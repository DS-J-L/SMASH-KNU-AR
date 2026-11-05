"""Validate room-local observations; only room-1 feeds the 3D runtime registry."""
import asyncio
import contextlib

from .camera_protocol import normalize_pong, normalize_pose, parse_hello
from .pose_receiver import accept_pose
from .schemas import MessageError, parse_clock_pong, parse_pose_2d
from ..sync.clock import server_now_ms


class RoomPose:
    def __init__(self, runtime, member, registry=None):
        self.runtime, self.member = runtime, member
        self.registry = registry if registry is not None else runtime.registry
        self.stream = None
        self.clock_id = None
        self.seen = set()
        self.pinger = None

    def send(self, payload):
        self.member.peer.send({'schema': 'room.v1', 'type': 'pose',
                               'room_id': self.member.room_id, 'payload': payload})

    def touch(self):
        if self.stream and self.registry.is_current(self.stream):
            self.stream.last_message_at_ms = server_now_ms()

    async def handle(self, message):
        try:
            if self.member.role != 'camera' or self.member.room_id not in ('room-1', 'room-2'):
                raise MessageError('pose_not_allowed')
            if not isinstance(message, dict):
                raise MessageError('invalid_pose_message')
            kind = message.get('type')
            rt, member = self.runtime, self.member
            if kind == 'camera_hello':
                reg = parse_hello(message, rt.settings.camera_ids)
                if reg.camera_id != member.camera_id or reg.device_id != member.device_id:
                    raise MessageError('pose_identity_mismatch')
                if message.get('source') != 'live':
                    raise MessageError('pose_live_required')
                if reg.stream_id in self.seen or len(self.seen) >= 128:
                    raise MessageError('stream_mismatch')
                stream, old = self.registry.register(reg, member.peer, server_now_ms())
                await self.stop_pinger()
                self.stream, self.clock_id = stream, message['clock_id']
                self.seen.add(stream.stream_id)
                entry = rt.calibrations.get(stream.camera_id) if member.room_id == 'room-1' else None
                cal = entry.calibration if entry else None
                expected = {'calibration_id': cal.calibration_id,
                            'image': {'width': cal.width, 'height': cal.height,
                                      'rotation_deg': cal.rotation_deg}} if cal else None
                self.send({'type': 'camera_ack', 'camera_id': stream.camera_id,
                           'device_id': stream.device_id, 'stream_id': stream.stream_id,
                           'expected': expected})
                self.pinger = asyncio.create_task(self.ping(stream))
                rt.broadcast_status()
                if old and old.peer and old.peer is not member.peer:
                    await old.peer.close(4001, 'superseded')
                return
            if not self.stream or not self.registry.is_current(self.stream):
                raise MessageError('pose_not_registered')
            self.touch()
            if kind == 'clock_pong':
                pong = parse_clock_pong(normalize_pong(message))
                sent = self.stream.pings.pop(pong.ping_id, None)
                if sent is None or sent != pong.server_send_ms or pong.clock_id != self.clock_id:
                    raise MessageError('invalid_clock_pong')
                self.stream.clock.add(pong.clock_id, sent, pong.device_time_ms, server_now_ms())
            elif kind == 'pose_2d':
                pose = parse_pose_2d(normalize_pose(message, 'live'), rt.settings.camera_ids)
                if pose.clock_id != self.clock_id:
                    raise MessageError('clock_mismatch')
                accept_pose(self.stream, pose, server_now_ms(), rt.settings)
                self.send({'type': 'pose_received', 'stream_id': self.stream.stream_id,
                           'frame_id': pose.frame_id, 'clock_ready': self.stream.clock.ready})
            else:
                raise MessageError('unsupported_message')
        except MessageError as exc:
            if self.stream:
                self.stream.rejected[exc.code] += 1
            self.send({'type': 'error', 'code': exc.code, 'detail': exc.detail})

    async def ping(self, stream):
        n = 0
        while self.registry.is_current(stream):
            n += 1
            sent = server_now_ms()
            stream.pings[n] = sent
            while len(stream.pings) > 64:
                stream.pings.pop(next(iter(stream.pings)))
            self.send({'type': 'clock_ping', 'ping_id': n, 'server_time_ms': sent})
            settings = self.runtime.settings
            await asyncio.sleep(settings.clock_ping_interval_s / 10 if n < settings.clock_fast_pings
                                else settings.clock_ping_interval_s)

    async def stop_pinger(self):
        if self.pinger:
            self.pinger.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.pinger
            self.pinger = None

    async def close(self):
        await self.stop_pinger()
        if self.stream and self.registry.unregister(self.stream):
            self.runtime.broadcast_status()
