import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function tour({ready=false,seen=false}={}){
  const elements=new Map(),frames=new Map();let frame=0,observer;
  const document={body:{},activeElement:null,getElementById:element,querySelector:selector=>selector==='.tour-card'?element('card'):
    selector==='#coordinate-search .coordinate-row'?element('row'):
    selector==='[data-mission="spherex"]'?element('mission'):element(selector.slice(1))};
  function element(id){
    if(!elements.has(id))elements.set(id,{open:false,scrollTop:0,disabled:false,textContent:'',style:{},attrs:new Map(),listeners:{},
      addEventListener(name,callback){this.listeners[name]=callback;},querySelector:()=>element('card'),
      focus(){document.activeElement=this;},showModal(){this.open=true;},close(){this.open=false;},
      setAttribute(key,value){this.attrs.set(key,value);},getAttribute(key){return this.attrs.get(key);},
      toggleAttribute(key,on){if(on)this.attrs.set(key,'');else this.attrs.delete(key);},
      getClientRects:()=>[{}],getBoundingClientRect:()=>({left:32,top:100,right:352,bottom:200,width:320,height:id==='card'?260:100})});
    return elements.get(id);
  }
  element('coordinate-fields').disabled=!ready;element('mission').disabled=!ready;
  element('mission').attrs.set('aria-pressed','true');
  element('coordinate-panel').scrollTop=75;
  const originalFocus=element('original');document.activeElement=originalFocus;
  const storage=new Map(seen?[['planetx.quick-tour.v1','seen']]:[]);
  const context=vm.createContext({document,window:{innerWidth:1440,innerHeight:900,addEventListener(){}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    MutationObserver:class{constructor(callback){this.callback=callback;observer=this;}observe(){}disconnect(){this.disconnected=true;}},
    requestAnimationFrame:callback=>{frames.set(++frame,callback);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(fs.readFileSync(new URL('../quick-tour.mjs',import.meta.url),'utf8').replace(/^export /gm,''),context);
  const flush=()=>{for(const [id,callback] of [...frames]){frames.delete(id);callback();}};
  return {element,storage,originalFocus,document,flush,notify:()=>observer.callback(),observer:()=>observer};
}

test('tour waits for loaded controls and points to them without changing inputs or invoking viewer actions',()=>{
  const env=tour();assert.equal(env.element('quick-tour').open,false);
  env.element('right-ascension').value='123';env.element('wavelength-slider').value='62';
  env.element('coordinate-fields').disabled=false;env.element('mission').disabled=false;env.notify();env.flush();
  assert.equal(env.element('quick-tour').open,true);assert.match(env.element('tour-title').textContent,/welcome/);
  assert.equal(env.element('tour-arrow').attrs.has('hidden'),true);
  env.element('tour-next').listeners.click();env.flush();
  assert.equal(env.element('coordinate-panel').open,true);assert.equal(env.element('coordinate-panel').scrollTop,0);
  assert.equal(env.element('tour-arrow').attrs.has('hidden'),false);assert.match(env.element('tour-arrow').attrs.get('d'),/^M /);
  env.element('tour-next').listeners.click();env.flush();assert.equal(env.element('coordinate-panel').open,false);
  assert.match(env.element('tour-title').textContent,/infrared/);
  env.element('tour-next').listeners.click();env.flush();assert.match(env.element('tour-title').textContent,/Switch/);
  env.element('tour-next').listeners.click();
  assert.equal(env.element('quick-tour').open,false);assert.equal(env.element('coordinate-panel').scrollTop,75);
  assert.equal(env.element('coordinate-panel').open,false);assert.equal(env.document.activeElement,env.originalFocus);
  assert.equal(env.element('right-ascension').value,'123');assert.equal(env.element('wavelength-slider').value,'62');
  assert.equal(env.storage.get('planetx.quick-tour.v1'),'seen');
});

test('dismissal restores an open drawer and replay starts from welcome',()=>{
  const env=tour({seen:true,ready:true});assert.equal(env.element('quick-tour').open,false);
  env.element('coordinate-panel').open=true;env.element('tour-replay').listeners.click();
  env.element('tour-next').listeners.click();env.element('tour-next').listeners.click();
  assert.equal(env.element('coordinate-panel').open,false);
  let prevented=false,stopped=false;
  env.element('quick-tour').listeners.cancel({preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(env.element('quick-tour').open,false);
  assert.equal(env.element('coordinate-panel').open,true);assert.equal(env.element('coordinate-panel').scrollTop,75);
  env.element('tour-replay').listeners.click();assert.match(env.element('tour-title').textContent,/welcome/);
  env.element('tour-skip').listeners.click();assert.equal(env.element('quick-tour').open,false);
});
