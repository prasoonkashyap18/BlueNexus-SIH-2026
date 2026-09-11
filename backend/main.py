"""Backend entry point.

Run with ``uvicorn main:app --port 8000`` from ``backend/`` (the frontend's
``useHealthCheck`` expects the API on ``http://localhost:8000``).

The FastAPI application is assembled in :mod:`app.api.app`. This module stays a
thin re-export so the historical ``main:app`` target keeps working. The
preserved ``GET /api/health`` endpoint and the CORS configuration now live in
that package (D10); their existing behaviour is unchanged for the frontend.
"""

from app.api.app import app

__all__ = ["app"]
