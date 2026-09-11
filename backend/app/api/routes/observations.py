"""Real in-situ observation routes: Argo profiling floats (Step 28) and
underwater gliders (Step 29).

Point / profile / trajectory data - served separately from the gridded
``/api/datasets`` surface, never merged with the model grid, and the two
observation families are independent of each other.

* ``GET /api/observations/argo``                   - list every Argo float profile
* ``GET /api/observations/argo/{platform_id}``      - one Argo profile + its levels
* ``GET /api/observations/gliders``                 - list every glider deployment
* ``GET /api/observations/gliders/{platform_id}``   - one deployment + its samples

Values are verbatim from the source snapshot: native units
(``decibar`` / ``degree_Celsius`` / ``PSU``), raw QC codes, ``null`` for a real
missing measurement (never a fill value), ISO-8601 timestamps unchanged.
"""

from __future__ import annotations

from fastapi import APIRouter, Path

from ...services import get_argo_catalog, get_glider_catalog
from ..schemas import (
    ArgoObservedTemperatureProfileResponse,
    ArgoPlatformDetail,
    ArgoPlatformList,
    ErrorResponse,
    GliderPlatformDetail,
    GliderPlatformList,
)

router = APIRouter(prefix="/api/observations", tags=["observations"])

_ARGO_PLATFORM_ID = Path(
    ...,
    pattern=r"^[0-9]{1,12}_[0-9]{1,6}$",
    description="Composite Argo id: <platform_number>_<cycle_number>.",
    examples=["2903951_10"],
)

_GLIDER_PLATFORM_ID = Path(
    ...,
    pattern=r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$",
    description="Glider deployment id (platform_deployment).",
    examples=["sea057_20220707"],
)

_SNAPSHOT_UNAVAILABLE = {
    503: {"model": ErrorResponse, "description": "the observation snapshot is not loaded"}
}


# -- Argo (Step 28) -------------------------------------------------------
@router.get(
    "/argo",
    response_model=ArgoPlatformList,
    operation_id="list_argo_platforms",
    responses={**_SNAPSHOT_UNAVAILABLE},
    summary="List real INCOIS Argo float profiles (summary metadata)",
    description=(
        "One entry per real Argo float profile (ascent cycle) in the INCOIS "
        "ERDDAP `Indian_ARGO_Floats` snapshot: id, WMO number, cycle, position, "
        "time, level count and pressure range. Summary only -- the measured "
        "levels are on the per-profile endpoint."
    ),
)
def list_argo_platforms() -> dict:
    return get_argo_catalog().list_platforms()


@router.get(
    "/argo/{platform_id}",
    response_model=ArgoPlatformDetail,
    operation_id="get_argo_platform",
    responses={
        404: {"model": ErrorResponse, "description": "no such Argo profile in the snapshot (`unknown_argo_platform`)"},
        422: {"model": ErrorResponse, "description": "`platform_id` is not `<number>_<cycle>` (`malformed_request`)"},
        **_SNAPSHOT_UNAVAILABLE,
    },
    summary="One real Argo float profile: metadata + every measured level",
    description=(
        "The full profile: summary metadata plus `levels[]`, each level a real "
        "measurement -- `pressure` (decibar), `temperature` (degree_Celsius), "
        "`salinity` (PSU) and their raw QC codes. A missing value is `null` "
        "(never a fill value); QC flags are carried through, not applied."
    ),
)
def get_argo_platform(platform_id: str = _ARGO_PLATFORM_ID) -> dict:
    return get_argo_catalog().get_platform(platform_id)


@router.get(
    "/argo/{platform_id}/temperature-profile",
    response_model=ArgoObservedTemperatureProfileResponse,
    operation_id="get_argo_observed_temperature_profile",
    responses={
        404: {"model": ErrorResponse, "description": "no such Argo profile in the snapshot (`unknown_argo_platform`)"},
        422: {"model": ErrorResponse, "description": "`platform_id` is not `<number>_<cycle>` (`malformed_request`)"},
        **_SNAPSHOT_UNAVAILABLE,
    },
    summary="Step 44: comparison-ready OBSERVED temperature profile for one real Argo profile",
    description=(
        "The real Argo temperature measurements prepared for the (later) "
        "model-vs-observation comparison: `(pressure_dbar, temperature)` pairs "
        "on the **native Argo pressure coordinate** (decibar -- never converted "
        "to depth), in **ascending pressure** order, keeping a pair only when "
        "**both** values are finite. Raw `pressure_qc` / `temperature_qc` codes "
        "are carried on each point; **no QC filtering, no interpolation, "
        "smoothing, decimation, gap-fill or unit conversion** is applied. "
        "`metadata` carries the level / point / finite / null counts and the QC "
        "definitions.\n\n"
        "This is a focused view of the same measurements already on "
        "`GET /api/observations/argo/{platform_id}` (which returns every level, "
        "unsorted, with salinity and QC). **No model temperature is involved "
        "and no model-minus-observation difference is computed (Step 45).**"
    ),
)
def get_argo_observed_temperature_profile(platform_id: str = _ARGO_PLATFORM_ID) -> dict:
    return get_argo_catalog().observed_temperature_profile(platform_id)


# -- Gliders (Step 29) --------------------------------------------------
@router.get(
    "/gliders",
    response_model=GliderPlatformList,
    operation_id="list_glider_platforms",
    responses={**_SNAPSHOT_UNAVAILABLE},
    summary="List real EGO / OceanGliders glider deployments (summary metadata)",
    description=(
        "One entry per real underwater-glider deployment in the EGO / "
        "OceanGliders GDAC snapshot: id, sample count, time span, and "
        "latitude / longitude / pressure ranges. Summary only -- the trajectory "
        "samples are on the per-deployment endpoint."
    ),
)
def list_glider_platforms() -> dict:
    return get_glider_catalog().list_platforms()


@router.get(
    "/gliders/{platform_id}",
    response_model=GliderPlatformDetail,
    operation_id="get_glider_platform",
    responses={
        404: {"model": ErrorResponse, "description": "no such deployment in the snapshot (`unknown_glider_deployment`)"},
        422: {"model": ErrorResponse, "description": "`platform_id` is not a valid deployment id (`malformed_request`)"},
        **_SNAPSHOT_UNAVAILABLE,
    },
    summary="One real glider deployment: metadata + every trajectory sample",
    description=(
        "The full deployment: summary metadata plus `samples[]` in trajectory "
        "order, each with `time`, position and `position_qc`, `pressure` "
        "(decibar), `temperature` (degree_Celsius), `salinity` (PSU) and raw QC "
        "codes. Missing values are `null`; QC is carried through, not applied."
    ),
)
def get_glider_platform(platform_id: str = _GLIDER_PLATFORM_ID) -> dict:
    return get_glider_catalog().get_platform(platform_id)
