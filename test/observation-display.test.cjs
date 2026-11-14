const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { angularSeparationDegrees } = require('../sky-region.mjs');

// Exercise the browser controller without a live archive or WebGL context.
function browserController({ invalidProjection = false, displayFails = false, imageCenter = [60,50] } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const properties = new Map();
      elements.set(id, { hidden: false, textContent: '',
        addEventListener() {}, setAttribute() {},
        style: { setProperty: (k,v) => properties.set(k,v), getPropertyValue: k => properties.get(k) || '' }
      });
    }
    return elements.get(id);
  };
  let fov = 1, pendingFov = null, options;
  const layers = new Map();
  const map = {
    gotoRaDec() {}, setRotation() {}, setFoV(value) { pendingFov = value; },
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
    console: { info() {}, error() {} }, performance, setTimeout, clearTimeout, angularSeparationDegrees,
    AbortController, AbortSignal, URL, URLSearchParams, Blob, TextDecoder, Uint8Array,
    requestAnimationFrame(callback) {
      return setImmediate(() => { if (pendingFov !== null) { fov = pendingFov; pendingFov = null; } callback(); });
    },
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {},
      body: { classList: { add() {}, remove() {} } } },
    window: { addEventListener() {}, innerWidth:400,innerHeight:400,location: { href: 'http://localhost/' } },
    fetch: async url => String(url).includes('/observations?')
      ? { ok:true, status:200, json:async () => ({requestId:'test',observations:[{
        observedStart:'2026-08-25T07:03:31Z', band:'SPHEREx-D2',cutoutUrl:'/cutout',coverage:'full'
      }]}) }
      : { ok:true, status:200, headers:new Headers(), arrayBuffer:async () => new TextEncoder().encode('SIMPLE  ').buffer },
    testMap: map,
    testA: { HiPS(url,configuration) {
      let opacity=1;
      const hips={setOpacity(value){opacity=value;},getOpacity:()=>opacity,setFrequency(){},load:()=>configuration.successCallback(hips)};
      return hips;
    }, image(url,configuration) {
      options = configuration;
      let opacity = configuration.opacity;
      return { setOpacity(value) { opacity=value; }, getOpacity: () => opacity,
        getCuts: () => [140,180], ra:60,dec:50,fov:.2,load:()=>configuration.successCallback(...imageCenter,.2) };
    } }
  });
  const source = fs.readFileSync(require.resolve('../script.js'),'utf8')
    .replace(/^import .*;\n/m,'').replace(/\bexport /g,'').replace('loadSky().catch(showError);','');
  vm.runInContext(source + `
    A = testA; skyMap = testMap; comparisonMap = testMap; comparisonActive = true;
    currentMission = baseMission = 'spherex';
    selectedRegion = {position:{ra:60,dec:50},corners:[[59.9,49.9],[60.1,49.9],[60.1,50.1],[59.9,50.1]],sizeDegrees:.3,rotation:0,aspect:1};
    metadata.set('spherex',{hips_cube_depth:'100',em_min:'1e-6',em_max:'5e-6'});
    metadata.set('gaia',{});
    globalThis.controller = { fitComparisonRegion, loadSelectedObservations, switchMission, clearSelectedRegion,
      active: () => comparisonActive, mission: () => currentMission,
      cancel: () => { comparisonActive=false; selectedRegion=null; },
      state: () => pairState };
  `,context);
  return { controller:context.controller, element, options:() => options, layers };
}

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
