const { createHash } = require('node:crypto');
const BLOCK = 2880;
const padded = size => Math.ceil(size / BLOCK) * BLOCK;

function cardValue(card) {
  if (card.slice(8,10) !== '= ') return undefined;
  const text = card.slice(10).trim();
  if (text.startsWith("'")) {
    const match = text.match(/^'((?:[^']|'')*)'/);
    return match?.[1].replace(/''/g,"'").trim();
  }
  const value = text.split('/')[0].trim();
  if (value === 'T' || value === 'F') return value === 'T';
  const n = Number(value.replace(/[dD]/,'E'));
  return value && Number.isFinite(n) ? n : value;
}

function inspectFits(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.toString('ascii',0,8) !== 'SIMPLE  ') throw new Error('IRSA did not return a FITS file.');
  const hdus = [];
  let offset = 0;
  while (offset < buffer.length) {
    const header = {}, cards = [];
    let position = offset, ended = false;
    while (position + 80 <= buffer.length) {
      const card = buffer.toString('ascii',position,position+80);
      position += 80; cards.push(card);
      const key = card.slice(0,8).trim();
      if (key === 'END') { ended = true; break; }
      const value = cardValue(card);
      if (value !== undefined) header[key] = value;
    }
    if (!ended) throw new Error('Truncated FITS header.');
    const axesCount = header.NAXIS;
    if (!Number.isInteger(axesCount) || axesCount < 0 || axesCount > 16) throw new Error('Invalid FITS NAXIS.');
    const axes = Array.from({length:axesCount},(_,i)=>header[`NAXIS${i+1}`]);
    if (axes.some(n=>!Number.isSafeInteger(n)||n<0)) throw new Error('Invalid FITS dimensions.');
    const pixels = axes.length ? axes.reduce((a,b)=>a*b,1) : 0;
    const bytesPerPixel = Math.abs(header.BITPIX)/8;
    if (![1,2,4,8].includes(bytesPerPixel)) throw new Error('Unsupported FITS BITPIX.');
    const dataBytes = (pixels + (header.PCOUNT || 0)) * (header.GCOUNT || 1) * bytesPerPixel;
    const dataStart = offset + padded(position-offset);
    const next = dataStart + padded(dataBytes);
    if (!Number.isSafeInteger(dataBytes) || next > buffer.length) throw new Error('Truncated FITS data.');
    hdus.push({index:hdus.length,name:header.EXTNAME || 'PRIMARY',type:header.XTENSION || 'PRIMARY',axes,header,cards,dataStart,dataBytes});
    offset = next;
  }
  return hdus;
}

function imageStatistics(buffer, hdu) {
  const {BITPIX:bitpix, BSCALE:scale=1, BZERO:zero=0, BLANK:blank} = hdu.header;
  const bytes = buffer.subarray(hdu.dataStart,hdu.dataStart+hdu.dataBytes);
  const step = Math.abs(bitpix)/8;
  const read = bitpix === -32 ? p=>bytes.readFloatBE(p) : bitpix === -64 ? p=>bytes.readDoubleBE(p)
    : bitpix === 8 ? p=>bytes[p] : bitpix === 16 ? p=>bytes.readInt16BE(p) : bitpix === 32 ? p=>bytes.readInt32BE(p) : null;
  let finitePixels=0,min=Infinity,max=-Infinity;
  if (read) for (let p=0;p<bytes.length;p+=step) {
    const raw=read(p); if ((bitpix>0 && raw===blank) || !Number.isFinite(raw)) continue;
    const value=raw*scale+zero; if (!Number.isFinite(value)) continue;
    finitePixels++;min=Math.min(min,value);max=Math.max(max,value);
  }
  return {finitePixels, min:finitePixels?min:null,max:finitePixels?max:null,
    pixelSha256:createHash('sha256').update(bytes).digest('hex')};
}

function extractImage(buffer) {
  const hdus = inspectFits(buffer);
  const image = hdus.find(h=>h.name==='IMAGE' && h.type==='IMAGE' && h.axes.length===2);
  if (!image) throw new Error('The FITS file has no uncompressed two-dimensional IMAGE extension.');
  if (!image.header.CTYPE1 || !image.header.CTYPE2) throw new Error('The IMAGE extension has no celestial WCS.');
  // Repackage the original science array as a primary HDU. Copy its spatial WCS
  // and all pixel bytes verbatim. No resampling, stretching, or sharpening.
  const omit = new Set(['XTENSION','PCOUNT','GCOUNT','CHECKSUM','DATASUM','END']);
  const cards = ['SIMPLE  =                    T'.padEnd(80),
    ...image.cards.filter(c=>!omit.has(c.slice(0,8).trim())), 'END'.padEnd(80)];
  const headerText=cards.join('');
  const header=Buffer.alloc(padded(headerText.length),32);header.write(headerText,'ascii');
  const pixels=buffer.subarray(image.dataStart,image.dataStart+image.dataBytes);
  const imageBytes=Buffer.concat([header,pixels,Buffer.alloc(padded(pixels.length)-pixels.length)]);
  const summary = {
    hdus:hdus.map(({index,name,type,axes,dataBytes})=>({index,name,type,axes,dataBytes})),
    image:{index:image.index,name:image.name,axes:image.axes,bitpix:image.header.BITPIX,
      ctype:[image.header.CTYPE1,image.header.CTYPE2],unit:image.header.BUNIT || null,
      wcs:Object.fromEntries(Object.entries(image.header).filter(([key]) =>
        /^(RADESYS|EQUINOX|LONPOLE|LATPOLE|WCSAXES|NAXIS[12]|CTYPE[12]|CUNIT[12]|CRPIX[12]|CRVAL[12]|CDELT[12]|CROTA[12]|(?:CD|PC)[12]_[12]|[AB]P?_(ORDER|\d+_\d+))$/.test(key))),
      ...imageStatistics(buffer,image)},
    sourceBytes:buffer.length,displayBytes:imageBytes.length
  };
  return {imageBytes,summary};
}
module.exports={inspectFits,extractImage,imageStatistics};
