"""PCK and repeated-measures ANOVA for the user test (issue #27, 2-camera stage).

Reads the sessions the server saves under data/local/pck/<session_id>/ (format: docs/PCK_EVAL.md),
projects each judging phone's 3D joints onto that phone's own JPEG, compares them with a reference
pose model (RTMPose-x via rtmlib) and writes:

    <out>/pck_frames.csv    one row per (image, joint)
    <out>/pck_summary.csv   one row per (participant, motion): mean PCK  -> ANOVA input
    <out>/anova.json        rm_anova + friedman (+ pairwise t, Holm) over the directed motions

Usage:
    python tools/pck_eval.py data/local/pck --out data/results/pck \
        --schedule right_punch:20,left_punch:20,kick:20

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
DEFAULT_SCHEDULE = "right_punch:20,left_punch:20,kick:20"   # placeholder until the team fixes the list
MATCH_MS = 150          # max |t_ms| gap between a JPEG and the joint frame of the same phone
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


def pick_person(kps: np.ndarray, scores: np.ndarray, pred: dict) -> int | None:
    """The reference person closest to the system's prediction (another person may be in frame)."""
    if len(kps) == 0:
        return None
    pts = [(JOINTS[n], p) for n, p in pred.items() if p is not None]
    if not pts:
        return int(np.argmax(scores.mean(axis=1)))
    cost = [np.mean([np.linalg.norm(kps[i, j] - p) for j, p in pts]) for i in range(len(kps))]
    return int(np.argmin(cost))


def nearest(times: list[float], t: float) -> int | None:
    if not times:
        return None
    i = bisect_left(times, t)
    best = min((k for k in (i - 1, i) if 0 <= k < len(times)), key=lambda k: abs(times[k] - t))
    return best


def evaluate_session(session: Path, reference: Reference, schedule: list[tuple[str, float]],
                     alpha: float = 0.2, cameras: Iterable[str] = ("C0", "C1")) -> list[dict]:
    import cv2

    meta = json.loads((session / "meta.json").read_text(encoding="utf-8"))
    participant = meta["participant"]
    markers = read_jsonl(session / "markers.jsonl")
    start = next((m["server_ms"] for m in markers if m["label"] == "directed_start"), None)
    if start is None:
        print(f"[warn] {session.name}: no 'directed_start' marker; directed motions cannot be labelled",
              file=sys.stderr)

    calibs: dict[str, list[Calib]] = {}
    for entry in read_jsonl(session / "calib.jsonl"):
        calibs.setdefault(entry["camera"], []).append(parse_calib(entry))
    joints_by_cam: dict[str, list[dict]] = {}
    for j in read_jsonl(session / "joints.jsonl"):
        joints_by_cam.setdefault(j["camera"], []).append(j)
    for rows in joints_by_cam.values():
        rows.sort(key=lambda r: r["t_ms"])

    cache_path = session / "reference_rtmpose.jsonl"
    cache = {r["file"]: r for r in read_jsonl(cache_path)}
    new_cache: list[dict] = []
    rows: list[dict] = []
    for fr in read_jsonl(session / "frames.jsonl"):
        cam = fr["camera"]
        if cam not in cameras:
            continue
        motion = motion_at(fr["server_ms"], start, schedule)
        if motion is None:
            continue
        cal = [c for c in calibs.get(cam, []) if c.server_ms <= fr["server_ms"]]
        jlist = joints_by_cam.get(cam, [])
        k = nearest([r["t_ms"] for r in jlist], fr["t_ms"])
        jrow = jlist[k] if k is not None and abs(jlist[k]["t_ms"] - fr["t_ms"]) <= MATCH_MS else None

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
        person = pick_person(kps, scs, pred)
        base = {"session": session.name, "participant": participant, "camera": cam, "file": fr["file"],
                "server_ms": fr["server_ms"], "motion": motion, "owner": bool(jrow and jrow.get("owner"))}
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
    return rows


def summarize(rows: list[dict]) -> list[dict]:
    """Mean PCK per (participant, motion): average of per-image PCK, one value per cell."""
    per_image: dict[tuple, list[int]] = {}
    for r in rows:
        if "correct" in r:
            per_image.setdefault((r["participant"], r["motion"], r["camera"], r["file"]), []).append(r["correct"])
    cells: dict[tuple, list[float]] = {}
    for (pid, motion, _cam, _file), marks in per_image.items():
        cells.setdefault((pid, motion), []).append(sum(marks) / len(marks))
    return [{"participant": pid, "motion": motion, "n_images": len(v), "pck": round(float(np.mean(v)), 4)}
            for (pid, motion), v in sorted(cells.items())]


def anova(summary: list[dict]) -> dict:
    import pandas as pd
    import pingouin as pg

    df = pd.DataFrame(summary)
    if df.empty:
        return {"error": "no data"}
    full = df.pivot(index="participant", columns="motion", values="pck").dropna()
    dropped = sorted(set(df["participant"]) - set(full.index))
    long = full.reset_index().melt(id_vars="participant", var_name="motion", value_name="pck")
    result: dict = {"n_participants": int(len(full)), "motions": list(full.columns),
                    "dropped_incomplete": dropped,
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
        alpha: float = 0.2, cameras: Iterable[str] = ("C0", "C1")) -> dict:
    sessions = sorted(p for p in root.iterdir() if (p / "meta.json").exists())
    if not sessions:
        raise SystemExit(f"no sessions under {root}")
    rows: list[dict] = []
    for s in sessions:
        rows += evaluate_session(s, reference, schedule, alpha, cameras)
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "pck_frames.csv", rows)
    summary = summarize(rows)
    write_csv(out / "pck_summary.csv", summary)
    statuses: dict[str, int] = {}
    for r in rows:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    result = {"metric": f"PCK@{alpha} vs reference model (RTMPose)", "sessions": [s.name for s in sessions],
              "schedule": schedule, "row_status_counts": statuses, **anova(summary)}
    (out / "anova.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path, help="folder holding <session_id>/ folders (data/local/pck)")
    ap.add_argument("--out", type=Path, default=Path("data/results/pck"))
    ap.add_argument("--schedule", default=DEFAULT_SCHEDULE,
                    help="directed motions after the 'directed_start' marker, label:seconds,...")
    ap.add_argument("--alpha", type=float, default=0.2, help="PCK threshold as a fraction of torso length")
    ap.add_argument("--cameras", default="C0,C1")
    ap.add_argument("--mode", default="performance", choices=["performance", "balanced", "lightweight"])
    ap.add_argument("--device", default="cpu")
    a = ap.parse_args(argv)
    result = run(a.root, a.out, rtmpose_reference(a.mode, a.device), parse_schedule(a.schedule),
                 a.alpha, tuple(a.cameras.split(",")))
    print(json.dumps({k: result.get(k) for k in ("n_participants", "means", "dropped_incomplete", "error")},
                     ensure_ascii=False, indent=2))
    for r in result.get("rm_anova", []):
        print(f"RM-ANOVA F({r.get('ddof1')}, {r.get('ddof2')}) = {r.get('F'):.3f}, p = {r.get('p_unc'):.4f}")
    print(f"wrote {a.out}/pck_frames.csv, pck_summary.csv, anova.json")


if __name__ == "__main__":
    main()
