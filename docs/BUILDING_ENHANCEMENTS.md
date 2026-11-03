# 건물·파편 고도화 — 2026-11-02

최신 파편 기본 버전은 IT 1호관 v3(96개)·본관 v2(85개)다. [세분화·역할 구분](FRACTURE_REFINEMENT.md)을 참고한다. 아래는 이전 v2/v1 고도화의 제작·검증 기록이다.

IT 1호관 v2, 본관 v1과 캠퍼스 v12를 추가했다. 이전 IT 1호관 v1·캠퍼스 v11은 보존한다. [실행 안내](ASSET_PIPELINE.md)의 서버를 실행한 뒤 [건물 파괴 실험실](http://127.0.0.1:8765/monitor/fracture/)에서 모델을 고른다.

## 제작 결과

| 패키지 | 파편 수 | 정상 / 파편 삼각형 | 정상 / 파편 GLB | 게임 크기 X/Y/Z, m |
| --- | --- | --- | --- | --- |
| `knu-it1-v2` | 64 | 666 / 4,914 | 836,016 / 1,605,784 bytes | 2.81012 / 1.08444 / 0.62564 |
| `knu-main-v1` | 52 | 1,612 / 6,340 | 916,028 / 1,707,376 bytes | 1.94587 / 0.73341 / 2.79928 |
| `knu-it1-v1` (보존) | 32 | 28 / 636 | 4,580 / 100,360 bytes | 2.8 / 1.03244 / 0.61552 |

- IT 1호관: 본체 모서리, 입체 옥상 난간과 설비 상자 2개, 외벽·유리의 거칠기·노멀맵을 보완했다. 본체 기준 길이 2.8m에 난간이 더해져 최종 폭은 약 2.81012m다.
- 본관: 기존 본체·돔·현관 지붕·기둥·현관 바닥을 게임용 폐합 메시로 합쳤다. 중복 박공·얇은 돔 테두리·곡선 계단은 충돌·파편용 모델에서 생략했다. 원래 캠퍼스의 세부물은 보존한다.
- 파편: 고정 시드 3D Voronoi 분할로 규칙적인 상자 조각을 대체했다. 절단면을 막고 골재의 색·거칠기·노멀맵을 적용했다. 외벽 UV는 조립 위치 기준으로 이어진다.
- 캠퍼스: 건물 코어 123개의 옥상 둘레에 원본 단위 0.06m, 2단계 모서리 마감을 적용하고 벽·지붕·유리의 PBR 값을 정리했다. 하단·높이·윤곽과 기존 지형 접지는 유지한다. v12 GLB는 25,219,388 bytes다.

재질은 직접 생성한 반복 타일이며 실제 창·벽돌 배치가 아니다. 옥상 마감·설비·분할은 게임 표현이다. 신규 측량·사진 복원·구조 파괴 해석을 수행하지 않았다. 높이 대응 보류 83개, 본관 면적 차이, 정밀 DEM·도로 종단면은 그대로 남는다. 출처·이용 조건은 [캠퍼스 안내](../web/public/assets/campus/README.md)를 이어받는다.

## 데모 조작

건물 선택 → 건물 위 클릭으로 타격점 선택 → `Space`로 파괴 → `R`로 복원한다. 파편 분리 슬라이더(0~40%)에서는 조각의 절단면을 검사하며 0으로 돌리거나 `R`을 누르면 플레이할 수 있다. `G`로 같은 위치의 충돌체를 겹쳐 본다. 타격점에 가까운 파편에 큰 속도를 주고 재사용하는 먼지 버퍼를 표시한다. 점수·60초·실패 복구 규칙은 유지한다. 모델 전환 실패 시 이전 모델을 유지한다.

모델 목록은 [catalog.json](../web/public/assets/buildings/catalog.json)에 둔다. 기본값은 `knu-it1-v2`이며 `?building=knu-main-v1`로 본관을 직접 열 수 있다. 파편 수를 32로 고정하지 않고 manifest를 따른다. 모든 패키지는 m·Y-up이고 축 변환이 이미 적용됐다. 기존 `pose_3d`의 `room_z_up` 계약과 서버 상태는 변경하지 않았다.

## 재생성

Blender 5.2.3, NumPy, 설치된 `blender-asset-qa` 스크립트를 사용한다. 저장소 루트에서:

```powershell
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/enhance_buildings.py -- --building it1
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/enhance_buildings.py -- --building main
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/enhance_buildings.py -- --campus
blender -b assets/source/knu-campus-v12.blend --python-exit-code 1 -P tools/audit_campus_assets.py
blender -b assets/source/knu-campus-v12.blend --python-exit-code 1 -P tools/review_campus_enhancements.py
npm run validate:enhancements
npm run validate:assets
npm run build:demo
npm run test:demo
python -m pytest -q
python tools/check_scaffold.py
```

편집 원본은 `assets/source/knu-it1-fracture-v2.blend`, `knu-main-fracture-v1.blend`, `knu-campus-v12.blend`다. `tools/review_building_assets.py`는 저장한 단일 건물 원본을 다시 내보내고 와이어 시트를 갱신한다. `tools/gltf_tangents.py`는 최종 GLB의 삼각형·UV에서 직교 tangent를 계산한다. 작은 모서리에서 발생한 Blender 내보내기의 영벡터 오류를 수정했다. IT 1호관 파편 정점 1개는 접선 누적 상쇄로 법선에 직교하는 대체 축을 사용하며, 나머지는 최종 UV에서 직접 계산했다.

## 검증 근거와 범위

결과·이미지는 [asset-validation/enhancement](asset-validation/enhancement/summary.json)에 모은다. 건물 정상·각 파편의 폐합·법선·퇴화 면·UV 검사 오류 0, IT 1호관 부피 상대 오차 3.819e-8, 본관 1.734e-8이다. 정상/조립 파편을 GLB로 다시 가져와 경계 오차 0.00002m 미만을 확인했다. 다각도 재질·와이어, Cycles 정상/분리 렌더를 육안 확인했다.

새 패키지 4개 GLB·보존 패키지 2개·캠퍼스 v12의 Khronos 형식 검사 오류·경고 0건이다. 캠퍼스 원본 새 검사에서 대상 메시 2,123개·144,847삼각형, 건물 123개·수목 170개 접지 오류 0이다. 파편 충돌체는 IT 1호관 최대 33점·본관 최대 30점의 볼록 근사다. 렌더/충돌체 경계 일치를 확인했지만 오목한 부분을 채우는 근사 오차는 남는다.

브라우저 전체 20개 시험과 서버 4개 시험을 통과했다. 모델 선택·분리 검사·타격점·먼지·실패 시 기존 모델 유지·반복 전환 자원 해제와 기존 15개 회귀를 포함한다. 마지막 난간 갱신 뒤 모델 관련 6개 시험도 다시 통과했다. 정확한 최종 실행 상태는 summary.json 및 두 browser-final 보고서를 따른다.

수용한 메시 경고는 반복 타일링 UV 중첩·범위 초과와 조립 파편의 상대 높이다. 작은 게임 메시의 z-fight 거리 기준은 0.0001m로 검사했다. 캠퍼스의 상대 표고·정적 n-gon·green.036 근접 정점 경고는 기존 용도에 따라 수용한다. 기본 QA wire modifier의 얇은 삼각형 miter 돌출은 실제 메시 문제가 아니어서 일정 두께·miter 없는 검토용 선으로 바꿨다. 실패 시도 JSON과 브라우저 첫 시험 8개 실패(중복 status 역할)를 보존했다. 슬라이더 수치 표시를 일반 span으로 바꿔 상태 알림 역할 중복도 수정했다.

입력은 synthetic/keyboard_demo, 브라우저 검사는 Playwright 소프트웨어 WebGL이다. 실기기·소리·C0 영상·실제 손목 궤적·AR 정합·20분 구동·시연 PC FPS는 미검증이다. 약 5MB 번들에 Vite 큰 청크 경고가 남는다. 개인 에셋 고도화 완료와 공통 P2 통과를 구분한다.
