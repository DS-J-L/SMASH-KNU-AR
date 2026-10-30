"""Synthetic end-to-end check of the server: three fake phones + one pose_3d consumer.

Every message is sample_only=true and every number printed is a SYNTHETIC result. It checks
the software path (register -> clock sync -> pose_2d -> alignment -> pose_3d), not real accuracy.

    python tools/synthetic.py                       # writes data/local/synthetic/*.json
    SMASH_CAMERAS_CONFIG=data/local/synthetic/cameras.json SMASH_ALLOW_SYNTHETIC_CALIBRATION=1 \
        python -m uvicorn backend.server:app --port 8000
    python tools/synthetic_cameras.py --url ws://127.0.0.1:8000 --seconds 10
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import ssl
import time
import uuid
from urllib.parse import quote

import numpy as np
import websockets

from synthetic import synthetic_rig, wrists_at

CLOCK_OFFSETS = {"C0": 1834.0, "C1": -5212.0, "C2": 377.0}   # fake device clock - server clock (ms)


def now_ms() -> float:
    return time.time() * 1000.0


INSECURE = False   # --insecure: accept a self-signed certificate (local testing only)


def ssl_ctx(url: str):
    if not url.startswith("wss://"):
        return None
    ctx = ssl.create_default_context()
    if INSECURE:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def with_key(url: str, key: str) -> str:
    return f"{url}?key={quote(key)}" if key else url


async def fake_phone(url, key, cid, cal, seconds, fps, stop, report):
    offset = CLOCK_OFFSETS[cid]
    device_clock = lambda: now_ms() + offset  # noqa: E731
    clock_id = uuid.uuid4().hex
    rng = np.random.default_rng(abs(hash(cid)) % 2**32)
    async with websockets.connect(with_key(f"{url}/ws/ingest", key), ssl=ssl_ctx(url)) as ws:
        await ws.send(json.dumps({"schema_version": "0.1", "type": "register", "camera_id": cid,
                                  "device_id": cal.device_id, "sample_only": True}))
        reg = json.loads(await ws.recv())
        if reg.get("type") != "registered":
            raise SystemExit(f"{cid} registration failed: {reg}")
        lock = asyncio.Lock()

        async def send(msg, delay):
            await asyncio.sleep(delay)
            try:
                async with lock:
                    await ws.send(json.dumps(msg))
            except websockets.ConnectionClosed:
                pass

        async def reader():
            async for raw in ws:
                m = json.loads(raw)
                if m["type"] == "clock_ping":
                    async def answer(m=m):
                        await asyncio.sleep(random.uniform(0.003, 0.03))           # downlink delay
                        await send({"schema_version": "0.1", "type": "clock_pong", "ping_id": m["ping_id"],
                                    "server_send_ms": m["server_send_ms"], "device_time_ms": device_clock(),
                                    "clock_id": clock_id}, random.uniform(0.003, 0.03))  # uplink delay
                    asyncio.create_task(answer())
                elif m["type"] == "error":
                    report.setdefault("errors", []).append((cid, m["code"]))

        rtask = asyncio.create_task(reader())
        outbox: asyncio.Queue = asyncio.Queue()

        async def uplink():
            # one WebSocket preserves order: jitter delays frames but never reorders them
            while True:
                due, msg = await outbox.get()
                await send(msg, max(0.0, due - time.monotonic()))

        utask = asyncio.create_task(uplink())

        await asyncio.sleep(1.5)
        await asyncio.sleep(random.uniform(0, 1 / fps))          # unsynchronized shutters
        frame_id, end = 0, time.time() + seconds
        while time.time() < end and not stop.is_set():
            t_true = now_ms()
            wrists = {}
            for name, X in wrists_at(t_true).items():
                u, v = cal.project(X)[0] + rng.normal(0, 1.5, 2)    # 1.5 px detection noise
                vis = 0.1 if rng.random() < 0.05 else 0.95          # occasional occlusion
                wrists[name] = {"u_px": float(u), "v_px": float(v), "visibility": vis}
            msg = {"schema_version": "0.1", "type": "pose_2d", "sample_only": True, "camera_id": cid,
                   "device_id": cal.device_id, "stream_id": reg["stream_id"], "frame_id": frame_id,
                   "calibration_id": reg["expected"]["calibration_id"] if reg["expected"] else None,
                   "image": {"width": cal.width, "height": cal.height, "rotation_deg": 0, "mirrored": False,
                             "coordinate_space": "raw_distorted_pixels"},
                   "timing": {"capture_time_ms": t_true + offset, "clock_id": clock_id,
                              "timestamp_source": "capture_metadata"},
                   "joints": wrists}
            outbox.put_nowait((time.monotonic() + random.uniform(0.010, 0.060), msg))  # latency + jitter
            frame_id += 1
            await asyncio.sleep(max(0.0, 1 / fps - (now_ms() - t_true) / 1000))
        rtask.cancel()
        utask.cancel()


async def consumer(url, key, seconds, stop, report):
    errs = {"left_wrist": [], "right_wrist": []}
    invalid = {"left_wrist": {}, "right_wrist": {}}
    latency, skew, n, sample_flags = [], [], 0, set()
    async with websockets.connect(with_key(f"{url}/ws/pose3d", key), ssl=ssl_ctx(url)) as ws:
        end = time.time() + seconds + 2.5
        while time.time() < end:
            try:
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=1.0))
            except asyncio.TimeoutError:
                continue
            if m.get("type") != "pose_3d" or m["aligned_capture_at_server_ms"] is None:
                continue
            n += 1
            sample_flags.add(m["sample_only"])
            truth = wrists_at(m["aligned_capture_at_server_ms"])
            latency.append(m["server_sent_at_ms"] - m["aligned_capture_at_server_ms"])
            if m["skew_ms"] is not None:
                skew.append(m["skew_ms"])
            for name, j in m["joints"].items():
                if j["valid"]:
                    errs[name].append(np.linalg.norm(np.array(j["position_m"]) - truth[name]))
                else:
                    invalid[name][j["reason"]] = invalid[name].get(j["reason"], 0) + 1
    stop.set()
    report.update(n=n, errs=errs, invalid=invalid, latency=latency, skew=skew, sample_flags=sample_flags)


def print_report(r, mode_hint):
    def cm(a):
        a = np.asarray(a) * 100
        return f"mean {a.mean():.2f} cm, p95 {np.percentile(a, 95):.2f} cm" if len(a) else "-"
    print("\n=== SYNTHETIC end-to-end check (sample_only, not a live measurement) ===")
    print(f"pose_3d frames with aligned time: {r['n']}   sample_only flags seen: {sorted(r['sample_flags'])}")
    for name in ("left_wrist", "right_wrist"):
        print(f"{name}: {cm(r['errs'][name])}; invalid by reason: {r['invalid'][name]}")
    if r["latency"]:
        print(f"capture -> pose_3d sent (server clock): mean {np.mean(r['latency']):.1f} ms, "
              f"p95 {np.percentile(r['latency'], 95):.1f} ms")
        print(f"skew_ms: mean {np.mean(r['skew']):.1f}, max {np.max(r['skew']):.1f}  ({mode_hint})")
    if r.get("errors"):
        print(f"server errors: {r['errors'][:5]}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://127.0.0.1:8000")
    ap.add_argument("--key", default="")
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--mode-hint", default="align_mode as configured on the server")
    ap.add_argument("--insecure", action="store_true", help="accept a self-signed certificate")
    args = ap.parse_args()
    global INSECURE
    INSECURE = args.insecure
    rig = synthetic_rig()
    stop, report = asyncio.Event(), {}
    await asyncio.gather(consumer(args.url, args.key, args.seconds, stop, report),
                         *[fake_phone(args.url, args.key, cid, cal, args.seconds, args.fps, stop, report)
                           for cid, cal in rig.items()])
    print_report(report, args.mode_hint)


if __name__ == "__main__":
    asyncio.run(main())
