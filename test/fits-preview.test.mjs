import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sampleFitsPreview} from '../fits-preview.mjs';

function image(values,bitpix=-32,extra={}){
  const fields={SIMPLE:'T',BITPIX:bitpix,NAXIS:2,NAXIS1:2,NAXIS2:2,...extra};
  const text=Object.entries(fields).map(([key,value])=>`${key.padEnd(8)}= ${String(value).padStart(20)}`.padEnd(80)).join('')+'END'.padEnd(80);
  const bytes=new Uint8Array(2880+values.length*Math.abs(bitpix)/8);bytes.fill(32,0,2880);bytes.set(new TextEncoder().encode(text));
  const view=new DataView(bytes.buffer);
  values.forEach((value,index)=>bitpix===-32?view.setFloat32(2880+index*4,value):view.setInt16(2880+index*2,value));
  return bytes.buffer;
}

test('preview reads big-endian science pixels, flips FITS rows, and leaves NaNs black',()=>{
  const {pixels}=sampleFitsPreview(image([0,10,NaN,20]),[0,20],2,2);
  assert.deepEqual([...pixels],[0,0,0,255,255,255,255,255,0,0,0,255,128,128,128,255]);
});

test('preview respects integer scaling and missing-pixel values',()=>{
  const {pixels}=sampleFitsPreview(image([0,5,-999,10],16,{BSCALE:2,BZERO:10,BLANK:-999}),[10,30],2,2);
  assert.deepEqual([...pixels],[0,0,0,255,255,255,255,255,0,0,0,255,128,128,128,255]);
  assert.throws(()=>sampleFitsPreview(new ArrayBuffer(8),[0,1]),/Incomplete/);
});

test('genuine SPHEREx cutout produces a nonuniform thumbnail without modifying the FITS bytes',async()=>{
  const source=await readFile(new URL('./fixtures/spherex/2026-09-22-image.fits',import.meta.url));
  const buffer=source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),before=new Uint8Array(buffer).slice();
  const preview=sampleFitsPreview(buffer,[.2297091633,4.6622943878]);
  assert.equal(preview.pixels.length,96*60*4);
  const shades=new Set(Array.from(preview.pixels).filter((_,i)=>i%4===0));
  assert.ok(shades.size>20);
  assert.deepEqual(new Uint8Array(buffer),before);
});
