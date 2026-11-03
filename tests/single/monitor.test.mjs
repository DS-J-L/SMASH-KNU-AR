import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DisplayTransform } from '../../frontend/single/display-transform.js';
import { FrameCoordinator } from '../../frontend/single/frame-coordinator.js';
import { GameController, SINGLE_GATES } from '../../frontend/game/controller.js';
import { TargetProvider } from '../../frontend/single/target-provider.js';
import { LogBuffer } from '../../frontend/single/log-buffer.js';

test('T-SC-03 raw/display round trips for portrait, landscape, four rotations, mirrors and letterbox',()=>{
  for(const [iw,ih] of [[640,480],[480,640]])for(const [w,h] of [[1200,700],[375,600]])for(const rotation of [0,90,180,270])for(const mirror of [false,true]){
    const t=new DisplayTransform({imageWidth:iw,imageHeight:ih,width:w,height:h,rotation,mirror});
    for(const p of [[0,0],[1,0],[0,1],[1,1],[.3,.7]]){
      const q=t.toImage(t.toScreen(p));assert.ok(Math.hypot(q[0]-p[0],q[1]-p[1])<1e-12);
      const [a,b,c,d,e,f]=t.matrix, pixel=[p[0]*iw,p[1]*ih];
      const matrixPoint=[a*pixel[0]+c*pixel[1]+e,b*pixel[0]+d*pixel[1]+f];
      assert.ok(Math.hypot(...matrixPoint.map((v,i)=>v-t.toScreen(p)[i]))<1e-9);
    }
  }
  const t=new DisplayTransform({imageWidth:640,imageHeight:480,width:1000,height:1000});
  assert.equal(t.contains([500,0]),false);assert.equal(t.contains([500,500]),true);
  assert.throws(()=>new DisplayTransform({imageWidth:0,imageHeight:480,width:1,height:1}));
});

const ctx={room_id:'room',stream_id:'stream',server_epoch:'server',run_id:1,transform_version:1};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
const resource=()=>({closed:0,close(){this.closed++;}});
test('T-SC-04 single in flight/latest pending and one matched display resource',async()=>{
  let now=100;const tasks=[],shown=[];
  const q=new FrameCoordinator({now:()=>now,process:(r,m)=>{const d=deferred();tasks.push({d,m});return d.promise;},onMatched:(_r,m)=>shown.push(m.frame_id)});
  q.configure(ctx);const a=resource(),b=resource(),c=resource();
  for(const [i,r] of [a,b,c].entries())q.submit(r,{...ctx,frame_id:i+1,observed_at_pc_ms:100});
  assert.equal(tasks.length,1);assert.equal(b.closed,1);assert.equal(q.stats.maxPending,1);
  tasks[0].d.resolve(tasks[0].m);await turn();assert.deepEqual(shown,[1]);assert.equal(tasks.length,2);
  tasks[1].d.resolve(tasks[1].m);await turn();assert.deepEqual(shown,[1,3]);assert.equal(a.closed,1);assert.equal(c.closed,0);
  q.dispose();assert.equal(c.closed,1);
});
test('T-SC-04/06 discard old runs, exact TTL boundary, wrong pose keys and clean resources',async()=>{
  let now=100;const d=deferred(),shown=[];const q=new FrameCoordinator({now:()=>now,process:()=>d.promise,onMatched:()=>shown.push(1)});
  q.configure(ctx);const a=resource();q.submit(a,{...ctx,frame_id:1,observed_at_pc_ms:100});q.configure({...ctx,run_id:2});d.resolve({...ctx,frame_id:1});await turn();assert.equal(a.closed,1);assert.equal(shown.length,0);
  const stale=new FrameCoordinator({now:()=>now,process:async(_r,m)=>{now=300;return m;},onMatched:()=>assert.fail('stale display')});
  stale.configure(ctx);const b=resource();stale.submit(b,{...ctx,frame_id:2,observed_at_pc_ms:100});await turn();assert.equal(b.closed,1);
  const bad=new FrameCoordinator({now:()=>now,process:async()=>({...ctx,frame_id:9}),onMatched:()=>assert.fail('wrong pose')});
  bad.configure(ctx);const c=resource();bad.submit(c,{...ctx,frame_id:1,observed_at_pc_ms:300});await turn();assert.equal(bad.stats.failed,1);assert.equal(c.closed,1);
  const dup=resource();assert.equal(bad.submit(dup,{...ctx,frame_id:1,observed_at_pc_ms:300}),false);assert.equal(dup.closed,1);
});

function setup(options={}){
  let clock=1000,ids=0;const hits=[],logs=[];
  const game=new GameController({source:'synthetic',now:()=>clock,uuid:()=>`id-${++ids}`,onHit:e=>{hits.push(e);return true;},onLog:e=>logs.push(e),validateHit:()=>true,...options});
  game.bind(ctx);game.setGates(Object.fromEntries(SINGLE_GATES.map(k=>[k,true])));
  const pose=(id,wrists)=>({...ctx,schema:'single_camera.v1-draft',session_id:game.sessionId,task_type:'pilot',tracking_mode:'single_view_2d',source:'synthetic',frame_id:id,observed_at_pc_ms:clock,
    wrists:wrists??{left_wrist:{valid:true,image_norm:[.4,.5],visibility:1}}});
  const feed=id=>{clock+=50;return game.setPose(pose(id));};
  const start=async()=>{feed(1);assert.equal(await game.start(r=>({...r,type:'start_ack'})),true);feed(2);feed(3);};
  const event=(overrides={})=>({...ctx,schema:'single_camera.v1-draft',tracking_mode:'single_view_2d',source:'synthetic',task_type:'pilot',session_id:game.sessionId,
    event_id:'event',building_id:'it1',joint:'left_wrist',frame_id:3,previous_frame_id:2,hit_point_image_norm:[.5,.5],speed_norm_per_s:1.2,hit_point_m:null,speed_mps:null,...overrides});
  return {game,hits,logs,pose,feed,start,event,setTime:v=>{clock=v;},advance:v=>{clock+=v;}};
}
test('T-SC-10 ACK matching, no clock before ACK, late ACK after reset and malformed ACK',async()=>{
  const x=setup();x.feed(1);const d=deferred();let req;
  const pending=x.game.start(r=>{req=r;return d.promise;});await turn();assert.equal(x.game.phase,'starting');assert.equal(x.game.endsAt,0);
  assert.equal(x.game.acceptHit(x.event()).accepted,false);x.game.reset();d.resolve({...req,type:'start_ack'});assert.equal(await pending,false);assert.equal(x.game.sessionId,null);
  const y=setup();y.feed(1);assert.equal(await y.game.start(r=>({...r,type:'start_ack',stream_id:'other'})),false);assert.equal(y.game.reason,'ack_mismatch');
});
test('T-SC-10 timeout never starts and old ACK cannot start the replacement request',async()=>{
  const x=setup({startTimeoutMs:10});x.feed(1);const d=deferred();let req;
  assert.equal(await x.game.start(r=>{req=r;return d.promise;}),false);assert.equal(x.game.reason,'start_timeout');
  d.resolve({...req,type:'start_ack'});await turn();assert.equal(x.game.phase,'idle');
});
test('T-SC-11 exactly one score/effect for simultaneous hands, duplicates, old sessions and expiry',async()=>{
  const x=setup();await x.start();assert.equal(x.game.acceptHit(x.event()).accepted,true);assert.equal(x.game.acceptHit(x.event()).reject_reason,'duplicate_event');
  assert.equal(x.game.acceptHit(x.event({event_id:'second'})).reject_reason,'already_destroyed');assert.equal(x.game.score,100);assert.equal(x.hits.length,1);
  const y=setup();await y.start();assert.equal(y.game.acceptHit(y.event({session_id:'previous'})).accepted,false);
  y.setTime(y.game.endsAt);assert.equal(y.game.acceptHit(y.event()).accepted,false);assert.equal(y.game.phase,'ended');assert.equal(y.game.score,0);
});
test('T-SC-09/12 tracking/control/visibility failures block hits while time continues; recovery first point cannot hit',async()=>{
  const x=setup();await x.start();const deadline=x.game.endsAt;
  x.game.setGates({control_alive:false});assert.equal(x.game.acceptHit(x.event()).reject_reason,'not_ready');assert.equal(x.game.endsAt,deadline);
  x.game.setGates({control_alive:true});assert.equal(x.game.acceptHit(x.event(),{visible:false}).accepted,false);
  x.game.clearInput();x.feed(4);assert.equal(x.game.acceptHit(x.event({frame_id:4,previous_frame_id:3})).accepted,false);
  x.feed(5);assert.equal(x.game.acceptHit(x.event({frame_id:5,previous_frame_id:4})).accepted,true);
});
test('T-SC-06/14 stale, null, NaN, image bounds and metric-unit/source contamination fail closed',async()=>{
  for(const patch of [{source:'live'},{hit_point_m:[1,2,3]},{speed_mps:2},{speed_norm_per_s:NaN},{hit_point_image_norm:[1.1,.2]},{joint:'ankle'}]){
    const x=setup();await x.start();assert.equal(x.game.acceptHit(x.event(patch)).accepted,false,JSON.stringify(patch));assert.equal(x.game.score,0);
  }
  const y=setup();await y.start();y.advance(200);assert.equal(y.game.acceptHit(y.event()).accepted,false);
  const z=setup();await z.start();z.advance(10);z.game.setPose(z.pose(4,{left_wrist:{valid:false,image_norm:null,visibility:0}}));z.feed(5);
  assert.equal(z.game.acceptHit(z.event({frame_id:5,previous_frame_id:4})).accepted,false);
});
test('T-SC-12/13 changed stream or server epoch ends game, reset invalidates callbacks and scores',async()=>{
  const x=setup();await x.start();x.game.bind({...ctx,server_epoch:'restarted'});assert.equal(x.game.phase,'ended');assert.equal(x.game.reason,'binding_changed');
  x.game.reset();assert.equal(x.game.score,0);assert.equal(x.game.sessionId,null);assert.equal(x.game.seenEvents.size,0);
});
test('T-SC-08 target union excludes gaps, respects mirror/rotation and deactivation, clips behind camera',()=>{
  const root=new THREE.Group();for(const x of [-1,1]){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.5,1));mesh.position.x=x;root.add(mesh);}
  const camera=new THREE.PerspectiveCamera(50,1,.1,20);camera.position.z=5;camera.lookAt(0,0,0);
  const t=new DisplayTransform({imageWidth:640,imageHeight:480,width:800,height:800,rotation:90,mirror:true});
  const target=new TargetProvider('building');target.update(root,camera,t,2);assert.ok(target.triangles.length>0);
  assert.equal(target.contains(t.toImage([400,400])),false);
  const tri=target.triangles[0],center=[0,1].map(i=>(tri[0][i]+tri[1][i]+tri[2][i])/3);assert.equal(target.contains(center),true);
  target.active=false;assert.equal(target.contains(center),false);target.active=true;
  root.position.z=10;target.update(root,camera,t,3);assert.equal(target.triangles.length,0);
});
test('T-SC-15 bounded log buffer keeps loss counts without retaining frames or growing forever',()=>{
  const buffer=new LogBuffer(2);for(let i=0;i<20;i++)buffer.add({event_id:i});const data=buffer.export();
  assert.equal(data.dropped_log_count,18);assert.deepEqual(data.entries.map(e=>e.event_id),[18,19]);data.entries.pop();assert.equal(buffer.entries.length,2);
});
test('T-SC-16 keyboard controller keeps ready/autostart/100 points/expiry/reset behavior',()=>{
  let now=0;const game=new GameController({trackingMode:'keyboard_demo',source:'synthetic',now:()=>now,uuid:()=>String(now)});
  assert.equal(game.acceptKeyboard('a','it1'),true);assert.equal(game.score,100);assert.equal(game.acceptKeyboard('b','it1'),false);
  now=60000;game.tick();assert.equal(game.phase,'ended');game.reset();assert.equal(game.phase,'ready');assert.equal(game.acceptKeyboard('a','it1'),true);
});

test('T-SC-04 consumer refusal and changed dimensions never replace a matched display',async()=>{
  const q=new FrameCoordinator({now:()=>100,process:async(_r,m)=>m,onMatched:()=>false});q.configure(ctx);
  const a=resource();q.submit(a,{...ctx,frame_id:1,observed_at_pc_ms:100});await turn();assert.equal(a.closed,1);assert.equal(q.displayed,null);
  const bad=new FrameCoordinator({now:()=>100,process:async(_r,m)=>({...m,image_width:1280}),onMatched:()=>assert.fail('bad dimensions')});bad.configure(ctx);
  const b=resource();bad.submit(b,{...ctx,frame_id:2,image_width:640,observed_at_pc_ms:100});await turn();assert.equal(b.closed,1);assert.equal(bad.stats.failed,1);
});
test('T-SC-15 logger outage does not repeat or cancel the accepted effect or score',async()=>{
  const x=setup({onLog:()=>{throw new Error('logger_down');}});await x.start();
  assert.equal(x.game.acceptHit(x.event()).accepted,true);assert.equal(x.game.score,100);assert.equal(x.game.logFailed,true);
  assert.equal(x.game.acceptHit(x.event()).accepted,false);assert.equal(x.hits.length,1);
});
