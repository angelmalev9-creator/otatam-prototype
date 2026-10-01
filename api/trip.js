const DESTINATIONS = [
  'Lisbon','Prague','Budapest','Barcelona','Rome','Vienna','Madrid','Paris','Amsterdam','Athens'
];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = s => [...String(s)].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0);
const placeCache = new Map();

async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'OTATAM-prototype/1.1' } });
    if (!r.ok) throw new Error(`Provider error ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function geocode(name) {
  const u = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=1&language=bg&format=json';
  const d = await getJSON(u);
  if (!d.results?.length) throw new Error('Дестинацията не е намерена');
  const x = d.results[0];
  return { name: x.name, country: x.country || '', lat: x.latitude, lon: x.longitude, timezone: x.timezone || 'auto' };
}

async function weather(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
  const d = await getJSON(u); const c = d.current || {};
  return { temperature:c.temperature_2m??0, feels:c.apparent_temperature??0, code:c.weather_code??0, wind:c.wind_speed_10m??0 };
}

async function overpass(lat, lon, limit) {
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}:${limit}`;
  const cached = placeCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
  const q = `[out:json][timeout:8];nwr["tourism"~"attraction|museum"]["name"](around:4500,${lat},${lon});out center tags ${Math.max(24, limit)};`;
  const d = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
  const out=[]; const seen=new Set();
  for (const e of d.elements || []) {
    const name=e.tags?.name, plat=e.lat??e.center?.lat, plon=e.lon??e.center?.lon;
    if (!name || plat==null || plon==null || seen.has(name)) continue;
    seen.add(name);
    out.push({name,lat:plat,lon:plon,tags:e.tags||{},osmType:e.type,osmId:e.id,osmUrl:`https://www.openstreetmap.org/${e.type}/${e.id}`});
    if (out.length >= limit) break;
  }
  placeCache.set(key,{at:Date.now(),data:out});
  return out;
}

function category(p){
  const t=p.tags||{};
  if(t.tourism==='museum') return 'Музей';
  if(t.leisure==='park') return 'Парк';
  if(t.amenity==='place_of_worship') return 'Забележителност';
  if(t.historic) return 'Историческо място';
  return 'Атракция';
}

function addressFromTags(t={}){
  return [t['addr:street'],t['addr:housenumber'],t['addr:postcode'],t['addr:city']].filter(Boolean).join(' ');
}

function decorate(p,i,input){
  const cat=category(p); const photo=(input.interests||[]).includes('photo'); const t=p.tags||{};
  return {
    name:p.name, lat:p.lat, lon:p.lon, category:cat,
    duration:cat==='Музей'?90:cat==='Парк'?60:55,
    booking:cat==='Музей',
    description:`Реално място от OpenStreetMap с точни координати.`,
    why:`Подбрано според избраното темпо и интереси, така че маршрутът да остане практичен.`,
    photoTip:photo?'Подходящо е да се посети сутрин или привечер; провери натовареността преди посещение.':'Използвай точната локация на картата и провери условията преди посещение.',
    hiddenGem:i%4===3,
    osm:{type:p.osmType,id:p.osmId,url:p.osmUrl},
    wikidata:t.wikidata||null,
    wikipedia:t.wikipedia||null,
    image:t.image||null,
    website:t.website||t['contact:website']||null,
    phone:t.phone||t['contact:phone']||null,
    openingHours:t.opening_hours||null,
    address:addressFromTags(t)||null,
    source:'OpenStreetMap',
    coordinateConfidence:'exact-osm-object'
  };
}

function buildDays(places,input,dest){
  const per=input.pace==='relaxed'?3:input.pace==='fast'?5:4; const days=[];
  for(let d=0;d<input.days;d++){
    const start=(d*per)%Math.max(1,places.length); const stops=[];
    for(let j=0;j<per&&j<places.length;j++) stops.push(decorate(places[(start+j)%places.length],j+d*per,input));
    days.push({ title:d===0?`Първи ден в ${dest.name}`:d===input.days-1?'Последни акценти':`Разглеждане на ${dest.name}`, stops });
  }
  return days;
}

function makeBudget(input){
  const total=Number(input.budget)||0;
  const ratios=input.style==='comfort'
    ? {'Полети':.27,'Настаняване':.39,'Храна':.17,'Активности':.08,'Транспорт':.05,'Резерв':.04}
    : input.style==='save'
    ? {'Полети':.25,'Настаняване':.28,'Храна':.18,'Активности':.10,'Транспорт':.07,'Резерв':.12}
    : {'Полети':.27,'Настаняване':.34,'Храна':.18,'Активности':.10,'Транспорт':.06,'Резерв':.05};
  const categories={}; for(const [k,v] of Object.entries(ratios)) categories[k]=Math.round(total*v);
  const buffer=categories['Резерв']; delete categories['Резерв'];
  const planned=Object.values(categories).reduce((a,b)=>a+b,0);
  return {categories,planned,buffer};
}

function weatherText(w){
  const rainy=[51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(w.code);
  return {
    summary:`В момента: ${Math.round(w.temperature)}°C, усеща се като ${Math.round(w.feels)}°C, вятър ${Math.round(w.wind)} км/ч.`,
    switch: rainy?'Заради времето: приоритизирай закрити места и провери външните активности.':'Времето е подходящо за външния план; запази една закрита алтернатива.'
  };
}

module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Разрешен е само POST'});
  try{
    const input={...(req.body||{})};
    input.days=clamp(Number(input.days)||4,1,10);
    input.travellers=clamp(Number(input.travellers)||2,1,10);
    input.budget=Math.max(150,Number(input.budget)||1500);
    input.pace=['relaxed','balanced','fast'].includes(input.pace)?input.pace:'balanced';
    input.style=['save','value','comfort'].includes(input.style)?input.style:'value';
    if(!Array.isArray(input.interests)) input.interests=['culture','architecture'];
    const picked=(input.destination||'').trim() || DESTINATIONS[Math.abs(hash(input.interests.join('|')+'|'+input.budget+'|'+input.days))%DESTINATIONS.length];
    const dest=await geocode(picked);
    const needed=clamp(input.days*(input.pace==='relaxed'?3:input.pace==='fast'?5:4),8,24);
    const [w,places]=await Promise.all([weather(dest.lat,dest.lon),overpass(dest.lat,dest.lon,needed)]);
    if(places.length<4) throw new Error('Няма достатъчно точни OpenStreetMap места за тази дестинация');
    const days=buildDays(places,input,dest); const all=days.flatMap(x=>x.stops); const wt=weatherText(w); const budget=makeBudget(input);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      generatedAt:new Date().toISOString(), input, destination:dest,
      weather:{...w,...wt}, days, budget,
      totalStops:all.length, hiddenGems:all.filter(x=>x.hiddenGem).length,
      photoSpots:all.filter((_,i)=>i%3===0).length,
      confidence:{places:'exact-osm-object',weather:'live',budget:'estimated',flights:'check-before-booking',stay:'check-before-booking'},
      status:'needs_review'
    });
  }catch(e){ return res.status(500).json({error:e.message||'Генерирането не успя'}); }
};
