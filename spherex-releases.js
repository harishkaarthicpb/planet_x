const {archiveRequest}=require('./archive-diagnostics');
const {createHash}=require('node:crypto');
const ORIGIN='https://irsa.ipac.caltech.edu';
const DEFAULT_SURVEY=`${ORIGIN}/data/hips/SPHEREx/spherex_allsky_cube`;
const HIPS_LIST=`${ORIGIN}/data/hips/list`;
const TARGET_MICRONS=3.293;

function parseProperties(text){
  return Object.fromEntries(text.split(/\r?\n/).filter(line=>line.trim() && !line.trim().startsWith('#') && line.includes('='))
    .map(line=>{const i=line.indexOf('=');return [line.slice(0,i).trim(),line.slice(i+1).trim()];}));
}

function parseHipsList(text){
  const records=[];let lines=[];
  const flush=()=>{if(lines.length)records.push(parseProperties(lines.join('\n')));lines=[];};
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()){flush();continue;}
    const identifier=line.match(/^\s*(creator_did|ID)\s*=/)?.[1];
    if(identifier && lines.some(value=>new RegExp(`^\\s*${identifier}\\s*=`).test(value)))flush();
    if(!line.trim().startsWith('#'))lines.push(line);
  }
  flush();return records;
}

function releaseNumber(record){
  return Number((record.creator_did || record.ID || '').match(/^ivo:\/\/IPAC\/P\/SPHEREx\/DR([1-9]\d*)\/cube$/i)?.[1]) || 0;
}

function officialSurveyUrl(value){
  const url=new URL(value);
  if(url.origin!==ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/data/hips/')){
    throw new Error('The survey is not an official IRSA HiPS service.');
  }
  return url.href.replace(/\/$/,'');
}

function describeSurvey(properties,url){
  url=officialSurveyUrl(url);
  const release=releaseNumber(properties),depth=Number(properties.hips_cube_depth);
  const wavelengths=(properties.data_cube_crval3_arr || '').trim().split(/\s+/).map(Number);
  const low=Number(properties.em_min),high=Number(properties.em_max);
  if(!release || properties.dataproduct_type!=='cube' || Number(properties.moc_sky_fraction)<.999 ||
    !Number.isFinite(Number(properties.moc_sky_fraction)) || !Number.isInteger(depth) || depth<2 || depth>4096 ||
    wavelengths.length!==depth || wavelengths.some(n=>!Number.isFinite(n) || n<=0) ||
    !properties.hips_tile_format?.split(/\s+/).includes('png') || !(low>0 && high>low)){
    throw new Error('The advertised SPHEREx map is incompatible with this viewer.');
  }
  let channelIndex=0;
  wavelengths.forEach((value,index)=>{if(Math.abs(value-TARGET_MICRONS)<Math.abs(wavelengths[channelIndex]-TARGET_MICRONS))channelIndex=index;});
  if(Math.abs(wavelengths[channelIndex]-TARGET_MICRONS)>.05)throw new Error('The map has no compatible 3.293 µm channel.');
  return {url,release:`DR${release}`,releaseNumber:release,channelIndex,wavelengthMicrons:wavelengths[channelIndex],properties,
    revision:[properties.creator_did,properties.hips_release_date,properties.hips_creation_date,
      createHash('sha256').update(JSON.stringify(properties)).digest('hex')].join('|')};
}

function createReleaseResolver({now=Date.now,read=async url=>archiveRequest(url,5000,'SPHEREx release discovery',r=>r.text(),
  {fetchOptions:{cache:'no-store',redirect:'error'}})}={}){
  let cached=null,expires=0,pending=null;
  async function discover(){
    const attemptedAt=new Date(now()).toISOString(),warnings=[],surveys=[];
    const [catalogue,canonical]=await Promise.allSettled([read(HIPS_LIST),read(`${DEFAULT_SURVEY}/properties`)]);
    if(canonical.status==='fulfilled'){
      try{surveys.push(describeSurvey(parseProperties(canonical.value),DEFAULT_SURVEY));}catch(error){warnings.push(error.message);}
    }else warnings.push('The default survey metadata could not be checked.');
    let advertised=[];
    if(catalogue.status==='fulfilled'){
      advertised=parseHipsList(catalogue.value).filter(record=>releaseNumber(record)>0)
        .sort((a,b)=>releaseNumber(b)-releaseNumber(a));
      const candidates=advertised.filter(record=>releaseNumber(record)>Math.max(0,...surveys.map(s=>s.releaseNumber))).slice(0,3);
      for(const candidate of candidates){
        try{
          const url=officialSurveyUrl(candidate.hips_service_url);
          const survey=describeSurvey(parseProperties(await read(`${url}/properties`)),url);
          if(survey.releaseNumber!==releaseNumber(candidate))throw new Error('The advertised release does not match its metadata.');
          surveys.push(survey);break;
        }catch(error){warnings.push(error.message);}
      }
    }else warnings.push('The official survey catalogue could not be checked.');
    const best=surveys.sort((a,b)=>b.releaseNumber-a.releaseNumber)[0];
    if(!best){
      if(!cached)throw new Error('No compatible SPHEREx whole-sky map could be verified.');
      expires=now()+60000;
      cached={...cached,stale:true,lastAttemptAt:attemptedAt,warnings};return cached;
    }
    // A temporarily stale catalogue/canonical service must not downgrade an
    // already verified newer map. Keep it and report that it was not reverified.
    if(cached?.survey.releaseNumber>best.releaseNumber){
      expires=now()+60000;cached={...cached,stale:true,lastAttemptAt:attemptedAt,warnings};return cached;
    }
    cached={survey:best,checkedAt:attemptedAt,lastAttemptAt:attemptedAt,stale:false,warnings,
      newerAdvertised:advertised.some(record=>releaseNumber(record)>best.releaseNumber)};
    expires=now()+86400000;return cached;
  }
  return async({force=false}={})=>{
    if(cached && now()<expires && !force)return cached;
    if(!pending)pending=discover().finally(()=>{pending=null;});
    return pending;
  };
}

const resolveRelease=createReleaseResolver();
async function handleReleaseRequest(request,response){
  const url=new URL(request.url,'http://localhost');
  if(url.pathname!=='/api/spherex/release')return false;
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if(request.method!=='GET'){response.writeHead(405,{Allow:'GET'});response.end();return true;}
  try{const result=await resolveRelease();response.writeHead(200);response.end(JSON.stringify(result));}
  catch(error){response.writeHead(503);response.end(JSON.stringify({error:error.message}));}
  return true;
}
module.exports={DEFAULT_SURVEY,parseProperties,parseHipsList,describeSurvey,createReleaseResolver,handleReleaseRequest};
