"""Per-stream device clock -> server clock conversion (NTP-style).

Server sends clock_ping{server_send_ms}; the phone answers clock_pong{server_send_ms,
device_time_ms, clock_id}; the server stamps the arrival time. One sample gives

    rtt    = server_recv - server_send
    offset = device_time - (server_send + server_recv) / 2      # device clock - server clock

The minimum-RTT sample in a sliding window is used (its symmetry assumption is the best),
and half of that RTT is reported as the conversion uncertainty. A new clock_id (page reload,
new performance.timeOrigin) discards the old samples.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass

MIN_SAMPLES = 3
MAX_RTT_MS = 2_000.0


def server_now_ms() -> float:
    return time.time() * 1000.0


@dataclass(frozen=True)
class ClockSample:
    rtt_ms: float
    offset_ms: float


class DeviceClock:
    def __init__(self, window: int = 20):
        self.clock_id: str | None = None
        self.samples: deque[ClockSample] = deque(maxlen=window)

    def add(self, clock_id: str, server_send_ms: float, device_time_ms: float, server_recv_ms: float) -> bool:
        """Add one ping/pong sample. Returns False when the sample is rejected."""
        if clock_id != self.clock_id:
            self.clock_id = clock_id
            self.samples.clear()
        rtt = server_recv_ms - server_send_ms
        if not 0 <= rtt <= MAX_RTT_MS:
            return False
        self.samples.append(ClockSample(rtt, device_time_ms - (server_send_ms + server_recv_ms) / 2.0))
        return True

    @property
    def ready(self) -> bool:
        return len(self.samples) >= MIN_SAMPLES

    def _best(self) -> ClockSample | None:
        return min(self.samples, key=lambda s: s.rtt_ms) if self.samples else None

    @property
    def offset_ms(self) -> float | None:
        b = self._best()
        return b.offset_ms if b and self.ready else None

    @property
    def uncertainty_ms(self) -> float | None:
        b = self._best()
        return b.rtt_ms / 2.0 if b and self.ready else None

    def to_server(self, clock_id: str, device_time_ms: float) -> float | None:
        """Device timestamp -> server time, or None if this clock is unknown/not ready."""
        if not self.ready or clock_id != self.clock_id:
            return None
        return device_time_ms - self.offset_ms
