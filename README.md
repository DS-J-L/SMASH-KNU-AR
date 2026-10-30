# SMASH-KNU-AR · 경북대 부수기

휴대폰 3대로 몸의 움직임을 추적하고, 모니터에 합성한 경북대 건물을 부수는 AR 프로젝트입니다.

**처음 시작하면 [PM 전체 계획](PM_plan.md)과 아래 ‘팀원 시작 안내’를 읽으세요.**

## 현재 상태

FastAPI 서버에 기기 등록·2D 관절 수신/검증, 시계 교환·시간 정렬, 보정 파일 검증·3D 손목 복원, 상태·3D 전달과 선택적 접속 키를 구현했습니다. Windows Python 3.13.14에서 자동 테스트 50개가 통과했습니다. 입력·추적 검증은 합성이며 실제 휴대폰 3대의 통합 완료를 뜻하지 않습니다.

브라우저 화면은 모니터 준비 화면과 휴대폰 로컬 카메라 미리보기 단계입니다. 휴대폰의 관절 추출·송신, C0 영상 전송, 실측 보정 계산, 모니터의 새 상태/3D 연결, 3D 렌더링·충돌·파괴는 남아 있습니다. 시작 버튼은 비활성 상태이며, 예시·합성 보정을 실측값으로 사용하지 않습니다.

외부 접속은 로컬 PC와 ipTIME 포트포워딩을 사용하는 방향입니다. 산출물의 DuckDNS·인증서·8443 실행 예시는 [SETUP.md](docs/SETUP.md)에서 확인하며, 공인 HTTPS·휴대폰 접속은 아직 미검증입니다.

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
