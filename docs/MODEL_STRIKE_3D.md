# IT1 모델 3D 타격 판정 — 상자 대신 건물 모양으로

작성: 김태이 (2026-11-10). 계획: [김태이_plan.md](../김태이_plan.md) P4 "실제 3D 궤적 충돌·타격 이벤트". PR #10의 3D 시험(`/test/mono3d/`, `/test/multi3d/`)은 바닥 마커 자리의 **상자**로 타격을 센다. 이 문서는 그 상자 대신 이동수님 **IT1 모델(`knu-it1-v3`)의 실제 모양**으로 손목·발목 타격을 판정하는 모듈과, 화면·서버에 연결하는 요청을 적는다. 이 PR은 김태이 새 파일만 추가한다.

## 1. 들어간 것

| 파일 | 내용 |
| --- | --- |
| `web/shared/model-strike-3d.js` | 판정 모듈(브라우저). 카메라 1대 `/test/mono3d/` 폰 페이지용 |
| `backend/model_strike.py` | 같은 판정(서버). 카메라 3대 `/test/multi3d/` 서버용 |
| `tests/fixtures/model_strike_cases.json` | 두 판정이 똑같이 통과해야 하는 손 계산 사례 13개(ㄴ자 시험 건물) |
| `tests/test_model_strike.py`·`.mjs` | 공용 사례 + 실제 IT1 패키지 검사 |

아직 아무 화면·서버에서도 부르지 않으므로 **지금 동작은 바뀌지 않는다.**

## 2. 건물 모양 = 파편 충돌체 96개의 합

- IT1 패키지의 `colliders.json`은 파편 96개 각각의 볼록 껍질이다(파편 물리가 쓰는 것과 같다). 판정은 이 **96개의 합집합**을 건물로 본다.
- 건물 전체를 껍질 하나로 감싸면 오목한 곳(건물 사이 빈 공간)까지 건물이 된다. 공용 사례 `the_empty_notch_above_the_low_block_is_not_building`이 이 차이를 확인한다.
- 실제 IT1 확인: 바닥 기준 길이 2.81 m · 깊이 0.63 m · 높이 1.08 m(manifest와 일치), 96개 껍질 모두 닫혀 있음, 껍질 합 부피 약 1.60 m³(파편 부피 합 1.56 m³), 껍질끼리 겹침 없음(격자 표본). 만드는 데 브라우저 약 0.05초, 서버 약 0.5초(시작 때 한 번).
- 판정 결과에 **맞은 파편 번호(`fragment_id`)와 맞은 점**이 함께 나온다. 파편 연출에 그대로 쓸 수 있다.

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
| 2 | 이번 프레임에 건물에 들어감(안에 있음 또는 프레임 사이 선분이 통과), 직전에는 밖 | `outside` / `already_inside` |
| 3 | 건물이 아직 안 부서짐(`destroy_on_hit`) | `destroyed` |
| 4 | 직전 점과 이어짐(250 ms·1.5 m 이내). **첫 점이나 끊긴 뒤 첫 점은 기준점만** | `baseline` / `gap` |
| 5 | 발목이면 0.20 m 이상 들어 올림 | `too_low` |
| 6 | 속도: 손목 0 m/s 이상(제한 없음), 발목 1.5 m/s 이상 | `too_slow` |
| 7 | 딛고 있는 발이 건물 자리(10 cm 여유) 밖 | `standing_in_building` |
| 8 | 같은 관절 직전 타격에서 300 ms 지남 | `cooldown` |

- 한 프레임에 여러 관절이 들어오면 **먼저 들어간 하나만** 이벤트가 된다(나머지 `simultaneous`). 2D 판정과 같다.
- `destroy_on_hit`(기본 켬): 첫 타격에 건물이 부서지고 `restore()` 전까지 더 세지 않는다. 시험처럼 계속 세려면 끈다.
- `restore()`: 건물 복원, 궤적·cooldown 비움. 건물 안에 손을 둔 채 복원해도 나갔다 들어와야 친다. `reset()`: 새 세션(점수까지 0).
- 지금 `/test/` 페이지와 다른 점: (1) 첫 점이 건물 안이면 타격이 아니라 기준점(계획 P4 "복구 첫 유효 프레임은 기준점만"), (2) "건물 자리에 서 있음"을 두 발 평균이 아니라 딛는 발로 판단([FOOT_STRIKE.md](FOOT_STRIKE.md) 3장 이유), (3) 상자가 아니라 모델 모양.
- 숫자는 모두 시작값이며 실제 폰으로 조정하지 않았다.

이벤트(`hit_3d`): `{schema: "model_strike.v1-draft", event_id, building_id, joint, hit_by: "inside"|"swept", fragment_id, point_m, speed_mps, t_ms, previous_t_ms, placement, config_version}`.

## 5. 사용 예

서버(`/test/multi3d/`):

```python
from backend.model_strike import ModelStrikeJudge, Placement, load_model_target
target = load_model_target(placement=Placement(x_m=0, y_m=0, yaw_deg=0))   # 시작할 때 한 번
judge = ModelStrikeJudge(target)
out = judge.update({n: joints[n]["p"] if joints.get(n) else None for n in
                    ("left_wrist", "right_wrist", "left_ankle", "right_ankle", "left_hip", "right_hip")}, t_ms)
if out["event"]: ...  # 점수·화면 전달
```

브라우저(`/test/mono3d/` 폰 페이지):

```js
import { ModelStrikeJudge, loadModelTarget } from '/shared/model-strike-3d.js';
const target = await loadModelTarget('/public/assets/buildings/knu-it1-v3/colliders.json', placement);
const judge = new ModelStrikeJudge(target);
const out = judge.update(Object.fromEntries(['left_wrist', 'right_wrist', 'left_ankle', 'right_ankle', 'left_hip', 'right_hip']
  .map((n) => [n, result.joints[n]?.position_m ?? null])), t);
```

## 6. 연결 요청 (김태이가 수정하지 않음)

**이동수** — 모델·화면·공통 변환 담당
1. **배치 값 정하기:** IT1을 마커 어디에, 어느 방향으로, 몇 배로 놓을지. 기본값은 마커 중심·회전 0·실제 크기. 정해지면 판정과 화면이 같은 값을 쓰도록 한 곳(설정)에 둔다.
2. **3D 화면에 IT1 그리기:** PC 3D 화면(`/test/*/view.html`)에 `placementToThree()`로 IT1 정상 모델을 놓고, `hit_3d` 이벤트의 `fragment_id`·`point_m`으로 파편 연출. 화면 파일은 정경호님 것이므로 두 분이 정해 주세요.

**정경호** — 3D 좌표·서버·시험 페이지 담당
1. **카메라 3대:** `test_multi3d.py`에서 `box()` 판정 대신(또는 선택으로) `ModelStrikeJudge.update()`를 부르고 결과(`event`, `destroyed`, `decisions`)를 화면에 보내기. 시작/복원 버튼에 `reset()`/`restore()` 연결.
2. **카메라 1대:** `mono3d/app.js` 측정 단계에서 같은 방식으로 연결. 발을 들면 바닥 기준(`floorAnchor`)이 틀어지는지 확인(발차기 문서 4장과 같은 문제).
3. 폰·서버 결과에 발목·골반 3D 점이 함께 오는지 확인(딛는 발·발차기 판정에 필요).

**PM(이동수)** — `hit_3d` 이벤트와 배치 값이 새 계약이므로 `docs/DATA_CONTRACT.md` 또는 관련 문서와 `PM_progress.md`에 기록.

연결 작업은 이 PR이 머지된 뒤 각자 자기 브랜치에서 해 주세요.

## 7. 미검증

- 실제 폰 3D 좌표로 시험하지 않음(합성 좌표 사례와 실제 IT1 기하 검사만).
- 3D 좌표 오차(정경호 시험의 재투영 오차 등)에 맞는 `margin_m`은 실측 후 정한다.
- IT1 분석형 QA 패키지(`knu-it1-analytic-*`, 다른 형식)는 지원하지 않는다. 기본 `knu-it1-v3`와 같은 `colliders.json` 형식만 읽는다.
