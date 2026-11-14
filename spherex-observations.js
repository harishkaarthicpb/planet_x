const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { archiveRequest, logTrace } = require('./archive-diagnostics');
const { extractImage } = require('./fits-image');

const ARCHIVE = 'https://irsa.ipac.caltech.edu';
const WAVELENGTH_METERS = 3.293e-6;
const MAX_RECORDS = 200; // We need two dates, not an exhaustive latest-date search.
const cutouts = new Map();

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ARCHIVE && !url.search && !url.hash &&
      /^\/ibe\/data\/spherex\/(dr1|qr3)\/level2\/.+\.fits$/.test(url.pathname);
  } catch { return false; }
}

function number(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
    ? Number(value) : NaN;
}

function exposureRows(payload) {
  const resources = payload?.VOTABLE?.RESOURCE_ARRAY;
  if (!Array.isArray(resources)) throw new Error('IRSA returned an unexpected query format.');
  const resource = resources.find(item => item.TABLE);
  if (!resource) throw new Error('IRSA returned no exposure table.');
  for (const info of resource.INFO_ARRAY || []) {
    const attributes = info['<xmlattr>'] || {};
    if (attributes.name === 'QUERY_STATUS' && !['OK', 'OVERFLOW'].includes(attributes.value)) {
      throw new Error('IRSA could not complete the exposure search.');
    }
  }
  const fields = resource.TABLE.FIELD_ARRAY?.map(field => field['<xmlattr>'].name);
  const data = resource.TABLE.DATA?.TABLEDATA || [];
  if (!Array.isArray(fields) || !Array.isArray(data)) throw new Error('IRSA returned an invalid exposure table.');
  const seen = new Set();
  const rows = data.map(row => Object.fromEntries(fields.map((field, index) => [field, row[index]])))
    .filter(row => {
      const start = number(row.t_min);
      const end = number(row.t_max);
      const key = `${row.obs_id}/${row.energy_bandpassname}`;
      const valid = Number.isFinite(start) && start > 0 && Number.isFinite(end) && end >= start &&
        row.energy_bandpassname === 'SPHEREx-D4' && row.dataproduct_type === 'image' &&
        number(row.em_min) <= WAVELENGTH_METERS && number(row.em_max) >= WAVELENGTH_METERS &&
        validImageUrl(row.access_url) && !seen.has(key);
      if (valid) seen.add(key);
      return valid;
    })
    .sort((a, b) => number(b.t_min) - number(a.t_min));
  return rows;
}

function selectRegionPair(payload) {
  // POS=POLYGON already selects every image intersecting the region, including
  // partial coverage. Do not require containment or tie dates to the mosaic.
  const rows = exposureRows(payload);
  const later = rows[0];
  if (!later) throw new Error('No overlapping SPHEREx detector-4 observations were returned for this rectangle.');
  const day = row => Math.floor(number(row.t_min)); // UTC days in MJD.
  // Explicit rule: newest two distinct UTC dates returned by the search.
  const earlier = rows.find(row => day(row) !== day(later));
  if (!earlier) throw new Error('The archive search did not return two different observation dates for this rectangle. Try a nearby region.');
  return [earlier, later];
}

function buildTapQuery(region) {
  const {ra,dec}=region.position;
  // Same point-containment join and time column as NASA's cutouts notebook.
  // Inputs have already passed regionFromCorners; only numbers enter ADQL.
  return `SELECT TOP 200 a.uri, p.time_bounds_lower
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
AND p.energy_bandpassname = 'SPHEREx-D4'
ORDER BY p.time_bounds_lower DESC`;
}

function tapRows(payload) {
  if (!Array.isArray(payload?.metadata) || !Array.isArray(payload.data)) throw new Error('IRSA TAP returned an unexpected JSON table.');
  const fields=payload.metadata.map(f=>f.name);
  return payload.data.map(data=>{
    const row=Object.fromEntries(fields.map((name,i)=>[name,data[i]]));
    const raw=String(row.uri || '');
    const url=new URL(raw, ARCHIVE + '/').href;
    return {
      obs_id:url.split('/').pop()?.replace(/\.fits$/,''), access_url:url,
      t_min:row.time_bounds_lower,t_max:null,
      obs_collection:url.includes('/qr3/')?'spherex_qr3':'spherex_dr1',
      energy_bandpassname:'SPHEREx-D4',dataproduct_type:'image',
      em_min:2.42e-6,em_max:3.82e-6
    };
  });
}

function selectTapPair(payload) {
  const rows=tapRows(payload).filter(row=>validImageUrl(row.access_url) && Number.isFinite(number(row.t_min)))
    .sort((a,b)=>number(b.t_min)-number(a.t_min));
  const later=rows[0];
  const earlier=rows.find(row=>Math.floor(number(row.t_min))!==Math.floor(number(later?.t_min)));
  if (!later || !earlier) throw new Error('The center-point query did not return observations on two different UTC dates.');
  return [earlier,later];
}

async function searchObservations(region, {mode='rectangle',requestId=randomUUID(),log=logTrace}={}) {
  const started=performance.now();
  let selected, recordCount, searchLimited;
  if (mode==='point') {
    const query=new URL('/TAP/sync',ARCHIVE);
    const body=new URLSearchParams({REQUEST:'doQuery',LANG:'ADQL',FORMAT:'json',QUERY:buildTapQuery(region)});
    const payload=await archiveRequest(query,90000,'IRSA observation search',r=>r.json(),{
      requestId,log,fetchOptions:{method:'POST',body}
    });
    recordCount=payload.data?.length || 0;
    selected=selectTapPair(payload);
    searchLimited=recordCount>=MAX_RECORDS;
  } else {
    const query = new URL('/SIA', ARCHIVE);
    for (const collection of ['spherex_dr1','spherex_qr3','spherex_dr1_deep','spherex_qr3_deep']) query.searchParams.append('COLLECTION',collection);
    query.searchParams.set('POS',`POLYGON ${region.corners.flat().join(' ')}`);
    query.searchParams.set('BAND',String(WAVELENGTH_METERS));
    query.searchParams.set('RESPONSEFORMAT','JSON');query.searchParams.set('MAXREC',String(MAX_RECORDS));
    const payload=await archiveRequest(query,90000,'IRSA observation search',r=>r.json(),{requestId,log});
    recordCount=payload.VOTABLE?.RESOURCE_ARRAY?.find(r=>r.TABLE)?.TABLE.DATA?.TABLEDATA?.length || 0;
    selected=selectRegionPair(payload);
    searchLimited=payload.VOTABLE.RESOURCE_ARRAY.some(r=>r.INFO_ARRAY?.some(i=>i['<xmlattr>']?.value==='OVERFLOW'));
  }
  const {footprintContainsRegion}=await import('./sky-region.mjs');
  log({requestId,stage:'IRSA observation search',event:'selected',mode,elapsedMs:Math.round(performance.now()-started),recordCount,searchLimited,
    observations:selected.map(row=>({id:row.obs_id,observedStart:summarize(row).observedStart,band:row.energy_bandpassname}))});
  return {selected,recordCount,searchLimited,requestId,coverage:selected.map(row=>mode==='point'?'center-test':
    footprintContainsRegion(row.s_region,region.corners)?'full':'partial-or-unknown')};
}

function cutoutUrl(row, region, sizeDegrees=region.sizeDegrees) {
  const url=new URL(row.access_url);
  if (!validImageUrl(url.href)) throw new Error('The archive returned an unsupported image URL.');
  url.searchParams.set('center',`${region.position.ra},${region.position.dec}`);
  url.searchParams.set('size',String(sizeDegrees));url.searchParams.set('gzip','false');
  return url;
}

async function downloadCutout(url,{requestId=randomUUID(),log=logTrace}={}) {
  const rawBytes=await archiveRequest(url,90000,'IRSA image download',async r=>Buffer.from(await r.arrayBuffer()),{requestId,log});
  const started=performance.now();
  let result;
  try { result=extractImage(rawBytes); }
  catch(error) {
    log({requestId,stage:'FITS IMAGE inspection',event:'error',sourceBytes:rawBytes.length,
      elapsedMs:Math.round(performance.now()-started),exception:{name:error.name,message:error.message}});
    throw new Error(`FITS IMAGE inspection failed: ${error.message}`,{cause:error});
  }
  const {imageBytes,summary}=result;
  log({requestId,stage:'FITS IMAGE inspection',event:'complete',elapsedMs:Math.round(performance.now()-started),...summary});
  if (!summary.image.finitePixels) throw new Error('The IMAGE extension has no finite science pixels in this cutout.');
  return {rawBytes,imageBytes,summary};
}

function summarize(row) {
  const iso = value => new Date((number(value) - 40587) * 86400000).toISOString();
  return {
    id: row.obs_id,
    collection: row.obs_collection,
    observedStart: iso(row.t_min),
    observedEnd: row.t_max == null ? null : iso(row.t_max),
    band: row.energy_bandpassname,
    wavelengthMinMicrons: number(row.em_min) * 1e6,
    wavelengthMaxMicrons: number(row.em_max) * 1e6,
    downloadUrl: row.access_url
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function handleObservationRequest(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/spherex/')) return false;
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' });
    response.end('Method not allowed');
    return true;
  }
  const requestId=randomUUID();
  try {
    if (url.pathname === '/api/spherex/observations') {
      let region;
      try {
        const { regionFromCorners } = await import('./sky-region.mjs');
        region = regionFromCorners(JSON.parse(url.searchParams.get('corners')));
      } catch (error) {
        sendJson(response, 400, { error: error.message });
        return true;
      }
      const mode=url.searchParams.get('mode') || 'rectangle';
      if (!['rectangle','point'].includes(mode)) { sendJson(response,400,{error:'Unknown observation search mode.'}); return true; }
      const result=await searchObservations(region,{mode,requestId});
      const size=mode==='point'?0.05:region.sizeDegrees;
      const observations=result.selected.map((row,index)=>{
        const url=cutoutUrl(row,region,size);
        const token=createHash('sha256').update(url.href).digest('hex');
        cutouts.set(token,{url:url.href,requestId});
        return {...summarize(row),coverage:result.coverage[index],cutoutUrl:`/api/spherex/cutout/${token}`};
      });
      while (cutouts.size>64) cutouts.delete(cutouts.keys().next().value);
      sendJson(response,200,{...region,observations,requestId,recordCount:result.recordCount,
        searchLimited:result.searchLimited,mode,cutoutSizeDegrees:size,
        selectionRule:'newest-two-UTC-dates-returned',coverage:mode==='point'?'center-test':'partial-allowed'});
    } else if (/^\/api\/spherex\/cutout\/[a-f0-9]{64}$/.test(url.pathname)) {
      const token = url.pathname.split('/').pop();
      const cutout = cutouts.get(token);
      if (!cutout) {
        sendJson(response, 404, { error: 'The cutout reference expired. Load the selected region again.' });
        return true;
      }
      // Only URLs registered by our IRSA search can be fetched, never arbitrary hosts.
      const {imageBytes,summary}=await downloadCutout(cutout.url,{requestId:cutout.requestId});
      response.writeHead(200, { 'Content-Type':'application/fits','Cache-Control':'no-store',
        'X-PlanetX-Request-ID':cutout.requestId,'X-PlanetX-Source-Bytes':String(summary.sourceBytes),
        'X-PlanetX-Image-HDU':'IMAGE','X-PlanetX-Pixel-SHA256':summary.image.pixelSha256 });
      response.end(imageBytes);
    } else {
      sendJson(response, 404, { error: 'Unknown SPHEREx observation route.' });
    }
  } catch (error) {
    logTrace({requestId,stage:'Observation endpoint',event:'error',status:502,exception:{name:error.name,message:error.message}});
    sendJson(response,502,{requestId,error:error instanceof Error?error.message:String(error)});
  }
  return true;
}

module.exports = { handleObservationRequest, selectRegionPair, selectTapPair, buildTapQuery, searchObservations, cutoutUrl, downloadCutout, validImageUrl };
