"""Validation of phone -> server messages (docs/DATA_CONTRACT.md).

Each validator returns a normalized object or raises MessageError(code, detail).
Unknown extra fields are ignored so the contract can grow without breaking old servers.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

from ..settings import TIMESTAMP_SOURCES

SCHEMA_VERSION = "0.1"
COORDINATE_SPACES = ("raw_distorted_pixels", "undistorted_pixels")
ROTATIONS = (0, 90, 180, 270)
WRISTS = ("left_wrist", "right_wrist")
MAX_ID_LEN = 128
MAX_IMAGE_SIDE = 8192


class MessageError(ValueError):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class Register:
    camera_id: str
    device_id: str
    sample_only: bool
    stream_id: str | None = None


@dataclass(frozen=True)
class ClockPong:
    ping_id: int
    server_send_ms: float
    device_time_ms: float
    clock_id: str


@dataclass(frozen=True)
class Wrist:
    u_px: float
    v_px: float
    visibility: float
    in_frame: bool


@dataclass(frozen=True)
class Pose2D:
    sample_only: bool
    camera_id: str
    device_id: str
    stream_id: str
    frame_id: int
    calibration_id: str | None
    width: int
    height: int
    rotation_deg: int
    coordinate_space: str
    capture_time_ms: float | None
    clock_id: str
    timestamp_source: str
    wrists: dict  # name -> Wrist | None


def parse_json(text: str, max_bytes: int) -> dict:
    if len(text.encode("utf-8")) > max_bytes:
        raise MessageError("message_too_large", f"limit {max_bytes} bytes")
    try:
        value = json.loads(text, parse_constant=_reject_constant)
    except MessageError:
        raise
    except json.JSONDecodeError as exc:
        raise MessageError("invalid_json", str(exc)) from exc
    if not isinstance(value, dict):
        raise MessageError("unsupported_message", "message must be a JSON object")
    return value


def _reject_constant(name: str):
    raise MessageError("non_finite_number", f"{name} is not allowed")


def _str(msg: dict, key: str, *, nullable: bool = False) -> str | None:
    value = msg.get(key)
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not value or len(value) > MAX_ID_LEN:
        raise MessageError("invalid_field", f"{key} must be a non-empty string (<= {MAX_ID_LEN})")
    return value


def _bool(msg: dict, key: str) -> bool:
    value = msg.get(key)
    if not isinstance(value, bool):
        raise MessageError("invalid_field", f"{key} must be true or false")
    return value


def _num(value, key: str, *, nullable: bool = False) -> float | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MessageError("invalid_field", f"{key} must be a number")
    if not math.isfinite(value):
        raise MessageError("non_finite_number", key)
    return float(value)


def _int(value, key: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise MessageError("invalid_field", f"{key} must be an integer in [{lo}, {hi}]")
    return value


def _check_header(msg: dict, expected_type: str) -> None:
    if msg.get("schema_version") != SCHEMA_VERSION:
        raise MessageError("unsupported_schema_version", f"expected {SCHEMA_VERSION}")
    if msg.get("type") != expected_type:
        raise MessageError("unsupported_message", f"expected type {expected_type}")


def _camera_id(msg: dict, camera_ids: tuple[str, ...]) -> str:
    cid = msg.get("camera_id")
    if cid not in camera_ids:
        raise MessageError("invalid_camera_id", f"camera_id must be one of {list(camera_ids)}")
    return cid


def parse_register(msg: dict, camera_ids: tuple[str, ...]) -> Register:
    _check_header(msg, "register")
    return Register(_camera_id(msg, camera_ids), _str(msg, "device_id"), _bool(msg, "sample_only"))


def parse_clock_pong(msg: dict) -> ClockPong:
    _check_header(msg, "clock_pong")
    return ClockPong(
        ping_id=_int(msg.get("ping_id"), "ping_id", 0, 2**53),
        server_send_ms=_num(msg.get("server_send_ms"), "server_send_ms"),
        device_time_ms=_num(msg.get("device_time_ms"), "device_time_ms"),
        clock_id=_str(msg, "clock_id"),
    )


def parse_pose_2d(msg: dict, camera_ids: tuple[str, ...]) -> Pose2D:
    _check_header(msg, "pose_2d")
    image = msg.get("image")
    timing = msg.get("timing")
    joints = msg.get("joints")
    if not isinstance(image, dict) or not isinstance(timing, dict) or not isinstance(joints, dict):
        raise MessageError("invalid_field", "image, timing and joints must be objects")

    width = _int(image.get("width"), "image.width", 1, MAX_IMAGE_SIDE)
    height = _int(image.get("height"), "image.height", 1, MAX_IMAGE_SIDE)
    rotation = image.get("rotation_deg")
    if rotation not in ROTATIONS or isinstance(rotation, bool):
        raise MessageError("invalid_field", "image.rotation_deg must be 0/90/180/270")
    if image.get("mirrored") is not False:
        raise MessageError("mirrored_not_supported", "send coordinates before any mirror flip")
    space = image.get("coordinate_space")
    if space not in COORDINATE_SPACES:
        raise MessageError("invalid_field", f"image.coordinate_space must be one of {list(COORDINATE_SPACES)}")

    capture = _num(timing.get("capture_time_ms"), "timing.capture_time_ms", nullable=True)
    source = timing.get("timestamp_source")
    if source not in TIMESTAMP_SOURCES:
        raise MessageError("invalid_field", f"timing.timestamp_source must be one of {list(TIMESTAMP_SOURCES)}")
    if capture is None:
        source = "unknown"

    wrists = {}
    for name in WRISTS:
        if name not in joints:
            raise MessageError("invalid_field", f"joints.{name} is required (null if not detected)")
        j = joints[name]
        if j is None:
            wrists[name] = None
            continue
        if not isinstance(j, dict):
            raise MessageError("invalid_field", f"joints.{name} must be an object or null")
        u = _num(j.get("u_px"), f"joints.{name}.u_px")
        v = _num(j.get("v_px"), f"joints.{name}.v_px")
        vis = _num(j.get("visibility"), f"joints.{name}.visibility")
        if not 0.0 <= vis <= 1.0:
            raise MessageError("invalid_visibility", f"joints.{name}.visibility must be in [0, 1]")
        wrists[name] = Wrist(u, v, vis, 0.0 <= u <= width and 0.0 <= v <= height)

    return Pose2D(
        sample_only=_bool(msg, "sample_only"),
        camera_id=_camera_id(msg, camera_ids),
        device_id=_str(msg, "device_id"),
        stream_id=_str(msg, "stream_id"),
        frame_id=_int(msg.get("frame_id"), "frame_id", 0, 2**53),
        calibration_id=_str(msg, "calibration_id", nullable=True),
        width=width, height=height, rotation_deg=rotation, coordinate_space=space,
        capture_time_ms=capture, clock_id=_str(timing, "clock_id"), timestamp_source=source, wrists=wrists,
    )
