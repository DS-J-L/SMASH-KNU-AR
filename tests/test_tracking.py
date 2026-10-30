"""Pipeline tests on a synthetic rig (numerical checks only, not live accuracy)."""

import numpy as np
import pytest

from backend.ingest.pose_receiver import accept_pose
from backend.ingest.registry import Registry
from backend.ingest.schemas import Register, parse_pose_2d
from backend.runtime import Runtime
from backend.settings import load_settings
from backend.tracking.pipeline import CalibrationEntry, TrackingPipeline
from helpers import pose_2d, project_wrists
from synthetic import synthetic_rig, wrists_at

NOW = 1_000_000.0
OFFSETS = {"C0": 1834.0, "C1": -5212.0, "C2": 377.0}   # device clock - server clock


def setup(allow_synthetic=True):
    settings = load_settings(allow_synthetic_calibration=allow_synthetic)
    rig = synthetic_rig()
    calibs = {cid: CalibrationEntry("synthetic", cal) for cid, cal in rig.items()}
    reg = Registry(settings)
    streams = {}
    for cid, cal in rig.items():
        s, _ = reg.register(Register(cid, cal.device_id, True), None, NOW)
        for i in range(3):   # exact, symmetric samples -> offset known
            s.clock.add("clk", NOW + i, NOW + i + 5 + OFFSETS[cid], NOW + i + 10)
        streams[cid] = s
    return settings, rig, calibs, reg, streams


def feed(settings, rig, streams, t_server, frame_id, *, positions=None, override=None, cams=None, **kw):
    positions = positions or wrists_at(t_server)
    for cid in cams or rig:
        s, cal = streams[cid], rig[cid]
        wr = project_wrists(cal, positions)
        if override and cid in override:
            override[cid](wr)
        stream = {"camera_id": cid, "device_id": s.device_id, "stream_id": s.stream_id}
        msg = pose_2d(stream, frame_id, wrists=wr, capture_time_ms=t_server + OFFSETS[cid] + 5,
                      calibration_id=cal.calibration_id, **kw)
        accept_pose(s, parse_pose_2d(msg, settings.camera_ids), t_server + 20, settings)


def run(settings, reg, calibs, now):
    msg, states = TrackingPipeline(settings).step(reg, calibs, now, force=True)
    assert msg is not None
    return msg, states


def test_three_views_recover_wrists_exactly():
    settings, rig, calibs, reg, streams = setup()
    feed(settings, rig, streams, NOW, 0)
    msg, _ = run(settings, reg, calibs, NOW + 30)
    truth = wrists_at(NOW)
    for name in ("left_wrist", "right_wrist"):
        j = msg["joints"][name]
        assert j["valid"] and j["camera_ids"] == ["C0", "C1", "C2"] and j["reason"] is None
        assert np.linalg.norm(np.array(j["position_m"]) - truth[name]) < 1e-3
    assert msg["sample_only"] is True and msg["coordinate_frame"] == "room_z_up" and msg["skew_ms"] == 0.0


def test_single_view_is_null_with_reason():
    settings, rig, calibs, reg, streams = setup()
    hide = lambda w: w["right_wrist"].update(visibility=0.1)  # noqa: E731
    feed(settings, rig, streams, NOW, 0, override={"C1": hide, "C2": hide})
    msg, _ = run(settings, reg, calibs, NOW + 30)
    j = msg["joints"]["right_wrist"]
    assert j["position_m"] is None and j["valid"] is False
    assert j["reason"] == "low_visibility" and j["excluded"] == {"C1": "low_visibility", "C2": "low_visibility"}
    assert msg["joints"]["left_wrist"]["valid"]


def test_one_bad_detection_is_dropped():
    settings, rig, calibs, reg, streams = setup()
    shift = lambda w: w["left_wrist"].update(u_px=w["left_wrist"]["u_px"] + 120)  # noqa: E731
    feed(settings, rig, streams, NOW, 0, override={"C1": shift})
    msg, _ = run(settings, reg, calibs, NOW + 30)
    j = msg["joints"]["left_wrist"]
    assert j["valid"] and j["camera_ids"] == ["C0", "C2"] and j["excluded"]["C1"] == "reprojection_error"


def test_synthetic_calibration_is_not_used_unless_allowed():
    settings, rig, calibs, reg, streams = setup(allow_synthetic=False)
    feed(settings, rig, streams, NOW, 0)
    msg, states = run(settings, reg, calibs, NOW + 30)
    assert all(st.reason == "not_calibrated" for st in states.values())
    assert msg["joints"]["left_wrist"]["reason"] == "not_calibrated"


def test_calibration_mismatch_blocks_camera():
    settings, rig, calibs, reg, streams = setup()
    feed(settings, rig, streams, NOW, 0, cams=["C0", "C1"])
    feed(settings, rig, streams, NOW, 0, cams=["C2"], width=640, height=480)
    msg, states = run(settings, reg, calibs, NOW + 30)
    assert states["C2"].reason == "calibration_mismatch" and states["C2"].mismatch == "calibration_id" or \
        states["C2"].mismatch == "image_size"
    assert msg["joints"]["left_wrist"]["camera_ids"] == ["C0", "C1"]


def test_presentation_time_is_not_treated_as_capture_time():
    settings, rig, calibs, reg, streams = setup()
    feed(settings, rig, streams, NOW, 0, source="presentation_time")
    msg, states = run(settings, reg, calibs, NOW + 30)
    assert all(st.reason == "clock_unknown" for st in states.values())
    assert msg["aligned_capture_at_server_ms"] is None


def test_lagging_camera_is_excluded_as_time_skew():
    settings, rig, calibs, reg, streams = setup()
    feed(settings, rig, streams, NOW, 0, cams=["C0", "C1"])
    feed(settings, rig, streams, NOW - 150, 0, cams=["C2"])     # lags by more than max_wait_ms
    msg, _ = run(settings, reg, calibs, NOW + 30)
    j = msg["joints"]["right_wrist"]
    assert j["camera_ids"] == ["C0", "C1"] and j["excluded"]["C2"] == "time_skew"


def test_stale_input_stops_tracking():
    settings, rig, calibs, reg, streams = setup()
    feed(settings, rig, streams, NOW, 0)
    msg, states = TrackingPipeline(settings).step(reg, calibs, NOW + 2000, force=True)
    assert all(st.reason == "stale" for st in states.values())
    assert msg["joints"]["left_wrist"]["reason"] == "stale" and not msg["joints"]["left_wrist"]["valid"]


def test_synthetic_tracking_never_makes_readiness_true():
    settings, rig, calibs, reg, streams = setup()
    rt = Runtime(settings)
    rt.registry, rt.calibrations = reg, calibs
    feed(settings, rig, streams, NOW, 0)
    msg = rt.tracking_step(NOW + 30)
    assert msg["joints"]["left_wrist"]["valid"] and msg["sample_only"]
    status = rt.status(NOW + 30)
    assert status["readiness"]["calibration"] is False and status["readiness"]["tracking"] is False
    assert status["game_ready"] is False
    assert all(c["calibration"]["status"] == "synthetic" for c in status["cameras"])


@pytest.mark.parametrize("mode", ["nearest", "interpolate"])
def test_moving_wrist_with_unsynchronized_shutters(mode):
    """Cameras capture 11 ms apart; interpolation should cut the motion error."""
    settings, rig, calibs, reg, streams = setup()
    settings = load_settings(allow_synthetic_calibration=True,
                             tracking=settings.tracking.__class__(**{**settings.tracking.__dict__, "align_mode": mode}))
    pipe = TrackingPipeline(settings)
    errors = []
    phase = {"C0": 0.0, "C1": 11.0, "C2": 22.0}
    for k in range(12):
        for cid in rig:
            t = NOW + k * 33.3 + phase[cid]
            feed(settings, rig, streams, t, k, cams=[cid])
        msg, _ = pipe.step(reg, calibs, NOW + k * 33.3 + 60)
        if msg and msg["joints"]["right_wrist"]["valid"]:
            truth = wrists_at(msg["aligned_capture_at_server_ms"])["right_wrist"]
            errors.append(np.linalg.norm(np.array(msg["joints"]["right_wrist"]["position_m"]) - truth))
    assert errors
    limit = 0.02 if mode == "interpolate" else 0.05
    assert max(errors) < limit
