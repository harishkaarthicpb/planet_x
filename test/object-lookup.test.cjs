const test=require('node:test');
const assert=require('node:assert/strict');
const {lookup,parameters,handleObjectRequest,propagatePosition,buildQuery}=require('../object-lookup');
const payload=rows=>({metadata:['main_id','ra','dec','otype','object_type','separation','pmra','pmdec'].map(name=>({name})),data:rows.map(row=>[...row,...Array(Math.max(0,8-row.length)).fill(null)])});
const ok=rows=>({ok:true,json:async()=>payload(rows)});
const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});

test('numeric validation rejects missing, unsafe and excessively broad searches',()=>{
  for(const input of ['', 'ra=0&dec=0','ra=360&dec=0&radius=6','ra=0&dec=91&radius=6',
    'ra=0&dec=0&radius=31','ra=0;DROP&dec=0&radius=6','ra=0&dec=0&radius=','ra=NaN&dec=0&radius=6']){
    assert.throws(()=>parameters(new URLSearchParams(input)),/valid ICRS/);
  }
  assert.deepEqual(parameters(new URLSearchParams('ra=0&dec=-90&radius=30')),{ra:0,dec:-90,radius:30,epoch:2000});
  for(const epoch of ['NaN','','1800','2201'])assert.throws(()=>parameters(new URLSearchParams(`ra=0&dec=0&radius=6&epoch=${epoch}`)),/image epoch/);
});

test('trusted SIMBAD query returns nearest candidates, human object types and encoded catalog links',async()=>{
  const result=await lookup({ra:0,dec:0,radius:6},{fetchImpl:async(url,options)=>{
    assert.equal(url,'https://simbad.cfa.harvard.edu/simbad/sim-tap/sync');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    const query=options.body.get('query');assert.match(query,/TOP 201/);assert.match(query,/LEFT JOIN otypedef/);
    assert.match(query,/ORDER BY separation ASC/);assert.match(query,/CIRCLE\('ICRS',0,0,0\.001666/);
    return ok([['Far',.001,0,'*','Star',null],['A & B',0,0,'G','Galaxy',null],['Outside',.01,0,'*','Star',null],['Missing',null,0,'*','Star',null]]);
  }});
  assert.deepEqual(result.candidates.map(item=>item.name),['A & B','Far']);
  assert.equal(result.candidates[0].type,'Galaxy');assert.equal(result.candidates[0].separationArcsec,0);
  assert.equal(new URL(result.candidates[0].url).searchParams.get('Ident'),'A & B');
  assert.match(result.source,/Harvard/);assert.match(result.note,/lag/);
});

test('Barnard-like motion can move a star several arcminutes while the final match radius stays tight',async()=>{
  // Synthetic regression: westward 0.8 and northward 10.3 arcsec/year.
  // The expected 2026 position uses independent small-angle motion equations.
  const ra=269.45,dec=4.69,years=26,epoch=2026;
  const tapped={ra:ra-.8*years/(3600*Math.cos(dec*Math.PI/180)),dec:dec+10.3*years/3600,radius:6,epoch};
  const rows=[['Fast-moving star',ra,dec,'*','Star',null,-800,10300],
    ['Unrelated stationary star',ra,dec,'*','Star',null,0,0],
    ['Moving away',ra,dec,'*','Star',null,800,-10300]];
  let query;
  const result=await lookup(tapped,{fetchImpl:async(url,options)=>{query=options.body.get('query');return ok(rows);}});
  assert.equal(result.candidates.length,1);const star=result.candidates[0];
  assert.equal(star.name,'Fast-moving star');assert.equal(star.motionApplied,true);
  assert.equal(star.coordinateEpoch,2026);assert.equal(star.catalogRa,ra);assert.equal(star.catalogDec,dec);
  assert.ok(star.separationArcsec<.1);assert.equal(result.radius,6);
  assert.match(query,/b\.pmra/);assert.match(query,/b\.pmdec/);assert.match(query,/26\*SQRT/);
  assert.doesNotMatch(query,/t_min|TIME|year\s*>|COLLECTION/i);
  const originalEpoch=await lookup({...tapped,epoch:2000},{fetchImpl:async()=>ok(rows)});
  assert.equal(originalEpoch.candidates.length,0,'Without the motion correction the same tap misses');
});

test('stationary objects remain fixed and motion propagation stays finite across RA wrap and poles',()=>{
  assert.deepEqual(propagatePosition(10,41,0,0,2026),{ra:10,dec:41,motionApplied:false});
  assert.deepEqual(propagatePosition(10,41,null,null,2026),{ra:10,dec:41,motionApplied:false});
  const east=propagatePosition(359.999,0,1000,0,2026);
  assert.ok(east.ra>=0 && east.ra<.01);assert.ok(Math.abs(east.dec)<1e-10);
  const north=propagatePosition(0,89.999,0,1000,2026);
  assert.ok(Number.isFinite(north.ra+north.dec));assert.ok(north.dec<=90 && north.dec>89.9);
  const back=propagatePosition(123,56,1000,2000,1974);
  assert.ok(back.ra<123);assert.ok(back.dec<56);
  assert.doesNotMatch(buildQuery({ra:10,dec:41,radius:6,epoch:2000}),/SQRT/);
});

test('an unavailable mirror falls back only to the official CDS service and preserves empty results',async()=>{
  const calls=[];
  const result=await lookup({ra:10,dec:20,radius:6},{fetchImpl:async url=>{
    calls.push(url);if(calls.length===1)return {ok:false,status:503};return ok([]);
  }});
  assert.equal(calls.length,2);assert.equal(new URL(calls[1]).hostname,'simbad.cds.unistra.fr');
  assert.deepEqual(result.candidates,[]);assert.match(result.source,/Strasbourg/);
});

test('catalog failures remain errors rather than false no-match results; cancellation prevents fallback',async()=>{
  await assert.rejects(lookup({ra:10,dec:20,radius:6},{fetchImpl:async()=>({ok:true,json:async()=>({error:'Query error'})})}),/unavailable/);
  const controller=new AbortController();let calls=0;
  await assert.rejects(lookup({ra:10,dec:20,radius:6},{signal:controller.signal,fetchImpl:async()=>{
    calls++;controller.abort();throw new Error('Cancelled');
  }}));
  assert.equal(calls,1);
});

test('API validates before fetching, caches successful repeats and leaves existing routes alone',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return ok([]);};
  try{
    const bad=response();await handleObjectRequest({method:'GET',url:'/api/objects?ra=0'},bad);assert.equal(bad.status,400);assert.equal(calls,0);
    for(let i=0;i<2;i++){
      const result=response();await handleObjectRequest({method:'GET',url:'/api/objects?ra=123.456&dec=56&radius=6'},result);
      assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.body).candidates,[]);
    }
    assert.equal(calls,1);
    const post=response();await handleObjectRequest({method:'POST',url:'/api/objects'},post);assert.equal(post.status,405);
    assert.equal(await handleObjectRequest({method:'GET',url:'/api/spherex/observations'},response()),false);
  }finally{globalThis.fetch=original;}
});
