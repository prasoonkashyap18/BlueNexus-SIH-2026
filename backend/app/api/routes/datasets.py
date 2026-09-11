"""Gridded-dataset discovery / detail / parameters / coordinates routes.

All four are metadata-only -- they read the cached ``.bnx`` manifest, never the
bulk arrays. ``dataset_id`` is validated by pattern **and** resolved against the
in-memory catalog; it is never turned into a filesystem path.
"""

from __future__ import annotations

from fastapi import APIRouter, Path

from ...services import get_catalog
from ..schemas import (
    CoordinateList,
    DatasetDetail,
    DatasetList,
    ErrorResponse,
    ParameterList,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

_DATASET_ID = Path(
    ...,
    pattern=r"^[a-z0-9][a-z0-9_]{0,63}$",
    description="Canonical BlueNexus dataset id (from GET /api/datasets).",
    examples=["incois_argo_10day_analysis"],
)

_UNKNOWN_DATASET = {
    404: {"model": ErrorResponse, "description": "`dataset_id` is not a dataset this API serves"}
}
_CATALOG_UNAVAILABLE = {
    503: {"model": ErrorResponse, "description": "the BlueNexus catalog is not loaded"}
}


@router.get(
    "",
    response_model=DatasetList,
    operation_id="list_datasets",
    responses={**_CATALOG_UNAVAILABLE},
    summary="List available gridded datasets (metadata only)",
    description=(
        "Every BlueNexus dataset this API serves, with its product type "
        "(`analysis` / `forecast`), parameter ids, dimensions, coverage and "
        "provenance summary. No bulk arrays are included -- this answers from "
        "the cached `.bnx` manifests only."
    ),
)
def list_datasets() -> dict:
    summaries = get_catalog().list_summaries()
    return {"count": len(summaries), "datasets": summaries}


@router.get(
    "/{dataset_id}",
    response_model=DatasetDetail,
    operation_id="get_dataset",
    responses={**_UNKNOWN_DATASET, **_CATALOG_UNAVAILABLE},
    summary="Full metadata contract for one dataset",
    description=(
        "The complete D9 contract for one dataset: dimensions, coordinate axes, "
        "per-parameter metadata, dataset metadata, provenance and freshness. "
        "Small coordinate axes are included; 4-D data arrays are not."
    ),
)
def get_dataset(dataset_id: str = _DATASET_ID) -> dict:
    return get_catalog().dataset_detail(dataset_id)


@router.get(
    "/{dataset_id}/parameters",
    response_model=ParameterList,
    operation_id="get_dataset_parameters",
    responses={**_UNKNOWN_DATASET, **_CATALOG_UNAVAILABLE},
    summary="Canonical parameters in a dataset (aliases are not accepted)",
    description=(
        "The scientific variables the dataset carries, by canonical id "
        "(`temperature`, `salinity`, `current_u`, `current_v`, `current_speed`). "
        "Each entry includes units (`degC` / `PSU` / `m s-1`), shape, whether it "
        "is surface-only and whether it is the authoritative field. Display "
        "aliases (`temp`, `sst`, `salt`, ...) are cosmetic and are rejected as "
        "lookup keys."
    ),
)
def get_parameters(dataset_id: str = _DATASET_ID) -> dict:
    return get_catalog().parameters(dataset_id)


@router.get(
    "/{dataset_id}/coordinates",
    response_model=CoordinateList,
    operation_id="get_dataset_coordinates",
    responses={**_UNKNOWN_DATASET, **_CATALOG_UNAVAILABLE},
    summary="Exact coordinate arrays (time / depth / latitude / longitude)",
    description=(
        "The dataset's coordinate axes exactly as stored -- values, units, "
        "calendar, ordering and (for time) ISO-8601 strings. Coordinates are "
        "never regridded or resampled; the currents grid keeps its native "
        "0.0833 deg spacing."
    ),
)
def get_coordinates(dataset_id: str = _DATASET_ID) -> dict:
    return get_catalog().coordinates(dataset_id)
