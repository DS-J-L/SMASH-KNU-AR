import copy

import numpy as np
import pytest

from backend.calibration.storage import CalibrationError, calibration_dict, parse_calibration
from synthetic import synthetic_rig


@pytest.fixture
def data():
    return calibration_dict(synthetic_rig()["C0"])


def test_round_trip_and_matching(data):
    cal = parse_calibration(data, "C0")
    assert not cal.measured
    assert cal.mismatch(device_id=cal.device_id, calibration_id=cal.calibration_id,
                        width=1280, height=720, rotation_deg=0) is None
    assert cal.mismatch(device_id="other", calibration_id=cal.calibration_id,
                        width=1280, height=720, rotation_deg=0) == "device_id"
    assert cal.mismatch(device_id=cal.device_id, calibration_id=cal.calibration_id,
                        width=1280, height=720, rotation_deg=90) == "rotation"


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d.update(source="guess"), "source"),
    (lambda d: d.update(camera_id="C1"), "camera_id"),
    (lambda d: d["R_world_to_camera"][0].__setitem__(0, 2.0), "rotation"),
    (lambda d: d.update(K=[[1, 0], [0, 1]]), "shape"),
    (lambda d: d["t_world_to_camera_m"].__setitem__(0, float("nan")), "NaN"),
    (lambda d: d.update(world={"frame": "three_y_up", "units": "m"}), "world"),
    (lambda d: d.update(dist=[0.1, 0.2]), "dist"),
])
def test_invalid_calibration_is_rejected(data, mutate, message):
    bad = copy.deepcopy(data)
    mutate(bad)
    with pytest.raises(CalibrationError, match=message):
        parse_calibration(bad, "C0")


def test_normalize_removes_distortion_once(data):
    d = copy.deepcopy(data)
    d["dist"] = [0.1, -0.05, 0, 0, 0]
    cal = parse_calibration(d, "C0")
    import cv2
    X = np.array([[0.3, 0.2, 1.1]])
    rvec, _ = cv2.Rodrigues(cal.R)
    distorted, _ = cv2.projectPoints(X, rvec, cal.t, cal.K, cal.dist)
    norm = cal.normalize(distorted.reshape(-1, 2), distorted=True)[0]
    xc = cal.R @ X[0] + cal.t
    assert np.allclose(norm, xc[:2] / xc[2], atol=1e-6)
