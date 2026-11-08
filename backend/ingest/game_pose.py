"""Convert validated raw pixels to the PC game's normalized wrist representation."""
def game_pose(frame):
    pose = frame.pose
    wrists = {}
    for name, point in pose.wrists.items():
        reason = 'not_detected' if point is None else 'out_of_frame' if not point.in_frame else 'low_visibility' if point.visibility < .5 else None
        wrists[name] = {'valid': reason is None, 'image_norm':
            [point.u_px / pose.width, point.v_px / pose.height] if reason is None else None,
            'visibility': point.visibility if point else None, 'reason': reason}
    return {'stream_id': pose.stream_id, 'frame_id': pose.frame_id, 'wrists': wrists,
            'source': 'live', 'capture_time_ms': pose.capture_time_ms,
            'timestamp_source': pose.timestamp_source}
