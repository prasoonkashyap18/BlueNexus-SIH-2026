"""D10 API error types and handlers.

Clients get a small, stable JSON envelope::

    { "error": { "type": "unknown_dataset", "message": "...", "detail": {...} } }

Python tracebacks and internal paths are never included in a normal response.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Base class -- carries an HTTP status, a stable ``type`` slug and a message."""

    status_code = 500
    slug = "internal_error"

    def __init__(self, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


class UnknownDatasetError(ApiError):
    status_code = 404
    slug = "unknown_dataset"


class UnknownParameterError(ApiError):
    status_code = 404
    slug = "unknown_parameter"


class UnknownArgoPlatformError(ApiError):
    """No Argo float profile with this ``<platform_number>_<cycle_number>``."""

    status_code = 404
    slug = "unknown_argo_platform"


class UnknownGliderDeploymentError(ApiError):
    """No glider deployment with this id in the loaded snapshot."""

    status_code = 404
    slug = "unknown_glider_deployment"


class ParameterNotInDatasetError(ApiError):
    status_code = 404
    slug = "parameter_not_in_dataset"


class InvalidIndexError(ApiError):
    status_code = 422
    slug = "invalid_index"


class MalformedRequestError(ApiError):
    status_code = 422
    slug = "malformed_request"


class DataUnavailableError(ApiError):
    status_code = 503
    slug = "data_unavailable"


# -- Step 39: NetCDF-backed scientific API namespace (/api/netcdf) ------------
class NetCDFNotConfiguredError(ApiError):
    """No NetCDF file is configured (``BLUENEXUS_NETCDF_PATH`` unset)."""

    status_code = 503
    slug = "netcdf_not_configured"


class NetCDFUnavailableError(ApiError):
    """A NetCDF file is configured but could not be opened (missing / unreadable)."""

    status_code = 503
    slug = "netcdf_unavailable"


class UnknownVariableError(ApiError):
    """The requested variable name is not a data variable of the NetCDF dataset."""

    status_code = 404
    slug = "unknown_variable"


class SliceTooLargeError(ApiError):
    """The requested selection would return too many elements; add more indices."""

    status_code = 422
    slug = "slice_too_large"


# -- Step 43: model-at-observation extraction (/api/model-observations) -------
class ObservationOutsideModelCoverageError(ApiError):
    """The observation exists and the model exists, but the observation's
    position / time falls outside the configured model dataset's extent, so no
    model profile can be extracted for it. (Not a fallback to another dataset.)"""

    status_code = 422
    slug = "observation_outside_model_coverage"


def _envelope(slug: str, message: str, detail: dict | None = None) -> dict:
    return {"error": {"type": slug, "message": message, "detail": detail or {}}}


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(exc.slug, exc.message, exc.detail),
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Malformed query/path params (e.g. non-integer or negative index).
    fields = [
        {"location": list(e.get("loc", [])), "message": e.get("msg", "")}
        for e in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=_envelope(
            "malformed_request",
            "One or more request parameters are invalid.",
            {"fields": fields},
        ),
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(
            "http_error", str(exc.detail) if exc.detail else "HTTP error", {}
        ),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # Never leak the traceback / internal detail to the client.
    return JSONResponse(
        status_code=500,
        content=_envelope("internal_error", "An internal error occurred."),
    )


def install_error_handlers(app) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
