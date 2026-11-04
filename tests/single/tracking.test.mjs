import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachTracking } from '../../frontend/single/tracking.js';

const square = [[[0.4, 0.3], [0.6, 0.3], [0.6, 0.7]], [[0.4, 0.3], [0.6, 0.7], [0.4, 0.7]]];
const wrist = (x) => ({ valid: true, image_norm: [x, 0.5], visibility: 0.95, reason: null });
const missing = { valid: false, image_norm: null, visibility: null, reason: 'not_detected' };
const pose = (frame_id, x) => ({
  schema: 'single_camera.v1-draft', room_id: 'room', stream_id: 'stream', server_epoch: 'epoch', run_id: 2,
  transform_version: 1, frame_id, image_width: 640, image_height: 480, observed_at_pc_ms: 1000 + 33 * frame_id,
  session_id: 'session-1', tracking_mode: 'single_view_2d', source: 'replay', task_type: 'pilot',
  wrists: { left_wrist: wrist(x), right_wrist: missing },
});

function fixture({ accept = true, unlockResult = true } = {}) {
  const calls = { processor: 0, detached: 0, played: [], unlocks: 0, disposed: 0, models: [] };
  let listener = null;
  let processor = null;
  const monitor = {
    attachPoseProcessor(fn) { calls.processor++; processor = fn; return () => { calls.detached++; }; },
    onPoseFrame(fn) { listener = fn; return () => { listener = null; }; },
    getTarget: () => ({ building_id: 'knu-it1-v3', transform_version: 1, active: true, triangles: square }),
    acceptHit: () => (accept ? { accepted: true, reject_reason: null, score_delta: 100 } : { accepted: false, reject_reason: 'not_ready', score_delta: 0 }),
  };
  const handlers = new Map();
  const target = {
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
  };
  const audio = { state: 'suspended' };
  const sound = {
    prepare() { calls.prepared = (calls.prepared ?? 0) + 1; return audio.state; },
    async unlock() { calls.unlocks++; if (unlockResult) audio.state = 'running'; return unlockResult; },
    info: () => ({ state: audio.state }),
    play(event) { calls.played.push(event.event_id); return true; },
    dispose() { calls.disposed++; },
  };
  const loadPose = async () => ({ RUNTIME: {}, async createPoseLandmarker(model) {
    const instance = { closed: false, detectForVideo: () => ({ landmarks: [] }), close() { this.closed = true; } };
    calls.models.push(instance);
    return { landmarker: instance, delegate: 'CPU' };
  } });
  const tracking = attachTracking(monitor, { target, sound, pose: { loadPose } });
  const image = { width: 640, height: 480 };
  return { tracking, calls, handlers, audio, frame: (p) => listener?.(p), process: (p) => processor(image, p) };
}

test('registers one pose processor and plays a sound only for accepted hits', async () => {
  const accepted = fixture();
  assert.equal(accepted.calls.processor, 1);
  accepted.frame(pose(1, 0.2));
  accepted.frame(pose(2, 0.65));
  assert.equal(accepted.calls.played.length, 1);
  assert.equal(accepted.tracking.hit.results[0].accepted, true);

  const rejected = fixture({ accept: false });
  rejected.frame(pose(1, 0.2));
  rejected.frame(pose(2, 0.65));
  assert.equal(rejected.calls.played.length, 0);
  assert.equal(rejected.tracking.hit.results[0].reject_reason, 'not_ready');
});

test('the audio context is prepared at attach and the first gesture resumes it', async () => {
  const { calls, handlers } = fixture();
  assert.equal(calls.prepared, 1);
  assert.equal(calls.unlocks, 0);
  assert.deepEqual([...handlers.keys()].sort(), ['keydown', 'pointerdown']);
  handlers.get('pointerdown')();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.unlocks, 1);
  // While audio runs, further gestures cost nothing.
  handlers.get('keydown')();
  assert.equal(calls.unlocks, 1);
});

test('listeners stay for the page lifetime, so audio suspended again later is resumed by the next gesture', async () => {
  const { calls, handlers, audio } = fixture();
  handlers.get('pointerdown')();
  await new Promise((r) => setImmediate(r));
  audio.state = 'interrupted';
  handlers.get('pointerdown')();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.unlocks, 2);
  assert.equal(audio.state, 'running');
  assert.equal(handlers.size, 2);
});

test('a blocked or failing unlock is retried on the next gesture and never rejects into the page', async () => {
  const { calls, handlers } = fixture({ unlockResult: false });
  handlers.get('keydown')();
  handlers.get('keydown')();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.unlocks, 2);
  assert.equal(handlers.size, 2);
});

test('MediaPipe is not loaded until the first live frame reaches the processor', async () => {
  const { calls, process } = fixture();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.models.length, 0);
  const result = await process(pose(1, 0.2));
  assert.equal(calls.models.length, 1);
  assert.equal(result.frame_id, 1);
});

test('dispose detaches the processor and frame listener and frees the model and audio', async () => {
  const { tracking, calls, handlers, frame, process } = fixture();
  await process(pose(1, 0.2));
  tracking.dispose();
  assert.equal(calls.detached, 1);
  assert.equal(calls.disposed, 1);
  assert.equal(handlers.size, 0);
  assert.equal(calls.models[0].closed, true);
  frame(pose(1, 0.2));
  frame(pose(2, 0.65));
  assert.equal(calls.played.length, 0);
});
