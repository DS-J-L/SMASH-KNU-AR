"""Choose one frame per camera for a common reference time T (aligned server clock).

T = earliest "latest aligned capture time" among eligible cameras, i.e. wait for the slowest
camera, except that a camera lagging the freshest one by more than max_wait_ms no longer holds
T back (it is then usually excluded as time_skew). For every camera the frame nearest to T is taken (align_mode
"nearest"); frames further than max_skew_ms from T are excluded as time_skew, and while the
selected frames span more than max_skew_ms the one furthest from the median is dropped.

align_mode "interpolate" (off by default, proposal in docs/DECISIONS.md) linearly interpolates
the 2D wrists between the two frames around T when both exist and are close together.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from statistics import median

from ..ingest.registry import ReceivedFrame, Stream
from ..ingest.schemas import Wrist

MAX_INTERP_GAP_MS = 70.0


@dataclass
class Selection:
    t_ms: float
    frames: dict[str, ReceivedFrame] = field(default_factory=dict)
    excluded: dict[str, str] = field(default_factory=dict)

    @property
    def skew_ms(self) -> float | None:
        ts = [f.aligned_capture_at_server_ms for f in self.frames.values()]
        return max(ts) - min(ts) if len(ts) >= 2 else None


def _aligned(frames) -> list[ReceivedFrame]:
    return [f for f in frames if f.aligned_capture_at_server_ms is not None]


def _interpolate(frames: list[ReceivedFrame], t: float) -> ReceivedFrame | None:
    after = next((i for i, f in enumerate(frames) if f.aligned_capture_at_server_ms >= t), None)
    if after is None or after == 0:
        return None
    a, b = frames[after - 1], frames[after]
    ta, tb = a.aligned_capture_at_server_ms, b.aligned_capture_at_server_ms
    if tb == t:
        return b
    if tb - ta > MAX_INTERP_GAP_MS or tb <= ta:
        return None
    w = (t - ta) / (tb - ta)
    wrists = {}
    for name, wa in a.pose.wrists.items():
        wb = b.pose.wrists.get(name)
        if wa is None or wb is None:
            wrists[name] = None
        else:
            wrists[name] = Wrist(wa.u_px + w * (wb.u_px - wa.u_px), wa.v_px + w * (wb.v_px - wa.v_px),
                                 min(wa.visibility, wb.visibility), wa.in_frame and wb.in_frame)
    return replace(b, pose=replace(b.pose, wrists=wrists), aligned_capture_at_server_ms=t)


class FrameAligner:
    def __init__(self, max_skew_ms: float, align_mode: str = "nearest", max_wait_ms: float = 100.0):
        self.max_skew_ms = max_skew_ms
        self.max_wait_ms = max_wait_ms
        self.align_mode = align_mode
        self.last_t: float | None = None

    def reset(self) -> None:
        self.last_t = None

    def select(self, streams: dict[str, Stream]) -> Selection | None:
        """streams: eligible cameras only. Returns None when T has not advanced."""
        latest = {cid: _aligned(s.frames) for cid, s in streams.items()}
        latest = {cid: fs for cid, fs in latest.items() if fs}
        if not latest:
            return None
        newest = max(fs[-1].aligned_capture_at_server_ms for fs in latest.values())
        t = min(fs[-1].aligned_capture_at_server_ms for fs in latest.values()
                if fs[-1].aligned_capture_at_server_ms >= newest - self.max_wait_ms)
        if self.last_t is not None and t <= self.last_t:
            return None
        self.last_t = t

        sel = Selection(t)
        for cid, fs in latest.items():
            f = _interpolate(fs, t) if self.align_mode == "interpolate" else None
            if f is None:
                f = min(fs, key=lambda x: abs(x.aligned_capture_at_server_ms - t))
            if abs(f.aligned_capture_at_server_ms - t) <= self.max_skew_ms:
                sel.frames[cid] = f
            else:
                sel.excluded[cid] = "time_skew"

        while len(sel.frames) >= 2 and sel.skew_ms > self.max_skew_ms:
            m = median(f.aligned_capture_at_server_ms for f in sel.frames.values())
            worst = max(sel.frames, key=lambda c: abs(sel.frames[c].aligned_capture_at_server_ms - m))
            sel.frames.pop(worst)
            sel.excluded[worst] = "time_skew"
        return sel
