import test from 'node:test';
import assert from 'node:assert/strict';
import {createImpactAudio} from '../frontend/building-test/impact-audio.js';

function setup(state='running'){
  const nodes=[];let contexts=0;
  const param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=()=>{const n={connect(){},disconnect(){},gain:param(),frequency:param(),start(at){this.started=at;},stop(at){this.stopped=at??'now';}};nodes.push(n);return n;};
  const ctx={state,currentTime:10,sampleRate:100,destination:{},createGain:node,createOscillator:node,createBufferSource:node,createBiquadFilter:node,
    createBuffer:()=>({getChannelData:()=>new Float32Array(200)}),resume(){this.state='running';return Promise.resolve();},close(){return Promise.resolve();}};
  return {audio:createImpactAudio({createContext:()=>{contexts++;return ctx;}}),nodes,ctx,contexts:()=>contexts};
}
test('one explosion is followed by bounded rolling collapse and multiple staggered clatters',()=>{
  const {audio,nodes,contexts}=setup();assert.equal(audio.play(),true);
  const {cues,active}=audio.info();assert.equal(contexts(),1);assert.equal(active,14);
  assert.equal(cues[0].kind,'boom');assert.equal(cues[0].delay,0);
  assert.equal(cues.filter(c=>c.kind==='thud').length,5);
  assert.equal(cues.filter(c=>c.kind==='clatter').length,4);
  assert.ok(cues.some(c=>c.delay>1));assert.ok(nodes.some(n=>n.started>11));audio.dispose();
});
test('mute and cancel stop every pending source; unmute/unlock never replay a queued impact',()=>{
  const {audio,nodes}=setup();audio.play();const started=nodes.filter(n=>n.started!==undefined);
  audio.mute(true);assert.equal(audio.info().active,0);assert.ok(started.every(n=>n.stopped==='now'));
  assert.equal(audio.play(),false);audio.mute(false);audio.unlock();assert.equal(audio.info().played,1);
  audio.play();assert.equal(audio.info().active,14);audio.cancel();assert.equal(audio.info().active,0);audio.dispose();
});
test('locked and unavailable contexts skip audio without accumulating delayed cues',()=>{
  const {audio}=setup('suspended');assert.equal(audio.play(),false);audio.unlock();assert.equal(audio.info().played,0);audio.dispose();
  const unsupported=createImpactAudio({createContext:()=>{throw new Error('no audio');}});
  assert.equal(unsupported.play(),false);unsupported.dispose();
});
test('failed output graph construction stays silent and does not interrupt visual acceptance',()=>{
  const {audio,ctx}=setup();ctx.createGain=()=>{throw new Error('output unavailable');};
  assert.equal(audio.play(),false);assert.equal(audio.info().active,0);audio.dispose();
});
