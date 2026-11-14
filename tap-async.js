const { performance } = require('node:perf_hooks');
const { archiveRequest, logTrace } = require('./archive-diagnostics');
const ARCHIVE = 'https://irsa.ipac.caltech.edu';

function validJobUrl(value, base = `${ARCHIVE}/TAP/async`) {
  const url = new URL(value, base);
  if (url.origin !== ARCHIVE || url.username || url.password || url.search || url.hash ||
      !/^\/TAP\/async\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname)) {
    throw new Error('IRSA returned an unexpected TAP job URL.');
  }
  return url.href.replace(/\/$/, '');
}

// TAP documents CSV results. Normalize them to the metadata/data structure used
// by the existing observation selector; handle quoted commas and newlines.
function parseTapCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === '"') {
      if (field || afterQuote) throw new Error('IRSA returned malformed CSV quotes.');
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = ''; afterQuote = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i+1] === '\n') i++;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; field = ''; afterQuote = false;
    } else {
      if (afterQuote && !/\s/.test(char)) throw new Error('IRSA returned malformed CSV values.');
      if (!afterQuote) field += char;
    }
  }
  if (quoted) throw new Error('IRSA returned an incomplete quoted CSV field.');
  if (field || row.length || afterQuote) { row.push(field); rows.push(row); }
  const names = (rows.shift() || []).map(name => name.trim());
  if (!names.includes('uri') || !names.includes('time_bounds_lower')) {
    throw new Error('IRSA TAP CSV is missing uri or time_bounds_lower columns.');
  }
  if (rows.some(values => values.length !== names.length)) throw new Error('IRSA TAP CSV has inconsistent column counts.');
  return { metadata: names.map(name => ({name})), data: rows };
}

async function runAsyncTap(adql, {
  maxWaitMs = 150000, pollIntervalMs = 3000, requestId, log = logTrace
} = {}) {
  if (!(Number.isFinite(maxWaitMs) && maxWaitMs > 0 && Number.isFinite(pollIntervalMs) && pollIntervalMs >= 0)) {
    throw new Error('Invalid TAP wait budget.');
  }
  const started = performance.now();
  let jobUrl = null, lastPhase = null;
  const remaining = () => maxWaitMs - (performance.now() - started);
  const budgetError = () => new Error(`IRSA asynchronous TAP search exceeded ${maxWaitMs/1000} seconds; last phase: ${lastPhase || 'not received'}.${jobUrl ? ` Job: ${jobUrl}` : ''}`);
  const request = async (url, stage, read, fetchOptions = {}, acceptedStatuses) => {
    if (remaining() <= 0) throw budgetError();
    return archiveRequest(url, Math.max(1, Math.min(20000, Math.ceil(remaining()))), stage, read,
      { requestId, log, fetchOptions: {...fetchOptions, redirect: 'manual'}, acceptedStatuses });
  };
  // Standard UWS creation: preserve the Location header rather than following
  // the redirect into the job document. Do not retry a failed submission.
  const created = await request(`${ARCHIVE}/TAP/async`, 'IRSA TAP job creation', async response => {
    const location = response.headers.get('location');
    await response.body?.cancel();
    return {location,status:response.status};
  }, {
    method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({REQUEST:'doQuery',LANG:'ADQL',FORMAT:'CSV',QUERY:adql})
  }, [200,201,303]);
  if (!created.location) throw new Error(`IRSA TAP job creation returned HTTP ${created.status} without a Location header.`);
  jobUrl = validJobUrl(created.location);
  log({requestId,stage:'IRSA TAP job creation',event:'created',jobUrl,elapsedMs:Math.round(performance.now()-started)});

  let runRequested = false;
  let phaseRetries = 0;
  const maxPhaseRetries = 2;
  while (remaining() > 0) {
    let phase;
    try {
      phase = (await request(`${jobUrl}/phase`, 'IRSA TAP phase polling', response => response.text())).trim().toUpperCase();
    } catch (error) {
      // A gateway error while READING a job's status does not mean the job
      // failed. Allow at most two extra GETs for this same job, within the
      // original overall budget. Never repeat creation or PHASE=RUN here.
      if (![502,503,504].includes(error.httpStatus) || phaseRetries >= maxPhaseRetries) {
        const failure = new Error(`${error.message} Existing job: ${jobUrl}`, {cause:error});
        failure.httpStatus = error.httpStatus;
        failure.jobUrl = jobUrl;
        throw failure;
      }
      phaseRetries += 1;
      if (remaining() <= 0) throw budgetError();
      const delayMs = Math.min(pollIntervalMs * 2 ** (phaseRetries - 1), remaining());
      log({requestId,stage:'IRSA TAP phase polling',event:'retry',jobUrl,status:error.httpStatus,
        retry:phaseRetries,maxRetries:maxPhaseRetries,delayMs,phase:lastPhase});
      await new Promise(resolve => setTimeout(resolve,delayMs));
      continue;
    }
    lastPhase = phase;
    log({requestId,stage:'IRSA TAP execution',event:'phase',jobUrl,phase,elapsedMs:Math.round(performance.now()-started)});
    if (phase === 'COMPLETED') {
      const payload = await request(`${jobUrl}/results/result`, 'IRSA TAP result retrieval', async response => parseTapCsv(await response.text()));
      log({requestId,stage:'IRSA asynchronous TAP search',event:'complete',jobUrl,recordCount:payload.data.length,elapsedMs:Math.round(performance.now()-started)});
      return payload;
    }
    if (['ERROR','ABORT','ABORTED'].includes(phase)) {
      let detail;
      try {
        detail = (await request(`${jobUrl}/error`, 'IRSA TAP error report', response => response.text()))
          .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1000);
      } catch (error) { detail = error.message; }
      log({requestId,stage:'IRSA TAP execution',event:'error',jobUrl,phase,detail});
      throw new Error(`IRSA TAP execution ended with phase ${phase}. ${detail || `See ${jobUrl}/error`}`);
    }
    if (phase === 'PENDING' && !runRequested) {
      await request(`${jobUrl}/phase`, 'IRSA TAP job start', async response => { await response.body?.cancel(); }, {
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({PHASE:'RUN'})
      }, [200,303]);
      runRequested = true;
    } else if (!['PENDING','QUEUED','EXECUTING','HELD','SUSPENDED'].includes(phase)) {
      throw new Error(`IRSA TAP phase polling returned an unexpected phase: ${phase}. Job: ${jobUrl}`);
    }
    if (remaining() <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining())));
  }
  log({requestId,stage:'IRSA TAP execution',event:'deadline',jobUrl,phase:lastPhase,elapsedMs:Math.round(performance.now()-started)});
  // Keep the job URL for diagnosis; do not silently create another job or
  // resubmit a failed query. A client may inspect the existing job later.
  throw budgetError();
}

module.exports = { runAsyncTap, validJobUrl, parseTapCsv };
