"""Kicks against the 3D building box (docs/FOOT_STRIKE.md).

Positions are metres in the floor-marker frame used by backend/test_multi3d.py and /test/mono3d/:
x, y on the floor, z up, floor at z = 0. The box is {"center": [x, y, z], "half": [hx, hy, hz]} with an
optional "margin", the same dict test_multi3d.py builds. web/shared/foot-strike-3d.js is the same judge
for the browser; both are checked against tests/fixtures/foot_strike_cases.json.

Why feet need their own rules (wrists only need "entered the box"):
- The building stands on the floor, so an ordinary step carries the ankle into the box. A kick has the
  foot lifted (min_lift_m) and moving fast (min_speed_mps).
- "Standing in the building" must look at the planted foot only. The mean of both ankles moves halfway
  toward the building during a kick and would block the kick itself.
All numbers are starting values, not tuned on real phones yet.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

ANKLES = ("left_ankle", "right_ankle")
HIPS = ("left_hip", "right_hip")


@dataclass(frozen=True)
class FootStrikeConfig:
    config_version: str = "foot-3d-1"
    min_lift_m: float = 0.20        # ankle height above the floor; a walking step stays lower
    min_speed_mps: float = 1.5      # ankle speed over the last frame pair
    max_gap_ms: float = 250.0       # same as SWING_MAX_GAP_MS in test_multi3d.py
    max_jump_m: float = 1.5         # same as SWING_MAX_JUMP_M: longer jumps are tracking glitches
    cooldown_ms: float = 300.0      # same as HIT_COOLDOWN_MS: one kick = one hit
    stand_clearance_m: float = 0.10  # same as STAND_CLEARANCE_M


CONFIG = FootStrikeConfig()


def _point(p):
    if p is None or len(p) != 3:
        return None
    try:
        q = [float(v) for v in p]
    except (TypeError, ValueError):
        return None
    return q if all(math.isfinite(v) for v in q) else None


def inside_box(box, p, margin=0.0) -> bool:
    return p is not None and all(abs(p[k] - box["center"][k]) <= box["half"][k] + margin for k in range(3))


def segment_hits_box(box, a, b, margin=0.0) -> bool:
    """Does the segment a->b pass through the box (slab method)?"""
    if a is None or b is None:
        return inside_box(box, b, margin)
    t0, t1 = 0.0, 1.0
    for k in range(3):
        lo = box["center"][k] - box["half"][k] - margin
        hi = box["center"][k] + box["half"][k] + margin
        d = b[k] - a[k]
        if abs(d) < 1e-12:
            if a[k] < lo or a[k] > hi:
                return False
            continue
        u, v = (lo - a[k]) / d, (hi - a[k]) / d
        if u > v:
            u, v = v, u
        t0, t1 = max(t0, u), min(t1, v)
        if t0 > t1:
            return False
    return True


def support_point(positions: dict, config: FootStrikeConfig = CONFIG):
    """The planted foot: the lowest ankle below min_lift_m. Without one, the mean of the visible hips.

    Returns (name, point) with name "left_ankle" / "right_ankle" / "hips", or (None, None).
    """
    positions = positions or {}
    planted = [(p[2], name, p) for name in ANKLES if (p := _point(positions.get(name))) and p[2] < config.min_lift_m]
    if planted:
        _, name, p = min(planted)
        return name, p
    hips = [p for name in HIPS if (p := _point(positions.get(name)))]
    if hips:
        return "hips", [sum(p[k] for p in hips) / len(hips) for k in range(3)]
    return None, None


def standing_in_building(positions: dict, box, config: FootStrikeConfig = CONFIG) -> bool:
    _, p = support_point(positions, config)
    return p is not None and all(abs(p[k] - box["center"][k]) <= box["half"][k] + config.stand_clearance_m for k in (0, 1))


class FootStrikeJudge:
    """One per tracked person. Call update() once per fused frame, in time order."""

    def __init__(self, config: FootStrikeConfig = CONFIG):
        self.config = config
        self.reset()

    def reset(self):
        self.prev = {name: None for name in ANKLES}          # (point, t_ms)
        self.was_inside = {name: False for name in ANKLES}
        self.last_hit_at = {name: -math.inf for name in ANKLES}
        self.hits = 0

    def update(self, positions: dict, box, t_ms: float) -> dict:
        """positions: name -> [x, y, z] or None (ankles, optionally hips). Returns this frame's result."""
        c = self.config
        positions = positions or {}
        margin = float(box.get("margin", 0.0) or 0.0)
        support, _ = support_point(positions, c)
        standing = standing_in_building(positions, box, c)
        hit, decisions, speeds = {}, {}, {}
        for name in ANKLES:
            p = _point(positions.get(name))
            prev = self.prev[name]
            speeds[name] = None
            if p is None:
                # Occlusion breaks the path; the next point is a baseline.
                self.prev[name], self.was_inside[name] = None, False
                decisions[name] = "invalid"
                continue
            inside = inside_box(box, p, margin)
            dt = t_ms - prev[1] if prev else None
            dist = math.dist(p, prev[0]) if prev else None
            linked = prev is not None and 0 < dt <= c.max_gap_ms and dist <= c.max_jump_m
            swept = linked and segment_hits_box(box, prev[0], p, margin)
            if linked:
                speeds[name] = round(dist / (dt / 1000.0), 3)
            entered = (inside or swept) and not self.was_inside[name]
            if not entered:
                decision = "already_inside" if inside else "outside"
            elif not linked:
                decision = "baseline" if prev is None else "gap"
            elif (p[2] if inside else max(p[2], prev[0][2])) < c.min_lift_m:
                decision = "too_low"
            elif speeds[name] < c.min_speed_mps:
                decision = "too_slow"
            elif standing:
                decision = "standing_in_building"
            elif t_ms - self.last_hit_at[name] < c.cooldown_ms:
                decision = "cooldown"
            else:
                decision = "hit"
                hit[name] = "inside" if inside else "swept"
                self.last_hit_at[name] = t_ms
                self.hits += 1
            decisions[name] = decision
            # Entered but rejected: the foot must leave the box before it can kick again.
            self.was_inside[name] = inside
            self.prev[name] = (p, t_ms)
        return {"hit": hit, "decisions": decisions, "speed_mps": speeds, "support": support,
                "standing_in_building": standing, "hits": self.hits, "config_version": c.config_version}
