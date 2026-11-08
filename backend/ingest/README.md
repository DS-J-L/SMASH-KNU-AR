# 입력 수신 · T01~T03

주 담당 정경호, 휴대폰 담당 김태이. 메시지 형식은 [데이터 계약](../../docs/DATA_CONTRACT.md)의 `/ws/ingest`를 따릅니다.

| 파일 | 상태 | 내용 |
| --- | --- | --- |
| `schemas.py` | 구현 | `register`·`clock_pong`·`pose_2d` 검증. NaN·무한대, 범위 밖 신뢰도, 잘못된 카메라 ID, 거울 좌표, 16KB 초과, 모르는 형식 거부 |
| `registry.py` | 구현 | C0/C1/C2 ↔ device_id ↔ stream_id. 다른 기기의 중복 번호 거부, 같은 기기 재등록은 새 스트림으로 대체, heartbeat 끊김 판정, 스트림별 유한 버퍼 |
| `pose_receiver.py` | 구현 | 등록 정보 대조, 프레임 중복·역순 거부, 서버 수신 시각·정렬 시각·시계 불확실성 기록 |
| `video.py` | 미구현 | C0 영상 경로. 전송 방식은 T03 실기기 지연 측정 후 결정. 관절 큐와 분리 |
| `pc_capture.py` | 해당 없음 | D01에서 PC 추론을 채택할 경우에만 추가 |

검증: `tests/test_ingest.py`(TestClient로 등록·중복·재연결·검증 오류·heartbeat). 실제 휴대폰 3대 수신은 김태이의 송신 연결 후 확인해야 하며 아직 미검증입니다.

## 카메라 브랜치 호환 (2026-10-30)

camera_protocol.py가 /ws/pose의 camera_hello·camera_ack·시계 필드를 내부 계약에 연결합니다. 기존 /ws/ingest는 유지합니다. 재생은 합성으로 표시하고 visibility 미상은 관측 없음으로 처리합니다. 구체적인 필드·재연결·촬영 시각 규칙은 docs/DATA_CONTRACT.md의 카메라 브랜치 호환 절을 따릅니다.
