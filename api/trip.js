const DESTINATIONS=['Lisbon','Prague','Budapest','Barcelona','Rome','Vienna','Madrid','Paris','Amsterdam','Athens'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const hash=s=>[...String(s)].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0);
const placeCache=new Map();
const CAPITALS={BG:'Sofia',IT:'Rome',FR:'Paris',ES:'Madrid',AT:'Vienna',RO:'Bucharest',GR:'Athens',PT:'Lisbon',CZ:'Prague',HU:'Budapest',DE:'Berlin',NL:'Amsterdam',BE:'Brussels',HR:'Zagreb',SI:'Ljubljana',SK:'Bratislava',PL:'Warsaw',DK:'Copenhagen',SE:'Stockholm',NO:'Oslo',FI:'Helsinki',IE:'Dublin',GB:'London',CH:'Bern',RS:'Belgrade',MK:'Skopje',AL:'Tirana',ME:'Podgorica',BA:'Sarajevo',IS:'Reykjavik',EE:'Tallinn',LV:'Riga',LT:'Vilnius',CY:'Nicosia',MT:'Valletta',LU:'Luxembourg',MC:'Monaco',SM:'San Marino',VA:'Vatican City',AD:'Andorra la Vella',LI:'Vaduz',MD:'Chisinau',UA:'Kyiv',BY:'Minsk',TR:'Ankara',US:'Washington',CA:'Ottawa',AU:'Canberra',NZ:'Wellington',JP:'Tokyo',KR:'Seoul',CN:'Beijing',IN:'New Delhi',BR:'Brasilia',AR:'Buenos Aires',MX:'Mexico City',AE:'Abu Dhabi',TH:'Bangkok',SG:'Singapore',ID:'Jakarta',MY:'Kuala Lumpur',ZA:'Pretoria',EG:'Cairo',MA:'Rabat'};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9а-я]+/gi,' ').trim();

async function getJSON(url,timeout=7000){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  try{
    const r=await fetch(url,{signal:ctl.signal,headers:{'user-agent':'OTATAM-production-mvp/2.1'}});
    if(!r.ok)throw new Error(`Грешка от доставчик ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer)}
}

async function geoSearch(name,language){
  const u='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=10&language='+language+'&format=json';
  return (await getJSON(u)).results||[];
}
function scoreGeo(x,q){
  const n=norm(q),name=norm(x.name),country=norm(x.country);let s=0;
  if(name===n)s+=160;if(country===n)s+=130;if(x.feature_code==='PCLI')s+=110;if(x.feature_code==='PPLC')s+=95;if(/^PPLA/.test(x.feature_code||''))s+=65;
  if(x.population)s+=Math.min(35,Math.log10(Number(x.population)+1)*5);if(name.includes(n)||n.includes(name))s+=20;return s;
}
async function resolveCountryCapital(countryEnglish,countryLocal,countryCode){
  const known=CAPITALS[countryCode];
  if(known){
    try{
      const [en,bg]=await Promise.all([geoSearch(known,'en').catch(()=>[]),geoSearch(known,'bg').catch(()=>[])]);
      const valid=en.concat(bg).filter(r=>r.country_code===countryCode&&['PPLC','PPLA','PPLA2'].includes(r.feature_code));
      if(valid.length){
        const base=en.find(r=>r.country_code===countryCode&&r.feature_code==='PPLC')||valid[0];
        const local=bg.find(r=>r.country_code===countryCode&&r.feature_code===base.feature_code)||base;
        return{name:local.name||base.name,searchName:base.name,country:countryLocal||countryEnglish,countryCode,lat:base.latitude,lon:base.longitude,timezone:base.timezone||'auto',featureCode:base.feature_code||'PPLC',requestedCountry:{name:countryEnglish,country:countryLocal||countryEnglish,countryCode},displayName:`${countryLocal||countryEnglish} · ${local.name||base.name}`};
      }
    }catch(e){}
  }
  try{
    const wp=await getJSON('https://en.wikipedia.org/w/api.php?action=query&titles='+encodeURIComponent(countryEnglish)+'&prop=pageprops&format=json&origin=*',5000);
    const page=Object.values(wp.query?.pages||{})[0],qid=page?.pageprops?.wikibase_item;if(!qid)return null;
    const wd=await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,5000),entity=wd.entities?.[qid];
    const capId=entity?.claims?.P36?.[0]?.mainsnak?.datavalue?.value?.id;if(!capId)return null;
    const capData=await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${capId}.json`,5000),cap=capData.entities?.[capId];
    const coord=cap?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;if(!coord)return null;
    const enLabel=cap?.labels?.en?.value||'Capital',label=cap?.labels?.bg?.value||enLabel;
    return{name:label,searchName:enLabel,country:countryLocal||countryEnglish,countryCode,lat:coord.latitude,lon:coord.longitude,timezone:'auto',featureCode:'PPLC',requestedCountry:{name:countryEnglish,country:countryLocal||countryEnglish,countryCode},displayName:`${countryLocal||countryEnglish} · ${label}`};
  }catch(e){return null}
}
async function geocode(name){
  const hasCyr=/[а-я]/i.test(name),langs=hasCyr?['bg','en']:['en','bg'];
  const results=(await Promise.all(langs.map(l=>geoSearch(name,l).catch(()=>[])))).flat();
  if(!results.length)throw new Error('Дестинацията не е намерена');
  const ranked=results.slice().sort((a,b)=>scoreGeo(b,name)-scoreGeo(a,name)),x=ranked[0];
  if(x.feature_code==='PCLI'){
    const en=results.find(r=>r.feature_code==='PCLI'&&r.country_code===x.country_code&&/[A-Za-z]/.test(r.name))||x;
    const cap=await resolveCountryCapital(en.name,x.country||x.name,x.country_code||'');if(cap)return cap;
  }
  const alias=results.find(r=>r.id===x.id&&/[A-Za-z]/.test(r.name))||results.find(r=>Math.abs(r.latitude-x.latitude)<0.0001&&Math.abs(r.longitude-x.longitude)<0.0001&&/[A-Za-z]/.test(r.name));
  return{name:x.name,searchName:alias?.name||x.name,country:x.country||'',countryCode:x.country_code||'',lat:x.latitude,lon:x.longitude,timezone:x.timezone||'auto',featureCode:x.feature_code||'',requestedCountry:null,displayName:x.name};
}

async function weather(lat,lon){
  const d=await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`),c=d.current||{};
  return{temperature:c.temperature_2m??0,feels:c.apparent_temperature??0,code:c.weather_code??0,wind:c.wind_speed_10m??0};
}

function irrelevant(title,dest){
  const t=norm(title),d=norm(dest);
  return t===d||/^(history of|list of|timeline of|siege of|battle of|district of|administrative divisions of|transport in|economy of|demographics of)/i.test(title)||/\b(\d{4}|\d{3} bc)\b/i.test(title)||/ railway station$| metro station$| football club$| season$/i.test(title);
}
function suspiciousImageName(s=''){
  return /(?:map|karte|locator|location|district|bezirk|borough|ward|coat.of.arms|wappen|flag|plan|diagram|logo|seal|emblem|\.svg)/i.test(String(s));
}
function broadPlaceDescription(s=''){
  return /\b(district|municipal district|administrative (?:district|division|area|unit)|borough|neighbou?rhood|quarter|subdivision|ward|city district|historic centre|historical centre|old town area)\b/i.test(String(s));
}
function commonsFile(filename){return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=1200`}

async function enrichWikidata(places){
  const ids=[...new Set(places.filter(p=>p.wikidata).map(p=>p.wikidata))].slice(0,45);if(!ids.length)return places;
  try{
    const d=await getJSON('https://www.wikidata.org/w/api.php?action=wbgetentities&ids='+encodeURIComponent(ids.join('|'))+'&props=claims|descriptions&languages=en|bg&format=json&origin=*',6500);
    for(const p of places){
      if(!p.wikidata)continue;
      const entity=d.entities?.[p.wikidata],desc=entity?.descriptions?.en?.value||entity?.descriptions?.bg?.value||'';
      if(broadPlaceDescription(desc)){p.reject=true;continue}
      if(p.image&&suspiciousImageName(p.image))p.image=null;
      if(!p.image){
        const fn=entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if(fn&&!suspiciousImageName(fn))p.image=commonsFile(fn);
      }
    }
  }catch(e){}
  return places;
}

async function overpassPlaces(lat,lon,limit,destName){
  const q=`[out:json][timeout:8];(nwr["tourism"~"attraction|museum|gallery|viewpoint"]["name"](around:7000,${lat},${lon});nwr["historic"]["name"](around:7000,${lat},${lon}););out center tags ${Math.max(60,limit*4)};`;
  const d=await getJSON('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),9000),out=[],seen=new Set();
  for(const e of d.elements||[]){
    const name=e.tags?.name,plat=e.lat??e.center?.lat,plon=e.lon??e.center?.lon;
    if(!name||plat==null||plon==null||seen.has(norm(name))||irrelevant(name,destName))continue;
    seen.add(norm(name));
    const rawImage=/^https?:\/\//i.test(e.tags?.image||'')?e.tags.image:null;
    out.push({name,lat:plat,lon:plon,wikidata:e.tags?.wikidata||null,wikipedia:e.tags?.wikipedia||null,image:rawImage&&!suspiciousImageName(rawImage)?rawImage:null,source:'OpenStreetMap / Wikidata',coordinateConfidence:'точен-osm-обект'});
    if(out.length>=limit*3)break;
  }
  await enrichWikidata(out);
  return out.filter(p=>!p.reject).sort((a,b)=>Number(!!b.image)-Number(!!a.image)).slice(0,limit);
}

async function wikiPlaces(lat,lon,limit,destName){
  const key=`${lat.toFixed(3)}:${lon.toFixed(3)}:${limit}`,cached=placeCache.get(key);
  if(cached&&Date.now()-cached.at<30*60*1000)return cached.data;
  try{
    const params=new URLSearchParams({action:'query',generator:'geosearch',ggscoord:`${lat}|${lon}`,ggsradius:'10000',ggslimit:String(Math.max(100,limit*6)),ggsnamespace:'0',prop:'coordinates|pageimages|pageprops',piprop:'thumbnail',pithumbsize:'1200',format:'json',origin:'*'});
    const d=await getJSON('https://en.wikipedia.org/w/api.php?'+params.toString(),8000),pages=Object.values(d.query?.pages||{}).filter(p=>p.coordinates?.[0]&&!irrelevant(p.title,destName));
    pages.sort((a,b)=>Number(!!b.thumbnail)-Number(!!a.thumbnail)||(a.index||999)-(b.index||999));
    const out=[];
    for(const p of pages){
      const c=p.coordinates[0],thumb=p.thumbnail?.source||null;
      out.push({name:p.title,lat:c.lat,lon:c.lon,wikidata:p.pageprops?.wikibase_item||null,wikipedia:`en:${p.title}`,image:thumb&&!suspiciousImageName(thumb)?thumb:null,source:'Wikipedia GeoSearch / Wikidata',coordinateConfidence:'координати-на-конкретното-място'});
      if(out.length>=limit*3)break;
    }
    await enrichWikidata(out);
    let clean=out.filter(p=>!p.reject).sort((a,b)=>Number(!!b.image)-Number(!!a.image));
    if(clean.length<limit){
      try{
        const extra=await overpassPlaces(lat,lon,limit,destName),seen=new Set(clean.map(x=>norm(x.name)));
        for(const x of extra){const k=norm(x.name);if(!seen.has(k)){seen.add(k);clean.push(x)}}
      }catch(e){}
    }
    clean=clean.slice(0,limit);placeCache.set(key,{at:Date.now(),data:clean});return clean;
  }catch(e){
    const out=await overpassPlaces(lat,lon,limit,destName);placeCache.set(key,{at:Date.now(),data:out});return out;
  }
}

function decorate(p,i,input){
  const photo=(input.interests||[]).includes('photo');
  return{name:p.name,lat:p.lat,lon:p.lon,category:'Забележителност',duration:60,booking:false,description:'Реално място с проверими координати и източник.',why:'Подбрано спрямо темпото, интересите и географската близост.',photoTip:photo?'Посети при мека сутрешна или вечерна светлина и провери натовареността.':'Провери работното време и условията преди посещение.',hiddenGem:i%4===3,wikidata:p.wikidata,wikipedia:p.wikipedia,image:p.image,website:null,phone:null,openingHours:null,address:null,source:p.source,coordinateConfidence:p.coordinateConfidence};
}
function buildDays(places,input,dest){
  const per=input.pace==='relaxed'?3:input.pace==='fast'?5:4,days=[];
  for(let d=0;d<input.days;d++){
    const start=d*per,stops=[];
    for(let j=0;j<per&&start+j<places.length;j++)stops.push(decorate(places[start+j],j+d*per,input));
    if(!stops.length)break;
    days.push({title:d===0?`Първи ден в ${dest.name}`:d===input.days-1?'Последни акценти':`Разглеждане на ${dest.name}`,cover:stops.find(s=>s.image)?.image||null,stops});
  }
  return days;
}
function makeBudget(input){
  const total=Number(input.budget)||0,ratios=input.style==='comfort'?{'Полети':.27,'Настаняване':.39,'Храна':.17,'Активности':.08,'Транспорт':.05,'Резерв':.04}:input.style==='save'?{'Полети':.25,'Настаняване':.28,'Храна':.18,'Активности':.10,'Транспорт':.07,'Резерв':.12}:{'Полети':.27,'Настаняване':.34,'Храна':.18,'Активности':.10,'Транспорт':.06,'Резерв':.05},categories={};
  for(const[k,v]of Object.entries(ratios))categories[k]=Math.round(total*v);
  const buffer=categories['Резерв'];delete categories['Резерв'];return{categories,planned:Object.values(categories).reduce((a,b)=>a+b,0),buffer};
}
function weatherText(w){
  const rainy=[51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(w.code);
  return{summary:`В момента: ${Math.round(w.temperature)}°C, усеща се като ${Math.round(w.feels)}°C, вятър ${Math.round(w.wind)} км/ч.`,switch:rainy?'Заради времето: приоритизирай закрити места и провери външните активности.':'Времето е подходящо за външния план; запази една закрита алтернатива.'};
}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Разрешен е само POST'});
  try{
    const input={...(req.body||{})};
    input.days=clamp(Number(input.days)||4,1,10);input.travellers=clamp(Number(input.travellers)||2,1,10);input.budget=Math.max(150,Number(input.budget)||1500);
    input.pace=['relaxed','balanced','fast'].includes(input.pace)?input.pace:'balanced';input.style=['save','value','comfort'].includes(input.style)?input.style:'value';if(!Array.isArray(input.interests))input.interests=['culture','architecture'];
    const picked=(input.destination||'').trim()||DESTINATIONS[Math.abs(hash(input.interests.join('|')+'|'+input.budget+'|'+input.days))%DESTINATIONS.length],dest=await geocode(picked),needed=clamp(input.days*(input.pace==='relaxed'?3:input.pace==='fast'?5:4),8,24);
    const [w,places]=await Promise.all([weather(dest.lat,dest.lon),wikiPlaces(dest.lat,dest.lon,needed,dest.searchName||dest.name)]);
    if(places.length<4)throw new Error('Няма достатъчно надеждни места за тази дестинация');
    const days=buildDays(places,input,dest),all=days.flatMap(x=>x.stops),wt=weatherText(w),budget=makeBudget(input);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({generatedAt:new Date().toISOString(),input,destination:dest,weather:{...w,...wt},days,budget,totalStops:all.length,hiddenGems:all.filter(x=>x.hiddenGem).length,photoSpots:all.filter(x=>x.image).length,confidence:{places:'wikipedia-wikidata-coordinates',weather:'live',budget:'estimated',flights:'external-live-search',stay:'external-live-search'},status:'needs_review'});
  }catch(e){return res.status(500).json({error:e.message||'Генерирането не успя'})}
};
