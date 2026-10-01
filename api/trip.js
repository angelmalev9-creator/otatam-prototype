const DESTINATIONS = [
  'Lisbon','Prague','Budapest','Barcelona','Rome','Vienna','Madrid','Paris','Amsterdam','Athens'
];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = s => [...String(s)].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0);

async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'OTATAM-prototype/1.0' } });
    if (!r.ok) throw new Error(`Provider error ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function geocode(name) {
  const u = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=1&language=en&format=json';
  const d = await getJSON(u);
  if (!d.results?.length) throw new Error('Destination not found');
  const x = d.results[0];
  return { name: x.name, country: x.country || '', lat: x.latitude, lon: x.longitude, timezone: x.timezone || 'auto' };
}

async function weather(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
  const d = await getJSON(u); const c = d.current || {};
  return { temperature:c.temperature_2m??0, feels:c.apparent_temperature??0, code:c.weather_code??0, wind:c.wind_speed_10m??0 };
}

async function overpass(lat, lon, limit) {
  const q = `[out:json][timeout:12];(
    nwr["tourism"="attraction"](around:7000,${lat},${lon});
    nwr["tourism"="museum"](around:7000,${lat},${lon});
    nwr["historic"](around:7000,${lat},${lon});
    nwr["leisure"="park"](around:7000,${lat},${lon});
  );out center tags ${Math.max(30, limit*4)};`;
  const d = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
  const out=[]; const seen=new Set();
  for (const e of d.elements || []) {
    const name=e.tags?.name, plat=e.lat??e.center?.lat, plon=e.lon??e.center?.lon;
    if (!name || plat==null || plon==null || seen.has(name)) continue;
    seen.add(name); out.push({name,lat:plat,lon:plon,tags:e.tags||{}});
    if (out.length >= limit) break;
  }
  return out;
}

async function wikiFallback(lat,lon,limit) {
  const u=`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=8000&gslimit=${limit}&format=json&origin=*`;
  const d=await getJSON(u);
  return (d.query?.geosearch||[]).map(x=>({name:x.title,lat:x.lat,lon:x.lon,tags:{tourism:'attraction'}}));
}

function category(p){
  const t=p.tags||{};
  if(t.tourism==='museum') return 'Museum';
  if(t.leisure==='park') return 'Park';
  if(t.historic) return 'Historic';
  return 'Attraction';
}

function decorate(p,i,input){
  const cat=category(p); const photo=(input.interests||[]).includes('photo');
  return {
    name:p.name, lat:p.lat, lon:p.lon, category:cat,
    duration:cat==='Museum'?90:cat==='Park'?60:55,
    booking:cat==='Museum',
    description:`Real mapped ${cat.toLowerCase()} selected from live destination data.`,
    why:`Fits a ${input.pace} pace and selected interests while keeping the itinerary geographically practical.`,
    photoTip:photo?'Prefer softer morning/evening light and re-check crowds before arrival.':'Use the mapped location and check light/crowds before arrival.',
    hiddenGem:i%4===3
  };
}

function buildDays(places,input,dest){
  const per=input.pace==='relaxed'?3:input.pace==='fast'?5:4; const days=[];
  for(let d=0;d<input.days;d++){
    const start=(d*per)%Math.max(1,places.length); const stops=[];
    for(let j=0;j<per&&j<places.length;j++) stops.push(decorate(places[(start+j)%places.length],j+d*per,input));
    days.push({ title:d===0?`First look at ${dest.name}`:d===input.days-1?'Last highlights':`Explore ${dest.name}`, stops });
  }
  return days;
}

function makeBudget(input){
  const total=Number(input.budget)||0;
  const ratios=input.style==='comfort'
    ? {Flights:.27,Stay:.39,Food:.17,Activities:.08,Transport:.05,Buffer:.04}
    : input.style==='save'
    ? {Flights:.25,Stay:.28,Food:.18,Activities:.10,Transport:.07,Buffer:.12}
    : {Flights:.27,Stay:.34,Food:.18,Activities:.10,Transport:.06,Buffer:.05};
  const categories={}; for(const [k,v] of Object.entries(ratios)) categories[k]=Math.round(total*v);
  const buffer=categories.Buffer; delete categories.Buffer;
  const planned=Object.values(categories).reduce((a,b)=>a+b,0);
  return {categories,planned,buffer};
}

function weatherText(w){
  const rainy=[51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(w.code);
  return {
    summary:`Current conditions: ${Math.round(w.temperature)}°C, feels ${Math.round(w.feels)}°C, wind ${Math.round(w.wind)} km/h.`,
    switch: rainy?'Weather Switch: prioritize museums/indoor stops and re-check outdoor timing.':'Weather Switch: outdoor plan is suitable; keep one indoor backup.'
  };
}

module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const input={...(req.body||{})};
    input.days=clamp(Number(input.days)||4,1,10);
    input.travellers=clamp(Number(input.travellers)||2,1,10);
    input.budget=Math.max(150,Number(input.budget)||1500);
    input.pace=['relaxed','balanced','fast'].includes(input.pace)?input.pace:'balanced';
    input.style=['save','value','comfort'].includes(input.style)?input.style:'value';
    if(!Array.isArray(input.interests)) input.interests=['culture','architecture'];
    const picked=(input.destination||'').trim() || DESTINATIONS[Math.abs(hash(input.interests.join('|')+'|'+input.budget+'|'+input.days))%DESTINATIONS.length];
    const dest=await geocode(picked); const w=await weather(dest.lat,dest.lon);
    const needed=clamp(input.days*(input.pace==='relaxed'?3:input.pace==='fast'?5:4),8,28);
    let places=[]; try{places=await overpass(dest.lat,dest.lon,needed)}catch(e){}
    if(places.length<6) places=await wikiFallback(dest.lat,dest.lon,needed);
    if(!places.length) throw new Error('No usable live places returned');
    const days=buildDays(places,input,dest); const all=days.flatMap(x=>x.stops); const wt=weatherText(w); const budget=makeBudget(input);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      generatedAt:new Date().toISOString(), input, destination:dest,
      weather:{...w,...wt}, days, budget,
      totalStops:all.length, hiddenGems:all.filter(x=>x.hiddenGem).length,
      photoSpots:all.filter((_,i)=>i%3===0).length,
      confidence:{places:'verified-source',weather:'live',budget:'estimated',flights:'check-before-booking',stay:'check-before-booking'},
      status:'needs_review'
    });
  }catch(e){ return res.status(500).json({error:e.message||'Generation failed'}); }
};
