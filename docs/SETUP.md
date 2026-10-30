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
- `/api/calibration`: 카메라별 보정 상태·값
- `/ws/status`: 실제 입력·보정·추적 기준의 상태 메시지
- `/ws/ingest`, `/ws/pose3d`: 휴대폰 입력과 3D 손목 전달. 형식은 [데이터 계약](DATA_CONTRACT.md)
- `/docs`: HTTP API 문서

화면 파일을 더블클릭하는 대신 서버 URL로 접속하세요. 서버는 `web/`만 정적으로 제공하며 설정·보정·실험 폴더는 공개하지 않습니다.

## 3. 휴대폰으로 접속하기 — 외부 주소 방식 (D07)

휴대폰 브라우저는 신뢰하는 HTTPS에서만 카메라를 켭니다. 사용자는 로컬 PC + ipTIME 포트포워딩 외부 접속을 요청했습니다. 아래 **DuckDNS 주소 + Let's Encrypt 인증서 + 접속 키 + TCP 8443**는 외부 에이전트 산출물의 실행 예시이며, 세부 방식과 실제 접속은 검증 대기입니다([결정 기록 D07](DECISIONS.md)). 실제 주소·접속 키·공인 IP는 저장소에 적지 않고 팀 안에서만 공유합니다.

### 3-1. 처음 한 번 준비 (서버 PC 담당)

1. **내부 IP 고정:** 공유기 DHCP 설정에서 서버 PC를 고정 할당합니다. 서버는 유선 연결을 기준으로 합니다(Wi-Fi는 다른 IP를 받을 수 있음).
2. **포트포워딩:** 외부 TCP 8443 → 서버 PC 8443. 인증서를 발급·갱신할 때만 외부 TCP 80 → 서버 PC 80을 켜고, 끝나면 비활성화합니다.
3. **방화벽(Windows, 관리자 PowerShell):**
   ```powershell
   New-NetFirewallRule -DisplayName "SMASH 8443" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow
   New-NetFirewallRule -DisplayName "SMASH 80" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
   ```
4. **주소:** duckdns.org에서 하위 도메인을 만들고 현재 공인 IP를 등록합니다. 고정 IP라면 갱신 프로그램은 필요 없습니다. 산출물은 ipTIME DDNS 인증서 발급 실패를 기록했지만, 이번 PC에서는 재현하지 않았습니다. 주소·발급 방식은 실제 DNS와 인증서 발급 결과로 확인합니다.
5. **인증서(Windows, win-acme):** 관리자 PowerShell에서 실행합니다. 결과 폴더는 미리 만듭니다.
   ```powershell
   mkdir C:\certs
   cd C:\win-acme
   .\wacs.exe --source manual --host <팀 주소>.duckdns.org --validation selfhosting --store pemfiles --pemfilespath C:\certs --accepttos --emailaddress <담당자 이메일>
   ```
   `C:\certs\<주소>-chain.pem`(인증서+체인)과 `<주소>-key.pem`(개인키)이 생깁니다. 개인키는 공유하거나 저장소에 넣지 않습니다(`.gitignore`의 `*.pem`). 실제 만료일은 발급 결과로 확인합니다. 80번 포트를 꺼두면 HTTP 검증 기반 자동 갱신이 실패할 수 있으므로 갱신 시 포트 개방 절차도 확인해야 합니다.

### 3-2. 서버 실행

접속 키는 추측하기 어려운 값(영문·숫자 16자 이상)으로 정합니다. Windows에서는 프로젝트 루트에 아래 내용의 배치 파일을 만들어 실행할 수 있습니다. 이 파일은 키를 담으므로 커밋하지 않습니다(`*.local.bat` 등 로컬 이름 사용).

```bat
@echo off
cd /d %~dp0
set SMASH_ACCESS_KEY=<접속 키>
.venv\Scripts\python.exe -m uvicorn backend.server:app --host 0.0.0.0 --port 8443 ^
  --ssl-certfile C:\certs\<주소>-chain.pem --ssl-keyfile C:\certs\<주소>-key.pem
pause
```

휴대폰·모니터에서 `https://<주소>:8443/monitor/?key=<접속 키>`처럼 **처음 한 번 키를 붙여** 엽니다. 이후 같은 브라우저에서는 쿠키로 통과합니다. 서버가 켜져 있는 동안만 외부에서 접속되므로, 시험이 끝나면 서버를 끕니다. 행사·평가 중에는 PC 절전을 끕니다.

같은 공유기 Wi-Fi 안에서 외부 주소로 접속이 안 되면 공유기의 NAT 루프백 설정을 확인합니다. 휴대폰은 가능하면 서버와 같은 공유기 Wi-Fi(5GHz)에 연결해 지연을 줄입니다.

### 3-3. 같은 네트워크 안에서만 시험할 때

외부 주소 없이 시험하려면 접속할 PC 주소를 포함한 로컬 개발 인증서를 만들고 휴대폰에서 신뢰 설정을 한 뒤 `--ssl-certfile`, `--ssl-keyfile`로 실행합니다. 인증서는 `certs/`에 두며 Git에서 제외됩니다.

## 4. 설정 파일과 보정 파일

서버는 `config/project.local.json`, `config/cameras.local.json`을 읽습니다. 없으면 `*.example.json`의 제안값을 읽고 상태 메시지에 `config_source: "example"`로 표시합니다. 실제 기기 설정을 정하면 example을 복사해 `.local.json`으로 만들고 값을 고칩니다. 환경변수 `SMASH_PROJECT_CONFIG`, `SMASH_CAMERAS_CONFIG`로 다른 경로를 지정할 수 있습니다.

| 설정 | 위치 | 의미 |
| --- | --- | --- |
| `tracking.visibility_min`, `max_skew_ms`, `max_reprojection_error_px`, `min_views` | project | 3D 유효성 기준(제안값, 파일럿 후 확정) |
| `tracking.max_frame_age_ms` | project | 이보다 오래된 프레임은 `stale`. null이면 서버 기본값 250ms를 쓰고 기록에 남김 |
| `tracking.max_wait_ms` | project | 늦은 카메라를 기다리는 최대 시간(제안 100ms) |
| `tracking.align_mode` | project | `nearest`(기본) / `interpolate`(D08 제안) |
| `tracking.allowed_timestamp_sources` | project | 3D 정렬에 쓸 촬영 시각 출처. 기본 `["capture_metadata"]` |
| `cameras[].device_id` | cameras | 지정하면 그 기기만 해당 번호로 등록 가능 |
| `cameras[].calibration_file` | cameras | 저장소 루트 기준 경로, 예 `calib/local/C0.json` |

실제 보정 결과는 `calib/local/`, 로그는 `data/local/`에 둡니다. `.local.json`, 보정값, 영상, 실험 원자료는 Git에서 제외합니다. `example` 파일은 실제 성능·기기·좌표가 아닙니다.

### 합성 입력으로 서버 경로 확인

실기기 없이 등록 → 시계 교환 → `pose_2d` → 정렬 → `pose_3d` 경로를 확인하는 도구입니다. **모든 값은 합성이며 실측 정확도가 아닙니다.** 합성 보정은 `data/local/synthetic/`에 만들어지고, 서버 상태의 보정 준비는 항상 false로 남습니다.

```bash
python tools/synthetic.py
SMASH_CAMERAS_CONFIG=data/local/synthetic/cameras.json SMASH_ALLOW_SYNTHETIC_CALIBRATION=1 \
  python -m uvicorn backend.server:app --port 8000
# 다른 터미널, tools 폴더에서
python synthetic_cameras.py --url ws://127.0.0.1:8000 --seconds 10
```

Windows PowerShell에서는 환경변수를 `$env:SMASH_CAMERAS_CONFIG="data/local/synthetic/cameras.json"`처럼 지정합니다.

## 5. 확인

```bash
python tools/check_scaffold.py
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

카메라가 없는 PC에서는 미리보기 실패 안내가 정상입니다. 자동 검사와 합성 확인 통과는 실기기 3대의 수신·추적·정합이 검증됐다는 뜻이 아닙니다.

## 공식 문서

- [FastAPI WebSocket](https://fastapi.tiangolo.com/advanced/websockets/)
- [FastAPI 정적 파일](https://fastapi.tiangolo.com/tutorial/static-files/)
- [브라우저 카메라 권한과 HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MediaPipe Pose 웹 가이드](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

## 로컬 반영 검증 환경 (2026-10-30)

Windows Python 3.13.14의 `.venv`에 `requirements-dev.txt`를 설치해 자동 테스트 50개 통과를 확인했습니다. 기존 기준 Python 3.12의 Linux 검증과 구분합니다. Starlette TestClient의 httpx 사용 중단 예정 경고가 1개 있으며 테스트 실패는 아닙니다. 공인 HTTPS·휴대폰 접속은 미검증입니다.

### 2026-10-30 19:37 KST — 외부 접속 후속 확인

사용자가 인증서 발급·포트포워딩과 외부 접속 성공을 보고했습니다. 이전 미검증 기록 이후의 확인이며, 외부 브라우저의 에이전트 재현은 아닙니다. 로컬 실행 파일 start_server.local.bat는 같은 폴더의 start_server.local.ps1을 호출합니다. 첫 실행에 기존 접속 키를 입력하면 access-key.local.txt에 저장·재사용합니다. 세 파일은 Git 제외되며, 현재 서버 종료 후 실행합니다. 관절 송신·실제 3대 통합은 여전히 미검증입니다.

### 2026-10-30 — 로컬 실행 파일의 키 관리 변경

현재 로컬 실행 파일은 프로젝트 .env의 SMASH_ACCESS_KEY를 읽습니다. access-key.local.txt와 첫 실행 키 입력 방식은 더 이상 사용하지 않습니다. 기존 서버를 종료하고 start_server.local.bat를 실행하면 적용됩니다. 키 누락·중복·16자 미만이면 시작을 중단합니다. .env·실행 파일은 Git 제외 대상이며 Uvicorn 직접 실행은 .env를 자동 로드하지 않습니다. PowerShell 실행 파일의 -CheckOnly로 키를 출력하지 않고 필수 파일과 키 형식을 검사할 수 있습니다.
