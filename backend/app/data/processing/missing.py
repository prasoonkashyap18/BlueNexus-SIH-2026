"""Canonical missing-value normalisation for D8.

Policy (see ``docs/data-processing.md`` §"Missing-value policy"):

* A cell is *missing* if it is IEEE NaN, **or** equals the declared
  ``_FillValue``, **or** equals the declared ``missing_value``.
* Every missing cell becomes one canonical marker in the cleaned buffer:
  **IEEE NaN**, with a matching :data:`QualityFlag.MISSING` byte.
* Valid cells are copied through unchanged (widened float32 -> float64 is exact).
* **Never** zero-fill, interpolate, forward-fill or back-fill.
* The source buffer is only *read* here -- never written.
"""

from __future__ import annotations

import array
import math

from ..ingestion.models import DataVariable
from .models import CANONICAL_MISSING, MissingValuePolicy, QualityFlag


def is_missing(value: float, fill_value: float | None, missing_value: float | None) -> bool:
    """True if *value* is NaN or matches a declared missing marker."""
    if isinstance(value, float) and math.isnan(value):
        return True
    if fill_value is not None and value == fill_value:
        return True
    if missing_value is not None and value == missing_value:
        return True
    return False


def canonicalise(var: DataVariable) -> tuple[array.array, array.array, MissingValuePolicy]:
    """Return ``(values_f64, quality, policy)`` for one D7 variable.

    * ``values_f64`` -- ``array('d')``: valid values (widened, exact) with every
      missing cell set to canonical NaN.
    * ``quality``    -- ``array('B')``: 0 = VALID, 1 = MISSING.
    * ``policy``     -- what was recognised and what happened (audit record).
    """
    fill_value = var.fill_value
    missing_value = var.missing_value_attr

    n = len(var.values)
    values = array.array("d", bytes(8 * n))
    quality = array.array("B", bytes(n))

    src_nan = 0
    src_sentinel = 0
    canonical_missing = 0

    for i, raw in enumerate(var.values):
        raw_is_nan = isinstance(raw, float) and math.isnan(raw)
        raw_is_sentinel = (
            (fill_value is not None and not raw_is_nan and raw == fill_value)
            or (missing_value is not None and not raw_is_nan and raw == missing_value)
        )
        if raw_is_nan:
            src_nan += 1
        if raw_is_sentinel:
            src_sentinel += 1

        if raw_is_nan or raw_is_sentinel:
            values[i] = CANONICAL_MISSING
            quality[i] = QualityFlag.MISSING
            canonical_missing += 1
        else:
            values[i] = float(raw)          # exact widening for float32 sources
            quality[i] = QualityFlag.VALID

    policy = MissingValuePolicy(
        recognised_nan=True,
        recognised_fill_value=fill_value,
        recognised_missing_value=missing_value,
        source_nan_cells=src_nan,
        source_sentinel_cells=src_sentinel,
        canonical_missing_cells=canonical_missing,
        canonical_marker="NaN",
        replacement_with_zero=False,
        interpolation=False,
        fill_forward_or_backward=False,
    )
    return values, quality, policy
