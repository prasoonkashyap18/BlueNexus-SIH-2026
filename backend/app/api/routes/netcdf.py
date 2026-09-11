"""Step 39 -- the additive ``/api/netcdf`` namespace.

Thin handlers that delegate to :class:`app.services.netcdf_service.NetCDFDataService`.
They expose one configured NetCDF file (``BLUENEXUS_NETCDF_PATH``) read-only:

* ``GET /api/netcdf/dataset``                       -- identity + structure + metadata
* ``GET /api/netcdf/variables/{variable_name}``     -- one variable's metadata
* ``GET /api/netcdf/variables/{variable_name}/slice`` -- an indexed selection + values

Nothing here touches the BlueNexus ``.bnx`` datasets, the model grid or the
observation endpoints. Errors use the shared ``{"error": {...}}`` envelope; no
tracebacks or filesystem paths are ever returned.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Path, Query, Request

from ...services.netcdf_service import NetCDFDataService
from ..errors import NetCDFNotConfiguredError
from ..schemas import (
    ErrorResponse,
    NetCDFDatasetResponse,
    NetCDFSliceResponse,
    NetCDFVariableResponse,
)

router = APIRouter(prefix="/api/netcdf", tags=["netcdf"])


def _service(request: Request) -> NetCDFDataService:
    """The per-app NetCDF service (set on ``app.state`` at startup)."""
    service = getattr(request.app.state, "netcdf_service", None)
    if service is None:
        raise NetCDFNotConfiguredError(
            "no NetCDF dataset is configured for this API",
            {"hint": "set BLUENEXUS_NETCDF_PATH to a NetCDF file and restart"},
        )
    return service

_VARIABLE_NAME = Path(
    ...,
    pattern=r"^[A-Za-z][A-Za-z0-9_]{0,127}$",
    description="A data-variable name from GET /api/netcdf/dataset (e.g. `T_ANALYZED`).",
    examples=["T_ANALYZED"],
)

_NETCDF_UNAVAILABLE = {
    503: {
        "model": ErrorResponse,
        "description": "no NetCDF file configured (`netcdf_not_configured`) or it could not be opened (`netcdf_unavailable`)",
    }
}
_UNKNOWN_VARIABLE = {
    404: {"model": ErrorResponse, "description": "`variable_name` is not a data variable of the dataset"}
}
_BAD_SELECTION = {
    422: {
        "model": ErrorResponse,
        "description": "an index is out of range / for a missing axis (`invalid_index`), the selection is too large (`slice_too_large`), or a query parameter is malformed (`malformed_request`)",
    }
}

_INDEX_QUERY_KW = dict(default=None, ge=0)


@router.get(
    "/dataset",
    response_model=NetCDFDatasetResponse,
    operation_id="get_netcdf_dataset",
    responses={**_NETCDF_UNAVAILABLE},
    summary="NetCDF dataset identity, dimensions, coordinates, variables and global metadata",
    description=(
        "The configured NetCDF file's structure: `dataset_id`, `dimensions` "
        "(name -> length), every coordinate axis (with values, units, attributes "
        "and a best-effort role), the list of data variables, and the global "
        "attributes. Coordinate and variable metadata are preserved verbatim; "
        "non-finite floats serialize as `null` (see `nan_encoding`)."
    ),
)
def get_netcdf_dataset(request: Request) -> dict:
    return _service(request).dataset_info()


@router.get(
    "/variables/{variable_name}",
    response_model=NetCDFVariableResponse,
    operation_id="get_netcdf_variable",
    responses={**_UNKNOWN_VARIABLE, **_NETCDF_UNAVAILABLE},
    summary="One NetCDF variable's metadata (dimensions, shape, dtype, units, attributes)",
    description=(
        "Metadata only -- no bulk values. `dimensions`, `shape`, `dtype`, "
        "`units` and the full `attributes` map straight from the file, plus "
        "`axis_roles` mapping each dimension to a resolved "
        "time/depth/latitude/longitude role where one can be determined."
    ),
)
def get_netcdf_variable(request: Request, variable_name: str = _VARIABLE_NAME) -> dict:
    return _service(request).variable_info(variable_name)


@router.get(
    "/variables/{variable_name}/slice",
    response_model=NetCDFSliceResponse,
    operation_id="get_netcdf_variable_slice",
    responses={**_UNKNOWN_VARIABLE, **_BAD_SELECTION, **_NETCDF_UNAVAILABLE},
    summary="An indexed selection of a NetCDF variable, with values",
    description=(
        "Positionally selects along whichever of the time / depth / latitude / "
        "longitude axes the variable has, using 0-based `time_index`, "
        "`depth_index`, `latitude_index`, `longitude_index`. An omitted index "
        "leaves that axis at full extent. Indices are never clamped: an "
        "out-of-range index, or an index for an axis the variable does not have, "
        "is a `422`. The response carries the applied `selection` (with the "
        "coordinate value at each index), the remaining `dimensions` / `shape`, "
        "the remaining coordinate axes, and `values`.\n\n"
        "Scientific values are verbatim -- no scaling, interpolation, regridding, "
        "normalization, unit conversion or rounding. Non-finite floats "
        "(NaN / Infinity) serialize as JSON `null`; the underlying data is "
        "unchanged. Selections larger than the element cap return "
        "`422 slice_too_large`."
    ),
)
def get_netcdf_variable_slice(
    request: Request,
    variable_name: str = _VARIABLE_NAME,
    time_index: Optional[int] = Query(
        description="0-based index into the variable's time axis.", **_INDEX_QUERY_KW
    ),
    depth_index: Optional[int] = Query(
        description="0-based index into the variable's depth axis.", **_INDEX_QUERY_KW
    ),
    latitude_index: Optional[int] = Query(
        description="0-based index into the variable's latitude axis.", **_INDEX_QUERY_KW
    ),
    longitude_index: Optional[int] = Query(
        description="0-based index into the variable's longitude axis.", **_INDEX_QUERY_KW
    ),
) -> dict:
    return _service(request).slice(
        variable_name,
        time_index=time_index,
        depth_index=depth_index,
        latitude_index=latitude_index,
        longitude_index=longitude_index,
    )
