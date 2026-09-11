"""``GET /api/datasets/{dataset_id}/parameters/{parameter_id}/slice``.

The core D10 endpoint: one latitude x longitude plane of one parameter at a
chosen ``time_index`` / ``depth_index``. Backed by the D9 ``BnxReader`` partial
read -- it touches only ``ny * nx * 9`` payload bytes, not the whole container.
"""

from __future__ import annotations

from fastapi import APIRouter, Path, Query

from ...services import get_catalog
from ..schemas import ErrorResponse, SliceResponse

router = APIRouter(prefix="/api/datasets", tags=["slice"])


@router.get(
    "/{dataset_id}/parameters/{parameter_id}/slice",
    response_model=SliceResponse,
    operation_id="get_parameter_slice",
    responses={
        404: {"model": ErrorResponse, "description": "unknown dataset / parameter, or parameter not in dataset"},
        422: {"model": ErrorResponse, "description": "time_index / depth_index out of range or malformed"},
        503: {"model": ErrorResponse, "description": "backing .bnx unavailable"},
    },
    summary="One latitude x longitude slice of a parameter",
    description=(
        "A single latitude x longitude plane of one parameter at the chosen "
        "`time_index` / `depth_index`. Backed by a bounded partial read of the "
        "`.bnx` container (only `ny * nx * 9` payload bytes -- see `bytes_read` "
        "in the response), never the whole file and never the raw NetCDF.\n\n"
        "Missing cells in `values` are JSON `null` (never 0 / -1 / -9999 / "
        "-1e34); `quality[i][j] == 1` marks them, `0` = VALID. `latitude` / "
        "`longitude` are returned once, not per cell. Units are canonical "
        "(`degC` / `PSU` / `m s-1`). Indices are 0-based and are never clamped: "
        "an out-of-range index is a 422, not a nearest-valid plane."
    ),
)
def get_slice(
    dataset_id: str = Path(..., pattern=r"^[a-z0-9][a-z0-9_]{0,63}$"),
    parameter_id: str = Path(
        ...,
        pattern=r"^[a-z0-9][a-z0-9_]{0,63}$",
        description="Canonical id only: temperature | salinity | current_u | current_v | current_speed. "
        "Aliases (temp, sst, salt, current, velocity) are rejected.",
        examples=["temperature"],
    ),
    time_index: int = Query(
        0, ge=0, description="0-based index into the dataset's time axis; >= axis size -> 422 invalid_index."
    ),
    depth_index: int = Query(
        0, ge=0, description="0-based index into the dataset's depth axis; >= axis size -> 422 invalid_index."
    ),
) -> dict:
    return get_catalog().slice(
        dataset_id, parameter_id, time_index=time_index, depth_index=depth_index
    )
