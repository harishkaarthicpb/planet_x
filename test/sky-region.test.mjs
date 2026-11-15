import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { regionFromCorners, regionFromRectangle, footprintContainsRegion } from '../sky-region.mjs';
const require = createRequire(import.meta.url);
const { selectRegionPair, selectTapPair, buildTapQuery, handleObservationRequest, utcDateFromMjd } = require('../spherex-observations.js');
const {extractImage,inspectFits}=require('../fits-image');
const {safeUrl,archiveRequest}=require('../archive-diagnostics');

const rectangle = [[59.9, 49.9], [60.1, 49.9], [60.1, 50.1], [59.9, 50.1]];
const footprint = 'POLYGON ICRS 59 49 61 49 61 51 59 51 59 49';
const fields = ['obs_id','obs_collection','t_min','t_max','energy_bandpassname','dataproduct_type','em_min','em_max','access_url','s_region'];
function row(id, mjd, area = footprint) {
  return [id, 'spherex_qr3', String(mjd), String(mjd + 0.001), 'SPHEREx-D4', 'image', '2.42e-6', '3.82e-6', `https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/test/${id}.fits`, area];
}
function payload(rows) {
  return { VOTABLE: { RESOURCE_ARRAY: [{
    INFO_ARRAY: [{ '<xmlattr>': { name: 'QUERY_STATUS', value: 'OK' } }],
    TABLE: { FIELD_ARRAY: fields.map(name => ({ '<xmlattr>': { name } })), DATA: { TABLEDATA: rows } }
  }] } };
}
function response() {
  return { status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

function makeFits() {
  const card=(key,value)=>`${key.padEnd(8)}= ${String(value).padStart(20)}`.padEnd(80);
  const header=values=>{
    const text=Object.entries(values).map(([k,v])=>card(k,v)).join('')+'END'.padEnd(80);
    const b=Buffer.alloc(Math.ceil(text.length/2880)*2880,32);b.write(text);return b;
  };
  const primary=header({SIMPLE:'T',BITPIX:8,NAXIS:0,EXTEND:'T'});
  const extension=name=>header({XTENSION:"'IMAGE   '",BITPIX:-32,NAXIS:2,NAXIS1:2,NAXIS2:2,PCOUNT:0,GCOUNT:1,EXTNAME:`'${name}'`,CTYPE1:"'RA---TAN-SIP'",CTYPE2:"'DEC--TAN-SIP'",CRPIX1:1,CRPIX2:1,CRVAL1:60,CRVAL2:50,CDELT1:-.001,CDELT2:.001,A_ORDER:2,A_2_0:.001,BUNIT:"'MJy / sr'",CHECKSUM:"'obsolete'"});
  const science=Buffer.alloc(2880);[1,2,NaN,4].forEach((n,i)=>science.writeFloatBE(n,i*4));
  const flags=Buffer.alloc(2880);[8,8,8,8].forEach((n,i)=>flags.writeFloatBE(n,i*4));
  return Buffer.concat([primary,extension('FLAGS'),flags,extension('IMAGE'),science]);
}

test('rectangle conversion uses all four corners and handles RA wraparound', () => {
  const region = regionFromRectangle({ x: 0, y: 0, w: 10, h: 10 }, (x,y) => [(359.9+x*.02)%360, -.1+y*.02]);
  assert.ok(Math.min(region.position.ra, 360-region.position.ra) < 1e-8);
  assert.ok(Math.abs(region.position.dec) < 1e-8);
  assert.ok(region.sizeDegrees > .28 && region.sizeDegrees < .30);
  assert.equal(region.corners.length, 4);
});

test('invalid, oversized, degenerate and off-projection rectangles are rejected', () => {
  assert.throws(() => regionFromRectangle({x:0,y:0,w:1,h:10}, () => [0,0]), /5 pixels/);
  assert.throws(() => regionFromCorners([[0,0],[10,0],[10,10],[0,10]]), /smaller/);
  assert.throws(() => regionFromCorners([[0,0],[0,0],[0,0],[0,0]]), /non-zero/);
  assert.throws(() => regionFromRectangle({x:0,y:0,w:10,h:10}, () => null), /valid ICRS/);
  assert.throws(() => regionFromCorners([[0,0],[NaN,0],[0,.1],[.1,.1]]), /valid ICRS/);
});

test('infrared allows wide rectangles across RA wrap while time keeps its one-degree limit',()=>{
  const corners=[[330,-30],[30,-30],[30,30],[330,30]];
  const region=regionFromCorners(corners,{maxSizeDegrees:170});
  assert.ok(region.sizeDegrees>80 && region.sizeDegrees<90);
  assert.ok(Math.min(region.position.ra,360-region.position.ra)<1e-8);
  assert.throws(()=>regionFromCorners(corners),/within 1°/);
  assert.throws(()=>regionFromCorners(corners,{maxSizeDegrees:180}),/170°/);
});

test('spherical footprint containment handles either winding, RA wrap and poles', () => {
  assert.equal(footprintContainsRegion(footprint, rectangle), true);
  assert.equal(footprintContainsRegion('POLYGON ICRS 59 49 59 51 61 51 61 49', rectangle), true);
  assert.equal(footprintContainsRegion(footprint, [[59.9,49.9],[61.2,49.9],[61.2,50.1],[59.9,50.1]]), false);
  const wrap = regionFromCorners([[359.9,-.1],[.1,-.1],[.1,.1],[359.9,.1]]);
  assert.equal(footprintContainsRegion('POLYGON ICRS 359 -1 1 -1 1 1 359 1', wrap.corners), true);
  const pole = regionFromCorners([[0,89.9],[90,89.9],[180,89.9],[270,89.9]]);
  assert.ok(pole.position.dec > 89.99);
  assert.equal(footprintContainsRegion('POLYGON ICRS 0 89 90 89 180 89 270 89', pole.corners), true);
  assert.equal(footprintContainsRegion(null, rectangle), false);
});

test('selects two UTC dates including partial overlaps, independently of the mosaic', () => {
  const data = payload([
    row('partial',61300,'POLYGON ICRS 60 49 61 49 61 51 60 51'),
    row('same-day',61300.2), row('older',61280), row('oldest',61270)
  ]);
  const pair = selectRegionPair(data);
  assert.equal(pair[0].obs_id, 'older');
  assert.equal(pair[1].obs_id, 'same-day');
  // Image footprints need not contain the rectangle: SIA already checked intersection.
  assert.equal(selectRegionPair(payload([row('partial',61300,'POLYGON ICRS 60 49 61 49 61 51 60 51'),row('older',61280)]))[1].obs_id, 'partial');
  assert.throws(() => selectRegionPair(payload([row('only',61290),row('same-day',61290.1)])), /two different/);
  data.VOTABLE.RESOURCE_ARRAY[0].INFO_ARRAY[0]['<xmlattr>'].value = 'OVERFLOW';
  assert.equal(selectRegionPair(data).length,2,'A limited result is enough to demonstrate two dates');
  data.VOTABLE.RESOURCE_ARRAY[0].INFO_ARRAY[0]['<xmlattr>'].value = 'ERROR';
  assert.throws(() => selectRegionPair(data), /could not complete/);
});

test('rectangle route returns two dates and serves the unchanged IMAGE pixels', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fits = makeFits();
  globalThis.fetch = async url => {
    const parsed = new URL(url); calls.push(parsed);
    if (parsed.pathname === '/SIA') return { ok:true, status:200, json:async () => payload([row('newer',61290),row('older',61280)]) };
    assert.equal(parsed.origin, 'https://irsa.ipac.caltech.edu');
    assert.equal(parsed.searchParams.get('gzip'), 'false');
    assert.ok(Number(parsed.searchParams.get('size')) >= regionFromCorners(rectangle).sizeDegrees);
    return { ok:true, status:200, arrayBuffer:async () => fits };
  };
  try {
    const query = new URLSearchParams({ corners: JSON.stringify(rectangle) });
    const res = response();
    await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${query}`},res);
    assert.equal(res.status,200);
    const result = JSON.parse(res.body);
    assert.deepEqual(result.observations.map(e=>e.id),['older','newer']);
    assert.equal(result.coverage,'partial-allowed');
    assert.match(calls[0].searchParams.get('POS'), /^POLYGON /);
    assert.equal(calls[0].searchParams.get('MAXREC'),'200');
    assert.equal(calls[0].searchParams.has('TIME'),false);
    for (const exposure of result.observations) {
      const image = response();
      await handleObservationRequest({method:'GET',url:exposure.cutoutUrl},image);
      assert.equal(image.status,200);
      assert.deepEqual(image.body,extractImage(fits).imageBytes);
      assert.equal(image.headers['X-PlanetX-Image-HDU'],'IMAGE');
    }
    const invalid = response();
    await handleObservationRequest({method:'GET',url:'/api/spherex/observations?corners=bad'},invalid);
    assert.equal(invalid.status,400);
    assert.equal(calls.length,3,'One search and exactly two downloads');
  } finally { globalThis.fetch = originalFetch; }
});

test('archive timeouts identify the step that failed', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('operation aborted','TimeoutError'); };
  try {
    const query = new URLSearchParams({ corners:JSON.stringify(rectangle) });
    const res = response();
    await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${query}`},res);
    assert.equal(res.status,502);
    assert.match(JSON.parse(res.body).error,/IRSA observation search timed out after 90 seconds/);
  } finally { globalThis.fetch = originalFetch; }
});

test('TAP point query uses the documented join; selects newest two UTC dates explicitly', () => {
  const region=regionFromCorners(rectangle);
  const query=buildTapQuery(region);
  assert.match(query,/FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid/);
  assert.match(query,/CONTAINS\(POINT\('ICRS'/);
  assert.match(query,/ORDER BY p.time_bounds_lower DESC/);
  const data={metadata:[{name:'uri'},{name:'time_bounds_lower'}],data:[
    ['ibe/data/spherex/qr3/level2/a/new.fits',61300.8],
    ['ibe/data/spherex/qr3/level2/a/same-day.fits',61300.1],
    ['ibe/data/spherex/qr3/level2/a/previous.fits',61299.5],
    ['ibe/data/spherex/qr3/level2/a/oldest.fits',61200]
  ]};
  assert.deepEqual(selectTapPair(data).map(e=>e.obs_id),['previous','new']);
});

test('only IMAGE is repackaged; pixel bytes, units and spatial WCS are preserved', () => {
  const original=makeFits();const {imageBytes,summary}=extractImage(original);
  assert.equal(summary.image.index,2,'Must not select FLAGS, even if it is first');
  assert.equal(summary.image.finitePixels,3);assert.equal(summary.image.min,1);assert.equal(summary.image.max,4);
  const originalHdu=inspectFits(original).find(h=>h.name==='IMAGE');
  const [display]=inspectFits(imageBytes);
  assert.equal(display.type,'PRIMARY');assert.equal(display.header.SIMPLE,true);
  for(const key of ['CTYPE1','CTYPE2','CRPIX1','CRPIX2','CRVAL1','CRVAL2','CDELT1','CDELT2','A_ORDER','A_2_0','BUNIT'])assert.equal(display.header[key],originalHdu.header[key]);
  assert.equal(display.header.CHECKSUM,undefined,'Changed header must not retain an obsolete checksum');
  assert.deepEqual(imageBytes.subarray(display.dataStart,display.dataStart+display.dataBytes),original.subarray(originalHdu.dataStart,originalHdu.dataStart+originalHdu.dataBytes));
  assert.throws(()=>extractImage(original.subarray(0,100)),/Truncated/);
});

test('diagnostics redact credentials and preserve HTTP/elapsed/error evidence', async () => {
  assert.equal(safeUrl('https://user:password@example.com/data?ra=60&token=secret').includes('secret'),false);
  const originalFetch=globalThis.fetch,logs=[];
  globalThis.fetch=async()=>({ok:false,status:503,headers:new Headers({'content-type':'text/plain'})});
  try {
    await assert.rejects(archiveRequest('https://example.com?api_key=private',90000,'search',r=>r.json(),{requestId:'test',log:e=>logs.push(e)}),/HTTP 503/);
    assert.equal(logs.at(-1).status,503);assert.equal(typeof logs.at(-1).elapsedMs,'number');
    assert.equal(JSON.stringify(logs).includes('private'),false);
  }finally{globalThis.fetch=originalFetch;}
});

test('controlled point route creates an async job and keeps the 0.05-degree coverage label', async()=>{
 const originalFetch=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{
   calls.push({url:String(url),options});
   if(String(url).endsWith('/TAP/async'))return new Response(null,{status:303,headers:{location:'/TAP/async/test-123'}});
   if(String(url).endsWith('/phase'))return new Response('COMPLETED');
   if(String(url).endsWith('/results/result'))return new Response('uri,time_bounds_lower\nibe/data/spherex/qr3/level2/a/new.fits,61300.8\nibe/data/spherex/qr3/level2/a/older.fits,61299.2\n');
   throw new Error('Unexpected URL '+url);
 };
 try {
   const responseBody=response();const query=new URLSearchParams({corners:JSON.stringify(rectangle),mode:'point'});
   await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${query}`},responseBody);
   assert.equal(responseBody.status,200);const data=JSON.parse(responseBody.body);
   assert.equal(data.mode,'point');assert.equal(data.cutoutSizeDegrees,.05);assert.equal(data.coverage,'center-test');
   assert.ok(data.observations.every(o=>o.coverage==='center-test'));
   assert.equal(calls[0].url,'https://irsa.ipac.caltech.edu/TAP/async');assert.equal(calls[0].options.method,'POST');
   assert.equal(calls[0].options.body.get('FORMAT'),'CSV');assert.equal(calls[0].options.redirect,'manual');
   assert.equal(calls.length,3,'Creation, completed phase, and result; no needless RUN or duplicate submission');
 }finally{globalThis.fetch=originalFetch;}
});

test('HTTP 502 diagnostics capture gateway details without logging cookies or credentials',async()=>{
 const originalFetch=globalThis.fetch,logs=[];
 globalThis.fetch=async()=>new Response('<html><title>Proxy Error</title><body>Upstream connection refused. token=secret-value</body></html>',{status:502,headers:{server:'Apache','content-type':'text/html','set-cookie':'private-cookie'}});
 try {
   await assert.rejects(archiveRequest('https://example.com/search',90000,'search',r=>r.json(),{log:e=>logs.push(e)}),/HTTP 502/);
   const failure=logs.find(e=>e.event==='http-error');
   assert.match(failure.bodyPreview,/Upstream connection refused/);
   assert.equal(failure.responseHeaders.server,'Apache');
   assert.equal(JSON.stringify(logs).includes('secret-value'),false);
   assert.equal(JSON.stringify(logs).includes('private-cookie'),false);
 }finally{globalThis.fetch=originalFetch;}
});

test('MJD UTC grouping has no noon shift and changes at calendar midnight',()=>{
 assert.equal(utcDateFromMjd(51544),'2000-01-01');
 assert.equal(utcDateFromMjd(51544.49999),'2000-01-01');
 assert.equal(utcDateFromMjd(51544.5),'2000-01-01');
 assert.equal(utcDateFromMjd(51544.99999),'2000-01-01');
 assert.equal(utcDateFromMjd(51545),'2000-01-02');
 for(const value of [null,'',undefined,NaN,Infinity,'invalid'])assert.throws(()=>utcDateFromMjd(value),/Invalid observation timestamp/);
});

test('cached genuine SPHEREx fixtures have distinct UTC dates and intact science pixels',async()=>{
 const fs=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const {imageStatistics}=require('../fits-image');
 const root=new URL('./fixtures/spherex/',import.meta.url);
 const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.observations.length,2);
 assert.notEqual(manifest.observations[0].observedStart.slice(0,10),manifest.observations[1].observedStart.slice(0,10));
 for(const item of manifest.observations){
   const bytes=await fs.readFile(new URL(item.filename,root));const [hdu]=inspectFits(bytes);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),item.imageFileSha256);
   assert.equal(hdu.header['DATE-OBS']+'Z',item.observedStart);assert.equal(hdu.header.OBSID,item.id);
   assert.equal(imageStatistics(bytes,hdu).pixelSha256,item.pixelSha256);
   assert.ok(imageStatistics(bytes,hdu).finitePixels>0);assert.equal(hdu.header.TIMESYS,'UTC');
 }
});

test('single-image rectangle action accepts any band and prefers the newest usable returned date',async()=>{
 const original=globalThis.fetch,calls=[];
 const first=row('newest-usable',61300);first[4]='SPHEREx-D2';first[6]='1.10e-6';first[7]='1.62e-6';
 globalThis.fetch=async(url)=>{
   const parsed=new URL(url);calls.push(parsed);
   assert.equal(parsed.searchParams.has('INSTRUMENT'),false);
   assert.deepEqual(parsed.searchParams.getAll('COLLECTION'),['spherex_qr3','spherex_qr3_deep']);
   assert.equal(parsed.searchParams.get('MAXREC'),'1000');
   assert.match(parsed.searchParams.get('POS'),/^CIRCLE /);
   assert.equal(parsed.searchParams.has('BAND'),false);
   assert.equal(parsed.searchParams.has('TIME'),false);
   return {ok:true,status:200,json:async()=>payload([row('older-first-row',61200),
     row('newest-but-off-center',61400,'POLYGON ICRS 20 20 21 20 21 21 20 21'),first])};
 };
 try{
   const result=response();const params=new URLSearchParams({corners:JSON.stringify(rectangle),mode:'single'});
   await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${params}`},result);
   assert.equal(result.status,200);const data=JSON.parse(result.body);
   assert.equal(data.observations.length,1);assert.equal(data.observations[0].id,'newest-usable');
   assert.equal(data.observations[0].band,'SPHEREx-D2');assert.equal(data.selectionRule,'newest-usable-image-returned');
   assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;}
});

test('single search explicitly scopes the documented QR3 wide and deep collections',async()=>{
 const original=globalThis.fetch,calls=[];
 const dr1=row('deep-image',61200);dr1[1]='spherex_qr3_deep';
 globalThis.fetch=async(url)=>{
   calls.push(new URL(url).searchParams.getAll('COLLECTION'));
   assert.equal(new URL(url).searchParams.has('INSTRUMENT'),false);
   return {ok:true,status:200,json:async()=>payload([dr1])};
 };
 try{
   const {searchObservations}=require('../spherex-observations');
   const result=await searchObservations(regionFromCorners(rectangle),{mode:'single',log:()=>{}});
   assert.equal(result.selected.length,1);assert.equal(result.selected[0].obs_id,'deep-image');
   assert.deepEqual(calls,[['spherex_qr3','spherex_qr3_deep']]);
 }finally{globalThis.fetch=original;}
});

test('single search falls back to DR1 wide/deep only after a valid QR3 response with no usable image',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{
   const collections=new URL(url).searchParams.getAll('COLLECTION');calls.push(collections);
   const image=row('dr1-fallback',61200);image[1]='spherex_dr1';image[8]=image[8].replace('/qr3/','/dr1/');
   return {ok:true,status:200,json:async()=>payload(calls.length===1?[]:[image])};
 };
 try{
   const {searchObservations}=require('../spherex-observations');
   const result=await searchObservations(regionFromCorners(rectangle),{mode:'single',log:()=>{}});
   assert.equal(result.selected[0].obs_id,'dr1-fallback');
   assert.deepEqual(calls,[['spherex_qr3','spherex_qr3_deep'],['spherex_dr1','spherex_dr1_deep']]);
 }finally{globalThis.fetch=original;}
});

test('single search does not retry or change collections after a gateway error',async()=>{
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;return new Response('Bad Gateway',{status:502});};
 try{
   const {searchObservations}=require('../spherex-observations');
   await assert.rejects(searchObservations(regionFromCorners(rectangle),{mode:'single',log:()=>{}}),/single-image search failed: HTTP 502/);
   assert.equal(count,1);
 }finally{globalThis.fetch=original;}
});

test('earlier dates are strictly before the anchor UTC day, distinct, same band, and capped at ten',()=>{
 const {selectEarlierDates}=require('../spherex-observations');
 const rows=[row('current',61300.1),row('future',61301),row('same-day',61300.8)];
 for(let i=15;i>=1;i--)rows.push(row(`old-${i}`,61300-i+.25),row(`duplicate-${i}`,61300-i+.1));
 const wrong=row('wrong-band',61299.9);wrong[4]='SPHEREx-D2';rows.push(wrong);
 const options={before:new Date((61300.5-40587)*86400000).toISOString(),band:'SPHEREx-D4',limit:10};
 const selected=selectEarlierDates(payload(rows),options);
 assert.deepEqual(selected.map(r=>r.obs_id),Array.from({length:10},(_,i)=>`old-${i+1}`));
 assert.equal(selectEarlierDates(payload([]),options).length,0);
 assert.throws(()=>selectEarlierDates(payload([]),{...options,limit:11}),/between 1 and 10/);
});

test('history route searches the four documented collections before UTC midnight and reports capped results',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{
   const parsed=new URL(url);calls.push(parsed);
   assert.equal(parsed.searchParams.has('INSTRUMENT'),false);
   assert.deepEqual(parsed.searchParams.getAll('COLLECTION'),['spherex_qr3','spherex_qr3_deep','spherex_dr1','spherex_dr1_deep']);
   assert.equal(parsed.searchParams.get('TIME'),'-Inf 61300');
   assert.equal(parsed.searchParams.get('MAXREC'),'1000');
   assert.match(parsed.searchParams.get('POS'),/^CIRCLE /);
   const outside=row('off-center',61299.9,'POLYGON ICRS 20 20 21 20 21 21 20 21');
   const usable=row('usable-same-day',61299.8);
   const data=payload([outside,usable,row('current',61300),row('duplicate',61299.7),...Array.from({length:12},(_,i)=>row(`older-${i}`,61298-i))]);
   data.VOTABLE.RESOURCE_ARRAY[0].INFO_ARRAY[0]['<xmlattr>'].value='OVERFLOW';
   return {ok:true,status:200,json:async()=>data};
 };
 try{
   const params=new URLSearchParams({corners:JSON.stringify(rectangle),mode:'history',before:new Date((61300.5-40587)*86400000).toISOString(),band:'SPHEREx-D4',limit:'10'});
   const res=response();await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${params}`},res);
   assert.equal(res.status,200);const data=JSON.parse(res.body);
   assert.equal(data.observations.length,10);assert.equal(data.observations[0].id,'usable-same-day');
   assert.ok(data.observations.every(o=>o.band==='SPHEREx-D4' && /^\/api\/spherex\/cutout\/[a-f0-9]{64}$/.test(o.cutoutUrl)));
   assert.equal(data.searchLimited,true);
   assert.equal(data.searchSummary.matchingExposures,14);
   assert.equal(data.searchSummary.matchingDates,13);
   assert.equal(data.selectionRule,'earlier-distinct-UTC-dates-from-returned-rows');
   assert.equal(calls.length,1,'Search does not download images');
 }finally{globalThis.fetch=original;}
});

test('invalid history filters are rejected before archive access',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('Must not reach the archive');};
 try{
   for(const invalid of [{before:'invalid'},{before:'2026-02-30'},{band:'SPHEREx-D9'},{limit:'11'},{limit:'0'}]){
     const params=new URLSearchParams({corners:JSON.stringify(rectangle),mode:'history',before:'2026-09-22',band:'SPHEREx-D2',limit:'10',...invalid});
     const res=response();await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${params}`},res);
     assert.equal(res.status,400);
   }
   assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('newer-date refresh scopes collection queries and accepts official release URLs with one exposure per UTC day',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
   const parsed=new URL(url);
   assert.equal(parsed.searchParams.has('INSTRUMENT'),false);
   assert.deepEqual(parsed.searchParams.getAll('COLLECTION'),['spherex_qr3','spherex_qr3_deep','spherex_dr1','spherex_dr1_deep']);
   assert.equal(parsed.searchParams.get('TIME'),'61301 +Inf');
   const newer=row('new-dr2',61301);newer[1]='spherex_dr2';newer[8]=newer[8].replace('/qr3/','/dr2/');
   const later=row('new-qr4',61302);later[1]='spherex_qr4';later[8]=later[8].replace('/qr3/','/qr4/');
   return {ok:true,status:200,json:async()=>payload([later,row('anchor-day',61300.9),row('duplicate-day',61301.1),newer])};
 };
 try{
   const params=new URLSearchParams({corners:JSON.stringify(rectangle),mode:'newer',after:new Date((61300.5-40587)*86400000).toISOString(),band:'SPHEREx-D4',limit:'10'});
   const res=response();await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${params}`},res);
   assert.equal(res.status,200);const result=JSON.parse(res.body);
   assert.deepEqual(result.observations.map(o=>o.id),['new-dr2','new-qr4']);
   assert.equal(result.selectionRule,'newer-distinct-UTC-dates-from-returned-rows');
   assert.equal(result.searchSummary.matchingDates,2);
 }finally{globalThis.fetch=original;}
});
