"""Quality gate for one triangulated joint: positive depth and reprojection error.

With three views and a failed gate, each single view is dropped in turn and the best passing
pair is used, so one bad 2D detection cannot ruin the result. The views actually used are
returned; anything else is reported as invalid with a reason (never a placeholder position).
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np

from ..calibration.storage import Calibration
from .triangulation import triangulate_dlt


@dataclass(frozen=True)
class JointEstimate:
    position_m: np.ndarray | None
    camera_ids: tuple[str, ...]
    reprojection_error_px: float | None   # max over the views used
    reason: str | None


def _evaluate(obs: dict[str, np.ndarray], calibs: dict[str, Calibration], ids: tuple[str, ...]):
    try:
        X = triangulate_dlt([obs[c] for c in ids], [calibs[c].Rt for c in ids])
    except ValueError:
        return None, float("inf"), "insufficient_views"
    errors = []
    for c in ids:
        cal = calibs[c]
        if cal.depth(X)[0] <= 0:
            return X, float("inf"), "behind_camera"
        measured = (cal.K @ np.array([obs[c][0], obs[c][1], 1.0]))[:2]
        errors.append(float(np.linalg.norm(cal.project(X)[0] - measured)))
    return X, max(errors), None


def estimate_joint(obs: dict[str, np.ndarray], calibs: dict[str, Calibration],
                   min_views: int, max_reprojection_error_px: float) -> JointEstimate:
    ids = tuple(sorted(obs))
    if len(ids) < min_views:
        return JointEstimate(None, ids, None, "insufficient_views")

    X, err, why = _evaluate(obs, calibs, ids)
    if why is None and err <= max_reprojection_error_px:
        return JointEstimate(X, ids, err, None)

    first_reason = why or "reprojection_error"
    if len(ids) > min_views:
        best = None
        for subset in combinations(ids, len(ids) - 1):
            Xs, es, ws = _evaluate(obs, calibs, subset)
            if ws is None and es <= max_reprojection_error_px and (best is None or es < best[1]):
                best = (Xs, es, subset)
        if best is not None:
            return JointEstimate(best[0], best[2], best[1], None)
    return JointEstimate(None, ids, None if err == float("inf") else err, first_reason)
