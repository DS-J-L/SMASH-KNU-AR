"""Synthetic camera rig and wrist motion for tests and tools/synthetic_cameras.py.

Everything produced here is synthetic: calibration files carry source="synthetic" and the
messages built from them carry sample_only=true. Do not report results as live measurements.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.calibration.storage import Calibration, calibration_dict  # noqa: E402

CAMERA_IDS = ("C0", "C1", "C2")
SYNTH_DIR = ROOT / "data/local/synthetic"


def look_at(center, target, up=(0.0, 0.0, 1.0)) -> tuple[np.ndarray, np.ndarray]:
    """World->camera (R, t) for a camera at `center` looking at `target` (OpenCV axes)."""
    c = np.asarray(center, dtype=np.float64)
    f = np.asarray(target, dtype=np.float64) - c
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    R = np.vstack([r, d, f])
    return R, -R @ c


def synthetic_rig(width=1280, height=720, focal=1000.0, radius=2.5, cam_z=1.2, target_z=1.0,
                  device_prefix="synthetic-device") -> dict[str, Calibration]:
    """Three cameras around the origin (C0 in front at -Y), 120 degrees apart."""
    K = np.array([[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1]], dtype=np.float64)
    rig = {}
    for cid, deg in zip(CAMERA_IDS, (270.0, 30.0, 150.0)):
        a = np.deg2rad(deg)
        R, t = look_at((radius * np.cos(a), radius * np.sin(a), cam_z), (0.0, 0.0, target_z))
        rig[cid] = Calibration(f"synthetic-{cid}", "synthetic", cid, f"{device_prefix}-{cid}",
                               width, height, 0, K.copy(), np.zeros(5), R, t)
    return rig


def wrists_at(t_ms: float) -> dict[str, np.ndarray]:
    """Ground-truth wrist positions (m, room_z_up). Person at the origin facing C0 (-Y).
    Right wrist: 1 Hz forward punch. Left wrist: 0.7 Hz sideways swing."""
    s = t_ms / 1000.0
    pelvis = np.array([0.05 * np.sin(2 * np.pi * 0.3 * s), 0.03 * np.sin(2 * np.pi * 0.2 * s), 0.95])
    right, fwd, up = np.array([-1.0, 0, 0]), np.array([0, -1.0, 0]), np.array([0, 0, 1.0])
    r_sh = pelvis + 0.50 * up + 0.19 * right
    l_sh = pelvis + 0.50 * up - 0.19 * right
    p = 0.5 - 0.5 * np.cos(2 * np.pi * 1.0 * s)
    a = np.pi * (0.5 + 0.45 * np.sin(2 * np.pi * 0.7 * s))
    return {
        "right_wrist": r_sh + (0.15 + 0.45 * p) * fwd - (0.25 - 0.25 * p) * up,
        "left_wrist": l_sh + 0.55 * (np.cos(a) * -right + np.sin(a) * fwd) + 0.05 * up,
    }


def write_synthetic_config(rig: dict[str, Calibration] | None = None, out: Path = SYNTH_DIR) -> Path:
    """Write calibration files + a cameras config under data/local/synthetic (git-ignored).
    Start the server with SMASH_CAMERAS_CONFIG=<returned path> SMASH_ALLOW_SYNTHETIC_CALIBRATION=1."""
    rig = rig or synthetic_rig()
    out.mkdir(parents=True, exist_ok=True)
    cams = []
    for cid, cal in rig.items():
        path = out / f"{cid}.json"
        path.write_text(json.dumps(calibration_dict(cal, note="synthetic rig for software tests only"),
                                   indent=2), encoding="utf-8")
        cams.append({"camera_id": cid, "role": "synthetic", "device_id": cal.device_id,
                     "input_source": "synthetic", "image_settings": None, "calibration_file": str(path)})
    cfg = out / "cameras.json"
    cfg.write_text(json.dumps({"schema_version": "0.1", "sample_only": True, "cameras": cams}, indent=2),
                   encoding="utf-8")
    return cfg


if __name__ == "__main__":
    print(write_synthetic_config())
