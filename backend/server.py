"""HTTP/WebSocket entry points. Algorithms live in ingest/, sync/, calibration/ and tracking/.

    /ws/ingest  phone -> server: register, clock_pong, pose_2d   (server -> phone: registered, clock_ping, error)
    /ws/pose    phone branch: camera_hello, clock_pong, pose_2d (camera_ack, clock_ping, error)
    /ws/status  system_status on connect, on get_status and whenever readiness changes
    /ws/pose3d  server -> consumers: pose_3d stream (monitor render / physics)
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .auth import AccessKeyMiddleware
from .connections import Peer
from .ingest.pose_receiver import accept_pose
from .ingest.camera_protocol import parse_hello, normalize_pose, normalize_pong
from .ingest.schemas import MessageError, parse_clock_pong, parse_json, parse_pose_2d, parse_register
from .runtime import Runtime
from .settings import Settings, load_settings
from .sync.clock import server_now_ms

WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
REGISTER_TIMEOUT_S = 5.0
MAX_PENDING_PINGS = 64
MAX_STREAM_CHANGES = 128
log = logging.getLogger("smash")

# Close codes sent to phones (docs/DATA_CONTRACT.md).
CLOSE_SUPERSEDED = 4001
CLOSE_BAD_REQUEST = 4400
CLOSE_DEVICE_MISMATCH = 4403
CLOSE_IN_USE = 4409


def _error(code: str, detail: str = "", **extra) -> dict:
    return {"schema_version": "0.1", "type": "error", "code": code, "detail": detail, **extra}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        runtime = Runtime(settings)
        app.state.runtime = runtime
        await runtime.start()
        try:
            yield
        finally:
            await runtime.stop()

    app = FastAPI(title="SMASH-KNU-AR", version="0.2.0", lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> dict:
        return {"status": "ok", "service": "SMASH-KNU-AR", "stage": "development"}

    @app.get("/api/calibration")
    async def calibration() -> dict:
        """Calibration values for consumers such as the C0 projection on the monitor."""
        rt: Runtime = app.state.runtime
        return {"cameras": [
            {"camera_id": cid, "status": e.status,
             **({"calibration": e.calibration.public()} if e.calibration else {})}
            for cid, e in rt.calibrations.items()
        ]}

    @app.get("/")
    async def home() -> RedirectResponse:
        return RedirectResponse("/monitor/")

    # --- status -----------------------------------------------------------------------
    @app.websocket("/ws/status")
    async def status_socket(websocket: WebSocket) -> None:
        rt: Runtime = websocket.app.state.runtime
        await websocket.accept()
        peer = Peer(websocket, "status").start()
        peer.send(rt.status())
        rt.status_peers.add(peer)
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    request = json.loads(text)
                except json.JSONDecodeError:
                    peer.send({"type": "error", "code": "invalid_json"})
                    continue
                kind = request.get("type") if isinstance(request, dict) else None
                if kind == "get_status":
                    peer.send(rt.status())
                elif kind == "scene_report" and isinstance(request.get("ready"), bool):
                    rt.scene_ready = request["ready"]
                    rt.broadcast_status()
                else:
                    peer.send({"type": "error", "code": "unsupported_message"})
        except WebSocketDisconnect:
            pass
        finally:
            rt.status_peers.discard(peer)
            await peer.stop()

    # --- pose_3d consumers ------------------------------------------------------------
    @app.websocket("/ws/pose3d")
    async def pose3d_socket(websocket: WebSocket) -> None:
        rt: Runtime = websocket.app.state.runtime
        await websocket.accept()
        peer = Peer(websocket, "pose3d", queue_size=32).start()
        rt.pose_peers.add(peer)
        try:
            while True:
                await websocket.receive_text()  # consumers send nothing in v0.2
                peer.send({"type": "error", "code": "unsupported_message"})
        except WebSocketDisconnect:
            pass
        finally:
            rt.pose_peers.discard(peer)
            await peer.stop()

    # --- phone ingest -------------------------------------------------------------------
    @app.websocket("/ws/ingest")
    @app.websocket("/ws/pose")
    async def ingest_socket(websocket: WebSocket) -> None:
        rt: Runtime = websocket.app.state.runtime
        await websocket.accept()
        peer = Peer(websocket, "ingest", queue_size=32).start()
        camera_protocol = websocket.url.path == "/ws/pose"

        try:
            first = await asyncio.wait_for(websocket.receive_text(), timeout=REGISTER_TIMEOUT_S)
            hello = parse_json(first, settings.max_message_bytes)
            reg = (parse_hello if camera_protocol else parse_register)(hello, settings.camera_ids)
            stream, old = rt.registry.register(reg, peer, server_now_ms())
        except MessageError as exc:
            code = exc.code if exc.code != "unsupported_message" else "not_registered"
            close = {"camera_id_in_use": CLOSE_IN_USE, "device_mismatch": CLOSE_DEVICE_MISMATCH}
            peer.send(_error("duplicate_camera_id" if camera_protocol and code == "camera_id_in_use" else code, exc.detail))
            await peer.close(close.get(code, CLOSE_BAD_REQUEST), code)
            return
        except (asyncio.TimeoutError, WebSocketDisconnect, RuntimeError, KeyError):
            await peer.close(CLOSE_BAD_REQUEST, "not_registered")
            return

        if old is not None and old.peer is not None:
            old.peer.send(_error("superseded", "the same device registered again"))
            asyncio.create_task(old.peer.close(CLOSE_SUPERSEDED, "superseded"))

        entry = rt.calibrations.get(stream.camera_id)
        expected = None
        if entry and entry.calibration:
            c = entry.calibration
            expected = {"calibration_id": c.calibration_id, "calibration_source": c.source,
                        "image": {"width": c.width, "height": c.height, "rotation_deg": c.rotation_deg}}
        peer.send({"schema_version": "0.1", "type": "camera_ack" if camera_protocol else "registered", "camera_id": stream.camera_id,
                   "device_id": stream.device_id, "stream_id": stream.stream_id,
                   "sample_only": stream.sample_only, "expected": expected,
                   "clock_ping_interval_ms": int(settings.clock_ping_interval_s * 1000)})
        log.info("%s registered (stream %s)", stream.camera_id, stream.stream_id[:8])
        rt.broadcast_status()
        seen_stream_ids = {stream.stream_id}

        async def pinger() -> None:
            n = 0
            while rt.registry.is_current(stream):
                n += 1
                sent = server_now_ms()
                stream.pings[n] = sent
                while len(stream.pings) > MAX_PENDING_PINGS:
                    stream.pings.pop(next(iter(stream.pings)))
                time_field = "server_time_ms" if camera_protocol else "server_send_ms"
                peer.send({"schema_version": "0.1", "type": "clock_ping", "ping_id": n, time_field: sent})
                interval = settings.clock_ping_interval_s
                await asyncio.sleep(interval / 10 if n < settings.clock_fast_pings else interval)

        ping_task = asyncio.create_task(pinger())
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect" or not rt.registry.is_current(stream):
                    break
                now = server_now_ms()
                stream.last_message_at_ms = now
                if message.get("text") is None:
                    stream.rejected["unsupported_message"] += 1
                    peer.send(_error("unsupported_message", "binary messages are not accepted on /ws/ingest"))
                    continue
                frame_id = None
                try:
                    msg = parse_json(message["text"], settings.max_message_bytes)
                    kind = msg.get("type")
                    frame_id = msg.get("frame_id")
                    if kind == "pose_2d":
                        if camera_protocol:
                            msg = normalize_pose(msg, hello["source"])
                        pose = parse_pose_2d(msg, settings.camera_ids)
                        if camera_protocol and pose.stream_id != stream.stream_id:
                            # The phone starts a new stream on image-size/rotation changes.
                            if (pose.stream_id in seen_stream_ids or pose.frame_id != 0
                                    or len(seen_stream_ids) >= MAX_STREAM_CHANGES
                                    or pose.camera_id != stream.camera_id or pose.device_id != stream.device_id):
                                raise MessageError("stream_mismatch", "new stream requires frame 0 and registered identity")
                            stream.stream_id = pose.stream_id
                            seen_stream_ids.add(pose.stream_id)
                            stream.frames.clear()
                            stream.arrivals.clear()
                            stream.last_frame_id = None
                        accept_pose(stream, pose, now, settings)
                    elif kind == "clock_pong":
                        if camera_protocol:
                            msg = normalize_pong(msg)
                        pong = parse_clock_pong(msg)
                        sent = stream.pings.pop(pong.ping_id, None)
                        if sent is None:
                            raise MessageError("unknown_ping", str(pong.ping_id))
                        if pong.server_send_ms != sent:
                            raise MessageError("invalid_field", "clock_pong must echo the server timestamp")
                        stream.clock.add(pong.clock_id, sent, pong.device_time_ms, now)
                    elif kind == "register":
                        raise MessageError("already_registered", stream.stream_id)
                    else:
                        raise MessageError("unsupported_message", str(kind))
                except MessageError as exc:
                    stream.rejected[exc.code] += 1
                    extra = {"frame_id": frame_id} if isinstance(frame_id, int) and not isinstance(frame_id, bool) else {}
                    peer.send(_error(exc.code, exc.detail, **extra))
        except WebSocketDisconnect:
            pass
        except Exception:
            log.exception("%s ingest error", stream.camera_id)
        finally:
            ping_task.cancel()
            if rt.registry.unregister(stream):
                log.info("%s disconnected", stream.camera_id)
                rt.broadcast_status()
            await peer.stop()

    # Serve only browser assets; local configs, calibration and experiment data stay outside.
    app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web")
    app.add_middleware(AccessKeyMiddleware, access_key=settings.access_key)
    return app


app = create_app()
