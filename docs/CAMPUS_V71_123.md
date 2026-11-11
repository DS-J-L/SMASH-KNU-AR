# 캠퍼스 v71 누적 모델 123개

캠퍼스 v71 기준본의 123개 모델 ID를 유지하고 묶음 1~10의 70개 작업 기록, dot 인계에서 확인한 8개 변경, 1·2그룹 후속 보완을 한 사본에 반영했다. 원본 v71과 편집 이력은 별도로 보존했다. 이 버전의 정적 합본은 객체 1,784개와 삼각형 893,532개를 포함한다. [원본 체크포인트와 이용 조건](CAMPUS_V71_CHECKPOINT.md) · [모델·파일 목록과 SHA-256](asset-validation/campus-v71-123/inventory.json)

| 산출물 | 파일 |
| --- | --- |
| 전체 캠퍼스 편집 원본 | [Blender](../assets/source/knu-campus-v71-123-group2-r1.blend) |
| 전체 캠퍼스 게임 모델 | [GLB](../web/public/assets/campus/knu-campus-v71-123-group2-r1.glb) |
| 파편 게임 패키지 | [카탈로그](../web/public/assets/buildings/catalog.json) · [정상 GLB·파편 GLB·충돌체·매니페스트](../web/public/assets/buildings/) |
| 게임 편집 원본 | [패키지별 Blender](../assets/source/campus-v71-123/) · [기존 버전 원본](../assets/source/README.md) |

게임의 기본 캠퍼스 지도는 이 합본을 사용한다. 최초 합본의 게임 항목 96개에 단독 연습용 3개를 더해 현재 선택 목록은 99개이며, 파편은 패키지 전체를 합해 6,354개다. 매니페스트에는 원본 모델 ID, 출처, 캠퍼스 위치·배율, 게임용 피벗과 충돌체의 기준을 기록했다. 출처를 특정할 수 없었던 모델은 기존 ID로 관리한다.

저장소 루트에서 `python -m http.server 8890 --bind 127.0.0.1 --directory web`을 실행하고 [모델 데모](http://127.0.0.1:8890/monitor/fracture/)를 연다. 건물을 선택한 뒤 Space로 파괴하고 R로 복원한다. 캠퍼스 지형 탭에서 전체 지도를 볼 수 있다.

캠퍼스 지형 탭의 **캠퍼스 구역 선택**에서 다음 8개 구역을 선택한다. 선택한 구역의 건물과 주변 지형만 표시하며 **전체 캠퍼스**를 고르면 전체 지도를 다시 볼 수 있다. 좁은 화면에서는 구역을 담도록 카메라 거리를 늘린다.

| 기존 구역 | 선택 항목 |
| --- | --- |
| 북쪽 | ① 북문·예술대·온실 / ② 본관·글로벌플라자·중앙도서관 |
| 서쪽 | ③ 농대·자연과학대 / ④ 체육관·대운동장 |
| 동쪽 | ⑤ 박물관·사회과학대 |
| 공대·IT | ⑥ 공대·화학관 / ⑦ IT대·수의대 |
| 남쪽 | ⑧ 생활관 |

생활관은 남쪽 기숙사 A/B/C·진리관·화목관·봉사관·면학관 주변을 보여준다. 카탈로그에서 123개 건물의 표시 구역을 지정하며 창문과 옥상 등 연결된 세부 요소도 함께 표시한다. 지형과 도로는 구역의 건물·주요 시설을 둘러싼 표시 범위로 자른다. 이 범위는 3D 화면용이며 현장 경계는 별도로 확인해야 한다.

**건물 파괴 → 연습할 건물 → 단독 파괴 연습**에는 아래 다섯 건물이 먼저 나온다. 하나를 선택하면 해당 건물만 표시된다. 클릭으로 타격점을 고른 뒤 Space 또는 파괴 버튼으로 부수고, R 또는 복원 버튼으로 초기화한다. 그 외 건물과 이전 버전은 같은 목록의 별도 그룹에서 고를 수 있다.

| 연습 모델 | 파편 | 근거 |
| --- | ---: | --- |
| 글로벌플라자 | 64 | v71 건물 본체에서 분할, [외형](asset-validation/practice-packages/global/intact.png) · [파편](asset-validation/practice-packages/global/fragments.png) |
| 경북대학교 본관 | 85 | 기존 `knu-main-v2` 재사용 |
| IT5호관(IT융복합관) | 64 | v71 건물 본체에서 분할, [외형](asset-validation/practice-packages/it5/intact.png) · [파편](asset-validation/practice-packages/it5/fragments.png) |
| IT1호관 | 96 | 기존 기본값 `knu-it1-v3` 재사용 |
| 중앙도서관 | 64 | v71 건물 본체에서 분할, [외형](asset-validation/practice-packages/library/intact.png) · [파편](asset-validation/practice-packages/library/fragments.png) |

새 모델은 캠퍼스 본체와 재질을 사용하며 별도 외벽·지붕 장식은 포함하지 않는다. 가장 긴 축을 2.8m로 맞춘 게임용 소품으로, 캠퍼스 합본의 실제 배치와 배율은 유지된다. Blender 5.2에서 합본 `.blend`를 열고 `tools/build_practice_packages.py`의 `--building global|it5|library`로 새 패키지를 재생성한다. `npm run validate:enhancements`와 `npx playwright test tests/browser/building-practice.spec.js`로 에셋과 단독 파괴 연습을 확인한다.

공식 지도와 사진을 대조한 범위는 [70개 범위표](asset-validation/campus-v71-123/history/scope-70.json), [dot 변경 객체·좌표](asset-validation/campus-v71-123/history/merge-123/model-merge-manifest.json), [1그룹 변경](asset-validation/campus-v71-123/history/merge-123/group1-review/edits.json), [2그룹 변경](asset-validation/campus-v71-123/history/merge-123/group2-review/edits.json)과 [사진 출처](asset-validation/campus-v71-123/history/merge-123/group2-review/photo-sources.json)에 남겼다. 확인이 어려운 면과 지붕 요소는 근거가 확보될 때 다시 대조한다. 출처 표기와 이용 조건은 v71 원본의 기준을 따른다.

게시 후보를 Blender 5.2.3에서 다시 열어 편집 파일 97개의 외부 의존성이 없음을 확인했다. 정상·파편 GLB 192개와 캠퍼스 GLB를 검사했다. 오류 0건이며, 정적 캠퍼스의 공대 12호관·약학대학·정보화본부에 기존 탄젠트 경고 3건이 남아 있다. 상세 외장을 유지한 게임 패키지 4개는 정상 메시의 기존 1만 삼각형 기준을 넘는다. 해당 패키지의 실제 값 13,628~19,128개를 검사 상한으로 기록했다. [편집 원본 확인](asset-validation/campus-v71-123/editable-source-qa.json) · [GLB·형상 검사](asset-validation/campus-v71-123/gltf-validation.json)

게시 후보를 Edge D3D11에서 열어 96개 항목의 선택·파괴·복원, v71 지도 로드와 건물 보기 복귀를 확인했다. [브라우저 기록](asset-validation/campus-v71-123/browser-qa.json) · [전체 지도](asset-validation/campus-v71-123/campus.png) · [파편 화면](asset-validation/campus-v71-123/game-fragments.png)

재검증은 `npm run validate:enhancements`, `npm run build:demo`, `node tools/validate-campus-v71-123-browser.mjs`로 실행한다. 브라우저 검사 전 위 정적 서버를 띄운다. Windows Edge D3D11을 사용할 때는 `AR_TEST_CHANNEL=msedge`와 `AR_TEST_RENDERER=d3d11`을 환경에 지정한다. 이번 실행은 키보드 데모와 합성 입력 범위이며, 실제 카메라·접촉·AR·실기기 성능은 미검증이다.
