"""D6 reference value ranges, used by D8 **as diagnostic context only**.

These are the valid ranges D6 (`docs/data-validation.md` §8) already investigated
and judged scientifically plausible. D8 never clips, discards or modifies a value
because it sits near or at one of these bounds -- the range diagnostic only
*reports* how the cleaned data compares.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReferenceRange:
    variable: str
    minimum: float
    maximum: float
    units: str
    source: str


# Values transcribed from docs/data-validation.md §8 "Valid Range Summary".
REFERENCE_RANGES: dict[str, ReferenceRange] = {
    "T_ANALYZED": ReferenceRange(
        "T_ANALYZED", 2.540, 32.586, "degC", "D6 docs/data-validation.md §2/§8"
    ),
    "S_ANALYZED": ReferenceRange(
        "S_ANALYZED", 30.930, 37.353, "PSU", "D6 docs/data-validation.md §3/§8"
    ),
    "U": ReferenceRange(
        "U", -1.13419, 1.68921, "m s-1", "D6 docs/data-validation.md §4/§8"
    ),
    "V": ReferenceRange(
        "V", -1.33055, 2.47688, "m s-1", "D6 docs/data-validation.md §4/§8"
    ),
    "CURRENT": ReferenceRange(
        "CURRENT", 0.00038, 2.63063, "m s-1", "D6 docs/data-validation.md §4/§8"
    ),
}


def reference_for(variable: str) -> ReferenceRange | None:
    return REFERENCE_RANGES.get(variable)
