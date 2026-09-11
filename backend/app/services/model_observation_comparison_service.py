"""Step 45 -- GLORYS12V1 model - Argo observation temperature difference.

    Argo platform_id
      -> Step 44: real observed temperature profile (native pressure_dbar)
      -> Step 43: nearest-native GLORYS thetao column (native depth, m) + the
                  exact spatial / temporal match
      -> Step 45 (here): TEOS-10 pressure->depth, adaptive nearest-depth
                  matching, and  difference_c = model - observed

The first step where model and observation are actually compared. It **reuses**
:class:`ModelObservationExtractionService` (Step 43) and
:class:`ArgoObservationCatalog` (Step 44) unchanged, and the pure
:mod:`app.data.comparison` core for the science. Kept separate from
``NetCDFDataService`` / the extraction services / the Argo reader.

No new spatial or temporal matching: the model cell, the model daily timestamp
and the reported spatial / temporal separations are Step 43's, verbatim.
"""

from __future__ import annotations

from typing import Any

from ..data.comparison import (
    ADAPTIVE_TOLERANCE_RULE,
    DIFFERENCE_DEFINITION,
    GSW_DEPTH_FUNCTION,
    GSW_VERSION,
    OBSERVATION_DEPTH_METHOD,
    VERTICAL_METHOD,
    comparison_statistics,
    match_comparison_profile,
)
from .model_observation_service import ModelObservationExtractionService
from .observations import ArgoObservationCatalog

TRANSPARENCY_NOTES = [
    "Observation: real INCOIS Argo float temperature (in-situ CTD), verbatim.",
    "Model: MERCATOR GLORYS12V1 reanalysis potential temperature (thetao), from Copernicus Marine.",
    "GLORYS thetao is a DAILY MEAN. This is a model/reanalysis-versus-observation comparison, "
    "NOT validation against a simultaneous, co-located, instantaneous model observation.",
    "Horizontal: the model value is from the SAME nearest native GLORYS 1/12 grid cell used by Step 43 "
    "(no new spatial interpolation). The spatial separation is reported.",
    "Temporal: the model value is the nearest GLORYS daily mean used by Step 43 (no new temporal "
    "interpolation). The temporal separation is reported.",
    "Vertical: Argo pressure_dbar is converted to depth with TEOS-10 (GSW gsw.z_from_p); the original "
    "pressure is preserved and comparison_depth_m is a separate field.",
    "Vertical matching: for each native GLORYS depth, the nearest Argo observation by derived depth, "
    "accepted only within an adaptive tolerance of half the local GLORYS level spacing. "
    "No interpolation of either dataset; no index pairing.",
    "Only GLORYS levels with an accepted Argo match are differenced. Argo observations deeper than the "
    "deepest GLORYS level (~541.089 m in this subset) are outside the comparison.",
    "difference_c = model_temperature_c - observed_temperature_c (positive => model warmer).",
    "Missing model or observed values yield difference_c = null -- never a fabricated difference.",
    "QC: raw Argo QC codes are carried on every matched point. No QC filtering is applied (Step 44 policy).",
    "Statistics are computed over valid matched comparison points only.",
]


class ModelObservationComparisonService:
    """model - observation temperature difference for one real Argo profile."""

    def __init__(
        self,
        netcdf_service,
        argo_catalog: ArgoObservationCatalog,
    ) -> None:
        self._extraction = ModelObservationExtractionService(netcdf_service, argo_catalog)
        self._argo = argo_catalog

    # ------------------------------------------------------------------
    def compare_argo_temperature(self, platform_id: str) -> dict:
        # Step 43 -- model side (also does id validation + the coverage / 503
        # errors, and gives us the exact spatial / temporal match).
        model = self._extraction.extract_argo_temperature(platform_id)

        # Step 44 -- observation side (comparison-ready observed profile).
        observed = self._argo.observed_temperature_profile(platform_id)

        argo_lat = model["observation"]["latitude"]
        argo_lon = model["observation"]["longitude"]

        glorys_depths = [row["depth"] for row in model["profile"]]
        glorys_temps = [row["temperature"] for row in model["profile"]]

        obs_points = observed["profile"]
        argo_pres = [p["pressure_dbar"] for p in obs_points]
        argo_temp = [p["temperature"] for p in obs_points]
        argo_tqc = [p["temperature_qc"] for p in obs_points]
        argo_pqc = [p["pressure_qc"] for p in obs_points]

        matched = match_comparison_profile(
            glorys_depths_m=glorys_depths,
            glorys_temps_c=glorys_temps,
            argo_pressures_dbar=argo_pres,
            argo_temps_c=argo_temp,
            argo_temp_qc=argo_tqc,
            argo_pressure_qc=argo_pqc,
            argo_latitude=float(argo_lat),
        )

        profile = matched["profile"]
        matched_rows = [r for r in profile if r["matched"]]
        stats = comparison_statistics([r["difference_c"] for r in matched_rows])

        a_depths = [z for z in matched["argo_comparison_depths_m"] if z is not None]
        argo_depth_range = (
            {"min": min(a_depths), "max": max(a_depths)} if a_depths else None
        )
        in_band = sum(
            1 for z in a_depths if z <= matched["model_depth_range_m"]["max"]
        )

        return {
            "comparison": {
                "platform_id": platform_id,
                "model_dataset_id": model["model"]["dataset_id"],
                "model_source": model["model"]["source"],
                "observation_source": observed["observation"]["source"],
                "model_variable": model["model"]["variable"],
                "observation_variable": observed["metadata"]["variable"],
                "model_units": model["model"]["units"],
                "observation_units": observed["metadata"]["units"],
                "difference_units": "degree_Celsius",
                "difference_units_note": (
                    "a temperature difference on the Celsius scale (numerically "
                    "identical to a kelvin difference); model and observation are "
                    "both Celsius"
                ),
                "difference_definition": DIFFERENCE_DEFINITION,
                "kind": (
                    "model/reanalysis-versus-observation comparison -- NOT "
                    "validation against a simultaneous co-located instantaneous "
                    "model observation"
                ),
            },
            "matching": {
                "vertical_method": VERTICAL_METHOD,
                "model_depth_coordinate": (
                    "native GLORYS12V1 depth levels (metres, positive down), unchanged"
                ),
                "observation_depth_method": OBSERVATION_DEPTH_METHOD,
                "gsw_version": GSW_VERSION,
                "gsw_function": GSW_DEPTH_FUNCTION,
                "adaptive_tolerance_rule": ADAPTIVE_TOLERANCE_RULE,
                "maximum_vertical_separation_m": matched["max_separation_m"],
                "model_level_count": len(profile),
                "matched_level_count": len(matched_rows),
                "unmatched_level_count": len(profile) - len(matched_rows),
                "model_depth_range_m": matched["model_depth_range_m"],
                "argo_comparison_depth_range_m": argo_depth_range,
                "argo_levels_in_comparison_depth_band": in_band,
                "argo_observations_below_model_depth": matched["argo_below_model_depth_count"],
                "temporal_matching": (
                    "reused from Step 43 -- nearest GLORYS daily mean, no new "
                    "temporal interpolation"
                ),
                "spatial_matching": (
                    "reused from Step 43 -- nearest native GLORYS cell, no new "
                    "spatial interpolation"
                ),
            },
            "model": {
                **{
                    k: model["model"][k]
                    for k in (
                        "dataset_id", "source", "product_id", "copernicus_dataset_id",
                        "doi", "file_name", "variable", "standard_name", "units",
                        "latitude", "longitude", "timestamp",
                        "spatial_match", "temporal_match", "decoding",
                        "level_count", "finite_level_count", "depth_units", "depth_positive",
                    )
                },
            },
            "observation": {
                **model["observation"],  # Step 43 observation block (verbatim Argo)
                "variable": observed["metadata"]["variable"],
                "units": observed["metadata"]["units"],
                "vertical_coordinate": observed["metadata"]["vertical_coordinate"],
                "vertical_coordinate_units": observed["metadata"]["vertical_coordinate_units"],
                "source_level_count": observed["metadata"]["source_level_count"],
                "point_count": observed["metadata"]["point_count"],
                "qc": observed["metadata"]["qc"],
            },
            "profile": profile,
            "statistics": stats,
            "provenance": {
                "model": {
                    "product_id": model["model"]["product_id"],
                    "copernicus_dataset_id": model["model"]["copernicus_dataset_id"],
                    "doi": model["model"]["doi"],
                    "file_name": model["model"]["file_name"],
                },
                "observation": observed.get("provenance"),
            },
            "notes": list(TRANSPARENCY_NOTES),
            "nan_encoding": (
                "scientific values verbatim; a null model or observed temperature, "
                "or an unmatched GLORYS level, yields difference_c = null"
            ),
        }
