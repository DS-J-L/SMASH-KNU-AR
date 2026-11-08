// Single-camera APPROXIMATE 3D from MediaPipe Pose + a calibrated floor marker. Test only.
// Idea: the foot that touches the floor is found exactly (ray ∩ floor). The rest of the body is placed
// around it with MediaPipe worldLandmarks (hip-centred, metric-ish, camera-aligned axes), scaled by a
// one-time body calibration. Each joint is then snapped onto its own 2D pixel ray, so the left/right/up
// error comes from the 2D detection and only the depth along the ray comes from the body model.
// Output is tagged source:'mono_approx' and must never be reported as multi-view 3D.
import {
  sub, add, scale, norm, normalize, mid, transposeMul, project, pixelRay, intersectZ, intersectPlane, closestOnRay,
} from './geometry.js?v=20261109-4';

export const LM = {
  nose: 0, left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26,
  left_ankle: 27, right_ankle: 28, left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32,
};
export const OUTPUT_JOINTS = ['nose', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
export const FOOT_HEIGHT_M = 0.03;   // heel / toe landmark height above the floor, rough
export const ANKLE_HEIGHT_M = 0.08;  // ankle landmark height, used when heel/toe are not detected
export const MIN_VISIBILITY = 0.5;
export const FOOT_MIN_VISIBILITY = 0.3;  // feet are small and often low-confidence at the frame edge
export const NOSE_TO_HEIGHT = 0.92;  // nose height ≈ 0.92 × body height, rough anthropometric ratio
const SAME_FLOOR_M = 0.08;

const inFrame = lm => lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;
const visible = (lm, min = MIN_VISIBILITY) => lm && Number.isFinite(lm.visibility) && lm.visibility >= min && inFrame(lm);
const pixel = (K, lm) => [lm.x * K.width, lm.y * K.height];
const vec = w => [w.x, w.y, w.z];
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

function footObservation(K, pose, landmarks, world, side) {
  let ids = [LM[`${side}_heel`], LM[`${side}_foot_index`]].filter(i => visible(landmarks[i], FOOT_MIN_VISIBILITY) && world[i]);
  let height = FOOT_HEIGHT_M;
  if (!ids.length) {                         // heel/toe missed: fall back to the ankle
    ids = [LM[`${side}_ankle`]].filter(i => visible(landmarks[i], FOOT_MIN_VISIBILITY) && world[i]);
    height = ANKLE_HEIGHT_M;
  }
  if (!ids.length) return null;
  const px = ids.map(i => pixel(K, landmarks[i]));
  const u = px.reduce((s, p) => s + p[0], 0) / px.length, v = px.reduce((s, p) => s + p[1], 0) / px.length;
  const m = scale(ids.map(i => vec(world[i])).reduce(add), 1 / ids.length);
  const floor = intersectZ(pixelRay(K, pose, u, v), height);
  return floor ? { side, floor, mp: m, mp_up: transposeMul(pose.R, m)[2] - height } : null;
}

// Head point for the height measurement: nose, else the middle of the eyes.
function headObservation(landmarks, world) {
  if (visible(landmarks[LM.nose]) && world[LM.nose]) return { lm: landmarks[LM.nose], mp: vec(world[LM.nose]) };
  const eyes = [2, 5];
  if (eyes.every(i => visible(landmarks[i]) && world[i])) {
    const [a, b] = eyes.map(i => landmarks[i]);
    return { lm: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, mp: mid(vec(world[2]), vec(world[5])) };
  }
  return null;
}

// The lower foot (in body-model world height) is the one standing on the floor.
export function floorAnchor(K, pose, landmarks, world) {
  const feet = ['left', 'right'].map(s => footObservation(K, pose, landmarks, world, s)).filter(Boolean);
  if (!feet.length) return null;
  feet.sort((a, b) => a.mp_up - b.mp_up);
  const used = feet.length === 2 && feet[1].mp_up - feet[0].mp_up < SAME_FLOOR_M ? feet : [feet[0]];
  return {
    source: 'floor',
    point_w: scale(used.map(f => f.floor).reduce(add), 1 / used.length),
    mp: scale(used.map(f => f.mp).reduce(add), 1 / used.length),
    feet: used.map(f => f.side),
  };
}

// Fallback without visible feet: slide the hip centre along its pixel ray until the calibrated
// hip→shoulder vector (orientation from the body model) projects to the observed pixel length.
export function torsoAnchor(K, pose, landmarks, world, bodyScale) {
  const ids = [LM.left_shoulder, LM.right_shoulder, LM.left_hip, LM.right_hip];
  if (!(bodyScale > 0) || !ids.every(i => visible(landmarks[i]) && world[i])) return null;
  const [ls, rs, lh, rh] = ids.map(i => pixel(K, landmarks[i]));
  const sh = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2], hip = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2];
  const lengthPx = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
  if (lengthPx < 10) return null;
  const mpHip = mid(vec(world[LM.left_hip]), vec(world[LM.right_hip]));
  const up = scale(transposeMul(pose.R, sub(mid(vec(world[LM.left_shoulder]), vec(world[LM.right_shoulder])), mpHip)), bodyScale);
  const ray = pixelRay(K, pose, ...hip);
  const projectedLength = d => {
    const h = add(ray.origin, scale(ray.dir, d)), a = project(K, pose, h), b = project(K, pose, add(h, up));
    return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
  };
  let lo = 0.3, hi = 15;
  if (!(projectedLength(lo) > lengthPx && projectedLength(hi) < lengthPx)) return null;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (projectedLength(m) > lengthPx) lo = m; else hi = m; }
  return { source: 'torso_scale', point_w: add(ray.origin, scale(ray.dir, (lo + hi) / 2)), mp: mpHip, feet: [] };
}

// One calibration sample: person standing still, at least one foot and the head visible.
export function measureBody(K, pose, landmarks, world) {
  if (!landmarks || !world) return { ok: false, reason: 'no_person' };
  const anchor = floorAnchor(K, pose, landmarks, world);
  if (!anchor) return { ok: false, reason: 'feet_not_visible' };
  const head = headObservation(landmarks, world);
  if (!head) return { ok: false, reason: 'head_not_visible' };
  const toward = sub(anchor.point_w, pose.C);
  const n = normalize([toward[0], toward[1], 0]);           // vertical plane facing the camera
  const noseW = intersectPlane(pixelRay(K, pose, ...pixel(K, head.lm)), anchor.point_w, n);
  if (!noseW) return { ok: false, reason: 'nose_ray_failed' };
  const realUp = noseW[2] - anchor.point_w[2];
  const mpUp = transposeMul(pose.R, sub(head.mp, anchor.mp))[2];
  if (!(mpUp > 0.5) || !(realUp > 0.3)) return { ok: false, reason: 'not_upright' };
  const torsoMp = norm(sub(
    mid(vec(world[LM.left_shoulder]), vec(world[LM.right_shoulder])),
    mid(vec(world[LM.left_hip]), vec(world[LM.right_hip]))));
  return { ok: true, scale: realUp / mpUp, nose_height_m: noseW[2], mp_up: mpUp, torso_mp: torsoMp,
    stand_point_w: anchor.point_w };
}

// Median over samples. `heightM` (optional, user's real height) overrides the image-based scale.
export function finalizeBody(samples, heightM = null) {
  const ok = samples.filter(s => s.ok);
  if (ok.length < 5) return null;
  const imageScale = median(ok.map(s => s.scale));
  const scaleFromHeight = heightM > 0 ? median(ok.map(s => (NOSE_TO_HEIGHT * heightM - FOOT_HEIGHT_M) / s.mp_up)) : null;
  const s = scaleFromHeight ?? imageScale;
  return {
    scale: s,
    scale_source: scaleFromHeight ? 'user_height' : 'image',
    image_scale: imageScale,
    estimated_height_m: median(ok.map(x => x.nose_height_m)) / NOSE_TO_HEIGHT,
    torso_m: median(ok.map(x => x.torso_mp)) * s,
    samples: ok.length,
  };
}

export function estimate(K, pose, landmarks, world, body) {
  if (!body?.scale) return { valid: false, reason: 'body_not_calibrated', source: 'mono_approx' };
  if (!landmarks || !world) return { valid: false, reason: 'no_person', source: 'mono_approx' };
  const anchor = floorAnchor(K, pose, landmarks, world) || torsoAnchor(K, pose, landmarks, world, body.scale);
  if (!anchor) return { valid: false, reason: 'no_floor_or_torso_anchor', source: 'mono_approx' };
  const joints = {};
  for (const name of OUTPUT_JOINTS) {
    const i = LM[name];
    if (!visible(landmarks[i]) || !world[i]) { joints[name] = null; continue; }
    const model = add(anchor.point_w, scale(transposeMul(pose.R, sub(vec(world[i]), anchor.mp)), body.scale));
    const snapped = closestOnRay(pixelRay(K, pose, ...pixel(K, landmarks[i])), model);
    joints[name] = { position_m: snapped, model_m: model, ray_residual_m: norm(sub(model, snapped)),
      visibility: landmarks[i].visibility };
  }
  return { valid: true, source: 'mono_approx', anchor_source: anchor.source, anchor_feet: anchor.feet,
    anchor_m: anchor.point_w, joints };
}

// Box: { center:[x,y,z], half:[hx,hy,hz] } (legacy { center, size } = cube still accepted).
const halfOf = box => box.half ?? [box.size / 2, box.size / 2, box.size / 2];

export function insideBox(box, P, marginM = 0) {
  const h = halfOf(box);
  return !!P && [0, 1, 2].every(k => Math.abs(P[k] - box.center[k]) <= h[k] + marginM);
}

export const WAIST_TO_HEIGHT = 0.6;     // waist (navel) height ≈ 0.6 × body height, rough
export const DEFAULT_WAIST_M = 0.95;

// Waist height for the building: real height if given, else the calibrated estimate, else a default.
export function waistHeightM(body, heightM = null) {
  const h = heightM > 0 ? heightM : body?.estimated_height_m;
  return h > 0 ? Math.min(1.3, Math.max(0.6, WAIST_TO_HEIGHT * h)) : DEFAULT_WAIST_M;
}

// A building standing on the floor: footprint centred at (x, y), base z = 0, top z = heightM.
export function buildingBox(x, y, widthM, depthM, heightM) {
  return { center: [x, y, heightM / 2], half: [widthM / 2, depthM / 2, heightM / 2] };
}

// Does the segment A→B pass through the box (slab method)? Catches fast swings between frames.
export function segmentHitsBox(box, A, B, marginM = 0) {
  if (!A || !B) return insideBox(box, B, marginM);
  const h = halfOf(box);
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const lo = box.center[k] - h[k] - marginM, hi = box.center[k] + h[k] + marginM, d = B[k] - A[k];
    if (Math.abs(d) < 1e-12) { if (A[k] < lo || A[k] > hi) return false; continue; }
    let a = (lo - A[k]) / d, b = (hi - A[k]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
