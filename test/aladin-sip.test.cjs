const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {inspectFits}=require('../fits-image');
const {angularSeparationDegrees}=require('../sky-region.mjs');
const {wcsProbe}=require('./helpers/aladin-wcs.cjs');
const source=fs.readFileSync(require.resolve('../vendor/aladin-lite-3.8.2.js'),'utf8');
const probe=wcsProbe(source);

test('native SIP evaluator includes constant terms and advances ordinary powers',async()=>{
  const native=await probe;
  // Coefficient order: 1, y, y², y³, x, xy, xy², x², x²y, x³.
  const coefficients=[1,2,3,4,5,6,7,8,9,10];
  for(const [x,y]of [[0,0],[2,3],[-81,-389],[.2,-.7]]){
    const expected=1+2*y+3*y*y+4*y**3+5*x+6*x*y+7*x*y*y+8*x*x+9*x*x*y+10*x**3;
    const actual=native.polynomial(coefficients,3,x,y);
    assert.ok(Math.abs(actual-expected)<=Math.max(1e-10,Math.abs(expected)*1e-12),`${actual} != ${expected}`);
  }
});

// Independent FITS TAN-SIP forward equations: polynomial in reference-pixel
// offsets, linear matrix in degrees, then inverse gnomonic projection.
function standardTanSip(header,[x,y]){
  const u=x-header.CRPIX1,v=y-header.CRPIX2;
  const polynomial=prefix=>Object.entries(header).reduce((sum,[key,value])=>{
    const match=key.match(new RegExp(`^${prefix}_(\\d+)_(\\d+)$`));
    return match ? sum+value*u**Number(match[1])*v**Number(match[2]) : sum;
  },0);
  const a=u+polynomial('A'),b=v+polynomial('B'),rad=Math.PI/180;
  const coefficient=(i,j)=>header[`CD${i}_${j}`]??(header[`CDELT${i}`]??1)*(header[`PC${i}_${j}`]??(i===j?1:0));
  const xi=(coefficient(1,1)*a+coefficient(1,2)*b)*rad;
  const eta=(coefficient(2,1)*a+coefficient(2,2)*b)*rad;
  const alpha=header.CRVAL1*rad,delta=header.CRVAL2*rad;
  const denominator=Math.cos(delta)-eta*Math.sin(delta);
  return [((alpha+Math.atan2(xi,denominator))/rad+360)%360,
    Math.atan2(Math.sin(delta)+eta*Math.cos(delta),Math.hypot(denominator,xi))/rad];
}

test('reported D2 cutout retains its pixels and native WCS matches TAN-SIP at center and corners',async()=>{
  const bytes=fs.readFileSync(require.resolve('./fixtures/spherex/2026-09-22-image.fits'));
  const [hdu]=inspectFits(bytes),header=hdu.header;
  const pixels=bytes.subarray(hdu.dataStart,hdu.dataStart+hdu.dataBytes);
  assert.equal(createHash('sha256').update(pixels).digest('hex'),'ef55acc371f8432a6f6894aecf7e60dea3c4ea629414c0c25b9bec3e8807335e');
  const points=[[107.5,107.5],[.5,.5],[214.5,.5],[214.5,214.5],[.5,214.5]];
  const actual=(await probe).unproject(header,points);
  points.forEach((point,index)=>{
    const expected=standardTanSip(header,point);
    assert.ok(angularSeparationDegrees(actual[index],expected)<1e-8,`${actual[index]} != ${expected}`);
  });
  assert.ok(angularSeparationDegrees(actual[0],[60.44222703421171,54.54087028244997])<.003);
});
