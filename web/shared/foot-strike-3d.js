// Kicks against the 3D building box (docs/FOOT_STRIKE.md). Browser twin of backend/foot_strike.py:
// same rules, same config keys, same output; both are checked against tests/fixtures/foot_strike_cases.json.
// Positions are metres in the floor-marker frame of /test/mono3d/ and /test/multi3d/: x, y on the floor,
// z up, floor at z = 0. box is { center: [x, y, z], half: [hx, hy, hz], margin? } like mono3d buildingBox().
// A kick has the ankle lifted (min_lift_m) and moving fast (min_speed_mps): a walking step also carries the
// ankle into a building that stands on the floor. "Standing in the building" looks at the planted foot only.
// All numbers are starting values, not tuned on real phones yet.
export const FOOT_STRIKE_CONFIG = Object.freeze({
  config_version: 'foot-3d-1',
  min_lift_m: 0.20,
  min_speed_mps: 1.5,
  max_gap_ms: 250,
  max_jump_m: 1.5,
  cooldown_ms: 300,
  stand_clearance_m: 0.10,
});
export const ANKLES = Object.freeze(['left_ankle', 'right_ankle']);
const HIPS = ['left_hip', 'right_hip'];

const point = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? p.map(Number) : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round3 = (v) => Math.round(v * 1000) / 1000;

export function insideBox(box, p, margin = 0) {
  return !!p && [0, 1, 2].every((k) => Math.abs(p[k] - box.center[k]) <= box.half[k] + margin);
}

// Does the segment a→b pass through the box (slab method)?
export function segmentHitsBox(box, a, b, margin = 0) {
  if (!a || !b) return insideBox(box, b, margin);
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const lo = box.center[k] - box.half[k] - margin, hi = box.center[k] + box.half[k] + margin, d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) { if (a[k] < lo || a[k] > hi) return false; continue; }
    let u = (lo - a[k]) / d, v = (hi - a[k]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

// The planted foot: the lowest ankle below min_lift_m; without one, the mean of the visible hips.
export function supportPoint(positions, config = FOOT_STRIKE_CONFIG) {
  let best = null;
  for (const name of ANKLES) {
    const p = point(positions?.[name]);
    if (p && p[2] < config.min_lift_m && (!best || p[2] < best.point[2])) best = { name, point: p };
  }
  if (best) return best;
  const hips = HIPS.map((name) => point(positions?.[name])).filter(Boolean);
  if (hips.length) return { name: 'hips', point: [0, 1, 2].map((k) => hips.reduce((s, p) => s + p[k], 0) / hips.length) };
  return { name: null, point: null };
}

export function standingInBuilding(positions, box, config = FOOT_STRIKE_CONFIG) {
  const { point: p } = supportPoint(positions, config);
  return !!p && [0, 1].every((k) => Math.abs(p[k] - box.center[k]) <= box.half[k] + config.stand_clearance_m);
}

// One per tracked person. Call update() once per frame, in time order.
export class FootStrikeJudge {
  constructor(config = {}) {
    this.config = { ...FOOT_STRIKE_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.prev = Object.fromEntries(ANKLES.map((n) => [n, null]));        // { p, t }
    this.wasInside = Object.fromEntries(ANKLES.map((n) => [n, false]));
    this.lastHitAt = Object.fromEntries(ANKLES.map((n) => [n, -Infinity]));
    this.hits = 0;
  }

  // positions: name -> [x, y, z] or null (ankles, optionally hips). Returns this frame's result.
  update(positions, box, tMs) {
    const c = this.config;
    const margin = Number(box.margin) || 0;
    const support = supportPoint(positions, c).name;
    const standing = standingInBuilding(positions, box, c);
    const hit = {}, decisions = {}, speeds = {};
    for (const name of ANKLES) {
      const p = point(positions?.[name]);
      const prev = this.prev[name];
      speeds[name] = null;
      if (!p) {
        // Occlusion breaks the path; the next point is a baseline.
        this.prev[name] = null; this.wasInside[name] = false;
        decisions[name] = 'invalid';
        continue;
      }
      const inside = insideBox(box, p, margin);
      const dt = prev ? tMs - prev.t : null;
      const d = prev ? dist(p, prev.p) : null;
      const linked = !!prev && dt > 0 && dt <= c.max_gap_ms && d <= c.max_jump_m;
      const swept = linked && segmentHitsBox(box, prev.p, p, margin);
      if (linked) speeds[name] = round3(d / (dt / 1000));
      const entered = (inside || swept) && !this.wasInside[name];
      let decision;
      if (!entered) decision = inside ? 'already_inside' : 'outside';
      else if (!linked) decision = prev ? 'gap' : 'baseline';
      else if ((inside ? p[2] : Math.max(p[2], prev.p[2])) < c.min_lift_m) decision = 'too_low';
      else if (speeds[name] < c.min_speed_mps) decision = 'too_slow';
      else if (standing) decision = 'standing_in_building';
      else if (tMs - this.lastHitAt[name] < c.cooldown_ms) decision = 'cooldown';
      else {
        decision = 'hit';
        hit[name] = inside ? 'inside' : 'swept';
        this.lastHitAt[name] = tMs;
        this.hits += 1;
      }
      decisions[name] = decision;
      // Entered but rejected: the foot must leave the box before it can kick again.
      this.wasInside[name] = inside;
      this.prev[name] = { p, t: tMs };
    }
    return { hit, decisions, speed_mps: speeds, support, standing_in_building: standing, hits: this.hits,
      config_version: c.config_version };
  }
}
