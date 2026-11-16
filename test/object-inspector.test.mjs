import test from 'node:test';
import assert from 'node:assert/strict';
import {tapPosition,createObjectInspector,surveyEpoch} from '../object-inspector.mjs';

function setup(fetchImpl,getEpoch=()=>null){
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',children:[],listeners:{},
      addEventListener(name,fn){this.listeners[name]=fn;},replaceChildren(){this.children=[];},
      append(...children){this.children.push(...children);},getBoundingClientRect:()=>({left:10,top:20})});
    return elements.get(id);
  }
  const document={getElementById:element,createElement:tag=>element(Symbol(tag))};
  let enabled=true;
  const map={getSize:()=>[400,400],pix2world:(x,y)=>[123+(x-200)/3600,56+(y-200)/3600]};
  const inspector=createObjectInspector({map,element:element('map'),document,isEnabled:()=>enabled,getEpoch,fetchImpl});
  return {inspector,map,element,setEnabled:value=>{enabled=value;inspector.reset();}};
}
const position={ra:123,dec:56,radius:6};
const candidate={name:'<img src=x>',type:'Star',ra:123,dec:56,separationArcsec:0,url:'https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=Star'};
const result=candidates=>({ok:true,json:async()=>({candidates,source:'SIMBAD',note:null})});

test('map epoch follows published observation dates rather than today or the map publication date',()=>{
  assert.equal(surveyEpoch({t_min:51544.5,t_max:51544.5}),2000);
  assert.equal(surveyEpoch({t_min:51544.5+25*365.25,t_max:51544.5+27*365.25,hips_release_date:'2030-01-01'}),2026);
  for(const value of [{},{t_min:null,t_max:null},{t_min:'',t_max:''},{t_min:60000,t_max:50000},{t_min:'NaN',t_max:60000}])assert.equal(surveyEpoch(value),null);
});

test('lookup sends the actual map epoch and labels estimated motion-adjusted coordinates',async()=>{
  let query;
  const browser=setup(async url=>{query=new URL(url,'http://localhost').searchParams;return result([
    {...candidate,motionApplied:true,coordinateEpoch:2026.25}]);},()=>2026.25);
  await browser.inspector.identify(position);
  assert.equal(query.get('epoch'),'2026.25');
  assert.match(browser.element('object-info-list').children[0].children[2].textContent,/motion-adjusted to ~2026\.25/);
  assert.match(browser.element('object-info-source').textContent,/map's midpoint/);
});

test('tap coordinates use local ICRS pixels, handle RA wrap and flag wide views',()=>{
  const browser=setup();
  const found=tapPosition(browser.map,browser.element('map'),{clientX:210,clientY:220});
  assert.equal(found.ra,123);assert.equal(found.dec,56);assert.equal(found.tooWide,false);assert.ok(found.radius>=6);
  browser.map.pix2world=(x,y)=>[359.999+x*.1,y*.1];
  const wide=tapPosition(browser.map,browser.element('map'),{clientX:20,clientY:30});
  assert.ok(wide.ra<2);assert.equal(wide.tooWide,true);
  browser.map.pix2world=()=>null;assert.equal(tapPosition(browser.map,browser.element('map'),{clientX:20,clientY:30}),null);
});

test('off-center star taps use a forgiving screen target, larger for touch, without changing the zoom threshold',async()=>{
  let query;
  const browser=setup(async url=>{query=new URL(url,'http://localhost').searchParams;return result([candidate]);});
  browser.map.pix2world=(x,y)=>[123+(x-200)/3600,0+(y-200)/3600];
  const event={clientX:210,clientY:220,pointerType:'mouse'};
  const mouse=tapPosition(browser.map,browser.element('map'),event);
  const touch=tapPosition(browser.map,browser.element('map'),{...event,pointerType:'touch'});
  assert.ok(mouse.radius>17.9 && mouse.radius<18.1);
  assert.ok(touch.radius>27.9 && touch.radius<28.1);
  assert.equal(mouse.tooWide,false);assert.equal(touch.tooWide,false);
  // A star 14 arcseconds from the tap used to lie outside the six-pixel cone.
  assert.ok(mouse.radius>14);await browser.inspector.identify(mouse);
  assert.ok(Number(query.get('radius'))>14);
  browser.map.pix2world=(x,y)=>[123+(x-200)*3/3600,(y-200)*3/3600];
  const capped=tapPosition(browser.map,browser.element('map'),event);
  assert.equal(capped.radius,30);assert.equal(capped.tooWide,false,'Larger targets must not demand extra zoom');
  browser.map.pix2world=(x,y)=>[123+(x-200)*.01,(y-200)*.01];
  assert.equal(tapPosition(browser.map,browser.element('map'),event).tooWide,true);
});

test('lookup renders text safely and distinguishes ambiguous, missing and unavailable results',async()=>{
  let response=result([candidate]);const browser=setup(async()=>response);
  await browser.inspector.identify(position);
  assert.equal(browser.element('object-info').hidden,false);
  assert.match(browser.element('object-info-status').textContent,/Nearby catalog match/);
  assert.equal(browser.element('object-info-list').children[0].children[0].textContent,'<img src=x>');
  response=result([candidate,candidate]);await browser.inspector.identify(position);
  assert.match(browser.element('object-info-status').textContent,/Multiple possible/);
  response=result([]);await browser.inspector.identify(position);
  assert.match(browser.element('object-info-status').textContent,/No catalog match/);
  response={ok:false,json:async()=>({error:'Catalog unavailable'})};await browser.inspector.identify(position);
  assert.equal(browser.element('object-info-status').textContent,'Catalog unavailable');
  assert.equal(browser.element('object-info-list').children.length,0);
});

test('wide views never query and leaving SPHEREx hides the card and ignores late results',async()=>{
  let calls=0,release;
  const browser=setup(async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  await browser.inspector.identify({...position,tooWide:true});assert.equal(calls,0);
  assert.match(browser.element('object-info-status').textContent,/Zoom in/);
  const loading=browser.inspector.identify(position);
  browser.setEnabled(false);release(result([candidate]));await loading;
  assert.equal(browser.element('object-info').hidden,true);assert.equal(browser.element('object-info-list').children.length,0);
  await browser.inspector.identify(position);assert.equal(calls,1);
});

test('a later tap wins over an earlier response and closing the card cancels the lookup',async()=>{
  const requests=[];const browser=setup((url,options)=>new Promise(resolve=>requests.push({resolve,options})));
  const first=browser.inspector.identify(position),second=browser.inspector.identify({...position,ra:124});
  assert.equal(requests[0].options.signal.aborted,true);
  requests[1].resolve(result([]));await second;
  requests[0].resolve(result([candidate]));await first;
  assert.match(browser.element('object-info-status').textContent,/No catalog match/);
  assert.match(browser.element('object-info-coordinates').textContent,/124\.000000/);
  browser.element('object-info-close').listeners.click();assert.equal(browser.element('object-info').hidden,true);
});

test('map dragging, multi-touch and controls never trigger identification',async()=>{
  let calls=0;const browser=setup(async()=>{calls++;return result([]);}),events=browser.element('map').listeners;
  const tap={pointerId:1,isPrimary:true,button:0,clientX:210,clientY:220};
  events.pointerdown(tap);events.pointermove({...tap,clientX:230});events.pointerup(tap);
  events.pointerdown(tap);events.pointerdown({...tap,pointerId:2,isPrimary:false});events.pointerup(tap);
  events.pointerdown(tap);events.pointerup({...tap,target:{closest:()=>true}});
  assert.equal(calls,0);
  events.pointerdown(tap);events.pointerup(tap);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
});
