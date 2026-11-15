// Small display-only previews of the IMAGE-only FITS already downloaded by the
// viewer. Science bytes and the WCS used for the main image are not modified.
export function sampleFitsPreview(buffer, cuts, width=96, height=60) {
  const view=new DataView(buffer),header={};
  const decoder=new TextDecoder('ascii');
  let offset=0,ended=false;
  while(offset+80<=buffer.byteLength){
    const card=decoder.decode(new Uint8Array(buffer,offset,80));offset+=80;
    const key=card.slice(0,8).trim();
    if(key==='END'){ended=true;break;}
    if(card.slice(8,10)==='= ')header[key]=Number(card.slice(10).split('/')[0].trim().replace(/[dD]/,'E'));
  }
  if(!ended)throw new Error('Incomplete FITS preview header.');
  const {NAXIS1:nx,NAXIS2:ny,BITPIX:bitpix,BSCALE:scale=1,BZERO:zero=0,BLANK:blank}=header;
  const bytes=Math.abs(bitpix)/8,start=Math.ceil(offset/2880)*2880;
  if(header.NAXIS!==2 || !Number.isSafeInteger(nx) || !Number.isSafeInteger(ny) || nx<1 || ny<1 ||
    ![-64,-32,8,16,32].includes(bitpix) || start+nx*ny*bytes>buffer.byteLength){
    throw new Error('Unsupported or truncated FITS preview.');
  }
  const readers={
    '-64':p=>view.getFloat64(p),'-32':p=>view.getFloat32(p),
    8:p=>view.getUint8(p),16:p=>view.getInt16(p),32:p=>view.getInt32(p)
  };
  const [low,high]=cuts || [];
  const pixels=new Uint8ClampedArray(width*height*4);
  const fit=Math.min(width/nx,height/ny),drawWidth=nx*fit,drawHeight=ny*fit;
  const left=(width-drawWidth)/2,top=(height-drawHeight)/2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*4;pixels[index+3]=255;
    if(x+.5<left || x+.5>=left+drawWidth || y+.5<top || y+.5>=top+drawHeight)continue;
    const sx=Math.min(nx-1,Math.floor((x+.5-left)/fit));
    // FITS row zero is at the bottom of the detector image.
    const sy=ny-1-Math.min(ny-1,Math.floor((y+.5-top)/fit));
    const raw=readers[bitpix](start+(sy*nx+sx)*bytes),value=raw*scale+zero;
    if(!Number.isFinite(value) || (bitpix>0 && raw===blank))continue;
    const grey=Number.isFinite(low) && Number.isFinite(high) && high>low
      ? Math.round(Math.max(0,Math.min(1,(value-low)/(high-low)))*255) : 128;
    pixels[index]=pixels[index+1]=pixels[index+2]=grey;
  }
  return {width,height,pixels};
}
