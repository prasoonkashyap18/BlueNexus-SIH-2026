"""Step 44 -- comparison-ready extraction of the REAL Argo *observed* temperature
profile.

    ArgoProfile  ->  extract_observed_temperature_profile()  ->  {observation, profile, metadata}

Pure, no I/O, no model. This is the observation-side counterpart of Step 43's
model extraction (``app.services.model_observation_service``). Step 45 will pair
the two; **Step 44 involves no model temperature and computes no difference.**

Guarantees (mirrors the frontend ``measuredProfilePoints`` helper, Step 32):

* Temperature values are the **real Argo measurements**, verbatim -- no average,
  smooth, interpolation, gap-fill, outlier clip, unit change or resampling.
* The native vertical coordinate is **pressure in decibar**, named
  ``pressure_dbar`` -- never silently converted to depth, never treated as
  metres.
* A ``(pressure_dbar, temperature)`` pair is emitted **only when both are finite**
  (a real missing / non-finite value on either drops that pair; it is still
  counted in ``metadata``).
* Points are returned in **ascending pressure order**. The INCOIS ERDDAP rows
  are already ascending-pressure; the sort here is defensive and is a *pure
  reordering* of the kept points -- no value is changed.
* **No QC filtering.** Every finite temperature is kept regardless of its QC
  flag; the raw ``pressure_qc`` / ``temperature_qc`` codes are carried on each
  point and the QC-code definitions are echoed in ``metadata`` for later
  scientific decisions.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Optional

from .argo import (
    ARGO_DATASET_ID,
    QUALITY_DEFINITION,
    STANDARD_NAMES,
    UNITS,
    ArgoLevel,
    ArgoProfile,
)

#: Explicit name of the observed profile's vertical coordinate. Native Argo
#: pressure in decibar -- NOT depth, NOT metres.
VERTICAL_COORDINATE = "pressure_dbar"
VERTICAL_COORDINATE_UNITS = UNITS["pressure"]  # "decibar"

TRANSPARENCY_NOTES = [
    "Temperature here is a real in-situ Argo measurement (an observation), not a model value.",
    "Source: the existing INCOIS ERDDAP Indian_ARGO_Floats snapshot -- unchanged, not re-downloaded.",
    "Temperature values are preserved verbatim from the source: no averaging, no clipping, no gap-fill.",
    "No interpolation is performed. No smoothing is performed. No decimation is performed.",
    "Native vertical coordinate: pressure in decibar (pressure_dbar). Not converted to depth; dbar is not metres.",
    "Points are ordered by ascending pressure for profile presentation -- a pure reordering, values unchanged.",
    "A (pressure_dbar, temperature) pair is emitted only when BOTH are finite; missing values are counted in metadata.",
    "No QC filtering: every finite temperature is kept regardless of flag; raw pressure_qc / temperature_qc codes are carried per point.",
    "No model temperature is involved in Step 44, and no model-minus-observation difference is computed (that is Step 45).",
]


def _is_finite(value: Optional[float]) -> bool:
    return value is not None and isinstance(value, (int, float)) and math.isfinite(value)


def observed_temperature_points(levels: Iterable[ArgoLevel]) -> list[dict]:
    """The real ``(pressure_dbar, temperature)`` measurements to compare, sorted
    by ascending pressure.

    A level is emitted only when its pressure **and** temperature are both
    finite. Raw QC codes are carried through. Nothing is interpolated, smoothed,
    decimated or unit-converted.
    """
    points: list[dict] = []
    for lv in levels:
        if not _is_finite(lv.pressure) or not _is_finite(lv.temperature):
            continue
        points.append(
            {
                "pressure_dbar": lv.pressure,
                "temperature": lv.temperature,
                "pressure_qc": lv.pressure_qc,
                "temperature_qc": lv.temperature_qc,
            }
        )
    points.sort(key=lambda p: p["pressure_dbar"])
    return points


def _range(values: list[float]) -> Optional[dict]:
    return {"min": min(values), "max": max(values)} if values else None


def extract_observed_temperature_profile(
    profile: ArgoProfile, provenance: Optional[dict] = None
) -> dict:
    """Assemble the comparison-ready observed-temperature payload for one real
    Argo profile. Pure -- no model, no difference, no I/O."""
    levels = profile.levels
    points = observed_temperature_points(levels)

    finite_temp = sum(1 for lv in levels if _is_finite(lv.temperature))
    null_temp = sum(1 for lv in levels if not _is_finite(lv.temperature))
    finite_pres = sum(1 for lv in levels if _is_finite(lv.pressure))

    temps = [p["temperature"] for p in points]
    press = [p["pressure_dbar"] for p in points]

    # QC codes actually present on the kept temperature points (for visibility).
    qc_present = sorted({p["temperature_qc"] for p in points if p["temperature_qc"]})

    payload: dict[str, Any] = {
        "observation": {
            "source": "INCOIS Argo float profile (in-situ CTD)",
            "dataset_id": ARGO_DATASET_ID,
            "platform_id": profile.platform_id,
            "platform_number": profile.platform_number,
            "cycle_number": profile.cycle_number,
            "platform_type": profile.platform_type,
            "direction": profile.direction,
            "latitude": profile.latitude,
            "longitude": profile.longitude,
            "timestamp": profile.time,
        },
        "profile": points,
        "metadata": {
            "variable": STANDARD_NAMES["temperature"],  # sea_water_temperature
            "units": UNITS["temperature"],              # degree_Celsius
            "vertical_coordinate": VERTICAL_COORDINATE,  # pressure_dbar
            "vertical_coordinate_units": VERTICAL_COORDINATE_UNITS,  # decibar
            "vertical_coordinate_standard_name": STANDARD_NAMES["pressure"],
            "source_level_count": profile.level_count,
            "point_count": len(points),
            "finite_temperature_count": finite_temp,
            "null_temperature_count": null_temp,
            "finite_pressure_count": finite_pres,
            "pressure_dbar_range": _range(press),
            "temperature_range": _range(temps),
            "ordering": "ascending pressure_dbar (pure reordering; source values unchanged)",
            "pairing_rule": "a point is kept only when pressure_dbar AND temperature are both finite",
            "qc": {
                "filtering_applied": False,
                "flags_retained": True,
                "representation": "raw Argo QC codes as strings, per point (pressure_qc / temperature_qc)",
                "temperature_qc_codes_present": qc_present,
                "definition": dict(QUALITY_DEFINITION),
                "note": (
                    "Step 44 keeps every finite temperature regardless of QC flag "
                    "and preserves the raw codes for later scientific decisions "
                    "(Step 45+). No threshold is applied here."
                ),
            },
            "transforms_applied": "none (no interpolation, smoothing, decimation, gap-fill or unit conversion)",
        },
        "notes": list(TRANSPARENCY_NOTES),
        "missing_value": None,
    }
    if provenance is not None:
        payload["provenance"] = provenance
    return payload
