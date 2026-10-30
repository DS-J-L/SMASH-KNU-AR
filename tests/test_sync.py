from backend.ingest.registry import ReceivedFrame, Stream
from backend.ingest.schemas import Pose2D, Wrist
from backend.sync.clock import DeviceClock
from backend.sync.frame_aligner import FrameAligner


def test_min_rtt_sample_wins_over_asymmetric_ones():
    c = DeviceClock()
    offset = 5000.0
    for i, (down, up) in enumerate([(40, 5), (3, 3), (5, 60), (20, 25)]):
        send = 1000.0 * i
        c.add("clk", send, send + down + offset, send + down + up)
    assert c.ready and abs(c.offset_ms - offset) < 1e-9 and c.uncertainty_ms == 3.0
    assert c.to_server("clk", 10_000 + offset) == 10_000


def test_new_clock_id_discards_old_samples():
    c = DeviceClock()
    for i in range(3):
        c.add("page-1", i, i + 1, i + 2)
    assert c.ready
    c.add("page-2", 10, 11, 12)
    assert not c.ready and c.to_server("page-1", 5) is None


def _frame(cid, t, u=100.0):
    pose = Pose2D(True, cid, "d", "s", 0, None, 1280, 720, 0, "raw_distorted_pixels", t, "clk",
                  "capture_metadata", {"left_wrist": Wrist(u, 100.0, 0.9, True), "right_wrist": None})
    return ReceivedFrame(pose, t, t, 1.0)


def _stream(cid, times, us=None):
    s = Stream(cid, "d", True, None, 0.0)
    for i, t in enumerate(times):
        s.frames.append(_frame(cid, t, us[i] if us else 100.0))
    return s


def test_aligner_waits_for_slowest_camera_within_max_wait():
    a = FrameAligner(max_skew_ms=45, max_wait_ms=100)
    sel = a.select({"C0": _stream("C0", [970, 1003, 1036]), "C1": _stream("C1", [950, 983, 1016]),
                    "C2": _stream("C2", [960])})
    assert sel.t_ms == 960                          # C2 lags 73 ms: everyone waits for it
    assert set(sel.frames) == {"C0", "C1", "C2"} and sel.skew_ms <= 45
    assert a.select({"C2": _stream("C2", [960])}) is None   # same T is not emitted twice


def test_camera_lagging_beyond_max_wait_does_not_hold_others_back():
    a = FrameAligner(max_skew_ms=45, max_wait_ms=100)
    sel = a.select({"C0": _stream("C0", [1000, 1033]), "C1": _stream("C1", [1010]),
                    "C2": _stream("C2", [900])})
    assert sel.t_ms == 1010 and set(sel.frames) == {"C0", "C1"}
    assert sel.excluded == {"C2": "time_skew"}


def test_interpolation_lands_on_reference_time():
    a = FrameAligner(max_skew_ms=45, align_mode="interpolate")
    sel = a.select({"C0": _stream("C0", [1000]), "C1": _stream("C1", [990, 1020], us=[0.0, 300.0])})
    f = sel.frames["C1"]
    assert f.aligned_capture_at_server_ms == 1000 and abs(f.pose.wrists["left_wrist"].u_px - 100.0) < 1e-9
    assert sel.skew_ms == 0.0
