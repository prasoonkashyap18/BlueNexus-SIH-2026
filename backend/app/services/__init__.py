"""D10 service layer -- sits between the HTTP routes and the data.

Routes never touch files, indexing or serialisation directly. They call:

* :class:`app.services.catalog.BlueNexusCatalog` -- the gridded ``.bnx`` datasets,
* :class:`app.services.observations.ArgoObservationCatalog` -- the real Argo
  profiling-float observations (Step 28), a separate point/profile path.
"""

from .catalog import BlueNexusCatalog, get_catalog
from .model_observation_comparison_service import ModelObservationComparisonService
from .model_observation_service import ModelObservationExtractionService
from .netcdf_service import NetCDFDataService, build_netcdf_service
from .observations import (
    ArgoObservationCatalog,
    GliderObservationCatalog,
    get_argo_catalog,
    get_glider_catalog,
    init_argo_catalog,
    init_glider_catalog,
)

__all__ = [
    "BlueNexusCatalog",
    "get_catalog",
    "ArgoObservationCatalog",
    "get_argo_catalog",
    "init_argo_catalog",
    "GliderObservationCatalog",
    "get_glider_catalog",
    "init_glider_catalog",
    "NetCDFDataService",
    "build_netcdf_service",
    "ModelObservationExtractionService",
    "ModelObservationComparisonService",
]
