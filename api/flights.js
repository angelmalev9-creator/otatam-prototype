const BASE=(process.env.AMADEUS_BASE_URL||'https://test.api.amadeus.com').replace(/\/$/,'');
async function token(){
  const id=process.env.AMADEUS_CLIENT_ID, secret=process.env.AMADEUS_CLIENT_SECRET;
  if(!id||!secret)return null;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret});
  const r=await fetch(BASE+'/v1/security/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!r.ok)throw new Error('Amadeus authentication failed');
  return (await r.json()).access_token;
}
async function cityCode(name,t){
  const q=new URLSearchParams({subType:'CITY,AIRPORT',keyword:name,'page[limit]':'8',view:'LIGHT'});
  const r=await fetch(BASE+'/v1/reference-data/locations?'+q,{headers:{authorization:'Bearer '+t}});
  if(!r.ok)throw new Error('Airport lookup failed');
  const data=(await r.json()).data||[];
  const city=data.find(x=>x.subType==='CITY'&&x.iataCode)||data.find(x=>x.iataCode);
  if(!city)throw new Error('Не намерих летищен код за '+name);
  return city.iataCode;
}
function duration(x=''){
  const h=(x.match(/(\d+)H/)||[])[1],m=(x.match(/(\d+)M/)||[])[1];
  return [h?`${h} ч`:null,m?`${m} мин`:null].filter(Boolean).join(' ');
}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    const t=await token();
    if(!t)return res.status(200).json({configured:false,provider:'Amadeus'});
    const b=req.body||{}, adults=Math.max(1,Math.min(9,Number(b.adults)||1));
    const [origin,destination]=await Promise.all([cityCode(b.from||'Sofia',t),cityCode(b.to||'',t)]);
    const q=new URLSearchParams({originLocationCode:origin,destinationLocationCode:destination,departureDate:b.departureDate,adults:String(adults),currencyCode:'EUR',max:'8'});
    if(b.returnDate)q.set('returnDate',b.returnDate);
    const r=await fetch(BASE+'/v2/shopping/flight-offers?'+q,{headers:{authorization:'Bearer '+t}});
    const d=await r.json(); if(!r.ok)throw new Error(d.errors?.[0]?.detail||'Flight search failed');
    const carriers=d.dictionaries?.carriers||{};
    const results=(d.data||[]).map(o=>{
      const it=o.itineraries?.[0],segs=it?.segments||[],first=segs[0],last=segs[segs.length-1],code=o.validatingAirlineCodes?.[0]||first?.carrierCode||'';
      return {id:o.id,carrier:carriers[code]||code,route:`${origin} → ${destination}`,departure:first?.departure?.at?.replace('T',' ')||'',arrival:last?.arrival?.at?.replace('T',' ')||'',duration:duration(it?.duration),stops:Math.max(0,segs.length-1),price:o.price?.grandTotal||o.price?.total||'',currency:o.price?.currency||'EUR'};
    });
    res.setHeader('Cache-Control','s-maxage=180, stale-while-revalidate=300');
    return res.status(200).json({configured:true,provider:'Amadeus',origin,destination,results});
  }catch(e){return res.status(500).json({error:e.message||'Flight search failed'})}
};
