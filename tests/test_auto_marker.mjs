import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matrix3,Vector3} from 'three';
import {homography} from '../web/test/mono3d/geometry.js';
import {ID0_BITS} from '../web/test/multi3d/aruco.js';
import {detectMarker,StableMarker} from '../web/test/multi3d/auto-marker.js';

function raster(corners,{W=320,H=260,noise=0,plain=false,contrast=200}={}){
  const h=homography([[0,0],[6,0],[6,6],[0,6]],corners),inv=new Matrix3().set(...h.slice(0,3),...h.slice(3,6),h[6],h[7],1).invert();
  const data=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=new Vector3(x,y,1).applyMatrix3(inv),u=p.x/p.z,v=p.y/p.z;
    const c=Math.floor(u),r=Math.floor(v),inside=c>=0&&c<6&&r>=0&&r<6;
    const white=!inside||!plain&&c>0&&c<5&&r>0&&r<5&&ID0_BITS[r-1][c-1];
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
