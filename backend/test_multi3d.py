"""Test-only 3-camera relay + triangulation for /test/multi3d/ (same flow as /test/mono3d/).

    /ws/test/multi3d?role=phone&camera=C0|C1|C2
        phone -> server: multi3d_calib (K, R, t from the floor marker), multi3d_frame (33 landmarks), multi3d_jpeg
        server -> phone: multi3d_fused, multi3d_status
    /ws/test/multi3d?role=viewer
        viewer -> server: multi3d_config (building), multi3d_reset_hits
        server -> viewer: phone calib/frame/jpeg (tagged with camera_id), multi3d_fused, multi3d_status

Every phone calibrates against the same floor marker, so all share the marker's room_z_up frame.
New phones exchange clocks and buffer inference-input timestamps before weighted triangulation.
Legacy phones retain an explicitly labelled arrival-time fallback; the modes are never mixed.
Input timestamps are not hardware exposure timestamps. Results carry source='multi_view_test'
and are not P3 evidence. Reprojection refinement and ray-angle gates do not synthesize joints.
Nothing is stored on disk. Protected by the normal access key.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import statistics
import time
import uuid
from collections import deque
from itertools import combinations, product

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from .calibration.storage import Calibration
from .connections import Peer
from .tracking.triangulation import triangulate_dlt
from .tracking.test_fusion import estimate as robust_estimate
from .sync.test_inputs import InputFrames,MAX_SPREAD_MS
from .super_smash import SuperSmash

CAMERAS = ("C0", "C1", "C2")
MAX_MESSAGE_BYTES = 512 * 1024
SYNC_WINDOW_MS = MAX_SPREAD_MS  # legacy fallback; aligned frames also include clock uncertainty
STALE_MS = 400                # a camera silent for longer is left out
FUSE_INTERVAL_MS = 25         # at most ~40 fused results per second
MIN_VIEWS = 2
MAX_REPROJECTION_PX = 8.0     # reference pixels at a 720px short image side
MIN_VISIBILITY = 0.5
SWING_MAX_GAP_MS = 250
SWING_MAX_JUMP_M = 1.5
HIT_COOLDOWN_MS = 300         # views fused from slightly different times can flicker in/out: one swing = one hit
NOSE_TO_HEIGHT = 0.92
WAIST_TO_HEIGHT = 0.6
DEFAULT_WAIST_M = 0.95
JOINTS = {"nose": 0, "left_shoulder": 11, "right_shoulder": 12, "left_elbow": 13, "right_elbow": 14,
          "left_wrist": 15, "right_wrist": 16, "left_hip": 23, "right_hip": 24, "left_knee": 25,
          "right_knee": 26, "left_ankle": 27, "right_ankle": 28}
WRISTS = ("left_wrist", "right_wrist")
# Left/right pairs. A phone that sees the person from behind (or MediaPipe guessing wrong) may swap the
# labels, which makes every paired joint disagree between views; the server tries both labelings.
PAIRS = [("left_shoulder", "right_shoulder"), ("left_elbow", "right_elbow"), ("left_wrist", "right_wrist"),
         ("left_hip", "right_hip"), ("left_knee", "right_knee"), ("left_ankle", "right_ankle")]
SWAP = {a: b for pair in PAIRS for a, b in (pair, pair[::-1])}
MISMATCH_PENALTY_PX = 200.0
STAND_CLEARANCE_M = 0.10      # feet within the footprint + this: the person stands in the building, no hits
# Two views whose directions to the play area differ by less than / more than these angles cannot
# measure depth well (almost the same ray, or facing each other through the person).
MIN_PAIR_ANGLE_DEG = 25.0
MAX_PAIR_ANGLE_DEG = 150.0
CLOSE_SUPERSEDED = 4001
CLOSE_BAD_REQUEST = 4400
log = logging.getLogger("smash.multi3d")


def now_ms() -> float:
    # Windows/Python 3.12 monotonic() ticks at 15.6ms, too coarse for 10ms clock quality.
    # Every test-hub ping, arrival and fuse time uses this same high-resolution clock.
    return time.perf_counter() * 1000.0


class MessageError(ValueError):
    pass


def parse_calibration(camera_id: str, m: dict) -> Calibration:
    try:
        width, height = int(m["image"]["width"]), int(m["image"]["height"])
        k = m["K"]
        K = np.array([[float(k["fx"]), 0, float(k["cx"])], [0, float(k["fy"]), float(k["cy"])], [0, 0, 1]])
        R = np.array(m["R"], dtype=np.float64).reshape(3, 3)
        t = np.array(m["t"], dtype=np.float64).reshape(3)
    except (KeyError, TypeError, ValueError) as exc:
        raise MessageError(f"bad calibration: {exc}") from exc
    if not (np.isfinite(K).all() and np.isfinite(R).all() and np.isfinite(t).all()) or width <= 0 or height <= 0:
        raise MessageError("bad calibration: non-finite values")
    if np.abs(R @ R.T - np.eye(3)).max() > 1e-3 or abs(np.linalg.det(R) - 1) > 1e-3:
        raise MessageError("bad calibration: R is not a rotation")
    dist=np.asarray(m.get('dist',[0]*5),dtype=float).reshape(-1)
    if len(dist) not in (4,5,8,12,14) or not np.isfinite(dist).all() or min(K[0,0],K[1,1])<=0:raise MessageError('bad lens calibration')
    return Calibration(calibration_id=uuid.uuid4().hex, source="test_marker_tap", camera_id=camera_id,
                       device_id=None, width=width, height=height, rotation_deg=0, K=K, dist=dist, R=R, t=t)


def parse_landmarks(value) -> list | None:
    if value is None:
        return None
    if not isinstance(value, list) or len(value) != 33:
        raise MessageError("landmarks must be 33 [x, y, visibility] rows or null")
    out = []
    for row in value:
        if not isinstance(row, list) or len(row) != 3 or not all(isinstance(v, (int, float)) for v in row):
            raise MessageError("landmark rows must be [x, y, visibility]")
        out.append((float(row[0]), float(row[1]), float(row[2])))
    return out


# ---------- building and hit test (same rules as /test/mono3d/) ----------
def waist_height(estimated_height_m: float | None) -> float:
    if not estimated_height_m or estimated_height_m <= 0:
        return DEFAULT_WAIST_M
    return min(1.3, max(0.6, WAIST_TO_HEIGHT * estimated_height_m))


def inside_box(center, half, p, margin=0.0) -> bool:
    return p is not None and all(abs(p[k] - center[k]) <= half[k] + margin for k in range(3))


def segment_hits_box(center, half, a, b, margin=0.0) -> bool:
    if a is None or b is None:
        return inside_box(center, half, b, margin)
    t0, t1 = 0.0, 1.0
    for k in range(3):
        lo, hi, d = center[k] - half[k] - margin, center[k] + half[k] + margin, b[k] - a[k]
        if abs(d) < 1e-12:
            if a[k] < lo or a[k] > hi:
                return False
            continue
        s0, s1 = sorted(((lo - a[k]) / d, (hi - a[k]) / d))
        t0, t1 = max(t0, s0), min(t1, s1)
        if t0 > t1:
            return False
    return True


def reprojection_cost(obs: dict, calibs: dict) -> float | None:
    """Max reprojection error (px) of one joint triangulated from all given views, None if < 2 views."""
    if len(obs) < 2:
        return None
    try:
        X = triangulate_dlt([obs[c] for c in obs], [calibs[c].Rt for c in obs])
    except ValueError:
        return MISMATCH_PENALTY_PX
    errors = []
    for c, xy in obs.items():
        cal = calibs[c]
        if cal.depth(X)[0] <= 0:
            return MISMATCH_PENALTY_PX
        measured = (cal.K @ np.array([xy[0], xy[1], 1.0]))[:2]
        errors.append(float(np.linalg.norm(cal.project(X)[0] - measured)))
    return min(max(errors), MISMATCH_PENALTY_PX)


def choose_swaps(raw: dict[str, dict], calibs: dict) -> set[str]:
    """Cameras whose left/right labels to swap so the views agree best. The first camera is the reference."""
    cams = sorted(raw)
    if len(cams) < 2:
        return set()
    best = None
    for flags in product((False, True), repeat=len(cams) - 1):
        swapped = {c for c, f in zip(cams[1:], flags) if f}
        total = 0.0
        core=[pair for pair in (PAIRS[0],PAIRS[3]) if sum(all(n in raw[c] for n in pair)
              and np.linalg.norm(raw[c][pair[0]]-raw[c][pair[1]])>.005 for c in cams)>=2]
        for a, b in core or PAIRS:
            for name in (a, b):
                obs = {}
                for c in cams:
                    src = SWAP[name] if c in swapped else name
                    if src in raw[c]:
                        obs[c] = raw[c][src]
                cost = reprojection_cost(obs, calibs)
                if cost is not None:
                    total += cost
        if best is None or total < best[0] - 1e-9:
            best = (total, swapped)
    return best[1]


def camera_geometry_warnings(calibs: dict, target) -> list[str]:
    warnings = []
    target = np.asarray(target, float)
    for a, b in combinations(sorted(calibs), 2):
        # Horizontal (floor-plane) angle: phones at similar heights facing each other look nearly
        # along the same line even if the 3D angle is a bit smaller.
        da, db = (calibs[a].center - target)[:2], (calibs[b].center - target)[:2]
        cos = float(np.dot(da, db) / (np.linalg.norm(da) * np.linalg.norm(db)))
        angle = float(np.degrees(np.arccos(np.clip(cos, -1, 1))))
        if angle > MAX_PAIR_ANGLE_DEG:
            warnings.append(f"{a}-{b} facing:{angle:.0f}")
        elif angle < MIN_PAIR_ANGLE_DEG:
            warnings.append(f"{a}-{b} same_side:{angle:.0f}")
    return warnings


class Multi3d:
    def __init__(self) -> None:
        self.phones: dict[str, Peer] = {}
        self.calibs: dict[str, Calibration] = {}
        self.calib_msgs: dict[str, dict] = {}
        self.frames: dict[str, dict] = {}      # camera -> {landmarks, at, fps}
        self.inputs=InputFrames()
        self.jpegs: dict[str, dict] = {}
        self.viewers: set[Peer] = set()
        self.building = {"x": 0.0, "y": 0.0, "width": 0.3, "depth": 0.3, "height": None, "margin": 0.05}
        self.nose_heights: deque[float] = deque(maxlen=150)
        self.hits = 0
        self.was_inside = {w: False for w in WRISTS}
        self.prev = {w: None for w in WRISTS}  # (position, at)
        self.last_hit_at = {w: -1e9 for w in WRISTS}
        self.last_fused: dict | None = None
        self.last_fuse_at = -1e9
        self.pending_fuse: asyncio.TimerHandle | None = None
        from .body_reference import BodyCapture
        self.body_capture=BodyCapture();self.body_required=False
        self.fragment_test = None  # enabled only by the separate IT1 fragment-test viewer
        self.smash = SuperSmash()
        self.viewer_ids = {}
        self.watch_task = None

    def model_snapshot(self, delivery='update'):
        return self.smash.decorate(self.fragment_test.snapshot(), delivery)

    def ensure_watch(self):
        if self.watch_task is not None:return
        async def watch():
            while self.viewers or self.phones:
                await asyncio.sleep(.2)
                if self.smash.mode == 'super_smash':self.maybe_fuse()
            self.watch_task=None
        self.watch_task=asyncio.create_task(watch())

    # ----- state -----
    def estimated_height(self) -> float | None:
        if len(self.nose_heights) < 15:
            return None
        return statistics.median(self.nose_heights) / NOSE_TO_HEIGHT

    def box(self):
        b = self.building
        auto = b["height"] is None
        h = waist_height(self.estimated_height()) if auto else float(b["height"])
        return {"center": [b["x"], b["y"], h / 2], "half": [b["width"] / 2, b["depth"] / 2, h / 2],
                "margin": b["margin"], "auto_height": auto, "estimated_height_m": self.estimated_height()}

    def status(self) -> dict:
        t = now_ms()
        cams = {}
        for c in CAMERAS:
            f = self.frames.get(c)
            clock=self.inputs.clocks.get(c)
            cams[c] = {"connected": c in self.phones, "calibrated": c in self.calibs,
                       "fps": f["fps"] if f else None, "age_ms": round(t - f["at"]) if f else None,
                       "person": bool(f and f["landmarks"]),
                       'clock_ready':bool(clock and clock.ready),'clock_uncertainty_ms':clock.uncertainty_ms if clock else None}
        return {"type": "multi3d_status", "cameras": cams, "viewers": len(self.viewers)}

    def broadcast(self, message: dict, latest_key: str | None = None, phones: bool = False) -> None:
        targets = [*self.viewers, *(self.phones.values() if phones else ())]
        for peer in targets:
            if latest_key:
                peer.send_video(latest_key, message)
            else:
                peer.send(message)

    def broadcast_status(self) -> None:
        self.broadcast(self.status(), phones=True)

    # ----- fusion -----
    def fuse(self) -> dict:
        compute_started=time.perf_counter()*1000
        t = now_ms()
        live = {c: f for c, f in self.frames.items() if c in self.calibs and t - f["at"] <= STALE_MS}
        views,timing,target,excluded=self.inputs.select(live)
        observed_at=target if timing=='inference_input_aligned' and target is not None else t
        spread = (max(f.get('sample_at',f['at']) for f in views.values()) - min(f.get('sample_at',f['at']) for f in views.values())) if views else None
        joints: dict[str, dict | None] = {}
        reasons: dict[str, str] = {}
        raw: dict[str, dict] = {}              # camera -> joint -> normalized image point
        visibility={}
        for c, f in views.items():
            lm, cal = f["landmarks"], self.calibs[c]
            raw[c] = {}
            visibility[c]={}
            for name, index in (JOINTS.items() if lm else ()):
                x, y, vis = lm[index]
                if vis >= MIN_VISIBILITY and 0 <= x <= 1 and 0 <= y <= 1:
                    raw[c][name] = cal.normalize(np.array([[x * cal.width, y * cal.height]]), distorted=True)[0]
                    visibility[c][name]=vis
        swapped = choose_swaps(raw, self.calibs)
        for name in JOINTS:
            obs = {}
            confidence={}
            for c in raw:
                src = SWAP.get(name, name) if c in swapped else name
                if src in raw[c]:
                    obs[c] = raw[c][src]
                    confidence[c]=visibility[c][src]
            est = robust_estimate(obs, {c: self.calibs[c] for c in obs},confidence,MAX_REPROJECTION_PX)
            if est.position_m is None:
                joints[name] = None
                reasons[name] = est.reason or "invalid"
            else:
                joints[name] = {"p": [round(float(v), 4) for v in est.position_m], "cams": list(est.camera_ids),
                                "err_px": round(float(est.reprojection_error_px), 1),
                                'ray_angle_deg':round(est.ray_angle_deg,1),'excluded_cameras':sorted(set(obs)-set(est.camera_ids))}

        nose, la, ra = joints.get("nose"), joints.get("left_ankle"), joints.get("right_ankle")
        if nose and (la or ra):                # standing person: nose height above the lower ankle
            floor = min(a["p"][2] for a in (la, ra) if a) - 0.08
            if 0.8 < nose["p"][2] - floor < 2.2:
                self.nose_heights.append(nose["p"][2] - max(0.0, floor))

        if self.body_capture.update(joints,observed_at,len(views)):
            from .fragment_test import apply_body_reference
            if self.fragment_test:self.fragment_test=apply_body_reference(self.fragment_test,self.body_capture.reference)
            from .fragment_test import BUILDING_HEIGHT_RATIO
            self.building.update(x=0.0,y=0.0,height=self.body_capture.reference['waist_height_m']*BUILDING_HEIGHT_RATIO)
        can_hit=not self.body_required or self.body_capture.reference is not None
        box = self.box()
        # Standing on the building spot: hands hanging by the body would count as hits all the time.
        feet = [joints[n]["p"] for n in ("left_ankle", "right_ankle") if joints.get(n)]             or [joints[n]["p"] for n in ("left_hip", "right_hip") if joints.get(n)]
        standing_in = bool(feet) and all(
            abs(float(np.mean([p[k] for p in feet])) - box["center"][k]) <= box["half"][k] + STAND_CLEARANCE_M for k in (0, 1))
        hit_now = {}
        for w in WRISTS:
            p = joints[w]["p"] if can_hit and joints.get(w) else None
            inside = inside_box(box["center"], box["half"], p, box["margin"])
            prev = self.prev[w]
            swept = bool(p and prev and 0 < observed_at - prev[1] <= SWING_MAX_GAP_MS
                         and float(np.linalg.norm(np.subtract(p, prev[0]))) <= SWING_MAX_JUMP_M
                         and segment_hits_box(box["center"], box["half"], prev[0], p, box["margin"]))
            if (inside or swept) and not standing_in and not self.was_inside[w] and t - self.last_hit_at[w] >= HIT_COOLDOWN_MS:
                self.hits += 1
                self.last_hit_at[w] = t
                hit_now[w] = "inside" if inside else "swept"
            self.was_inside[w] = inside
            self.prev[w] = (p, observed_at) if p else None

        model_test=None
        if self.fragment_test:
            eligible=self.smash.gate(self,joints,observed_at,t,timing,views,can_hit)
            state=(self.fragment_test.snapshot() if eligible is None else
                   self.fragment_test.update(eligible,observed_at,super_smash=self.smash.mode=='super_smash'))
            if state.get('event') and state['event'].get('effect_style')=='screen_impact_v1':
                event=state['event'];joint=joints.get(event.get('joint')) or {}
                event['quality']={k:joint.get(k) for k in ('cams','err_px','ray_angle_deg')}
                event['quality'].update(timing=timing,spread_ms=spread,
                    clock_uncertainty_ms={c:self.inputs.clocks[c].uncertainty_ms for c in views if c in self.inputs.clocks})
                event['server_fuse_ms']=time.perf_counter()*1000-compute_started
            model_test=self.smash.decorate(state)
        return {"type": "multi3d_fused", "source": "multi_view_test", "timing": timing,
                'excluded_cameras':excluded,'input_reference_ms':target,
                "cameras_used": sorted(views), "spread_ms": round(spread) if spread is not None else None,
                "valid": any(joints.get(w) for w in WRISTS), "joints": joints, "reasons": reasons,
                "building": box, "hits": self.hits, "hit": hit_now, "standing_in_building": standing_in,
                "swapped_left_right": sorted(swapped),
                "geometry_warnings": camera_geometry_warnings(self.calibs, [box["center"][0], box["center"][1], 1.0]),
                "cameras": self.status()["cameras"], "model_test": model_test, "body_calibration":self.body_capture.snapshot(),"body_calibration_required":self.body_required}

    def maybe_fuse(self, force: bool = False) -> None:
        t = now_ms()
        wait = FUSE_INTERVAL_MS - (t - self.last_fuse_at)
        if not force and wait > 0:
            # Throttled: fuse once more when the interval ends, so the last camera's frame is used.
            if self.pending_fuse is None:
                self.pending_fuse = asyncio.get_running_loop().call_later(wait / 1000, self._trailing_fuse)
            return
        if self.pending_fuse is not None:
            self.pending_fuse.cancel()
            self.pending_fuse = None
        self.last_fuse_at = t
        fused = self.fuse()
        self.last_fused = fused
        # A hit must not be dropped by latest-only delivery: send those reliably.
        if self.smash.mode=='super_smash':
            # Latest-only queue tokens can overtake a hit when replaced by a later revision.
            for peer in [*self.viewers,*self.phones.values()]:peer.send_critical(fused)
        else:
            self.broadcast(fused, None if fused["hit"] or (fused["model_test"] and fused["model_test"]["event"]) else "fused", phones=True)


    def _trailing_fuse(self) -> None:
        self.pending_fuse = None
        self.maybe_fuse(force=True)


def multi3d_router() -> APIRouter:
    router = APIRouter()
    hub = Multi3d()

    @router.websocket("/ws/test/multi3d")
    async def multi3d_socket(websocket: WebSocket) -> None:
        role, camera = websocket.query_params.get("role"), websocket.query_params.get("camera")
        await websocket.accept()
        peer = Peer(websocket, f"multi3d:{role}:{camera}", queue_size=32).start()
        clock_task=None
        if role not in ("phone", "viewer") or (role == "phone" and camera not in CAMERAS):
            peer.send({"type": "error", "code": "bad_role_or_camera"})
            await peer.close(CLOSE_BAD_REQUEST, "bad_role_or_camera")
            return

        if role == "viewer":
            hub.viewer_ids[peer]=uuid.uuid4().hex
            peer.send({'type':'multi3d_viewer','viewer_id':hub.viewer_ids[peer]})
            if websocket.query_params.get("model") == "it1" and hub.fragment_test is None:
                from backend.fragment_test import FragmentTest
                hub.fragment_test = FragmentTest()
            hub.viewers.add(peer)
            for c in CAMERAS:
                if c in hub.calib_msgs:
                    peer.send(hub.calib_msgs[c])
                if c in hub.jpegs:
                    peer.send(hub.jpegs[c])
            if hub.last_fused:
                initial={**hub.last_fused}
                if hub.fragment_test:initial['model_test']=hub.model_snapshot('snapshot')
                peer.send(initial)
            if hub.fragment_test:
                peer.send({"type": "multi3d_model_state", "model_test": hub.model_snapshot('snapshot')})
        else:
            if hub.fragment_test:
                hub.fragment_test.clear_tracking()
            old = hub.phones.get(camera)
            hub.phones[camera] = peer
            hub.inputs.reset(camera)
            hub.smash.invalidate(hub.fragment_test)
            mode=websocket.query_params.get('input_mode','live')
            hub.smash.input_modes[camera]=mode if mode in ('live','synthetic','replay') else 'unknown'
            if hub.body_required:hub.body_capture.invalidate()
            for store in (hub.calibs, hub.calib_msgs, hub.frames, hub.jpegs):
                store.pop(camera, None)
            if old is not None:
                old.send({"type": "error", "code": "superseded"})
                await old.close(CLOSE_SUPERSEDED, "superseded")
            log.info("multi3d %s connected", camera)
            async def ping_clock():
                count=0
                while hub.phones.get(camera) is peer:
                    peer.send(hub.inputs.ping(camera,uuid.uuid4().hex,now_ms()))
                    count+=1
                    await asyncio.sleep(.1 if count<5 else 2)
            clock_task=asyncio.create_task(ping_clock())
        hub.broadcast_status()
        hub.ensure_watch()

        try:
            while True:
                text = await websocket.receive_text()
                if role == "phone" and hub.phones.get(camera) is not peer:
                    continue
                if len(text.encode("utf-8")) > MAX_MESSAGE_BYTES:
                    peer.send({"type": "error", "code": "message_too_large"})
                    continue
                try:
                    m = json.loads(text)
                    if not isinstance(m, dict):
                        raise MessageError("object expected")
                    kind = m.get("type")
                    if kind=='multi3d_body_start':
                        if hub.smash.mode=='super_smash':raise MessageError('body capture unavailable during super smash')
                        from .fragment_test import FragmentTest
                        if hub.fragment_test is None:hub.fragment_test=FragmentTest()
                        hub.body_required=True;hub.body_capture.start();hub.fragment_test.clear_tracking()
                        hub.maybe_fuse(force=True)
                    elif role == "viewer":
                        if kind=='multi3d_model_snapshot':
                            if hub.fragment_test:peer.send_critical({'type':'multi3d_model_state','model_test':hub.model_snapshot('snapshot')})
                        elif kind=='multi3d_model_control':
                            if hub.fragment_test is None:raise MessageError('model viewer required')
                            ack,state=hub.smash.control(m,hub.viewer_ids[peer],hub,now_ms())
                            peer.send_critical(ack)
                            if state:
                                for target in hub.viewers:target.send_critical({'type':'multi3d_model_state','model_test':state})
                        elif kind=='multi3d_presentation':
                            if hub.fragment_test:hub.smash.presentation(m,hub.viewer_ids[peer],hub.fragment_test,now_ms())
                        elif isinstance(kind, str) and kind.startswith("multi3d_model_"):
                            if hub.smash.mode=='super_smash':raise MessageError('use super smash control envelope')
                            from backend.fragment_test import FragmentTest, model_command
                            if hub.fragment_test is None:
                                hub.fragment_test = FragmentTest()
                            hub.fragment_test = model_command(hub.fragment_test, m)
                            if hub.body_capture.reference:
                                from .fragment_test import apply_body_reference
                                hub.fragment_test=apply_body_reference(hub.fragment_test,hub.body_capture.reference)
                            hub.maybe_fuse(force=True)
                        elif kind == "multi3d_config":
                            b = m.get("building", {})
                            if not isinstance(b, dict):
                                raise MessageError("building must be an object")
                            if hub.body_capture.reference and any(k in b for k in ('x','y','width','depth','height')):
                                raise MessageError('body_reference_locked')
                            new = dict(hub.building)
                            for key in ("x", "y", "width", "depth", "margin"):
                                if key in b:
                                    new[key] = float(b[key])
                            if "height" in b:
                                new["height"] = None if b["height"] is None else float(b["height"])
                            if not all(math.isfinite(value) for value in new.values() if value is not None):
                                raise MessageError("building values must be finite")
                            if min(new["width"], new["depth"]) <= 0 or new["margin"] < 0 or (new["height"] is not None and new["height"] <= 0):
                                raise MessageError("building sizes must be positive")
                            hub.building = new
                            hub.maybe_fuse(force=True)
                        elif kind == "multi3d_reset_hits":
                            hub.hits = 0
                            hub.maybe_fuse(force=True)
                        else:
                            raise MessageError(f"unsupported: {kind}")
                    elif kind == "multi3d_calib":
                        hub.calibs[camera] = parse_calibration(camera, m)
                        hub.smash.invalidate(hub.fragment_test)
                        # Marker calibration remains necessary; person capture is optional in 3-view tests.
                        hub.body_required=False
                        if hub.body_capture.active or hub.body_capture.reference:hub.body_capture.invalidate()
                        hub.inputs.buffers.pop(camera,None);hub.frames.pop(camera,None)
                        if hub.fragment_test:
                            hub.fragment_test.clear_tracking()
                        hub.calib_msgs[camera] = {**m, "camera_id": camera}
                        hub.broadcast(hub.calib_msgs[camera])
                        hub.broadcast_status()
                    elif kind == "multi3d_frame":
                        landmarks = parse_landmarks(m.get("landmarks"))
                        frame={"landmarks": landmarks, "at": now_ms(), "fps": m.get("fps")}
                        if not hub.inputs.add(camera,frame,m):continue
                        hub.frames[camera] = frame
                        hub.broadcast({"type": "multi3d_frame", "camera_id": camera, "landmarks": m.get("landmarks")},
                                      latest_key=f"frame:{camera}")
                        hub.maybe_fuse()
                    elif kind=='multi3d_clock_pong':
                        old_clock=hub.inputs.clocks.get(camera)
                        old_id=old_clock.clock_id if old_clock else None
                        hub.inputs.pong(camera,m,now_ms())
                        if old_id is not None and old_id!=m.get('clock_id'):hub.smash.invalidate(hub.fragment_test)
                    elif kind == "multi3d_jpeg":
                        if not isinstance(m.get("data"), str) or not m["data"].startswith("data:image/jpeg;base64,"):
                            raise MessageError("jpeg data URL expected")
                        hub.jpegs[camera] = {"type": "multi3d_jpeg", "camera_id": camera, "data": m["data"],"occlusion":m.get("occlusion"),"t_ms":m.get("t_ms")}
                        hub.broadcast(hub.jpegs[camera], latest_key=f"jpeg:{camera}")
                    else:
                        raise MessageError(f"unsupported: {kind}")
                except (TypeError, ValueError, OverflowError) as exc:
                    peer.send({"type": "error", "code": "bad_message", "detail": str(exc)[:200]})
        except WebSocketDisconnect:
            pass
        except RuntimeError:
            if websocket.application_state is not WebSocketState.DISCONNECTED:
                raise
        finally:
            if clock_task:clock_task.cancel()
            if role == "viewer":
                hub.viewers.discard(peer)
                hub.smash.disconnect(hub.viewer_ids.pop(peer,None))
            elif hub.phones.get(camera) is peer:
                hub.smash.invalidate(hub.fragment_test)
                hub.smash.input_modes.pop(camera,None)
                if hub.fragment_test:
                    hub.fragment_test.clear_tracking()
                if hub.body_required:hub.body_capture.invalidate()
                del hub.phones[camera]
                hub.inputs.reset(camera)
                for store in (hub.calibs, hub.calib_msgs, hub.frames, hub.jpegs):
                    store.pop(camera, None)
                hub.broadcast({"type": "multi3d_phone_left", "camera_id": camera})
                log.info("multi3d %s disconnected", camera)
            hub.broadcast_status()
            if not hub.viewers and not hub.phones:
                if hub.watch_task:hub.watch_task.cancel();hub.watch_task=None
                if hub.pending_fuse:hub.pending_fuse.cancel();hub.pending_fuse=None
            await peer.stop()

    return router
