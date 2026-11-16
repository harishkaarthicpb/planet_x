// An independent presentation layer. Never calls the sky viewer or its APIs.
const STORAGE_KEY='planetx.quick-tour.v1';
const STEPS=[
  {title:'Hi, welcome to Planet X.',text:'Explore the infrared sky, one wavelength at a time. Here’s a quick look at the three controls you need to get started.'},
  {target:'#coordinate-search .coordinate-row',title:'Choose a place in the sky',text:'Enter Right Ascension (RA) and Declination (Dec) in degrees here. Choose your field of view below, then select “Explore coordinates” to visit that location.'},
  {target:'#wavelength-panel',title:'See the sky in infrared',text:'Move this slider to view the same sky at a different infrared wavelength. The number in µm tells you which wavelength you’re viewing.'},
  {target:'#mission-switch',title:'Switch your view',text:'Use these tabs to compare SPHEREx with WISE, DSS2 Color, or Gaia. Your sky position stays the same when you switch. The surveys were taken at different dates.'}
];

// Prefer a card beside the highlighted control; fall back to the free end of
// the viewport on narrow screens. All positions are CSS pixels.
export function placeTourCard(target,card,viewport){
  const gap=24,margin=16,maxX=Math.max(margin,viewport.width-card.width-margin),maxY=Math.max(margin,viewport.height-card.height-margin);
  const clamp=(value,max)=>Math.max(margin,Math.min(max,value));
  if(!target)return {x:clamp((viewport.width-card.width)/2,maxX),y:clamp((viewport.height-card.height)/2,maxY)};
  const candidates=[
    {x:target.right+gap,y:target.top},
    {x:target.left-card.width-gap,y:target.top},
    {x:(viewport.width-card.width)/2,y:target.bottom+gap},
    {x:(viewport.width-card.width)/2,y:target.top-card.height-gap}
  ];
  for(const candidate of candidates){
    const next={x:clamp(candidate.x,maxX),y:clamp(candidate.y,maxY)};
    if(next.x>=target.right+gap || next.x+card.width<=target.left-gap ||
      next.y>=target.bottom+gap || next.y+card.height<=target.top-gap)return next;
  }
  return {x:clamp((viewport.width-card.width)/2,maxX),
    y:target.top+target.height/2<viewport.height/2?maxY:margin};
}

function installTour(){
  const dialog=document.getElementById('quick-tour');
  if(!dialog || typeof dialog.showModal!=='function')return;
  const card=dialog.querySelector('.tour-card'),title=document.getElementById('tour-title'),text=document.getElementById('tour-text');
  const progress=document.getElementById('tour-progress'),next=document.getElementById('tour-next'),back=document.getElementById('tour-back');
  const spotlight=document.getElementById('tour-spotlight'),ring=document.getElementById('tour-ring'),arrow=document.getElementById('tour-arrow');
  const panel=document.getElementById('coordinate-panel'),replay=document.getElementById('tour-replay');
  let index=0,saved=null,frame=null,autoAttempted=false;
  const seen=()=>{try{return localStorage.getItem(STORAGE_KEY)==='seen';}catch{return false;}};
  const markSeen=()=>{try{localStorage.setItem(STORAGE_KEY,'seen');}catch{/* Tour still works without storage. */}};
  function finish(){
    if(!dialog.open)return;
    markSeen();dialog.close();
    if(frame!==null)cancelAnimationFrame(frame);frame=null;
    panel.open=saved.panelOpen;panel.scrollTop=saved.panelScroll;
    saved.focus?.focus?.({preventScroll:true});saved=null;
  }
  function layout(){
    frame=null;if(!dialog.open)return;
    const viewport={width:window.innerWidth,height:window.innerHeight};
    const target=STEPS[index].target?document.querySelector(STEPS[index].target):null;
    const rect=target && target.getClientRects().length?target.getBoundingClientRect():null;
    const size=card.getBoundingClientRect(),placement=placeTourCard(rect,size,viewport);
    card.style.left=`${placement.x}px`;card.style.top=`${placement.y}px`;
    for(const element of [spotlight,ring,arrow])element.toggleAttribute('hidden',!rect);
    if(!rect)return;
    const left=Math.max(4,rect.left-7),top=Math.max(4,rect.top-7);
    const right=Math.min(viewport.width-4,rect.right+7),bottom=Math.min(viewport.height-4,rect.bottom+7);
    for(const element of [spotlight,ring]){
      element.setAttribute('x',left);element.setAttribute('y',top);
      element.setAttribute('width',Math.max(0,right-left));element.setAttribute('height',Math.max(0,bottom-top));
    }
    const center={x:(left+right)/2,y:(top+bottom)/2};
    const cx=placement.x+size.width/2,cy=placement.y+size.height/2;
    let from,to;
    if(placement.x>=right){from=[placement.x,cy];to=[right+3,Math.max(top,Math.min(bottom,cy))];}
    else if(placement.x+size.width<=left){from=[placement.x+size.width,cy];to=[left-3,Math.max(top,Math.min(bottom,cy))];}
    else if(cy<center.y){from=[cx,placement.y+size.height];to=[Math.max(left,Math.min(right,cx)),top-3];}
    else{from=[cx,placement.y];to=[Math.max(left,Math.min(right,cx)),bottom+3];}
    arrow.setAttribute('d',`M ${from[0]} ${from[1]} Q ${from[0]} ${to[1]} ${to[0]} ${to[1]}`);
  }
  function schedule(){if(dialog.open && frame===null)frame=requestAnimationFrame(layout);}
  function showStep(){
    panel.open=index===1?true:saved.panelOpen;
    if(index===1)panel.scrollTop=0;
    // Close the temporary coordinates drawer on later steps, then restore it
    // on exit. This keeps the wavelength control visible on a small screen.
    if(index>1)panel.open=false;
    title.textContent=STEPS[index].title;text.textContent=STEPS[index].text;
    progress.textContent=`${index+1} of ${STEPS.length}`;
    back.disabled=index===0;next.textContent=index===0?'Show me around':index===STEPS.length-1?'Start exploring':'Next';
    schedule();
  }
  function start(){
    if(dialog.open)return;
    saved={panelOpen:panel.open,panelScroll:panel.scrollTop,focus:document.activeElement};
    index=0;showStep();dialog.showModal();schedule();next.focus({preventScroll:true});
  }
  next.addEventListener('click',()=>{if(index===STEPS.length-1)finish();else{index++;showStep();}});
  back.addEventListener('click',()=>{if(index>0){index--;showStep();}});
  document.getElementById('tour-skip').addEventListener('click',finish);
  dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish();});
  // Keep keyboard shortcuts on the layer so H/Escape never alter the viewer.
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  replay.addEventListener('click',start);
  window.addEventListener('resize',schedule);
  panel.addEventListener('scroll',schedule,{passive:true});
  const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
  resizeObserver?.observe(card);
  for(const step of STEPS){const target=step.target?document.querySelector(step.target):null;if(target)resizeObserver?.observe(target);}
  function tryStart(){
    if(autoAttempted || seen()){observer.disconnect();return;}
    const coordinates=document.getElementById('coordinate-fields');
    const mission=document.querySelector('[data-mission="spherex"]');
    if(coordinates.disabled || mission.disabled || mission.getAttribute('aria-pressed')!=='true')return;
    autoAttempted=true;observer.disconnect();start();
  }
  const observer=new MutationObserver(tryStart);
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['disabled','hidden','aria-pressed']});
  tryStart();
}

if(typeof document!=='undefined')installTour();
