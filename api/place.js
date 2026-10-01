async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6500);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'OTATAM-prototype/1.2' } });
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

module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Разрешен е само POST'});
  try{
    const p=req.body||{};
    if(!p.name || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) {
      return res.status(400).json({error:'Липсват точни данни за мястото'});
    }

    const photos=[]; const sources=[]; let description=''; let wikiUrl=null;
    if(typeof p.image==='string' && /^https?:\/\//i.test(p.image)) {
      photos.push(p.image); sources.push('Снимка от Wikipedia/Wikimedia');
    }

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
        if(fn){ photos.push(commonsFileUrl(fn)); sources.push('Wikidata / Wikimedia Commons'); }
        description=description || entity?.descriptions?.bg?.value || entity?.descriptions?.en?.value || '';
      }
      if(result.type==='wikipedia'){
        const sum=result.data;
        if(sum.thumbnail?.source){ photos.push(sum.thumbnail.source.replace(/\/\d+px-/,'/1200px-')); sources.push('Wikipedia'); }
        if(!description && sum.extract) description=sum.extract;
        if(sum.content_urls?.desktop?.page) wikiUrl=sum.content_urls.desktop.page;
      }
    }

    const exactPhotoCount=uniq(photos).length;
    res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({
      name:p.name, lat:Number(p.lat), lon:Number(p.lon),
      address:p.address||null, openingHours:p.openingHours||null,
      website:p.website||null, phone:p.phone||null,
      osm:p.osm||null, wikidata:p.wikidata||null, wikipedia:p.wikipedia||null,
      wikipediaUrl:wikiUrl,
      description:description || 'За това точно място все още няма потвърдено редакционно описание.',
      photos:uniq(photos), photoSources:uniq(sources),
      photoConfidence:exactPhotoCount ? 'свързана-с-точното-място' : 'няма-потвърдена-снимка',
      coordinateConfidence:'точен-osm-обект'
    });
  }catch(e){
    return res.status(500).json({error:e.message||'Данните за мястото не се заредиха'});
  }
};
