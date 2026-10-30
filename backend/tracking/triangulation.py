"""Multi-view DLT triangulation on normalized image coordinates (K^-1 already applied).

Normalized coordinates keep the linear system well conditioned regardless of pixel scale.
"""

from __future__ import annotations

import numpy as np


def triangulate_dlt(points: list[np.ndarray], Rts: list[np.ndarray]) -> np.ndarray:
    """points[i] = (x, y) normalized in view i, Rts[i] = 3x4 [R|t]. Needs >= 2 views."""
    if len(points) < 2 or len(points) != len(Rts):
        raise ValueError("need at least two matching views")
    rows = []
    for (x, y), Rt in zip(points, Rts):
        rows.append(x * Rt[2] - Rt[0])
        rows.append(y * Rt[2] - Rt[1])
    _, _, vt = np.linalg.svd(np.asarray(rows, dtype=np.float64))
    X = vt[-1]
    if abs(X[3]) < 1e-12:
        raise ValueError("point at infinity")
    return X[:3] / X[3]
