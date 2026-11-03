// No npm dependencies: node --experimental-vm-modules --test tests/test_camera_lifecycle.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../web/camera/app.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function cameraPage({ media, createPose } = {}) {
  const callbacks = new Map(), timers = new Map(), links = [], tracks = [];
  let nextId = 1, detects = 0, failInference = false;
  const context2d = Object.fromEntries(['clearRect', 'beginPath', 'arc', 'fill', 'fillText'].map(name => [name, () => {}]));
  const elements = new Map();
  for (const id of ['preview', 'overlay', 'camera-id', 'facing', 'model', 'start', 'stop', 'camera-status', 'server-status', 'link-status', 'last-message', 'device-info', 'stat-fps', 'stat-infer', 'stat-sent', 'stat-time', 'stat-errors']) {
    const listeners = new Map();
    elements.set(id, {
      value: id === 'camera-id' ? 'C0' : id === 'model' ? 'lite' : 'environment',
      options: [], disabled: id === 'stop', textContent: '', width: 640, height: 480,
      addEventListener: (type, fn) => listeners.set(type, fn),
      click: () => listeners.get('click')?.(),
      getContext: () => context2d,
    });
  }
  const video = elements.get('preview');
  Object.assign(video, {
    videoWidth: 640, videoHeight: 480, srcObject: null,
    play: async () => {}, pause() {}, removeAttribute() {},
    requestVideoFrameCallback(fn) { const id = nextId++; callbacks.set(id, fn); return id; },
    cancelVideoFrameCallback(id) { callbacks.delete(id); },
  });
  const makeStream = () => {
    const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {}, getSettings: () => ({ width: 640, height: 480 }) };
    tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const makePose = () => ({
    closed: false, close() { this.closed = true; },
    detectForVideo() { detects++; if (failInference) throw new Error('inference failed'); return {}; },
  });
  const pose = makePose();
  const storage = new Map();
  const browser = {
    isSecureContext: true, addEventListener() {},
    setInterval(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    cancelAnimationFrame(id) { callbacks.delete(id); },
  };
  const ctx = vm.createContext({
    document: { querySelector: selector => elements.get(selector.slice(1)) },
    window: browser, navigator: { userAgent: 'lifecycle-test', mediaDevices: { getUserMedia: media ?? (async () => makeStream()) } },
    location: { search: '' }, crypto: webcrypto, URLSearchParams,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => 1000 + detects },
    requestAnimationFrame(fn) { const id = nextId++; callbacks.set(id, fn); return id; },
  });
  const mocks = {
    '/shared/status-socket.js': { watchServerStatus() {} },
    '/camera/pose.js': { createPoseLandmarker: createPose ?? (async () => ({ landmarker: pose, delegate: 'CPU' })), extractWrists: () => ({ left_wrist: null, right_wrist: null }), RUNTIME: {} },
    '/camera/pose-link.js': { openPoseLink({ makeHello }) {
      makeHello();
      const link = { closed: false, send: () => true, close() { this.closed = true; } };
      links.push(link);
      return link;
    } },
  };
  const module = new vm.SourceTextModule(source, { context: ctx });
  await module.link(specifier => new vm.SyntheticModule(Object.keys(mocks[specifier]), function () {
    for (const [name, value] of Object.entries(mocks[specifier])) this.setExport(name, value);
  }, { context: ctx }));
  await module.evaluate();
  return {
    start: () => elements.get('start').click(), stop: () => elements.get('stop').click(),
    status: () => elements.get('camera-status').textContent,
    stopped: () => !elements.get('start').disabled && elements.get('stop').disabled,
    callbacks, timers, links, tracks, pose, makePose, makeStream,
    failInference() { failInference = true; },
    frame() {
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id);
      callback(1000, {});
    },
  };
}

test('stop during model loading does not start inference or transport afterwards', async () => {
  const loading = deferred();
  const page = await cameraPage({ createPose: () => loading.promise });
  const pending = page.start();
  await flush();
  page.stop();
  loading.resolve({ landmarker: page.pose, delegate: 'CPU' });
  await pending;
  assert.equal(page.links.length, 0);
  assert.equal(page.callbacks.size, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.pose.closed, true);
  assert.equal(page.stopped(), true);
  assert.ok(page.tracks.every(track => track.stopped));
});

test('late camera permission response after stop releases the acquired track', async () => {
  const permission = deferred();
  const page = await cameraPage({ media: () => permission.promise });
  const pending = page.start();
  page.stop();
  permission.resolve(page.makeStream());
  await pending;
  assert.equal(page.links.length, 0);
  assert.ok(page.tracks.every(track => track.stopped));
  assert.equal(page.stopped(), true);
});

test('stop cancels the queued video callback and repeated starts have one loop', async () => {
  const page = await cameraPage();
  await page.start();
  assert.equal(page.callbacks.size, 1);
  page.stop();
  assert.equal(page.callbacks.size, 0);
  await page.start();
  assert.equal(page.callbacks.size, 1);
  page.frame();
  assert.equal(page.callbacks.size, 1);
  page.stop();
  assert.equal(page.callbacks.size, 0);
});

test('inference failure stops the camera and transport and permits retry', async () => {
  const page = await cameraPage();
  await page.start();
  page.failInference();
  assert.doesNotThrow(() => page.frame());
  assert.equal(page.callbacks.size, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.links[0].closed, true);
  assert.ok(page.tracks.every(track => track.stopped));
  assert.equal(page.stopped(), true);
  assert.match(page.status(), /inference failed/);
  assert.equal(page.pose.closed, true);
});

test('an old model load completing after a restart cannot replace the active session', async () => {
  const oldLoad = deferred();
  let calls = 0;
  const page = await cameraPage({ createPose: () => ++calls === 1 ? oldLoad.promise : Promise.resolve({ landmarker: activePose, delegate: 'CPU' }) });
  const activePose = page.makePose();
  const pending = page.start();
  await flush();
  page.stop();
  await page.start();
  oldLoad.resolve({ landmarker: page.pose, delegate: 'CPU' });
  await pending;
  assert.equal(page.links.length, 1);
  assert.equal(page.links[0].closed, false);
  assert.equal(page.callbacks.size, 1);
  assert.equal(page.pose.closed, true);
  assert.equal(activePose.closed, false);
});

test('an old permission rejection after restart leaves the new camera running', async () => {
  const oldPermission = deferred();
  let calls = 0;
  const page = await cameraPage({ media: () => ++calls === 1 ? oldPermission.promise : Promise.resolve(page.makeStream()) });
  const pending = page.start();
  page.stop();
  await page.start();
  oldPermission.reject(new Error('old permission rejected'));
  await pending;
  assert.equal(page.links.length, 1);
  assert.equal(page.links[0].closed, false);
  assert.equal(page.callbacks.size, 1);
  assert.equal(page.tracks[0].stopped, false);
});
