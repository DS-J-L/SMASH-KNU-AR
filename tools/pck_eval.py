"""PCK and repeated-measures ANOVA for the user test (issue #27, 2-camera stage).

Reads the sessions the server saves under data/local/pck/<session_id>/ (format: docs/PCK_EVAL.md),
projects each judging phone's 3D joints onto that phone's own JPEG, compares them with a reference
pose model (RTMPose-x via rtmlib) and writes:

    <out>/pck_frames.csv    one row per (image, joint)
    <out>/pck_summary.csv   one row per (participant, motion): mean PCK  -> ANOVA input
    <out>/anova.json        rm_anova + friedman (+ pairwise t, Holm) over the directed motions

Usage:
    python tools/pck_eval.py data/local/pck --out data/results/pck

Directed motions are labelled from the "motion:<name>" markers the operator writes during the test.

Report the result as "PCK@0.2 against a reference model (RTMPose-x)", not as ground-truth accuracy.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from bisect import bisect_left
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

# The 13 joints the phones send (web/test/mono3d/mono3d.js OUTPUT_JOINTS) and their COCO-17 index.
JOINTS = {
    "nose": 0, "left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8,
    "left_wrist": 9, "right_wrist": 10, "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14, "left_ankle": 15, "right_ankle": 16,
}
MEDIAPIPE = {"nose": 0, "left_shoulder": 11, "right_shoulder": 12, "left_elbow": 13, "right_elbow": 14,
             "left_wrist": 15, "right_wrist": 16, "left_hip": 23, "right_hip": 24,
             "left_knee": 25, "right_knee": 26, "left_ankle": 27, "right_ankle": 28}   # landmark index
DEFAULT_SCHEDULE = "right_punch:20,left_punch:20,kick:20"   # placeholder until the team fixes the list
MATCH_MS = 150          # max wait (phone ms) from a JPEG to the joint frame that describes it
MIN_REF_SCORE = 0.3     # reference joints below this score have no ground truth (excluded)

# reference(image_bgr) -> (keypoints (N,17,2), scores (N,17)) in image pixels
Reference = Callable[[np.ndarray], "tuple[np.ndarray, np.ndarray]"]


@dataclass
class Calib:
    server_ms: float
    width: int
    height: int
    K: np.ndarray       # 3x3
    R: np.ndarray       # 3x3, Xc = R Xw + t (OpenCV axes)
    t: np.ndarray       # 3


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def parse_calib(entry: dict) -> Calib:
    m = entry["msg"]
    k = m["K"]
    K = np.array([[k["fx"], 0, k["cx"]], [0, k["fy"], k["cy"]], [0, 0, 1]], dtype=float)
    R = np.asarray(m["camera"]["R"], dtype=float).reshape(3, 3)
    t = np.asarray(m["camera"]["t"], dtype=float).reshape(3)
    return Calib(float(entry["server_ms"]), int(m["image"]["width"]), int(m["image"]["height"]), K, R, t)


def project(calib: Calib, joints: dict, image_w: int, image_h: int) -> dict[str, np.ndarray | None]:
    """Marker-frame 3D joints -> pixels of the saved JPEG (the JPEG is the calibration image, resized)."""
    sx, sy = image_w / calib.width, image_h / calib.height
    out: dict[str, np.ndarray | None] = {}
    for name in JOINTS:
        p = joints.get(name) if joints else None
        if p is None:
            out[name] = None
            continue
        c = calib.R @ np.asarray(p, dtype=float) + calib.t
        if c[2] <= 1e-6:
            out[name] = None
            continue
        u, v = (calib.K @ (c / c[2]))[:2]
        out[name] = np.array([u * sx, v * sy])
    return out


def motion_at(server_ms: float, start_ms: float | None, schedule: list[tuple[str, float]]) -> str | None:
    """Directed motion label for a time, from the 'directed_start' marker and a fixed schedule."""
    if start_ms is None or server_ms < start_ms:
        return None
    elapsed = (server_ms - start_ms) / 1000.0
    for label, seconds in schedule:
        if elapsed < seconds:
            return label
        elapsed -= seconds
    return None


MOTION_PREFIX = "motion:"
END_LABELS = ("directed_end", "free_start", "session_end")


def make_labeler(markers: list[dict], schedule: list[tuple[str, float]], skip_ms: float = 1000.0):
    """server_ms -> directed motion label (or None).

    Marker mode (preferred): the operator presses a button each time the directed motion changes, which
    writes {"label": "motion:<name>"}. An image gets the latest such label, until a "directed_end" marker.
    The first `skip_ms` after every marker are dropped: the participant is still switching motions.
    A motion may come back several times (cycling through the motions until the buildings fall).

    Schedule mode (fallback): only a "directed_start" marker, motions follow a fixed timetable."""
    events = sorted((m["server_ms"], m["label"]) for m in markers
                    if m["label"].startswith(MOTION_PREFIX) or m["label"] in END_LABELS)
    if any(label.startswith(MOTION_PREFIX) for _, label in events):
        times = [t for t, _ in events]

        def by_marker(server_ms: float) -> str | None:
            i = bisect_left(times, server_ms + 1e-9) - 1      # last marker at or before the image
            if i < 0 or not events[i][1].startswith(MOTION_PREFIX) or server_ms - times[i] < skip_ms:
                return None
            return events[i][1][len(MOTION_PREFIX):]
        return by_marker
    start = next((m["server_ms"] for m in markers if m["label"] == "directed_start"), None)
    return (lambda server_ms: motion_at(server_ms, start, schedule)) if start is not None else None


def pick_person(kps: np.ndarray, scores: np.ndarray, pred: dict) -> int | None:
    """The reference person closest to the system's prediction (another person may be in frame)."""
    if len(kps) == 0:
        return None
    pts = [(JOINTS[n], p) for n, p in pred.items() if p is not None]
    if not pts:
        return int(np.argmax(scores.mean(axis=1)))
    cost = [np.mean([np.linalg.norm(kps[i, j] - p) for j, p in pts]) for i in range(len(kps))]
    return int(np.argmin(cost))


def frame_for_image(times: list[float], t: float) -> int | None:
    """Index of the joint frame that describes the image taken at phone time `t`.

    The phone stamps a JPEG with the inference time and a joint frame with the (later) send time, and
    sends the frame before the JPEG in the same tick (web/test/mono3d/app.js sendToPc). So the frame
    for an image is the first one at or after the image time, not the nearest one: the nearest can be
    the previous inference."""
    i = bisect_left(times, t - 1)          # both stamps are rounded to 1 ms
    return i if i < len(times) and times[i] - t <= MATCH_MS else None


def flatten(row: dict) -> dict:
    """joints.jsonl line -> flat dict. Accepts {"camera","server_ms","owner","msg": <mono3d_frame>} or flat."""
    return {**row.get("msg", {}), **{k: v for k, v in row.items() if k != "msg"}}


def evaluate_session(session: Path, reference: Reference, schedule: list[tuple[str, float]],
                     alpha: float = 0.2, cameras: Iterable[str] = ("C0", "C1"),
                     owner_only: bool = True, skip_ms: float = 1000.0) -> tuple[list[dict], list[float]]:
    """Rows for pck_frames.csv, and |projected joint - phone 2D landmark| in px (a calibration self-check)."""
    import cv2

    meta = json.loads((session / "meta.json").read_text(encoding="utf-8"))
    participant = meta["participant"]
    markers = read_jsonl(session / "markers.jsonl")
    label_of = make_labeler(markers, schedule, skip_ms)
    if label_of is None:
        print(f"[warn] {session.name}: no 'motion:<name>' or 'directed_start' marker; nothing can be labelled",
              file=sys.stderr)
        return [], []

    calibs: dict[str, list[Calib]] = {}
    for entry in read_jsonl(session / "calib.jsonl"):
        calibs.setdefault(entry["camera"], []).append(parse_calib(entry))
    joints_by_cam: dict[str, list[dict]] = {}
    for j in map(flatten, read_jsonl(session / "joints.jsonl")):
        joints_by_cam.setdefault(j["camera"], []).append(j)
    for rows in joints_by_cam.values():
        rows.sort(key=lambda r: r["t_ms"])

    cache_path = session / "reference_rtmpose.jsonl"
    cache = {r["file"]: r for r in read_jsonl(cache_path)}
    new_cache: list[dict] = []
    rows: list[dict] = []
    check: list[float] = []
    times = {c: [r["t_ms"] for r in v] for c, v in joints_by_cam.items()}
    for fr in read_jsonl(session / "frames.jsonl"):
        cam = fr["camera"]
        if cam not in cameras:
            continue
        motion = label_of(fr["server_ms"])
        if motion is None:
            continue
        cal = [c for c in calibs.get(cam, []) if c.server_ms <= fr["server_ms"]] or calibs.get(cam, [])[:1]
        k = frame_for_image(times.get(cam, []), fr["t_ms"])
        jrow = joints_by_cam[cam][k] if k is not None else None
        if owner_only and jrow is not None and jrow.get("owner") is False:
            continue                           # the other phone is judging this person

        if fr["file"] in cache:
            kps = np.asarray(cache[fr["file"]]["keypoints"], dtype=float).reshape(-1, 17, 2)
            scs = np.asarray(cache[fr["file"]]["scores"], dtype=float).reshape(-1, 17)
            image_w, image_h = cache[fr["file"]]["width"], cache[fr["file"]]["height"]
        else:
            img = cv2.imread(str(session / fr["file"]))
            if img is None:
                print(f"[warn] cannot read {fr['file']}", file=sys.stderr)
                continue
            image_h, image_w = img.shape[:2]
            kps, scs = reference(img)
            kps, scs = np.asarray(kps, dtype=float).reshape(-1, 17, 2), np.asarray(scs, dtype=float).reshape(-1, 17)
            new_cache.append({"file": fr["file"], "width": image_w, "height": image_h,
                              "keypoints": kps.tolist(), "scores": scs.tolist()})

        pred = (project(cal[-1], jrow["joints"], image_w, image_h)
                if cal and jrow and jrow.get("valid") else {n: None for n in JOINTS})
        lms = jrow.get("landmarks") if jrow else None
        if lms:                                # projected 3D joint should land on the phone's 2D landmark
            for name, i in MEDIAPIPE.items():
                if pred.get(name) is not None and lms[i]:
                    check.append(float(np.linalg.norm(pred[name] - [lms[i][0] * image_w, lms[i][1] * image_h])))
        person = pick_person(kps, scs, pred)
        base = {"session": session.name, "participant": participant, "camera": cam, "file": fr["file"],
                "server_ms": fr["server_ms"], "motion": motion,
                "tracked": int(any(v is not None for v in pred.values()))}
        if person is None:
            rows.append({**base, "joint": "", "status": "no_reference_person"})
            continue
        ref, sc = kps[person], scs[person]
        ls, rh = JOINTS["left_shoulder"], JOINTS["right_hip"]
        if sc[ls] < MIN_REF_SCORE or sc[rh] < MIN_REF_SCORE:
            rows.append({**base, "joint": "", "status": "no_torso"})
            continue
        torso = float(np.linalg.norm(ref[ls] - ref[rh]))
        for name, j in JOINTS.items():
            row = {**base, "joint": name, "ref_x": round(ref[j][0], 1), "ref_y": round(ref[j][1], 1),
                   "ref_score": round(float(sc[j]), 3), "torso_px": round(torso, 1)}
            if sc[j] < MIN_REF_SCORE:
                rows.append({**row, "status": "excluded_low_reference"})
                continue
            p = pred.get(name)
            if p is None:   # ground truth exists but the system gave nothing: counts as wrong
                rows.append({**row, "status": "missing_prediction", "correct": 0})
                continue
            d = float(np.linalg.norm(p - ref[j]))
            rows.append({**row, "status": "ok", "pred_x": round(p[0], 1), "pred_y": round(p[1], 1),
                         "dist_px": round(d, 1), "correct": int(d <= alpha * torso)})

    if new_cache:
        with cache_path.open("a", encoding="utf-8") as f:
            for r in new_cache:
                f.write(json.dumps(r) + "\n")
    return rows, check


def summarize(rows: list[dict]) -> list[dict]:
    """Mean PCK per (participant, motion): average of per-image PCK, one value per cell.

    tracked_rate = share of those images where the system output any joint. Untracked images stay in the
    PCK (all joints wrong), so report both."""
    per_image: dict[tuple, list[int]] = {}
    tracked: dict[tuple, int] = {}
    for r in rows:
        if "correct" in r:
            key = (r["participant"], r["motion"], r["camera"], r["file"])
            per_image.setdefault(key, []).append(r["correct"])
            tracked[key] = r["tracked"]
    cells: dict[tuple, list[tuple[float, int]]] = {}
    for key, marks in per_image.items():
        cells.setdefault(key[:2], []).append((sum(marks) / len(marks), tracked[key]))
    return [{"participant": pid, "motion": motion, "n_images": len(v),
             "pck": round(float(np.mean([a for a, _ in v])), 4),
             "tracked_rate": round(float(np.mean([b for _, b in v])), 4)}
            for (pid, motion), v in sorted(cells.items())]


def anova(summary: list[dict], min_images: int = 10) -> dict:
    """Repeated-measures ANOVA over motions. A cell with fewer than `min_images` images is treated as
    missing (its mean is too noisy), and a participant with a missing cell is left out."""
    import pandas as pd
    import pingouin as pg

    df = pd.DataFrame(summary)
    if df.empty:
        return {"error": "no data"}
    thin = df[df["n_images"] < min_images]
    wide = df[df["n_images"] >= min_images].pivot(index="participant", columns="motion", values="pck")
    wide = wide.reindex(columns=sorted(df["motion"].unique()))
    full = wide.dropna()
    dropped = sorted(set(df["participant"]) - set(full.index))
    long = full.reset_index().melt(id_vars="participant", var_name="motion", value_name="pck")
    result: dict = {"n_participants": int(len(full)), "motions": list(full.columns),
                    "dropped_incomplete": dropped, "min_images_per_cell": min_images,
                    "thin_cells": [f"{r.participant}/{r.motion} ({r.n_images} images)" for r in thin.itertuples()],
                    "means": {m: round(float(full[m].mean()), 4) for m in full.columns}}
    if len(full) < 2 or full.shape[1] < 2:
        result["error"] = "need at least 2 participants with every motion"
        return result
    clean = lambda d: json.loads(d.to_json(orient="records"))
    kw = {"dv": "pck", "within": "motion", "subject": "participant"}
    errors: dict[str, str] = {}
    try:
        result["rm_anova"] = clean(pg.rm_anova(long, correction=True, effsize="np2", **kw))
    except (ZeroDivisionError, ValueError, np.linalg.LinAlgError) as exc:
        # Mauchly's test needs more participants than 2 (pingouin divides by zero): report uncorrected.
        errors["sphericity"] = f"{type(exc).__name__}: {exc}"
        result["rm_anova"] = clean(pg.rm_anova(long, correction=False, effsize="np2", **kw))
    for key, fn in (("friedman", lambda: pg.friedman(long, **kw)),
                    ("pairwise_t_holm", lambda: pg.pairwise_tests(long, padjust="holm", **kw))):
        try:
            result[key] = clean(fn())
        except (ZeroDivisionError, ValueError, np.linalg.LinAlgError) as exc:
            errors[key] = f"{type(exc).__name__}: {exc}"
    if errors:
        result["stat_errors"] = errors
    return result


def rtmpose_reference(mode: str = "performance", device: str = "cpu") -> Reference:
    from rtmlib import Body
    body = Body(mode=mode, backend="onnxruntime", device=device)
    return lambda img: body(img)


def parse_schedule(text: str) -> list[tuple[str, float]]:
    out = []
    for part in text.split(","):
        label, _, sec = part.partition(":")
        out.append((label.strip(), float(sec)))
    return out


def write_csv(path: Path, rows: list[dict]) -> None:
    keys = list(dict.fromkeys(k for r in rows for k in r))
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def run(root: Path, out: Path, reference: Reference, schedule: list[tuple[str, float]],
        alpha: float = 0.2, cameras: Iterable[str] = ("C0", "C1"), owner_only: bool = True,
        skip_ms: float = 1000.0, min_images: int = 10) -> dict:
    sessions = sorted(p for p in root.iterdir() if (p / "meta.json").exists())
    if not sessions:
        raise SystemExit(f"no sessions under {root}")
    rows: list[dict] = []
    check: list[float] = []
    for s in sessions:
        r, c = evaluate_session(s, reference, schedule, alpha, cameras, owner_only, skip_ms)
        rows += r
        check += c
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "pck_frames.csv", rows)
    summary = summarize(rows)
    write_csv(out / "pck_summary.csv", summary)
    statuses: dict[str, int] = {}
    for r in rows:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    result = {"metric": f"PCK@{alpha} vs reference model (RTMPose)", "sessions": [s.name for s in sessions],
              "schedule": schedule, "row_status_counts": statuses,
              # Should be ~0-2 px. Larger means the calibration, image size or mirroring does not match.
              "projection_check_px": ({"n": len(check), "median": round(float(np.median(check)), 2),
                                       "p95": round(float(np.percentile(check, 95)), 2)} if check else None),
              **anova(summary, min_images)}
    if check and np.median(check) > 3:
        print(f"[warn] projected joints are {np.median(check):.1f} px (median) away from the phone's own 2D "
              "landmarks: check calibration / image size / mirroring before trusting PCK", file=sys.stderr)
    (out / "anova.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path, help="folder holding <session_id>/ folders (data/local/pck)")
    ap.add_argument("--out", type=Path, default=Path("data/results/pck"))
    ap.add_argument("--schedule", default=DEFAULT_SCHEDULE,
                    help="fallback when a session has no 'motion:<name>' markers: motions after the "
                         "'directed_start' marker, label:seconds,...")
    ap.add_argument("--skip-ms", type=float, default=1000.0,
                    help="drop images this long after each 'motion:<name>' marker (switching motions)")
    ap.add_argument("--min-images", type=int, default=10,
                    help="a participant x motion cell needs at least this many images to enter the ANOVA")
    ap.add_argument("--alpha", type=float, default=0.2, help="PCK threshold as a fraction of torso length")
    ap.add_argument("--cameras", default="C0,C1")
    ap.add_argument("--mode", default="performance", choices=["performance", "balanced", "lightweight"])
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--all-cameras", action="store_true",
                    help="also score images from the phone that is not judging (default: judging phone only)")
    a = ap.parse_args(argv)
    result = run(a.root, a.out, rtmpose_reference(a.mode, a.device), parse_schedule(a.schedule),
                 a.alpha, tuple(a.cameras.split(",")), not a.all_cameras, a.skip_ms, a.min_images)
    print(json.dumps({k: result.get(k) for k in ("n_participants", "means", "dropped_incomplete", "thin_cells",
                                                 "projection_check_px", "row_status_counts", "error")},
                     ensure_ascii=False, indent=2))
    for r in result.get("rm_anova", []):
        print(f"RM-ANOVA F({r.get('ddof1')}, {r.get('ddof2')}) = {r.get('F'):.3f}, p = {r.get('p_unc'):.4f}")
    print(f"wrote {a.out}/pck_frames.csv, pck_summary.csv, anova.json")


if __name__ == "__main__":
    main()
