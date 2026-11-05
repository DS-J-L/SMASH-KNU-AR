# 방·영상·영상 확인 세션 계약 room.v1

기준: 2026-11-04 KST. 현재 로컬 코드의 계약이다. 단일 2D 게임 설계는 [SINGLE_CAMERA_INTERFACES.md](SINGLE_CAMERA_INTERFACES.md), 기존 좌표 계약은 [DATA_CONTRACT.md](DATA_CONTRACT.md)를 따른다.

## 1. 방과 화면

| 방 | 카메라 자리·시작 필수 | PC | QR 수 |
| --- | --- | --- | --- |
| room-1 · 다중 카메라 | C0/C1/C2 모두 | 1대 | 3개 |
| room-2 · 단일 카메라 | C0 | 1대 | 1개 |

- `/monitor/`: 방 상태·PC 입장 링크·전체 QR4개. 목록 조회는 방을 점유하지 않는다.
- `/monitor/room-1/`, `/monitor/room-2/`: 해당 방에 PC 자동 입장, 카메라 가로 표시·게임 시작·60초/결과·그 방 QR 제공.
- `/camera/room/?room=room-1&camera=C0`: 지정 방/카메라를 미리 선택한다. 폰에서 권한 허용·입장 버튼을 누른다. 방 1은 폰 손목 추론·관절/영상 송신, 방 2는 영상만 송신한다.
- room-2는 C1/C2 입장을 거부한다. 허용 목록 외 방·QR·PC 페이지는 제공하지 않는다.
- 방 구성은 `backend/room_config.py`가 입장·세션 시작 필수 목록의 기준이다. 상태의 camera_mode는 연결 구성일 뿐 2D/3D 추적 완료를 뜻하지 않는다.

## 2. 인증과 고정 QR

카메라 입장에는 키·참가 토큰을 요구하지 않는다. 카메라 페이지와 정확히 지정된 필수 shared 파일만 공개한다. PC·방 목록·보정·기존 관절 수신·나머지 API는 `SMASH_ACCESS_KEY` 설정 시 기존 키/쿠키로 보호한다. 키를 설정하지 않은 개발 서버는 기존처럼 전체 접근이 가능하다.

`/ws/single/signaling`은 카메라를 위해 무인증 연결을 받아도, 첫 join의 monitor 역할은 키/쿠키를 다시 검사한다. camera로 입장한 연결은 monitor로 승격할 수 없고 게임 시작도 할 수 없다. device_id는 클라이언트 식별자이며 기기별 비밀 인증값은 아니다.

PC의 QR 출력 영역에서 휴대폰이 접속할 HTTPS origin을 지정한다. localhost는 휴대폰에서 PC를 가리키지 않는다. QR은 아래 주소만 인코딩하며 키·토큰·만료값이 없다. 주소가 유지되면 출력물을 재사용할 수 있다.

```text
https://서버주소:8443/camera/room/?room=room-1&camera=C0
```

`GET /api/single/rooms/{room_id}/qr/{camera_id}.svg?base_url=...`는 PC 인증을 요구하며 qrcode8.2로 SVG를 만든다. base_url은 http/https origin만 허용하고 경로·계정/암호·query·fragment는 거부한다. 외부 QR 생성 서비스로 데이터를 보내지 않는다.

## 3. 방 조회·입장·수명주기

`GET /api/single/rooms`는 schema=room.v1, server_epoch, rooms 목록을 반환한다. 동적 방 생성은 제공하지 않는다.

`WS /ws/single/signaling`의 첫 메시지:

```json
{"schema":"room.v1","type":"join","room_id":"room-1","role":"camera","camera_id":"C0","device_id":"phone-example","transport":"server"}
```

PC는 role=monitor, camera_id=null 또는 생략이다. transport는 webrtc(기본)/server. device_id는 비어 있지 않은 문자열(최대128자). 서버는 joined 다음 room_status를 보낸다.

- joined: room_id, role, camera_id, connection_id, server_epoch, heartbeat_interval_ms, heartbeat_timeout_ms.
- room_status: room_id, server_epoch, state(empty/waiting/connected), monitor_connected, monitor_connection_id, cameras[{camera_id,connected,connection_id,transport}], camera_count, max_cameras, required_cameras, camera_mode, game.
- connection_id는 입장마다, server_epoch는 앱 시작마다 바뀐다. connected는 PC와 카메라가 연결됐다는 뜻이며 영상/게임/3D 준비와 다르다.

입장 후 모든 메시지는 schema=room.v1과 현재 room_id를 포함한다.

| type | 동작 |
| --- | --- |
| ping | pong 응답. 참가자는 joined의 heartbeat_interval_ms마다 송신 |
| get_status | 현재 room_status 조회 |
| leave | 자리 해제·연결 종료·남은 참가자에게 상태 전달 |
| offer / answer / ice | 같은 방 현재 PC↔카메라의 WebRTC 신호 중계 |
| video_frame | server 방식 카메라의 JPEG를 같은 방 PC에 중계 |
| start_game | PC의 video_check 세션 시작 요청 |
| get_game_status | 현재 방의 세션·남은 시간·결과 조회 |

서버 기본 수신 만료는5초다. 입장/교체/종료/만료 때 상태를 전달한다. 유한 송신 큐에서 누락된 상태는 get_status로 재조회한다. 같은 기기의 동일 자리는 새 연결로 교체하고 이전 연결은 superseded/4001로 종료한다. 이전 연결의 늦은 종료는 새 연결을 지우지 않는다. 다른 기기의 자리 중복·기기 ID의 다른 자리 중복은 거부한다. 방 이동은 leave 후 새 join이다.

| 오류 | 의미 |
| --- | --- |
| access_key_required / 4401 | 인증 없는 PC 역할 입장 |
| slot_in_use, device_in_use / 4409 | 자리 또는 기기 중복 |
| join_required, unknown_room, invalid_role, invalid_camera_id, invalid_device_id, invalid_transport / 4400 | 입장 형식·역할·구성 오류 |
| heartbeat_timeout / 4408 | 수신 만료 |
| room_mismatch, invalid_schema, unsupported_message | 입장 후 다른 방·형식·미지원 메시지 |

서버는 단일 프로세스 메모리로 관리한다. 여러 worker 사이에 공유하지 않으며 재시작 시 접속·세션을 초기화한다.

## 4. 영상 전달과 표시 정렬

### WebRTC 직접

SDP/ICE의 target_connection_id와 payload를 지정한다. 서버는 현재 같은 방의 반대 역할만 대상으로 허용하고 from_connection_id·camera_id는 등록값으로 채운다. offer는 카메라, answer는 PC만 보낸다. STUN/TURN은 미구성이라 같은 망에서 우선 시험한다. 수신 프레임별 시각 메타데이터가 없어 영상 간 표시 정렬 대상에서는 제외한다.

### 서버 JPEG 중계

카메라는 video_frame에 frame_id, data_url(JPEG base64), prepared_at_server_ms(서버 기준 준비 시각 또는 null)를 보낸다. 서버는 현재 방/역할/방식과 유한한 시각값을 검사하고 현재 PC에만 전달한다.

- 송신: 긴 변640px·JPEG 품질0.65·약15FPS. WebRTC도 시각 합성을 위한 캔버스 경로를 사용한다.
- 메시지512KiB·JPEG360KiB 한도, base64·JPEG 시작/종료 바이트 검사. 실제 픽셀 디코딩은 브라우저에서 수행한다.
- 폰 전송 버퍼512KiB 초과 시 새 프레임을 건너뛴다. 서버는 카메라당 최신 대기1개만 보관한다. 영상은 디스크에 저장하지 않는다.
- PC는 연결별 최대32프레임을 보관하고 유효 카메라의 최신 준비 시각 중 가장 작은 값을 표시 기준으로 삼는다. 각 카메라에서 그 시각 이하 가장 가까운 프레임을 고른다.
- 기준과120ms 넘게 어긋나거나 보관분이 없으면 동기화 버퍼 부족을 표시한다. 묶음을 모두 디코딩한 후 같은 JS 작업에서 캔버스에 반영한다. 디코딩 대기는 최대1초다.
- 1.5초간 유효 프레임이 없는 카메라는 제외하고 복구·새 연결 때 오래된 버퍼를 정리한다.
- 시각이 없으면 검은 화면으로 막지 않고 개별 영상을 표시하며 동기화 제외를 명시한다. 유효 묶음이 준비되면 동기화 표시로 전환한다.

이는 전송 준비 시각 기준의 표시 정렬이다. 센서 동시 촬영·실제3D 시간 정렬·디스플레이 스캔아웃 일치를 증명하지 않는다. 빠른 카메라에는 느린 카메라를 기다리는 표시 지연이 추가된다.

## 5. 서버 기준 시각 표시

기존 heartbeat에 ping_id를 보내고 pong의 server_received_ms·server_sent_ms로 왕복을 보정한다. 브라우저는 performance.now와 최근10초 최소RTT 표본으로 서버 시각을 추정한다. 입장 직후와 기존 heartbeat 주기로 갱신하며 영상 프레임마다 서버 응답을 기다리지 않는다.

영상에는 서버 기준 전송 준비 HH:mm:ss.SSS KST와 추정 오차를, PC에는 같은 기준 현재 시각을 표시한다. ±값은 서버 처리 구간을 제외한 RTT/2 추정이며 비대칭 망·드리프트의 정확한 오차 상한이 아니다. 유효 표본이 없으면 동기화 대기로 표시하고 영상은 개별 표시한다. 기존 다중3D 시계·촬영 시각 계약에는 적용하지 않는다.

## 6. 준비 점검·60초·결과

현재는 mode=video_check인 영상 확인 세션이다. 방 1 폰 손목 추론·서버 수신은 연결했지만 게임 장면·충돌·점수는 연결 전이며 결과의 score는 null이다. 아래 시작 조건은 영상 확인용이며 관절/3D 준비 완료를 뜻하지 않는다.

PC는 현재 방 입장·표시 중인 탭·필수 카메라 모두 연결·각 영상의 최근1.5초 프레임을 검사한다. room-1은3대, room-2는1대다. 부족하면 시작 버튼을 비활성화하고 사유를 표시한다. 서버도 필수 카메라와 현재 연결 ID·PC 역할을 검사한다. 실제 영상 준비는 PC 보고이며 서버의 독립 영상 인식 검증이 아니다.

```json
{"schema":"room.v1","type":"start_game","room_id":"room-2","session_id":"pc-generated-uuid","mode":"video_check","cameras":[{"camera_id":"C0","connection_id":"current-camera-connection","video_ready":true}]}
```

승인 game_ack 전에는 타이머를 시작하지 않는다. game에는 session_id, room_id, mode, state(playing/ended), duration_ms=60000, remaining_ms, elapsed_ms, started_at_server_ms, camera_ids, score=null, reason이 있다. PC는 단조시계로 남은 시간을 표시하고 기존 heartbeat마다 get_game_status를 조회한다. 서버도 방별 단조시계로60초 만료를 판정한다.

동일 요청 재전송은 같은 세션을 반환하고 시간을 초기화하지 않는다. 같은 ID/다른 구성은 session_conflict, 진행 중 다른 ID는 session_in_progress, 새 판 뒤 이전 ID는 old_session이다. 이력은 프로세스당 최대1000개이며 초과 시 session_limit로 거부한다. 방별 세션은 독립적이고 다음 시작에는 새UUID를 쓴다.

PC 연결만 끊긴 경우 서버 타이머는 계속 가며 같은 방 재입장 시 현재 상태를 조회한다. 필수 카메라 연결 끊김은 아래 자동 중지 규칙을 따른다. 종료 결과는 종료 사유·실제 진행 시간·시작 카메라·세션ID·점수 미연결을 표시한다. 카메라 테스트로 돌아가기는 결과만 닫고 남은 영상·방 연결을 유지하며 세션을 새로 만들지 않는다.

시작 ACK 후 PC는 카메라 영역을 브라우저 화면 가득 확대한다. 기본은 C0이며 방 1은 상단 C0/C1/C2 버튼으로 큰 영상 하나를 선택한다. 원본 영상 비율을 유지하고 video 요소·스트림을 재생성하지 않는다. 상단에 남은 시간과 서버 점수를 표시하며 현재 score=null은 —/타격 연결 전으로 표시한다. 유한 숫자 점수를 수신하면 해당 점수를 상단·결과에 반영한다. 화면 축소 또는 Esc로 일반 화면으로 나와도 타이머·연결은 유지하고 크게 보기로 복귀할 수 있다. 같은 세션 상태 조회가 축소 선택을 덮어쓰지 않는다. 종료 시 결과 화면, 방 연결 종료 시 일반 화면으로 복귀한다. 브라우저 창 내부 확대이며 OS 전체 화면 권한은 요구하지 않는다.

### 수동·자동 중지

확대 화면과 일반 화면의 중지 버튼은 현재 세션 ID를 명시해 stop_game을 보낸다. 서버 종료 응답 전에는 중지 대기를 표시하고 중복 클릭을 막는다. 7초 응답이 없으면 재시도를 허용한다. PC 역할만 가능하며 다른 방/이전 세션을 중지할 수 없다. 서버는 game_status와 갱신 room_status를 반환한다.

```json
{"schema":"room.v1","type":"stop_game","room_id":"room-1","session_id":"current-session-id","reason":"manual_stop"}
```

- manual_stop: 사용자 중지. camera_stalled: PC에서 필수 영상의1.5초 진행 중단을 감지해 요청하는 자동 중지. 다른 reason은 invalid_stop_reason, 현재 세션 ID 불일치는 session_mismatch다. 오류는 request_type=stop_game을 포함한다.
- camera_disconnected: 서버가 필수 카메라 연결 종료를 감지하면 해당 방을 자동 종료한다. room-1은 C0/C1/C2 중 하나, room-2는 C0가 대상이며 다른 방에는 영향을 주지 않는다.
- 영상이 멈췄지만 연결은 유지되는 경우 PC가 마지막 프레임 진행 시각을 확인해 camera_stalled를 요청한다. 중계는 디코딩/그리기 완료, WebRTC는 수신 프레임 통계(미지원 시 디코딩 프레임)도 사용해 큰 화면에서 숨겨진 정상 카메라를 오인하지 않는다. 폰은 원본 video.currentTime이 멈추면 새 시각만 입힌 영상을 반복 송신하지 않는다. PC 탭이 숨겨진 동안의 렌더 중단은 이 검사에서 제외하며 탭 복귀 후1.5초 유예한다. 서버의 카메라 연결 종료 검사는 계속 적용된다.
- 중지 시 state=ended, remaining_ms=0이며 elapsed_ms는 중지 시각으로 고정한다. 동일 중지 재전송과 재연결로 경과 시간·기존 종료 사유가 바뀌지 않는다. 이미60초 만료된 세션의 time_up도 덮어쓰지 않는다. 결과 후 카메라 테스트로 돌아가 준비 조건을 충족하면 새 UUID로 시작한다. 자동 재개하지 않는다.

## 7. 방 1 폰 손목 송신

### 얼굴 제외 전신 2D 확장

방 1은 같은 MediaPipe 추론 결과의11~32번을 body로 사용한다. 어깨·팔꿈치·손목·새끼손가락 끝·검지 끝·엄지 끝·골반·무릎·발목·뒤꿈치·발끝을 좌우 각각22개 점으로 추출한다. 머리는 별도 head 중심점1개로 표시·전송한다. 얼굴 세부 점은 보내지 않는다. 폰/PC 영상에 점과 연결선을 그리며 visibility 0.5 미만·미검출·화면 밖 점과 그 연결선은 숨긴다. PC 전송의200ms 유효기간·크기 변경/추론 종료 시 제거 규칙은 유지한다.

pose_2d의 기존 joints.left_wrist/right_wrist는 유지하고 선택 필드 body를 추가한다. body가 있으면 left/right_shoulder, elbow, wrist, pinky, index, thumb, hip, knee, ankle, heel, foot_index의22개 키가 모두 있어야 한다. 각 값은 기존과 같은 원본 픽셀 u_px/v_px·visibility 또는 null이다. 서버는 얼굴/알 수 없는 키·누락·비유한 수·잘못된 가시성을 거부하고 수신 스트림의 최신 Pose2D.body에 보관한다. body가 없는 기존 입력은 호환한다. body의3D 복원·pose_3d 추가 출력은 아직 없으며 기존3D는 손목만 사용한다. 기존 모델을 한 번만 추론하고 결과를 재사용한다. 전송/그리기 비용 증가와 실제 폰 지연은 실측이 필요하다.

방 1은 이미 열린 카메라 영상에 MediaPipe lite(GPU 우선, CPU 대체)를 적용해 최대15Hz로 양손 손목 픽셀·가시성을 추출한다. 미검출은 null이다. 폰 미리보기에 왼손 파란 점·오른손 주황 점, 좌표·전송 개수·서버 수신 프레임·관절 시계 상태를 표시한다. 모델 로딩/추론 실패 시에도 영상 송신은 유지한다. 방 2는 폰 추론을 실행하지 않는다.

PC 영상에도 같은 양손 손목 점을 표시한다. 폰에서 이미 계산한 최신 손목 결과를 축소된 송신 canvas에 비율대로 그린 뒤 WebRTC/JPEG로 보낸다. 추가 추론·관절 응답 대기·네트워크 왕복을 넣지 않으며 기존 별도 관절 메시지는 유지한다. 미검출·200ms 초과 결과·원본 크기 불일치·추론 종료 후에는 점을 그리지 않는다. 최신 좌표를 재사용하는 시각화이며 영상 프레임과 관절의 정밀 정합/실측 지연 완료를 뜻하지 않는다. 방 2는 영상 전용을 유지한다.

관절도 `/ws/single/signaling` 연결을 사용한다. 내부 payload는 기존 카메라 v0.1 계약이며 서버 응답도 같은 pose 봉투를 쓴다.

```json
{"schema":"room.v1","type":"pose","room_id":"room-1","payload":{"schema_version":"0.1","type":"camera_hello","camera_id":"C0","device_id":"joined-device-id","stream_id":"new-stream-uuid","clock_id":"page-clock-id","source":"live"}}
```

- camera_hello → camera_ack → pose_2d 순서다. 서버는 room-1 camera 역할·카메라 번호·device_id를 확인하고 기존 runtime.registry에 등록한다. 다른 슬롯/기기 사칭은 거부하며 기존 중복·기기 바인딩·입력 검증을 유지한다. joined에는 device_id를 포함한다.
- 폰 ID는 기존 `/camera/`와 `smash.device_id`를 공유한다. 기존 ID가 없으면 과거 `smash.room.camera.device`를 이관한다. camera_ack.expected에 보정 ID·영상 설정이 있으면 원본 크기/회전이 일치할 때만 해당 ID를 송신한다. 서버의 기기/보정 일치 검사도 유지한다.
- 서버 clock_ping에 폰 performance.now()로 clock_pong을 답해 기존 DeviceClock을 동기화한다. 촬영 시각은 requestVideoFrameCallback.captureTime이 있을 때만 rvfc_capture_time으로 표시한다. 없으면 capture_time_ms=null/timestamp_source=unknown이다. 서버 수신/영상 전송 준비 시각으로 대신하지 않는다.
- 수신 검증 후 pose_received(stream_id/frame_id/clock_ready)를 반환한다. 전송 개수와 서버 수신 확인은 구분한다. 관절 오류는 내부 error(code/detail)로 반환하며 영상 연결은 유지한다.
- 원본 영상 크기가 바뀌면 새 stream_id로 재등록·ACK 후 frame_id=0부터 보낸다. 퇴장/재입장은 모델·프레임 콜백·관절 시계 태스크·소유 스트림을 정리한다. 이전 연결 종료가 새 연결의 스트림을 삭제하지 않는다.
- 영상의 최신 프레임 큐와 관절 처리는 구분한다. 같은 방 WS를 공유하므로 송신 버퍼64KiB 초과 시 관절 프레임은 버리고 등록/시계 제어는 유지한다. 실제 망에서 영상·관절 지연 영향은 측정해야 한다. 기존 `/ws/pose`는 공개하지 않는다.

## 8. 미연결·검증 범위

선택 head 필드는 {u_px,v_px,visibility} 중심점1개 또는 null이다. 폰 내부에서 양 귀 중점을 우선 사용하고, 불가능하면 양 눈 중점·코 위치 순으로 대표점을 추정한다. 코/눈/귀 각각의 좌표·표정 정보는 송신하지 않는다. 유한 픽셀·가시성[0,1]과 정확한3개 키를 검증하고 최신 Pose2D.head에 보관한다. body22개와 joints 손목은 유지하며 head 없는 이전 입력도 받는다. 폰/PC에는 노란 머리 대표점1개만 표시한다. 두 귀가 보이지 않을 때는 해부학적 머리 중심이 아닌 근사 위치다. 기존 Pose 모델을 재사용하며 얼굴 메시·표정 분석·머리3D 복원은 포함하지 않는다.

- 방 1 관절은 기존 추적 런타임에 연결됐다. `/ws/pose3d`는 서버 실행 단위 ID를 유지하며 video_check 게임 UUID와 동일시하지 않는다. 소비자 화면·실제게임 연결은 별도다.
- 단일 모드 PC 추론·타격, 다중 모드 실측 보정·3D 복원 연결, 실제게임 점수·타격/성능 영구 로그는 후속이다.
- 단위/서버 테스트와 Edge 모의 UI는 통과 기록이 있다. 실제3대·폰QR 스캔·다른 망·장시간·정량 지연은 미검증이다. 사용자 영상 정상 보고와 에이전트 실기기 검증은 구분한다.
