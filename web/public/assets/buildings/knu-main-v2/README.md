# 본관 세분화 패키지 v2

2026-11-02. 이전 v1의 52개를 불규칙 파편 **85개**로 세분화했다. 80개 Voronoi 영역에서 연결되지 않은 조각도 독립 파편으로 분리했다. 정상 1,612삼각형, 파편 합계 7,982삼각형이며 정상 외형·크기는 이전과 같다.

- [정상 GLB](intact.glb) · [파편 GLB](fragments.glb) · [충돌체](colliders.json) · [manifest](manifest.json)
- [편집 원본](../../../../../assets/source/knu-main-fracture-v2.blend)
- [재생성·검증·역할 구분](../../../../../docs/FRACTURE_REFINEMENT.md)

m·Y-up, 축 변환 적용 완료, 바닥 중앙 원점과 파편 로컬 피벗을 사용한다. 같은 축 회전을 다시 적용하지 않는다. 닫힌 절단면과 최대 31점 볼록 충돌체다. 실제 손목·몸·AR는 미연결이다. [이전 v1](../knu-main-v1/README.md)의 출처·면적 차이·단순화 한계와 [캠퍼스 이용 조건](../../campus/README.md)을 이어받는다.
