# IT 1호관 게임 패키지 v1

2026-11-02 / `building_id: knu-it1-v1`. 첫 건물의 키보드 테스트용 패키지다.

- `intact.glb`: 정상 건물, 28삼각형, 바닥 중앙 원점.
- `fragments.glb`: 닫힌 파편 32개, 합계 636삼각형, 복원 위치 포함.
- `colliders.json`: 파편별 단순 볼록 충돌체와 같은 로컬 피벗·조립 위치.
- `manifest.json`: 단위·축·게임 배율·원본 위치·실측 한계.
- 편집 원본: [knu-it1-fracture-v1.blend](../../../../../assets/source/knu-it1-fracture-v1.blend).
- [데모 실행·재생성·검증](../../../../../docs/ASSET_PIPELINE.md).

1 단위는 1m, glTF와 충돌체는 Y 위쪽이다. 이미 `(X,Y,Z) → (X,Z,-Y)` 변환을 적용했다. 같은 회전을 다시 적용하지 않는다. 폭 2.8m는 게임용 설계값이다. 캠퍼스 위치는 출처 정보이며 실내 AR 배치를 뜻하지 않는다.

재검증 정정: `manifest.dimensions_m`는 축소된 게임 크기 `[2.8, 1.0324382, 0.6155215]`m다. 원본 캠퍼스 크기는 `source_dimensions_campus_z_up_m`로 분리했다. 초기 manifest의 원본 크기를 게임 크기로 사용하지 않는다. 패키지 v1의 파편 회전·배율은 메시로 적용했고 복원 quaternion은 항등값이다.

원형은 © OpenStreetMap 기여자의 way 468931895. 기존 2019 지상 9층 × 가정 층고 3.5m 높이를 유지했으며 실측 높이가 아니다. 반복 창은 게임용 재질이다. 실제 창 배치나 콘크리트의 파괴 양상을 재현하지 않는다. 체적을 보존하는 고정 시드 분할이며 각 절단면을 막아 내부 재질을 적용했다.

형상·좌표·단위·재가져오기·부피와 브라우저 키보드 물리/복원을 검사했다. 실제 손목 타격·카메라 영상·보정·AR 정합과 다른 팀원의 실제 소비 코드 연결은 미검증이다.

출처·이용 조건은 [원본 캠퍼스 안내](../../campus/README.md)를 함께 확인한다. [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright), 기존 캠퍼스의 [FABDEM V1-2](https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/) 및 CC BY-NC-SA 4.0 출처·비상업·동일조건 공유 표시를 보존한다.
