# 3D 손목 복원 · T07

정경호 구현, 이동수·김태이 검증.

- `triangulation.py` (구현): 왜곡을 제거한 정규 영상좌표로 2~3시점 DLT/SVD.
- `quality.py` (구현): 양의 깊이, 사용 시점 중 최대 재투영 오차 검사. 3시점이 실패하면 한 대씩 빼서 통과하는 최선의 2시점을 사용.
- `pipeline.py` (구현): 카메라 단위 자격(입력·신선도·보정 일치·시계) → 정렬 → 손목별 관측(미검출·영상 밖·낮은 신뢰도 제외) → `pose_3d`.

좌·우 손목만 다룹니다. 최소 2개의 서로 다른 유효 시점, 보정 일치, 시간 정렬을 통과해야 하며, 실패는 `position_m=null`, `valid=false`와 이유로 보냅니다. MediaPipe의 hip-relative world landmarks는 쓰지 않습니다. 합성 보정은 `SMASH_ALLOW_SYNTHETIC_CALIBRATION=1`일 때만 쓰이고, 결과는 `sample_only=true`이며 준비 상태를 바꾸지 않습니다.

검증 범위: 합성 기준점으로 수학을 확인했습니다(`tests/test_tracking.py`, `tools/synthetic_cameras.py`). 실제 기준점으로 공간 오차를 재는 검증은 실측 보정 이후 별도로 합니다.
