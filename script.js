import { regionFromRectangle, angularSeparationDegrees } from './sky-region.mjs';
import { sampleFitsPreview } from './fits-preview.mjs';
import { observeSurveyTiles, waitForSurveyTiles, spectrumFrameSize, captureSpectrumFrame, captureBlankSpectrumFrame, bufferSpectrumFrames, disposeSpectrumFrames, paintSpectrumFrame } from './spectrum-buffer.mjs';
import { registerCubeTileRoot, blankCubeChannels } from './hips-cube-tiles.mjs';

// Pinned Aladin 3.8.2 with its SIP polynomial evaluator corrected locally.
// See vendor/README.md for the reproduction and dependency patch.
const ALADIN_URL = '/vendor/aladin-lite-3.8.2.js';
const MISSIONS = {
  spherex: {
    name: 'SPHEREx DR1 — 3.293 µm',
    url: 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube',
    credit: 'SPHEREx · NASA/Caltech/IPAC',
    link: 'https://irsa.ipac.caltech.edu/Missions/spherex.html',
    description: 'SPHEREx DR1 infrared sky at approximately 3.293 µm.'
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
export const observationDiagnostics = [];
function observationLog(stage, event, details = {}) {
  const entry = {time:new Date().toISOString(),stage,event,...details};
  observationDiagnostics.push(entry);
  if (observationDiagnostics.length>200) observationDiagnostics.shift();
  console.info(`[Planet X] ${stage}: ${event}${details.url ? ` ${details.url}` : ''}`, entry);
}
function diagnosticUrl(value) {
  const url=new URL(value,window.location.href);
  for (const key of [...url.searchParams.keys()]) if (/^(token|access_token|api_?key|key|password|secret|sig|signature)$/i.test(key)) url.searchParams.set(key,'[redacted]');
  url.username='';url.password='';return url.href;
}

let CHANNEL_INDEX = 62; // Selected from each verified release's wavelength metadata.
let baseSurveyImage = null;
let wavelengthTimer = null;
let pendingWavelength = null;
const wavelengthPanel = document.getElementById('wavelength-panel');
const wavelengthSlider = document.getElementById('wavelength-slider');
const wavelengthValue = document.getElementById('wavelength-value');
const wavelengthMin = document.getElementById('wavelength-min');
const wavelengthMax = document.getElementById('wavelength-max');
let releaseSignature = null;
let deferredSurveyUpdate = false;
let checkingUpdates = false;
let lastUpdateCheck = Date.now();
const status = document.getElementById('status');
const missionButtons = [...document.querySelectorAll('[data-mission]')];
const missionSwitch = document.getElementById('mission-switch');
const historyButton = document.getElementById('load-history');
const dataFreshness = document.getElementById('data-freshness');
const filmstrip = document.getElementById('observation-filmstrip');
const filmstripTrack = document.getElementById('filmstrip-track');
const filmstripWindow = document.getElementById('filmstrip-window');
const observationScrubber = document.getElementById('observation-scrubber');
const filmstripDate = document.getElementById('filmstrip-date');
const filmstripHelp = document.getElementById('filmstrip-help');
const filmstripPlay = document.getElementById('filmstrip-play');
let filmstripSignature = '';
let filmstripTiles = [];
let scrubbedObservationId = null;
let filmstripDrag = null;
let playback = null;
const PLAYBACK_FRAME_MS = 250;
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
const loadSpectrumButton = document.getElementById('load-spectrum');
const regionModeFields = document.getElementById('region-mode');
const regionModeTime = document.getElementById('region-mode-time');
const regionModeInfrared = document.getElementById('region-mode-infrared');
const spectrumPlayer = document.getElementById('spectrum-player');
const spectrumScrubber = document.getElementById('spectrum-scrubber');
const spectrumValue = document.getElementById('spectrum-value');
const spectrumBands = document.getElementById('spectrum-bands');
const spectrumPlay = document.getElementById('spectrum-play');
const spectrumHelp = document.getElementById('spectrum-help');
const spectrumLoading = document.getElementById('spectrum-loading');
const spectrumLoadingProgress = document.getElementById('spectrum-loading-progress');
const spectrumLoadingCount = document.getElementById('spectrum-loading-count');
const spectrumLoadingDetail = document.getElementById('spectrum-loading-detail');
const spectrumRangeControls = document.getElementById('spectrum-range-controls');
const spectrumRangeFrom = document.getElementById('spectrum-range-from');
const spectrumRangeTo = document.getElementById('spectrum-range-to');
const spectrumRangeSummary = document.getElementById('spectrum-range-summary');
const spectrumRangeError = document.getElementById('spectrum-range-error');
const prepareSpectrumRange = document.getElementById('prepare-spectrum-range');
let spectrumRangeSignature='';
let spectrumTilesSignature='';
let regionMode = 'time';
let spectrumState = null;
let spectrumTiles = [];
let spectrumPreparation = null;
const spectrumCanvas = document.createElement('canvas');
spectrumCanvas.className='spectrum-canvas';spectrumCanvas.hidden=true;spectrumCanvas.setAttribute('aria-hidden','true');
const regionResult = document.getElementById('region-result');
const preloadProgress = document.getElementById('preload-progress');
let pairState = null;
let preloadSequence = 0;
let baseMission = null;
let regionSurvey = null;
const REGION_SURVEY_LAYER = 'planetx-region-survey';

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

function configureSpherexSurvey(survey) {
  const properties=survey.properties;
  const release=properties.creator_did?.match(/^ivo:\/\/IPAC\/P\/SPHEREx\/DR([1-9]\d*)\/cube$/i)?.[1];
  const wavelengths=(properties.data_cube_crval3_arr || '').trim().split(/\s+/).map(Number);
  const previousWavelength=skyWavelengths()[CHANNEL_INDEX];
  const target=previousWavelength ?? 3.293;
  const channel=previousWavelength===undefined && survey.channelIndex!==undefined?survey.channelIndex:
    wavelengths.reduce((best,value,index)=>Math.abs(value-target)<Math.abs(wavelengths[best]-target)?index:best,0);
  const url=new URL(survey.url);
  if(!release || url.origin!=='https://irsa.ipac.caltech.edu' || !url.pathname.startsWith('/data/hips/') ||
    url.search || url.hash || url.username || url.password || !Number.isInteger(channel) ||
    !Number.isFinite(wavelengths[channel]) || Math.abs(wavelengths[channel]-target)>.05){
    throw new Error('The published SPHEREx map is not compatible with this viewer.');
  }
  registerCubeTileRoot(survey.url);
  CHANNEL_INDEX=channel;
  Object.assign(MISSIONS.spherex,{url:survey.url});
  metadata.set('spherex',properties);
  updateWavelengthDescription();
  releaseSignature=`${survey.url}|${survey.revision || [properties.creator_did,properties.hips_release_date,properties.hips_creation_date].join('|')}`;
}

function skyWavelengths() {
  const properties=metadata.get('spherex');
  const values=(properties?.data_cube_crval3_arr || '').trim().split(/\s+/).map(Number);
  return values.length===Number(properties?.hips_cube_depth) && values.every(value=>Number.isFinite(value) && value>0)?values:[];
}

function updateWavelengthDescription() {
  const wavelength=skyWavelengths()[CHANNEL_INDEX];
  if(wavelength===undefined)return;
  const release=metadata.get('spherex').creator_did?.match(/\/DR(\d+)\/cube$/i)?.[1];
  const name=`SPHEREx${release?` DR${release}`:''}`;
  Object.assign(MISSIONS.spherex,{name:`${name} — ${wavelength.toFixed(3)} µm`,
    credit:`${name} · ${wavelength.toFixed(3)} µm · NASA/Caltech/IPAC`,
    description:`${name} infrared sky at ${wavelength.toFixed(3)} µm (channel ${CHANNEL_INDEX+1}).`});
}

function updateWavelengthControls() {
  const wavelengths=skyWavelengths();
  wavelengthPanel.hidden=currentMission!=='spherex' || comparisonActive || !wavelengths.length;
  wavelengthSlider.disabled=wavelengthPanel.hidden || switching || !baseSurveyImage;
  if(wavelengths.length){
    wavelengthSlider.max=String(wavelengths.length-1);
    wavelengthSlider.value=String(CHANNEL_INDEX);
    wavelengthMin.textContent=`${wavelengths[0].toFixed(3)} µm`;
    wavelengthMax.textContent=`${wavelengths.at(-1).toFixed(3)} µm`;
    showWavelengthValue(CHANNEL_INDEX);
  }
  if(wavelengthSlider.disabled){clearTimeout(wavelengthTimer);wavelengthTimer=null;pendingWavelength=null;}
}

function showWavelengthValue(channel) {
  const wavelengths=skyWavelengths(),value=wavelengths[channel];
  if(value===undefined)return;
  wavelengthValue.textContent=`${value.toFixed(3)} µm${blankCubeChannels(metadata.get('spherex')).has(channel)?' · No archive data':''}`;
  wavelengthSlider.setAttribute('aria-valuetext',`${value.toFixed(3)} micrometers, band ${channel+1} of ${wavelengths.length}`);
  wavelengthValue.title=`Band ${channel+1} of ${wavelengths.length}`;
}

function setSkyChannel(channel) {
  if(wavelengthSlider.disabled || !Number.isInteger(channel) || skyWavelengths()[channel]===undefined)return false;
  const previous=CHANNEL_INDEX,properties=metadata.get('spherex');
  try{
    setSurveyChannel(baseSurveyImage,properties,channel);
    baseSurveyImage.setOpacity(surveyOpacity('spherex',channel));
    // Keep a cached survey crop in sync; dated FITS frames are independent.
    if(regionSurvey?.id==='spherex' && regionSurvey.image)setSurveyChannel(regionSurvey.image,properties,channel);
    CHANNEL_INDEX=channel;updateWavelengthDescription();updateSourceDescription();
    updateWavelengthControls();return true;
  }catch(error){
    try{setSurveyChannel(baseSurveyImage,properties,previous);
      baseSurveyImage.setOpacity(surveyOpacity('spherex',previous));
      if(regionSurvey?.id==='spherex' && regionSurvey.image)setSurveyChannel(regionSurvey.image,properties,previous);
    }catch{/* Preserve the original error. */}
    updateWavelengthControls();showError(error);return false;
  }
}

function flushSkyWavelength() {
  clearTimeout(wavelengthTimer);wavelengthTimer=null;
  const channel=pendingWavelength;pendingWavelength=null;
  if(channel!==null)setSkyChannel(channel);
}
wavelengthSlider.addEventListener('input',()=>{
  if(wavelengthSlider.disabled)return;
  pendingWavelength=Number(wavelengthSlider.value);showWavelengthValue(pendingWavelength);
  // Limit dragging to ten channel changes per second; commit the final band
  // immediately on release or keyboard change.
  if(wavelengthTimer===null)wavelengthTimer=setTimeout(flushSkyWavelength,100);
});
wavelengthSlider.addEventListener('change',flushSkyWavelength);

function setSurveyChannel(image,properties,channel=CHANNEL_INDEX) {
  const depth=Number(properties.hips_cube_depth),low=299792458/Number(properties.em_max),high=299792458/Number(properties.em_min);
  if(!(Number.isInteger(channel) && channel>=0 && depth>channel && Number.isFinite(low) && high>low)){
    throw new Error('SPHEREx cube metadata is missing or invalid.');
  }
  if(blankCubeChannels(properties).has(channel)){image.setOpacity(0);return;}
  // Aladin bins the cube's frequency interval uniformly. The physical channel
  // labels come from data_cube_crval3_arr, not that synthetic bin coordinate.
  image.setFrequency({value:low+(channel+.5)/depth*(high-low),unit:'Hz'});
}

function surveyOpacity(id,channel=CHANNEL_INDEX) {
  return id==='spherex' && blankCubeChannels(metadata.get('spherex')).has(channel)?0:1;
}

function selectedSpectrumChannels() {
  const from=Number(spectrumRangeFrom.value),to=Number(spectrumRangeTo.value),count=skyWavelengths().length;
  if(spectrumRangeFrom.value==='' || spectrumRangeTo.value==='' || !Number.isInteger(from) || !Number.isInteger(to) || from<0 || to>=count || from>to){
    throw new Error('Choose a From wavelength that is less than or equal to To.');
  }
  return Array.from({length:to-from+1},(_,index)=>from+index);
}

function updateSpectrumRangeControls() {
  const wavelengths=skyWavelengths(),signature=wavelengths.join(',');
  if(signature!==spectrumRangeSignature){
    const oldFrom=Number(spectrumRangeFrom.value),oldTo=Number(spectrumRangeTo.value),initialized=!!spectrumRangeSignature;
    spectrumRangeFrom.replaceChildren();spectrumRangeTo.replaceChildren();
    wavelengths.forEach((value,index)=>{
      for(const select of [spectrumRangeFrom,spectrumRangeTo]){
        const option=document.createElement('option');option.value=String(index);option.textContent=value.toFixed(3);select.append(option);
      }
    });
    spectrumRangeFrom.value=String(initialized?Math.min(oldFrom,wavelengths.length-1):0);
    spectrumRangeTo.value=String(initialized?Math.min(oldTo,wavelengths.length-1):wavelengths.length-1);
    spectrumRangeSignature=signature;
  }
  spectrumRangeControls.hidden=regionMode!=='infrared';
  const slot=document.getElementById(comparisonActive && regionMode==='infrared'?'player-spectrum-range-slot':'region-spectrum-range-slot');
  if(spectrumRangeControls.parentElement!==slot)slot.append(spectrumRangeControls);
  spectrumRangeFrom.disabled=spectrumRangeTo.disabled=switching || !wavelengths.length;
  try{
    const channels=selectedSpectrumChannels();spectrumRangeError.hidden=true;
    spectrumRangeSummary.textContent=`${channels.length} band${channels.length===1?'':'s'} selected · Fewer bands load faster.`;
    prepareSpectrumRange.disabled=!selectedRegion || switching || !!spectrumState?.preparing;
  }catch(error){spectrumRangeError.hidden=false;spectrumRangeError.textContent=error.message;prepareSpectrumRange.disabled=true;}
}

function changeSpectrumRange() {
  stopSpectrum();
  if(spectrumState){
    spectrumState.ready=false;
    if(spectrumState.preparing)spectrumState.controller.abort(new Error('Wavelength range changed. Choose Prepare selected range.'));
    spectrumHelp.textContent='Range changed. Choose Prepare selected range to load these wavelengths.';
  }
  updateSpectrumRangeControls();updateSpectrumControls();
}

function updateSpectrumControls() {
  const state=spectrumState;
  spectrumLoading.hidden=!(regionMode==='infrared' && comparisonActive && state?.region===selectedRegion && state.preparing);
  if(!spectrumLoading.hidden){
    const wavelengths=skyWavelengths(),total=state.channels.length,loaded=state.channels.filter(channel=>state.frames[channel]).length;
    spectrumLoadingProgress.max=total || 1;spectrumLoadingProgress.value=loaded;
    spectrumLoadingCount.textContent=`${loaded} of ${total} wavelengths ready · ${Math.round(loaded/(total || 1)*100)}%`;
    spectrumLoadingDetail.textContent=state.loadingChannel===undefined?'Opening the infrared sky map…':
      `Loading ${wavelengths[state.loadingChannel].toFixed(3)} µm. Play becomes available after all wavelengths are prepared.`;
  }
  const visible=regionMode==='infrared' && comparisonActive && state?.region===selectedRegion && currentMission==='spherex';
  spectrumPlayer.hidden=!visible;
  document.body.classList.toggle('has-spectrum',!!visible);
  spectrumPlay.disabled=!visible || switching || !state?.ready || state.channels.length<2;
  spectrumPlayer.setAttribute('aria-busy',String(!!state?.preparing));
  spectrumPlay.textContent=state?.playing?'Ⅱ Pause':'▶ Play';
  spectrumPlay.setAttribute('aria-pressed',String(!!state?.playing));
  spectrumPlay.setAttribute('aria-label',state?.playing?'Pause spectrum':'Play spectrum');
  spectrumScrubber.disabled=spectrumPlay.disabled;
  if(!visible)return;
  const wavelengths=skyWavelengths(),channels=state.channels,signature=channels.join(',');
  if(spectrumTilesSignature!==signature){
    spectrumTilesSignature=signature;
    spectrumBands.replaceChildren();spectrumTiles=[];
    channels.forEach(index=>{
      const value=wavelengths[index];
      const tile=document.createElement('span');tile.classList.add('spectrum-band');
      tile.title=`${value.toFixed(3)} µm`;tile.style.setProperty('--band',index);
      spectrumBands.append(tile);spectrumTiles.push(tile);
    });
  }
  spectrumScrubber.min=String(channels[0]);spectrumScrubber.max=String(channels.at(-1));spectrumScrubber.value=String(state.channel);
  spectrumValue.textContent=`${wavelengths[state.channel].toFixed(3)} µm · ${channels.indexOf(state.channel)+1}/${channels.length}`;
  spectrumScrubber.setAttribute('aria-valuetext',`${wavelengths[state.channel].toFixed(3)} micrometers, frame ${channels.indexOf(state.channel)+1} of ${channels.length} selected bands`);
  spectrumTiles.forEach((tile,index)=>{
    tile.classList.toggle('selected',channels[index]===state.channel);
    tile.classList.toggle('buffered',!!state.frames[channels[index]]);
  });
}

function stopSpectrum() {
  if(spectrumState){
    if(spectrumState.playing)spectrumHelp.textContent='Paused. Drag to a wavelength or press Play to continue.';
    spectrumState.playing=false;
    if(spectrumState.frame!==null)cancelAnimationFrame(spectrumState.frame);
    spectrumState.frame=null;
  }
  updateSpectrumControls();
}

function discardSpectrum() {
  stopSpectrum();
  spectrumState?.controller.abort(new Error('Spectrum preparation cancelled.'));
  if(spectrumState)disposeSpectrumFrames(spectrumState.frames);
  spectrumCanvas.hidden=true;
  if(spectrumState?.image && regionSurvey?.image===spectrumState.image){
    setSurveyChannel(spectrumState.image,spectrumState.properties);
  }
  spectrumState=null;updateSpectrumControls();
}

function selectSpectrumChannel(channel,{manual=true}={}) {
  const state=spectrumState;
  if(!state?.ready || !comparisonActive || regionMode!=='infrared' || switching ||
    !Number.isInteger(channel) || !state.channels.includes(channel) || !state.frames[channel])return false;
  if(manual)stopSpectrum();
  try{
    drawSpectrumFrame(state.frames[channel]);state.channel=channel;
    updateSpectrumControls();updateSourceDescription();return true;
  }catch(error){stopSpectrum();showError(error);return false;}
}

function spectrumFrame(now) {
  const state=spectrumState;
  if(!state?.playing)return;
  if(document.hidden || !comparisonActive || regionMode!=='infrared' || state.region!==selectedRegion || switching){stopSpectrum();return;}
  if(now>=state.nextAt){
    if(!selectSpectrumChannel(state.channels[(state.channels.indexOf(state.channel)+1)%state.channels.length],{manual:false}))return;
    state.nextAt=now+125;
  }
  if(spectrumState===state && state.playing)state.frame=requestAnimationFrame(spectrumFrame);
}

function toggleSpectrum() {
  const state=spectrumState;
  if(state?.playing){stopSpectrum();return;}
  if(!state || spectrumPlay.disabled || document.hidden)return;
  stopPlayback();
  state.playing=true;state.nextAt=performance.now()+125;
  spectrumHelp.textContent=`All ${state.channels.length} selected wavelengths buffered. Playing from short to long wavelengths, then looping.`;
  updateSpectrumControls();state.frame=requestAnimationFrame(spectrumFrame);
}

async function loadSelectedSpectrum() {
  if(regionMode!=='infrared' || !selectedRegion || drawingRegion || switching || pairState?.pending || pairState?.historyPending)return false;
  const region=selectedRegion;
  discardPreparedObservations();stopSpectrum();
  preloadProgress.hidden=false;preloadProgress.textContent='Loading infrared sky data…';
  if(spectrumPreparation){
    spectrumState?.controller.abort(new Error('Spectrum preparation restarted.'));
    await spectrumPreparation.catch(()=>{});
  }
  if(selectedRegion!==region || regionMode!=='infrared')return false;
  const properties=await getProperties('spherex');
  updateSpectrumRangeControls();
  let channels;
  try{channels=selectedSpectrumChannels();}catch(error){preloadProgress.hidden=true;spectrumRangeError.textContent=error.message;spectrumRangeError.hidden=false;return false;}
  if(spectrumState && (spectrumState.region!==region || spectrumState.properties!==properties))discardSpectrum();
  if(spectrumState){
    spectrumState.channels=channels;
    if(!channels.includes(spectrumState.channel))spectrumState.channel=channels[0];
  }
  if(spectrumState && channels.every(channel=>spectrumState.frames[channel])){
    await enterComparison();
    if(selectedRegion!==region || regionMode!=='infrared' || !comparisonActive)return false;
    currentMission='spherex';spectrumState.ready=true;spectrumState.image.setOpacity(0);
    drawSpectrumFrame(spectrumState.frames[spectrumState.channel]);
    preloadProgress.hidden=true;
    spectrumHelp.textContent=`All ${channels.length} selected wavelengths buffered. Press Play or drag the spectrum.`;
    updateSourceDescription();updateMissionControls();return true;
  }
  const state=spectrumState || {region,properties,channels,channel:channels.includes(CHANNEL_INDEX)?CHANNEL_INDEX:channels[0],frames:[],playing:false,frame:null,ready:false};
  state.controller=new AbortController();state.preparing=true;spectrumState=state;
  const task=prepareSelectedSpectrum(state);spectrumPreparation=task;
  try{return await task;}finally{if(spectrumPreparation===task)spectrumPreparation=null;}
}

function drawSpectrumFrame(frame) {
  paintSpectrumFrame(spectrumCanvas,frame);
  spectrumCanvas.hidden=false;
}

async function prepareSelectedSpectrum(state) {
  let tracker;
  updateSpectrumControls();
  try{
    // Start observing before a fresh layer is created, so no initial tile
    // request can escape the readiness gate.
    tracker=observeSurveyTiles(MISSIONS.spherex.url);
    if(regionSurvey){comparisonMap.removeImageLayer(REGION_SURVEY_LAYER);regionSurvey=null;}
    if(!await switchRegionSurvey('spherex'))throw new Error('The infrared sky map could not load.');
    state.controller.signal.throwIfAborted();
    if(spectrumState!==state || selectedRegion!==state.region || !comparisonActive)return false;
    state.image=regionSurvey.image;
    const [width,height]=comparisonMap.getSize(),count=state.channels.length;
    const size=spectrumFrameSize(width,height,count);
    if(state.size && (size.width!==state.size.width || size.height!==state.size.height))disposeSpectrumFrames(state.frames);
    state.frames.forEach((frame,index)=>{if(frame && !state.channels.includes(index)){frame.close?.();delete state.frames[index];}});
    state.size=size;
    regionMapElement.append(spectrumCanvas);
    spectrumCanvas.width=size.width;spectrumCanvas.height=size.height;spectrumCanvas.hidden=false;
    spectrumCanvas.getContext('2d').fillRect(0,0,size.width,size.height);
    preloadProgress.hidden=true;
    const blanks=blankCubeChannels(state.properties);
    await bufferSpectrumFrames({count:skyWavelengths().length,channels:state.channels,frames:state.frames,signal:state.controller.signal,
      isBlankChannel:channel=>blanks.has(channel),
      selectChannel:channel=>{state.image.setOpacity(1);setSurveyChannel(state.image,state.properties,channel);},
      waitForTiles:()=>waitForSurveyTiles(tracker,{signal:state.controller.signal,
        isRendering:()=>comparisonMap.view?.wasm?.isRendering?.() ?? false}),
      captureFrame:(channel,{blank})=>blank?captureBlankSpectrumFrame(size,skyWavelengths()[channel]):captureSpectrumFrame(comparisonMap,size),
      onProgress:(channel,loaded)=>{
        state.loadingChannel=channel;
        spectrumHelp.textContent=`Preparing infrared spectrum: ${loaded}/${count} wavelengths buffered · loading ${skyWavelengths()[channel].toFixed(3)} µm. Play becomes available when every frame is ready.`;
        updateSpectrumControls();
      }});
    state.controller.signal.throwIfAborted();
    state.ready=true;state.image.setOpacity(0);
    drawSpectrumFrame(state.frames[state.channel]);
    spectrumHelp.textContent=`All ${count} wavelengths buffered. Press Play or drag the spectrum; playback uses the loaded frames.`;
    updateSourceDescription();return true;
  }catch(error){
    if(spectrumState===state){
      state.ready=false;
      observationLog('Spectrum preparation','error',{message:error.message,channel:state.loadingChannel,
        buffered:state.frames.filter(Boolean).length});
      spectrumHelp.textContent=`Preparation stopped: ${error.message} Use Explore infrared to retry; buffered frames are retained.`;
    }
    return false;
  }finally{
    tracker?.dispose();state.preparing=false;
    if(spectrumState===state){preloadProgress.hidden=true;updateMissionControls();}
  }
}

async function chooseRegionMode(mode) {
  if(!['time','infrared'].includes(mode) || switching || pairState?.pending || pairState?.historyPending)return false;
  if(mode===regionMode)return true;
  if(mode==='time' && selectedRegion?.sizeDegrees>1){
    regionResult.textContent='Time mode needs a region within 1°. Clear this infrared region, zoom in, and draw a smaller rectangle.';
    updateMissionControls();return false;
  }
  discardSpectrum();discardPreparedObservations();regionMode=mode;
  if(!selectedRegion)regionResult.textContent=regionSelectionHint();
  updateMissionControls();
  if(!selectedRegion || drawingRegion)return true;
  return mode==='infrared'?loadSelectedSpectrum():loadSelectedObservations();
}

async function fetchPublishedSurvey() {
  const response=await fetch('/api/spherex/release',{cache:'no-store',signal:AbortSignal.timeout(25000)});
  const result=await response.json();
  if(!response.ok || !result.survey?.properties)throw new Error(result.error || 'The latest whole-sky release could not be checked.');
  return result;
}

function describeReleaseCheck(result) {
  const release=result.survey.release;
  dataFreshness.textContent=result.stale?`${release} retained; release check is temporarily unavailable.`:
    `${release} · release checked ${new Date(result.checkedAt).toLocaleString()} · new observation batches are checked daily while this page is open.`;
  if(result.newerAdvertised)dataFreshness.textContent+=' A newer map is published but needs a compatibility update.';
  else if(result.warnings?.length)dataFreshness.textContent+=' Full release discovery is temporarily incomplete.';
}

async function getProperties(id) {
  if (metadata.has(id)) return metadata.get(id);
  if(id==='spherex'){
    try{
      const result=await fetchPublishedSurvey();
      configureSpherexSurvey(result.survey);describeReleaseCheck(result);
      return result.survey.properties;
    }catch(error){observationLog('SPHEREx release check','unavailable',{message:error.message});}
  }
  const response = await fetch(`${MISSIONS[id].url}/properties`, {
    signal: AbortSignal.timeout(15000),cache:'no-store'
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
  if(id==='spherex'){
    configureSpherexSurvey({url:MISSIONS.spherex.url,properties});
    dataFreshness.textContent=`${MISSIONS.spherex.name} loaded; automatic release discovery is temporarily unavailable.`;
  }
  metadata.set(id, properties);
  return properties;
}

async function refreshPublishedSurvey() {
  const result=await fetchPublishedSurvey(),survey=result.survey;
  const signature=`${survey.url}|${survey.revision}`;
  if(signature===releaseSignature){deferredSurveyUpdate=false;describeReleaseCheck(result);return false;}
  // Discover new releases as usual, but avoid replacing a cube mid-playback.
  if(spectrumState && comparisonActive && regionMode==='infrared'){
    deferredSurveyUpdate=true;
    dataFreshness.textContent=`${survey.release} is available. The current infrared region keeps its loaded map until you return to the whole sky.`;
    return false;
  }
  const previous={mission:{...MISSIONS.spherex},properties:metadata.get('spherex'),channel:CHANNEL_INDEX,signature:releaseSignature};
  configureSpherexSurvey(survey);
  switching=true;updateMissionControls();
  try{
    if(baseMission==='spherex')await applyLayer('spherex',survey.properties);
    if(regionSurvey?.id==='spherex'){
      if(comparisonActive && currentMission==='spherex'){
        const state={region:selectedRegion,id:'spherex',image:null};regionSurvey=state;
        state.image=await applyLayer('spherex',survey.properties,comparisonMap,REGION_SURVEY_LAYER);
        if(regionSurvey===state && comparisonActive)state.image.setOpacity(surveyOpacity('spherex'));
      }else{
        regionSurvey=null;comparisonMap.removeImageLayer(REGION_SURVEY_LAYER);
      }
    }
    deferredSurveyUpdate=false;updateSourceDescription();describeReleaseCheck(result);return true;
  }catch(error){
    Object.assign(MISSIONS.spherex,previous.mission);CHANNEL_INDEX=previous.channel;releaseSignature=previous.signature;
    if(previous.properties){
      metadata.set('spherex',previous.properties);
      try{
        if(baseMission==='spherex')await applyLayer('spherex',previous.properties);
        if(comparisonActive && currentMission==='spherex'){
          const state={region:selectedRegion,id:'spherex',image:null};regionSurvey=state;
          state.image=await applyLayer('spherex',previous.properties,comparisonMap,REGION_SURVEY_LAYER);
          state.image.setOpacity(surveyOpacity('spherex'));
        }
      }catch(restoreError){observationLog('Map restoration','error',{message:restoreError.message});}
    }else metadata.delete('spherex');
    throw error;
  }finally{switching=false;updateMissionControls();}
}

async function checkForDataUpdates() {
  if(!skyMap || switching || checkingUpdates || pairState?.pending || pairState?.historyPending)return false;
  checkingUpdates=true;updateMissionControls();
  let verified=false;
  try{
    try{await refreshPublishedSurvey();verified=true;}
    catch(error){dataFreshness.textContent='The map update check failed; the current map is retained.';
      observationLog('SPHEREx release check','unavailable',{message:error.message});}
    if(pairState?.ready){
      // Re-enable older-date discovery too: a new release can backfill data
      // that were not searchable when a previous history check was exhausted.
      pairState.historyExhausted=false;
      await loadEarlierObservations({newer:true});
    }
    lastUpdateCheck=Date.now();
    return verified;
  }finally{checkingUpdates=false;updateMissionControls();}
}

function applyLayer(id, properties, viewer = skyMap, layer = null) {
  return new Promise((resolve, reject) => {
    const options = {
      name: MISSIONS[id].name,
      // Use the same PNG display transfer in the live sky and buffered crop.
      ...(id==='spherex'?{imgFormat:'png',colormap:'native',stretch:'linear',
        minCut:0,maxCut:255,reversed:false,gamma:1,brightness:0,contrast:0,saturation:0,additive:false}:{}),
      opacity: layer ? 0 : 1,
      errorCallback: reject,
      successCallback: hips => {
        try {
          if (layer) hips.setOpacity(0);
          if (id === 'spherex') setSurveyChannel(hips,properties,
            viewer===comparisonMap && spectrumState?.preparing && regionMode==='infrared'?spectrumState.channels[0]:CHANNEL_INDEX);
          if(viewer===skyMap && !layer)baseSurveyImage=hips;
          resolve(hips);
        } catch (error) { reject(error); }
      }
    };
    // Replaces the base layer in the SAME viewer. Aladin reads each survey's
    // coordinate frame (SPHEREx equatorial, Gaia galactic) from its metadata.
    // No goto/zoom calls: the current ICRS position, FoV and perspective stay put.
    const hips = A.HiPS(MISSIONS[id].url, options);
    if (layer) viewer.setOverlayImageLayer(hips, layer);
    else viewer.setBaseImageLayer(hips);
  });
}

function isObservation(id) { return /^observation-\d+$/.test(id || ''); }
const observationIndex = id => Number(id.slice('observation-'.length));

function observationTimeline() {
  return (selectedPair?.observations || []).map((exposure,index)=>({exposure,id:`observation-${index}`}))
    .filter(entry=>pairState?.frames.has(entry.id))
    .sort((a,b)=>Date.parse(a.exposure.observedStart)-Date.parse(b.exposure.observedStart));
}

function updatePlaybackControls() {
  filmstripPlay.disabled=!comparisonActive || !pairState?.ready || switching || observationTimeline().length<2;
  filmstripPlay.textContent=playback?'Ⅱ Pause':'▶ Play';
  filmstrip.classList.toggle('playing',!!playback);
  filmstripPlay.setAttribute('aria-label',playback?'Pause observations':'Play observations');
  filmstripPlay.setAttribute('aria-pressed',String(!!playback));
}

function stopPlayback() {
  const previous=playback;playback=null;
  if(previous?.frame!=null)cancelAnimationFrame(previous.frame);
  updatePlaybackControls();
}

function playbackFrame(now) {
  const run=playback;
  if(!run)return;
  run.frame=null;
  if(document.hidden || pairState!==run.state || !comparisonActive || switching || !pairState?.ready){stopPlayback();return;}
  if(now>=run.nextAt){
    // Advance once after a slow/background frame rather than racing through
    // missed images. Every displayed frame is a real resident observation.
    run.nextAt=now+PLAYBACK_FRAME_MS;
    const index=run.ids.indexOf(currentMission),id=run.ids[(index+1)%run.ids.length];
    void switchMission(id,{fromPlayback:true}).catch(error=>{
      if(playback===run){stopPlayback();showError(error);}
    });
  }
  if(playback===run)run.frame=requestAnimationFrame(playbackFrame);
}

function togglePlayback() {
  if(playback){stopPlayback();return;}
  const entries=observationTimeline();
  if(!comparisonActive || !pairState?.ready || switching || entries.length<2 || document.hidden)return;
  const ids=entries.map(entry=>entry.id),index=ids.indexOf(currentMission);
  const run={state:pairState,ids,frame:null,nextAt:performance.now()+PLAYBACK_FRAME_MS};
  playback=run;
  // When parked on the newest photo, Play begins at the oldest date.
  const first=index<0 || index===ids.length-1?ids[0]:ids[index];
  void switchMission(first,{fromPlayback:true}).catch(error=>{
    if(playback===run){stopPlayback();showError(error);}
  });
  updatePlaybackControls();
  if(playback===run)run.frame=requestAnimationFrame(playbackFrame);
}

function updateFilmstrip() {
  const entries=observationTimeline();
  const visible=regionMode==='time' && comparisonActive && !!pairState?.ready && entries.length>0;
  if(playback && (!visible || switching || playback.ids.join(',')!==entries.map(entry=>entry.id).join(',')))stopPlayback();
  updatePlaybackControls();
  filmstrip.hidden=!visible;
  document.body.classList.toggle('has-filmstrip',visible);
  document.body.classList.toggle('has-multiple-observations',visible && entries.length>1);
  if(!visible){
    if(filmstripDrag && filmstripWindow.hasPointerCapture(filmstripDrag.pointer))filmstripWindow.releasePointerCapture(filmstripDrag.pointer);
    filmstripDrag=null;filmstripWindow.classList.remove('dragging');
    filmstripTrack.replaceChildren();filmstripTiles=[];filmstripSignature='';return;
  }
  const signature=`${pairState.sequence}:${entries.map(entry=>entry.id).join(',')}`;
  if(signature!==filmstripSignature){
    filmstripTrack.replaceChildren();filmstripTiles=[];
    for(const {exposure,id} of entries){
      const tile=document.createElement('div');tile.classList.add('filmstrip-tile');
      const preview=pairState.frames.get(id).thumbnail;
      if(preview){const image=document.createElement('img');image.src=preview;image.alt='';tile.append(image);}
      const caption=document.createElement('span');caption.textContent=exposure.observedStart.slice(0,10);
      tile.append(caption);filmstripTrack.append(tile);filmstripTiles.push(tile);
    }
    filmstripSignature=signature;
  }
  const selected=isObservation(currentMission)?currentMission:scrubbedObservationId;
  let index=entries.findIndex(entry=>entry.id===selected);
  if(index<0)index=entries.length-1;
  observationScrubber.max=String(entries.length-1);
  observationScrubber.value=String(index);
  observationScrubber.disabled=switching || entries.length<2;
  const date=entries[index].exposure.observedStart.replace('T',' ').replace('Z',' UTC');
  observationScrubber.setAttribute('aria-valuetext',`${date}, image ${index+1} of ${entries.length}`);
  filmstripDate.textContent=isObservation(currentMission)?`${date} · ${index+1}/${entries.length}`:'Drag below to view dated observations';
  filmstripHelp.textContent=entries.length<2?'Load earlier dates to scrub through observations.':'Drag the strip or slider · oldest → newest · UTC dates';
  filmstripTrack.style.transform=`translateX(-${index*68+32}px)`;
  filmstripTiles.forEach((tile,i)=>tile.classList.toggle('selected',i===index && isObservation(currentMission)));
}

function scrubObservation() {
  stopPlayback();
  if(observationScrubber.disabled || !comparisonActive)return;
  const entries=observationTimeline(),index=Math.round(Number(observationScrubber.value));
  if(!Number.isFinite(index) || !entries[index])return;
  if(currentMission===entries[index].id)return;
  void switchMission(entries[index].id).catch(showError);
}

filmstripWindow.addEventListener('pointerdown',event=>{
  if(observationScrubber.disabled || event.button!==0)return;
  stopPlayback();
  event.preventDefault();
  filmstripDrag={pointer:event.pointerId,x:event.clientX,index:Number(observationScrubber.value)};
  filmstripWindow.setPointerCapture(event.pointerId);
  filmstripWindow.classList.add('dragging');
});
filmstripWindow.addEventListener('pointermove',event=>{
  if(!filmstripDrag || filmstripDrag.pointer!==event.pointerId)return;
  const index=filmstripDrag.index+Math.round((filmstripDrag.x-event.clientX)/68);
  observationScrubber.value=String(Math.max(0,Math.min(Number(observationScrubber.max),index)));
  scrubObservation();
});
function finishFilmstripDrag(event){
  if(!filmstripDrag || filmstripDrag.pointer!==event.pointerId)return;
  const drag=filmstripDrag;filmstripDrag=null;
  filmstripWindow.classList.remove('dragging');
  if(filmstripWindow.hasPointerCapture(event.pointerId))filmstripWindow.releasePointerCapture(event.pointerId);
  if(event.type==='pointerup' && Math.abs(event.clientX-drag.x)<4){
    const bounds=filmstripWindow.getBoundingClientRect();
    const index=drag.index+Math.round((event.clientX-bounds.left-bounds.width/2)/68);
    observationScrubber.value=String(Math.max(0,Math.min(Number(observationScrubber.max),index)));
    scrubObservation();
  }
}
filmstripWindow.addEventListener('pointerup',finishFilmstripDrag);
filmstripWindow.addEventListener('pointercancel',finishFilmstripDrag);
filmstripWindow.addEventListener('lostpointercapture',()=>{filmstripDrag=null;filmstripWindow.classList.remove('dragging');});

function attachObservationPreview(state,id,bytes) {
  const frame=state.frames.get(id);
  if(!frame)return;
  try{
    const {width,height,pixels}=sampleFitsPreview(bytes,frame.image.getCuts());
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');
    const image=context.createImageData(width,height);image.data.set(pixels);context.putImageData(image,0,0);
    frame.thumbnail=canvas.toDataURL('image/png');
  }catch(error){observationLog('Observation preview','unavailable',{id,message:error.message});}
}

function syncObservationButtons() {
  const count=Math.max(1,selectedPair?.observations.length || 0);
  for (let i=missionButtons.length-1;i>=0;i--) {
    const button=missionButtons[i];
    if (isObservation(button.dataset.mission) && observationIndex(button.dataset.mission)>=count) {
      button.remove();missionButtons.splice(i,1);
    }
  }
  for (let index=0;index<count;index++) {
    const id=`observation-${index}`;
    if (missionButtons.some(button=>button.dataset.mission===id)) continue;
    const button=document.createElement('button');
    button.type='button';button.dataset.mission=id;
    button.addEventListener('click',()=>switchMission(id).catch(showError));
    missionSwitch.insertBefore(button,historyButton);missionButtons.push(button);
  }
}

function updateMissionControls() {
  syncObservationButtons();
  missionButtons.forEach(button => {
    const id = button.dataset.mission;
    const dated = isObservation(id);
    const index = dated ? observationIndex(id) : -1;
    button.disabled = switching || currentMission === null || (dated && (!pairState?.ready || !pairState.frames.has(id)));
    button.setAttribute('aria-pressed', String(id === currentMission));
    if (dated) {
      const exposure = selectedPair?.observations[index];
      button.textContent = exposure ? exposure.observedStart.slice(0, 10) : 'Observation';
      button.title = exposure ? `Observed ${exposure.observedStart}; coverage: ${exposure.coverage || 'not measured'}` : 'Draw a rectangle to load one available observation.';
    }
  });
  historyButton.hidden = regionMode!=='time' || !pairState?.ready;
  historyButton.disabled = switching || !!pairState?.pending || !!pairState?.historyPending || !!pairState?.historyExhausted;
  historyButton.textContent = pairState?.historyPending ? 'Loading earlier dates…' : pairState?.historyExhausted ? 'No earlier same-band dates' :
    pairState?.historyRetry ? 'Retry earlier dates' : (selectedPair?.observations.length || 0)>1 ? 'Load 10 more dates' : 'Load 10 earlier dates';
  updateFilmstrip();
  updateRegionControls();
  updateWavelengthControls();
  updateSpectrumControls();
}

function updateSourceDescription() {
  if(regionMode==='infrared' && spectrumState && comparisonActive && currentMission==='spherex'){
    const wavelength=skyWavelengths()[spectrumState.channel];
    const release=metadata.get('spherex').creator_did.match(/\/DR(\d+)\/cube$/i)?.[1];
    surveyCredit.textContent=`SPHEREx${release?` DR${release}`:''} · ${wavelength.toFixed(3)} µm · NASA/Caltech/IPAC`;
    surveyCredit.href=MISSIONS.spherex.link;surveyCredit.title='Selected region of the infrared sky mosaic; wavelength sequence, not a time sequence.';
  }else if (isObservation(currentMission)) {
    const exposure = selectedPair.observations[observationIndex(currentMission)];
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

async function switchMission(id, {fromPlayback=false}={}) {
  if(regionMode==='infrared' && comparisonActive && id!=='spherex')return false;
  if(!fromPlayback)stopPlayback();
  if (switching || !skyMap) return false;
  if (isObservation(id)) {
    if (!pairState?.ready || !pairState.frames.has(id)) return false;
    const state=pairState,region=selectedRegion;
    // Resident frames already share the locked camera/crop. Scrubbing changes
    // visibility synchronously; only re-entering the region needs a fresh fit.
    if(!comparisonActive)await enterComparison();
    else if(!regionMapElement.style.getPropertyValue('--region-clip'))await fitComparisonRegion();
    if (pairState!==state || selectedRegion!==region || !state.ready || !comparisonActive) return false;
    regionSurvey?.image?.setOpacity(0);
    pairState.frames.forEach((frame, key) => frame.image.setOpacity(key === id ? 1 : 0));
    currentMission = id;
    scrubbedObservationId = id;
    updateSourceDescription();
    updateMissionControls();
    await verifyImageDisplay(id);
    return true;
  }
  if (!MISSIONS[id]) return false;
  if (selectedRegion) return switchRegionSurvey(id);
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

async function switchRegionSurvey(id) {
  const region = selectedRegion;
  switching = true;
  updateMissionControls();
  try {
    await enterComparison();
    if (selectedRegion !== region || !comparisonActive) return false;
    status.hidden = false;
    status.textContent = `Loading ${MISSIONS[id].name} in the selected region…`;
    if (regionSurvey?.region !== region || regionSurvey.id !== id || !regionSurvey.image) {
      const properties = await getProperties(id);
      if (selectedRegion !== region || !comparisonActive) return false;
      const state = { region, id, image: null };
      regionSurvey = state;
      const image = await applyLayer(id, properties, comparisonMap, REGION_SURVEY_LAYER);
      state.image = image;
      if (regionSurvey !== state || selectedRegion !== region || !comparisonActive) return false;
    }
    await fitComparisonRegion();
    if (selectedRegion !== region || !comparisonActive) return false;
    pairState?.frames.forEach(frame => frame.image.setOpacity(0));
    regionSurvey.image.setOpacity(surveyOpacity(id));
    currentMission = id;
    updateSourceDescription();
    status.hidden = true;
    return true;
  } catch (error) {
    if (regionSurvey?.region === region && regionSurvey.id === id) {
      comparisonMap.removeImageLayer(REGION_SURVEY_LAYER);
      regionSurvey = null;
    }
    showError(error);
    return false;
  } finally {
    switching = false;
    if (selectedRegion !== region || !comparisonActive) status.hidden = true;
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
  // Standalone FITS readPixel is unimplemented in Aladin 3.8.2. Its null
  // results cannot tell us whether the image is visible or has coverage.
  observationLog('Aladin image display','frame',{requestId:frame.requestId || selectedPair.requestId,id,registered,opacity,
    size:[width,height],elapsedMs:Math.round(performance.now()-start),
    viewCenter:comparisonMap.getRaDec(),viewFov:comparisonMap.getFov(),
    imageCenter:[frame.image.ra,frame.image.dec],imageFov:frame.image.fov,
    cuts:frame.image.getCuts(),crop:regionMapElement.style.getPropertyValue('--region-clip')});
  if (!registered || opacity!==1) throw new Error(`Aladin display failed for ${id}: registered=${registered}, opacity=${opacity}.`);
}

function leaveComparison() {
  stopSpectrum();
  if(spectrumState?.preparing)spectrumState.controller.abort(new Error('Return to Infrared to finish preparing the spectrum.'));
  spectrumCanvas.hidden=true;
  stopPlayback();
  const wasActive = comparisonActive;
  comparisonActive = false;
  regionView.hidden = true;
  document.body.classList.remove('region-comparison');
  document.getElementById('sky-map').inert = false;
  if (wasActive || isObservation(currentMission)) currentMission = baseMission;
  coordinateFields.disabled = !skyMap;
  backToSkyButton.hidden = true;
  updateFilmstrip();
  updateSpectrumControls();
  clearCursorCoordinates();
}

async function enterComparison() {
  if (!selectedRegion) return;
  if (comparisonActive && comparisonMap) return;
  const region = selectedRegion;
  regionView.hidden = false;
  comparisonActive = true;
  updateSpectrumControls();
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
  await fitComparisonRegion();
  updateRegionControls();
}

function enforceRegionLayers() {
  // Aladin may restore a default background after a failed first FITS load.
  // Keep only the selected region's observation and explicitly chosen survey.
  const allowed = new Set([...(pairState?.frames.values() || [])].map(frame => frame.layer));
  if (regionSurvey) allowed.add(REGION_SURVEY_LAYER);
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
  stopSpectrum();
  if(spectrumState?.preparing){
    spectrumState.controller.abort(new Error('The view resized. Prepare the spectrum again.'));
    disposeSpectrumFrames(spectrumState.frames);
  }
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    if (comparisonActive && selectedRegion) {
      sizeComparisonFrame();
      void fitComparisonRegion().catch(showError);
    }
  });
}

let regionFitSequence = 0;
const afterRenderFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function fitComparisonRegion() {
  if (!comparisonMap || !selectedRegion || !comparisonActive) return;
  const sequence = ++regionFitSequence;
  const region = selectedRegion;
  const valid = () => sequence === regionFitSequence && selectedRegion === region && comparisonActive;
  const { position: { ra, dec }, corners, rotation } = region;
  comparisonMap.gotoRaDec(ra, dec);
  // Version 3.8.2 treats zero as an absent rotation; 360 is equivalent to zero.
  comparisonMap.setRotation(rotation || 360);
  let fov = region.sizeDegrees;
  comparisonMap.setFoV(fov);
  await afterRenderFrame();
  if (!valid()) return;
  const [width, height] = comparisonMap.getSize();
  if (!(width > 0 && height > 0)) throw new Error('The region viewer has no drawing area.');
  for (let i = 0; i < 3; i++) {
    const pixels = corners.map(([lon, lat]) => comparisonMap.world2pix(lon, lat));
    if (pixels.some(p => !p || p.some(n => !Number.isFinite(n)))) throw new Error('The selected region could not be projected into the viewer.');
    const scale = Math.max(...pixels.map(([x, y]) => Math.max(Math.abs(x-width/2)/(width/2), Math.abs(y-height/2)/(height/2))));
    if (!(scale > 0 && Number.isFinite(scale))) throw new Error('The selected region has invalid projected bounds.');
    fov = 2 * Math.atan(Math.tan(fov*Math.PI/360) * scale * 1.002) * 180/Math.PI;
    comparisonMap.setFoV(fov);
    await afterRenderFrame();
    if (!valid()) return;
  }
  const pixels = corners.map(([lon, lat]) => comparisonMap.world2pix(lon, lat));
  if (pixels.some(p => !p || p.some(n => !Number.isFinite(n)))) throw new Error('The selected region crop could not be calculated.');
  regionMapElement.style.setProperty('--region-clip', `polygon(${pixels.map(([x,y]) => `${x}px ${y}px`).join(',')})`);
}

function discardPreparedObservations() {
  stopPlayback();
  const state = pairState;
  pairState = null;
  selectedPair = null;
  scrubbedObservationId = null;
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
  const requestId=exposure.requestId || state.requestId;
  observationLog('Browser FITS decoding','start',{requestId,id,url:diagnosticUrl(blobUrl),date:exposure.observedStart});
  return new Promise((resolve,reject)=>{
    state.frameSequence=(state.frameSequence || 0)+1;
    const layer=`planetx-pair-${state.sequence}-${id}-${state.frameSequence}`;
    let settled=false,phase='Browser FITS decoding',image;
    const timer=setTimeout(()=>fail(new Error(`${phase} timed out after 90 seconds for ${exposure.observedStart}.`)),90000);
    const cancel=()=>fail(new Error('Observation loading cancelled.'));
    const cleanup=()=>{clearTimeout(timer);state.controller.signal.removeEventListener('abort',cancel);};
    const fail=error=>{
      if (settled) return;
      settled=true;cleanup();
      observationLog(phase,'error',{requestId,id,elapsedMs:Math.round(performance.now()-start),exception:{name:error?.name,message:error?.message || String(error)}});
      reject(error);
    };
    state.controller.signal.addEventListener('abort',cancel,{once:true});
    try {
      image=A.image(blobUrl,{
        // Single-image searches accept any detector. Let Aladin calculate cuts
        // from these pixels rather than forcing every band into a 0–40 range.
        name:`SPHEREx ${exposure.observedStart}`,imgFormat:'fits',opacity:1,
        successCallback:(ra,dec,fov)=>{
          if (settled || pairState!==state || state.controller.signal.aborted) {
            setTimeout(()=>comparisonMap.removeImageLayer(layer),0);fail(new Error('Observation loading cancelled.'));return;
          }
          // A registered layer can still be on the wrong part of the sky.
          // Compare against the requested cutout, never move the camera to hide
          // a WCS error. Allow generous room for rotation and partial cutouts.
          const expected = [state.region.position.ra,state.region.position.dec];
          const separation = angularSeparationDegrees(expected,[ra,dec]);
          const maximum = 2 * Math.max(state.region.sizeDegrees,Number.isFinite(fov) ? Math.abs(fov) : 0);
          observationLog('FITS sky placement','check',{requestId,id,
            expectedCenter:expected,imageCenter:[ra,dec],separationDegrees:separation,maximumDegrees:maximum});
          if (![ra,dec,fov,separation].every(Number.isFinite) || Math.abs(dec)>90 || fov<=0 || separation>maximum) {
            fail(new Error(`FITS coordinate mismatch: decoded image center RA ${ra}, Dec ${dec} is ${separation.toFixed(3)}° from the selected region. The observation cannot be displayed at these coordinates.`));
            return;
          }
          image.setOpacity(0);
          observationLog(phase,'complete',{requestId,id,elapsedMs:Math.round(performance.now()-start),imageCenter:[ra,dec],imageFov:fov,cuts:image.getCuts()});
          phase='Aladin image registration';
          const waitForRegistration=()=>{
            if (settled || pairState!==state || state.controller.signal.aborted) { comparisonMap.removeImageLayer(layer);fail(new Error('Observation loading cancelled.'));return; }
            if (comparisonMap.getOverlayImageLayer(layer)!==image) { setTimeout(waitForRegistration,16);return; }
            settled=true;cleanup();
            observationLog(phase,'complete',{requestId,id,elapsedMs:Math.round(performance.now()-start),layer});resolve();
          };
          setTimeout(waitForRegistration,0);
        },errorCallback:fail
      });
      state.frames.set(id,{image,layer,requestId});comparisonMap.setOverlayImageLayer(image,layer);
    } catch(error) { fail(error); }
  });
}

function updateRegionControls() {
  drawRegionButton.disabled = !skyMap || currentMission === null || switching;
  drawRegionButton.textContent = drawingRegion ? 'Cancel drawing' : 'Draw rectangle';
  drawRegionButton.setAttribute('aria-pressed', String(drawingRegion));
  clearRegionButton.hidden = !selectedRegion;
  loadObservationButton.disabled = !selectedRegion || selectedRegion.sizeDegrees>1 || drawingRegion || switching || !!pairState?.pending || !!pairState?.historyPending;
  loadObservationButton.textContent = pairState?.pending ? 'Loading observation…' : 'Load one observation';
  loadObservationButton.hidden=regionMode!=='time';
  loadSpectrumButton.hidden=regionMode!=='infrared';
  loadSpectrumButton.disabled=!selectedRegion || drawingRegion || switching || !!spectrumState?.preparing;
  loadSpectrumButton.textContent=spectrumState?.preparing?'Preparing spectrum…':'Explore infrared';
  regionModeFields.disabled=switching || !!pairState?.pending || !!pairState?.historyPending;
  regionModeTime.checked=regionMode==='time';regionModeInfrared.checked=regionMode==='infrared';
  updateSpectrumRangeControls();
}

function regionSelectionHint() {
  return regionMode==='infrared'?'Drag a rectangle to explore its infrared spectrum. Large sky regions are supported.':
    'Zoom in, then drag a rectangle that fits within 1° for Time mode.';
}

function clearSelectedRegion() {
  discardSpectrum();
  selectionSequence += 1;
  if (drawingRegion) { skyMap.fire('default'); skyMap.showReticle(false); }
  drawingRegion = false;
  leaveComparison();
  discardPreparedObservations();
  if (regionSurvey) comparisonMap.removeImageLayer(REGION_SURVEY_LAYER);
  regionSurvey = null;
  selectedRegion = null;
  regionOverlay?.removeAll();
  regionOverlay?.hide();
  preloadProgress.hidden = true;
  regionResult.textContent = regionSelectionHint();
  updateMissionControls();
}

async function startRegionSelection() {
  if (!skyMap || switching) return;
  if (drawingRegion) { clearSelectedRegion(); return; }
  clearSelectedRegion();
  const sequence = ++selectionSequence;
  drawingRegion = true;
  regionResult.textContent = `Drag a rectangle, then release to explore ${regionMode==='infrared'?'its infrared spectrum':'dated observations'}. Escape cancels.`;
  updateRegionControls();
  try {
    await skyMap.select('rect', async rect => {
      if (sequence !== selectionSequence) return;
      drawingRegion = false;
      setTimeout(() => skyMap.showReticle(false), 0);
      try {
        selectedRegion = {
          ...regionFromRectangle(rect, (...args) => skyMap.pix2world(...args),{maxSizeDegrees:regionMode==='infrared'?170:1}),
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
        if (sequence === selectionSequence && selectedRegion) {
          if(regionMode==='infrared')void loadSelectedSpectrum();else void loadSelectedObservations();
        }
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
  if (regionMode!=='time' || !selectedRegion || selectedRegion.sizeDegrees>1 || drawingRegion || switching || pairState?.pending) return false;
  const region = selectedRegion;
  await enterComparison();
  if (selectedRegion !== region || !comparisonActive) return false;
  discardPreparedObservations();
  const state = { sequence: ++preloadSequence, region, controller: new AbortController(), frames: new Map(), blobUrls: [], pending:true, ready:false };
  pairState = state;
  preloadProgress.hidden = false;
  preloadProgress.textContent = 'Finding the newest usable SPHEREx image returned for this region…';
  updateMissionControls();
  let step = 'Observation search';
  try {
    const query=new URLSearchParams({corners:JSON.stringify(region.corners),mode:'single'});
    const url=`/api/spherex/observations?${query}`;
    const started=performance.now();
    observationLog(step,'start',{url:diagnosticUrl(url),mode:'single'});
    const response=await fetch(url,{signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(105000)])});
    observationLog(step,'headers',{url:diagnosticUrl(url),status:response.status,elapsedMs:Math.round(performance.now()-started)});
    const result=await readArchiveResponse(response,step);
    state.requestId=result.requestId;
    observationLog(step,'complete',{requestId:state.requestId,status:response.status,elapsedMs:Math.round(performance.now()-started),recordCount:result.recordCount,searchLimited:result.searchLimited});
    if (pairState!==state || state.controller.signal.aborted) return false;
    if (!Array.isArray(result.observations) || result.observations.length!==1 ||
      !result.observations[0].cutoutUrl || !result.observations[0].observedStart) throw new Error('The archive did not return one usable observation.');
    for (const [index,exposure] of result.observations.entries()) {
      const date=exposure.observedStart.slice(0,10);
      step=`Image download for ${date}`;
      preloadProgress.textContent=`Loading observation · ${date}…`;
      if (exposure.downloadUrl) console.info('[Planet X] Original image URL:', diagnosticUrl(exposure.downloadUrl));
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
      preloadProgress.textContent=`Preparing observation · ${date}…`;
      await prepareResidentImage(state,`observation-${index}`,exposure,blobUrl);
      attachObservationPreview(state,`observation-${index}`,bytes);
    }
    if (pairState !== state || state.controller.signal.aborted) return false;
    selectedPair = result;
    state.ready = true;
    enforceRegionLayers();
    // Do not reopen a comparison the user left while the files were loading.
    step = 'Aladin image display';
    if (comparisonActive) await switchMission('observation-0');
    if (pairState !== state || state.controller.signal.aborted) return false;
    preloadProgress.textContent = `Observation ready · ${result.observations[0].observedStart.slice(0,10)} UTC · ${result.observations[0].band} · ${result.observations[0].coverage==='full'?'full footprint coverage':'partial coverage possible'}`+
      (result.searchLimited?' · Search capped; newer images may exist.':'');
    return true;
  } catch (error) {
    state.ready = false;
    state.controller.abort();
    state.frames.forEach(frame => comparisonMap.removeImageLayer(frame.layer));
    state.blobUrls.forEach(url => URL.revokeObjectURL(url));
    state.frames.clear(); state.blobUrls = [];
    if (pairState === state) {
      if (isObservation(currentMission)) currentMission = baseMission;
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

async function loadEarlierObservations({newer=false}={}) {
  const state=pairState, selection=selectedPair;
  if (regionMode!=='time' || !selectedRegion || !state?.ready || state.pending || state.historyPending || (!newer && state.historyExhausted) || switching) return false;
  const anchor=newer?(state.newerAnchor || selection.observations.reduce((latest,exposure)=>
    Date.parse(exposure.observedStart)>Date.parse(latest.observedStart)?exposure:latest)):
    (state.historyAnchor || selection.observations[isObservation(currentMission)?observationIndex(currentMission):0]);
  if(newer)state.newerAnchor=anchor;else state.historyAnchor=anchor;
  state.historyPending=true;
  preloadProgress.hidden=false;
  preloadProgress.textContent=`Finding up to 10 dates ${newer?'after':'before'} ${anchor.observedStart.slice(0,10)} UTC · ${anchor.band}…`;
  updateMissionControls();
  try {
    const query=new URLSearchParams({corners:JSON.stringify(state.region.corners),mode:newer?'newer':'history',
      [newer?'after':'before']:anchor.observedStart,band:anchor.band,limit:'10'});
    const response=await fetch(`/api/spherex/observations?${query}`,{
      signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(105000)])});
    const result=await readArchiveResponse(response,newer?'Newer-date search':'Earlier-date search');
    if (pairState!==state || state.controller.signal.aborted) return false;
    if (!Array.isArray(result.observations) || result.observations.length>10 || result.observations.some(exposure=>
      !exposure.cutoutUrl || !Number.isFinite(Date.parse(exposure.observedStart)) || exposure.band!==anchor.band ||
      (newer?exposure.observedStart.slice(0,10)<=anchor.observedStart.slice(0,10):exposure.observedStart.slice(0,10)>=anchor.observedStart.slice(0,10)))) {
      throw new Error('The archive returned observations outside the requested dates.');
    }
    const dates=new Set(selection.observations.map(exposure=>exposure.observedStart.slice(0,10)));
    const candidates=result.observations.filter(exposure=>!dates.has(exposure.observedStart.slice(0,10)));
    const failures=[];
    for (const [offset,exposure] of candidates.entries()) {
      if (pairState!==state || state.controller.signal.aborted) return false;
      const date=exposure.observedStart.slice(0,10);
      if (dates.has(date)) continue;
      const id=`observation-${selection.observations.length}`,blobCount=state.blobUrls.length;
      try {
        preloadProgress.textContent=`Loading ${newer?'newer':'earlier'} date ${offset+1}/${candidates.length} · ${date} UTC…`;
        observationLog('Earlier image download','start',{requestId:result.requestId,date,url:diagnosticUrl(exposure.cutoutUrl),originalUrl:exposure.downloadUrl});
        const cutout=await fetch(exposure.cutoutUrl,{
          signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(105000)])});
        if (!cutout.ok) await readArchiveResponse(cutout,`Image download for ${date}`);
        const bytes=await cutout.arrayBuffer();
        observationLog('Earlier image download','complete',{requestId:result.requestId,date,status:cutout.status,byteSize:bytes.byteLength,
          pixelSha256:cutout.headers.get('x-planetx-pixel-sha256')});
        if (new TextDecoder().decode(new Uint8Array(bytes,0,Math.min(8,bytes.byteLength)))!=='SIMPLE  ') {
          throw new Error(`The ${date} response is not a FITS image.`);
        }
        if (pairState!==state || state.controller.signal.aborted) return false;
        const blobUrl=URL.createObjectURL(new Blob([bytes],{type:'application/fits'}));
        state.blobUrls.push(blobUrl);
        const dated={...exposure,requestId:result.requestId};
        await prepareResidentImage(state,id,dated,blobUrl);
        if (pairState!==state || state.controller.signal.aborted) return false;
        attachObservationPreview(state,id,bytes);
        selection.observations.push(dated);dates.add(date);
        updateMissionControls();
      } catch(error) {
        const frame=state.frames.get(id);
        if (frame) comparisonMap.removeImageLayer(frame.layer);
        state.frames.delete(id);
        state.blobUrls.splice(blobCount).forEach(url=>URL.revokeObjectURL(url));
        if (pairState!==state || state.controller.signal.aborted) return false;
        failures.push(date);
        observationLog('Earlier observation','error',{requestId:result.requestId,date,message:error.message});
      }
    }
    if (pairState!==state || state.controller.signal.aborted) return false;
    if(!newer)state.historyRetry=failures.length>0;
    if(newer && !failures.length)state.newerAnchor=null;
    if(!newer && !failures.length){
      // Advance only after this batch is complete. A retry keeps its original
      // anchor so a failed date is not skipped when looking farther back.
      const oldest=result.observations.reduce((earliest,exposure)=>
        Date.parse(exposure.observedStart)<Date.parse(earliest.observedStart)?exposure:earliest,anchor);
      state.historyAnchor=oldest;
      state.historyExhausted=!result.searchLimited && result.observations.length<10;
    }
    const count=selection.observations.length-1;
    preloadProgress.textContent=`${count} additional date${count===1?'':'s'} loaded · ${anchor.band} · checked ${newer?'after':'before'} ${anchor.observedStart.slice(0,10)} UTC`+
      (result.searchSummary?` · This search: ${result.searchSummary.matchingExposures} exposures across ${result.searchSummary.matchingDates} UTC dates.`:'')+
      (failures.length?(newer?` · ${failures.length} failed; retrying at the next daily check.`:` · ${failures.length} failed; use Retry earlier dates.`):'')+
      (!newer && state.historyExhausted?' · No earlier same-band dates remaining.':'')+
      (result.searchLimited?' · Search capped; more dates may exist.':'');
    return true;
  } catch(error) {
    if (pairState===state && !state.controller.signal.aborted) {
      if(!newer)state.historyRetry=true;
      preloadProgress.textContent=`${newer?'Newer':'Earlier'} dates unavailable: ${error.message}. The loaded observation is still available.`;
      observationLog('Earlier-date search','error',{message:error.message});
    }
    return false;
  } finally {
    state.historyPending=false;
    if (pairState===state) updateMissionControls();
  }
}

drawRegionButton.addEventListener('click', startRegionSelection);
historyButton.addEventListener('click', loadEarlierObservations);
filmstripPlay.addEventListener('click',togglePlayback);
observationScrubber.addEventListener('input',scrubObservation);
observationScrubber.addEventListener('pointerdown',stopPlayback);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopPlayback();stopSpectrum();}
  else if(Date.now()-lastUpdateCheck>=86400000)void checkForDataUpdates();
});
window.setInterval(()=>{if(!document.hidden)void checkForDataUpdates();},86400000);
clearRegionButton.addEventListener('click', clearSelectedRegion);
loadObservationButton.addEventListener('click', loadSelectedObservations);
loadSpectrumButton.addEventListener('click',()=>{void loadSelectedSpectrum().catch(showError);});
regionModeTime.addEventListener('change',()=>{if(regionModeTime.checked)void chooseRegionMode('time').catch(showError);});
regionModeInfrared.addEventListener('change',()=>{if(regionModeInfrared.checked)void chooseRegionMode('infrared').catch(showError);});
spectrumPlay.addEventListener('click',toggleSpectrum);
spectrumScrubber.addEventListener('input',()=>{selectSpectrumChannel(Number(spectrumScrubber.value));});
spectrumScrubber.addEventListener('pointerdown',stopSpectrum);
spectrumRangeFrom.addEventListener('change',changeSpectrumRange);
spectrumRangeTo.addEventListener('change',changeSpectrumRange);
prepareSpectrumRange.addEventListener('click',()=>{void loadSelectedSpectrum().catch(showError);});
backToSkyButton.addEventListener('click', () => {
  leaveComparison();updateSourceDescription();updateMissionControls();
  if(deferredSurveyUpdate)void checkForDataUpdates();
});
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
  if(event.target===observationScrubber || event.target===spectrumScrubber)return;
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
