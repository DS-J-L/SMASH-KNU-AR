# 모델 원본 · 이동수

Blender 원본과 참고 자료를 관리할 위치입니다. 아래 검증된 Blender 원본 8개는 Git 공유 예외에 포함합니다. 그 밖의 원본은 기본적으로 제외하며, 추가 공유나 Git LFS 도입은 팀이 정합니다.

첫 산출물은 건물 1개입니다. 단위 m, 바닥 원점, 축 방향, GLB 배율, 충돌체 치수, 파편 피벗과 개수를 함께 기록하세요. 실제 크기와 교실에 맞춘 축소 배율을 구분합니다.

게임에서 읽는 GLB·소리는 `web/public/assets/`에 내보냅니다. 사용한 지도·사진·모델·소리의 출처와 이용 조건을 해당 폴더의 README에 적습니다.


2026-11-02 로컬 검증 원본: `knu-campus-v11.blend`, `knu-it1-fracture-v1.blend` 및 고도화한 `knu-campus-v12.blend`, `knu-it1-fracture-v2.blend`, `knu-main-fracture-v1.blend`. 이 파일은 .gitignore의 개별 예외로 공유 대상에 포함한다. [제작·검증·한계](../../docs/BUILDING_ENHANCEMENTS.md)를 따른다. 이전 버전은 보존한다.


[knu-campus-v13.blend](knu-campus-v13.blend)은 지도·사진과 대조한 6개 건물 보완 원본이다. [변경과 검증](../../docs/CAMPUS_MAP_REVIEW.md)을 따른다. 이전 원본은 보존하며 이 파일을 공유 예외에 포함했다.


세분화 원본: [knu-it1-fracture-v3.blend](knu-it1-fracture-v3.blend)·[knu-main-fracture-v2.blend](knu-main-fracture-v2.blend). 이전 원본은 보존하며 [제작/검증·담당](../../docs/FRACTURE_REFINEMENT.md)을 따른다.


## 2026-11-09 캠퍼스 v71 체크포인트

사용자 요청에 따라 [knu-campus-v71.blend](knu-campus-v71.blend) 한 개를 명시적 공유 예외에 추가한다. 기존 원본은 보존한다. 이 파일은 고도화 진행상황 체크포인트이며 전수 실측·전체 건물 완료를 뜻하지 않는다. [범위·검증·이용 조건](../../docs/CAMPUS_V71_CHECKPOINT.md)을 따른다. 대형 복원 ZIP과 중간 원본, 원시 참고 사진은 Git에 추가하지 않는다. 일반 Git 바이너리 정책을 유지하며 Git LFS를 도입하지 않았다.
