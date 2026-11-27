"""tools/pck_eval.py on synthetic 2-camera-stage sessions (no RTMPose: a fake reference model)."""
import csv
import json
from pathlib import Path

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
pytest.importorskip("pingouin")

from tools import pck_eval as pe  # noqa: E402

CALIB_W, CALIB_H = 960, 720          # phone video size used for calibration
IMG_W, IMG_H = 480, 360              # saved JPEG size (calibration image resized)
K = {"fx": 800.0, "fy": 800.0, "cx": 480.0, "cy": 360.0}
R = [1, 0, 0, 0, 1, 0, 0, 0, 1]
T = [0.0, 0.0, 3.0]
SCHEDULE = [("right_punch", 2.0), ("left_punch", 2.0), ("kick", 2.0)]
START = 10_000.0                     # server_ms of the 'directed_start' marker


def body(dx: float) -> dict:
    """A standing person in the phone's marker frame (metres)."""
    y = {"nose": -0.8, "left_shoulder": -0.6, "right_shoulder": -0.6, "left_elbow": -0.35, "right_elbow": -0.35,
         "left_wrist": -0.1, "right_wrist": -0.1, "left_hip": 0.0, "right_hip": 0.0,
         "left_knee": 0.4, "right_knee": 0.4, "left_ankle": 0.8, "right_ankle": 0.8}
    x = {n: (0.2 if n.startswith("left") else -0.2 if n.startswith("right") else 0.0) for n in y}
    return {n: [x[n] + dx, y[n], 0.0] for n in y}


def to_px(p):
    c = np.array(p) + np.array(T)
    u = K["fx"] * c[0] / c[2] + K["cx"]
    v = K["fy"] * c[1] / c[2] + K["cy"]
    return np.array([u * IMG_W / CALIB_W, v * IMG_H / CALIB_H])


ERROR_PX = {"right_punch": 2.0, "left_punch": 4.0, "kick": 40.0}   # reference vs system disagreement
TRUTH: dict[int, tuple[np.ndarray, str]] = {}


def write_session(root: Path, pid: str, skill: float, missing_wrist: bool = False, noise_px: float = 0.0) -> None:
    rng = np.random.default_rng(int(pid[1:]))
    s = root / f"s_{pid}"
    (s / "frames" / "C0").mkdir(parents=True)
    (s / "meta.json").write_text(json.dumps({"session_id": s.name, "participant": pid}))
    calib = {"type": "mono3d_calib", "image": {"width": CALIB_W, "height": CALIB_H}, "K": K,
             "camera": {"R": R, "t": T}}
    (s / "calib.jsonl").write_text(json.dumps({"camera": "C0", "server_ms": 0, "msg": calib}) + "\n")
    (s / "markers.jsonl").write_text(json.dumps({"server_ms": START, "label": "directed_start"}) + "\n")
    frames, joints = [], []
    for i in range(-3, 30):                      # 5 images/s, a few before the start marker
        server_ms = START + i * 200
        t_ms = 50_000 + i * 200
        motion = pe.motion_at(server_ms, START, SCHEDULE)
        key = len(TRUTH) + 1
        img = np.zeros((IMG_H, IMG_W, 3), np.uint8)
        img[0, 0] = (key % 256, key // 256, 0)  # PNG keeps it exact: the fake reference reads it back
        name = f"frames/C0/{t_ms}.png"
        cv2.imwrite(str(s / name), img)
        sysj = body(0.0)
        if missing_wrist:
            sysj["right_wrist"] = None
        err = ERROR_PX.get(motion or "", 0.0) * skill
        ref = np.array([to_px(body(0.0)[n]) for n in pe.JOINTS])
        names = list(pe.JOINTS)
        if motion == "kick":
            ref[[names.index("left_ankle"), names.index("right_ankle")], 0] += err
        else:
            ref[:, 0] += err
        if motion and noise_px:
            ref += rng.normal(0, noise_px * (2.0 if motion == "kick" else 1.0), ref.shape)
        TRUTH[key] = (ref, motion)
        frames.append({"camera": "C0", "file": name, "t_ms": t_ms + 20, "server_ms": server_ms,
                       "width": CALIB_W, "height": CALIB_H})
        joints.append({"camera": "C0", "t_ms": t_ms, "server_ms": server_ms, "valid": True, "owner": True,
                       "joints": sysj})
    (s / "frames.jsonl").write_text("".join(json.dumps(f) + "\n" for f in frames))
    (s / "joints.jsonl").write_text("".join(json.dumps(j) + "\n" for j in joints))


def fake_reference(img):
    key = int(img[0, 0, 0]) + 256 * int(img[0, 0, 1])
    ref13, _ = TRUTH[key]
    kps = np.zeros((2, 17, 2))
    scores = np.full((2, 17), 0.9)
    for n, j in pe.JOINTS.items():
        kps[0, j] = ref13[list(pe.JOINTS).index(n)]
    kps[1] = kps[0] + [200, 0]                 # a second person (operator) far from the prediction
    scores[0, [1, 2, 3, 4]] = 0.1              # eyes/ears unused
    return kps, scores


def test_projection_matches_known_pixels():
    cal = pe.parse_calib({"server_ms": 0, "msg": {"image": {"width": CALIB_W, "height": CALIB_H}, "K": K,
                                                  "camera": {"R": R, "t": T}}})
    p = pe.project(cal, {"nose": [0.0, -0.8, 0.0]}, IMG_W, IMG_H)["nose"]
    assert np.allclose(p, to_px([0.0, -0.8, 0.0]))


def test_motion_schedule():
    assert pe.motion_at(START - 1, START, SCHEDULE) is None
    assert pe.motion_at(START + 1999, START, SCHEDULE) == "right_punch"
    assert pe.motion_at(START + 4500, START, SCHEDULE) == "kick"
    assert pe.motion_at(START + 6000, START, SCHEDULE) is None


def test_pck_values_exact(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    write_session(root, "P01", 1.0)
    write_session(root, "P04", 1.0, missing_wrist=True)
    out = tmp_path / "results"
    result = pe.run(root, out, fake_reference, SCHEDULE)
    summary = {(r["participant"], r["motion"]): float(r["pck"])
               for r in csv.DictReader((out / "pck_summary.csv").open())}
    # punches: every joint within 0.2 x torso (~19 px); kick: both ankles 40 px off -> 11/13
    assert summary[("P01", "right_punch")] == pytest.approx(1.0)
    assert summary[("P01", "kick")] == pytest.approx(11 / 13, abs=1e-3)
    # a joint the system did not output counts as wrong
    assert summary[("P04", "right_punch")] == pytest.approx(12 / 13, abs=1e-3)
    # 30 directed images per session (6 s x 5/s); images before the start marker are skipped
    assert result["row_status_counts"]["missing_prediction"] == 30
    assert (root / "s_P01" / "reference_rtmpose.jsonl").exists()
    # 2 participants: still an F value; Mauchly cannot run, so the uncorrected ANOVA is reported
    assert result["rm_anova"][0]["ddof2"] == 2
    assert "sphericity" in result.get("stat_errors", {})


def test_anova_over_participants(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    for i, skill in enumerate([1.0, 1.2, 0.8, 1.1, 0.9, 1.0, 1.3, 0.7, 1.05], start=1):
        write_session(root, f"P{i:02d}", skill, noise_px=10.0)
    result = pe.run(root, tmp_path / "r", fake_reference, SCHEDULE)
    assert result["n_participants"] == 9
    assert set(result["motions"]) == {"right_punch", "left_punch", "kick"}
    a = result["rm_anova"][0]
    assert (a["ddof1"], a["ddof2"]) == (2, 16)
    assert a["p_unc"] < 0.05                      # kick is clearly worse in this synthetic data
    assert result["means"]["kick"] < result["means"]["right_punch"]
    assert "friedman" in result and len(result["pairwise_t_holm"]) == 3
    # cached reference is reused on a second run
    again = pe.run(root, tmp_path / "r2", lambda img: (_ for _ in ()).throw(AssertionError("not cached")),
                   SCHEDULE)
    assert again["means"] == result["means"]


def test_two_participants_minimum(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    write_session(root, "P01", 1.0)
    result = pe.run(root, tmp_path / "r", fake_reference, SCHEDULE)
    assert "need at least 2" in result["error"]
