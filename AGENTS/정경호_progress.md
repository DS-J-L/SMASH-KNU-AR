# 정경호 진행 기록


계획: [정경호_plan.md](../정경호_plan.md) · [PM_plan.md](../PM_plan.md) · [팀 현황](진행현황.md) · [기록 절차](README.md)

## 1. 현재 상태

| 항목 | 현재 값 |
| --- | --- |
| 마지막 갱신 | 2026-11-04 21:56 KST |
| 현재 작업 | 전신22개+머리 대표점1개 2D 표시/송신 로컬 검증 완료, 실기기 확인 대기 |
| 구현 완료 범위 | 기존 관절 수신·시계/3D 기초, 두 방·영상·QR·video_check, 방 1 폰 손목 입력, 확대·시간/점수, 수동/자동 중지 — 로컬 자동검증 범위 |
| 방 구성 | room-1 C0/C1/C2 모두 시작 필수, room-2 C0만. PC는 방별 전용 페이지 |
| 최근 기능 검증 | Python131개·관련JS16개·합성 영상 수신 픽셀1개 통과. 이전 게임UI9개, 실기기와 구분 |
| 남은 일 | 실제 3대 관절/시각 확인·실측 보정·3D 정합, 소비자 결과 연결, 단일PC 추론·실제타격/점수·로그·장시간/QR실스캔 |
| 다음 작업 | 서버 재시작·PC/폰 새로고침 후 수동 중지·폰 하나 종료/영상 중단 자동 중지 확인, 실제 관절/시각·보정 검증 |
| 판정 제한 | 영상 확인 세션은 실제게임이 아님. 사용자 영상정상 보고와 에이전트 실기기 검증을 구분. 공통Phase 통과는 확인 전 |

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

## 3. 최초 문서 대비 실질 변경

2026-11-04 사용자가 문서 정리를 요청해 최초 추가 커밋과 현재 로컬 코드를 비교했다. 아래 커밋은 비교 기준이며 현재 미커밋 코드의 게시 근거가 아니다.

| 문서·최초 커밋 | 최초 내용 | 현재 유효 변경 |
| --- | --- | --- |
| README · a370c4f | 프로젝트 소개 | 실행 경로·역할·구현/미검증 범위·문서 연결 |
| 구조·데이터 계약·결정 · 37c6ab9 | 상태WS와2D/3D 메시지 초안 | 관절 수신/검증·시계/3D·인증 계약, 별도 room.v1 영상/세션/QR 계약 |
| PM·개인 계획/기록 · a4ca910 | P0~P6·담당·실기기 기준 | 단일카메라 추가 계획·11/09 시험 목표, 현재두방·영상·video_check 범위와 인계 |
| 단일 인터페이스 · 8ec08d7 | PC추론/2D게임 설계 기준안 | 실제 room.v1과 미구현 추론/타격 설계 구분 |
| ROOMS.md · 신규 로컬 문서 | 없음 | 현재 두방·공개카메라/PC보호·영상/시각/정렬·QR4개·시작/결과 계약 |

## 4. 기능별 작업·검증 기록

### 2026-10-30 — 기존 서버 등록·시계·3D 기초

- Phase·상태: P1 서버 측 구현·검토 요청, P2/P3 기초 일부. 실제3대/실측 기준 미완료.
- 변경: backend ingest/registry/schemas, sync/clock/frame_aligner, calibration/storage, tracking/triangulation/quality/pipeline, runtime/settings/connections/auth/server; 예시 config/contracts·합성 도구·실패 사례 테스트.
- 동작: 기기/스트림 등록·중복/재연결·수신 검증, 최소RTT 시계 변환·프레임 정렬, 보정값 검증·DLT/재투영/깊이 검사·무효좌표 null, 상태/pose_3d 전달·접속키 보호.
- 검증: Linux Python3.12에서50개, Windows Python3.13.14에서50개 회귀. 합성 카메라3대·루프백 WS10초는 정렬375프레임, 좌/우 p95 오차4.80/1.91cm·평균84.0ms(관측→서버전송). 실제정확도/전체지연 성능이 아니다. 기존 로컬 근거는 data/local/windows-synthetic.txt·windows-server.log이며 Git 제외다.
- 배포: 로컬 bat→ps1→.env 접속키/인증서로8443 실행. 외부HTTPS 성공은 사용자 보고. MediaPipe 런타임/모델 준비를 서버 실행 전에 수행하고 실패 시 중단하도록 로컬 ps1을 보완했다.

### 2026-10-30~11-03 — 카메라 프로토콜·최신 코드 통합

- 변경: /ws/pose camera_hello/ack·폰stream_id·시계필드 호환, 재생sample_only·신뢰도미상·회전 스트림 초기화·이전ID 재사용 차단. 최신 폰 송신·모델/파편·단일 계획과 기존서버를 병합했다(23e1196).
- 검증: 기존서버 포함58개 통과. 카메라 PR 재생 입력의 receiving/시계·오류복구/연결교체 확인은 팀 기록의 replay 근거이며 실제3대가 아니다.
- 데이터 계약: 기존 room_z_up/m·모델 three_y_up 변환·패키지 manifest/피벗/충돌체·카탈로그 규칙 보존. 단일은 PC추론/화면2D 기준안이며 기존 폰2D/서버3D와 별개다.

### 2026-11-04 — 두 방·영상·고정 QR

- 변경: rooms.py·room_config.py, PC목록/방전용페이지·폰방선택, WebRTC 신호 중계와 JPEG 서버중계, Peer의 최신프레임 대기 교체, QR생성·출력과 camera역할 공개/monitor역할 인증.
- 최종 구성: room-1 PC1대·C0/C1/C2, room-2 PC1대·C0. 방별영상/상태 분리, 중복·재접속·만료·이전연결 종료 보호. QR4개는 서버주소/방/번호만 담고 만료토큰·접속키를 넣지 않는다.
- 영상: 긴변640·약15FPS, JPEG0.65. WebRTC는 STUN/TURN 미구성·독립표시. 중계영상은 유한버퍼·준비시각 기준 묶음표시. 실제폰·다른망·장시간·QR실스캔은 미검증이다.
- 사용자 보고: 영상 표시와 직접/중계 지연이 유사하다는 보고가 있다. 정량 지연·실제3대 완료로 판정하지 않았다.

### 2026-11-04 — 서버 시각·표시 정렬·영상 미표시 수정

- 변경: server-clock.js·video-clock.js·video-timeline.js·synchronized-video.js 및 room메시지. heartbeat 서버수신/응답 시각으로 단조시계 오프셋 보정, 프레임별 응답대기 없음. 최근10초 최소RTT·추정오차 표시.
- 정렬: 연결별32프레임, 가장 늦은 최신 준비시각 기준·차이120ms 한도, 묶음 디코딩 후 같은 JS작업에서 표시. 1.5초 미수신 제외·복구 버퍼 정리·디코딩1초 제한.
- 수정 근거: 시각null 프레임을 모두 제외해 영상이 안 나올 수 있던 경로를 개별표시 fallback으로 보완했다. 시각 준비 후 동기화로 전환하며 stream/track을 정리한다. 모듈캐시 버전과15FPS 표시를 보완했다.
- 검증: 타임라인4개·시계3개·fallback 전환/track정리1개 통과. 브라우저 실제영상 시험에서는 SDP 교환 후 ICE new·수신폭0을 관측해 성공으로 판정하지 않았다. 현재 준비시각은 센서 촬영시각이 아니며 시각대기 원인·실제정렬/지연 실측은 미확정이다.

### 2026-11-04 — 방별 시작 승인·60초·결과·카메라 테스트 복귀

- 변경: game_sessions.py, room.v1 start_game/game_ack/get_game_status, PC준비/신선프레임 검사·버튼활성화·단조타이머·결과·테스트복귀.
- 최종 조건: room-1 세대 모두 연결/최근1.5초 영상, room-2 C0. 서버도 필수목록·현재연결ID·monitor 역할을 검사한다. ACK전 타이머 미시작, 동일요청은 시간초기화 없이 응답, 진행중 중복/과거세션 차단, 새시작은 새UUID.
- 세션: 방별60초·재접속 시 남은시간 조회·프로세스당 최대1000이력. 종료 후 테스트복귀는 영상/방 유지·결과숨김이며 새세션을 시작하지 않는다. mode=video_check, score=null, 실제타격/점수는 미연결이다.
- 최근 검증: 전체 Python111 passed(기존Starlette/httpx 경고1개), Edge모의UI5 passed(35.5초), JS문법·JSON6/Markdown49·링크 통과. UI시험의 WS/영상속성은 모의이며 실카메라 시험이 아니다. 검사명령은 아래에 있다.

## 5. 검증·재개 위치

```powershell
.venv\Scripts\python.exe -X utf8 -m pytest tests/ -q -p no:cacheprovider --tb=short
npx playwright test -c playwright.room-game.config.js --reporter=line
node --test tests/test_server_clock.mjs tests/test_video_timeline.mjs
node --experimental-vm-modules --test tests/test_synchronized_video.mjs
.venv\Scripts\python.exe -X utf8 tools/check_scaffold.py
```

이 명령들은 위 기능 작업 때의 검증/재현 명령이다. 이번 문서정리에서 기능시험을 재실행한 것은 아니다. 실기기 확인은 서버 재시작·양쪽 새로고침 후 PC방입장·폰QR입장·필수영상 준비·시작/결과/테스트복귀 순으로 진행한다. 관절/3D 연결은 DATA_CONTRACT와 기존 /ws/pose를 먼저 대조한다.

## 6. 문서 정리

### 2026-11-04 14:26 KST — 현재 계획·코드 기준 문서 정리

- 담당 / 기록자: 정경호 / Codex. 사용자 요청에 따라 기존 누적기록의 정리 예외를 적용했다.
- 범위: 최초 문서 커밋과 현재 코드 대조, 질문/단순확인·원복된 작업·미채택 중간구성 기록 제거, 현재계약·실제변경·검증/실패수정·남은일 보존.
- 계획 체크리스트·다른 담당자의 기록·실기기/공통Phase 판정은 유지한다. 코드·설정·테스트·Git이력은 수정하지 않는다.
- 결과: JSON 예제6개·Markdown49개와 로컬 링크 검사 통과. 비문서488개 파일의 정리 전후 SHA-256이 모두 동일하다. 계획 체크리스트는 변경하지 않았다. 기능 시험은 이번 정리에서 재실행하지 않았다.
- 남은 일 / 다음 행동: 기존 관절/3D 경로와 room-1 연결, 실제 폰·QR·장시간 시험. 현재 구현과 목표 계약의 구분을 유지하며 담당자와 입력/소비 경계를 확인한다.

### 2026-11-04 16:26 KST — 방 1 폰 손목 추론·기존 수신 경로 연결

- 담당 / Phase: 정경호, P1 입력 수신·P2 연결 지원. 개인 계획 P1의 기기별 관절 수신/검증 및 P2 영상·관절 경로 분리 항목.
- 목표: 기존 방 1 카메라 화면에서 폰 MediaPipe 손목 추출을 실행하고 공개 방 연결의 기기/슬롯에 묶어 기존 서버 registry·시계·3D 파이프라인에 입력한다. 방 2는 영상 전용 유지.
- 검증: 합성 WS 입력으로 3대 수신·권한/기기/스트림 분리·시계·퇴장 정리, 모의 모델로 추론 수명/미검출·시각 출처 확인. 실제 폰·보정/3D 정확도는 미검증.
- 변경: `web/camera/room/pose.js`와 방 카메라 앱/화면, `web/shared/room-link.js`, `backend/ingest/room_pose.py`·rooms/auth. 별도 카메라를 열지 않고 기존 video를 추론하며 영상 전송은 모델 로딩을 기다리지 않는다. 등록/시계 제어와 최신 관절 프레임의 송신 버퍼 제한을 구분한다.
- 계약: room.v1 pose 봉투로 camera_hello/ack·clock_ping/pong·pose_2d·pose_received/error 전달. 공개 권한은 방 1 카메라의 소유 슬롯으로 제한하고 기존 `/ws/pose` 보호는 유지한다. 기존 폰 기기 ID와 보정 ID/영상 설정 검증을 재사용한다. 촬영 시각 미상은 3D 유효 입력으로 꾸미지 않는다.
- 실행 / 결과: `.venv\Scripts\python.exe -X utf8 -m pytest tests/ -q -p no:cacheprovider --tb=short` →117 passed, 기존 Starlette/httpx 경고1개. `node --experimental-vm-modules --test tests/test_room_pose.mjs tests/test_camera_lifecycle.mjs tests/test_server_clock.mjs tests/test_video_timeline.mjs tests/test_synchronized_video.mjs` →17 passed. Edge room-game5 passed(35.5초), 별도18884 서버에서 rooms의 권한대기취소/영상·관절수신2 passed(1.7분). 후자는 합성 canvas·모의 추론이며 실제 WS 수신을 확인했다. 테스트 서버 종료 대기가 지연되어 이번에 띄운 PID만 종료했고 기존 서버는 유지했다. 임시 설정 파일은 제거됐다.
- 문서: README·ROOMS·DATA_CONTRACT·ARCHITECTURE·SETUP과 계획 현재 범위를 갱신. JSON6개·Markdown49개·로컬 링크 검사 통과. 기능 확인과 실기기/공통 Phase 통과는 구분하고 체크박스는 유지한다. Git 명령·커밋·push는 수행하지 않았다.
- 남은 일 / 다음 행동: 서버 재시작 후 폰 새로고침·방 1 각 C0/C1/C2 입장 → 파란/주황 손목 점·좌표·서버 수신 프레임 증가 확인. 촬영 시각 출처와 관절 수신/영상 병행 지연을 측정하고 실측 보정·3D·소비자 연결을 검증한다. 방 2 PC 추론과 게임 타격/점수는 후속이다.

### 2026-11-04 20:56 KST — 시작 후 큰 카메라 화면·상단 시간/점수

- 담당 / Phase: 정경호, 현재 추가 구현 범위의 방별 video_check 시작→60초→결과 UI. P4 실제게임·점수 완료로 판정하지 않는다.
- 목표: 시작 ACK 후 C0 기본 큰 화면과 카메라 선택, 상단 시간·점수 표시, 종료/통신 종료 시 일반 화면 복귀. 실제 점수 null은 —로 표시한다.
- 검증 계획: Edge 모의 UI로 승인 전후·시간·점수 미연결·3대 선택·축소/복귀·60초 결과 확인. WS/점수 계약은 유지한다.
- 상태 / 결과: 로컬 UI 완료. 시작 ACK 후 브라우저 창을 채우는 C0 기본 영상과 상단 남은 시간·점수를 표시한다. 방 1은 C0/C1/C2 선택, 방 2는 C0를 제공한다. 기존 video/스트림은 유지하며 카메라 이탈 시 남은 영상으로 전환한다. Esc/축소는 타이머를 멈추지 않고 같은 세션 상태 조회가 축소 선택을 덮어쓰지 않는다. 종료 시 결과·카메라 테스트로 복귀한다.
- 바꾼 파일: `web/monitor/app.js`, `web/monitor/room/index.html`, `web/shared/styles.css`, `tests/browser/room-game.spec.js`, README·ROOMS와 본인 진행/현황. 백엔드·폰 추론·WS 계약은 변경하지 않았다.
- 실행 / 결과: `node --check web/monitor/app.js` 통과. `node_modules\.bin\playwright.cmd test -c playwright.room-game.config.js --reporter=line` → Edge7 passed(46.3초). 숫자 점수 결과 반영 보완 후 `--grep "ACK opens"` → 대상2개 passed(12.0초). JSON6/Markdown49·로컬 링크 검사 통과.
- 입력·장비 범위: Windows Edge, 모의 WS/영상 속성. 1440×1000·390×844에서 화면 경계·가로 넘침·선택/영상 노드 유지와 확대/축소·카메라 이탈·종료 복귀 확인. 캡처는 test-results/room-game 아래에 있으며 영상 자체는 모의이므로 검은 영역이다. 테스트의12점은 모의 수신값이며 실제 득점 검증이 아니다. 실제 score=null은 —/타격 연결 전으로 표시한다.
- 남은 일 / 다음 행동: PC 새로고침 후 실제 폰 영상으로 시작·큰 화면·시간·카메라 선택·종료 복귀 확인. 실제 손목/3D·점수·게임 통합 기준은 유지하고 공통 Phase/체크리스트는 변경하지 않았다. Git 명령·커밋·push 없음. 종료 시각20:56 KST.

### 2026-11-04 21:17 KST — 수동 중지·카메라 끊김 자동 중지

- 담당 / Phase: 정경호, 현재 video_check 세션 제어. 사용자 확인으로 카메라 끊김 후 계속 진행은 오류이며 자동 중지로 변경한다.
- 연결할 계획 항목: 개인 계획 P4 만료/세션 처리 및 현재 추가 구현 범위의 시작→결과→카메라 테스트. 실제게임 Phase 통과는 별도다.
- 목표: 확대/일반 화면 중지 버튼, 서버 세션 종료·경과시간 고정·종료 사유, 필수 카메라 연결 끊김/영상1.5초 중단 시 자동 종료. 화면에서 숨긴 영상의 정상 수신을 중단으로 오인하지 않는다.
- 검증 계획: 합성 서버 세션/WS로 수동·끊김·멱등·오래된 요청/권한 검사, 모의 UI로 중지/결과·끊김·영상중단·정상 숨김 영상 확인.
- 상태 / 결과: 로컬 구현·자동 검사 완료. 확대/일반 화면 중지 버튼은 서버 응답 후 종료하며 중복 클릭을 막는다. 서버는 현재 방·세션 ID·PC 역할을 검사하고 종료 시각/사유를 고정한다. 필수 카메라 제거 시 서버가 해당 방을 종료하며 재입장해도 자동 재개하지 않는다. PC는 필수 영상1.5초 중단도 감지해 자동 중지를 요청한다.
- 바꾼 파일 / 계약: `backend/game_sessions.py`, `backend/rooms.py`, `web/monitor/app.js`·방HTML·공유CSS, `web/shared/room-link.js`·relay/synchronized-video.js, 관련 Python/JS/Edge 테스트. room.v1 stop_game(session_id/reason), game_status/room_status 종료, error.request_type 확장. reason은 manual_stop/camera_stalled/camera_disconnected/time_up. 계획 현재 범위·README·ROOMS·단일 인터페이스의 끊김 기준을 함께 갱신했다. 후속 소비자는 종료 사유·고정 경과시간을 참조한다.
- 프레임 검사: 큰 화면에서 숨겨진 WebRTC 영상도 수신 통계로 진행을 확인한다. 중계는 실제 디코딩/그리기 완료를 사용한다. 폰 원본이 멈추면 새 시각만 덧씌운 프레임을 반복하지 않는다. PC 숨김 탭의 렌더 중단과 실제 카메라 종료를 구분한다.
- 실행 / 결과: `.venv\Scripts\python.exe -X utf8 -m pytest tests/ -q -p no:cacheprovider --tb=short` →124 passed(3.83초), 기존 Starlette/httpx 경고1개. Edge `node_modules\.bin\playwright.cmd test -c playwright.room-game.config.js --reporter=line` →9 passed(57.8초). 최초 UI 검사에서 영상 노드 생성 전에 모의 준비 속성을 설정하던 테스트 대기를 수정한 뒤 통과했다. JSON6/Markdown49·로컬 링크 검사 통과.
- JS 최종 검사: `node --experimental-vm-modules --test tests/test_room_link.mjs tests/test_room_pose.mjs tests/test_camera_lifecycle.mjs tests/test_server_clock.mjs tests/test_video_timeline.mjs tests/test_synchronized_video.mjs` →19 passed. 기존 VM Modules 실험 기능 경고가 있다. 종료21:18 KST.
- 입력·검증 범위: 합성 WS/세션, 모의 추론·영상·RTP통계/Edge UI. 수동 중지 ACK/중복, 방1 세슬롯·방2 C0 연결 종료, 영상 시각 정지, 재연결 후 미재개, 새 세션 재시작, 숨김 영상 오인 방지·데스크톱/모바일 중지 버튼 확인. 실제 폰·망 장애/RTC 복구·지연은 미검증이다.
- 남은 일 / 다음 행동: 서버 재시작·PC/폰 새로고침 후 실제 폰 중지/카메라 종료·영상 중단에서 결과 사유와 시간이 고정되는지 확인한다. 실제 손목·3D·점수·Phase 기준은 유지하고 체크박스는 변경하지 않는다. Git 명령·커밋·push 없음.

### 2026-11-04 21:22 KST — 중지 후 영상 재연결 보완

- 담당/범위: 정경호, 기존 video_check 연결 복구. WebRTC 일시 단절로 비운 영상에 connected 복구 시 같은 스트림을 다시 연결한다. 테스트 복귀 시 영상 준비가 부족하면 PC 방 연결을 재설정한다. stop_game 오류는 영상 연결 종료로 처리하지 않는다.
- 변경: web/shared/room-link.js, web/monitor/app.js, tests/test_room_link.mjs. 실제 사용자의 재현 원인이 이것인지 실기기 확인은 남아 있다.
- 검증: node --experimental-vm-modules --test tests/test_room_link.mjs →3 passed. Edge room-game의 manual stop 대상 →1 passed(12.3초), 모의 영상/WS. 중지→결과→테스트→새 세션 확인. Git 명령 없음.
- 다음: PC 새로고침 후 동일 현상 재현 확인. 폰이 실제로 퇴장한 경우에는 폰에서 재입장 필요. 3D/점수·공통 Phase 상태 변경 없음.

### 2026-11-04 — unsupported_message 중지 오류·연결 보존

- 사용자 실제 오류: 중지 후 서버 오류 unsupported_message. 실행 중 구서버가 새 stop_game을 거부하는 경우를 재현했다. 실제 서버 프로세스 버전은 직접 확인하지 않았다.
- 수정: 구서버의 request_type 없는 중지 거부도 세션 오류로 처리해 영상 연결을 유지하고 서버 재시작 안내를 표시한다. 미지원 중지 자동 반복도 차단한다. 세션 상태 갱신 때 기존 카메라 DOM을 매번 이동시키지 않도록 보완해 재생 중단 가능성을 줄였다.
- 검증: tests/test_room_link.mjs 4 passed, 구서버 거부 후 소켓 유지 포함. 모의 UI 중지/확대 회귀 확인 진행. 실제 폰 재현 확인·서버 재시작 필요. Git 명령 없음.
- 종료 검증: Edge 모의 UI 확대/수동 중지3 passed(17.0초), JSON6/Markdown49·로컬 링크 검사 통과. 사용자 서버를 직접 중단하거나 재시작하지 않았다. 다음 단계는 실행 중 서버 종료 후 로컬 실행파일로 재시작·PC/폰 새로고침이다.

### 2026-11-04 — PC 카메라 영상의 손목 점 표시

- 담당/계획: 정경호, 방 1 영상·관절 연결 지원. 폰의 기존 손목 추론 결과를 송신 canvas에 비율대로 그려 PC의 세 화면/확대 화면에서 확인한다. 별도 3D/게임 완료 판정은 변경하지 않는다.
- 변경: web/camera/room/pose.js의 drawOn, 방 앱의 영상 그리기 연결, web/shared/room-link.js·video-clock.js의 송신 합성 훅, 캐시 버전. 기존 추론을 재사용하며 전송을 기다리게 하지 않는다. 200ms 초과·미검출·영상 크기 변경·추론 종료 시 점 제거. 방 2는 영상 전용.
- 검증: node --experimental-vm-modules --test tests/test_room_pose.mjs tests/test_room_link.mjs tests/test_server_clock.mjs tests/test_synchronized_video.mjs →13 passed. 모의 추론/캔버스로 축소 좌표·오래된 점·추론 추가 실행 없음·영상/점/시각 그리기 순서 확인. 실제 폰 지연·WebRTC/중계 인코딩 성능은 미측정.
- 다음: PC·폰 새로고침 후 방 1에서 손목 점이 함께 전송되는지 확인하고 표시 전후 실제 망 지연/FPS 비교. ROOM 계약 갱신, Git 명령/커밋/push 없음.

### 2026-11-04 — PC 손목 점 누락 후 수신 영상 픽셀 검증

- 사용자 보고: PC 영상에 점이 보이지 않음. 송신 video-clock.js의 미버전 import로 이전 모듈이 캐시에 남을 수 있어 카메라 HTML/app/room-link/video-clock 연결에 새 버전을 적용했다. 사용자 기기 캐시가 직접 원인이었는지는 미확인이다.
- 검증: 별도18886 테스트 서버·Edge에서 모의 손목 추론/합성 영상 → 실제 JPEG 중계 → PC video를 canvas로 읽어 (120,80)의 파란 손목 점 픽셀 확인, 1 passed(25.8초). 테스트 서버 종료 대기 중 이번에 생성한 PID33152만 종료했고 임시 설정은 제거됐다. WebRTC/실제 폰 지연은 미검증.
- 회귀: room_pose/room_link/server_clock JS12 passed, JSON6/Markdown49·로컬 링크 통과. 변경은 송신 모듈 캐시 버전·수신 픽셀 테스트이며 Git 명령 없음.
- 다음: 방1 폰을 퇴장→새로고침→재입장하고 PC 새로고침 후 확인. 폰 자체 인식 실패/구서버 pose 미지원은 별도 확인 필요.

### 2026-11-04 — 얼굴 제외 전신22개 2D 관절 확장

- 담당/범위: 정경호, 방1 영상·관절 송수신 확장. 같은 MediaPipe 결과의11~32번을 추출해 폰/PC에 전신 점과 연결선 표시. 얼굴0~10번은 표시·송신하지 않는다. 추가 추론 없이 기존15Hz·송신 오버레이200ms 수명 유지. 손목만의3D 파이프라인은 보존한다.
- 변경: web/camera/body.js(추출/연결선), room/pose.js·app·HTML, backend/ingest/schemas.py의 선택 body 검증/보관, auth의 정확한 공개 모듈 추가. body22개 키/픽셀/가시성/null을 검증하고 기존 joints 손목 입력과 이전 body 없는 메시지를 유지한다. ROOM/DATA 계약·README 갱신. 전신3D/게임 연결은 구현하지 않았다.
- 검증: 전체 Python128 passed(3.39초), 관련 JS15 passed. 마지막 WS3대 수신/전신 보관·검증 보강 후 Python 대상12 passed(0.89초), body/추론JS6 passed. 실제18887 서버/Edge·합성영상/모의추론으로 PC 수신 JPEG의 손목 점과 팔 연결선 픽셀 확인1 passed(50.3초). 종료 대기 중 테스트 PID35252만 종료, 임시설정 제거. JSON6/Markdown49·링크 통과. 실제 폰 정확도·전후 지연/FPS는 미측정.
- 다음: 서버 재시작(새 공개 모듈/서버 검증 반영)·PC/폰 새로고침 후 방1 재입장. 전신 점/연결선과 관절 개수 확인. 실측 보정·손목3D·타격/점수·공통Phase 완료 기준은 유지한다. Git 명령/커밋/push 없음.

### 2026-11-04 21:56 KST — 전신22개+머리 대표점1개 확정

- 담당/범위: 정경호, 기존 방1 2D 관절 송신/시각화 확장. 최신 사용자 지시에 맞춰 얼굴 세부 좌표·표정은 보내지 않고 머리 대표 위치1개만 표시·송신한다. 기존 body22개·joints 손목·손목3D 계약은 유지한다.
- 구현: web/camera/body.js의 extractHead는 귀 중점→눈 중점→코 근사 위치 순으로 유효한 머리 대표점을 추정한다. 상세 얼굴 점은 내부 추정에만 사용하고 송신 payload에는 head {u_px,v_px,visibility}/null만 추가한다. 폰/PC에는 노란 점 하나만 표시한다. 추가 추론 없이 기존 결과 재사용, 200ms 만료/해상도 불일치·종료 후 제거 유지.
- 서버/계약: backend/ingest/schemas.py의 선택 head 검증·최신 Pose2D.head 보관. 기존 head 없는 입력도 호환한다. 얼굴 세부 face 필드/표시/관련 중간 구현은 최종 산출물에서 제거했다. 원본 픽셀/가시성·정확한3키 검증, body/손목과 분리. README·ROOMS·DATA_CONTRACT·카메라 안내·캐시 버전 갱신.
- 검증: 전체 Python131 passed(3.38초), 관련 JS16 passed. 모의 WS로3대 head/body 보관, 귀 중점·코 대체·미검출·좌표 축소·부적절한 수/키와 송신에 face 없음 확인. Edge/별도18889 서버의 합성 영상·모의 추론으로 실제 PC 수신 JPEG의 머리 노란 점·손목 점·연결선 픽셀 확인1 passed(33.6초). 종료 대기 중 이번 테스트 PID39640만 종료하고 임시 설정 제거. JSON6/Markdown49·링크 통과.
- 남은 일/다음: 서버 재시작·PC/폰 새로고침 후 방1 재입장, 머리 대표점·전신 확인. 머리 대표점은 정밀 머리 중심/표정/회전/머리3D가 아니며 실제 정확도·추가 지연/FPS는 미측정이다. 기존 실기기/3D·게임 완료 기준과 체크박스 유지, Git 명령·커밋·push 없음.

### 2026-11-04 — 삼각기둥 마커 보정 계산 도구

- 담당/계획: 정경호 P2/P3 실측 보정 K/dist·R/t 계산. 사용자 방향은 기존 QR을 붙인 삼각기둥 기준물이며 실제 모양·치수는 미정이다. 가이드 정렬만으로 보정을 완료 처리하지 않고 알려진3D/원본2D 모서리 대응으로 계산한다.
- 변경: backend/calibration/solve.py, tools/calibrate_camera.py, tests/test_marker_calibration.py, docs/MARKER_CALIBRATION.md, calib/README.md. 입력식 정삼각기둥 좌표 생성·렌즈 보정·마커 PnP·기존 Calibration 저장 형식 연결. CLI는 새 파일만 작성하며 설정·실측 보정 파일을 자동 적용/덮어쓰지 않는다. 실제 치수나 보정값은 생성하지 않았다.
- 품질/계약: room_z_up/m·원본 영상 설정·기기ID·보정ID 유지. 큰 재투영 오차·카메라 뒤쪽 해·모호한 평면 자세 거부. source 명시·합성→실측 승격 금지. 합성 마커→복원 R/t→기존 DLT3D 경로와 렌즈 보정 재현 검증. 실제3대·마커 자동검출·화면 가이드/선택 UI는 아직 없다.
- 사용자 후속: 제작 전이므로 계산이 쉬운 기준물 구조/마커 구성을 추천하는 단계. 실물 치수·기준면 배치 확정 후 데이터 확보가 다음이다. 기존 촬영 시각 unknown·손목3D 제한은 유지하고 Phase 체크박스는 변경하지 않는다. Git 명령/커밋/push 없음.
