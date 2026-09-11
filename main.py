"""Vercel serverless entry point for the FastAPI backend.

Vercel's Python runtime auto-detects ``main.py`` at the project root as the
Vercel Function entrypoint and serves whatever ASGI app its top-level ``app``
name points to. This file is a thin re-export -- exactly like
``backend/main.py``, the pre-existing local entry point -- so the FastAPI
application built in ``backend/app/api/app.py`` (routes, CORS, error
handling, lifespan) is completely unchanged for this deployment target. No
scientific logic, data, or API behaviour is touched here.

``backend/`` is inserted onto ``sys.path`` explicitly because Vercel imports
this file from the project root, not from inside ``backend/`` the way local
development does (``uvicorn main:app`` run with ``backend/`` as the working
directory). Without this, ``from app.api.app import app`` below cannot find
the top-level ``app`` package.
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.api.app import app  # noqa: E402

__all__ = ["app"]
