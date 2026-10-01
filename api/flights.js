const BASE=(process.env.AMADEUS_BASE_URL||'https://test.api.amadeus.com').replace(/\/$/,'');

async function iata(name){
  const q=new URLSearchParams({term:name||'',locale:'en'});
  q.append('types[]','city'); q.append('types[]','airport');
  const r=await fetch('https://autocomplete.travelpayouts.com/places2?'+q);
  if(!r.ok)throw new Error('Airport lookup failed');
  const a=await r.json();
  const x=a.find(v=>v.type==='city'&&v.code)||a.find(v=>v.city_code)||a.find(v=>v.code);
  const code=x?.code||x?.city_code;
  if(!code)throw new Error('Не намерих летищен код за '+name);
  return code;
}
function mins(v){const n=Number(v)||0,h=Math.floor(n/60),m=n%60;return [h?`${h} ч`:null,m?`${m} мин`:null].filter(Boolean).join(' ')||'—'}

async function serpFlights(b){
  const key=process.env.SERPAPI_KEY;if(!key)return null;
  const adults=Math.max(1,Math.min(9,Number(b.adults)||1));
  const [origin,destination]=await Promise.all([iata(b.from||'Sofia'),iata(b.to||'')]);
  const q=new URLSearchParams({engine:'google_flights',departure_id:origin,arrival_id:destination,outbound_date:b.departureDate,currency:'EUR',hl:'en',gl:'bg',adults:String(adults),api_key:key});
  if(b.returnDate)q.set('return_date',b.returnDate);
  const r=await fetch('https://serpapi.com/search.json?'+q),d=await r.json();
  if(!r.ok||d.error)throw new Error(d.error||'Google Flights search failed');
  const raw=[...(d.best_flights||[]),...(d.other_flights||[])];
  const results=raw.slice(0,10).map((o,i)=>{const fs=o.flights||[],first=fs[0]||{},last=fs[fs.length-1]||{},airlines=[...new Set(fs.map(x=>x.airline).filter(Boolean))];return{id:`serp-${i}`,carrier:airlines.join(' + ')||'Полет',route:`${origin} → ${destination}`,departure:first.departure_airport?.time||'',arrival:last.arrival_airport?.time||'',duration:mins(o.total_duration),stops:Math.max(0,fs.length-1),price:o.price??'',currency:'EUR',source:'Google Flights',logo:first.airline_logo||o.airline_logo||'',token:o.departure_token||''}}).filter(x=>x.price!==''&&x.price!=null);
  return {configured:true,provider:'Google Flights via SerpApi',origin,destination,results};
}

async function token(){const id=process.env.AMADEUS_CLIENT_ID,secret=process.env.AMADEUS_CLIENT_SECRET;if(!id||!secret)return null;const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret});const r=await fetch(BASE+'/v1/security/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error('Amadeus authentication failed');return (await r.json()).access_token}
async function cityCode(name,t){const q=new URLSearchParams({subType:'CITY,AIRPORT',keyword:name,'page[limit]':'8',view:'LIGHT'});const r=await fetch(BASE+'/v1/reference-data/locations?'+q,{headers:{authorization:'Bearer '+t}});if(!r.ok)throw new Error('Airport lookup failed');const data=(await r.json()).data||[],city=data.find(x=>x.subType==='CITY'&&x.iataCode)||data.find(x=>x.iataCode);if(!city)throw new Error('Не намерих летищен код за '+name);return city.iataCode}
function duration(x=''){const h=(x.match(/(\d+)H/)||[])[1],m=(x.match(/(\d+)M/)||[])[1];return [h?`${h} ч`:null,m?`${m} мин`:null].filter(Boolean).join(' ')}
async function amadeusFlights(b){const t=await token();if(!t)return null;const adults=Math.max(1,Math.min(9,Number(b.adults)||1)),[origin,destination]=await Promise.all([cityCode(b.from||'Sofia',t),cityCode(b.to||'',t)]);const q=new URLSearchParams({originLocationCode:origin,destinationLocationCode:destination,departureDate:b.departureDate,adults:String(adults),currencyCode:'EUR',max:'8'});if(b.returnDate)q.set('returnDate',b.returnDate);const r=await fetch(BASE+'/v2/shopping/flight-offers?'+q,{headers:{authorization:'Bearer '+t}}),d=await r.json();if(!r.ok)throw new Error(d.errors?.[0]?.detail||'Flight search failed');const carriers=d.dictionaries?.carriers||{},results=(d.data||[]).map(o=>{const it=o.itineraries?.[0],segs=it?.segments||[],first=segs[0],last=segs[segs.length-1],code=o.validatingAirlineCodes?.[0]||first?.carrierCode||'';return{id:o.id,carrier:carriers[code]||code,route:`${origin} → ${destination}`,departure:first?.departure?.at?.replace('T',' ')||'',arrival:last?.arrival?.at?.replace('T',' ')||'',duration:duration(it?.duration),stops:Math.max(0,segs.length-1),price:o.price?.grandTotal||o.price?.total||'',currency:o.price?.currency||'EUR',source:'Amadeus'}});return{configured:true,provider:'Amadeus',origin,destination,results}}

module.exports=async function handler(req,res){if(req.method!=='POST')return res.status(405).json({error:'POST only'});try{const b=req.body||{},data=await serpFlights(b)||await amadeusFlights(b);if(!data)return res.status(200).json({configured:false,provider:'Google Flights / Amadeus',needs:'SERPAPI_KEY or Amadeus credentials'});res.setHeader('Cache-Control','s-maxage=180, stale-while-revalidate=300');return res.status(200).json(data)}catch(e){return res.status(500).json({error:e.message||'Flight search failed'})}};
