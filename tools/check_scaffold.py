"""Dependency-free JSON and local Markdown link check; run from any directory."""

import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
json_paths = sorted(ROOT.glob("config/*.example.json")) + sorted(ROOT.glob("contracts/*.example.json"))

for path in json_paths:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("sample_only") is not True:
            errors.append(f"{path.relative_to(ROOT)}: example must have sample_only=true")
    except (ValueError, OSError) as exc:
        errors.append(f"{path.relative_to(ROOT)}: {exc}")

markdown_paths = [path for path in ROOT.rglob("*.md") if not any(
    part.startswith(".") and part != ".github" for part in path.relative_to(ROOT).parts
)]
for path in markdown_paths:
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
        if target.startswith(("https://", "http://", "mailto:", "#")):
            continue
        target = target.split("#", 1)[0]
        if target and not (path.parent / target).exists():
            errors.append(f"{path.relative_to(ROOT)}: missing link target {target}")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"OK: {len(json_paths)} JSON examples, {len(markdown_paths)} Markdown files and local links")
