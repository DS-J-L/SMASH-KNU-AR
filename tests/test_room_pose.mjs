import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { extractBody, extractHead, drawBody } from '../web/camera/body.js';

const source = await readFile(new URL('../web/camera/room/pose.js', import.meta.url), 'utf8');
async function harness({ load } = {}) {
  let now = 100, callback = null, detected = [], closed = 0, fail = false;
  const sent = [], statuses = [];
  const landmarker = { close() { closed++; }, detectForVideo(video, at) {
    if (fail) throw new Error('inference failed');
    detected.push(at); return {};
  }};
  const video = { videoWidth: 640, videoHeight: 480, currentTime: 1,
    requestVideoFrameCallback(fn) { callback = fn; return 1; },
    cancelVideoFrameCallback() { callback = null; } };
  const overlay = { width: 0, height: 0, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, fill() {},
  }) };
  const context = vm.createContext({ performance: { now: () => now }, crypto: webcrypto });
  const dependency = new vm.SyntheticModule(['createPoseLandmarker', 'extractWrists'], function() {
    this.setExport('createPoseLandmarker', load || (async () => ({ landmarker, delegate: 'CPU' })));
    this.setExport('extractWrists', () => ({ left_wrist: { u_px: 120, v_px: 80, visibility: 0.9 }, right_wrist: null }));
  }, { context });
  const module = new vm.SourceTextModule(source, { context });
  const bodyModule = new vm.SyntheticModule(['extractBody','extractHead','drawBody'],function(){
    this.setExport('extractBody',extractBody);this.setExport('extractHead',extractHead);this.setExport('drawBody',drawBody);
  },{context});
  await module.link(spec => spec.includes('/body.js') ? bodyModule : dependency); await module.evaluate();
  const pose = module.namespace.createRoomPose({ video, overlay,
    send: message => { sent.push(message); return true; }, onStatus: message => statuses.push(message) });
  const member = { camera_id: 'C0', device_id: 'phone' };
  return { pose, member, sent, statuses, detected, video,
    advance(ms) { now += ms; },
    closed: () => closed, callback: () => callback, fail() { fail = true; },
    tick(metadata) { now += 70; const next = callback; callback = null; next?.(now, metadata); } };
}

test('room phone sends registered wrists, preserves unknown capture time and rotates streams on resize', async () => {
  const h = await harness(); await h.pose.start(h.member);
  const hello = h.sent[0]; assert.equal(hello.type, 'camera_hello');
  h.tick({}); assert.equal(h.sent.length, 1); // No coordinates until server ACK.
  h.pose.receive({ type: 'camera_ack', stream_id: hello.stream_id,
    expected: { calibration_id: 'measured-a', image: { width: 640, height: 480, rotation_deg: 0 } } });
  h.tick({});
  let pose = h.sent.at(-1);
  assert.equal(pose.type, 'pose_2d'); assert.equal(pose.frame_id, 0);
  assert.equal(pose.calibration_id, 'measured-a');
  assert.equal(pose.camera_id, 'C0'); assert.equal(pose.device_id, 'phone');
  assert.equal(pose.joints.left_wrist.u_px, 120); assert.equal(pose.joints.right_wrist, null);
  assert.equal(Object.keys(pose.body).length,22);assert.equal(pose.body.left_wrist.u_px,120);
  assert.equal(pose.head,null);assert.equal('face' in pose,false);
  assert.equal(pose.timing.capture_time_ms, null); assert.equal(pose.timing.timestamp_source, 'unknown');
  h.pose.receive({ type: 'pose_received', stream_id: hello.stream_id, frame_id: 0, clock_ready: true });
  assert.ok(h.statuses.at(-1).includes('서버 수신 프레임 0'));
  h.pose.receive({ type: 'clock_ping', ping_id: 1, server_time_ms: 999 });
  assert.equal(h.sent.at(-1).type, 'clock_pong');
  assert.equal(h.sent.at(-1).clock_id, hello.clock_id);
  h.tick({ captureTime: 90, presentationTime: 95 });
  pose = h.sent.at(-1); assert.equal(pose.frame_id, 1);
  assert.equal(pose.timing.capture_time_ms, 90); assert.equal(pose.timing.timestamp_source, 'rvfc_capture_time');
  h.video.videoWidth = 480; h.video.videoHeight = 640; h.tick({});
  const resized = h.sent.at(-1); assert.equal(resized.type, 'camera_hello');
  assert.notEqual(resized.stream_id, hello.stream_id);
  h.pose.receive({ type: 'camera_ack', stream_id: hello.stream_id }); h.tick({});
  assert.equal(h.sent.at(-1), resized); // Old ACK cannot enable the new stream.
  h.pose.receive({ type: 'camera_ack', stream_id: resized.stream_id }); h.tick({});
  assert.equal(h.sent.at(-1).frame_id, 0); assert.equal(h.sent.at(-1).image.width, 480);
  assert.equal(h.sent.at(-1).calibration_id, null);
  h.pose.close(); assert.equal(h.callback(), null); assert.equal(h.closed(), 1);
});

test('leaving during model load disposes a late model without sending or scheduling', async () => {
  let resolve, closed = 0;
  const h = await harness({ load: () => new Promise(done => { resolve = done; }) });
  const starting = h.pose.start(h.member); h.pose.close();
  resolve({ landmarker: { close() { closed++; } }, delegate: 'CPU' }); await starting;
  assert.equal(closed, 1); assert.equal(h.sent.length, 0); assert.equal(h.callback(), null);
});

test('inference failure closes the estimator and cannot send later frames', async () => {
  const h = await harness(); await h.pose.start(h.member);
  h.pose.receive({ type: 'camera_ack', stream_id: h.sent[0].stream_id });
  h.fail(); h.tick({});
  assert.equal(h.closed(), 1); assert.equal(h.callback(), null);
  assert.ok(h.statuses.at(-1).includes('손목 인식 중단'));
  assert.equal(h.sent.length, 1);
});

test('outgoing wrist overlay scales existing results and drops stale observations',async()=>{
  const h=await harness();await h.pose.start(h.member);h.tick({});
  const arcs=[],ctx={beginPath(){},arc(...args){arcs.push(args);},fill(){}};
  const canvas={width:320,height:240,getContext:()=>ctx};
  const count=h.detected.length;h.pose.drawOn(canvas);
  assert.equal(arcs.length,1);assert.equal(arcs[0][0],60);assert.equal(arcs[0][1],40);
  assert.equal(ctx.fillStyle,'#7fd6ff');assert.equal(h.detected.length,count);
  h.advance(201);h.pose.drawOn(canvas);assert.equal(arcs.length,1);
  h.tick({});h.video.videoWidth=480;h.pose.drawOn(canvas);assert.equal(arcs.length,1);
  h.pose.close();h.pose.drawOn(canvas);assert.equal(arcs.length,1);
});
