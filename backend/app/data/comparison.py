"""Step 45 -- pure vertical-matching + difference core for the model-vs-observation
temperature comparison.

No I/O, no HTTP, no dataset loading. Given a GLORYS native depth column and an
Argo observed profile it produces a per-GLORYS-level comparison:

    model temperature (GLORYS native depth, unchanged)
      vs nearest Argo observation (matched by DERIVED DEPTH, not index)
      -> difference_c = model_temperature_c - observed_temperature_c

Scientific choices (all explicit, deterministic, documented):

* **Pressure -> depth**: TEOS-10 via the GSW toolbox --
  ``comparison_depth_m = -gsw.z_from_p(pressure_dbar, argo_latitude)``.
  ``gsw.z_from_p`` returns height (negative below the surface); depth is its
  negation. The original Argo ``pressure_dbar`` is never modified -- the derived
  depth is a *separate* field.
* **Comparison grid**: the GLORYS native depth levels, unchanged.
* **Matching**: for each GLORYS level, the single nearest Argo observation by
  ``abs(argo_comparison_depth_m - glorys_depth_m)``. **No interpolation** of
  either dataset. **No index pairing.**
* **Adaptive tolerance**: a GLORYS level is only matched when the nearest Argo
  observation is within ``max_separation_m[i] = local_spacing_m[i] / 2`` where

      local_spacing_m[i] = (d[i+1] - d[i-1]) / 2     for an interior level
                         = d[1]   - d[0]              for the first level
                         = d[-1]  - d[-2]             for the last level

  (so an interior level's tolerance is ``(d[i+1] - d[i-1]) / 4``). This is
  strict where the GLORYS grid is fine (sub-metre near the surface) and looser
  where it is coarse (tens of metres near the bottom of the subset).
* **Difference**: ``difference_c = model_temperature_c - observed_temperature_c``
  -- positive => model warmer than the observation. Signed is primary; the
  absolute value is only a secondary statistic.
* **Depth coverage**: Argo observations deeper than the deepest GLORYS level are
  reported (as a count) but never compared -- the current GLORYS subset ends at
  ~541.089 m.
* **Missing values**: a ``null`` on either side yields ``difference_c = null``
  (never a fabricated difference).
* **QC**: the raw Argo QC codes travel on every matched point. No QC filtering.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

import gsw
import numpy as np

#: The GSW function used for pressure -> depth (documented in the API response).
GSW_VERSION = gsw.__version__
GSW_DEPTH_FUNCTION = "gsw.z_from_p"

DIFFERENCE_DEFINITION = (
    "difference_c = model_temperature_c - observed_temperature_c "
    "(positive => model warmer than observation)"
)

VERTICAL_METHOD = (
    "nearest Argo observation to each native GLORYS depth level, matched by "
    "derived depth; no interpolation of either dataset; no index pairing"
)

OBSERVATION_DEPTH_METHOD = (
    "TEOS-10 (GSW toolbox): comparison_depth_m = -gsw.z_from_p(pressure_dbar, "
    "argo_latitude). The original Argo pressure_dbar is preserved unchanged; the "
    "derived depth is a separate field."
)

ADAPTIVE_TOLERANCE_RULE = (
    "max_separation_m[i] = local_spacing_m[i] / 2, where "
    "local_spacing_m[i] = (d[i+1] - d[i-1]) / 2 for an interior GLORYS level, "
    "or the single adjacent gap (d[1]-d[0] / d[-1]-d[-2]) for the first / last "
    "level. d = the native GLORYS depth levels (ascending, unchanged)."
)


def comparison_depth_m(pressure_dbar: float, latitude: float) -> float:
    """Derived seawater depth (metres, positive down) from Argo pressure via
    TEOS-10 ``gsw.z_from_p`` (height, negative) negated. Pure; does not touch the
    input pressure."""
    return float(-gsw.z_from_p(float(pressure_dbar), float(latitude)))


def comparison_depths_m(
    pressures_dbar: Sequence[float], latitude: float
) -> list[Optional[float]]:
    """Vectorised :func:`comparison_depth_m`; ``None`` for a non-finite pressure."""
    out: list[Optional[float]] = []
    for p in pressures_dbar:
        if p is None or not math.isfinite(p):
            out.append(None)
        else:
            out.append(float(-gsw.z_from_p(float(p), float(latitude))))
    return out


def adaptive_max_separation_m(glorys_depths_m: Sequence[float]) -> list[float]:
    """``max_separation_m[i] = local_spacing_m[i] / 2`` for each GLORYS level.

    ``glorys_depths_m`` must be ascending with >= 2 levels.
    """
    d = [float(x) for x in glorys_depths_m]
    n = len(d)
    if n < 2:
        raise ValueError("need at least two GLORYS depth levels for a local spacing")
    if any(d[i + 1] <= d[i] for i in range(n - 1)):
        raise ValueError("GLORYS depth levels must be strictly ascending")

    out: list[float] = []
    for i in range(n):
        if i == 0:
            local = d[1] - d[0]
        elif i == n - 1:
            local = d[-1] - d[-2]
        else:
            local = (d[i + 1] - d[i - 1]) / 2.0
        out.append(local / 2.0)
    return out


def _finite(x) -> bool:
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def match_comparison_profile(
    glorys_depths_m: Sequence[float],
    glorys_temps_c: Sequence[Optional[float]],
    argo_pressures_dbar: Sequence[float],
    argo_temps_c: Sequence[Optional[float]],
    argo_temp_qc: Sequence[Optional[str]],
    argo_pressure_qc: Sequence[Optional[str]],
    argo_latitude: float,
) -> dict:
    """Build the per-GLORYS-level comparison profile.

    Returns ``{"profile": [...32 rows...], "argo_comparison_depths_m": [...],
    "argo_below_model_depth_count": int, "max_separation_m": [...]}``.

    One row per GLORYS native depth level, each:
      model_depth_m, model_temperature_c,
      argo_pressure_dbar, argo_depth_m, observed_temperature_c,
      observed_temperature_qc, observed_pressure_qc,
      vertical_separation_m, max_vertical_separation_m,
      difference_c, matched, reason
    """
    d = [float(x) for x in glorys_depths_m]
    max_sep = adaptive_max_separation_m(d)

    a_depth = comparison_depths_m(argo_pressures_dbar, argo_latitude)
    a_depth_arr = np.array(
        [np.inf if z is None else z for z in a_depth], dtype="float64"
    )
    deepest_glorys = d[-1]
    argo_below = sum(1 for z in a_depth if z is not None and z > deepest_glorys)

    rows: list[dict] = []
    for i, gd in enumerate(d):
        mt = glorys_temps_c[i] if i < len(glorys_temps_c) else None
        row = {
            "model_depth_m": gd,
            "model_temperature_c": mt if _finite(mt) else None,
            "argo_pressure_dbar": None,
            "argo_depth_m": None,
            "observed_temperature_c": None,
            "observed_temperature_qc": None,
            "observed_pressure_qc": None,
            "vertical_separation_m": None,
            "max_vertical_separation_m": max_sep[i],
            "difference_c": None,
            "matched": False,
            "reason": None,
        }

        if a_depth_arr.size == 0 or not np.isfinite(a_depth_arr).any():
            row["reason"] = "no Argo observation with a finite pressure"
            rows.append(row)
            continue

        k = int(np.argmin(np.abs(a_depth_arr - gd)))
        sep = float(abs(a_depth_arr[k] - gd))
        row["argo_pressure_dbar"] = argo_pressures_dbar[k]
        row["argo_depth_m"] = a_depth[k]
        row["observed_temperature_c"] = (
            argo_temps_c[k] if _finite(argo_temps_c[k]) else None
        )
        row["observed_temperature_qc"] = (
            argo_temp_qc[k] if k < len(argo_temp_qc) else None
        )
        row["observed_pressure_qc"] = (
            argo_pressure_qc[k] if k < len(argo_pressure_qc) else None
        )
        row["vertical_separation_m"] = sep

        if sep > max_sep[i]:
            row["reason"] = "no Argo observation within the adaptive vertical tolerance"
        elif not _finite(mt):
            row["reason"] = "model temperature missing (land / below seafloor)"
        elif not _finite(argo_temps_c[k]):
            row["reason"] = "observed temperature missing"
        else:
            row["matched"] = True
            row["difference_c"] = float(mt) - float(argo_temps_c[k])
        rows.append(row)

    return {
        "profile": rows,
        "argo_comparison_depths_m": a_depth,
        "argo_below_model_depth_count": argo_below,
        "max_separation_m": max_sep,
        "model_depth_range_m": {"min": d[0], "max": d[-1]},
    }


#: Minimum number of valid matched points for a summary statistic to be reported.
MIN_POINTS_FOR_STATISTICS = 1


def comparison_statistics(differences_c: Sequence[float]) -> dict:
    """Summary stats over the **valid matched** signed differences only.

    ``differences_c`` must already exclude every null / unmatched / out-of-range
    level. Returns ``null`` values with an explanation when there are too few
    points.
    """
    vals = [float(x) for x in differences_c if _finite(x)]
    n = len(vals)
    base = {
        "population": (
            "valid matched comparison points only: model and observed temperature "
            "both finite, nearest Argo observation within the adaptive vertical "
            "tolerance, and within GLORYS depth coverage"
        ),
        "matched_count": n,
    }
    if n < MIN_POINTS_FOR_STATISTICS:
        return {
            **base,
            "mean_difference_c": None,
            "mean_absolute_difference_c": None,
            "minimum_difference_c": None,
            "maximum_difference_c": None,
            "rmse_c": None,
            "note": "no valid matched comparison points -- no statistics computed",
        }
    arr = np.array(vals, dtype="float64")
    stats = {
        **base,
        "mean_difference_c": float(arr.mean()),
        "mean_absolute_difference_c": float(np.abs(arr).mean()),
        "minimum_difference_c": float(arr.min()),
        "maximum_difference_c": float(arr.max()),
        "rmse_c": float(np.sqrt(np.mean(arr**2))),
    }
    if n < 3:
        stats["note"] = (
            f"only {n} valid matched point(s) -- statistics are reported but not "
            "robust"
        )
    return stats
