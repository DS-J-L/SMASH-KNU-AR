# SMASH-KNU-AR · 경북대 부수기

휴대폰 3대로 몸의 움직임을 추적하고, 모니터에 합성한 경북대 건물을 부수는 AR 프로젝트입니다.

**처음 시작하면 [PM 전체 계획](PM_plan.md)과 아래 ‘팀원 시작 안내’를 읽으세요.**

## 현재 상태

FastAPI 등록·2D 관절 수신/검증·시계 교환·시간 정렬·3D 손목 복원 기초를 제공합니다. 방 1은 각 폰의 MediaPipe 손목 추출을 기존 서버 파이프라인에 연결했습니다. 실제 3D 복원에는 실측 보정과 검증된 촬영 시각이 필요합니다.

- PC `/monitor/`에서 방을 선택합니다. room-1은 C0/C1/C2 세대, room-2는 C0한대입니다. 각 전용 페이지에서 테스트·시작점검·서버승인·60초·결과·테스트복귀를 제공합니다.
- 기본 방 페이지의 시작은 영상 확인용 `video_check`입니다. 승인 후 C0 영상을 크게 표시하고 방 1은 카메라 선택·축소를 제공합니다. 이 세션의 점수는 null이며 화면에는 —로 표시합니다.
- 진행 중 중지 버튼으로 종료할 수 있습니다. 필수 카메라 하나라도 연결이 끊기거나 영상이1.5초 이상 중단되면 자동 중지하며 실제 진행 시간·종료 사유를 표시합니다. 재연결 후 자동 재개하지 않습니다.
- 폰 `/camera/room/`은 키/토큰 없는 고정QR로 입장하며, WebRTC 직접 또는 서버JPEG 중계를 선택합니다. PC 역할·게임시작·관리API는 키로 보호합니다.
- 두 방 모두 폰에서 양손 손목을 추출하고 전신22개 2D 관절을 body로 송신하며 폰·PC에 표시합니다. 방 1은 기존 서버3D 입력으로 연결하고, 방 2의 C0는 별도 registry에서 관리해 방 1에 섞이지 않습니다. 전신3D는 후속입니다.
- 머리는 head 필드의 대표 위치1개만 전송하고 폰·PC에 노란 점으로 표시합니다. 얼굴 세부 좌표·표정 정보는 보내지 않습니다.
- 건물 타격 게임은 각 방의 **‘폰 좌표로 2D 게임 · C0 서버 중계’** 링크 → **‘휴대폰 연결 준비’ → ‘시작’** 순서입니다. `/monitor/phone-game/?room=room-2`는 C0 한 대, `room-1`은 C0/C1/C2 모두가 필수이며 C0는 서버 중계를 선택합니다. 같은 프레임의 영상·유효 손목·건물 준비 후 시작합니다.
- `phone_2d`는 폰 손목을 팀원 게임 모듈에 연결해 60초·화면2D 타격·파편96개·타격음·건물당100점·서버 점수를 제공합니다. 실제 깊이/3D 충돌은 계산하지 않습니다. [실행·계약·검증](docs/PHONE_POSE_GAME.md)은 로컬 미커밋 구현 기준이며 합성 시험과 실제 폰 검증을 구분합니다.
- 서버시각 표시·중계영상 정렬·시각미상 개별표시를 구현했습니다. 실제3대 보정/3D 정합·정량지연·장시간·QR실스캔은 미검증입니다. [방/영상/세션/QR 계약](docs/ROOMS.md)을 참조하세요.

[키보드 파괴·복원 데모](http://127.0.0.1:8765/monitor/fracture/)는 IT1 96개·본관85개 파편, 모델선택·클릭타격·60초·점수·리셋을 제공합니다. synthetic/keyboard_demo로 실제입력과 구분합니다. 캠퍼스v13은 건물123개와 지형을 포함합니다. [에셋 실행](docs/ASSET_PIPELINE.md)·[지도/치수 한계](docs/CAMPUS_MAP_REVIEW.md)·[모델/파편](docs/FRACTURE_REFINEMENT.md)을 참조하세요.

외부HTTPS 접속과 영상 정상 동작은 사용자 보고가 있으며 에이전트의 실제폰 검증과 구분합니다. [SETUP.md](docs/SETUP.md)·[개인 진행 기록](AGENTS/정경호_progress.md)에 실행/검증 범위를 정리합니다.

## 팀원 시작 안내

처음 받는 경우:

```bash
git clone https://github.com/DS-J-L/SMASH-KNU-AR.git
cd SMASH-KNU-AR
```

이미 저장소를 받은 경우, main을 갱신합니다.

```bash
git switch main
git pull --ff-only origin main
```

1. [PM_plan.md](PM_plan.md)에서 P0~P6의 목표·일정·통합 완료 기준을 확인합니다. 날짜는 제안 일정입니다.
2. [AGENTS.md](AGENTS.md)와 [기록 운영 안내](AGENTS/README.md)를 읽습니다.
3. 아래 표에서 자신의 계획과 진행 파일을 열고, 마지막 완료·미검증·다음 작업을 확인합니다.
4. 작업 시작 기록을 남기고 진행합니다. 종료할 때 검증 결과·남은 일·다음 행동을 기록하고, 완료한 계획 체크박스와 [팀 진행현황](AGENTS/진행현황.md)의 자기 행을 갱신합니다.
5. 작업 브랜치의 PR에 코드 변경과 관련 계획·진행 기록을 함께 담습니다. 공통 Phase 통과는 PM의 통합 확인 기록으로 구분합니다.

| 담당 | 작업 계획 | 진행 기록 |
| --- | --- | --- |
| 이동수 | [이동수_plan.md](이동수_plan.md) | [이동수_progress.md](AGENTS/이동수_progress.md) |
| 김태이 | [김태이_plan.md](김태이_plan.md) | [김태이_progress.md](AGENTS/김태이_progress.md) |
| 정경호 | [정경호_plan.md](정경호_plan.md) | [정경호_progress.md](AGENTS/정경호_progress.md) |
| PM·공통 관리 | [PM_plan.md](PM_plan.md) | [PM_progress.md](AGENTS/PM_progress.md) |

[팀 진행현황](AGENTS/진행현황.md)에서 사람별 작업과 공통 Phase를 확인하고, 새 기록에는 [작업 기록 양식](AGENTS/작업기록_template.md)을 사용합니다. 최초 개발 상태는 `확인 전`이므로 기존 작업·실행 근거를 확인해 갱신합니다.

Codex를 사용할 때는 저장소를 프로젝트 폴더로 열고 아래처럼 요청할 수 있습니다.

```text
AGENTS.md와 PM_plan.md를 읽고, 내 이름_plan.md와 AGENTS/내 이름_progress.md를
확인해 다음 작업을 진행해줘. 시작 기록을 남기고, 끝나면 검증 결과·남은 일·
다음 작업을 기록한 뒤 계획 체크리스트와 팀 진행현황도 맞춰줘.
```

`내 이름`은 실제 담당자 이름으로 바꿉니다. AGENTS는 작업 지침과 기록이며, 서버·휴대폰 준비는 아래 실행 방법과 [SETUP.md](docs/SETUP.md)를 따릅니다.

## 실행

Python 3.12를 기준으로 하며, Windows Python 3.13.14에서도 자동 테스트를 확인했습니다. 프로젝트 루트에서 실행합니다.

```bash
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
# macOS/Linux는 source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn backend.server:app --reload --host 127.0.0.1 --port 8000
```

- 모니터: <http://127.0.0.1:8000/monitor/>
- 카메라 미리보기: <http://127.0.0.1:8000/camera/>
- 서버 확인: <http://127.0.0.1:8000/api/health>
- 상세 실행·휴대폰 HTTPS 연결: [SETUP.md](docs/SETUP.md)

휴대폰에서 `127.0.0.1`은 휴대폰 자신입니다. PC의 로컬 IP와 휴대폰이 신뢰하는 HTTPS 연결을 준비해야 합니다. 현재 미리보기 영상은 기기 안에서만 표시하며 서버로 전송하지 않습니다.

## 폴더 안내

| 경로 | 넣을 내용 | 제안 담당 |
| --- | --- | --- |
| `backend/` | FastAPI, 입력 수신, 보정, 시간 정렬, 3D 복원 | 정경호 |
| `web/camera/` | 휴대폰 카메라, MediaPipe, 관절 전송 | 김태이 + 정경호 |
| `web/monitor/` | 모니터 UI, Three.js 합성, 게임 진행 | 이동수 |
| `web/monitor/physics/` | 충돌, Rapier 파편, 소리 | 김태이 |
| `config/` | 팀이 공유하는 설정 양식 | 정경호 |
| `calib/` | 각 기기의 실제 보정 결과 | 정경호 + 김태이 |
| `models/` | MediaPipe 모델 파일 | 김태이 |
| `assets/source/` | Blender 원본 관리 안내 | 이동수 |
| `web/public/assets/` | 게임에서 사용할 GLB·소리 | 이동수 + 김태이 |
| `contracts/` | 메시지 형식 예시 | 정경호, 전원 검토 |
| `data/` | 실험 로그와 기록의 로컬 저장 위치 | 전원 |
| `docs/` | 구조, 실행, 장비, 평가, 결정 기록 | 이동수 취합 |
| `tests/`, `tools/` | 기본 서버 검증과 구조 점검 | 정경호 |

실명 역할은 첨부 5차 발표자료를 바탕으로 구체화한 **제안**입니다. GitHub 계정에 자동 배정하지 않았습니다.

## 읽는 순서

1. [PM_plan.md](PM_plan.md)와 개인 계획: P0~P6 목표·담당·일정·완료 기준
2. [AGENTS.md](AGENTS.md), [AGENTS/README.md](AGENTS/README.md), [팀 진행현황](AGENTS/진행현황.md): 계획 읽기·진행 기록·통합 확인
3. [SETUP.md](docs/SETUP.md): 설치와 실행
4. [ARCHITECTURE.md](docs/ARCHITECTURE.md): 각 폴더의 책임과 데이터 흐름
5. [DATA_CONTRACT.md](docs/DATA_CONTRACT.md): 함께 맞춰야 할 메시지·좌표·시간 규칙
6. [DECISIONS.md](docs/DECISIONS.md): 노션과 발표자료의 차이, 아직 결정할 항목
7. [HARDWARE_CHECKLIST.md](docs/HARDWARE_CHECKLIST.md): 실제 휴대폰 3대 점검
8. [EVALUATION.md](docs/EVALUATION.md): 실험 계획의 구분과 측정 기준
9. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): 초기 T00~T13 설계와 개발 배경

## 확인 명령

```bash
python tools/check_scaffold.py
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## 기준 자료

- [학교 뿌시기 기획](https://app.notion.com/p/404821aaca748095b195f7bbd9677299)
- [3카메라 개발 설계서 v0.2](https://app.notion.com/p/404821aaca748169853afe6296063034)
- 첨부 `경북대부수기_5차_수정본_대본.pptx`의 구현·일정·역할·평가 내용

노션의 PC 추론과 발표자료의 휴대폰 추론, 평가 인원·A/B 정의가 서로 다릅니다. 현재 작업 가정과 변경 지점은 결정 기록에 적었습니다. 모바일 1인칭 빠따 모드는 별도 확장으로 남깁니다.
