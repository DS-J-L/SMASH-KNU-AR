# 단일 카메라 인터페이스·상태 설계 v0.2

2026-11-06 KST 갱신. [실행 계획](SINGLE_CAMERA_PLAN.md)의 v0.2 설계와 main의 PC 소비자 규격을 보존하고, 현재 로컬 `phone_2d` 연결을 구분한다. 실제 방·영상·제어는 [ROOMS.md](ROOMS.md), 폰 좌표 게임 연결은 [PHONE_POSE_GAME.md](PHONE_POSE_GAME.md)를 따른다. 아래 `single_camera.v1-draft`는 PC 내부 DTO/기존 ControlLink 초안이며 room.v1·서버0.1과 자동 호환되지 않는다. `/ws/single/control`과 POST 방 생성은 현재 서버에 구현하지 않았다.

## 현재 로컬 구현과 기존 설계의 관계

- main의 `/monitor/single/`과 PC 추론용 PoseAdapter/Tracking 모듈은 보존한다. 현재 실행 가능한 추가 진입점은 `/monitor/phone-game/?room=room-1` 또는 `room-2`이며 폰 추론 결과를 사용한다.
- room-1은 C0/C1/C2 모두, room-2는 C0 한 대가 시작 필수다. 이 화면의 타격 입력은 각 방 C0이며 서버 JPEG와 같은 스냅샷의 손목을 짝지어 전달한다. PC 재추론은 하지 않는다.
- `RoomInputLink`가 room.v1 시작/ACK·상태/점수를 기존 GameController에 연결한다. PC가 2D 기하 타격을 판정하고 서버는 방·세션·스트림·최근 프레임/이벤트를 검사해 점수를 보관한다. 서버 영구 로그·전체 로그 ACK/재전송은 미구현이다.
- 아래 PC 추론·별도 제어 채널 내용은 원래 경로의 설계/모듈 계약으로 읽는다. 현재 어댑터 경로의 실제 전송·중단 정책이 우선한다. 합성 통합 통과와 실폰·실제 MediaPipe·3D 검증은 구분한다.

## 1. 책임과 구현 경계

| 경계 | 생산자 → 소비자 | 인계할 결과 | 주 담당 / 검토 |
| --- | --- | --- | --- |
| 카메라 → 영상 | 김태이 폰 송신 → 이동수 PC 수신 | 선택 렌즈·실제 track 설정, stream_id, 종료/교체 알림 | 김태이 / 이동수 |
| 연결·세션 | 정경호 서버 → 폰/PC | 방 소유권, SDP/ICE, 스트림 등록, 세션 ACK·상태 | 정경호 / 김태이·이동수 |
| 프레임 → 추론 | 이동수 FrameCoordinator → 김태이 PoseAdapter | FrameInput 및 폐기/자원 반환 규칙 | 이동수 / 김태이 |
| 추론 → 화면/타격 | 김태이 PoseAdapter → 이동수 표시·김태이 판정 | PoseFrame, 무효 사유, 원본 크기와 프레임 키 | 김태이 / 이동수 |
| 건물 → 판정 | 이동수 TargetProvider → 김태이 판정 | 원본 영상 좌표로 환산한 타격 영역·버전 | 이동수 / 김태이 |
| 타격 → 게임/로그 | 김태이 HitDetector → 이동수 GameController → 정경호 로그 | HitEvent, 수락/거부 사유, 점수·종료·리셋 | 각 경계 담당 / 상대 담당 |

카메라 1대·플레이어 1명·IT1 1개·양손 손목만 MVP다. 자동 인물 식별, 여러 사람 교대 인식, 몸 전체와 파편의 지속 충돌은 후속 범위다. 여러 사람이 들어오면 시험을 멈추고 1명 조건을 다시 맞춘다.

## 2. 세션과 상태

단일 모드의 session_id는 **PC GameController가 UUID로 생성**하는 기준안으로 구체화한다. room_id는 연결 방, stream_id는 카메라 송출, session_id는 60초 게임 1회로 서로 다른 수명이다. 기존 서버 추적 런타임 ID와 같은 값으로 가정하지 않는다. server_epoch는 서버 재시작마다 바뀌며 로컬 run_id는 중지·복원·모드/스트림/표시 변환 변경 때 증가한다.

1. 고정 방의 PC 페이지에서 폰의 고정 QR 링크를 제공하고 카메라1대를 연결한다. 서버는 PC/폰 역할과 stream_id 바인딩을 확인한다.
2. 영상·모델·유효 손목·변환·장면·제어 연결이 준비되면 시작 버튼이 활성화된다.
3. PC가 새 session_id와 모드/입력 출처/설정 버전을 시작 요청으로 보낸다. 서버 ACK 전에는 타이머·타격·점수를 시작하지 않는다. 같은 ID·같은 내용 재전송은 같은 ACK, 같은 ID·다른 내용은 충돌로 거부한다.
4. ACK 수신 후 PC 단조 시계로 60초를 잰다. 원래 PC 소비자는 타격/게임의 주체다. 현재 phone_2d에서는 서버도 세션 타이머·종료·점수를 보관하고 PC가 서버 남은 시간/점수에 맞춘다. 서버는 수락 이벤트의 바인딩·중복·100점 단위를 검사하지만 기하 타격을 재계산하지 않는다.
5. 게임 상태는 idle → ready → starting → playing → ended다. reset은 점수·물리·이벤트·궤적을 비우고 idle로 간다. 카메라는 계속 켜둘 수 있으며 다음 시작에 새 session_id를 쓴다. 모드 변경은 진행 중 게임을 종료한 뒤 수행한다.

연결 상태(disconnected/connecting/live/stalled/failed), 추적 상태(loading/valid/invalid/stale), 장면 상태는 게임 상태와 분리한다. playing 중 손목 미검출/추적 무효·제어 단절은 타격을 차단하는 기준안이다. 카메라 연결 종료·필수 영상 중단은 사용자 최신 지시로 자동 중지하며 현재 video_check의 수동/자동 중지 규칙은 [ROOMS.md](ROOMS.md)를 따른다. 손목 미검출만으로 카메라 연결 종료를 판정하지 않는다. 장비 장애 회차도 지우지 않고 종료·무효 사유를 기록한다. 탭이 숨겨지거나 렌더 루프가 멈춘 동안 입력은 거부한다.

단일 모드 준비 식:

~~~text
single_ready = control_bound && control_alive && selected_stream_live && fresh_frame
               && model_ready && fresh_valid_wrist && transform_ready && scene_ready
accept_hit = playing && remaining_ms > 0 && visible_page && single_ready
             && matching_session_stream_run_transform && continuous_valid_points
~~~

fresh_valid_wrist는 적어도 한 손목이 유효한 조건이다. 판정은 손목별로 따로 유효성을 검사한다. 종료 시각 이상 이벤트는 거부한다. 독립 단일 PC 경로의 기본식은 C1/C2·다중 보정을 요구하지 않는다. 현재 phone_2d 어댑터는 방1에서 C0/C1/C2, 방2에서 C0의 최근 영상 조건을 추가한다. 이는 3D 준비 판정이 아니다. multiview_3d의 최소 유효 시점·시간/보정 기준은 유지한다. 시작 타임아웃은 starting을 해제하고 늦은 ACK가 중복 시작을 만들지 않게 한다.

제어 WebSocket 단절 또는 heartbeat 만료 시 영상이 남아도 타격을 차단한다. 재접속/복구는 경로별로 구분한다. 기본 video_check는 서버 상태/남은 시간을 조회할 수 있으나 현재 phone_2d 게임 화면은 연결 단절 시 로컬 회차를 중단하고 복원·명시적 재시작을 요구한다. 자동 게임 재개·다른 방 이동을 하지 않는다. 서버 재시작·알 수 없는 세션도 새로 시작한다.

## 3. 제안하는 서버 API

GET /api/single/rooms와 WS /ws/single/signaling은 현재 room.v1로 구현되어 있다. /ws/single/control은 미구현 제안이고 single_camera.v1-draft는 구현된 PC 내부 DTO 및 별도 ControlLink 초안이다. 현재 phone_2d는 시작/ACK·상태 조회·game_hit도 signaling에서 처리하고 RoomInputLink가 PC 소비자에 연결한다. 기존 /ws/status·/ws/pose 계약과 자동 호환되지 않는다.

| 제안 경로 | 역할·핵심 동작 | 실패와 시험 |
| --- | --- | --- |
| GET /api/single/rooms | 현재 고정 방 조회. 단일용 room-2는 C0한대 | 카메라 공개입장·PC인증과 상세 메시지는 [ROOMS.md](ROOMS.md) 참조 |
| WS /ws/single/signaling | join, offer, answer, ice, leave 중계 | room/role/stream 확인, ICE는 remote description 설정 전 큐·중복 제거, 종료 시 폐기 |
| WS /ws/single/control | stream bind, status, start/ack, end, hit/log ack | 중복 start/event는 멱등 처리, 오래된 세션·모드/출처 혼입 거부 |

현재 카메라는 토큰 없이 공개 입장하며 PC 역할·관리 API는 기존 키/쿠키로 보호한다. 실제 공개 경로·역할 검증은 ROOMS.md를 따른다. 별도 참가 토큰 발급은 사용하지 않는다.

연결 종료 시 RTCPeerConnection·MediaStreamTrack·프레임 콜백·추론 작업을 정리한다. 재연결은 새 peer/stream 바인딩 ACK 뒤 시작하며, 예전 peer의 늦은 SDP/ICE/추론 결과는 무시한다. TURN은 필요성을 실제 시험망에서 확인한 뒤 정하며 유료 서비스 도입을 전제하지 않는다.

## 4. 프레임·시계·변환 계약

FrameInput의 키는 room_id/stream_id/run_id/frame_id/transform_version이다. frame_id는 새 디코딩 프레임에만 증가한다. width/height는 실제 추론 이미지 크기, media_time_s는 미디어 시각, observed_at_pc_ms는 PC가 새 프레임을 확보한 performance.now 계열 시각이다. 추론 시작/끝 시각을 별도로 남긴다. 폰의 노출 시각 또는 서버 UTC로 대신 쓰지 않는다. capture_time은 브라우저가 제공한 경우에만 값·출처를 기록하고 없으면 null이다.

위 문단은 기존 PC 수신/추론 경로의 프레임 정의다. 현재 phone_2d는 JPEG 전송 frame_id와 원래 관측의 pose_frame_id를 구분하고, PC PoseFrame에는 원래 관측 frame_id를 사용한다. 소유 스트림/짝 검증 후 관측 번호는 건너뛸 수 있으며 새로 만들어 섞지 않는다. PC observed_at_pc_ms는 짝지어진 표시 프레임 수신 시각이다.

- 대기열은 실행 중 1개 + 최신 대기 1개로 제한한다. 새 대기가 오면 이전 대기는 폐기하고 자원을 닫는다. 결과가 돌아와도 현재 키/버전과 다르거나 observed_at_pc_ms부터 만료 기준 이상이면 타격에 사용하지 않는다.
- 표시하는 배경 스냅샷과 손목 결과를 같은 frame_id로 묶는다. 결과가 없는 최신 영상에 과거 손목을 겹치지 않는다. 오래된 마지막 화면은 추적 끊김 표시와 함께 둘 수 있으나 타격은 차단한다. 영상 갱신률과 3D 렌더 갱신률은 별도로 측정한다.
- Worker 경로는 ImageBitmap 등의 소유권 이전·복제 비용·반환/close를 시제품으로 확인한다. 전송 후 같은 객체를 화면에서도 계속 쓸 수 있다고 가정하지 않는다. stop/reset 뒤 늦은 응답도 자원을 회수하고 결과는 버린다.
- Worker/OffscreenCanvas/GPU 지원 조합을 측정한 뒤 선택한다. 대체 경로는 제한 빈도 메인 스레드 추론 또는 CPU이며 렌더 성능도 함께 측정한다. 새 프레임 API 미지원 시 mediaTime 변화 확인 방식으로 대체하되 실제 호환성을 기록한다.

원본 영상 좌표는 좌상단 원점·x 오른쪽·y 아래·거울 미적용이다. PoseAdapter는 픽셀과 정규화 좌표를 연결한다. 영상의 회전·거울·비율·letterbox/crop은 이동수의 DisplayTransform 한 곳에서 관리하고 영상/손목/충돌 영역에 같은 변환을 적용한다. MVP 기본은 contain·crop 없음, 거울 표시는 옵션이다. 추론 자체에는 표시용 거울 변환을 넣지 않는다.

TargetProvider는 현재 가상 카메라의 IT1 정상 건물 표면을 화면에 투영한 뒤 역변환해 image_norm 영역(폴리곤/삼각형 집합)을 제공한다. 전체 바운딩 박스만으로 빈 공간을 타격 처리하지 않는다. 건물/카메라는 playing 동안 고정하고 변경이 필요하면 준비 상태에서 수행한다. 창 크기·방향·track 크기 변경은 transform_version/run_id를 갱신하고 궤적을 비운 뒤 첫 유효 점부터 다시 모은다. 타격 목표는 파편이 아닌 정상 건물이며 파괴 후 비활성화, 복원 시 재등록한다.

## 5. PoseFrame·HitEvent 필드

공통 헤더: schema, room_id, stream_id, session_id, run_id, frame_id, transform_version, tracking_mode, task_type, source. session_id는 준비 화면의 PoseFrame에서만 null 허용, 게임 HitEvent에서는 현재 ACK된 값이 필수다. task_type은 기존 지정/자유 과제 키와 매핑을 정하고 파일럿은 pilot로 분리한다. source는 live/synthetic/replay 중 세션 시작 시 고정한다. keyboard_demo는 기존 데모의 tracking_mode이며 단일 live 입력으로 바꾸어 기록하지 않는다.

| 데이터 | 필드·단위 | 무효/거부 규칙 |
| --- | --- | --- |
| PoseFrame | image_width/height, observed_at_pc_ms, media_time_s(경로가 제공할 때), wrists.left_wrist/right_wrist: valid, image_norm[x,y], visibility, reason | 미검출/낮은 신뢰도/범위 밖/비유한 값은 해당 손목 valid=false, image_norm=null |
| HitEvent | event_id, building_id, joint, frame_id, previous_frame_id, hit_point_image_norm[x,y], speed_norm_per_s | 이전/현재 점이 연속 유효하고 같은 키 계열이며 시간 증가·만료 이내여야 함 |
| 2D 물리 구분 | hit_point_m=null, speed_mps=null, effect_point_scene_m는 선택 | 연출 좌표는 가상 장면 좌표임을 표시. pose_3d valid로 변환 금지 |
| 결과 로그 | accepted, reject_reason, score_delta, game_elapsed_ms, config_version, model_version | 중복/다른 세션/종료 후/이미 파괴/잘못된 단위는 거부 사유 보존 |

speed_norm_per_s = hypot(dx_pixels, dy_pixels) / hypot(width, height) / dt_seconds. 화면 크기나 거울 표시로 속도 단위가 바뀌지 않는다. 3D 이벤트는 기존 계약의 유효 m 좌표·m/s를 요구하며, 두 모드는 분기된 검증기로 검사한다.

HitDetector는 손목별 직전 유효 점과 현재 점 사이 선분을 검사한다. 양 끝이 건물 밖이어도 선분이 통과하면 후보가 된다. 정지 겹침은 타격하지 않는다. 최소 움직임/속도·재진입 조건과 cooldown을 별도로 튜닝하고 임계값/설정 버전을 기록한다. 단순 큰 이동량만으로 빠른 정상 타격을 제거하지 않는다. 가림/만료/버전 변경 후 첫 점은 기준점만 저장한다. 유효 후보라도 GameController가 session/시간/event/building 중복을 마지막으로 확인한 뒤 한 번만 점수·파편·소리를 실행한다.

예제는 형식 설명용 합성 데이터다. sample_only는 문서 예제 표식이며 실행 DTO 필드 채택 여부와 분리한다. UUID 값도 예시다.

~~~json
{
  "schema": "single_camera.v1-draft",
  "sample_only": true,
  "type": "hit",
  "room_id": "room-example",
  "stream_id": "stream-example",
  "session_id": "d11c4050-21f5-4b82-900f-ff55d6a263c1",
  "run_id": 3,
  "frame_id": 42,
  "previous_frame_id": 41,
  "transform_version": 2,
  "tracking_mode": "single_view_2d",
  "task_type": "pilot",
  "source": "synthetic",
  "event_id": "9f727ac7-506a-46ec-8245-bd4e8e31b0fb",
  "building_id": "knu-it1-v3",
  "joint": "left_wrist",
  "hit_point_image_norm": [0.42, 0.51],
  "speed_norm_per_s": 1.2,
  "hit_point_m": null,
  "speed_mps": null,
  "effect_point_scene_m": [0.0, 1.0, 0.0]
}
~~~

## 6. 로그와 인계

정경호는 연결/세션/입력 무효/타격 수락·거부/종료를 구분한 로그 형식과 예제를 제공한다. 이동수는 PC 프레임 관측·추론·게임 반영 시각을 측정하고 김태이는 판정 사유를 제공한다. 서로 다른 기기의 단조 시각을 직접 빼지 않는다. PC 내부 구간 지연과 외부 촬영으로 측정한 전체 동작 지연은 다른 지표다.

기본은 원본 영상 저장 없이 이벤트·설정·기기·성능 요약을 남긴다. 재생 자료가 필요하면 허용된 시험 자료로 별도 준비하고 영상/토큰을 PR에 포함하지 않는다. 로그 전송 실패 시 PC는 개수 제한 임시 버퍼와 dropped_log_count를 사용하며 로그 ACK 재전송으로 점수를 다시 반영하지 않는다. 로그 수신 실패 자체와 제어 연결 상실을 별도 상태로 표시한다.

인계 PR에는 송신/수신 예제, 성공/거부 예제, 실행 명령, source, commit·모델/설정 버전, [검증표](SINGLE_CAMERA_TEST_PLAN.md)의 관련 시험 ID와 실제 결과를 적는다. 구현하지 않은 경로는 빈 성공 화면 대신 미구현·시작 불가 사유를 표시한다.

## 7. PC 소비자 구현 연결 (2026-11-03)

[PC 실행·인계 문서](SINGLE_CAMERA_MONITOR.md)의 VideoReceiver/ControlLink·프레임/게임 API 구현 이력이다. 별도 ControlLink가 요구하는 POST 방 생성·control API는 현재도 제안이며 404를 성공으로 취급하지 않는다. 현재 room.v1 어댑터와 구분한다. 손목 키는 wrists.left_wrist/right_wrist다. Worker 입력은 빌린 스냅샷이며 원본 소유권 이전을 금지하고 필요 시 복제한다.

PC 클라이언트의 1초 ping/3초 heartbeat·7.5초 제어 요청/8초 게임 시작 타임아웃은 현재 시험 설정이다. 실제 서버와 연결할 때 설정/프로토콜을 함께 검토한다. TTL200ms·가시성0.5·60초는 현재 PC 모듈 기준이며 실제 성능 달성 수치가 아니다. 로그의 서버 보존/ACK 재전송과 실제 물리/소리는 후속 인계에서 확인한다.
