"""Server runtime: registry, calibrations, tracking loop and status/pose_3d broadcasting."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid

from .calibration.storage import CalibrationError, load_calibration
from .connections import Peer
from .ingest.registry import Registry
from .settings import Settings
from .sync.clock import server_now_ms
from .tracking.pipeline import CalibrationEntry, CameraState, TrackingPipeline, camera_states

log = logging.getLogger("smash")

TRACKING_TICK_S = 0.005
HEARTBEAT_EMIT_MS = 100.0      # emit an explicit invalid pose_3d when no new aligned frame
TRACKING_READY_WINDOW_MS = 1000.0
RECEIVING_WINDOW_MS = 1000.0


class Runtime:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.registry = Registry(settings)
        self.pipeline = TrackingPipeline(settings)
        self.session_id = uuid.uuid4().hex   # server-run scope until the game session owner is decided
        self.sequence = 0
        self.status_peers: set[Peer] = set()
        self.pose_peers: set[Peer] = set()
        self.scene_ready = False
        self.last_valid_tracking_ms: float | None = None
        self.last_emit_ms = 0.0
        self._status_signature = None
        self._tasks: list[asyncio.Task] = []
        self.calibrations: dict[str, CalibrationEntry] = {}
        self.load_calibrations()

    # --- calibration ------------------------------------------------------------------
    def load_calibrations(self) -> None:
        entries = {}
        for slot in self.settings.cameras:
            if slot.calibration_file is None:
                entries[slot.camera_id] = CalibrationEntry("missing")
                continue
            try:
                cal = load_calibration(slot.calibration_file, slot.camera_id)
                entries[slot.camera_id] = CalibrationEntry(cal.source, cal)
            except CalibrationError as exc:
                entries[slot.camera_id] = CalibrationEntry("invalid", error=str(exc))
                log.warning("calibration %s rejected: %s", slot.camera_id, exc)
        self.calibrations = entries
        self.pipeline.aligner.reset()

    # --- status -----------------------------------------------------------------------
    def _camera_status(self, cid: str, now: float, states: dict[str, CameraState]) -> dict:
        entry = self.calibrations.get(cid) or CalibrationEntry("missing")
        cal = {"status": entry.status,
               "calibration_id": entry.calibration.calibration_id if entry.calibration else None}
        if entry.error:
            cal["error"] = entry.error
        stream = self.registry.current(cid)
        if stream is None:
            return {"camera_id": cid, "status": "disconnected", "calibration": cal}
        latest = stream.latest
        if latest is None:
            state = "registered"
        elif now - latest.received_at_server_ms <= RECEIVING_WINDOW_MS:
            state = "receiving"
        else:
            state = "stale"
        st = states.get(cid)
        if st and st.reason == "calibration_mismatch":
            cal["mismatch"] = st.mismatch
        return {
            "camera_id": cid, "status": state, "calibration": cal,
            "device_id": stream.device_id, "stream_id": stream.stream_id, "sample_only": stream.sample_only,
            "clock": {"ready": stream.clock.ready,
                      "offset_ms": _r(stream.clock.offset_ms), "uncertainty_ms": _r(stream.clock.uncertainty_ms)},
            "tracking_input": (st.reason if st else None) or "ok",
            "input_fps": stream.input_fps(now),
            "last_frame_id": stream.last_frame_id,
            "timestamp_source": latest.pose.timestamp_source if latest else None,
            "rejected": dict(stream.rejected),
        }

    def status(self, now: float | None = None) -> dict:
        now = server_now_ms() if now is None else now
        states = camera_states(self.settings, self.registry, self.calibrations, now)
        cams = [self._camera_status(cid, now, states) for cid in self.settings.camera_ids]
        n = len(cams)
        receiving = [c for c in cams if c["status"] == "receiving" and not c.get("sample_only")]
        measured = [c for c in cams if c["calibration"]["status"] == "measured" and "mismatch" not in c["calibration"]]
        readiness = {
            "camera_input": len(receiving) == n,
            "calibration": len(measured) == n,
            "tracking": False,
            "scene": self.scene_ready,
        }
        readiness["tracking"] = readiness["calibration"] and self.last_valid_tracking_ms is not None and \
            now - self.last_valid_tracking_ms <= TRACKING_READY_WINDOW_MS
        parts = [f"관절 수신 {len(receiving)}/{n}", f"실측 보정 {len(measured)}/{n}",
                 f"3D 추적 {'가능' if readiness['tracking'] else '대기'}",
                 f"화면 {'준비' if readiness['scene'] else '대기'}"]
        if any(c.get("sample_only") for c in cams):
            parts.append("합성/샘플 입력 포함")
        if self.settings.config_source == "example":
            parts.append("예시 설정 사용 중")
        return {
            "schema_version": "0.1",
            "type": "system_status",
            "stage": "development",
            "game_ready": all(readiness.values()),
            "config_source": self.settings.config_source,
            "cameras": cams,
            "readiness": readiness,
            "message": " · ".join(parts),
        }

    @staticmethod
    def _signature(status: dict):
        """Fields whose change should be pushed immediately (not fps/clock jitter)."""
        return (status["game_ready"], tuple(status["readiness"].items()),
                tuple((c["camera_id"], c["status"], c["calibration"]["status"], c.get("stream_id"),
                       c.get("clock", {}).get("ready"), c.get("tracking_input")) for c in status["cameras"]))

    def broadcast_status(self, force: bool = False) -> None:
        st = self.status()
        sig = self._signature(st)
        if force or sig != self._status_signature:
            self._status_signature = sig
            for p in list(self.status_peers):
                p.send(st)

    # --- tracking -----------------------------------------------------------------------
    def tracking_step(self, now: float) -> dict | None:
        force = now - self.last_emit_ms >= HEARTBEAT_EMIT_MS
        msg, _ = self.pipeline.step(self.registry, self.calibrations, now, force=force)
        if msg is None:
            return None
        self.sequence += 1
        msg = {**msg, "session_id": self.session_id, "sequence": self.sequence,
               "server_sent_at_ms": round(server_now_ms(), 1)}
        if not msg["sample_only"] and all(j["valid"] for j in msg["joints"].values()):
            self.last_valid_tracking_ms = now
        self.last_emit_ms = now
        for p in list(self.pose_peers):
            p.send(msg)
        return msg

    async def _tracking_loop(self) -> None:
        while True:
            try:
                self.tracking_step(server_now_ms())
            except Exception:
                log.exception("tracking step failed")
            await asyncio.sleep(TRACKING_TICK_S)

    async def _housekeeping_loop(self) -> None:
        while True:
            now = server_now_ms()
            for stream in self.registry.expired(now):
                self.registry.unregister(stream)
                if stream.peer:
                    stream.peer.send({"schema_version": "0.1", "type": "error", "code": "heartbeat_timeout"})
                    asyncio.create_task(stream.peer.close(4408, "heartbeat_timeout"))
                log.info("%s heartbeat timeout", stream.camera_id)
            self.broadcast_status()
            await asyncio.sleep(0.25)

    async def start(self) -> None:
        self._tasks = [asyncio.create_task(self._tracking_loop()), asyncio.create_task(self._housekeeping_loop())]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t


def _r(v: float | None) -> float | None:
    return None if v is None else round(v, 1)
