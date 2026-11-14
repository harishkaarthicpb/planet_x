// Independent, serial diagnosis. No web server or browser is required.
const {parseArgs}=require('node:util');
const fs=require('node:fs/promises');
const path=require('node:path');
const {searchObservations,cutoutUrl,downloadCutout}=require('../spherex-observations');
(async()=>{
 const {values}=parseArgs({options:{ra:{type:'string',default:'210.80227'},dec:{type:'string',default:'54.34895'},mode:{type:'string',default:'point'},out:{type:'string',default:'/private/tmp/planetx-search-check'},download:{type:'string',default:'1'}}});
 const ra=Number(values.ra),dec=Number(values.dec),count=Number(values.download);
 if (!(ra>=0 && ra<360 && dec>-89.9 && dec<89.9 && ['point','rectangle'].includes(values.mode) && [0,1,2].includes(count))) throw new Error('Expected valid --ra/--dec, --mode point|rectangle, --download 0|1|2.');
 const {regionFromCorners}=await import('../sky-region.mjs');
 const dx=.025/Math.cos(dec*Math.PI/180),wrap=n=>(n+360)%360;
 const region=regionFromCorners([[wrap(ra-dx),dec-.025],[wrap(ra+dx),dec-.025],[wrap(ra+dx),dec+.025],[wrap(ra-dx),dec+.025]]);
 await fs.mkdir(values.out,{recursive:true});
 const result=await searchObservations(region,{mode:values.mode});
 await fs.writeFile(path.join(values.out,'search.json'),JSON.stringify(result,null,2));
 // Search completes first. Downloads are serial and can be limited to ONE.
 for (let i=0;i<count;i++) {
   const resultImage=await downloadCutout(cutoutUrl(result.selected[i],region,.05),{requestId:result.requestId});
   await fs.writeFile(path.join(values.out,`observation-${i}-original.fits`),resultImage.rawBytes);
   await fs.writeFile(path.join(values.out,`observation-${i}-image.fits`),resultImage.imageBytes);
   await fs.writeFile(path.join(values.out,`observation-${i}-fits.json`),JSON.stringify(resultImage.summary,null,2));
 }
 console.log(`Saved search and ${count} verified IMAGE extension(s) to ${values.out}`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
