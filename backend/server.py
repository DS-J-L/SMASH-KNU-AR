"""Development scaffold. No camera ingestion or AR tracking is implemented yet."""

import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
app = FastAPI(title="SMASH-KNU-AR", version="0.1.0")


def system_status() -> dict:
    """Keep readiness false until real inputs and checks are implemented."""
    return {
        "schema_version": "0.1",
        "type": "system_status",
        "stage": "scaffold",
        "game_ready": False,
        "cameras": [
            {"camera_id": camera_id, "status": "not_implemented"}
            for camera_id in ("C0", "C1", "C2")
        ],
        "readiness": {
            "camera_input": False,
            "calibration": False,
            "tracking": False,
            "scene": False,
        },
        "message": "초기 구조입니다. 카메라 입력·보정·3D 추적은 아직 연결하지 않았습니다.",
    }


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": "SMASH-KNU-AR", "stage": "scaffold"}


@app.get("/")
async def home() -> RedirectResponse:
    return RedirectResponse("/monitor/")


@app.websocket("/ws/status")
async def status_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(system_status())
    try:
        while True:
            message = await websocket.receive_text()
            try:
                request = json.loads(message)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "code": "invalid_json"})
                continue
            if isinstance(request, dict) and request.get("type") == "get_status":
                await websocket.send_json(system_status())
            else:
                await websocket.send_json({"type": "error", "code": "unsupported_message"})
    except WebSocketDisconnect:
        return


# Serve only browser assets; local configs, calibration and experiment data stay outside.
app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web")
