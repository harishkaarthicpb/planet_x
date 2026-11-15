import test from 'node:test';
import assert from 'node:assert/strict';
import {observeSurveyTiles,waitForSurveyTiles,spectrumFrameSize,bufferSpectrumFrames,disposeSpectrumFrames,paintSpectrumFrame,captureSpectrumFrame} from '../spectrum-buffer.mjs';

const root='https://irsa.ipac.caltech.edu/data/hips/SPHEREx/test';

// A one-pixel source-over/copy compositor exercises repeated alpha blending
// without needing a browser or a WebGL context for this regression.
function pixelCanvas(){
  const canvas={width:1,height:1,pixel:[0,0,0,0]};
  const context={globalAlpha:1,globalCompositeOperation:'source-over',
    fillRect(){
      assert.equal(this.fillStyle,'#000');
      if(this.globalCompositeOperation==='copy')canvas.pixel=[0,0,0,255];
      else canvas.pixel=[0,0,0,255];
    },
    drawImage(frame){
      const alpha=frame.pixel[3]/255*this.globalAlpha,previous=canvas.pixel;
      canvas.pixel=frame.pixel.slice(0,3).map((value,index)=>Math.round(value*alpha+previous[index]*(1-alpha)));
      canvas.pixel.push(Math.round((alpha+previous[3]/255*(1-alpha))*255));
    }};
  canvas.getContext=()=>context;return canvas;
}

test('replaying and scrubbing transparent frames replaces pixels without brightness accumulating',()=>{
  const canvas=pixelCanvas(),frame={width:1,height:1,pixel:[200,100,50,64]};
  for(let index=0;index<100;index++)paintSpectrumFrame(canvas,frame);
  assert.deepEqual(canvas.pixel,[50,25,13,255]);
  paintSpectrumFrame(canvas,{width:1,height:1,pixel:[0,0,200,128]});
  assert.deepEqual(canvas.pixel,[0,0,100,255]);
  paintSpectrumFrame(canvas,frame);assert.deepEqual(canvas.pixel,[50,25,13,255]);
});

test('buffered capture matches live pixels over black and does not use PNG export',async()=>{
  const source={width:1,height:1,pixel:[200,100,50,64]};
  const viewer={view:{imageCanvas:source},getViewDataURL(){throw new Error('PNG export must not be used');}};
  const frame=await captureSpectrumFrame(viewer,{width:1,height:1},{createCanvas:pixelCanvas,
    bitmap:async canvas=>({width:1,height:1,pixel:[...canvas.pixel]})});
  assert.deepEqual(frame.pixel,[50,25,13,255]);
  const display=pixelCanvas();paintSpectrumFrame(display,frame);
  assert.deepEqual(display.pixel,frame.pixel);
  await assert.rejects(captureSpectrumFrame({view:{}},{width:1,height:1}),/not ready/);
});
function environment(){
  class Image extends EventTarget {get src(){return this.url;}set src(value){this.url=value;}}
  class Worker extends EventTarget {postMessage(data){this.sent=data;}}
  return {HTMLImageElement:Image,Worker,createImageBitmap:async image=>image};
}

test('tile tracker waits for image loading and reports errors only for the survey',()=>{
  const env=environment(),original=Object.getOwnPropertyDescriptor(env.HTMLImageElement.prototype,'src').set;
  const tracker=observeSurveyTiles(root,env),image=new env.HTMLImageElement();
  image.src=root+'/Norder3/Npix0.png';assert.equal(tracker.pending,1);
  image.dispatchEvent(new Event('load'));assert.equal(tracker.pending,0);
  image.src='https://example.com/icon.png';image.dispatchEvent(new Event('error'));
  assert.equal(tracker.failures.length,0);
  image.src=root+'/Norder3/Dir0/Npix1.png';image.dispatchEvent(new Event('error'));
  assert.equal(tracker.pending,0);assert.equal(tracker.failures.length,1);
  tracker.dispose();assert.equal(Object.getOwnPropertyDescriptor(env.HTMLImageElement.prototype,'src').set,original);
});

test('tracker includes bitmap decoding and matching asynchronous cube-worker responses',async()=>{
  const env=environment();let finish;
  env.createImageBitmap=()=>new Promise(resolve=>{finish=resolve;});
  const tracker=observeSurveyTiles(root,env),decode=env.createImageBitmap({});
  assert.equal(tracker.pending,1);finish({});await decode;assert.equal(tracker.pending,0);
  const worker=new env.Worker();
  const data={bitmap:{},tileDepth:102,HiPS:'cube',cell:{depth:3,idx:10n}};
  worker.postMessage(data);assert.equal(tracker.pending,1);
  worker.dispatchEvent(new MessageEvent('message',{data:{HiPSCDid:'other',cell:data.cell}}));
  assert.equal(tracker.pending,1);
  worker.dispatchEvent(new MessageEvent('message',{data:{HiPSCDid:'cube',cell:data.cell}}));
  assert.equal(tracker.pending,0);tracker.dispose();
});

test('fetch tracking covers the response body rather than stopping at headers',async()=>{
  const env=environment();let finish;
  env.fetch=async()=>({ok:true,clone:()=>({arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})})});
  const original=env.fetch,tracker=observeSurveyTiles(root,env);
  await env.fetch(root+'/Norder3/Dir0/Npix1.png');assert.equal(tracker.pending,1);
  finish(new ArrayBuffer(0));await Promise.resolve();assert.equal(tracker.pending,0);
  tracker.dispose();assert.equal(env.fetch,original);
});

test('overlapping trackers restore browser hooks only after the final observer exits',()=>{
  const env=environment(),original=Object.getOwnPropertyDescriptor(env.HTMLImageElement.prototype,'src').set;
  const first=observeSurveyTiles(root,env),second=observeSurveyTiles(root,env);
  first.dispose();const image=new env.HTMLImageElement();image.src=root+'/Norder3/Dir0/Npix1.png';
  assert.equal(second.pending,1);image.dispatchEvent(new Event('load'));assert.equal(second.pending,0);
  second.dispose();assert.equal(Object.getOwnPropertyDescriptor(env.HTMLImageElement.prototype,'src').set,original);
});

test('optional survey metadata 404s do not abort buffering, but a tile 404 identifies its URL',async()=>{
  const env=environment();
  env.fetch=async()=>({ok:false,status:404,clone:()=>({arrayBuffer:async()=>new ArrayBuffer(0)})});
  const tracker=observeSurveyTiles(root,env);
  for(const file of ['Moc.fits','properties.json','preview.jpg','metadata.xml'])await env.fetch(`${root}/${file}`);
  assert.equal(tracker.pending,0);assert.equal(tracker.failures.length,0);
  const preview=new env.HTMLImageElement();preview.src=root+'/preview.jpg';preview.dispatchEvent(new Event('error'));
  assert.equal(tracker.failures.length,0);
  const tile=root+'/Norder5/Dir10000/Npix12345_1.fits';
  await env.fetch(tile);await Promise.resolve();
  assert.equal(tracker.failures.length,1);
  assert.ok(tracker.failures[0].includes(tile));
  assert.match(tracker.failures[0],/HTTP 404/);tracker.dispose();
});

test('readiness waits for downloads, rendering and a quiet interval, with cancellation and timeout',async()=>{
  let now=0;
  const tracker={pending:1,activity:1,failures:[]};
  await waitForSurveyTiles(tracker,{now:()=>now,isRendering:()=>now<1000,nextFrame:async()=>{
    now+=50;if(now===900){tracker.pending=0;tracker.activity++;}
  }});
  assert.ok(now>=1300);
  const controller=new AbortController();controller.abort(new Error('cancelled'));
  await assert.rejects(waitForSurveyTiles(tracker,{signal:controller.signal}),/cancelled/);
  now=0;tracker.pending=1;
  await assert.rejects(waitForSurveyTiles(tracker,{now:()=>now,nextFrame:async()=>{now+=100;},timeoutMs:500}),/timed out/);
});

test('buffering captures every wavelength in order after its tile readiness and retries missing frames',async()=>{
  const controller=new AbortController(),frames=[],events=[];let failed=true;
  const options={count:4,frames,signal:controller.signal,selectChannel:channel=>events.push(`select:${channel}`),
    waitForTiles:async()=>events.push('ready'),captureFrame:async channel=>{
      if(channel===2 && failed)throw new Error('decode failed');
      events.push(`capture:${channel}`);return {channel,close(){this.closed=true;}};
    }};
  await assert.rejects(bufferSpectrumFrames(options),/decode failed/);
  assert.equal(frames.length,2);failed=false;await bufferSpectrumFrames(options);
  assert.deepEqual(frames.map(frame=>frame.channel),[0,1,2,3]);
  assert.equal(events.filter(event=>event==='select:0').length,1);
  assert.deepEqual(events.slice(0,6),['select:0','ready','capture:0','select:1','ready','capture:1']);
  const resident=[...frames];disposeSpectrumFrames(frames);
  assert.equal(frames.length,0);assert.ok(resident.every(frame=>frame.closed));
});

test('cancellation during capture closes the late frame and never registers it',async()=>{
  const controller=new AbortController(),frames=[],frame={close(){this.closed=true;}};
  await assert.rejects(bufferSpectrumFrames({count:1,frames,signal:controller.signal,
    selectChannel(){},waitForTiles:async()=>{},captureFrame:async()=>{controller.abort(new Error('cancelled'));return frame;}}),/cancelled/);
  assert.equal(frame.closed,true);assert.equal(frames.length,0);
});

test('inclusive subranges retain global channel indices and progress counts only selected bands',async()=>{
  const controller=new AbortController(),frames=[],requested=[],progress=[];
  frames[0]={outside:true};
  await bufferSpectrumFrames({count:102,channels:[60,61,62],frames,signal:controller.signal,
    selectChannel:channel=>requested.push(channel),waitForTiles:async()=>{},captureFrame:async channel=>({channel}),
    onProgress:(channel,loaded)=>progress.push([channel,loaded])});
  assert.deepEqual(requested,[60,61,62]);assert.deepEqual(progress.at(-1),[62,3]);
  assert.equal(frames[60].channel,60);assert.equal(frames[62].channel,62);assert.equal(frames[63],undefined);
  await assert.rejects(bufferSpectrumFrames({count:102,channels:[102],frames,signal:controller.signal}),/Invalid spectrum channel range/);
});

test('published blank channels are represented explicitly without selecting or waiting for nonexistent tiles',async()=>{
  const controller=new AbortController(),frames=[],requested=[],captured=[];
  await bufferSpectrumFrames({count:4,frames,signal:controller.signal,isBlankChannel:channel=>channel===1 || channel===2,
    selectChannel:channel=>requested.push(channel),waitForTiles:async()=>{},
    captureFrame:async(channel,{blank})=>{captured.push({channel,blank});return {channel,blank};}});
  assert.deepEqual(requested,[0,3]);
  assert.deepEqual(captured,[{channel:0,blank:false},{channel:1,blank:true},{channel:2,blank:true},{channel:3,blank:false}]);
});

test('frame resolution bounds the memory of all decoded wavelengths and preserves aspect ratio',()=>{
  const size=spectrumFrameSize(3840,2160,102);
  assert.ok(size.width*size.height*4*102<=96*1024*1024);
  assert.ok(Math.abs(size.width/size.height-3840/2160)<.01);
  assert.throws(()=>spectrumFrameSize(0,100,102),/Invalid/);
});
