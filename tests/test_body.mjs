import assert from 'node:assert/strict';
import test from 'node:test';
import {BODY_NAMES,extractBody,extractHead,drawBody} from '../web/camera/body.js';

test('only body indices 11..32 are extracted; missing/offscreen joints stay null',()=>{
  const landmarks=Array.from({length:33},(_,i)=>({x:i/100,y:0.5,visibility:0.9}));
  const body=extractBody({landmarks:[landmarks]},1000,500);
  assert.equal(Object.keys(body).length,22);assert.equal(body.left_shoulder.u_px,110);
  assert.equal(body.right_foot_index.u_px,320);
  assert.equal(body.nose,undefined);assert.equal(body.left_eye,undefined);
  landmarks[11].x=2;landmarks[12].visibility=NaN;
  const invalid=extractBody({landmarks:[landmarks]},1000,500);
  assert.equal(invalid.left_shoulder,null);assert.equal(invalid.right_shoulder,null);
  assert.ok(Object.values(extractBody({},100,100)).every(v=>v===null));
});

test('skeleton draws only valid connected body points and scales to outgoing size',()=>{
  const body=Object.fromEntries(BODY_NAMES.map(n=>[n,null]));
  body.left_shoulder={u_px:100,v_px:200,visibility:0.9};
  body.left_elbow={u_px:200,v_px:300,visibility:0.9};
  body.left_wrist={u_px:300,v_px:400,visibility:0.1};
  const points=[],lines=[];const ctx={beginPath(){},moveTo(...p){lines.push(p);},lineTo(...p){lines.push(p);},stroke(){},arc(...p){points.push(p);},fill(){}};
  drawBody({width:500,height:250,getContext:()=>ctx},body,1000,500);
  assert.equal(points.length,2);assert.deepEqual(lines,[[50,100],[100,150]]);
});

test('head transmits only one position with ears, eyes and nose fallback',()=>{
  const points=[];points[7]={x:0.2,y:0.3,visibility:0.9};points[8]={x:0.4,y:0.3,visibility:0.8};
  const result={landmarks:[points]};
  assert.deepEqual(extractHead(result,1000,500),{u_px:300,v_px:150,visibility:0.8});
  points[8]=null;points[0]={x:0.3,y:0.4,visibility:0.9};
  assert.equal(extractHead(result,1000,500).v_px,200);
  assert.equal(extractHead({},1000,500),null);
  const arcs=[],ctx={beginPath(){},arc(...p){arcs.push(p);},fill(){}};
  drawBody({width:500,height:250,getContext:()=>ctx},{},1000,500,extractHead(result,1000,500));
  assert.equal(arcs.length,1);assert.equal(arcs[0][0],150);assert.equal(ctx.fillStyle,'#ffe08a');
});
