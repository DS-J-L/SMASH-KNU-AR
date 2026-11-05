"""Adapter for the phone contract in origin/feat/p1-camera-mediapipe.

Keep browser timestamp provenance intact; accepting a message does not authorize 3D.
"""
from .schemas import MessageError, Register, _check_header, _camera_id, _str


def parse_hello(msg, camera_ids):
    _check_header(msg, 'camera_hello')
    source = msg.get('source')
    if source not in ('live', 'replay'):
        raise MessageError('invalid_field', 'source must be live or replay')
    _str(msg, 'clock_id')
    return Register(_camera_id(msg, camera_ids), _str(msg, 'device_id'),
                    source == 'replay', _str(msg, 'stream_id'))


def normalize_pose(msg, source):
    if msg.get('source') != source or msg.get('sample_only') is not False:
        raise MessageError('sample_flag_mismatch', 'source must match camera_hello')
    # The phone branch labels replay as sample_only=false; never let replay look live.
    msg = {**msg, 'sample_only': source == 'replay'}
    joints = msg.get('joints')
    if isinstance(joints, dict):
        msg['joints'] = {
            name: None if isinstance(joint, dict) and joint.get('visibility', 'missing') is None else joint
            for name, joint in joints.items()
        }
    return msg


def normalize_pong(msg):
    return {**msg, 'schema_version': '0.1',
            'server_send_ms': msg.get('server_time_ms'),
            'device_time_ms': msg.get('client_time_ms')}
