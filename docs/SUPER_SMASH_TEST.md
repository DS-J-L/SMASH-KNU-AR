# 3대 연쇄 폭파 실행·인수 안내

2026-11-21, Asia/Seoul. 작업 브랜치 `feat/super-smash-three-camera`. [설계](SUPER_SMASH_DESIGN.md)의 C0/C1/C2 삼각측량 경로를 구현했다. **실제 폰·실측 정합·청취·전체 지연·20분 인수는 미검증이다.** 공유·검토 상태는 [PR 검토 기록](asset-validation/super-smash-pr-review-20261121.json)을 따른다.

## 실행

기존 [3대 실행 안내](MULTI3D_TEST.md)의 서버·HTTPS/접속키·모델 준비를 사용한다. 변경 후 `npm run build:building-test`, 서버 재시작, PC/폰 새로고침이 필요하다.

1. 세 폰에서 `/test/multi3d/?camera=C0`, `C1`, `C2`를 열어 같은 ID0 마커로 고정·보정·전송한다. 시계 교환이 끝나야 한다. 3대에 새 필수 몸 보정을 추가하지 않았다.
2. PC는 `/test/building/?scene=it1`로 시작한다. URL은 공유 허브를 초기화하지 않는다. **이 PC로 운영 → IT1 선택 · 복원**으로 장면을 명시 선택한다. 기본 `/test/building/`에서는 기존 소구역을 사용하며 슈퍼는 현재 소구역 전체를 파괴한다.
3. **폭발 미리보기 · 무득점**은 폰 없이 사용할 수 있다. 서버 명령·제거 집합·점수는 바뀌지 않는다. 소리는 브라우저 사용자 조작 뒤 활성화된다.
4. **C0 플레이 화면**은 C0 비율을 유지해 크게 표시한다. 같은 버튼으로 운영 화면에 돌아온다. 다른 폰으로 자동 교체하지 않는다. OS/브라우저 전체화면 전환은 별도 운영 조작이다.
5. 모드를 **연쇄 폭파**로 바꾼다. 새 epoch·0점·전체 복원·옛 궤적 제거를 서버가 확정한다. 세 장비/시각·최신 C0 영상·모델 준비 뒤 손/발을 대상 밖에서 관측한다. 장비300ms·관절 밖2표본/100ms를 확보하고 **한 번 쳐 보세요**가 표시되면 타격한다.
6. 정상 손목/발목 접촉1회 → 남은 전체 고유 파편 제거·파편당1점 → 접촉점 폭발→거리 순서 붕괴·먼지의 약2.1초 연출 → 결과. **다시 세우기**는 같은 장면/placement에서 새 epoch/0점으로 복원한다. 밖에서 다시 준비해야 한다.

**중지**는 로컬 효과/소리를 즉시 취소하고 서버 중지를 요청한다. 응답 전/후 상태를 구분한다. **재개**는 점수·제거 집합을 보존하고 궤적/준비만 다시 확보한다. 음소거·동작 줄이기도 제공한다. 복원/새 장면/탭 숨김/재접속 때 밀린 효과나 소리를 재생하지 않는다.

운영 PC 한 곳만 새 제어·준비 임대를 소유한다. 나머지는 관찰자다. 운영 PC 종료/임대 만료 뒤 다른 PC에서 **이 PC로 운영**을 누른다. 자동 인계하지 않는다. room-1/room-2 게임과 별개의 시험 허브다.

## 판정·표시 경계

- C0/C1/C2 모두 연결·보정·400ms 이내 입력이 필요하다. 한 폰이 끊기면 중단하며 2대 운영으로 전환하지 않는다. 개별 관절은 유효한 최소2시점이 필요하다.
- 기존 visibility·광선 각도·재투영·모호성·시각 정렬을 유지한다. 세 폰 시계 불확실성10ms 이하, 추론 입력시각 정렬을 요구한다. 구형 server_arrival 호환 입력으로는 슈퍼를 준비하지 않는다.
- 첫 내부 검출·미검출 뒤 복구 첫점·250ms 초과 간격/1.5m 초과 이동·낮거나 느린 발은 타격을 만들지 않는다. 기존 빠른 겹침 접촉 규칙은 준비 후에만 적용한다.
- 최상위 hits는 옛 상자 카운터다. 슈퍼는 model_test.event를 쓰며 파편 score를 상자 타격 카운터에 넣지 않는다. snapshot은 상태만 복구하고 후속 update는 진행 중 효과를 재시작/취소하지 않는다.
- 모드 실제 변경은 새 라운드다. 일반 blast/collapse 설정은 보존한다. 슈퍼 중 mouse/push/drop_all·2차 파편 release 등의 우회 파괴를 차단한다.
- 공개 명칭은 연쇄 폭파이며 큰 효과명 글자를 그리지 않는다. 타격점부터 폭발하고 먼 파편은 최대650ms 뒤에 방출한다. 논리 파괴/점수는 한 번에 확정한다.
- 화면 Canvas 긴 변1920/DPR1.5, 동적 몸체128개·프레임당16개/3ms 준비 한도다. 초과 조각은 논리 제거 후 화면 먼지로 표시한다. 4초 뒤 잔해/동적 몸체/예약을 정리한다. 물리 예산 때문에 점수를 줄이지 않는다. 예산은 실기기 성능 달성 결과가 아니다.

## 자동 검사 재현

루트 PowerShell, 저장소 `.venv`, 설치된 Edge를 사용한다.

```powershell
$env:PYTHONUTF8='1'
.venv/Scripts/python.exe -m pytest tests/test_super_smash.py tests/test_fragment_test.py tests/test_multi3d_relay.py -q
node --experimental-vm-modules --test --test-concurrency=1 tests/test_super_smash.mjs tests/test_fragment_physics.mjs tests/test_screen_impact.mjs tests/test_impact_audio.mjs
npm run build:building-test
$env:AR_TEST_RENDERER='d3d11'
npx playwright test -c playwright.building-test.config.js
```

Node 전체는 `rg --files tests -g '*.mjs'` 목록을 `node --experimental-vm-modules --test`에 전달한다. 일부 기존 검사가 vm.SourceTextModule을 써서 플래그가 필요하다. Python 전체의 all_zones는 CPU 시간이 길어 브라우저 시각 제한 검사와 동시에 실행하지 않는다. SwiftShader와 D3D11 결과를 같은 성능 결과로 합치지 않는다.

새 검사는 서버 정책/명령·소유권/우회 차단, 실제 IT1/소구역 기하의 제거/점수, 130조각 물리 상한/취소, PC 중복/역순/세대·무연출 재접속, 초기 국소 픽셀·원점 투영/무문구·무득점·합성3폰 전체 경로를 확인한다. 합성도 실제 WebSocket/시계 교환·추정기를 거치지만 실제 사람/촬영 시험은 아니다.

진단: `window.buildingFragmentTest.snapshot()`의 modelState·super·physics. super.logs는 최근128개 수신/첫 draw·종료/취소·출처·장면·제거 수·품질/서버 fuse 비용을 제공한다. PC 시각은 performance.now이며 모니터 실제 표시나 전체 지연이 아니다. 브라우저 검사는 Playwright가 만드는 `test-results/building-fragments/<테스트별 폴더>/`에 합성 한 타격의 `synthetic-browser-metric.json`과 trace를 저장한다. 사전에 개인 진단 폴더를 만들 필요가 없다. 단일 값으로 p95/실제 전체 지연을 주장하지 않는다.

## 실제3대 인수에서 남은 일

설계 T01~16 중 실제 항목을 수행한다. C0 영상·마커/건물 정합, 손목20회·발목20회·거부 동작, 카메라/영상/시계 상실·복구, 청취/축소/복원, 같은 조건 일반/슈퍼 지연, 20분·복원30회/장면왕복10회를 기록한다. 같은 영상에 실제 동작과 PC 화면을 함께 촬영해 전체 지연을 측정하며 동기화 안 된 시각을 직접 빼지 않는다.

live/synthetic/replay/데모를 구분한다. 자동 통과를 P3/P4/P5 완료로 쓰지 않는다. 자동 결과와 한계는 [검증 요약](asset-validation/super-smash-review.json)·[PM 기록](../AGENTS/PM_progress.md)을 따른다.


연출 후속 검사: Node에 test_screen_impact/test_impact_audio와 거리 전파 사례를 추가했다. 브라우저 super-smash.spec은 접촉점32ms/화염232ms/먼지932ms 캡처 및 실제 서버 접촉점의 C0 투영 일치를 검사한다. 내부 super_smash/screen_impact_v1 식별자는 호환을 위해 유지한다.

최신 연출 회귀는 Node 전체316개를 --test-concurrency=1로 실행했다. 관련 브라우저19고유 시나리오는17개 통과 후 기존 합성 관측2개를 시각/스트림 계약에 맞춰 수정·재통과했고, 최종 연출3개를 다시 확인했다. 서버 코드/판정·고유 점수/메시지는 이번 연출 변경에서 수정하지 않았다.
