"""Test-only wide stages: single-camera phones side by side, judged as one stage.

Two layouts share this hub (one instance each):
    wide  /test/building/?mode=wide  /ws/test/wide3d  judging phones C0|C1|C2 on markers ID0/ID1/ID2
    duo   /test/building/?mode=duo   /ws/test/duo3d   judging phones C0|C1 on markers ID0/ID1, plus a view-only
          phone V on the far side that sees both markers at once; its video is the main screen
          (docs/DUO_STAGE_TEST.md). V sends wide3d_view_calib (pose already in the stage frame),
          wide3d_view_layout (measured marker spacing and turns, shown on the PC) and mono3d_jpeg; it never
          judges. It receives the judging phone's stage-frame joints (duo_person) to give the real person's outline in its own video a depth; that outline comes back with its mono3d_jpeg.
          With auto spacing on (default), V's measured spacing becomes the stage spacing (no fixed 2 m).
          WebRTC (2026-11-20): rtc_signal {to, data} is relayed between a viewer (PC) and V so V's camera video
          goes straight to the PC on the same Wi-Fi; the server never sees that video. mono3d_jpeg stays the fallback.

    /ws/test/wide3d?role=phone&camera=C0|C1|C2
        phone -> server: mono3d_calib, mono3d_frame, mono3d_jpeg (the /test/mono3d/ page with ?stage=wide)
        server -> phone: mono3d_status
    /ws/test/wide3d?role=viewer
        viewer -> server: multi3d_model_* commands, wide3d_stage_config {spacing_m}, duo: duo_auto_spacing {enabled},
                          rtc_signal {to:'V', data}
        server -> viewer: multi3d_calib / multi3d_jpeg / multi3d_phone_left (tagged with camera_id, stage frame),
                          wide3d_frame, wide3d_status, multi3d_model_state

Markers lie on the floor in one row along +X, same orientation, `spacing_m` apart and centred on x = 0:
wide marker n is at x = (n - 1) * spacing, duo marker n at x = (n - 0.5) * spacing. Each phone keeps its own single-camera approximate depth in its marker frame and the
server only shifts it by that offset; nothing is triangulated. The phone whose marker is closest to the
person judges the hits (with hysteresis), so one swing is never judged from two phones' different estimates.
A wrist/ankle the judging phone cannot see is borrowed from a neighbour that sees the same person right now; when
a joint's source phone changes, only that joint's path is cut, so the jump between two estimates is never a swing.
Results stay `source: mono_approx`. Nothing is stored on disk. Protected by the normal access key.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from .building_scenes import (DUO_PREFIX, STAGE_SECTIONS, WIDE_PREFIX, WIDE_SPACING_RANGE_M, stage_set, stage_sets,
                              scene_spec, wide_scene_id)
from .connections import Peer
from .fragment_test import FragmentTest, model_command
from .model_strike import Placement

CAMERAS = ("C0", "C1", "C2")    # the wide layout; see LAYOUTS
VIEW_CAMERA = "V"
LAYOUTS = {
    "wide": {"cameras": CAMERAS, "prefix": WIDE_PREFIX, "view": False, "spacing_m": 1.5},
    "duo": {"cameras": ("C0", "C1"), "prefix": DUO_PREFIX, "view": True, "spacing_m": 2.0},
}
MAX_MESSAGE_BYTES = 512 * 1024
AUTO_SPACING_MIN_M = 0.005       # duo: V's measured spacing replaces the stage spacing when it differs this much
STALE_MS = 400                   # a phone's last valid frame older than this cannot judge
SWITCH_MARGIN_M = 0.15           # another phone takes over only when the person is this much closer to its marker
BLAST_RADIUS_M = 0.6             # default blast reach: one building in one section, not the whole row
BORROW_MAX_AGE_MS = 150          # a borrowed joint must be this fresh (it is judged at the owner's frame time)
BORROW_ANCHOR_TOLERANCE_M = 0.4  # the neighbour's person must stand this close to the owner's person (same person)
BORROW_JOINTS = ("left_wrist", "right_wrist", "left_ankle", "right_ankle")
MODEL_JOINTS = ("left_wrist", "right_wrist", "left_ankle", "right_ankle", "left_hip", "right_hip")
CLOSE_SUPERSEDED = 4001
CLOSE_BAD_REQUEST = 4400
log = logging.getLogger("smash.wide3d")


def now_ms() -> float:
    return time.perf_counter() * 1000.0


def marker_x(camera: str, spacing: float, cameras: tuple = CAMERAS) -> float:
    return (cameras.index(camera) - (len(cameras) - 1) / 2) * spacing


def finite_list(value, length) -> list[float] | None:
    if not isinstance(value, list) or len(value) != length:
        return None
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) <= 1e4 for v in value):
        return None
    return [float(v) for v in value]


def parse_calibration(camera: str, m: dict) -> dict:
    """The phone's marker-frame pose; rejects another camera's marker (ID n belongs to Cn)."""
    if m.get("marker_id") != int(camera[1:]):
        raise ValueError("marker_id_mismatch")
    image, k, pose = m.get("image"), m.get("K"), m.get("camera")
    if not isinstance(image, dict) or not isinstance(k, dict) or not isinstance(pose, dict):
        raise ValueError("bad calibration")
    size = finite_list([image.get("width"), image.get("height")], 2)
    K = finite_list([k.get(n) for n in ("fx", "fy", "cx", "cy")], 4)
    R, t, C = finite_list(pose.get("R"), 9), finite_list(pose.get("t"), 3), finite_list(pose.get("C"), 3)
    if not size or min(size) <= 0 or not K or min(K[:2]) <= 0 or not R or not t or not C:
        raise ValueError("bad calibration")
    if not is_rotation(R):
        raise ValueError("bad calibration: R is not a rotation")
    return {"image": {"width": size[0], "height": size[1]}, "K": dict(zip(("fx", "fy", "cx", "cy"), K)),
            "R": R, "t": t, "C": C, "marker_side_m": m.get("marker_side_m"), "facing": m.get("facing"),
            "body": m.get("body") if isinstance(m.get("body"), dict) else None}


def is_rotation(R: list[float]) -> bool:
    rows = [R[0:3], R[3:6], R[6:9]]
    return all(abs(sum(rows[i][k] * rows[j][k] for k in range(3)) - (i == j)) <= 1e-3 for i in range(3) for j in range(3))


def parse_view_calibration(m: dict, spacing: float) -> dict:
    """The view phone's pose from both markers at once, already in the stage frame for `spacing`."""
    image, k, pose = m.get("image"), m.get("K"), m.get("camera")
    if not isinstance(image, dict) or not isinstance(k, dict) or not isinstance(pose, dict):
        raise ValueError("bad view calibration")
    if m.get("marker_ids") != [0, 1]:
        raise ValueError("view calibration needs markers [0, 1]")
    used = m.get("spacing_m")
    if type(used) not in (int, float) or not math.isfinite(used) or abs(used - spacing) > 5e-4:
        raise ValueError("spacing_mismatch")
    size = finite_list([image.get("width"), image.get("height")], 2)
    K = finite_list([k.get(n) for n in ("fx", "fy", "cx", "cy")], 4)
    R, t, C = finite_list(pose.get("R"), 9), finite_list(pose.get("t"), 3), finite_list(pose.get("C"), 3)
    if not size or min(size) <= 0 or not K or min(K[:2]) <= 0 or not R or not t or not C or not is_rotation(R):
        raise ValueError("bad view calibration")
    error = m.get("reprojection_max_px")
    return {"image": {"width": size[0], "height": size[1]}, "K": dict(zip(("fx", "fy", "cx", "cy"), K)),
            "R": R, "t": t, "C": C, "marker_side_m": m.get("marker_side_m"), "spacing_m": float(used),
            "reprojection_max_px": error if type(error) in (int, float) and math.isfinite(error) else None}


def parse_view_layout(m: dict) -> dict:
    """The markers' real placement measured by the view phone: spacing and each marker's turn from the centre line.

    Informational: the PC shows it and may apply the spacing; the judging coordinates are not rotated by it."""
    spacing, entered = m.get("spacing_m"), m.get("entered_spacing_m")
    yaw, error = finite_list(m.get("yaw_deg"), 2), m.get("reprojection_max_px")
    if type(spacing) not in (int, float) or not math.isfinite(spacing) or not .2 <= spacing <= 10:
        raise ValueError("bad view layout: spacing_m")
    if yaw is None or any(abs(v) > 180 for v in yaw):
        raise ValueError("bad view layout: yaw_deg")
    warn = m.get("warn")
    return {"spacing_m": round(float(spacing), 4),
            "entered_spacing_m": float(entered) if type(entered) in (int, float) and math.isfinite(entered) else None,
            "yaw_deg": [round(v, 2) for v in yaw],
            "reprojection_max_px": float(error) if type(error) in (int, float) and math.isfinite(error) else None,
            "warn": [w for w in warn if w in ("spacing", "yaw")] if isinstance(warn, list) else []}


def body_reference(calib: dict | None) -> dict | None:
    ref = (calib or {}).get("body") or {}
    ref = ref.get("model_reference")
    if not isinstance(ref, dict) or not isinstance(ref.get("id"), str):
        return None
    waist = ref.get("waist_height_m")
    if type(waist) not in (int, float) or not math.isfinite(waist) or not .6 <= waist <= 1.3:
        return None
    return ref


class WideStage:
    def __init__(self, layout: str = "wide") -> None:
        self.layout = layout
        self.cameras: tuple = LAYOUTS[layout]["cameras"]
        self.has_view = LAYOUTS[layout]["view"]
        self.view_calib: dict | None = None    # duo: the view-only phone V, stage frame
        self.view_layout: dict | None = None   # duo: V's measured marker spacing/turns (shown on the PC only)
        self.last_outline: dict | None = None  # duo: V's last person outline, re-attached to video-only frames
        self.auto_spacing = self.has_view       # duo: V's measured spacing is applied by itself
        self.rtc_ids: dict[str, Peer] = {}      # duo: viewer id -> viewer, for WebRTC signalling with V
        self.phones: dict[str, Peer] = {}
        self.viewers: set[Peer] = set()
        self.calibs: dict[str, dict] = {}
        self.jpegs: dict[str, dict] = {}
        self.frames: dict[str, dict] = {}       # camera -> {at, valid, joints (stage), anchor_x}
        self.spacing = LAYOUTS[layout]["spacing_m"]
        self.zone_id = stage_sets(STAGE_SECTIONS[LAYOUTS[layout]["prefix"]], self.spacing)[0]["id"]   # a stage set
        self.reference: dict | None = None      # first body calibration, frozen until that phone redoes it
        self.owner: str | None = None
        self.joint_sources: dict[str, str] = {}  # strike joint -> phone whose estimate the model last tracked
        self.model: FragmentTest | None = None
        self.lock = asyncio.Lock()

    # ----- stage / model -----
    def marker_x(self, camera: str) -> float:
        return marker_x(camera, self.spacing, self.cameras)

    def height(self) -> float:
        # Kept in the scene id for compatibility; stage buildings are sized by width (0.7~0.8 m), not by the body.
        return 0.0

    def sections(self) -> int:
        return STAGE_SECTIONS[LAYOUTS[self.layout]["prefix"]]

    def follow_spacing(self, old_spacing: float) -> None:
        """Sets depend on the stage width: keep showing the set that holds the same first building."""
        old = stage_set(self.sections(), old_spacing, self.zone_id)
        sets = stage_sets(self.sections(), self.spacing)
        first = old["packages"][0] if old else None
        self.zone_id = next((g["id"] for g in sets if first in g["packages"]), sets[0]["id"])

    def scene_id(self) -> str:
        return wide_scene_id(self.zone_id, self.spacing, self.height(), LAYOUTS[self.layout]["prefix"])

    async def rebuild(self) -> None:
        old = self.model
        new = await asyncio.to_thread(FragmentTest, Placement(scale=1.0), self.scene_id())
        new.approximate = True
        new.sweep = self.has_view   # duo only: a swing breaks its whole path, one effect per swing
        if old:
            new.collapse, new.blast_enabled = old.collapse, old.blast_enabled
            new.blast_radius, new.blast_strength, new.depth_margin = old.blast_radius, old.blast_strength, old.depth_margin
        else:
            # Stage defaults (2026-11-20, user): a hit breaks what it touches; no whole-building blast, no support collapse.
            new.blast_radius = BLAST_RADIUS_M
            new.blast_enabled = False
            new.collapse = False
        # The size comes from this reference (baked into the scene id); stored for the PC's height text.
        new.body_reference = dict(self.reference) if self.reference else None
        self.model = new

    def stage(self) -> dict:
        return {"zone_id": self.zone_id, "spacing_m": self.spacing, "height_m": scene_spec(self.scene_id())["wide"]["height_m"],
                "owner": self.owner, "borrowed": self.borrowed(), "reference_camera": (self.reference or {}).get("camera_id"),
                "markers": {c: {"marker_id": i, "x_m": self.marker_x(c)} for i, c in enumerate(self.cameras)}, "layout": self.layout}

    def model_packet(self, state=None) -> dict:
        state = state or self.model.snapshot()
        return {"type": "multi3d_model_state", "source": "mono_approx", "timing": "server_arrival",
                "model_test": {**state, "stage": self.stage()}}

    def send_model(self, state=None) -> None:
        if not self.model:
            return
        packet = self.model_packet(state)
        for viewer in self.viewers:
            if packet["model_test"].get("event"):
                viewer.send(packet)
            else:
                viewer.send_video("model_state", packet)

    # ----- coordinates -----
    def stage_calib(self, camera: str) -> dict:
        """Marker-n frame -> stage frame: X_stage = X_marker + o, so t' = t - R o and C' = C + o."""
        c, o = self.calibs[camera], self.marker_x(camera)
        R, t = c["R"], c["t"]
        shifted_t = [t[i] - R[3 * i] * o for i in range(3)]
        return {"type": "multi3d_calib", "camera_id": camera, "source": "mono_approx", "stage": "wide",
                "image": c["image"], "K": c["K"], "R": R, "t": shifted_t, "C": [c["C"][0] + o, c["C"][1], c["C"][2]],
                "marker_id": int(camera[1:]), "marker_offset_m": [o, 0, 0], "marker_side_m": c["marker_side_m"],
                "body_calibrated": body_reference(c) is not None}

    def broadcast_calib(self, camera: str) -> None:
        packet = self.stage_calib(camera)
        for viewer in self.viewers:
            viewer.send(packet)

    def shift_joints(self, camera: str, joints) -> dict:
        o = self.marker_x(camera)
        out = {}
        if isinstance(joints, dict):
            for name, p in joints.items():
                q = finite_list(p, 3)
                if q is not None and isinstance(name, str):
                    out[name] = [round(q[0] + o, 4), q[1], q[2]]
        return out

    # ----- status -----
    def status(self) -> dict:
        t = now_ms()
        cams = {}
        for c in self.cameras:
            f = self.frames.get(c)
            cams[c] = {"connected": c in self.phones, "calibrated": c in self.calibs,
                       "body": body_reference(self.calibs.get(c)) is not None,
                       "valid": bool(f and f["valid"] and t - f["at"] <= STALE_MS),
                       "age_ms": round(t - f["at"]) if f else None,
                       "marker_id": int(c[1:]), "marker_x_m": self.marker_x(c)}
        view = None
        if self.has_view:
            view = {"connected": VIEW_CAMERA in self.phones, "calibrated": self.view_calib is not None,
                    "reprojection_max_px": (self.view_calib or {}).get("reprojection_max_px"),
                    "camera_height_m": round(self.view_calib["C"][2], 3) if self.view_calib else None,
                    "layout": self.view_layout, "auto_spacing": self.auto_spacing}
        return {"type": "wide3d_status", "layout": self.layout, "cameras": cams, "view": view,
                "owner": self.owner, "spacing_m": self.spacing,
                "zone_id": self.zone_id, "viewers": len(self.viewers)}

    def broadcast_status(self) -> None:
        status = self.status()
        for viewer in self.viewers:
            viewer.send(status)
        for camera, phone in self.phones.items():
            # The view phone solves its pose from these marker positions; a spacing change makes it solve again.
            phone.send({"type": "mono3d_status", "phone_connected": True, "viewers": len(self.viewers),
                        "camera": camera, "owner": self.owner, "layout": self.layout, "spacing_m": self.spacing,
                        "markers": {int(c[1:]): self.marker_x(c) for c in self.cameras},
                        "view_calibrated": self.view_calib is not None if camera == VIEW_CAMERA else None})

    def view_packet(self) -> dict:
        c = self.view_calib
        return {"type": "multi3d_calib", "camera_id": VIEW_CAMERA, "role": "view", "source": "mono_approx", "stage": self.layout,
                "image": c["image"], "K": c["K"], "R": c["R"], "t": c["t"], "C": c["C"], "marker_ids": [0, 1],
                "marker_offset_m": [0, 0, 0], "marker_side_m": c["marker_side_m"], "spacing_m": c["spacing_m"],
                "reprojection_max_px": c["reprojection_max_px"], "body_calibrated": False}

    # ----- judging phone -----
    def borrowed(self) -> dict:
        return {n: c for n, c in self.joint_sources.items() if c != self.owner}

    def borrow(self, name: str, anchor_x: float | None) -> tuple[list, str] | None:
        """The joint from the nearest-section neighbour that sees the same person now, else None."""
        if anchor_x is None:
            return None
        t, best = now_ms(), None
        for c, f in self.frames.items():
            if c == self.owner or not f["valid"] or t - f["at"] > BORROW_MAX_AGE_MS or name not in f["joints"]:
                continue
            if f["anchor_x"] is None or abs(f["anchor_x"] - anchor_x) > BORROW_ANCHOR_TOLERANCE_M:
                continue
            distance = abs(anchor_x - self.marker_x(c))
            if best is None or distance < best[0]:
                best = (distance, f["joints"][name], c)
        return (best[1], best[2]) if best else None

    def judged_joints(self, joints: dict, anchor_x: float | None) -> dict:
        """Owner joints, with missing wrists/ankles borrowed; a source change cuts only that joint's path."""
        judged, sources = {}, {}
        for n in MODEL_JOINTS:
            if n in joints:
                judged[n], sources[n] = joints[n], self.owner
            elif n in BORROW_JOINTS and (got := self.borrow(n, anchor_x)):
                judged[n], sources[n] = got
        for n in BORROW_JOINTS:
            if sources.get(n) != self.joint_sources.get(n):
                self.model.previous.pop(n, None)
        self.joint_sources = {n: c for n, c in sources.items() if n in BORROW_JOINTS}
        return judged

    def choose_owner(self) -> str | None:
        t = now_ms()
        live = {c: f for c, f in self.frames.items() if f["valid"] and f["anchor_x"] is not None and t - f["at"] <= STALE_MS}
        if not live:
            return None
        distance = {c: abs(f["anchor_x"] - self.marker_x(c)) for c, f in live.items()}
        best = min(distance, key=distance.get)
        if self.owner in distance and distance[best] > distance[self.owner] - SWITCH_MARGIN_M:
            return self.owner
        return best

    def on_frame(self, camera: str, m: dict) -> tuple[dict, dict | None]:
        valid = m.get("valid") is True and camera in self.calibs
        joints = self.shift_joints(camera, m.get("joints")) if valid else {}
        anchor = finite_list(m.get("anchor_m"), 3) if valid else None
        self.frames[camera] = {"at": now_ms(), "valid": valid and bool(joints), "joints": joints,
                               "anchor_x": anchor[0] + self.marker_x(camera) if anchor else None}
        owner = self.choose_owner()
        if owner != self.owner:
            # Another phone's estimate of the same swing differs; never join two phones into one path.
            self.owner = owner
            self.joint_sources = {}
            if self.model:
                self.model.clear_tracking()
            self.broadcast_status()
        state, shown = None, joints
        if self.model and camera == self.owner:
            judged = self.judged_joints(joints, self.frames[camera]["anchor_x"])
            state = self.model.update({n: {"p": p} for n, p in judged.items()}, now_ms())
            shown = {**joints, **judged}
        elif self.model and self.owner is None and not valid:
            state = self.model.update({}, now_ms())
        return {"type": "wide3d_frame", "camera_id": camera, "source": "mono_approx", "valid": self.frames[camera]["valid"],
                "reason": m.get("reason") if isinstance(m.get("reason"), str) else None,
                "joints": shown or None, "owner": self.owner,
                "borrowed": self.borrowed() if camera == self.owner else {}}, state

    def forget(self, camera: str) -> None:
        for store in (self.calibs, self.jpegs, self.frames):
            store.pop(camera, None)
        if camera == VIEW_CAMERA:
            self.view_calib = None
            self.view_layout = None
            self.last_outline = None
        if self.owner == camera:
            self.owner = None
            if self.model:
                self.model.clear_tracking()


def stage_router(layout: str) -> APIRouter:
    router = APIRouter()
    hub = WideStage(layout)
    path = f"/ws/test/{layout}3d"
    phone_ids = hub.cameras + ((VIEW_CAMERA,) if hub.has_view else ())

    async def ensure_model():
        async with hub.lock:
            if hub.model is None:
                await hub.rebuild()

    async def apply_spacing(spacing) -> None:
        """New marker spacing (hub.lock held): re-lay the stage, re-send calibrations, drop V's old-spacing pose."""
        if type(spacing) not in (int, float) or not WIDE_SPACING_RANGE_M[0] <= spacing <= WIDE_SPACING_RANGE_M[1]:
            raise ValueError(f"spacing_m must be {WIDE_SPACING_RANGE_M[0]}~{WIDE_SPACING_RANGE_M[1]} m")
        old_spacing, hub.spacing = hub.spacing, round(float(spacing), 3)
        hub.follow_spacing(old_spacing)
        hub.frames.clear()
        hub.owner = None
        await hub.rebuild()
        for camera in hub.calibs:
            hub.broadcast_calib(camera)
        if hub.view_calib and abs(hub.view_calib["spacing_m"] - hub.spacing) > 5e-4:
            # Solved for the old marker positions: hide it until the view phone solves again (status below).
            hub.view_calib = None
            for viewer in hub.viewers:
                viewer.send({"type": "multi3d_phone_left", "camera_id": VIEW_CAMERA, "reason": "spacing_changed"})

    def auto_spacing_target() -> float | None:
        """V's measured spacing when auto spacing should apply it, else None."""
        spacing = (hub.view_layout or {}).get("spacing_m")
        if not hub.auto_spacing or spacing is None or abs(spacing - hub.spacing) < AUTO_SPACING_MIN_M:
            return None
        return spacing if WIDE_SPACING_RANGE_M[0] <= spacing <= WIDE_SPACING_RANGE_M[1] else None

    def relay_rtc(peer: Peer, sender: str, m: dict) -> None:
        """WebRTC signalling only (offer/answer/ICE, a few kB): viewer <-> V. The video itself never passes here."""
        to, data = m.get("to"), m.get("data")
        if not isinstance(data, dict) or not isinstance(to, str):
            raise ValueError("rtc_signal needs to and data")
        if sender == VIEW_CAMERA:
            target = hub.rtc_ids.get(to)
        else:
            target = hub.phones.get(VIEW_CAMERA) if to == VIEW_CAMERA else None
        if target is None:
            peer.send({"type": "rtc_signal_failed", "to": to, "reason": "not_connected"})
            return
        target.send({"type": "rtc_signal", "from": sender, "data": data})

    async def viewer_command(peer: Peer, m: dict) -> None:
        kind = m.get("type")
        async with hub.lock:
            if kind == "wide3d_stage_config":
                await apply_spacing(m.get("spacing_m"))
            elif kind == "duo_auto_spacing" and hub.has_view:
                if type(m.get("enabled")) is not bool:
                    raise ValueError("enabled must be true or false")
                hub.auto_spacing = m["enabled"]
                target = auto_spacing_target()
                if target is not None:
                    await apply_spacing(target)
            elif kind == "multi3d_model_scene":
                zone = m.get("scene_id")
                if not isinstance(zone, str) or stage_set(hub.sections(), hub.spacing, zone) is None:
                    raise ValueError("the stage shows a stage set: unknown scene_id")
                hub.zone_id = zone
                await hub.rebuild()
            elif kind == "multi3d_model_config":
                raise ValueError("the stage layout follows the markers; move the markers or change spacing_m")
            elif isinstance(kind, str) and kind.startswith("multi3d_model_"):
                hub.model = await asyncio.to_thread(model_command, hub.model, m)
            else:
                raise ValueError(f"unsupported: {kind}")
            event = hub.model.pending_event
            hub.model.pending_event = None
            hub.send_model(hub.model.snapshot(event))
        hub.broadcast_status()

    async def phone_calibration(peer: Peer, camera: str, m: dict) -> None:
        try:
            calib = parse_calibration(camera, m)
        except ValueError as exc:
            code = str(exc) if str(exc) == "marker_id_mismatch" else "bad_message"
            peer.send({"type": "error", "code": code, "detail": str(exc)[:200]})
            return
        async with hub.lock:
            changed = hub.calibs.get(camera) != calib
            hub.calibs[camera] = calib
            ref = body_reference(calib)
            owner_redo = ref and hub.reference and hub.reference.get("camera_id") == camera and ref["id"] != hub.reference["id"]
            if ref and (hub.reference is None or owner_redo):
                # First body calibration fixes the building size; only that phone's explicit redo replaces it.
                hub.reference = {**ref, "camera_id": camera}
                await hub.rebuild()
                hub.send_model()
            elif changed and hub.model:
                hub.frames.pop(camera, None)
                if hub.owner == camera:
                    hub.owner = None
                hub.model.clear_tracking()
        hub.broadcast_calib(camera)
        hub.broadcast_status()

    async def view_calibration(peer: Peer, m: dict) -> None:
        async with hub.lock:
            try:
                hub.view_calib = parse_view_calibration(m, hub.spacing)
            except ValueError as exc:
                code = "spacing_mismatch" if str(exc) == "spacing_mismatch" else "bad_message"
                peer.send({"type": "error", "code": code, "detail": str(exc)[:200], "spacing_m": hub.spacing})
                return
            packet = hub.view_packet()
        for viewer in hub.viewers:
            viewer.send(packet)
        hub.broadcast_status()

    @router.websocket(path)
    async def stage_socket(websocket: WebSocket) -> None:
        role, camera = websocket.query_params.get("role"), websocket.query_params.get("camera")
        await websocket.accept()
        peer = Peer(websocket, f"{layout}3d:{role}:{camera}", queue_size=32).start()
        if role not in ("phone", "viewer") or (role == "phone" and camera not in phone_ids):
            peer.send({"type": "error", "code": "bad_role_or_camera"})
            await peer.close(CLOSE_BAD_REQUEST, "bad_role_or_camera")
            return
        await ensure_model()
        if role == "viewer":
            hub.viewers.add(peer)
            peer.rtc_id = uuid.uuid4().hex[:12]
            hub.rtc_ids[peer.rtc_id] = peer
            if hub.has_view:
                peer.send({"type": "rtc_hello", "id": peer.rtc_id})
            for c in phone_ids:
                if c in hub.calibs:
                    peer.send(hub.stage_calib(c))
                if c == VIEW_CAMERA and hub.view_calib:
                    peer.send(hub.view_packet())
                if c in hub.jpegs:
                    peer.send(hub.jpegs[c])
            peer.send(hub.model_packet())
        else:
            old = hub.phones.get(camera)
            hub.phones[camera] = peer
            hub.forget(camera)
            if old is not None:
                old.send({"type": "error", "code": "superseded"})
                await old.close(CLOSE_SUPERSEDED, "superseded")
            log.info("%s3d %s connected", layout, camera)
        hub.broadcast_status()

        try:
            while True:
                text = await websocket.receive_text()
                if role == "phone" and hub.phones.get(camera) is not peer:
                    continue                      # a replaced phone is ignored
                if len(text.encode("utf-8")) > MAX_MESSAGE_BYTES:
                    peer.send({"type": "error", "code": "message_too_large"})
                    continue
                try:
                    m = json.loads(text)
                    if not isinstance(m, dict):
                        raise ValueError("object expected")
                    kind = m.get("type")
                    if kind == "rtc_signal" and hub.has_view and (role == "viewer" or camera == VIEW_CAMERA):
                        relay_rtc(peer, peer.rtc_id if role == "viewer" else VIEW_CAMERA, m)
                    elif role == "viewer":
                        await viewer_command(peer, m)
                    elif camera == VIEW_CAMERA and kind not in ("wide3d_view_calib", "wide3d_view_layout", "mono3d_jpeg"):
                        peer.send({"type": "error", "code": "unsupported_message", "detail": "the view phone never judges"})
                    elif kind == "wide3d_view_calib":
                        if camera != VIEW_CAMERA:
                            raise ValueError("only the view phone sends wide3d_view_calib")
                        await view_calibration(peer, m)
                    elif kind == "wide3d_view_layout":
                        if camera != VIEW_CAMERA:
                            raise ValueError("only the view phone sends wide3d_view_layout")
                        measured = parse_view_layout(m)
                        if measured != hub.view_layout:
                            hub.view_layout = measured
                            async with hub.lock:
                                target = auto_spacing_target()
                                if target is not None:
                                    # The stage follows the markers as V measures them: no fixed spacing to type in.
                                    await apply_spacing(target)
                                    hub.send_model()
                            hub.broadcast_status()
                    elif kind == "mono3d_calib":
                        await phone_calibration(peer, camera, m)
                    elif kind == "mono3d_frame":
                        frame, state = hub.on_frame(camera, m)
                        for viewer in hub.viewers:
                            viewer.send_video(f"frame:{camera}", frame)
                        view = hub.phones.get(VIEW_CAMERA) if hub.has_view else None
                        if view is not None and frame["valid"] and camera == hub.owner and frame["joints"]:
                            # Depth only for V's outline: latest frame wins, never queued behind video.
                            view.send_video("person", {"type": "duo_person", "camera_id": camera,
                                                       "joints": frame["joints"], "source": "mono_approx"})
                        if state is not None:
                            hub.send_model(state)
                    elif kind == "mono3d_jpeg":
                        if not isinstance(m.get("data"), str) or not m["data"].startswith("data:image/jpeg;base64,"):
                            raise ValueError("jpeg data URL expected")
                        occlusion, keep, mask_t = m.get("occlusion"), False, m.get("t_ms")
                        if m.get("occlusion_keep") is True and camera == VIEW_CAMERA:
                            # A video-only frame: re-attach the last outline, so a dropped outline frame is not lost.
                            last = hub.last_outline
                            keep = last is not None
                            occlusion, mask_t = (last["occlusion"], last["t_ms"]) if last else (None, None)
                        elif camera == VIEW_CAMERA:
                            hub.last_outline = {"occlusion": occlusion, "t_ms": mask_t} if occlusion and m.get("occlusion_valid") is True else None
                        hub.jpegs[camera] = {"type": "multi3d_jpeg", "camera_id": camera, "data": m["data"],
                                             "occlusion": occlusion, "occlusion_valid": (m.get("occlusion_valid") is True) and (occlusion is not None),
                                             "occlusion_reason": m.get("occlusion_reason"), "t_ms": m.get("t_ms"),
                                             "occlusion_keep": keep, "occlusion_t_ms": mask_t}
                        for viewer in hub.viewers:
                            viewer.send_video(f"jpeg:{camera}", hub.jpegs[camera])
                    else:
                        peer.send({"type": "error", "code": "unsupported_message"})
                except (TypeError, ValueError, OverflowError) as exc:
                    peer.send({"type": "error", "code": "bad_message", "detail": str(exc)[:200]})
        except WebSocketDisconnect:
            pass
        except RuntimeError:
            if websocket.application_state is not WebSocketState.DISCONNECTED:
                raise
        finally:
            if role == "viewer":
                hub.viewers.discard(peer)
                hub.rtc_ids.pop(getattr(peer, "rtc_id", None), None)
                if hub.has_view and VIEW_CAMERA in hub.phones:
                    hub.phones[VIEW_CAMERA].send({"type": "rtc_signal", "from": peer.rtc_id, "data": {"type": "bye"}})
            elif hub.phones.get(camera) is peer:
                del hub.phones[camera]
                hub.forget(camera)
                for viewer in hub.viewers:
                    viewer.send({"type": "multi3d_phone_left", "camera_id": camera})
                log.info("%s3d %s disconnected", layout, camera)
            hub.broadcast_status()
            await peer.stop()

    return router


def wide3d_router() -> APIRouter:
    return stage_router("wide")


def duo3d_router() -> APIRouter:
    return stage_router("duo")
