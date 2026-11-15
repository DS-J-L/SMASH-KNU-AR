// Pure pinhole-camera geometry for the single-camera approximate 3D test. No DOM, no server.
// World: room_z_up, metres, origin = marker centre, +X right / +Y away from the camera / +Z up.
// Camera: OpenCV (+x right, +y down, +z forward). Xc = R·Xw + t, R stored row-major 3x3.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => scale(a, 1 / norm(a));
export const mid = (a, b) => scale(add(a, b), 0.5);
export const matVec = (M, v) => [0, 1, 2].map(r => M[3 * r] * v[0] + M[3 * r + 1] * v[1] + M[3 * r + 2] * v[2]);
export const transposeMul = (M, v) => [0, 1, 2].map(c => M[c] * v[0] + M[3 + c] * v[1] + M[6 + c] * v[2]);

// Diagonal field of view → focal length in pixels. Approximation until a lens calibration exists.
export function intrinsicsFromFov(width, height, fovDiagDeg) {
  const f = Math.hypot(width, height) / (2 * Math.tan(fovDiagDeg * Math.PI / 360));
  return { fx: f, fy: f, cx: width / 2, cy: height / 2, width, height, fov_diag_deg: fovDiagDeg };
}

// Corner order shown to the user: far-left, far-right, near-right, near-left (as seen from the camera).
export function markerCorners(sideM) {
  const a = sideM / 2;
  return [[-a, a], [a, a], [a, -a], [-a, -a]];
}

export function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
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
  return M.map((row, i) => row[n] / row[i]);
}

// Plane points (X, Y) → pixels (u, v), exactly four correspondences, h33 = 1.
export function homography(planePts, pixels) {
  const A = [], b = [];
  planePts.forEach(([X, Y], i) => {
    const [u, v] = pixels[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  });
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

// Pose of the plane z=0 from its homography (Zhang decomposition + Gram-Schmidt).
export function planePose(K, H) {
  const kinv = v => [(v[0] - K.cx * v[2]) / K.fx, (v[1] - K.cy * v[2]) / K.fy, v[2]];
  const col = i => [H[i], H[3 + i], H[6 + i]];
  const m1 = kinv(col(0)), m2 = kinv(col(1)), m3 = kinv(col(2));
  let lambda = 2 / (norm(m1) + norm(m2));
  if (m3[2] * lambda < 0) lambda = -lambda;      // marker must be in front of the camera
  const r1 = normalize(scale(m1, lambda));
  let r2 = scale(m2, lambda);
  r2 = normalize(sub(r2, scale(r1, dot(r1, r2))));
  const r3 = cross(r1, r2);
  const t = scale(m3, lambda);
  const R = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
  return { R, t, C: scale(transposeMul(R, t), -1) };
}

function rotationFromVector([x, y, z]) {
  const th = Math.hypot(x, y, z);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [a, b, c] = [x / th, y / th, z / th], s = Math.sin(th), co = Math.cos(th), v = 1 - co;
  return [co + a * a * v, a * b * v - c * s, a * c * v + b * s,
    b * a * v + c * s, co + b * b * v, b * c * v - a * s,
    c * a * v - b * s, c * b * v + a * s, co + c * c * v];
}
const matMul = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c]));

// Levenberg-Marquardt on reprojection error, starting from the homography pose (like solvePnP iterative).
export function refinePose(K, points3d, pixels, pose, iterations = 40) {
  const residual = p => points3d.flatMap((P, i) => {
    const q = project(K, p, P);
    return q ? [q[0] - pixels[i][0], q[1] - pixels[i][1]] : [1e6, 1e6];
  });
  const apply = (p, d) => ({ R: matMul(rotationFromVector(d.slice(0, 3)), p.R), t: add(p.t, d.slice(3)) });
  const cost = r => r.reduce((s, v) => s + v * v, 0);
  let current = { R: pose.R, t: pose.t }, r = residual(current), c = cost(r), lambda = 1e-3;
  for (let it = 0; it < iterations; it++) {
    const eps = 1e-6, J = [0, 1, 2, 3, 4, 5].map(k => {
      const d = [0, 0, 0, 0, 0, 0]; d[k] = eps;
      return residual(apply(current, d)).map((v, i) => (v - r[i]) / eps);
    });
    const A = [0, 1, 2, 3, 4, 5].map(i => [0, 1, 2, 3, 4, 5].map(j => J[i].reduce((s, v, n) => s + v * J[j][n], 0)));
    const g = [0, 1, 2, 3, 4, 5].map(i => -J[i].reduce((s, v, n) => s + v * r[n], 0));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const step = solveLinear(A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-9) : 0))), g);
      if (!step) { lambda *= 10; continue; }
      const next = apply(current, step), rn = residual(next), cn = cost(rn);
      if (cn < c) { current = next; r = rn; improved = true; lambda = Math.max(lambda / 10, 1e-9); c = cn; }
      else lambda *= 10;
    }
    if (!improved || c < 1e-18) break;
  }
  return { R: current.R, t: current.t, C: scale(transposeMul(current.R, current.t), -1) };
}

export function project(K, pose, P) {
  const c = add(matVec(pose.R, P), pose.t);
  if (c[2] <= 1e-6) return null;
  return [K.fx * c[0] / c[2] + K.cx, K.fy * c[1] / c[2] + K.cy];
}

export function pixelRay(K, pose, u, v) {
  return { origin: pose.C, dir: normalize(transposeMul(pose.R, [(u - K.cx) / K.fx, (v - K.cy) / K.fy, 1])) };
}

// Ray ∩ horizontal plane z = height. Null when parallel or behind the camera.
export function intersectZ(ray, height) {
  if (Math.abs(ray.dir[2]) < 1e-9) return null;
  const s = (height - ray.origin[2]) / ray.dir[2];
  return s > 0 ? add(ray.origin, scale(ray.dir, s)) : null;
}

// Ray ∩ plane through `point` with normal `n`.
export function intersectPlane(ray, point, n) {
  const d = dot(n, ray.dir);
  if (Math.abs(d) < 1e-9) return null;
  const s = dot(n, sub(point, ray.origin)) / d;
  return s > 0 ? add(ray.origin, scale(ray.dir, s)) : null;
}

export function closestOnRay(ray, P) {
  return add(ray.origin, scale(ray.dir, Math.max(0, dot(sub(P, ray.origin), ray.dir))));
}

export function cameraTiltDownDeg(pose) {
  const forward = transposeMul(pose.R, [0, 0, 1]);
  return Math.asin(-forward[2]) * 180 / Math.PI;
}

// Raw solve for the FOV search and the final quality check. A small reprojection error alone
// cannot certify the plane normal: a tiny/foreshortened quad admits very different poses.
function solveMarker(width, height, pixels, sideM, fovDiagDeg) {
  const K = intrinsicsFromFov(width, height, fovDiagDeg);
  const plane = markerCorners(sideM);
  const H = homography(plane, pixels);
  if (!H) return { ok: false, reason: 'degenerate_corners' };
  const initial = planePose(K, H);
  if (!(initial.C[2] > 0)) return { ok: false, reason: 'camera_below_floor_check_corner_order' };
  const pose = refinePose(K, plane.map(([X, Y]) => [X, Y, 0]), pixels, initial);
  if (!(pose.C[2] > 0)) return { ok: false, reason: 'camera_below_floor_check_corner_order' };
  const errors = plane.map(([X, Y], i) => {
    const p = project(K, pose, [X, Y, 0]);
    return p ? Math.hypot(p[0] - pixels[i][0], p[1] - pixels[i][1]) : Infinity;
  });
  return { ok: true, K, pose, reprojection_max_px: Math.max(...errors),
    camera_height_m: pose.C[2], tilt_down_deg: cameraTiltDownDeg(pose) };
}

export function markerCalibrationMessage(reason) {
  const messages = {
    camera_below_floor_check_corner_order: '카메라가 바닥 아래로 계산됐습니다. 마커 모서리를 다시 찍어 주세요.',
    marker_too_small_or_oblique: '마커가 너무 작거나 납작하게 보입니다. 폰을 마커에 가까이 두거나 더 위에서 내려다보고 다시 찍어 주세요.',
    unstable_floor_normal: '작은 모서리 오차에도 바닥 방향이 크게 바뀝니다. 마커를 더 크게 보이게 촬영하고 네 모서리를 다시 찍어 주세요.',
    marker_reprojection_error: '네 모서리가 일관된 바닥 자세로 맞지 않습니다. 검은 정사각형의 네 모서리를 다시 찍어 주세요.',
    degenerate_corners: '마커의 서로 다른 네 모서리를 정확히 찍어 주세요.',
  };
  return messages[reason] ?? `보정 실패: ${reason}`;
}

export function calibrateMarker(width, height, pixels, sideM, fovDiagDeg) {
  if (!(width > 0 && height > 0 && sideM > 0 && fovDiagDeg > 0 && fovDiagDeg < 180)
    || !Array.isArray(pixels) || pixels.length !== 4
    || pixels.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
    return { ok: false, reason: 'degenerate_corners' };
  }
  const edges = pixels.map((p, i) => sub([...pixels[(i + 1) % 4], 0], [...p, 0]));
  const turns = edges.map((e, i) => cross(e, edges[(i + 1) % 4])[2]);
  if (!turns.every(t => t > 0) && !turns.every(t => t < 0)) return { ok: false, reason: 'degenerate_corners' };
  const lengths = edges.map(norm);
  const area = Math.abs(pixels.reduce((s, p, i) => {
    const q = pixels[(i + 1) % 4]; return s + p[0] * q[1] - p[1] * q[0];
  }, 0)) / 2;
  const pixelScale = Math.min(width, height) / 720;
  const footprint = Math.min(...lengths, area / Math.max(...lengths));
  // Practical starting limits, not a measured real-world accuracy guarantee.
  if (footprint < 24 * pixelScale) return { ok: false, reason: 'marker_too_small_or_oblique' };
  const result = solveMarker(width, height, pixels, sideM, fovDiagDeg);
  if (!result.ok) return result;
  if (!Number.isFinite(result.reprojection_max_px) || result.reprojection_max_px > 3 * pixelScale) {
    return { ok: false, reason: 'marker_reprojection_error' };
  }
  // Perturb each raw-frame coordinate by one reference pixel. If the normal swings >15°,
  // refuse to draw a building from this ambiguous calibration instead of guessing "up".
  const normal = p => [p.R[2], p.R[5], p.R[8]];
  let maxAngle = 0;
  for (let i = 0; i < 4; i++) for (let axis = 0; axis < 2; axis++) for (const sign of [-1, 1]) {
    const moved = pixels.map(p => [...p]); moved[i][axis] += sign * pixelScale;
    const sample = solveMarker(width, height, moved, sideM, fovDiagDeg);
    if (!sample.ok) return { ok: false, reason: 'unstable_floor_normal' };
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(normal(result.pose), normal(sample.pose))))) * 180 / Math.PI;
    maxAngle = Math.max(maxAngle, angle);
  }
  if (!Number.isFinite(maxAngle) || maxAngle > 15) return { ok: false, reason: 'unstable_floor_normal' };
  return { ...result, normal_sensitivity_deg: maxAngle };
}

// Unknown lens: choose the FOV whose solution puts the camera at the known height.
// Scans the FOV range (some FOVs may fail), then bisects the first bracket. Null when no FOV fits.
export function fovForCameraHeight(width, height, pixels, sideM, targetHeightM, lo = 30, hi = 130) {
  const h = fov => { const r = solveMarker(width, height, pixels, sideM, fov); return r.ok ? r.camera_height_m - targetHeightM : NaN; };
  let prev = null;
  for (let fov = lo; fov <= hi + 1e-9; fov += 2) {
    const value = h(fov);
    if (!Number.isFinite(value)) { prev = null; continue; }
    if (prev && prev.value * value <= 0) {
      let a = prev.fov, b = fov, fa = prev.value;
      for (let i = 0; i < 50; i++) {
        const m = (a + b) / 2, fm = h(m);
        if (!Number.isFinite(fm)) return null;
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      return (a + b) / 2;
    }
    prev = { fov, value };
  }
  return null;
}

// Camera heights reachable from these corners over the FOV range: explains a failed auto-FOV.
export function cameraHeightRange(width, height, pixels, sideM, lo = 30, hi = 130) {
  const heights = [];
  for (let fov = lo; fov <= hi + 1e-9; fov += 5) {
    const r = solveMarker(width, height, pixels, sideM, fov);
    if (r.ok) heights.push({ fov, height: r.camera_height_m });
  }
  if (!heights.length) return null;
  const values = heights.map(x => x.height);
  return { min: Math.min(...values), max: Math.max(...values), samples: heights };
}

// Any tap order (and a mirrored display) → canonical image order: far-left, far-right, near-right,
// near-left. Corners are sorted clockwise on screen; the edge highest in the image is the far edge.
export function orderMarkerCorners(pixels) {
  if (pixels.length !== 4) return pixels;
  const cu = pixels.reduce((s, p) => s + p[0], 0) / 4, cv = pixels.reduce((s, p) => s + p[1], 0) / 4;
  const ring = [...pixels].sort((a, b) => Math.atan2(a[1] - cv, a[0] - cu) - Math.atan2(b[1] - cv, b[0] - cu));
  let far = 0;
  for (let i = 1; i < 4; i++) {
    const mid = j => (ring[j][1] + ring[(j + 1) % 4][1]) / 2;
    if (mid(i) < mid(far)) far = i;
  }
  return [0, 1, 2, 3].map(k => [...ring[(far + k) % 4]]);
}
