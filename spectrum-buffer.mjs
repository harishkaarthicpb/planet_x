// Track the actual tile downloads and decodes used by the pinned Aladin
// renderer. Render-idle alone does not mean its asynchronous tiles are ready.
const installations=new WeakMap();

function isSurveyTile(url,root) {
  if(!String(url).startsWith(root))return false;
  const path=String(url).slice(root.length).split(/[?#]/)[0];
  // Survey setup also requests optional MOCs, previews and metadata. Missing
  // auxiliary files do not mean the wavelength's rendered tiles are missing.
  return /^Norder\d+\/(?:[^/]+\/)*(?:Npix[^/]+|Allsky[^/]*)\.(?:png|jpe?g|webp|fits(?:\.gz)?)$/i.test(path);
}

export function observeSurveyTiles(root,environment=window) {
  let installation=installations.get(environment);
  if(!installation){installation=installObservers(environment);installations.set(environment,installation);}
  const observer={root:root.replace(/\/$/,'')+'/',pending:0,activity:0,failures:[],disposed:false};
  installation.observers.add(observer);
  return {
    get pending(){return observer.pending;},
    get activity(){return observer.activity;},
    get failures(){return observer.failures;},
    dispose(){
      observer.disposed=true;installation.observers.delete(observer);
      if(!installation.observers.size){installation.restore();installations.delete(environment);}
    }
  };
}

function installObservers(environment) {
  const observers=new Set(),restorers=[],cleanups=new Set();
  const begin=url=>{
    const active=[...observers].filter(o=>!o.disposed && (url===null || isSurveyTile(url,o.root)));
    active.forEach(o=>{o.pending++;o.activity++;});
    let done=false;
    return error=>{
      if(done)return;done=true;
      active.forEach(o=>{o.pending--;o.activity++;if(error)o.failures.push(String(error.message || error));});
    };
  };
  const patch=(object,key,replacement)=>{
    const original=object[key];object[key]=replacement(original);
    const installed=object[key];restorers.push(()=>{if(object[key]===installed)object[key]=original;});
  };
  const imagePrototype=environment.HTMLImageElement?.prototype;
  const src=imagePrototype && Object.getOwnPropertyDescriptor(imagePrototype,'src');
  if(!src?.set || !src.configurable)throw new Error('This browser cannot track spectrum tile loading.');
  const imageLoads=new WeakMap();
  const setter=function(value){
    imageLoads.get(this)?.();
    const end=begin(value);
    const cleanup=()=>{this.removeEventListener('load',loaded);this.removeEventListener('error',failed);cleanups.delete(cleanup);imageLoads.delete(this);};
    const loaded=()=>{cleanup();end();};
    const failed=()=>{cleanup();end(new Error(`A spectrum tile could not load: ${value}`));};
    const cancel=()=>{cleanup();end();};
    imageLoads.set(this,cancel);cleanups.add(cleanup);
    this.addEventListener('load',loaded);this.addEventListener('error',failed);
    try{src.set.call(this,value);}catch(error){cleanup();end(error);throw error;}
  };
  Object.defineProperty(imagePrototype,'src',{...src,set:setter});
  restorers.push(()=>{if(Object.getOwnPropertyDescriptor(imagePrototype,'src')?.set===setter)Object.defineProperty(imagePrototype,'src',src);});
  if(environment.fetch)patch(environment,'fetch',original=>async function(input,...args){
    const url=typeof input==='string'?input:input?.url || String(input);
    if(![...observers].some(o=>isSurveyTile(url,o.root)))return original.call(this,input,...args);
    const end=begin(url);
    try{
      const response=await original.call(this,input,...args);
      // A fetch resolves at headers; consume a clone to observe body completion.
      response.clone().arrayBuffer().then(()=>end(response.ok?null:new Error(`Spectrum tile HTTP ${response.status}: ${url}`)),end);
      return response;
    }catch(error){end(error);throw error;}
  });
  if(environment.createImageBitmap)patch(environment,'createImageBitmap',original=>async function(...args){
    const end=begin(null);
    try{const image=await original.apply(this,args);end();return image;}catch(error){end(error);throw error;}
  });
  if(environment.Worker?.prototype.postMessage)patch(environment.Worker.prototype,'postMessage',original=>function(data,...args){
    if(!data?.bitmap || data.tileDepth===undefined)return original.call(this,data,...args);
    const cellKey=(hips,cell)=>JSON.stringify([hips,cell],(_,value)=>typeof value==='bigint'?value.toString():value);
    const end=begin(null),key=cellKey(data.HiPS,data.cell);
    const cleanup=()=>{this.removeEventListener('message',message);this.removeEventListener('error',failed);cleanups.delete(cleanup);};
    const message=event=>{
      if(cellKey(event.data?.HiPSCDid,event.data?.cell)!==key)return;
      cleanup();end();
    };
    const failed=event=>{cleanup();end(new Error(event.message || 'Spectrum tile decoding failed.'));};
    cleanups.add(cleanup);this.addEventListener('message',message);this.addEventListener('error',failed);
    try{return original.call(this,data,...args);}catch(error){cleanup();end(error);throw error;}
  });
  return {observers,restore(){restorers.reverse().forEach(restore=>restore());cleanups.forEach(cleanup=>cleanup());}};
}

export async function waitForSurveyTiles(tracker,{signal,isRendering=()=>false,now=()=>performance.now(),
  nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),quietMs=350,minimumMs=500,timeoutMs=120000}={}) {
  const start=now();let changedAt=start,activity=tracker.activity;
  while(true){
    signal?.throwIfAborted();
    if(tracker.failures.length)throw new Error(tracker.failures[0]);
    const time=now(),busy=isRendering();
    if(tracker.activity!==activity || tracker.pending || busy){changedAt=time;activity=tracker.activity;}
    if(!busy && !tracker.pending && time-start>=minimumMs && time-changedAt>=quietMs)return;
    if(time-start>=timeoutMs)throw new Error('Spectrum tile loading timed out. Try preparing the spectrum again.');
    await nextFrame();
  }
}

export function spectrumFrameSize(width,height,count,memoryBytes=96*1024*1024) {
  if(![width,height,count].every(n=>Number.isFinite(n) && n>0))throw new Error('Invalid spectrum frame size.');
  const scale=Math.min(1,1024/Math.max(width,height),Math.sqrt(memoryBytes/(4*count*width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}

export function paintSpectrumFrame(canvas,frame,{width=frame.width,height=frame.height}={}) {
  if(canvas.width!==width || canvas.height!==height){canvas.width=width;canvas.height=height;}
  const context=canvas.getContext('2d');
  // The live sky is composited over black. Replace the entire previous frame
  // with that same opaque background before drawing, including on scrubs.
  context.globalAlpha=1;context.globalCompositeOperation='copy';
  context.fillStyle='#000';context.fillRect(0,0,width,height);
  context.globalCompositeOperation='source-over';context.drawImage(frame,0,0,width,height);
}

export async function captureSpectrumFrame(viewer,size,{createCanvas=()=>document.createElement('canvas'),bitmap=canvas=>createImageBitmap(canvas)}={}) {
  const source=viewer.view?.imageCanvas;
  if(!source?.width || !source.height)throw new Error('The infrared image canvas is not ready for capture.');
  // Capture the same rendered canvas the user sees, without export overlays,
  // a PNG encode/decode cycle, or a second alpha/color conversion.
  const canvas=createCanvas();paintSpectrumFrame(canvas,source,size);
  return bitmap(canvas);
}

export async function captureBlankSpectrumFrame(size,wavelength) {
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
  const context=canvas.getContext('2d');
  context.fillStyle='#000';context.fillRect(0,0,size.width,size.height);
  context.fillStyle='#c7cfdb';context.font=`${Math.max(10,Math.min(18,size.width/24))}px system-ui`;
  context.textAlign='center';context.fillText(`${wavelength.toFixed(3)} µm — No archive data`,size.width/2,size.height/2,size.width-16);
  return createImageBitmap(canvas);
}

export async function bufferSpectrumFrames({count,channels=Array.from({length:count},(_,index)=>index),frames,signal,selectChannel,waitForTiles,captureFrame,isBlankChannel=()=>false,onProgress=()=>{}}) {
  if(!channels.length || channels.some(channel=>!Number.isInteger(channel) || channel<0 || channel>=count))throw new Error('Invalid spectrum channel range.');
  const loaded=()=>channels.filter(channel=>frames[channel]).length;
  for(const channel of channels){
    signal.throwIfAborted();
    if(frames[channel])continue;
    onProgress(channel,loaded());
    const blank=isBlankChannel(channel);
    if(!blank){await selectChannel(channel);await waitForTiles();}
    signal.throwIfAborted();
    const frame=await captureFrame(channel,{blank});
    if(signal.aborted){frame.close?.();signal.throwIfAborted();}
    frames[channel]=frame;onProgress(channel,loaded());
  }
}

export function disposeSpectrumFrames(frames) {
  frames.forEach(frame=>frame?.close?.());frames.length=0;
}
