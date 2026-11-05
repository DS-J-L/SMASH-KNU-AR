import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerClock } from '../web/shared/server-clock.js';
import { serverClockLabel, drawTimedFrame } from '../web/shared/video-clock.js';

test('server estimate uses monotonic RTT and removes server handling duration', () => {
  let now = 100;
  const clock = createServerClock(() => now);
  assert.equal(clock.estimate(), null);
  const id = clock.ping();
  now = 140;
  // 15ms each network direction, 10ms handling at server.
  assert.equal(clock.receive({ping_id:id, server_received_ms:1000115, server_sent_ms:1000125}), true);
  assert.deepEqual(clock.estimate(), {nowMs:1000140, uncertaintyMs:15});
  now = 1140;
  assert.equal(clock.estimate().nowMs, 1001140);
});

test('least RTT avoids queued samples, expires and can resynchronize', () => {
  let now = 0;
  const clock = createServerClock(() => now);
  const first = clock.ping(); now = 20;
  clock.receive({ping_id:first, server_received_ms:5010, server_sent_ms:5010});
  now = 100;
  const queued = clock.ping(); now = 300;
  clock.receive({ping_id:queued, server_received_ms:5290, server_sent_ms:5290});
  assert.deepEqual(clock.estimate(), {nowMs:5300, uncertaintyMs:10});
  now = 11000;
  assert.equal(clock.estimate(), null);
  assert.equal(serverClockLabel(clock), '시각 동기화 대기');
  const next = clock.ping(); now += 10;
  clock.receive({ping_id:next, server_received_ms:16005, server_sent_ms:16005});
  assert.equal(clock.estimate().nowMs, 16010);
});

test('unknown, reused and malformed responses do not set server time', () => {
  let now = 0;
  const clock = createServerClock(() => now);
  assert.equal(clock.receive({ping_id:999, server_received_ms:5000,server_sent_ms:5000}), false);
  const id = clock.ping(); now = 20;
  assert.equal(clock.receive({ping_id:id,server_received_ms:5000,server_sent_ms:4990}), false);
  assert.equal(clock.estimate(), null);
  assert.equal(clock.receive({ping_id:id,server_received_ms:5000,server_sent_ms:5000}), false);
});

test('video rendering applies overlay before timestamp without waiting for inference',()=>{
  const order=[];
  const ctx={drawImage(){order.push('video');},fillRect(){},fillText(){order.push('timestamp');}};
  const canvas={width:0,height:0,getContext:()=>ctx};
  drawTimedFrame(canvas,{videoWidth:1280,videoHeight:720},'C0',null,target=>{
    assert.equal(target.width,640);assert.equal(target.height,360);order.push('wrists');
  });
  assert.deepEqual(order,['video','wrists','timestamp']);
});
