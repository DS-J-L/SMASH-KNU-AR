"""pose_2d acceptance for one registered stream: identity checks, frame order, clock conversion.

The server adds received_at_server_ms, aligned_capture_at_server_ms and clock_uncertainty_ms.
aligned_capture_at_server_ms stays None when the capture time is missing, its source is not in
tracking.allowed_timestamp_sources, or the device clock is not known yet; such frames are still
received (2D input is visible in status) but never used for 3D.
"""

from __future__ import annotations

from ..settings import Settings
from .registry import ReceivedFrame, Stream
from .schemas import MessageError, Pose2D


def accept_pose(stream: Stream, pose: Pose2D, now_ms: float, settings: Settings) -> ReceivedFrame:
    if pose.camera_id != stream.camera_id:
        raise MessageError("camera_id_mismatch", f"stream is registered as {stream.camera_id}")
    if pose.stream_id != stream.stream_id:
        raise MessageError("stream_mismatch", "use the stream_id from the latest registered message")
    if pose.device_id != stream.device_id:
        raise MessageError("device_mismatch", "device_id differs from registration")
    if pose.sample_only != stream.sample_only:
        raise MessageError("sample_flag_mismatch", "sample_only differs from registration")
    if stream.last_frame_id is not None:
        if pose.frame_id == stream.last_frame_id:
            raise MessageError("duplicate_frame", str(pose.frame_id))
        if pose.frame_id < stream.last_frame_id:
            raise MessageError("out_of_order_frame", f"{pose.frame_id} < {stream.last_frame_id}")

    aligned = None
    if pose.capture_time_ms is not None and pose.timestamp_source in settings.tracking.allowed_timestamp_sources:
        aligned = stream.clock.to_server(pose.clock_id, pose.capture_time_ms)

    frame = ReceivedFrame(pose, now_ms, aligned, stream.clock.uncertainty_ms if aligned is not None else None)
    stream.last_frame_id = pose.frame_id
    stream.frames.append(frame)
    stream.arrivals.append(now_ms)
    return frame
