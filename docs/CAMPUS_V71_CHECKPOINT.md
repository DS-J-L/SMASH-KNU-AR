# 캠퍼스 v71 고도화 체크포인트

2026-11-09. 사용자 요청에 따라 현재 진리관 개선을 끝내고 추가 건물 작업을 멈춘 시점의 모델이다. 기존 Windows·클라우드 통합 캠퍼스에 v70의 제2과학관 벽등·농대3호관 배관 보완과 v71 진리관 북서쪽 입면 보완을 보존했다. 전체 건물의 실측 복원이나 캠퍼스 전수 완료를 뜻하지 않는다.

## 파일과 열기

- [편집 원본](../assets/source/knu-campus-v71.blend): Blender 5.2.3 LTS, 22,063,400 bytes.
- [정적 GLB](../web/public/assets/campus/knu-campus-v71.glb): 68,594,784 bytes.
- [파일 해시와 동결 원본 대응](asset-validation/campus-v71/publication-artifacts.json)
- [독립 검수 요약](asset-validation/campus-v71/INDEPENDENT-REVIEW-v71-r3.txt), [판정](asset-validation/campus-v71/ACCEPTANCE-v71-r3.json), [정확한 변경 범위](asset-validation/campus-v71/scope.json)

Blender 원본을 열면 포함된 전체 캠퍼스를 확인할 수 있다. GLB는 정적 모델 검토용이다. 게임 카탈로그 기본값과 기존 캠퍼스 v13 제공 경로는 바꾸지 않았다. 이 파일 자체에 파괴 물리가 추가된 것은 아니다.

최종 native SHA256:
`5013f5124e761563d11ea3f8677740fe53d865048318115697d4f05aa286b7cd`

최종 GLB SHA256:
`9b6cf71c67f8276884dbd869d86ec9fffd40dbb88fe254c04838a9e27c3a4bdd`

## 이번 진리관 변경

대상은 공식 번호501, OSM way468931880의 진리관이다. 북서쪽 모서리의 북쪽 짧은 면 JA와 서쪽 면 AB를 공식 외관 사진·가상 투어·주변 배치와 대조했다.

- 북쪽 넓은 녹색 유리 구역과 최상단 유리 열, 서쪽 계단실 유리 구역.
- 크림색 세로·가로 띠와 북서쪽 돌출 처마.
- 기존 코어 면4개의 재질 배정. 코어 형상·층수·지붕·지형은 보존했다.
- 관찰된 새 표현과 중복되는 기존 근사 창22개 섬을 제거하고 나머지133개 섬의 모든 속성을 그대로 보존했다.
- 새 메시6개·단색 재질5개, 새 이미지0개. 총1,735객체·902,354삼각형·457재질·50이미지다.

[재질 보기](asset-validation/campus-v71/jinri-nw-material.png) · [와이어 보기](asset-validation/campus-v71/jinri-nw-wire.png)

사진의 촬영일과 실측 치수는 확인하지 못했다. 색상·비례·프레임 간격은 근사이며 유리는 불투명 간략 표현이다. 남측 필로티와 미등록 사진2는 이번 형상에 적용하지 않았다. 다른 면과 남아 있는 규칙 창도 새로 검증한 것으로 취급하지 않는다.

## 검증과 보존

Blender 5.2.3에서 실제 파일을 다시 열어 제작 결과와 별도로 검사했다.

- 기존 무변경 객체1,727개 및 IT1 관련12개 객체·재질·이미지 정확히 일치.
- 원래 재질·이미지의 내용과 메타데이터, 월드·컬렉션·장면 상태 보존. 장면에는 새 객체6개의 소속만 추가.
- 새 연결 섬9개가 닫힌 외향 메시이며, 실제 코어 삼각면 접촉으로 지지를 확인.
- 의도하지 않은 주변 교차·포함·자기 교차·양의 면적을 갖는 동일방향 공면 겹침0건.
- 새 UV 검사와 재질/와이어6시점 확인. 변경·추가 메시8개는 native와 GLB의 좌표·법선·UV가 내보내기 규칙 아래 정확히 일치.
- 복원 ZIP CRC와 데이터42개 해시를 확인하고 실제 추출한 native를 다시 열었다. 복원 ZIP과 이전 버전은 로컬에 보존하며 이 PR에는 중복 게시하지 않는다.
- r2 저장 때 무관한 packed 이미지 경로가 자동 변경된 문제를 보존 검사에서 발견했다. r3에서 원래 메타데이터로 복구했고 형상은 그대로다.

남은 한계:
- 진리관 기존 코어는 UV가 없다. 이번 단색 재질 편집은 그 상태를 유지하며, 전체 건물의 UV/베이크 준비 완료를 주장하지 않는다.
- 평평한 처마 끝면 n-gon2개와 현장 상대 표고를 수용했다.
- Blender GLB 재가져오기에서 기존 terrain 객체5개에 정확히 같은11삼각형 손실이 남는다. native·직접 해독한 GLB는902,354삼각형, 재가져오기는902,343이다. 새 대상 손실은 없다.
- 구조 안전·현장 최신 상태·게임 물리·실기기·AR·장시간 시험은 이 정적 모델 검수 범위에 포함하지 않는다.

## 출처와 이용 조건

기존 [에셋 파이프라인](ASSET_PIPELINE.md)의 출처·비상업·동일조건 공유 표시를 이어받는다. OSM 기반 윤곽은 [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright), 지형은 [FABDEM V1-2](https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/)에서 유래한다. 기존 FABDEM 기반 파생물의 CC BY-NC-SA 4.0 표시를 보존한다. 별도 법률 판단이나 새로운 이용 허락을 주장하지 않는다.

진리관 식별·입면 참고:
- [경북대학교 생활관 진리관 안내](https://dorm.knu.ac.kr/dorm/dorm_04.php)
- [공식 외관 사진1](https://dorm.knu.ac.kr/img/sub/dorm/dorm4_1.jpg)
- [공식 가상 투어 북서쪽 모서리](https://home.knu.ac.kr/HOME/knuprmap2/indexdata/_5_01_11475/mobile/2.jpg)

원시 참고 사진을 모델에 새로 넣거나 Git에 게시하지 않았다. 관찰한 형태를 별도 메시와 단색 재질로 표현했다. 기존 원본·복원 백업·현재 게임 패키지는 보존한다.

## 파일 크기 정책

이 저장소의 일반 Git 바이너리 정책을 유지했다. 새 native 한 파일만 assets/source의 명시적 예외로 추가했고 Git LFS는 도입하지 않았다. GLB는 약65.4MiB로 대용량 경고 대상이므로 새 중간 버전을 반복 추가하지 않는다. 복원 ZIP·원시 사진·캐시·개인 설정·인증 자료는 공유 대상에서 제외한다.

추가 형식 검사: glTF Validator 2.0.0-dev.3.10에서 오류0, 경고3이다. 공대12호관·약학대학·정보화본부의 기존 normal-map primitive가 tangent를 생략해 런타임 생성에 의존하는 동일 경고이며, v70과 이름·재질·내용이 일치한다. 플랫폼 간 tangent 재생성 차이 가능성은 남아 있다. 새 오류·새 경고는0이며 [정확한 비교](asset-validation/campus-v71/gltf-format-comparison.json)를 보존했다.

검수 원문3개(판정 JSON·독립 검수 TXT·범위 JSON)는 원래 CRLF 바이트와 SHA256를 보존하도록 해당 경로만 Git 줄바꿈 변환에서 제외했다. 다른 문서는 기존 LF 규칙을 따른다. 생성된 phone-game 번들도 기존 fracture/single과 같은 GLSL 문자열 공백 정책을 따른다. 실행 소스의 공백 검사는 유지한다.
