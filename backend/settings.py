"""Runtime settings: environment variables plus the shared project/camera config files.

`config/*.local.json` is used when present; otherwise the `*.example.json` proposal values are
loaded and reported as `config_source="example"` so nobody mistakes them for agreed values.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Used only when the shared config leaves a value null (e.g. max_frame_age_ms before the pilot).
FALLBACKS = {"max_frame_age_ms": 250.0, "max_wait_ms": 100.0}
TIMESTAMP_SOURCES = ("capture_metadata", "rvfc_capture_time", "presentation_time", "inference_time", "unknown")


@dataclass(frozen=True)
class CameraSlot:
    camera_id: str
    role: str
    device_id: str | None
    calibration_file: Path | None


@dataclass(frozen=True)
class TrackingConfig:
    min_views: int
    visibility_min: float
    max_skew_ms: float
    max_reprojection_error_px: float
    max_frame_age_ms: float
    max_wait_ms: float
    align_mode: str
    allowed_timestamp_sources: tuple[str, ...]


@dataclass(frozen=True)
class Settings:
    access_key: str | None
    allow_synthetic_calibration: bool
    config_source: str
    cameras: tuple[CameraSlot, ...]
    tracking: TrackingConfig
    clock_ping_interval_s: float = 1.0
    clock_fast_pings: int = 10
    heartbeat_timeout_s: float = 5.0
    max_message_bytes: int = 16_384
    fallbacks_used: tuple[str, ...] = field(default_factory=tuple)

    @property
    def camera_ids(self) -> tuple[str, ...]:
        return tuple(c.camera_id for c in self.cameras)

    def slot(self, camera_id: str) -> CameraSlot | None:
        return next((c for c in self.cameras if c.camera_id == camera_id), None)


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _pick(env_name: str, local: Path, example: Path) -> tuple[Path, str]:
    if os.environ.get(env_name):
        return Path(os.environ[env_name]), "env"
    return (local, "local") if local.exists() else (example, "example")


def _resolve(path_value: str | None, base: Path) -> Path | None:
    if not path_value:
        return None
    p = Path(path_value)
    return p if p.is_absolute() else (base / p)


def load_settings(**overrides) -> Settings:
    project_path, project_src = _pick("SMASH_PROJECT_CONFIG", ROOT / "config/project.local.json",
                                      ROOT / "config/project.example.json")
    cameras_path, cameras_src = _pick("SMASH_CAMERAS_CONFIG", ROOT / "config/cameras.local.json",
                                      ROOT / "config/cameras.example.json")
    project = _read(project_path)
    cams = _read(cameras_path)
    t = project.get("tracking", {})

    used = []

    def num(key: str) -> float:
        value = t.get(key)
        if value is None:
            used.append(key)
            return FALLBACKS[key]
        return float(value)

    sources = tuple(t.get("allowed_timestamp_sources") or ("capture_metadata",))
    bad = [s for s in sources if s not in TIMESTAMP_SOURCES or s == "unknown"]
    if bad:
        raise ValueError(f"allowed_timestamp_sources has unsupported values: {bad}")

    tracking = TrackingConfig(
        min_views=max(2, int(t.get("min_views", 2))),
        visibility_min=float(t["visibility_min"]),
        max_skew_ms=float(t["max_skew_ms"]),
        max_reprojection_error_px=float(t["max_reprojection_error_px"]),
        max_frame_age_ms=num("max_frame_age_ms"),
        max_wait_ms=num("max_wait_ms"),
        align_mode=str(t.get("align_mode", "nearest")),
        allowed_timestamp_sources=sources,
    )
    if tracking.align_mode not in ("nearest", "interpolate"):
        raise ValueError("tracking.align_mode must be 'nearest' or 'interpolate'")

    base = ROOT  # calibration_file paths are relative to the repository root
    slots = tuple(
        CameraSlot(
            camera_id=str(c["camera_id"]),
            role=str(c.get("role", "")),
            device_id=c.get("device_id"),
            calibration_file=_resolve(c.get("calibration_file"), base),
        )
        for c in cams["cameras"]
    )
    if len({s.camera_id for s in slots}) != len(slots):
        raise ValueError("camera_id values in the cameras config must be unique")

    values = dict(
        access_key=os.environ.get("SMASH_ACCESS_KEY") or None,
        allow_synthetic_calibration=os.environ.get("SMASH_ALLOW_SYNTHETIC_CALIBRATION") == "1",
        config_source="local" if {project_src, cameras_src} <= {"local", "env"} else "example",
        cameras=slots,
        tracking=tracking,
        fallbacks_used=tuple(used),
    )
    values.update(overrides)
    return Settings(**values)
