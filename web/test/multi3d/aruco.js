// Reads which way the floor marker (ArUco DICT_4X4_50, id 0) is turned, from 4 tapped corners.
// Every phone must use the same world axes, so the corner order cannot depend on where the phone
// stands (the single-camera page uses "farthest edge = front"; that differs between phones).
// Canonical corner order = marker image TL, TR, BR, BL = world (-a,+a), (+a,+a), (+a,-a), (-a,-a)
// (assets/markers/floor-direction-id0.json: front +Y, right +X).

// Inner 4x4 bits of id 0 (1 = white), row by row from the marker image's top-left.
export const ID0_BITS = [
  [1, 0, 1, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [0, 0, 1, 0],
];

// Homography from marker grid units (0..6 on both axes) to image pixels; corners clockwise from TL.
function gridHomography(corners) {
  const src = [[0, 0], [6, 0], [6, 6], [0, 6]], A = [], b = [];
  src.forEach(([X, Y], i) => {
    const [u, v] = corners[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  });
  const n = 8, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const h = M.map((row, i) => row[n] / row[i]);
  return (X, Y) => { const w = h[6] * X + h[7] * Y + 1; return [(h[0] * X + h[1] * Y + h[2]) / w, (h[3] * X + h[4] * Y + h[5]) / w]; };
}

// Mean brightness of the middle of each inner cell (3x3 samples per cell, avoids cell edges).
export function sampleCells(gray, corners) {
  const H = gridHomography(corners);
  if (!H) return null;
  const cells = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 4; c++) {
      let sum = 0, n = 0;
      for (const dy of [0.3, 0.5, 0.7]) for (const dx of [0.3, 0.5, 0.7]) {
        const v = gray(...H(c + 1 + dx, r + 1 + dy));
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      row.push(n ? sum / n : NaN);
    }
    cells.push(row);
  }
  return cells;
}

// Two-class split (Otsu on 16 values) → bits.
export function binarize(cells) {
  const values = cells.flat();
  if (values.some(v => !Number.isFinite(v))) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let best = { score: -1, t: 0 };
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted.slice(0, i), hi = sorted.slice(i);
    const m0 = lo.reduce((s, v) => s + v, 0) / lo.length, m1 = hi.reduce((s, v) => s + v, 0) / hi.length;
    const score = lo.length * hi.length * (m1 - m0) ** 2;
    if (score > best.score) best = { score, t: (sorted[i - 1] + sorted[i]) / 2, contrast: m1 - m0 };
  }
  if (!(best.contrast > 30)) return null;          // flat patch: not the marker (0..255 scale)
  return cells.map(row => row.map(v => (v > best.t ? 1 : 0)));
}

const rotate = bits => bits[0].map((_, c) => bits.map(row => row[c]).reverse());   // 90° clockwise

// corners: any clockwise-on-screen order (e.g. from orderMarkerCorners). Returns the same corners
// re-ordered to the canonical TL, TR, BR, BL, or null when the pattern does not match id 0.
export function orientMarkerCorners(gray, corners, maxErrors = 1) {
  let best = null;
  for (let shift = 0; shift < 4; shift++) {
    const ordered = [0, 1, 2, 3].map(k => corners[(k + shift) % 4]);
    const cells = sampleCells(gray, ordered);
    const bits = cells && binarize(cells);
    if (!bits) continue;
    const errors = bits.flat().reduce((s, v, i) => s + (v !== ID0_BITS[Math.floor(i / 4)][i % 4] ? 1 : 0), 0);
    if (!best || errors < best.errors) best = { corners: ordered, errors, shift };
  }
  return best && best.errors <= maxErrors ? best : null;
}

// Canvas → gray sampler (nearest pixel, 0..255).
export function graySampler(canvas) {
  const W = canvas.width, H = canvas.height, data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  return (x, y) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return NaN;
    const i = (iy * W + ix) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
}

export { rotate as rotateBits };
