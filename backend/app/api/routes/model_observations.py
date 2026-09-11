"""Step 43 -- the additive ``/api/model-observations`` namespace.

Connects a real INCOIS Argo profile to the **nearest-native** GLORYS12V1
``thetao`` column. Extraction only -- no model-minus-observation difference, no
reformatting of the observed profile (Steps 44+).

* ``GET /api/model-observations/argo/{platform_id}/temperature``
    -- the model temperature profile at that Argo profile's location + time.

``platform_id`` is the project's composite Argo id ``<platform_number>_<cycle_number>``
(same as ``/api/observations/argo/{platform_id}``), e.g. ``3902669_4``.

Thin handler: it builds a per-request
:class:`~app.services.model_observation_service.ModelObservationExtractionService`
over the app's NetCDF service (Steps 39/42) and the Argo catalog (Step 28), and
delegates. Errors use the shared ``{"error": {...}}`` envelope; no tracebacks or
paths are ever returned.
"""

from __future__ import annotations

from fastapi import APIRouter, Path, Request

from ...services import (
    ModelObservationComparisonService,
    ModelObservationExtractionService,
    get_argo_catalog,
)
from ..errors import NetCDFNotConfiguredError
from ..schemas import (
    ErrorResponse,
    ModelAtArgoTemperatureResponse,
    ModelObsTemperatureComparisonResponse,
)

router = APIRouter(prefix="/api/model-observations", tags=["model-observations"])

_ARGO_PLATFORM_ID = Path(
    ...,
    pattern=r"^[0-9]{1,12}_[0-9]{1,6}$",
    description="Composite Argo id: <platform_number>_<cycle_number>.",
    examples=["3902669_4"],
)

_RESPONSES = {
    404: {
        "model": ErrorResponse,
        "description": "no such Argo profile in the snapshot (`unknown_argo_platform`)",
    },
    422: {
        "model": ErrorResponse,
        "description": (
            "`platform_id` is not `<number>_<cycle>` (`malformed_request`), or the "
            "observation falls outside the configured GLORYS model coverage "
            "(`observation_outside_model_coverage`)"
        ),
    },
    503: {
        "model": ErrorResponse,
        "description": (
            "no GLORYS model file configured (`netcdf_not_configured`) or it could "
            "not be opened (`netcdf_unavailable`); or the Argo snapshot is not "
            "loaded (`data_unavailable`)"
        ),
    },
}


def _extraction_service(request: Request) -> ModelObservationExtractionService:
    netcdf = getattr(request.app.state, "netcdf_service", None)
    if netcdf is None:
        raise NetCDFNotConfiguredError(
            "no NetCDF (GLORYS model) dataset is configured for this API",
            {"hint": "set BLUENEXUS_NETCDF_PATH to a NetCDF file and restart"},
        )
    return ModelObservationExtractionService(netcdf, get_argo_catalog())


def _comparison_service(request: Request) -> ModelObservationComparisonService:
    netcdf = getattr(request.app.state, "netcdf_service", None)
    if netcdf is None:
        raise NetCDFNotConfiguredError(
            "no NetCDF (GLORYS model) dataset is configured for this API",
            {"hint": "set BLUENEXUS_NETCDF_PATH to a NetCDF file and restart"},
        )
    return ModelObservationComparisonService(netcdf, get_argo_catalog())


@router.get(
    "/argo/{platform_id}/temperature",
    response_model=ModelAtArgoTemperatureResponse,
    operation_id="get_model_temperature_at_argo",
    responses=_RESPONSES,
    summary="GLORYS12V1 model temperature profile at a real Argo profile's location & time",
    description=(
        "Returns the GLORYS12V1 `thetao` (potential temperature, degrees_C) "
        "column at the **nearest native** grid cell to the given Argo profile, "
        "on the **nearest available daily-mean** timestep, across **all native "
        "GLORYS depth levels** (32 for the current Arabian Sea subset).\n\n"
        "Matching is nearest-neighbour only -- **no spatial, temporal or "
        "vertical interpolation**. The response states the requested vs matched "
        "coordinate and the exact spatial (degrees / km) and temporal (seconds) "
        "mismatch. GLORYS values are daily means, not observations. **Step 43 "
        "does not compute model-minus-observation differences.**"
    ),
)
def get_model_temperature_at_argo(
    request: Request, platform_id: str = _ARGO_PLATFORM_ID
) -> dict:
    return _extraction_service(request).extract_argo_temperature(platform_id)


@router.get(
    "/argo/{platform_id}/temperature-comparison",
    response_model=ModelObsTemperatureComparisonResponse,
    operation_id="get_model_observation_temperature_comparison",
    responses=_RESPONSES,
    summary="GLORYS12V1 model MINUS Argo observed temperature (vertically matched by derived depth)",
    description=(
        "The scientific comparison layer: GLORYS12V1 `thetao` **minus** the real "
        "INCOIS Argo observed temperature, one row per **native GLORYS depth "
        "level**.\n\n"
        "Argo pressure is converted to depth with **TEOS-10 (GSW "
        "`gsw.z_from_p`)** using the Argo latitude; the original `pressure_dbar` "
        "is preserved and `argo_depth_m` is a separate field. Each GLORYS level "
        "is matched to the **nearest Argo observation by derived depth**, "
        "accepted only within an **adaptive tolerance of half the local GLORYS "
        "level spacing** -- **no interpolation, no index pairing**. Argo "
        "observations deeper than the deepest GLORYS level (~541.089 m) are "
        "outside the comparison.\n\n"
        "`difference_c = model_temperature_c - observed_temperature_c` "
        "(**positive => model warmer**). The nearest GLORYS cell and daily "
        "timestamp are **Step 43's, unchanged**; GLORYS `thetao` is a daily mean "
        "-- this is reanalysis-vs-observation, not co-located instantaneous "
        "validation. Summary statistics are over valid matched points only."
    ),
)
def get_model_observation_temperature_comparison(
    request: Request, platform_id: str = _ARGO_PLATFORM_ID
) -> dict:
    return _comparison_service(request).compare_argo_temperature(platform_id)
