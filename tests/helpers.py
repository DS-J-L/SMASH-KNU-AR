"""Builders for contract messages used across tests (all synthetic)."""

import numpy as np


def register(camera_id="C0", device_id="dev-a", sample_only=True):
    return {"schema_version": "0.1", "type": "register", "camera_id": camera_id,
            "device_id": device_id, "sample_only": sample_only}


def pose_2d(stream, frame_id, *, wrists=None, capture_time_ms=1000.0, clock_id="clk",
            source="capture_metadata", width=1280, height=720, calibration_id=None, sample_only=True, **over):
    msg = {
        "schema_version": "0.1", "type": "pose_2d", "sample_only": sample_only,
        "camera_id": stream["camera_id"], "device_id": stream["device_id"], "stream_id": stream["stream_id"],
        "frame_id": frame_id, "calibration_id": calibration_id,
        "image": {"width": width, "height": height, "rotation_deg": 0, "mirrored": False,
                  "coordinate_space": "raw_distorted_pixels"},
        "timing": {"capture_time_ms": capture_time_ms, "clock_id": clock_id, "timestamp_source": source},
        "joints": wrists if wrists is not None else {
            "left_wrist": {"u_px": 600.0, "v_px": 300.0, "visibility": 0.9},
            "right_wrist": None,
        },
    }
    msg.update(over)
    return msg


def project_wrists(cal, positions, visibility=0.95):
    out = {}
    for name, X in positions.items():
        u, v = cal.project(np.asarray(X))[0]
        out[name] = {"u_px": float(u), "v_px": float(v), "visibility": visibility}
    return out


def recv_type(ws, kind, limit=50):
    """Read messages until one of the given type arrives (skipping clock_ping etc.)."""
    for _ in range(limit):
        m = ws.receive_json()
        if m.get("type") == kind:
            return m
    raise AssertionError(f"no {kind} message")
