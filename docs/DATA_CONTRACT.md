# 데이터 계약 v0.1

이 문서는 팀이 별도로 개발할 때 맞춰야 할 인터페이스 초안입니다. **현재 구현된 통신은 `/ws/status`뿐입니다.** 아래 `pose_2d`와 `pose_3d`는 형식 예시이며 수신 API·알고리즘은 아직 없습니다.

## 현재 구현: 상태 메시지

`/ws/status` 연결 즉시 `system_status`를 한 번 보냅니다. 이후 클라이언트가 `{"type":"get_status"}`를 보내면 다시 응답합니다. 그 외 메시지는 `error`로 알립니다. HTTP `/api/health`는 프로세스가 실행 중인지 확인하는 용도입니다.

```json
{
  "schema_version": "0.1",
  "type": "system_status",
  "stage": "scaffold",
  "game_ready": false,
  "cameras": [
    {"camera_id": "C0", "status": "not_implemented"},
    {"camera_id": "C1", "status": "not_implemented"},
    {"camera_id": "C2", "status": "not_implemented"}
  ],
  "readiness": {"camera_input": false, "calibration": false, "tracking": false, "scene": false},
  "message": "초기 구조입니다. 카메라 입력·보정·3D 추적은 아직 연결하지 않았습니다."
}
```

서버 연결, 카메라 영상 확보, 관절 수신, 보정 완료, 플레이 가능은 서로 다른 상태로 표시해야 합니다. 브라우저의 미리보기 성공만으로 서버의 `camera_input`을 true로 바꾸지 않습니다.

## 다음 구현: 휴대폰 → 서버

예시: [pose_2d.example.json](../contracts/pose_2d.example.json)

| 필드 | 의미·규칙 |
| --- | --- |
| `schema_version`, `type` | 버전 `0.1`, 메시지 종류 `pose_2d` |
| `sample_only` | 예제는 true. 실제 입력은 false로 명시하고 테스트 세션과 분리 |
| `camera_id`, `device_id` | C0/C1/C2 논리 ID와 장비 ID. 브라우저 재연결에도 보정 매핑을 확인 |
| `frame_id` | 기기별 증가 번호. 재연결 시 새 스트림 ID 발급 |
| `stream_id` | 재연결 전후 프레임 번호·시계 기준이 섞이지 않게 구분 |
| `image` | 실제 width/height, 회전·거울·좌표 공간. 예시는 왜곡 보정 전 원본 픽셀 |
| `calibration_id` | 렌즈·해상도·회전 등과 일치하는 보정 버전. 미보정은 null |
| `timing.capture_time_ms` | 기기 시계 기준 촬영 시각. 없으면 null |
| `timing.clock_id` | 시간 기준 식별자. 페이지가 재시작되면 바뀔 수 있음 |
| `timing.timestamp_source` | 촬영 메타데이터/영상 재생 시각/수신 시각 등 실제 출처. 모르면 `unknown` |
| `joints.left_wrist/right_wrist` | `{u_px, v_px, visibility}` 또는 null. MediaPipe 15·16번 |

서버는 수신 후 별도 필드로 `received_at_server_ms`, `aligned_capture_at_server_ms`, `clock_uncertainty_ms`를 붙입니다. 서버가 계산할 값을 클라이언트가 확정해서 보내지 않습니다. 영상 재생 시간은 센서 노출 시각과 같다고 가정하지 않습니다.

시간이 미상인 예제는 구조 검토용이며 삼각측량에 사용할 수 없습니다. NaN·무한대·범위를 벗어난 신뢰도·잘못된 카메라 ID·초과 크기 메시지를 거부하는 검증을 T01~T02에 추가합니다.

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

## 다음 구현: 서버 → 모니터

예시: [pose_3d.example.json](../contracts/pose_3d.example.json)

| 필드 | 의미·규칙 |
| --- | --- |
| `session_id`, `sequence` | 게임 세션과 증가 프레임 번호 |
| `coordinate_frame`, `units` | `room_z_up`, `m` |
| `aligned_capture_at_server_ms`, `server_sent_at_ms` | 공통 서버 시계의 관측·전송 시각. 브라우저 시계와 직접 빼지 않음 |
| `skew_ms` | 선택 관측의 공통 촬영 시각 최대 차이. 시각 변환이 없으면 null |
| `joints.*.position_m` | 공통 월드 3D 점 또는 null |
| `joints.*.valid` | 시간·시점 수·신뢰도·재투영 검사 통과 여부 |
| `joints.*.camera_ids` | 실제 사용한 서로 다른 카메라 ID |
| `joints.*.reprojection_error_px` | 사용 관측 중 최대 재투영 오차. 미측정은 null |
| `joints.*.reason` | `not_calibrated`, `insufficient_views`, `stale`, `time_skew`, `reprojection_error` 등 |

렌더러는 좌표를 Three.js 축으로 변환하고 충돌체에도 같은 변환을 적용합니다. 무효 프레임을 건너뛰어 이전 궤적과 이어붙이지 않습니다. 연결 복구·세션/구역 변경 시 궤적을 초기화합니다. 네트워크 정지 중에도 마지막 좌표로 계속 판정하지 않도록 수신 watchdog을 구현해야 합니다.

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
