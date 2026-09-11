"""Step 51 -- ``GET /api/sources``: the real data-source / provenance catalogue.

Metadata only. It reports, for every real scientific dataset the application
uses, the source identity / dataset id / variable / units / coverage and
whether it is analysis, forecast, reanalysis or observation. It reuses the
existing authoritative metadata (the ``.bnx`` catalogue, the observation
provenance constants, the model config + NetCDF service) -- it does not read
bulk arrays, touch a scientific value, or expose a filesystem path.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ...data.sources import build_source_catalog
from ...services import get_catalog
from ..schemas import ErrorResponse, SourceCatalogResponse

router = APIRouter(prefix="/api/sources", tags=["sources"])


@router.get(
    "",
    response_model=SourceCatalogResponse,
    operation_id="list_data_sources",
    responses={503: {"model": ErrorResponse, "description": "the BlueNexus catalog is not loaded"}},
    summary="Real data sources, provenance and coverage (metadata only)",
    description=(
        "Every real scientific dataset the application uses -- INCOIS temperature / "
        "salinity analysis, INCOIS IO-HOOFS surface currents, INCOIS "
        "Indian_ARGO_Floats, EGO / OceanGliders GDAC, and the GLORYS12V1 / "
        "Copernicus Marine model used for the temperature comparison -- with its "
        "dataset/product identity, variable, units, temporal semantics and "
        "coverage. GLORYS12V1 is clearly identified as Copernicus Marine data, "
        "never as INCOIS."
    ),
)
def list_data_sources(request: Request) -> dict:
    netcdf_service = getattr(request.app.state, "netcdf_service", None)
    return build_source_catalog(catalog=get_catalog(), netcdf_service=netcdf_service)
