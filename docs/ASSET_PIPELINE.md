# 건물·지형 보완 및 키보드 파괴 데모

2026-11-02 사용자 지시로 건물·지형 → 충돌체·파편 → 키보드 데모 순서로 작업한다. 기존 main 66078f7을 기준으로 `feat/building-fracture-demo` 로컬 브랜치에서 진행한다.

## 실행

저장소 루트에서 Node.js 22.12 이상과 Python 환경을 준비한다.

```powershell
npm ci
npm run build:demo
python -m pip install -r requirements.txt
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8765
```

브라우저에서 [키보드 데모](http://127.0.0.1:8765/monitor/fracture/)를 연다. FastAPI가 빌드 결과와 패키지를 함께 제공한다. 실행 중 외부 CDN·모델 다운로드는 필요하지 않다. 모니터의 기존 실기기 게임 시작 조건과 독립된 테스트 화면이다.

- `Space`: 준비 상태에서는 테스트를 시작하고 한 번 파괴한다. 한 세션의 건물은 한 번만 파괴·100점 반영한다.
- 버튼에 초점이 있으면 `Space`는 해당 버튼을 누른다. 장면/페이지에 초점이 있을 때 파괴 단축키로 동작한다.
- `R`: 동적 강체 제거, 고정 충돌체 재생성, 파편 변환·시간·점수·중복 기록 초기화.
- `G`: 충돌체 표시 전환.
- 60초 종료 후에는 파괴를 막는다. 재시작은 복원 후 수행한다.
- 건물 선택에서 IT 1호관 v3(96개)·본관 v2(85개) 및 이전 64/52/32개 버전을 고른다. [세분화·검증·담당 구분](FRACTURE_REFINEMENT.md)을 따른다. 클릭으로 타격 위치, 슬라이더로 파편 분리 미리보기를 조정한다.
- 캠퍼스 지형 보기에서는 게임 입력을 끄고 [v71 누적 캠퍼스](CAMPUS_V71_123.md)를 불러온다. 둘러보기 메뉴에서 지도·사진과 대조한 지점으로 이동할 수 있다. [지도 대조·변경·한계](CAMPUS_MAP_REVIEW.md), [모델·파편 고도화](BUILDING_ENHANCEMENTS.md)를 참고한다.

입력 구분은 `keyboard_demo`다. 실기기 손목 수신·카메라 영상·보정·AR 추적·실제 궤적 충돌 통합은 이 데모의 검증 범위에 포함하지 않는다.

## 지형과 건물 보완 범위

v10과 약 30m FABDEM V1-2 표고를 보존한다. 체육시설 경계에 맞는 삼각분할과 외부 12m 전이 구간을 만들고, 도로·녹지의 원래 표면 두께를 유지하면서 실제 지형 삼각면에 맞춘다. 건물 하단 둘레는 렌더링되는 지형보다 3cm 아래로 맞춘다. 이는 화면 접합을 위한 기초 근사이며 실제 설계 기초가 아니다. 건물의 평면 윤곽·지붕 높이·실측 여부는 변경하지 않는다.

지형의 중복 하부·외곽 띠를 제거하고 위쪽 정적 표면만 제공한다. **지형 외곽은 열린 메시**이며 폐합된 출력·동적 강체용 지형이 아니다. 게임의 바닥 충돌은 별도 평면이다. 녹지 green.005의 중복 조각 0.045354㎡를 제거하고 green.013을 재삼각분할했다. 최초 QA 오류 30건은 `terrain-v11-attempt1.json`에 보존하고 최종 오류 0건과 수정 내역은 `terrain-v11.json`, `terrain-repair.json`에 기록한다.

정밀 DEM·학교 도면은 이번 작업의 확보 자료에 없다. [국토정보플랫폼](https://map.ngii.go.kr/ms/map/NlipMap.do)은 후보 경로지만 이 작업에서 해당 페이지의 자료 다운로드를 확인하지 못했다. 보간 메시를 세분화해도 원자료의 측량 해상도가 높아지지는 않는다. 보류 83개 건물의 대장 대응, 본관 면적 차이, 도로 종단면·출입구·옹벽은 후속 대조 대상이다.

## 첫 건물 패키지

경로: `web/public/assets/buildings/knu-it1-v1/`.

| 파일 | 용도 |
| --- | --- |
| `intact.glb` | 게임용 정상 건물 1개 |
| `fragments.glb` | 닫힌 파편 32개, 각 로컬 피벗과 조립 위치 포함 |
| `colliders.json` | 파편별 볼록 충돌체 정점·밀도·마찰과 조립 위치 |
| `manifest.json` | 건물 ID·단위·축·원점·게임 배율·출처와 한계 |

원본은 OSM way 468931895의 IT 1호관 본체다. 높이는 기존 2019년 지상 9층 × 가정 층고 3.5m를 유지한다. **새로 측정한 높이가 아니다.** 폭 2.8m는 게임 설계값이며 원본 건물의 축소 비율은 manifest에 기록한다. 반복 창 재질은 게임 표현이며 실제 창 배치·형태의 복원이 아니다. 캠퍼스 v11의 원래 외벽 세부물은 유지하고 게임 패키지는 본체 기반의 가벼운 별도 모델로 만든다.

패키지는 m 단위, Y 위쪽의 glTF/Three.js 좌표다. 공통 월드 `(X,Y,Z) → (X,Z,-Y)` 변환을 **내보낼 때 이미 적용**했다. 패키지에 같은 축 회전을 다시 적용하지 않는다. `source_origin_campus_z_up_m`는 출처 추적용 캠퍼스 원점이며 실내 플레이 위치로 사용하지 않는다. 실내 배치는 후속 AR 보정으로 별도 결정한다.

`dimensions_m`는 **축소한 게임 모델의 X/Y/Z 크기**다. 현재 약 `[2.8, 1.0324382, 0.6155215]`m다. 원본 캠퍼스의 X/Y/Z 크기는 `source_dimensions_campus_z_up_m`에 따로 둔다. 패키지 v1은 노드 회전·배율을 메시 자체에 적용하고 파편의 복원 회전을 항등 quaternion으로 기록한다. 로딩 시 단위·좌표·파편 수·피벗·GLB와 충돌체 크기를 검사하고 불일치하면 시작을 막는다.

정상 건물은 파편 충돌체를 결합한 고정 강체로 사용한다. 파괴 시 고정 강체를 제거하고, 파편마다 같은 정점을 이용한 동적 강체를 만든다. 렌더 메시를 움직이는 삼각형 충돌체로 사용하지 않는다. 밀도 200kg/m³와 초기 속도는 게임용 설계값이다. [Rapier 강체·충돌체 문서](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)를 기준으로 구현했다.

## 재생성·검증

Blender 5.2.3과 Codex의 `blender-asset-qa` 스크립트를 설치한 환경에서 실행한다. 원본·v11·파편 편집 파일을 각각 보존한다.

```powershell
blender -b assets/source/knu-campus-v10.blend --python-exit-code 1 -P tools/build_campus_assets.py -- --stage terrain
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/repair_campus_meshes.py
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/finalize_campus.py
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/build_campus_assets.py -- --stage fracture
blender -b assets/source/knu-it1-fracture-v1.blend --python-exit-code 1 -P tools/build_campus_assets.py -- --stage qa-fracture
npm run validate:assets
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/audit_campus_assets.py
npm run build:demo
npx playwright install chromium
npm run test:demo
python -m pytest -q
```

`docs/asset-validation/`에 메시 QA, 파편 부피 보존, 재가져오기 경계, glTF Validator, 재질·와이어 다각도 이미지와 브라우저 화면을 기록한다. 반복 복원 시험에서 강체·충돌체·GPU geometry·texture 수가 늘지 않는지 확인한다. 브라우저 자동화는 소프트웨어 WebGL을 사용하므로 실제 시연 PC·휴대폰 성능 측정과 구분한다.

## 출처·이용 조건

기존 OSM 기반 윤곽은 [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright), 지형은 [FABDEM V1-2](https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/)에서 유래한다. 기존 v10 README의 출처·추정 범위와 이용 조건을 이어받는다. FABDEM 기반 캠퍼스와 파생 패키지는 기존 CC BY-NC-SA 4.0 출처·비상업·동일조건 공유 표시를 보존한다. 대장 높이의 신규 검증이나 이용 조건의 별도 법률 판단은 수행하지 않았다.

## 수용한 경고와 자원 범위

- 캠퍼스 지형은 외곽이 열린 정적 표면이고 상대 표고를 사용하므로 바닥 z=0 경고를 수용한다. 지형·도로·녹지의 텍스처 없는 단색 표면은 UV 검사를 제외했다. 일부 기존 정적 표면의 n-gon은 glTF 내보내기 시 삼각분할하며 동적 파편으로 쓰지 않는다.
- 새 전체 검사에서 남은 `green.036`의 중복 정점 경고 1건은 0.01mm 이내의 근접 정점 쌍이다. 정적 녹지 표면이고 퇴화 면·법선·면 겹침 오류가 없어 수용한다.
- 건물·파편은 폐합 검사를 통과했다. 추가 UV 검사에서 33개 메시의 오류 0건, UV 영면적 면 0건이다. 반복 창 타일링을 위한 UV 중첩·0~1 범위 초과는 의도한 것으로 수용한다. 광원·노멀 텍스처 베이크용 UV가 아니다. 조립 상태에서 공중에 있는 파편의 상대 z 경고도 복원 위치에 따른 것이다.
- 수목 170개는 줄기·수관을 한 쌍씩 QA하고 개선 지면보다 1.5cm 아래에 접지했다. 원래 지형과 최대 약 1.509m 차이가 난 수목을 함께 이동했다. 새로운 실측으로 위치·높이를 검증한 것은 아니다.
- GLB 크기는 정상 건물 약 4.6KB, 파편 약 100KB, 전체 캠퍼스 약 25MB다. 전체 캠퍼스는 별도 검사 탭에서만 불러온다. Rapier WASM을 포함한 데모 번들은 약 5MB이며 Vite의 큰 청크 경고가 남는다. 모든 파일을 로컬 제공하며 네트워크·실기기 성능 검증은 별도다.

## 2026-11-02 담당 범위 재검증·수정

회귀 시험에서 버튼 Space가 파괴를 실행하는 문제, 낮은 프레임 속도에서 시간 표시가 갱신되지 않는 문제, 불일치 패키지를 허용하는 문제를 재현했다. 추가 GLB 대조에서 `dimensions_m`가 게임 크기 대신 원본 캠퍼스 크기였던 오류를 발견했다. 버튼 기본 동작 보존, 경과 시간 기반 갱신·만료, 실제 패키지 계약 검사, 생성 코드의 크기 배율을 수정하고 패키지를 재생성했다.

브라우저 15개, 서버 pytest 4개 통과. 브라우저 범위는 20회 파괴/복원, 60초 만료, 200ms 간격의 느린 프레임, 프레임 중단 후 타격, 키보드 접근, 5종 잘못된 패키지, 로딩 실패/재시도, 모바일 레이아웃이다. 느린 프레임은 시계·콜백을 통제한 합성 조건이며 실제 기기 FPS가 아니다. 실행 결과와 이전 실패는 `retest-after.json`, `retest-before.json`에 보존한다.

현재 Blender 캠퍼스 원본에서 메시 2,123개/140,799삼각형과 건물 123개·수목 170개 접지를 새로 검사해 오류 0건이다. 접지 최대 오차는 건물 약 0.000016m, 수목 약 0.00000035m이며 **모델 내부 지면과의 차이**다. 실제 현장 정확도를 측정한 수치가 아니다. 파편 33개 메시의 새 폐합·UV 검사, 정상/파편/캠퍼스 GLB 형식 검사도 통과했다.

소리, 실제 휴대폰·C0 영상·손목 궤적·AR 정합, 실제 하드웨어 성능과 20분 구동은 미검증이다. 공통 Phase 완료로 판정하지 않는다.
