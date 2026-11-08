import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "tools"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

# Tests use the shared example configs so a developer's local configs/calibration never leak in.
os.environ["SMASH_PROJECT_CONFIG"] = str(ROOT / "config/project.example.json")
os.environ["SMASH_CAMERAS_CONFIG"] = str(ROOT / "config/cameras.example.json")
for name in ("SMASH_ACCESS_KEY", "SMASH_ALLOW_SYNTHETIC_CALIBRATION"):
    os.environ.pop(name, None)
