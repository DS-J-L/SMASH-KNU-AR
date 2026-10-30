"""Camera registration: logical slot (C0/C1/C2) <-> phone (device_id) <-> stream.

Rules (docs/DATA_CONTRACT.md):
- The camera_id comes from the phone's register message, never from connection order.
- A slot bound to a device_id in the cameras config only accepts that device.
- While a slot has a live stream from another device, a second registration is rejected
  (camera_id_in_use). The same device registering again (page reload) supersedes its old
  stream; every registration gets a new stream_id so frames and clock state never mix.
- A stream that sends nothing for heartbeat_timeout is treated as disconnected.
"""

from __future__ import annotations

import uuid
from collections import Counter, deque
from dataclasses import dataclass, field

from ..connections import Peer
from ..settings import Settings
from ..sync.clock import DeviceClock
from .schemas import MessageError, Pose2D, Register


@dataclass
class ReceivedFrame:
    pose: Pose2D
    received_at_server_ms: float
    aligned_capture_at_server_ms: float | None
    clock_uncertainty_ms: float | None


@dataclass
class Stream:
    camera_id: str
    device_id: str
    sample_only: bool
    peer: Peer | None
    registered_at_ms: float
    stream_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    clock: DeviceClock = field(default_factory=DeviceClock)
    last_message_at_ms: float = 0.0
    last_frame_id: int | None = None
    frames: deque = field(default_factory=lambda: deque(maxlen=90))
    arrivals: deque = field(default_factory=lambda: deque(maxlen=240))
    rejected: Counter = field(default_factory=Counter)
    pings: dict = field(default_factory=dict)  # ping_id -> server_send_ms (outstanding)

    @property
    def latest(self) -> ReceivedFrame | None:
        return self.frames[-1] if self.frames else None

    def input_fps(self, now_ms: float) -> float:
        return float(sum(1 for t in self.arrivals if now_ms - t <= 1000.0))


class Registry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.streams: dict[str, Stream] = {}

    def register(self, reg: Register, peer: Peer | None, now_ms: float) -> tuple[Stream, Stream | None]:
        """Returns (new stream, superseded stream or None). Raises MessageError when rejected."""
        slot = self.settings.slot(reg.camera_id)
        if slot is None:
            raise MessageError("invalid_camera_id", reg.camera_id)
        if slot.device_id is not None and slot.device_id != reg.device_id:
            raise MessageError("device_mismatch", f"{reg.camera_id} is bound to another device")
        current = self.streams.get(reg.camera_id)
        if current is not None and current.device_id != reg.device_id:
            raise MessageError("camera_id_in_use", f"{reg.camera_id} is already registered by another device")
        stream = Stream(reg.camera_id, reg.device_id, reg.sample_only, peer, now_ms, last_message_at_ms=now_ms)
        if reg.stream_id is not None:
            if current is not None and current.stream_id == reg.stream_id:
                raise MessageError("stream_mismatch", "reconnect requires a new stream_id")
            stream.stream_id = reg.stream_id
        self.streams[reg.camera_id] = stream
        return stream, current

    def unregister(self, stream: Stream) -> bool:
        """Remove the stream if it is still the current one for its slot."""
        if self.streams.get(stream.camera_id) is stream:
            del self.streams[stream.camera_id]
            return True
        return False

    def current(self, camera_id: str) -> Stream | None:
        return self.streams.get(camera_id)

    def is_current(self, stream: Stream) -> bool:
        return self.streams.get(stream.camera_id) is stream

    def expired(self, now_ms: float) -> list[Stream]:
        limit = self.settings.heartbeat_timeout_s * 1000.0
        return [s for s in self.streams.values() if now_ms - s.last_message_at_ms > limit]
