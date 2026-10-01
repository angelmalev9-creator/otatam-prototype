async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6500);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'OTATAM-prototype/1.3' } });
    if (!r.ok) throw new Error(`Грешка от доставчик ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function commonsFileUrl(filename, width=1400){
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }
function wikipediaParts(tag){
  if(!tag) return null;
  const i=tag.indexOf(':');
  if(i>0 && i<6) return {lang:tag.slice(0,i),title:tag.slice(i+1)};
  return {lang:'en',title:tag};
}
function suspiciousImageName(s=''){ return /(?:map|karte|locator|location|district|bezirk|coat.of.arms|wappen|flag|plan|diagram|logo|seal|emblem|\.svg)/i.test(String(s)); }
function norm(s=''){
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9а-я]+/gi,' ').trim();
}
function tokenMatch(title,name){
  const a=new Set(norm(name).split(/\s+/).filter(x=>x.length>2));
  const b=new Set(norm(title).split(/\s+/).filter(x=>x.length>2));
  if(!a.size) return false;
  let hit=0; for(const t of a) if(b.has(t)) hit++;
  return hit >= Math.max(1, Math.ceil(a.size*0.5));
}
async function commonsCategoryPhoto(category){
  if(!category) return null;
  const clean=String(category).replace(/^Category:/i,'');
  const u='https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle='+encodeURIComponent('Category:'+clean)+'&gcmtype=file&gcmlimit=12&prop=imageinfo&iiprop=url|mime&iiurlwidth=1400&format=json';
  const d=await getJSON(u);
  for(const page of Object.values(d.query?.pages||{})){
    const ii=page.imageinfo?.[0];
    if(ii?.thumburl && /^image\/(jpeg|png|webp)$/i.test(ii.mime||'')) return {url:ii.thumburl,title:page.title};
  }
  return null;
}
async function commonsGeoPhoto(lat,lon,name){
  const u=`https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggsprimary=all&ggsnamespace=6&ggslimit=20&ggsradius=120&ggscoord=${lat}%7C${lon}&prop=imageinfo&iiprop=url|mime&iiurlwidth=1400&format=json`;
  const d=await getJSON(u);
  const pages=Object.values(d.query?.pages||{});
  const ranked=pages.filter(p=>tokenMatch(p.title,name)).concat(pages.filter(p=>!tokenMatch(p.title,name)));
  for(const page of ranked){
    const ii=page.imageinfo?.[0];
    if(ii?.thumburl && /^image\/(jpeg|png|webp)$/i.test(ii.mime||'')) return {url:ii.thumburl,title:page.title,matched:tokenMatch(page.title,name)};
  }
  return null;
}

module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Разрешен е само POST'});
  try{
    const p=req.body||{};
    if(!p.name || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) {
      return res.status(400).json({error:'Липсват точни данни за мястото'});
    }

    const photos=[]; const sources=[]; let description=''; let wikiUrl=null;
    let commonsCategory=null; let commonsPage=null;
    const inputImage=(typeof p.image==='string' && /^https?:\/\//i.test(p.image)) ? p.image : null;

    const tasks=[];
    if(p.wikidata){
      tasks.push(getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(p.wikidata)}.json`)
        .then(wd=>({type:'wikidata',data:wd})).catch(()=>null));
    }
    const wp=wikipediaParts(p.wikipedia);
    if(wp){
      tasks.push(getJSON(`https://${encodeURIComponent(wp.lang)}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wp.title)}`)
        .then(data=>({type:'wikipedia',data})).catch(()=>null));
    }

    const results=await Promise.all(tasks);
    for(const result of results){
      if(!result) continue;
      if(result.type==='wikidata'){
        const entity=result.data.entities?.[p.wikidata];
        const fn=entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if(fn && !suspiciousImageName(fn)){ photos.push(commonsFileUrl(fn)); sources.push('Wikidata P18 / Wikimedia Commons'); }
        commonsCategory=entity?.claims?.P373?.[0]?.mainsnak?.datavalue?.value || null;
        commonsPage=entity?.sitelinks?.commonswiki?.title || null;
        description=description || entity?.descriptions?.bg?.value || entity?.descriptions?.en?.value || '';
      }
      if(result.type==='wikipedia'){
        const sum=result.data;
        if(sum.thumbnail?.source && !suspiciousImageName(sum.thumbnail.source)){ photos.push(sum.thumbnail.source.replace(/\/\d+px-/,'/1200px-')); sources.push('Wikipedia'); }
        if(!description && sum.extract) description=sum.extract;
        if(sum.content_urls?.desktop?.page) wikiUrl=sum.content_urls.desktop.page;
      }
    }

    if(!photos.length && inputImage && !suspiciousImageName(inputImage)){ photos.push(inputImage); sources.push('Wikipedia / свързана снимка'); }

    if(!photos.length && (commonsCategory || commonsPage)){
      try{
        const hit=await commonsCategoryPhoto(commonsCategory || commonsPage);
        if(hit){ photos.push(hit.url); sources.push('Wikimedia Commons категория за точното място'); }
      }catch(e){}
    }

    if(!photos.length){
      try{
        const hit=await commonsGeoPhoto(Number(p.lat),Number(p.lon),p.name);
        if(hit && hit.matched && !suspiciousImageName(hit.title)){
          photos.push(hit.url);
          sources.push('Wikimedia Commons · име + близки координати');
        }
      }catch(e){}
    }

    const exactPhotoCount=uniq(photos).length;
    res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      name:p.name, lat:Number(p.lat), lon:Number(p.lon),
      address:p.address||null, openingHours:p.openingHours||null,
      website:p.website||null, phone:p.phone||null,
      osm:p.osm||null, wikidata:p.wikidata||null, wikipedia:p.wikipedia||null,
      wikipediaUrl:wikiUrl,
      description:description || 'За това място все още няма потвърдено редакционно описание.',
      photos:uniq(photos), photoSources:uniq(sources),
      photoConfidence:exactPhotoCount ? 'снимка-от-свързан-свободен-източник' : 'няма-потвърдена-снимка',
      coordinateConfidence:'точен-osm-обект'
    });
  }catch(e){
    return res.status(500).json({error:e.message||'Данните за мястото не се заредиха'});
  }
};
