// K-SC-04: screen 2D hit test for the single-camera mode (docs/SINGLE_CAMERA_INTERFACES.md §4–5).
// A hit is a wrist or ankle segment between two consecutive valid frames that enters the intact
// building's projected triangles while moving fast enough. Depth is not measured; this is single_view_2d
// only. Ankles (kicks) come from pose.ankles, same shape as pose.wrists (docs/FOOT_STRIKE.md).
export const HIT_CONFIG = Object.freeze({
  config_version: 'hit-2d-2',
  // Image diagonals per second. Starting values for the live pilot, not tuned on a real phone yet.
  minSpeedNormPerS: 0.5,
  // Feet need a faster entry: a walking step also carries the foot into the building's lower edge.
  minAnkleSpeedNormPerS: 0.8,
  // Same as the PC frame TTL: a longer gap is a tracking break, not one fast swing.
  maxGapMs: 200,
  cooldownMs: 300,
  minVisibility: 0.5,
});
export const WRIST_JOINTS = Object.freeze(['left_wrist', 'right_wrist']);
export const ANKLE_JOINTS = Object.freeze(['left_ankle', 'right_ankle']);
const JOINTS = [...WRIST_JOINTS, ...ANKLE_JOINTS];
// Each joint reads its own field of the PoseFrame and has its own speed bar.
const PART = Object.fromEntries([
  ...WRIST_JOINTS.map((joint) => [joint, { field: 'wrists', invalid: 'invalid_wrist', speedKey: 'minSpeedNormPerS' }]),
  ...ANKLE_JOINTS.map((joint) => [joint, { field: 'ankles', invalid: 'invalid_ankle', speedKey: 'minAnkleSpeedNormPerS' }]),
]);
const STREAM_KEYS = ['room_id', 'stream_id', 'run_id', 'transform_version', 'session_id'];

const isNorm = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);

// Part of segment p0→p1 (t in [0,1]) inside one triangle, or null. Cyrus–Beck against its three edges.
export function clipSegment(p0, p1, triangle) {
  const [a, b, c] = triangle;
  const orientation = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (!orientation) return null;
  const d = [p1[0] - p0[0], p1[1] - p0[1]];
  let t0 = 0;
  let t1 = 1;
  for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const edge = [v[0] - u[0], v[1] - u[1]];
    // Inside means the point is on the triangle's side of this edge: f(t) = start + t * slope >= 0.
    const start = orientation * (edge[0] * (p0[1] - u[1]) - edge[1] * (p0[0] - u[0]));
    const slope = orientation * (edge[0] * d[1] - edge[1] * d[0]);
    if (Math.abs(slope) < 1e-15) {
      if (start < 0) return null;
    } else if (slope > 0) {
      t0 = Math.max(t0, -start / slope);
    } else {
      t1 = Math.min(t1, -start / slope);
    }
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

// Earliest entry of the segment into the union of triangles; gaps between triangles stay empty.
export function firstEntry(p0, p1, triangles) {
  let best = null;
  for (const triangle of triangles) {
    const span = clipSegment(p0, p1, triangle);
    if (span && (!best || span[0] < best[0])) best = span;
  }
  if (!best) return null;
  // Step just past the boundary so the reported point is inside the triangle, not on its edge.
  const t = best[0] + Math.min((best[1] - best[0]) / 2, 1e-3);
  return { t, point: [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])] };
}

const insideAny = (point, triangles) => triangles.some((triangle) => {
  const span = clipSegment(point, point, triangle);
  return span !== null;
});

export class HitDetector {
  constructor({ config = HIT_CONFIG, uuid = () => crypto.randomUUID() } = {}) {
    this.config = { ...HIT_CONFIG, ...config };
    this.uuid = uuid;
    this.reset();
  }

  // Forget every trajectory. Called by the monitor's start/reset/run changes through update() keys too.
  reset() {
    this.key = null;
    this.joints = Object.fromEntries(JOINTS.map((joint) => [joint, { previous: null, armed: false, cooldownUntil: -Infinity }]));
    this.decisions = Object.fromEntries(JOINTS.map((joint) => [joint, null]));
    this.stats = {};
  }

  // pose: PoseFrame from onPoseFrame. target: getTarget() snapshot. Returns at most one HitEvent.
  update(pose, target) {
    const key = STREAM_KEYS.map((k) => pose?.[k]).join('|');
    if (key !== this.key) {
      // New stream, run, transform or game: the old points belong to another coordinate system or session.
      this.reset();
      this.key = key;
    }
    const usable = target?.active === true && target.transform_version === pose.transform_version && Array.isArray(target.triangles);
    const candidates = [];
    for (const joint of JOINTS) {
      const decision = this.step(joint, pose, usable ? target : null);
      this.decisions[joint] = decision.reason;
      this.stats[decision.reason] = (this.stats[decision.reason] ?? 0) + 1;
      if (decision.candidate) candidates.push(decision.candidate);
    }
    if (!candidates.length) return null;
    // Before a start ACK there is no game to score; the game would only log a rejection for each swing.
    if (typeof pose.session_id !== 'string' || !pose.session_id) {
      this.stats.no_session = (this.stats.no_session ?? 0) + 1;
      return null;
    }
    // Several joints in one frame: the earlier entry wins, then the faster one. One event per frame.
    candidates.sort((a, b) => a.t - b.t || b.speed - a.speed);
    const hit = candidates[0];
    return {
      schema: 'single_camera.v1-draft',
      type: 'hit',
      room_id: pose.room_id,
      stream_id: pose.stream_id,
      session_id: pose.session_id,
      run_id: pose.run_id,
      frame_id: pose.frame_id,
      previous_frame_id: hit.previousFrameId,
      transform_version: pose.transform_version,
      tracking_mode: pose.tracking_mode,
      task_type: pose.task_type,
      source: pose.source,
      event_id: this.uuid(),
      building_id: target.building_id,
      joint: hit.joint,
      hit_point_image_norm: hit.point.map((v) => Math.round(v * 1e6) / 1e6),
      speed_norm_per_s: Math.round(hit.speed * 1e4) / 1e4,
      hit_point_m: null,
      speed_mps: null,
      observed_at_pc_ms: pose.observed_at_pc_ms,
      config_version: this.config.config_version,
    };
  }

  step(joint, pose, target) {
    const state = this.joints[joint];
    const part = PART[joint];
    const observed = pose[part.field]?.[joint];
    const config = this.config;
    if (!(observed?.valid === true && isNorm(observed.image_norm) && Number.isFinite(observed.visibility) && observed.visibility >= config.minVisibility)) {
      // Occlusion or a bad point breaks the trajectory; the next valid point is a baseline only.
      // A PoseFrame without ankles (phone or adapter not sending them yet) lands here for both ankles.
      state.previous = null;
      return { reason: part.invalid };
    }
    const current = { point: observed.image_norm, frameId: pose.frame_id, at: pose.observed_at_pc_ms };
    const previous = state.previous;
    state.previous = current;
    const inside = target ? insideAny(current.point, target.triangles) : false;
    // Re-arming needs the joint seen outside an active target, so a hand resting in the building after
    // a restore or start never hits by itself.
    const wasArmed = state.armed;
    state.armed = Boolean(target) && !inside;
    if (!previous) return { reason: 'baseline' };
    const dt = current.at - previous.at;
    if (!(current.frameId > previous.frameId) || !(dt > 0) || dt >= config.maxGapMs) return { reason: 'gap' };
    if (!target) return { reason: 'no_target' };
    if (!wasArmed) return { reason: 'disarmed' };
    const entry = firstEntry(previous.point, current.point, target.triangles);
    if (!entry) return { reason: 'missed' };
    const dx = (current.point[0] - previous.point[0]) * pose.image_width;
    const dy = (current.point[1] - previous.point[1]) * pose.image_height;
    const speed = Math.hypot(dx, dy) / Math.hypot(pose.image_width, pose.image_height) / (dt / 1000);
    // A slow entry is not a strike; the joint is inside now and must leave before it can hit.
    state.armed = false;
    if (speed < config[part.speedKey]) return { reason: 'too_slow' };
    if (current.at < state.cooldownUntil) return { reason: 'cooldown' };
    state.cooldownUntil = current.at + config.cooldownMs;
    return { reason: 'hit', candidate: { joint, t: entry.t, point: entry.point, speed, previousFrameId: previous.frameId } };
  }
}

// Wires the detector to window.singleCameraMonitor; acceptHit's answer is kept for the log and tests.
export function attachHitDetector(monitor, { detector = new HitDetector(), onResult = () => {} } = {}) {
  const results = [];
  const unsubscribe = monitor.onPoseFrame((pose) => {
    const event = detector.update(pose, monitor.getTarget());
    if (!event) return;
    // After time-up the session id is still set; the game would only log a not_playing rejection per swing.
    const phase = monitor.snapshot?.().phase;
    if (phase !== undefined && phase !== 'playing') {
      results.push({ event_id: event.event_id, joint: event.joint, frame_id: event.frame_id, accepted: false, reject_reason: 'not_playing_local', score_delta: 0 });
      if (results.length > 50) results.shift();
      return;
    }
    const result = monitor.acceptHit(event);
    results.push({ event_id: event.event_id, joint: event.joint, frame_id: event.frame_id, ...result });
    if (results.length > 50) results.shift();
    onResult(event, result);
  });
  return { detector, results, dispose: unsubscribe };
}
