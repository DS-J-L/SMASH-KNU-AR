import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoseAdapter, attachPoseAdapter, toWrist } from '../../frontend/single/pose-adapter.js';

const meta = (frame_id, observed_at_pc_ms = 1000 + frame_id) => ({
  schema: 'single_camera.v1-draft', room_id: 'room', stream_id: 'stream', server_epoch: 'epoch', run_id: 1,
  transform_version: 1, frame_id, image_width: 640, image_height: 480, observed_at_pc_ms, media_time_s: frame_id / 30,
  capture_time: null, session_id: null, tracking_mode: 'single_view_2d', source: 'replay', task_type: 'pilot',
});
const image = () => ({ width: 640, height: 480, closed: 0, close() { this.closed++; } });
const pose = (left, right) => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  landmarks[15] = left;
  landmarks[16] = right;
  return landmarks;
};

// Fake /camera/pose.js: records every instance, the delegates asked for and the timestamps seen.
function fakePose({ results = [], failOn = new Set() } = {}) {
  const calls = { created: [], timestamps: [], resultsClosed: 0 };
  const module = {
    RUNTIME: { package: '@mediapipe/tasks-vision', version: 'test' },
    async createPoseLandmarker(model, delegates) {
      const instance = {
        model, delegates, closed: false,
        detectForVideo(source, timestamp) {
          calls.timestamps.push(timestamp);
          if (failOn.has(calls.timestamps.length)) throw new Error('gpu_lost');
          const landmarks = results.shift();
          return { landmarks: landmarks ? [landmarks] : [], close() { calls.resultsClosed++; } };
        },
        close() { this.closed = true; },
      };
      calls.created.push(instance);
      return { landmarker: instance, delegate: delegates[0] };
    },
  };
  return { calls, loadPose: async () => module };
}

test('wrist validity: detected, off frame, low visibility, non-finite and missing', () => {
  assert.deepEqual(toWrist({ x: 0.25, y: 0.75, visibility: 0.98 }), { valid: true, image_norm: [0.25, 0.75], visibility: 0.98, reason: null });
  assert.deepEqual(toWrist(null), { valid: false, image_norm: null, visibility: null, reason: 'not_detected' });
  assert.equal(toWrist({ x: 1.02, y: 0.5, visibility: 0.9 }).reason, 'out_of_frame');
  assert.equal(toWrist({ x: 0.5, y: -0.01, visibility: 0.9 }).reason, 'out_of_frame');
  assert.equal(toWrist({ x: 0.5, y: 0.5, visibility: 0.49 }).reason, 'low_visibility');
  assert.equal(toWrist({ x: 0.5, y: 0.5 }).reason, 'low_visibility');
  assert.equal(toWrist({ x: NaN, y: 0.5, visibility: 0.9 }).reason, 'non_finite');
  assert.equal(toWrist({ x: 0.5, y: 0.5, visibility: 1.7 }).visibility, 1);
  // Edges of the frame are still on the frame.
  assert.equal(toWrist({ x: 0, y: 1, visibility: 0.5 }).valid, true);
});

test('PoseFrame keeps every frame field, adds both wrists and never touches the borrowed image', async () => {
  const fake = fakePose({ results: [pose({ x: 0.3, y: 0.4, visibility: 0.95 }, { x: 0.7, y: 0.4, visibility: 0.2 })] });
  let clock = 50;
  const adapter = createPoseAdapter({ loadPose: fake.loadPose, now: () => (clock += 7) });
  const frame = image();
  const result = await adapter.process(frame, meta(1));
  assert.deepEqual({ ...result, wrists: undefined, inference: undefined }, { ...meta(1), wrists: undefined, inference: undefined });
  assert.deepEqual(result.wrists.left_wrist, { valid: true, image_norm: [0.3, 0.4], visibility: 0.95, reason: null });
  assert.deepEqual(result.wrists.right_wrist, { valid: false, image_norm: null, visibility: 0.2, reason: 'low_visibility' });
  assert.equal(result.inference.ended_at_pc_ms - result.inference.started_at_pc_ms, 7);
  assert.equal(result.inference.delegate, 'GPU');
  assert.equal(frame.closed, 0);
  assert.equal(fake.calls.resultsClosed, 1);
});

test('no person gives two not_detected wrists, not an error', async () => {
  const fake = fakePose({ results: [] });
  const result = await createPoseAdapter({ loadPose: fake.loadPose }).process(image(), meta(1));
  assert.equal(result.wrists.left_wrist.reason, 'not_detected');
  assert.equal(result.wrists.right_wrist.reason, 'not_detected');
});

test('MediaPipe timestamps stay strictly increasing across equal times, a new stream and a new run', async () => {
  const fake = fakePose();
  const adapter = createPoseAdapter({ loadPose: fake.loadPose });
  await adapter.process(image(), meta(1, 2000.4));
  await adapter.process(image(), meta(2, 2000.2));
  await adapter.process(image(), { ...meta(1, 1500), stream_id: 'stream-2', run_id: 2 });
  await adapter.process(image(), meta(3, 2100));
  assert.deepEqual(fake.calls.timestamps, [2000, 2001, 2002, 2100]);
});

test('a frame whose size differs from its meta is rejected before any model work', async () => {
  const fake = fakePose();
  const adapter = createPoseAdapter({ loadPose: fake.loadPose });
  await assert.rejects(adapter.process({ width: 480, height: 640 }, meta(1)), /frame_size_mismatch/);
  assert.equal(fake.calls.created.length, 0);
});

test('model loads once for warmup and concurrent frames', async () => {
  const fake = fakePose();
  const adapter = createPoseAdapter({ loadPose: fake.loadPose });
  await Promise.all([adapter.warmup(), adapter.process(image(), meta(1)), adapter.process(image(), meta(2))]);
  assert.equal(fake.calls.created.length, 1);
  assert.equal(adapter.info().ready, true);
});

test('warmup runs one blank inference once, before and in timestamp order with real frames', async () => {
  const fake = fakePose();
  const created = [];
  globalThis.document = { createElement: () => { const canvas = { width: 0, height: 0 }; created.push(canvas); return canvas; } };
  try {
    let clock = 500;
    const adapter = createPoseAdapter({ loadPose: fake.loadPose, now: () => clock });
    await adapter.warmup({ width: 320, height: 240 });
    await adapter.warmup();
    assert.deepEqual(created, [{ width: 320, height: 240 }]);
    clock = 900;
    await adapter.process(image(), meta(1, 400));
    assert.deepEqual(fake.calls.timestamps, [500, 501]);
    assert.equal(adapter.info().stats.frames, 1);
  } finally {
    delete globalThis.document;
  }
});

test('a GPU failure during inference closes that instance and the next frame runs on CPU', async () => {
  const fake = fakePose({ failOn: new Set([2]) });
  const adapter = createPoseAdapter({ loadPose: fake.loadPose });
  await adapter.process(image(), meta(1));
  await assert.rejects(adapter.process(image(), meta(2)), /gpu_lost/);
  assert.equal(fake.calls.created[0].closed, true);
  const result = await adapter.process(image(), meta(3));
  assert.deepEqual(fake.calls.created.map((instance) => instance.delegates), [['GPU', 'CPU'], ['CPU']]);
  assert.equal(result.inference.delegate, 'CPU');
  assert.equal(adapter.info().stats.failures, 1);
});

test('dispose while the model is loading closes the late instance and rejects further frames', async () => {
  let release;
  const fake = fakePose();
  const gate = new Promise((resolve) => { release = resolve; });
  const adapter = createPoseAdapter({ loadPose: async () => { await gate; return fake.loadPose(); } });
  const pending = adapter.process(image(), meta(1));
  adapter.dispose();
  release();
  await assert.rejects(pending, /pose_adapter_disposed/);
  assert.equal(fake.calls.created[0].closed, true);
  await assert.rejects(adapter.process(image(), meta(2)), /pose_adapter_disposed/);
});

test('attachPoseAdapter registers one processor and its dispose detaches and frees the model', async () => {
  const fake = fakePose();
  let processor = null;
  let detached = 0;
  const monitor = { attachPoseProcessor(fn) { processor = fn; return () => { detached++; processor = null; }; } };
  const attached = attachPoseAdapter(monitor, { loadPose: fake.loadPose });
  const result = await processor(image(), meta(1));
  assert.equal(result.frame_id, 1);
  attached.dispose();
  assert.equal(detached, 1);
  assert.equal(fake.calls.created[0].closed, true);
});
