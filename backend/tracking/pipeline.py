"""Received 2D wrists -> camera eligibility -> time alignment -> 3D wrists -> pose_3d message.

Camera-level exclusion reasons: no_input, stale, not_calibrated, calibration_mismatch,
clock_unknown, time_skew. Joint-level: not_detected, out_of_frame, low_visibility.
Triangulation-level: insufficient_views, reprojection_error, behind_camera.
A joint's `reason` is the single shared exclusion reason when all cameras failed the same way,
otherwise insufficient_views; `excluded` lists the reason per camera for diagnosis.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..calibration.storage import Calibration
from ..ingest.registry import Registry, Stream
from ..ingest.schemas import WRISTS
from ..settings import Settings
from ..sync.frame_aligner import FrameAligner, Selection
from .quality import estimate_joint


@dataclass
class CalibrationEntry:
    status: str                 # missing / invalid / synthetic / measured
    calibration: Calibration | None = None
    error: str | None = None

    def usable(self, allow_synthetic: bool) -> bool:
        return self.calibration is not None and (self.status == "measured" or
                                                 (self.status == "synthetic" and allow_synthetic))


@dataclass
class CameraState:
    camera_id: str
    stream: Stream | None
    reason: str | None          # None = eligible for alignment
    mismatch: str | None = None


def camera_states(settings: Settings, registry: Registry, calibs: dict[str, CalibrationEntry],
                  now_ms: float) -> dict[str, CameraState]:
    states = {}
    max_age = settings.tracking.max_frame_age_ms
    for cid in settings.camera_ids:
        stream = registry.current(cid)
        latest = stream.latest if stream else None
        entry = calibs.get(cid) or CalibrationEntry("missing")
        if latest is None:
            states[cid] = CameraState(cid, stream, "no_input")
            continue
        ref = latest.aligned_capture_at_server_ms or latest.received_at_server_ms
        if now_ms - ref > max_age or now_ms - latest.received_at_server_ms > max_age:
            states[cid] = CameraState(cid, stream, "stale")
            continue
        if not entry.usable(settings.allow_synthetic_calibration):
            states[cid] = CameraState(cid, stream, "not_calibrated")
            continue
        p = latest.pose
        mismatch = entry.calibration.mismatch(device_id=p.device_id, calibration_id=p.calibration_id,
                                              width=p.width, height=p.height, rotation_deg=p.rotation_deg)
        if mismatch:
            states[cid] = CameraState(cid, stream, "calibration_mismatch", mismatch)
            continue
        if latest.aligned_capture_at_server_ms is None:
            states[cid] = CameraState(cid, stream, "clock_unknown")
            continue
        states[cid] = CameraState(cid, stream, None)
    return states


def _joint_reason(excluded: dict[str, str], fallback: str) -> str:
    reasons = set(excluded.values())
    return reasons.pop() if len(reasons) == 1 and fallback == "insufficient_views" else fallback


def build_pose_3d(settings: Settings, states: dict[str, CameraState], calibs: dict[str, CalibrationEntry],
                  selection: Selection | None) -> dict:
    t = settings.tracking
    base_excluded = {cid: st.reason for cid, st in states.items() if st.reason}
    if selection is not None:
        base_excluded.update(selection.excluded)
    else:  # forced heartbeat frame: eligible cameras produced no newer aligned frame
        base_excluded.update({cid: "stale" for cid, st in states.items() if st.reason is None})
    used_frames = selection.frames if selection else {}
    usable = {cid: calibs[cid].calibration for cid in used_frames}

    joints = {}
    for name in WRISTS:
        excluded = dict(base_excluded)
        obs: dict[str, np.ndarray] = {}
        for cid, frame in used_frames.items():
            w = frame.pose.wrists.get(name)
            if w is None:
                excluded[cid] = "not_detected"
            elif not w.in_frame:
                excluded[cid] = "out_of_frame"
            elif w.visibility < t.visibility_min:
                excluded[cid] = "low_visibility"
            else:
                distorted = frame.pose.coordinate_space == "raw_distorted_pixels"
                obs[cid] = usable[cid].normalize(np.array([[w.u_px, w.v_px]]), distorted)[0]

        est = estimate_joint(obs, usable, t.min_views, t.max_reprojection_error_px)
        valid = est.position_m is not None
        if valid:
            excluded.update({cid: "reprojection_error" for cid in obs if cid not in est.camera_ids})
        reason = None if valid else (_joint_reason(excluded, est.reason) if len(obs) < t.min_views else est.reason)
        joints[name] = {
            "position_m": [round(float(v), 4) for v in est.position_m] if valid else None,
            "valid": valid,
            "camera_ids": list(est.camera_ids) if valid else [],
            "reprojection_error_px": round(est.reprojection_error_px, 2) if est.reprojection_error_px is not None else None,
            "reason": reason,
            "excluded": dict(sorted(excluded.items())),
        }

    streams = [st.stream for st in states.values() if st.stream is not None]
    sample = any(f.pose.sample_only for f in used_frames.values()) or any(s.sample_only for s in streams)
    return {
        "schema_version": "0.1",
        "type": "pose_3d",
        "sample_only": sample,
        "coordinate_frame": "room_z_up",
        "units": "m",
        "aligned_capture_at_server_ms": round(selection.t_ms, 1) if selection else None,
        "skew_ms": round(selection.skew_ms, 1) if selection and selection.skew_ms is not None else None,
        "joints": joints,
    }


class TrackingPipeline:
    def __init__(self, settings: Settings):
        self.settings = settings
        t = settings.tracking
        self.aligner = FrameAligner(t.max_skew_ms, t.align_mode, t.max_wait_ms)

    def step(self, registry: Registry, calibs: dict[str, CalibrationEntry], now_ms: float,
             force: bool = False) -> tuple[dict | None, dict[str, CameraState]]:
        """Returns (pose_3d or None, camera states). force=True emits an invalid/heartbeat frame
        even when no new aligned time exists, so consumers see that tracking stopped."""
        states = camera_states(self.settings, registry, calibs, now_ms)
        eligible = {cid: st.stream for cid, st in states.items() if st.reason is None}
        selection = self.aligner.select(eligible) if eligible else None
        if selection is None and not force:
            return None, states
        return build_pose_3d(self.settings, states, calibs, selection), states
