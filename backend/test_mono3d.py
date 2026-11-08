"""Test-only relay for the single-camera approximate 3D page (/test/mono3d/).

    /ws/test/mono3d?role=phone   phone -> server: mono3d_calib, mono3d_frame, mono3d_jpeg
    /ws/test/mono3d?role=viewer  server -> PC: the same messages + mono3d_status

One phone at a time (a new phone replaces the old one). The server only checks size/type and
forwards; it does no geometry. Frames and JPEGs are latest-only per viewer, so a slow PC skips
stale ones instead of lagging. Values are `source: mono_approx`, never multi-view 3D. Nothing is
stored on disk. Protected by the normal access key (the page is not public).
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .connections import Peer

MAX_MESSAGE_BYTES = 512 * 1024
PHONE_TYPES = frozenset({"mono3d_calib", "mono3d_frame", "mono3d_jpeg"})
CLOSE_SUPERSEDED = 4001
CLOSE_BAD_REQUEST = 4400
log = logging.getLogger("smash.mono3d")


class Mono3dRelay:
    def __init__(self) -> None:
        self.phone: Peer | None = None
        self.viewers: set[Peer] = set()
        self.last: dict[str, dict] = {}   # latest calib / frame / jpeg for late viewers

    def status(self) -> dict:
        return {"type": "mono3d_status", "phone_connected": self.phone is not None, "viewers": len(self.viewers)}

    def broadcast_status(self) -> None:
        message = self.status()
        for peer in (*self.viewers, *([self.phone] if self.phone else [])):
            peer.send(message)

    def forward(self, message: dict) -> None:
        kind = message["type"]
        self.last[kind] = message
        for viewer in self.viewers:
            if kind == "mono3d_calib":
                viewer.send(message)
            else:
                viewer.send_video(kind, message)


def mono3d_router() -> APIRouter:
    router = APIRouter()
    relay = Mono3dRelay()

    @router.websocket("/ws/test/mono3d")
    async def mono3d_socket(websocket: WebSocket) -> None:
        role = websocket.query_params.get("role")
        await websocket.accept()
        peer = Peer(websocket, f"mono3d:{role}", queue_size=16).start()
        if role not in ("phone", "viewer"):
            peer.send({"type": "error", "code": "bad_role"})
            await peer.close(CLOSE_BAD_REQUEST, "bad_role")
            return

        if role == "viewer":
            relay.viewers.add(peer)
            for kind in ("mono3d_calib", "mono3d_frame", "mono3d_jpeg"):
                if kind in relay.last:
                    peer.send(relay.last[kind])
        else:
            old, relay.phone = relay.phone, peer
            relay.last.clear()
            if old is not None:
                old.send({"type": "error", "code": "superseded"})
                await old.close(CLOSE_SUPERSEDED, "superseded")
            log.info("mono3d phone connected")
        relay.broadcast_status()

        try:
            while True:
                text = await websocket.receive_text()
                if role == "viewer" or relay.phone is not peer:
                    continue                      # viewers only listen; a replaced phone is ignored
                if len(text.encode("utf-8")) > MAX_MESSAGE_BYTES:
                    peer.send({"type": "error", "code": "message_too_large"})
                    continue
                try:
                    message = json.loads(text)
                except json.JSONDecodeError:
                    peer.send({"type": "error", "code": "invalid_json"})
                    continue
                if not isinstance(message, dict) or message.get("type") not in PHONE_TYPES:
                    peer.send({"type": "error", "code": "unsupported_message"})
                    continue
                message["source"] = "mono_approx"
                relay.forward(message)
        except WebSocketDisconnect:
            pass
        finally:
            if role == "viewer":
                relay.viewers.discard(peer)
            elif relay.phone is peer:
                relay.phone = None
                for viewer in relay.viewers:
                    viewer.send({"type": "mono3d_phone_left"})
                log.info("mono3d phone disconnected")
            relay.broadcast_status()
            await peer.stop()

    return router
