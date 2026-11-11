"""3D hits against a building model placed on the floor marker (docs/MODEL_STRIKE_3D.md).

Server twin of web/shared/model-strike-3d.js: same rules, config keys and output; both are checked
against tests/fixtures/model_strike_cases.json.

The building is the union of its fragment convex hulls from the package's colliders.json (the same
colliders the fracture physics uses), so concave parts of the outline are empty, not filled in.
Marker frame: metres, x and y on the floor, z up, floor at z = 0 (backend/test_multi3d.py).
Package frame: three.js y-up, bottom-centre origin (web/public/assets/buildings/*/manifest.json).

Partial damage (damage_mode "partial", the default): a hit breaks the struck fragment and the
break_count - 1 unbroken fragments nearest the hit point. A fragment stays while it is still joined to the
floor through unbroken fragments that share a face (below, beside or above, any one is enough); a piece
or group cut off from the floor falls and breaks too. Broken fragments are air. Who touches whom is worked
out once from the intact building. The floor holds the bottom layer: pieces touching z = 0, and pieces with
nothing under them that start within GROUND_BAND_M of the floor (uneven bases).
"""
from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass, field, replace
from pathlib import Path

WRISTS = ("left_wrist", "right_wrist")
ANKLES = ("left_ankle", "right_ankle")
JOINTS = WRISTS + ANKLES
HIPS = ("left_hip", "right_hip")
EPS = 1e-9
DAMAGE_MODES = ("partial", "whole", "none")
CONTACT_TOL_M = 0.002        # faces closer than this touch (package metres, scaled with the placement)
SUPPORT_MIN_NORMAL_Z = 0.5   # contact normal within 60 degrees of vertical: one piece is under the other
GROUND_BAND_M = 0.15         # bottom pieces of uneven bases start up to this high (package metres, scaled)
IT1_COLLIDERS = Path(__file__).resolve().parent.parent / "web" / "public" / "assets" / "buildings" / "knu-it1-v3" / "colliders.json"


@dataclass(frozen=True)
class ModelStrikeConfig:
    config_version: str = "model-3d-2"
    margin_m: float = 0.0             # grow every hull by this much (tracking noise allowance)
    wrist_min_speed_mps: float = 0.0  # 0 = any entry counts, like the current /test/ pages
    ankle_min_lift_m: float = 0.20    # kicks (docs/FOOT_STRIKE.md): the foot must be lifted ...
    ankle_min_speed_mps: float = 1.5  # ... and moving fast; a step also reaches a building on the floor
    max_gap_ms: float = 250.0
    max_jump_m: float = 1.5
    cooldown_ms: float = 300.0
    stand_clearance_m: float = 0.10
    damage_mode: str = "partial"      # partial: break_count blocks per hit + what loses support; whole: all; none
    break_count: int = 3              # blocks one hit breaks: the struck one and the nearest others


@dataclass(frozen=True)
class Placement:
    x_m: float = 0.0
    y_m: float = 0.0
    yaw_deg: float = 0.0
    scale: float = 1.0


CONFIG = ModelStrikeConfig()


def _point(p):
    if p is None:
        return None
    try:
        q = [float(v) for v in p]
    except (TypeError, ValueError):
        return None
    return q if len(q) == 3 and all(math.isfinite(v) for v in q) else None


def _sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _rotate(q, v):
    x, y, z, w = q
    t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
    return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]),
            v[2] + w * t[2] + (x * t[1] - y * t[0])]


def package_to_marker(p, placement: Placement = Placement()):
    """Package (y-up) point -> marker (z-up): (x, y, z) -> (x, -z, y), scale, yaw about z, move."""
    s = placement.scale
    r = [p[0] * s, -p[2] * s, p[1] * s]
    a = math.radians(placement.yaw_deg)
    c, sn = math.cos(a), math.sin(a)
    return [c * r[0] - sn * r[1] + placement.x_m, sn * r[0] + c * r[1] + placement.y_m, r[2]]


def hull_planes(points, tol=1e-5):
    """Outward face planes (n, d) with n.x <= d inside, of the convex hull of a small point set."""
    planes, seen = [], set()
    count = len(points)
    for i in range(count):
        for j in range(i + 1, count):
            for k in range(j + 1, count):
                n = _cross(_sub(points[j], points[i]), _sub(points[k], points[i]))
                length = math.sqrt(_dot(n, n))
                if length < 1e-12:
                    continue
                n = [v / length for v in n]
                d = _dot(n, points[i])
                above = below = False
                for p in points:
                    s = _dot(n, p) - d
                    if s > tol:
                        above = True
                    elif s < -tol:
                        below = True
                    if above and below:
                        break
                if above and below:
                    continue
                if above:
                    n, d = [-v for v in n], -d
                key = tuple(round(v * 1e5) + 0 for v in (*n, d))
                if key in seen:
                    continue
                seen.add(key)
                planes.append((n, d))
    return planes


def _bounds(points):
    return ([min(p[k] for p in points) for k in range(3)], [max(p[k] for p in points) for k in range(3)])


def _round6(v):
    # Same rounding as the browser twin (half up), so ties break the same way in both.
    return math.floor(v * 1e6 + 0.5)


def face_contact(a_pts, a_planes, b_pts, b_planes, tol):
    """Unit normal from hull a toward hull b when they share part of a face, else None.

    None when they are apart, overlap, or meet only along an edge or at a corner (then two non-parallel
    face planes are both at zero distance, and nothing rests on anything).
    """
    near = []
    for planes, other, sign in ((a_planes, b_pts, 1.0), (b_planes, a_pts, -1.0)):
        for n, d in planes:
            s = min(_dot(n, q) for q in other) - d
            if s > tol:
                return None
            if s >= -tol:
                near.append([sign * v for v in n])
    if not near or any(_dot(near[0], m) < 0.99 for m in near[1:]):
        return None
    return near[0]


@dataclass
class Fragment:
    fragment_id: str
    planes: list
    lo: list
    hi: list
    centroid: list = field(default_factory=list)


@dataclass
class ModelTarget:
    building_id: str | None
    placement: Placement
    fragments: list = field(default_factory=list)
    lo: list = field(default_factory=list)
    hi: list = field(default_factory=list)
    grounded: list = field(default_factory=list)   # indices held by the floor
    links: list = field(default_factory=list)      # links[i]: indices sharing a face with i


def _structure(fragments, points, scale):
    """Floor pieces and face contacts of the intact building (see the module docstring)."""
    count, tol = len(fragments), CONTACT_TOL_M * scale
    links = [set() for _ in range(count)]
    has_below = [False] * count
    for i in range(count):
        a = fragments[i]
        for j in range(i + 1, count):
            b = fragments[j]
            if any(a.lo[k] > b.hi[k] + tol or b.lo[k] > a.hi[k] + tol for k in range(3)):
                continue
            n = face_contact(points[i], a.planes, points[j], b.planes, tol)
            if n is None:
                continue
            links[i].add(j)
            links[j].add(i)
            if n[2] >= SUPPORT_MIN_NORMAL_Z:        # j is on top of i
                has_below[j] = True
            elif n[2] <= -SUPPORT_MIN_NORMAL_Z:     # i is on top of j
                has_below[i] = True
    grounded = [i for i, f in enumerate(fragments)
                if f.lo[2] <= tol or (not has_below[i] and f.lo[2] <= GROUND_BAND_M * scale)]
    return grounded, [sorted(h) for h in links]


def _reach(starts, links, broken):
    seen = {i for i in starts if i not in broken}
    stack = list(seen)
    while stack:
        for j in links[stack.pop()]:
            if j not in seen and j not in broken:
                seen.add(j)
                stack.append(j)
    return seen


def build_model_target(colliders: dict, placement: Placement = Placement()) -> ModelTarget:
    if colliders.get("coordinate_frame") != "three_y_up" or not isinstance(colliders.get("fragments"), list):
        raise ValueError("unsupported_colliders")
    if not (placement.scale > 0 and all(math.isfinite(v) for v in (placement.x_m, placement.y_m, placement.yaw_deg))):
        raise ValueError("invalid_placement")
    fragments, points = [], []
    for f in colliders["fragments"]:
        v, q, o = f["vertices_m"], f.get("rest_quaternion_xyzw") or [0, 0, 0, 1], f.get("rest_position_m") or [0, 0, 0]
        pts = []
        for i in range(0, len(v) - 2, 3):
            r = _rotate(q, v[i:i + 3])
            pts.append(package_to_marker([r[0] + o[0], r[1] + o[1], r[2] + o[2]], placement))
        planes = hull_planes(pts)
        if len(planes) >= 4:
            lo, hi = _bounds(pts)
            centroid = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
            fragments.append(Fragment(f.get("fragment_id", f.get("node")), planes, lo, hi, centroid))
            points.append(pts)
    if not fragments:
        raise ValueError("no_fragments")
    lo, hi = _bounds([p for f in fragments for p in (f.lo, f.hi)])
    grounded, links = _structure(fragments, points, placement.scale)
    return ModelTarget(colliders.get("building_id"), placement, fragments, lo, hi, grounded, links)


def load_model_target(path=IT1_COLLIDERS, placement: Placement = Placement()) -> ModelTarget:
    return build_model_target(json.loads(Path(path).read_text()), placement)


def _near(p, lo, hi, m):
    return all(lo[k] - m <= p[k] <= hi[k] + m for k in range(3))


def _inside_index(target: ModelTarget, p, margin=0.0, broken=frozenset()):
    if p is None or not _near(p, target.lo, target.hi, margin):
        return None
    for i, f in enumerate(target.fragments):
        if i not in broken and _near(p, f.lo, f.hi, margin) and all(_dot(n, p) - d <= margin for n, d in f.planes):
            return i
    return None


def inside_model(target: ModelTarget, p, margin=0.0, broken=frozenset()):
    """fragment_id of an unbroken hull containing p, or None. broken: fragment indices that are air."""
    i = _inside_index(target, p, margin, broken)
    return None if i is None else target.fragments[i].fragment_id


def first_entry(target: ModelTarget, a, b, margin=0.0, broken=frozenset()):
    """Earliest entry of segment a->b into the unbroken hulls: {fragment_id, index, t, point} or None."""
    best = None
    ab = _sub(b, a)
    for i, f in enumerate(target.fragments):
        if i in broken:
            continue
        t0, t1 = 0.0, 1.0
        for n, d in f.planes:
            f0, df = _dot(n, a) - d - margin, _dot(n, ab)
            if abs(df) < EPS:
                if f0 > 0:
                    t0 = 2.0
                    break
                continue
            t = -f0 / df
            if df < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                break
        if t0 <= t1 and (best is None or t0 < best["t"]):
            best = {"fragment_id": f.fragment_id, "index": i, "t": t0}
    if best:
        best["point"] = [a[k] + best["t"] * ab[k] for k in range(3)]
    return best


def support_point(positions: dict, config: ModelStrikeConfig = CONFIG):
    """The planted foot: the lowest ankle below ankle_min_lift_m; without one, the mean of the visible hips."""
    positions = positions or {}
    best = None
    for name in ANKLES:
        p = _point(positions.get(name))
        if p and p[2] < config.ankle_min_lift_m and (best is None or p[2] < best[1][2]):
            best = (name, p)
    if best:
        return best
    hips = [p for name in HIPS if (p := _point(positions.get(name)))]
    if hips:
        return "hips", [sum(p[k] for p in hips) / len(hips) for k in range(3)]
    return None, None


def standing_in_model(target: ModelTarget, positions: dict, config: ModelStrikeConfig = CONFIG,
                      broken=frozenset()) -> bool:
    _, p = support_point(positions, config)
    return p is not None and _inside_index(target, [p[0], p[1], 0.02], config.stand_clearance_m, broken) is not None


def plane_distance(fragment: Fragment, p) -> float:
    """How far p is outside the hull's farthest face plane (0 inside). Exact off a face, shorter off an edge."""
    return max(0.0, max(_dot(n, p) - d for n, d in fragment.planes))


def blocks_to_break(target: ModelTarget, struck: int, point, broken, count: int):
    """The struck fragment, then the count - 1 unbroken fragments nearest the hit point.

    Nearest by plane_distance; ties go to the closer centre, then to the earlier fragment in the package.
    """
    others = [i for i in range(len(target.fragments)) if i != struck and i not in broken]
    others.sort(key=lambda i: (_round6(plane_distance(target.fragments[i], point)),
                               _round6(math.dist(target.fragments[i].centroid, point)), i))
    return [struck] + others[:max(0, count - 1)]


def unsupported(target: ModelTarget, broken):
    """Unbroken fragments no longer joined to the floor, in package order."""
    standing = _reach(target.grounded, target.links, broken)
    return [i for i in range(len(target.fragments)) if i not in broken and i not in standing]


class ModelStrikeJudge:
    """One per tracked person and building. Call update() once per frame, in time order."""

    def __init__(self, target: ModelTarget, config: ModelStrikeConfig = CONFIG, new_id=lambda: str(uuid.uuid4()), **overrides):
        self.target = target
        self.config = replace(config, **overrides) if overrides else config
        if self.config.damage_mode not in DAMAGE_MODES:
            raise ValueError("invalid_damage_mode")
        self.new_id = new_id
        self.reset()

    def _clear_trajectories(self):
        self.prev = {name: None for name in JOINTS}
        self.was_inside = {name: False for name in JOINTS}
        self.last_hit_at = {name: -math.inf for name in JOINTS}

    @property
    def destroyed(self) -> bool:
        return len(self.broken) == len(self.target.fragments)

    def reset(self):
        """New session: forget everything, building intact, score 0."""
        self._clear_trajectories()
        self.broken = set()
        self.hits = 0

    def restore(self):
        """Building restored for another round: intact again, old paths and cooldowns dropped."""
        self._clear_trajectories()
        self.broken = set()

    def _break(self, struck: int, point):
        """Apply one hit; returns (broken ids, fallen ids) for the event."""
        target, c = self.target, self.config
        if c.damage_mode == "none":
            return [], []
        if c.damage_mode == "whole":
            hit = [i for i in range(len(target.fragments)) if i not in self.broken]
            hit.remove(struck)
            hit.insert(0, struck)
            self.broken.update(hit)
            return [target.fragments[i].fragment_id for i in hit], []
        hit = blocks_to_break(target, struck, point, self.broken, c.break_count)
        self.broken.update(hit)
        fallen = unsupported(target, self.broken)
        self.broken.update(fallen)
        return [target.fragments[i].fragment_id for i in hit], [target.fragments[i].fragment_id for i in fallen]

    def update(self, positions: dict, t_ms: float) -> dict:
        c, target = self.config, self.target
        positions = positions or {}
        broken = self.broken
        support, _ = support_point(positions, c)
        standing = standing_in_model(target, positions, c, broken)
        decisions, speeds, candidates = {}, {}, []
        for name in JOINTS:
            p = _point(positions.get(name))
            prev = self.prev[name]
            speeds[name] = None
            if p is None:
                self.prev[name], self.was_inside[name] = None, False
                decisions[name] = "invalid"
                continue
            inside = _inside_index(target, p, c.margin_m, broken) is not None
            dt = t_ms - prev[1] if prev else None
            dist = math.dist(p, prev[0]) if prev else None
            linked = prev is not None and 0 < dt <= c.max_gap_ms and dist <= c.max_jump_m
            entry = first_entry(target, prev[0], p, c.margin_m, broken) if linked else None
            if linked:
                speeds[name] = round(dist / (dt / 1000.0), 3)
            ankle = name in ANKLES
            if not ((inside or entry) and not self.was_inside[name]):
                decision = "already_inside" if inside else "outside"
            elif not linked:
                decision = "gap" if prev else "baseline"
            elif ankle and (p[2] if inside else max(p[2], prev[0][2])) < c.ankle_min_lift_m:
                decision = "too_low"
            elif speeds[name] < (c.ankle_min_speed_mps if ankle else c.wrist_min_speed_mps):
                decision = "too_slow"
            elif standing:
                decision = "standing_in_building"
            elif t_ms - self.last_hit_at[name] < c.cooldown_ms:
                decision = "cooldown"
            else:
                decision = "candidate"
                candidates.append({"name": name, "entry": entry, "hit_by": "inside" if inside else "swept",
                                   "speed": speeds[name], "previous_t_ms": prev[1]})
            decisions[name] = decision
            # Entered but rejected: the joint must leave the building before it can hit again.
            self.was_inside[name] = inside
            self.prev[name] = (p, t_ms)
        # Several joints entering in one frame: the earliest entry wins, then the faster one.
        candidates.sort(key=lambda h: (h["entry"]["t"], -h["speed"]))
        event = None
        for i, hit in enumerate(candidates):
            if i > 0:
                decisions[hit["name"]] = "simultaneous"
                continue
            decisions[hit["name"]] = "hit"
            self.last_hit_at[hit["name"]] = t_ms
            self.hits += 1
            point = hit["entry"]["point"]
            broken_ids, fallen_ids = self._break(hit["entry"]["index"], point)
            event = {"schema": "model_strike.v2-draft", "type": "hit_3d", "event_id": self.new_id(),
                     "building_id": target.building_id, "joint": hit["name"], "hit_by": hit["hit_by"],
                     "fragment_id": hit["entry"]["fragment_id"],
                     "point_m": [round(v, 4) for v in point], "speed_mps": hit["speed"], "points": 1,
                     "broken_fragment_ids": broken_ids, "fallen_fragment_ids": fallen_ids,
                     "remaining_fragments": len(target.fragments) - len(self.broken),
                     "t_ms": t_ms, "previous_t_ms": hit["previous_t_ms"],
                     "placement": {"x_m": target.placement.x_m, "y_m": target.placement.y_m,
                                   "yaw_deg": target.placement.yaw_deg, "scale": target.placement.scale},
                     "config_version": c.config_version}
        return {"event": event, "decisions": decisions, "speed_mps": speeds, "support": support,
                "standing_in_building": standing, "destroyed": self.destroyed, "hits": self.hits,
                "remaining_fragments": len(self.target.fragments) - len(self.broken),
                "config_version": c.config_version}
