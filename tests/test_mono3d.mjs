import assert from 'node:assert/strict';
import test from 'node:test';
import {
  intrinsicsFromFov, markerCorners, project, calibrateMarker, fovForCameraHeight, sub, norm, normalize, cross, matVec, scale,
} from '../web/test/mono3d/geometry.js';
import { LM, measureBody, finalizeBody, estimate, floorAnchor, insideBox, segmentHitsBox, buildingBox, waistHeightM } from '../web/test/mono3d/mono3d.js';
import {visualPersonEstimate,packPersonDepth} from '../web/test/mono3d/person-depth.js';

const W = 720, H = 1280, FOV = 80;
function lookAt(C, target) {
  const f = normalize(sub(target, C)), r = normalize(cross(f, [0, 0, 1])), d = cross(f, r);
  const R = [...r, ...d, ...f];
  return { R, t: scale(matVec(R, C), -1), C };
}
const K = intrinsicsFromFov(W, H, FOV);
const truePose = lookAt([0.1, -1.15, 1.0], [0, 0.6, 0.6]);
const markerPx = markerCorners(0.2).map(([X, Y]) => project(K, truePose, [X, Y, 0]));
const close = (a, b, tol) => assert.ok(norm(sub(a, b)) < tol, `${a} vs ${b}`);

test('visual torso occlusion remains available with hidden ankles without enabling collisions',()=>{
  const pose=lookAt([0,-2.2,1.05],[0,0,.7]),standing=person({at:[0,0],pose});
  const sample=measureBody(K,pose,standing.landmarks,standing.world,{markerCentered:true});assert.ok(sample.ok);
  const body=finalizeBody(Array(15).fill(sample),1.6/.92,{markerCentered:true});
  const moved=person({at:[.1,.3],pose});for(const id of [27,28,29,30,31,32])moved.landmarks[id].visibility=0;
  const tracking=estimate(K,pose,moved.landmarks,moved.world,body);assert.equal(tracking.valid,false);
  const visual=visualPersonEstimate(K,pose,moved.landmarks,moved.world,body,tracking);
  assert.equal(visual.valid,true);assert.equal(visual.source,'visual_torso_only');assert.equal(visual.collision_usable,false);
  assert.equal(tracking.valid,false);assert.equal(visual.joints.left_ankle,null);
  assert.ok(packPersonDepth({width:64,height:64,alpha:new Uint8Array(64*64).fill(255)},moved.landmarks,visual,pose));
  assert.equal(visualPersonEstimate(K,pose,moved.landmarks,moved.world,null,tracking),null);
});

test('marker corners recover the synthetic camera pose', () => {
  const r = calibrateMarker(W, H, markerPx, 0.2, FOV);
  assert.ok(r.ok);
  close(r.pose.C, truePose.C, 1e-6);
  assert.ok(r.reprojection_max_px < 1e-6);
  assert.ok(Math.abs(r.camera_height_m - 1.0) < 1e-6);
});

test('mirrored tap order is rejected, known height recovers the field of view', () => {
  const mirrored = [markerPx[1], markerPx[0], markerPx[3], markerPx[2]];
  assert.equal(calibrateMarker(W, H, mirrored, 0.2, FOV).ok, false);
  assert.ok(Math.abs(fovForCameraHeight(W, H, markerPx, 0.2, 1.0) - FOV) < 1e-3);
});

// Synthetic standing person: world joints → MediaPipe-like world landmarks (hip-centred, camera axes, wrong scale).
function person({ at = [0.05, 0.7], leftFootUp = 0, wrist = null, mpScale = 0.9, pose=truePose } = {}) {
  const [x, y] = at, P = {};
  P[LM.nose] = [x, y, 1.6];
  P[LM.left_shoulder] = [x - 0.18, y, 1.45]; P[LM.right_shoulder] = [x + 0.18, y, 1.45];
  P[LM.left_elbow] = [x - 0.25, y, 1.2]; P[LM.right_elbow] = [x + 0.25, y, 1.2];
  P[LM.left_wrist] = [x - 0.28, y, 0.95]; P[LM.right_wrist] = wrist ?? [x + 0.28, y, 0.95];
  P[LM.left_hip] = [x - 0.1, y, 0.95]; P[LM.right_hip] = [x + 0.1, y, 0.95];
  P[LM.left_knee] = [x - 0.1, y, 0.5 + leftFootUp]; P[LM.right_knee] = [x + 0.1, y, 0.5];
  P[LM.left_ankle] = [x - 0.1, y, 0.09 + leftFootUp]; P[LM.right_ankle] = [x + 0.1, y, 0.09];
  P[LM.left_heel] = [x - 0.1, y - 0.05, 0.03 + leftFootUp]; P[LM.right_heel] = [x + 0.1, y - 0.05, 0.03];
  P[LM.left_foot_index] = [x - 0.1, y + 0.12, 0.03 + leftFootUp]; P[LM.right_foot_index] = [x + 0.1, y + 0.12, 0.03];
  const hip = scale([0, 1, 2].map(k => P[LM.left_hip][k] + P[LM.right_hip][k]), 0.5);
  const landmarks = [], world = [];
  for (let i = 0; i < 33; i++) {
    if (!P[i]) { landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0 }); world.push({ x: 0, y: 0, z: 0, visibility: 0 }); continue; }
    const [u, v] = project(K, pose, P[i]);
    landmarks.push({ x: u / W, y: v / H, z: 0, visibility: 0.95 });
    const m = scale(matVec(pose.R, sub(P[i], hip)), mpScale);
    world.push({ x: m[0], y: m[1], z: m[2], visibility: 0.95 });
  }
  return { P, landmarks, world };
}

test('body calibration recovers the model scale and the person height', () => {
  const cal = calibrateMarker(W, H, markerPx, 0.2, FOV);
  const p = person();
  const samples = Array.from({ length: 6 }, () => measureBody(cal.K, cal.pose, p.landmarks, p.world));
  assert.ok(samples.every(s => s.ok));
  const body = finalizeBody(samples);
  assert.ok(Math.abs(body.scale - 1 / 0.9) < 0.03, String(body.scale)); // foot centre sits ~3.5cm in front of the nose plane
  assert.ok(Math.abs(body.estimated_height_m - 1.6 / 0.92) < 0.03, String(body.estimated_height_m));
  assert.equal(finalizeBody(samples.slice(0, 3)), null);
});

test('moved person and stretched wrist are reconstructed; lifted foot is not used as the anchor', () => {
  const cal = calibrateMarker(W, H, markerPx, 0.2, FOV);
  const base = person();
  const body = finalizeBody(Array.from({ length: 5 }, () => measureBody(cal.K, cal.pose, base.landmarks, base.world)));
  const moved = person({ at: [0.4, 1.2], leftFootUp: 0.3, wrist: [0.7, 1.05, 1.3] });
  const anchor = floorAnchor(cal.K, cal.pose, moved.landmarks, moved.world);
  assert.deepEqual(anchor.feet, ['right']);
  const r = estimate(cal.K, cal.pose, moved.landmarks, moved.world, body);
  assert.ok(r.valid); assert.equal(r.source, 'mono_approx'); assert.equal(r.anchor_source, 'floor');
  close(r.joints.right_wrist.position_m, moved.P[LM.right_wrist], 0.03);
  close(r.joints.left_wrist.position_m, moved.P[LM.left_wrist], 0.03);
});

test('torso fallback without feet, invalid states and box test', () => {
  const cal = calibrateMarker(W, H, markerPx, 0.2, FOV);
  const base = person();
  const body = finalizeBody(Array.from({ length: 5 }, () => measureBody(cal.K, cal.pose, base.landmarks, base.world)));
  const p = person({ at: [0.2, 1.0] });
  for (const i of [LM.left_heel, LM.right_heel, LM.left_foot_index, LM.right_foot_index, LM.left_ankle, LM.right_ankle]) p.landmarks[i].visibility = 0.1;
  const r = estimate(cal.K, cal.pose, p.landmarks, p.world, body);
  assert.equal(r.anchor_source, 'torso_scale');
  close(r.joints.right_wrist.position_m, p.P[LM.right_wrist], 0.03);
  assert.equal(estimate(cal.K, cal.pose, p.landmarks, p.world, null).valid, false);
  for (const i of [LM.left_shoulder, LM.right_shoulder]) p.landmarks[i].visibility = 0.1;
  assert.equal(estimate(cal.K, cal.pose, p.landmarks, p.world, body).reason, 'no_floor_or_torso_anchor');
  const box = { center: [0.5, 0, 1.1], size: 0.3 };
  assert.ok(insideBox(box, [0.6, 0.1, 1.2])); assert.ok(!insideBox(box, [0.6, 0.3, 1.2]));
  assert.ok(insideBox(box, [0.6, 0.3, 1.2], 0.2)); assert.ok(!insideBox(box, null));
});

test('auto field of view: unreachable height returns null and the reachable range explains it', async () => {
  const { cameraHeightRange } = await import('../web/test/mono3d/geometry.js');
  assert.equal(fovForCameraHeight(W, H, markerPx, 0.2, 50), null);
  const range = cameraHeightRange(W, H, markerPx, 0.2);
  assert.ok(range.min < 1.0 && range.max > 1.0, `${range.min}..${range.max}`);
  assert.ok(Math.abs(fovForCameraHeight(W, H, markerPx, 0.2, 1.0, 30, 170) - FOV) < 1e-3, 'failing FOVs near the upper end are skipped');
});

test('any tap order (including a mirrored screen order) is sorted to the canonical corner order', async () => {
  const { orderMarkerCorners } = await import('../web/test/mono3d/geometry.js');
  const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  for (const p of perms([0, 1, 2, 3])) {
    const ordered = orderMarkerCorners(p.map(i => markerPx[i]));
    ordered.forEach((q, i) => assert.ok(Math.hypot(q[0] - markerPx[i][0], q[1] - markerPx[i][1]) < 1e-9, `perm ${p}`));
    assert.ok(calibrateMarker(W, H, ordered, 0.2, FOV).ok);
  }
});

test('body calibration works with one foot, ankle-only feet and eyes instead of the nose', () => {
  const cal = calibrateMarker(W, H, markerPx, 0.2, FOV);
  const p = person();
  for (const i of [LM.left_heel, LM.left_foot_index, LM.left_ankle]) p.landmarks[i].visibility = 0.1;  // left foot hidden
  const one = measureBody(cal.K, cal.pose, p.landmarks, p.world);
  assert.ok(one.ok, one.reason); assert.ok(Math.abs(one.scale - 1 / 0.9) < 0.03);
  const q = person();
  for (const i of [LM.left_heel, LM.right_heel, LM.left_foot_index, LM.right_foot_index]) q.landmarks[i].visibility = 0.1;
  const ankles = measureBody(cal.K, cal.pose, q.landmarks, q.world);
  assert.ok(ankles.ok, ankles.reason); assert.ok(Math.abs(ankles.scale - 1 / 0.9) < 0.05, String(ankles.scale));
  const body = finalizeBody(Array.from({ length: 5 }, () => ankles));
  const r = estimate(cal.K, cal.pose, q.landmarks, q.world, body);
  assert.equal(r.anchor_source, 'floor');
  close(r.joints.right_wrist.position_m, q.P[LM.right_wrist], 0.05);
  assert.equal(measureBody(cal.K, cal.pose, null, null).reason, 'no_person');
  q.landmarks[LM.nose].visibility = 0.1;
  assert.equal(measureBody(cal.K, cal.pose, q.landmarks, q.world).reason, 'head_not_visible');
});

test('waist-high building at the marker and swing-path hit', () => {
  assert.ok(Math.abs(waistHeightM(null, 1.72) - 1.032) < 1e-9);          // real height wins
  assert.ok(Math.abs(waistHeightM({ estimated_height_m: 1.6 }) - 0.96) < 1e-9);
  assert.equal(waistHeightM(null), 0.95);                                 // no info → default
  assert.equal(waistHeightM(null, 3), 1.3);                               // clamped
  const b = buildingBox(0, 0, 0.3, 0.3, 0.96);
  assert.deepEqual(b.center, [0, 0, 0.48]);
  assert.ok(insideBox(b, [0.1, -0.1, 0.9])); assert.ok(!insideBox(b, [0.1, -0.1, 1.0]));   // above the roof
  assert.ok(!insideBox(b, [0.1, 0, -0.05])); assert.ok(insideBox(b, [0.2, 0, 0.5], 0.05));
  // Fast swing: both frames outside, the path between them crosses the building.
  assert.ok(segmentHitsBox(b, [-0.6, 0, 0.7], [0.6, 0.05, 0.7]));
  assert.ok(!segmentHitsBox(b, [-0.6, 0, 1.1], [0.6, 0, 1.1]));            // over the roof
  assert.ok(!segmentHitsBox(b, [-0.6, 0.4, 0.7], [0.6, 0.4, 0.7]));        // behind it
  assert.ok(segmentHitsBox(b, [-0.6, 0.4, 0.7], [0.6, 0.4, 0.7], 0.3));    // margin
  assert.ok(segmentHitsBox(b, [0, 0, 1.5], [0, 0, 0.2]));                  // chop from above
  assert.ok(segmentHitsBox(b, null, [0, 0, 0.5])); assert.ok(!segmentHitsBox(b, null, null));
});

const standingPose=lookAt([.1,-2.2,1.1],[0,0,.8]);
const markerSample=p=>measureBody(K,standingPose,p.landmarks,p.world,{markerCentered:true});
test('marker-centred body reference calibrates ankle height and preserves moving wrist depth',()=>{
  const base=person({at:[0,0],pose:standingPose});const sample=markerSample(base);
  assert.ok(sample.ok,JSON.stringify(sample));
  const body=finalizeBody(Array(15).fill(sample),null,{markerCentered:true});
  assert.ok(body);assert.equal(body.depth_reference.version,'marker_center_v1');
  assert.ok(Math.abs(body.depth_reference.ankle_height_m-.09)<.002);
  assert.ok(Math.abs(body.scale-1/.9)<.003);
  for(const y of [-.4,0,.6]){
    const moved=person({at:[.15,y],wrist:[.35,y-.2,1.1],pose:standingPose});
    const r=estimate(K,standingPose,moved.landmarks,moved.world,body);
    assert.ok(r.valid);assert.equal(r.anchor_source,'floor');
    close(r.joints.right_wrist.position_m,moved.P[LM.right_wrist],.005);
    close(r.joints.left_hip.position_m,moved.P[LM.left_hip],.005);
  }
});

test('marker reference refuses wrong position, one foot, lifted foot and unstable calibration',()=>{
  assert.equal(markerSample(person({at:[0,.7],pose:standingPose})).reason,'stand_on_marker');
  const hidden=person({at:[0,0],pose:standingPose});hidden.landmarks[LM.left_ankle].visibility=.1;
  assert.equal(markerSample(hidden).reason,'both_feet_required');
  assert.equal(markerSample(person({at:[0,0],leftFootUp:.12,pose:standingPose})).ok,false);
  const a=markerSample(person({at:[0,0],pose:standingPose}));assert.ok(a.ok);
  assert.equal(finalizeBody([...Array(5).fill(a),...Array(5).fill({ok:false})],null,{markerCentered:true}),null);
  const b={...a,stand_point_w:[a.stand_point_w[0]+.12,a.stand_point_w[1],a.stand_point_w[2]]};
  assert.equal(finalizeBody([...Array(8).fill(a),b],null,{markerCentered:true}),null);
  assert.equal(finalizeBody([...Array(8).fill(a),{...a,scale:a.scale*1.3}],null,{markerCentered:true}),null);
});

test('marker depth reference rejects invisible feet instead of guessing torso depth, then recovers',()=>{
  const p=person({at:[0,0],pose:standingPose});const sample=markerSample(p);
  const body=finalizeBody(Array(15).fill(sample),1.6/.92,{markerCentered:true});assert.ok(body);
  const moved=person({at:[.2,.5],pose:standingPose});
  moved.landmarks[LM.left_ankle].visibility=.1;moved.landmarks[LM.right_ankle].visibility=.1;
  const invalid=estimate(K,standingPose,moved.landmarks,moved.world,body);
  assert.equal(invalid.valid,false);assert.equal(invalid.reason,'feet_required_for_depth');
  moved.landmarks[LM.right_ankle].visibility=.95;
  const restored=estimate(K,standingPose,moved.landmarks,moved.world,body);assert.ok(restored.valid);
  assert.deepEqual(restored.anchor_feet,['right']);close(restored.joints.right_wrist.position_m,moved.P[LM.right_wrist],.005);
});

// 2026-11-20: a judging phone set high and tilted down over its marker (head out of frame) still calibrates.
test('tilted-down phone: head out of frame, shoulders set the body scale and depth stays right', () => {
  const pose = lookAt([0, -0.75, 1.9], [0, 0.25, 0.3]);
  const markerPx = markerCorners(0.27).map(([X, Y]) => project(K, pose, [X, Y, 0]));
  const cal = calibrateMarker(W, H, markerPx, 0.27, FOV);
  assert.ok(cal.ok, cal.reason); assert.ok(cal.tilt_down_deg > 45, String(cal.tilt_down_deg));
  const standing = person({ at: [0, 0], pose, mpScale: 0.9 });
  const nose = standing.landmarks[LM.nose];
  assert.ok(nose.x < 0 || nose.x > 1 || nose.y < 0 || nose.y > 1, 'precondition: nose out of frame');
  const sample = measureBody(cal.K, cal.pose, standing.landmarks, standing.world, { markerCentered: true });
  assert.ok(sample.ok, sample.reason); assert.equal(sample.scale_from, 'shoulder');
  assert.ok(Math.abs(sample.scale - 1 / 0.9) < 0.04, String(sample.scale));
  const body = finalizeBody(Array(10).fill(sample), null, { markerCentered: true });
  assert.ok(body); assert.equal(body.scale_from, 'shoulder');
  assert.ok(Math.abs(body.estimated_height_m - 1.6 / 0.92) < 0.06, String(body.estimated_height_m));
  const moved = person({ at: [0.2, 0.4], pose, mpScale: 0.9 });
  const r = estimate(cal.K, cal.pose, moved.landmarks, moved.world, body);
  assert.ok(r.valid, r.reason);
  close(r.joints.right_wrist.position_m, moved.P[LM.right_wrist], 0.06);
  close(r.joints.left_ankle.position_m, moved.P[LM.left_ankle], 0.04);
});

test('phone straight above the marker: no NaN plane, the calibration either works or says why', () => {
  const C = [0, 0, 2.6], R = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const pose = { R, t: scale(matVec(R, C), -1), C };
  const standing = person({ at: [0, 0], pose });
  const sample = measureBody(K, pose, standing.landmarks, standing.world, { markerCentered: true });
  if (sample.ok) assert.ok(Number.isFinite(sample.scale) && Number.isFinite(sample.nose_height_m));
  else assert.equal(typeof sample.reason, 'string');
});
