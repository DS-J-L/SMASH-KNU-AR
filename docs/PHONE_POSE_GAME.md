# 폰 좌표 → 팀원 2D 게임 연결

2026-11-06 로컬 구현. 기존 방별 영상 확인과 `/monitor/single/`은 유지한다.

## 실행 결과와 확인 순서

1. 서버를 재시작하고 PC 인증 후 방 1 또는 방 2에 입장한다. 한 대로 시험하려면 방 2를 사용한다.
2. 방 1은 기존 고정 QR로 C0·C1·C2 세 대, 방 2는 해당 방 QR로 C0 한 대를 연결한다. **C0는 서버 중계**를 선택한다. C0 WebRTC는 이번 좌표/영상 짝 전달의 대상이 아니다.
3. 해당 방의 **폰 좌표로 2D 게임 · C0 서버 중계** 링크를 연다. 주소는 `/monitor/phone-game/?room=room-1` 또는 `/monitor/phone-game/?room=room-2`다. 방마다 PC 한 명이므로 같은 탭에서 이동한다.
4. **휴대폰 연결 준비**를 누른다. 방별 필수 카메라의 최근 영상, C0 짝지어진 영상·손목, 건물 준비가 충족되면 시작할 수 있다. 방 2는 C1·C2를 요구하지 않는다.
5. 60초 동안 C0 영상 위 IT 1호관을 손목으로 빠르게 가로지르면 기존 팀원 모듈이 타격을 판정한다. 유효 타격 한 번에 건물 파편 96개·타격음·100점이 나온다. 현재 건물은 한 번만 파괴되며 복원 후 새 게임을 시작한다.
6. **연결 중지**로 끝낼 수 있다. 복원·재연결 후 다시 시작할 수 있고, 필수 카메라 이탈/영상 정지 또는 C0 짝지어진 좌표 1.5초 중단은 자동 중지한다. 재접속만으로 자동 재개하지 않는다.

팀원 게임의 2D 충돌·파편·소리·게임 컨트롤러를 재사용한다. C1·C2는 방 1의 준비/중단 조건에 참여하며 이 게임의 타격 좌표는 C0만 사용한다. 실제 공간의 3D 손목·미터 단위 충돌·보정 완료를 뜻하지 않는다.

2026-11-06 방 2 확장: 두 방의 C0 입력과 세션·점수는 분리한다. 방 1 관측은 기존 runtime registry/3D 입력으로 보내고, 방 2는 별도 room-local registry에 보관한다. 방 2의 등록·재접속·종료는 방 1 C0를 교체하거나 3D 관측에 섞이지 않는다. 방 2도 폰에서 MediaPipe로 관절을 계산하며, 방 1 보정값을 방 2에 자동 적용하지 않는다.

## 연결 계약

- 폰은 한 canvas 스냅샷으로 MediaPipe를 실행하고 같은 스냅샷을 JPEG로 보낸다. 영상 `frame_id`와 별도로 `pose_stream_id`/`pose_frame_id`를 실어 서버가 현재 소켓·기기·등록 스트림·최신 수신 관측과 대조한다.
- 서버 `backend/ingest/game_pose.py`는 기존 원시 픽셀 관측을 보존하고 게임용 `wrists.left_wrist/right_wrist`를 추가로 만든다. `image_norm=[u_px/width,v_px/height]`, `valid`, `visibility`, `reason`을 사용한다. 미검출·영상 밖·가시성 0.5 미만은 무효이며 좌표는 null이다. 전신·머리는 기존 송신 경로를 유지한다.
- JPEG `phone_pose`에는 원본 관측의 `stream_id`/`frame_id`가 붙는다. PC는 표시할 JPEG에 포함된 좌표만 사용하며 별도 최신 좌표와 섞지 않는다. PC에서 MediaPipe를 다시 실행하지 않는다.
- 어댑터는 기존 `room.v1` 방/인증/신호 연결을 팀원 소비자의 `single_camera.v1-draft` 로컬 컨텍스트에 연결한다. 서버 전체 프로토콜을 팀원 초안으로 교체한 것은 아니다. `run_id`/`transform_version`/세션·프레임 검사는 기존 FrameCoordinator/GameController가 수행한다.
- `observed_at_pc_ms`는 표시 프레임을 PC가 받은 `performance.now()`이며 유효 입력 TTL은 200ms이다. 실제 촬영 시각으로 해석하지 않는다. 원본 촬영 시각 미상은 `capture_time_ms=null`로 유지한다.
- 새 서버 게임 모드는 `phone_2d`다. `game_hit`의 수락 이벤트에 대해 서버가 방·세션·스트림·최근 짝지어진 두 프레임·입력 출처·건물·중복 이벤트를 검사하고 점수를 저장한다. 충돌 판정 자체는 인증된 PC를 신뢰하며 서버에서 기하를 재계산하지 않는다. 기존 `video_check`의 점수 null은 유지한다.
- 정경호 연결 파일: `backend/rooms.py`, `backend/game_sessions.py`, `backend/ingest/game_pose.py`, `frontend/phone-game/`, `web/camera/room/`, `web/shared/`. 이동수의 `frontend/single/main.js`에는 새 입력 모드 선택, 김태이의 기존 hit-detector/hit-sound 모듈에는 호출 연결을 추가했다. 상대 담당자의 인수·실기기 확인을 의미하지 않는다.

## 빌드와 검증

`npm run build:phone-game`으로 `web/monitor/phone-game/`을 생성한다. 기존 단일 화면을 빌드하는 `build:single`은 유지하며 `build:all`에 새 화면 빌드를 포함했다.

- Python: `.venv\Scripts\python.exe -X utf8 -m pytest tests/ -q -p no:cacheprovider --tb=short` — 방 2 확장 후 153개 통과.
- 팀원 JS: `node --test tests/single/*.test.mjs` — 66개 통과.
- 관련 JS: `node --experimental-vm-modules --test tests/test_room_pose.mjs tests/test_room_link.mjs tests/test_server_clock.mjs tests/test_synchronized_video.mjs`.
- 통합 브라우저: `npx playwright test --config playwright.phone-game.config.js` — 방 1/방 2 두 시험 통과. 실제 FastAPI/WS·JPEG·게임·GLB·물리 경로에 합성 canvas 카메라/결정적 관절 추론을 연결했다. 각 방에서 타격100점·파편96개·서버 점수·중지/재연결·추론중단/카메라이탈 자동 중지를 검사한다. 합성 선택 모드나 live 수락 우회 API로 점수를 넣지 않는다.

실제 폰·실제 MediaPipe 모델의 이 화면 통합, 소리 청취, 지연/장시간 성능은 미검증이다. 빌드의 약5MB JS 크기 경고가 있으며 Three/Rapier를 포함한다. 기존 main 병합 충돌은 이 작업에서 해결/스테이지/커밋하지 않는다.
