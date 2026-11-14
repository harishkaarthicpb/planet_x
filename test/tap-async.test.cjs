const test=require('node:test');
const assert=require('node:assert/strict');
const {runAsyncTap,validJobUrl,parseTapCsv}=require('../tap-async');
const BASE='https://irsa.ipac.caltech.edu/TAP/async';
const csv='uri,time_bounds_lower\r\nibe/data/spherex/qr3/level2/a/new.fits,61300.8\r\nibe/data/spherex/qr3/level2/a/old.fits,61299.2\r\n';
const created=()=>new Response(null,{status:303,headers:{location:'/TAP/async/job-1'}});
const silent=()=>{};

test('create, start PENDING job once, poll, and parse CSV results',async()=>{
 const original=globalThis.fetch,calls=[],logs=[];
 let phase=0;
 globalThis.fetch=async(url,options)=>{
   calls.push({url:String(url),options});
   if(url===BASE)return created();
   if(String(url).endsWith('/phase') && options.method==='POST')return new Response(null,{status:303});
   if(String(url).endsWith('/phase'))return new Response(['PENDING','PENDING','EXECUTING','COMPLETED'][phase++]);
   if(String(url).endsWith('/results/result'))return new Response(csv,{headers:{'content-type':'text/csv'}});
   throw new Error('Unexpected URL');
 };
 try{
   const result=await runAsyncTap('SELECT test',{pollIntervalMs:0,log:e=>logs.push(e),requestId:'test'});
   assert.equal(result.data.length,2);assert.equal(result.metadata[0].name,'uri');
   assert.equal(calls.filter(c=>c.url===BASE).length,1);
   assert.equal(calls.filter(c=>c.options.method==='POST'&&c.url.endsWith('/phase')).length,1);
   assert.equal(calls[0].options.body.get('FORMAT'),'CSV');
   assert.ok(calls.every(c=>c.options.redirect==='manual'));
   assert.ok(logs.some(e=>e.event==='created'));
   assert.ok(logs.some(e=>e.stage==='IRSA asynchronous TAP search'&&e.recordCount===2));
 }finally{globalThis.fetch=original;}
});

test('HTTP 502 at submission stops without polling or retrying',async()=>{
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;return new Response('Bad Gateway',{status:502});};
 try{
   await assert.rejects(runAsyncTap('SELECT test',{pollIntervalMs:0,log:silent}),/IRSA TAP job creation failed: HTTP 502/);
   assert.equal(count,1);
 }finally{globalThis.fetch=original;}
});

test('ERROR execution phase retrieves error report and preserves failure stage',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url)=>{
   calls.push(String(url));
   if(url===BASE)return created();
   if(String(url).endsWith('/phase'))return new Response('ERROR');
   if(String(url).endsWith('/error'))return new Response('<uws:errorSummary>Invalid table</uws:errorSummary>');
   throw new Error('Must not fetch a result');
 };
 try{
   await assert.rejects(runAsyncTap('SELECT test',{pollIntervalMs:0,log:silent}),/execution ended with phase ERROR.*Invalid table/);
   assert.ok(calls.at(-1).endsWith('/error'));assert.equal(calls.length,3);
 }finally{globalThis.fetch=original;}
});

test('phase and result HTTP errors identify their exact failed endpoint',async()=>{
 const original=globalThis.fetch;
 try{
   for(const failAt of ['phase','results/result']){
     globalThis.fetch=async(url)=>{
       if(url===BASE)return created();
       if(String(url).endsWith('/'+failAt))return new Response('Bad gateway',{status:502});
       return new Response('COMPLETED');
     };
     await assert.rejects(runAsyncTap('SELECT test',{pollIntervalMs:0,log:silent}),failAt==='phase'?/phase polling failed: HTTP 502/:/result retrieval failed: HTTP 502/);
   }
 }finally{globalThis.fetch=original;}
});

test('unsafe or missing job locations never trigger follow-up requests',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
   for(const location of ['https://example.com/TAP/async/1','/TAP/async/job?token=secret',null]){
     calls=0;
     globalThis.fetch=async()=>{calls++;return new Response(null,{status:303,headers:location?{location}:{}});};
     await assert.rejects(runAsyncTap('SELECT test',{log:silent}),location?/unexpected TAP job URL/:/without a Location header/);
     assert.equal(calls,1);
   }
   assert.equal(validJobUrl('/TAP/async/123/'),BASE+'/123');
 }finally{globalThis.fetch=original;}
});

test('CSV parser handles quoted commas, escaped quotes and newline fields; rejects incomplete results',()=>{
 const result=parseTapCsv('\uFEFFuri,time_bounds_lower,note\r\n"https://example.com?center=60,50",61300.2,"a ""quote""\nline"\r\n');
 assert.equal(result.data[0][0],'https://example.com?center=60,50');
 assert.equal(result.data[0][2],'a "quote"\nline');
 assert.throws(()=>parseTapCsv('uri,time_bounds_lower\n"unfinished'),/incomplete/);
 assert.throws(()=>parseTapCsv('<error>failed</error>'),/missing uri/);
 assert.throws(()=>parseTapCsv('uri,time_bounds_lower\nonly-one-column\n'),/column counts/);
});

test('queued job respects a bounded wait budget and retains its job URL',async()=>{
 const original=globalThis.fetch;let submissions=0;
 globalThis.fetch=async(url)=>{if(url===BASE){submissions++;return created();}return new Response('QUEUED');};
 try{
   await assert.rejects(runAsyncTap('SELECT test',{maxWaitMs:100,pollIntervalMs:10,log:silent}),/exceeded .*last phase: QUEUED.*Job: https:\/\/irsa/);
   assert.equal(submissions,1);
 }finally{globalThis.fetch=original;}
});


test('temporary status 502 resumes the same queued job and reaches its result',async()=>{
 const original=globalThis.fetch,logs=[];let creates=0,reads=0,starts=0;
 globalThis.fetch=async(url,options)=>{
   if(url===BASE){creates++;return created();}
   if(String(url).endsWith('/phase')){
     if(options.method==='POST'){starts++;throw new Error('Do not restart a queued job');}
     const phase=['QUEUED','QUEUED',502,'EXECUTING','COMPLETED'][reads++];
     return phase===502?new Response('Gateway error',{status:502}):new Response(phase);
   }
   if(String(url).endsWith('/results/result'))return new Response(csv);
   throw new Error('Unexpected URL');
 };
 try{
   const result=await runAsyncTap('SELECT test',{pollIntervalMs:0,log:e=>logs.push(e)});
   assert.equal(result.data.length,2);assert.equal(creates,1);assert.equal(starts,0);assert.equal(reads,5);
   assert.equal(logs.filter(e=>e.event==='retry').length,1);
   assert.equal(logs.find(e=>e.event==='retry').jobUrl,BASE+'/job-1');
 }finally{globalThis.fetch=original;}
});

test('persistent status 502 stops after two extra reads without resubmission',async()=>{
 const original=globalThis.fetch;let creates=0,reads=0;
 globalThis.fetch=async(url)=>{
   if(url===BASE){creates++;return created();}
   assert.equal(url,BASE+'/job-1/phase');reads++;return new Response('Gateway error',{status:502});
 };
 try{
   await assert.rejects(runAsyncTap('SELECT test',{pollIntervalMs:0,log:silent}),error=>{
     assert.match(error.message,/phase polling failed: HTTP 502.*Existing job:/);
     assert.equal(error.jobUrl,BASE+'/job-1');assert.equal(error.httpStatus,502);return true;
   });
   assert.equal(creates,1);assert.equal(reads,3);
 }finally{globalThis.fetch=original;}
});
