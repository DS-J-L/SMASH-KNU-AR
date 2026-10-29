# 추론 모델

## 휴대폰 MediaPipe (T02)

브라우저용 런타임과 모델은 Git에 넣지 않고, 아래 명령으로 `web/public/vendor/mediapipe/`에 받습니다. 스크립트가 파일마다 SHA-256을 확인하므로 팀원 모두 같은 파일을 제공합니다. 시연 중에는 외부 CDN에 의존하지 않습니다.

```bash
python tools/fetch_mediapipe.py
```

| 항목 | 버전·파일 | 출처 |
| --- | --- | --- |
| 런타임 | `@mediapipe/tasks-vision` 0.10.35 (`vision_bundle.mjs`, `wasm/vision_wasm_internal.*`, `wasm/vision_wasm_nosimd_internal.*`) | npm 패키지, jsDelivr로 받음. Apache-2.0 |
| 모델 기본값 | `pose_landmarker_lite.task` float16 v1, 5,777,746 B | `storage.googleapis.com/mediapipe-models/pose_landmarker/` |
| 모델 선택 | `pose_landmarker_full.task` float16 v1, 9,398,198 B | 같은 경로 |

카메라 페이지에서 lite/full을 고를 수 있습니다. GPU 생성이 실패하면 CPU로 다시 시도하며, 실제로 쓴 쪽을 화면과 `camera_hello.device_info`에 표시합니다. 버전을 바꿀 때는 `tools/fetch_mediapipe.py`의 해시와 이 표를 함께 고칩니다.

## PC 추론

D01에서 PC 추론을 채택하면 PC용 모델은 이 폴더에 둡니다. 두 위치에 불필요하게 복제하지 않습니다.

[MediaPipe Pose 웹 가이드](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
