# 김태이 진행 기록

계획: [김태이_plan.md](../김태이_plan.md) · 전체: [PM_plan.md](../PM_plan.md) · [팀 현황](./진행현황.md) · [기록 양식](./작업기록_template.md)

## 1. 현재 상태

| 항목 | 현재 값 |
| --- | --- |
| 마지막 갱신 | 2026-10-29 19:20 KST — P1 카메라 페이지 구현(브랜치 `feat/p1-camera-mediapipe`) |
| 현재 Phase·작업 상태 | P1 / 진행 중 — 코드 구현, 실기기 미검증 (P0 장비표도 미완) |
| 마지막 확인된 개발 완료 | PC 브라우저 녹화 재생으로 좌·우 손목 추출·`pose_2d` 생성·임시 수신기 송신 확인 (실기기 아님) |
| 현재 작업 | 휴대폰 MediaPipe 손목 추출·`pose_2d` 송신 |
| 남은 일·미검증 | 실제 폰 HTTPS 접속·GPU 추론·FPS, `captureTime` 제공 여부, 3대 동시 송신, 정경호 `/ws/pose` 연결 |
| 다음 한 단계 | HTTPS 인증서로 실제 폰에서 `/camera/` 실행 → 장비 정보·FPS·시각 출처를 장비표에 기록 |
| 막힌 점·인계 | 정경호: `docs/DATA_CONTRACT.md`의 `/ws/pose` 제안 절차 확인·서버 구현 필요 |

## 2. 개인 Phase 현황

| Phase | 상태 | 확인된 결과·근거 | 남은 완료 기준 |
| --- | --- | --- | --- |
| P0 | 확인 전 | 기록 없음 | 장비표·접속·배치·미리보기 |
| P1 | 진행 중 | 카메라 페이지 구현, PC 녹화 재생·임시 수신기로 송신·중복 거부·재연결 확인 (아래 2026-10-29 기록) | 실제 폰 3대 추출·정경호 서버 수신·FPS 기록 |
| P2 | 확인 전 | 기록 없음 | C0 송신·보정 촬영/실측·독립 파괴 데모 |
| P3 | 확인 전 | 기록 없음 | 촬영 보완·시간/가림 시험·무효 입력 대응 |
| P4 | 확인 전 | 기록 없음 | 실제 3D 궤적 충돌·이벤트·파편·소리·초기화 |
| P5 | 확인 전 | 기록 없음 | 20분/반복 시험·장비 장애·복구·설정 |
| P6 | 확인 전 | 기록 없음 | 평가 장비 운영·관찰·참조 판정 |

개인 Phase 상태와 공통 Phase 통과는 구분한다. 입력이 안정되기 전에는 충돌·효과보다 기기 입력과 보정 자료를 우선한다.

## 3. 다음 작업에 필요한 협업

- 정경호: 기기 등록·2D 수신·시계 교환·유효한 3D 입력 규격.
- 이동수: 건물/파편·충돌체·좌표 변환·게임 상태·리셋 규격.
- 전달할 것: 실제 2D 입력·시각 출처·보정 촬영·C0 영상·타격 이벤트.
- 위 항목은 예정된 협업이며 전달 완료 기록은 아직 없다.

## 4. 누적 작업 기록

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
