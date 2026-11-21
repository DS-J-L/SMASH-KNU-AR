import { test, expect } from '@playwright/test';
import { intrinsicsFromFov, markerCorners, project, normalize, sub, cross, scale, matVec } from '../../web/test/mono3d/geometry.js';

const W = 640, H = 480;
const K = intrinsicsFromFov(W, H, 80), C = [0.1, -2.3, 1];
const forward = normalize(sub([0, .6, .6], C)), right = normalize(cross(forward, [0, 0, 1]));
const R = [...right, ...cross(forward, right), ...forward], pose = { R, t: scale(matVec(R, C), -1), C };
const corners = markerCorners(.6).map(([x, y]) => project(K, pose, [x, y, 0]));
const saved = { width: W, height: H, corners, markerCm: 60, fov: 80, cameraHeight: 1, autoFov: false };
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'no-preference' }); });
const effect = page => page.evaluate(() => window.__arHitEffect.snapshot());

function person(wrist = [.33, .7, .95]) {
  const points = {
    0: [.05, .7, 1.6], 11: [-.13, .7, 1.45], 12: [.23, .7, 1.45],
    13: [-.2, .7, 1.2], 14: [.3, .7, 1.2], 15: [-.23, .7, .95], 16: wrist,
    23: [-.05, .7, .95], 24: [.15, .7, .95], 25: [-.05, .7, .5], 26: [.15, .7, .5],
    27: [-.05, .7, .09], 28: [.15, .7, .09], 29: [-.05, .65, .03], 30: [.15, .65, .03],
    31: [-.05, .82, .03], 32: [.15, .82, .03],
  };
  const landmarks = [], world = [];
  for (let i = 0; i < 33; i++) {
    const source = points[i];
    if (!source) { landmarks.push({ x: .5, y: .5, visibility: 0 }); world.push({ x: 0, y: 0, z: 0, visibility: 0 }); continue; }
    // Body capture now requires both feet at the marker, before moving away to strike.
    const p = [source[0], source[1] - .7, source[2]];
    const [u, v] = project(K, pose, p), q = scale(matVec(R, sub(p, [.05, 0, .95])), .9);
    landmarks.push({ x: u / W, y: v / H, visibility: .95 });
    world.push({ x: q[0], y: q[1], z: q[2], visibility: .95 });
  }
  return { landmarks: [landmarks], worldLandmarks: [world] };
}

async function meterAudio(page) {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    window.__arAudio = { contexts: [], hits: 0 };
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        const meter = this.createAnalyser(); meter.fftSize = 2048; meter.connect(this.destination);
        Object.defineProperty(this, 'destination', { value: meter });
        window.__arAudio.contexts.push({ context: this, meter });
      }
      createOscillator() {
        const source = super.createOscillator(), start = source.start.bind(source);
        source.start = (...args) => { if (source.type === 'triangle') window.__arAudio.hits++; return start(...args); };
        return source;
      }
    };
  });
}
const count = page => page.evaluate(() => window.__arAudio.hits);
const rms = page => page.evaluate(() => Math.max(0, ...window.__arAudio.contexts.map(({ meter }) => {
  const data = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(data);
  return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
})));

async function phoneCamera(page, mode) {
  await page.addInitScript(({ initial, saved, mode }) => {
    window.__arPose = initial;
    localStorage.setItem(mode === 'mono3d' ? 'mono3d-test-calibration-v2:environment' : 'multi3d-test-calibration-v1:C0:environment', JSON.stringify(saved));
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d'); let n = 0;
      setInterval(() => { context.fillStyle = n++ % 2 ? '#263b42' : '#315642'; context.fillRect(0, 0, 640, 480); }, 50);
      return canvas.captureStream(20);
    };
  }, { initial: person(), saved, mode });
  await page.route('**/camera/pose.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function createPoseLandmarker(){return {landmarker:{detectForVideo(){return window.__arPose;},close(){}}};}
  ` }));
  await page.goto(`/test/${mode}/`);
  await page.locator('#start').click();
  await expect(page.locator('#useSaved')).toBeVisible();
  await page.locator('#useSaved').click();
}

function frame(mode, hits, valid = true, hit = { left_wrist: 'swept' }) {
  return { type: mode === 'mono3d' ? 'mono3d_frame' : 'multi3d_fused', hits, valid, hit,
    joints: { left_wrist: mode === 'mono3d' ? [-.2, -.1, .55] : { p: [-.2, -.1, .55], cams: ['C0', 'C1'], err_px: 1 } },
    reasons: {}, cameras: {}, cameras_used: ['C0', 'C1'], geometry_warnings: [],
    building: { center: [0, 0, .5], half: [.15, .15, .5] } };
}

for (const mode of ['mono3d', 'multi3d']) {
  test(`${mode} AR PC viewer: accepted 3D hits animate and sound, with mute/dedup/reconnect boundaries`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await meterAudio(page);
    let wire, connections = 0;
    await page.routeWebSocket(`**/ws/test/${mode}**`, socket => { wire = socket; connections++; });
    await page.goto(`/test/${mode}/view.html`);
    await expect(page.locator('#sound')).toHaveText('소리 끄기');
    await page.locator('#scene').click();
    await expect.poll(() => connections).toBe(1);
    const calibration = { type: `${mode}_calib`, camera_id: 'C0', image: { width: W, height: H }, K, camera: pose,
      R: pose.R, t: pose.t, C: pose.C, marker_side_m: .2, building: frame(mode, 0).building };
    wire.send(JSON.stringify(calibration));
    wire.send(JSON.stringify(frame(mode, 5)));
    await expect(page.locator('#hits')).toHaveText('5');
    expect(await count(page)).toBe(0);
    expect((await effect(page)).total).toBe(0);
    wire.send(JSON.stringify(frame(mode, 6)));
    await expect.poll(() => count(page)).toBe(1);
    await expect.poll(() => rms(page), { intervals: [20, 50, 100] }).toBeGreaterThan(.001);
    await expect.poll(() => effect(page)).toMatchObject({ total: 1, active: 1, lastOrigin: [-.15, -.1, .55] });
    await expect.poll(async () => (await effect(page)).renderedFrames).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`${mode}-impact.png`), fullPage: true });
    wire.send(JSON.stringify(frame(mode, 6)));
    wire.send(JSON.stringify(frame(mode, 7, false)));
    await expect(page.locator('#hits')).toHaveText('7');
    expect(await count(page)).toBe(1);
    expect((await effect(page)).total).toBe(1);
    await page.locator('#sound').click();
    await expect(page.locator('#sound')).toHaveText('소리 켜기');
    await expect.poll(() => rms(page)).toBeLessThan(.0001);
    wire.send(JSON.stringify(frame(mode, 8)));
    await expect(page.locator('#hits')).toHaveText('8');
    expect(await count(page)).toBe(1);
    expect((await effect(page)).total).toBe(2); // Muting audio must keep the visual feedback.
    await page.locator('#sound').click();
    wire.send(JSON.stringify(frame(mode, 9)));
    await expect.poll(() => count(page)).toBe(2);
    wire.close();
    await expect.poll(() => connections).toBe(2);
    wire.send(JSON.stringify(frame(mode, 12)));
    await expect(page.locator('#hits')).toHaveText('12');
    expect(await count(page)).toBe(2);
    expect(await effect(page)).toMatchObject({ total: 3, active: 0 });
    wire.send(JSON.stringify(frame(mode, 13)));
    await expect.poll(() => count(page)).toBe(3);
    expect((await effect(page)).total).toBe(4);
    expect(await page.evaluate(() => window.__arAudio.contexts.length)).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect.poll(() => page.evaluate(() => window.__arAudio.contexts[0].context.state)).toBe('closed');
    expect(errors).toEqual([]);
  });
}

test('mono3d AR phone: calibrated 3D wrist entry produces sound and projected impact animation', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await meterAudio(page);
  await page.routeWebSocket('**/ws/test/mono3d**', () => {});
  await phoneCamera(page, 'mono3d');
  await expect(page.locator('#bodyLive')).toContainText('마커 중심 · 양발/직립 확인됨');
  await page.locator('#delay').selectOption('3');
  await page.locator('#calibBody').click();
  await expect(page.locator('#toMeasure')).toBeVisible({ timeout: 15000 });
  await page.locator('#toMeasure').click();
  expect(await count(page)).toBe(0);
  await page.evaluate(input => { window.__arPose = input; }, person([0, .7, .5]));
  await expect(page.locator('#hits')).toHaveText('1');
  await expect.poll(() => count(page)).toBe(1);
  await expect.poll(() => rms(page), { intervals: [20, 50, 100] }).toBeGreaterThan(.001);
  await expect.poll(() => effect(page)).toMatchObject({ total: 1, active: 1 });
  await expect.poll(async () => (await effect(page)).renderedFrames).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('mono3d-phone-impact.png'), fullPage: true });
  await expect.poll(() => rms(page)).toBeLessThan(.0001);
  expect(await count(page)).toBe(1);
  await expect.poll(() => effect(page)).toMatchObject({ total: 1, active: 0, particles: 0 });
  expect(await page.evaluate(() => window.__arAudio.contexts.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('multi3d AR phone: newly accepted server 3D hits animate once with sound', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await meterAudio(page);
  let wire;
  await page.routeWebSocket('**/ws/test/multi3d**', socket => { wire = socket; });
  await phoneCamera(page, 'multi3d');
  await expect.poll(() => Boolean(wire)).toBe(true);
  wire.send(JSON.stringify(frame('multi3d', 5)));
  await expect(page.locator('#hits')).toHaveText('5');
  expect(await count(page)).toBe(0);
  expect((await effect(page)).total).toBe(0);
  wire.send(JSON.stringify(frame('multi3d', 6)));
  await expect.poll(() => count(page)).toBe(1);
  await expect.poll(() => rms(page), { intervals: [20, 50, 100] }).toBeGreaterThan(.001);
  await expect.poll(() => effect(page)).toMatchObject({ total: 1, active: 1 });
  await expect.poll(async () => (await effect(page)).renderedFrames).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('multi3d-phone-impact.png'), fullPage: true });
  wire.send(JSON.stringify(frame('multi3d', 6)));
  wire.send(JSON.stringify(frame('multi3d', 7, false)));
  await expect(page.locator('#hits')).toHaveText('7');
  expect(await count(page)).toBe(1);
  expect((await effect(page)).total).toBe(1);
  expect(await page.evaluate(() => window.__arAudio.contexts.length)).toBe(1);
  expect(errors).toEqual([]);
});
