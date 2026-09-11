"""Step 43 -- model-at-observation extraction (GLORYS12V1 thetao @ a real Argo).

    Argo platform_id  ->  real Argo profile (Step 28 catalog)
                      ->  nearest native GLORYS (lat, lon, daily time) cell
                      ->  native-level thetao column (Step 42 NetCDF service)
                      ->  explicit matching metadata + the model profile

This is **extraction only**. It does NOT compute model - observation
differences, reformat the observed profile, or render anything -- those are
Steps 44-47.

Design
------
* **Reuses** ``ArgoObservationCatalog`` (Step 28) for the real Argo profile and
  its 404 / 422 errors, and ``NetCDFDataService`` (Steps 39/42) for every touch
  of the NetCDF file -- this module never opens the NetCDF, parses Argo, or
  re-implements nearest-neighbour selection.
* **No interpolation of any kind.** Spatial + temporal matching are
  nearest-native (``xarray .sel(method="nearest")`` snaps to grid points); the
  vertical axis is returned at its full native GLORYS extent. The response
  states the exact spatial / temporal mismatch.
* Kept separate from ``NetCDFDataService`` (which stays a generic one-file
  NetCDF reader) -- this service knows about Argo and about "a model profile at
  an observation".
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from ..api.config import (
    MODEL_COPERNICUS_DATASET_ID,
    MODEL_DOI,
    MODEL_PRODUCT_ID,
    MODEL_TEMPERATURE_VARIABLE,
)
from ..api.errors import ObservationOutsideModelCoverageError
from ..services.netcdf_service import NetCDFDataService
from ..services.observations import ArgoObservationCatalog

_EARTH_RADIUS_KM = 6371.0088

#: The scientific-transparency notes attached to every extraction response.
TRANSPARENCY_NOTES = [
    "Observation source: real INCOIS Argo float profile (in-situ CTD).",
    "Model source: MERCATOR GLORYS12V1 reanalysis, distributed by Copernicus Marine.",
    "GLORYS 'thetao' is sea_water_potential_temperature (potential temperature), in degrees_C.",
    "GLORYS values are DAILY MEANS -- not instantaneous, and not an observation.",
    "Spatial matching: nearest native GLORYS 1/12 grid cell. No spatial interpolation / regridding.",
    "Temporal matching: nearest available GLORYS daily timestep. No temporal interpolation.",
    "Vertical values: native GLORYS depth levels, unchanged. No vertical interpolation onto Argo pressure levels.",
    "Missing model values (land / below-seafloor) are preserved as null.",
    "Step 43 does NOT compute model-minus-observation differences (that is a later step).",
]


def _to_datetime(iso: str) -> datetime:
    v = iso.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


class ModelObservationExtractionService:
    """Connects one real Argo profile to its nearest-native GLORYS thetao column."""

    def __init__(
        self,
        netcdf_service: NetCDFDataService,
        argo_catalog: ArgoObservationCatalog,
        *,
        variable: str = MODEL_TEMPERATURE_VARIABLE,
    ) -> None:
        self._netcdf = netcdf_service
        self._argo = argo_catalog
        self._variable = variable

    # ------------------------------------------------------------------
    def extract_argo_temperature(self, platform_id: str) -> dict:
        # 1-2. real Argo profile (reuses Step 28 catalog: 422 malformed, 404 unknown)
        argo = self._argo.get_platform(platform_id)

        obs_lat = argo.get("latitude")
        obs_lon = argo.get("longitude")
        obs_time = argo.get("time")
        if obs_lat is None or obs_lon is None or obs_time is None:
            raise ObservationOutsideModelCoverageError(
                "the Argo profile has no usable position / time fix to match against the model",
                {
                    "platform_id": platform_id,
                    "latitude": obs_lat,
                    "longitude": obs_lon,
                    "time": obs_time,
                },
            )

        # 3-4. validate the observation is inside the model's space AND time.
        # (`coverage()` calls the NetCDF service's readiness check -> a clean
        #  503 netcdf_not_configured / netcdf_unavailable if the file is gone.)
        coverage = self._netcdf.coverage()
        self._require_within_coverage(platform_id, obs_lat, obs_lon, obs_time, coverage)

        # 5-7. nearest native (lat, lon, daily time) + the native-level column.
        # NetCDFDataService owns all NetCDF/xarray access and the decoding.
        picked = self._netcdf.nearest_profile(
            self._variable,
            latitude=float(obs_lat),
            longitude=float(obs_lon),
            time=obs_time,
        )

        m_lat = picked["matched"]["latitude"]
        m_lon = picked["matched"]["longitude"]
        m_time_iso = picked["matched"]["time"]

        lat_diff = m_lat - float(obs_lat)
        lon_diff = m_lon - float(obs_lon)
        temporal_diff_s: Optional[float] = None
        if m_time_iso is not None:
            temporal_diff_s = abs(
                (_to_datetime(m_time_iso) - _to_datetime(obs_time)).total_seconds()
            )

        depths = picked["depth"] or []
        values = picked["values"] if isinstance(picked["values"], list) else [picked["values"]]
        profile = [
            {"depth": d, "temperature": t} for d, t in zip(depths, values)
        ]
        null_levels = sum(1 for row in profile if row["temperature"] is None)

        warnings: list[str] = []
        if profile and null_levels == len(profile):
            warnings.append(
                "the nearest native model cell is entirely masked (land / below "
                "seafloor) -- every model temperature is null"
            )

        # 8. explicit matching metadata + profile values.
        return {
            "observation": {
                "source": "INCOIS Argo float profile",
                "dataset_id": argo.get("dataset_id"),
                "platform_id": argo.get("platform_id"),
                "platform_number": argo.get("platform_number"),
                "cycle_number": argo.get("cycle_number"),
                "latitude": obs_lat,
                "longitude": obs_lon,
                "timestamp": obs_time,
                "level_count": argo.get("level_count"),
                "pressure_min": argo.get("pressure_min"),
                "pressure_max": argo.get("pressure_max"),
            },
            "model": {
                "dataset_id": self._netcdf.dataset_id,
                "source": self._netcdf.source_label or "GLORYS12V1 / Copernicus Marine",
                "product_id": MODEL_PRODUCT_ID,
                "copernicus_dataset_id": MODEL_COPERNICUS_DATASET_ID,
                "doi": MODEL_DOI,
                "file_name": self._netcdf.file_name,
                "variable": picked["variable"],
                "standard_name": picked["standard_name"],
                "units": picked["units"],
                "latitude": m_lat,
                "longitude": m_lon,
                "timestamp": m_time_iso,
                "spatial_match": {
                    "method": "nearest native GLORYS 1/12 grid cell (no interpolation)",
                    "requested": {"latitude": float(obs_lat), "longitude": float(obs_lon)},
                    "matched": {"latitude": m_lat, "longitude": m_lon},
                    "latitude_difference_deg": lat_diff,
                    "longitude_difference_deg": lon_diff,
                    "distance_km": _haversine_km(float(obs_lat), float(obs_lon), m_lat, m_lon),
                },
                "temporal_match": {
                    "method": "nearest available GLORYS daily-mean timestep (no interpolation)",
                    "requested": obs_time,
                    "matched": m_time_iso,
                    "difference_seconds": temporal_diff_s,
                    "note": "GLORYS thetao is a DAILY MEAN, not an instantaneous value",
                },
                "decoding": picked["decoding"],
                "level_count": picked["level_count"],
                "finite_level_count": picked["finite_level_count"],
                "null_level_count": null_levels,
                "depth_units": picked["depth_units"],
                "depth_positive": picked["depth_positive"],
            },
            "profile": profile,
            "coverage": coverage,
            "warnings": warnings,
            "notes": list(TRANSPARENCY_NOTES),
            "nan_encoding": picked["nan_encoding"],
        }

    # ------------------------------------------------------------------
    def _require_within_coverage(
        self,
        platform_id: str,
        lat: float,
        lon: float,
        iso_time: str,
        coverage: dict,
    ) -> None:
        cov_lat = coverage.get("latitude") or {}
        cov_lon = coverage.get("longitude") or {}
        cov_time = coverage.get("time") or {}

        problems: list[str] = []
        if cov_lat and not (cov_lat["min"] <= lat <= cov_lat["max"]):
            problems.append("latitude")
        if cov_lon and not (cov_lon["min"] <= lon <= cov_lon["max"]):
            problems.append("longitude")

        if cov_time.get("start") and cov_time.get("end"):
            start = _to_datetime(cov_time["start"])
            end = _to_datetime(cov_time["end"])
            obs = _to_datetime(iso_time)
            # each daily-mean label covers [label, label + 1 day)
            if not (start <= obs < end + timedelta(days=1)):
                problems.append("time")

        if problems:
            raise ObservationOutsideModelCoverageError(
                "the Argo observation is outside the configured GLORYS model "
                f"coverage ({', '.join(problems)})",
                {
                    "platform_id": platform_id,
                    "observation": {"latitude": lat, "longitude": lon, "time": iso_time},
                    "model_coverage": {
                        "latitude": [cov_lat.get("min"), cov_lat.get("max")],
                        "longitude": [cov_lon.get("min"), cov_lon.get("max")],
                        "time": [cov_time.get("start"), cov_time.get("end")],
                        "time_note": "GLORYS daily means; each label covers that calendar day",
                    },
                    "outside": problems,
                },
            )
