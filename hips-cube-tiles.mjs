// HiPS plane zero uses the ordinary image tile name, without an "_0" suffix.
// The pinned Aladin 3.8.2 cube renderer requests that suffix for plane zero.
// Normalize transport URLs only: keep its internal channel indices intact.
const installations=new WeakMap();

export function blankCubeChannels(properties) {
  // Only honor explicit published metadata; an arbitrary 404 is still an error.
  const match=(properties.obs_description || '').match(/\bFrames?\s+(\d+(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)\d+)*)\s*(?:\([^)]*\)\s*)?(?:is|are)\s+blank\b/i);
  const depth=Number(properties.hips_cube_depth);
  return new Set((match?.[1].match(/\d+/g) || []).map(Number).filter(index=>index>=0 && index<depth));
}

export function cubeTileUrl(value,roots) {
  const text=String(value);
  for(const root of roots){
    const prefix=root.replace(/\/$/,'')+'/';
    if(!text.startsWith(prefix))continue;
    const url=new URL(text),relative=url.pathname.slice(new URL(prefix).pathname.length);
    if(/^Norder\d+\/(?:[^/]+\/)*(?:Npix\d+|Allsky)_0\.(?:png|jpe?g|webp|fits(?:\.gz)?)$/i.test(relative)){
      url.pathname=url.pathname.replace(/_0(?=\.[^/]+$)/,'');return url.href;
    }
  }
  return text;
}

export function registerCubeTileRoot(root,environment=window) {
  let roots=installations.get(environment);
  if(roots){roots.add(root);return;}
  roots=new Set([root]);
  const prototype=environment.HTMLImageElement?.prototype;
  const src=prototype && Object.getOwnPropertyDescriptor(prototype,'src');
  if(!src?.set || !src.configurable)throw new Error('This browser cannot normalize infrared cube tile URLs.');
  Object.defineProperty(prototype,'src',{...src,set(value){src.set.call(this,cubeTileUrl(value,roots));}});
  if(environment.fetch){
    const original=environment.fetch;
    environment.fetch=function(input,...args){
      const url=typeof input==='string'?input:input?.url || String(input),normalized=cubeTileUrl(url,roots);
      if(normalized!==url)input=typeof input?.url==='string'?new environment.Request(normalized,input):normalized;
      return original.call(this,input,...args);
    };
  }
  installations.set(environment,roots);
}
