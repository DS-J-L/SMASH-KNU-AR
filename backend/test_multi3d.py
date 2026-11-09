"""Test-only 3-camera relay + triangulation for /test/multi3d/ (same flow as /test/mono3d/).

    /ws/test/multi3d?role=phone&camera=C0|C1|C2
        phone -> server: multi3d_calib (K, R, t from the floor marker), multi3d_frame (33 landmarks), multi3d_jpeg
        server -> phone: multi3d_fused, multi3d_status
    /ws/test/multi3d?role=viewer
        viewer -> server: multi3d_config (building), multi3d_reset_hits
        server -> viewer: phone calib/frame/jpeg (tagged with camera_id), multi3d_fused, multi3d_status

Every phone calibrates against the same floor marker, so all share the marker's room_z_up frame.
The server triangulates each joint from the latest frame of every calibrated camera whose arrival is
within SYNC_WINDOW_MS of the newest one (DLT + quality gate from backend/tracking, unchanged).
TIMING IS SERVER ARRIVAL TIME, NOT CAPTURE TIME: network jitter shifts views by tens of ms, so fast
swings get a position error. Results carry source='multi_view_test' and are not P3 evidence.
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

from .calibration.storage import Calibration
from .connections import Peer
from .tracking.quality import estimate_joint
from .tracking.triangulation import triangulate_dlt

CAMERAS = ("C0", "C1", "C2")
MAX_MESSAGE_BYTES = 512 * 1024
SYNC_WINDOW_MS = 120          # views further apart than this are not fused together
STALE_MS = 400                # a camera silent for longer is left out
FUSE_INTERVAL_MS = 25         # at most ~40 fused results per second
MIN_VIEWS = 2
MAX_REPROJECTION_PX = 30.0    # loose: intrinsics come from an approximate FOV, no lens calibration
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
    return time.monotonic() * 1000.0


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
    return Calibration(calibration_id=uuid.uuid4().hex, source="test_marker_tap", camera_id=camera_id,
                       device_id=None, width=width, height=height, rotation_deg=0, K=K, dist=np.zeros(5), R=R, t=t)


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
        for a, b in PAIRS:
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
            cams[c] = {"connected": c in self.phones, "calibrated": c in self.calibs,
                       "fps": f["fps"] if f else None, "age_ms": round(t - f["at"]) if f else None,
                       "person": bool(f and f["landmarks"])}
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
        t = now_ms()
        live = {c: f for c, f in self.frames.items() if c in self.calibs and t - f["at"] <= STALE_MS}
        newest = max((f["at"] for f in live.values()), default=None)
        views = {c: f for c, f in live.items() if newest is not None and newest - f["at"] <= SYNC_WINDOW_MS}
        spread = (max(f["at"] for f in views.values()) - min(f["at"] for f in views.values())) if views else None
        joints: dict[str, dict | None] = {}
        reasons: dict[str, str] = {}
        raw: dict[str, dict] = {}              # camera -> joint -> normalized image point
        for c, f in views.items():
            lm, cal = f["landmarks"], self.calibs[c]
            raw[c] = {}
            for name, index in (JOINTS.items() if lm else ()):
                x, y, vis = lm[index]
                if vis >= MIN_VISIBILITY and 0 <= x <= 1 and 0 <= y <= 1:
                    raw[c][name] = cal.normalize(np.array([[x * cal.width, y * cal.height]]), distorted=False)[0]
        swapped = choose_swaps(raw, self.calibs)
        for name in JOINTS:
            obs = {}
            for c in raw:
                src = SWAP.get(name, name) if c in swapped else name
                if src in raw[c]:
                    obs[c] = raw[c][src]
            est = estimate_joint(obs, {c: self.calibs[c] for c in obs}, MIN_VIEWS, MAX_REPROJECTION_PX)
            if est.position_m is None:
                joints[name] = None
                reasons[name] = est.reason or "invalid"
            else:
                joints[name] = {"p": [round(float(v), 4) for v in est.position_m], "cams": list(est.camera_ids),
                                "err_px": round(float(est.reprojection_error_px), 1)}

        nose, la, ra = joints.get("nose"), joints.get("left_ankle"), joints.get("right_ankle")
        if nose and (la or ra):                # standing person: nose height above the lower ankle
            floor = min(a["p"][2] for a in (la, ra) if a) - 0.08
            if 0.8 < nose["p"][2] - floor < 2.2:
                self.nose_heights.append(nose["p"][2] - max(0.0, floor))

        box = self.box()
        # Standing on the building spot: hands hanging by the body would count as hits all the time.
        feet = [joints[n]["p"] for n in ("left_ankle", "right_ankle") if joints.get(n)]             or [joints[n]["p"] for n in ("left_hip", "right_hip") if joints.get(n)]
        standing_in = bool(feet) and all(
            abs(float(np.mean([p[k] for p in feet])) - box["center"][k]) <= box["half"][k] + STAND_CLEARANCE_M for k in (0, 1))
        hit_now = {}
        for w in WRISTS:
            p = joints[w]["p"] if joints.get(w) else None
            inside = inside_box(box["center"], box["half"], p, box["margin"])
            prev = self.prev[w]
            swept = bool(p and prev and t - prev[1] <= SWING_MAX_GAP_MS
                         and float(np.linalg.norm(np.subtract(p, prev[0]))) <= SWING_MAX_JUMP_M
                         and segment_hits_box(box["center"], box["half"], prev[0], p, box["margin"]))
            if (inside or swept) and not standing_in and not self.was_inside[w] and t - self.last_hit_at[w] >= HIT_COOLDOWN_MS:
                self.hits += 1
                self.last_hit_at[w] = t
                hit_now[w] = "inside" if inside else "swept"
            self.was_inside[w] = inside
            self.prev[w] = (p, t) if p else None

        return {"type": "multi3d_fused", "source": "multi_view_test", "timing": "server_arrival",
                "cameras_used": sorted(views), "spread_ms": round(spread) if spread is not None else None,
                "valid": any(joints.get(w) for w in WRISTS), "joints": joints, "reasons": reasons,
                "building": box, "hits": self.hits, "hit": hit_now, "standing_in_building": standing_in,
                "swapped_left_right": sorted(swapped),
                "geometry_warnings": camera_geometry_warnings(self.calibs, [box["center"][0], box["center"][1], 1.0]),
                "cameras": self.status()["cameras"]}

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
        self.broadcast(fused, None if fused["hit"] else "fused", phones=True)


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
        if role not in ("phone", "viewer") or (role == "phone" and camera not in CAMERAS):
            peer.send({"type": "error", "code": "bad_role_or_camera"})
            await peer.close(CLOSE_BAD_REQUEST, "bad_role_or_camera")
            return

        if role == "viewer":
            hub.viewers.add(peer)
            for c in CAMERAS:
                if c in hub.calib_msgs:
                    peer.send(hub.calib_msgs[c])
                if c in hub.jpegs:
                    peer.send(hub.jpegs[c])
            if hub.last_fused:
                peer.send(hub.last_fused)
        else:
            old = hub.phones.get(camera)
            hub.phones[camera] = peer
            for store in (hub.calibs, hub.calib_msgs, hub.frames, hub.jpegs):
                store.pop(camera, None)
            if old is not None:
                old.send({"type": "error", "code": "superseded"})
                await old.close(CLOSE_SUPERSEDED, "superseded")
            log.info("multi3d %s connected", camera)
        hub.broadcast_status()

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
                    if role == "viewer":
                        if kind == "multi3d_config":
                            b = m.get("building", {})
                            if not isinstance(b, dict):
                                raise MessageError("building must be an object")
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
                        hub.calib_msgs[camera] = {**m, "camera_id": camera}
                        hub.broadcast(hub.calib_msgs[camera])
                        hub.broadcast_status()
                    elif kind == "multi3d_frame":
                        landmarks = parse_landmarks(m.get("landmarks"))
                        hub.frames[camera] = {"landmarks": landmarks, "at": now_ms(), "fps": m.get("fps")}
                        hub.broadcast({"type": "multi3d_frame", "camera_id": camera, "landmarks": m.get("landmarks")},
                                      latest_key=f"frame:{camera}")
                        hub.maybe_fuse()
                    elif kind == "multi3d_jpeg":
                        if not isinstance(m.get("data"), str) or not m["data"].startswith("data:image/jpeg;base64,"):
                            raise MessageError("jpeg data URL expected")
                        hub.jpegs[camera] = {"type": "multi3d_jpeg", "camera_id": camera, "data": m["data"]}
                        hub.broadcast(hub.jpegs[camera], latest_key=f"jpeg:{camera}")
                    else:
                        raise MessageError(f"unsupported: {kind}")
                except (TypeError, ValueError, OverflowError) as exc:
                    peer.send({"type": "error", "code": "bad_message", "detail": str(exc)[:200]})
        except WebSocketDisconnect:
            pass
        finally:
            if role == "viewer":
                hub.viewers.discard(peer)
            elif hub.phones.get(camera) is peer:
                del hub.phones[camera]
                for store in (hub.calibs, hub.calib_msgs, hub.frames, hub.jpegs):
                    store.pop(camera, None)
                hub.broadcast({"type": "multi3d_phone_left", "camera_id": camera})
                log.info("multi3d %s disconnected", camera)
            hub.broadcast_status()
            await peer.stop()

    return router
