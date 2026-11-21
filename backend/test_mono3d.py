"""Test-only relay for the single-camera approximate 3D page (/test/mono3d/).

    /ws/test/mono3d?role=phone   phone -> server: mono3d_calib, mono3d_frame, mono3d_jpeg
    /ws/test/mono3d?role=viewer  server -> PC: the same messages + mono3d_status

One phone at a time (a new phone replaces the old one). The legacy viewer receives the relay;
the optional model=it1 viewer also judges the phone's approximate wrist coordinates (no triangulation).
Frames and JPEGs are latest-only per viewer, so a slow PC skips
stale ones instead of lagging. Values are `source: mono_approx`, never multi-view 3D. Nothing is
stored on disk. Protected by the normal access key (the page is not public).
"""

from __future__ import annotations

import json
import logging
import math
import time
import asyncio

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

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
        self.model_viewers: set[Peer] = set()
        self.model = None

    def model_state(self, state=None):
        if self.model:
            packet={"type":"mono3d_model_state","source":"mono_approx","timing":"server_arrival",
                    "model_test":state or self.model.snapshot()}
            for viewer in self.model_viewers:
                if packet['model_test'].get('event'):viewer.send(packet)
                else:viewer.send_video('model_state',packet)
            if self.phone:
                self.phone.send_video('model_state',packet)

    def update_model(self, message):
        if not self.model:return
        joints={}
        raw=message.get('joints') if message.get('valid') is True else None
        if isinstance(raw,dict):
            for name in ('left_wrist','right_wrist','left_ankle','right_ankle','left_hip','right_hip'):
                p=raw.get(name)
                if isinstance(p,list) and len(p)==3 and all(isinstance(v,(int,float)) and math.isfinite(v) and abs(v)<=100 for v in p):
                    joints[name]={'p':p}
        # Python 3.12 on Windows uses a 15.6 ms tick for monotonic(); separate
        # frames can otherwise share a timestamp and be rejected as a zero-time path.
        self.model_state(self.model.update(joints,time.perf_counter()*1000))

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

    @router.get('/api/test/building-scenes')
    async def scenes(kind:str='zone'):
        # zone: several-building stages (3 cameras); single: one building at a time (1 camera).
        from .building_scenes import scene_list, single_scene_list
        if kind not in ('zone','single'):raise HTTPException(status_code=400,detail='kind must be zone or single')
        return single_scene_list() if kind=='single' else scene_list()

    @router.get('/api/test/building-scenes/{scene_id}')
    async def scene(scene_id:str):
        from .building_scenes import scene_spec
        from fastapi import HTTPException
        try:return await asyncio.to_thread(scene_spec,scene_id)
        except ValueError as exc:raise HTTPException(404,str(exc)) from exc

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
            if websocket.query_params.get('model')=='it1':
                from .fragment_test import FragmentTest
                if relay.model is None:
                    relay.model=FragmentTest();relay.model.approximate=True;relay.model.depth_margin=0
                relay.model_viewers.add(peer)
            for kind in ("mono3d_calib", "mono3d_frame", "mono3d_jpeg"):
                if kind in relay.last:
                    peer.send(relay.last[kind])
            if peer in relay.model_viewers:relay.model_state()
        else:
            old, relay.phone = relay.phone, peer
            if relay.model is None:
                from .fragment_test import FragmentTest
                relay.model=await asyncio.to_thread(FragmentTest);relay.model.approximate=True
            relay.last.clear()
            if relay.model:relay.model.clear_tracking()
            if old is not None:
                old.send({"type": "error", "code": "superseded"})
                await old.close(CLOSE_SUPERSEDED, "superseded")
            relay.model_state()
            log.info("mono3d phone connected")
        relay.broadcast_status()

        try:
            while True:
                text = await websocket.receive_text()
                if role == "viewer":
                    if peer in relay.model_viewers:
                        try:
                            if len(text.encode('utf-8'))>MAX_MESSAGE_BYTES:raise ValueError('message too large')
                            message=json.loads(text)
                            if not isinstance(message,dict):raise ValueError('object expected')
                            from .fragment_test import model_command
                            relay.model=await asyncio.to_thread(model_command,relay.model,message)
                            event=relay.model.pending_event;relay.model.pending_event=None
                            relay.model_state(relay.model.snapshot(event))
                        except (TypeError,ValueError,OverflowError) as exc:
                            peer.send({'type':'error','code':'bad_message','detail':str(exc)[:200]})
                    continue
                if relay.phone is not peer:
                    continue                      # viewers only listen; a replaced phone is ignored
                if len(text.encode("utf-8")) > MAX_MESSAGE_BYTES:
                    peer.send({"type": "error", "code": "message_too_large"})
                    continue
                try:
                    message = json.loads(text)
                except json.JSONDecodeError:
                    peer.send({"type": "error", "code": "invalid_json"})
                    continue
                kind = message.get("type") if isinstance(message, dict) else None
                if not isinstance(kind, str) or kind not in PHONE_TYPES:
                    peer.send({"type": "error", "code": "unsupported_message"})
                    continue
                message["source"] = "mono_approx"
                if kind=='mono3d_calib' and relay.model:
                    reference=message.get('body',{}).get('model_reference') if isinstance(message.get('body'),dict) else None
                    if reference:
                        from .fragment_test import apply_body_reference
                        try:relay.model=apply_body_reference(relay.model,reference)
                        except ValueError:
                            peer.send({'type':'error','code':'invalid_body_reference'});continue
                        relay.model_state()
                    old=relay.last.get(kind,{})
                    if (old.get('camera')!=message.get('camera') or old.get('image')!=message.get('image')
                            or old.get('body')!=message.get('body')):
                        relay.model.clear_tracking()
                relay.forward(message)
                if kind=='mono3d_frame':relay.update_model(message)
        except WebSocketDisconnect:
            pass
        except RuntimeError:
            if websocket.application_state is not WebSocketState.DISCONNECTED:
                raise
        finally:
            if role == "viewer":
                relay.viewers.discard(peer)
                relay.model_viewers.discard(peer)
            elif relay.phone is peer:
                relay.phone = None
                if relay.model:relay.model.clear_tracking()
                for viewer in relay.viewers:
                    viewer.send({"type": "mono3d_phone_left"})
                log.info("mono3d phone disconnected")
            relay.broadcast_status()
            await peer.stop()

    return router
