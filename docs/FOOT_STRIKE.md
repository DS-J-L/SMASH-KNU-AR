# 발차기(발목) 타격 — 판정 규칙과 연결 요청

작성: 김태이 (2026-11-10). 손목에 더해 **발목도 건물을 부수는 관절로 넣는다**는 팀 결정(11-09)을 구현하기 위한 문서다. 이 PR은 김태이 파일만 바꾸고, 다른 사람 파일에 연결하는 일은 아래 [4장](#4-연결-요청-김태이가-수정하지-않음)에 요청으로 남긴다.

## 1. 이 PR에 들어간 것

| 파일 | 내용 | 지금 동작에 주는 영향 |
| --- | --- | --- |
| `frontend/single/hit-detector.js` | 2D 판정이 `pose.ankles.left_ankle/right_ankle`도 검사. 발목은 속도 기준을 따로 둠(`minAnkleSpeedNormPerS`). `config_version` `hit-2d-2` | 없음. 지금은 PoseFrame에 `ankles`가 없어 두 발목이 `invalid_ankle`로 끝남. 배포된 화면 번들(`web/monitor/*/assets`)은 다시 빌드하지 않음 |
| `frontend/single/pose-adapter.js` | PC 추론 경로에서 MediaPipe 27/28을 `ankles`로 추가 | PC 추론 경로를 쓰는 화면에서만. 손목 결과는 그대로 |
| `backend/foot_strike.py` | 3D 발차기 판정(카메라 3대 `/test/multi3d/` 서버용) | 없음. 아직 아무 곳에서도 부르지 않음 |
| `web/shared/foot-strike-3d.js` | 같은 3D 판정의 브라우저판(카메라 1대 `/test/mono3d/`용) | 없음. 아직 아무 곳에서도 불러오지 않음 |
| `tests/fixtures/foot_strike_cases.json` | 두 3D 판정이 똑같이 통과해야 하는 공용 사례 12개 | — |

## 2. 2D 판정(화면 위 건물, `single_view_2d`)

손목과 같은 규칙에 발목을 더했다: 연속한 두 유효 프레임 사이 선분이 건물 삼각형에 **들어가고**, 그 전에 건물 밖에서 보였고(무장), 충분히 빠르고, cooldown이 지났으면 타격 한 번.

- 발목 데이터 모양은 손목과 같다: `ankles.left_ankle = { valid, image_norm: [x, y], visibility, reason }`.
- 속도 기준: 손목 0.5, 발목 **0.8** 화면 대각선/초. 걷는 발도 건물 아래쪽 가장자리로 들어가기 때문에 더 빠른 진입만 발차기로 본다. 실제 폰으로 조정하지 않은 시작값이다.
- 한 프레임에 손과 발이 같이 들어오면 먼저 들어간 쪽 하나만 이벤트가 된다(기존 규칙 그대로).
- 이벤트의 `joint`가 `left_ankle`/`right_ankle`이 될 수 있다.

## 3. 3D 판정(바닥 마커 좌표, `/test/mono3d/`·`/test/multi3d/`)

좌표는 두 시험 페이지와 같다: 바닥 마커 기준 m, x·y는 바닥, z는 위, 바닥 z=0. 건물 상자는 `{center, half, margin?}`(바닥부터 허리 높이)로 `test_multi3d.py`의 `box()`·mono3d `buildingBox()` 결과를 그대로 넣으면 된다.

손목은 "상자에 들어왔는가"만 보면 되지만 발은 그렇지 않다. 건물이 바닥에 서 있어서 **그냥 한 걸음 딛어도 발목이 상자에 들어간다.** 그래서 발목은 아래를 모두 만족해야 타격이다.

| 순서 | 조건 | 기본값 | 실패 사유 |
| --- | --- | --- | --- |
| 1 | 발목이 보임(유한한 3D 점) | — | `invalid` |
| 2 | 이번 프레임에 상자에 들어감(안에 있음 또는 프레임 사이 선분이 통과), 직전에는 밖 | — | `outside` / `already_inside` |
| 3 | 직전 점과 이어짐(250 ms 이내, 1.5 m 이내) | `max_gap_ms` 250, `max_jump_m` 1.5 | `baseline`(직전 점 없음) / `gap` |
| 4 | 발을 들어 올림: 발목 높이 | `min_lift_m` **0.20 m** | `too_low` |
| 5 | 빠르게 움직임: 직전 프레임 대비 발목 속도 | `min_speed_mps` **1.5 m/s** | `too_slow` |
| 6 | 딛고 있는 발이 건물 자리 밖 | `stand_clearance_m` 0.10 m | `standing_in_building` |
| 7 | 같은 발의 직전 타격에서 300 ms 지남 | `cooldown_ms` 300 | `cooldown` |

- **딛고 있는 발** = 0.20 m보다 낮은 발목 중 더 낮은 것. 둘 다 들려 있거나 안 보이면 두 골반의 평균. 지금 `test_multi3d.py`는 두 발목의 **평균**으로 "건물 자리에 서 있음"을 정하는데, 발차기 중에는 평균이 건물 쪽으로 반쯤 옮겨가서 **발차기 자체가 막힐 수 있다.** 공용 사례 `kick_from_beside_the_building_is_not_blocked_by_the_mean_of_both_feet`가 이 경우다(딛는 발 x=0.72, 차는 발 x=1.0 → 평균 0.86은 막히는 범위).
- 들어갔지만 거부된 발은 상자 밖으로 나갔다 와야 다시 찰 수 있다.
- 결과: `{hit: {right_ankle: "inside"|"swept"}, decisions, speed_mps, support, standing_in_building, hits, config_version}`.
- 숫자는 모두 시작값이며 실제 폰으로 조정하지 않았다.

사용 예(파이썬):

```python
from backend.foot_strike import FootStrikeJudge
judge = FootStrikeJudge()                        # 사람 한 명당 하나
out = judge.update({n: joints[n]["p"] if joints.get(n) else None
                    for n in ("left_ankle", "right_ankle", "left_hip", "right_hip")}, box, t_ms)
```

브라우저(`/shared/foot-strike-3d.js`, 접속 키가 있는 페이지에서 불러올 수 있음):

```js
import { FootStrikeJudge } from '/shared/foot-strike-3d.js';
const judge = new FootStrikeJudge();
const out = judge.update(Object.fromEntries(['left_ankle', 'right_ankle', 'left_hip', 'right_hip']
  .map((n) => [n, result.joints[n]?.position_m ?? null])), { ...box, margin }, t);
```

mono3d처럼 여유값(`margin`)을 따로 들고 있으면 위처럼 상자에 넣어 준다. 넣지 않으면 0으로 본다.

## 4. 연결 요청 (김태이가 수정하지 않음)

### 정경호

1. **폰 좌표 게임에 발목 전달** — `backend/ingest/game_pose.py`가 지금 `wrists`만 만든다. 폰은 이미 `body`에 발목(`left_ankle`/`right_ankle`)을 보내고 `schemas.py`도 받는다. 같은 모양으로 `ankles`를 추가해 주면 2D 발차기가 켜진다.
2. **카메라 3대 `/test/multi3d/`** — `backend/test_multi3d.py`의 손목 반복문 옆에서 `FootStrikeJudge.update()`를 부르고, 결과의 `hit`를 `hits`·`hit`에 합치기. "건물 자리에 서 있음"은 이 판정의 `standing_in_building`(딛는 발 기준)으로 바꾸는 것을 제안(위 3장 이유). `view.js`의 궤적·표시에 발목 추가.
3. **카메라 1대 `/test/mono3d/`** — `app.js` 측정 단계에서 같은 방식으로 `foot-strike-3d.js` 연결. 주의: mono3d는 **발이 바닥에 닿아 있다고 보고** 거리를 잡는다(`floorAnchor`). 한 발을 들면 그 발이 기준에 들어가 깊이가 틀어질 수 있으니, 들린 발(높이 0.20 m 이상)을 기준에서 빼는지 확인 필요.

### 이동수

1. **게임이 발 타격을 받도록** — `frontend/game/controller.js`의 `JOINTS = ['left_wrist', 'right_wrist']` 때문에 `joint`가 발목인 이벤트는 거부된다. 발목을 추가하고 `setPose()`의 짝 프레임 기록에도 `pose.ankles`를 넣어야 한다.
2. **폰 좌표 화면** — `frontend/single/main.js` 17행이 `phone_pose.wrists`만 넘긴다. `ankles: meta.phone_pose.ankles`를 같이 넘기고, 손목 점 표시에 발목도 그리기.
3. 위 수정 뒤 `npm run build:single`·`build:phone-game`으로 화면 번들을 다시 만들어야 실제 화면에 반영된다.
4. (PM) 인터페이스·범위 변경 기록 — `PoseFrame`에 `ankles`가 생기고 HitEvent `joint`에 발목이 들어온다. `docs/SINGLE_CAMERA_INTERFACES.md`의 PoseFrame·HitEvent 행과 `PM_progress.md`에 11-09 결정·영향을 남겨 주기(공유·PM 파일이라 김태이가 고치지 않음).

### 순서

이동수 1·2를 정경호 1과 **같이 또는 먼저** → 2D 발차기 실폰 시험. 정경호 2·3 → 3D 발차기 시험.
정경호 1만 먼저 들어가면 발목 타격은 게임에서 `invalid_units_or_fields`로 거부되고(점수·소리 없음), 손과 발이 **같은 프레임**에 들어오면 발 쪽이 먼저일 때 그 프레임의 손 타격도 밀려난다(한 프레임에 이벤트 하나). 그래서 순서를 지켜 주는 것이 좋다.

연결 작업은 이 PR이 머지된 뒤 **각자 자기 브랜치에서** 해 주세요. 이 PR 브랜치(`feat/foot-strike`)에 직접 커밋하면 충돌이 날 수 있습니다.

## 5. 미검증·조정할 것

- 실제 폰 시험 없음. 2D 발목 속도 0.8, 3D 들어 올림 0.20 m·속도 1.5 m/s는 모두 시작값.
- 카메라에 **발끝까지** 보여야 한다. 그만큼 멀어지면 손목 인식이 약해질 수 있다.
- 빠른 발은 흐려져 MediaPipe 신뢰도가 떨어질 수 있다(`invalid`가 늘어남).
- 걷기·뛰기·제자리 발 구르기가 타격으로 잡히지 않는지, 발차기가 놓치지 않는지 실폰 시험 필요.
