const test=require('node:test');
const assert=require('node:assert/strict');
const {DEFAULT_SURVEY,parseHipsList,describeSurvey,createReleaseResolver}=require('../spherex-releases');
// DR2/DR3 records in these tests are hypothetical future catalogue entries.
const futureUrl='https://irsa.ipac.caltech.edu/data/hips/SPHEREx/test_dr2_cube';
function properties(release=1,extra={}){
  return {creator_did:`ivo://IPAC/P/SPHEREx/DR${release}/cube`,dataproduct_type:'cube',
    moc_sky_fraction:'1',hips_cube_depth:'3',data_cube_crval3_arr:'1.1 3.293 4.9',
    hips_tile_format:'png',em_min:'1e-6',em_max:'5e-6',hips_release_date:'2026-11-01',...extra};
}
const text=record=>Object.entries(record).map(([k,v])=>`${k} = ${v}`).join('\n');
const catalogue=(release=2,url=futureUrl)=>text({creator_did:`ivo://IPAC/P/SPHEREx/DR${release}/cube`,hips_service_url:url});

test('catalogue parser handles repeated records without blank lines and both identifier fields',()=>{
  const records=parseHipsList(`${catalogue()}\n${catalogue(3)}\nID = ivo://IPAC/P/SPHEREx/DR3/cube`);
  assert.equal(records.length,2);assert.equal(records[1].ID,'ivo://IPAC/P/SPHEREx/DR3/cube');
});

test('discovers a compatible future release from its advertised official URL and caches the check',async()=>{
  let now=0;const calls=[];
  const resolve=createReleaseResolver({now:()=>now,read:async url=>{
    calls.push(url);
    return url.endsWith('/list')?catalogue():text(properties(url.startsWith(futureUrl)?2:1));
  }});
  const result=await resolve();
  assert.equal(result.survey.release,'DR2');assert.equal(result.survey.url,futureUrl);
  assert.equal(result.survey.channelIndex,1);assert.equal(result.survey.wavelengthMicrons,3.293);
  assert.equal(calls.length,3);
  await resolve();assert.equal(calls.length,3);
  now=3600001;await resolve();assert.equal(calls.length,3);
  now=86400001;await resolve();assert.equal(calls.length,6);
});

test('recognizes a newer release published at the existing canonical URL',async()=>{
  const resolve=createReleaseResolver({read:async url=>url.endsWith('/list')?catalogue(1,DEFAULT_SURVEY):text(properties(2))});
  const result=await resolve();assert.equal(result.survey.release,'DR2');assert.equal(result.survey.url,DEFAULT_SURVEY);
});

test('incompatible advertised maps retain the verified current map and report the newer release',async()=>{
  const resolve=createReleaseResolver({read:async url=>url.endsWith('/list')?catalogue():
    text(properties(url.startsWith(futureUrl)?2:1,url.startsWith(futureUrl)?{data_cube_crval3_arr:'1 2 5'}:{}))});
  const result=await resolve();assert.equal(result.survey.release,'DR1');
  assert.equal(result.newerAdvertised,true);assert.ok(result.warnings.length);
  assert.throws(()=>describeSurvey(properties(2,{moc_sky_fraction:'.1'}),futureUrl),/incompatible/);
  assert.throws(()=>describeSurvey(properties(2),futureUrl+'?token=x'),/official/);
});

test('untrusted catalogue services are never fetched',async()=>{
  const calls=[];
  const resolve=createReleaseResolver({read:async url=>{
    calls.push(url);return url.endsWith('/list')?catalogue(2,'https://example.com/untrusted'):text(properties());
  }});
  const result=await resolve();assert.equal(result.survey.release,'DR1');
  assert.ok(calls.every(url=>new URL(url).origin==='https://irsa.ipac.caltech.edu'));
});

test('an outage or stale catalogue preserves the last verified newer map without relabelling it',async()=>{
  let failed=false,stale=false,now=0;
  const resolve=createReleaseResolver({now:()=>now,read:async url=>{
    if(failed)throw new Error('offline');
    return url.endsWith('/list')?(stale?catalogue(1,DEFAULT_SURVEY):catalogue()):text(properties(url.startsWith(futureUrl)?2:1));
  }});
  const original=await resolve();failed=true;now=100;
  const offline=await resolve({force:true});assert.equal(offline.survey.release,'DR2');
  assert.equal(offline.checkedAt,original.checkedAt);assert.equal(offline.stale,true);
  failed=false;stale=true;
  const oldCatalogue=await resolve({force:true});assert.equal(oldCatalogue.survey.release,'DR2');assert.equal(oldCatalogue.stale,true);
});
