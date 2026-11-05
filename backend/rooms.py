"""Fixed connection rooms, independent of legacy camera ingestion and tracking."""

from __future__ import annotations

import asyncio
import base64
import binascii
import math
from dataclasses import dataclass
import uuid

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from .connections import Peer
from .ingest.schemas import MessageError, parse_json
from .ingest.room_pose import RoomPose
from .settings import Settings
from .sync.clock import server_now_ms
from .game_sessions import GameSessions
from .auth import is_authorized
from .room_config import ROOM_CAMERAS

SCHEMA = "room.v1"
CAMERA_IDS = ("C0", "C1", "C2")
MAX_VIDEO_MESSAGE_BYTES = 512 * 1024


@dataclass
class Member:
    room_id: str
    role: str
    camera_id: str | None
    device_id: str
    connection_id: str
    peer: Peer
    transport: str = 'webrtc'

    @property
    def slot(self) -> str:
        return self.camera_id if self.role == "camera" else "monitor"


class Rooms:
    def __init__(self, room_ids: tuple[str, ...] = tuple(ROOM_CAMERAS)):
        self.server_epoch = uuid.uuid4().hex
        self.members: dict[str, dict[str, Member]] = {rid: {} for rid in room_ids}
        self.games = GameSessions()

    def camera_ids(self, room_id: str) -> tuple[str, ...]:
        return ROOM_CAMERAS.get(room_id, CAMERA_IDS)

    def status(self, room_id: str) -> dict:
        members = self.members[room_id]
        camera_ids = self.camera_ids(room_id)
        monitor = "monitor" in members
        count = sum(cid in members for cid in camera_ids)
        return {"schema": SCHEMA, "type": "room_status", "room_id": room_id,
                "server_epoch": self.server_epoch,
                "state": "connected" if monitor and count else "waiting" if members else "empty",
                "monitor_connected": monitor,
                "monitor_connection_id": members['monitor'].connection_id if monitor else None,
                "cameras": [{"camera_id": cid, "connected": cid in members,
                             "connection_id": members[cid].connection_id if cid in members else None,
                             "transport": members[cid].transport if cid in members else None}
                            for cid in camera_ids],
                "camera_count": count, "max_cameras": len(camera_ids),
                "required_cameras": list(camera_ids),
                "camera_mode": 'single_camera' if len(camera_ids) == 1 else 'multi_camera',
                "game": self.games.status(room_id)}

    def join(self, msg: dict, peer: Peer) -> tuple[Member, Member | None]:
        if msg.get("schema") != SCHEMA or msg.get("type") != "join":
            raise MessageError("join_required", "first message must be room.v1 join")
        rid, role = msg.get("room_id"), msg.get("role")
        if not isinstance(rid, str) or rid not in self.members:
            raise MessageError("unknown_room")
        if role not in ("monitor", "camera"):
            raise MessageError("invalid_role")
        device = msg.get("device_id")
        if not isinstance(device, str) or not device.strip() or len(device) > 128:
            raise MessageError("invalid_device_id")
        cid = msg.get("camera_id")
        if (role == "camera" and cid not in self.camera_ids(rid)) or (role == "monitor" and cid is not None):
            raise MessageError("invalid_camera_id")
        slot = cid if role == "camera" else "monitor"
        old = self.members[rid].get(slot)
        if old and old.device_id != device:
            raise MessageError("slot_in_use")
        # One physical/browser identity owns only one slot across all rooms.
        if any(m.device_id == device and m is not old
               for room in self.members.values() for m in room.values()):
            raise MessageError("device_in_use")
        transport = msg.get('transport', 'webrtc')
        if transport not in ('webrtc', 'server'):
            raise MessageError('invalid_transport')
        member = Member(rid, role, cid, device, uuid.uuid4().hex, peer, transport)
        self.members[rid][slot] = member
        return member, old

    def is_current(self, member: Member) -> bool:
        return self.members[member.room_id].get(member.slot) is member

    def remove(self, member: Member) -> bool:
        if not self.is_current(member):
            return False
        del self.members[member.room_id][member.slot]
        if member.role == 'camera':
            self.games.camera_disconnected(member.room_id, member.camera_id)
        return True

    def broadcast(self, room_id: str) -> None:
        status = self.status(room_id)
        for member in self.members[room_id].values():
            member.peer.send(status)

    def relay(self, sender: Member, msg: dict) -> None:
        target_id = msg.get('target_connection_id')
        target = next((m for m in self.members[sender.room_id].values()
                       if m.connection_id == target_id), None)
        if not target:
            raise MessageError('target_unavailable')
        if sender.role == target.role:
            raise MessageError('invalid_target')
        camera = sender if sender.role == 'camera' else target
        if camera.transport != 'webrtc':
            raise MessageError('invalid_transport')
        kind, payload = msg.get('type'), msg.get('payload')
        if (kind == 'offer' and sender.role != 'camera') or (kind == 'answer' and sender.role != 'monitor'):
            raise MessageError('invalid_signal_role')
        if not isinstance(payload, dict):
            raise MessageError('invalid_signal')
        if kind in ('offer', 'answer'):
            if payload.get('type') != kind or not isinstance(payload.get('sdp'), str) or not payload['sdp']:
                raise MessageError('invalid_signal')
        elif not isinstance(payload.get('candidate'), str):
            raise MessageError('invalid_signal')
        target.peer.send({'schema': SCHEMA, 'type': kind, 'room_id': sender.room_id,
                          'from_connection_id': sender.connection_id,
                          'target_connection_id': target.connection_id,
                          'camera_id': sender.camera_id if sender.role == 'camera' else target.camera_id,
                          'payload': payload})

    def relay_video(self, sender: Member, msg: dict) -> None:
        if sender.role != 'camera' or sender.transport != 'server':
            raise MessageError('invalid_transport')
        frame = msg.get('frame_id')
        data = msg.get('data_url')
        prepared = msg.get('prepared_at_server_ms')
        if prepared is not None and (type(prepared) not in (int, float) or not math.isfinite(prepared) or prepared < 0):
            raise MessageError('invalid_frame_time')
        if type(frame) is not int or frame < 0 or not isinstance(data, str) or not data.startswith('data:image/jpeg;base64,'):
            raise MessageError('invalid_frame')
        try:
            jpeg = base64.b64decode(data.split(',', 1)[1], validate=True)
        except (ValueError, binascii.Error):
            raise MessageError('invalid_frame')
        if len(jpeg) > 360 * 1024 or not jpeg.startswith(b'\xff\xd8') or not jpeg.endswith(b'\xff\xd9'):
            raise MessageError('invalid_frame')
        target = self.members[sender.room_id].get('monitor')
        if target:
            target.peer.send_video(sender.camera_id, {
                'schema': SCHEMA, 'type': 'video_frame', 'room_id': sender.room_id,
                'camera_id': sender.camera_id, 'from_connection_id': sender.connection_id,
                'target_connection_id': target.connection_id, 'frame_id': frame, 'data_url': data,
                'prepared_at_server_ms': prepared})


def room_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/api/single/rooms")
    async def list_rooms(request: Request):
        rooms = request.app.state.rooms
        return {"schema": SCHEMA, "server_epoch": rooms.server_epoch,
                "rooms": [rooms.status(rid) for rid in rooms.members]}

    @router.websocket("/ws/single/signaling")
    async def room_socket(ws: WebSocket):
        rooms: Rooms = ws.app.state.rooms
        await ws.accept()
        peer = Peer(ws, "room").start()
        member = None
        pose = None

        async def read_message() -> dict:
            raw = await asyncio.wait_for(ws.receive(), timeout=settings.heartbeat_timeout_s)
            if raw["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(raw.get("code", 1000))
            if raw.get("text") is None:
                raise MessageError("unsupported_message", "JSON text required")
            msg = parse_json(raw['text'], MAX_VIDEO_MESSAGE_BYTES)
            if msg.get('type') != 'video_frame':
                return parse_json(raw['text'], settings.max_message_bytes)
            return msg

        try:
            msg = await read_message()
            if msg.get('role') == 'monitor' and not is_authorized(ws.scope, settings.access_key):
                raise MessageError('access_key_required')
            member, old = rooms.join(msg, peer)
            pose = RoomPose(ws.app.state.runtime, member)
            peer.send({"schema": SCHEMA, "type": "joined", "room_id": member.room_id,
                       "role": member.role, "camera_id": member.camera_id, "device_id": member.device_id,
                       "connection_id": member.connection_id, "server_epoch": rooms.server_epoch,
                       "heartbeat_interval_ms": int(settings.heartbeat_timeout_s * 1000 / 3),
                       "heartbeat_timeout_ms": int(settings.heartbeat_timeout_s * 1000)})
            rooms.broadcast(member.room_id)
            if old:
                old.peer.send({"schema": SCHEMA, "type": "error", "code": "superseded"})
                await old.peer.close(4001, "superseded")
            while rooms.is_current(member):
                try:
                    msg = await read_message()
                    received_ms = server_now_ms()
                    if not rooms.is_current(member):
                        break
                    if msg.get("schema") != SCHEMA:
                        raise MessageError("invalid_schema")
                    if msg.get("room_id") != member.room_id:
                        raise MessageError("room_mismatch")
                    kind = msg.get("type")
                    if kind == "ping":
                        pose.touch()
                        ping_id = msg.get('ping_id')
                        if ping_id is not None and (type(ping_id) is not int or ping_id < 0):
                            raise MessageError('invalid_ping_id')
                        peer.send({"schema": SCHEMA, "type": "pong", "room_id": member.room_id,
                                   "ping_id": ping_id, 'server_received_ms': received_ms,
                                   'server_sent_ms': server_now_ms()})
                    elif kind == "get_status":
                        peer.send(rooms.status(member.room_id))
                    elif kind == "leave":
                        break
                    elif kind in ('offer', 'answer', 'ice'):
                        rooms.relay(member, msg)
                    elif kind == 'video_frame':
                        rooms.relay_video(member, msg)
                    elif kind == 'pose':
                        await pose.handle(msg.get('payload'))
                    elif kind == 'start_game':
                        game = rooms.games.start(member, msg, rooms.members[member.room_id])
                        peer.send({'schema': SCHEMA, 'type': 'game_ack', 'room_id': member.room_id, 'game': game})
                        rooms.broadcast(member.room_id)
                    elif kind == 'get_game_status':
                        peer.send({'schema': SCHEMA, 'type': 'game_status', 'room_id': member.room_id,
                                   'game': rooms.games.status(member.room_id)})
                    elif kind == 'stop_game':
                        game = rooms.games.stop(member, msg)
                        peer.send({'schema': SCHEMA, 'type': 'game_status', 'room_id': member.room_id, 'game': game})
                        rooms.broadcast(member.room_id)
                    else:
                        raise MessageError("unsupported_message")
                except MessageError as exc:
                    peer.send({"schema": SCHEMA, "type": "error", "code": exc.code, 'request_type': msg.get('type')})
        except asyncio.TimeoutError:
            peer.send({"schema": SCHEMA, "type": "error", "code": "heartbeat_timeout"})
            await peer.close(4408, "heartbeat_timeout")
        except MessageError as exc:
            peer.send({"schema": SCHEMA, "type": "error", "code": exc.code})
            code = 4401 if exc.code == 'access_key_required' else 4409 if exc.code in ('slot_in_use', 'device_in_use') else 4400
            await peer.close(code, exc.code)
        except WebSocketDisconnect:
            pass
        finally:
            if pose:
                await pose.close()
            if member and rooms.remove(member):
                rooms.broadcast(member.room_id)
            await peer.close()

    return router
