# 실제 지도·건물 사진 대조 및 캠퍼스 v13

2026-11-02 사용자 요청에 따라 공식 캠퍼스 지도, 새로 받은 OpenStreetMap 데이터, 대학 건물 사진과 항공영상의 보이는 특징을 v12 모델과 비교했다. 차이가 컸던 6개 건물을 보완하고 v13 편집 원본·GLB를 별도로 만들었다. 기존 v12 및 IT 1호관·본관 파편 패키지는 보존한다.

## 확인한 자료와 누락 범위

- [경북대 공식 대구캠퍼스 지도](https://en.knu.ac.kr/intro/map04.htm)와 2025년 안내도: 건물 이름·배치 식별에 사용했다. 안내도는 그림 지도이므로 치수 측정에 사용하지 않았다.
- [현재 OpenStreetMap 스냅샷](https://api.openstreetmap.org/api/0.6/map?bbox=128.6034,35.8845,128.6173,35.8963): 기존 캠퍼스 경계 안의 건물 윤곽 94개가 모두 모델에 대응했다. 기존 VWorld 기반 추가 건물 29개를 합쳐 코어 123개를 유지한다. OSM 자체가 건물을 누락할 수 있으므로 **캠퍼스 전체 건물이 빠짐없이 검증됐다는 뜻은 아니다.**
- [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer): 옥상 구조·단차·색 구역을 육안 비교했다. 촬영일·공급자별 시기는 확인하지 못했다. 고층 건물의 시차 때문에 화면에서 보이는 지붕을 지상 윤곽으로 옮기지 않았다.
- 경북대 사진 DB의 건물별 사진: 보이는 외형을 비교했다. 글로벌플라자는 2014-01-05 사진이며 다른 표본은 촬영일 미상이다. 오래된 사진에 설비가 보이지 않는다는 이유로 기존 태양광 패널을 삭제하지 않았다.

출처 URL, 관찰한 특징, 추정한 부분과 보류 사항은 [sources.json](../assets/reference/map-review-2026-11-02/sources.json)에 건물별로 남겼다. 원본 지도·사진 픽셀은 게임 텍스처에 넣지 않았다. 사진 미리보기·항공 타일은 git에서 제외한 로컬 참고 폴더에 둔다. OSM 스냅샷과 파생 대조도에는 OpenStreetMap 기여자·ODbL 표시를 보존한다. 기존 지형·VWorld·대장 출처와 이용 조건은 [캠퍼스 안내](../web/public/assets/campus/README.md)를 따른다.

## 건물별 변경

| 건물 | 확인한 기존 표현의 부족 | 반영한 변경 | 남은 불확실성 |
| --- | --- | --- | --- |
| 글로벌플라자 | 중앙 후퇴부가 반복 창 격자로 덮임 | 두 유리 볼륨·어두운 중앙 후퇴부·상부 횡단부·기단 입구 | 상부 구성 치수·가려진 면·정확한 창틀 간격 |
| 중앙도서관 | 동 전체가 같은 높이인 한 덩어리 | 낮은 동쪽 날개, 중앙 옥상 구조, 동별 태양광 구역과 흰 창틀 | 동 경계·높이 비율·패널 수·신구관의 상세 연결 |
| IT 2호관 | 단순 평지붕과 기본 반복 창 | 낮은 중앙 옥상, 작은 채광부, 외곽 패널 구역과 흰 입면 띠 | 중앙 단차 3.2m와 세부 크기는 근사. 건물 관통 중정으로 해석하지 않음 |
| 대강당 | 일반 강의동 같은 3층 창 격자 | 후퇴한 유리 입구와 좁은 상부 세로 창, 기존 다각 지붕·태양광 유지 | 입구 깊이·창 개수·가림면·사진 시기 |
| 박물관 | 근거가 약한 연속 유리·흰 채움 띠 | 넓은 벽돌 면과 밝은 수직 기둥·층 경계, 기존 태양광 유지 | 기둥 두께·후면 입면·사진 시기 |
| 제2체육관 | 모든 동의 지붕이 같은 높이 | 주 체육관과 낮은 서/북서 부속동, 채광 띠·환기부·지붕색 구분 | 동별 높이 비율·채광창 간격·절대 높이 |

[글로벌플라자 사진](https://photo.knu.ac.kr/www/selectPhotoInfoWebView.do?ctgryNo=1&key=162&pageUnit=24&photoInfoNo=14199&photoNo=54436), [도서관 사진](https://photo.knu.ac.kr/www/selectPhotoInfoWebView.do?ctgryNo=3&key=839&pageUnit=60&photoInfoNo=15157), [대강당 사진](https://photo.knu.ac.kr/www/selectPhotoInfoWebView.do?ctgryNo=3&key=839&pageUnit=48&photoInfoNo=15267), [박물관 사진](https://photo.knu.ac.kr/www/selectPhotoInfoWebView.do?key=162&ctgryNo=1&photoInfoNo=15380&pageUnit=24)이 각 관찰을 뒷받침한다. 수치가 없는 부재 치수·반복 패턴은 모델링 근사다. 새 측량·정확한 사진 복원·구조 해석을 수행하지 않았다.

기존 지형과 기초 접지점은 보존했다. 지붕·마감의 최대 높이는 기존 건물 그룹의 높이 범위를 넘지 않게 제한했다. 창틀·얇은 마감은 외곽에서 약 0.11m까지 돌출할 수 있으며 대조 JSON에 기록한다. 이것은 새로 측정한 건축면적이 아니다.

## 결과 확인

[키보드 데모](http://127.0.0.1:8765/monitor/fracture/) → **캠퍼스 지형** → **보완한 건물 둘러보기**에서 6개 건물 또는 전체를 고른다. 실제 캠퍼스 좌표의 건물로 카메라가 이동한다. 이 모드에서는 게임 타격을 끈다. **건물 파괴**로 돌아오면 기존 파편 패키지를 사용할 수 있다.

- [v13 GLB](../web/public/assets/campus/knu-campus-v13.glb)
- [v13 Blender 원본](../assets/source/knu-campus-v13.blend)
- [보완 모델 렌더](asset-validation/map-review/reviewed-buildings.png)
- [모델·OSM 윤곽 대조도](asset-validation/map-review/footprint-overlay-v13.svg)
- [최종 검증·파일 해시](asset-validation/map-review/summary.json)

다각도 전후 형태 비교는 `*-before.png`, `*-after.png`, 새 와이어는 `*-after-wire.png`다. Workbench 재질 모드는 기본색·형태 검사이며 이미지 텍스처 표현은 Cycles `*-hero.png`와 실제 브라우저 화면으로 확인했다.

## 재생성·검증

Blender 5.2.3 및 기존 Blender QA 스크립트 환경에서 저장소 루트 기준으로 실행한다. 지도 외곽 대조에는 Shapely가 필요하며 `.cache/map-review-deps`에 설치해 분리했다. 사용한 버전과 결과는 summary.json에 남긴다.

```powershell
python -m pip install --target .cache/map-review-deps shapely==2.2.0 --no-deps
blender -b assets/source/knu-campus-v12.blend --python-exit-code 1 -P tools/refine_campus_from_maps.py
blender -b assets/source/knu-campus-v13.blend --python-exit-code 1 -P tools/finalize_map_assets.py
blender -b assets/source/knu-campus-v13.blend --python-exit-code 1 -P tools/audit_campus_assets.py
blender -b assets/source/knu-campus-v13.blend --python-exit-code 1 -P tools/inspect_map_comparison.py
python tools/compare_campus_map.py v13
blender -b assets/source/knu-campus-v13.blend --python-exit-code 1 -P tools/render_map_buildings.py
blender -b assets/source/knu-campus-v13.blend --python-exit-code 1 -P tools/render_map_heroes.py
npm run validate:enhancements
npm run build:demo
npm run test:demo
python -m pytest -q
python tools/check_scaffold.py
```

`finalize_map_assets.py`는 얇은 패널/옥상 합집합의 겹침 여유가 기존 최대 높이를 넘지 않도록 정리하고, 6개 폐합 메시를 QA한 뒤 내보낸 GLB의 경계를 다시 읽는다. 기초 검사에서는 새 차양·단차 하부를 지면으로 오인하지 않도록 v12의 기초 정점을 실제 v13 메시와 대조한다.

자동 QA의 상대 높이 경고는 상대 표고 때문이며 반복 UV 중첩은 의도한 타일링이다. 기존 정적 n-gon·green.036 근접 정점 경고와 Vite 약 5MB 청크 경고는 유지한다. 모델·브라우저 최종 결과 및 최초 실패(도서관 패널 돌출, 카메라 부동소수점 비교)는 검증 폴더에 보존한다.

남은 대조 대상은 높이 보류 83개, 기존 추가 건물 29개의 현재 윤곽, 본관 면적 차이, 수의과대학의 시기별 지붕 차이, 온실 상세·정밀 DEM이다. 실제 휴대폰·C0·손목 입력·AR 정합·소리·장기 구동은 이번 지도/모델 작업의 검증 범위에 포함하지 않는다. 공통 P0~P6 통과 상태를 바꾸지 않는다.


## 최종 실행 결과 — 2026-11-02 18:54 KST

6개 메시의 삼각형 수는 글로벌플라자 162, 중앙도서관 148, IT 2호관 130, 대강당 6,864, 박물관 3,652, 제2체육관 314다. 태양광 패널은 본체에 합쳐 폐합 검사하며 모든 새 메시의 폐합·법선·퇴화 면·UV 오류 0건이다.

캠퍼스 원본의 QA 대상 메시 2,123개·155,677삼각형, 건물 123개·수목 170개 접지 오류 0건이다. GLB 재가져오기 123개 코어와 변경 6개 경계 오차 0m(내부 수치)이며, 최종 GLB는 24,049,444 bytes·396,917삼각형이고 형식 오류·경고 0건이다. 미변경 게임 패키지 파일은 이전 SHA-256과 일치한다.

브라우저 전체 22개, 최종 모델 재확인 2개, 서버 4개 시험을 통과했다. 6개 좌표 이동·모바일 메뉴·실패 재시도와 기존 파괴/복원 회귀를 포함한다. 지도 일치는 v12 최소 IoU 0.99819, v13 마감 포함 최소 IoU 0.99208이다. 마감 돌출을 포함한 외곽 최대 차이는 약 0.109m이며, 신규 현장 정확도 수치가 아니다. 도서관 패널의 지붕 밖 돌출과 낮은 날개 위 공중 연결은 최종 렌더에서 확인·수정했다.
