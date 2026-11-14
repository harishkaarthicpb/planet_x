// Reproducible local correction for the pinned Aladin Lite 3.8.2 WASM bundle.
// Usage: node scripts/patch-aladin-sip.cjs original-aladin.js vendor/aladin-lite-3.8.2.js
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const WASM_URL = /data:application\/wasm;base64,([A-Za-z0-9+/=]+)/;

function uleb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}

function inspectWasm(bytes) {
  let position = 8;
  const read = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[position++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    return value >>> 0;
  };
  const string = () => { const size = read(), start = position; position += size; return bytes.toString('utf8',start,position); };
  const sections = [];
  while (position < bytes.length) {
    const begin = position, id = bytes[position++], size = read(), start = position;
    sections.push({id,begin,start,end:start+size}); position += size;
  }
  const names = new Map();
  for (const section of sections.filter(s => s.id === 0)) {
    position = section.start;
    if (string() !== 'name') continue;
    while (position < section.end) {
      const id = bytes[position++], size = read(), end = position + size;
      if (id === 1) { const count = read(); for (let i=0;i<count;i++) { const index=read(); names.set(index,string()); } }
      position = end;
    }
  }
  const importedFunctions = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).filter(i => i.kind === 'function').length;
  const code = sections.find(s => s.id === 10);
  position = code.start;
  const count = read(), bodies = [];
  for (let i=0;i<count;i++) {
    const begin=position,size=read(),start=position;
    bodies.push({begin,start,end:start+size}); position += size;
  }
  return {sections,names,importedFunctions,bodies};
}

function extractWasm(source) {
  const match = source.match(WASM_URL);
  if (!match) throw new Error('The pinned embedded WASM bundle is missing.');
  return Buffer.from(match[1],'base64');
}

function patchBundle(source) {
  const expected = 'bed9c8ef1d1e83501b1cb782366092c72c5ecd1c88f16fef3166188ae8062066';
  if (createHash('sha256').update(source).digest('hex') !== expected) {
    throw new Error('Unexpected Aladin bundle: refusing to patch an unverified dependency.');
  }
  const bytes=extractWasm(source),meta=inspectWasm(bytes);
  const index=[...meta.names].find(([,name]) => name.startsWith('mapproj::sip::SipCoeff::p::'))?.[0];
  if (index === undefined) throw new Error('The pinned SIP evaluator is missing.');
  const body=meta.bodies[index-meta.importedFunctions];
  let corrected=bytes.subarray(body.start,body.end);
  const replace = (from,to) => {
    const old=Buffer.from(from,'hex'),replacement=Buffer.from(to,'hex'),at=corrected.indexOf(old);
    if (at<0 || corrected.indexOf(old,at+1)>=0) throw new Error('The pinned SIP instructions do not match.');
    corrected=Buffer.concat([corrected.subarray(0,at),replacement,corrected.subarray(at+old.length)]);
  };
  // Add local 13 (x^i), starting at x^0. Keep the original x argument intact.
  replace('02087f027c','02087f037c44000000000000f03f210d');
  // Each row starts at y^0; advance powers by multiplication, not squaring.
  replace('2002210c','44000000000000f03f210c');
  replace('200b2001200ca2','200b200d200ca2');
  replace('200c200ca2210c','200c2002a2210c');
  replace('20012001a22101','200d2001a2210d');
  const code=meta.sections.find(s => s.id === 10);
  const payload=Buffer.concat([bytes.subarray(code.start,body.begin),uleb(corrected.length),corrected,bytes.subarray(body.end,code.end)]);
  const patched=Buffer.concat([bytes.subarray(0,code.begin),Buffer.from([10]),uleb(payload.length),payload,bytes.subarray(code.end)]);
  if (!WebAssembly.validate(patched)) throw new Error('The corrected WASM module failed validation.');
  const notice='// Aladin Lite 3.8.2, LGPL-3.0-or-later, CDS/Unistra.\n' +
    '// Local SIP polynomial correction; see vendor/README.md and scripts/patch-aladin-sip.cjs.\n';
  return notice+source.replace(WASM_URL,`data:application/wasm;base64,${patched.toString('base64')}`);
}

if (require.main === module) {
  const [input,output]=process.argv.slice(2);
  if (!input || !output) throw new Error('Expected input and output bundle paths.');
  const result=patchBundle(fs.readFileSync(input,'utf8'));
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,result);
}
module.exports={inspectWasm,extractWasm,uleb,patchBundle};
