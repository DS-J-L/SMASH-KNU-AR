# PCK 계산용 데이터 저장 요청 (2대 무대)

- 작성: 김태이 (2026-11-25 작성, 2026-11-27 수정)
- 요청 대상: 정경호 (서버·로그 담당)
- 관련: 이슈 #27 (평가 설계), #30 (저장 전 확인 사항), `docs/PCK_EVAL.md` (분석 스크립트)

## 1. 목적과 일정

이슈 #27은 사용자 테스트에서 지정 동작 종류마다 PCK 평균이 다른지를 반복측정 ANOVA로 비교한다. 분석 스크립트(`tools/pck_eval.py`)는 저장된 세션을 읽어 PCK와 ANOVA를 계산한다. 이 문서는 그 스크립트가 읽는 형식대로 서버가 테스트 중 데이터를 저장하도록 요청한다.

- 월요일(11/30): 최종 시연. 저장 → PCK → ANOVA 결과까지 확인 (팀원 3명 이상이 참가자 역할)
- 수요일(12/2): 참가자 9명 본 실험

## 2. 결정 사항 (2026-11-27 정경호 답변)

| 항목 | 결정 |
|---|---|
| 테스트 경로 | 2대 무대 (`/test/building/?mode=duo`, 판정 폰 C0·C1 + 화면 폰 V) |
| 관절 | 13개 (`web/test/mono3d/mono3d.js`의 `OUTPUT_JOINTS`) |
| 방식 | 테스트 중 영상과 관절 로그를 전부 저장하고, PCK는 테스트 완료 후 계산 |
| 보관 | 영상은 테스트 PC 밖으로 옮겨 비공개로 보관 |

## 3. 현재 상태 (main `eba1771` 기준)

2대 무대 서버(`backend/test_wide3d.py`)는 받은 데이터를 메모리에만 둔다(`docs/WIDE_STAGE_TEST.md` "저장은 하지 않는다").

| 데이터 | 보내는 쪽 | 서버 수신 | 비고 |
|---|---|---|---|
| `mono3d_jpeg` | C0·C1 | 받음 | 폭 480px, 약 5장/초, `t_ms`는 폰 시각 |
| `mono3d_frame` | C0·C1 | 받음 | 13개 관절의 3D 위치(폰의 마커 좌표). 서버는 `shift_joints`로 무대 좌표로 옮겨 씀 |
| `mono3d_calib` | C0·C1 | 받음 | `image`, `K`, `camera.R/t` |
| 화면 폰 영상 | V | WebRTC면 받지 않음 | JPEG 중계일 때만 받음 |

## 4. 요청 사항 (월요일 시연 전 필수)

1. **세션 시작/종료:** PC 화면에 참가자 코드(P01~P09) 입력칸과 시작·종료 버튼. 시작하면 세션 폴더를 만들고 저장을 켜며, 종료하면 끈다. 한 참가자(연습·지정 동작·자유 동작 전체)가 한 세션이다. 세션이 없을 때는 저장하지 않는다.
2. **지정 동작 시작 표시:** "지정 동작 시작" 버튼. 누르면 `markers.jsonl`에 `directed_start` 한 줄을 쓴다.
3. **원본 영상:** C0·C1의 `mono3d_jpeg`를 받은 그대로 저장한다. 관절 선·건물을 그린 화면은 쓰지 않는다.
4. **관절 로그:** `mono3d_frame`을 **받은 메시지 그대로** 저장한다(가공 없음, `shift_joints` 적용 전). 그 프레임을 처리한 뒤 `camera == hub.owner`인지를 `owner`로 함께 남긴다.
5. **보정값:** 세션을 시작할 때 C0·C1의 현재 보정값을 먼저 쓰고, 이후 `mono3d_calib`를 받을 때마다 받은 메시지 그대로 추가한다. 폰은 보정값이 바뀔 때만 보내므로, 서버가 카메라별 마지막 `mono3d_calib` 원본을 들고 있어야 한다(지금 `hub.calibs`에는 가공된 값만 있다).
6. **시각:** 폰 시각(`t_ms`)과 서버 수신 시각(`server_ms`)을 함께 남긴다.
7. **판정 지연 방지:** 파일 쓰기는 큐나 별도 스레드로 처리한다.

선택: 화면 폰(V) 원본 영상(JPEG 중계일 때), `free_start` 등 다른 진행 표시.

## 5. 저장 형식 (분석 스크립트 입력과 같음)

```text
data/local/pck/<session_id>/
  meta.json        {"session_id": "...", "participant": "P01"}
  calib.jsonl      {"camera": "C0", "server_ms": ..., "msg": <받은 mono3d_calib 그대로>}
  frames/C0/<t_ms>.jpg
  frames.jsonl     {"camera": "C0", "file": "frames/C0/<t_ms>.jpg", "t_ms": ..., "server_ms": ...}
  joints.jsonl     {"camera": "C0", "server_ms": ..., "owner": true, "msg": <받은 mono3d_frame 그대로>}
  markers.jsonl    {"server_ms": ..., "label": "directed_start"}
```

필드 이름을 바꾸면 `tools/pck_eval.py`도 같이 바꿔야 한다. 바꿀 때는 이 PR이나 #30에 알려 준다.

## 6. 보관

- `data/local/`은 `.gitignore`에 포함되어 있어 커밋되지 않는다.
- 영상에 참가자 얼굴이 포함되므로 공개 저장소에 올리지 않는다. 테스트 후 테스트 PC 밖의 비공개 공간에 보관한다.

## 7. 완료 기준

- [ ] 참가자 코드를 넣고 시작 → 지정 동작 시작 → 1분 → 종료하면 5의 파일이 모두 생긴다.
- [ ] 그 폴더로 `python tools/pck_eval.py data/local/pck`를 실행하면 `pck_summary.csv`가 나오고, `anova.json`의 `projection_check_px` 중앙값이 3px 이하다(참가자 3명 이상이면 ANOVA 결과도 나온다). 분석용 패키지는 서버와 다른 가상환경에 설치한다(`docs/PCK_EVAL.md` 3절).
- [ ] 세션을 시작하지 않으면 기존과 동일하게 동작한다.

## 8. 확인 필요

- 테스트 중 화면 폰(V)을 WebRTC로 쓰는지, JPEG 중계로 쓰는지
- 테스트 후 영상을 옮겨 둘 장소
