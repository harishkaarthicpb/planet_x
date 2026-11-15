const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { archiveRequest, logTrace } = require('./archive-diagnostics');
const { extractImage } = require('./fits-image');
const { runAsyncTap } = require('./tap-async');

const ARCHIVE = 'https://irsa.ipac.caltech.edu';
const WAVELENGTH_METERS = 3.293e-6;
const MAX_RECORDS = 200; // We need two dates, not an exhaustive latest-date search.
const DISCOVERY_MAX_RECORDS = 1000;
const cutouts = new Map();

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ARCHIVE && !url.username && !url.password && !url.search && !url.hash &&
      /^\/ibe\/data\/spherex\/(dr[1-9]\d*|qr[1-9]\d*)\/level2\/.+\.fits$/.test(url.pathname);
  } catch { return false; }
}

function number(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
    ? Number(value) : NaN;
}

function utcDateFromMjd(mjd) {
  const value=number(mjd);
  const instant=new Date((value-40587)*86400000);
  if (!Number.isFinite(value) || !Number.isFinite(instant.getTime())) throw new Error('Invalid observation timestamp.');
  // MJD already starts at midnight, unlike JD. No half-day shift is needed.
  return instant.toISOString().slice(0,10);
}

function exposureRows(payload, {anyBand=false,sortByDate=true}={}) {
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
        (anyBand ? /^SPHEREx-D[1-6]$/.test(row.energy_bandpassname) : row.energy_bandpassname === 'SPHEREx-D4') && row.dataproduct_type === 'image' &&
        (anyBand || (number(row.em_min) <= WAVELENGTH_METERS && number(row.em_max) >= WAVELENGTH_METERS)) &&
        validImageUrl(row.access_url) && !seen.has(key);
      if (valid) seen.add(key);
      return valid;
    });
  if (sortByDate) rows.sort((a,b)=>number(b.t_min)-number(a.t_min));
  return rows;
}

function selectRegionPair(payload) {
  // POS=POLYGON already selects every image intersecting the region, including
  // partial coverage. Do not require containment or tie dates to the mosaic.
  const rows = exposureRows(payload);
  const later = rows[0];
  if (!later) throw new Error('No overlapping SPHEREx detector-4 observations were returned for this rectangle.');
  const day = row => utcDateFromMjd(row.t_min);
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
      obs_collection:`spherex_${url.match(/\/spherex\/((?:dr|qr)\d+)\//)?.[1] || 'unknown'}`,
      energy_bandpassname:'SPHEREx-D4',dataproduct_type:'image',
      em_min:2.42e-6,em_max:3.82e-6
    };
  });
}

function selectTapPair(payload) {
  const rows=tapRows(payload).filter(row=>validImageUrl(row.access_url) && Number.isFinite(number(row.t_min)))
    .sort((a,b)=>number(b.t_min)-number(a.t_min));
  const later=rows[0];
  if (!later) throw new Error('TAP returned no usable observations.');
  const laterDate=utcDateFromMjd(later.t_min);
  const earlier=rows.find(row=>utcDateFromMjd(row.t_min)!==laterDate);
  if (!later || !earlier) throw new Error('The center-point query did not return observations on two different UTC dates.');
  return [earlier,later];
}

function historyOptions({before,band,limit=10}) {
  const instant = new Date(before);
  if (typeof before !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*Z)?$/.test(before) || !Number.isFinite(instant.getTime())) {
    throw new Error('Choose a valid UTC observation date for the earlier-date search.');
  }
  if (!/^SPHEREx-D[1-6]$/.test(band)) throw new Error('Choose a valid SPHEREx detector band.');
  limit=Number(limit);
  if (!Number.isInteger(limit) || limit<1 || limit>10) throw new Error('The earlier-date limit must be between 1 and 10.');
  const beforeDate=instant.toISOString().slice(0,10);
  if (before.slice(0,10)!==beforeDate) throw new Error('Choose a valid UTC observation date.');
  return {beforeDate,band,limit,beforeMjd:Date.parse(`${beforeDate}T00:00:00Z`)/86400000+40587};
}

function selectEarlierDates(payload, options, accepts=()=>true) {
  const {beforeDate,band,limit}=historyOptions(options);
  const seen=new Set();
  return exposureRows(payload,{anyBand:true}).filter(row=>{
    const date=utcDateFromMjd(row.t_min);
    if (row.energy_bandpassname!==band || date>=beforeDate || seen.has(date) || !accepts(row)) return false;
    seen.add(date);return true;
  }).slice(0,limit);
}

function selectNewerDates(payload, {after,...options}, accepts=()=>true) {
  const {beforeDate:afterDate,band,limit}=historyOptions({...options,before:after});
  const seen=new Set();
  return exposureRows(payload,{anyBand:true}).sort((a,b)=>number(a.t_min)-number(b.t_min)).filter(row=>{
    const date=utcDateFromMjd(row.t_min);
    if(row.energy_bandpassname!==band || date<=afterDate || seen.has(date) || !accepts(row))return false;
    seen.add(date);return true;
  }).slice(0,limit);
}

async function searchObservations(region, {mode='rectangle',requestId=randomUUID(),log=logTrace,...options}={}) {
  const started=performance.now();
  let selected, recordCount, searchLimited, searchSummary;
  if (mode==='history' || mode==='newer') {
    const newer=mode==='newer';
    const history=historyOptions(newer?{...options,before:options.after}:options);
    const {ra,dec}=region.position;
    const query=new URL('/SIA',ARCHIVE);
    // Query the instrument, not fixed release names: new searchable DR/QR
    // collections (including deep fields) participate without a code update.
    query.searchParams.set('INSTRUMENT','SPHEREx');
    query.searchParams.set('POS',`CIRCLE ${ra} ${dec} 0.0001`);
    query.searchParams.set('TIME',newer?`${history.beforeMjd+1} +Inf`:`-Inf ${history.beforeMjd}`);
    query.searchParams.set('DPTYPE','image');
    query.searchParams.set('RESPONSEFORMAT','JSON');query.searchParams.set('MAXREC',String(DISCOVERY_MAX_RECORDS));
    const payload=await archiveRequest(query,90000,newer?'IRSA newer-date search':'IRSA earlier-date search',r=>r.json(),{requestId,log});
    const {footprintContainsRegion}=await import('./sky-region.mjs');
    const accepts=row=>footprintContainsRegion(row.s_region,[[ra,dec]]);
    selected=newer?selectNewerDates(payload,{after:history.beforeDate,band:history.band,limit:history.limit},accepts):
      selectEarlierDates(payload,{before:history.beforeDate,band:history.band,limit:history.limit},accepts);
    const matching=exposureRows(payload,{anyBand:true}).filter(row=>row.energy_bandpassname===history.band &&
      (newer?utcDateFromMjd(row.t_min)>history.beforeDate:utcDateFromMjd(row.t_min)<history.beforeDate) && accepts(row));
    searchSummary={matchingExposures:matching.length,matchingDates:new Set(matching.map(row=>utcDateFromMjd(row.t_min))).size,
      collections:[...new Set(matching.map(row=>row.obs_collection))],instrument:'SPHEREx'};
    const resources=payload?.VOTABLE?.RESOURCE_ARRAY;
    const resource=resources?.find(item=>item.TABLE);
    recordCount=(resource.TABLE.DATA?.TABLEDATA || []).length;
    searchLimited=resources.some(r=>r.INFO_ARRAY?.some(i=>i['<xmlattr>']?.value==='OVERFLOW')) || recordCount>=DISCOVERY_MAX_RECORDS;
  } else if (mode==='single') {
    // Discover all currently searchable releases. A bounded SIA response can
    // establish only the newest usable returned exposure, not global newestness.
    const {ra,dec}=region.position;
    const {footprintContainsRegion}=await import('./sky-region.mjs');
    const query=new URL('/SIA',ARCHIVE);
    query.searchParams.set('INSTRUMENT','SPHEREx');
    query.searchParams.set('POS',`CIRCLE ${ra} ${dec} 0.0001`);
    query.searchParams.set('DPTYPE','image');
    query.searchParams.set('RESPONSEFORMAT','JSON');query.searchParams.set('MAXREC',String(DISCOVERY_MAX_RECORDS));
    const payload=await archiveRequest(query,90000,'IRSA single-image search',r=>r.json(),{requestId,log});
    const resource=payload.VOTABLE?.RESOURCE_ARRAY?.find(r=>r.TABLE);
    recordCount=resource?.TABLE.DATA?.TABLEDATA?.length || 0;
    searchLimited = resource?.INFO_ARRAY?.some(i=>i['<xmlattr>']?.value==='OVERFLOW') ||
      (resource?.TABLE.DATA?.TABLEDATA?.length || 0)>=DISCOVERY_MAX_RECORDS;
    const first=exposureRows(payload,{anyBand:true}).find(row=>footprintContainsRegion(row.s_region,[[ra,dec]]));
    if (first) selected=[first];
    if (!selected) throw new Error('No SPHEREx FITS image overlapping this rectangle was returned.');
  } else if (mode==='point') {
    const payload=await runAsyncTap(buildTapQuery(region),{maxWaitMs:150000,requestId,log});
    recordCount=payload.data?.length || 0;
    selected=selectTapPair(payload);
    searchLimited=recordCount>=MAX_RECORDS;
  } else {
    const query = new URL('/SIA', ARCHIVE);
    query.searchParams.set('INSTRUMENT','SPHEREx');
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
  return {selected,recordCount,searchLimited,requestId,searchSummary,coverage:selected.map(row=>mode==='point'?'center-test':
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
      if (!['single','rectangle','point','history','newer'].includes(mode)) { sendJson(response,400,{error:'Unknown observation search mode.'}); return true; }
      let history={};
      if (mode==='history' || mode==='newer') {
        try { history=historyOptions({before:url.searchParams.get(mode==='newer'?'after':'before'),band:url.searchParams.get('band'),limit:url.searchParams.get('limit')??10}); }
        catch(error) {sendJson(response,400,{error:error.message});return true;}
      }
      const result=await searchObservations(region,{mode,requestId,...(['history','newer'].includes(mode)?
        {[mode==='newer'?'after':'before']:history.beforeDate,band:history.band,limit:history.limit}:{})});
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
        selectionRule:mode==='single'?'newest-usable-image-returned':mode==='history'?'earlier-distinct-UTC-dates-from-returned-rows':mode==='newer'?'newer-distinct-UTC-dates-from-returned-rows':'newest-two-UTC-dates-returned',
        ...(['history','newer'].includes(mode)?{[mode==='newer'?'after':'before']:history.beforeDate,band:history.band,limit:history.limit,searchSummary:result.searchSummary}:{}),coverage:mode==='point'?'center-test':'partial-allowed'});
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

module.exports = { handleObservationRequest, selectRegionPair, selectTapPair, selectEarlierDates,selectNewerDates, buildTapQuery, searchObservations, cutoutUrl, downloadCutout, validImageUrl, utcDateFromMjd };
