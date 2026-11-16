import {angularSeparationDegrees} from './sky-region.mjs';

// Convert the actual ICRS pixels under a tap; account for projection and poles.
export function tapPosition(map,element,event){
  const bounds=element.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top;
  const center=map.pix2world(x,y,'ICRS');
  if(!center || !center.every(Number.isFinite))return null;
  const [width,height]=map.getSize();
  const angularRadius=pixels=>{
    const neighbors=[[x+(x+pixels<width?pixels:-pixels),y],[x,y+(y+pixels<height?pixels:-pixels)]]
      .map(([px,py])=>map.pix2world(px,py,'ICRS')).filter(point=>point?.every(Number.isFinite));
    return neighbors.length?Math.max(...neighbors.map(point=>angularSeparationDegrees(center,point)*3600)):null;
  };
  const fineRadius=angularRadius(6);
  const targetRadius=angularRadius(event.pointerType==='touch'?28:18);
  if(fineRadius===null || targetRadius===null)return null;
  // A wider screen target tolerates tapping the visible star away from its
  // center. Keep the old zoom threshold and the 30-arcsecond catalog cap.
  return {ra:((center[0]%360)+360)%360,dec:center[1],
    radius:Math.min(30,Math.max(12,targetRadius)),tooWide:fineRadius>30};
}

export function surveyEpoch(properties){
  const start=properties?.t_min,end=properties?.t_max;
  if(start==null || end==null || String(start).trim()==='' || String(end).trim()==='')return null;
  const min=Number(start),max=Number(end);
  if(!Number.isFinite(min) || !Number.isFinite(max) || max<min)return null;
  const epoch=2000+((min+max)/2-51544.5)/365.25;
  return epoch>=1900 && epoch<=2200?epoch:null;
}

export function createObjectInspector({map,element,document,isEnabled,getEpoch=()=>null,fetchImpl=fetch}){
  const card=document.getElementById('object-info'),status=document.getElementById('object-info-status');
  const coordinates=document.getElementById('object-info-coordinates'),list=document.getElementById('object-info-list');
  const source=document.getElementById('object-info-source');
  let pointer=null,controller=null,sequence=0,lastTap=-Infinity;
  function close(){sequence++;controller?.abort();controller=null;card.hidden=true;}
  function reset(){if(!isEnabled())close();}
  async function identify(position){
    if(!isEnabled())return;
    const current=++sequence;controller?.abort();controller=new AbortController();
    card.hidden=false;list.replaceChildren();source.textContent='';
    coordinates.textContent=`Tapped RA ${position.ra.toFixed(6)}° · Dec ${position.dec.toFixed(6)}° · ICRS`;
    if(position.tooWide){status.textContent='Zoom in further, then tap the object again to identify it.';return;}
    status.textContent='Looking for nearby catalog objects…';
    try{
      const query=new URLSearchParams({ra:String(position.ra),dec:String(position.dec),radius:String(position.radius)});
      const epoch=getEpoch();if(Number.isFinite(epoch))query.set('epoch',String(epoch));
      const response=await fetchImpl(`/api/objects?${query}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(23000)])});
      const result=await response.json();
      if(current!==sequence || !isEnabled())return;
      if(!response.ok)throw new Error(result.error || 'The object catalog is unavailable. Try another tap.');
      if(!Array.isArray(result.candidates))throw new Error('The catalog returned an invalid response.');
      status.textContent=result.candidates.length?
        `${result.candidates.length===1?'Nearby catalog match':'Multiple possible matches'} · within ${position.radius.toFixed(1)}″ of your tap`:
        `No catalog match within ${position.radius.toFixed(1)}″. Try tapping closer or zooming in.`;
      for(const candidate of result.candidates){
        const item=document.createElement('li'),link=document.createElement('a'),detail=document.createElement('p'),location=document.createElement('p');
        link.textContent=candidate.name;link.href=candidate.url;link.target='_blank';link.rel='noopener noreferrer';
        detail.textContent=`${candidate.type} · ${candidate.separationArcsec.toFixed(1)}″ from tap`;
        location.textContent=`RA ${candidate.ra.toFixed(6)}° · Dec ${candidate.dec.toFixed(6)}°`+
          (candidate.motionApplied?` · motion-adjusted to ~${candidate.coordinateEpoch.toFixed(2)}`:' · catalog position (epoch 2000)');
        item.append(link,detail,location);list.append(item);
      }
      source.textContent=`${result.source}${result.limited?' · Catalog results capped; additional matches may exist.':''} ${result.note || ''} `+
        (Number.isFinite(epoch)?`Available proper motions are adjusted approximately to the map's midpoint (~${epoch.toFixed(2)}); individual image dates vary. `:
          'The map observation date is unavailable; positions use catalog epoch 2000. ')+
        'Proximity is not a confirmed identification.';
    }catch(error){
      if(current===sequence && isEnabled())status.textContent=error.name==='TimeoutError'?'The catalog lookup timed out. Tap again to retry.':error.message;
    }
  }
  document.getElementById('object-info-close').addEventListener('click',close);
  element.addEventListener('pointerdown',event=>{
    pointer=isEnabled() && event.isPrimary!==false && event.button===0?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null;
  },{passive:true});
  element.addEventListener('pointermove',event=>{
    if(pointer && pointer.id===event.pointerId && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6)pointer=null;
  },{passive:true});
  element.addEventListener('pointercancel',()=>{pointer=null;});
  element.addEventListener('pointerup',event=>{
    const start=pointer;pointer=null;
    if(!start || start.id!==event.pointerId || !isEnabled() || performance.now()-start.time>700 ||
      Math.hypot(event.clientX-start.x,event.clientY-start.y)>6 || performance.now()-lastTap<400)return;
    if(event.target?.closest?.('button,a,input,select,textarea,[role="button"]'))return;
    lastTap=performance.now();
    const position=tapPosition(map,element,event);if(position)void identify(position);
  },{passive:true});
  return {close,reset,identify};
}
