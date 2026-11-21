import test from 'node:test';
import assert from 'node:assert/strict';
import {createSuperFeedback} from '../frontend/building-test/super-smash-feedback.js';

function setup(){
  let at=0,played=0,cancelled=0;const canvas={hidden:true,width:1,height:1,getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})};
  const audio={play(){played++;},cancel(){cancelled++;},unlock(){},mute(){},dispose(){},info:()=>({played,cancelled})};
  const f=createSuperFeedback({canvas,audio,now:()=>at});
  const state=(revision,extra={})=>({server_instance_id:'a',model_revision:revision,epoch:'one',scene_id:'it1',smash_mode:'super_smash',delivery:'update',...extra});
  const event=(revision,extra={})=>state(revision,{delivery:'event',event:{event_id:'hit',epoch:'one',server_instance_id:'a',model_revision:revision,effect_style:'screen_impact_v1',input_mode:'synthetic',point_m:[0,0,1]},...extra});
  f.accept(state(1,{delivery:'snapshot'}));
  return {f,state,event,time:v=>{at=v;},canvas};
}
test('only a new matching live delivery produces one effect and one sound',()=>{
  const {f,state,event}=setup();assert.ok(f.accept(event(2)).event);f.accept(event(2));f.accept(state(1));
  f.accept({...event(3),event:{...event(3).event,model_revision:3}});
  assert.equal(f.info().eventCount,1);assert.equal(f.info().audio.played,1);
});
test('initial/reconnected cleared snapshot is silent even if it contains historical event data',()=>{
  const {f,event}=setup();f.accept({...event(2),delivery:'snapshot',phase:'cleared'});assert.equal(f.info().eventCount,0);
});
test('ordinary updates preserve active animation, reset and pause cancel it',()=>{
  const {f,event,state}=setup();f.accept(event(2));f.accept(state(3));assert.equal(f.info().screen.active,true);
  f.accept(state(4,{phase:'paused'}));assert.equal(f.info().screen.active,false);
});
test('old epoch, mismatched event and unavailable video do not animate',()=>{
  const {f,event,state}=setup();f.accept(state(2,{epoch:'two'}));f.accept(event(1));
  f.accept({...event(3),epoch:'two'});assert.equal(f.info().eventCount,0);
  f.accept({...event(4),event:{...event(4).event,event_id:'second'}},{presentable:false});assert.equal(f.info().eventCount,0);
});
test('retired server packets cannot roll state back after restart',()=>{
  const {f,state,event}=setup();f.accept(state(1,{server_instance_id:'b',delivery:'snapshot'}));
  assert.equal(f.accept(event(10)).accepted,false);
  assert.equal(f.accept(state(11,{delivery:'snapshot'})).accepted,false);
});
test('unknown provenance stays silent and preview creates no authoritative event',()=>{
  const {f,event}=setup();const m=event(2);m.event.input_mode='unknown';f.accept(m);f.preview();
  assert.equal(f.info().eventCount,0);assert.equal(f.info().screen.preview,true);
});
test('a blocked first draw cancels instead of replaying delayed audio/animation',()=>{
  const {f,event,time,canvas}=setup();f.accept(event(2));time(101);f.draw(101);
  assert.equal(canvas.hidden,true);assert.equal(f.info().logs[0].cancel,'draw_deadline');
});
