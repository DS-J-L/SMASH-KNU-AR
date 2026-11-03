# 불규칙 파편 세분화와 역할 구분

2026-11-02 사용자 요청으로 IT 1호관 64→96개, 본관 52→85개로 사전 파편을 세분화했다. 기존 버전은 보존하며 기본 모델을 `knu-it1-v3`로 바꿨다. [데모](http://127.0.0.1:8765/monitor/fracture/)의 건물 선택에서 새 버전과 이전 3개 버전을 비교한다.

## 결과물

| 모델 | 새 ID | 파편 수 | 정상/파편 삼각형 | 파편 GLB |
| --- | --- | --- | --- | --- |
| IT 1호관 | `knu-it1-v3` | 96 | 666 / 6,442 | 1,799,952 bytes |
| 본관 | `knu-main-v2` | 85 | 1,612 / 7,982 | 1,915,956 bytes |

IT 1호관은 96개 Voronoi 영역, 본관은 80개 영역으로 나눴다. 본관에서 연결되지 않은 기둥 등의 조각을 독립 메시로 분리한 결과 총 85개다. 서로 떨어진 조각을 같은 강체로 묶어 파편 수를 맞추지 않았다. 정상 모델의 크기·부피·배치·재질은 이전 버전과 같고 불규칙 분할만 더 잘게 했다.

각 파편은 닫힌 절단면, 골재 재질, 독립 피벗과 볼록 충돌체를 갖는다. 충돌체는 최대 IT 1호관 29점·본관 31점이다. 단위 m·Y-up·내보내기에서 적용한 축 변환·항등 복원 회전 규칙은 유지한다. 파편 수는 manifest에서 읽으며 32/64개로 고정하지 않는다. 실제 파괴 역학·철근·층별 붕괴 해석을 재현한 것은 아니다.

- [IT 1호관 새 패키지](../web/public/assets/buildings/knu-it1-v3/README.md) · [편집 원본](../assets/source/knu-it1-fracture-v3.blend)
- [본관 새 패키지](../web/public/assets/buildings/knu-main-v2/README.md) · [편집 원본](../assets/source/knu-main-fracture-v2.blend)
- [IT 1호관 분리 렌더](asset-validation/enhancement/knu-it1-v3-exploded.png) · [본관 분리 렌더](asset-validation/enhancement/knu-main-v2-exploded.png)
- [최종 검증·해시](asset-validation/fracture-refinement/summary.json)

## 사람과 건물·파편의 상호작용 담당

사용자가 확인한 인수 범위는 **이동수 담당 작업 전체**다. 앞서 이를 팀 전체 인수로 해석한 기록을 정정했다. 원래 김태이·정경호의 책임을 이동수에게 재배정하지 않는다. 이미 만든 공용 키보드 데모의 구현·검증 사실은 보존하되 해당 담당자가 실제 기기 작업을 끝냈다는 뜻으로 쓰지 않는다.

| 기능 | 기존 담당·계획 | 이동수의 연결 지점 |
| --- | --- | --- |
| 유효한 좌우 3D 손목 좌표·시각·품질 | 정경호의 보정/복원·P3 | 같은 축 변환으로 표시하고 무효 상태를 화면에 반영 |
| 손목 궤적과 건물의 충돌·타격 이벤트 | 김태이 P4 | 건물/충돌체/배치 전달, 받은 이벤트를 화면·점수와 연결 |
| 파편 강체·낙하·수명·소리·제거 | 김태이 P4 | 파편 메시·피벗·충돌체 제공, 게임 시작/종료/리셋 연결 |
| 정상/파편 모델·재질·렌더·60초·점수·결과 | 이동수 | 본인 담당 |
| 부서진 파편이 몸 전체와 접촉해 튕기거나 밀림 | 물리 담당 김태이와 추적 담당 정경호가 범위를 정할 확장 사항 | 필요한 시각 표현과 게임 연결 지원 |

근거는 [김태이의 책임·P4](../김태이_plan.md), [정경호의 책임·P3](../정경호_plan.md), [이동수의 책임·P2/P4](../이동수_plan.md), [PM 분담표](../PM_plan.md)다. 현재 기본 계획은 **좌우 손목 궤적으로 건물을 타격**하는 범위다. 몸 전체의 지속적인 파편 충돌체는 별도 구현·추적 범위를 합의해야 한다. 이번 변경은 모델과 공용 키보드 데모의 검증이며 실제 손목/몸 입력 연결은 아직 미구현·미검증이다.

## 재생성·검증

```powershell
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/enhance_buildings.py -- --building it1 --detailed
blender -b assets/source/knu-campus-v11.blend --python-exit-code 1 -P tools/enhance_buildings.py -- --building main --detailed
npm run validate:enhancements
npm run build:demo
npm run test:demo
python tools/check_scaffold.py
```

`--detailed`는 새 ID·원본으로 저장한다. 옵션을 생략하면 이전 IT 1호관 v2/본관 v1 규격을 사용한다. Blender 폐합·법선·퇴화 면·UV 오류 0, 파편 부피 상대 오차는 IT 1호관 1.6835e-8·본관 3.2382e-8이다. 정상/조립 GLB 경계와 충돌체·복원 위치를 확인한다. 반복 UV 중첩·상대 높이는 기존 용도에 따른 수용 경고다. 노멀맵 tangent는 최종 GLB 삼각형/UV로 계산하며 본관 파편 정점 2개에서 직교 대체 축을 사용했다.

검증 결과와 이전 버전 보존 SHA-256은 `asset-validation/fracture-refinement/summary.json`에 기록한다. 브라우저는 Playwright 소프트웨어 WebGL이며 실제 시연 PC/휴대폰 성능을 대신하지 않는다. 소리·실제 손목/몸 입력·AR 정합·장기 구동은 검증 범위 밖이고 공통 Phase 통과를 변경하지 않는다. 지형·실측 관련 남은 항목도 유지한다.


## 최종 확인 결과 — 2026-11-02 21:04 KST

Intel UHD/Direct3D11 하드웨어 브라우저 시험 22개·서버 pytest 4개 통과, GLB 11개 형식 오류·경고 0건이다. 새96/85개와 이전64/52/32개 모델 전환·파괴·복원, 20회 초기화·중복 점수·바닥·자원 수·실패/시간/모바일을 확인했다. 정상 크기는 이전 manifest와 동일하고, 이전 패키지·편집 원본10개 SHA-256도 일치한다.

SwiftShader 전체 시험은19개 통과·3개 제한시간 초과였다. 6개 캠퍼스 뷰 캡처와20회 복원 캡처의 시험 예산을120초로 보완했으나 소프트웨어 전체 재통과를 주장하지 않는다. 실패는 browser-final.json, 하드웨어 결과는 browser-hardware.json으로 구분한다. 실제 FPS나 휴대폰 성능 측정은 아니다.

Windows 하드웨어 검증 재현:

```powershell
$env:AR_TEST_RENDERER='d3d11'
npm run test:demo
```

환경변수를 생략하면 SwiftShader를 사용한다. 실제 신체 충돌·소리는 별도 담당 작업으로 남으며 이번 에셋 검증으로 완료 처리하지 않았다.
