import assert from 'node:assert/strict';
import test from 'node:test';
import { VideoTimeline } from '../web/shared/video-timeline.js';
const frame = (id, time) => ({ frame_id: id, prepared_at_server_ms: time });

test('fast cameras wait for the slowest latest frame instead of displaying newest', () => {
  const timeline = new VideoTimeline(); timeline.setCameras(['C0','C1','C2'],0);
  for (let i=0;i<5;i++) timeline.push('C0',frame(i,1000+i*66),i*66);
  for (let i=0;i<4;i++) timeline.push('C1',frame(i,1010+i*66),i*66);
  timeline.push('C2',frame(0,1080),250);
  const selected=timeline.select(300);
  assert.equal(selected.target,1080);
  assert.deepEqual(selected.batch.map(entry=>entry.frame.prepared_at_server_ms),[1066,1076,1080]);
  assert.equal(timeline.select(350).batch,null); // Fast frames cannot advance the common clock.
  timeline.push('C2',frame(1,1146),360);
  assert.equal(timeline.select(360).target,1146);
});

test('new camera waits briefly and a stalled camera is excluded, then recovers', () => {
  const timeline = new VideoTimeline(); timeline.setCameras(['fast','slow'],0);
  timeline.push('fast',frame(0,1000),0);
  assert.equal(timeline.select(100).state,'waiting');
  timeline.push('fast',frame(1,3000),1600);
  assert.deepEqual(timeline.select(1600).stalled,['slow']);
  timeline.push('slow',frame(0,3010),1700);
  assert.equal(timeline.select(1700).state,'buffer_limit'); // Wait for matching fast-camera history.
  timeline.push('fast',frame(2,3066),1701);
  assert.equal(timeline.select(1701).state,'ready');
  timeline.setCameras(['fast'],1800);
  assert.equal(timeline.cameras.size,1);
});

test('bounded history refuses widely mismatched frames, no unbounded delay buffer', () => {
  const timeline = new VideoTimeline({maxFrames:3}); timeline.setCameras(['fast','slow'],0);
  for(let i=0;i<10;i++) timeline.push('fast',frame(i,1000+i*100),100);
  timeline.push('slow',frame(0,1100),100);
  assert.equal(timeline.cameras.get('fast').frames.length,3);
  assert.equal(timeline.select(100).state,'buffer_limit');
});

test('unknown times, out of order frames and old connection identities are not used', () => {
  const timeline=new VideoTimeline(); timeline.setCameras(['old'],0);
  assert.equal(timeline.push('old',frame(0,null),0),false);
  timeline.push('old',frame(1,1000),0);
  assert.equal(timeline.push('old',frame(2,900),1),false);
  timeline.setCameras(['new'],10);
  assert.equal(timeline.push('old',frame(3,2000),10),false);
  assert.equal(timeline.select(20).state,'waiting');
});
