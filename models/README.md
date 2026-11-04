# 추론 모델

## 휴대폰 MediaPipe (T02)

브라우저용 런타임과 모델은 Git에 넣지 않고, 아래 명령으로 `web/public/vendor/mediapipe/`에 받습니다. 스크립트가 파일마다 SHA-256을 확인하므로 팀원 모두 같은 파일을 제공합니다. 시연 중에는 외부 CDN에 의존하지 않습니다.

```bash
python tools/fetch_mediapipe.py
```

| 항목 | 버전·파일 | 출처 |
| --- | --- | --- |
| 런타임 | `@mediapipe/tasks-vision` 0.10.35 (`vision_bundle.js`, `wasm/vision_wasm_internal.*`, `wasm/vision_wasm_nosimd_internal.*`) | npm 패키지, jsDelivr로 받음. Apache-2.0 |
| 모델 기본값 | `pose_landmarker_lite.task` float16 v1, 5,777,746 B | `storage.googleapis.com/mediapipe-models/pose_landmarker/` |
| 모델 선택 | `pose_landmarker_full.task` float16 v1, 9,398,198 B | 같은 경로 |

카메라 페이지에서 lite/full을 고를 수 있습니다. GPU 생성이 실패하면 CPU로 다시 시도하며, 실제로 쓴 쪽을 화면과 `camera_hello.device_info`에 표시합니다. 버전을 바꿀 때는 `tools/fetch_mediapipe.py`의 해시와 이 표를 함께 고칩니다.

원본 `vision_bundle.mjs`는 같은 내용·해시의 `vision_bundle.js`로 저장합니다. Windows의 `.mjs` MIME 등록이 `text/plain`이면 브라우저가 모듈을 거부하므로, 이 경우에도 실행할 수 있도록 제공 파일명만 바꿨습니다. 이전에 받은 경우 다운로드 명령을 다시 실행하세요.

## PC 추론

D01에서 PC 추론을 채택하면 PC용 모델은 이 폴더에 둡니다. 두 위치에 불필요하게 복제하지 않습니다.

단일 카메라 모드(SC-D04)의 PC 추론은 별도 모델을 두지 않습니다. `frontend/single/pose-adapter.js`가 실행 시점에 `/camera/pose.js`를 불러와 위 표의 같은 런타임·모델을 씁니다. 그래서 Vite 번들에는 MediaPipe가 들어가지 않으며, PC에서도 다운로드 명령을 먼저 실행해야 합니다. GPU 첫 추론은 셰이더 준비로 수 초 걸릴 수 있어(2026-11-03 M4 Chrome 시험 8.9초), 어댑터가 등록 직후 빈 화면으로 한 번 추론해 둡니다.

[MediaPipe Pose 웹 가이드](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
