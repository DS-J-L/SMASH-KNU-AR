import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrateMarker, intrinsicsFromFov, markerCorners, project,
  normalize, cross, scale, matVec } from '../web/test/mono3d/geometry.js';

const W = 720, H = 1280, FOV = 80, side = 0.2;
function scene(C) {
  const f = normalize(scale(C, -1)), r = normalize(cross(f, [0, 0, 1])), d = cross(f, r);
  const R = [...r, ...d, ...f], pose = { R, t: scale(matVec(R, C), -1), C };
  const K = intrinsicsFromFov(W, H, FOV);
  return { pose, pixels: markerCorners(side).map(([x, y]) => project(K, pose, [x, y, 0])) };
}

test('tiny foreshortened marker cannot accept a wrong normal even with low pixel residual', () => {
  // Camera really at [0,-4,1]; +/-4px taps previously fitted C=[-.12,4.03,.64]
  // with only 1.70px residual, despite the floor normal turning by 156 degrees.
  const pixels = [[337.1736909535472,638.2785926039988], [381.6364890958424,638.3864981595153],
    [378.1306372521104,648.1180004507455], [337.15197339899527,641.6965827264044]];
  const out = calibrateMarker(W, H, pixels, side, FOV);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'marker_too_small_or_oblique');
});

test('clear floor markers preserve the vertical axis from different sides and corner rotations', () => {
  for (const C of [[0,-1,1], [1,0,1], [0,1,1], [-1,0,1], [.5,-.5,1.5]]) {
    const { pose, pixels } = scene(C);
    for (let shift = 0; shift < 4; shift++) {
      const out = calibrateMarker(W, H, pixels.map((_, i) => pixels[(i + shift) % 4]), side, FOV);
      assert.equal(out.ok, true, JSON.stringify({ C, shift, out }));
      const cos = [2,5,8].reduce((s, k) => s + out.pose.R[k] * pose.R[k], 0);
      assert.ok(cos > .999999, `floor normal ${cos}`);
    }
  }
});

test('duplicate and non-finite corners are refused before solving', () => {
  for (const pixels of [[[0,0],[1,0],[1,0],[0,1]], [[0,0],[100,0],[100,100],[NaN,100]]]) {
    assert.equal(calibrateMarker(W, H, pixels, side, FOV).ok, false);
  }
});

test('large but ambiguous marker is refused when one-pixel changes swing the normal', () => {
  const pixels = [[298.11943838518175,595.065884234077], [420.73730058263925,592.6865868565353],
    [422.9734012374373,690.9404845806778], [300.51131488553267,691.946313525644]];
  const out = calibrateMarker(W, H, pixels, side, FOV);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unstable_floor_normal');
});

test('quality decisions are unchanged when the raw image resolution doubles', () => {
  for (const C of [[0,-1,1], [0,-4,1]]) {
    const { pixels } = scene(C);
    const a = calibrateMarker(W, H, pixels, side, FOV);
    const b = calibrateMarker(W*2, H*2, pixels.map(p => p.map(x => x*2)), side, FOV);
    assert.equal(a.ok, b.ok);
    assert.equal(a.reason, b.reason);
    if (a.ok) assert.ok(Math.abs(a.normal_sensitivity_deg - b.normal_sensitivity_deg) < 1e-6);
  }
});
