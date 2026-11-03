# 이동수 단일 카메라 PC 화면 구현·인계

2026-11-03 KST. L-SC-01 → 02 → 03 → 04 → 05 → 06 순서로 PC 모듈을 구현했다. **PC 모듈의 합성/브라우저 피어 검증과 실제 폰 플레이 완료는 다르다.** 폰 송신·PC PoseAdapter/HitDetector·방/신호/제어 서버는 각각 김태이·정경호의 후속 연결 대상이다. 해당 모듈을 이번 작업으로 완료 처리하지 않는다.

## 실행과 화면 시험

기존 프로젝트의 Python/Node 의존성을 설치한 환경에서 저장소 루트 기준:

~~~powershell
npm ci
npm run build:all
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8765
~~~

PC에서 http://127.0.0.1:8765/monitor/single/ 를 연다. 모니터 첫 화면에도 진입 링크를 추가했다.

1. 기본 '휴대폰 영상'은 실제 입력 경로다. 현재 main 기반 서버에는 /api/single/rooms가 없어 연결 안내를 표시하고 시작을 차단한다. 로컬 카메라 성공·서버 health만으로 준비 완료를 표시하지 않는다.
2. '합성 입력 시험'을 선택하면 시험 격자/양손 점과 IT1이 표시된다. 실제 카메라 영상이나 MediaPipe 결과가 아니다.
3. '시작' → '합성 타격 1회'로 96개 파편·100점·중복 차단을 확인한다. 이 버튼은 HitEvent 소비 시험이며 실제 손목 선분 판정을 구현/검증한 기능이 아니다.
4. '복원·새 게임'은 강체·파편·점수·이벤트·궤적을 초기화한다. 다음 시작은 새로운 게임 ID를 사용한다. 카메라 연결 자체와 게임 복원은 구분한다.
5. 준비 중 거울/회전을 변경할 수 있다. 진행 중에는 조작을 잠근다. 창 크기/실제 영상 크기가 바뀌면 실행/변환 버전을 올리고 이전 궤적과 늦은 응답을 버린다.
6. '시험 로그 저장'은 영상/토큰 없이 브라우저의 이벤트·설정·프레임 처리 요약을 JSON으로 받는다. 로컬 링 버퍼는 200건이며 초과 폐기 수를 기록한다. 서버 영구 저장/로그 ACK 재전송 완료를 뜻하지 않는다.

## 파일과 경계

| 작업 | 구현 | 독립 검증과 남은 인계 |
| --- | --- | --- |
| L-SC-01 | frontend/game/controller.js의 단일/키보드 세션·게임 정책, 아래 공개 API | 생산/소비 예제·단위/거부 시험. 상대 담당 실제 수신 검토 대기 |
| L-SC-02 | frontend/single/video-receiver.js·control-link.js | 실제 RTCPeerConnection 브라우저 피어 3회 수신/정리. 폰/실제 신호 서버는 미검증 |
| L-SC-03 | frame-coordinator.js·display-transform.js | 추론 1건+최신 대기1건·만료·일치 프레임·회전/거울/contain. 실제 K-SC-03 추론 연결 대기 |
| L-SC-04 | target-provider.js·fracture-view.js | 정상 메시 투영 삼각형의 합집합, 빈 공간/클립/비활성/복원. 실제 K-SC-04 선분 판정 인계 대기 |
| L-SC-05 | main.js·index.html·style.css, 공용 GameController와 fragment-bodies.js | ACK/60초·타격 수락/거부·점수/복원, 기존 키보드도 같은 공용 계층 사용. 실제 소리·추적/서버 연결 대기 |
| L-SC-06 | 실행 안내·모듈/브라우저 시험·화면 근거 | 합성 3회 복원·가상 시계60초3회. 실제 폰·실시간20분·실제 FPS/전체 지연 파일럿은 미검증 |

기존 frontend/fracture/main.js의 물리 body 생성식을 공용 fragment-bodies.js로 이동해 두 화면에서 재사용한다. 새로운 실제 힘/소리·손목 속도 추정기를 구현했다고 표시하지 않는다. 자산·모델·보정/3D 서버 기준은 변경하지 않았다.

## 김태이: PoseAdapter·HitDetector 연결

페이지의 window.singleCameraMonitor가 제공하는 API:

| API | 의미 |
| --- | --- |
| attachPoseProcessor(process) → detach | process(image, meta) → PoseFrame 또는 Promise. 등록/해제 때 이전 run 폐기 |
| onPoseFrame(listener) → unsubscribe | 현재 화면에 채택된 유효 키의 PoseFrame 수신. 판정 모듈에서 손목별 궤적 관리 |
| getContext() | 현재 room/stream/server_epoch/run/변환·session·source/task |
| getTarget() | IT1 정상 표면의 image_norm 삼각형 복사·활성 상태·변환 버전 |
| acceptHit(event) | 현재 세션·출처·프레임 쌍·준비/시각·단위·목표/중복 검사 후 {accepted,reject_reason,score_delta} |
| snapshot() | 읽기 전용 게임/영상/프레임·장면 요약. live 시작을 우회하는 함수는 제공하지 않음 |

process가 받는 image는 원본 프레임 스냅샷이며 호출자가 빌려준다. process Promise가 끝날 때까지 입력을 사용하고 **원본을 close하거나 Worker로 transfer하지 않는다.** Worker가 필요하면 복제본을 만들어 자기 쪽에서 관리한다. stop/해제 시 Worker 종료와 Promise 정리는 추론 어댑터 책임이다. PC 코디네이터는 실행 중1개+최신 대기1개+현재 표시1개만 보관하고 폐기 자원을 반환한다.

PoseFrame은 받은 meta를 그대로 보존하고 wrists.left_wrist/right_wrist를 추가한다. 각 손목은 {valid, image_norm:[x,y] 또는 null, visibility, reason}이다. 원본 크기·관측 시각·schema·session·출처·프레임/run/변환이 다른 응답은 거부한다. 실제 손목 추출은 기존 pose.js를 활용한 K-SC-03 어댑터에서 수행한다. 표시용 거울/회전은 추론 이미지에 적용하지 않는다.

~~~javascript
// 연결 형식 예시. poseAdapter/hitDetector는 김태이 모듈의 실제 구현을 주입한다.
const monitor = window.singleCameraMonitor;
const detach = monitor.attachPoseProcessor((image, meta) => poseAdapter.process(image, meta));
const unsubscribe = monitor.onPoseFrame(pose => {
  const target = monitor.getTarget();
  const event = hitDetector.update(pose, target);
  if (event) monitor.acceptHit(event);
});
// 모듈 종료 시 unsubscribe(); detach(); poseAdapter.dispose();
~~~

HitEvent는 SINGLE_CAMERA_INTERFACES의 2D 필드와 실제 frame_id/previous_frame_id를 사용한다. 시작/복원/무효/변환 후 첫 점은 연속 쌍이 없어 점수를 낼 수 없다. 연속 두 유효 손목·단조 시각/TTL을 PC에서 다시 확인하며 선분/최소속도·재무장·cooldown 계산 자체는 HitDetector 책임이다. 가상 충격점은 실제 월드 측정값으로 기록하지 않는다.

## 정경호: PC가 소비하는 신호·제어 초안

현재 서버 구현과 혼동하지 않도록 별도 single_camera.v1-draft를 사용한다. **아래는 PC 소비자 구현이며 신규 서버 API가 배포됐다는 뜻이 아니다.** 실제 통합 PR에서 양쪽이 합의한 형식으로 함께 갱신한다.

| 경계 | PC 요구 |
| --- | --- |
| POST /api/single/rooms | 요청 {role:pc,schema}. 응답 room_id·pc_token·server_epoch 필수, join_url·ice_servers 선택 |
| WS /ws/single/signaling·control | 소켓 open 후 join 메시지의 role=pc·room_id·token으로 인증 요청. URL 쿼리에 PC 토큰을 넣지 않음 |
| 수신 공통 | schema·room_id·server_epoch 필수. 다른 방은 무시, 같은 방의 다른 server_epoch는 세션 중단 |
| stream_bound | control로 stream_id를 승인한 뒤 PC가 수신 peer 생성, signaling으로 receiver_ready 전송. 두 소켓 도착 순서 역전 시 최대64개 임시 보관 |
| offer/answer/ice | 폰 offer를 PC가 수신해 answer 반환. 원격 설명 전 ICE 최대128개·중복 제거, 방/스트림 필터. 구 peer Promise는 새 연결을 막지 않음 |
| ping/pong | PC 1초 ping, 3초 미만 heartbeat만 유효한 현재 클라이언트 시험 설정. 실제 배포 설정은 서버와 합의·버전 고정 필요 |
| start/start_ack | PC가 request_id·session_id 생성. ACK는 두 ID·room/stream/epoch·mode/source/task/config를 그대로 확인. PC 8초/연결 요청7.5초 타임아웃, 늦은 ACK·복원 전 요청 거부 |
| end/log | end는 종료/복원 이유·session_id, log는 수락/거부·버전/PC 단조 시각. 서버 저장/중복 ACK·보존 정책은 J-SC-05에서 연결 |

참가 정보 만료·Origin·권한·역할 독점·배포 HTTPS는 서버 담당과 실제 장비 시험에서 검증한다. 기존 다중 모드의 game_ready·보정/최소2시점 기준을 변경하지 않는다. PC heartbeat 단절 시 P2P 영상이 남아도 타격을 차단하고 시간은 계속 흐른다. 서버 epoch/스트림 교체는 진행 회차를 종료하고 명시적 복원·새 시작이 필요하다.

## 검증 명령과 범위

~~~powershell
npm run test:single
npm run build:all
$env:AR_TEST_RENDERER='d3d11'
npx playwright test -c playwright.single.config.js --reporter=line
python -m pytest tests/test_server.py -q
node --experimental-vm-modules --test tests/test_camera_lifecycle.mjs
~~~

playwright.single.config.js는 독립 포트8875·새 서버를 사용해 다른 작업의 서버를 재사용하지 않는다. 기본 Playwright 설정으로도 새 시험을 실행할 수 있다. Windows 하드웨어 경로 대신 기본 소프트웨어 렌더러를 쓸 때는 AR_TEST_RENDERER를 설정하지 않는다. 새 브라우저 시험의 실제 RTC 영상은 canvas 합성 스트림으로 만든 브라우저 피어이며 실제 폰/카메라 실험이 아니다.

상세 결과·시각 근거는 [검증 요약](asset-validation/single-camera/summary.json), [준비 화면](asset-validation/single-camera/ready.png), [파편 화면](asset-validation/single-camera/fractured.png), [개인 기록](../AGENTS/이동수_progress.md)에 남긴다. T-SC 시험의 자동/합성으로 확인한 범위와 live 미검증은 아래 검증 요약에서 구분한다. 원래 실제 장비 파일럿과 실시간20분/60초3회 항목은 가상 시계 검사만으로 완료 처리하지 않는다.

## PR #5 검토 보완 — 2026-11-03

- 추론 어댑터 미등록 시에도 수신 영상의 같은 프레임을 표시한다. 손목은 valid=false/pose_adapter_missing이므로 시작·타격은 계속 차단한다. 영상만 표시한 상태를 추론 성공으로 기록하지 않는다.
- 폰 교체 시 새 스트림 offer/ICE가 control의 stream_bound보다 먼저 오면 제한 큐에 보관한다. 승인된 스트림으로 전환한 뒤 전달하고 이전 스트림의 지연 신호는 폐기한다.
- FrameInput 메타는 읽기 전용이다. 어댑터는 시각·프레임 키를 수정하지 말고 반환 객체에 복사한다. 콜백 중 reset/dispose가 발생해도 이전 프레임을 다시 보관하지 않는다.
- HitEvent는 허용된 손목 이름과 증가하는 정수 frame_id/previous_frame_id를 요구한다. 프로토타입 속성 이름이나 누락된 프레임은 거부한다.
- hit_result 로그에는 방/스트림·실행/변환·이전/현재 프레임·건물·손목을 남긴다. 서버 전달과 로컬 저장은 같은 PC 관측 시각·설정/모델 버전의 레코드를 쓴다.
- 시작 ACK 대기 중 복원/모드 변경도 pending session_id로 end를 보내고 제어 요청을 취소한다. 전송 전에 취소된 start는 보내지 않으며 늦은 ACK는 새 게임을 시작하지 못한다. pagehide도 진행/대기 세션 종료를 알린다. 서버는 starting 세션의 end도 멱등 취소로 처리해야 한다.
- pagehide에서 자원을 해제한 화면이 캐시로 복귀하면 새 문서를 로드해 다시 초기화한다. persisted 이벤트의 의미는 [MDN pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event)를 참조했다. 회귀 시험은 합성 PageTransitionEvent이며 실제 기기 캐시 성능 측정은 아니다.

[PR #5 검토·재현·최종 검증](asset-validation/single-camera/pr5-review.json)은 최초 구현의 summary.json과 별도로 보존한다. 최신 소스/빌드의 해시는 검토 보고서를 따른다. 실제 폰·망·추론/선분/서버 통합·실시간20분은 여전히 미검증이다.

영상만 표시한 프레임의 tracking_state=loading과 valid=false는 추론 결과가 아니다. 이 경로의 처리 시간은 실제 MediaPipe 추론 성능으로 보고하지 않는다.
