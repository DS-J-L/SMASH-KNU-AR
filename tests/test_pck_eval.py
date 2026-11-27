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
K = {"fx": 800.0, "fy": 800.0, "cx": 480.0, "cy": 360.0, "width": CALIB_W, "height": CALIB_H}
R = [1, 0, 0, 0, 1, 0, 0, 0, 1]
T = [0.0, 0.0, 3.0]
SCHEDULE = [("right_punch", 2.0), ("left_punch", 2.0), ("kick", 2.0)]
START = 10_000.0                     # server_ms of the 'directed_start' marker
ERROR_PX = {"right_punch": 2.0, "left_punch": 4.0, "kick": 40.0}   # reference vs system disagreement
NAMES = list(pe.JOINTS)
TRUTH: dict[int, np.ndarray] = {}


def body(dx: float = 0.0) -> dict:
    """A standing person in the phone's marker frame (metres)."""
    y = {"nose": -0.8, "left_shoulder": -0.6, "right_shoulder": -0.6, "left_elbow": -0.35, "right_elbow": -0.35,
         "left_wrist": -0.1, "right_wrist": -0.1, "left_hip": 0.0, "right_hip": 0.0,
         "left_knee": 0.4, "right_knee": 0.4, "left_ankle": 0.8, "right_ankle": 0.8}
    x = {n: (0.2 if n.startswith("left") else -0.2 if n.startswith("right") else 0.0) for n in y}
    return {n: [x[n] + dx, y[n], 0.0] for n in y}


def to_px(p):
    c = np.array(p) + np.array(T)
    return np.array([(K["fx"] * c[0] / c[2] + K["cx"]) * IMG_W / CALIB_W,
                     (K["fy"] * c[1] / c[2] + K["cy"]) * IMG_H / CALIB_H])


def landmarks(joints: dict) -> list:
    """33 normalized MediaPipe landmarks consistent with the 3D joints (as the phone sends them)."""
    out = [[0.0, 0.0, 0.0]] * 33
    for n, i in pe.MEDIAPIPE.items():
        if joints.get(n) is not None:
            px = to_px(joints[n])
            out[i] = [px[0] / IMG_W, px[1] / IMG_H, 0.99]
    return out


def frame_line(t_ms, server_ms, joints, owner=True, valid=True):
    return {"camera": "C0", "server_ms": server_ms, "owner": owner,
            "msg": {"type": "mono3d_frame", "t_ms": t_ms, "valid": valid,
                    "joints": joints if valid else None, "landmarks": landmarks(joints)}}


def write_session(root: Path, pid: str, skill: float = 1.0, missing_wrist: bool = False, noise_px: float = 0.0,
                  owner=True, untracked_kick: bool = False) -> None:
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
        t_img = 50_000 + i * 200                 # phone time of the inference the JPEG shows
        motion = pe.motion_at(server_ms, START, SCHEDULE)
        key = len(TRUTH) + 1
        img = np.zeros((IMG_H, IMG_W, 3), np.uint8)
        img[0, 0] = (key % 256, key // 256, 0)  # PNG keeps it exact: the fake reference reads it back
        name = f"frames/C0/{t_img}.png"
        cv2.imwrite(str(s / name), img)
        sysj = body()
        if missing_wrist:
            sysj["right_wrist"] = None
        err = ERROR_PX.get(motion or "", 0.0) * skill
        ref = np.array([to_px(body()[n]) for n in NAMES])
        if motion == "kick":
            ref[[NAMES.index("left_ankle"), NAMES.index("right_ankle")], 0] += err
        else:
            ref[:, 0] += err
        if motion and noise_px:
            ref += rng.normal(0, noise_px * (2.0 if motion == "kick" else 1.0), ref.shape)
        TRUTH[key] = ref
        frames.append({"camera": "C0", "file": name, "t_ms": t_img, "server_ms": server_ms})
        # The previous inference's frame was sent 3 ms before this image's time: nearest in time, but stale.
        joints.append(frame_line(t_img - 3, server_ms - 3, body(dx=0.5), owner))
        # This image's frame is sent 40 ms later (inference + send delay).
        joints.append(frame_line(t_img + 40, server_ms + 40, sysj, owner,
                                 valid=not (untracked_kick and motion == "kick")))
    (s / "frames.jsonl").write_text("".join(json.dumps(f) + "\n" for f in frames))
    (s / "joints.jsonl").write_text("".join(json.dumps(j) + "\n" for j in joints))


def fake_reference(img):
    ref13 = TRUTH[int(img[0, 0, 0]) + 256 * int(img[0, 0, 1])]
    kps = np.zeros((2, 17, 2))
    scores = np.full((2, 17), 0.9)
    for n, j in pe.JOINTS.items():
        kps[0, j] = ref13[NAMES.index(n)]
    kps[1] = kps[0] + [200, 0]                 # a second person (operator) far from the prediction
    scores[0, [1, 2, 3, 4]] = 0.1              # eyes/ears unused
    return kps, scores


def read_summary(out: Path) -> dict:
    return {(r["participant"], r["motion"]): r for r in csv.DictReader((out / "pck_summary.csv").open())}


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


def test_frame_for_image_takes_first_frame_after_the_image():
    times = [997.0, 1040.0, 1073.0]
    assert pe.frame_for_image(times, 1000.0) == 1          # not 997, although it is nearer
    assert pe.frame_for_image(times, 1040.0) == 1
    assert pe.frame_for_image(times, 1100.0) is None       # nothing after
    assert pe.frame_for_image([2000.0], 1000.0) is None    # too late to be the same inference


def test_pck_values_exact(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    write_session(root, "P01")
    write_session(root, "P04", missing_wrist=True)
    out = tmp_path / "results"
    result = pe.run(root, out, fake_reference, SCHEDULE)
    summary = read_summary(out)
    # punches: every joint within 0.2 x torso (~19 px); kick: both ankles 40 px off -> 11/13.
    # A stale frame (0.5 m off) would give 0 here, so this also checks the frame matching.
    assert float(summary[("P01", "right_punch")]["pck"]) == pytest.approx(1.0)
    assert float(summary[("P01", "kick")]["pck"]) == pytest.approx(11 / 13, abs=1e-3)
    # a joint the system did not output counts as wrong
    assert float(summary[("P04", "right_punch")]["pck"]) == pytest.approx(12 / 13, abs=1e-3)
    # 30 directed images per session (6 s x 5/s); images before the start marker are skipped
    assert result["row_status_counts"]["missing_prediction"] == 30
    assert (root / "s_P01" / "reference_rtmpose.jsonl").exists()
    # projected joints land on the phone's own 2D landmarks
    assert result["projection_check_px"]["median"] < 0.5
    # 2 participants: still an F value; Mauchly cannot run, so the uncorrected ANOVA is reported
    assert result["rm_anova"][0]["ddof2"] == 2
    assert "sphericity" in result.get("stat_errors", {})


def test_untracked_images_count_as_wrong_and_are_reported(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    write_session(root, "P01", untracked_kick=True)
    out = tmp_path / "results"
    pe.run(root, out, fake_reference, SCHEDULE)
    summary = read_summary(out)
    assert float(summary[("P01", "kick")]["pck"]) == 0.0
    assert float(summary[("P01", "kick")]["tracked_rate"]) == 0.0
    assert float(summary[("P01", "right_punch")]["tracked_rate"]) == 1.0


def test_only_the_judging_phone_is_scored(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    write_session(root, "P01", owner=False)
    out = tmp_path / "results"
    assert pe.run(root, out, fake_reference, SCHEDULE)["error"] == "no data"
    assert pe.run(root, out, fake_reference, SCHEDULE, owner_only=False)["means"]["right_punch"] == 1.0


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


def test_one_participant_is_not_enough(tmp_path):
    TRUTH.clear()
    root = tmp_path / "pck"
    write_session(root, "P01")
    result = pe.run(root, tmp_path / "r", fake_reference, SCHEDULE)
    assert "need at least 2" in result["error"]
