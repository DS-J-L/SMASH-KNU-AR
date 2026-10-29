"""Download the pinned MediaPipe web runtime and pose models into web/public/vendor/mediapipe/.

The files are not committed. Each download is checked against a fixed SHA-256 so every
team machine serves the same runtime and model. Run from any directory:

    python tools/fetch_mediapipe.py
"""

import base64
import hashlib
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "web" / "public" / "vendor" / "mediapipe"
TASKS_VISION_VERSION = "0.10.35"
NPM_BASE = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{TASKS_VISION_VERSION}"
MODEL_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"

# (published path, source URL, SHA-256 as reported by jsDelivr / measured on 2026-10-29)
FILES = [
    ("vision_bundle.mjs", f"{NPM_BASE}/vision_bundle.mjs",
     "VderYk+7cNzFrcSubX6pz8tWkTnT2/vysd6vy5ZrwP4="),
    ("wasm/vision_wasm_internal.js", f"{NPM_BASE}/wasm/vision_wasm_internal.js",
     "5/2YWOjo8iHZuW7dwR+OB38mPgt7vXnTy+iCsTQnT4w="),
    ("wasm/vision_wasm_internal.wasm", f"{NPM_BASE}/wasm/vision_wasm_internal.wasm",
     "alxkWEwqthx2O24gSvvbx84cr39SFhhzIryo35T2Rrw="),
    ("wasm/vision_wasm_nosimd_internal.js", f"{NPM_BASE}/wasm/vision_wasm_nosimd_internal.js",
     "Q40f6P9/TZRgJbwhHCkVQ8A32KN4XtTu5g8fUhsjYpY="),
    ("wasm/vision_wasm_nosimd_internal.wasm", f"{NPM_BASE}/wasm/vision_wasm_nosimd_internal.wasm",
     "ijCS00x50/V+a6hZIQXoqQ9rB8J4kf/s0UzKQov9PjE="),
    ("models/pose_landmarker_lite.task",
     f"{MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
     "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"),
    ("models/pose_landmarker_full.task",
     f"{MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task",
     "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"),
]


def expected_hex(value: str) -> str:
    return value if len(value) == 64 else base64.b64decode(value).hex()


def main() -> int:
    errors = []
    for relative, url, digest in FILES:
        path = TARGET / relative
        want = expected_hex(digest)
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == want:
            print(f"ok    {relative}")
            continue
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
        got = hashlib.sha256(data).hexdigest()
        if got != want:
            errors.append(f"{relative}: sha256 {got} != {want}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"saved {relative} ({len(data):,} bytes)")
    if errors:
        print("\n".join(errors))
        return 1
    print(f"OK: MediaPipe tasks-vision {TASKS_VISION_VERSION} → {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
