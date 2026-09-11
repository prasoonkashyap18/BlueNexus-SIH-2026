"""BlueNexus Data Track **D10 -- backend/API data layer**.

HTTP access to the D9 BlueNexus datasets. ``app.api.app:app`` is the FastAPI
application; ``backend/main.py`` re-exports it so ``uvicorn main:app`` keeps
working.
"""

from .app import app, create_app
from .config import ApiConfig

__all__ = ["app", "create_app", "ApiConfig"]
