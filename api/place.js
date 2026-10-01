async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'OTATAM-prototype/1.1' } });
    if (!r.ok) throw new Error(`Provider error ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function commonsFileUrl(filename, width=1400){
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

function uniq(arr){
  return [...new Set(arr.filter(Boolean))];
}

function wikipediaParts(tag){
  if(!tag) return null;
  const i=tag.indexOf(':');
  if(i>0 && i<6) return {lang:tag.slice(0,i),title:tag.slice(i+1)};
  return {lang:'en',title:tag};
}

module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const p=req.body||{};
    if(!p.name || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) {
      return res.status(400).json({error:'Missing exact place data'});
    }

    const photos=[];
    const sources=[];
    let description='';
    let wikiUrl=null;

    if(typeof p.image==='string' && /^https?:\/\//i.test(p.image)) {
      photos.push(p.image); sources.push('OpenStreetMap image tag');
    }

    if(p.wikidata){
      try{
        const wd=await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(p.wikidata)}.json`);
        const entity=wd.entities?.[p.wikidata];
        const fn=entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if(fn){ photos.push(commonsFileUrl(fn)); sources.push('Wikidata P18 / Wikimedia Commons'); }
        if(!description){
          description=entity?.descriptions?.en?.value || entity?.descriptions?.bg?.value || '';
        }
      }catch(e){}
    }

    const wp=wikipediaParts(p.wikipedia);
    if(wp){
      try{
        const sum=await getJSON(`https://${encodeURIComponent(wp.lang)}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wp.title)}`);
        if(sum.thumbnail?.source){ photos.push(sum.thumbnail.source.replace(/\/\d+px-/,'/1200px-')); sources.push('Wikipedia thumbnail'); }
        if(!description && sum.extract) description=sum.extract;
        if(sum.content_urls?.desktop?.page) wikiUrl=sum.content_urls.desktop.page;
      }catch(e){}
    }

    const exactPhotoCount=uniq(photos).length;
    return res.status(200).json({
      name:p.name,
      lat:Number(p.lat),lon:Number(p.lon),
      address:p.address||null,
      openingHours:p.openingHours||null,
      website:p.website||null,
      phone:p.phone||null,
      osm:p.osm||null,
      wikidata:p.wikidata||null,
      wikipedia:p.wikipedia||null,
      wikipediaUrl:wikiUrl,
      description:description || 'No verified editorial description is attached to this exact place yet.',
      photos:uniq(photos),
      photoSources:uniq(sources),
      photoConfidence:exactPhotoCount ? 'linked-to-exact-place' : 'no-verified-photo',
      coordinateConfidence:'exact-osm-object'
    });
  }catch(e){
    return res.status(500).json({error:e.message||'Place enrichment failed'});
  }
};
