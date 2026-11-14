import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { regionFromCorners, regionFromRectangle, footprintContainsRegion } from '../sky-region.mjs';
const require = createRequire(import.meta.url);
const { selectRegionPair, selectTapPair, buildTapQuery, handleObservationRequest } = require('../spherex-observations.js');
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

test('controlled point route uses TAP and 0.05-degree cutouts without claiming full coverage', async()=>{
 const originalFetch=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{
   calls.push({url:String(url),options});
   return {ok:true,status:200,headers:new Headers(),json:async()=>({metadata:[{name:'uri'},{name:'time_bounds_lower'}],data:[
     ['ibe/data/spherex/qr3/level2/a/new.fits',61300.8],['ibe/data/spherex/qr3/level2/a/older.fits',61299.2]]})};
 };
 try {
   const responseBody=response();const query=new URLSearchParams({corners:JSON.stringify(rectangle),mode:'point'});
   await handleObservationRequest({method:'GET',url:`/api/spherex/observations?${query}`},responseBody);
   assert.equal(responseBody.status,200);const data=JSON.parse(responseBody.body);
   assert.equal(data.mode,'point');assert.equal(data.cutoutSizeDegrees,.05);assert.equal(data.coverage,'center-test');
   assert.ok(data.observations.every(o=>o.coverage==='center-test'));
   assert.equal(calls[0].url,'https://irsa.ipac.caltech.edu/TAP/sync');assert.equal(calls[0].options.method,'POST');
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
