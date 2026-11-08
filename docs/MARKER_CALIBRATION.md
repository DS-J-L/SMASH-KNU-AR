# 삼각기둥 기준물로 카메라 보정하기

현재 구현은 **알려진 모서리 좌표로 보정값을 계산하는 오프라인 도구**다. 화면 가이드·모서리 선택·QR 자동 검출 UI는 아직 없다. 실제 보정값과 기둥 치수도 아직 입력하지 않았다.

## 기준물과 촬영

기존 카메라 입장 QR을 삼각기둥 각 면에 붙인다. QR 링크는 입장 용도이며 링크 자체가 카메라 위치나 축척을 제공하지 않는다. 실제 기둥의 한 변/높이, 면과 모서리의 대응을 함께 정의한다. QR 테두리를 기준으로 쓰려면 QR 검출 테두리의 실제 크기·면 위 위치도 별도로 실측해야 한다. 종이나 흰 여백 크기와 QR 검출 영역을 혼동하지 않는다.

- 모든 폰이 **같은 고정된 기둥**을 보며 각각 C0/C1/C2로 등록한다.
- 가능하면 각 폰에서 두 면의 모서리가 보이도록 배치해, 서로 같은 평면에 있지 않은 모서리6개 이상을 사용한다. 한 평면만 보이면 두 자세가 비슷하게 맞는 모호성이 생길 수 있다.
- 기둥의 아래 삼각형 중심이 원점, 수평 x/y와 위쪽 z, 단위 m를 사용한다. 기둥을 바닥에 놓지 않으면 이 원점과 실제 바닥의 높이 관계를 따로 기록한다.
- 보정 후 폰 위치·렌즈·줌·방향·원본 해상도를 고정한다. 폰이나 기둥이 움직이면 다시 보정한다.
- 화면에서 윤곽을 맞추는 것은 촬영 안내다. 최종 계산에는 실제3D 모서리와 원본 영상2D 픽셀의 대응, 폰 렌즈 K/dist가 필요하다. 모니터에 축소된 영상 좌표를 그대로 사용하지 않는다.

## 계산 도구

```powershell
.venv\Scripts\python.exe tools/calibrate_camera.py prism --input data/local/prism.json --output data/local/prism-reference.json
.venv\Scripts\python.exe tools/calibrate_camera.py intrinsics --input data/local/C0-lens-views.json --output data/local/C0-intrinsics.json
.venv\Scripts\python.exe tools/calibrate_camera.py marker --input data/local/C0-marker-points.json --output calib/local/C0.json
```

입력은 사용자가 실제로 확보한 값으로 작성한다. 출력은 새 파일만 생성하며 기존 파일 덮어쓰기·서버 설정 변경·적용은 자동으로 하지 않는다. C1/C2도 같은 절차다.

정삼각기둥 reference 입력은 `side_m`, `height_m` 두 양수다. 출력의 vertices와 faces는 기준 좌표이며 측정 완료 보정값이 아니다. 실제 치수가 확정되기 전에는 숫자를 임의로 채우지 않는다.

렌즈 입력은 `source`(measured/synthetic), `image`(width/height/rotation_deg), `views` 배열이다. 각 view는 `object_points_m`(N×3)와 `image_points_px`(N×2) 대응이며6개 이상 모서리·6장 이상 다양한 방향의 보정판 촬영을 요구한다. 촬영 장수만 채우거나 같은 각도만 반복해선 충분한 보정이 보장되지 않는다. 출력에 K/dist·rms_px를 보관한다. 렌즈 보정은 고정 전 다양한 방향으로 보정판을 보여주며 수행할 수 있다.

마커 입력은 `source`, `camera_id`, `device_id`, 선택 `calibration_id`, `world={frame:room_z_up,units:m}`, 위 렌즈 출력인 `intrinsics`, 대응 `object_points_m`, `image_points_px`다. 두 source는 같아야 한다. 측정하지 않은 값을 measured로 붙이지 않는다. 일반3D 모서리는6개 이상, 평면은4개 이상을 요구한다. 카메라 뒤쪽 해·큰 재투영 오차·서로 구분하기 어려운 평면 후보를 거부한다. 기본 오차 한계2px와 모호성0.25px는 초기 소프트웨어 기준이며 실측 성능이 아니다.

출력은 기존 `Calibration` 형식(K/dist/R/t·보정ID·영상 설정·기기ID)과 카메라 중심·재투영 오차를 담는다. 설정의 각 calibration_file을 해당 파일로 지정하고 서버를 재시작한 뒤 폰도 재입장해야 새 보정ID를 받는다. 원본 설정이 다르면 기존 서버가 입력을 거부한다.

## 3D 복원까지 남은 단계

1. 실제 마커·기둥 치수와 화면 모서리 대응 확보, 각 폰 렌즈 보정.
2. 각 카메라 외부 보정 계산 후 별도 검증용 기준점의 재투영·공간 오차 측정.
3. 같은 순간의 손목2D 관측을 정렬해 기존 DLT 복원에 전달.
4. 실제 위치와 복원 결과를 대조하고 소비자 화면·게임에 연결.

현재 서버3D는 손목만 복원한다. 전신22개·머리1개는2D 수신/표시만 연결됐다. 촬영 시각이 unknown이면 기존 정책대로3D 유효 입력으로 취급하지 않으며 수신 시각으로 속이지 않는다. 화면 합성이나 실기기3D 완료로 판정하지 않는다.
