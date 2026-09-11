"""D10 HTTP routes -- thin handlers that delegate to the service layer."""

from fastapi import APIRouter

from . import datasets, health, model_observations, netcdf, observations, slices, sources

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(datasets.router)
api_router.include_router(slices.router)
api_router.include_router(observations.router)
# Step 39: additive NetCDF -> xarray -> ScientificDataset -> JSON namespace.
api_router.include_router(netcdf.router)
# Step 43: additive model-at-observation extraction (GLORYS thetao @ a real Argo).
api_router.include_router(model_observations.router)
# Step 51: additive real data-source / provenance catalogue (metadata only).
api_router.include_router(sources.router)

__all__ = ["api_router"]
