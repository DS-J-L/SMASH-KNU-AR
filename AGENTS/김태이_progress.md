# 김태이 진행 기록

계획: [김태이_plan.md](../김태이_plan.md) · 전체: [PM_plan.md](../PM_plan.md) · [팀 현황](./진행현황.md) · [기록 양식](./작업기록_template.md)

## 1. 현재 상태

| 항목 | 현재 값 |
| --- | --- |
| 마지막 갱신 | 2026-11-21 15:01 KST |
| 현재 Phase·작업 상태 | P4 실제 AR 타격음 소비 연결 로컬 검증 완료 — 1대 근사·3대 삼각측량 모드의 폰/PC. 실제 장비 청취·공통 Phase는 미검증 |
| 마지막 확인된 개발 완료 | AR 폰·PC 4개 경로 충격/붕괴/잔해음, 기본 활성·제스처 해제·음소거·초기/중복/재접속 무음. 브라우저 4/4·오디오/기하/모델 Node 59/59. 앞선 2D/키보드 기능 변경은 정리 |
| 현재 작업 | PR #21 발목/부분 파괴 소비와 main AR 소리 유지·합성 검증 완료 |
| 남은 일·미검증 | 부분 파괴: 화면 연출(지정 파편만 풀기)·1타 1점 게임 상태(이동수), 서버·mono3d 연결(정경호), 낙하 규칙·3개 수치 화면 확인. 발차기: 실폰 시험·기준값(2D 발목 0.8, 3D 0.20 m·1.5 m/s) 조정, 정경호·이동수 연결. 11-09 시험 수치·로그 기록. 실폰에서 느린 통과·거부/중복 타격 무음·무점수, 반복 복원, 속도·cooldown·음량 튜닝, 장시간·지연. PC 추론 경로: 화면 등록 한 줄·전제 시험 2개(이동수 파일), Worker |
| 다음 한 단계 | 폰/PC의 mono3d·multi3d AR 페이지를 새로고침하고 PC 화면 한 번 클릭 후 실제 손목 타격의 파괴음·음량을 장비로 확인한다 |
| 막힌 점·인계 | 발차기 연결은 다른 사람 파일이라 김태이가 수정하지 않음: 정경호 `game_pose.py`·`test_multi3d.py`·mono3d, 이동수 `controller.js`·`main.js`·화면 번들([FOOT_STRIKE.md](../docs/FOOT_STRIKE.md) 4장). 11-08 관찰 1·3은 PR #10에서 정경호가 수정 |

## 2. 개인 Phase 현황

| Phase | 상태 | 확인된 결과·근거 | 남은 완료 기준 |
| --- | --- | --- | --- |
| P0 | 확인 전 | 기록 없음 | 장비표·접속·배치·미리보기 |
| P1 | 코드 검토·main 반영 | PR #1·PM 회귀 6개/서버 호환 replay 확인 | 실제 폰 3대 손목/미검출·HTTPS/GPU/FPS·재연결 |
| P2 | 담당자 수행 확인 전 | 이동수·Codex의 공용 파편/키보드 데모 검증 근거 별도 | 소리·C0·보정 촬영·실측·담당자 확인 |
| P3 | 확인 전 | 기록 없음 | 촬영 보완·시간/가림 시험·무효 입력 대응 |
| P4 | AR 소리 연결 로컬 검증·실기기 통합 확인 전 | 1대/3대 폰·PC 오디오 신호 브라우저 4/4, 관련 Node 59/59 | 실제 손동작·정합·실폰/스피커 청취·물리/이벤트/초기화 통합 |
| P5 | 확인 전 | 기록 없음 | 20분/반복 시험·장비 장애·복구·설정 |
| P6 | 확인 전 | 기록 없음 | 평가 장비 운영·관찰·참조 판정 |

개인 Phase 상태와 공통 Phase 통과는 구분한다. 입력이 안정되기 전에는 충돌·효과보다 기기 입력과 보정 자료를 우선한다.

## 3. 다음 작업에 필요한 협업

- 정경호: 기기 등록·2D 수신·시계 교환·유효한 3D 입력 규격.
- 이동수: 건물/파편·충돌체·좌표 변환·게임 상태·리셋 규격.
- 전달할 것: 실제 2D 입력·시각 출처·보정 촬영·C0 영상·타격 이벤트.
- 위 항목은 예정된 협업이며 전달 완료 기록은 아직 없다.

## 4. 누적 작업 기록

아직 담당자 작업 기록이 없다. 작업을 시작하면 읽은 계획·현재 Phase·이번 목표를 기록하고 종료 시 실제 결과·검증·다음 행동을 채운다. 이 초기화는 개발 완료를 의미하지 않는다.


### 2026-11-02 16:44 KST — 건물·지형 보완 및 파편 데모 시작

- 담당 / 기록자: 사용자 전체 인수 / Codex.
- 작업 구분·Phase·상태: 에셋 개발·문서 / P0 건물 규격·P2 패키지 및 독립 데모 / 진행 중.
- 읽은 계획·기록: PM 계획 2~6절, 이동수 P0·P2, 김태이 P2, AGENTS 운영·현황·작업기록 양식과 각 최신 진행 요약, 기존 v10 README·생성 코드·검증 기록.
- 연결할 계획 항목: 이동수 P2의 건물 1개 GLB·단순 충돌체·사전 분할 파편, 공통 원점·단위·배율, 키보드 파괴·복원; 김태이 P2 독립 파괴 데모.
- 목표·완료 기준: v10 보존 후 근거 있는 건물·지형 접합 보완, 첫 건물 패키지와 복원 가능한 키보드 데모를 로컬에 제작한다.
- 검증 계획: Blender 메시 QA·재가져오기·다각도 재질/와이어 렌더, 파편 부피·좌표·충돌체 대조, 브라우저 파괴·복원 반복과 오류·리소스 확인.
- 입력·장비 범위: 기존 공개 자료·합성 에셋 / keyboard_demo. 실기기 AR는 미검증.
- 이번 결정: 다음 주(11/09~11/15) 전체 작업 인수, 이번 턴은 지정한 순서대로 에셋과 독립 데모 우선. GitHub 게시 지시는 없어 로컬 브랜치에서 작업.
- 재개 위치: SMASH-KNU-AR/ 로컬 worktree, feat/building-fracture-demo, 기준 main 66078f7. 최신 원격 main 일치 확인; 원격 기능 브랜치는 병합하지 않았다.
- 남은 일·막힘: 고해상도 DEM·학교 도면 미확보. 기존 FABDEM 보간의 시각적 접합 보완을 측량 정확도 개선과 구분한다.

### 2026-11-02 17:09 KST — 지형 보완·IT 1호관 파편·키보드 데모 검증 종료

- 담당 / 기록자: 사용자 전체 인수 / Codex. 이전 실명 담당자의 실제 수행 완료를 대신 판정하지 않는다.
- 작업 구분·Phase·상태: 에셋·독립 데모 / P0 게임 규격·P2 일부 작업 완료, 공통 P2 미통과.
- 읽은 계획·기록: PM·이동수·김태이 계획 P0·P2, 정경호의 좌표 계약, AGENTS 운영·현황·양식 및 v10 마지막 검증·공유 기록.
- 연결할 계획 항목: 이동수 P0 첫 건물 게임용 크기·원점, P2 건물 GLB·충돌체·사전 파편·게임 틀·키보드 복원; PM P2 입력 없는 파괴·복원 데모.
- 이번 목표·완료 기준: v10 보존 후 근거를 구분한 접합 보완, 단일 건물의 동일 단위·원점·축 패키지와 반복 복원 데모.
- 바꾼 파일·결과물: 작업 저장소 `SMASH-KNU-AR/`의 `assets/source/knu-campus-v11.blend`, `knu-it1-fracture-v1.blend`, `web/public/assets/campus/knu-campus-v11.glb`, `web/public/assets/buildings/knu-it1-v1/`의 정상·파편 GLB/manifest/colliders/README, `frontend/fracture/`, 빌드된 `web/monitor/fracture/`, npm 잠금 파일·브라우저 시험·제작/검증 도구와 `docs/ASSET_PIPELINE.md`, 데이터 계약·출처 안내. 기존 main 66078f7 및 v10 보존, 로컬 브랜치 `feat/building-fracture-demo`; 신규 커밋·PR·원격 게시 없음.
- 어디까지 완료: 건물 하단 123개와 도로·녹지 1,999개 표면, 수목 170그루 접지 보완. 체육시설 경계 삼각분할과 12m 전이. IT 1호관 폭 2.8m 게임용 모델, 정상 28삼각형·닫힌 파편 32개/636삼각형·로컬 볼록 충돌체. Space 파괴·100점 단일 반영, 60초 종료, R 복원, 충돌체 표시·캠퍼스 검사 탭.
- 검증 방법·실제 결과: Blender 5.2.3 에셋 QA 최종 오류 0건(최초 지형 30건은 `terrain-v11-attempt1.json`에 보존). 33개 건물/파편의 폐합 검사와 추가 UV 검사 오류 0건, UV 영면적 면 0. 파편 부피 상대 오차 1.3183e-8. 정상/파편 재가져오기 경계 차이 1e-5m 미만, 캠퍼스 GLB의 건물 123개 경계 차이 0m. 세 GLB의 Khronos Validator 오류·경고 0건. Playwright 5개·서버 pytest 4개 통과. 파괴/복원 20회에서 강체 2↔33, 충돌체 33 유지, GPU geometry/texture 누적 없음. 60초 만료·실패 입력 파일·모바일 화면 시험 통과.
- 수정·수용한 경고: 지형의 중복 하부·겹친 외곽을 제거한 열린 정적 표면이며 동적 강체·3D 출력용 폐합 지형이 아니다. 상대 z 경고, 텍스처 없는 환경의 UV 제외, 일부 정적 n-gon, 반복 창 재질의 UV 중첩·범위 초과는 용도에 따라 수용했다. 상세 근거는 ASSET_PIPELINE 문서. 약 5MB Rapier 포함 번들에 Vite 큰 청크 경고가 남는다.
- 입력·장비 범위: 기존 공개 자료 기반 합성 에셋·keyboard_demo(source=synthetic), Playwright 소프트웨어 WebGL. 실제 카메라·손목·스피커 청취·현장 측량·시연 PC FPS·20분 연속 시험은 미실행.
- 남은 일·미검증: 보류 83개 높이 대응·전체 평면 실측·본관 면적 차이·정밀 DEM·도로 종단면. 게임 모델 반복 창은 실사 복원 아님. C0 영상·실제 손목 궤적 충돌·소리·팀원의 소비 코드·AR 정합은 미통합. 김태이 P2의 소리 포함 두 항목은 부분 구현이므로 체크하지 않았다.
- 막힌 점·도움·해제 조건: 도면·실측·정밀 DEM 미확보. 독립 패키지/키보드 데모의 기술적 막힘 없음. 다른 입력 기능의 완료를 추정하지 않았다.
- 다음 한 단계·재개 위치: `SMASH-KNU-AR/docs/ASSET_PIPELINE.md`의 실행 절차로 데모 확인; 다음 건물은 본관의 평면·기초 대조 후 같은 패키지 규격으로 준비. 실측 대기는 근거표로 남기고 독립 개발을 이어간다.
- 인계 자료: 로컬 패키지·편집 원본·검증 JSON/이미지. 좌표는 패키지 Y-up/m, pose_3d는 기존 room_z_up 유지, 이중 축 변환 금지. 네트워크 상태·실제 게임 준비 조건 변경 없음.
- 갱신한 체크리스트·현황: 충족한 이동수 P0 1개·P2 3개, PM P2 1개만 체크. 개인 P2는 진행 중, 공통 P0~P6는 통합 확인 전 유지. 계획 인수 사항·진행 기록·팀 현황 갱신.
- 종료 시각: 2026-11-02 17:09 KST.

### 2026-11-02 17:13 KST — 담당 에셋·키보드 데모 재검증 시작

- 담당 / 기록자: 사용자 인수 범위 / Codex.
- 작업 구분·Phase·상태: 개발 검증·수정 / P2 독립 패키지·키보드 데모 및 P5 안정화 관련 / 진행 중.
- 읽은 계획·기록: PM 계획과 이동수 P0·P2·P5, 김태이 P2·진행 요약, AGENTS 운영·현황·양식, 17:09 종료 기록과 ASSET_PIPELINE.
- 목표·완료 기준: 기존 제작물을 다시 검사하고 사용자 조작·실패·타이밍·재생성 문제를 재현해 고친다. 각 수정의 회귀 검사와 최종 상태를 남긴다.
- 검증 계획: 서버/브라우저/GLB 검사, 키보드 접근성과 느린 프레임·실패 복구, 실제 소스와 산출물의 일치·재생성 계약 검사. 필요할 때 Blender QA를 적용한다.
- 입력·장비 범위: synthetic / keyboard_demo. 실기기·현장 실측·실제 AR는 미검증 유지.
- 다음 행동: 기본 검사 실행 후 경계 사례를 재현한다. 사용자 기존 변경과 main 기준 로컬 브랜치를 보존한다.

### 2026-11-02 17:24 KST — 재현된 오류와 수정 중간 기록

- 확인된 문제: Space가 초점 버튼의 기본 동작 대신 파괴를 실행함; 프레임 시각을 16ms로 가정한 UI 갱신 때문에 느린/특정 위상 프레임에서 타이머가 멈춤; 잘못된 단위·파편 수·복원 위치의 패키지도 시작됨.
- 추가 발견: manifest.dimensions_m에 게임 축소 배율이 빠져 정상 GLB 폭 2.8m와 달리 약 85.43m가 기록됨. 실제 GLB와 비교하는 새 검사가 발견했다.
- 수정: 버튼 Space 기본 동작 보존, 실제 경과 시간으로 주기·만료 처리, 메타데이터/GLB/충돌체 계약 검증, manifest 게임 크기와 별도 원본 크기 기록. 제작 코드를 고쳐 파편 패키지를 실제로 재생성했다.
- 재현 근거: docs/asset-validation/retest-before.json(기존 코드에서 6개 실패·1개 통과). 단위·파편 수·피벗의 구체적인 거부 사유도 회귀 검사한다. 느린 프레임 시험의 시계 설치 순서를 바로잡고 콜백 실행 수를 확인하도록 보완했다.
- 새 Blender 검사: 현재 캠퍼스 원본의 메시 2,123개·140,799삼각형, 건물 123개·수목 170개 접지 오류 0건. 건물 접지 최대 오차 약 0.000016m, 수목 접지 최대 오차 약 0.00000035m. 실측 정확도 수치가 아니라 모델 내부 접합 수치다.
- 다음 행동: 수정 후 전체 브라우저 회귀 검사와 최종 기록. 타격음·실기기·실제 AR는 이번 오류 수정과 별개로 미검증 유지.

### 2026-11-02 17:27 KST — 담당 범위 재검증·오류 수정 종료

- 담당 / 기록자: 사용자 인수 범위 / Codex.
- 작업 구분·Phase·상태: 검증·수정 / P2 독립 에셋·키보드 데모 / 이 작업 완료, 공통 P2 미통과 유지.
- 읽은 계획·기록: PM 및 이동수 P0·P2·P5, 김태이 P2, AGENTS 운영·현황·양식, 직전 제작 종료와 이번 시작·중간 기록, ASSET_PIPELINE 및 데이터 계약.
- 연결할 항목·완료 기준: 동일 좌표·단위의 정상/파편/충돌체, 키보드 파괴·복원과 상태·시간·점수, 반복/실패 시험에서 발견한 오류 수정과 회귀 통과.
- 실제 수정: ① 버튼에 초점이 있을 때 Space의 기본 동작을 보존 ② 16ms 프레임 가정을 제거해 실제 경과 시간으로 UI/60초 만료 처리, 화면 갱신 중단 후 타격도 즉시 만료 반영 ③ 파편 수·단위·축·유효 숫자·회전/배율·노드/피벗·렌더/충돌체 크기 불일치 시 시작 차단 ④ manifest.dimensions_m의 누락된 축소 배율 수정, 원본 크기는 별도 필드로 구분.
- 바꾼 파일: 작업 저장소 `frontend/fracture/main.js`, `package-contract.js`, 빌드된 `web/monitor/fracture/`, `tests/browser/fracture-regressions.spec.js`, `tools/build_campus_assets.py`, `tools/validate-assets.mjs`, 새 `tools/audit_campus_assets.py`, 재생성한 IT 1호관 패키지·편집 원본, ASSET_PIPELINE/데이터 계약/패키지 README·검증 JSON과 아래 진행 파일. 신규 커밋·PR·원격 게시 없음.
- 검증 결과: 수정 후 브라우저 15개 통과(실패/건너뜀/불안정 0), 서버 pytest 4개 통과, GLB 3개 형식 오류·경고 0. 파편 생성 및 재가져오기·폐합·추가 UV 검사를 실제 재실행해 오류 0. GLB와 manifest 게임 크기 약 [2.8,1.0324382,0.6155215]m 일치 확인.
- 새 캠퍼스 원본 검사: 수정하지 않고 현재 실제 메시 2,123개·140,799삼각형과 건물 123개·수목 170개 접지를 새로 검사, 오류 0. 접지 최대 오차 건물 0.00001553m, 수목 0.0000003434m는 모델 내부 지면과의 수치이며 현장 정확도 아님.
- 회귀 범위: 키보드 버튼·뷰 전환, 200ms 간격의 합성 저속 프레임과 콜백 실행 확인, 프레임 중단 후 만료, 파편 수/단위/피벗/크기/충돌체가 틀린 5종 패키지, 로딩 실패·재시도, 20회 복원·자원 수·점수 중복, 60초 종료, 모바일 화면.
- 실패 보존·근거: `docs/asset-validation/retest-before.json`에 기존 코드 6개 실패/1개 통과. 강화 검사 도중 기존 manifest 크기 오류를 발견해 정정했고, 느린 프레임 시험의 가상 시계 설치 순서도 보완해 콜백이 실제 실행되는지 확인했다. 최종 결과와 파일 SHA-256은 `retest-after.json`, 새 메시 검사는 `retest-campus.json`에 저장.
- 수용한 경고: 상대 지면 z, 정적 표면 n-gon, 반복 창 UV 중첩·범위 초과, 정적 green.036의 0.01mm 이내 근접 정점 경고 1건. 모든 메시 오류는 0이며 상세 이유는 ASSET_PIPELINE. Vite 약 5MB 청크 경고는 유지.
- 입력·장비 범위: synthetic/keyboard_demo, Playwright 소프트웨어 WebGL·가상 시계. 실제 휴대폰·C0·AR·타격음·실제 하드웨어 FPS·20분 연속 시험은 미실행.
- 남은 일·막힘: 보류 83개 치수·본관 면적·정밀 DEM은 자료 필요. 타격음·실제 입력/영상/추적 통합은 별도 남은 구현. 이번 재현 오류의 기술적 막힘 없음.
- 다음 행동·재개 위치: `docs/ASSET_PIPELINE.md`로 수정 데모 실행, 타격음·실제 입력 소비 연결 및 본관 패키지 대조를 이어간다. 패키지 소비자는 수정된 dimensions_m와 source_dimensions_campus_z_up_m를 구분한다.
- 갱신한 상태: 이동수·김태이·PM 현재 요약과 팀 현황을 재검증 완료로 갱신; 정경호 기록에 크기 계약 정정 연결. 실제 통합·실측 미검증 체크박스와 공통 Phase는 변경하지 않았다.
- 종료 시각: 2026-11-02 17:27 KST.

### 2026-11-02 17:38 KST — 건물·파편 고도화 시작

- 담당 / 기록자: 사용자 인수 범위 / Codex.
- 작업 구분·Phase·상태: 에셋·시각화 개발 / P2 고도화 / 진행 중. 기존 정상 동작과 원본을 보존한다.
- 읽은 계획·기록: PM·이동수 P0/P2/P5, 김태이 P2, AGENTS 운영·현황·양식, 17:27 재검증 종료 기록과 패키지 계약.
- 사용자 지시: 현재 만든 건물들의 모델 또는 파편을 고도화한다.
- 이번 목표: IT 1호관의 입체 마감·외벽/절단면 PBR과 불규칙 파편, 기존 본관의 게임 패키지, 캠퍼스 건물 재질·모서리 마감, 모델 선택·분리 검사·타격점 기반 데모. 기존 IT 1호관 v1과 캠퍼스 v11은 보존한다.
- 검증 계획: Blender 폐합/법선/UV/부피/접합·다각도 재질/와이어, GLB 재가져오기·형식·좌표/충돌체 대조, 새 건물/분리 보기/전환/반복 복원 브라우저 검사와 기존 회귀 검사.
- 정확도 범위: 기존 공개 자료·윤곽을 재사용한다. 재질·마감·옥상 소품·분할은 게임 표현이며 실사·실측 정확도 개선으로 보고하지 않는다. 데이터가 없는 높이·평면 치수는 추정으로 수정하지 않는다.
- 입력 범위: synthetic/keyboard_demo. 실기기·AR 통합은 별도 미검증.


### 2026-11-02 18:20 KST — 건물·파편 고도화 종료

- 담당 / 기록자: 사용자 인수 범위 / Codex.
- 작업 구분·Phase·상태: 에셋·시각화 개발·검증 / P2 독립 모델·파편 고도화 / 이번 작업 완료. 공통 P2 통과와 별개.
- 읽은 계획·기록: PM·이동수 P0/P2/P5, 김태이 P2, AGENTS 운영·현황·양식, 17:38 고도화 시작 기록·직전 재검증·패키지 계약.
- 연결 항목·완료 기준: 계획 말미의 2026-11-02 고도화 추가 항목; IT 1호관 외형/불규칙 파편, 본관 게임 패키지, 123개 건물 마감, 새 조작과 회귀·메시/GLB 검증.
- 바꾼 파일·결과물: tools/enhance_buildings.py·gltf_tangents.py·review_building_assets.py·review_campus_enhancements.py·validate-enhancements.mjs, IT 1호관 v2·본관 v1 패키지/편집 원본, 캠퍼스 v12, catalog.json, frontend/fracture와 빌드 결과, 브라우저 시험·검증 JSON/이미지·문서. 이전 v1/v11 보존, 커밋·PR·원격 게시 없음.
- 실제 모델 변경: 외벽/유리/골재 절단면의 색·거칠기·노멀맵, IT 1호관 모서리·입체 난간·옥상 상자 2개, 본관 돔·현관·기둥 결합, 고정 시드 3D Voronoi 폐합 파편. 캠퍼스 건물 코어 123개 옥상 0.06m 모서리와 재질 보완. 본관 게임 메시의 중복 박공·얇은 테두리·곡선 계단 생략, 캠퍼스 세부 원본 유지.
- 데모 변경: 모델 3종 선택, 0~40% 분리 미리보기와 R 복원, 클릭 타격점·거리별 초기 속도·재사용 먼지, 모델 교체 실패 시 이전 모델 유지, 교체 때 GPU/강체 정리. 기존 시간·점수·실패 계약 유지.
- 메시·재가져오기 검증: IT 1호관 64개(정상 666/파편 4,914삼각형), 본관 52개(1,612/6,340삼각형). 정상/각 파편 폐합·법선·UV·퇴화 면 검사 오류 0. 부피 상대 오차 IT 1호관 3.8186e-8, 본관 1.7340e-8, GLB 정상/조립 경계 차이 0.00002m 미만. 재질·와이어 다각도 및 Cycles 정상/분리 렌더 육안 확인.
- 형식·경계 검증: 새 4개·보존 2개·캠퍼스 v12 GLB 오류/경고 0. 이전 v11 포함 기존 검사도 통과. 로더에서 파편 수·단위·축·피벗·렌더/충돌체 경계 대조. 볼록 충돌체 점 수 최대 IT 1호관 33/본관 30, 오목한 부분의 근사는 남음.
- 캠퍼스 검증: 새 원본 대상 메시 2,123개·144,847삼각형, 건물 123개·수목 170개 접지 오류 0. 지면과의 수치는 모델 내부 접합이며 실측 정확도 아님. 기존 높이·평면·지형 가정 유지.
- 실행 검증: 브라우저 전체 20개 통과, 최종 난간 갱신 후 모델 관련 6개 재통과. 서버 pytest 4개, 새/기존 GLB 검증·빌드·로컬 링크 검사 통과. 반복 전환 geometry/texture 수 동일, 20회 복원·점수·바닥·느린 프레임·60초·모바일·불일치 패키지/실패 복구 포함.
- 실패와 수정 보존: 난간 합집합 후 bevel의 미세 퇴화/겹침을 본체 선행 마감으로 수정. 본관 Boolean은 MANIFOLD와 평면 삼각분할 정리를 적용해 부피 손실·중복 면 해소. 잘못된 tangent 영벡터는 최종 GLB 삼각형/UV에서 직교 계산(파편 정점 1개 대체 축). wire 검토 miter 돌출은 검토용 선 설정 수정. 첫 브라우저 8개 실패는 output과 status 역할 중복으로, 일반 span 표시로 수정. 각 실패 JSON 보존.
- 수용한 경고·한계: 반복 UV 중첩·범위, 파편/캠퍼스 상대 높이, 기존 정적 n-gon·green.036 근접 정점, Vite 약 5MB 청크. 새 게임 메시 z-fight 기준 0.0001m. 신규 에셋은 게임 표현이며 실제 파괴 해석·신규 실측이 아님.
- 입력·장비 범위: synthetic/keyboard_demo, Blender 5.2.3·Cycles RTX 4060·Playwright 소프트웨어 WebGL. 실제 휴대폰·C0·손목·AR·소리·실제 FPS·20분 연속 구동 미검증.
- 남은 일·막힘: 보류 83개 높이·본관 면적·정밀 DEM/도면 대조와 실제 입력 통합. 이 고도화의 기술적 막힘 없음; 현장 정확도는 도면/실측 자료 필요.
- 다음 한 단계·재개 위치: docs/BUILDING_ENHANCEMENTS.md로 새 모델 선택·분리/타격 확인 후 실제 타격 이벤트 소비와 소리·C0/보정 작업 연결. source=synthetic 표기를 유지하고 실제 입력과 구분.
- 인계 자료·근거: docs/asset-validation/enhancement/summary.json에 결과와 SHA-256, browser-final.json·browser-final-models.json·glTF/QA/렌더. 김태이/정경호 소비자는 catalog·각 manifest를 읽고 32개 고정값이나 이중 축 변환을 사용하지 않는다. 기존 room_z_up 메시지·기기·시계 계약 변경 없음.
- 갱신한 계획·현황: 이번 추가 에셋 항목만 검증 완료 표시. 소리·C0·실기기·공통 Phase 체크는 유지. 이동수/김태이/PM 요약·Phase 표·팀 현황과 정경호 계약 연결 기록 갱신.
- 종료 시각: 2026-11-02 18:20 KST.


### 2026-11-02 18:54 KST — 지도 대조 캠퍼스 v13 경로 인계 연결

- 사용자 인수 정적 에셋 보완의 계약 연결 기록. 글로벌플라자·도서관·IT2·대강당·박물관·제2체육관을 지도/사진과 대조해 보완하고 catalog.campus를 v13으로 변경했다. campus_focus는 로컬 캠퍼스 Y-up/m 카메라 이동 목록이다.
- 기존 IT1 64/32·본관 52 파편 패키지 SHA-256과 파편/피벗·room_z_up·시계/네트워크 계약은 유지했다. docs/CAMPUS_MAP_REVIEW.md와 map-review/summary.json을 전달 근거로 남긴다. 실제 소비 코드·입력·소리·C0/AR 통합 완료는 추정하지 않으며 해당 개인 Phase 상태는 유지한다.


### 2026-11-02 20:41 KST — 파편 세분화 시작·인수 범위 정정

- 담당/기록자: 이동수 인수 범위 / Codex. Phase P2 에셋 보완 / 진행 중.
- 읽은 계획·기록: PM 및 이동수 P2/P5, 김태이 P2/P4, 정경호 책임 절, AGENTS 운영·현황과 18:54 종료 기록.
- 최신 사용자 확인: 인수는 이동수 담당 작업 전체이며 팀 전체가 아님. 이전의 넓은 인수 해석을 정정하고 실제 제작/검증 이력은 보존한다. 김태이/정경호의 담당 업무를 사용자에게 재배정하지 않는다.
- 이번 목표: IT1 64→96개·본관 52→80개 불규칙 분할을 새 버전으로 생성, 동일 정상 모델/단위/피벗과 부피·폐합·충돌체·반복 파괴/복원 검증. 기존 버전 보존.
- 역할 답변 근거: 실제 손목 궤적 충돌·파편 물리·소리는 김태이 P4, 3D 손목 복원은 정경호, 모델/화면/게임 상태 연결은 이동수. 몸 전체의 지속 파편 상호작용은 별도 확장 요구.
- 검증 계획: 새 각 파편 폐합/법선/UV/부피·다각도 검토, GLB/충돌체/단위/복원 대조, 브라우저 반복·바닥·모델 전환·기존 회귀. synthetic/keyboard_demo 범위, 실제 손목 통합 상태는 미검증 유지.


### 2026-11-02 21:04 KST — 인수 정정 확정·세분화 에셋 인계 자료

- 사용자 인수는 이동수 담당 전체다. 김태이의 손목 충돌·파편 물리/소리, 정경호의 유효3D 복원 책임은 유지한다. 이전 팀 전체 인수 해석을 정정했다.
- 이동수·Codex가 IT1 v3 96개·본관v2 85개 에셋을 검증했다. 기존 버전/단위/피벗/이벤트/시계 규칙 유지. docs/FRACTURE_REFINEMENT.md와 summary에 인계 자료를 준비했으며 실제 공동 로드/실기기 소비 완료는 아님.
- 몸 전체의 지속 파편 접촉은 기본 손목 타격과 별도 확장 요구다. 물리/추적 담당이 범위를 맞추고 이동수는 모델/화면/게임 연결을 담당한다. 다른 담당자 Phase 완료 사실을 추가하지 않는다.

### 2026-11-03 15:24 KST — PM의 PR #1 검토·수정·머지 결과 연결

- 담당 / 기록자: PM·공통 코드 검토 / Codex. Phase P1 코드 검토·머지 완료, 실제 장비 기준은 미충족.
- 근거·결과: PR #1을 검증 후 fa3b19e87564d9b8746d893f8b7c1f655416774f로 main에 머지. 중지/재시작·늦은 비동기 응답·추론 오류와 Windows ESM MIME 로딩을 수정. 상세 변경/재현/시험은 PM의 같은 시각 종료 기록과 원격 PR의 PM 기록 참조.
- 검증 범위: Node 회귀 6개·PR pytest 4개·임시 서버 결합 pytest 58개, 실제 MediaPipe PC replay에서 손목 추출/서버 receiving·샘플 구분 및 루프 정리 확인. 김태이의 실제 폰 작업 완료를 뜻하지 않음.
- 변경 기록·상태: 본 요약·P1 표·팀 현황의 김태이 행을 원격 코드 확인 사실에 맞춤. P0 장비·P2 C0·P4 실제 충돌/물리/소리·실기기 체크는 유지.
- 남은 일·다음 행동: 11-09 실제 폰 시험 및 C0 송신/타격 이벤트/물리 리셋 인계 준비. 로컬 모델 작업 폴더는 새 main 미병합 상태로 보존되어 원격 버전과 구분 필요.
- 종료 시각: 2026-11-03 15:24 KST.


## 원격 PR 기록 병합 보존 — 2026-11-03

최신 main f5bf683의 아래 누적 기록을 원문으로 보존한다. 로컬 에셋 작업과 원격 담당자·검토 기록은 서로 다른 근거이며 현재 상태는 상단 요약과 최신 통합 기록을 따른다.

### 2026-10-29 19:20 KST — P1 휴대폰 MediaPipe 손목 추출·pose_2d 송신

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분: 개인 개발
- Phase: P1 (P0 장비표·HTTPS 확인은 아직 남음)
- 상태: 검토 요청 — 코드 구현, 실기기 미검증
- 읽은 계획·기록: `김태이_plan.md` 3절 P1, `정경호_plan.md` P1, `docs/DATA_CONTRACT.md`, `docs/ARCHITECTURE.md`, 본 파일 초기 기록
- 연결할 계획 항목: P1 체크리스트 1~8번 (MediaPipe·픽셀 좌표·거울 분리·계약 필드·시각 구분·시계 교환 응답·등록 상태·최신 관측 처리)
- 이번 목표·완료 기준: 폰 페이지에서 좌·우 손목을 원본 픽셀·신뢰도로 만들고 계약 형식으로 송신. 서버가 없으면 로컬 표시
- 검증 계획: PC 브라우저에서 녹화 재생(`?replay=`) + 커밋하지 않은 임시 `/ws/pose` 수신기

진행·종료 결과:

- 바꾼 파일·결과물: `web/camera/app.js`·`index.html`·`pose.js`·`pose-link.js`, `web/shared/styles.css`, `tools/fetch_mediapipe.py`, `.gitignore`(`web/public/vendor/`), `models/README.md`, `docs/DATA_CONTRACT.md`·`SETUP.md`·`ARCHITECTURE.md`, `README.md`, `tests/test_server.py`
- 어디까지 완료: MediaPipe tasks-vision 0.10.35 + pose_landmarker lite/full 로컬 제공(SHA-256 확인), GPU→CPU 대체, 손목 15/16번 원본 픽셀·visibility, 미검출·화면 밖은 `null`, 미리보기 반전 없음, `device_id` 유지·연결마다 새 `stream_id`, 해상도 변경 시 새 스트림, `captureTime` 없으면 `null`/`unknown`, 추론 종료 시각 분리, `clock_pong` 응답, 등록 응답 후에만 송신, 송신 버퍼 64 KB 초과 시 버림, FPS·추론 시간·전송/미전송·장비 정보 표시
- 검증 방법·조건·실제 결과: MediaPipe 예제 사진(pose.jpg)으로 만든 640×480 재생 영상, Mac 앱 내 Chromium 152. GPU 추론 약 20 ms, 좌손목 (457,227) vis 0.99·우손목 (169,221) vis 0.98로 사람 기준 좌우 일치. 임시 수신기에 `camera_hello`→`camera_ack`→`clock_pong`→`pose_2d` 134프레임(0..133) 도착. 같은 C0 두 번째 탭은 `duplicate_camera_id` 표시·송신 0. 서버 재시작 후 새 `stream_id`로 frame 0부터 재개. `/ws/pose` 없는 원래 서버에서는 연결 실패 안내 후 로컬 표시만. `pytest` 4개·`check_scaffold.py` 통과. 첫 GPU 추론은 약 11초 걸림(셰이더 준비)
- 입력·장비 범위: replay (PC). live 미실행
- 남은 일·미검증: 실제 폰 HTTPS·카메라·GPU 추론·FPS·발열, iOS Safari/Android Chrome의 `captureTime` 제공 여부, 3대 동시 송신, 정경호 서버와의 실제 연결, 사람 없는 화면의 `null` 실측
- 막힌 점·도움·해제 조건: `/ws/pose` 서버 수신이 없음 — 정경호가 제안 절차를 확인하거나 수정안을 주면 맞춤
- 다음 한 단계·재개 위치: `python tools/fetch_mediapipe.py` 후 HTTPS로 서버 실행, 폰에서 `/camera/` 접속, "장비 정보"를 `docs/HARDWARE_CHECKLIST.md`에 옮기고 FPS 기록
- 인계 대상·넘긴 자료: 정경호 — `docs/DATA_CONTRACT.md`의 추가 필드와 `/ws/pose` 제안 절차
- 갱신한 계획 체크리스트·현황: P1 항목은 실기기 확인 전이라 `[ ]` 유지. 본 파일 요약·Phase 표, `진행현황.md` 김태이 행 갱신
- 종료·중단 시각: 2026-10-29 19:20 KST

### 2026-11-02 16:05 KST — 정경호 서버 통합 시험·연결 처리 수정

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분: 개인 개발 / 검증
- Phase: P1
- 상태: 검토 요청 — 코드 수정·통합 시험(replay), 실기기 미검증
- 읽은 계획·기록: 본 파일 2026-10-29 기록, `origin/feat/server-deployment`의 `정경호_progress.md`·`DATA_CONTRACT.md`(카메라 브랜치 호환 수신)·`DECISIONS.md` D07/D08·`SETUP.md` 3절, 서버 코드 `backend/server.py`·`ingest/`·`sync/clock.py`
- 연결할 계획 항목: P1 "등록·중복 ID 오류·송신 상태를 폰 화면에 표시하고 재접속 시 새 스트림으로 연결한다", "세 폰을 동시에 켜서 … 재접속을 정경호와 확인한다"(서버 측 일부)
- 이번 목표·완료 기준: 실제 서버 `/ws/pose`와 등록·시계·`pose_2d`가 오류 없이 이어지고, 재등록·프레임 오류·스트림 전환에서 송신이 멈추거나 반복 재등록하지 않음
- 검증 계획: 임시 worktree에서 `feat/server-deployment` + 카메라 브랜치 병합(문서 충돌은 시험용으로 서버 쪽 채택), Python 3.13, `pytest`, 브라우저 replay 2탭

진행·종료 결과:

- 바꾼 파일·결과물: `web/camera/pose-link.js`, `web/camera/app.js`, `web/camera/index.html`, `docs/DATA_CONTRACT.md`(5·6번 규칙)
- 어디까지 완료: 병합 코드 `pytest` 58개 통과. 서버 상태 C0 `receiving`, 시계 `ready`(불확실성 0.2 ms), `rejected {}`. 발견·수정한 버그 3건 — ① 같은 기기 두 탭이 4001로 서로 밀어내며 3초마다 재등록 반복(재현함) → 4001/4401/4403은 재연결하지 않고 안내 ② 등록 후 프레임 하나의 `error`로 그 연결 송신 전체 중단 → 등록 후 오류는 횟수만 표시하고 계속 송신 ③ 새 스트림 0번 프레임이 버퍼 초과로 버려지면 서버가 그 스트림을 계속 `stream_mismatch`로 거부 → `frame_id`를 실제 송신 시에만 증가
- 검증 방법·조건·실제 결과: ① 두 번째 탭 12초간 `등록됨` 유지, 첫 탭은 4001 안내 후 정지(재등록 없음) ② `image.width=-5` 프레임 1개 주입 → `1 · invalid_field` 표시, 이후 5초간 150프레임 계속 송신 ③ 송신 버퍼를 1.5초간 가득 찬 것으로 만든 채 640×480→480×640 영상 전환 → 44프레임 버림, 서버가 새 `stream_id`를 받아 `receiving`·30fps, 추가 거부 없음
- 입력·장비 범위: replay (PC 앱 내 Chromium). live 미실행
- 남은 일·미검증: 실제 폰·3대 동시, `captureTime` 제공 여부. ③의 수정 전 동작은 서버 코드로 판단했고 직접 재현하지 않음
- 막힌 점·도움·해제 조건: 서버 실행에는 Python ≥3.11 필요(numpy 2.4.4). 정경호 서버 주소·키·실행 시간 공유 필요
- 다음 한 단계·재개 위치: 정경호와 시간을 맞춰 실제 폰 1대 → 3대 접속, `HARDWARE_CHECKLIST.md` 기록
- 인계 대상·넘긴 자료: 정경호 — 수정된 종료 코드 처리(DATA_CONTRACT `/ws/pose` 5·6번), 병합 시 문서 충돌 4개(`DATA_CONTRACT.md`, `README.md`, `ARCHITECTURE.md`, `진행현황.md`) 예상
- 갱신한 계획 체크리스트·현황: 실기기 확인 전이라 P1 체크리스트 `[ ]` 유지. 본 파일 요약, `진행현황.md` 김태이 행
- 종료·중단 시각: 2026-11-02 16:05 KST

### 2026-11-03 20:50 KST — K-SC-03 PC 추론 어댑터 구현·검증

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 개발 / 단일 카메라 SC-02 K-SC-03 / 코드 구현·PC 검증 완료, 실제 폰 영상 미연결
- 읽은 계획·기록: 김태이_plan.md v0.2 K-SC 표, `docs/SINGLE_CAMERA_PLAN.md`·`SINGLE_CAMERA_INTERFACES.md` 4·5절, PR #5(`origin/feat/single-camera-monitor`)의 `SINGLE_CAMERA_MONITOR.md`·`frame-coordinator.js`·`main.js`·`game/controller.js`
- 연결할 계획 항목: K-SC-03 "PoseFrame·손목별 무효 사유·종료/자원 반환", T-SC-04~06/09/13/15 중 어댑터 범위
- 이번 목표·완료 기준: PR #5가 넘기는 빌린 캔버스 스냅샷을 받아 같은 frame 키의 PoseFrame을 만들고, 코디네이터 TTL(200 ms) 안에 돌려줌. 무효 손목은 사유와 함께 `valid=false`

진행·종료 결과:

- 바꾼 파일·결과물: `frontend/single/pose-adapter.js`(신규: `createPoseAdapter`·`attachPoseAdapter`·`toWrist`·`toPoseFrame`), `tests/single/pose-adapter.test.mjs`(신규 10개), `web/camera/pose.js`(손목 번호 export, `createPoseLandmarker(model, delegates)` 선택 인자 — 기존 호출 동작 동일)
- 동작: 런타임·모델은 `/camera/pose.js`를 실행 시점에 불러와 폰과 같은 고정 파일 사용(번들에 MediaPipe를 넣지 않음). 받은 meta를 그대로 두고 `wrists.left_wrist/right_wrist = {valid, image_norm, visibility, reason}`과 `inference{started/ended_at_pc_ms, model, delegate, runtime}` 추가. 사유: `not_detected`/`out_of_frame`/`low_visibility`(<0.5, PR #5 기준과 같음)/`non_finite`. 이미지는 닫거나 transfer하지 않음. 크기가 meta와 다르면 `frame_size_mismatch`. GPU 추론 중 예외 시 그 인스턴스를 닫고 다음 프레임부터 CPU로 다시 생성. stream/run이 바뀌어도 MediaPipe 시각은 단조 증가
- 발견·수정: 첫 실행에서 **모델 로딩 후 첫 `detectForVideo`가 8.9초 동안 메인 스레드를 막아** 그동안의 4초 분량 프레임이 모두 TTL 초과로 버려짐(가로 구간 matched 0). → `warmup()`이 빈 캔버스로 한 번 추론해 GPU 초기화를 미리 끝내고, `attachPoseAdapter`가 등록과 함께 실행. 수정 후 빈 추론 0.43초, 이후 폐기 0
- 검증 방법·조건·실제 결과: ① `node --test tests/single/pose-adapter.test.mjs` 10/10, 기존 `tests/test_camera_lifecycle.mjs` 6/6. ② 실제 MediaPipe e2e(스크래치 스크립트, 커밋 안 함): MacBook Air M4·Chrome 139 headless, FastAPI `/camera/pose.js`, PR #5 `frame-coordinator.js` 원본, MediaPipe 예제 사진(`mediapipe-assets/pose.jpg`)을 좌우로 움직여 그린 캔버스 스냅샷 30 fps 제출. GPU·lite, 로딩 0.66초. 640×480 4초: 115/115 정합, 28.8 fps, 추론 평균 16.0·최대 39.1 ms, 양손 115/115 유효. 480×640(run 2) 3초: 87/87, 29.0 fps, 평균 22.6 ms, 양손 유효. 사람 없음 1.5초: 44/44 정합·양손 `not_detected`. 크기 불일치·dispose 후 프레임은 `onInvalid`로 거부. 코디네이터 submitted 248·processed 246·dropped 0·failed 2(의도한 두 건). 좌우: 정면 인물의 `left_wrist`가 영상 오른쪽(x 0.64~0.96)으로 촬영자 기준 판별 유지
- 입력·장비 범위: synthetic/replay 스냅샷(사진 1장 이동), PC 브라우저 1종. 실제 폰 WebRTC 영상·live·Windows/다른 GPU·PR #5 화면 연동은 미실행
- 남은 일·미검증: PR #5 `index.html`에 `attachPoseAdapter(window.singleCameraMonitor)` 등록 위치(이동수 파일이라 머지 후 또는 합의 후). Worker/OffscreenCanvas 경로(K-SC-01 측정 항목) — 현재는 메인 스레드 동기 추론. 시연 PC의 GPU/CPU 대체·추론 시간
- 막힌 점·도움·해제 조건: 없음(독립 모듈). live 검증은 K-SC-02 폰 송신과 정경호 방/신호 서버가 있어야 함
- 다음 한 단계·재개 위치: K-SC-04 `frontend/single/hit-detector.js` — PoseFrame + PR #5 `getTarget()` 삼각형으로 손목 선분 판정
- 인계 대상·넘긴 자료: 이동수 — PoseFrame에 추가 필드 `inference`가 붙음(코디네이터 비교 키와 무관), 첫 GPU 추론 지연과 warmup 필요. 아직 메시지 발송 없음
- 갱신한 계획 체크리스트·현황: 실제 영상·실기기 전이라 K-SC-03 `[ ]` 유지. 본 파일 요약만 갱신. `진행현황.md` 김태이 행은 PR #5가 바로 위 이동수 행을 바꿔 충돌하므로 PR #5 머지 뒤 따로 갱신
- 종료·중단 시각: 2026-11-03 20:50 KST

### 2026-11-03 21:05 KST — K-SC-04 화면 2D 타격 판정 구현·검증

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 개발 / 단일 카메라 SC-03 K-SC-04 / 코드 구현·PC 검증 완료, 실제 폰 영상 미연결
- 읽은 계획·기록: `SINGLE_CAMERA_INTERFACES.md` 5절(HitEvent·선분·재무장·cooldown), `SINGLE_CAMERA_TEST_PLAN.md` T-SC-06/07/08/11, PR #5 `game/controller.js`(acceptHit 검사·pairs)·`target-provider.js`(image_norm 삼각형)·`main.js`(validateHit·onPoseFrame 순서)
- 연결할 계획 항목: K-SC-04 "HitEvent·연속/재무장·속도/설정 버전", 완료 기준 "빠른 통과·빈 공간/정지·복구 첫 점·중복 검사"
- 이번 목표·완료 기준: PoseFrame과 `getTarget()`만으로 PR #5 GameController가 수락하는 HitEvent를 만들고, 정지·느린 겹침·빈 공간·끊긴 궤적은 타격하지 않음

진행·종료 결과:

- 바꾼 파일·결과물: `frontend/single/hit-detector.js`(신규: `HitDetector`·`attachHitDetector`·`clipSegment`·`firstEntry`·`HIT_CONFIG`), `tests/single/hit-detector.test.mjs`(신규 10개)
- 동작: 손목별 직전 유효 점→현재 점 선분을 삼각형 합집합에 Cyrus–Beck으로 잘라 가장 먼저 들어간 지점(경계 바로 안쪽)을 타격점으로 씀. 양 끝이 밖이어도 통과하면 후보. 조건: 직전 점이 활성 목표 **밖**에서 관측됨(재무장), dt 0 초과·200 ms 미만, 속도 ≥ 0.5 대각선/초, 손목별 cooldown 300 ms, 목표 `active`·`transform_version` 일치, session_id 있음. room/stream/run/transform/session이 바뀌면 궤적 초기화(첫 점은 기준점만). 양손 동시 후보는 먼저 들어간 쪽 1건. 속도는 인터페이스 정의대로 `hypot(dx_px, dy_px)/hypot(w,h)/dt`. `hit_point_m`·`speed_mps`는 null. 판정 사유(`baseline`/`invalid_wrist`/`gap`/`no_target`/`disarmed`/`missed`/`too_slow`/`cooldown`/`hit`/`no_session`)를 손목별·누적으로 보관. 임계값은 `config_version: hit-2d-1`로 이벤트에 기록
- 발견·수정: PR #5 GameController와 결합 시험에서 게임 시작 전 손짓마다 이벤트가 만들어져 `not_playing` 거부 로그가 쌓임 → session_id가 없으면 이벤트를 만들지 않음
- 검증 방법·조건·실제 결과: ① `node --test tests/single/*.test.mjs` 20/20(어댑터 10 + 판정 10). ② PR #5 결합(임시 worktree, 커밋 안 함): 실제 `GameController`+`TargetProvider.contains`로 시작 전 0건, 첫 타격 수락·100점, 같은 이벤트 재전송 `duplicate_event`, 파괴 후 추가 점수 0, 복원 후 손이 건물 안에 있으면 타격 0 → 밖으로 나갔다 들어오면 수락, 60초 종료 후 타격 `not_playing` 거부. PR #5 자체 테스트 19/19 유지. ③ 실제 MediaPipe e2e(MacBook Air M4·Chrome 139 headless·GPU, PR #5 FrameCoordinator + 어댑터 + 판정, 사진을 움직인 640×480 스냅샷): 왼손목이 쉬는 위치에 폭 0.04의 막대 목표를 두고 — 정지 3초 87프레임 타격 0(손목 x 변동 0.001), 느린 흔들기(약 0.2 대각선/초) 4초 116프레임 타격 0, 빠른 흔들기(약 1.1) 4초 116프레임 타격 11·cooldown 10(통과 약 21회, 0.3초 간격 제한과 일치), 측정 속도 0.99~1.36
- 입력·장비 범위: synthetic(단위·결합 시험) / replay 스냅샷(사진 1장 이동). 정지 사진이라 실제 카메라의 손목 흔들림(지터)은 재현하지 못함. 실제 폰·live·사람 동작은 미실행
- 남은 일·미검증: 0.5/초·300 ms는 출발값이며 실제 폰 파일럿에서 지터·실제 타격 속도로 조정 필요. PR #5 화면 등록(`attachHitDetector(window.singleCameraMonitor)`). 깊이를 재지 않으므로 건물 앞뒤 손도 겹치면 타격(단일 2D 모드의 알려진 한계)
- 막힌 점·도움·해제 조건: 없음(독립 모듈)
- 다음 한 단계·재개 위치: K-SC-05 수락된 타격의 소리·연출 충격 연결
- 인계 대상·넘긴 자료: 이동수 — HitEvent에 `observed_at_pc_ms`·`config_version` 추가 필드, 판정기는 `getTarget()`을 프레임마다 호출. 메시지 발송 없음
- 갱신한 계획 체크리스트·현황: 실제 영상·실기기 전이라 K-SC-04 `[ ]` 유지. 본 파일 요약만 갱신(`진행현황.md`는 PR #5 충돌 회피로 보류)
- 종료·중단 시각: 2026-11-03 21:05 KST

### 2026-11-03 17:19 KST — 단일 카메라 v0.2 역할 계획 추가

- 담당 / 기록자: PM·공통 계획 / Codex. 개인 개발 수행 보고가 아니라 사용자 지시에 따른 역할 계획 연결이다.
- 작업 구분·Phase·상태: 문서 / SC-00~05 추가 경로 / 역할 계획 반영 완료, 기능 미착수.
- 읽은 계획·항목: PM 계획·단일 실행 계획 v0.2 및 김태이_plan.md의 기존 SC 요약·개인 Phase/마지막 기록. 세부 K-SC-01~06을 추가했다.
- 목표·결과물: 김태이_plan.md에 받을 입력·파일 경계·완료/인계·T-SC 시험을 명시. 공통 인터페이스/검증 문서와 팀 현황 연결.
- 검증 범위: 문서 링크·ID·기존 체크리스트 보존은 PM 기록의 문서 검증 결과를 따른다. 개인 앱/모듈/실기기 시험은 이번 작업에서 실행하지 않음.
- 입력·장비 범위: 해당 없음(계획 문서). 기존 개발 검증과 실제 장비 미검증 사실은 유지.
- 남은 일·막힘: 담당자 가용 일정·실제 폰/PC/망 확인, 상세 계약 미정 항목을 구현 PR에서 해소. 다른 담당의 구현 완료를 가정하지 않음.
- 다음 행동·재개: K-SC-01 장비/PC 추론 시제품·J-SC-02 신호/K-SC-02 송신 준비, 11-09 실제 폰 시험. 해당 개인 계획의 v0.2 체크리스트부터 시작 기록을 남긴다.
- 체크리스트·현황: 새 기능 6개 모두 미완료, 기존 P0~P6 상태/체크 유지. 현황의 다음 행동만 갱신. 팀원 메시지 발송 없음.
- 종료 시각: 2026-11-03 17:19 KST. PR #4 문서 변경에 함께 공유하며 머지 결과는 PM 기록에 남긴다.

### 2026-11-03 17:44 KST — 이동수 PC 소비자 구현 인계 문서 연결

- 기록자/구분: 이동수·PM 인계 / Codex. 담당자의 실제 개발 수행/완료 기록이 아님.
- 자료: [단일 PC 실행·인계](../docs/SINGLE_CAMERA_MONITOR.md), frontend/single/ 및 frontend/game/. attachPoseProcessor/onPoseFrame/acceptHit·getTarget를 연결한다. PoseFrame은 빌린 원본 스냅샷/메타 키·세션·출처를 보존하고 wrists.left_wrist/right_wrist를 반환한다. 실제 손목 추출/선분/소리 구현은 해당 담당 범위다.
- 검증/범위: PC 합성·실제 RTC 브라우저 피어로 독립 검증. 상대 모듈과 실제 폰/서버 연결은 아직 미검증이며 개인 Phase 체크는 유지.
- 다음: 개인 SC 계획의 해당 생산 모듈에서 위 문서의 양방향 예제를 사용하고 실제 수신 결과/버전을 기록한다. 메시지 발송·상대 인수 완료를 추정하지 않는다.

### 2026-11-03 23:12 KST — PR #5 소비자 검토 수정 인계

- 기록자/범위: PM 코드 검토 / Codex. FrameInput 메타는 동결된 읽기 전용 객체다. {...meta, wrists}로 결과를 반환하고 원본 시각/키를 변경하지 않는다. 추론 미등록 시 영상만 보이며 손목 valid=false/시작 차단을 유지한다. HitEvent는 허용된 손목·증가 정수 프레임 쌍이 필수다.
- 자료/검증: SINGLE_CAMERA_MONITOR.md의 PR 검토 보완과 pr5-review.json에 연결한다. PC 재현/회귀만 수행하며 실제 담당 개발 완료·실기기/공통 Phase 체크는 유지한다. 메시지 발송·상대 검토 완료를 의미하지 않는다.

### 2026-11-04 15:28 KST — PR #6 최신 main 반영·머지 준비

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·상태: PR 관리 / K-SC-03·04 / 머지 전 검증
- 운영 원칙(사용자 결정, 2026-11-04): 김태이 브랜치·파일만 수정하고 다른 팀원이 만든 브랜치·코드·PR은 수정·머지하지 않는다. 김태이 PR은 김태이가 직접 올리고 검증 후 직접 머지한다.
- 내용: PR #5 머지(7b0990a)를 `feat/single-pose-adapter`에 병합(충돌 없음). PR #5로 미뤄 둔 `진행현황.md` 김태이 행만 갱신. PR #5 검토 보완(읽기 전용 FrameInput 메타, HitEvent 손목 이름·증가 정수 프레임 검사)과 두 모듈의 호환을 머지 전 검사로 확인
- 다음: 검증한 head로 머지, K-SC-05 소리·연출 충격

### 2026-11-04 15:30 KST — PR #6 머지 완료

- 담당 / 기록자: 김태이 / Claude Code
- 결과: PR #6(K-SC-03·04)을 검증한 head 952b4e4로 김태이가 직접 머지. 머지 커밋 6b24edf, main 트리가 검증 트리와 동일함을 확인. 머지 전 tests/single 45/45·카메라 6/6·서버 4/4·check_scaffold·build:all(커밋된 번들과 동일)·실제 MediaPipe replay 통과
- 미검증: 실제 폰·live, PC 화면 등록(이동수 파일)

### 2026-11-04 18:15 KST — K-SC-05 타격 소리·화면 등록 모듈

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 개발 / 단일 카메라 SC-04 K-SC-05(소리 부분), K-SC-03·04 연결 준비 / 코드 구현·PC 검증, 실제 폰 미연결
- 읽은 계획·기록: 김태이_plan.md K-SC-05·P2 "소리", 발표 19장(사전 분할·물리·소리), `SINGLE_CAMERA_MONITOR.md` 연결 API, PR #5 `main.js`(matched·acceptHit·pagehide)·`game/controller.js`(start 준비 검사)·`tests/browser/single-camera*.spec.js`
- 연결할 계획 항목: K-SC-05 "거부/중복 타격 무음·무점수, 반복 복원과 오디오 시작 권한 확인"
- 바꾼 파일·결과물:
  - `frontend/single/hit-sound.js`(신규): Web Audio 합성음(저음 쿵·붕괴 잡음·파편 딸깍 4개), 파일 없음. 속도→음량 0.55~1(연출용, 실측 힘 아님). 동시 3개 제한, 잡음 버퍼 재사용. `prepare()`로 꺼진 상태의 오디오를 미리 만들고 `unlock()`은 사용자 클릭·키 입력 때 켜기만 함
  - `frontend/single/tracking.js`(신규): 어댑터·판정기·소리를 `window.singleCameraMonitor`에 한 번에 등록. **게임이 수락한 타격에만** 소리. 첫 클릭·키 입력에서 오디오 켜고 리스너 제거. pagehide 때 정리. 이 파일은 `index.html`이 main.js 다음에 불러야 동작(이동수 파일이라 아직 미등록)
  - `frontend/single/pose-adapter.js`: `attachPoseAdapter(..., { eagerWarmup })` 추가. 미리 추론을 하지 않으면 첫 실제 프레임에서 그 크기로 1회 미리 추론
  - 시험: `tests/single/hit-sound.test.mjs`(11), `tracking.test.mjs`(6), `pose-adapter.test.mjs`(+3), `hit-detector.test.mjs`(+1)
- 발견·수정: ① 등록 즉시 미리 추론하면 소프트웨어 WebGL(이동수 Playwright 설정)에서 페이지가 9.2초 멈춰 합성 모드 시험이 실패 → tracking은 미리 추론을 첫 실제 프레임까지 미룸(합성 모드는 MediaPipe를 불러오지 않음). ② 시작 클릭 때 AudioContext를 만들면 280 ms 멈춰 손목 정보가 만료돼 시작이 거부됨(합성 시험 3/3 실패 재현) → 페이지 로드 때 미리 만들고 클릭 때는 resume만(0.1 ms)
- 검증 방법·조건·실제 결과: ① `node --test tests/single/*.test.mjs` 66/66(김태이 모듈 41 + 이동수 모니터·전송 25). ② 임시 worktree에서 최신 main + 이 변경 + `index.html` 등록 한 줄로 `build:single`, MacBook Air M4·Chrome 139 headless, 휴대폰 역할은 **별도 브라우저 창**(사진 이동 영상 canvas → WebRTC), 신호 서버는 PR #5 검토 시험과 같은 가짜 WebSocket: 첫 1초 미리 추론 중 4프레임 폐기 후 2초에 시작 가능, 시작 전 빠른 손짓 이벤트 0, 느린 통과 타격 0(`too_slow`), 빠른 통과 수락 → 100점·파편 96·서버 로그 수락 1건, **소리 1회 재생 후 사용 중 소리 0으로 복귀**, 처리 471·실패 0·GPU. ③ 같은 빌드로 이동수 브라우저 시험(single-camera·review, Chrome 소프트웨어 WebGL) 2회 반복: 14 통과·6 실패 = 3개×2. 실패는 "추론 어댑터 없음"을 전제로 한 2개(`single live entry ... pose adapter are missing`, `received video ... pose adapter is absent`)와 등록 없이도 이 Mac에서 실패하는 페이지 캐시 복귀 1개
- 전역·지역 리뷰(서브에이전트 2개, 읽기·시험만) 반영: 확정 계약 불일치 없음(한 프레임 추적·필드/프레임 쌍/TTL/건물 ID 일치, 전체 검사 통과, 커밋된 번들 최신). 김태이 코드 지적 반영 — ① 오디오 켜는 중 정리되면 처리 안 된 오류 → 정리 후엔 false 반환 ② 처음 켠 뒤 클릭 감지를 없애 OS/Safari가 다시 멈추면 계속 무음 → 감지를 유지하고 `interrupted`도 다시 켬 ③ 겹친 소리 클리핑 → 전체 음량 ×0.45 ④ 소리 생성 중 예외가 손목 리스너로 번져 입력이 지워질 수 있음(옛 Safari `connect()` 연결) → 연결을 나누고 예외 시 `error`로 건너뜀 ⑤ 모델 로드 실패 시 매 프레임 재시도·안내 소실 → 5초 간격 재시도·`info().loadError` ⑥ 시간 종료 뒤에도 휘두를 때마다 거부 로그 전송 → 플레이 중이 아니면 보내지 않음 ⑦ `models/README.md` 미리 추론 설명 갱신. 반영하지 않은 것: 판정 설정·속도의 서버 로그 기록(이동수 controller/main 수정 필요), 휴대폰 연결 직후 모델 준비 중 표시(이동수 화면), 이동수 코드 지적(아래 인계)
- 입력·장비 범위: synthetic(단위) / replay(사진 이동 영상, 별도 창 송신·가짜 신호). 스피커로 실제 청취·실제 폰·live는 미실행
- 남은 일·미검증: 이동수에게 `index.html` 등록 한 줄과 위 시험 2개의 전제 변경 요청. 음량·음색 실제 청취 조정, 파편 물리의 타격 세기 연결(이동수 FractureView 영역)
- 막힌 점·도움·해제 조건: 화면 등록은 이동수 파일 수정이 필요
- 다음 한 단계·재개 위치: 김태이 폰 1대 실기기 측정
- 인계 대상·넘긴 자료: 이동수 — 등록 방법(`<script type="module" src="./tracking.js">`를 main.js 다음에), 바뀌어야 할 시험 2개, 오디오·미리 추론 시점 이유, 전역 리뷰가 찾은 이동수 코드 항목(세로 영상일 때 검은 띠 위 건물은 타격 불가, 로그 `model_version`이 건물 ID, 판정 설정·속도 로그 누락, 문서의 PoseAdapter/HitDetector '후속' 표기). 메시지 발송 없음
- 갱신한 계획 체크리스트·현황: 실제 청취·실기기 전이라 K-SC-05 `[ ]` 유지. 본 파일 요약, `진행현황.md` 김태이 행
- 종료·중단 시각: 2026-11-04 18:25 KST

### 2026-11-04 18:23 KST — PR #7 머지 완료

- 담당 / 기록자: 김태이 / Claude Code
- 결과: PR #7(K-SC-05 소리·화면 등록 모듈)을 검증한 head 4a21284로 김태이가 직접 머지. 머지 커밋 e50d5b3, main 트리가 검증 트리와 동일함을 확인. 머지 전 tests/single 66/66·카메라 6/6·서버 4/4·check_scaffold·build:all(번들 변경 0)
- 미검증: 실제 폰·스피커 청취, PC 화면 등록(이동수 파일)

### 2026-11-08 12:50 KST — 방 2 실제 폰 시험 (정경호 PR #8, 미머지)

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 검증 / 단일 카메라 SC-05 입력 파일럿·11-09 사전 확인 / 실제 폰 1대 시험 완료. 개발 Phase 통과·공통 Phase 판정과 별개
- 읽은 계획·기록: PR #8 본문, `docs/PHONE_POSE_GAME.md`·`ROOMS.md`·`SETUP.md`·`SINGLE_CAMERA_PLAN.md`(PR #8), main `SINGLE_CAMERA_PLAN.md` 11-05~09 일정, 김태이_plan.md K-SC-05·06, 정경호_progress 11-06
- 연결할 계획 항목: K-SC-06(입력 파일럿·실기기 인계)의 live 파일럿 1회, K-SC-05의 수락 타격→소리 확인 일부
- 이번 목표·완료 기준: 11-09 전에 PR #8 방 2를 실제 폰으로 실행해 연결·수락 타격·점수·파편·소리·시간 종료·폰 퇴장 시 종료가 PC와 서버에서 일치하는지 확인
- 검증 계획: PR #8 코드를 수정하지 않고 실행, PC 화면 상태를 0.1초 간격으로 기록, 서버 방 상태 API·서버 로그와 대조, 소리는 사용자 청취로 확인
- 바꾼 파일·결과물: 없음(이 기록만)
- 시험 대상: PR #8 head `21ab784`(정경호 `feat/server-deployment`)를 임시 worktree에 꺼냄. 코드는 수정하지 않았고, Git 제외 대상인 `web/public/vendor/mediapipe`만 main 작업 폴더에서 복사. 화면은 `/monitor/phone-game/?room=room-2` — 폰 MediaPipe lite 추론, C0 서버 JPEG 중계, 같은 스냅샷의 손목을 김태이 `hit-detector`·`hit-sound`와 이동수 게임이 사용(PC 재추론 없음)
- 실행 방법(SETUP.md 절차와 다름): 저장소 밖 임시 실행 스크립트로 한 앱 프로세스를 두 주소로 제공 — 폰용 HTTPS 8443(이 Mac LAN IP용 7일 자체 서명 인증서, 폰에서 경고 수락), PC 화면용 `http://localhost:8000`(앱 내장 브라우저가 자체 서명 인증서를 거부해서 추가). 접속 키는 시험용 임의값(저장소 밖 보관). 실제 주소·키는 저장소에 적지 않음
- 장비·환경: 서버·PC 화면 MacBook Air M4(macOS 26.2), Python 3.13 venv(PR #8 requirements), PC 화면은 Claude 앱 내장 브라우저. 폰 1대(김태이 폰, 기종·브라우저 버전 미기록), 같은 공유기 Wi-Fi
- 실행 순서: PC 방 2 입장 → 폰 좌표 게임 링크 → 휴대폰 연결 준비 → 폰에서 방 2 QR 입장(C0·후면·서버 중계 JPEG) → 시작
- 실제 결과(시각은 시작 클릭 직전에 켠 PC 기록 기준):
  - 연결: 폰 HTTPS 페이지·WebSocket·모델 로드 정상. 서버 등록 room-2/C0/transport=server. 시작 전 5초 측정 영상·손목 짝 9.6장/초, 폐기 0·실패 0, 왼손목 유효 48/48·오른손목 30/48
  - 1판: 약 26.4초에 실제 폰 입력으로 타격 수락 → 100점·파편 96. 약 60.1초 `time_up` 종료(서버 elapsed 60000 ms). 26.4초 시점의 PC 연결 이후 누적 정합 프레임 1,237·폐기 0. 서버 game: phone_2d·ended·score 100·`time_up`
  - 소리: 1판 파괴 후 맥 스피커로 타격음을 들었다고 사용자 확인
  - 2판: 약 4.6초 타격 수락 → 100점(파편 수는 따로 기록하지 않음). 사용자가 폰에서 "퇴장"을 누른 뒤 PC가 약 10.4초에 `ended`·`camera_disconnected`로 바뀌고 시작 버튼 잠김(퇴장 시각을 따로 재지 않아 퇴장→종료 지연은 미측정). 서버 game: elapsed 약 10.3초·score 100·`camera_disconnected`
  - 서버 오류·예외 0건
- 관찰(정경호에게 전달할 것, 김태이가 수정하지 않음):
  1. 코드 확인: 폰 퇴장 후에도 PC 영상 상태가 "수신 중"(`videoState=live`)으로 남음. 손목은 "대기/만료"·ready=false·시작 잠김이라 판정 영향 없음(표시만 틀림). `PairedReceiver`는 `deliver()`에서 live로, `stop()`에서만 disconnected로 바꾸고 카메라 이탈 때는 바꾸지 않음
  2. 환경 관찰(코드 버그로 확인되지 않음): 앱 내장 브라우저 창이 숨겨진 상태에서 한 번 PC 연결이 끊김("서버 응답이 끊겼습니다", 서버 monitor_connected=false). 원인 미확인 — 백그라운드 타이머 지연으로 heartbeat가 만료됐을 가능성. 창을 보이게 하고 다시 연결하자 즉시 정상. 11-09에는 PC 창을 앞에 두고 절전을 끌 것
  3. 시작 직후 약 0.1초 "입력이 끊겼습니다" 표시 후 정상(2판 모두). 표시만, 영향 없음
- 미검증: 느린 통과 비타격(사용자 동작 미기록, 이 화면은 판정 기록을 외부에서 읽을 수 없음), 거부/중복 타격 무음·무점수의 실폰 확인, 반복 복원, 장시간·지연 정량, 다른 네트워크·외부 주소, 방 1(3대), 아이폰/안드로이드별 차이, PC 추론 경로의 실제 폰 연결
- 입력 구분: live(실제 폰 카메라·실제 MediaPipe). 합성·replay 아님
- 막힌 점·도움·해제 조건: 없음. 11-09 재현에는 PR #8 머지 또는 같은 임시 실행 방법이 필요
- 다음 한 단계·재개 위치: PR #8 머지 여부 팀 확인 후 11-09 같은 순서로 방 2 재현
- 인계 대상·넘긴 자료: 정경호 — 위 관찰 3건, 실폰 시험 결과. 이동수(PM) — `진행현황.md` 김태이 행이 실폰 결과보다 오래됨(PR #8 머지 직후 갱신 예정). 메시지 발송 없음
- 갱신한 계획 체크리스트·현황: 본 파일 요약. `진행현황.md` 김태이 행은 PR #8이 같은 행을 수정하므로 충돌을 피하려 이번에 바꾸지 않음. K-SC-05 `[ ]` 유지(거부/중복 타격 무음·무점수와 반복 복원을 실폰으로 확인하지 않음). K-SC-06 `[ ]` 유지(live 파일럿 1회, T-SC 기록·손별 파일럿·가림 미작성)
- 종료·중단 시각: 2026-11-08 12:50 KST

### 2026-11-09 — 실제 장비 시험 (정경호 PR #10 기준, 사용자 보고)

- 담당 / 기록자: 김태이 / Claude Code (사용자 보고를 옮겨 적음)
- 작업 구분·Phase·상태: 검증 / 11-09 실제 장비 시험 / 시험 완료, 세부 수치 미기록
- 시험 대상: 정경호 PR #10(`feat/3d-test-pages`, 당시 미머지 → 11-10 00:50 KST main 반영) 기준
- 장비·환경: 서버 정경호 PC. 폰 1대 시험과 3대 시험 모두 진행. 바닥 마커는 정경호 A4 PDF(ArUco 20 cm), 화면의 마커 한 변 20 cm 그대로. 폰 기종·브라우저·Wi-Fi 종류는 미기록
- 실제 결과: 사용자 보고로 "잘 작동했다". 화면 수치·로그·타격 횟수·FPS는 이 기록에 없음(김태이 Mac에 로그 없음)
- 결정: 같은 날 팀이 손목 외에 **발목(발차기)도 타격 관절로 넣기로** 함(스트레스 해소 목적). 구현은 아래 11-10 기록
- 미검증: 수치 근거(로그·영상) 없음. 정경호 기록이 올라오면 대조
- 입력 구분: live(실제 폰)
- 종료·중단 시각: 2026-11-09 (시험 종료 시각 미기록)

### 2026-11-10 16:30 KST — 발차기(발목) 타격 판정 모듈

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 구현 / 단일 카메라 K-SC-04 확장·P4(3D 충돌) 준비 / 김태이 파일 구현·합성 검증 완료, 연결·실폰 미검증
- 읽은 계획·기록: main `42d50f3`의 `test_multi3d.py`·`web/test/mono3d/*`(PR #10), `frontend/game/controller.js`, `frontend/single/main.js`, `backend/ingest/game_pose.py`·`schemas.py`, 이 파일 11-08 기록
- 이번 목표·완료 기준: 김태이 파일만 바꿔 발목을 2D·3D 판정에 넣고, 다른 사람 파일 연결은 요청 문서로 남김. 기존 손목 판정과 배포 화면 동작은 그대로
- 바꾼 파일·결과물: `frontend/single/hit-detector.js`(발목 `pose.ankles`, 발목 속도 기준 0.8, `hit-2d-2`), `frontend/single/pose-adapter.js`(MediaPipe 27/28 → `ankles`), 새 파일 `backend/foot_strike.py`·`web/shared/foot-strike-3d.js`(3D 발차기: 들어 올림 0.20 m·속도 1.5 m/s·딛는 발 기준 건물 자리 판정·cooldown 300 ms), `tests/fixtures/foot_strike_cases.json`(공용 사례 12개), `tests/test_foot_strike.py`·`tests/test_foot_strike.mjs`, `tests/single/hit-detector.test.mjs`·`pose-adapter.test.mjs`, `docs/FOOT_STRIKE.md`
- 확인 방법·실제 결과: `node --test tests/single/*.test.mjs` 74/74, `node --test tests/test_foot_strike.mjs` 13/13, `pytest tests` 176/176(Python 3.13 venv). 전체 `node --test tests/*.mjs tests/single/*.test.mjs`는 126개 중 16개 실패 — 같은 16개가 변경 전 main에서도 실패(카메라 생명주기·동기화 시험, 이번 변경과 무관)
- 확인된 사실: `test_multi3d.py`의 "건물 자리에 서 있음"은 두 발목 평균을 써서 발차기 중 차는 발이 평균을 건물 쪽으로 끌어 발차기를 막을 수 있음(공용 사례로 재현). 3D 판정에는 속도 기준이 없어 바닥부터 서 있는 건물에 걸음만으로 들어가도 타격이 됨. `controller.js`는 손목이 아닌 `joint`를 `invalid_units_or_fields`로 거부
- 미검증: 실제 폰 발차기, 기준값 조정, mono3d에서 발을 들 때 바닥 기준(`floorAnchor`) 영향, 화면 번들 재빌드(하지 않음)
- 입력 구분: 합성(손으로 만든 좌표 사례)
- 인계 대상·넘긴 자료: 정경호 — `game_pose.py` 발목 전달, `test_multi3d.py`·mono3d 연결(FOOT_STRIKE.md 4장). 이동수 — `controller.js` 발목 허용·`main.js` 발목 전달·번들 재빌드. 메시지 발송 없음(사용자가 전달)
- 갱신한 계획 체크리스트·현황: 본 파일 요약, `진행현황.md` 김태이 행. K-SC-04·05·06 `[ ]` 유지
- 종료·중단 시각: 2026-11-10 16:30 KST

### 2026-11-10 17:16 KST — PR #13 머지 완료

- 담당 / 기록자: 김태이 / Claude Code
- 결과: [PR #13](https://github.com/DS-J-L/SMASH-KNU-AR/pull/13) head `6f2179c`를 검증한 SHA로 지정해 main에 머지(merge commit `a42a1a6`, kimtaei1223). 머지 전 main `42d50f3` 그대로·충돌 없음·리뷰/댓글 0·자동 검사 없음. PR 본문에서 정경호(@jkh0515)·이동수(@DS-J-L)에게 연결 요청 멘션
- 남은 일: 연결 대기(정경호 `game_pose.py`·3D 연결, 이동수 `controller.js`·`main.js`), 실폰 발차기 시험

### 2026-11-10 17:40 KST — IT1 모델 모양 3D 타격 판정 (P4 착수)

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 구현 / P4 실제 3D 궤적 충돌·타격 이벤트 / 김태이 모듈 구현·합성 검증 완료, 연결·실폰 미검증
- 읽은 계획·기록: 김태이_plan.md P4, 정경호·이동수 plan P4 범위, `test_multi3d.py`·`web/test/mono3d/*`(PR #10), IT1 `manifest.json`·`colliders.json`·`frontend/game/package-runtime.js`
- 이번 목표·완료 기준: PR #10 3D 시험의 상자 대신 IT1 모델 모양으로 손목·발목 타격을 판정하는 모듈을 김태이 새 파일로 만들고, 배치(마커 위치·회전·배율)를 화면과 공유할 수 있게 한다. 다른 사람 파일은 바꾸지 않는다
- 바꾼 파일·결과물: 새 파일 `web/shared/model-strike-3d.js`, `backend/model_strike.py`, `tests/fixtures/model_strike_cases.json`(ㄴ자 시험 건물 손 계산 사례 13개), `tests/test_model_strike.py`·`.mjs`, `docs/MODEL_STRIKE_3D.md`
- 동작: 파편 볼록 껍질 96개를 마커 좌표로 옮겨 면 평면을 만들고, 관절 직전→현재 선분이 처음 들어가는 파편·점을 찾는다. 첫 점은 기준점만, 발목은 들어 올림 0.20 m·1.5 m/s, 딛는 발 기준 건물 자리 판정, cooldown 300 ms, 한 프레임 한 이벤트, 첫 타격에 파괴·`restore()`로 복원. 이벤트 `hit_3d`에 `fragment_id`·`point_m`·속도·배치
- 확인 방법·실제 결과: `pytest tests` 197/197(Python 3.13 venv), `node --test tests/single/*.test.mjs tests/test_foot_strike.mjs tests/test_model_strike.mjs` 104/104. 실제 IT1: 범위가 manifest 크기(2.81×0.63×1.08 m)와 일치, 96개 껍질 모두 닫힘, 껍질 합 부피 약 1.60 m³(파편 부피 합 1.56 m³), 격자 표본에서 겹침 없음, 생성 시간 브라우저 약 0.05초·서버 약 0.5초. TestClient: `/shared/model-strike-3d.js`·IT1 `colliders.json` 모두 키 없으면 401, 키 있으면 200(3D 시험 페이지와 같은 조건)
- 확인된 사실: IT1 정면은 평평하지 않아 마커 x=0·높이 0.5 m에서 벽면이 범위 끝(−0.313 m)보다 안쪽(−0.292 m)에 있음
- 미검증: 실제 폰 3D 좌표로 시험, 3D 오차에 맞춘 `margin_m`, 배치 값(팀 결정 전 기본값), IT1 분석형 QA 패키지 형식
- 입력 구분: 합성(손 계산 좌표)과 실제 IT1 패키지 기하
- 인계 대상·넘긴 자료: 이동수 — 배치 값 결정·3D 화면에 IT1 그리기·파편 연출·계약 기록. 정경호 — `test_multi3d.py`·mono3d 연결, 발목·골반 3D 점 확인(MODEL_STRIKE_3D.md 6장). PR 본문 멘션 예정
- 갱신한 계획 체크리스트·현황: 본 파일 요약, `진행현황.md` 김태이 행. P4 체크박스는 실제 3D 궤적 시험 전이라 `[ ]` 유지
- 종료·중단 시각: 2026-11-10 17:40 KST

### 2026-11-10 19:01 KST — PR #14 머지 완료

- 담당 / 기록자: 김태이 / Claude Code
- 결과: [PR #14](https://github.com/DS-J-L/SMASH-KNU-AR/pull/14) head `1f2f64c`를 검증한 SHA로 지정해 main에 머지(merge commit `bb997e2`, kimtaei1223). 머지 전 main `a42a1a6` 그대로·충돌 없음·리뷰/댓글 0·자동 검사 없음. 머지 후 main에서 Python 197·JS 104 통과 확인. PR 본문에서 이동수(@DS-J-L)·정경호(@jkh0515)에게 연결 요청 멘션
- 남은 일: 연결 대기(이동수 배치·화면, 정경호 `test_multi3d.py`·mono3d), 실폰 3D 타격 시험

### 2026-11-11 14:37 KST — 부분 파괴: 맞은 곳 블럭 3개, 이어진 블럭이 하나도 없으면 낙하, 1타 1점

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 구현 / P4 실제 3D 궤적 충돌·파편·타격 이벤트 / 김태이 판정 구현·합성 검증 완료, 연결·연출·실폰 미검증
- 사용자 결정(11-11): 한 번에 부서지는 범위는 블럭 3개, 받치던 아래가 부서지면 위도 떨어짐, 점수는 타격 하나당 1점. 판정(김태이 역할)부터 시작. 이어서 "블럭 하나라도 이어져 있으면 부서지지 않도록" 정정 → 아래만 받침으로 보던 첫 구현을 바꿔, 면을 맞댄 블럭(아래·옆·위)을 따라 바닥까지 이어지면 남고 끊긴 블럭·덩어리만 떨어지게 함
- 읽은 계획·기록: 김태이_plan.md P4, main `61e2818`(이동수 PR #15·#16·#17: 캠퍼스 v71 123개, 64조각 연습 건물 3개), `frontend/game/fragment-bodies.js`(파편 전부 한꺼번에 풀고 맞은 점 근처만 세게), `frontend/game/controller.js`(건물당 한 번 100점)
- 이번 목표·완료 기준: 첫 타격에 건물 전체가 부서지던 3D 판정을, 맞은 곳 주변만 부서지고 바닥과 이어진 블럭이 없어진 부분만 떨어지도록 바꾼다. 브라우저·서버 판정이 같은 결과를 내고, 실제 건물이 처음엔 서 있어야 한다. 다른 사람 파일은 바꾸지 않는다
- 바꾼 파일·결과물: `web/shared/model-strike-3d.js`·`backend/model_strike.py`(면 맞댐 연결 계산 `faceContact`/`face_contact`·`links`, `blocksToBreak`/`blocks_to_break`, `unsupported`, `damage_mode` partial/whole/none, `break_count` 3, `config_version` `model-3d-2`, 이벤트 `model_strike.v2-draft`에 `points`·`broken_fragment_ids`·`fallen_fragment_ids`·`remaining_fragments`, 부서진 파편은 빈 공간), `tests/fixtures/model_strike_cases.json`(시험 벽 10블럭과 사례 4개 추가, 기존 2개 갱신), `tests/test_model_strike.py`·`.mjs`, `docs/MODEL_STRIKE_3D.md` 5장 추가
- 확인 방법·실제 결과: `pytest tests` 208/208(Python 3.13 venv), `node --test tests/single/*.test.mjs tests/test_foot_strike.mjs tests/test_model_strike.mjs` 115/115. 전체 `node --test tests/*.mjs tests/single/*.test.mjs`는 154개 중 16개 실패 — 같은 이름 16개가 현재 main `61e2818`에서도 실패(카메라 생명주기·동기화 시험, 이번 변경과 무관)
- 실제 건물 5개(IT1 96, 본관 85, IT5·중앙도서관·글로벌플라자 연습 64): 처음엔 떨어지는 조각 0, 바닥 조각을 모두 없애면 나머지 전부 낙하, 멀쩡한 건물의 어느 조각을 처음 쳐도 추가 낙하 거의 없음(본관 2곳 1개). 한 가지 순서로 끝까지 부수면 IT1 25번·본관 24번·연습 17~21번, 덩어리째 낙하 1~3번(IT1 최대 17조각). 브라우저·서버 판정을 두 배치(기본, 이동·회전·0.8배)에서 같은 순서로 돌려 연결 구조·부서짐·낙하가 모두 같음(별도 확인 스크립트, 커밋 안 함). 계산 시간 서버 0.03~0.38초·브라우저 5~72 ms(시작 때 한 번)
- 확인된 사실: 연습 건물 3개는 밑면이 평평하지 않아 가장 아래 조각이 0~11 cm 위에서 시작한다. "바닥에 닿음(z≈0)"만 쓰면 IT5는 바닥 조각이 2개뿐이라, 밑이 빈 15 cm 이내 조각도 바닥으로 본다. 본관에는 밑이 빈 높은 조각(돌출부)이 있다 — 바닥 조각으로 보지 않고 이웃과 이어져 있는 동안 남는다
- 미검증: 실제 폰 3D 좌표 시험, 화면 연출(지정 파편만 풀고 나머지 고정), 1타 1점 게임 상태, 낙하 규칙(15 cm·2 mm)과 3개가 화면에서 자연스러운지, 블럭이 적게 남았을 때 먼 블럭이 부서지는 문제(거리 제한 없음)
- 입력 구분: 합성(손 계산 좌표)과 실제 건물 패키지 기하
- 인계 대상·넘긴 자료: 이동수 — `spawnFragmentBodies()`가 지정 파편만 풀도록, `controller.js` 타격당 1점·같은 건물 계속 받기, 계약 기록. 정경호 — `test_multi3d.py`·mono3d 연결 시 `remaining_fragments` 전달(MODEL_STRIKE_3D.md 7장). PR 본문 멘션 예정
- 갱신한 계획 체크리스트·현황: 본 파일 요약, `진행현황.md` 김태이 행. P4 체크박스는 실제 3D 궤적 시험 전이라 `[ ]` 유지
- 종료·중단 시각: 2026-11-11 14:37 KST

### 2026-11-11 16:26 KST — PR #18 머지 완료

- 담당 / 기록자: 김태이 / Claude Code
- 사용자 지시: "지금까지의 변동사항이 없으면, 머지하자". 머지 직전 GitHub 확인: main `61e2818` 그대로, PR #18 헤드 `e880e97` 그대로, 댓글·리뷰 없음
- 결과: 머지 커밋 `9820019`(헤드 고정 머지). 머지된 main에서 Python 208/208, JS single·3D 115/115
- 화면·서버 동작 변화 없음(판정을 아직 아무 곳에서도 부르지 않음)

### 2026-11-15 16:10 KST — 월요일 시험 점검, 이슈 #19, 2D 게임용 부분 파괴 연결 함수

- 담당 / 기록자: 김태이 / Claude Code
- 작업 구분·Phase·상태: 점검·구현 / P4 / 김태이 함수 구현·합성 검증 완료, 화면 연결·실폰 미검증
- 점검(사용자 질문 "월요일 정경호님 서버 시험에 발차기·파편 연출이 바로 반영되는가"): main `9820019` 기준 폰 좌표 2D 게임은 손 타격 → IT1 **첫 타격에 전체 붕괴**(100점)로 동작. 발차기는 안 됨 — 폰은 몸 22점(발목 포함)을 보내지만 `backend/ingest/game_pose.py`(정경호)·`frontend/single/main.js` 17행·`frontend/game/controller.js`(이동수)가 손목만 전달·수락하고, 서버가 내보내는 화면 번들은 11-10 빌드(`hit-2d-1`, 발목 없음). 필요한 수정은 모두 PR #13 "함께 바뀌는 계약"에 이미 있음. 부분 파괴(PR #18)는 3D 판정용이라 2D 게임에서 쓰이지 않음
- 이슈 #19 발행(사용자 승인): "월요일(11-16) 테스트: 폰 좌표 2D 게임 발차기 연결 확인 요청". PR #13 요청을 링크로 가리키고 월요일 기한·서버 반영·테스트 때 볼 점만 추가, 이동수·정경호 담당 지정·멘션
- 사용자 결정: 2D 게임에서도 부분 파괴를 쓸 수 있게 김태이 판정 파일에 연결 함수 추가. 브랜치 `feat/partial-strike-2d`
- 확인된 사실: 2D 게임은 이미 화면 타격점을 건물 표면의 3D 점으로 바꾼다(`fracture-view.js` `impact()` 광선 → `destroy()`의 `runtime.frame.toLocal()` 패키지 좌표 `impactPoint`). `knu-it1-v3`는 원점 이동·회전이 없어 이 좌표가 `colliders.json` 좌표와 같다. `colliders.json`의 `fragment_id`는 숫자, 장면 노드 이름은 `node`(`SM_IT1V3_Fragment_000` 형식)
- 바꾼 파일·결과물: `web/shared/model-strike-3d.js` — `BuildingDamage`(패키지 좌표 점 → 맞은 블럭(5 cm 안), 부서질·떨어질 블럭 id와 장면 노드 이름, `points` 1, `remaining_fragments`, `restore()`), `applyDamage()`(판정과 공유하도록 `ModelStrikeJudge.breakAt` 분리), `markerToPackage()`, 파편에 `node` 보관. `tests/test_model_strike.mjs` 4개 추가. `docs/MODEL_STRIKE_3D.md` 6장 "2D 게임에서 쓰기", 7장 이동수 5번 요청
- 확인 방법·실제 결과: `pytest tests` 208/208, `node --test tests/single/*.test.mjs tests/test_foot_strike.mjs tests/test_model_strike.mjs` 119/119. 공용 사례 17개의 모든 타격에서 `BuildingDamage`와 `ModelStrikeJudge`의 부서짐·낙하·남은 수가 같음. 전체 `node --test tests/*.mjs tests/single/*.test.mjs` 실패 16개는 main `9820019`와 같은 이름(이번 변경과 무관)
- 미검증: 실제 2D 게임 화면의 광선 점으로 시험하지 않음(화면 연결은 이동수 파일), 5 cm 붙임 값, Python판 없음(2D 게임은 브라우저만)
- 입력 구분: 합성(손 계산 좌표)과 실제 IT1 패키지 기하
- 인계 대상·넘긴 자료: 이동수 — `fracture-view.js`에서 `BuildingDamage.hitAt(impactPoint)` 결과 노드만 풀기, 남은 파편 보이기·광선 대상, `controller.js` 타격당 1점, 번들 재빌드(MODEL_STRIKE_3D.md 7장 5번). 월요일 시험에는 넣지 않음(발차기 연결 우선)
- 갱신한 계획 체크리스트·현황: 본 파일 요약, `진행현황.md` 김태이 행. P4 체크박스 `[ ]` 유지
- 종료·중단 시각: 2026-11-15 16:10 KST

### 2026-11-16 01:14 KST — 2D 부분 파괴·발차기 연결 종료

- 담당/기록자: PM 통합·이동수 화면·정경호 서버 / Codex. P4 로컬 구현·합성 검증 완료, 공통 Phase와 실폰 완료는 별도.
- 읽은 계획/기준: PM·개인 계획 P4 및 SC 타격/게임 연결, AGENTS 절차·현황·개인 기록, FOOT_STRIKE·MODEL_STRIKE_3D·pr-workflow. 사용자 요청 1/2번: 2D 부분 파괴·파편당 점수와 발차기 연결.
- 코드: frontend/single/fracture-view.js가 BuildingDamage를 호출해 신규 파편 노드만 물리로 풀고 해당 고정 충돌체만 제거. 남은 파편 고정·광선/투영 대상 유지, 풀린 파편은 타격 대상 제외, 복원 시 충돌체/상태 재생성. fragment-bodies.js의 선택 노드 필터와 target-provider.js 필터 재사용. analytic 단독 QA 경로는 기존 전체 해제를 유지하고 폰 게임에서 계속 차단.
- 입력/점수: backend/ingest/game_pose.py의 body 발목→ankles→main.js 표시/전달→GameController 관절별 프레임 짝과 이벤트 수락. controller는 onHit의 신규 파편 결과로 점수를 계산하고 남은 건물 재타격·동일 프레임/이벤트/파편 중복 방지. backend/game_sessions.py가 실제 IT1 ID·세션/등록 프레임·신규 제거 집합·남은 수/점수 일치를 검증해 서버 점수 확정. 2D 화면의 기하는 PC가 판정하며 서버가 깊이/영상 기하를 재계산하지 않음.
- 배포/문서: build:single·build:phone-game 완료 및 web/monitor/single·phone-game 배포본 갱신. PM·이동수·정경호 계획, PHONE_POSE_GAME·SINGLE_CAMERA_INTERFACES·FOOT_STRIKE·MODEL_STRIKE_3D 계약과 진행/팀 요약 정합. 이전 100점/미연결 기록은 이전 버전 이력으로 보존.
- 검증: Python phone_game/game_sessions/room_pose 47/47(WS 동일 JPEG 발목 정규화·누락/저신뢰 무효·손 이후 발타격/신규 점수·잘못된 ID/중복/점수 거부). Node single/model_strike 108/108 + fracture 83/83. 두 빌드 통과. Edge D3D11 브라우저 최종 5/5(24.8초): room1/2 손→발·서버 점수·중단/재연결·입력 중단, 단독 3회 복원, 반복 부분 파괴→96점/96개·고정+동적 충돌체97개 유지·복원, 모바일 회전/거울/입력전환.
- 실패/정정: 첫 브라우저 자체 webServer 정리가 끝나지 않아 테스트4개 통과 후 중단. 별도 루프백 서버/PHONE_PARTIAL_EXTERNAL=1로 최종 명령 정상 종료. 추가 반복 시험에서 같은 영상 프레임 재사용이 거부돼 프레임 증가를 기다리도록 수정, portrait 시험은 viewport/ResizeObserver 변환 안정화 대기 후 통과. 기존 Starlette·pytest 캐시 접근·대형 번들 경고 유지.
- 범위/남은 일: synthetic canvas/결정적 추론·실제 GLB·실제 FastAPI/WS·Edge, 실제 폰/MediaPipe·발차기 기준값 튜닝·청취/지연/장시간·3D 발차기 연결은 미검증/별도. 손목0.5·발목0.8 화면 대각선/초 시작값 유지. 3D 건물 시험 파괴 규칙은 변경하지 않음.
- 다음/인계: 서버 재시작·PC/폰 새로고침→방2 C0 서버중계→폰 좌표2D게임. 발목까지 보이게 촬영 후 손/발 타격·남은블록/점수·복원 확인. 팀원 별 실제 완료를 추정하지 않으며 공통 Phase/계획 체크는 유지.
- Git: 기존 작업 보존. 사용자 지시로 Git 변경 명령·worktree·stage·commit·push·충돌 해결 표시 없음.


### 2026-11-21 03:15 KST — 건물 파괴음 누락 수정 시작

- 담당 / 기록자: 김태이 담당 소리 모듈 및 이동수 화면 연결 보완 / Codex. 사용자가 건물을 부술 때 소리가 나도록 수정을 요청했다.
- 작업 구분·Phase·상태: 오디오·화면 연결 오류 수정 / K-SC-05(SC-04)·P4 관련, 실기기 통과와 별개 / 진행 중.
- 읽은 계획·기록: PM_plan.md 운영/역할·P4, 김태이_plan.md K-SC-05의 최종 수락한 이벤트·거부/중복 무음·오디오 권한 기준, 이동수 계획·진행 요약, AGENTS 운영/현황/기록 양식, 김태이 최신 부분 파괴 인계 기록, pr-workflow.
- 목표·완료 기준: 건물 실험실의 버튼/Space, 2D 합성 타격·폰 좌표의 성공한 파괴에서 같은 충격·붕괴음이 1번 재생된다. 거부·중복·미리보기는 무음이며 첫 제스처의 resume 경합과 자원 해제를 검사한다.
- 시작 근거: main eb65bc0의 frontend/fracture/main.js에는 소리 호출이 없고, frontend/single/main.js는 폰 HitDetector onResult에서만 재생해 sampleHit/public acceptHit 경로를 놓친다.
- 검증 계획: 관련 Node 오디오/추적 시험, 실제 Web Audio의 브라우저 회귀(첫 Space/버튼·거부·반복 복원·합성/폰 경로), 세 화면 빌드와 git diff --check. 실제 스피커 청취·실폰은 따로 미검증으로 기록한다.
- 작업 브랜치: fix/building-destruction-sound-20261121. GitHub 게시는 이번 로컬 수정 요청 범위에 포함하지 않는다.

### 2026-11-21 03:22 KST — 건물 파괴음 누락 수정·로컬 검증 완료

- 담당 / 기록자: 김태이 담당 소리 모듈 및 화면 연결 보완 / Codex. 작업 구분·Phase·상태: 오류 수정·회귀 검증 / K-SC-05·P4 관련 / 이번 로컬 수정 완료, 실기기 통합 대기.
- 연결한 계획 기준: 김태이_plan.md K-SC-05의 최종 수락한 이벤트만 재생·거부/중복 무음·오디오 시작 권한, PM_plan.md의 한 타격에 파괴·소리·점수 한 번 반영 기준이다.
- 원인: 건물 실험실에는 타격음 호출이 없었다. 단일/폰 게임의 기존 오디오는 폰 HitDetector의 onResult에만 있어 합성 버튼과 공개 acceptHit가 재생 경로를 건너뛰었다.
- 바꾼 파일·결과물: frontend/fracture/main.js의 성공한 파괴, frontend/single/main.js의 최종 수락 지점에 동일한 Web Audio 충격·붕괴·잔해음을 연결했다. frontend/single/hit-sound.js에 페이지별 제스처/재개·정리 어댑터를 추가하고 tracking.js의 중복 재생을 막았다. 두 Node 시험·신규 tests/browser/destruction-sound.spec.js, docs/SINGLE_CAMERA_MONITOR.md, web/monitor의 fracture/single/phone-game 빌드 결과, 본 기록·PM 기록·팀 현황을 갱신했다.
- 동작·자원: 첫 클릭/키 입력에서 오디오를 재개하고 같은 입력의 성공한 파괴는 재개 완료를 기다린다. 다음 사용자 입력·페이지 숨김/종료에는 이전 대기 타격음을 재생하지 않는다. 파괴 거부·중복·분리 미리보기는 추가 소리 없음. 오디오 지원이 없어도 물리·점수는 정상 진행한다.
- 검증·실제 결과: Node single·fracture 전체 161/161 통과 후 최종 변경에 직접 영향받는 오디오·추적 21/21 재검증 통과. npm run build:all로 세 화면 빌드 성공(기존 2600kB 초과 청크 경고 유지). Playwright Chromium D3D11·정적 루프백 8899에서 신규 오디오 5/5 통과: 첫 Space/버튼, 반복 복원·중복/미리보기 무음, 단일/폰 게임 합성 이벤트·거부 무음, 미지원 오디오. 실제 AudioContext 출력 AnalyserNode에서 RMS 0.001 초과 확인, 컨텍스트 1개·pagehide 후 closed 확인. 기존 building-practice.spec.js 2/2도 통과했다.
- 실패·보완 이력: 수정 전 배포본의 신규 첫 Space 검사는 소리 상태 부재로 실패했다. 첫 어댑터의 200ms 재개 대기 제한 때문에 첫 버튼 클릭에서 played=0이 1회 재현(초기 브라우저 6/7)됐다. 시간 제한 대신 제스처 세대로 이전 입력을 취소하고 터치용 click 재시도를 추가한 뒤 신규 5/5 재검증했다. 최초 FastAPI 기반 검사 시작은 기본 Python의 cv2 미설치로 서버 실행 실패했고, 의존성 변경 없이 정적 HTTP 서버로 이번 화면/오디오 검사를 완료했다.
- 입력·장비 범위: keyboard_demo·synthetic 및 실제 브라우저 Web Audio 그래프. 실제 스피커 청취, 실폰 입력/오디오 정책, WebSocket 신호 회귀, 실제 3D·AR·장시간은 미검증이다.
- 근거: data/local/destruction-sound-qa/의 baseline.log, browser.log, browser-recheck.log, node.log, audio-recheck.log, build.log, summary.json. 재현: npm run build:all 후 해당 폴더 playwright.config.mjs로 destruction-sound.spec.js 실행; 일반 환경은 기존 Playwright 설정을 사용한다.
- 남은 일·막힌 점: 코드 수정에 막힘 없음. 실제 PC/폰 청취·음량 및 live 통합을 확인한다. 기본 Python에서 전체 서버를 실행하려면 프로젝트 requirements의 OpenCV가 필요하며 이번 오디오 작업에서 전역 환경을 바꾸지 않았다.
- 다음 한 단계·인계: SMASH-KNU-AR의 fix/building-destruction-sound-20261121에서 화면을 새로고침하고 파괴 버튼/Space·실폰 타격음을 확인한다. PM·이동수·김태이는 snapshot().sound 및 SINGLE_CAMERA_MONITOR.md의 소리 소유 경계를 참고한다.
- 공유·계획 판정: 로컬 수정만 수행했고 신규 커밋·원격 push·PR은 없다. K-SC-05와 개발 Phase의 체크박스는 실제 통합 기준이 남아 유지했다. 팀 현황·PM 기록의 이번 공통 관리 행을 갱신했다.
- 종료 시각: 2026-11-21 03:22 KST.


### 2026-11-21 05:42 KST — 실제 AR 타격음 범위 정정·수정 시작

- 담당 / 기록자: 김태이 소리·정경호 AR 뷰어 연결 / Codex. Phase·상태: P4 소리 연결 및 공통 연결 관리 / 진행 중.
- 최신 사용자 지시: 2D 타격이 아니라 실제 증강 현실에서 타격할 때 부수는 소리가 필요하다. 앞선 실험실/2D 연결은 요청 범위를 잘못 잡았으므로 이번 정정에서 본 세션의 해당 코드/번들 변경을 정리한다. 과거 검증·결과 기록은 보존한다.
- 읽은 계획·기록: PM_plan P4, 김태이_plan P4·K-SC-05, 정경호_plan P4와 진행 기록, AGENTS 절차/현황, pr-workflow. 현재 작업 브랜치에서 같은 소리 수정 작업을 이어 간다.
- 시작 근거: web/test/mono3d/app.js 및 multi3d/phone.js는 실제 타격에 1200Hz 0.08초 삐 소리만 낸다. 두 PC view.js는 sound 버튼을 눌러야 audio 컨텍스트가 생기며 180Hz 사각파만 낸다. 이 경로는 앞선 2D 수정에 포함되지 않았다.
- 목표·완료 기준: 실제 입력을 소비하는 AR 폰·PC 경로의 수락된 타격에 같은 충격/붕괴/잔해음을 연결한다. 초기 접속의 누적 점수·중복·무효 프레임은 재생하지 않으며 PC 음소거·브라우저 제스처 잠금/해제·종료 정리를 확인한다.
- 검증 계획·입력: 기존 추적/기하 판정은 유지하고 실제 AR 페이지에 합성 카메라/3D 판정 메시지를 공급하여 실제 Web Audio 출력과 중복/재접속 경계를 검사한다. 실폰·현장 정합·스피커 청취는 근거 없으면 미검증으로 남긴다.


### 2026-11-21 05:52 KST — 실제 AR 두 모드 타격음 연결·로컬 검증 완료

- 담당 / 기록자: 김태이 소리 모듈·정경호 AR 소비 경로 연결 보완 / Codex. 작업 구분·Phase·상태: 오류 수정 및 공통 연결 / P4 / 요청한 코드 연결·로컬 자동 검증 완료, 실제 장비 확인 대기.
- 사용자 확인·범위 정정: 사용자는 2D가 아니라 실제 증강 현실 타격음을 요청했고, 1대+마커와 3대+PC 모드 중 적용 대상에 '둘다'라고 답했다. 앞선 2D·건물 실험실의 본 세션 코드/테스트/빌드 변경은 HEAD 기준으로 정리하고 해당 결과 기록은 이력으로 보존했다.
- 원인·변경 결과: 기존 AR 폰의 실제 타격은 1200Hz 0.08초 신호음, PC는 기본 음소거와 180Hz 사각파였다. web/shared/hit-sound.js로 기존 합성기를 공용화하고 ar-hit-sound.js를 추가해 충격·붕괴·잔해음을 생성한다. web/test/mono3d/app.js·view.js, multi3d/phone.js·view.js에 연결하고 네 HTML의 스크립트 캐시 버전을 갱신했다. 보정·카운트다운의 안내음은 같은 컨텍스트에서 유지한다.
- 수락 경계·UI: 1대 폰은 기존 3D 추정/건물 진입 판정의 성공 분기에서 재생한다. 1대 PC·3대 폰/PC는 기존 hits/valid/hit의 새 유효 타격만 소비한다. 최초/재접속 스냅샷·중복 횟수·무효 결과·리셋은 무음이다. PC는 기본 활성 후 화면 한 번 클릭으로 오디오를 해제하며 소리 끄기/켜기는 현재 소리까지 즉시 음소거한다. 판정·점수·시각 효과는 음소거와 독립적이다. 대기 중 재개음은 음소거·재접속·페이지 종료 이후 재생하지 않는다. 오디오 종료와 브라우저 이력 복원도 처리한다.
- 변경 파일: web/shared/hit-sound.js·ar-hit-sound.js, web/test/mono3d 및 multi3d의 폰/PC JS·HTML 8개, frontend/single/hit-sound.js 호환 재수출, tests/ar-hit-sound.test.mjs·tests/browser/ar-hit-sound.spec.js, docs/MONO3D_TEST.md·MULTI3D_TEST.md, 김태이/정경호/PM 진행 기록과 팀 현황. 기존 2D/키보드의 이벤트·상태·번들은 HEAD와 동일하다.
- 검증 방법·실제 결과: Node 오디오·1대 기하/몸 보정·모델 판정 합계 59/59. Chromium·정적 루프백 8899의 AR 브라우저 4/4(14.4초): 1대 PC, 3대 PC, 1대 폰, 3대 폰. PC/3대 폰은 합성 3D 판정 메시지와 WebSocket 경로를 사용했다. 1대 폰은 합성 Canvas 카메라·MediaPipe 형식 관절을 넣고 실제 마커 보정·몸 보정·3D 추정·건물 진입 코드를 거쳐 1회 타격을 확인했다. 모든 경로에서 실제 AudioContext의 충격음 발진·출력 RMS 0.001 초과를 확인했다. PC 중복/초기/무효·재접속 무음, 음소거·컨텍스트 1개·pagehide 후 closed를 검사했다. git diff --check와 JS 구문 검사도 통과했다.
- 실패·보완 이력: 첫 AR 브라우저 실행은 3/4 통과했다. 1대 폰 합성 인물의 머리가 가로 640×480 화면 밖에 있어 몸 보정이 올바르게 거부됐다. 테스트용 카메라 위치만 y=-1.15m에서 -2.3m로 옮겼고, 실제 앱의 보정·판정 코드는 바꾸지 않았다. 대상 재시험 1/1 후 최종 네 경로 4/4를 확인했다.
- 입력·장비 범위: synthetic 관절/카메라·3D 메시지, 실제 브라우저 Web Audio 그래프. 실제 카메라 live 입력·현장 AR 정합/정확도·폰 3대 삼각측량 실행·실제 WebSocket 서버·스피커 청취·장시간은 이번 자동 검증으로 확인하지 않았다. 1대는 mono_approx, 3대는 multi_view_test 출처를 유지한다.
- 근거·재현: data/local/ar-hit-sound-qa/browser.log(초기 3/4), mono-phone-recheck.log(1/1), browser-final.log(4/4), node-final.log(59/59), summary.json 및 playwright.config.mjs. AR 정적 파일은 빌드 없이 제공되며 docs의 실제 HTTPS/접속 키 실행 절차를 따른다.
- 남은 일·막힌 점: 코드 수정에 막힘 없음. 실제 사용자 장비에서 새로고침 후 소리·음량·브라우저 권한을 확인한다. 기존 부분 파괴·발차기 인계 및 실제 3D Phase 완료 기준은 별도 유지한다.
- 다음 행동·인계: 김태이/정경호/PM에게 두 AR 경로의 공용 소리 소비 경계·캐시 버전·검증 범위를 전달한다. PC는 화면을 한 번 클릭한 후 새 타격을 시험한다.
- 갱신한 현황·게시: 개인 P4 행과 현재 요약, 정경호/PM 인계 및 팀 공통 행을 갱신했다. 계획 체크·공통 Phase는 실제 통합 근거가 없어 유지한다. 새 커밋·push·PR 없음.
- 종료 시각: 2026-11-21 05:52 KST.


### 2026-11-21 13:06 KST — AR 소리와 시각 효과 동일 수락 경계 검증·게시 준비

- 기록자: Codex, 김태이 소리·이동수 연출 공통 지원. 사용자 요청으로 기존 AR 소리 수정에 시각 효과를 추가해 함께 GitHub에 공유한다. 상세 구현·검증·게시 단계는 이동수_progress.md의 같은 시각 기록을 따른다.
- 새 유효 타격에 파괴음과 충격파/파편/먼지/반동을 연결하고 초기·중복·무효·재접속은 다시 재생하지 않는다. 음소거 중 시각 효과는 유지한다. AR 네 경로 브라우저 4/4·관련 Node 65/65·호환 빌드 2개 통과. synthetic 입력과 실제 AudioContext/Canvas 검증이며 실폰·청취·실측/장시간은 미검증이다.
- docs/asset-validation/ar-feedback/summary.json에 재현·결과·한계를 공유한다. 기존 Phase/체크리스트는 유지하며 커밋·push·PR 게시 결과를 후속 기록으로 남긴다.


### 2026-11-21 13:09 KST — AR 타격음·연출 PR 공유 완료

- Codex 공통 지원: 검증한 코드  작업 브랜치로 push하고 [PR #22](https://github.com/DS-J-L/SMASH-KNU-AR/pull/22)를 생성했다. Node 65/65·AR 브라우저 4/4·호환 빌드 2개 및 synthetic/live 미검증 구분을 본문과 검증 요약에 남겼다.
- 상태는 PR 검토 요청이며 main 머지는 하지 않았다. 상세 게시·다음 행동은 이동수_progress.md의 같은 시각 기록을 따른다. 실제 장비 청취/정합·성능 및 기존 Phase 기준은 별도 유지한다.


### 2026-11-21 13:24 KST — PR #22 머지 전 소리/연출 회귀 확인

- Codex PM 검토: head daceb92a2345b34283f293fd12d5bfa59e970e10의 코드 검토에서 머지 차단 사항 없음. 관련 Node와 single 전체 128/128, 합성 AR 네 경로 4/4·호환 빌드 2개 재확인. 소리/연출 수락·중복/무효·음소거·정리 경계를 검토했다.
- 실제 live·실폰·서버/3대·청취·정합·성능/장시간은 미검증이며 계획/Phase 체크를 유지한다. 사용자 요청 범위의 머지·동기화 실제 결과는 PM 인계 기록을 따른다.


### 2026-11-21 15:01 KST — PR #21 통합 검토·소비 인계

- 담당 / 기록자: 김태이 담당 경계의 PM 통합 검토 / Codex. P3·P4 관련 코드 검토 완료·main 머지 대기, 실기기/개인·공통 Phase 통과와 별개다.
- 결과: 2D 부분 파괴·남은 파편 재타격·파편 고유 점수·발목 소비, 3D 마커/가림·시계와 main AR 소리·타격 위치 효과를 결합했다. Windows 고해상도 수신 시계·옵션 경합·정상 소켓 종료를 보완했다.
- 검증: Node201, Python255 고유항목, 건물25·2D폰8·AR4 브라우저, 배포 빌드3개 통과. 입력은 synthetic·mouse/keyboard 데모이며 실폰·실측·청취·정량/장시간은 미검증이다. 상세 명령/초기 실패/재검증은 PM_progress.md와 ../docs/asset-validation/pr21-review.json을 따른다.
- 다음·인계: 승인된 #21 main 반영 뒤 #23의 넓은 무대/2대 경로를 결합·확인한다. 실기기 시험은 BUILDING_FRAGMENT_TEST·MONO3D_TEST·MULTI3D_TEST 문서에서 재개한다. 기존 개인/공통 Phase 체크는 유지했다.
