# 실제 보정 결과

T05에서 `local/C0.json`, `local/C1.json`, `local/C2.json`을 생성합니다. 현재 실측 보정 파일은 없습니다. 임의의 단위 행렬이나 합성 값을 실제 보정값처럼 사용하지 않습니다. 서버는 `config/cameras.local.json`의 `calibration_file`(저장소 루트 기준 경로)로 파일을 찾습니다.

`local/`은 Git에서 제외합니다. 공유해야 하는 검증 데이터는 식별 정보를 정리한 뒤 별도 경로와 보관 방법을 팀이 결정합니다.

## 파일 형식 (서버 `backend/calibration/storage.py`가 검증)

```json
{
  "schema_version": "0.1",
  "calibration_id": "C0-2026-11-12-a",
  "source": "measured",
  "camera_id": "C0",
  "device_id": "<등록에 쓰는 device_id, 모르면 null>",
  "image": {"width": 1280, "height": 720, "rotation_deg": 0, "crop": null},
  "K": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "dist": [k1, k2, p1, p2, k3],
  "R_world_to_camera": [[...], [...], [...]],
  "t_world_to_camera_m": [tx, ty, tz],
  "world": {"frame": "room_z_up", "units": "m"},
  "reference_object": {"type": "...", "size_m": "...", "face_transforms": "다면 마커면 면별 변환"},
  "reprojection_error_px": {"mean": 0.0, "max": 0.0},
  "created_at": "2026-11-12T15:00:00+09:00"
}
```

- `x_cam = R_world_to_camera · X_world + t_world_to_camera_m`, 카메라 축은 OpenCV(+x 오른쪽, +y 아래, +z 전방).
- `source`: `measured`(실측) 또는 `synthetic`(시험용). 합성 파일은 준비 상태를 true로 만들지 않습니다.
- `dist`는 4·5·8개 계수. `R`은 회전행렬(직교, det=1)이어야 하며 아니면 파일 전체를 거부합니다.
- 휴대폰은 `pose_2d`에 `calibration_id`를 그대로 넣고, 해상도·회전이 이 파일과 같아야 3D에 쓰입니다.
- `reference_object`, `reprojection_error_px`, `created_at`은 기록용 필수 정보입니다(서버 검증 대상은 아님).
