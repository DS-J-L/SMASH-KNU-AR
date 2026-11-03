# 정경호 진행 기록

계획: [정경호_plan.md](../정경호_plan.md) · 전체: [PM_plan.md](../PM_plan.md) · [팀 현황](./진행현황.md) · [기록 양식](./작업기록_template.md)

## 1. 현재 상태

| 항목 | 현재 값 |
| --- | --- |
| 마지막 갱신 | 2026-11-03 21:35 KST |
| 현재 Phase·작업 상태 | 기존 서버·최신 main 로컬 병합 충돌 해소·자동 검증 완료 — 실기기 미검증 |
| 마지막 확인된 개발 완료 | feat/server-deployment e9cdaff의 수신/시간/3D 기초 확인, 임시 카메라 결합 pytest 58개·replay receiving |
| 현재 작업 | 충돌 문서 6개 정리, 서버58·카메라6·문서 검사 통과. 병합 커밋·push 전 |
| 남은 일·미검증 | 실제 폰·촬영 시각·실측 보정·3D 소비 연결, 단일 모드 방/신호·세션 ACK·로그 |
| 다음 한 단계 | J-SC-01 단일 계약·접속 보호 검토 후 J-SC-02 방/신호 구현 |
| 막힌 점·인계 | 실제 기기·모델 배포·현장 시험 필요. 최신 카메라 송신 코드는 이번 로컬 병합에 포함 |

## 2. 개인 Phase 현황

| Phase | 상태 | 확인된 결과·근거 | 남은 완료 기준 |
| --- | --- | --- | --- |
| P0 | 진행 중 | 계약 초안 v0.2, 실행 안내 보완(SETUP 2~4절), 기기·스트림·보정 ID 관계와 재연결 정책 문서화. 자동 검사 통과 | 김태이·이동수의 계약 검토, 촬영 입력 요구 전달 |
| P1 | 검토 요청 | 등록·중복 거부·재연결·수신 검증·상태 전달과 카메라 브랜치 /ws/pose 호환 구현, 자동 테스트 58개 통과 | 카메라 화면은 로컬 병합됨. 실제 3대 손목·미검출·재연결 확인, 모니터 UI 연결 |
| P2 | 진행 중 | 설정 로더(local/example 표시), 보정 파일 형식·검증, 시계 교환·불확실성, 합성 입력 도구 | C0 연결 지원, 실제 촬영 자료 확인, 실측 baseline으로 기준값 합의 |
| P3 | 진행 중 | 시간 정렬·DLT·깊이/재투영 검사·실패 이유·`pose_3d` 전달을 합성으로 확인 | 실측 K/dist/R/t 계산, 기준점 재투영·위치 오차 실측, 실기기 시간 정렬 검증 |
| P4 | 확인 전 | 무효 프레임 주기 전송(0.1초)만 선반영 | 세션·타격 로그, 성능 지표 |
| P5 | 확인 전 | 기록 없음 | 안정성·성능·복구·재현 버전/설정 |
| P6 | 확인 전 | 기록 없음 | 실제 로그·정답·정확도/성능·결측 분석 |

개인 Phase 상태와 공통 Phase 통과는 구분한다. 실제 3D 복원 검증과 합성/재생의 수치 검증을 별도로 기록한다.

## 3. 다음 작업에 필요한 협업

- 김태이: 실제 기기 설정·2D 입력·시각 출처·보정 촬영/실측·장애 재현.
- 이동수: C0 수신 요구·바닥/기준점 정합 결과·게임 세션/상태.
- 전달할 것: 등록/수신 규격·보정값·공통 시각·유효성 포함 3D 입력·로그.
- 2026-10-30: 계약 v0.2(`docs/DATA_CONTRACT.md`)를 검토 요청 상태로 넘김. 수신 확인 기록은 아직 없다.

## 4. 누적 작업 기록

### 2026-10-30 KST — 서버 등록·수신·시계·정렬·3D 기초와 외부 접속 키 시작

- 담당 / 기록자: 정경호 / Claude(담당자 요청으로 작성)
- 작업 구분: 개인 개발
- Phase: P0~P1 중심, P2·P3 서버 기초 일부
- 상태: 진행 중
- 읽은 계획·기록: `AGENTS.md`, `AGENTS/README.md`, `PM_plan.md` P0~P3, `정경호_plan.md` P0~P3, `docs/DATA_CONTRACT.md` v0.1, `ARCHITECTURE.md`, `DECISIONS.md`, 각 `backend/*/README.md`, 이 파일의 초기 상태
- 연결할 계획 항목: P0 “계약 초안·기기/스트림/보정 ID 관계와 재연결 정책·실행 안내”, P1 전체 체크리스트, P2 “설정 로더·보정 입력/결과 구조·시계 교환·재현 도구”, P3 “시간 정렬·삼각측량·품질 검사·실패 null·3D 메시지”
- 이번 목표·완료 기준: 계약과 일치하는 서버 측 등록·검증·상태·시계·정렬·3D 경로를 구현하고, 실패 사례 중심 테스트와 합성 종단 확인을 통과한다. 팀 결정 D07(외부 접속)을 서버·문서에 반영한다
- 검증 계획: `python -m pytest -q`, `python tools/check_scaffold.py`, wss + 접속 키로 띄운 서버에 `tools/synthetic_cameras.py` 실행

### 2026-10-30 KST — 서버 등록·수신·시계·정렬·3D 기초와 외부 접속 키 종료

- 담당 / 기록자: 정경호 / Claude(담당자 요청으로 작성)
- 작업 구분·Phase·상태: 개인 개발 / P0~P3 서버 측 / 검토 요청
- 바꾼 파일·결과물: `backend/server.py`(재작성), `backend/settings.py`, `backend/runtime.py`, `backend/auth.py`, `backend/connections.py`, `backend/ingest/{schemas,registry,pose_receiver}.py`, `backend/sync/{clock,frame_aligner}.py`, `backend/calibration/storage.py`, `backend/tracking/{triangulation,quality,pipeline}.py`, 각 `__init__.py`; `tests/`(conftest·helpers, `test_ingest`·`test_sync`·`test_tracking`·`test_calibration`·`test_auth`, `test_server` 상태 기대값 갱신); `tools/synthetic.py`, `tools/synthetic_cameras.py`; `config/*.example.json`(runtime_loaded, `max_wait_ms`·`align_mode`·`allowed_timestamp_sources` 제안값); `contracts/register.example.json`, `contracts/clock_pong.example.json`, `contracts/pose_3d.example.json`(excluded); `docs/DATA_CONTRACT.md` v0.2, `docs/SETUP.md` 2~4절, `docs/DECISIONS.md` D07·D08·미확정 설정, `docs/ARCHITECTURE.md` 현재 흐름·의존성, `backend/*/README.md`, `calib/README.md`, `requirements.txt`(numpy 2.4.4, opencv-python-headless 4.13.0.92), `.gitignore`(`*.local.bat`). 브랜치 `feat/backend-ingest-sync-tracking`, 커밋·PR 없음(로컬 결과물)
- 어디까지 완료:
  - `/ws/ingest`: 첫 메시지 등록, 설정 기반 C0/C1/C2·device 바인딩, 다른 기기 중복 거부(4409), 같은 기기 재등록 시 새 `stream_id`로 대체(4001), 5초 heartbeat 끊김(4408), 스트림별 유한 버퍼
  - `pose_2d` 검증: 필드·범위·NaN/무한대·신뢰도·거울 좌표·16KB·모르는 형식, 등록 정보 대조, 중복·역순 프레임 거부, 오류 응답에 코드·frame_id
  - 시계: `clock_ping`/`clock_pong`, 최소 RTT 오프셋·불확실성, `clock_id` 변경 시 재설정. 허용 출처(`capture_metadata`)가 아니면 3D에 쓰지 않음
  - 정렬·3D: 최근접(기본)/보간(옵션) 정렬, `max_skew_ms`·`max_wait_ms`·`max_frame_age_ms`, DLT·깊이·재투영 검사, 3시점 이상치 제거, 실패 null+이유, 0.1초 무효 프레임, `/ws/pose3d`
  - 상태: 카메라별 disconnected/registered/receiving/stale, 보정 missing/invalid/synthetic/measured/mismatch, 시계 준비, readiness 4항목 분리, 변경 시 푸시, `scene_report` 수신. 합성 보정·샘플 입력은 준비 상태를 바꾸지 않음
  - 접속 키(D07): `SMASH_ACCESS_KEY` 설정 시 HTTP 401·WebSocket 거부, `?key=` 이후 해시 쿠키로 기존 페이지 수정 없이 통과
- 검증 방법·조건·실제 결과:
  - `python -m pytest -q` → 50 passed (Linux 개발 환경, Python 3.12.3, 고정 버전 설치). 기존 테스트 4개 중 상태 기대값 1개를 `not_implemented`→`disconnected`·보정 `missing`으로 갱신(“준비 상태를 주장하지 않는다”는 의도는 유지)
  - `python tools/check_scaffold.py` → OK: 6 JSON examples, 33 Markdown files
  - 합성 종단 확인: 자체 서명 인증서 wss + 접속 키, 가상 폰 3대(시계 오프셋 +1834/−5212/+377ms, 업로드 지연 10~60ms, 검출 잡음 1.5px, 5% 가림), 10초. `nearest`: 손목 오차 평균 0.98/0.62cm, p95 2.96/1.38cm, 촬영→전송 평균 57.8ms, skew 최대 29.5ms. `interpolate`: 평균 0.80/0.52cm, p95 1.69/0.98cm, skew 최대 10.6ms. 서버 오류·예외 0건. 셔터 위상이 실행마다 달라 수치는 변동함
- 입력·장비 범위: synthetic. 실제 휴대폰·실측 보정·담당자 Windows PC는 사용하지 않음
- 남은 일·미검증: 실기기 3대 수신·재연결, 담당자 PC에서 DuckDNS 인증서로 실행·휴대폰 접속, 폰 브라우저의 `captureTime` 제공 여부(없으면 `allowed_timestamp_sources` 결정 필요), C0 영상 경로(T03), 실측 보정 계산(`intrinsics.py`·`extrinsics.py`), 세션 ID 주체, 평가 로그(T10). 루트 `README.md`의 “현재 상태” 문구는 공통 문서라 수정하지 않았으며 PM 확인이 필요함
- 막힌 점·도움·해제 조건: 실기기 검증은 김태이의 `/ws/ingest` 송신 구현이 있어야 진행 가능. 모니터 상태 표시는 이동수가 새 상태 값을 연결해야 확인 가능
- 다음 한 단계·재개 위치: `docs/SETUP.md` 3-2절대로 서버 PC에서 실행 → 휴대폰으로 `https://<주소>:8443/monitor/?key=<키>` 접속 확인 → 김태이와 `contracts/register.example.json` 형식으로 등록 시험
- 인계 대상·넘긴 자료: 김태이 — `docs/DATA_CONTRACT.md`의 `/ws/ingest`(등록·시계 교환·`pose_2d`·오류 코드), `tools/synthetic_cameras.py`(송신 예시 코드). 이동수 — `/ws/status` 새 필드, `scene_report`, `/ws/pose3d`, `/api/calibration`. PM — D07·D08 결정 기록, README 현재 상태 갱신 필요
- 갱신한 계획 체크리스트·현황: 계획 체크박스는 변경하지 않음(모든 항목이 실기기·담당자 PC·검토자 확인을 완료 기준에 포함). 이 파일의 현재 상태·Phase 표, `AGENTS/진행현황.md`의 정경호 행 갱신
- 종료·중단 시각: 2026-10-30 KST

### 2026-10-30 17:40 KST — 외부 에이전트 산출물 로컬 반영·Windows 검증 시작

- 담당 / 기록자: 정경호 / Codex.
- 작업 구분: 개인 개발·검증·문서.
- Phase: P1 서버 측, P2·P3 기초 일부. 공통 Phase 통과와 별개.
- 상태: 진행 중.
- 읽은 계획·기록: PM_plan.md, 정경호_plan.md P0~P3, AGENTS 운영 안내·현황·개인/PM 기록, 작업기록_template.md, 산출물 PR_DESCRIPTION.md.
- 연결할 계획 항목: P0 실행·기본 검사, P1 등록/수신 실패 사례 테스트, P2·P3 합성 검증.
- 이번 목표·완료 기준: ZIP 안전 해제 및 패치 반영, Windows 자동 테스트, 문서·계획·진행 기록 일치.
- 검증 계획: ZIP/반영 파일 대조, pytest, check_scaffold, 합성 입력 확인. 실기기·공인 HTTPS는 미검증으로 유지.
- 현재 브랜치: feat/server-deployment. GitHub 업로드는 사용자 수행.

### 2026-10-30 17:44 KST — 산출물 반영·Windows 검증 종료

- 담당 / 기록자: 정경호 / Codex.
- 작업 구분: 개인 개발·검증·공통 문서 정합.
- Phase·상태: P1 서버 측 검토 요청, P2·P3 기초 일부. 이번 로컬 반영·검증 작업은 완료, 공통 Phase는 확인 전 유지.
- 읽은 계획·기록: PM_plan.md, 정경호_plan.md P0~P3, AGENTS 운영·현황·개인/PM 기록과 양식, 외부 산출물 PR 설명·패치.
- 연결할 계획 항목·완료 기준: P0 기존 점검 명령·서버 테스트, P1 등록/검증/재연결 실패 사례 테스트. ZIP 해제·반영, Windows 검증과 문서 정합 확인.
- 바꾼 파일·결과물: ZIP 46개 파일을 `정경호_작업/.extracted/`에 안전 해제하고 패치를 루트에 적용. ZIP의 UTF-8 파일명 인코딩 지정 후 대조(자체 수정한 .gitignore·개인 기록 외 내용 일치). backend·config·contracts·tests·tools 및 관련 문서 반영. README·PM/개인 계획·결정 기록·설치 안내·개인/PM 진행 기록·팀 현황 보완. 압축 해제본은 Git 제외, 원본 ZIP·패치·PR 설명 보존.
- 어디까지 완료: 로컬 브랜치 `feat/server-deployment`에 서버 구현 반영. 이전 누적 기록의 `feat/backend-ingest-sync-tracking`과 Linux 결과는 외부 에이전트 환경이며 이번 PC와 구분한다. GitHub 업로드는 수행하지 않음.
- 검증 방법·조건·실제 결과:
  - Windows Python 3.13.14, `.venv` 생성 후 requirements-dev.txt 설치. 첫 설치는 네트워크 제한으로 실패해 승인된 권한으로 재시도·성공.
  - `.venv/Scripts/python.exe -m pytest -q`: 50 passed, Starlette/httpx 사용 중단 예정 경고 1개. HTTP 상태·정적 경로·접근 제한과 WebSocket/합성 추적을 포함한다.
  - `.venv/Scripts/python.exe tools/check_scaffold.py`: JSON 예시 6개·Markdown 35개와 로컬 링크 통과(최종 재검사 별도 수행).
  - 실제 Uvicorn 프로세스 + 접속 키 + 루프백 HTTP/WS에 합성 카메라 3대 10초 연결. 정렬 프레임 375개, sample_only=true. 좌/우 손목 p95 오차 4.80/1.91cm, 합성 관측→서버 전송 평균 84.0ms. 실측·전체 화면 지연이 아니다. no_input·low_visibility·insufficient_views 무효 사유 관측. 시험 서버는 종료.
  - 로컬 재현 도구 `data/local/verify_backend.py`, 결과 `data/local/windows-synthetic.txt`, 서버 로그 `data/local/windows-server.log`. 모두 Git 제외 경로, 테스트 키는 재현 전용 고정값이며 실서비스 키가 아님.
- 입력·장비 범위: synthetic / Windows PC. 실제 휴대폰·공인 HTTPS·인증서는 사용하지 않음.
- 남은 일·미검증: 실제 세 폰 송신, 외부 HTTPS·키 접속, 실측 보정·시간 출처, C0 영상, 모니터 새 계약 연결, 세션·타격 로그.
- 막힌 점·도움·해제 조건: 김태이의 폰 송신·실측 자료, 이동수의 상태/3D 소비 연결 필요. D07 세부 배포 방식과 인증서 결과는 산출물 보고로만 확인되어 검증 대기로 정정.
- 다음 한 단계·재개 위치: docs/SETUP.md 3절의 주소·인증서·포트 구성 확인 후 실제 휴대폰 1대 HTTPS 접속, 이어 /ws/ingest 송신 연결.
- 인계 대상·넘긴 자료: 김태이·이동수에게 docs/DATA_CONTRACT.md v0.2 및 예제(로컬 준비, 실제 전달·수신 확인은 미검증), PM에게 계획·현황 정합.
- 갱신한 계획 체크리스트·현황: P0 기존 점검/서버 테스트, P1 실패 사례 테스트 항목만 체크. 실기기·검토·통합 항목은 미체크 유지. 개인 상태/Phase·팀 정경호 행과 PM 관리 행 갱신.
- 종료·중단 시각: 2026-10-30 17:44 KST.

### 2026-10-30 19:37 KST — 외부 HTTPS 확인 기록·로컬 실행 정리 시작

- 담당 / 기록자: 정경호 / Codex.
- Phase·상태: P0 접속 환경 / 진행 중.
- 읽은 계획·기록: 개인 계획 P0, 개인/PM 진행 요약, 팀 현황. 완료 기준은 사용자 외부 접속 보고 기록과 키 누락 방지 실행 파일 준비.
- 검증 계획: PowerShell 구문·필수 파일·Git 제외 확인. 실행 중인 서버는 재시작하지 않음.


### 2026-10-30 19:37 KST — 외부 접속 확인·로컬 실행 정리 종료

- 담당 / 기록자: 정경호 / Codex.
- 작업 구분·Phase·상태: 검증 기록·실행 지원 / P0 접속 환경 / 이번 작업 완료, 개인 P0는 검토/합의 잔여로 진행 중.
- 연결할 계획 항목: 개인 P0의 신뢰 가능한 HTTPS 접속 준비. 김태이의 동일 환경 확인은 남아 체크박스 유지.
- 바꾼 파일·결과물: start_server.local.ps1·start_server.local.bat 준비, .gitignore에 *.local.ps1·*.local.txt 추가. 개인/PM 기록·팀 현황·SETUP·결정 기록 갱신.
- 확인한 근거: 사용자 서버 로그에서 8443 HTTPS 실행 성공, 에이전트 로컬 HTTPS 401 응답·포트 수신·방화벽 허용 조회. 사용자가 로컬 카메라 미리보기와 외부 접속 성공을 각각 보고함. 외부 기기·망·브라우저 상세는 미기록, 에이전트가 외부 브라우저로 재현한 것은 아님.
- 실행 파일 동작: 첫 실행 때 기존 팀 키를 숨김 입력받아 access-key.local.txt에 로컬 저장하고 재사용. 빈 키·16자 미만·필수 파일 누락 시 시작 중단. 키 값은 기록·출력하지 않음. 현재 서버나 키는 변경하지 않았으며 새 파일은 아직 실행하지 않음.
- 검증 방법·실제 결과: PowerShell AST 구문 검사 통과, git check-ignore로 실행 파일 2개와 키 파일 제외 확인. 기존 서버와 8443이 겹쳐 실제 재시작은 미실행. 접근키 파일은 아직 생성하지 않음.
- 입력·장비 범위: 사용자 실제 외부 접속 보고 / 로컬 서버 조회. 관절·영상 서버 전송과 실제 3대 입력은 미검증.
- 남은 일·막힌 점: 김태이 폰 송신·이동수 상태/3D 연결, 실측 보정·시각 출처·C0 영상. 키 저장은 로컬 평문이며 Git 제외, 팀 안에서 관리.
- 다음 한 단계: 현재 서버 종료 후 start_server.local.bat 실행, 기존 키 입력 후 접속 재확인. 이어 /ws/ingest 등록·관절 송신 연결.
- 인계·체크리스트·현황: 개인 요약·P0 잔여·팀 정경호 행·PM 요약 갱신. 전체 Phase와 실기기 송신 항목은 완료 처리하지 않음. GitHub 업로드 안 함.
- 종료 시각: 2026-10-30 19:37 KST.

### 2026-10-30 20:56 KST — .env 기반 실행 전환 시작

- 담당 / 기록자: 정경호 / Codex. P0 실행 환경, 진행 중.
- 읽은 계획·기록: 개인 P0 실행·HTTPS 준비와 직전 로컬 실행 기록.
- 목표·검증: 키 내용 출력 없이 .env를 읽고 누락 시 중단, CheckOnly로 실제 서버 시작 없이 확인. 기존 서버는 유지.


### 2026-10-30 20:56 KST — .env 기반 실행 전환 종료

- 담당 / 기록자: 정경호 / Codex. 작업 구분: 실행 지원·문서 / P0 / 이번 작업 완료.
- 연결할 계획 항목·완료 기준: P0 서버 실행·접속 환경. .env 키를 읽고 누락·빈 값·중복·16자 미만이면 실행을 중단한다.
- 바꾼 파일: start_server.local.ps1, 개인/PM 기록·팀 현황·SETUP. 기존 .env는 읽기만 했고 키 내용은 출력·변경하지 않았다.
- 실제 결과: PowerShell -CheckOnly 성공(.env와 필수 인증서·Python 존재/키 형식 확인), git check-ignore로 .env·실행 파일 제외 확인. access-key.local.txt는 더 이상 읽거나 생성하지 않으며 기존 파일이 있어도 보존한다.
- 검증 범위: 로컬 설정 검사만. 현재 서버는 중단·재시작하지 않았으며 .env 적용 후 외부 재접속은 미검증. 키는 실행 스크립트가 읽으므로 Uvicorn을 직접 실행하면 자동 로드되지 않는다.
- 남은 일·다음 행동: 현재 서버 Ctrl+C 후 start_server.local.bat 실행, .env의 키로 접속 확인. 이후 김태이 폰 송신·이동수 소비자 연결.
- 현황·체크리스트: 개인 현재 작업·팀 정경호 행에 .env 실행 방식 반영. 실기기 관절 수신·공통 Phase 완료 표시 변경 없음. GitHub 업로드 안 함.
- 종료 시각: 2026-10-30 20:56 KST.

### 2026-10-30 21:03 KST — 외부 접속 후 잔여 역할 대조 시작·종료

- 담당 / 기록자: 정경호 / Codex. 작업 구분: 상태 확인·문서 / P0 및 P1~P6 잔여 정리 / 완료.
- 읽은 계획·기록: 정경호_plan.md P0~P6, 개인 진행 요약·직전 .env 실행 기록, backend·tools·tests 파일 목록. 목표는 실제 완료·합성 검증·미구현·협업 대기를 구분하는 것.
- 확인 근거·실제 결과: 사용자가 .env 실행 안내 이후 외부 접속 성공을 보고했다. 이전의 재접속 미검증 기록 이후 추가 확인이며 에이전트 외부 재현은 아님. 서버 자동/합성 검증은 직전 50개 테스트 결과 유지, 이번에는 재실행 안 함.
- 바꾼 파일·결과물: 개인 계획의 외부 접속 상태·설정 로더 설명, 개인 진행 요약·누적 기록, 팀 정경호 행, PM 누적 기록. 이번 요청으로 구현 추가 없음.
- 남은 일: P0 계약·좌표·촬영 요구를 팀원과 검토·전달, P1 실제 3대 손목/미검출·중복·재연결 확인과 상태 UI 연결, P2 C0 경로·실측 자료·기준값 합의, P3 실측 내부/외부 보정 계산과 실제 정합·시간 검증, P4 세션·타격/성능 로그, P5 장시간·장애·재현 절차, P6 실제 평가/분석.
- 막힌 점·의존성: 실제 관절 수신은 김태이 송신 필요, 모니터 소비는 이동수 연결 필요. 보정 계산 도구·촬영 입력 규격·관측 재생 도구 준비는 독립적으로 진행 가능. 현재 합성 카메라 도구를 실제 관측 로그 재생 완료로 간주하지 않음.
- 다음 행동·재개 위치: 우선 docs/DATA_CONTRACT.md를 기준으로 김태이 register/clock_pong/pose_2d 연결, 이동수 상태/pose3d 검토. 병행해서 backend/calibration의 실측 K/dist/R/t 계산 도구와 촬영 요건 준비.
- 체크리스트·현황: P0의 팀 검토와 P1 실기기 기준은 미충족이므로 일괄 체크 안 함. 공통 Phase 확인 전 유지. GitHub 미업로드.
- 종료 시각: 2026-10-30 21:03 KST.

### 2026-10-30 21:08 KST — PM 진행 기록 변경 철회

- 담당 / 기록자: 정경호 / Codex. 작업 구분: 문서 정정 / 개인 기록 관리 / 완료.
- 사용자 지시: PM이 아니므로 PM_progress.md를 수정하지 않고, 이번 세션에서 수정한 내용도 제거.
- 확인·변경: Git 차이를 대조해 PM_progress.md 변경이 이번 세션의 요약 수정·누적 기록 4개임을 확인하고 HEAD의 기존 내용으로 복원. 기존 PM 기록 보존.
- 검증·결과: PM_progress.md의 Git 차이 없음 확인. 서버 코드·개인 계획·기록은 유지. 앞으로 PM 기록 직접 수정 안 함.
- 남은 일·다음 행동: 실제 휴대폰 관절 송수신 연결, 실측 보정 도구 준비. 개인 작업 상태·Phase 변화 없음.

- 실행 경과 보완: 최초 복원은 샌드박스의 Git index.lock 접근 제한으로 실패했고, 승인 후 같은 파일 복원을 재시도해 성공. 최종 git diff --exit-code 및 git status 결과에서 PM_progress.md 변경 없음 확인.

### 2026-10-30 21:14 KST — 개인 진행 상태만 갱신하도록 범위 정리

- 담당 / 기록자: 정경호 / Codex. 작업 구분: 개인 문서 관리 / 완료.
- 사용자 지시·완료 기준: 팀 현황의 공통 관리 추가 행을 제거하고 개인 진행 상태만 갱신.
- 변경: 진행현황.md의 서버 산출물 공통 관리 행 삭제, 상단 공통 기준 문구 원복. 정경호 행의 검증 결과·다음 작업은 유지. 개인 요약 갱신 시각 반영.
- 검증: 진행현황 Git 차이가 정경호 행에만 남는지 대조, PM_progress.md 차이 없음 및 문서 링크 검사.
- 남은 일·다음 행동: 실제 관절 송수신 연결·실측 보정 도구 준비. 개인 상태·Phase 변경 없음. 앞으로 개인 진행 파일과 팀 현황의 정경호 행만 상태 갱신하고 PM/공통 관리 상태는 수정하지 않음.
- 종료 시각: 2026-10-30 21:14 KST.

### 2026-10-30 — 카메라 브랜치 통신 호환 시작

- 담당 / 기록자: 정경호 / Codex. P1 서버 수신·P2 시계 기초, 진행 중.
- 읽은 계획·기록: 개인 계획 P1 수신·재연결 검증, 개인 진행 기록·팀 정경호 행, 카메라 브랜치 pose-link.js·app.js·계약 제안과 현재 서버.
- 목표·검증: /ws/pose camera_hello/ack·폰 발급 stream·시계 필드를 서버에서 수용, 기존 /ws/ingest 유지. 재연결·회전·시간/신뢰도 미상·재생 출처를 실패 사례 테스트로 검증. 폰 화면 코드는 미변경, 실기기 미검증 유지.


### 2026-10-30 21:37 KST — 카메라 브랜치 통신 호환 종료

- 담당 / 기록자: 정경호 / Codex. 작업 구분: 개인 서버 개발·검증 / P1 수신·P2 시계 기초 / 서버 측 검토 요청.
- 연결할 계획 항목·완료 기준: P1 등록·검증·재연결·실패 사례 테스트. 카메라 브랜치 9b760a8의 실제 메시지 구조를 수용하고 기존 ingest 유지. 전체 P1 실기기 기준은 미충족.
- 바꾼 파일·결과물: backend/server.py, ingest/camera_protocol.py·registry.py·schemas.py, settings.py; tests/test_camera_protocol.py; docs/DATA_CONTRACT.md·backend/ingest/README.md; 개인 계획/진행·팀 정경호 행. PM 기록·타인 진행 행은 수정 안 함.
- 구현 결과: /ws/pose camera_hello→camera_ack, 폰 생성 stream_id 수용, 시계 필드·schema_version 생략 pong 변환. 회전/해상도 변경 시 frame 0 새 스트림으로 관측·번호 이력 초기화, 이전 ID 재사용 차단·연결당 128개 제한. 재생은 sample_only=true로 구분, visibility=null 손목은 관측 없음, rvfc_capture_time은 출처를 유지하고 기본 3D 허용에는 추가하지 않음. 같은 키/쿠키 보호 적용.
- 검증 방법·실제 결과: Windows Python 3.13.14, pytest -q -o cache_dir=data/local/pytest-cache --tb=short → 58 passed, 기존 Starlette/httpx 경고 1개. 새 8개 테스트: 폰 등록/시계/2D, 스트림 전환·이전 ID, 신뢰도/시각 미상, 재생 출처, 중복·재접속, ID 재사용, 잘못된 시계 에코, 키 보호. 기존 /ws/ingest 포함 50개 회귀 통과.
- 최초 새 테스트 1개 실패: frozen 설정에 직접 대입한 테스트 준비 오류. dataclasses.replace로 고쳐 재실행 통과. 최초 pytest 기본 캐시 권한 경고는 Git 제외 data/local 캐시 경로 지정 후 해소.
- 입력·장비 범위: TestClient의 카메라 브랜치 구조 메시지, synthetic. 브라우저 MediaPipe·실제 3대·현재 공인 서버 재시작 검증은 미실행.
- 남은 일·막힌 점: 카메라 브랜치 화면 코드는 아직 현 브랜치 미반영, 모델·WASM 준비 필요. calibration_id=null·실측 보정·촬영 시각 출처 문제도 후속. 송신 구현이 없다는 이전 추정은 정정: 별도 브랜치에 존재하고 서버 호환을 이번에 완료함.
- 다음 한 단계: 사용자와 화면 반영 범위를 정한 뒤 카메라 페이지·모델 준비, 서버 재시작 후 휴대폰 1대 /ws/pose 수신부터 확인. 실행 중 서버는 변경·종료하지 않음.
- 인계·현황: 계약 호환 절과 개인 요약·P1 표·팀 정경호 행 갱신. 김태이·이동수에게 실제 메시지는 발송하지 않음. 실기기/공통 Phase 체크박스 변경 안 함. GitHub 미업로드.
- 종료 시각: 2026-10-30 21:37 KST.

### 2026-11-02 17:09 KST — 사용자 인수 및 패키지 계약 연결

- 공통 관리 / 실제 서버·추적 개발 완료와 별개. 사용자가 전체 작업을 인수했다.
- IT 1호관 패키지의 Y-up/m 로컬 좌표·원점·배율·파편 피벗을 작업 저장소 `docs/DATA_CONTRACT.md`, `docs/ASSET_PIPELINE.md`에 연결했다. 기존 pose_3d room_z_up 계약은 유지하고 이중 변환을 피한다. keyboard_demo의 source는 synthetic이다.
- 검증은 합성 패키지와 독립 브라우저 범위다. 실기기·등록·2D 수신·보정·3D 추적의 상태는 확인 전 유지. 다음 행동은 실제 입력 인터페이스 확인이다.

### 2026-11-02 17:27 KST — 건물 크기 계약 정정 연결

- 독립 패키지 재검증에서 dimensions_m의 축소 배율 누락을 확인·수정했다. Y-up 게임 크기는 약 [2.8,1.0324382,0.6155215]m이며 원본 캠퍼스 크기는 source_dimensions_campus_z_up_m로 구분한다. 소비 코드에서 이전 크기를 쓰지 않도록 데이터 계약에 연결했다.
- 기존 pose_3d room_z_up 계약과 실제 서버·휴대폰·보정 완료 상태는 변경하지 않았다. 검증은 합성 패키지·키보드 범위다.


### 2026-11-02 18:20 KST — 고도화 건물 카탈로그 계약 연결

- 공통 관리/인계 연결이며 서버·추적 개발 완료를 뜻하지 않는다. catalog.json에서 knu-it1-v2 64개, knu-main-v1 52개, 보존 knu-it1-v1 32개를 선택한다. 파편 수·실제 게임 크기는 각 manifest를 읽는다. m·three_y_up 및 미리 적용된 축 변환은 유지한다.
- 로컬 클릭 타격점·파편·먼지는 synthetic/keyboard_demo 범위다. pose_3d room_z_up·시계·기기·서버 준비 계약은 변경하지 않았다. docs/BUILDING_ENHANCEMENTS.md와 DATA_CONTRACT에 결과·검증을 연결했다. 실제 네트워크 소비 코드·카메라·3D 복원·AR는 확인 전 유지한다.


### 2026-11-02 18:54 KST — 지도 대조 캠퍼스 v13 경로 인계 연결

- 사용자 인수 정적 에셋 보완의 계약 연결 기록. 글로벌플라자·도서관·IT2·대강당·박물관·제2체육관을 지도/사진과 대조해 보완하고 catalog.campus를 v13으로 변경했다. campus_focus는 로컬 캠퍼스 Y-up/m 카메라 이동 목록이다.
- 기존 IT1 64/32·본관 52 파편 패키지 SHA-256과 파편/피벗·room_z_up·시계/네트워크 계약은 유지했다. docs/CAMPUS_MAP_REVIEW.md와 map-review/summary.json을 전달 근거로 남긴다. 실제 소비 코드·입력·소리·C0/AR 통합 완료는 추정하지 않으며 해당 개인 Phase 상태는 유지한다.


### 2026-11-02 21:04 KST — 인수 정정 확정·세분화 에셋 인계 자료

- 사용자 인수는 이동수 담당 전체다. 김태이의 손목 충돌·파편 물리/소리, 정경호의 유효3D 복원 책임은 유지한다. 이전 팀 전체 인수 해석을 정정했다.
- 이동수·Codex가 IT1 v3 96개·본관v2 85개 에셋을 검증했다. 기존 버전/단위/피벗/이벤트/시계 규칙 유지. docs/FRACTURE_REFINEMENT.md와 summary에 인계 자료를 준비했으며 실제 공동 로드/실기기 소비 완료는 아님.
- 몸 전체의 지속 파편 접촉은 기본 손목 타격과 별도 확장 요구다. 물리/추적 담당이 범위를 맞추고 이동수는 모델/화면/게임 연결을 담당한다. 다른 담당자 Phase 완료 사실을 추가하지 않는다.

### 2026-11-03 15:24 KST — 카메라 PR과 서버 코드 호환 PM 검증

- 담당 / 기록자: PM·공통 코드 검토 / Codex. P1 수신·P2 시계/샘플·P3 기초 코드 확인, 실측 통합 기준은 미검증.
- 확인한 코드·결과: 원격 feat/server-deployment e9cdaffbc6d799e4aeb92e5138f975567d0a78dc와 PR #1 수정본을 임시 worktree에서 결합. pytest 58개·카메라 회귀 6개 통과, 실제 MediaPipe replay에서 C0 receiving·clock.ready=true·sample_only=true·rejected={}·game_ready=false 확인.
- 역할·검증 한계: 서버의 등록/수신·시계·정렬/3D 기초 코드가 존재함을 확인했으며 로컬 초기 '확인 전' 기록을 보완한다. 실제 폰·실측 보정·3D 정확도·외부 HTTPS 재접속을 이번에 검증하지 않았다.
- 머지 범위: PR #1 카메라 코드만 main fa3b19e로 머지. 서버 브랜치는 별도이며 문서 4개 충돌은 시험용으로 서버 쪽을 선택했을 뿐 실제 통합 해결이 아니다.
- 변경 기록·남은 일·다음 행동: 본 요약과 팀 서버 행을 실제 코드 확인 근거로 갱신. 서버 PR/문서 병합, rvfc_capture_time 허용 정책·실측 보정·세션/상태 규격 공유 및 11-09 장비 시험 준비. 체크리스트·공통 Phase 완료 상태는 유지.
- 종료 시각: 2026-11-03 15:24 KST.

### 2026-11-03 17:19 KST — 단일 카메라 v0.2 역할 계획 추가

- 담당 / 기록자: PM·공통 계획 / Codex. 개인 개발 수행 보고가 아니라 사용자 지시에 따른 역할 계획 연결이다.
- 작업 구분·Phase·상태: 문서 / SC-00~05 추가 경로 / 역할 계획 반영 완료, 기능 미착수.
- 읽은 계획·항목: PM 계획·단일 실행 계획 v0.2 및 정경호_plan.md의 기존 SC 요약·개인 Phase/마지막 기록. 세부 J-SC-01~06을 추가했다.
- 목표·결과물: 정경호_plan.md에 받을 입력·파일 경계·완료/인계·T-SC 시험을 명시. 공통 인터페이스/검증 문서와 팀 현황 연결.
- 검증 범위: 문서 링크·ID·기존 체크리스트 보존은 PM 기록의 문서 검증 결과를 따른다. 개인 앱/모듈/실기기 시험은 이번 작업에서 실행하지 않음.
- 입력·장비 범위: 해당 없음(계획 문서). 기존 개발 검증과 실제 장비 미검증 사실은 유지.
- 남은 일·막힘: 담당자 가용 일정·실제 폰/PC/망 확인, 상세 계약 미정 항목을 구현 PR에서 해소. 다른 담당의 구현 완료를 가정하지 않음.
- 다음 행동·재개: J-SC-01 main/서버 차이·접속/세션 계약 정리 후 J-SC-02 방/신호 PR, 기존 서버 미머지 범위 분리. 해당 개인 계획의 v0.2 체크리스트부터 시작 기록을 남긴다.
- 체크리스트·현황: 새 기능 6개 모두 미완료, 기존 P0~P6 상태/체크 유지. 현황의 다음 행동만 갱신. 팀원 메시지 발송 없음.
- 종료 시각: 2026-11-03 17:19 KST. PR #4 문서 변경에 함께 공유하며 머지 결과는 PM 기록에 남긴다.

### 2026-11-03 21:35 KST — 최신 main·기존 서버 충돌 병합 시작

- 담당 / 기록자: 정경호 / Codex. 로컬 병합·문서 정합 / P1 및 J-SC-01 준비 / 진행 중.
- 읽은 계획·기록: PM 계획·AGENTS 운영/현황, 정경호 계획 J-SC-01~06·양쪽 개인 기록, 단일 계획/인터페이스, pr-workflow 스킬.
- 사용자 요청·완료 기준: 최신 계획·역할 우선, 기존 서버 API·이력 보존, 충돌 6개 해소·검증. 커밋·push는 하지 않음.
- 변경 범위: README, ARCHITECTURE, DATA_CONTRACT, DECISIONS, 개인 progress, 진행현황. 기존 merge 코드 보존, PM/타인 진행 파일 미수정.
- 검증 계획: 충돌 마커·미병합 인덱스·문서 링크·서버 회귀·카메라 수명주기. live·외부 서버·실측 미실행.

### 2026-11-03 21:36 KST — 최신 main·기존 서버 충돌 병합 종료

- 담당 / 기록자: 정경호 / Codex. 작업 구분·상태: 로컬 병합 충돌 해소·검증 완료 / 병합 커밋 대기.
- 바꾼 파일: README.md, docs/ARCHITECTURE.md, docs/DATA_CONTRACT.md, docs/DECISIONS.md, AGENTS/정경호_progress.md, AGENTS/진행현황.md. 최신 모델/카메라/SC 계획과 기존 서버 API·양쪽 누적 기록을 보존. 진행현황은 타인 행 보존·정경호 행만 갱신.
- 검증 결과: .venv/Scripts/python.exe -X utf8 -m pytest tests/ -q -p no:cacheprovider --tb=short → 58 passed, Starlette/httpx 경고 1개. node --experimental-vm-modules --test tests/test_camera_lifecycle.mjs → 6 passed. tools/check_scaffold.py → JSON 6개·Markdown 48개·로컬 링크 정상. 충돌 마커 없음·diff 공백 검사 통과.
- 입력·장비 범위: Windows PC, TestClient/synthetic 및 카메라 lifecycle mock. 실제 폰·외부 HTTPS·MediaPipe 실제 재생·3D/AR·브라우저 파괴 렌더 회귀는 이번 미실행.
- 남은 일·다음 행동: 사용자 병합 결과 확인 후 커밋, J-SC-01 단일 계약/접속 보호 검토 후 방·신호 구현. 새 단일 모드 API/세션/로그는 미구현. 기존 서버 기능의 실측 기준과 공통 Phase 체크는 변경하지 않음.
- Git 상태 정정: git add는 인덱스 권한 제한으로 실패했고 재시도 승인은 사용자가 취소했다. 문서의 충돌 마커는 제거했지만 Git의 충돌 해결 표시는 아직 하지 않았다. 이후 사용자 지시에 따라 문서만 수정하며 Git 명령은 명시적으로 요청받은 것만 실행한다. 커밋·push·실행 서버 변경 없음. 로컬 키·실행 스크립트는 수정하지 않음.
- 종료 시각: 2026-11-03 21:36 KST.
