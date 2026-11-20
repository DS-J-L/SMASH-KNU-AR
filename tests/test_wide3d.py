"""Test-only wide stage /ws/test/wide3d: three single-camera phones on markers ID0/ID1/ID2 in a row."""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.building_scenes import (STAGE_HEIGHT_BAND_M, STAGE_MAX_DEPTH_M, STAGE_MAX_WIDTH_M, STAGE_MIN_HEIGHT_M,
                                     STAGE_MIN_SQUEEZE, campus_size, parse_wide_scene, scene_spec, stage_axes,
                                     stage_buildings, stage_sets, stage_size, wide_scene_id)
from backend.server import create_app
from backend.settings import load_settings
from backend.test_wide3d import WideStage, parse_calibration

KEY = "s3cret"
# Camera 2 m in front of its marker, 1 m high, looking along +Y: x_cam = X, y_cam = -Z, z_cam = Y.
R = [1, 0, 0, 0, 0, -1, 0, 1, 0]


def calib(camera, waist=None, ref_id=None):
    message = {"type": "mono3d_calib", "marker_id": int(camera[1]), "image": {"width": 640, "height": 480},
               "K": {"fx": 500, "fy": 500, "cx": 320, "cy": 240},
               "camera": {"R": R, "t": [0, 1, 2], "C": [0, -2, 1]}, "marker_side_m": 0.2}
    if waist:
        message["body"] = {"model_reference": {"id": ref_id or f"ref-{camera}", "waist_height_m": waist}}
    return message


def frame(anchor_x, wrist=None, valid=True):
    joints = {"left_hip": [anchor_x, 0.3, 0.9], "right_hip": [anchor_x + 0.2, 0.3, 0.9]}
    if wrist:
        joints["right_wrist"] = wrist
    return {"type": "mono3d_frame", "valid": valid, "anchor_m": [anchor_x, 0.3, 0] if valid else None,
            "joints": joints if valid else None}


def receive_until(ws, kind, check=lambda m: True, limit=40):
    for _ in range(limit):
        message = ws.receive_json()
        if message["type"] == kind and check(message):
            return message
    raise AssertionError(f"{kind} not received")


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key=KEY))) as c:
        yield c


def phone(client, camera):
    return client.websocket_connect(f"/ws/test/wide3d?role=phone&camera={camera}&key={KEY}")


def viewer(client):
    return client.websocket_connect(f"/ws/test/wide3d?role=viewer&key={KEY}")


def test_access_key_and_camera_are_required(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/test/wide3d?role=viewer") as ws:
            ws.receive_json()
    assert exc.value.code == 4401
    with client.websocket_connect(f"/ws/test/wide3d?role=phone&camera=C3&key={KEY}") as ws:
        assert ws.receive_json()["code"] == "bad_role_or_camera"


def building_at(scene_id, near_x):
    """The stage building whose centre is nearest near_x: (x, height)."""
    b = min(scene_spec(scene_id)["render"], key=lambda b: abs(b["offset"][0] - near_x))
    return b["offset"][0], b["height_m"]


def test_stage_sets_hold_one_big_building_each_and_fit_the_stage():
    """2026-11-20: one building per set, 1.0~1.2 m tall, footprint within 2.0 x 1.5 m (squeezed at most by half)."""
    used = stage_buildings()
    assert len(stage_axes()) == 61 and len(used) == 56
    for i in stage_axes():
        w, h, d = stage_size(i)
        kx, ky, kz = stage_axes()[i]
        assert w <= STAGE_MAX_WIDTH_M + 1e-9 and d <= STAGE_MAX_DEPTH_M + 1e-9 and h <= STAGE_HEIGHT_BAND_M[1] + 1e-9
        assert min(kx, kz) >= STAGE_MIN_SQUEEZE * ky - 1e-9 and max(kx, kz) <= ky + 1e-9   # footprint only squeezed
        if h >= STAGE_HEIGHT_BAND_M[0] - 1e-9:
            # Kept its height: an axis is squeezed only when it would be too long.
            cw, ch, cd = campus_size(i)
            assert kx == pytest.approx(ky) or w == pytest.approx(STAGE_MAX_WIDTH_M)
            assert kz == pytest.approx(ky) or d == pytest.approx(STAGE_MAX_DEPTH_M)
        assert (i in used) == (h >= STAGE_MIN_HEIGHT_M - 1e-9)
    heights = sorted(stage_size(i)[1] for i in used)
    assert heights[len(heights) // 2] >= 1.0 - 1e-9
    for sections, spacing in ((3, 1.5), (3, 1.0), (2, 2.0)):
        sets = stage_sets(sections, spacing)
        assert [g["packages"] for g in sets] == [[i] for i in used]
        assert all(g["fits"] for g in sets)   # 2 m never exceeds these stages (>= 3 m wide)
    first = stage_sets(3, 1.5)[0]
    spec = scene_spec(wide_scene_id(first["id"], 1.5))
    assert spec["layout"] == "wide_row" and spec["fixed_size"] is True and spec["wide"]["fit_scale"] == 1
    assert parse_wide_scene(spec["id"]) == (first["id"], 1.5, 0.0)
    assert spec["dimensions_m"][0] <= 4.5 + 1e-6 and spec["building_count"] == len(first["packages"])
    # Rendered sizes are the stage sizes, per axis.
    for b, i in zip(spec["render"], first["packages"]):
        assert b["height_m"] == pytest.approx(stage_size(i)[1], rel=1e-6) and len(b["scale"]) == 3
    # Colliders follow the same per-axis size and stand on the floor.
    pts = [(f["vertices_m"][k] + f["rest_position_m"][k % 3]) for f in spec["colliders"]["fragments"] for k in range(len(f["vertices_m"]))]
    for axis, size in enumerate(stage_size(first["packages"][0])):
        vals = pts[axis::3]
        assert max(vals) - min(vals) == pytest.approx(size, rel=1e-3)
    # A narrow stage (0.5 m spacing, 1 m for two sections) shrinks the building as a whole.
    narrow = scene_spec(wide_scene_id(stage_sets(2, 0.5)[0]["id"], 0.5, None, "duo:"))
    assert narrow["wide"]["fit_scale"] < 1 and narrow["dimensions_m"][0] <= 1.0 + 1e-6
    xs = [b["offset"][0] for b in spec["render"]]
    assert xs == sorted(xs) and xs[0] == pytest.approx(-xs[-1]) and all(b["offset"][1:] == [0, 0] for b in spec["render"])
    for bad in ("wide:nope:1500:0", f"wide:{first['id']}:100:0", f"wide:{first['id']}:1500:x", "wide:s99:1500:0"):
        with pytest.raises(ValueError):
            scene_spec(bad)


def test_marker_id_must_match_camera_and_calibration_is_shifted_to_the_stage(client):
    with viewer(client) as pc, phone(client, "C0") as c0:
        state = receive_until(pc, "multi3d_model_state")
        assert state["model_test"]["stage"]["spacing_m"] == 1.5 and state["model_test"]["scene_id"].startswith("wide:")
        c0.send_json({**calib("C0"), "marker_id": 1})
        assert receive_until(c0, "error")["code"] == "marker_id_mismatch"
        c0.send_json(calib("C0"))
        shifted = receive_until(pc, "multi3d_calib")
        assert shifted["camera_id"] == "C0" and shifted["marker_offset_m"] == [-1.5, 0, 0]
        assert shifted["C"] == [-1.5, -2, 1]
        # A marker-frame point P maps to the same pixel as stage point P + offset.
        P = [0.3, 0.5, 0.8]
        cam = [sum(R[3 * i + k] * P[k] for k in range(3)) + [0, 1, 2][i] for i in range(3)]
        Q = [P[0] - 1.5, P[1], P[2]]
        cam2 = [sum(R[3 * i + k] * Q[k] for k in range(3)) + shifted["t"][i] for i in range(3)]
        assert cam2 == pytest.approx(cam)
        status = receive_until(pc, "wide3d_status", lambda m: m["cameras"]["C0"]["calibrated"])
        assert status["cameras"]["C0"]["marker_x_m"] == -1.5


def test_nearest_marker_phone_judges_with_hysteresis_and_joints_are_shifted(client):
    with viewer(client) as pc, phone(client, "C0") as c0, phone(client, "C1") as c1:
        c0.send_json(calib("C0"))
        c1.send_json(calib("C1"))
        receive_until(pc, "wide3d_status", lambda m: m["cameras"]["C0"]["calibrated"] and m["cameras"]["C1"]["calibrated"])
        # Person at stage x = -1.4: C0 sees it at marker x 0.1, C1 at marker x -1.4.
        c1.send_json(frame(-1.4))
        first = receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1")
        assert first["owner"] == "C1" and first["joints"]["left_hip"][0] == -1.4
        c0.send_json(frame(0.1))
        shifted = receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C0")
        assert shifted["joints"]["left_hip"][0] == pytest.approx(-1.4) and shifted["owner"] == "C0"
        # Halfway between the markers, small differences keep the current phone.
        c1.send_json(frame(-0.80))
        assert receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1")["owner"] == "C0"
        c0.send_json(frame(0.75))
        assert receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C0")["owner"] == "C0"
        # Clearly in C1's section: hand over.
        c1.send_json(frame(-0.3))
        assert receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1")["owner"] == "C1"
        c1.send_json(frame(0, valid=False))
        c0.send_json(frame(0, valid=False))
        assert receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C0")["owner"] is None


def test_owner_swing_breaks_the_building_and_other_phones_do_not_judge(client):
    with viewer(client) as pc, phone(client, "C1") as c1, phone(client, "C2") as c2:
        state = receive_until(pc, "multi3d_model_state")["model_test"]
        c1.send_json(calib("C1"))
        c2.send_json(calib("C2"))
        receive_until(pc, "wide3d_status", lambda m: m["cameras"]["C2"]["calibrated"] and m["cameras"]["C1"]["calibrated"])
        lo, hi = state["bounds"]["lo"], state["bounds"]["hi"]
        x, height = building_at(state["scene_id"], 0.5)   # a building in C1's section (marker x 0)
        z = min(0.2, height / 2)
        # The person stands beside that building (C1 owns); C2 sends the same swing from the side.
        for y in (lo[1] - 0.5, lo[1] - 0.25, (lo[1] + hi[1]) / 2):
            c2.send_json(frame(-1.0, wrist=[x - 1.5, y, z]))
            c1.send_json(frame(0.5, wrist=[x, y, z]))
            time.sleep(0.05)
        hit = receive_until(pc, "multi3d_model_state", lambda m: m["model_test"].get("event"))["model_test"]
        assert hit["event"]["joint"] == "right_wrist" and hit["removed_ids"] and hit["stage"]["owner"] == "C1"
        assert abs(hit["event"]["point_m"][0] - x) < 0.45   # struck at that building, not a neighbour


def test_body_calibration_does_not_resize_stage_buildings(client):
    with viewer(client) as pc, phone(client, "C0") as c0:
        default = receive_until(pc, "multi3d_model_state")["model_test"]
        c0.send_json(calib("C0", waist=1.0))
        locked = receive_until(pc, "multi3d_model_state", lambda m: m["model_test"]["body_reference"])["model_test"]
        # Sizes come from the 0.7~0.8 m width rule only; the body reference is kept for display.
        assert locked["scene_id"] == default["scene_id"] and locked["stage"]["reference_camera"] == "C0"
        assert locked["stage"]["height_m"] == pytest.approx(scene_spec(default["scene_id"])["wide"]["height_m"])


def test_viewer_changes_spacing_and_zone_but_not_free_placement(client):
    with viewer(client) as pc, phone(client, "C2") as c2:
        receive_until(pc, "multi3d_model_state")
        c2.send_json(calib("C2"))
        assert receive_until(pc, "multi3d_calib")["marker_offset_m"] == [1.5, 0, 0]
        pc.send_json({"type": "wide3d_stage_config", "spacing_m": 2.0})
        assert receive_until(pc, "multi3d_calib")["marker_offset_m"] == [2.0, 0, 0]
        state = receive_until(pc, "multi3d_model_state", lambda m: m["model_test"]["stage"]["spacing_m"] == 2.0)["model_test"]
        assert ":2000:" in state["scene_id"]
        sets = stage_sets(3, 2.0)
        assert state["stage"]["zone_id"] == sets[0]["id"]   # the set holding the same first building
        pc.send_json({"type": "wide3d_stage_config", "spacing_m": 10})
        assert "spacing_m" in receive_until(pc, "error")["detail"]
        pc.send_json({"type": "multi3d_model_scene", "scene_id": sets[3]["id"]})
        assert receive_until(pc, "multi3d_model_state", lambda m: m["model_test"]["stage"]["zone_id"] == sets[3]["id"])
        # A spacing change keeps the set that holds the same first building.
        pc.send_json({"type": "wide3d_stage_config", "spacing_m": 1.5})
        first = sets[3]["packages"][0]
        moved = receive_until(pc, "multi3d_model_state", lambda m: m["model_test"]["stage"]["spacing_m"] == 1.5)["model_test"]
        assert first in next(g for g in stage_sets(3, 1.5) if g["id"] == moved["stage"]["zone_id"])["packages"]
        pc.send_json({"type": "multi3d_model_scene", "scene_id": "north-gate-arts-01"})
        assert "unknown scene_id" in receive_until(pc, "error")["detail"]
        pc.send_json({"type": "multi3d_model_scene", "scene_id": "it1"})
        assert "unknown scene_id" in receive_until(pc, "error")["detail"]
        pc.send_json({"type": "multi3d_model_config", "placement": {"x_m": 1}})
        assert "markers" in receive_until(pc, "error")["detail"]


def test_hidden_owner_wrist_is_borrowed_from_a_neighbour_seeing_the_same_person(client):
    with viewer(client) as pc, phone(client, "C1") as c1, phone(client, "C2") as c2:
        state = receive_until(pc, "multi3d_model_state")["model_test"]
        c1.send_json(calib("C1"))
        c2.send_json(calib("C2"))
        receive_until(pc, "wide3d_status", lambda m: m["cameras"]["C2"]["calibrated"] and m["cameras"]["C1"]["calibrated"])
        lo, hi = state["bounds"]["lo"], state["bounds"]["hi"]
        x, height = building_at(state["scene_id"], 0.5)
        z = min(0.2, height / 2)
        # Person at stage x = 0.5 (C1 owns). C1 cannot see the right wrist; C2 sees it swing into that building.
        c1.send_json(frame(0.5))
        for y in (lo[1] - 0.5, lo[1] - 0.25, (lo[1] + hi[1]) / 2):
            c2.send_json(frame(-1.0, wrist=[x - 1.5, y, z]))
            c1.send_json(frame(0.5))
            time.sleep(0.05)
        judged = receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1" and m["borrowed"])
        assert judged["owner"] == "C1" and judged["borrowed"] == {"right_wrist": "C2"}
        assert judged["joints"]["right_wrist"][0] == pytest.approx(x, abs=1e-3)
        hit = receive_until(pc, "multi3d_model_state", lambda m: m["model_test"].get("event"))["model_test"]
        assert hit["event"]["joint"] == "right_wrist" and hit["removed_ids"] and hit["stage"]["owner"] == "C1"
        assert hit["stage"]["borrowed"] == {"right_wrist": "C2"} and abs(hit["event"]["point_m"][0] - x) < 0.45


def test_another_person_in_the_neighbour_section_is_not_borrowed(client):
    with viewer(client) as pc, phone(client, "C0") as c0, phone(client, "C1") as c1:
        c0.send_json(calib("C0"))
        c1.send_json(calib("C1"))
        receive_until(pc, "wide3d_status", lambda m: m["cameras"]["C0"]["calibrated"] and m["cameras"]["C1"]["calibrated"])
        c1.send_json(frame(0.5))
        receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1")
        # C0 sees someone at stage x = -0.5: 1 m away from C1's person, so it is not the same person.
        c0.send_json(frame(1.0, wrist=[1.0, 0, 0.3]))
        c1.send_json(frame(0.5))
        judged = receive_until(pc, "wide3d_frame", lambda m: m["camera_id"] == "C1")
        assert judged["owner"] == "C1" and judged["borrowed"] == {} and "right_wrist" not in judged["joints"]


def test_switching_a_joint_source_cuts_its_path_instead_of_striking():
    stage = WideStage()
    asyncio.run(stage.rebuild())
    for camera in ("C1", "C2"):
        stage.calibs[camera] = parse_calibration(camera, calib(camera))
    lo, hi = stage.model.snapshot()["bounds"]["lo"], stage.model.snapshot()["bounds"]["hi"]
    x, height = building_at(stage.scene_id(), 0.5)   # a real building, so a wrongly joined path would strike it
    z, inside = min(0.2, height / 2), (lo[1] + hi[1]) / 2
    _, state = stage.on_frame("C1", frame(0.5, wrist=[x, lo[1] - 0.4, z]))
    assert stage.owner == "C1" and stage.joint_sources == {"right_wrist": "C1"}
    time.sleep(0.03)
    # C1 loses the wrist; C2's estimate of it is inside the building. The jump is two estimates, not a swing.
    stage.on_frame("C2", frame(-1.0, wrist=[x - 1.5, inside, z]))
    _, state = stage.on_frame("C1", frame(0.5))
    assert stage.borrowed() == {"right_wrist": "C2"} and not state.get("event") and not stage.model.removed
    time.sleep(0.03)
    _, state = stage.on_frame("C1", frame(0.5, wrist=[x, inside, z]))
    assert stage.joint_sources == {"right_wrist": "C1"} and not state.get("event") and not stage.model.removed
    # Too old a neighbour frame is not borrowed.
    stage.frames["C2"]["at"] -= 1000
    stage.on_frame("C1", frame(0.5))
    assert stage.borrowed() == {}
