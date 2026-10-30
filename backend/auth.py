"""Access key for the externally reachable server (team decision D07).

When SMASH_ACCESS_KEY is set, every HTTP request and WebSocket handshake needs either
`?key=<key>` or the cookie set after one successful `?key=` page load. The cookie holds a
SHA-256 digest, not the key, and is HttpOnly/SameSite=Strict (Secure on HTTPS). Because
browsers send it on same-origin WebSocket handshakes, pages need no code change.
"""

from __future__ import annotations

import hashlib
import hmac
from http.cookies import SimpleCookie
from urllib.parse import parse_qs

COOKIE = "smash_access"
MAX_AGE_S = 30 * 24 * 3600
DENIED_HTML = ("<!doctype html><meta charset='utf-8'><title>접속 키 필요</title>"
               "<p>접속 키가 필요합니다. 주소 끝에 <code>?key=접속키</code>를 붙여 다시 여세요.</p>").encode()


def digest(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class AccessKeyMiddleware:
    def __init__(self, app, access_key: str | None):
        self.app = app
        self.token = digest(access_key) if access_key else None

    async def __call__(self, scope, receive, send):
        if self.token is None or scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        query_key = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("key", [None])[0]
        by_query = query_key is not None and hmac.compare_digest(digest(query_key), self.token)
        by_cookie = hmac.compare_digest(self._cookie(scope) or "", self.token)

        if not (by_query or by_cookie):
            if scope["type"] == "websocket":
                await receive()  # websocket.connect
                await send({"type": "websocket.close", "code": 4401, "reason": "access key required"})
                return
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"text/html; charset=utf-8")]})
            await send({"type": "http.response.body", "body": DENIED_HTML})
            return

        if by_query and scope["type"] == "http":
            secure = "; Secure" if scope.get("scheme") == "https" else ""
            cookie = f"{COOKIE}={self.token}; Path=/; Max-Age={MAX_AGE_S}; HttpOnly; SameSite=Strict{secure}"

            async def send_with_cookie(message):
                if message["type"] == "http.response.start":
                    message = {**message, "headers": [*message.get("headers", []),
                                                      (b"set-cookie", cookie.encode("latin-1"))]}
                await send(message)

            return await self.app(scope, receive, send_with_cookie)
        return await self.app(scope, receive, send)

    @staticmethod
    def _cookie(scope) -> str | None:
        for name, value in scope.get("headers", []):
            if name == b"cookie":
                jar = SimpleCookie()
                try:
                    jar.load(value.decode("latin-1"))
                except Exception:
                    return None
                if COOKIE in jar:
                    return jar[COOKIE].value
        return None
