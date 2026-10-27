# SMASH-KNU-AR · 경북대 부수기

휴대폰 3대로 몸의 움직임을 추적하고, 모니터에 합성한 경북대 건물을 부수는 AR 프로젝트입니다.

**처음 시작하면 [개발 계획](DEVELOPMENT_PLAN.md)의 ‘첫 작업’부터 읽으세요.**

## 현재 상태

초기 개발 구조입니다. FastAPI 서버, 상태 확인용 WebSocket, 모니터 준비 화면, 휴대폰의 로컬 카메라 미리보기를 제공합니다.

관절 추출, 휴대폰 영상 전송, 카메라 등록, 보정, 시간 동기화, 삼각측량, 3D 렌더링, 충돌과 파괴는 아직 구현하지 않았습니다. 시작 버튼은 비활성 상태이며, 예시 설정을 실측값으로 사용하지 않습니다.

## 실행

Python 3.12를 기준으로 합니다. 프로젝트 루트에서 실행합니다.

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

1. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): 오늘 할 일, 역할, 일정, 작업별 완료 기준
2. [SETUP.md](docs/SETUP.md): 설치와 실행
3. [ARCHITECTURE.md](docs/ARCHITECTURE.md): 각 폴더의 책임과 데이터 흐름
4. [DATA_CONTRACT.md](docs/DATA_CONTRACT.md): 함께 맞춰야 할 메시지·좌표·시간 규칙
5. [DECISIONS.md](docs/DECISIONS.md): 노션과 발표자료의 차이, 아직 결정할 항목
6. [HARDWARE_CHECKLIST.md](docs/HARDWARE_CHECKLIST.md): 실제 휴대폰 3대 점검
7. [EVALUATION.md](docs/EVALUATION.md): 실험 계획의 구분과 측정 기준

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
