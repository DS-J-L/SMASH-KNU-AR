"""Test-only duo stage /ws/test/duo3d: judging phones C0/C1 on markers ID0/ID1 and a view-only phone V."""
import time

import pytest
from fastapi.testclient import TestClient

from backend.building_scenes import DUO_PREFIX, scene_spec, stage_sets, wide_scene_id
from backend.server import create_app
from backend.settings import load_settings
from tests.test_wide3d import KEY, R, building_at, calib, frame, receive_until

# The view phone 3.3 m behind the markers (+Y), 1.6 m high, looking back toward -Y.
VIEW_R = [-1, 0, 0, 0, 0, -1, 0, -1, 0]


def view_calib(spacing=2.0):
    C = [0, 3.3, 1.6]
    t = [-sum(VIEW_R[3 * i + k] * C[k] for k in range(3)) for i in range(3)]
    return {"type": "wide3d_view_calib", "image": {"width": 1920, "height": 1080},
            "K": {"fx": 1400, "fy": 1400, "cx": 960, "cy": 540}, "camera": {"R": VIEW_R, "t": t, "C": C},
            "marker_ids": [0, 1], "spacing_m": spacing, "marker_side_m": 0.27, "reprojection_max_px": 0.8}


@pytest.mark.parametrize('spacing',[float('nan'),float('inf'),float('-inf')])
def test_view_calibration_refuses_nonfinite_marker_spacing(spacing):
    from backend.test_wide3d import parse_view_calibration
    with pytest.raises(ValueError,match='spacing_mismatch'):
        parse_view_calibration(view_calib(spacing),2.0)


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key=KEY))) as c:
        yield c


def connect(client, role, camera=None):
    extra = f"&camera={camera}" if camera else ""
    return client.websocket_connect(f"/ws/test/duo3d?role={role}{extra}&key={KEY}")


def test_duo_scene_rows_fit_two_sections():
    sets = stage_sets(2, 2.0)
    for g in sets:
        spec = scene_spec(wide_scene_id(g["id"], 2.0, None, DUO_PREFIX))
        assert spec["layout"] == "wide_row" and spec["wide"]["sections"] == 2 and spec["id"].startswith("duo:")
        assert spec["dimensions_m"][0] <= 4.0 + 1e-6 and spec["wide"]["fit_scale"] == 1
    # 2026-11-20: one big building per set, centred between the two markers, at least 0.6 m tall.
    for g in sets:
        render = scene_spec(wide_scene_id(g["id"], 2.0, None, DUO_PREFIX))["render"]
        assert len(render) == 1 and render[0]["offset"] == [0, 0, 0] and render[0]["height_m"] >= 0.6 - 1e-9
    assert {g["building_count"] for g in sets} == {1}
    assert scene_spec(wide_scene_id(sets[0]["id"], 2.0, None, DUO_PREFIX))["label"].endswith("2대 무대")


def test_duo_judging_phones_sit_at_half_spacing_and_c2_is_refused(client):
    with connect(client, "viewer") as pc, connect(client, "phone", "C0") as c0, connect(client, "phone", "C1") as c1:
        state = receive_until(pc, "multi3d_model_state")["model_test"]
        assert state["scene_id"].startswith("duo:") and state["stage"]["layout"] == "duo" and state["stage"]["spacing_m"] == 2.0
        assert {c: m["x_m"] for c, m in state["stage"]["markers"].items()} == {"C0": -1.0, "C1": 1.0}
        c0.send_json(calib("C0"))
        assert receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "C0")["marker_offset_m"] == [-1.0, 0, 0]
        c1.send_json(calib("C1"))
        assert receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "C1")["marker_offset_m"] == [1.0, 0, 0]
        status = receive_until(c1, "mono3d_status", lambda m: m.get("markers"))
        assert status["layout"] == "duo" and status["markers"] == {"0": -1.0, "1": 1.0}
        # Person at stage x 0.8: C1 (marker x 1.0) judges.
        c1.send_json(frame(-0.2))
        assert receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1")["owner"] == "C1"
    with connect(client, "phone", "C2") as c2:
        assert c2.receive_json()["code"] == "bad_role_or_camera"


def test_view_phone_is_the_main_screen_but_never_judges(client):
    with connect(client, "viewer") as pc, connect(client, "phone", "V") as v:
        receive_until(pc, "multi3d_model_state")
        status = receive_until(v, "mono3d_status", lambda m: m.get("markers"))
        assert status["camera"] == "V" and status["spacing_m"] == 2.0 and status["view_calibrated"] is False
        v.send_json(view_calib(spacing=1.5))
        refused = receive_until(v, "error")
        assert refused["code"] == "spacing_mismatch" and refused["spacing_m"] == 2.0
        v.send_json(view_calib())
        shown = receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "V")
        assert shown["role"] == "view" and shown["C"] == [0, 3.3, 1.6] and shown["marker_offset_m"] == [0, 0, 0]
        status = receive_until(pc, "wide3d_status", lambda m: m["view"]["calibrated"])
        assert status["view"]["camera_height_m"] == 1.6 and status["view"]["reprojection_max_px"] == 0.8
        v.send_json({"type": "mono3d_jpeg", "data": "data:image/jpeg;base64,AAAA", "t_ms": 1})
        assert receive_until(pc, "multi3d_jpeg", lambda m: m["camera_id"] == "V")["data"].endswith("AAAA")
        v.send_json(frame(0.0))
        assert receive_until(v, "error")["code"] == "unsupported_message"
        v.send_json({**calib("C0"), "marker_id": 0})
        assert receive_until(v, "error")["code"] == "unsupported_message"
        # Moving the markers makes the view pose stale: hidden until V solves again with the new positions.
        pc.send_json({"type": "wide3d_stage_config", "spacing_m": 2.4})
        assert receive_until(pc, "multi3d_phone_left", lambda m: m["camera_id"] == "V")["reason"] == "spacing_changed"
        again = receive_until(v, "mono3d_status", lambda m: m.get("spacing_m") == 2.4)
        assert again["markers"] == {"0": -1.2, "1": 1.2} and again["view_calibrated"] is False
        v.send_json(view_calib(spacing=2.4))
        assert receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "V")["spacing_m"] == 2.4


def test_a_late_viewer_gets_the_view_pose_and_judging_swings_break_buildings(client):
    with connect(client, "phone", "V") as v, connect(client, "phone", "C1") as c1:
        receive_until(v, "mono3d_status", lambda m: m.get("markers"))
        v.send_json(view_calib())
        c1.send_json(calib("C1"))
        receive_until(c1, "mono3d_status", lambda m: m.get("markers"))
        time.sleep(0.1)
        with connect(client, "viewer") as pc:
            seen = {}
            for _ in range(20):
                m = pc.receive_json()
                if m["type"] == "multi3d_calib":
                    seen[m["camera_id"]] = m
                if m["type"] == "multi3d_model_state":
                    state = m["model_test"]
                    break
            assert set(seen) == {"C1", "V"}
            lo, hi = state["bounds"]["lo"], state["bounds"]["hi"]
            x, height = building_at(state["scene_id"], 1.5)   # the right-most building, in C1's section
            z = min(0.2, height / 2)
            # The person on marker ID1 (stage x 1.0), swinging into it (C1 marker frame = stage - 1.0).
            for y in (lo[1] - 0.5, lo[1] - 0.25, (lo[1] + hi[1]) / 2):
                c1.send_json(frame(0.0, wrist=[x - 1.0, y, z]))
                time.sleep(0.05)
            hit = receive_until(pc, "multi3d_model_state", lambda m: m["model_test"].get("event"))["model_test"]
            assert hit["stage"]["owner"] == "C1" and abs(hit["event"]["point_m"][0] - x) < 0.45


def test_view_phone_gets_the_judging_joints_in_the_stage_frame_and_sends_its_outline(client):
    with connect(client, "viewer") as pc, connect(client, "phone", "V") as v, connect(client, "phone", "C1") as c1:
        receive_until(pc, "multi3d_model_state")
        receive_until(v, "mono3d_status", lambda m: m.get("markers"))
        v.send_json(view_calib())
        c1.send_json(calib("C1"))
        receive_until(c1, "mono3d_status", lambda m: m.get("markers"))
        # C1's marker frame x -0.2 is stage x 0.8: V gets the owner's joints already shifted.
        c1.send_json(frame(-0.2))
        person = receive_until(v, "duo_person")
        assert person["camera_id"] == "C1" and person["source"] == "mono_approx"
        assert person["joints"]["left_hip"] == pytest.approx([0.8, 0.3, 0.9])
        # An invalid frame is not depth for V's outline.
        c1.send_json(frame(0.0, valid=False))
        v.send_json({"type": "mono3d_jpeg", "data": "data:image/jpeg;base64,BBBB", "t_ms": 2,
                     "occlusion": {"encoding": "camera_z_mm_rg16_alpha_v1", "width": 384, "height": 216,
                                   "data": "data:image/png;base64,AAAA"},
                     "occlusion_valid": True, "occlusion_reason": "실제 사람 가림"})
        shown = receive_until(pc, "multi3d_jpeg", lambda m: m["camera_id"] == "V" and m["data"].endswith("BBBB"))
        assert shown["occlusion_valid"] is True and shown["occlusion"]["width"] == 384
        # The next depth V gets is the next valid owner frame, never one from the invalid frame.
        c1.send_json(frame(0.1))
        assert receive_until(v, "duo_person")["joints"]["left_hip"] == pytest.approx([1.1, 0.3, 0.9])


def test_video_only_frames_carry_the_last_outline_until_a_new_one_or_none(client):
    mask = {"encoding": "camera_z_mm_rg16_alpha_v1", "width": 384, "height": 216, "data": "data:image/png;base64,MASK"}
    with connect(client, "viewer") as pc, connect(client, "phone", "V") as v:
        receive_until(pc, "multi3d_model_state")
        jpeg = lambda tag, t, **extra: v.send_json({"type": "mono3d_jpeg", "data": "data:image/jpeg;base64," + tag, "t_ms": t, **extra})
        shown = lambda tag: receive_until(pc, "multi3d_jpeg", lambda m: m["camera_id"] == "V" and m["data"].endswith(tag))
        # No outline yet: a video-only frame has nothing to carry.
        jpeg("K0", 1, occlusion_keep=True, occlusion_valid=True)
        first = shown("K0")
        assert first["occlusion"] is None and first["occlusion_valid"] is False and first["occlusion_keep"] is False
        jpeg("M1", 10, occlusion=mask, occlusion_valid=True)
        outline = shown("M1")
        assert outline["occlusion_t_ms"] == 10 and outline["occlusion_keep"] is False and outline["occlusion_valid"] is True
        jpeg("K1", 20, occlusion_keep=True, occlusion_valid=True)
        kept = shown("K1")
        assert kept["occlusion"] == mask and kept["occlusion_t_ms"] == 10 and kept["occlusion_keep"] is True and kept["t_ms"] == 20
        # An outline frame without a person ends the carried outline.
        jpeg("M2", 30, occlusion=None, occlusion_valid=False)
        assert shown("M2")["occlusion_valid"] is False
        jpeg("K2", 40, occlusion_keep=True, occlusion_valid=True)
        gone = shown("K2")
        assert gone["occlusion"] is None and gone["occlusion_valid"] is False


def test_view_phone_layout_measurement_reaches_the_pc_and_judging_phones_cannot_send_it(client):
    layout = {"type": "wide3d_view_layout", "spacing_m": 2.0512, "entered_spacing_m": 2.0, "yaw_deg": [-0.84, 2.16],
              "relative_yaw_deg": 3.0, "reprojection_max_px": 0.6, "warn": ["spacing", "yaw", "junk"]}
    with connect(client, "viewer") as pc, connect(client, "phone", "V") as v, connect(client, "phone", "C0") as c0:
        receive_until(pc, "multi3d_model_state")
        receive_until(v, "mono3d_status", lambda m: m.get("markers"))
        # Sent even before (or without) a rigid calibration: the PC sees the measurement either way.
        v.send_json(layout)
        status = receive_until(pc, "wide3d_status", lambda m: (m["view"] or {}).get("layout"))
        assert status["view"]["layout"] == {"spacing_m": 2.0512, "entered_spacing_m": 2.0, "yaw_deg": [-0.84, 2.16],
                                            "reprojection_max_px": 0.6, "warn": ["spacing", "yaw"]}
        assert status["view"]["calibrated"] is False
        v.send_json({**layout, "yaw_deg": [0, 400]})
        assert receive_until(v, "error")["code"] == "bad_message"
        v.send_json({**layout, "spacing_m": "2"})
        assert receive_until(v, "error")["code"] == "bad_message"
        c0.send_json(layout)
        assert receive_until(c0, "error")["code"] == "bad_message"
        # Applying the measured spacing keeps the measurement (it is physical), the view pose must be solved again.
        pc.send_json({"type": "wide3d_stage_config", "spacing_m": 2.051})
        status = receive_until(pc, "wide3d_status", lambda m: m["spacing_m"] == 2.051)
        assert status["view"]["layout"]["spacing_m"] == 2.0512
    # V gone: its measurement goes with it.
    with connect(client, "viewer") as pc:
        status = receive_until(pc, "wide3d_status")
        assert status["view"]["connected"] is False and status["view"]["layout"] is None


def test_measured_spacing_is_applied_by_itself_unless_turned_off(client):
    """2026-11-20: no fixed 2 m. V's measured spacing becomes the stage spacing (auto on by default)."""
    layout = {"type": "wide3d_view_layout", "entered_spacing_m": 2.0, "yaw_deg": [0.2, -0.3],
              "relative_yaw_deg": -0.5, "reprojection_max_px": 0.5, "warn": ["spacing"]}
    with connect(client, "viewer") as pc, connect(client, "phone", "V") as v, connect(client, "phone", "C0") as c0:
        receive_until(pc, "multi3d_model_state")
        assert receive_until(pc, "wide3d_status")["view"]["auto_spacing"] is True
        v.send_json({**layout, "spacing_m": 2.4})
        # The re-laid stage (model state) goes out first, then the status with the new spacing.
        assert receive_until(pc, "multi3d_model_state", lambda m: m["model_test"]["stage"]["spacing_m"] == 2.4)
        status = receive_until(pc, "wide3d_status", lambda m: m["spacing_m"] == 2.4)
        assert status["view"]["layout"]["spacing_m"] == 2.4
        assert receive_until(c0, "mono3d_status", lambda m: m.get("spacing_m") == 2.4)["markers"] == {"0": -1.2, "1": 1.2}
        # Within 5 mm: noise, the stage stays.
        v.send_json({**layout, "spacing_m": 2.403})
        assert receive_until(pc, "wide3d_status", lambda m: m["view"]["layout"]["spacing_m"] == 2.403)["spacing_m"] == 2.4
        # Outside the stage range (0.5~3 m): shown, never applied.
        v.send_json({**layout, "spacing_m": 3.6})
        assert receive_until(pc, "wide3d_status", lambda m: m["view"]["layout"]["spacing_m"] == 3.6)["spacing_m"] == 2.4
        # Off: the measurement is only shown; turning it on again applies the last measurement.
        pc.send_json({"type": "duo_auto_spacing", "enabled": False})
        assert receive_until(pc, "wide3d_status", lambda m: m["view"]["auto_spacing"] is False)
        v.send_json({**layout, "spacing_m": 1.8})
        assert receive_until(pc, "wide3d_status", lambda m: m["view"]["layout"]["spacing_m"] == 1.8)["spacing_m"] == 2.4
        pc.send_json({"type": "duo_auto_spacing", "enabled": True})
        assert receive_until(pc, "wide3d_status", lambda m: m["view"]["auto_spacing"] and m["spacing_m"] == 1.8)
        pc.send_json({"type": "duo_auto_spacing", "enabled": "yes"})
        assert receive_until(pc, "error")["code"] == "bad_message"


def test_webrtc_signals_are_relayed_between_the_pc_and_the_view_phone_only(client):
    """2026-11-20: offer/answer/ICE pass through the server; the video goes phone -> PC directly."""
    with connect(client, "viewer") as pc:
        pc_id = receive_until(pc, "rtc_hello")["id"]
        assert isinstance(pc_id, str) and len(pc_id) == 12
        pc.send_json({"type": "rtc_signal", "to": "V", "data": {"type": "offer", "sdp": "x"}})
        assert receive_until(pc, "rtc_signal_failed")["reason"] == "not_connected"
        with connect(client, "phone", "V") as v, connect(client, "phone", "C0") as c0:
            receive_until(v, "mono3d_status")
            pc.send_json({"type": "rtc_signal", "to": "V", "data": {"type": "offer", "sdp": "v=0"}})
            got = receive_until(v, "rtc_signal")
            assert got == {"type": "rtc_signal", "from": pc_id, "data": {"type": "offer", "sdp": "v=0"}}
            v.send_json({"type": "rtc_signal", "to": pc_id, "data": {"type": "answer", "sdp": "v=0"}})
            assert receive_until(pc, "rtc_signal") == {"type": "rtc_signal", "from": "V", "data": {"type": "answer", "sdp": "v=0"}}
            v.send_json({"type": "rtc_signal", "to": "nobody", "data": {"type": "ice"}})
            assert receive_until(v, "rtc_signal_failed")["to"] == "nobody"
            v.send_json({"type": "rtc_signal", "to": pc_id, "data": "not an object"})
            assert receive_until(v, "error")["code"] == "bad_message"
            # A judging phone has no WebRTC role.
            c0.send_json({"type": "rtc_signal", "to": pc_id, "data": {"type": "answer"}})
            assert receive_until(c0, "error")["code"] == "unsupported_message"
            with connect(client, "viewer") as pc2:
                pc2_id = receive_until(pc2, "rtc_hello")["id"]
                assert pc2_id != pc_id
            # That PC left: V is told to drop its connection.
            assert receive_until(v, "rtc_signal", lambda m: m["from"] == pc2_id)["data"] == {"type": "bye"}


def test_only_the_duo_stage_breaks_a_whole_swing_path():
    import asyncio
    from backend.test_wide3d import WideStage
    duo, wide = WideStage("duo"), WideStage("wide")
    asyncio.run(duo.rebuild()); asyncio.run(wide.rebuild())
    assert duo.model.sweep is True and wide.model.sweep is False


def test_measured_marker_poses_turn_and_move_the_judging_coordinates_until_turned_off(client):
    # 2026-11-22: V's floor pose of each marker (its own frame, the building's) corrects that judging phone's frame.
    import math
    poses = {"0": {"center_m": [-1.0, 0.0], "yaw_deg": 0.0}, "1": {"center_m": [1.05, 0.03], "yaw_deg": 3.0}}
    a = math.radians(3.0)
    expect = lambda q: [1.05 + math.cos(a) * q[0] - math.sin(a) * q[1], 0.03 + math.sin(a) * q[0] + math.cos(a) * q[1]]
    with connect(client, "viewer") as pc, connect(client, "phone", "C1") as c1, connect(client, "phone", "V") as v:
        receive_until(pc, "multi3d_model_state")
        c1.send_json(calib("C1"))
        plain = receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "C1")
        assert plain["marker_offset_m"] == [1.0, 0, 0] and plain["marker_yaw_deg"] == 0
        v.send_json({**view_calib(), "marker_poses": {"0": {"center_m": [0, 0]}}})
        assert receive_until(v, "error")["code"] == "bad_message"
        v.send_json({**view_calib(), "marker_poses": poses})
        fixed = receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "C1" and m["marker_yaw_deg"])
        assert fixed["marker_offset_m"] == [1.05, 0.03, 0] and fixed["marker_yaw_deg"] == 3.0
        cx, cy = expect([0, -2])
        assert all(abs(u - w) < 1e-9 for u, w in zip(fixed["C"], [cx, cy, 1]))
        status = receive_until(pc, "wide3d_status", lambda m: m["cameras"]["C1"]["correction"]["applied"])
        assert status["view"]["auto_rotation"] is True and status["cameras"]["C1"]["correction"]["yaw_deg"] == 3.0
        c1.send_json(frame(0.0, wrist=[0.3, -1.2, 0.5]))
        seen = receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1" and m["joints"])
        x, y = expect([0.3, -1.2])
        assert abs(seen["joints"]["right_wrist"][0] - x) < 1e-3 and abs(seen["joints"]["right_wrist"][1] - y) < 1e-3
        # Turned off on the PC: back to the plain spacing shift.
        pc.send_json({"type": "duo_auto_rotation", "enabled": False})
        off = receive_until(pc, "multi3d_calib", lambda m: m["camera_id"] == "C1" and m["marker_yaw_deg"] == 0)
        assert off["marker_offset_m"] == [1.0, 0, 0]
        c1.send_json(frame(0.0, wrist=[0.3, -1.2, 0.5]))
        seen = receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1" and m["joints"])
        assert seen["joints"]["right_wrist"][:2] == [1.3, -1.2]
        # A pose far from the nominal one is a misread: ignored even when the correction is on.
        pc.send_json({"type": "duo_auto_rotation", "enabled": True})
        v.send_json({**view_calib(), "marker_poses": {**poses, "1": {"center_m": [1.0, 0.0], "yaw_deg": 30.0}}})
        status = receive_until(pc, "wide3d_status", lambda m: m["view"]["auto_rotation"] and m["cameras"]["C1"]["correction"]["measured"]
                               and m["cameras"]["C1"]["correction"]["measured"][2] == 30.0)
        assert status["cameras"]["C1"]["correction"]["applied"] is False



def test_the_wide_stage_never_uses_marker_poses():
    from backend.test_wide3d import WideStage
    wide = WideStage("wide")
    wide.view_calib = {"marker_poses": {0: (-1.4, 0.1, 5.0), 1: (0.1, 0.0, 5.0)}}
    assert wide.marker_pose("C0") == (wide.marker_x("C0"), 0.0, 0.0)
    assert wide.to_stage("C0", [0.2, -1.0, 0.5]) == [wide.marker_x("C0") + 0.2, -1.0, 0.5]
