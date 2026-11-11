// 3D hits against a building model placed on the floor marker (docs/MODEL_STRIKE_3D.md).
// Browser twin of backend/model_strike.py: same rules, config keys and output; both are checked against
// tests/fixtures/model_strike_cases.json.
//
// The building is the union of its fragment convex hulls from the package's colliders.json (the same
// colliders the fracture physics uses), so concave parts of the outline are empty, not filled in.
// Marker frame: metres, x and y on the floor, z up, floor at z = 0 (/test/mono3d/, /test/multi3d/).
// Package frame: three.js y-up, bottom-centre origin (assets/buildings/*/manifest.json).
// A renderer must place the model with the same placement (see placementToThree) so the drawn and the
// judged building agree.
//
// Partial damage (damage_mode 'partial', the default): a hit breaks the struck fragment and the
// break_count - 1 unbroken fragments nearest the hit point. A fragment stays while it is still joined to the
// floor through unbroken fragments that share a face (below, beside or above, any one is enough); a piece
// or group cut off from the floor falls and breaks too. Broken fragments are air. Who touches whom is worked
// out once from the intact building. The floor holds the bottom layer: pieces touching z = 0, and pieces with
// nothing under them that start within GROUND_BAND_M of the floor (uneven bases).
export const MODEL_STRIKE_CONFIG = Object.freeze({
  config_version: 'model-3d-2',
  margin_m: 0,                 // grow every hull by this much (tracking noise allowance)
  wrist_min_speed_mps: 0,      // 0 = any entry counts, like the current /test/ pages
  ankle_min_lift_m: 0.20,      // kicks (docs/FOOT_STRIKE.md): the foot must be lifted ...
  ankle_min_speed_mps: 1.5,    // ... and moving fast; a step also reaches a building on the floor
  max_gap_ms: 250,
  max_jump_m: 1.5,
  cooldown_ms: 300,
  stand_clearance_m: 0.10,
  damage_mode: 'partial',      // partial: break_count blocks per hit + what loses support; whole: all; none
  break_count: 3,              // blocks one hit breaks: the struck one and the nearest others
});
export const DAMAGE_MODES = Object.freeze(['partial', 'whole', 'none']);
const CONTACT_TOL_M = 0.002;       // faces closer than this touch (package metres, scaled with the placement)
const SUPPORT_MIN_NORMAL_Z = 0.5;  // contact normal within 60 degrees of vertical: one piece is under the other
const GROUND_BAND_M = 0.15;        // bottom pieces of uneven bases start up to this high (package metres, scaled)
export const DEFAULT_PLACEMENT = Object.freeze({ x_m: 0, y_m: 0, yaw_deg: 0, scale: 1 });
export const WRISTS = Object.freeze(['left_wrist', 'right_wrist']);
export const ANKLES = Object.freeze(['left_ankle', 'right_ankle']);
const JOINTS = [...WRISTS, ...ANKLES];
const HIPS = ['left_hip', 'right_hip'];
const EPS = 1e-9;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
// Same rounding as the Python twin (half up), so ties break the same way in both.
const round6 = (v) => Math.floor(v * 1e6 + 0.5);
const point = (p) => (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? p.map(Number) : null);

function rotate(q, v) {
  const [x, y, z, w] = q;
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}

// Package (y-up) point -> marker (z-up) point. y-up -> z-up is (x, y, z) -> (x, -z, y), then scale,
// yaw about the marker's z axis (counter-clockwise seen from above), then move.
export function packageToMarker(p, placement = DEFAULT_PLACEMENT) {
  const { x_m, y_m, yaw_deg, scale } = { ...DEFAULT_PLACEMENT, ...placement };
  const r = [p[0] * scale, -p[2] * scale, p[1] * scale];
  const a = (yaw_deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c * r[0] - s * r[1] + x_m, s * r[0] + c * r[1] + y_m, r[2]];
}

// For a three.js scene in marker coordinates (z up): outer group gets position/rotationZ/scale,
// the loaded y-up model inside it gets rotationX.
export function placementToThree(placement = DEFAULT_PLACEMENT) {
  const p = { ...DEFAULT_PLACEMENT, ...placement };
  return { position: [p.x_m, p.y_m, 0], rotationZ: (p.yaw_deg * Math.PI) / 180, scale: p.scale, innerRotationX: Math.PI / 2 };
}

// Outward face planes {n, d} (n·x <= d inside) of the convex hull of a small point set. Brute force over
// point triples: fine for the <= 62 points per hull the packages use. tol (m) absorbs float32 noise in
// the package, so the four corners of one face still count as one face.
export function hullPlanes(points, tol = 1e-5) {
  const planes = [];
  const seen = new Set();
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) for (let k = j + 1; k < points.length; k++) {
    let n = cross(sub(points[j], points[i]), sub(points[k], points[i]));
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    n = n.map((v) => v / len);
    let d = dot(n, points[i]);
    let above = false, below = false;
    for (const p of points) {
      const s = dot(n, p) - d;
      if (s > tol) above = true; else if (s < -tol) below = true;
      if (above && below) break;
    }
    if (above && below) continue;
    if (above) { n = n.map((v) => -v); d = -d; }
    const key = [...n, d].map((v) => Math.round(v * 1e5) + 0).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    planes.push({ n, d });
  }
  return planes;
}

function bounds(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { lo, hi };
}

// Unit normal from hull a toward hull b when they share part of a face, else null: apart, overlapping, or
// meeting only along an edge or at a corner (then two non-parallel face planes are both at zero distance).
export function faceContact(aPts, aPlanes, bPts, bPlanes, tol) {
  const near = [];
  for (const [planes, other, sign] of [[aPlanes, bPts, 1], [bPlanes, aPts, -1]]) {
    for (const { n, d } of planes) {
      let s = Infinity;
      for (const q of other) s = Math.min(s, dot(n, q));
      s -= d;
      if (s > tol) return null;
      if (s >= -tol) near.push(n.map((v) => sign * v));
    }
  }
  if (!near.length || near.slice(1).some((m) => dot(near[0], m) < 0.99)) return null;
  return near[0];
}

function reach(starts, links, broken) {
  const seen = new Set(starts.filter((i) => !broken.has(i)));
  const stack = [...seen];
  while (stack.length) {
    for (const j of links[stack.pop()]) if (!seen.has(j) && !broken.has(j)) { seen.add(j); stack.push(j); }
  }
  return seen;
}

// Floor pieces and face contacts of the intact building (see the top of this file).
function structure(fragments, points, scale) {
  const count = fragments.length, tol = CONTACT_TOL_M * scale;
  const links = fragments.map(() => new Set()), hasBelow = fragments.map(() => false);
  for (let i = 0; i < count; i++) {
    const a = fragments[i];
    for (let j = i + 1; j < count; j++) {
      const b = fragments[j];
      if ([0, 1, 2].some((k) => a.lo[k] > b.hi[k] + tol || b.lo[k] > a.hi[k] + tol)) continue;
      const n = faceContact(points[i], a.planes, points[j], b.planes, tol);
      if (!n) continue;
      links[i].add(j); links[j].add(i);
      if (n[2] >= SUPPORT_MIN_NORMAL_Z) hasBelow[j] = true;          // j is on top of i
      else if (n[2] <= -SUPPORT_MIN_NORMAL_Z) hasBelow[i] = true;    // i is on top of j
    }
  }
  const grounded = [];
  fragments.forEach((f, i) => { if (f.lo[2] <= tol || (!hasBelow[i] && f.lo[2] <= GROUND_BAND_M * scale)) grounded.push(i); });
  return { grounded, links: links.map((h) => [...h].sort((x, y) => x - y)) };
}

// colliders: parsed colliders.json ({building_id, coordinate_frame: 'three_y_up', fragments: [...]}).
export function buildModelTarget(colliders, placement = DEFAULT_PLACEMENT) {
  if (colliders?.coordinate_frame !== 'three_y_up' || !Array.isArray(colliders.fragments)) throw new Error('unsupported_colliders');
  const place = { ...DEFAULT_PLACEMENT, ...placement };
  if (!(place.scale > 0) || ![place.x_m, place.y_m, place.yaw_deg].every(Number.isFinite)) throw new Error('invalid_placement');
  const fragments = [], points = [];
  for (const f of colliders.fragments) {
    const v = f.vertices_m, q = f.rest_quaternion_xyzw ?? [0, 0, 0, 1], o = f.rest_position_m ?? [0, 0, 0];
    const pts = [];
    for (let i = 0; i + 2 < v.length; i += 3) {
      const r = rotate(q, [v[i], v[i + 1], v[i + 2]]);
      pts.push(packageToMarker([r[0] + o[0], r[1] + o[1], r[2] + o[2]], place));
    }
    const planes = hullPlanes(pts);
    if (planes.length >= 4) {
      const centroid = [0, 1, 2].map((k) => pts.reduce((sum, q) => sum + q[k], 0) / pts.length);
      fragments.push({ fragment_id: f.fragment_id ?? f.node, planes, ...bounds(pts), centroid });
      points.push(pts);
    }
  }
  if (!fragments.length) throw new Error('no_fragments');
  return { building_id: colliders.building_id ?? null, placement: place, fragments,
    ...bounds(fragments.flatMap((f) => [f.lo, f.hi])), ...structure(fragments, points, place.scale) };
}

export async function loadModelTarget(url = '/public/assets/buildings/knu-it1-v3/colliders.json', placement = DEFAULT_PLACEMENT, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`colliders_http_${response.status}`);
  return buildModelTarget(await response.json(), placement);
}

const near = (p, lo, hi, m) => [0, 1, 2].every((k) => p[k] >= lo[k] - m && p[k] <= hi[k] + m);

const NONE = new Set();

function insideIndex(target, p, margin = 0, broken = NONE) {
  if (!p || !near(p, target.lo, target.hi, margin)) return null;
  for (let i = 0; i < target.fragments.length; i++) {
    const f = target.fragments[i];
    if (!broken.has(i) && near(p, f.lo, f.hi, margin) && f.planes.every(({ n, d }) => dot(n, p) - d <= margin)) return i;
  }
  return null;
}

// fragment_id of an unbroken hull containing p, or null. broken: Set of fragment indices that are air.
export function insideModel(target, p, margin = 0, broken = NONE) {
  const i = insideIndex(target, p, margin, broken);
  return i === null ? null : target.fragments[i].fragment_id;
}

// Earliest entry of segment a->b into the unbroken hulls: { fragment_id, index, t, point } or null.
export function firstEntry(target, a, b, margin = 0, broken = NONE) {
  let best = null;
  for (let i = 0; i < target.fragments.length; i++) {
    if (broken.has(i)) continue;
    const f = target.fragments[i];
    let t0 = 0, t1 = 1;
    for (const { n, d } of f.planes) {
      const f0 = dot(n, a) - d - margin, df = dot(n, sub(b, a));
      if (Math.abs(df) < EPS) { if (f0 > 0) { t0 = 2; break; } continue; }
      const t = -f0 / df;
      if (df < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) break;
    }
    if (t0 <= t1 && (!best || t0 < best.t)) best = { fragment_id: f.fragment_id, index: i, t: t0 };
  }
  if (best) best.point = [0, 1, 2].map((k) => a[k] + best.t * (b[k] - a[k]));
  return best;
}

// The planted foot: the lowest ankle below ankle_min_lift_m; without one, the mean of the visible hips.
export function supportPoint(positions, config = MODEL_STRIKE_CONFIG) {
  let best = null;
  for (const name of ANKLES) {
    const p = point(positions?.[name]);
    if (p && p[2] < config.ankle_min_lift_m && (!best || p[2] < best.point[2])) best = { name, point: p };
  }
  if (best) return best;
  const hips = HIPS.map((name) => point(positions?.[name])).filter(Boolean);
  if (hips.length) return { name: 'hips', point: [0, 1, 2].map((k) => hips.reduce((s, p) => s + p[k], 0) / hips.length) };
  return { name: null, point: null };
}

// Standing on the building: the support point, dropped to just above the floor, is inside a hull grown
// by stand_clearance_m.
export function standingInModel(target, positions, config = MODEL_STRIKE_CONFIG, broken = NONE) {
  const { point: p } = supportPoint(positions, config);
  return !!p && insideIndex(target, [p[0], p[1], 0.02], config.stand_clearance_m, broken) !== null;
}

// How far p is outside the hull's farthest face plane (0 inside). Exact off a face, shorter off an edge.
export function planeDistance(fragment, p) {
  let worst = 0;
  for (const { n, d } of fragment.planes) worst = Math.max(worst, dot(n, p) - d);
  return worst;
}

// The struck fragment, then the count - 1 unbroken fragments nearest the hit point. Nearest by
// planeDistance; ties go to the closer centre, then to the earlier fragment in the package.
export function blocksToBreak(target, struck, p, broken, count) {
  const key = (i) => [round6(planeDistance(target.fragments[i], p)), round6(dist(target.fragments[i].centroid, p)), i];
  const others = [];
  for (let i = 0; i < target.fragments.length; i++) if (i !== struck && !broken.has(i)) others.push({ i, k: key(i) });
  others.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]);
  return [struck, ...others.slice(0, Math.max(0, count - 1)).map((o) => o.i)];
}

// Unbroken fragments no longer joined to the floor, in package order.
export function unsupported(target, broken) {
  const standing = reach(target.grounded, target.links, broken);
  const out = [];
  for (let i = 0; i < target.fragments.length; i++) if (!broken.has(i) && !standing.has(i)) out.push(i);
  return out;
}

// One per tracked person and building. Call update() once per frame, in time order.
export class ModelStrikeJudge {
  constructor(target, { config = {}, uuid = () => globalThis.crypto.randomUUID() } = {}) {
    this.target = target;
    this.config = { ...MODEL_STRIKE_CONFIG, ...config };
    if (!DAMAGE_MODES.includes(this.config.damage_mode)) throw new Error('invalid_damage_mode');
    this.uuid = uuid;
    this.reset();
  }

  clearTrajectories() {
    this.prev = Object.fromEntries(JOINTS.map((n) => [n, null]));
    this.wasInside = Object.fromEntries(JOINTS.map((n) => [n, false]));
    this.lastHitAt = Object.fromEntries(JOINTS.map((n) => [n, -Infinity]));
  }

  get destroyed() { return this.broken.size === this.target.fragments.length; }

  // New session: forget everything, building intact, score 0.
  reset() { this.clearTrajectories(); this.broken = new Set(); this.hits = 0; }

  // Building restored for another round: intact again, old paths and cooldowns dropped. A hand resting in
  // the building does not hit until it leaves and comes back.
  restore() { this.clearTrajectories(); this.broken = new Set(); }

  // Apply one hit; returns { broken, fallen } fragment ids for the event.
  breakAt(struck, p) {
    const target = this.target, c = this.config, ids = (list) => list.map((i) => target.fragments[i].fragment_id);
    if (c.damage_mode === 'none') return { broken: [], fallen: [] };
    if (c.damage_mode === 'whole') {
      const hit = [struck];
      for (let i = 0; i < target.fragments.length; i++) if (i !== struck && !this.broken.has(i)) hit.push(i);
      hit.forEach((i) => this.broken.add(i));
      return { broken: ids(hit), fallen: [] };
    }
    const hit = blocksToBreak(target, struck, p, this.broken, c.break_count);
    hit.forEach((i) => this.broken.add(i));
    const fallen = unsupported(target, this.broken);
    fallen.forEach((i) => this.broken.add(i));
    return { broken: ids(hit), fallen: ids(fallen) };
  }

  // positions: name -> [x, y, z] in the marker frame or null (wrists, ankles, optionally hips).
  update(positions, tMs) {
    const c = this.config, target = this.target;
    const broken = this.broken;
    const support = supportPoint(positions, c).name;
    const standing = standingInModel(target, positions, c, broken);
    const decisions = {}, speeds = {}, candidates = [];
    for (const name of JOINTS) {
      const p = point(positions?.[name]);
      const prev = this.prev[name];
      speeds[name] = null;
      if (!p) {
        this.prev[name] = null; this.wasInside[name] = false;
        decisions[name] = 'invalid';
        continue;
      }
      const inside = insideIndex(target, p, c.margin_m, broken) !== null;
      const dt = prev ? tMs - prev.t : null;
      const d = prev ? dist(p, prev.p) : null;
      const linked = !!prev && dt > 0 && dt <= c.max_gap_ms && d <= c.max_jump_m;
      const entry = linked ? firstEntry(target, prev.p, p, c.margin_m, broken) : null;
      if (linked) speeds[name] = round(d / (dt / 1000), 3);
      const ankle = ANKLES.includes(name);
      let decision;
      if (!((inside || entry) && !this.wasInside[name])) decision = inside ? 'already_inside' : 'outside';
      else if (!linked) decision = prev ? 'gap' : 'baseline';
      else if (ankle && (inside ? p[2] : Math.max(p[2], prev.p[2])) < c.ankle_min_lift_m) decision = 'too_low';
      else if (speeds[name] < (ankle ? c.ankle_min_speed_mps : c.wrist_min_speed_mps)) decision = 'too_slow';
      else if (standing) decision = 'standing_in_building';
      else if (tMs - this.lastHitAt[name] < c.cooldown_ms) decision = 'cooldown';
      else {
        decision = 'candidate';
        candidates.push({ name, entry, hit_by: inside ? 'inside' : 'swept', speed: speeds[name], previous_t_ms: prev.t });
      }
      decisions[name] = decision;
      // Entered but rejected: the joint must leave the building before it can hit again.
      this.wasInside[name] = inside;
      this.prev[name] = { p, t: tMs };
    }
    // Several joints entering in one frame: the earliest entry wins, then the faster one. One event per frame.
    candidates.sort((a, b) => a.entry.t - b.entry.t || b.speed - a.speed);
    let event = null;
    candidates.forEach((hit, i) => {
      if (i > 0) { decisions[hit.name] = 'simultaneous'; return; }
      decisions[hit.name] = 'hit';
      this.lastHitAt[hit.name] = tMs;
      this.hits += 1;
      const { broken: brokenIds, fallen } = this.breakAt(hit.entry.index, hit.entry.point);
      event = {
        schema: 'model_strike.v2-draft', type: 'hit_3d', event_id: this.uuid(), building_id: target.building_id,
        joint: hit.name, hit_by: hit.hit_by, fragment_id: hit.entry.fragment_id,
        point_m: hit.entry.point.map((v) => round(v, 4)), speed_mps: hit.speed, points: 1,
        broken_fragment_ids: brokenIds, fallen_fragment_ids: fallen,
        remaining_fragments: target.fragments.length - this.broken.size,
        t_ms: tMs, previous_t_ms: hit.previous_t_ms, placement: { ...target.placement }, config_version: c.config_version,
      };
    });
    return { event, decisions, speed_mps: speeds, support, standing_in_building: standing, destroyed: this.destroyed,
      hits: this.hits, remaining_fragments: target.fragments.length - this.broken.size, config_version: c.config_version };
  }
}
