import { regionFromRectangle } from './sky-region.mjs';

// Same stable Aladin Lite distribution used by IRSA's HiPS example.
const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
const MISSIONS = {
  spherex: {
    name: 'SPHEREx DR1 — 3.293 µm',
    url: 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube',
    credit: 'SPHEREx · NASA/Caltech/IPAC',
    link: 'https://irsa.ipac.caltech.edu/Missions/spherex.html',
    description: 'SPHEREx DR1 infrared sky, fixed channel at approximately 3.293 µm.'
  },
  gaia: {
    name: 'Gaia DR3 colour flux map',
    // Published by ESA: https://skies.esac.esa.int/hipslist
    url: 'https://skies.esac.esa.int/Gaia/dr3/RGB',
    credit: 'Gaia DR3 · ESA/Gaia/DPAC · S. Moreira & A. Moitinho',
    link: 'https://skies.esac.esa.int/Gaia/dr3/RGB/',
    description: 'Gaia DR3 BP/G/RP source-flux map. Sandro Moreira, André Moitinho; CC BY-NC 3.0 IGO.'
  }
};
// Controlled diagnosis only; the normal URL retains full-rectangle searches.
const pointTest = new URLSearchParams(window.location.search).get('observationTest') === 'point';
export const observationDiagnostics = [];
function observationLog(stage, event, details = {}) {
  const entry = {time:new Date().toISOString(),stage,event,...details};
  observationDiagnostics.push(entry);
  if (observationDiagnostics.length>200) observationDiagnostics.shift();
  console.info('[Planet X observations]', entry);
}
function diagnosticUrl(value) {
  const url=new URL(value,window.location.href);
  for (const key of [...url.searchParams.keys()]) if (/^(token|access_token|api_?key|key|password|secret|sig|signature)$/i.test(key)) url.searchParams.set(key,'[redacted]');
  url.username='';url.password='';return url.href;
}

const CHANNEL_INDEX = 62; // Fixed wavelength channel, not an observation date.
const status = document.getElementById('status');
const missionButtons = [...document.querySelectorAll('[data-mission]')];
const surveyCredit = document.getElementById('survey-credit');
const coordinateForm = document.getElementById('coordinate-search');
const coordinateFields = document.getElementById('coordinate-fields');
const raInput = document.getElementById('right-ascension');
const decInput = document.getElementById('declination');
const fovInput = document.getElementById('field-of-view');
const coordinateError = document.getElementById('coordinate-error');
const coordinateResult = document.getElementById('coordinate-result');
const cursorCoordinates = document.getElementById('cursor-coordinates');
const markerToggle = document.getElementById('marker-toggle');
let selectedPair = null;
let comparisonMap = null;
let comparisonActive = false;
const regionView = document.getElementById('region-view');
const regionMapElement = document.getElementById('region-map');
const backToSkyButton = document.getElementById('back-to-sky');
let selectedRegion = null;
let regionOverlay = null;
let drawingRegion = false;
let selectionSequence = 0;
const drawRegionButton = document.getElementById('draw-region');
const clearRegionButton = document.getElementById('clear-region');
const loadObservationButton = document.getElementById('load-observation');
const regionResult = document.getElementById('region-result');
const preloadProgress = document.getElementById('preload-progress');
let pairState = null;
let preloadSequence = 0;
let baseMission = null;

let searchMarkerCatalog = null;
let markerVisible = false;
const metadata = new Map();
let A;
let currentMission = null;
let switching = false;
export let skyMap;

function showError(error) {
  status.hidden = false;
  status.textContent = `Sky imagery could not load: ${error instanceof Error ? error.message : error}`;
  console.error('Planet X sky:', error);
}

function clearCursorCoordinates() {
  cursorCoordinates.textContent = 'RA — · Dec — · ICRS';
}

function updateCursorCoordinates(position) {
  if (!skyMap || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
    clearCursorCoordinates();
    return;
  }
  try {
    // Convert the cursor's view pixels to ICRS, regardless of the survey's
    // native frame. This reads the pointer position, not the screen center.
    const viewer = comparisonActive ? comparisonMap : skyMap;
    const world = viewer.pix2world(position.x, position.y, 'ICRS');
    if (!world || !Number.isFinite(world[0]) || !Number.isFinite(world[1])) {
      clearCursorCoordinates();
      return;
    }
    const ra = ((world[0] % 360) + 360) % 360;
    const dec = world[1];
    cursorCoordinates.textContent = `RA ${ra.toFixed(5)}° · Dec ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}° · ICRS`;
  } catch {
    clearCursorCoordinates(); // The pointer may be outside the valid projection.
  }
}

async function getProperties(id) {
  if (metadata.has(id)) return metadata.get(id);
  const response = await fetch(`${MISSIONS[id].url}/properties`, {
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${MISSIONS[id].name} returned HTTP ${response.status}`);
  const properties = Object.fromEntries((await response.text()).split('\n')
    .filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const split = line.indexOf('=');
      return [line.slice(0, split).trim(), line.slice(split + 1).trim()];
    }));
  if (!properties.creator_did || !properties.hips_tile_format) {
    throw new Error(`${MISSIONS[id].name} returned invalid survey metadata.`);
  }
  if (id === 'gaia' && properties.creator_did !== 'ivo://ESAVO/P/GAIA/DR3-RGB') {
    throw new Error('The Gaia service did not return the expected DR3 dataset.');
  }
  metadata.set(id, properties);
  return properties;
}

function applyLayer(id, properties) {
  return new Promise((resolve, reject) => {
    const options = {
      name: MISSIONS[id].name,
      errorCallback: reject,
      successCallback: hips => {
        try {
          if (id === 'spherex') {
            const depth = Number(properties.hips_cube_depth);
            const low = 299792458 / Number(properties.em_max);
            const high = 299792458 / Number(properties.em_min);
            if (!(depth > CHANNEL_INDEX && Number.isFinite(low) && high > low)) {
              throw new Error('SPHEREx cube metadata is missing or invalid.');
            }
            // Same frequency-bin mapping as IRSA's cube example.
            hips.setFrequency({
              value: low + (CHANNEL_INDEX + 0.5) / depth * (high - low),
              unit: 'Hz'
            });
          }
          resolve();
        } catch (error) { reject(error); }
      }
    };
    // Replaces the base layer in the SAME viewer. Aladin reads each survey's
    // coordinate frame (SPHEREx equatorial, Gaia galactic) from its metadata.
    // No goto/zoom calls: the current ICRS position, FoV and perspective stay put.
    skyMap.setBaseImageLayer(A.HiPS(MISSIONS[id].url, options));
  });
}

function isObservation(id) { return /^observation-[01]$/.test(id || ''); }

function updateMissionControls() {
  missionButtons.forEach(button => {
    const id = button.dataset.mission;
    const dated = isObservation(id);
    const index = dated ? Number(id.at(-1)) : -1;
    button.disabled = switching || currentMission === null || (dated && !pairState?.ready);
    button.setAttribute('aria-pressed', String(id === currentMission));
    if (dated) {
      const exposure = selectedPair?.observations[index];
      button.textContent = exposure ? exposure.observedStart.slice(0, 10) : `Date ${index + 1}`;
      button.title = exposure ? `Observed ${exposure.observedStart}; coverage: ${exposure.coverage || 'not measured'}` : 'Draw a rectangle to load two dates.';
    }
  });
  updateRegionControls();
}

function updateSourceDescription() {
  if (isObservation(currentMission)) {
    const exposure = selectedPair.observations[Number(currentMission.at(-1))];
    surveyCredit.textContent = `SPHEREx · ${exposure.observedStart.replace('T', ' ').replace('Z', ' UTC')} · NASA/Caltech/IPAC`;
    surveyCredit.href = exposure.downloadUrl;
    surveyCredit.title = 'One dated exposure, cropped to the selected region. Black areas have no image coverage. Wavelengths vary across the exposure.';
  } else if (currentMission && MISSIONS[currentMission]) {
    const source = MISSIONS[currentMission];
    surveyCredit.textContent = source.credit;
    surveyCredit.href = source.link;
    surveyCredit.title = source.description;
  }
}

async function switchMission(id) {
  if (switching || !skyMap) return false;
  if (isObservation(id)) {
    if (!pairState?.ready) return false;
    await enterComparison();
    if (!pairState?.ready || !selectedRegion) return false;
    pairState.frames.forEach((frame, key) => frame.image.setOpacity(key === id ? 1 : 0));
    currentMission = id;
    await verifyImageDisplay(id);
    updateSourceDescription();
    updateMissionControls();
    return true;
  }
  if (!MISSIONS[id]) return false;
  leaveComparison();
  if (baseMission === id) {
    currentMission = id;
    updateSourceDescription();
    updateMissionControls();
    return true;
  }
  const previousBase = baseMission;
  switching = true;
  updateMissionControls();
  try {
    status.hidden = false;
    status.textContent = `Loading ${MISSIONS[id].name}…`;
    const properties = await getProperties(id);
    await applyLayer(id, properties);
    baseMission = currentMission = id;
    updateSourceDescription();
    status.hidden = true;
    return true;
  } catch (error) {
    if (previousBase) {
      try { await applyLayer(previousBase, metadata.get(previousBase)); }
      catch (restoreError) { console.error('Could not restore previous survey:', restoreError); }
      currentMission = baseMission = previousBase;
    }
    showError(error);
    return false;
  } finally {
    switching = false;
    updateMissionControls();
  }
}

async function verifyImageDisplay(id) {
  const start=performance.now();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const state=pairState, frame=state?.frames.get(id);
  if (!state?.ready || !frame || !comparisonActive || currentMission!==id) return;
  const registered=comparisonMap.getOverlayImageLayer(frame.layer)===frame.image;
  const opacity=frame.image.getOpacity();
  const [width,height]=comparisonMap.getSize();
  const samples=[];
  for (const [x,y] of [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]]) {
    try { samples.push(frame.image.readPixel(width*x,height*y)); } catch(error) { samples.push({error:String(error)}); }
  }
  observationLog('Aladin image display','frame',{requestId:selectedPair.requestId,id,registered,opacity,size:[width,height],elapsedMs:Math.round(performance.now()-start),samples});
  if (!registered || opacity!==1) throw new Error(`Aladin display failed for ${id}: registered=${registered}, opacity=${opacity}.`);
}

function leaveComparison() {
  comparisonActive = false;
  regionView.hidden = true;
  document.body.classList.remove('region-comparison');
  document.getElementById('sky-map').inert = false;
  if (isObservation(currentMission)) currentMission = baseMission;
  coordinateFields.disabled = !skyMap;
  backToSkyButton.hidden = true;
  clearCursorCoordinates();
}

async function enterComparison() {
  if (!selectedRegion) return;
  if (comparisonActive && comparisonMap) return;
  const region = selectedRegion;
  regionView.hidden = false;
  comparisonActive = true;
  document.body.classList.add('region-comparison');
  document.getElementById('coordinate-panel').open = false;
  document.getElementById('sky-map').inert = true;
  coordinateFields.disabled = true;
  backToSkyButton.hidden = false;
  if (!comparisonMap) {
    comparisonMap = A.aladin('#region-map', {
      survey: [], target: `${region.position.ra} ${region.position.dec}`,
      projection: 'TAN', fov: region.sizeDegrees,
      showLayersControl: false, showZoomControl: false,
      showFullscreenControl: false, showProjectionControl: false,
      showCooLocation: false, showFrame: false, showFov: false,
      showStatusBar: false, showReticle: false, showCooGrid: false,
      showContextMenu: false, inertia: false, log: false
    });
    comparisonMap.on('mouseMove', updateCursorCoordinates);
    // Canvas coordinates change on resize; re-fit and re-crop the same sky region.
    comparisonMap.on('resizeChanged', scheduleRegionFit);
    comparisonMap.on('stackChanged', enforceRegionLayers);
  }
  sizeComparisonFrame();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (selectedRegion !== region || !comparisonActive) return;
  fitComparisonRegion();
  updateRegionControls();
}

function enforceRegionLayers() {
  // Aladin may restore a default background after a failed first FITS load.
  // The comparison must contain only the two requested observations.
  const allowed = new Set([...(pairState?.frames.values() || [])].map(frame => frame.layer));
  for (const layer of [...comparisonMap.getStackLayers()]) {
    if (!allowed.has(layer)) comparisonMap.removeImageLayer(layer);
  }
}

function sizeComparisonFrame() {
  if (!selectedRegion) return;
  const aspect = selectedRegion.aspect;
  const width = Math.min(window.innerWidth, window.innerHeight * aspect);
  regionMapElement.style.width = `${width}px`;
  regionMapElement.style.height = `${width / aspect}px`;
}

let fitScheduled = false;
function scheduleRegionFit() {
  if (!comparisonActive || fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    if (comparisonActive && selectedRegion) {
      sizeComparisonFrame();
      fitComparisonRegion();
    }
  });
}

function fitComparisonRegion() {
  if (!comparisonMap || !selectedRegion) return;
  const { position: { ra, dec }, corners, rotation } = selectedRegion;
  comparisonMap.gotoRaDec(ra, dec);
  // Version 3.8.2 treats zero as an absent rotation; 360 is equivalent to zero.
  comparisonMap.setRotation(rotation || 360);
  let fov = selectedRegion.sizeDegrees;
  comparisonMap.setFoV(fov);
  const [width, height] = comparisonMap.getSize();
  if (!(width > 0 && height > 0)) return;
  for (let i = 0; i < 3; i++) {
    const pixels = corners.map(([lon, lat]) => comparisonMap.world2pix(lon, lat));
    if (pixels.some(p => !p || p.some(n => !Number.isFinite(n)))) return;
    const scale = Math.max(...pixels.map(([x, y]) => Math.max(Math.abs(x-width/2)/(width/2), Math.abs(y-height/2)/(height/2))));
    fov = 2 * Math.atan(Math.tan(fov*Math.PI/360) * scale * 1.002) * 180/Math.PI;
    comparisonMap.setFoV(fov);
  }
  const pixels = corners.map(([lon, lat]) => comparisonMap.world2pix(lon, lat));
  regionMapElement.style.setProperty('--region-clip', `polygon(${pixels.map(([x,y]) => `${x}px ${y}px`).join(',')})`);
}

function discardPreparedObservations() {
  const state = pairState;
  pairState = null;
  selectedPair = null;
  if (state) {
    state.controller.abort();
    state.frames.forEach(frame => comparisonMap.removeImageLayer(frame.layer));
    state.blobUrls.forEach(url => URL.revokeObjectURL(url));
  }
  if (isObservation(currentMission)) currentMission = baseMission;
  updateSourceDescription();
  updateMissionControls();
}

function prepareResidentImage(state,id,exposure,blobUrl) {
  const start=performance.now();
  observationLog('Browser FITS decoding','start',{requestId:state.requestId,id,url:diagnosticUrl(blobUrl),date:exposure.observedStart});
  return new Promise((resolve,reject)=>{
    const layer=`planetx-pair-${state.sequence}-${id}`;
    let settled=false,phase='Browser FITS decoding',image;
    const timer=setTimeout(()=>fail(new Error(`${phase} timed out after 90 seconds for ${exposure.observedStart}.`)),90000);
    const cancel=()=>fail(new Error('Observation loading cancelled.'));
    const cleanup=()=>{clearTimeout(timer);state.controller.signal.removeEventListener('abort',cancel);};
    const fail=error=>{
      if (settled) return;
      settled=true;cleanup();
      observationLog(phase,'error',{requestId:state.requestId,id,elapsedMs:Math.round(performance.now()-start),exception:{name:error?.name,message:error?.message || String(error)}});
      reject(error);
    };
    state.controller.signal.addEventListener('abort',cancel,{once:true});
    try {
      image=A.image(blobUrl,{
        name:`SPHEREx ${exposure.observedStart}`,imgFormat:'fits',opacity:0,minCut:0,maxCut:40,
        successCallback:()=>{
          image.setOpacity(0);
          if (settled || pairState!==state || state.controller.signal.aborted) {
            setTimeout(()=>comparisonMap.removeImageLayer(layer),0);fail(new Error('Observation loading cancelled.'));return;
          }
          observationLog(phase,'complete',{requestId:state.requestId,id,elapsedMs:Math.round(performance.now()-start)});
          phase='Aladin image registration';image.setCuts(0,40);
          const waitForRegistration=()=>{
            if (settled || pairState!==state || state.controller.signal.aborted) { comparisonMap.removeImageLayer(layer);fail(new Error('Observation loading cancelled.'));return; }
            if (comparisonMap.getOverlayImageLayer(layer)!==image) { setTimeout(waitForRegistration,16);return; }
            settled=true;cleanup();
            observationLog(phase,'complete',{requestId:state.requestId,id,elapsedMs:Math.round(performance.now()-start),layer});resolve();
          };
          setTimeout(waitForRegistration,0);
        },errorCallback:fail
      });
      state.frames.set(id,{image,layer});comparisonMap.setOverlayImageLayer(image,layer);
    } catch(error) { fail(error); }
  });
}

function updateRegionControls() {
  drawRegionButton.disabled = !skyMap || currentMission === null || switching;
  drawRegionButton.textContent = drawingRegion ? 'Cancel drawing' : 'Draw rectangle';
  drawRegionButton.setAttribute('aria-pressed', String(drawingRegion));
  clearRegionButton.hidden = !selectedRegion;
  loadObservationButton.disabled = !selectedRegion || drawingRegion || switching || !!pairState?.pending;
  loadObservationButton.textContent = pairState?.pending ? 'Loading two observations…' : 'Load two observations';
}

function clearSelectedRegion() {
  selectionSequence += 1;
  if (drawingRegion) { skyMap.fire('default'); skyMap.showReticle(false); }
  drawingRegion = false;
  leaveComparison();
  discardPreparedObservations();
  selectedRegion = null;
  regionOverlay?.removeAll();
  regionOverlay?.hide();
  preloadProgress.hidden = true;
  regionResult.textContent = 'Zoom in, then drag a rectangle that fits within 1°.';
  updateRegionControls();
}

async function startRegionSelection() {
  if (!skyMap || switching) return;
  if (drawingRegion) { clearSelectedRegion(); return; }
  clearSelectedRegion();
  const sequence = ++selectionSequence;
  drawingRegion = true;
  regionResult.textContent = 'Drag a rectangle, then release to lock it and load two dates. Escape cancels.';
  updateRegionControls();
  try {
    await skyMap.select('rect', async rect => {
      if (sequence !== selectionSequence) return;
      drawingRegion = false;
      setTimeout(() => skyMap.showReticle(false), 0);
      try {
        selectedRegion = {
          ...regionFromRectangle(rect, (...args) => skyMap.pix2world(...args)),
          aspect: rect.w / rect.h, rotation: skyMap.getRotation()
        };
        if (!regionOverlay) {
          regionOverlay = A.graphicOverlay({ name:'Selected region', color:'#ffe66d', lineWidth:2 });
          skyMap.addOverlay(regionOverlay);
        }
        regionOverlay.removeAll();
        regionOverlay.addFootprints([A.polygon(selectedRegion.corners.map(p => [...p]))]);
        regionOverlay.show();
        const {ra,dec} = selectedRegion.position;
        regionResult.textContent = `Locked region · RA ${ra.toFixed(5)}°, Dec ${dec.toFixed(5)}°`;
        await enterComparison();
        if (sequence === selectionSequence && selectedRegion) void loadSelectedObservations();
      } catch (error) {
        clearSelectedRegion();
        regionResult.textContent = error.message;
      }
      updateRegionControls();
    });
  } catch (error) {
    drawingRegion = false;
    regionResult.textContent = `Could not start selection: ${error.message}`;
    updateRegionControls();
  }
}

async function loadSelectedObservations() {
  if (!selectedRegion || drawingRegion || switching || pairState?.pending) return false;
  const region = selectedRegion;
  await enterComparison();
  if (selectedRegion !== region || !comparisonActive) return false;
  discardPreparedObservations();
  const state = { sequence: ++preloadSequence, controller: new AbortController(), frames: new Map(), blobUrls: [], pending:true, ready:false };
  pairState = state;
  preloadProgress.hidden = false;
  preloadProgress.textContent = 'Finding two different dates overlapping the rectangle…';
  updateMissionControls();
  let step = 'Observation search';
  try {
    const query=new URLSearchParams({corners:JSON.stringify(region.corners),mode:pointTest?'point':'rectangle'});
    const url=`/api/spherex/observations?${query}`;
    const started=performance.now();
    observationLog(step,'start',{url:diagnosticUrl(url),mode:pointTest?'point':'rectangle'});
    const response=await fetch(url,{signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(105000)])});
    observationLog(step,'headers',{url:diagnosticUrl(url),status:response.status,elapsedMs:Math.round(performance.now()-started)});
    const result=await readArchiveResponse(response,step);
    state.requestId=result.requestId;
    observationLog(step,'complete',{requestId:state.requestId,status:response.status,elapsedMs:Math.round(performance.now()-started),recordCount:result.recordCount,searchLimited:result.searchLimited});
    if (pairState!==state || state.controller.signal.aborted) return false;
    if (!Array.isArray(result.observations) || result.observations.length!==2 ||
      result.observations.some(e=>!e.cutoutUrl || !e.observedStart) ||
      result.observations[0].observedStart.slice(0,10)===result.observations[1].observedStart.slice(0,10)) throw new Error('The archive did not return two observations from different dates.');
    // Keep downloads serial while diagnosing. A failed first file prevents a
    // second request; its timing cannot be confused with the other download.
    for (const [index,exposure] of result.observations.entries()) {
      const date=exposure.observedStart.slice(0,10);
      step=`Image download for ${date}`;
      preloadProgress.textContent=`Loading image ${index+1}/2 · ${date}${result.mode==='point'?' · center test, 0.05° only':''}…`;
      const downloadStart=performance.now();
      observationLog(step,'start',{requestId:state.requestId,url:diagnosticUrl(exposure.cutoutUrl)});
      const cutout=await fetch(exposure.cutoutUrl,{signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(105000)])});
      if (!cutout.ok) await readArchiveResponse(cutout,step);
      const bytes=await cutout.arrayBuffer();
      observationLog(step,'complete',{requestId:state.requestId,status:cutout.status,elapsedMs:Math.round(performance.now()-downloadStart),byteSize:bytes.byteLength,
        sourceBytes:cutout.headers.get('x-planetx-source-bytes'),hdu:cutout.headers.get('x-planetx-image-hdu'),pixelSha256:cutout.headers.get('x-planetx-pixel-sha256')});
      if (new TextDecoder().decode(new Uint8Array(bytes,0,Math.min(8,bytes.byteLength)))!=='SIMPLE  ') throw new Error(`The ${date} response is not a FITS image.`);
      if (pairState!==state || state.controller.signal.aborted) return false;
      const blobUrl=URL.createObjectURL(new Blob([bytes],{type:'application/fits'}));state.blobUrls.push(blobUrl);
      step=`Browser FITS decoding for ${date}`;
      preloadProgress.textContent=`Preparing image ${index+1}/2 · ${date}…`;
      await prepareResidentImage(state,`observation-${index}`,exposure,blobUrl);
    }
    if (pairState !== state || state.controller.signal.aborted) return false;
    selectedPair = result;
    state.ready = true;
    enforceRegionLayers();
    preloadProgress.textContent = result.mode==='point'?'Center test ready · two 0.05° cutouts only · not full-rectangle coverage':`Two dates ready · missing coverage stays black${result.searchLimited?' · dates from a limited search':''}`;
    // Do not reopen a comparison the user left while the files were loading.
    if (comparisonActive) await switchMission('observation-0');
    return true;
  } catch (error) {
    state.controller.abort();
    state.frames.forEach(frame => comparisonMap.removeImageLayer(frame.layer));
    state.blobUrls.forEach(url => URL.revokeObjectURL(url));
    state.frames.clear(); state.blobUrls = [];
    if (pairState === state) {
      const message = error.name === 'TimeoutError' ? `${step} timed out. Please retry.` : (error.message || String(error));
      preloadProgress.textContent = `Observations unavailable: ${message}`;
      observationLog(step,'error',{requestId:state.requestId,exception:{name:error.name,message:error.message,cause:error.cause?.message}});
      console.error('Region observations:',error);
    }
    return false;
  } finally {
    state.pending = false;
    if (pairState === state) updateMissionControls();
  }
}

async function readArchiveResponse(response, step) {
  if (!response.ok) {
    let message = `${step} returned HTTP ${response.status}.`;
    try { const failure=await response.json(); message=failure.error || message; observationLog(step,'archive-error',{requestId:failure.requestId,status:response.status,message}); } catch { /* Keep HTTP status. */ }
    if (response.status === 404) message += ' Restart npm start to enable the updated route.';
    throw new Error(message);
  }
  return response.json();
}

drawRegionButton.addEventListener('click', startRegionSelection);
clearRegionButton.addEventListener('click', clearSelectedRegion);
loadObservationButton.addEventListener('click', loadSelectedObservations);
backToSkyButton.addEventListener('click', () => { leaveComparison(); updateSourceDescription(); updateMissionControls(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && drawingRegion) clearSelectedRegion();
});
// Prevent navigation in the comparison while preserving cursor-coordinate reads.
for (const name of ['pointerdown','mousedown','touchstart','wheel','dblclick','contextmenu','keydown']) {
  regionMapElement.addEventListener(name, event => {
    if (comparisonActive) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, {capture:true,passive:false});
}
window.addEventListener('keydown', event => {
  if (comparisonActive && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','=',' '].includes(event.key) && !(event.key === ' ' && event.target.tagName === 'BUTTON')) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, {capture:true});
window.addEventListener('resize', scheduleRegionFit);

export function parseCoordinates(rawRa, rawDec, rawFov) {
  const ra = Number(rawRa);
  const dec = Number(rawDec);
  const fov = Number(rawFov);
  if (!rawRa.trim() || !Number.isFinite(ra) || ra < 0 || ra > 360) {
    return { error: 'Enter a Right Ascension between 0° and 360°.', field: 'ra' };
  }
  if (!rawDec.trim() || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    return { error: 'Enter a Declination between −90° and +90°.', field: 'dec' };
  }
  if (!rawFov.trim() || !Number.isFinite(fov) || fov < 0.1 || fov > 110) {
    return { error: 'Choose a field of view between 0.1° and 110°.', field: 'fov' };
  }
  return { ra: ra === 360 ? 0 : ra, dec, fov };
}

function setMarkerVisible(visible) {
  if (!searchMarkerCatalog) return;
  if (visible) searchMarkerCatalog.show();
  else searchMarkerCatalog.hide();
  markerVisible = visible;
  markerToggle.setAttribute('aria-pressed', String(visible));
  markerToggle.textContent = visible ? 'Hide marker' : 'Show marker';
}

function markSearchPosition(ra, dec) {
  if (!searchMarkerCatalog) {
    // A real Aladin catalog source, stored in ICRS RA/Dec. Aladin projects
    // the crosshair as the view changes; it is not a fixed screen reticle.
    searchMarkerCatalog = A.catalog({
      name: 'Searched coordinates',
      shape: 'plus',
      sourceSize: 22,
      color: '#ffe66d'
    });
    skyMap.addCatalog(searchMarkerCatalog);
  }
  // Keep exactly one target: a new valid search replaces the previous marker.
  searchMarkerCatalog.removeAll();
  searchMarkerCatalog.addSources([A.source(ra, dec)]);
  setMarkerVisible(true);
  markerToggle.hidden = false;
}

markerToggle.addEventListener('click', () => {
  setMarkerVisible(!markerVisible);
});

coordinateForm.addEventListener('input', () => {
  coordinateError.hidden = true;
  coordinateResult.textContent = '';
  [raInput, decInput, fovInput].forEach(input => input.removeAttribute('aria-invalid'));
});

coordinateForm.addEventListener('submit', async event => {
  event.preventDefault();
  coordinateError.hidden = true;
  coordinateResult.textContent = '';
  [raInput, decInput, fovInput].forEach(input => input.removeAttribute('aria-invalid'));
  if (!skyMap) {
    coordinateError.textContent = 'The sky viewer is still loading. Please try again shortly.';
    coordinateError.hidden = false;
    return;
  }
  const view = parseCoordinates(raInput.value, decInput.value, fovInput.value);
  if (view.error) {
    const input = { ra: raInput, dec: decInput, fov: fovInput }[view.field];
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    coordinateError.textContent = view.error;
    coordinateError.hidden = false;
    return;
  }
  try {
    if (switching) throw new Error('Please wait for the current image to finish loading.');
    clearSelectedRegion(); // A new search must not reuse a different region's observation.
    // ICRS RA/Dec are independent of each survey's native tile coordinates.
    // Move the shared viewer; never replace the selected mission or projection.
    skyMap.gotoRaDec(view.ra, view.dec);
    skyMap.setFoV(view.fov);
    markSearchPosition(view.ra, view.dec);
    raInput.value = String(view.ra);
    coordinateResult.textContent = `Centered at RA ${view.ra.toFixed(5)}°, Dec ${view.dec.toFixed(5)}° · ${view.fov}° view`;
  } catch (error) {
    coordinateError.textContent = `Could not move the sky view: ${error instanceof Error ? error.message : error}`;
    coordinateError.hidden = false;
  }
});

missionButtons.forEach(button => {
  button.addEventListener('click', () => { switchMission(button.dataset.mission).catch(showError); });
});

async function loadSky() {
  ({ default: A } = await import(ALADIN_URL));
  return A.init.then(async () => {
    if (skyMap) return;
    skyMap = A.aladin('#sky-map', {
      survey: [],
      target: '60.8109955 51.3404038',
      projection: 'TAN',
      fov: 75,
      showLayersControl: false,
      showZoomControl: false,
      showFullscreenControl: false,
      showProjectionControl: false,
      showCooLocation: false,
      showFrame: false,
      showFov: false,
      showStatusBar: false,
      showReticle: false,
      showCooGrid: false,
      inertia: false,
      log: false
    });
    skyMap.setFoVRange(1 / 36000, 110);
    skyMap.on('mouseMove', updateCursorCoordinates);
    document.getElementById('sky-map').addEventListener('mouseleave', clearCursorCoordinates);
    coordinateFields.disabled = false;
    await switchMission('spherex');
  });
}

loadSky().catch(showError);
