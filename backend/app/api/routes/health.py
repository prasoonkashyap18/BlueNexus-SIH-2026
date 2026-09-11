"""``GET /api/health`` -- preserved from the original backend, lightly extended.

The response still contains ``{"status": "ok"}`` (the frontend's existing
``useHealthCheck`` only reads ``.status``); the ``data_layer`` block confirms the
BlueNexus ``.bnx`` files are discoverable and the expected datasets are loaded.
It does **not** validate the scientific content -- that is D15 -- and it does
**not** depend on the frontend.
"""

from __future__ import annotations

from fastapi import APIRouter

from ...services import get_catalog
from ..schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/api/health",
    response_model=HealthResponse,
    operation_id="get_health",
    summary="Liveness + BlueNexus dataset availability",
    description=(
        "`status` is `\"ok\"` whenever the API process is serving requests "
        "(liveness only). Data readiness is `data_layer.all_expected_present` -- "
        "true when every expected BlueNexus dataset's `.bnx` container is loaded. "
        "This endpoint never scans scientific values and never calls the "
        "frontend."
    ),
)
def health() -> dict:
    try:
        data_layer = get_catalog().health()
    except Exception:
        # Catalog singleton not initialised -- the one case we cannot describe
        # in full. Still machine-readable, still no traceback.
        data_layer = {"available": False}
    return {
        "status": "ok",
        "service": "bluenexus-data-api",
        "data_layer": data_layer,
    }
