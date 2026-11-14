// Run the pinned native WCS code directly in Node, without WebGL or a browser.
// Test-only exports expose internal routines; the shipped module is unmodified
// apart from the SIP correction documented in vendor/README.md.
const {inspectWasm,extractWasm,uleb}=require('../../scripts/patch-aladin-sip.cjs');

async function wcsProbe(source) {
  const bytes=extractWasm(source),meta=inspectWasm(bytes);
  const exportsToAdd={
    parse:'<wcs::params::_::<impl serde_core::de::Deserialize for wcs::params::WCSParams>::deserialize::__Visitor as serde_core::de::Visitor>::visit_map::h551ba5e54a16a46c',
    create:'wcs::WCSProj::new::', unproject:'wcs::WCSProj::unproj_lonlat::', polynomial:'mapproj::sip::SipCoeff::p::'
  };
  const additions=Object.entries(exportsToAdd).map(([label,prefix])=>{
    const index=[...meta.names].find(([,name])=>name.startsWith(prefix))?.[0];
    if(index===undefined)throw new Error(`Missing pinned WCS symbol: ${prefix}`);
    const name=Buffer.from(label);
    return Buffer.concat([uleb(name.length),name,Buffer.from([0]),uleb(index)]);
  });
  const section=meta.sections.find(s=>s.id===7);
  let p=section.start,count=0,shift=0,byte;
  do{byte=bytes[p++];count|=(byte&127)<<shift;shift+=7;}while(byte&128);
  const payload=Buffer.concat([uleb(count+additions.length),bytes.subarray(p,section.end),...additions]);
  const moduleBytes=Buffer.concat([bytes.subarray(0,section.begin),Buffer.from([7]),uleb(payload.length),payload,bytes.subarray(section.end)]);
  let native;
  // wasm-bindgen's reserved values, followed by test-owned JS handles.
  const values=Array(128).fill(undefined).concat([undefined,null,true,false]);
  const add=value=>{values.push(value);return values.length-1;};
  const view=()=>new DataView(native.memory.buffer);
  const text=(ptr,size)=>Buffer.from(native.memory.buffer,ptr,size).toString('utf8');
  const imports={};
  for(const entry of WebAssembly.Module.imports(new WebAssembly.Module(moduleBytes))){
    imports[entry.module]??={};
    imports[entry.module][entry.name]=(...args)=>{
      const name=entry.name;
      if(name==='__wbindgen_string_new')return add(text(...args));
      if(name.startsWith('__wbg_getwithrefkey'))return add(values[args[0]]?.[values[args[1]]]);
      if(name.startsWith('__wbg_has_'))return values[args[1]] in values[args[0]];
      if(name.startsWith('__wbg_isSafeInteger'))return Number.isSafeInteger(values[args[0]]);
      if(name==='__wbindgen_jsval_loose_eq')return values[args[0]]==values[args[1]];
      if(name==='__wbindgen_is_undefined')return values[args[0]]===undefined;
      if(name==='__wbindgen_is_object')return values[args[0]]!==null && typeof values[args[0]]==='object';
      if(name==='__wbindgen_is_string')return typeof values[args[0]]==='string';
      if(name==='__wbindgen_is_bigint')return typeof values[args[0]]==='bigint';
      if(name==='__wbindgen_object_clone_ref')return add(values[args[0]]);
      if(name==='__wbindgen_object_drop_ref')return;
      if(name==='__wbindgen_number_get'){
        const number=values[args[1]];
        view().setInt32(args[0],typeof number==='number'?1:0,true);
        view().setFloat64(args[0]+8,typeof number==='number'?number:0,true);return;
      }
      if(name==='__wbindgen_string_get'){
        const value=values[args[1]];let ptr=0,size=0;
        if(typeof value==='string'){
          const data=Buffer.from(value);size=data.length;ptr=native.__wbindgen_malloc(size,1);
          new Uint8Array(native.memory.buffer,ptr,size).set(data);
        }
        view().setInt32(args[0],ptr,true);view().setInt32(args[0]+4,size,true);return;
      }
      if(name==='__wbindgen_error_new')throw new Error(text(...args));
      throw new Error(`Unexpected native import in WCS-only test: ${name}`);
    };
  }
  native=(await WebAssembly.instantiate(moduleBytes,imports)).instance.exports;
  const allocate=size=>{
    const ptr=native.__wbindgen_malloc(size,8);
    new Uint8Array(native.memory.buffer,ptr,size).fill(0);return ptr;
  };
  return {
    unproject(header,points){
      const keys=Object.keys(header),list=allocate(keys.length*8);
      keys.forEach((key,index)=>{
        const data=Buffer.from(key),ptr=allocate(data.length);
        new Uint8Array(native.memory.buffer,ptr,data.length).set(data);
        view().setInt32(list+index*8,ptr,true);view().setInt32(list+index*8+4,data.length,true);
      });
      const map=allocate(24),params=allocate(4096),result=allocate(8192),output=allocate(32);
      view().setInt32(map+8,list,true);view().setInt32(map+12,list+keys.length*8,true);view().setInt32(map+16,add(header),true);
      native.parse(result,map);
      // Exact WCSParams layout in the pinned binary, populated by its own
      // serde visitor rather than by a second implementation of FITS parsing.
      new Uint8Array(native.memory.buffer,params,2968).set(new Uint8Array(native.memory.buffer,result,2968));
      native.create(result,BigInt(header.NAXIS1),BigInt(header.NAXIS2),params);
      return points.map(([x,y])=>{
        native.unproject(output,result,x,y);
        if(view().getInt32(output,true)!==1)throw new Error('The native WCS could not unproject this pixel.');
        return [view().getFloat64(output+8,true)*180/Math.PI,view().getFloat64(output+16,true)*180/Math.PI];
      });
    },
    polynomial(coefficients,order,x,y){
      const data=allocate(coefficients.length*8),state=allocate(16);
      new Float64Array(native.memory.buffer,data,coefficients.length).set(coefficients);
      view().setInt32(state,data,true);view().setInt32(state+4,coefficients.length,true);view().setUint16(state+8,order+1,true);
      return native.polynomial(state,x,y);
    }
  };
}
module.exports={wcsProbe};
