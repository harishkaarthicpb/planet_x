import test from 'node:test';
import assert from 'node:assert/strict';
import {cubeTileUrl,registerCubeTileRoot,blankCubeChannels} from '../hips-cube-tiles.mjs';
import {observeSurveyTiles} from '../spectrum-buffer.mjs';
const root='https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';

test('only explicitly documented in-range blank frames are classified as missing data',()=>{
  const properties={hips_cube_depth:'102',obs_description:'Frames 50 and 51 (band 3 channel 17, band 4 channel 1, the dichroic channels) are blank.'};
  assert.deepEqual([...blankCubeChannels(properties)],[50,51]);
  assert.deepEqual([...blankCubeChannels({...properties,obs_description:'Frame 102 is blank.'})],[]);
  assert.deepEqual([...blankCubeChannels({...properties,obs_description:'Some files are missing.'})],[]);
});

test('reported zero-frame tile URLs become the real unsuffixed archive filenames',()=>{
  for(const [order,pixel] of [[5,5716],[2,89],[5,5358]]){
    assert.equal(cubeTileUrl(`${root}/Norder${order}/Dir0/Npix${pixel}_0.png`,[root]),`${root}/Norder${order}/Dir0/Npix${pixel}.png`);
  }
  assert.equal(cubeTileUrl(root+'/Norder3/Allsky_0.png',[root]),root+'/Norder3/Allsky.png');
});

test('all 102 channel indices are preserved without shifting the first or last band',()=>{
  for(let channel=0;channel<102;channel++){
    const url=`${root}/Norder5/Dir0/Npix5716_${channel}.png`;
    assert.equal(cubeTileUrl(url,[root]),`${root}/Norder5/Dir0/Npix5716${channel?'_'+channel:''}.png`);
  }
  const other='https://example.com/cube/Norder5/Dir0/Npix5716_0.png';
  assert.equal(cubeTileUrl(other,[root]),other);
  assert.equal(cubeTileUrl(root+'/preview_0.png',[root]),root+'/preview_0.png');
  assert.equal(cubeTileUrl(root+'/Norder5/Dir0/Npix5716_0.png?version=1',[root]),root+'/Norder5/Dir0/Npix5716.png?version=1');
});

function environment(){
  class Image extends EventTarget {get src(){return this.url;}set src(value){this.url=value;}}
  const requests=[];
  return {HTMLImageElement:Image,Request,requests,fetch:async(input,options)=>{
    requests.push({input,options});return {ok:true,clone:()=>({arrayBuffer:async()=>new ArrayBuffer(0)})};
  }};
}

test('both image and fetch transports normalize zero tiles and preserve request options',async()=>{
  const env=environment();registerCubeTileRoot(root,env);
  const url=root+'/Norder5/Dir0/Npix5716_0.png',expected=root+'/Norder5/Dir0/Npix5716.png';
  const image=new env.HTMLImageElement();image.src=url;assert.equal(image.src,expected);
  const controller=new AbortController(),options={signal:controller.signal,credentials:'omit'};
  await env.fetch(url,options);assert.equal(env.requests[0].input,expected);assert.equal(env.requests[0].options,options);
  const request=new Request(url,{headers:{'X-Test':'preserved'}});
  await env.fetch(request);assert.equal(env.requests[1].input.url,expected);
  assert.equal(env.requests[1].input.headers.get('X-Test'),'preserved');
});

test('normalization remains active after the temporary spectrum tracker restores its hooks',async()=>{
  const env=environment();registerCubeTileRoot(root,env);
  const tracker=observeSurveyTiles(root,env),image=new env.HTMLImageElement();
  image.src=root+'/Norder2/Dir0/Npix89_0.png';assert.equal(tracker.pending,1);
  assert.equal(image.src,root+'/Norder2/Dir0/Npix89.png');
  image.dispatchEvent(new Event('load'));assert.equal(tracker.pending,0);tracker.dispose();
  const next=new env.HTMLImageElement();next.src=root+'/Norder2/Dir0/Npix89_0.png';
  assert.equal(next.src,root+'/Norder2/Dir0/Npix89.png');
  await env.fetch(root+'/Norder2/Dir0/Npix89_0.png');
  assert.equal(env.requests.at(-1).input,root+'/Norder2/Dir0/Npix89.png');
});
