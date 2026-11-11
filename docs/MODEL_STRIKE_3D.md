# IT1 모델 3D 타격 판정 — 상자 대신 건물 모양으로

작성: 김태이 (2026-11-10, 부분 파괴 2026-11-11). 계획: [김태이_plan.md](../김태이_plan.md) P4 "실제 3D 궤적 충돌·타격 이벤트". PR #10의 3D 시험(`/test/mono3d/`, `/test/multi3d/`)은 바닥 마커 자리의 **상자**로 타격을 센다. 이 문서는 그 상자 대신 이동수님 **IT1 모델(`knu-it1-v3`)의 실제 모양**으로 손목·발목 타격을 판정하는 모듈과, 화면·서버에 연결하는 요청을 적는다. 한 번 맞으면 건물 전체가 아니라 **맞은 곳 주변 블럭 3개만 부서지고, 바닥까지 이어진 블럭이 하나도 없게 된 부분만 떨어진다**(5장). 김태이 파일만 바꾼다.

## 1. 들어간 것

| 파일 | 내용 |
| --- | --- |
| `web/shared/model-strike-3d.js` | 판정 모듈(브라우저). 카메라 1대 `/test/mono3d/` 폰 페이지용 |
| `backend/model_strike.py` | 같은 판정(서버). 카메라 3대 `/test/multi3d/` 서버용 |
| `tests/fixtures/model_strike_cases.json` | 두 판정이 똑같이 통과해야 하는 손 계산 사례 17개(ㄴ자 시험 건물 13개, 블럭 10개 시험 벽 4개) |
| `tests/test_model_strike.py`·`.mjs` | 공용 사례 + 실제 건물 5개(IT1, 본관, 64조각 연습 건물 3개) 검사 |

아직 아무 화면·서버에서도 부르지 않으므로 **지금 동작은 바뀌지 않는다.**

## 2. 건물 모양 = 파편 충돌체 96개의 합

- IT1 패키지의 `colliders.json`은 파편 96개 각각의 볼록 껍질이다(파편 물리가 쓰는 것과 같다). 판정은 이 **96개의 합집합**을 건물로 본다.
- 건물 전체를 껍질 하나로 감싸면 오목한 곳(건물 사이 빈 공간)까지 건물이 된다. 공용 사례 `the_empty_notch_above_the_low_block_is_not_building`이 이 차이를 확인한다.
- 실제 IT1 확인: 바닥 기준 길이 2.81 m · 깊이 0.63 m · 높이 1.08 m(manifest와 일치), 96개 껍질 모두 닫혀 있음, 껍질 합 부피 약 1.60 m³(파편 부피 합 1.56 m³), 껍질끼리 겹침 없음(격자 표본). 만드는 데 브라우저 약 0.05초, 서버 약 0.5초(시작 때 한 번).
- 판정 결과에 **맞은 파편 번호(`fragment_id`)와 맞은 점**, 이번 타격에 **부서진 파편·떨어진 파편 번호**가 함께 나온다. 파편 연출에 그대로 쓸 수 있다.
- 같은 형식(`colliders.json`)이면 다른 건물도 읽는다. 본관(`knu-main-v2`, 85조각)과 연습 건물 3개(`knu-it5-practice-v1`·`knu-library-practice-v1`·`knu-global-practice-v1`, 각 64조각)를 테스트에서 확인한다.

## 3. 마커 위에 놓는 방법(배치) — 화면과 판정이 같은 값을 써야 한다

배치는 `{x_m, y_m, yaw_deg, scale}` 네 값이다. 기본값은 마커 중심, 회전 0, 실제 크기(1).

- 모델 패키지는 three.js **y가 위**, 바닥 가운데 원점이다. 마커 좌표는 **z가 위**다.
- 변환 순서: `(x, y, z) → (x, −z, y)`(y-up → z-up) → `scale` → 위에서 볼 때 반시계로 `yaw_deg` 회전 → `(x_m, y_m, 0)`만큼 이동.
- 기본 배치에서 IT1의 긴 변(2.81 m)은 마커 x축 방향이고, 모델의 +z 쪽(three.js 기준 앞)이 마커 −y 쪽을 향한다.
- 화면에서 같은 배치로 그리려면 `placementToThree(placement)`를 쓴다: z-up 장면에서 바깥 그룹에 `position`·`rotation.z`·`scale`, 그 안의 y-up 모델에 `rotation.x = π/2`. 테스트가 두 변환이 같은지 확인한다.

## 4. 타격 규칙

관절: 왼/오른 손목, 왼/오른 발목. 위치는 마커 좌표 m(정경호 3D 결과 그대로).

| 순서 | 조건 | 실패 사유 |
| --- | --- | --- |
| 1 | 관절이 보임 | `invalid` |
| 2 | 이번 프레임에 **남아 있는** 파편에 들어감(안에 있음 또는 프레임 사이 선분이 통과), 직전에는 밖. 부서진 파편 자리는 빈 공간 | `outside` / `already_inside` |
| 3 | 직전 점과 이어짐(250 ms·1.5 m 이내). **첫 점이나 끊긴 뒤 첫 점은 기준점만** | `baseline` / `gap` |
| 4 | 발목이면 0.20 m 이상 들어 올림 | `too_low` |
| 5 | 속도: 손목 0 m/s 이상(제한 없음), 발목 1.5 m/s 이상 | `too_slow` |
| 6 | 딛고 있는 발이 남은 건물 자리(10 cm 여유) 밖 | `standing_in_building` |
| 7 | 같은 관절 직전 타격에서 300 ms 지남 | `cooldown` |

- 한 프레임에 여러 관절이 들어오면 **먼저 들어간 하나만** 이벤트가 된다(나머지 `simultaneous`). 2D 판정과 같다.
- 모든 파편이 부서지면 `destroyed: true`. 그 뒤로는 칠 곳이 없으므로 모두 `outside`다(전에 있던 `destroyed` 판정 사유는 없앴다).
- `restore()`: 모든 파편 복원, 궤적·cooldown 비움. 건물 안에 손을 둔 채 복원해도 나갔다 들어와야 친다. `reset()`: 새 세션(점수까지 0).
- 지금 `/test/` 페이지와 다른 점: (1) 첫 점이 건물 안이면 타격이 아니라 기준점(계획 P4 "복구 첫 유효 프레임은 기준점만"), (2) "건물 자리에 서 있음"을 두 발 평균이 아니라 딛는 발로 판단([FOOT_STRIKE.md](FOOT_STRIKE.md) 3장 이유), (3) 상자가 아니라 모델 모양.
- 숫자는 모두 시작값이며 실제 폰으로 조정하지 않았다.

이벤트(`hit_3d`): `{schema: "model_strike.v2-draft", event_id, building_id, joint, hit_by: "inside"|"swept", fragment_id, point_m, speed_mps, points: 1, broken_fragment_ids, fallen_fragment_ids, remaining_fragments, t_ms, previous_t_ms, placement, config_version: "model-3d-2"}`. 매 프레임 결과에도 `remaining_fragments`(남은 파편 수)와 `hits`(누적 타격 수 = 점수)가 있다.

## 5. 부분 파괴 — 맞은 곳만 부서지고, 이어진 블럭이 없어지면 떨어진다

팀 결정(김태이, 2026-11-11): **한 번에 블럭 3개**, **받치던 블럭이 부서져 떨어지는 경우가 있되, 블럭 하나라도 이어져 있으면 부서지지 않음**, **타격 하나당 1점**.

1. **부서지는 블럭(`broken_fragment_ids`):** 맞은 파편 + 맞은 점에서 가장 가까운 남은 파편 2개(`break_count: 3`). 첫 번째가 맞은 파편이다.
   - 거리: 맞은 점이 파편 껍질의 가장 바깥 면에서 얼마나 떨어졌는지(안이면 0). 면 쪽에서는 정확하고, 모서리 쪽에서는 조금 짧게 잰다.
   - 거리가 같으면 파편 중심이 더 가까운 것, 그것도 같으면 패키지 순서가 앞선 것. 브라우저·서버가 같은 순서를 쓴다.
2. **떨어지는 블럭(`fallen_fragment_ids`):** 남은 블럭 중 **바닥까지 이어진 길이 끊긴 것**. 함께 부서진 것으로 친다.
   - **이어짐:** 두 블럭이 면을 맞대고 있으면(2 mm 이내) 이어진 것이다. 아래·옆·위 어느 방향이든 **하나라도** 남은 블럭과 이어져 있고, 그 블럭이 다시 바닥까지 이어져 있으면 떨어지지 않는다. 모서리나 꼭짓점만 닿은 것은 이어진 것이 아니다.
   - 그래서 아래 블럭이 부서져도 옆 블럭에 붙어 있으면 남는다. 마지막으로 이어 주던 블럭이 부서질 때 떨어진다. 바닥과 끊긴 덩어리는 서로 붙어 있어도 공중에 뜰 수 없으므로 덩어리째 떨어진다.
   - **바닥에 놓인 블럭:** 바닥(z = 0)에 닿은 것, 또는 밑에 아무것도 없고 바닥에서 15 cm 이내에서 시작하는 것. 연습 건물 3개는 밑면이 평평하지 않아 가장 아래 조각이 0~11 cm 위에서 시작한다. "밑에 있음"은 맞댄 면이 수평에서 60° 이내로 눕혀 있을 때다.
   - 누가 누구와 이어져 있는지는 처음 건물을 만들 때 한 번 계산한다.
3. **점수:** 타격 하나당 1점(`points: 1`). `hits`가 곧 점수다. 몇 개가 부서지든 1점이다.
4. **설정:** `damage_mode` — `partial`(기본, 위 규칙), `whole`(첫 타격에 전부, 예전 동작), `none`(부서지지 않고 계속 셈, 시험용). `break_count` — 한 번에 부서지는 수(기본 3).

실제 건물 확인(테스트): 5개 건물 모두 처음엔 한 조각도 떨어지지 않고, 바닥 조각을 모두 없애면 나머지가 모두 떨어진다. 멀쩡한 건물의 어느 조각을 처음 쳐도 추가로 떨어지는 조각은 거의 없다(본관 두 곳에서 1개). 남은 조각을 차례로 쳐서 다 부수는 한 가지 순서에서는 IT1 25번·본관 24번·연습 건물 17~21번이 걸렸고, 바닥과 끊긴 덩어리가 한 번에 떨어지는 순간이 건물마다 1~3번 있었다(IT1에서 한 번에 최대 17조각).

공용 사례의 시험 벽(마커 좌표, 두께 0.2 m, 정면은 −y):

| 블럭 | x (m) | z (m) | 면을 맞댄 블럭 |
| --- | --- | --- | --- |
| G1·G2·G3 (바닥) | 0–0.5 · 0.5–1.0 · 1.0–1.6 | 0–0.4 | 옆 G, 위 M (G1은 S도) |
| S (바닥, 5 cm 위에서 시작) | −0.4–0 | 0.05–0.3 | G1 |
| M1·M2·M3 | G와 같음 | 0.4–0.8 | 아래 G, 옆 M, 위 T (M3는 H도) |
| T1 | 0–1.0 | 0.8–1.1 | M1·M2·T2 |
| T2 | 1.0–1.6 | 0.8–1.1 | M3·T1 |
| H (밑이 빈 돌출부) | 1.6–2.0 | 0.5–0.8 | M3만 |

- M2 정면(x 0.92, z 0.7)을 치면: M2와 가장 가까운 M3·T2가 부서진다. H는 하나뿐인 이웃 M3가 없어져 떨어진다. T1은 M1과 이어져 남는다.
- G3 정면(x 1.5, z 0.3)을 차면: G3와 가장 가까운 M3·H가 부서진다. T2는 아래 M3가 없어졌지만 옆 T1과 이어져 있어 **남는다**. 다음에 M2를 쳐서 M2·G2·T1이 부서지면 마지막 이웃 T1이 없어져 T2가 떨어진다.

## 6. 사용 예

서버(`/test/multi3d/`):

```python
from backend.model_strike import ModelStrikeJudge, Placement, load_model_target
target = load_model_target(placement=Placement(x_m=0, y_m=0, yaw_deg=0))   # 시작할 때 한 번
judge = ModelStrikeJudge(target)
out = judge.update({n: joints[n]["p"] if joints.get(n) else None for n in
                    ("left_wrist", "right_wrist", "left_ankle", "right_ankle", "left_hip", "right_hip")}, t_ms)
if out["event"]: ...  # 점수 +1, 화면에 broken_fragment_ids·fallen_fragment_ids 전달
```

브라우저(`/test/mono3d/` 폰 페이지):

```js
import { ModelStrikeJudge, loadModelTarget } from '/shared/model-strike-3d.js';
const target = await loadModelTarget('/public/assets/buildings/knu-it1-v3/colliders.json', placement);
const judge = new ModelStrikeJudge(target);
const out = judge.update(Object.fromEntries(['left_wrist', 'right_wrist', 'left_ankle', 'right_ankle', 'left_hip', 'right_hip']
  .map((n) => [n, result.joints[n]?.position_m ?? null])), t);
```

## 7. 연결 요청 (김태이가 수정하지 않음)

**이동수** — 모델·화면·공통 변환 담당
1. **배치 값 정하기:** IT1을 마커 어디에, 어느 방향으로, 몇 배로 놓을지. 기본값은 마커 중심·회전 0·실제 크기. 정해지면 판정과 화면이 같은 값을 쓰도록 한 곳(설정)에 둔다.
2. **3D 화면에 IT1 그리기:** PC 3D 화면(`/test/*/view.html`)에 `placementToThree()`로 IT1 정상 모델을 놓고, `hit_3d` 이벤트의 `fragment_id`·`point_m`으로 파편 연출. 화면 파일은 정경호님 것이므로 두 분이 정해 주세요.
3. **부분 파괴 연출:** 지금 `frontend/game/fragment-bodies.js`의 `spawnFragmentBodies()`는 파편을 **전부** 한꺼번에 풀어 준다. 이벤트의 `broken_fragment_ids`·`fallen_fragment_ids`에 있는 파편만 풀고, 나머지는 제자리에 고정해 주세요. 남은 파편까지 물리로 풀면 화면에서 판정보다 더 많이 무너질 수 있습니다. `restore()`와 화면 복원을 함께 불러 주세요.
4. **점수:** `controller.js`는 지금 건물 하나당 한 번 100점이고 같은 건물을 다시 치면 `already_destroyed`로 거부한다. 3D 판정을 연결할 때 **타격 하나당 1점**(`points`)으로, 남은 파편이 있으면 같은 건물을 계속 받도록 바꿔 주세요.

**정경호** — 3D 좌표·서버·시험 페이지 담당
1. **카메라 3대:** `test_multi3d.py`에서 `box()` 판정 대신(또는 선택으로) `ModelStrikeJudge.update()`를 부르고 결과(`event`, `destroyed`, `remaining_fragments`, `decisions`)를 화면에 보내기. 시작/복원 버튼에 `reset()`/`restore()` 연결.
2. **카메라 1대:** `mono3d/app.js` 측정 단계에서 같은 방식으로 연결. 발을 들면 바닥 기준(`floorAnchor`)이 틀어지는지 확인(발차기 문서 4장과 같은 문제).
3. 폰·서버 결과에 발목·골반 3D 점이 함께 오는지 확인(딛는 발·발차기 판정에 필요).

**PM(이동수)** — `hit_3d` 이벤트(부분 파괴 필드 포함)와 배치 값이 새 계약이므로 `docs/DATA_CONTRACT.md` 또는 관련 문서와 `PM_progress.md`에 기록.

연결 작업은 이 PR이 머지된 뒤 각자 자기 브랜치에서 해 주세요.

## 8. 미검증

- 실제 폰 3D 좌표로 시험하지 않음(합성 좌표 사례와 실제 IT1 기하 검사만).
- 3D 좌표 오차(정경호 시험의 재투영 오차 등)에 맞는 `margin_m`은 실측 후 정한다.
- IT1 분석형 QA 패키지(`knu-it1-analytic-*`, 다른 형식)는 지원하지 않는다. 기본 `knu-it1-v3`와 같은 `colliders.json` 형식만 읽는다.
- 떨어짐 계산은 단순화한 규칙이다(힘·무게·마찰 없음). 한 블럭에만 옆으로 붙어 길게 남은 부분처럼 실제로는 버티기 어려운 모양도 남는다. 3개·2 mm·15 cm는 시작값이다. 화면에서 보며 조정한다.
- 블럭이 몇 개 안 남으면 "가장 가까운 2개"가 맞은 곳에서 멀 수 있다. 거리 제한은 아직 없다.
- 화면 연출(남은 파편 고정, 지정 파편만 풀기)과 1타 1점 게임 상태는 아직 없다(7장 요청).
