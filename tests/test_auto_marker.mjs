import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matrix3,Vector3} from 'three';
import {homography} from '../web/test/mono3d/geometry.js';
import {ID0_BITS,MARKER_BITS} from '../web/test/multi3d/aruco.js';
import {detectMarker,refineMarker,StableMarker} from '../web/test/multi3d/auto-marker.js';

function raster(corners,{W=320,H=260,noise=0,plain=false,contrast=200,bits=ID0_BITS}={}){
  const h=homography([[0,0],[6,0],[6,6],[0,6]],corners),inv=new Matrix3().set(...h.slice(0,3),...h.slice(3,6),h[6],h[7],1).invert();
  const data=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=new Vector3(x,y,1).applyMatrix3(inv),u=p.x/p.z,v=p.y/p.z;
    const c=Math.floor(u),r=Math.floor(v),inside=c>=0&&c<6&&r>=0&&r<6;
    const white=!inside||!plain&&c>0&&c<5&&r>0&&r<5&&bits[r-1][c-1];
    const value=25+(white?contrast:0)+noise*Math.sin(x*17+y*23),i=(y*W+x)*4;
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  return {data,W,H};
}
const base=[[62,40],[252,51],[240,221],[47,202]];
test('finds all four corners and canonical ID0 orientation under perspective and four rotations',()=>{
  for(let rotation=0;rotation<4;rotation++){
    const corners=[0,1,2,3].map(i=>base[(i+rotation)%4]),image=raster(corners,{noise:12});
    const got=detectMarker(image.data,image.W,image.H);assert.ok(got,`rotation ${rotation}`);
    assert.ok(got.every((p,i)=>Math.hypot(p[0]-corners[i][0],p[1]-corners[i][1])<3));
  }
});
test('plain rectangle, low contrast, clipped marker and multiple identical markers fail closed',()=>{
  for(const image of [raster(base,{plain:true}),raster(base,{contrast:20}),raster(base.map(p=>[p[0]-100,p[1]]))])assert.equal(detectMarker(image.data,image.W,image.H),null);
  const a=raster([[15,30],[130,30],[130,145],[15,145]]),b=raster([[175,60],[290,60],[290,175],[175,175]]);
  const data=new Uint8ClampedArray(a.data.length);for(let i=0;i<data.length;i++)data[i]=Math.min(a.data[i],b.data[i]);
  assert.equal(detectMarker(data,a.W,a.H),null);
});
test('requires consecutive stable video samples; loss, pauses and motion restart capture',()=>{
  const c=new StableMarker();for(let i=0;i<5;i++)assert.equal(c.add(base,i*180),null);
  assert.ok(c.add(base,900));c.reset();
  for(let i=0;i<4;i++)c.add(base,i*180);assert.equal(c.add(null,720),null);assert.equal(c.add(base,900),null);
  c.reset();for(let i=0;i<10;i++)assert.equal(c.add(base.map(p=>[p[0]+i*4,p[1]]),i*180),null);
  c.reset();c.add(base,0);assert.equal(c.add(base,1000),null);
});
test('wide stage: each phone finds only its own marker ID0/ID1/ID2 and ignores the neighbours',()=>{
  // Three markers side by side in one image, as a phone may see its neighbours' markers at the edges.
  const spots=[[[10,60],[95,60],[95,145],[10,145]],[[118,60],[203,60],[203,145],[118,145]],[[226,60],[311,60],[311,145],[226,145]]];
  const layers=spots.map((corners,id)=>raster(corners,{bits:MARKER_BITS[id]}));
  const data=new Uint8ClampedArray(layers[0].data.length);for(let i=0;i<data.length;i++)data[i]=Math.min(...layers.map(l=>l.data[i]));
  for(let id=0;id<3;id++){
    const got=detectMarker(data,320,260,id);assert.ok(got,`ID${id}`);
    assert.ok(got.every((p,i)=>Math.hypot(p[0]-spots[id][i][0],p[1]-spots[id][i][1])<3),`ID${id} corners`);
  }
  // A single marker of another id is not accepted, in any rotation.
  for(let rotation=0;rotation<4;rotation++){
    const corners=[0,1,2,3].map(i=>base[(i+rotation)%4]),image=raster(corners,{bits:MARKER_BITS[1]});
    assert.ok(detectMarker(image.data,image.W,image.H,1));
    assert.equal(detectMarker(image.data,image.W,image.H,0),null);assert.equal(detectMarker(image.data,image.W,image.H,2),null);
  }
  assert.equal(detectMarker(raster(base).data,320,260,7),null);
});

// Sub-pixel corners: anti-aliased (4x4 supersampled) and slightly blurred marker, like a real camera edge.
function smooth(corners,{W=320,H=260,bits=ID0_BITS,ss=4,blur=1,scale=1}={}){
  const h=homography([[0,0],[6,0],[6,6],[0,6]],corners),inv=new Matrix3().set(...h.slice(0,3),...h.slice(3,6),h[6],h[7],1).invert();
  let f=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let acc=0;
    for(let j=0;j<ss;j++)for(let i=0;i<ss;i++){const p=new Vector3((x+(i+.5)/ss)*scale,(y+(j+.5)/ss)*scale,1).applyMatrix3(inv),u=p.x/p.z,v=p.y/p.z;
      const c=Math.floor(u),r=Math.floor(v),inside=c>=0&&c<6&&r>=0&&r<6,white=!inside||c>0&&c<5&&r>0&&r<5&&bits[r-1][c-1];acc+=white?220:30;}
    f[y*W+x]=acc/ss/ss;}
  for(let b=0;b<blur;b++){const o=Float32Array.from(f);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;o[i]=(4*f[i]+2*(f[i-1]+f[i+1]+f[i-W]+f[i+W])+f[i-W-1]+f[i-W+1]+f[i+W-1]+f[i+W+1])/16;}f=o;}
  const data=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){data[4*i]=data[4*i+1]=data[4*i+2]=f[i]+6*Math.sin(i*12.9898);data[4*i+3]=255;}
  return {data,W,H};
}
const worst=(a,b)=>Math.max(...a.map((p,i)=>Math.hypot(p[0]-b[i][0],p[1]-b[i][1])));
test('refineMarker moves whole-pixel corners to the real edge (sub-pixel) and keeps the pattern order',()=>{
  for(let rotation=0;rotation<4;rotation++){
    const corners=[0,1,2,3].map(i=>base[(i+rotation)%4].map(v=>v+.37)),image=smooth(corners);
    const raw=detectMarker(image.data,image.W,image.H);assert.ok(raw,`rotation ${rotation}`);
    const fine=refineMarker(image.data,image.W,image.H,raw);
    assert.ok(worst(raw,corners)>.6,`raw ${worst(raw,corners)}`);
    assert.ok(worst(fine,corners)<.25,`rotation ${rotation} refined ${worst(fine,corners)}`);
  }
});
test('refineMarker finishes corners found on a downscaled copy at full resolution (judging phone scanner path)',()=>{
  const corners=[[124.3,80.6],[504.1,102.2],[480.7,442.4],[94.2,404.9]],full=smooth(corners,{W:640,H:520,ss:3});
  const half=smooth(corners,{W:320,H:260,ss:3,blur:0,scale:2}),rough=detectMarker(half.data,half.W,half.H);assert.ok(rough);
  const scaled=rough.map(p=>[p[0]*2,p[1]*2]);assert.ok(worst(scaled,corners)>1,`scaled ${worst(scaled,corners)}`);
  assert.ok(worst(refineMarker(full.data,full.W,full.H,scaled),corners)<.25);
});
test('refineMarker keeps the input when the edges are not a clear black square',()=>{
  const image=smooth(base),flat=new Uint8ClampedArray(image.data.length).fill(200);
  assert.deepEqual(refineMarker(flat,image.W,image.H,base),base);
  assert.equal(refineMarker(image.data,image.W,image.H,null),null);
});
