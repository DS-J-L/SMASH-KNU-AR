# 김태이 진행 기록

계획: [김태이_plan.md](../김태이_plan.md) · 전체: [PM_plan.md](../PM_plan.md) · [팀 현황](./진행현황.md) · [기록 양식](./작업기록_template.md)

## 1. 현재 상태

| 항목 | 현재 값 |
| --- | --- |
| 마지막 갱신 | 2026-11-02 16:05 KST — 정경호 서버와 통합 시험, 연결 처리 버그 3건 수정 |
| 현재 Phase·작업 상태 | P1 / 진행 중 — 코드 구현, 실기기 미검증 (P0 장비표도 미완) |
| 마지막 확인된 개발 완료 | 정경호 `feat/server-deployment` 서버와 합쳐 녹화 재생으로 등록·시계·`pose_2d` 수신 확인, 재등록·프레임 오류·스트림 전환 처리 수정 (실기기 아님) |
| 현재 작업 | 휴대폰 MediaPipe 손목 추출·`pose_2d` 송신 |
| 남은 일·미검증 | 실제 폰 HTTPS 접속·GPU 추론·FPS, `captureTime` 제공 여부, 3대 동시 송신 |
| 다음 한 단계 | 정경호 외부 HTTPS 서버(D07)에 실제 폰으로 `/camera/?key=` 접속 → 장비 정보·FPS·시각 출처를 장비표에 기록 |
| 막힌 점·인계 | 정경호: 서버 실행 시간·주소·접속 키 공유 필요. 3D 허용 시각 출처가 `capture_metadata`뿐이라 폰 `rvfc_capture_time` 사용 여부 합의 필요 |

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
