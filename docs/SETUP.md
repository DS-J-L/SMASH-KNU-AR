# 설치와 실행

## 1. 저장소 받기

```bash
git clone https://github.com/DS-J-L/SMASH-KNU-AR.git
cd SMASH-KNU-AR
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

활성화가 차단되면 정책 변경 없이 `.venv\Scripts\python.exe -m pip ...`처럼 가상환경의 Python을 직접 사용해도 됩니다.

macOS/Linux:

```bash
source .venv/bin/activate
```

## 2. 서버와 화면 실행

```bash
python -m pip install -r requirements.txt
python -m uvicorn backend.server:app --reload --host 127.0.0.1 --port 8000
```

- `/monitor/`: 준비 화면과 서버 연결 상태
- `/camera/`: C0/C1/C2 선택과 로컬 카메라 미리보기
- `/api/health`: 서버 상태 JSON
- `/ws/status`: 현재 구현 범위를 포함한 상태 메시지
- `/docs`: HTTP API 문서

화면 파일을 더블클릭하는 대신 서버 URL로 접속하세요. 서버는 `web/`만 정적으로 제공하며 설정·보정·실험 폴더는 공개하지 않습니다.

## 3. 휴대폰으로 접속하기

PC와 휴대폰을 같은 테스트 네트워크에 연결합니다. 휴대폰에서 PC의 LAN IP를 사용해야 하며, 카메라 권한을 위해 **휴대폰이 신뢰하는 HTTPS 인증서**가 필요합니다. PC의 `localhost` 예외는 다른 기기의 IP 접속에 적용되지 않습니다.

팀 환경에 맞는 로컬 HTTPS 프록시 또는 로컬 개발 인증서를 준비합니다. 인증서를 만들 때 접속할 PC 주소를 포함하고 휴대폰에서 신뢰 설정을 확인합니다. 인증서 준비 후 실행 예:

```bash
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --ssl-certfile certs/dev-cert.pem --ssl-keyfile certs/dev-key.pem
```

`https://<PC의 로컬 IP>:8000/camera/`로 접속합니다. `certs/`는 Git에서 제외됩니다. 인증서 파일은 이 저장소에 포함되어 있지 않습니다. 방화벽·공유기의 기기 격리 설정도 확인해야 합니다.

현재는 인증·세션별 접근 제어가 없는 개발용 서버이므로 팀의 로컬 테스트 환경에서 실행합니다. 외부 서비스 배포는 이번 범위에 포함하지 않습니다.

## 4. 설정 파일의 의미

`config/project.example.json`과 `config/cameras.example.json`은 **후속 구현을 위한 설정 양식**입니다. 현재 서버는 이 파일을 읽지 않습니다. 실제 기기 설정을 정한 뒤 각각 `project.local.json`, `cameras.local.json`으로 복사하고, T01에서 로더·검증을 연결합니다.

실제 보정 결과는 `calib/local/`, 로그는 `data/local/`에 둡니다. `.local.json`, 보정값, 영상, 실험 원자료는 Git에서 제외합니다. `example` 파일은 실제 성능·기기·좌표가 아닙니다.

## 5. 확인

```bash
python tools/check_scaffold.py
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

카메라가 없는 PC에서는 미리보기 실패 안내가 정상입니다. 자동 검사 통과는 실기기 3대의 수신·추적·정합이 검증됐다는 뜻이 아닙니다.

## 공식 문서

- [FastAPI WebSocket](https://fastapi.tiangolo.com/advanced/websockets/)
- [FastAPI 정적 파일](https://fastapi.tiangolo.com/tutorial/static-files/)
- [브라우저 카메라 권한과 HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MediaPipe Pose 웹 가이드](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
