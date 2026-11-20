"""Print files for the wide-stage floor markers ArUco DICT_4X4_50 ID1/ID2 (docs/WIDE_STAGE_TEST.md).

Same artwork as assets/markers/floor-direction-id0.*: 200 mm black outer square, 5 mm white margin, no labels
inside the 210 mm square. The A4 PDF adds one small line of text well below the square so the sheets can be
told apart; it is outside the white margin and does not touch the pattern. Every PNG is checked with OpenCV.

    python tools/make_floor_markers.py            # writes assets/markers/floor-direction-id{1,2}.*
    python tools/make_floor_markers.py --check    # only verifies the existing files

The duo stage (docs/DUO_STAGE_TEST.md) uses larger A3 sheets of ID0/ID1: duo-marker-id{0,1}-a3.pdf with a
270 mm black square, so the far-side view phone can read both markers at about 3 m. They are named
duo-marker-id{0,1}-a3.pdf; floor-direction-id0-a3.pdf is the older ID0 sheet with arrows and is left alone.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/markers"
SIDE_MM, MARGIN_MM = 200, 5
PNG_PX = 794                      # same density as the ID0 PNG (210 mm at about 96 dpi)
LABELS = {0: "C0 left", 1: "C1 centre", 2: "C2 right"}
A3_SIDE_MM = 270                  # A3 portrait 297 x 420 mm: 13.5 mm side margins, inside most printers' limits
A3_LABELS = {0: "duo stage C0 left", 1: "duo stage C1 right"}


def bits(marker_id: int) -> np.ndarray:
    """Inner 4x4 cells, 1 = white, row by row from the canonical top-left (front = +Y)."""
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    image = cv2.aruco.generateImageMarker(d, marker_id, 6)
    return (image[1:5, 1:5] > 127).astype(int)


def svg(marker_id: int) -> str:
    cells = "".join(f'<rect x="{c + 1}" y="{r + 1}" width="1" height="1"/>'
                    for r, row in enumerate(bits(marker_id)) for c, v in enumerate(row) if v)
    total = SIDE_MM + 2 * MARGIN_MM
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}mm" height="{total}mm" viewBox="0 0 {total} {total}">\n'
            f'<title>ArUco DICT_4X4_50 ID {marker_id} - 200 mm - A4 width</title>\n'
            f'<desc>200 x 200 mm black outer square with 5 mm white margin on all sides. No arrows or labels. Canonical top '
            f'is positive world Y. Wide stage: camera {LABELS[marker_id]}. Print A4 PDF at actual size 100 percent and '
            f'measure black square. Pattern preserves rotational identity.</desc>\n'
            f'<rect width="{total}" height="{total}" fill="white"/>\n'
            f'<svg x="{MARGIN_MM}" y="{MARGIN_MM}" width="{SIDE_MM}" height="{SIDE_MM}" viewBox="0 0 6 6" '
            f'shape-rendering="crispEdges"><rect width="6" height="6" fill="black"/><g fill="white">{cells}</g></svg>\n'
            f'</svg>\n')


def png(marker_id: int) -> np.ndarray:
    total = SIDE_MM + 2 * MARGIN_MM
    px = PNG_PX / total
    image = np.full((PNG_PX, PNG_PX), 255, np.uint8)
    x0, cell = MARGIN_MM * px, SIDE_MM * px / 6
    grid = np.zeros((6, 6), int)
    grid[1:5, 1:5] = bits(marker_id)
    for r in range(6):
        for c in range(6):
            if not grid[r, c]:
                image[round(x0 + r * cell):round(x0 + (r + 1) * cell), round(x0 + c * cell):round(x0 + (c + 1) * cell)] = 0
    return image


def pdf(marker_id: int, side_mm: float = SIDE_MM, page_mm=(210, 297), top_mm: float = 30, label: str | None = None) -> bytes:
    """Portrait page, the black square centred horizontally below `top_mm`; vector rectangles only.

    A4 default: the 210 mm artwork (200 mm square, 5 mm margin) 30 mm from the top.
    """
    mm = 72 / 25.4
    width, height = page_mm[0] * mm, page_mm[1] * mm
    cell = side_mm / 6 * mm
    x0, y_top = (width - side_mm * mm) / 2, height - (top_mm + MARGIN_MM) * mm
    ops = ["0 g", f"{x0:.3f} {y_top - side_mm * mm:.3f} {side_mm * mm:.3f} {side_mm * mm:.3f} re f", "1 g"]
    for r, row in enumerate(bits(marker_id)):
        for c, v in enumerate(row):
            if v:
                ops.append(f"{x0 + (c + 1) * cell:.3f} {y_top - (r + 2) * cell:.3f} {cell:.3f} {cell:.3f} re f")
    label = label or f"ArUco DICT_4X4_50 ID{marker_id} - wide stage {LABELS[marker_id]} - black square 200 mm - print 100% - top edge = away from phone"
    ops += ["0 g", "BT /F1 9 Tf", f"{20 * mm:.3f} {y_top - side_mm * mm - 25 * mm:.3f} Td", f"({label}) Tj", "ET"]
    stream = "\n".join(ops).encode("ascii")
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width:.3f} {height:.3f}] /Contents 4 0 R "
               f"/Resources << /Font << /F1 5 0 R >> >> >>".encode("ascii"),
               b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def metadata(marker_id: int) -> dict:
    base = json.loads((OUT / "floor-direction-id0.json").read_text(encoding="utf-8"))
    return {**base, "id": marker_id,
            "wide_stage": {"camera": f"C{marker_id}", "marker_x": f"({marker_id} - 1) * spacing_m",
                           "row": "ID0, ID1, ID2 left to right as seen from the phones, same orientation"},
            "integration": "wide stage /test/mono3d/?stage=wide&camera=C%d auto detection" % marker_id,
            "print": "A4 PDF floor-direction-id%d-a4.pdf, actual size 100%%; black outer square 200 mm; no fit to page" % marker_id}


def detected_id(path: Path) -> list:
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50))
    _, ids, _ = detector.detectMarkers(image)
    return [] if ids is None else ids.flatten().tolist()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    # ID0 is the existing artwork; regenerating its pattern must match, so the new sheets use the same layout.
    def pattern(text):
        return text[text.index("<svg x="):text.index("</svg>") + 6]
    if pattern(svg(0)) != pattern((OUT / "floor-direction-id0.svg").read_text(encoding="utf-8")):
        print("ID0 SVG differs from the generator; refusing to write mismatched sheets")
        return 1
    for marker_id in (1, 2):
        stem = OUT / f"floor-direction-id{marker_id}"
        if not args.check:
            stem.with_suffix(".svg").write_text(svg(marker_id), encoding="utf-8", newline="\n")
            cv2.imwrite(str(stem.with_suffix(".png")), png(marker_id))
            (OUT / f"floor-direction-id{marker_id}-a4.pdf").write_bytes(pdf(marker_id))
            stem.with_suffix(".json").write_text(json.dumps(metadata(marker_id), indent=2, ensure_ascii=False) + "\n",
                                                 encoding="utf-8", newline="\n")
        found = detected_id(stem.with_suffix(".png"))
        print(f"ID{marker_id}: OpenCV detects {found}")
        if found != [marker_id]:
            return 1
    for marker_id in (0, 1):
        sheet = OUT / f"duo-marker-id{marker_id}-a3.pdf"
        label = (f"ArUco DICT_4X4_50 ID{marker_id} - {A3_LABELS[marker_id]} - black square {A3_SIDE_MM} mm - A3 print 100% "
                 f"- top edge = away from the judging phone")
        data = pdf(marker_id, A3_SIDE_MM, (297, 420), 40, label)
        if not args.check:
            sheet.write_bytes(data)
        elif sheet.read_bytes() != data:
            print(f"{sheet.name} differs from the generator")
            return 1
        print(f"{sheet.name}: A3, black square {A3_SIDE_MM} mm, same pattern as ID{marker_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
