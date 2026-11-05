"""Room-local 60-second video-check sessions; actual hit scoring is not connected."""
import time
from .ingest.schemas import MessageError
from .sync.clock import server_now_ms
from .room_config import ROOM_CAMERAS


class GameSessions:
    def __init__(self, monotonic=time.monotonic):
        self.now = monotonic
        self.current = {}
        self.history = {}

    def start(self, member, message, members):
        if member.role != 'monitor':
            raise MessageError('monitor_required')
        sid = message.get('session_id')
        if not isinstance(sid, str) or not sid.strip() or len(sid) > 128:
            raise MessageError('invalid_session_id')
        if message.get('mode') != 'video_check':
            raise MessageError('game_not_connected')
        reported = message.get('cameras')
        actual = {m.camera_id: m.connection_id for m in members.values() if m.role == 'camera'}
        required = ROOM_CAMERAS.get(member.room_id, ())
        if not required or set(actual) != set(required):
            raise MessageError('camera_not_ready')
        if not isinstance(reported, list) or not 1 <= len(reported) <= 3:
            raise MessageError('camera_not_ready')
        checked = {}
        for item in reported:
            if not isinstance(item, dict) or not isinstance(item.get('camera_id'), str):
                raise MessageError('camera_not_ready')
            cid = item['camera_id']
            if cid in checked or actual.get(cid) != item.get('connection_id') or item.get('video_ready') is not True:
                raise MessageError('camera_not_ready')
            checked[cid] = item['connection_id']
        if checked != actual:
            raise MessageError('camera_not_ready')
        signature = (member.device_id, tuple(sorted(checked.items())), message['mode'])
        key = (member.room_id, sid)
        if key in self.history:
            previous = self.history[key]
            if previous['signature'] != signature:
                raise MessageError('session_conflict')
            if self.current.get(member.room_id) is not previous:
                raise MessageError('old_session')
            return self.status(member.room_id)
        current = self.status(member.room_id)
        if current and current['state'] == 'playing':
            raise MessageError('session_in_progress')
        if len(self.history) >= 1000:
            raise MessageError('session_limit')
        session = {'session_id': sid, 'room_id': member.room_id, 'signature': signature,
                   'started': self.now(), 'started_at_server_ms': server_now_ms(),
                   'state': 'playing', 'camera_ids': sorted(checked), 'reason': None}
        self.current[member.room_id] = self.history[key] = session
        return self.status(member.room_id)

    def status(self, room_id):
        s = self.current.get(room_id)
        if not s:
            return None
        elapsed = s.get('ended_elapsed_ms', min(60000, max(0, (self.now() - s['started']) * 1000)))
        if s['state'] == 'playing' and elapsed >= 60000:
            s['state'], s['reason'] = 'ended', 'time_up'
            s['ended_elapsed_ms'] = elapsed
        return {'session_id': s['session_id'], 'room_id': room_id, 'mode': 'video_check',
                'state': s['state'], 'duration_ms': 60000, 'remaining_ms': max(0, 60000 - elapsed) if s['state'] == 'playing' else 0,
                'elapsed_ms': elapsed, 'started_at_server_ms': s['started_at_server_ms'],
                'camera_ids': s['camera_ids'], 'score': None, 'reason': s['reason']}

    def _end(self, room_id, reason):
        current = self.status(room_id)
        if current and current['state'] == 'playing':
            session = self.current[room_id]
            session['state'], session['reason'] = 'ended', reason
            session['ended_elapsed_ms'] = current['elapsed_ms']
        return self.status(room_id)

    def stop(self, member, message):
        if member.role != 'monitor':
            raise MessageError('monitor_required')
        current = self.status(member.room_id)
        if not current or message.get('session_id') != current['session_id']:
            raise MessageError('session_mismatch')
        reason = message.get('reason', 'manual_stop')
        if reason not in ('manual_stop', 'camera_stalled'):
            raise MessageError('invalid_stop_reason')
        return self._end(member.room_id, reason)

    def camera_disconnected(self, room_id, camera_id):
        current = self.status(room_id)
        if current and camera_id in current['camera_ids']:
            self._end(room_id, 'camera_disconnected')
