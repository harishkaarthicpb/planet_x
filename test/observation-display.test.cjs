const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { angularSeparationDegrees,regionFromRectangle } = require('../sky-region.mjs');
const { sampleFitsPreview } = require('../fits-preview.mjs');
const {spectrumFrameSize,bufferSpectrumFrames,disposeSpectrumFrames,paintSpectrumFrame}=require('../spectrum-buffer.mjs');
const {blankCubeChannels}=require('../hips-cube-tiles.mjs');

// Exercise the browser controller without a live archive or WebGL context.
function browserController({ invalidProjection = false, displayFails = false, imageCenter = [60,50], history=[], failHistoryDate=null, historyGate=null, historySearchFails=false,clock=performance,
  newerHistory=[],releaseData=null,releaseFails=false,failSurveyUrl=null,largeRectangle=false,spectrumGate=null,spectrumCaptureFailure=null } = {}) {
  const elements = new Map();
  const requests=[];
  const documentEvents={};
  const intervals=[],baseLayers=[];
  const captures=[],canvasDraws=[];
  const classes=()=>{const set=new Set();return {add:value=>set.add(value),remove:value=>set.delete(value),contains:value=>set.has(value),toggle(value,on){if(on)set.add(value);else set.delete(value);}};};
  let elementSequence=0;
  const element = id => {
    if (!elements.has(id)) {
      const properties = new Map();
      const attributes=new Map(),listeners={},captures=new Set();
      elements.set(id, { hidden: false, textContent: '',
        dataset:{},children:[],classList:classes(),listeners,
        append(child){this.children.push(child);},replaceChildren(){this.children=[];},
        remove(){},insertBefore(){},addEventListener(name,callback){listeners[name]=callback;},
        setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),
        setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
        getBoundingClientRect:()=>({left:0,width:400}),
        getContext:()=>({drawImage:frame=>canvasDraws.push(frame),fillRect(){}}),
        style: { setProperty: (k,v) => properties.set(k,v), getPropertyValue: k => properties.get(k) || '' }
      });
    }
    return elements.get(id);
  };
  let fov = 1, pendingFov = null, options, fits=0;
  const layers = new Map();
  const map = {
    view:{wasm:{isRendering:()=>false}},
    select:async(type,callback)=>callback({x:150,y:150,w:100,h:100}),
    pix2world:(x,y)=>[60+(x-200)*(largeRectangle ? .2 : .001),50+(y-200)*(largeRectangle ? .2 : .001)],
    getRotation:()=>0,addOverlay(){},showReticle(){},fire(){},
    setBaseImageLayer(image){baseLayers.push(image);setImmediate(()=>image.load());},
    gotoRaDec() {}, setRotation() {}, setFoV(value) { pendingFov = value;fits++; },
    getSize: () => [400,400], getRaDec: () => [60,50], getFov: () => [fov,fov],
    world2pix: (ra,dec) => invalidProjection ? null : [200+(ra-60)*400/fov, 200+(dec-50)*400/fov],
    getOverlayImageLayer: id => displayFails && context.controller.state()?.ready ? undefined : layers.get(id),
    setOverlayImageLayer(image,id) {
      layers.set(id,image);
      setImmediate(() => image.load());
    },
    removeImageLayer: id => layers.delete(id), getStackLayers: () => [...layers.keys()]
  };
  const context = vm.createContext({
    console: { info() {}, error() {} }, performance:clock, setTimeout, clearTimeout, angularSeparationDegrees,regionFromRectangle,sampleFitsPreview,
    spectrumFrameSize,bufferSpectrumFrames,disposeSpectrumFrames,paintSpectrumFrame,
    registerCubeTileRoot(){},blankCubeChannels,
    observeSurveyTiles:()=>({pending:0,activity:0,failures:[],dispose(){}}),
    waitForSurveyTiles:async(tracker,{signal})=>{
      if(spectrumGate){spectrumGate.started=true;await spectrumGate.promise;}
      signal.throwIfAborted();
    },
    captureSpectrumFrame:async(viewer,size)=>{
      if(spectrumCaptureFailure?.(captures.length))throw new Error('Spectrum capture failed.');
      const frame={...size,closed:false,close(){this.closed=true;}};captures.push(frame);return frame;
    },
    captureBlankSpectrumFrame:async(size,wavelength)=>{
      const frame={...size,blank:true,wavelength,closed:false,close(){this.closed=true;}};captures.push(frame);return frame;
    },
    AbortController, AbortSignal, URL, URLSearchParams, Blob, TextDecoder, Uint8Array,
    requestAnimationFrame(callback) {
      return setImmediate(() => { if (pendingFov !== null) { fov = pendingFov; pendingFov = null; } callback(clock.now()); });
    },
    cancelAnimationFrame:clearImmediate,
    document: { getElementById: element,createElement:()=>element(`generated-${++elementSequence}`), querySelectorAll: () => [], addEventListener(name,callback){documentEvents[name]=callback;},
      body: { classList:classes() } },
    window: { addEventListener() {},setInterval(callback,milliseconds){intervals.push({callback,milliseconds});}, innerWidth:400,innerHeight:400,location: { href: 'http://localhost/' } },
    fetch: async url => {
      requests.push(String(url));
      if(String(url).includes('/api/spherex/release'))return releaseFails?
        {ok:false,status:503,json:async()=>({error:'Release check unavailable'})}:
        {ok:true,status:200,json:async()=>releaseData || publishedRelease()};
      if(String(url).includes('mode=newer'))return {ok:true,status:200,json:async()=>({requestId:'newer',observations:typeof newerHistory==='function'?newerHistory(String(url)):newerHistory})};
      if (String(url).includes('mode=history')) return historySearchFails
        ? {ok:false,status:502,json:async()=>({error:'History search failed'})}
        : {ok:true,status:200,json:async()=>({requestId:'history',observations:typeof history==='function'?history(String(url)):history})};
      if (String(url).includes('/older/') && historyGate) {historyGate.started=true;await historyGate.promise;}
      if (failHistoryDate && (typeof failHistoryDate==='function'?failHistoryDate(String(url)):String(url).includes(failHistoryDate))) return {ok:false,status:502,json:async()=>({error:'Image download failed'})};
      return String(url).includes('/observations?')
      ? { ok:true, status:200, json:async () => ({requestId:'test',observations:[{
        observedStart:'2026-08-25T07:03:31Z', band:'SPHEREx-D2',cutoutUrl:'/cutout',coverage:'full'
      }]}) }
      : { ok:true, status:200, headers:new Headers(), arrayBuffer:async () => new TextEncoder().encode('SIMPLE  ').buffer };
    },
    testMap: map,
    testA: { graphicOverlay:()=>({removeAll(){},addFootprints(){},show(){},hide(){}}),polygon:corners=>corners,
      HiPS(url,configuration) {
      let opacity=1;
      const hips={url,configuration,frequencies:[],setOpacity(value){opacity=value;},getOpacity:()=>opacity,setFrequency(value){this.frequencies.push(value);},
        load:()=>failSurveyUrl && url.includes(failSurveyUrl)?configuration.errorCallback(new Error('Map load failed')):configuration.successCallback(hips)};
      return hips;
    }, image(url,configuration) {
      options = configuration;
      let opacity = configuration.opacity;
      return { setOpacity(value) { opacity=value; }, getOpacity: () => opacity,
        getCuts: () => [140,180], ra:60,dec:50,fov:.2,load:()=>configuration.successCallback(...imageCenter,.2) };
    } }
  });
  const source = fs.readFileSync(require.resolve('../script.js'),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/\bexport /g,'').replace('loadSky().catch(showError);','');
  vm.runInContext(source + `
    A = testA; skyMap = testMap; comparisonMap = testMap; comparisonActive = true;
    currentMission = baseMission = 'spherex';
    selectedRegion = {position:{ra:60,dec:50},corners:[[59.9,49.9],[60.1,49.9],[60.1,50.1],[59.9,50.1]],sizeDegrees:.3,rotation:0,aspect:1};
    metadata.set('spherex',{hips_cube_depth:'100',em_min:'1e-6',em_max:'5e-6'});
    metadata.set('gaia',{});
    globalThis.controller = { fitComparisonRegion, loadSelectedObservations,loadEarlierObservations, switchMission, clearSelectedRegion,observationTimeline,scrubObservation,togglePlayback,stopPlayback,
      checkForDataUpdates,updating:()=>checkingUpdates,survey:()=>({...MISSIONS.spherex,channelIndex:CHANNEL_INDEX}),
      initializeSurvey:async survey=>{configureSpherexSurvey(survey);await applyLayer('spherex',survey.properties);currentMission=baseMission='spherex';leaveComparison();updateMissionControls();},
      chooseRegionMode,startRegionSelection,loadSelectedSpectrum,selectSpectrumChannel,toggleSpectrum,stopSpectrum,spectrum:()=>spectrumState,regionMode:()=>regionMode,
      playing:()=>!!playback,
      buttons:()=>missionButtons,
      active: () => comparisonActive, mission: () => currentMission,
      cancel: () => { comparisonActive=false; selectedRegion=null; },
      state: () => pairState };
  `,context);
  return { controller:context.controller, element, options:() => options, layers,requests,fits:()=>fits,document:context.document,documentEvents,intervals,baseLayers,
    captures,canvasDraws,setRendering:value=>{map.view.wasm.isRendering=()=>value;} };
}

function wavelengthSurvey(release=1){
  const survey=publishedRelease(release).survey;
  // Includes nonuniform spacing, so labels must follow metadata rather than
  // interpolate across the infrared range.
  survey.properties={...survey.properties,hips_cube_depth:'102',em_min:'7.43e-7',em_max:'5.009e-6',
    data_cube_crval3_arr:Array.from({length:102},(_,i)=>i===62?'3.293':(.753+4.235*(i/101)**1.1).toFixed(3)).join(' ')};
  survey.channelIndex=62;return survey;
}

test('sky wavelength slider selects all 102 cube planes without replacing the layer or moving the camera',async()=>{
  const browser=browserController(),survey=wavelengthSurvey();
  await browser.controller.initializeSurvey(survey);
  const slider=browser.element('wavelength-slider'),image=browser.baseLayers.at(-1),fits=browser.fits(),requests=browser.requests.length;
  assert.equal(browser.element('wavelength-panel').hidden,false);
  assert.equal(slider.max,'101');assert.equal(slider.value,'62');
  assert.equal(browser.element('wavelength-value').textContent,'3.293 µm');
  for(let channel=0;channel<102;channel++){
    slider.value=String(channel);slider.listeners.input();slider.listeners.change();
    const {value,unit}=image.frequencies.at(-1);
    const low=299792458/Number(survey.properties.em_max),high=299792458/Number(survey.properties.em_min);
    assert.equal(unit,'Hz');
    assert.equal(Math.floor((value-low)/(high-low)*102),channel);
  }
  assert.equal(browser.element('wavelength-value').textContent,'4.988 µm');
  assert.match(slider.getAttribute('aria-valuetext'),/band 102 of 102/);
  assert.equal(browser.baseLayers.length,1);
  assert.equal(browser.fits(),fits);
  assert.equal(browser.requests.length,requests);
  assert.match(browser.element('survey-credit').textContent,/4.988 µm/);
});

test('rapid wavelength input commits only the latest band and ignores invalid indices',async()=>{
  const browser=browserController();await browser.controller.initializeSurvey(wavelengthSurvey());
  const slider=browser.element('wavelength-slider'),image=browser.baseLayers.at(-1),count=image.frequencies.length;
  for(const value of ['10','20','30']){slider.value=value;slider.listeners.input();}
  assert.equal(image.frequencies.length,count);
  slider.listeners.change();
  assert.equal(image.frequencies.length,count+1);
  assert.equal(browser.controller.survey().channelIndex,30);
  slider.value='102';slider.listeners.input();slider.listeners.change();
  assert.equal(image.frequencies.length,count+1);
});

test('wavelength selection survives Gaia and stays independent of dated observations',async()=>{
  const browser=browserController();await browser.controller.initializeSurvey(wavelengthSurvey());
  const slider=browser.element('wavelength-slider');slider.value='10';slider.listeners.input();slider.listeners.change();
  // No region: use whole-sky source changes for this part of the test.
  browser.controller.cancel();
  await browser.controller.switchMission('gaia');
  assert.equal(browser.element('wavelength-panel').hidden,true);
  await browser.controller.switchMission('spherex');
  assert.equal(browser.element('wavelength-panel').hidden,false);
  assert.equal(slider.value,'10');
  // A fresh region still fetches observations without a wavelength constraint.
  const regionBrowser=browserController();await regionBrowser.controller.initializeSurvey(wavelengthSurvey());
  const regionSlider=regionBrowser.element('wavelength-slider');regionSlider.value='20';regionSlider.listeners.input();regionSlider.listeners.change();
  await regionBrowser.controller.loadSelectedObservations();
  assert.equal(regionBrowser.element('wavelength-panel').hidden,true);
  assert.equal(regionBrowser.controller.survey().channelIndex,20);
  const query=new URL(regionBrowser.requests.find(url=>url.includes('/observations?')),'http://localhost').searchParams;
  assert.equal(query.has('wavelength'),false);assert.equal(query.has('band'),false);
  assert.equal(regionBrowser.controller.state().frames.get('observation-0').image.getOpacity(),1);
});

test('a compatible release upgrade preserves the chosen sky wavelength',async()=>{
  const browser=browserController({releaseData:{...publishedRelease(2),survey:wavelengthSurvey(2)}});
  await browser.controller.initializeSurvey(wavelengthSurvey());
  const slider=browser.element('wavelength-slider');slider.value='90';slider.listeners.input();slider.listeners.change();
  const label=browser.element('wavelength-value').textContent;
  await browser.controller.checkForDataUpdates();
  assert.match(browser.controller.survey().name,/DR2/);
  assert.equal(browser.controller.survey().channelIndex,90);
  assert.equal(browser.element('wavelength-value').textContent,label);
});

test('rectangle infrared mode uses the locked mosaic and never searches for dated observations',async()=>{
  const browser=browserController();await browser.controller.initializeSurvey(wavelengthSurvey());
  assert.equal(await browser.controller.chooseRegionMode('infrared'),true);
  assert.equal(browser.controller.regionMode(),'infrared');
  assert.equal(browser.controller.state(),null);
  assert.equal(browser.element('spectrum-player').hidden,false);
  assert.equal(browser.element('observation-filmstrip').hidden,true);
  assert.equal(browser.element('wavelength-panel').hidden,true);
  assert.equal(browser.element('load-observation').hidden,true);
  assert.equal(browser.element('load-spectrum').hidden,false);
  assert.equal(browser.element('spectrum-bands').children.length,102);
  assert.equal(browser.requests.length,0);
  const crop=browser.element('region-map').style.getPropertyValue('--region-clip'),fits=browser.fits(),image=browser.controller.spectrum().image;
  for(const channel of [0,30,62,101])assert.equal(browser.controller.selectSpectrumChannel(channel),true);
  assert.equal(browser.controller.spectrum().image,image);
  assert.equal(browser.controller.spectrum().channel,101);
  assert.equal(browser.controller.survey().channelIndex,62,'The whole-sky selection remains independent');
  assert.match(browser.element('survey-credit').textContent,/4.988 µm/);
  assert.equal(browser.element('region-map').style.getPropertyValue('--region-clip'),crop);
  assert.equal(browser.fits(),fits);assert.equal(browser.requests.length,0);
  assert.equal(await browser.controller.loadSelectedObservations(),false);
  assert.equal(await browser.controller.loadEarlierObservations(),false);
  assert.equal(await browser.controller.switchMission('gaia'),false);
});

test('live and buffered SPHEREx layers use the same display transfer and colour settings',async()=>{
  const browser=browserController();await browser.controller.initializeSurvey(wavelengthSurvey());
  const live=browser.baseLayers.at(-1).configuration;
  await browser.controller.chooseRegionMode('infrared');
  const region=browser.controller.spectrum().image.configuration;
  for(const key of ['imgFormat','colormap','stretch','minCut','maxCut','reversed','gamma','brightness','contrast','saturation','additive']){
    assert.equal(region[key],live[key],key);
  }
  assert.equal(region.minCut,0);assert.equal(region.maxCut,255);assert.equal(region.additive,false);
});

test('Play remains disabled until every spectrum frame has been buffered',async()=>{
  let release;const gate={promise:new Promise(resolve=>{release=resolve;})};
  const browser=browserController({spectrumGate:gate});await browser.controller.initializeSurvey(wavelengthSurvey());
  const loading=browser.controller.chooseRegionMode('infrared');
  while(!gate.started)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(browser.controller.spectrum().preparing,true);
  assert.equal(browser.element('spectrum-loading').hidden,false);
  assert.equal(browser.element('spectrum-loading-progress').max,102);
  assert.equal(browser.element('spectrum-loading-progress').value,0);
  assert.match(browser.element('spectrum-loading-count').textContent,/0 of 102/);
  assert.equal(browser.element('spectrum-play').disabled,true);
  assert.equal(browser.element('spectrum-scrubber').disabled,true);
  browser.controller.toggleSpectrum();assert.equal(browser.controller.spectrum().playing,false);
  assert.match(browser.element('spectrum-help').textContent,/0\/102 wavelengths buffered/);
  release();await loading;
  assert.equal(browser.controller.spectrum().ready,true);
  assert.equal(browser.element('spectrum-loading').hidden,true);
  assert.equal(browser.controller.spectrum().frames.length,102);
  assert.equal(browser.element('spectrum-play').disabled,false);
  assert.equal(browser.captures.length,102);
});

function setSpectrumRange(browser,from,to){
  const first=browser.element('spectrum-range-from'),last=browser.element('spectrum-range-to');
  first.value=String(from);last.value=String(to);first.listeners.change();last.listeners.change();
}

test('a selected wavelength interval buffers only those bands and loops within its endpoints',async()=>{
  let now=0;
  const browser=browserController({clock:{now:()=>now}}),survey=wavelengthSurvey();
  await browser.controller.initializeSurvey(survey);setSpectrumRange(browser,17,19);
  assert.equal(await browser.controller.chooseRegionMode('infrared'),true);
  const state=browser.controller.spectrum();
  assert.deepEqual(Array.from(state.channels),[17,18,19]);
  assert.equal(browser.captures.length,3);assert.equal(state.frames.filter(Boolean).length,3);
  assert.equal(state.channel,17);assert.equal(browser.element('spectrum-bands').children.length,3);
  assert.equal(browser.element('spectrum-scrubber').min,'17');assert.equal(browser.element('spectrum-scrubber').max,'19');
  const low=299792458/Number(survey.properties.em_max),high=299792458/Number(survey.properties.em_min);
  assert.ok(state.image.frequencies.every(({value})=>[17,18,19].includes(Math.floor((value-low)/(high-low)*102))));
  const changes=state.image.frequencies.length;
  const step=async time=>{now=time;await new Promise(resolve=>setImmediate(resolve));};
  try{
    browser.controller.toggleSpectrum();
    await step(125);assert.equal(state.channel,18);
    await step(250);assert.equal(state.channel,19);
    await step(375);assert.equal(state.channel,17);
    assert.equal(state.image.frequencies.length,changes);
    assert.equal(browser.controller.selectSpectrumChannel(20),false);
  }finally{browser.controller.stopSpectrum();}
});

test('narrowing a buffered interval reuses frames and reversed endpoints are rejected',async()=>{
  const browser=browserController();await browser.controller.initializeSurvey(wavelengthSurvey());
  await browser.controller.chooseRegionMode('infrared');
  const captures=browser.captures.length;
  setSpectrumRange(browser,30,32);await browser.controller.loadSelectedSpectrum();
  assert.equal(browser.captures.length,captures);
  assert.deepEqual(Array.from(browser.controller.spectrum().channels),[30,31,32]);
  setSpectrumRange(browser,32,30);
  assert.equal(browser.element('spectrum-range-error').hidden,false);
  assert.equal(browser.element('prepare-spectrum-range').disabled,true);
  assert.equal(await browser.controller.loadSelectedSpectrum(),false);
  assert.equal(browser.captures.length,captures);
  setSpectrumRange(browser,31,31);await browser.controller.loadSelectedSpectrum();
  assert.equal(browser.controller.spectrum().channel,31);
  assert.equal(browser.element('spectrum-play').disabled,true);
});

test('changing range interrupts a long preparation and the next preparation uses the smaller total',async()=>{
  let release;const gate={promise:new Promise(resolve=>{release=resolve;})};
  const browser=browserController({spectrumGate:gate});await browser.controller.initializeSurvey(wavelengthSurvey());
  const loading=browser.controller.chooseRegionMode('infrared');
  while(!gate.started)await new Promise(resolve=>setImmediate(resolve));
  setSpectrumRange(browser,10,12);release();await loading;
  assert.equal(browser.controller.spectrum().ready,false);
  assert.equal(await browser.controller.loadSelectedSpectrum(),true);
  assert.equal(browser.captures.length,3);
  assert.deepEqual(Array.from(browser.controller.spectrum().channels),[10,11,12]);
  assert.equal(browser.element('spectrum-loading-progress').max,3);
});

test('documented blank bands get explicit empty frames and never request missing tiles',async()=>{
  const browser=browserController(),survey=wavelengthSurvey();
  survey.properties.obs_description='Frames 50 and 51 (band 3 channel 17, band 4 channel 1, the dichroic channels) are blank.';
  await browser.controller.initializeSurvey(survey);await browser.controller.chooseRegionMode('infrared');
  const state=browser.controller.spectrum();
  assert.equal(state.ready,true);assert.equal(state.frames.length,102);
  assert.equal(state.frames[50].blank,true);assert.equal(state.frames[51].blank,true);
  const properties=survey.properties,low=299792458/Number(properties.em_max),high=299792458/Number(properties.em_min);
  const requested=state.image.frequencies.map(({value})=>Math.floor((value-low)/(high-low)*102));
  assert.equal(requested.includes(50),false);assert.equal(requested.includes(51),false);
  assert.ok(requested.includes(0));assert.ok(requested.includes(101));
});

test('the live sky also labels documented blank channels and restores the next available band',async()=>{
  const browser=browserController(),survey=wavelengthSurvey();
  survey.properties.obs_description='Frames 50 and 51 are blank.';
  await browser.controller.initializeSurvey(survey);
  const slider=browser.element('wavelength-slider'),image=browser.baseLayers.at(-1),count=image.frequencies.length;
  slider.value='50';slider.listeners.input();slider.listeners.change();
  assert.equal(image.frequencies.length,count);assert.equal(image.getOpacity(),0);
  assert.match(browser.element('wavelength-value').textContent,/No archive data/);
  slider.value='52';slider.listeners.input();slider.listeners.change();
  assert.equal(image.getOpacity(),1);assert.equal(image.frequencies.length,count+1);
});

test('leaving during preparation cancels it without enabling partial playback or retaining stale frames after clear',async()=>{
  let release;const gate={promise:new Promise(resolve=>{release=resolve;})};
  const browser=browserController({spectrumGate:gate});await browser.controller.initializeSurvey(wavelengthSurvey());
  const loading=browser.controller.chooseRegionMode('infrared');
  while(!gate.started)await new Promise(resolve=>setImmediate(resolve));
  browser.controller.clearSelectedRegion();release();await loading;
  assert.equal(browser.controller.spectrum(),null);
  assert.equal(browser.element('spectrum-loading').hidden,true);
  assert.equal(browser.element('spectrum-play').disabled,true);
  assert.equal(browser.captures.length,0);
});

test('a failed preparation keeps Play disabled and retry reuses the already buffered bands',async()=>{
  let fail=true;
  const browser=browserController({spectrumCaptureFailure:count=>fail && count===3});
  await browser.controller.initializeSurvey(wavelengthSurvey());
  assert.equal(await browser.controller.chooseRegionMode('infrared'),false);
  const state=browser.controller.spectrum(),first=state.frames[0];
  assert.equal(state.ready,false);assert.equal(state.frames.length,3);
  assert.equal(browser.element('spectrum-play').disabled,true);
  assert.equal(browser.element('load-spectrum').disabled,false);
  fail=false;assert.equal(await browser.controller.loadSelectedSpectrum(),true);
  assert.equal(state.frames[0],first);assert.equal(state.frames.length,102);
  assert.equal(browser.captures.length,102);assert.equal(state.ready,true);
});

test('rectangle modes are exclusive and switching to Time retains the same crop',async()=>{
  const browser=browserController();await browser.controller.initializeSurvey(wavelengthSurvey());
  await browser.controller.loadSelectedObservations();
  const previous=browser.controller.state(),image=previous.frames.get('observation-0');
  await browser.controller.chooseRegionMode('infrared');
  assert.equal(previous.controller.signal.aborted,true);
  assert.equal(browser.layers.has(image.layer),false);
  assert.equal(browser.controller.state(),null);
  const region=browser.controller.spectrum().region;
  await browser.controller.chooseRegionMode('time');
  assert.equal(browser.controller.spectrum(),null);
  assert.equal(browser.controller.state().region,region);
  assert.equal(browser.controller.state().ready,true);
  assert.equal(browser.element('spectrum-player').hidden,true);
  assert.equal(browser.element('observation-filmstrip').hidden,false);
  assert.equal(browser.element('load-spectrum').hidden,true);
});

test('drawing in Infrared mode starts only the spectrum and leaving the region pauses it',async()=>{
  const browser=browserController({clock:{now:()=>0}});await browser.controller.initializeSurvey(wavelengthSurvey());
  browser.controller.clearSelectedRegion();
  await browser.controller.chooseRegionMode('infrared');
  await browser.controller.startRegionSelection();
  for(let i=0;i<30 && !browser.controller.spectrum()?.ready;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(browser.controller.spectrum());
  assert.equal(browser.controller.state(),null);
  assert.equal(browser.requests.length,0);
  try{
    browser.controller.toggleSpectrum();assert.equal(browser.controller.spectrum().playing,true);
    browser.element('back-to-sky').listeners.click();
    assert.equal(browser.controller.spectrum().playing,false);
    assert.equal(browser.element('spectrum-player').hidden,true);
  }finally{browser.controller.stopSpectrum();}
});

test('large infrared rectangles play normally and cannot be sent to the Time archive',async()=>{
  const browser=browserController({largeRectangle:true});await browser.controller.initializeSurvey(wavelengthSurvey());
  browser.controller.clearSelectedRegion();await browser.controller.chooseRegionMode('infrared');
  await browser.controller.startRegionSelection();
  for(let i=0;i<30 && !browser.controller.spectrum()?.ready;i++)await new Promise(resolve=>setImmediate(resolve));
  const state=browser.controller.spectrum();assert.ok(state);
  assert.ok(state.region.sizeDegrees>10);
  assert.equal(browser.element('spectrum-player').hidden,false);
  assert.equal(await browser.controller.chooseRegionMode('time'),false);
  assert.equal(browser.controller.regionMode(),'infrared');
  assert.equal(browser.controller.spectrum(),state);
  assert.equal(browser.element('region-mode-infrared').checked,true);
  assert.match(browser.element('region-result').textContent,/Time mode needs a region within 1°/);
  assert.equal(browser.requests.length,0);
  assert.equal(browser.controller.selectSpectrumChannel(80),true);
});

test('a release discovered during a spectrum is applied after returning to the whole sky',async()=>{
  const browser=browserController({releaseData:{...publishedRelease(2),survey:wavelengthSurvey(2)}});
  await browser.controller.initializeSurvey(wavelengthSurvey());
  await browser.controller.chooseRegionMode('infrared');
  const image=browser.controller.spectrum().image;
  await browser.controller.checkForDataUpdates();
  assert.match(browser.controller.survey().name,/DR1/);
  assert.equal(browser.controller.spectrum().image,image);
  browser.element('back-to-sky').listeners.click();
  while(browser.controller.updating())await new Promise(resolve=>setImmediate(resolve));
  assert.match(browser.controller.survey().name,/DR2/);
});

test('buffered spectrum playback loops without requesting tiles, changing native channels, or refitting',async()=>{
  let now=0;
  const browser=browserController({clock:{now:()=>now}});await browser.controller.initializeSurvey(wavelengthSurvey());
  await browser.controller.chooseRegionMode('infrared');
  const step=async time=>{now=time;await new Promise(resolve=>setImmediate(resolve));};
  const state=browser.controller.spectrum(),fits=browser.fits(),requests=browser.requests.length;
  const nativeChanges=state.image.frequencies.length;
  assert.equal(state.frames.length,102);assert.equal(browser.captures.length,102);
  try{
    browser.controller.selectSpectrumChannel(101);browser.controller.toggleSpectrum();
    await step(124);assert.equal(state.channel,101);
    await step(125);assert.equal(state.channel,0);
    browser.setRendering(true);await step(250);assert.equal(state.channel,1,'Cached frames do not depend on native rendering');
    await step(10000);assert.equal(state.channel,2,'A slow frame advances once');
    assert.equal(state.image.frequencies.length,nativeChanges);
    assert.equal(browser.captures.length,102);
    assert.equal(browser.fits(),fits);assert.equal(browser.requests.length,requests);
    browser.controller.selectSpectrumChannel(20);assert.equal(state.playing,false);
    browser.controller.toggleSpectrum();browser.document.hidden=true;browser.documentEvents.visibilitychange();
    assert.equal(state.playing,false);
    browser.document.hidden=false;browser.controller.toggleSpectrum();
    browser.controller.clearSelectedRegion();
    assert.equal(browser.controller.spectrum(),null);assert.equal(state.playing,false);
    assert.ok(browser.captures.every(frame=>frame.closed));
    assert.equal(browser.element('spectrum-player').hidden,true);
  }finally{browser.controller.stopSpectrum();}
});

function publishedRelease(release=1){
  return {checkedAt:'2026-11-14T00:00:00Z',stale:false,warnings:[],survey:{
    url:release===1?'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube':`https://irsa.ipac.caltech.edu/data/hips/SPHEREx/test_dr${release}_cube`,
    release:`DR${release}`,revision:`test-revision-${release}`,channelIndex:1,
    properties:{creator_did:`ivo://IPAC/P/SPHEREx/DR${release}/cube`,hips_cube_depth:'3',em_min:'1e-6',em_max:'5e-6',
      data_cube_crval3_arr:'1 3.293 5',hips_tile_format:'png'}
  }};
}

test('release refresh upgrades a compatible map and appends newer dates without changing the crop or frame',async()=>{
  const browser=browserController({releaseData:publishedRelease(2),newerHistory:url=>
    new URL(url,'http://localhost').searchParams.get('after').startsWith('2026-08-25')?
      [{observedStart:'2026-08-26T01:00:00Z',band:'SPHEREx-D2',cutoutUrl:'/newer/26',coverage:'full'}]:[]});
  await browser.controller.loadSelectedObservations();
  const state=browser.controller.state(),fits=browser.fits(),crop=browser.element('region-map').style.getPropertyValue('--region-clip');
  assert.equal(await browser.controller.checkForDataUpdates(),true);
  assert.match(browser.controller.survey().name,/DR2/);
  assert.equal(browser.controller.survey().channelIndex,1);
  assert.equal(state.frames.size,2);
  assert.equal(browser.controller.mission(),'observation-0');
  assert.equal(state.frames.get('observation-0').image.getOpacity(),1);
  assert.equal(browser.fits(),fits);
  assert.equal(browser.element('region-map').style.getPropertyValue('--region-clip'),crop);
  assert.ok(browser.requests.includes('/api/spherex/release'));
  assert.ok(browser.requests.every(url=>!url.includes('refresh=1')));
  const query=new URL(browser.requests.find(url=>url.includes('mode=newer')),'http://localhost').searchParams;
  assert.equal(query.get('after'),'2026-08-25T07:03:31Z');
  assert.equal(query.get('band'),'SPHEREx-D2');
  const replacements=browser.baseLayers.length;
  await browser.controller.checkForDataUpdates();
  assert.equal(browser.baseLayers.length,replacements);
  assert.equal(browser.requests.filter(url=>url==='/newer/26').length,1);
});

test('release discovery failure still checks weekly observations and retains the current map',async()=>{
  const browser=browserController({releaseFails:true,newerHistory:[
    {observedStart:'2026-08-26T01:00:00Z',band:'SPHEREx-D2',cutoutUrl:'/newer/26',coverage:'full'}]});
  await browser.controller.loadSelectedObservations();
  const survey=browser.controller.survey();
  assert.equal(await browser.controller.checkForDataUpdates(),false);
  assert.equal(browser.controller.survey().url,survey.url);
  assert.equal(browser.controller.state().frames.size,2);
  assert.match(browser.element('data-freshness').textContent,/current map is retained/);
});

test('failed new map load restores the previous survey and keeps resident observations usable',async()=>{
  const browser=browserController({releaseData:publishedRelease(2),failSurveyUrl:'test_dr2'});
  await browser.controller.loadSelectedObservations();
  const original=browser.controller.survey();
  assert.equal(await browser.controller.checkForDataUpdates(),false);
  assert.equal(browser.controller.survey().url,original.url);
  assert.equal(browser.baseLayers.at(-1).url,original.url);
  assert.equal(browser.controller.state().ready,true);
  assert.equal(browser.controller.state().frames.get('observation-0').image.getOpacity(),1);
});

test('daily updates run only while the page is visible',async()=>{
  const browser=browserController();
  assert.equal(browser.intervals.length,1);
  assert.equal(browser.intervals[0].milliseconds,86400000);
  browser.document.hidden=true;
  browser.intervals[0].callback();
  assert.equal(browser.requests.length,0);
  browser.document.hidden=false;
  browser.intervals[0].callback();
  while(browser.controller.updating())await new Promise(resolve=>setImmediate(resolve));
  assert.ok(browser.requests.some(url=>url.includes('/api/spherex/release')));
});

test('a failed newer download retries the original batch without downloading successful dates again',async()=>{
  let fail=true;
  const dates=[26,27].map(day=>({observedStart:`2026-08-${day}T01:00:00Z`,band:'SPHEREx-D2',cutoutUrl:`/newer/${day}`,coverage:'full'}));
  const browser=browserController({newerHistory:dates,failHistoryDate:url=>fail && url==='/newer/26'});
  await browser.controller.loadSelectedObservations();
  await browser.controller.checkForDataUpdates();
  assert.equal(browser.controller.state().frames.size,2);
  fail=false;
  await browser.controller.checkForDataUpdates();
  assert.equal(browser.controller.state().frames.size,3);
  const searches=browser.requests.filter(url=>url.includes('mode=newer'));
  assert.ok(searches.every(url=>new URL(url,'http://localhost').searchParams.get('after')==='2026-08-25T07:03:31Z'));
  assert.equal(browser.requests.filter(url=>url==='/newer/27').length,1);
});

test('region crop waits for zoom updates and fits all four corners', async () => {
  const browser = browserController();
  await browser.controller.fitComparisonRegion();
  const crop = browser.element('region-map').style.getPropertyValue('--region-clip');
  const values = [...crop.matchAll(/(-?[\d.]+)px/g)].map(m => Number(m[1]));
  assert.equal(values.length,8);
  assert.ok(values.every(value => value > 0 && value < 400),crop);
  assert.ok(Math.min(...values)<2 && Math.max(...values)>398,crop);
});

test('leaving comparison during a pending fit prevents a stale crop', async () => {
  const browser=browserController();
  const fit=browser.controller.fitComparisonRegion();
  browser.controller.cancel();
  await fit;
  assert.equal(browser.element('region-map').style.getPropertyValue('--region-clip'),'');
});

test('invalid projected corners fail instead of silently keeping a blank crop', async () => {
  const browser=browserController({invalidProjection:true});
  await assert.rejects(browser.controller.fitComparisonRegion(),/could not be projected/);
});

test('single observation uses automatic cuts and becomes ready after display checks', async () => {
  const browser=browserController();
  assert.equal(await browser.controller.loadSelectedObservations(),true);
  assert.equal(browser.options().opacity,1);
  assert.equal(browser.options().minCut,undefined);
  assert.equal(browser.options().maxCut,undefined);
  assert.match(browser.element('preload-progress').textContent,/Observation ready/);
  assert.equal(browser.controller.state().ready,true);
  assert.equal([...browser.layers.values()][0].getOpacity(),1);
});

test('display failure clears readiness and reports the failing stage', async () => {
  const browser=browserController({displayFails:true});
  assert.equal(await browser.controller.loadSelectedObservations(),false);
  assert.equal(browser.controller.state().ready,false);
  assert.match(browser.element('preload-progress').textContent,/Observations unavailable: Aladin display failed/);
  assert.equal(browser.layers.size,0);
});

test('an off-sky decoded image is rejected even when registration succeeds', async () => {
  const browser=browserController({imageCenter:[73.27156451746073,-34.11285165393297]});
  assert.equal(await browser.controller.loadSelectedObservations(),false);
  assert.equal(browser.controller.state().ready,false);
  assert.match(browser.element('preload-progress').textContent,/FITS coordinate mismatch/);
  assert.equal(browser.layers.size,0);
});

test('sky distance handles RA wraparound and polar regions', () => {
  assert.ok(Math.abs(angularSeparationDegrees([359.9,0],[.1,0])-.2)<1e-10);
  assert.ok(angularSeparationDegrees([0,89.99],[180,89.99])<.021);
  const separation=angularSeparationDegrees([60.44222703421171,54.54087028244997],[73.27156451746073,-34.11285165393297]);
  assert.ok(separation>89 && separation<90);
});

test('survey tabs preserve the cropped region and observation remains resident', async () => {
  const browser=browserController();
  assert.equal(await browser.controller.loadSelectedObservations(),true);
  const state=browser.controller.state(),frame=state.frames.get('observation-0');
  const crop=browser.element('region-map').style.getPropertyValue('--region-clip');
  for(const mission of ['spherex','gaia','spherex']){
    assert.equal(await browser.controller.switchMission(mission),true);
    assert.equal(browser.controller.active(),true);
    assert.equal(browser.controller.mission(),mission);
    assert.equal(browser.element('region-view').hidden,false);
    assert.equal(browser.element('region-map').style.getPropertyValue('--region-clip'),crop);
    assert.equal(browser.layers.get('planetx-region-survey').getOpacity(),1);
    assert.equal(frame.image.getOpacity(),0);
    assert.equal(browser.controller.state(),state);
  }
  assert.equal(await browser.controller.switchMission('observation-0'),true);
  assert.equal(browser.layers.get('planetx-region-survey').getOpacity(),0);
  assert.equal(frame.image.getOpacity(),1);
  browser.controller.clearSelectedRegion();
  assert.equal(browser.controller.active(),false);
  assert.equal(browser.element('region-view').hidden,true);
  assert.equal(browser.layers.size,0);
});

function earlier(count=10,offset=0){
  return Array.from({length:count},(_,i)=>({observedStart:new Date(Date.UTC(2026,7,24-i-offset,1)).toISOString(),
    band:'SPHEREx-D2',cutoutUrl:`/older/${offset+i}`,coverage:'full',downloadUrl:`https://example.com/${offset+i}`}));
}

test('loads ten earlier dates, preserves the current frame, and supports observation-10',async()=>{
  const browser=browserController({history:url=>new URL(url,'http://localhost').searchParams.get('before').startsWith('2026-08-25')?earlier():[]});
  await browser.controller.loadSelectedObservations();
  const state=browser.controller.state(),original=state.frames.get('observation-0').image;
  assert.equal(await browser.controller.loadEarlierObservations(),true);
  assert.equal(state.frames.size,11);
  assert.equal(browser.controller.mission(),'observation-0');
  assert.equal(original.getOpacity(),1);
  assert.ok([...state.frames].filter(([id])=>id!=='observation-0').every(([,frame])=>frame.image.getOpacity()===0));
  const query=new URL(browser.requests.find(url=>url.includes('mode=history')),'http://localhost').searchParams;
  assert.equal(query.get('before'),'2026-08-25T07:03:31Z');
  assert.equal(query.get('limit'),'10');assert.equal(query.get('band'),'SPHEREx-D2');
  assert.equal(await browser.controller.switchMission('observation-10'),true);
  assert.match(browser.element('survey-credit').textContent,/2026-08-15/);
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.requests.filter(url=>url.startsWith('/older/')).length,10,'The next batch must not download existing dates again');
  assert.equal(state.historyExhausted,true);
  const requests=browser.requests.length;
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.requests.length,requests,'An exhausted search must stop requesting');
  browser.controller.clearSelectedRegion();
  assert.equal(browser.controller.buttons().filter(button=>button.dataset.mission.startsWith('observation-')).length,1);
  assert.equal(browser.layers.size,0);
});

test('one failed earlier image preserves loaded dates and retry skips successful downloads',async()=>{
  const browser=browserController({history:earlier(3),failHistoryDate:'/older/1'});
  await browser.controller.loadSelectedObservations();
  const state=browser.controller.state();
  await browser.controller.loadEarlierObservations();
  assert.equal(state.frames.size,3);assert.equal(state.ready,true);assert.equal(state.historyRetry,true);
  assert.match(browser.element('preload-progress').textContent,/1 failed/);
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.requests.filter(url=>url==='/older/0').length,1);
  assert.equal(browser.requests.filter(url=>url==='/older/2').length,1);
  assert.equal(browser.requests.filter(url=>url==='/older/1').length,2);
  assert.equal(state.frames.get('observation-0').image.getOpacity(),1);
});

test('successive requests append older batches beyond ten dates while keeping existing frames',async()=>{
  const history=url=>{
    const before=new URL(url,'http://localhost').searchParams.get('before').slice(0,10);
    return before==='2026-08-25'?earlier(10):before==='2026-08-15'?earlier(10,10):earlier(2,20);
  };
  const browser=browserController({history,clock:{now:()=>0}});
  await browser.controller.loadSelectedObservations();
  const state=browser.controller.state(),original=state.frames.get('observation-0').image;
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.element('load-history').textContent,'Load 10 more dates');
  assert.equal(browser.element('load-history').disabled,false);
  browser.controller.togglePlayback();
  try{
    const displayed=browser.controller.mission();
    await browser.controller.loadEarlierObservations();
    assert.equal(state.frames.size,21);
    assert.equal(browser.controller.mission(),displayed);
    assert.equal(browser.controller.playing(),false,'New dates pause playback instead of shifting the playing sequence');
    await browser.controller.loadEarlierObservations();
    assert.equal(state.frames.size,23);
    assert.equal(state.frames.get('observation-0').image,original);
    const timeline=browser.controller.observationTimeline();
    assert.equal(new Set(timeline.map(entry=>entry.exposure.observedStart.slice(0,10))).size,23);
    assert.equal(browser.element('observation-scrubber').max,'22');
    assert.equal(state.historyExhausted,true);
    assert.equal(browser.element('load-history').disabled,true);
    const before=browser.requests.filter(url=>url.includes('mode=history')).map(url=>new URL(url,'http://localhost').searchParams.get('before').slice(0,10));
    assert.deepEqual(before,['2026-08-25','2026-08-15','2026-08-05']);
    assert.equal(browser.requests.filter(url=>url.startsWith('/older/')).length,22);
    await browser.controller.switchMission('observation-22');
    assert.equal(state.frames.get('observation-22').image.getOpacity(),1);
  }finally{browser.controller.stopPlayback();}
});

test('a partial batch retries its missing date before advancing the earlier-date cursor',async()=>{
  let failures=1;
  const history=url=>new URL(url,'http://localhost').searchParams.get('before').startsWith('2026-08-25')?earlier(10):earlier(2,10);
  const browser=browserController({history,failHistoryDate:url=>url==='/older/1' && failures-->0});
  await browser.controller.loadSelectedObservations();
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.element('load-history').textContent,'Retry earlier dates');
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.controller.state().frames.size,11);
  await browser.controller.loadEarlierObservations();
  assert.equal(browser.controller.state().frames.size,13);
  const before=browser.requests.filter(url=>url.includes('mode=history')).map(url=>new URL(url,'http://localhost').searchParams.get('before').slice(0,10));
  assert.deepEqual(before,['2026-08-25','2026-08-25','2026-08-15']);
  assert.equal(browser.requests.filter(url=>url==='/older/0').length,1);
  assert.equal(browser.requests.filter(url=>url==='/older/1').length,2);
});

test('clearing the region during a history download prevents stale dates from being added',async()=>{
  let release;
  const gate={promise:new Promise(resolve=>{release=resolve;}),started:false};
  const browser=browserController({history:earlier(1),historyGate:gate});
  await browser.controller.loadSelectedObservations();
  const loading=browser.controller.loadEarlierObservations();
  while(!gate.started)await new Promise(resolve=>setImmediate(resolve));
  browser.controller.clearSelectedRegion();release();
  assert.equal(await loading,false);
  assert.equal(browser.controller.state(),null);
  assert.equal(browser.layers.size,0);
  assert.equal(browser.element('preload-progress').hidden,true);
});

test('earlier search failure leaves the displayed observation usable',async()=>{
  const browser=browserController({historySearchFails:true});
  await browser.controller.loadSelectedObservations();
  assert.equal(await browser.controller.loadEarlierObservations(),false);
  assert.equal(browser.controller.state().ready,true);
  assert.equal(browser.layers.size,1);
  assert.equal(browser.controller.mission(),'observation-0');
  assert.match(browser.element('preload-progress').textContent,/still available/);
});

test('filmstrip scrubs chronologically with no downloads or camera resets and latest input wins',async()=>{
  const browser=browserController({history:earlier()});
  await browser.controller.loadSelectedObservations();await browser.controller.loadEarlierObservations();
  const timeline=browser.controller.observationTimeline();
  assert.equal(timeline[0].id,'observation-10');assert.equal(timeline[10].id,'observation-0');
  const slider=browser.element('observation-scrubber');
  assert.equal(browser.element('observation-filmstrip').hidden,false);
  assert.equal(slider.max,'10');assert.equal(slider.value,'10');
  const downloads=browser.requests.length,fits=browser.fits();
  slider.value='0';slider.listeners.input();
  assert.equal(browser.controller.mission(),'observation-10');
  assert.match(slider.getAttribute('aria-valuetext'),/2026-08-15/);
  slider.value='5';slider.listeners.input();
  slider.value='10';slider.listeners.input();
  assert.equal(browser.controller.mission(),'observation-0');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(browser.controller.mission(),'observation-0');
  assert.equal(browser.requests.length,downloads);assert.equal(browser.fits(),fits);
  const frames=browser.controller.state().frames;
  assert.equal([...frames.values()].filter(frame=>frame.image.getOpacity()===1).length,1);
  browser.controller.clearSelectedRegion();
  assert.equal(browser.element('observation-filmstrip').hidden,true);
  assert.equal(browser.element('filmstrip-track').children.length,0);
});

test('dragging the thumbnail strip selects frames and can return from a survey',async()=>{
  const browser=browserController({history:earlier(3)});
  await browser.controller.loadSelectedObservations();await browser.controller.loadEarlierObservations();
  await browser.controller.switchMission('spherex');
  const strip=browser.element('filmstrip-window');
  strip.listeners.pointerdown({button:0,pointerId:1,clientX:200,preventDefault(){}});
  strip.listeners.pointermove({pointerId:1,clientX:336});
  assert.equal(browser.controller.mission(),'observation-2');
  strip.listeners.pointerup({type:'pointerup',pointerId:1,clientX:336});
  assert.equal(strip.hasPointerCapture(1),false);
  assert.equal(browser.layers.get('planetx-region-survey').getOpacity(),0);
});

test('Play advances at a steady cadence, loops, and does not download or refit frames',async()=>{
  let now=0;
  const browser=browserController({history:earlier(3),clock:{now:()=>now}});
  await browser.controller.loadSelectedObservations();await browser.controller.loadEarlierObservations();
  const downloads=browser.requests.length,fits=browser.fits();
  const step=async time=>{now=time;await new Promise(resolve=>setImmediate(resolve));};
  try{
    browser.controller.togglePlayback();
    assert.equal(browser.controller.playing(),true);
    assert.equal(browser.controller.mission(),'observation-3');
    assert.match(browser.element('filmstrip-play').textContent,/Pause/);
    await step(249);assert.equal(browser.controller.mission(),'observation-3');
    await step(250);assert.equal(browser.controller.mission(),'observation-2');
    await step(500);assert.equal(browser.controller.mission(),'observation-1');
    await step(750);assert.equal(browser.controller.mission(),'observation-0');
    await step(1000);assert.equal(browser.controller.mission(),'observation-3');
    await step(10000);assert.equal(browser.controller.mission(),'observation-2','A slow frame advances once, without catch-up bursts');
    assert.equal(browser.requests.length,downloads);assert.equal(browser.fits(),fits);
    browser.controller.togglePlayback();
    assert.equal(browser.controller.playing(),false);
    await step(11000);assert.equal(browser.controller.mission(),'observation-2');
  }finally{browser.controller.stopPlayback();}
});

test('manual scrubbing, survey selection, hiding the tab, and region cleanup pause playback',async()=>{
  const browser=browserController({history:earlier(2),clock:{now:()=>0}});
  await browser.controller.loadSelectedObservations();await browser.controller.loadEarlierObservations();
  try{
    browser.controller.togglePlayback();
    const slider=browser.element('observation-scrubber');
    slider.value='1';slider.listeners.input();
    assert.equal(browser.controller.playing(),false);
    browser.controller.togglePlayback();
    await browser.controller.switchMission('spherex');
    assert.equal(browser.controller.playing(),false);
    browser.controller.togglePlayback();
    browser.document.hidden=true;browser.documentEvents.visibilitychange();
    assert.equal(browser.controller.playing(),false);
    browser.document.hidden=false;browser.controller.togglePlayback();
    browser.controller.clearSelectedRegion();
    assert.equal(browser.controller.playing(),false);
    assert.equal(browser.element('filmstrip-play').disabled,true);
  }finally{browser.controller.stopPlayback();}
});

test('playback is unavailable until more than one observation is loaded',async()=>{
  const browser=browserController();
  await browser.controller.loadSelectedObservations();
  browser.controller.togglePlayback();
  assert.equal(browser.controller.playing(),false);
  assert.equal(browser.element('filmstrip-play').disabled,true);
});
