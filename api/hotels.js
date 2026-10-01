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
  const q=new URLSearchParams({subType:'CITY',keyword:name,'page[limit]':'5',view:'LIGHT'});
  const r=await fetch(BASE+'/v1/reference-data/locations?'+q,{headers:{authorization:'Bearer '+t}});
  if(!r.ok)throw new Error('City lookup failed');
  const data=(await r.json()).data||[],city=data.find(x=>x.subType==='CITY'&&x.iataCode)||data.find(x=>x.iataCode);
  if(!city)throw new Error('Не намерих градски код за '+name);
  return city.iataCode;
}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    const t=await token();
    if(!t)return res.status(200).json({configured:false,provider:'Amadeus'});
    const b=req.body||{},adults=Math.max(1,Math.min(9,Number(b.adults)||1)),code=await cityCode(b.to||'',t);
    const listQ=new URLSearchParams({cityCode:code,radius:'20',radiusUnit:'KM',hotelSource:'ALL'});
    const lr=await fetch(BASE+'/v1/reference-data/locations/hotels/by-city?'+listQ,{headers:{authorization:'Bearer '+t}});
    const ld=await lr.json(); if(!lr.ok)throw new Error(ld.errors?.[0]?.detail||'Hotel list failed');
    const ids=(ld.data||[]).slice(0,15).map(x=>x.hotelId).filter(Boolean);
    if(!ids.length)return res.status(200).json({configured:true,provider:'Amadeus',results:[]});
    const q=new URLSearchParams({hotelIds:ids.join(','),adults:String(adults),checkInDate:b.departureDate,checkOutDate:b.returnDate,roomQuantity:'1',currency:'EUR',bestRateOnly:'true'});
    const r=await fetch(BASE+'/v3/shopping/hotel-offers?'+q,{headers:{authorization:'Bearer '+t}});
    const d=await r.json(); if(!r.ok)throw new Error(d.errors?.[0]?.detail||'Hotel search failed');
    const results=(d.data||[]).slice(0,10).map(x=>{const o=x.offers?.[0]||{};return{id:x.hotel?.hotelId||'',name:x.hotel?.name||'Хотел',address:x.hotel?.cityCode||code,room:o.room?.description?.text||o.room?.typeEstimated?.category||'',price:o.price?.total||'',currency:o.price?.currency||'EUR'};});
    res.setHeader('Cache-Control','s-maxage=180, stale-while-revalidate=300');
    return res.status(200).json({configured:true,provider:'Amadeus',cityCode:code,results});
  }catch(e){return res.status(500).json({error:e.message||'Hotel search failed'})}
};
