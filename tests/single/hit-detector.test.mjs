import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HitDetector, attachHitDetector, clipSegment, firstEntry } from '../../frontend/single/hit-detector.js';

// A square building at x 0.4–0.6, y 0.3–0.7 split into two triangles, plus a second block at x 0.7–0.8
// so a segment between them crosses empty space (the gap must not count).
const square = [[[0.4, 0.3], [0.6, 0.3], [0.6, 0.7]], [[0.4, 0.3], [0.6, 0.7], [0.4, 0.7]]];
const block = [[[0.7, 0.3], [0.8, 0.3], [0.8, 0.7]], [[0.7, 0.3], [0.8, 0.7], [0.7, 0.7]]];
const target = (overrides = {}) => ({ building_id: 'knu-it1-v3', transform_version: 1, active: true, triangles: [...square, ...block], ...overrides });

let ids = 0;
const detector = (config) => new HitDetector({ config, uuid: () => `event-${++ids}` });
const wrist = (x, y, visibility = 0.95) => ({ valid: true, image_norm: [x, y], visibility, reason: null });
const missing = { valid: false, image_norm: null, visibility: null, reason: 'not_detected' };
// 30 fps frames: frame n is observed at 1000 + 33n ms.
const pose = (frame_id, left, right = missing, overrides = {}) => ({
  schema: 'single_camera.v1-draft', room_id: 'room', stream_id: 'stream', server_epoch: 'epoch', run_id: 2,
  transform_version: 1, frame_id, image_width: 640, image_height: 480, observed_at_pc_ms: 1000 + 33 * frame_id,
  session_id: 'session-1', tracking_mode: 'single_view_2d', source: 'replay', task_type: 'pilot',
  wrists: { left_wrist: left, right_wrist: right }, ...overrides,
});
const run = (d, frames, t = target()) => frames.map((p) => d.update(p, typeof t === 'function' ? t(p) : t));
const inside = (point, triangles) => triangles.some((tri) => clipSegment(point, point, tri));

test('segment geometry: crossing, miss, start inside and the empty gap between blocks', () => {
  assert.deepEqual(clipSegment([0.3, 0.5], [0.7, 0.5], square[0]).map((v) => +v.toFixed(3)), [0.5, 0.75]);
  assert.equal(firstEntry([0.3, 0.1], [0.7, 0.1], square), null);
  assert.equal(firstEntry([0.61, 0.5], [0.69, 0.5], [...square, ...block]), null);
  const entry = firstEntry([0.3, 0.5], [0.9, 0.5], [...square, ...block]);
  assert.ok(entry.point[0] > 0.4 && entry.point[0] < 0.401);
  assert.ok(inside(entry.point, square));
});

test('T-SC-07 fast pass with both ends outside is one hit, entry point inside the building', () => {
  const d = detector();
  const events = run(d, [pose(1, wrist(0.2, 0.5)), pose(2, wrist(0.3, 0.5)), pose(3, wrist(0.65, 0.5))]);
  assert.deepEqual(events.slice(0, 2), [null, null]);
  const hit = events[2];
  assert.equal(hit.joint, 'left_wrist');
  assert.equal(hit.frame_id, 3);
  assert.equal(hit.previous_frame_id, 2);
  assert.ok(inside(hit.hit_point_image_norm, square));
  // 0.35 of 640 px in 33 ms over an 800 px diagonal.
  assert.equal(hit.speed_norm_per_s, +(0.35 * 640 / 800 / 0.033).toFixed(4));
  assert.equal(hit.hit_point_m, null);
  assert.equal(hit.speed_mps, null);
  for (const k of ['room_id', 'stream_id', 'run_id', 'transform_version', 'session_id', 'tracking_mode', 'source', 'task_type', 'schema']) {
    assert.equal(hit[k], pose(3)[k]);
  }
  assert.equal(hit.building_id, 'knu-it1-v3');
  // No ankles in this PoseFrame (phone or adapter not sending them yet): both ankles are invalid, wrists still work.
  assert.deepEqual(d.decisions, { left_wrist: 'hit', right_wrist: 'invalid_wrist', left_ankle: 'invalid_ankle', right_ankle: 'invalid_ankle' });
});

test('T-SC-07 miss, slow entry and resting inside never hit; re-entry needs an exit first', () => {
  const d = detector();
  const events = run(d, [
    pose(1, wrist(0.2, 0.1)), pose(2, wrist(0.35, 0.15)), // left of and above the building: missed
    pose(3, wrist(0.39, 0.5)), pose(4, wrist(0.41, 0.5)), // slow entry: too_slow, disarmed
    pose(5, wrist(0.42, 0.5)), pose(6, wrist(0.55, 0.5)), // still inside, even fast: disarmed
    pose(7, wrist(0.2, 0.5)), pose(8, wrist(0.25, 0.5)), pose(9, wrist(0.5, 0.5)), // out, then fast in: hit
  ]);
  assert.deepEqual(events.map((e) => e && e.frame_id), [null, null, null, null, null, null, null, null, 9]);
  assert.equal(d.stats.too_slow, 1);
  assert.ok(d.stats.disarmed >= 2);
  assert.equal(d.stats.missed >= 1, true);
});

test('T-SC-06 first point, occlusion, long gap and reversed time give no hit', () => {
  const d = detector();
  // First valid point already past the building: baseline only.
  assert.equal(d.update(pose(1, wrist(0.65, 0.5)), target()), null);
  assert.equal(d.decisions.left_wrist, 'baseline');
  // Occlusion in between breaks the pair: 0.66 → (lost) → 0.2 would have crossed the building.
  const occluded = run(d, [pose(2, wrist(0.66, 0.5)), pose(3, missing), pose(4, wrist(0.2, 0.5))]);
  assert.deepEqual(occluded, [null, null, null]);
  assert.equal(d.decisions.left_wrist, 'baseline');
  // 200 ms gap equals the TTL: rejected.
  const gap = [pose(5, wrist(0.2, 0.5)), pose(6, wrist(0.65, 0.5), missing, { observed_at_pc_ms: 1000 + 33 * 5 + 200 })];
  assert.deepEqual(run(d, gap), [null, null]);
  assert.equal(d.decisions.left_wrist, 'gap');
  // Same or older observation time.
  const back = [pose(7, wrist(0.2, 0.5)), pose(8, wrist(0.65, 0.5), missing, { observed_at_pc_ms: 1000 + 33 * 7 })];
  assert.deepEqual(run(d, back), [null, null]);
  assert.equal(d.decisions.left_wrist, 'gap');
});

test('a new run, transform or session resets trajectories, so its first frame is a baseline', () => {
  for (const change of [{ run_id: 3 }, { transform_version: 2 }, { session_id: 'session-2' }, { stream_id: 'stream-2' }]) {
    const d = detector();
    d.update(pose(1, wrist(0.2, 0.5)), target());
    const event = d.update(pose(2, wrist(0.65, 0.5), missing, change), target({ transform_version: change.transform_version ?? 1 }));
    assert.equal(event, null, JSON.stringify(change));
    assert.equal(d.decisions.left_wrist, 'baseline');
  }
});

test('T-SC-08 destroyed or stale target never hits; after restore the wrist must be seen outside first', () => {
  const d = detector();
  const frames = [pose(1, wrist(0.2, 0.5)), pose(2, wrist(0.65, 0.5))];
  assert.deepEqual(run(d, frames, target({ active: false })), [null, null]);
  assert.equal(d.decisions.left_wrist, 'no_target');
  assert.deepEqual(run(d, [pose(3, wrist(0.2, 0.5)), pose(4, wrist(0.65, 0.5))], target({ transform_version: 0 })), [null, null]);
  // Restored while the hand rests inside: no hit until it leaves and comes back.
  const restored = run(d, [pose(5, wrist(0.5, 0.5)), pose(6, wrist(0.55, 0.4)), pose(7, wrist(0.2, 0.4)), pose(8, wrist(0.5, 0.4))]);
  assert.deepEqual(restored.map((e) => e && e.frame_id), [null, null, null, 8]);
});

test('T-SC-11 both wrists in one frame give one event, the earlier entry; cooldown blocks a quick second strike', () => {
  const d = detector({ cooldownMs: 300 });
  const events = run(d, [
    pose(1, wrist(0.2, 0.5), wrist(0.35, 0.4)),
    pose(2, wrist(0.45, 0.5), wrist(0.65, 0.4)), // left enters at t≈0.8, right at t≈0.17
  ]);
  assert.equal(events[0], null);
  assert.equal(events[1].joint, 'right_wrist');
  assert.equal(d.decisions.left_wrist, 'hit');
  // Left was a candidate too, so it is in cooldown: exit and strike again within 300 ms is rejected.
  const again = run(d, [pose(3, wrist(0.2, 0.5)), pose(4, wrist(0.5, 0.5))]);
  assert.deepEqual(again, [null, null]);
  assert.equal(d.decisions.left_wrist, 'cooldown');
});

test('no event before the game has a session, even for a valid swing', () => {
  const d = detector();
  const idle = { session_id: null };
  assert.deepEqual(run(d, [pose(1, wrist(0.2, 0.5), missing, idle), pose(2, wrist(0.65, 0.5), missing, idle)]), [null, null]);
  assert.equal(d.stats.no_session, 1);
});

test('the speed threshold is configurable and recorded in the event', () => {
  const d = detector({ minSpeedNormPerS: 10, config_version: 'test-fast' });
  assert.deepEqual(run(d, [pose(1, wrist(0.3, 0.5)), pose(2, wrist(0.65, 0.5))]), [null, null]);
  assert.equal(d.decisions.left_wrist, 'too_slow');
  const e = detector({ config_version: 'test-default' });
  const [, hit] = run(e, [pose(1, wrist(0.3, 0.5)), pose(2, wrist(0.65, 0.5))]);
  assert.equal(hit.config_version, 'test-default');
});

test('attachHitDetector sends events to acceptHit with the current target and keeps the answers', () => {
  let listener = null;
  const sent = [];
  const monitor = {
    onPoseFrame(fn) { listener = fn; return () => { listener = null; }; },
    getTarget: () => target(),
    acceptHit(event) { sent.push(event); return { accepted: true, reject_reason: null, score_delta: 100 }; },
  };
  const attached = attachHitDetector(monitor, { detector: detector() });
  listener(pose(1, wrist(0.2, 0.5)));
  listener(pose(2, wrist(0.65, 0.5)));
  assert.equal(sent.length, 1);
  assert.deepEqual(attached.results.map((r) => [r.frame_id, r.accepted]), [[2, true]]);
  attached.dispose();
  assert.equal(listener, null);
});

test('attachHitDetector does not send events while the game is not playing (time-up)', () => {
  let listener = null;
  const sent = [];
  const monitor = {
    onPoseFrame(fn) { listener = fn; return () => {}; },
    getTarget: () => target(),
    snapshot: () => ({ phase: 'ended' }),
    acceptHit(event) { sent.push(event); return { accepted: true }; },
  };
  const attached = attachHitDetector(monitor, { detector: detector() });
  listener(pose(1, wrist(0.2, 0.5)));
  listener(pose(2, wrist(0.65, 0.5)));
  assert.equal(sent.length, 0);
  assert.deepEqual(attached.results.map((r) => r.reject_reason), ['not_playing_local']);
});

// Kicks (docs/FOOT_STRIKE.md): ankles arrive in pose.ankles with the same shape as pose.wrists.
const feet = (left = missing, right = missing) => ({ ankles: { left_ankle: left, right_ankle: right } });

test('kick: a fast ankle pass is one hit with joint left_ankle; resting or slow feet never hit', () => {
  const d = detector();
  const kick = run(d, [pose(1, missing, missing, feet(wrist(0.2, 0.6))), pose(2, missing, missing, feet(wrist(0.3, 0.6))),
    pose(3, missing, missing, feet(wrist(0.65, 0.6)))]);
  assert.deepEqual(kick.slice(0, 2), [null, null]);
  assert.equal(kick[2].joint, 'left_ankle');
  assert.ok(inside(kick[2].hit_point_image_norm, square));
  assert.equal(kick[2].config_version, 'hit-2d-2');
  assert.equal(d.decisions.left_ankle, 'hit');
  assert.equal(d.decisions.left_wrist, 'invalid_wrist');
  // A foot standing still inside the building after the kick does not hit again.
  const rest = run(d, [pose(4, missing, missing, feet(wrist(0.5, 0.6))), pose(5, missing, missing, feet(wrist(0.52, 0.6)))]);
  assert.deepEqual(rest, [null, null]);
  assert.equal(d.decisions.left_ankle, 'disarmed');
});

test('kick: an entry fast enough for a wrist (0.65 diagonals/s) is too slow for an ankle', () => {
  // 0.65 diagonals/s over 33 ms is 0.0268 of the 640 px width: 0.39 -> 0.4168 crosses x = 0.4.
  const step = 0.65 * 0.033 * 800 / 640;
  const d = detector();
  const events = run(d, [
    pose(1, wrist(0.39, 0.4), missing, feet(wrist(0.39, 0.6))),
    pose(2, wrist(0.39 + step, 0.4), missing, feet(wrist(0.39 + step, 0.6))),
  ]);
  assert.equal(events[1].joint, 'left_wrist');
  assert.equal(d.decisions.left_ankle, 'too_slow');
  const strict = detector({ minAnkleSpeedNormPerS: 0.6 });
  run(strict, [pose(1, missing, missing, feet(wrist(0.39, 0.6))), pose(2, missing, missing, feet(wrist(0.39 + step, 0.6)))]);
  assert.equal(strict.decisions.left_ankle, 'hit');
});

test('kick and punch in one frame give one event, the earlier entry; the ankle path is broken by occlusion like a wrist', () => {
  const d = detector();
  const events = run(d, [
    pose(1, wrist(0.2, 0.4), missing, feet(missing, wrist(0.35, 0.6))),
    pose(2, wrist(0.45, 0.4), missing, feet(missing, wrist(0.65, 0.6))), // wrist enters at t≈0.8, ankle at t≈0.17
  ]);
  assert.equal(events[1].joint, 'right_ankle');
  assert.equal(d.decisions.left_wrist, 'hit');
  const e = detector();
  const occluded = run(e, [pose(1, missing, missing, feet(wrist(0.66, 0.6))), pose(2, missing, missing, feet(missing)),
    pose(3, missing, missing, feet(wrist(0.2, 0.6)))]);
  assert.deepEqual(occluded, [null, null, null]);
  assert.equal(e.decisions.left_ankle, 'baseline');
});
