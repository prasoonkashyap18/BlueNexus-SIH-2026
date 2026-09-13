"""Tiny helper: run the real FastAPI app under uvicorn in a background thread,
so D10 tests make genuine HTTP requests (no ``httpx`` / TestClient dependency --
only the already-installed ``uvicorn`` plus stdlib ``urllib``).
"""

from __future__ import annotations

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from typing import Iterator


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LiveServer:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def request(self, method: str, path: str, *, expect_json: bool = True):
        url = self.base_url + path
        req = urllib.request.Request(url, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                status = resp.status
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            status = e.code
            e.close()
        payload = json.loads(body) if (expect_json and body) else body
        return status, payload

    def get(self, path: str):
        return self.request("GET", path)

    def raw_get(self, path: str) -> tuple[int, str]:
        return self.request("GET", path, expect_json=False)

    def get_with_headers(self, path: str, *, expect_json: bool = True, request_headers: dict[str, str] | None = None):
        """Step 57: like :meth:`get`, but also returns the response headers
        (case-insensitive ``email.message.Message`` mapping), so tests can
        assert on ``Cache-Control`` without disturbing every existing
        ``status, body = SRV.get(...)`` call site. Step 58: optionally send
        extra request headers (e.g. ``Origin``) to exercise CORS."""
        url = self.base_url + path
        req = urllib.request.Request(url, method="GET", headers=request_headers or {})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                status = resp.status
                headers = resp.headers
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            status = e.code
            headers = e.headers
            e.close()
        payload = json.loads(body) if (expect_json and body) else body
        return status, payload, headers


@contextmanager
def live_server(app, *, host: str = "127.0.0.1") -> Iterator[LiveServer]:
    import uvicorn

    port = _free_port()
    config = uvicorn.Config(app, host=host, port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None  # off the main thread

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base = f"http://{host}:{port}"
    deadline = time.time() + 30
    while time.time() < deadline:
        if getattr(server, "started", False):
            break
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    else:
        raise RuntimeError("uvicorn did not start in time")

    try:
        yield LiveServer(base)
    finally:
        server.should_exit = True
        thread.join(timeout=15)
