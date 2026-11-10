"""backend/foot_strike.py against the shared cases (the browser twin runs the same file)."""
import json
from pathlib import Path

import pytest

from backend.foot_strike import CONFIG, FootStrikeJudge, standing_in_building

CASES = json.loads((Path(__file__).parent / "fixtures" / "foot_strike_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_case(case):
    judge = FootStrikeJudge()
    for frame in case["frames"]:
        out = judge.update(frame["positions"], case["box"], frame["t_ms"])
        for key, want in frame["expect"].items():
            assert out[key] == want, (frame["t_ms"], key)
    assert judge.hits == case["hits"]


def test_the_mean_of_both_feet_would_have_blocked_the_kick_beside_the_building():
    # Why the planted foot is used: test_multi3d.py averages both ankles, which lands inside the clearance.
    box = {"center": [1.0, 0.0, 0.475], "half": [0.15, 0.15, 0.475]}
    feet = {"left_ankle": [0.72, 0.0, 0.08], "right_ankle": [1.0, 0.0, 0.5]}
    mean_x = (0.72 + 1.0) / 2
    assert abs(mean_x - box["center"][0]) <= box["half"][0] + CONFIG.stand_clearance_m
    assert standing_in_building(feet, box) is False


def test_reset_and_bad_points():
    judge = FootStrikeJudge()
    box = {"center": [1.0, 0.0, 0.475], "half": [0.15, 0.15, 0.475]}
    judge.update({"right_ankle": [0.7, 0, 0.4]}, box, 0)
    assert judge.update({"right_ankle": [0.95, 0, 0.45]}, box, 33)["hit"] == {"right_ankle": "inside"}
    judge.reset()
    assert judge.hits == 0
    out = judge.update({"right_ankle": [0.95, 0, float("nan")], "left_ankle": [1, 2]}, box, 66)
    assert out["decisions"] == {"left_ankle": "invalid", "right_ankle": "invalid"}
    # No person at all: nothing to judge, no crash.
    assert judge.update(None, box, 99)["decisions"] == {"left_ankle": "invalid", "right_ankle": "invalid"}
