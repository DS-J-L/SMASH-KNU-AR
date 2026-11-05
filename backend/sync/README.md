# 시계 보정과 프레임 정렬 · T06

정경호 구현, 김태이 실기기 검증.

- `clock.py` (구현): 스트림별 `clock_ping`/`clock_pong` 표본으로 기기 시계 → 서버 시계 오프셋을 추정합니다. 최근 20개 중 RTT가 가장 짧은 표본을 쓰고 RTT의 절반을 불확실성으로 기록합니다. `clock_id`가 바뀌면 표본을 버립니다.
- `frame_aligner.py` (구현): 가장 늦은 카메라에 맞춘 기준 시각 T(단 `max_wait_ms` 이상 늦은 카메라는 기다리지 않음)에서 카메라별 최근접 프레임을 고르고, 촬영 시각 차이가 `max_skew_ms`를 넘으면 제외합니다. `align_mode=interpolate`는 D08 제안 옵션입니다.

폰별 `performance.now()`는 그대로 비교하지 않습니다. 촬영 메타데이터·영상 표시 시각·추론 시각·서버 수신 시각을 구분하며, 3D에는 `tracking.allowed_timestamp_sources`에 있는 출처만 씁니다(기본 `capture_metadata`). 시계 오프셋은 기기 시계 차이를 맞출 뿐, 센서 노출 시각과 브라우저 시각의 차이까지 없애지는 못합니다. 공통 사건(광원·보드 동작)으로 상대 지연을 확인하는 실기기 검증이 남아 있습니다.

허용 시간차 45ms 등은 파일럿으로 조정할 제안값입니다. 검증: `tests/test_sync.py`, `tests/test_tracking.py`(합성).
