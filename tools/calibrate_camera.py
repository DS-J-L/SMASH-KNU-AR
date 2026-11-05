"""Offline lens/marker point calibration. Never writes or activates config automatically."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.calibration.solve import intrinsics, marker_pose, triangular_prism


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['intrinsics', 'marker', 'prism'])
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding='utf-8-sig'))
    result = {'intrinsics': intrinsics, 'marker': marker_pose, 'prism': triangular_prism}[args.mode](data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"{result['source']} calibration written: {args.output}")


if __name__ == '__main__':
    main()
