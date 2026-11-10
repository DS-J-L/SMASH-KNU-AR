"""backend/model_strike.py against the shared cases (the browser twin runs the same file) and the real IT1 package."""
import json
import math
from pathlib import Path

import pytest

from backend.model_strike import (IT1_COLLIDERS, ModelStrikeConfig, ModelStrikeJudge, Placement, build_model_target,
                                  first_entry, hull_planes, inside_model, load_model_target, package_to_marker)

DOC = json.loads((Path(__file__).parent / "fixtures" / "model_strike_cases.json").read_text())


def judge_for(case, ids):
    target = build_model_target(DOC["package"], Placement(**case.get("placement", {})))
    return ModelStrikeJudge(target, ModelStrikeConfig(**case.get("config", {})), new_id=lambda: f"event-{next(ids)}")


@pytest.mark.parametrize("case", DOC["cases"], ids=[c["name"] for c in DOC["cases"]])
def test_shared_case(case):
    ids = iter(range(1, 100))
    judge = judge_for(case, ids)
    for frame in case["frames"]:
        if frame.get("action") == "restore":
            judge.restore()
        out = judge.update(frame["positions"], frame["t_ms"])
        want = frame["expect"]
        assert out["decisions"] == want["decisions"], frame["t_ms"]
        for key in ("support", "standing_in_building", "destroyed"):
            assert out[key] == want[key], (frame["t_ms"], key)
        if want["event"] is None:
            assert out["event"] is None, frame["t_ms"]
        else:
            for key in ("joint", "hit_by", "fragment_id"):
                assert out["event"][key] == want["event"][key], (frame["t_ms"], key)
            assert out["event"]["point_m"] == pytest.approx(want["event"]["point_m"], abs=1e-3)
    assert judge.hits == case["hits"]


def test_event_fields():
    judge = judge_for(DOC["cases"][0], iter(range(1, 100)))
    judge.update({"left_wrist": [-0.5, -0.6, 0.8]}, 0)
    event = judge.update({"left_wrist": [-0.5, -0.1, 0.8]}, 33)["event"]
    assert event["schema"] == "model_strike.v1-draft" and event["type"] == "hit_3d"
    assert event["event_id"] == "event-1" and event["building_id"] == "test-l-block"
    assert event["previous_t_ms"] == 0 and event["t_ms"] == 33
    assert event["speed_mps"] == round(0.5 / 0.033, 3)
    assert event["placement"] == {"x_m": 0.0, "y_m": 0.0, "yaw_deg": 0.0, "scale": 1.0}
    assert event["config_version"] == "model-3d-1"


def test_the_concave_notch_would_be_filled_by_one_convex_hull():
    # Why the union of fragment hulls is used: one hull around every point covers the empty notch.
    target = build_model_target(DOC["package"])
    corners = [[x, y, z] for x in (-1, 1) for y in (-0.25, 0.25) for z in (0, 0.5)] + \
              [[x, y, 1] for x in (-1, 0) for y in (-0.25, 0.25)]
    one_hull = hull_planes(corners)
    notch = [0.5, 0.0, 0.7]
    assert all(sum(n[k] * notch[k] for k in range(3)) - d <= 0 for n, d in one_hull)
    assert inside_model(target, notch) is None


def test_hull_planes_of_a_cube_and_a_flat_set():
    cube = [[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)]
    assert len(hull_planes(cube)) == 6
    # A flat fragment has no volume: fewer than 4 planes, so build_model_target leaves it out.
    assert len(hull_planes([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]])) < 4


def test_bad_input_is_rejected_or_ignored():
    with pytest.raises(ValueError):
        build_model_target({"coordinate_frame": "z_up", "fragments": []})
    with pytest.raises(ValueError):
        build_model_target(DOC["package"], Placement(scale=0))
    judge = ModelStrikeJudge(build_model_target(DOC["package"]))
    out = judge.update({"left_wrist": [0, float("nan"), 1], "right_wrist": [1, 2], "left_ankle": "x"}, 0)
    assert set(out["decisions"].values()) == {"invalid"}
    assert judge.update(None, 33)["decisions"]["left_wrist"] == "invalid"


@pytest.fixture(scope="module")
def it1():
    return load_model_target()


def test_it1_package_matches_its_manifest(it1):
    manifest = json.loads((IT1_COLLIDERS.parent / "manifest.json").read_text())
    length, height, depth = manifest["dimensions_m"]
    assert len(it1.fragments) == manifest["fragment_count"] == 96
    assert it1.lo == pytest.approx([-length / 2, -depth / 2, 0], abs=1e-3)
    assert it1.hi == pytest.approx([length / 2, depth / 2, height], abs=1e-3)


def test_it1_every_hull_is_closed(it1):
    for f in it1.fragments:
        centre = [(f.lo[k] + f.hi[k]) / 2 for k in range(3)]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    if dx or dy or dz:
                        far = [centre[0] + 10 * dx, centre[1] + 10 * dy, centre[2] + 10 * dz]
                        assert not all(sum(n[k] * far[k] for k in range(3)) - d <= 0 for n, d in f.planes), f.fragment_id


def test_it1_inside_outside_and_a_punch(it1):
    assert inside_model(it1, [0, 0, 0.5]) is not None
    assert inside_model(it1, [0, 0.5, 0.5]) is None          # in front of the facade
    assert inside_model(it1, [0, 0, 1.2]) is None            # above the roof
    hit = first_entry(it1, [0, -0.8, 0.5], [0, -0.1, 0.5])
    # The facade is not flat (the bounding box includes details), so check the entry itself: on the facade
    # side, just before it is air and just after it is building.
    assert hit is not None and it1.lo[1] - 1e-6 <= hit["point"][1] < 0
    assert inside_model(it1, [0, hit["point"][1] - 0.005, 0.5]) is None
    assert inside_model(it1, [0, hit["point"][1] + 0.005, 0.5]) is not None
    judge = ModelStrikeJudge(it1)
    judge.update({"right_wrist": [0, -0.8, 0.5]}, 0)
    out = judge.update({"right_wrist": [0, -0.2, 0.5]}, 33)
    assert out["event"]["joint"] == "right_wrist" and out["destroyed"] is True
    assert out["event"]["building_id"] == "knu-it1-v3"


def test_it1_placement_turns_the_long_side():
    turned = load_model_target(placement=Placement(yaw_deg=90))
    assert turned.hi[1] - turned.lo[1] == pytest.approx(2.81, abs=0.01)
    assert turned.hi[0] - turned.lo[0] == pytest.approx(0.626, abs=0.01)
    assert math.isclose(turned.hi[2], 1.084, abs_tol=1e-3)
