"""Offline camera calibration from explicitly sourced, measured point correspondences."""
from datetime import datetime, timezone, timedelta
import uuid

import cv2
import numpy as np

from .storage import CalibrationError, calibration_dict, parse_calibration


def points(value, dimensions, minimum):
    array = np.asarray(value, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != dimensions or len(array) < minimum or not np.isfinite(array).all():
        raise CalibrationError(f'need at least {minimum} finite {dimensions}D points')
    return np.ascontiguousarray(array)


def source(data):
    value = data.get('source')
    if value not in ('measured', 'synthetic'):
        raise CalibrationError('explicit measured/synthetic source required')
    return value


def limit(data, key, default):
    value = data.get(key, default)
    if type(value) not in (int, float) or not np.isfinite(value) or value <= 0:
        raise CalibrationError(f'{key} must be a positive finite pixel limit')
    return value


def triangular_prism(data):
    side = limit(data, 'side_m', None)
    height = limit(data, 'height_m', None)
    radius = side / np.sqrt(3)
    bottom = [[-side/2, -radius/2, 0], [side/2, -radius/2, 0], [0, radius, 0]]
    vertices = bottom + [[x, y, height] for x, y, _ in bottom]
    return {'source': 'reference_geometry', 'world': {'frame': 'room_z_up', 'units': 'm'},
            'side_m': side, 'height_m': height, 'vertices': vertices,
            'faces': {'A': [0,1,4,3], 'B': [1,2,5,4], 'C': [2,0,3,5]}}


def intrinsics(data):
    provenance = source(data)
    image = data['image']
    width, height = image['width'], image['height']
    if type(width) is not int or type(height) is not int or min(width, height) <= 0:
        raise CalibrationError('positive integer image dimensions required')
    views = data['views']
    if len(views) < 6:
        raise CalibrationError('at least six diverse calibration views required')
    objects, pixels = [], []
    for view in views:
        obj = points(view['object_points_m'], 3, 6)
        uv = points(view['image_points_px'], 2, 6)
        if len(obj) != len(uv) or np.linalg.matrix_rank(obj - obj.mean(0)) < 2:
            raise CalibrationError('matched non-collinear calibration corners required')
        objects.append(obj.astype(np.float32)); pixels.append(uv.astype(np.float32))
    rms, K, dist, _, _ = cv2.calibrateCamera(objects, pixels, (width, height), None, None)
    if not np.isfinite(rms) or rms > limit(data, 'max_rms_px', 2.0) or not np.isfinite(K).all() or not np.isfinite(dist).all():
        raise CalibrationError('intrinsic reprojection error exceeds limit')
    return {'source': provenance, 'image': image, 'K': K.tolist(), 'dist': dist.ravel().tolist(),
            'rms_px': float(rms), 'view_count': len(views)}


def marker_pose(data):
    provenance = source(data)
    lens = data['intrinsics']
    if lens.get('source') != provenance:
        raise CalibrationError('intrinsics and marker source must agree; do not promote synthetic data')
    if data.get('world') != {'frame': 'room_z_up', 'units': 'm'}:
        raise CalibrationError('explicit room_z_up metre coordinates required')
    base = {'schema_version': '0.1', 'source': provenance,
            'camera_id': data['camera_id'], 'device_id': data['device_id'],
            'calibration_id': data.get('calibration_id') or uuid.uuid4().hex,
            'image': lens['image'], 'K': lens['K'], 'dist': lens['dist'],
            'R_world_to_camera': np.eye(3).tolist(), 't_world_to_camera_m': [0, 0, 0],
            'world': data['world']}
    cal = parse_calibration(base, data['camera_id'])
    obj, uv = points(data['object_points_m'], 3, 4), points(data['image_points_px'], 2, 4)
    if len(obj) != len(uv) or np.linalg.matrix_rank(obj - obj.mean(0)) < 2:
        raise CalibrationError('matched non-collinear marker corners required')
    planar = np.linalg.matrix_rank(obj - obj.mean(0), tol=1e-8) == 2
    if not planar and len(obj) < 6:
        raise CalibrationError('non-planar calibration requires at least six corners')
    flag = cv2.SOLVEPNP_IPPE if planar else cv2.SOLVEPNP_ITERATIVE
    _, rotations, translations, _ = cv2.solvePnPGeneric(obj, uv, cal.K, cal.dist, flags=flag)
    candidates = []
    for rvec, tvec in zip(rotations, translations):
        R, _ = cv2.Rodrigues(rvec); t = tvec.ravel()
        if not np.isfinite(R).all() or not np.isfinite(t).all() or np.any((obj @ R.T + t)[:, 2] <= 0):
            continue
        projected, _ = cv2.projectPoints(obj, rvec, tvec, cal.K, cal.dist)
        errors = np.linalg.norm(projected.reshape(-1, 2) - uv, axis=1)
        candidates.append((float(np.sqrt(np.mean(errors**2))), R, t, errors))
    candidates.sort(key=lambda c: c[0])
    if not candidates or candidates[0][3].max() > limit(data, 'max_error_px', 2.0):
        raise CalibrationError('marker pose has invalid depth or excessive reprojection error')
    best = candidates[0]
    if len(candidates) > 1:
        second = candidates[1]
        distinct = np.linalg.norm(best[1] - second[1]) > 0.01 or np.linalg.norm(best[2] - second[2]) > 0.01
        if distinct and second[0] - best[0] < 0.25:
            raise CalibrationError('ambiguous planar marker pose; add corners/markers or another view')
    base.update(R_world_to_camera=best[1].tolist(), t_world_to_camera_m=best[2].tolist())
    result = parse_calibration(base, data['camera_id'])
    return calibration_dict(result, reference_object={'type': 'surveyed_marker_corners',
        'object_points_m': obj.tolist()}, reprojection_error_px={'rms': best[0],
        'mean': float(best[3].mean()), 'max': float(best[3].max())},
        created_at=datetime.now(timezone(timedelta(hours=9))).isoformat(),
        camera_center_world_m=result.center.tolist())
