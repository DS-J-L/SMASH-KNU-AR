# PCK·ANOVA 분석 (사용자 테스트)

- 관련: 이슈 #27 (평가 설계), #30 (저장 전 확인 사항), PR #28 (서버 저장 요청)
- 스크립트: `tools/pck_eval.py`, 테스트: `tests/test_pck_eval.py`

## 1. 하는 일

2대 무대에서 저장한 세션을 읽어 지정 동작 종류별 PCK를 계산하고, 반복측정 ANOVA까지 낸다.

1. 판정 폰(C0·C1) 사진마다, 같은 폰의 관절 프레임 중 폰 시각(`t_ms`)이 가장 가까운 것(150ms 이내)을 고른다.
2. 그 프레임의 3D 관절(폰이 보낸 마커 좌표 그대로)을 그 폰의 보정값으로 사진에 투영한다(예측).
3. 같은 사진에 RTMPose-x(rtmlib `Body(mode="performance")`)를 실행해 관절 13개를 얻는다(정답). 결과는 세션 폴더의 `reference_rtmpose.jsonl`에 캐시한다.
4. 정답 신뢰도가 0.3 미만인 관절은 제외한다. 정답이 있는데 예측이 없으면 틀린 것으로 센다.
5. 예측과 정답의 거리가 몸통 길이(정답의 왼어깨~오른골반)의 0.2배 이내면 맞음으로 센다.
6. `directed_start` 표시와 동작 순서(`--schedule`)로 사진마다 지정 동작 종류를 붙인다.
7. 참가자 × 동작마다 평균 PCK 하나를 만들고, 반복측정 ANOVA(구형성 보정), Friedman, 대응 t(Holm)를 계산한다.

결과는 "참조 모델(RTMPose-x) 대비 PCK@0.2"로 보고한다.

## 2. 입력 형식 (서버가 저장할 것)

```text
<root>/<session_id>/            한 참가자 = 한 세션
  meta.json                     {"session_id": "...", "participant": "P01"}
  calib.jsonl                   mono3d_calib를 받을 때마다 한 줄: {"camera": "C0", "server_ms": ..., "msg": <받은 메시지 그대로>}
  frames/C0/<t_ms>.jpg          mono3d_jpeg 원본 (관절·건물을 그리지 않은 카메라 영상)
  frames.jsonl                  사진 한 장당 한 줄: {"camera", "file": "frames/C0/<t_ms>.jpg", "t_ms", "server_ms"}
  joints.jsonl                  mono3d_frame 한 번당 한 줄: {"camera", "t_ms", "server_ms", "valid", "owner",
                                 "joints": {이름: [x, y, z] | null}}   ← 폰이 보낸 마커 좌표 그대로 (무대 좌표 아님)
  markers.jsonl                 진행 표시 한 줄씩: {"server_ms", "label"}   label = "directed_start" (필수)
```

- `calib.jsonl`의 `msg`에서 쓰는 값: `image.width/height`, `K{fx,fy,cx,cy}`, `camera.R`(행 우선 9개), `camera.t`. 투영식은 `web/test/mono3d/geometry.js`의 `project()`와 같다.
- 사진은 보정 영상을 줄인 것으로 보고, 보정 크기에서 사진 크기로 비율만 바꾼다(좌우 반전 없음).
- 관절 이름은 `web/test/mono3d/mono3d.js`의 `OUTPUT_JOINTS` 13개다.

## 3. 실행

```bash
pip install -r tools/requirements-pck.txt
python tools/pck_eval.py data/local/pck --out data/results/pck --schedule right_punch:20,left_punch:20,kick:20
```

- `--schedule`: `directed_start` 이후의 지정 동작 순서와 초. **팀이 동작 목록을 정하면 이 값을 고정한다.** 기본값은 임시값이다.
- `--mode`: `performance`(기본, 정확도 우선) / `balanced` / `lightweight`. 첫 실행 때 모델 파일을 `~/.cache/rtmlib`에 내려받는다.
- 테스트가 모두 끝난 뒤 실행한다. 게임 중에 실행하면 CPU 부하로 판정이 느려질 수 있다.

## 4. 출력

| 파일 | 내용 |
|---|---|
| `pck_frames.csv` | 사진 × 관절마다 예측·정답 좌표, 거리, 몸통 길이, 맞음 여부, 상태 |
| `pck_summary.csv` | 참가자 × 지정 동작 종류별 평균 PCK (ANOVA 입력) |
| `anova.json` | 동작별 평균, 반복측정 ANOVA, Friedman, 대응 t(Holm), 제외된 참가자, 행 상태 개수 |

상태(`status`): `ok`, `missing_prediction`(예측 없음, 틀림으로 셈), `excluded_low_reference`(정답 신뢰도 낮음, 제외), `no_torso`(몸통 정답 없음, 사진 제외), `no_reference_person`.

## 5. 주의

- ANOVA는 모든 지정 동작을 가진 참가자가 2명 이상이어야 계산된다. 2명이면 구형성 검정을 할 수 없어 보정 없는 결과를 내고 `stat_errors`에 남긴다. 월요일 시연은 3명 이상을 권장한다.
- 원본 사진과 `reference_rtmpose.jsonl`은 `data/local/`에만 둔다. 공개 저장소에 올리지 않는다.
- 실제 사람 사진으로는 아직 확인하지 않았다(합성 데이터로만 시험). 첫 실제 세션에서 `pck_frames.csv`의 예측·정답 좌표가 같은 사람 위에 있는지 몇 장 확인한다.
