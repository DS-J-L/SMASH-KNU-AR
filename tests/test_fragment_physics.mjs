import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FragmentPhysics,initPhysics} from '../frontend/building-test/fragment-physics.js';
await initPhysics();
const place={x_m:0,y_m:0,yaw_deg:0,scale:1};
const vertices=[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].flatMap(z=>[x*.1,y*.1,z*.1])));
const cubes={fragments:[.1,.6].map((y,id)=>({fragment_id:id,node:`cube${id}`,rest_position_m:[0,y,0],vertices_m:vertices,density_kg_m3:200}))};
const run=(p,n=300)=>{for(let i=0;i<n;i++)p.step(1/60);};
const height=(p,id=1)=>p.records.get(id).body.translation().z;

test('gravity, floor, rotation and sleep; restore makes no dynamic pieces',()=>{
  const p=new FragmentPhysics(cubes,place);p.release([1],{kind:'wrist',fragment_id:1,direction:[1,0,0]});
  const q=p.records.get(1).body.rotation();
  for(let i=0;i<720;i++){p.release([1]);p.step(1/60);} // repeated network snapshots must not wake sleepers
  const stats=p.snapshot();assert.ok(stats.finite);assert.ok(stats.minZ>-.025);
  assert.ok(stats.sleeping>0);assert.notEqual(p.records.get(1).body.rotation().w,q.w);
  p.dispose();const fresh=new FragmentPhysics(cubes,place);assert.equal(fresh.snapshot().dynamic,0);assert.equal(fresh.snapshot().bodies,3);fresh.dispose();
});

test('turning off gravity and floor has physically distinct outcomes',()=>{
  const floating=new FragmentPhysics(cubes,place,{gravity:false});floating.release([1]);run(floating);assert.ok(Math.abs(height(floating)-.6)<.001);floating.dispose();
  const falling=new FragmentPhysics(cubes,place,{floor:false,building:false});falling.release([1]);run(falling,120);assert.ok(height(falling)<-1);falling.dispose();
});

test('fixed building and dynamic debris collision switches change stacking',()=>{
  for(const movingBase of [false,true]){
    const tops=[];
    for(const enabled of [false,true]){
      const p=new FragmentPhysics(cubes,place,{rotation:false,building:enabled,debris:enabled});
      p.release(movingBase?[0,1]:[1]);run(p,360);tops.push(height(p));p.dispose();
    }
    assert.ok(tops[1]>tops[0]+.15,JSON.stringify({movingBase,tops}));
  }
});

test('rotation lock, sleep off, fixed step time budget and finite state',()=>{
  const p=new FragmentPhysics(cubes,place,{rotation:false,sleep:false});p.release([1],{kind:'wrist',fragment_id:1,direction:[0,1,0]});
  const initial=p.records.get(1).body.rotation();run(p,600);
  assert.equal(p.snapshot().sleeping,0);assert.ok(Math.abs(p.records.get(1).body.rotation().w-initial.w)<1e-6);
  const steps=p.steps;p.step(5);assert.ok(p.steps-steps<=4);assert.ok(p.droppedTime>4);assert.ok(p.snapshot().finite);p.dispose();
});

test('falling debris reports force against a remaining fixed fragment',()=>{
  const p=new FragmentPhysics(cubes,place);const forces=[];
  p.onImpact=(id,force)=>forces.push({id,force});p.release([1]);run(p,180);
  assert.ok(forces.some(e=>e.id===0&&e.force>=8));p.dispose();
});

test('mouse push follows the ray without lift; duplicate events do not double push, released pieces can be pushed again',()=>{
  const p=new FragmentPhysics(cubes,place,{gravity:false,floor:false,building:false,debris:false});p.release([1]);
  const centre=p.records.get(1).body.translation(),event={event_id:'mouse1',fragment_id:1,direction:[1,0,0],point_m:[centre.x,centre.y,centre.z],strength:3};
  p.push(event);let v=p.records.get(1).body.linvel();assert.ok(v.x>2.9);assert.ok(Math.abs(v.z)<1e-6);
  p.push(event);assert.equal(p.records.get(1).body.linvel().x,v.x);
  p.push({...event,event_id:'mouse2'});assert.ok(p.records.get(1).body.linvel().x>5.9);
  p.push({...event,event_id:'mouse3',strength:6});assert.ok(p.records.get(1).body.linvel().x>11.9);assert.ok(p.records.get(1).body.linvel().x<=24.001);assert.equal(p.snapshot().mousePushes,3);p.dispose();
});

test('tracked wrist pushes released debris; stale/inside recovery and OFF cannot create phantom collisions',()=>{
  const p=new FragmentPhysics(cubes,place,{gravity:false,floor:false,building:false,debris:false});p.release([1]);
  for(let i=0;i<30;i++){
    p.updateWrists({right_wrist:{p:[-.4+i*.02,0,.6]}},i*1000/60,i*1000/60);p.step(1/60);
  }
  assert.ok(p.records.get(1).body.translation().x>.1);assert.equal(p.snapshot().activeHands,1);
  p.updateWrists({},500,500);assert.equal(p.snapshot().activeHands,0);
  const body=p.records.get(1).body,at=body.translation();body.setLinvel({x:0,y:0,z:0},true);body.setAngvel({x:0,y:0,z:0},true);
  for(let i=0;i<4;i++){p.updateWrists({right_wrist:{p:[at.x,at.y,at.z]}},600+i*17,600+i*17);p.step(1/60);}
  assert.equal(p.snapshot().activeHands,0);assert.ok(Math.abs(body.translation().x-at.x)<.001);
  p.configure({hand:false});p.updateWrists({right_wrist:{p:[at.x-.4,at.y,at.z]}},700,700);assert.equal(p.snapshot().activeHands,0);
  p.configure({hand:true});p.updateWrists({right_wrist:{p:[at.x-.4,at.y,at.z]}},800,800);
  p.updateWrists({right_wrist:{p:[at.x-.35,at.y,at.z]}},817,817);assert.equal(p.snapshot().activeHands,1);
  p.updateWrists({right_wrist:{p:[at.x-.35,at.y,at.z]}},817,1100);assert.equal(p.snapshot().activeHands,0);p.dispose();
});

test('actual IT1: 96 active hulls, bounded floor contact and measured step cost',async()=>{
  const data=JSON.parse(await readFile(new URL('../web/public/assets/buildings/knu-it1-v3/colliders.json',import.meta.url),'utf8'));
  const p=new FragmentPhysics(data,{...place,scale:.6});p.release(data.fragments.map(f=>f.fragment_id));run(p,120);
  const moving=p.snapshot();run(p,600);
  const stats=p.snapshot();assert.equal(stats.dynamic,96);assert.equal(stats.bodies,97);assert.equal(stats.colliders,97);assert.ok(stats.finite);assert.ok(stats.minZ>-.025,JSON.stringify(stats));
  console.log('IT1 96-fragment synthetic CPU benchmark',JSON.stringify({moving,settled:stats}));p.dispose();
});

test('area impulse launches all nearby pieces, excludes far pieces and deduplicates events',()=>{
  const p=new FragmentPhysics(cubes,place,{gravity:false,floor:false,building:false,debris:false});p.release([0,1]);
  const event={event_id:'blast1',blast:true,point_m:[0,0,.1],direction:[1,0,0],strength:12,blast_radius:.3};
  p.blast(event);assert.ok(p.records.get(0).body.linvel().x>10);assert.ok(p.records.get(0).body.linvel().z>3);
  assert.equal(p.records.get(1).body.linvel().x,0);const v=p.records.get(0).body.linvel().x;p.blast(event);assert.equal(p.records.get(0).body.linvel().x,v);p.dispose();
});

test('distance hook disables only separated debris contacts, keeping nearby stacking and floor',()=>{
  const heights=[];
  for(const distance of [.05,.75]){const p=new FragmentPhysics(cubes,place,{rotation:false});p.setInteractionDistance(distance);p.release([0,1]);run(p,300);
    heights.push(height(p));assert.ok(p.snapshot().minZ>-.025);if(distance===.05)assert.ok(p.filteredPairs>0);p.dispose();}
  assert.ok(heights[1]>heights[0]+.08,JSON.stringify(heights));
});
