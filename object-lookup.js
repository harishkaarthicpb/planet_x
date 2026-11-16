// SIMBAD endpoints documented by CDS: https://simbad.cds.unistra.fr/
// Only fixed, official services are contacted; the client supplies numbers.
const SERVICES=[
  {root:'https://simbad.cfa.harvard.edu/simbad/',label:'SIMBAD · Harvard mirror'},
  {root:'https://simbad.cds.unistra.fr/simbad/',label:'SIMBAD · CDS Strasbourg'}
];
const cache=new Map();
const CANDIDATE_LIMIT=200;
function parameters(search){
  const read=name=>search.has(name) && search.get(name).trim()!==''?Number(search.get(name)):NaN;
  const ra=read('ra'),dec=read('dec'),radius=read('radius'),epoch=search.has('epoch')?read('epoch'):2000;
  if(!Number.isFinite(ra) || ra<0 || ra>=360 || !Number.isFinite(dec) || Math.abs(dec)>90 ||
    !Number.isFinite(radius) || radius<1 || radius>30)throw new Error('Use valid ICRS coordinates and a search radius between 1 and 30 arcseconds.');
  if(!Number.isFinite(epoch) || epoch<1900 || epoch>2200)throw new Error('Use an image epoch between 1900 and 2200.');
  return {ra,dec,radius,epoch};
}
function buildQuery({ra,dec,radius,epoch=2000}){
  const years=Math.abs(epoch-2000),distance=`DISTANCE(POINT('ICRS',b.ra,b.dec),POINT('ICRS',${ra},${dec}))`;
  const cone=size=>`CONTAINS(POINT('ICRS',b.ra,b.dec),CIRCLE('ICRS',${ra},${dec},${size/3600}))=1`;
  // Discover moving stars outside the small tap cone, then filter their
  // propagated positions locally. The 15 arcsec/year discovery margin covers
  // Barnard's Star (~10.3 arcsec/year); it is not a wider final match radius.
  const motion=years?`(${cone(radius+15*years)}) AND ((${cone(radius)}) OR
    (b.pmra IS NOT NULL AND b.pmdec IS NOT NULL AND
    ${years}*SQRT(POWER(b.pmra,2)+POWER(b.pmdec,2))/3600000 >= ${distance}-${radius/3600}))`:cone(radius);
  return `SELECT TOP ${CANDIDATE_LIMIT+1} b.main_id, b.ra, b.dec, b.otype, t.description AS object_type, b.pmra, b.pmdec,
    ${distance} AS separation
    FROM basic AS b LEFT JOIN otypedef AS t ON b.otype=t.otype
    WHERE ${motion}
    ORDER BY separation ASC`;
}

function propagatePosition(ra,dec,pmra,pmdec,epoch){
  // SIMBAD pmra includes cos(dec), in milliarcseconds/year. A Cartesian
  // tangent vector avoids the RA singularity at a pole. This is a linear
  // proper-motion estimate, without parallax or perspective acceleration.
  if(epoch===2000 || pmra==null || pmdec==null || !Number.isFinite(Number(pmra)) || !Number.isFinite(Number(pmdec)) ||
    (Number(pmra)===0 && Number(pmdec)===0))return {ra,dec,motionApplied:false};
  const rad=Math.PI/180,a=ra*rad,d=dec*rad,scale=(epoch-2000)*rad/3600000;
  const east=Number(pmra)*scale,north=Number(pmdec)*scale;
  const x=Math.cos(d)*Math.cos(a)-east*Math.sin(a)-north*Math.sin(d)*Math.cos(a);
  const y=Math.cos(d)*Math.sin(a)+east*Math.cos(a)-north*Math.sin(d)*Math.sin(a);
  const z=Math.sin(d)+north*Math.cos(d);
  return {ra:((Math.atan2(y,x)/rad)%360+360)%360,dec:Math.atan2(z,Math.hypot(x,y))/rad,
    motionApplied:Number(pmra)!==0 || Number(pmdec)!==0};
}
async function lookup(position,{fetchImpl=fetch,signal}={}){
  position={epoch:2000,...position};
  const {angularSeparationDegrees}=await import('./sky-region.mjs');
  for(const service of SERVICES){
    signal?.throwIfAborted();
    try{
      const query=new URLSearchParams({request:'doQuery',lang:'adql',format:'json',query:buildQuery(position)});
      const response=await fetchImpl(`${service.root}sim-tap/sync`,{method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:query,
        signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok)throw new Error(`Catalog HTTP ${response.status}`);
      const payload=await response.json();
      if(!Array.isArray(payload.metadata) || !Array.isArray(payload.data))throw new Error('Invalid catalog response.');
      const fields=payload.metadata.map(field=>String(field.name).toLowerCase());
      if(!['main_id','ra','dec','otype','object_type','pmra','pmdec'].every(name=>fields.includes(name)))throw new Error('Missing catalog fields.');
      const candidates=payload.data.flatMap(values=>{
        if(!Array.isArray(values))return [];
        const row=Object.fromEntries(fields.map((key,i)=>[key,values[i]]));
        if(typeof row.main_id!=='string' || !row.main_id.trim() || row.ra==null || row.dec==null)return [];
        const ra=Number(row.ra),dec=Number(row.dec);
        if(!Number.isFinite(ra) || ra<0 || ra>=360 || !Number.isFinite(dec) || Math.abs(dec)>90)return [];
        const predicted=propagatePosition(ra,dec,row.pmra,row.pmdec,position.epoch);
        const separationArcsec=3600*angularSeparationDegrees([position.ra,position.dec],[predicted.ra,predicted.dec]);
        if(separationArcsec>position.radius+1e-6)return [];
        const url=new URL('sim-id',service.root);url.searchParams.set('Ident',row.main_id);
        return [{name:row.main_id,...predicted,catalogRa:ra,catalogDec:dec,coordinateEpoch:predicted.motionApplied?position.epoch:2000,
          type:row.object_type || row.otype || 'Unknown type',
          typeCode:row.otype,separationArcsec,url:url.href}];
      }).sort((a,b)=>a.separationArcsec-b.separationArcsec);
      return {...position,candidates:candidates.slice(0,6),limited:payload.data.length>=CANDIDATE_LIMIT+1 || candidates.length>6,source:service.label,
        note:service===SERVICES[0]?'Mirror catalog may lag the main SIMBAD database.':null};
    }catch(error){if(signal?.aborted)throw error;}
  }
  throw new Error('The object catalog is unavailable. Please try another tap shortly.');
}
async function handleObjectRequest(request,response){
  const url=new URL(request.url,'http://localhost');
  if(url.pathname!=='/api/objects')return false;
  const send=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(body));};
  if(request.method!=='GET'){response.writeHead(405,{Allow:'GET'});response.end();return true;}
  let position;
  try{position=parameters(url.searchParams);}catch(error){send(400,{error:error.message});return true;}
  const key=JSON.stringify(position),entry=cache.get(key);
  if(entry && Date.now()-entry.time<300000){send(200,entry.result);return true;}
  const controller=new AbortController();
  const cancel=()=>controller.abort();response.on?.('close',cancel);
  try{
    const result=await lookup(position,{signal:controller.signal});
    cache.set(key,{time:Date.now(),result});
    while(cache.size>128)cache.delete(cache.keys().next().value);
    if(!controller.signal.aborted)send(200,result);
  }catch(error){if(!controller.signal.aborted)send(502,{error:error.message});}
  finally{response.off?.('close',cancel);}
  return true;
}
module.exports={handleObjectRequest,lookup,parameters,buildQuery,propagatePosition};
