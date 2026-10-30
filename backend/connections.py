"""One outgoing queue per WebSocket so only one task ever calls send on a socket.

When a slow consumer fills its queue, new messages are dropped (counted in `dropped`):
pose and status messages are superseded by the next ones, so stale backlog is worse than loss.
"""

from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import WebSocket


class Peer:
    def __init__(self, ws: WebSocket, name: str, queue_size: int = 64):
        self.ws = ws
        self.name = name
        self.dropped = 0
        self._queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=queue_size)
        self._task: asyncio.Task | None = None

    def start(self) -> "Peer":
        self._task = asyncio.create_task(self._run(), name=f"send:{self.name}")
        return self

    def send(self, message: dict) -> None:
        try:
            self._queue.put_nowait(json.dumps(message, separators=(",", ":"), ensure_ascii=False))
        except asyncio.QueueFull:
            self.dropped += 1

    async def close(self, code: int = 1000, reason: str = "") -> None:
        """Flush queued messages, then close the socket."""
        with contextlib.suppress(asyncio.QueueFull):
            self._queue.put_nowait(None)
        if self._task:
            with contextlib.suppress(asyncio.TimeoutError, asyncio.CancelledError, Exception):
                await asyncio.wait_for(asyncio.shield(self._task), timeout=1.0)
        with contextlib.suppress(Exception):
            await self.ws.close(code=code, reason=reason)
        await self.stop()

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task

    async def _run(self) -> None:
        with contextlib.suppress(Exception):
            while True:
                text = await self._queue.get()
                if text is None:
                    return
                await self.ws.send_text(text)
