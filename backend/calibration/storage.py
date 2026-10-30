"""Calibration files (`calib/local/C0.json` ...): loading, validation and frame matching.

Conventions (docs/ARCHITECTURE.md):
- World: room_z_up, metres. Camera: OpenCV (+x right, +y down, +z forward).
- x_cam = R_world_to_camera @ X_world + t_world_to_camera_m
- `source` is "measured" or "synthetic". Synthetic files never make calibration readiness true.

Computing K/dist/R/t from real captures (intrinsics.py / extrinsics.py) is a later P3 task.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

ROTATIONS = (0, 90, 180, 270)


class CalibrationError(ValueError):
    pass


@dataclass(frozen=True)
class Calibration:
    calibration_id: str
    source: str
    camera_id: str
    device_id: str | None
    width: int
    height: int
    rotation_deg: int
    K: np.ndarray
    dist: np.ndarray
    R: np.ndarray
    t: np.ndarray

    @property
    def measured(self) -> bool:
        return self.source == "measured"

    @property
    def Rt(self) -> np.ndarray:
        return np.hstack([self.R, self.t.reshape(3, 1)])

    @property
    def center(self) -> np.ndarray:
        return -self.R.T @ self.t

    def normalize(self, uv_px: np.ndarray, distorted: bool) -> np.ndarray:
        """Pixel coords (N,2) -> normalized image coords (K^-1 applied, distortion removed once)."""
        pts = np.asarray(uv_px, dtype=np.float64).reshape(-1, 1, 2)
        if distorted:
            return cv2.undistortPoints(pts, self.K, self.dist).reshape(-1, 2)
        return cv2.undistortPoints(pts, self.K, None).reshape(-1, 2)

    def project(self, X: np.ndarray) -> np.ndarray:
        """World points (N,3) -> ideal (undistorted) pixels (N,2)."""
        X = np.asarray(X, dtype=np.float64).reshape(-1, 3)
        uvw = (X @ self.R.T + self.t) @ self.K.T
        return uvw[:, :2] / uvw[:, 2:3]

    def depth(self, X: np.ndarray) -> np.ndarray:
        X = np.asarray(X, dtype=np.float64).reshape(-1, 3)
        return (X @ self.R.T + self.t)[:, 2]

    def mismatch(self, *, device_id: str, calibration_id: str | None, width: int, height: int,
                 rotation_deg: int) -> str | None:
        """Why a frame cannot use this calibration, or None if it matches."""
        if calibration_id != self.calibration_id:
            return "calibration_id"
        if self.device_id is not None and device_id != self.device_id:
            return "device_id"
        if (width, height) != (self.width, self.height):
            return "image_size"
        if rotation_deg != self.rotation_deg:
            return "rotation"
        return None

    def public(self) -> dict:
        """What consumers (C0 projection on the monitor) need."""
        return {
            "calibration_id": self.calibration_id, "source": self.source, "camera_id": self.camera_id,
            "image": {"width": self.width, "height": self.height, "rotation_deg": self.rotation_deg},
            "K": self.K.tolist(), "dist": self.dist.tolist(),
            "R_world_to_camera": self.R.tolist(), "t_world_to_camera_m": self.t.tolist(),
            "world": {"frame": "room_z_up", "units": "m"},
        }


def _matrix(value, shape, name) -> np.ndarray:
    try:
        arr = np.asarray(value, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise CalibrationError(f"{name}: not numeric") from exc
    if arr.shape != shape:
        raise CalibrationError(f"{name}: expected shape {shape}, got {arr.shape}")
    if not np.all(np.isfinite(arr)):
        raise CalibrationError(f"{name}: contains NaN or infinity")
    return arr


def parse_calibration(data: dict, expected_camera_id: str | None = None) -> Calibration:
    if data.get("schema_version") != "0.1":
        raise CalibrationError("schema_version must be '0.1'")
    source = data.get("source")
    if source not in ("measured", "synthetic"):
        raise CalibrationError("source must be 'measured' or 'synthetic'")
    cid = data.get("calibration_id")
    if not isinstance(cid, str) or not cid:
        raise CalibrationError("calibration_id is required")
    camera_id = data.get("camera_id")
    if expected_camera_id is not None and camera_id != expected_camera_id:
        raise CalibrationError(f"camera_id {camera_id!r} does not match slot {expected_camera_id!r}")
    world = data.get("world") or {}
    if world.get("frame") != "room_z_up" or world.get("units") != "m":
        raise CalibrationError("world must be {frame: room_z_up, units: m}")

    image = data.get("image") or {}
    width, height, rot = image.get("width"), image.get("height"), image.get("rotation_deg", 0)
    if not (isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0):
        raise CalibrationError("image.width/height must be positive integers")
    if rot not in ROTATIONS:
        raise CalibrationError("image.rotation_deg must be one of 0/90/180/270")

    K = _matrix(data.get("K"), (3, 3), "K")
    if K[0, 0] <= 0 or K[1, 1] <= 0 or not np.allclose(K[2], [0, 0, 1]) or K[1, 0] != 0 or K[2, 0] != 0:
        raise CalibrationError("K must be an upper-triangular camera matrix with positive focal lengths")
    dist = np.asarray(data.get("dist", []), dtype=np.float64).ravel()
    if dist.size not in (4, 5, 8) or not np.all(np.isfinite(dist)):
        raise CalibrationError("dist must have 4, 5 or 8 finite coefficients")
    R = _matrix(data.get("R_world_to_camera"), (3, 3), "R_world_to_camera")
    if not np.allclose(R.T @ R, np.eye(3), atol=1e-4) or not math.isclose(np.linalg.det(R), 1.0, abs_tol=1e-4):
        raise CalibrationError("R_world_to_camera must be a proper rotation matrix")
    t = _matrix(data.get("t_world_to_camera_m"), (3,), "t_world_to_camera_m")

    return Calibration(cid, source, str(camera_id), data.get("device_id"), width, height, rot, K, dist, R, t)


def load_calibration(path: Path, expected_camera_id: str) -> Calibration:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CalibrationError(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CalibrationError(f"invalid JSON: {exc}") from exc
    return parse_calibration(data, expected_camera_id)


def calibration_dict(c: Calibration, **extra) -> dict:
    """Serialize for writing a calibration file (used by tools)."""
    return {
        "schema_version": "0.1", "calibration_id": c.calibration_id, "source": c.source,
        "camera_id": c.camera_id, "device_id": c.device_id,
        "image": {"width": c.width, "height": c.height, "rotation_deg": c.rotation_deg, "crop": None},
        "K": c.K.tolist(), "dist": c.dist.tolist(),
        "R_world_to_camera": c.R.tolist(), "t_world_to_camera_m": c.t.tolist(),
        "world": {"frame": "room_z_up", "units": "m"}, **extra,
    }
