"""D8 diagnostics -- they *report*, they never modify data.

* :func:`range_diagnostic` -- compares a cleaned variable's valid values against
  the D6 reference range. No clipping, no discarding.
* :func:`vector_consistency` -- re-confirms the D6 identity
  ``CURRENT == sqrt(U**2 + V**2)`` on jointly-valid cells, treating the source
  ``CURRENT`` field as authoritative and creating no replacement field.
"""

from __future__ import annotations

import math

from .models import (
    CleanedVariable,
    QualityFlag,
    RangeDiagnostic,
    VectorConsistencyDiagnostic,
)
from .ranges import ReferenceRange


def range_diagnostic(
    var: CleanedVariable, ref: ReferenceRange, *, rel_tolerance: float = 1e-3
) -> RangeDiagnostic:
    span = ref.maximum - ref.minimum
    tol = abs(span) * rel_tolerance if span else rel_tolerance
    lo_bound = ref.minimum - tol
    hi_bound = ref.maximum + tol

    below = above = 0
    vmin = vmax = None
    for v in var.iter_valid():
        if vmin is None or v < vmin:
            vmin = v
        if vmax is None or v > vmax:
            vmax = v
        if v < lo_bound:
            below += 1
        elif v > hi_bound:
            above += 1

    return RangeDiagnostic(
        variable=var.name,
        canonical_units=var.units.canonical_units,
        valid_min=vmin,
        valid_max=vmax,
        reference_min=ref.minimum,
        reference_max=ref.maximum,
        reference_source=ref.source,
        values_below_reference=below,
        values_above_reference=above,
        tolerance=tol,
    )


def vector_consistency(
    u: CleanedVariable, v: CleanedVariable, current: CleanedVariable
) -> VectorConsistencyDiagnostic:
    """max/mean |CURRENT - hypot(U, V)| over cells where all three are VALID."""
    uq, uv = u.quality, u.values
    vq, vv = v.quality, v.values
    cq, cv = current.quality, current.values

    n = len(cv)
    jointly_valid = 0
    max_abs = 0.0
    max_rel = 0.0
    sum_abs = 0.0
    within = 0

    VALID = QualityFlag.VALID
    for i in range(n):
        if uq[i] != VALID or vq[i] != VALID or cq[i] != VALID:
            continue
        jointly_valid += 1
        recomputed = math.hypot(uv[i], vv[i])
        diff = abs(cv[i] - recomputed)
        sum_abs += diff
        if diff > max_abs:
            max_abs = diff
        denom = abs(cv[i]) if abs(cv[i]) > 1e-12 else 1.0
        rel = diff / denom
        if rel > max_rel:
            max_rel = rel
        if diff <= 1e-6:
            within += 1

    mean_abs = sum_abs / jointly_valid if jointly_valid else 0.0
    return VectorConsistencyDiagnostic(
        jointly_valid_cells=jointly_valid,
        max_abs_difference=max_abs,
        max_rel_difference=max_rel,
        mean_abs_difference=mean_abs,
        cells_within_1e_6=within,
        source_current_is_authoritative=True,
        recomputed_field_created=False,
    )
