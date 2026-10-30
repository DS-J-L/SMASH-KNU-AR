# 데이터 계약 v0.2

팀이 따로 개발할 때 맞춰야 할 인터페이스입니다. 필드 정의는 정경호가 관리하고 송신·수신 담당이 함께 검토합니다. 모든 메시지는 JSON 텍스트, 시간 단위는 ms, 좌표 단위는 m입니다.

**v0.1에서 바뀐 점:** `/ws/ingest`(등록·시계 교환·`pose_2d` 수신), `/ws/pose3d`(`pose_3d` 전달), `/api/calibration`을 구현했습니다. `/ws/status`의 상태 값을 실제 입력 기준으로 바꿨습니다. 외부 접속용 접속 키(D07)를 추가했습니다. 아래 표의 **구현 상태**는 서버 쪽 기준입니다. 폰 송신(김태이)과 모니터 수신(이동수)은 각 담당이 연결합니다.

| 경로 | 방향 | 구현 상태 |
| --- | --- | --- |
| `/ws/status` | 서버 ↔ 모니터·카메라 페이지 | 구현. `scene_report` 송신은 모니터 미연결 |
| `/ws/ingest` | 휴대폰 ↔ 서버 | 서버 구현, 휴대폰 송신 미연결 |
| `/ws/pose3d` | 서버 → 렌더·물리 | 서버 구현, 소비자 미연결 |
| `GET /api/calibration` | 서버 → 렌더 | 구현. 실측 보정 파일은 아직 없음 |
| `hit_event` | 물리 → 게임·로그 | 미구현 (아래 ‘다음 구현’) |

## 접속 키 (D07)

서버를 `SMASH_ACCESS_KEY`와 함께 실행하면 모든 HTTP 요청과 WebSocket 연결에 키가 필요합니다. 처음 한 번 `https://<주소>:8443/monitor/?key=<키>`처럼 주소에 붙여 열면, 서버가 키의 해시를 담은 쿠키(HttpOnly, SameSite=Strict, HTTPS에서 Secure)를 줍니다. 같은 브라우저의 이후 요청과 WebSocket은 쿠키로 통과하므로 페이지 코드를 바꿀 필요가 없습니다. 쿠키를 쓰지 못하는 클라이언트는 WebSocket 주소에 `?key=<키>`를 붙입니다. 키가 없거나 틀리면 HTTP는 401, WebSocket은 연결이 거부됩니다. 키·실제 주소는 저장소에 기록하지 않습니다.

## `/ws/status` — 상태

연결 즉시 `system_status`를 한 번 보냅니다. 클라이언트가 `{"type":"get_status"}`를 보내면 다시 응답하고, 준비 상태·카메라 연결·보정·시계 준비 여부가 바뀌면 서버가 먼저 보냅니다. 그 외 메시지는 `error`(`invalid_json`, `unsupported_message`)로 알립니다.

```json
{
  "schema_version": "0.1",
  "type": "system_status",
  "stage": "development",
  "game_ready": false,
  "config_source": "example",
  "cameras": [
    {"camera_id": "C0", "status": "receiving",
     "calibration": {"status": "missing", "calibration_id": null},
     "device_id": "…", "stream_id": "…", "sample_only": false,
     "clock": {"ready": true, "offset_ms": 1834.2, "uncertainty_ms": 6.1},
     "tracking_input": "not_calibrated", "input_fps": 29.0, "last_frame_id": 812,
     "timestamp_source": "capture_metadata", "rejected": {"duplicate_frame": 1}},
    {"camera_id": "C1", "status": "disconnected", "calibration": {"status": "missing", "calibration_id": null}}
  ],
  "readiness": {"camera_input": false, "calibration": false, "tracking": false, "scene": false},
  "message": "관절 수신 1/3 · 실측 보정 0/3 · 3D 추적 대기 · 화면 대기 · 예시 설정 사용 중"
}
```

| 필드 | 의미 |
| --- | --- |
| `cameras[].status` | `disconnected`(미등록) / `registered`(등록, 관절 미수신) / `receiving`(최근 1초 안에 `pose_2d` 수신) / `stale`(수신이 끊김) |
| `cameras[].calibration.status` | `missing` / `invalid`(파일 검증 실패, `error` 포함) / `synthetic` / `measured`. 프레임과 맞지 않으면 `mismatch`에 이유 |
| `cameras[].clock` | 시계 교환 표본 3개 이상이면 `ready`. `uncertainty_ms`는 최소 RTT의 절반 |
| `cameras[].tracking_input` | 이 카메라가 3D에 쓰일 수 있으면 `ok`, 아니면 카메라 단위 제외 이유(아래 `pose_3d` 표) |
| `readiness.camera_input` | 설정된 모든 카메라가 `receiving`이고 샘플 입력이 아님 |
| `readiness.calibration` | 모든 카메라에 **실측(`measured`)** 보정이 있고 프레임과 일치. 합성 보정은 항상 false |
| `readiness.tracking` | 보정 조건을 만족하고, 최근 1초 안에 샘플이 아닌 입력으로 좌·우 손목이 모두 유효 |
| `readiness.scene` | 모니터가 `{"type":"scene_report","ready":true}`를 보낸 상태. 모니터 쪽 송신은 이동수 담당 |
| `game_ready` | 위 네 항목이 모두 true |
| `config_source` | `local`(`*.local.json` 또는 환경변수 경로) / `example`(제안값 사용 중) |

연결됨·관절 수신·보정 완료·추적 가능·플레이 가능은 서로 다른 값입니다. 브라우저 미리보기 성공이나 서버 연결만으로 어떤 준비 값도 true가 되지 않습니다.

## `/ws/ingest` — 휴대폰 → 서버

### 1. 등록

연결 후 **첫 메시지는 `register`**여야 합니다. 5초 안에 오지 않거나 다른 메시지가 오면 `not_registered` 오류 후 연결을 닫습니다. 예시: [register.example.json](../contracts/register.example.json)

```json
{"schema_version": "0.1", "type": "register", "camera_id": "C0", "device_id": "<기기 고유 ID>", "sample_only": false}
```

- `camera_id`는 폰이 선택한 논리 번호입니다. 연결 순서로 정하지 않습니다.
- `device_id`는 같은 폰이면 페이지를 다시 열어도 같아야 합니다(예: 처음 만든 UUID를 브라우저 저장소에 보관).
- `config/cameras.local.json`에서 슬롯에 `device_id`를 지정하면 그 기기만 등록할 수 있습니다(`device_mismatch`, 종료 코드 4403).
- 다른 기기가 이미 쓰는 번호면 거부합니다(`camera_id_in_use`, 종료 코드 4409).
- **같은 기기**가 다시 등록하면(새로고침 등) 새 스트림이 이전 스트림을 대체하고, 이전 연결은 `superseded` 오류 후 4001로 닫힙니다.

성공 응답:

```json
{"schema_version": "0.1", "type": "registered", "camera_id": "C0", "device_id": "…",
 "stream_id": "6f1c…", "sample_only": false,
 "expected": {"calibration_id": "C0-2026-11-12-a", "calibration_source": "measured",
              "image": {"width": 1280, "height": 720, "rotation_deg": 0}},
 "clock_ping_interval_ms": 1000}
```

`stream_id`는 등록마다 새로 발급됩니다. 이후 모든 `pose_2d`에 넣어야 하며, 다른 스트림 ID의 프레임은 `stream_mismatch`로 거부합니다. 프레임 번호·시계 상태는 스트림마다 새로 시작합니다. `expected`는 이 카메라의 보정이 요구하는 보정 ID와 영상 설정입니다. 보정이 없으면 `null`입니다.

### 2. 시계 교환

서버가 처음 10번은 0.1초, 이후 1초마다 보냅니다.

```json
{"schema_version": "0.1", "type": "clock_ping", "ping_id": 7, "server_send_ms": 1793300000123.4}
```

폰은 받자마자 답합니다. 예시: [clock_pong.example.json](../contracts/clock_pong.example.json)

```json
{"schema_version": "0.1", "type": "clock_pong", "ping_id": 7, "server_send_ms": 1793300000123.4,
 "device_time_ms": 1793300001957.9, "clock_id": "<페이지를 열 때 만든 ID>"}
```

- `device_time_ms`는 `capture_time_ms`와 같은 시계여야 합니다. 브라우저라면 `performance.timeOrigin + performance.now()`.
- `clock_id`는 그 시계 기준이 유지되는 동안 같아야 합니다. 바뀌면 서버가 이전 표본을 버리고 다시 맞춥니다.
- 서버는 자기가 보낸 `ping_id`의 송신 시각을 기억해서 씁니다. 모르는 `ping_id`는 `unknown_ping`입니다.
- 왕복 시간이 가장 짧은 표본으로 오프셋을 정하고, 그 RTT의 절반을 불확실성으로 기록합니다.
- 서버는 메시지가 5초 동안 하나도 오지 않으면 끊김으로 보고 `heartbeat_timeout` 후 연결을 정리합니다. `clock_pong`이 heartbeat 역할도 합니다.

### 3. `pose_2d`

예시: [pose_2d.example.json](../contracts/pose_2d.example.json)

| 필드 | 의미·규칙 |
| --- | --- |
| `schema_version`, `type` | `0.1`, `pose_2d` |
| `sample_only` | 등록 때 값과 같아야 함(`sample_flag_mismatch`). 합성·재생 입력은 true |
| `camera_id`, `device_id`, `stream_id` | 등록한 값과 같아야 함(`camera_id_mismatch`, `device_mismatch`, `stream_mismatch`) |
| `frame_id` | 스트림 안에서 증가하는 정수. 같은 번호는 `duplicate_frame`, 작은 번호는 `out_of_order_frame` |
| `calibration_id` | `registered.expected.calibration_id`를 그대로 넣음. 미보정은 null |
| `image.width/height` | 실제 관절 좌표의 기준 크기(1~8192) |
| `image.rotation_deg` | 0/90/180/270 |
| `image.mirrored` | 반드시 false. 거울 표시 전 좌표를 보냄(`mirrored_not_supported`) |
| `image.coordinate_space` | `raw_distorted_pixels`(서버가 왜곡 제거) 또는 `undistorted_pixels`(이미 제거됨, 서버는 다시 제거하지 않음) |
| `timing.capture_time_ms` | 기기 시계 기준 촬영 시각. 모르면 null |
| `timing.clock_id` | `clock_pong`과 같은 시계 ID |
| `timing.timestamp_source` | `capture_metadata`(예: `requestVideoFrameCallback`의 `captureTime`) / `presentation_time`(표시 예정 시각 등) / `inference_time` / `unknown` |
| `joints.left_wrist`, `joints.right_wrist` | `{u_px, v_px, visibility}` 또는 미검출 null. 키는 둘 다 있어야 함. MediaPipe 15·16번 |

- `u_px`, `v_px`는 원본 영상 크기 기준 픽셀입니다. MediaPipe 정규화 좌표는 `x × width`, `y × height`로 바꿉니다.
- `visibility`는 0~1이 아니면 메시지 전체를 거부합니다(`invalid_visibility`). NaN·무한대는 `non_finite_number`입니다.
- 좌표가 영상 밖이면 메시지는 받되 그 손목만 3D에서 제외합니다(`out_of_frame`).
- 16KB를 넘는 메시지는 `message_too_large`입니다.

**촬영 시각 정책:** 서버는 `timestamp_source`가 `config/project*.json`의 `tracking.allowed_timestamp_sources`(기본 `["capture_metadata"]`)에 있을 때만 시계를 변환해 3D 정렬에 씁니다. 그 외 출처나 null이면 2D 수신·상태 표시는 되지만 3D에서는 `clock_unknown`으로 제외합니다. 영상 표시 시각을 센서 촬영 시각으로 간주하지 않기 위한 규칙이며, 실제 폰의 지원 여부를 확인한 뒤 팀이 정합니다.

서버는 받은 프레임에 `received_at_server_ms`, `aligned_capture_at_server_ms`(위 조건을 만족할 때만), `clock_uncertainty_ms`를 붙여 내부에서 사용합니다. 클라이언트는 이 값을 보내지 않습니다.

### 오류 메시지

잘못된 메시지는 연결을 닫지 않고 오류로 알립니다(등록 단계 제외). `frame_id`를 읽을 수 있으면 함께 돌려줍니다.

```json
{"schema_version": "0.1", "type": "error", "code": "duplicate_frame", "detail": "812", "frame_id": 812}
```

| 코드 | 상황 |
| --- | --- |
| `not_registered`, `already_registered` | 등록 전 다른 메시지 / 등록 후 다시 `register` |
| `invalid_camera_id`, `camera_id_in_use`, `device_mismatch` | 설정에 없는 번호 / 다른 기기가 사용 중 / 슬롯에 묶인 기기와 다름 |
| `superseded`, `heartbeat_timeout` | 같은 기기의 새 등록으로 대체됨 / 5초 무응답 |
| `invalid_json`, `unsupported_message`, `unsupported_schema_version` | 형식 오류, 모르는 종류, 다른 버전. 바이너리 메시지도 `unsupported_message` |
| `invalid_field`, `invalid_visibility`, `non_finite_number`, `message_too_large`, `mirrored_not_supported` | 필드 검증 실패 |
| `camera_id_mismatch`, `stream_mismatch`, `sample_flag_mismatch` | 등록 정보와 다른 프레임 |
| `duplicate_frame`, `out_of_order_frame`, `unknown_ping` | 프레임 번호·시계 교환 오류 |

| 종료 코드 | 의미 |
| --- | --- |
| 4001 | 같은 기기의 새 등록으로 대체 |
| 4400 | 등록 실패(형식·번호 오류, 등록 시간 초과) |
| 4403 | 슬롯에 지정된 기기가 아님 |
| 4408 | heartbeat 시간 초과 |
| 4409 | 다른 기기가 사용 중인 번호 |

## `/ws/pose3d` — 서버 → 렌더·물리

새 정렬 시각이 생길 때마다 보내고, 새 시각이 없더라도 0.1초마다 무효 프레임을 보내 추적이 멈췄음을 알립니다. 예시: [pose_3d.example.json](../contracts/pose_3d.example.json)

| 필드 | 의미·규칙 |
| --- | --- |
| `session_id`, `sequence` | 세션 ID와 증가 번호. **게임 세션 생성 주체가 정해지기 전까지 `session_id`는 서버 실행 단위 ID**입니다 |
| `sample_only` | 합성·샘플 입력이 하나라도 관여하면 true |
| `coordinate_frame`, `units` | `room_z_up`, `m` |
| `aligned_capture_at_server_ms` | 사용한 관측의 공통 서버 시각 T. 정렬할 관측이 없으면 null |
| `server_sent_at_ms` | 서버 전송 시각. 브라우저 시계와 직접 빼지 않음 |
| `skew_ms` | 선택한 관측들의 촬영 시각 최대 차이. 2시점 미만이면 null |
| `joints.*.position_m` | 공통 월드 3D 점 또는 null. 실패 시 원점·직전 좌표를 넣지 않음 |
| `joints.*.valid` | 시점 수·시간·신뢰도·깊이·재투영 검사 통과 여부 |
| `joints.*.camera_ids` | 실제 사용한 카메라. 무효면 빈 배열 |
| `joints.*.reprojection_error_px` | 사용한 시점 중 최대 재투영 오차 |
| `joints.*.reason` | 무효 이유, 유효하면 null |
| `joints.*.excluded` | 카메라별 제외 이유(진단용) |

| 이유 | 단위 | 의미 |
| --- | --- | --- |
| `no_input` | 카메라 | 미등록이거나 받은 프레임 없음 |
| `stale` | 카메라 | 최신 프레임이 `max_frame_age_ms`보다 오래됨, 또는 새 정렬 프레임 없음 |
| `not_calibrated` | 카메라 | 보정 없음·검증 실패, 또는 합성 보정 사용이 허용되지 않음 |
| `calibration_mismatch` | 카메라 | 프레임의 보정 ID·기기·해상도·회전이 보정과 다름 |
| `clock_unknown` | 카메라 | 촬영 시각 없음, 허용하지 않는 시각 출처, 시계 미준비, `clock_id` 불일치 |
| `time_skew` | 카메라 | 기준 시각 T와 `max_skew_ms` 이상 차이 |
| `not_detected`, `out_of_frame`, `low_visibility` | 관절 | 미검출 / 영상 밖 / `visibility_min` 미만 |
| `insufficient_views` | 결과 | 유효 시점이 `min_views`(2) 미만이고 이유가 섞여 있음. 이유가 하나뿐이면 그 이유를 씀 |
| `reprojection_error`, `behind_camera` | 결과 | 재투영 오차 초과 / 카메라 뒤쪽 점 |

3시점에서 검사에 실패하면 한 대씩 빼 보고 가장 잘 맞는 2시점을 씁니다. 빠진 카메라는 `excluded`에 `reprojection_error`로 남습니다.

**정렬 규칙:** 기준 시각 T는 최신 프레임이 가장 늦은 카메라에 맞추되, 가장 빠른 카메라보다 `max_wait_ms` 넘게 늦은 카메라는 기다리지 않습니다. 각 카메라에서 T에 가장 가까운 프레임을 고르고, 선택한 프레임들의 촬영 시각 차이가 `max_skew_ms`를 넘으면 중앙값에서 가장 먼 프레임부터 뺍니다. `tracking.align_mode`가 `interpolate`면 T 앞뒤 프레임으로 2D 손목을 보간합니다(기본 `nearest`, D08 제안).

렌더러는 좌표를 Three.js 축 `(X,Y,Z) → (X,Z,-Y)`로 바꾸고 충돌체에도 같은 변환을 씁니다. 무효 프레임을 건너뛰어 이전 궤적과 이어붙이지 않습니다. 메시지가 끊기면 수신 쪽 watchdog으로 판정을 멈춥니다.

## `GET /api/calibration`

카메라별 보정 상태와, 보정이 있으면 `K`, `dist`, `R_world_to_camera`, `t_world_to_camera_m`, 영상 크기·회전, 보정 ID·출처를 돌려줍니다. C0 투영을 맞출 때 사용합니다. 보정 파일 형식은 [calib/README.md](../calib/README.md)에 있습니다.

## 다음 구현: 타격·평가 로그

`hit_event`: `event_id`, `session_id`, `building_id`, `joint`, `time_ms`, `hit_point_m`, `speed_mps`, `tracking_mode`, `task_type`, `source`.

- `tracking_mode`: `multiview_3d` / `single_view_2d` / `keyboard_demo`.
- `task_type`: `practice` / `prescribed` / `free`.
- `source`: `live` / `synthetic` / `replay`.
- 이벤트 ID로 중복 점수·로그를 막습니다.
- 참조 정답은 `reference_label`로 따로 기록합니다. 시스템의 성공 판정으로 정답을 자동 생성하지 않습니다.

노션의 A/B는 추적 방식, PPT의 A/B는 과제 종류입니다. 코드에서 둘 다 `mode=A/B`로 표현하지 않습니다.

## 카메라 브랜치 호환 수신 — 2026-10-30

대상은 `origin/feat/p1-camera-mediapipe`의 `9b760a8`이다. 서버가 아래 제안 규격을 지원하도록 맞췄다. 기존 `/ws/ingest` 계약은 유지하며 카메라 화면의 브랜치 병합·실기기 검증은 별도다.

| 항목 | `/ws/pose` 규칙 |
| --- | --- |
| 등록 요청 | `camera_hello`: schema_version=0.1, camera_id, device_id, stream_id, clock_id, source(live/replay). device_info는 추가 정보로 허용 |
| 등록 응답 | `camera_ack`: 휴대폰이 생성한 stream_id를 그대로 돌려줌. camera_id, device_id, sample_only, expected 등도 포함 |
| 중복 기기 | 다른 device가 같은 카메라를 등록하면 duplicate_camera_id 오류 및 종료 4409. 같은 device 재연결은 새 stream_id 필요 |
| 시계 요청 | `clock_ping`: ping_id, server_time_ms |
| 시계 응답 | `clock_pong`: ping_id, server_time_ms, client_time_ms, clock_id. 카메라 코드처럼 schema_version 생략 허용. 서버가 보낸 시각을 정확히 돌려줘야 함 |
| 2D 관측 | 기존 pose_2d 구조, source는 hello와 동일. 등록한 stream_id 사용. 해상도 변경 등 새 스트림은 새로운 ID·frame_id=0으로 시작 |
| 스트림 전환 | 연결 내 이전 ID 재사용 불가. 전환 시 이전 관측·프레임 번호·FPS 이력을 비움. 같은 페이지 시계 변환은 유지. 한 연결 최대 128개 스트림, 초과 시 재접속 필요 |
| 재생 입력 | 폰 브랜치의 source=replay·sample_only=false는 서버에서 sample_only=true로 정규화. 재생을 실제 입력 준비 완료로 사용하지 않음 |
| 신뢰도 미상 | 손목 visibility=null은 서버 내부에서 해당 손목 관측을 null로 처리. 신뢰도를 임의의 양수로 채우지 않음 |
| 촬영 시각 | rvfc_capture_time을 출처 이름 그대로 수신. 3D 허용 기본값 capture_metadata는 유지하므로 출처 검증·명시적 설정 전까지 시간 정렬에 사용하지 않음. 촬영 시각 null은 unknown |
| 접근 키 | 기존 HTTP/WS 키·같은 출처 쿠키가 /ws/pose에도 적용됨 |

서버 내부 알고리즘에는 두 경로 모두 같은 등록·검증·정렬 파이프라인으로 연결한다. 휴대폰의 calibration_id=null은 그대로 유지하며 실제 보정 연결은 후속 작업이다. /ws/pose 호출 성공만으로 3D 준비 완료가 되지 않는다.
