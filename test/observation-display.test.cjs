const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { angularSeparationDegrees } = require('../sky-region.mjs');
const { sampleFitsPreview } = require('../fits-preview.mjs');

// Exercise the browser controller without a live archive or WebGL context.
function browserController({ invalidProjection = false, displayFails = false, imageCenter = [60,50], history=[], failHistoryDate=null, historyGate=null, historySearchFails=false,clock=performance,
  newerHistory=[],releaseData=null,releaseFails=false,failSurveyUrl=null } = {}) {
  const elements = new Map();
  const requests=[];
  const documentEvents={};
  const intervals=[],baseLayers=[];
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
        style: { setProperty: (k,v) => properties.set(k,v), getPropertyValue: k => properties.get(k) || '' }
      });
    }
    return elements.get(id);
  };
  let fov = 1, pendingFov = null, options, fits=0;
  const layers = new Map();
  const map = {
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
    console: { info() {}, error() {} }, performance:clock, setTimeout, clearTimeout, angularSeparationDegrees,sampleFitsPreview,
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
    testA: { HiPS(url,configuration) {
      let opacity=1;
      const hips={url,setOpacity(value){opacity=value;},getOpacity:()=>opacity,setFrequency(){},
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
      playing:()=>!!playback,
      buttons:()=>missionButtons,
      active: () => comparisonActive, mission: () => currentMission,
      cancel: () => { comparisonActive=false; selectedRegion=null; },
      state: () => pairState };
  `,context);
  return { controller:context.controller, element, options:() => options, layers,requests,fits:()=>fits,document:context.document,documentEvents,intervals,baseLayers };
}

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
