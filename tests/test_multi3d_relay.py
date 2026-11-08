"""Test-only 3-camera route /ws/test/multi3d: synthetic phones -> triangulation -> viewer."""
import json
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.server import create_app
from backend.settings import load_settings
from backend.test_multi3d import JOINTS, segment_hits_box, inside_box, waist_height

KEY = "s3cret"
W, H = 720, 1280
K = {"fx": 900.0, "fy": 900.0, "cx": 360.0, "cy": 640.0}


def look_at(eye, target=(0.0, 0.3, 0.8)):
    eye, target = np.array(eye, float), np.array(target, float)
    f = target - eye; f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1]); r /= np.linalg.norm(r)
    d = np.cross(f, r)
    R = np.vstack([r, d, f])
    return R, -R @ eye


CAMS = {"C0": look_at([0.0, -2.5, 1.0]), "C1": look_at([2.3, 1.0, 1.2]), "C2": look_at([-2.3, 1.2, 0.9])}


def person(wrist):
    pts = {name: np.array([0.0, 0.5, 1.0]) for name in JOINTS}
    pts.update(nose=np.array([0.0, 0.5, 1.56]), left_ankle=np.array([-0.1, 0.5, 0.08]),
               right_ankle=np.array([0.1, 0.5, 0.08]), right_wrist=np.array(wrist, float),
               left_wrist=np.array([-0.4, 0.5, 0.9]))
    return pts


def landmarks(cam, pts):
    R, t = CAMS[cam]
    rows = [[0.5, 0.5, 0.0]] * 33
    for name, P in pts.items():
        c = R @ P + t
        u, v = K["fx"] * c[0] / c[2] + K["cx"], K["fy"] * c[1] / c[2] + K["cy"]
        rows[JOINTS[name]] = [u / W, v / H, 0.99]
    return rows


def calib(cam):
    R, t = CAMS[cam]
    return {"type": "multi3d_calib", "image": {"width": W, "height": H}, "K": K, "R": R.ravel().tolist(), "t": t.tolist()}


def until(ws, check, limit=200):
    for _ in range(limit):
        m = ws.receive_json()
        if check(m):
            return m
    raise AssertionError("expected message not received")


@pytest.fixture
def client():
    with TestClient(create_app(load_settings(access_key=KEY))) as c:
        yield c


def test_geometry_helpers():
    c, h = [0, 0, 0.48], [0.15, 0.15, 0.48]
    assert inside_box(c, h, [0.1, 0, 0.9]) and not inside_box(c, h, [0.1, 0, 1.0])
    assert segment_hits_box(c, h, [-0.6, 0, 0.7], [0.6, 0, 0.7])
    assert not segment_hits_box(c, h, [-0.6, 0, 1.1], [0.6, 0, 1.1])
    assert waist_height(None) == 0.95 and abs(waist_height(1.7) - 1.02) < 1e-9 and waist_height(5) == 1.3


def test_three_phones_triangulate_and_hit(client):
    q = f"key={KEY}"
    with client.websocket_connect(f"/ws/test/multi3d?role=viewer&{q}") as viewer, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C0&{q}") as c0, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C1&{q}") as c1, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C2&{q}") as c2:
        phones = {"C0": c0, "C1": c1, "C2": c2}
        for cam, ws in phones.items():
            ws.send_text(json.dumps(calib(cam)))
        until(viewer, lambda m: m["type"] == "multi3d_status" and all(v["calibrated"] for v in m["cameras"].values()))

        def send_all(wrist):
            time.sleep(0.03)                 # the server fuses at most every 25 ms
            for cam, ws in phones.items():
                ws.send_text(json.dumps({"type": "multi3d_frame", "fps": 30, "landmarks": landmarks(cam, person(wrist))}))

        # Standing still for a while: true 3D, person height from the nose -> waist-high building.
        for _ in range(20):
            send_all([0.6, 0.5, 0.9])
        fused = until(viewer, lambda m: m["type"] == "multi3d_fused" and len(m["cameras_used"]) == 3
                      and m["building"]["estimated_height_m"] is not None)
        p = np.array(fused["joints"]["right_wrist"]["p"])
        assert np.linalg.norm(p - [0.6, 0.5, 0.9]) < 1e-3
        assert sorted(fused["joints"]["right_wrist"]["cams"]) == ["C0", "C1", "C2"]
        assert fused["source"] == "multi_view_test" and fused["timing"] == "server_arrival"
        height = fused["building"]["estimated_height_m"]
        assert abs(height - (1.56 - 0.0) / 0.92) < 0.02
        assert abs(fused["building"]["half"][2] * 2 - 0.6 * height) < 0.02

        # Wrist moves into the building at the marker -> one hit, reliably delivered.
        send_all([0.05, 0.0, 0.5])
        hit = until(viewer, lambda m: m["type"] == "multi3d_fused" and m["hit"])
        assert hit["hits"] == 1 and hit["hit"] == {"right_wrist": "inside"}

        # Viewer can change the building and reset hits.
        viewer.send_text(json.dumps({"type": "multi3d_config", "building": {"height": 1.2, "width": 0.4}}))
        cfg = until(viewer, lambda m: m["type"] == "multi3d_fused" and abs(m["building"]["half"][2] - 0.6) < 1e-9)
        assert cfg["building"]["half"][0] == 0.2 and cfg["building"]["auto_height"] is False
        viewer.send_text(json.dumps({"type": "multi3d_reset_hits"}))
        until(viewer, lambda m: m["type"] == "multi3d_fused" and m["hits"] == 0)


def test_one_view_is_not_3d_and_bad_input_is_refused(client):
    q = f"key={KEY}"
    with client.websocket_connect(f"/ws/test/multi3d?role=viewer&{q}") as viewer, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C0&{q}") as c0:
        c0.send_text(json.dumps(calib("C0")))
        c0.send_text(json.dumps({"type": "multi3d_frame", "landmarks": landmarks("C0", person([0.6, 0.5, 0.9]))}))
        fused = until(viewer, lambda m: m["type"] == "multi3d_fused")
        assert fused["joints"]["right_wrist"] is None and fused["reasons"]["right_wrist"] == "insufficient_views"
        assert fused["valid"] is False

        bad = calib("C0"); bad["R"] = [2, 0, 0, 0, 1, 0, 0, 0, 1]
        c0.send_text(json.dumps(bad))
        assert until(c0, lambda m: m["type"] == "error")["code"] == "bad_message"
        c0.send_text(json.dumps({"type": "multi3d_frame", "landmarks": [[0, 0]]}))
        assert until(c0, lambda m: m["type"] == "error")["code"] == "bad_message"
    with client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C9&{q}") as bad_cam:
        assert bad_cam.receive_json()["code"] == "bad_role_or_camera"


def swap_labels(rows):
    pairs = [(11, 12), (13, 14), (15, 16), (23, 24), (25, 26), (27, 28)]
    out = [list(r) for r in rows]
    for a, b in pairs:
        out[a], out[b] = out[b], out[a]
    return out


def test_swapped_left_right_view_and_standing_in_building(client):
    q = f"key={KEY}"
    with client.websocket_connect(f"/ws/test/multi3d?role=viewer&{q}") as viewer, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C0&{q}") as c0, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C1&{q}") as c1:
        for cam, ws in (("C0", c0), ("C1", c1)):
            ws.send_text(json.dumps(calib(cam)))

        def send(pts, swap_c1=True):
            time.sleep(0.03)
            c0.send_text(json.dumps({"type": "multi3d_frame", "landmarks": landmarks("C0", pts)}))
            rows = landmarks("C1", pts)
            c1.send_text(json.dumps({"type": "multi3d_frame", "landmarks": swap_labels(rows) if swap_c1 else rows}))

        # C1 labels left/right the other way (e.g. sees the back): the server swaps it back.
        send(person([0.6, 0.5, 0.9]))
        fused = until(viewer, lambda m: m["type"] == "multi3d_fused" and len(m["cameras_used"]) == 2 and m["joints"]["right_wrist"])
        assert fused["swapped_left_right"] == ["C1"]
        assert np.linalg.norm(np.array(fused["joints"]["right_wrist"]["p"]) - [0.6, 0.5, 0.9]) < 1e-3
        assert np.linalg.norm(np.array(fused["joints"]["left_wrist"]["p"]) - [-0.4, 0.5, 0.9]) < 1e-3

        # Person standing on the building spot with a hand inside it: no hit, a warning instead.
        on_spot = person([0.05, 0.0, 0.5])
        on_spot.update(left_ankle=np.array([-0.08, 0.0, 0.08]), right_ankle=np.array([0.08, 0.0, 0.08]))
        for _ in range(3):
            send(on_spot)
        standing = until(viewer, lambda m: m["type"] == "multi3d_fused" and m["standing_in_building"])
        assert standing["hits"] == 0 and standing["hit"] == {}


def test_cameras_facing_each_other_are_reported(client):
    q = f"key={KEY}"
    with client.websocket_connect(f"/ws/test/multi3d?role=viewer&{q}") as viewer, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C0&{q}") as c0, \
         client.websocket_connect(f"/ws/test/multi3d?role=phone&camera=C1&{q}") as c1:
        c0.send_text(json.dumps(calib("C0")))                       # front, y = -2.5
        R, t = look_at([0.1, 2.5, 1.0])                              # straight across: ~180°
        c1.send_text(json.dumps({**calib("C0"), "R": R.ravel().tolist(), "t": t.tolist()}))
        c0.send_text(json.dumps({"type": "multi3d_frame", "landmarks": None}))
        fused = until(viewer, lambda m: m["type"] == "multi3d_fused" and m["geometry_warnings"])
        assert fused["geometry_warnings"][0].startswith("C0-C1 facing:")
