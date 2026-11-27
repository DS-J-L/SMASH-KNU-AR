# PCK·ANOVA 분석 (사용자 테스트)

- 관련: 이슈 #27 (평가 설계), #30 (저장 전 확인 사항), `docs/PCK_DATA_REQUEST.md` (서버 저장 요청)
- 스크립트: `tools/pck_eval.py`, 테스트: `tests/test_pck_eval.py`

## 1. 하는 일

2대 무대에서 저장한 세션을 읽어 지정 동작 종류별 PCK를 계산하고, 반복측정 ANOVA까지 낸다.

1. 판정 폰(C0·C1) 사진마다 그 사진을 설명하는 관절 프레임을 고른다. 폰은 사진에 추론 시각을, 관절 프레임에 그보다 늦은 전송 시각을 붙이므로(`web/test/mono3d/app.js` `sendToPc`), **사진 시각 이후 첫 프레임**(150ms 이내)을 쓴다. 가장 가까운 프레임을 고르면 한 추론 전의 관절이 잡힐 수 있다.
2. 그 프레임의 3D 관절(폰이 보낸 마커 좌표)을 그 폰의 보정값으로 사진에 투영한다(예측).
3. 같은 사진에 RTMPose-x(rtmlib `Body(mode="performance")`)를 실행해 관절 13개를 얻는다(정답). 결과는 세션 폴더의 `reference_rtmpose.jsonl`에 캐시한다.
4. 정답 신뢰도가 0.3 미만인 관절은 제외한다. 정답이 있는데 예측이 없으면 틀린 것으로 센다.
5. 예측과 정답의 거리가 몸통 길이(정답의 왼어깨~오른골반)의 0.2배 이내면 맞음으로 센다.
6. `directed_start` 표시와 동작 순서(`--schedule`)로 사진마다 지정 동작 종류를 붙인다.
7. 그 순간 판정하던 폰(`owner`)의 사진만 채점한다(`--all-cameras`로 끌 수 있다).
8. 참가자 × 동작마다 평균 PCK 하나를 만들고, 반복측정 ANOVA(구형성 보정), Friedman, 대응 t(Holm)를 계산한다.

결과는 "참조 모델(RTMPose-x) 대비 PCK@0.2"로 보고한다.

### 이 PCK가 재는 것

폰의 3D 관절은 MediaPipe 2D 관절의 시선 위에 놓인 점이다(`web/test/mono3d/mono3d.js` `estimate`의 `closestOnRay`). 그래서 사진에 투영하면 폰이 찾은 2D 관절 위치로 돌아온다. 이 PCK는 **판정 폰 화면에서 관절을 얼마나 정확히 찾았는가**를 재며, 깊이(앞뒤) 오차는 재지 않는다. 3D 정확도로 보고하지 않는다.

## 2. 입력 형식 (서버가 저장할 것)

```text
<root>/<session_id>/            한 참가자 = 한 세션
  meta.json                     {"session_id": "...", "participant": "P01"}
  calib.jsonl                   {"camera": "C0", "server_ms": ..., "msg": <mono3d_calib 받은 그대로>}
                                세션 시작 때 현재 보정값을 한 줄 쓰고, 이후 받을 때마다 추가
  frames/C0/<t_ms>.jpg          mono3d_jpeg 원본 (관절·건물을 그리지 않은 카메라 영상)
  frames.jsonl                  {"camera": "C0", "file": "frames/C0/<t_ms>.jpg", "t_ms": ..., "server_ms": ...}
  joints.jsonl                  {"camera": "C0", "server_ms": ..., "owner": true, "msg": <mono3d_frame 받은 그대로>}
  markers.jsonl                 {"server_ms": ..., "label": "directed_start"}
```

- `mono3d_frame`은 받은 그대로 저장한다. 스크립트는 `msg.t_ms`, `msg.valid`, `msg.joints`(폰의 마커 좌표, `shift_joints` 적용 전), `msg.landmarks`를 읽는다.
- `owner`는 그 프레임을 처리한 뒤 `camera == hub.owner`인지다.
- `calib.jsonl`의 `msg`에서 쓰는 값: `image.width/height`, `K{fx,fy,cx,cy}`, `camera.R`(행 우선 9개), `camera.t`. 투영식은 `web/test/mono3d/geometry.js`의 `project()`와 같다.
- 사진은 보정 영상을 줄인 것으로 보고, 보정 크기에서 사진 크기로 비율만 바꾼다.
- 시각: `t_ms`는 폰 시각(같은 폰의 사진과 관절을 맞출 때), `server_ms`는 서버 수신 시각(동작 구간을 나눌 때). `server_ms`와 `markers.jsonl`은 같은 시계여야 한다.

## 3. 실행

분석용 패키지는 **서버와 다른 가상환경**에 설치한다. rtmlib이 `opencv-python`을 끌어와 서버의 `opencv-python-headless` 고정 버전과 충돌한다.

```bash
python -m venv .venv-pck
.venv-pck/bin/pip install -r tools/requirements-pck.txt
.venv-pck/bin/python tools/pck_eval.py data/local/pck --out data/results/pck --schedule right_punch:20,left_punch:20,kick:20
```

- `--schedule`: `directed_start` 이후의 지정 동작 순서와 초. **팀이 동작 목록을 정하면 이 값을 고정한다.** 기본값은 임시값이다.
- `--mode`: `performance`(기본, 정확도 우선) / `balanced` / `lightweight`. 첫 실행 때 모델 파일을 `~/.cache/rtmlib`에 내려받는다(performance 약 550MB, balanced 약 145MB, lightweight 약 40MB). 시연 전에 미리 받아 둔다.
- 테스트가 모두 끝난 뒤 실행한다. 게임 중에 실행하면 CPU 부하로 판정이 느려질 수 있다.

## 4. 출력

| 파일 | 내용 |
|---|---|
| `pck_frames.csv` | 사진 × 관절마다 예측·정답 좌표, 거리, 몸통 길이, 맞음 여부, 상태 |
| `pck_summary.csv` | 참가자 × 지정 동작 종류별 평균 PCK(ANOVA 입력)와 추적 성공률(`tracked_rate`) |
| `anova.json` | 동작별 평균, 반복측정 ANOVA, Friedman, 대응 t(Holm), 제외된 참가자, 행 상태 개수, 투영 자가 점검 |

- 상태(`status`): `ok`, `missing_prediction`(예측 없음, 틀림으로 셈), `excluded_low_reference`(정답 신뢰도 낮음, 제외), `no_torso`(몸통 정답 없음, 사진 제외), `no_reference_person`.
- `tracked_rate`: 그 칸의 사진 중 시스템이 관절을 하나라도 낸 비율. 추적이 끊긴 사진은 PCK에서 모든 관절이 틀린 것으로 들어가므로 함께 보고한다.
- `projection_check_px`: 투영한 관절과 폰이 보낸 2D 관절(`landmarks`)의 거리. 0~2px가 정상이다. 3px를 넘으면 보정값·사진 크기·좌우 반전이 맞지 않는 것이므로 PCK를 믿지 않는다.

## 5. 주의

- ANOVA는 모든 지정 동작을 가진 참가자가 2명 이상이어야 계산된다. 2명이면 구형성 검정을 할 수 없어 보정 없는 결과를 내고 `stat_errors`에 남긴다. 시연은 3명 이상을 권장한다.
- 원본 사진과 `reference_rtmpose.jsonl`은 `data/local/`에만 둔다. 공개 저장소에 올리지 않는다.
- 확인한 것(2026-11-27): 합성 세션 테스트 8개, 패키지만 설치한 새 가상환경(Python 3.10)에서 테스트 통과, lightweight 모델로 명령줄 실행.
- 확인하지 못한 것: 실제 사람 사진에서의 RTMPose 결과, performance 모델의 처리 시간, Python 3.12, Windows. 첫 실제 세션에서 `projection_check_px`와 `pck_frames.csv`의 예측·정답 좌표를 몇 장 확인한다.
