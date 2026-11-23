import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FragmentPhysics,initPhysics} from '../frontend/building-test/fragment-physics.js';
import {feedbackId,FEEDBACK_PRESETS} from '../frontend/building-test/feedback-presets.js';
import {createSuperFeedback} from '../frontend/building-test/super-smash-feedback.js';
import {createScreenImpact} from '../frontend/building-test/screen-impact.js';
import {createImpactAudio} from '../frontend/building-test/impact-audio.js';
await initPhysics();
const data=JSON.parse(await readFile(new URL('../web/public/assets/buildings/knu-it1-v3/colliders.json',import.meta.url),'utf8'));
const placement={x_m:0,y_m:0,yaw_deg:0,scale:.6};
const event=(preset,extra={})=>({event_id:'test-'+preset,fragment_id:0,point_m:[0,0,.3],direction:[1,0,0],feedback_preset:preset,feedback_version:1,feedback_seed:1234,...extra});
function canvas(){return {hidden:true,width:1,height:1,getContext:()=>new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})};}

test('unknown preset and future protocol fall back to the original explosion',()=>{
  assert.equal(feedbackId({feedback_preset:'new-future-style'}),'chain_blast_v1');
  assert.equal(feedbackId({feedback_preset:'gravity_compress_v1',feedback_version:2}),'chain_blast_v1');
});

test('real IT1 swing follows both accepted left and right directions',()=>{
  for(const sign of [-1,1]){
    const p=new FragmentPhysics(data,placement),ids=[...p.records.keys()];
    p.queueSuper(ids,event('swing_wave_v1',{direction:[sign,0,0]}));
    const at=p.superAt;for(let i=0;i<12;i++)p.processSuper(at+400);
    assert.equal(p.dynamic.size,96);
    for(const id of p.dynamic)assert.ok(p.records.get(id).body.linvel().x*sign>0);
    p.stopSuper();p.dispose();
  }
});

test('real IT1 crush starts downward, keeps all logical removals and clears on stop',()=>{
  const p=new FragmentPhysics(data,placement),ids=[...p.records.keys()];
  p.queueSuper(ids,event('crush_collapse_v1'));const at=p.superAt;
  p.processSuper(at);assert.ok(p.dynamic.has(0));
  for(let i=0;i<12;i++)p.processSuper(at+500);
  assert.equal(p.superRemoved.size,96);assert.equal(p.dynamic.size,96);
  for(const id of p.dynamic)assert.ok(p.records.get(id).body.linvel().z<=0);
  for(let i=0;i<90;i++)p.step(1/60);assert.ok(p.snapshot().finite);
  p.stopSuper();assert.equal(p.dynamic.size,0);p.dispose();
});

test('real IT1 gravity compression has no dynamic colliders, shrinks toward contact and cancels',()=>{
  const p=new FragmentPhysics(data,placement),ids=[...p.records.keys()],e=event('gravity_compress_v1');
  p.queueSuper(ids,e);const at=p.superAt;for(let i=0;i<12;i++)p.processSuper(at+150);
  assert.equal(p.dynamic.size,0);assert.equal(p.superVisual.size,64);assert.equal(p.superHidden.size,32);
  for(const id of ids)assert.equal(p.records.get(id).collider.isEnabled(),false);
  const before=p.superVisual.get(0).position.distanceTo({x:0,y:0,z:.3});
  p.processSuper(at+600);assert.ok(p.localTransform(0).scale<1);
  assert.ok(p.superVisual.get(0).position.distanceTo({x:0,y:0,z:.3})<before);
  p.stopSuper();p.processSuper(at+700);assert.equal(p.superVisual.size,0);assert.equal(p.superHidden.size,96);p.dispose();
});

test('all four screen layers respect per-preset lifetime and reduced motion',()=>{
  globalThis.innerWidth=1440;globalThis.innerHeight=1000;globalThis.devicePixelRatio=1;
  for(const [id,descriptor] of Object.entries(FEEDBACK_PRESETS))for(const reduced of [false,true]){
    const c=canvas(),effect=createScreenImpact(c,{now:()=>0,reduced:()=>reduced});
    effect.start({event:event(id),originPx:[300,650],directionPx:[-100,0],spanPx:600});
    effect.draw(16);assert.equal(effect.info().preset,id);assert.deepEqual(effect.info().originPx,[300,650]);
    effect.draw(descriptor.durationMs+1);assert.equal(effect.info().active,false);assert.equal(c.hidden,true);
  }
});

test('unknown-version fallback is shared by screen, audio and physics presentation event',()=>{
  let at=0,played=null,cancelled=0;
  const f=createSuperFeedback({canvas:canvas(),now:()=>at,onCancel:()=>cancelled++,audio:{play:e=>{played=e;},cancel(){},info:()=>({}),unlock(){},mute(){},dispose(){}}});
  const state={server_instance_id:'s',epoch:'e',model_revision:1,smash_mode:'super_smash',delivery:'snapshot'};
  f.accept(state);
  const result=f.accept({...state,model_revision:2,delivery:'event',event:{...event('gravity_compress_v1'),feedback_version:2,effect_style:'screen_impact_v1',input_mode:'synthetic',server_instance_id:'s',epoch:'e',model_revision:2}});
  assert.equal(result.event.feedback_preset,'chain_blast_v1');assert.equal(played.feedback_preset,'chain_blast_v1');
  assert.equal(result.event.presentation_t0,0);at=101;f.draw(at);assert.equal(f.info().screen.active,false);assert.ok(cancelled>=2);
});

test('four audio cue signatures differ, stay bounded and stop all scheduled voices',()=>{
  const param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),start(){},stop(){}});
  const ctx={state:'running',currentTime:0,sampleRate:100,destination:{},createGain:node,createOscillator:node,createBufferSource:node,createBiquadFilter:node,createBuffer:()=>({getChannelData:()=>new Float32Array(200)}),close:()=>Promise.resolve()};
  const a=createImpactAudio({createContext:()=>ctx}),signatures=[];
  for(const id of Object.keys(FEEDBACK_PRESETS)){
    assert.equal(a.play(event(id)),true);const info=a.info();assert.equal(info.preset,id);assert.ok(info.active<=14);assert.equal(info.cues[0].delay,0);
    signatures.push(JSON.stringify(info.cues));a.cancel();assert.equal(a.info().active,0);
  }
  assert.equal(new Set(signatures).size,4);a.dispose();
});

for(const preset of Object.keys(FEEDBACK_PRESETS))test('reduced motion keeps authoritative removal but suppresses 3D motion: '+preset,()=>{
  const f=createSuperFeedback({canvas:canvas(),now:()=>0,reduced:()=>true,audio:{play(){},cancel(){},info:()=>({}),unlock(){},mute(){},dispose(){}}});
  const state={server_instance_id:'reduced',epoch:'e',model_revision:1,smash_mode:'super_smash',delivery:'snapshot'};
  f.accept(state);
  const result=f.accept({...state,model_revision:2,delivery:'event',event:{...event(preset),effect_style:'screen_impact_v1',input_mode:'synthetic',server_instance_id:'reduced',epoch:'e',model_revision:2}});
  const p=new FragmentPhysics(data,placement),ids=[...p.records.keys()];
  try{
    p.queueSuper(ids,result.event);for(let i=0;i<12;i++)p.processSuper(700);
    assert.equal(p.superRemoved.size,96);assert.equal(p.dynamic.size,0);assert.equal(p.superVisual.size,0);assert.equal(p.superHidden.size,96);
  }finally{p.dispose();f.dispose();}
});
