# 데이터 계약 v0.2

현재 방·영상·video_check 세션·QR 계약은 [ROOMS.md](ROOMS.md)를 따른다. 방 1은 room.v1의 pose 봉투로 아래 관절 계약을 전달하며 기존 registry·시계·3D 파이프라인에 입력한다. 방 2는 영상 전용이다. `/ws/pose`·`/ws/ingest`도 유지하며 실제 보정/3D 통합 검증은 별도다.

팀이 따로 개발할 때 맞춰야 할 인터페이스입니다. 필드 정의는 정경호가 관리하고 송신·수신 담당이 함께 검토합니다. 아래 서버 메시지는 JSON 텍스트이며 시간은 별도 표기가 없으면 ms입니다. 2D 관절은 원본 영상 픽셀, 3D 좌표는 m입니다. 단일 카메라 제안의 정규화 좌표·속도는 별도 계약을 따릅니다.

**v0.1에서 바뀐 점:** `/ws/ingest`(등록·시계 교환·`pose_2d` 수신), `/ws/pose3d`(`pose_3d` 전달), `/api/calibration`을 구현했습니다. `/ws/status`의 상태 값을 실제 입력 기준으로 바꿨습니다. 외부 접속용 접속 키(D07)를 추가했습니다. 아래 표의 **구현 상태**는 서버 쪽 기준입니다. 폰 송신(김태이)과 모니터 수신(이동수)은 각 담당이 연결합니다.

| 경로 | 방향 | 구현 상태 |
| --- | --- | --- |
| `/ws/status` | 서버 ↔ 모니터·카메라 페이지 | 구현. `scene_report` 송신은 모니터 미연결 |
| `/ws/ingest` | 휴대폰 ↔ 서버 | 서버 구현. 현재 카메라는 `/ws/pose` 사용 |
| `/ws/pose` | 휴대폰 ↔ 서버 | 송신 클라이언트·서버 호환 구현, 실제 폰 미검증 |
| `/ws/pose3d` | 서버 → 렌더·물리 | 서버 구현, 소비자 미연결 |
| `GET /api/calibration` | 서버 → 렌더 | 구현. 실측 보정 파일은 아직 없음 |
| `hit_event` | 물리 → 게임·로그 | 미구현 (아래 ‘다음 구현’) |

## 접속 키 (D07)

`SMASH_ACCESS_KEY` 설정 시 PC·기존 관절/3D API를 키로 보호합니다. 카메라 전용 페이지·필수 자산·방소켓 camera 입장은 공개하며 monitor 입장은 별도 키/쿠키 검사를 합니다. 처음 한 번 `https://<주소>:8443/monitor/?key=<키>`처럼 주소에 붙여 열면, 서버가 키의 해시를 담은 쿠키(HttpOnly, SameSite=Strict, HTTPS에서 Secure)를 줍니다. 같은 브라우저의 이후 요청과 WebSocket은 쿠키로 통과하므로 페이지 코드를 바꿀 필요가 없습니다. 쿠키를 쓰지 못하는 클라이언트는 WebSocket 주소에 `?key=<키>`를 붙입니다. 키가 없거나 틀리면 HTTP는 401, WebSocket은 연결이 거부됩니다. 키·실제 주소는 저장소에 기록하지 않습니다.

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

방 1 pose_2d는 선택 필드 body에 얼굴을 제외한22개 전신2D 관절을 추가할 수 있다. 필수 키·null·픽셀·가시성 검증은 [ROOMS.md](ROOMS.md)의 전신 확장을 따른다. 기존 joints 손목과 pose_3d는 유지하며 전신3D를 구현한 것은 아니다.

선택 head 필드로 머리 대표 위치1개 {u_px,v_px,visibility} 또는 null을 보낸다. 얼굴 세부 점·표정 정보는 송신하지 않는다. 기존 body22개·손목 계약은 유지하며 추정 방법과 검증·표시 범위는 ROOMS.md를 따른다. 머리3D 출력은 없다.

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

### 카메라 페이지가 실제로 보내는 값 (2026-10-29, 김태이)

`web/camera/`가 위 필드를 그대로 보내며, 아래 값을 추가로 채웁니다. 모두 추가 필드라 기존 필드의 의미는 바뀌지 않습니다.

| 필드 | 의미·규칙 |
| --- | --- |
| `source` | `live`(카메라) / `replay`(`?replay=` 녹화 재생). 평가·추적에는 `live`만 사용 |
| `timing.clock_id` | `perf-<uuid>`. 페이지의 `performance.now()` 기준이며 새로고침마다 바뀜 |
| `timing.capture_time_ms` | `requestVideoFrameCallback`의 `captureTime`이 있을 때만 채움(`timestamp_source=rvfc_capture_time`). 없으면 `null`·`unknown` |
| `timing.presentation_time_ms` | 같은 콜백의 `presentationTime`. 촬영 시각이 아니라 화면 표시 기준 시각 |
| `timing.inference_end_ms` | MediaPipe 추론이 끝난 시각 |
| `image.rotation_deg` | 항상 0. 브라우저가 전달한 프레임 방향 그대로의 좌표. 폭·높이가 바뀌면(회전 등) 새 `stream_id`로 시작 |
| `joints.*` | 사람이 검출되지 않았거나 손목이 화면 밖으로 추정되면 `null`. `visibility`는 0~1이며 기준값 거르기는 서버가 함 |

### `/ws/pose` 연결 절차 (김태이 제안 → 정경호 `feat/server-deployment`에서 서버 구현, 2026-10-30)

카메라 페이지는 아래 순서를 기준으로 구현했습니다. 서버에 `/ws/pose`가 없으면 연결 실패를 표시하고, 손목은 화면에만 보여주며 3초마다 다시 연결합니다.

1. 폰 → 서버 `camera_hello`: `camera_id`, `device_id`(브라우저 저장소에 유지), `stream_id`(연결마다 새로 발급), `clock_id`, `source`, `device_info`(UA·영상 설정·MediaPipe 버전/모델/GPU·CPU).
2. 서버 → 폰 `camera_ack` `{camera_id, stream_id}`를 받은 뒤에만 `pose_2d`를 보냅니다. 거부는 `{"type":"error","code":"duplicate_camera_id"}`처럼 보내면 폰 화면에 코드가 표시됩니다.
3. 서버 → 폰 `clock_ping` `{ping_id, server_time_ms}`에는 즉시 `clock_pong` `{ping_id, server_time_ms, client_time_ms, clock_id}`로 답합니다. `client_time_ms`는 `timing`과 같은 시계입니다.
4. 재연결하면 새 `stream_id`로 `camera_hello`부터 다시 시작하고 `frame_id`는 0부터 셉니다. 등록 전이나 송신 버퍼(64 KB)가 찼을 때의 프레임은 쌓지 않고 버립니다. `frame_id`는 실제로 보낸 프레임에만 증가하므로, 해상도·회전 변경으로 시작한 새 스트림도 서버에 항상 0번부터 도착합니다.
5. 등록 후의 `error`는 해당 메시지 하나에 대한 거부로 보고 송신을 계속하며, 화면의 "서버 거부 프레임"에 횟수·마지막 코드를 표시합니다. 등록 전의 `error`(`duplicate_camera_id` 등)는 등록 거부로 표시합니다.
6. 종료 코드 4001(같은 기기의 다른 탭이 대체), 4401(접속 키 없음), 4403(다른 기기 전용 번호)은 다시 연결해도 해결되지 않으므로 재연결하지 않고 안내만 표시합니다. 그 밖의 종료(4409 사용 중, 4400, 네트워크 끊김)는 3초 뒤 새 스트림으로 다시 등록합니다.


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

## 로컬 건물·파편 패키지 v1 (2026-11-02)

`web/public/assets/buildings/knu-it1-v1/manifest.json`과 `colliders.json`은 독립 에셋 계약이다. `building_id=knu-it1-v1`, 단위 m, 패키지 로컬 좌표는 glTF/Three.js의 Y 위쪽이다. 공통 월드의 `(X,Y,Z) → (X,Z,-Y)` 변환을 패키지 내보내기에서 이미 적용했으므로 패키지를 다시 회전하지 않는다. 조립 위치·피벗·충돌체 정점은 같은 로컬 좌표를 사용한다.

기존 `pose_3d`의 `room_z_up` 계약은 그대로다. 실내 배치는 보정 결과를 통해 별도로 결정한다. `source_origin_campus_z_up_m`는 출처 메타데이터이며 실제 플레이 공간의 위치로 쓰지 않는다. 키보드 데모는 `tracking_mode=keyboard_demo`, `source=synthetic`이며 네트워크 타격·추적 입력을 보내거나 서버 준비 상태를 바꾸지 않는다. [실행·제작·검증](ASSET_PIPELINE.md)을 참조한다.

2026-11-02 재검증 정정: manifest의 `dimensions_m`에 축소 배율이 빠져 있던 것을 수정했다. 이 값은 Y-up 게임 모델의 실제 크기이고, `source_dimensions_campus_z_up_m`가 원본 캠퍼스 크기다. 파편 수·단위·축·피벗·회전·배율·렌더/충돌체 경계를 로딩 전에 검사하며 불일치 패키지에서는 플레이를 허용하지 않는다. 이전 잘못된 크기 값을 보존한 소비 코드는 새 manifest와 대조해야 한다.


## 건물 카탈로그·고도화 패키지 (2026-11-02)

`web/public/assets/buildings/catalog.json`의 `default`와 `buildings[{id,label,folder}]`로 로컬 모델을 고른다. 기본 `knu-it1-v2`는 64개, `knu-main-v1`은 52개, 보존한 `knu-it1-v1`은 32개 파편이다. 소비 코드는 파편 수와 크기를 manifest에서 읽고 하드코딩하지 않는다. `campus`는 별도 검사 화면의 v12 GLB 경로다.

schema 1.0의 m·three_y_up·항등 복원 회전·같은 피벗/충돌체 규칙은 유지한다. 새 GLB는 PBR 텍스처와 최종 삼각형/UV에서 계산한 tangent를 포함한다. 크기는 난간 등 마감까지 포함한 실제 패키지 경계다. 원본 캠퍼스 크기와 혼용하지 않는다. 선택 모델의 사전 검증 후 강체·GPU 자원을 교체하며, 새 모델 로딩 실패 시 이전 모델을 유지한다.

클릭 타격점·방사형 속도·먼지는 로컬 synthetic/keyboard_demo 효과다. 네트워크 `hit_event`나 실제 궤적을 송수신한 결과가 아니다. 기존 `pose_3d`, 시계·장비 설정·서버 준비 계약은 변경하지 않았다. [고도화 결과·검증](BUILDING_ENHANCEMENTS.md)을 참고한다.


2026-11-02 지도 대조 v13: catalog.campus는 정적 캠퍼스 v13 GLB 경로다. 선택 필드 campus_focus의 각 항목은 {id,label,target_y_up_m,distance_m}로 로컬 카메라 둘러보기에만 사용한다. 실제 AR 보정값·실내 배치나 네트워크 메시지로 사용하지 않는다. 게임 건물 ID/파편/피벗·축 변환·기존 pose_3d 계약은 변경하지 않았다. 상세 근거는 [캠퍼스 지도 대조](CAMPUS_MAP_REVIEW.md)를 따른다.


2026-11-02 파편 세분화: catalog.default=knu-it1-v3(96개), knu-main-v2(85개)를 추가했다. 이전64/52/32개도 유지하며 수량은 manifest에서 읽는다. previous_version은 이전ID, fracture_seed_count는 생성영역 수다. 축/단위/피벗/복원·실제 hit_event 계약 유지. 사용자 인수는 이동수 담당이고 실제 충돌/물리는 김태이,3D는 정경호 책임이다. [세분화·역할](FRACTURE_REFINEMENT.md)을 따른다.


## 2026-11-03 단일 카메라 추가 계약 제안

[휴대폰 1대·PC 화면 계획](SINGLE_CAMERA_PLAN.md)의 단일 화면 2D 경로를 제안한다. PC 수신 프레임 추론·모드별 준비/세션·2D 이벤트 단위는 설계 검토 대상이며 현재 구현/메시지 스키마가 아니다. 기존 다중 3D의 room_z_up·보정·유효 시점·시간 기준은 유지하고 후속 구현 PR에서 확정·검증한다.

2026-11-03 v0.2 상세화: [인터페이스·상태 기준안](SINGLE_CAMERA_INTERFACES.md)에 PC 생성 세션/서버 ACK, 방/스트림/실행 버전, 프레임·변환·만료, 2D 단위와 수락/거부를 정의했다. [검증 계획](SINGLE_CAMERA_TEST_PLAN.md)의 T-SC-01~18로 후속 구현을 확인한다. 제안 API/파일은 신규 개발 대상이며 현재 스키마·실행 코드에 적용한 변경은 없다.

## 카메라 브랜치 호환 수신 — 2026-10-30

초기 호환 대상은 `origin/feat/p1-camera-mediapipe`의 `9b760a8`이었다. 현재 작업 브랜치에는 최신 main 카메라와 아래 서버 호환 경로를 로컬 병합했다. 위 연결 절차의 등록 후 오류·재연결 정책도 유지한다. 기존 `/ws/ingest` 계약과 실기기 미검증 상태는 유지한다.

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
