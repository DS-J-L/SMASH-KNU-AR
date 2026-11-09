// Marker orientation from the ArUco pattern (web/test/multi3d/aruco.js), synthetic images.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orientMarkerCorners, ID0_BITS, rotateBits } from '../web/test/multi3d/aruco.js';
import { homography, orderMarkerCorners } from '../web/test/mono3d/geometry.js';

// Gray image of marker id0 seen through a perspective quad (TL, TR, BR, BL image positions).
function render(quad, noise = 0) {
  const H = homography([[0, 0], [6, 0], [6, 6], [0, 6]], quad);
  const m = [[H[0], H[1], H[2]], [H[3], H[4], H[5]], [H[6], H[7], H[8]]];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det]];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
  return (x, y) => {
    const w = inv[2][0] * x + inv[2][1] * y + inv[2][2];
    const u = (inv[0][0] * x + inv[0][1] * y + inv[0][2]) / w, v = (inv[1][0] * x + inv[1][1] * y + inv[1][2]) / w;
    if (u < 0 || v < 0 || u >= 6 || v >= 6) return 230 + rnd();
    const c = Math.floor(u), r = Math.floor(v);
    if (c === 0 || r === 0 || c === 5 || r === 5) return 25 + rnd();
    return (ID0_BITS[r - 1][c - 1] ? 210 : 30) + rnd();
  };
}

const QUAD = [[500, 1548], [700, 1556], [730, 1690], [498, 1682]];   // like the photo, TL..BR..BL

test('pattern read gives the canonical corner order from any tap order', () => {
  const gray = render(QUAD, 20);
  for (let s = 0; s < 4; s++) {
    const taps = [0, 1, 2, 3].map(k => QUAD[(k + s) % 4]);
    for (const order of [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0]]) {
      const ring = orderMarkerCorners(order.map(i => taps[i]));
      const got = orientMarkerCorners(gray, ring);
      assert.ok(got, `rotation ${s}`);
      assert.deepEqual(got.corners, QUAD);
      assert.equal(got.errors, 0);
    }
  }
});

test('marker turned on the floor: the order follows the pattern, not the screen', () => {
  // Same quad but the printed marker lies rotated 90°: its TL is now the screen top-right corner.
  const turned = [QUAD[1], QUAD[2], QUAD[3], QUAD[0]];
  const got = orientMarkerCorners(render(turned), orderMarkerCorners(QUAD));
  assert.deepEqual(got.corners, turned);
});

test('no marker or a different pattern is refused', () => {
  assert.equal(orientMarkerCorners(() => 128, orderMarkerCorners(QUAD)), null);       // flat
  const other = (x, y) => (Math.floor(x / 10) % 2 ? 200 : 30);                         // stripes
  assert.equal(orientMarkerCorners(other, orderMarkerCorners(QUAD)), null);
  // id0 is not rotation-symmetric, so only one rotation can match
  const rots = [ID0_BITS, rotateBits(ID0_BITS), rotateBits(rotateBits(ID0_BITS)), rotateBits(rotateBits(rotateBits(ID0_BITS)))];
  const keys = new Set(rots.map(r => JSON.stringify(r)));
  assert.equal(keys.size, 4);
});
