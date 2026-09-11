"""Canonical *cleaned* representation produced by D8.

Design rules (mirrors the D8 objective):

* **Values are preserved where valid.** A cleaned variable's ``values`` buffer
  holds every valid scientific value exactly as D7 read it, only *widened* to
  float64 (an exact, lossless representation change for the float32 source
  fields). Nothing is regridded, resampled, smoothed, interpolated or clipped.
* **Missing is canonical and explicit.** Every missing cell -- whether the
  source encoded it as IEEE NaN, as ``_FillValue`` or as ``missing_value`` --
  becomes a single canonical marker: IEEE NaN, mirrored by a ``quality`` byte
  of :data:`QualityFlag.MISSING`. Missing cells are never set to zero and never
  filled.
* **The raw buffer is untouched.** ``CleanedVariable.source_values`` is a
  *reference* to the D7 ``array`` (never copied-then-mutated, never written
  back), so the original values -- fill markers included -- stay recoverable.
* **Coordinates are copied verbatim.** No synthetic grid is generated.
* **Provenance travels with the data.**

Everything here is a frozen dataclass; no third-party dependency.
"""

from __future__ import annotations

import array
import math
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Iterator, Mapping, Optional

CANONICAL_MISSING = float("nan")  # the single missing marker in cleaned buffers


class QualityFlag(IntEnum):
    """D8 quality is about *data availability*, not oceanographic grading."""

    VALID = 0
    MISSING = 1


@dataclass(frozen=True)
class CanonicalUnitInfo:
    """Raw source unit (provenance) vs. the D8 canonical unit."""

    raw_units: Optional[str]        # exactly as stored in the raw NetCDF (or None)
    canonical_units: str           # D8 target: "degC" | "PSU" | "m s-1"
    units_source: str              # why canonical_units is what it is (from D6/D7)
    converted: bool = False        # True only if a numeric unit conversion happened

    def __str__(self) -> str:
        return self.canonical_units


@dataclass(frozen=True)
class RangeDiagnostic:
    """How the cleaned valid values compare to the D6 reference range.

    Purely informational. ``values_outside_reference`` counts cells; **no cell
    was modified, clipped or discarded.**
    """

    variable: str
    canonical_units: str
    valid_min: Optional[float]
    valid_max: Optional[float]
    reference_min: float
    reference_max: float
    reference_source: str
    values_below_reference: int
    values_above_reference: int
    tolerance: float

    @property
    def values_outside_reference(self) -> int:
        return self.values_below_reference + self.values_above_reference

    @property
    def within_reference(self) -> bool:
        return self.values_outside_reference == 0

    def describe(self) -> str:
        rng = (
            "all-missing"
            if self.valid_min is None
            else f"[{self.valid_min:.6g}, {self.valid_max:.6g}]"
        )
        return (
            f"{self.variable}: cleaned valid range {rng} {self.canonical_units}; "
            f"D6 reference [{self.reference_min:g}, {self.reference_max:g}]; "
            f"outside reference (tol {self.tolerance:g}): "
            f"{self.values_below_reference} below / {self.values_above_reference} above "
            f"-- diagnostic only, no values changed"
        )


@dataclass(frozen=True)
class VectorConsistencyDiagnostic:
    """Re-confirms the D6 finding CURRENT == sqrt(U**2 + V**2) without touching
    the source CURRENT field."""

    jointly_valid_cells: int
    max_abs_difference: float
    max_rel_difference: float
    mean_abs_difference: float
    cells_within_1e_6: int
    source_current_is_authoritative: bool = True
    recomputed_field_created: bool = False

    def describe(self) -> str:
        return (
            f"CURRENT vs sqrt(U^2+V^2): {self.jointly_valid_cells} jointly-valid cells, "
            f"max|diff|={self.max_abs_difference:.3e}, mean|diff|={self.mean_abs_difference:.3e}, "
            f"{self.cells_within_1e_6}/{self.jointly_valid_cells} within 1e-6; "
            f"source CURRENT kept authoritative, no recomputed field created"
        )


@dataclass(frozen=True)
class MissingValuePolicy:
    """What D8 recognised as missing for one variable, and the outcome."""

    recognised_nan: bool
    recognised_fill_value: Optional[float]
    recognised_missing_value: Optional[float]
    source_nan_cells: int
    source_sentinel_cells: int
    canonical_missing_cells: int
    canonical_marker: str = "NaN"
    replacement_with_zero: bool = False
    interpolation: bool = False
    fill_forward_or_backward: bool = False

    def describe(self) -> str:
        parts = ["NaN"]
        if self.recognised_fill_value is not None:
            parts.append(f"_FillValue={self.recognised_fill_value:g}")
        if (
            self.recognised_missing_value is not None
            and self.recognised_missing_value != self.recognised_fill_value
        ):
            parts.append(f"missing_value={self.recognised_missing_value:g}")
        return (
            f"recognised missing: {', '.join(parts)}; "
            f"source cells nan={self.source_nan_cells} sentinel={self.source_sentinel_cells} "
            f"-> {self.canonical_missing_cells} canonical NaN; "
            f"zero-fill={self.replacement_with_zero} interpolation={self.interpolation} "
            f"ffill/bfill={self.fill_forward_or_backward}"
        )


@dataclass(frozen=True)
class CleanedCoordinate:
    """A coordinate axis copied verbatim from D7 -- values are an exact copy."""

    name: str
    axis_role: str
    dtype: str
    units: Optional[str]           # raw source units string, unchanged
    standard_name: Optional[str]
    long_name: Optional[str]
    axis: Optional[str]
    calendar: Optional[str]
    shape: tuple[int, ...]
    values: array.array = field(repr=False)          # exact copy of the D7 buffer
    attributes: Mapping[str, object] = field(repr=False, default_factory=dict)

    @property
    def count(self) -> int:
        return len(self.values)

    def as_list(self) -> list[float]:
        return list(self.values)


@dataclass(frozen=True)
class CleanedVariable:
    """One cleaned scientific field."""

    name: str
    dimensions: tuple[str, ...]        # unchanged from D7
    shape: tuple[int, ...]             # unchanged from D7
    source_dtype: str                  # e.g. "float32"
    canonical_dtype: str               # "float64"
    units: CanonicalUnitInfo
    standard_name: Optional[str]
    long_name: Optional[str]
    missing_policy: MissingValuePolicy
    valid_count: int
    missing_count: int
    values: array.array = field(repr=False)          # float64, missing == NaN
    quality: array.array = field(repr=False)         # 'B': 0 VALID / 1 MISSING
    source_values: array.array = field(repr=False)   # REFERENCE to the untouched D7 buffer
    attributes: Mapping[str, object] = field(repr=False, default_factory=dict)
    range_diagnostic: Optional[RangeDiagnostic] = None

    # -- helpers (all derived, read-only) -----------------------------
    @property
    def size(self) -> int:
        return len(self.values)

    def is_valid(self, flat_index: int) -> bool:
        return self.quality[flat_index] == QualityFlag.VALID

    def iter_valid(self) -> Iterator[float]:
        for q, v in zip(self.quality, self.values):
            if q == QualityFlag.VALID:
                yield v

    def valid_min_max(self) -> tuple[Optional[float], Optional[float]]:
        lo = hi = None
        for v in self.iter_valid():
            if lo is None or v < lo:
                lo = v
            if hi is None or v > hi:
                hi = v
        return lo, hi

    def missing_fraction(self) -> float:
        return self.missing_count / self.size if self.size else 0.0


@dataclass(frozen=True)
class ProvenanceRecord:
    """Enough metadata to trace a cleaned dataset back to its INCOIS origin."""

    dataset_name: str
    source_name: str
    source_url: str
    dataset_id: str
    product_title: str
    product_type: str                 # "analysis" | "forecast"
    temporal_semantics: str
    raw_file: str                     # repo-relative path
    raw_file_sha256: str
    raw_file_bytes: int
    raw_file_format: str
    conventions: Optional[str]
    variables_processed: tuple[str, ...]
    original_units: Mapping[str, Optional[str]]
    normalized_units: Mapping[str, str]
    dimensions: Mapping[str, int]
    coordinate_axes: Mapping[str, str]     # coord name -> role
    time_units: Optional[str]
    time_calendar: Optional[str]
    time_coverage: Optional[tuple[float, float]]
    depth_levels: tuple[float, ...]
    processed_at_utc: str
    d7_ingested: bool = True


@dataclass(frozen=True)
class CleanedDataset:
    """The object D9 will consume."""

    name: str
    product_type: str
    dimensions: tuple[tuple[str, int, bool, str], ...]   # (name, size, unlimited, role)
    coordinates: Mapping[str, CleanedCoordinate]
    variables: Mapping[str, CleanedVariable]
    provenance: ProvenanceRecord
    processing_log: tuple[str, ...]
    canonical_missing_marker: str = "NaN (IEEE 754)"
    vector_consistency: Optional[VectorConsistencyDiagnostic] = None
    time: Optional[CleanedCoordinate] = None
    depth: Optional[CleanedCoordinate] = None
    latitude: Optional[CleanedCoordinate] = None
    longitude: Optional[CleanedCoordinate] = None

    @property
    def dimension_sizes(self) -> dict[str, int]:
        return {name: size for name, size, _unlim, _role in self.dimensions}

    def manifest(self) -> dict:
        """JSON-serialisable summary (metadata + diagnostics only -- no bulk arrays)."""
        prov = self.provenance
        return {
            "dataset": self.name,
            "product_type": self.product_type,
            "canonical_missing_marker": self.canonical_missing_marker,
            "provenance": {
                "source_name": prov.source_name,
                "source_url": prov.source_url,
                "dataset_id": prov.dataset_id,
                "product_title": prov.product_title,
                "product_type": prov.product_type,
                "temporal_semantics": prov.temporal_semantics,
                "raw_file": prov.raw_file,
                "raw_file_sha256": prov.raw_file_sha256,
                "raw_file_bytes": prov.raw_file_bytes,
                "raw_file_format": prov.raw_file_format,
                "conventions": prov.conventions,
                "variables_processed": list(prov.variables_processed),
                "original_units": dict(prov.original_units),
                "normalized_units": dict(prov.normalized_units),
                "dimensions": dict(prov.dimensions),
                "coordinate_axes": dict(prov.coordinate_axes),
                "time_units": prov.time_units,
                "time_calendar": prov.time_calendar,
                "time_coverage": list(prov.time_coverage) if prov.time_coverage else None,
                "depth_levels": list(prov.depth_levels),
                "processed_at_utc": prov.processed_at_utc,
            },
            "dimensions": [
                {"name": n, "size": s, "unlimited": u, "role": r}
                for (n, s, u, r) in self.dimensions
            ],
            "coordinates": {
                c.name: {
                    "role": c.axis_role,
                    "dtype": c.dtype,
                    "units": c.units,
                    "count": c.count,
                    "first": c.values[0] if c.count else None,
                    "last": c.values[-1] if c.count else None,
                    "calendar": c.calendar,
                }
                for c in self.coordinates.values()
            },
            "variables": {
                v.name: {
                    "dimensions": list(v.dimensions),
                    "shape": list(v.shape),
                    "source_dtype": v.source_dtype,
                    "canonical_dtype": v.canonical_dtype,
                    "raw_units": v.units.raw_units,
                    "canonical_units": v.units.canonical_units,
                    "units_converted": v.units.converted,
                    "valid_count": v.valid_count,
                    "missing_count": v.missing_count,
                    "missing_fraction": round(v.missing_fraction(), 6),
                    "missing_policy": v.missing_policy.describe(),
                    "range_diagnostic": (
                        None
                        if v.range_diagnostic is None
                        else {
                            "valid_min": v.range_diagnostic.valid_min,
                            "valid_max": v.range_diagnostic.valid_max,
                            "reference_min": v.range_diagnostic.reference_min,
                            "reference_max": v.range_diagnostic.reference_max,
                            "reference_source": v.range_diagnostic.reference_source,
                            "values_below_reference": v.range_diagnostic.values_below_reference,
                            "values_above_reference": v.range_diagnostic.values_above_reference,
                            "within_reference": v.range_diagnostic.within_reference,
                        }
                    ),
                }
                for v in self.variables.values()
            },
            "vector_consistency": (
                None
                if self.vector_consistency is None
                else {
                    "jointly_valid_cells": self.vector_consistency.jointly_valid_cells,
                    "max_abs_difference": self.vector_consistency.max_abs_difference,
                    "max_rel_difference": self.vector_consistency.max_rel_difference,
                    "mean_abs_difference": self.vector_consistency.mean_abs_difference,
                    "cells_within_1e_6": self.vector_consistency.cells_within_1e_6,
                    "source_current_is_authoritative": (
                        self.vector_consistency.source_current_is_authoritative
                    ),
                    "recomputed_field_created": (
                        self.vector_consistency.recomputed_field_created
                    ),
                }
            ),
            "processing_log": list(self.processing_log),
        }

    def summary(self) -> str:
        lines = [
            f"{self.name}  ({self.product_type})  <- {self.provenance.raw_file}",
            f"  raw sha256 : {self.provenance.raw_file_sha256}",
            f"  canonical missing marker: {self.canonical_missing_marker}",
            "  dimensions : "
            + ", ".join(f"{n}={s}[{r}]" for (n, s, _u, r) in self.dimensions),
        ]
        for c in self.coordinates.values():
            lines.append(
                f"  coord {c.name} [{c.axis_role}]: n={c.count} "
                f"[{c.values[0]:g}..{c.values[-1]:g}] units={c.units} "
                f"calendar={c.calendar}"
            )
        for v in self.variables.values():
            lo, hi = v.valid_min_max()
            rng = "all-missing" if lo is None else f"{lo:.6g}..{hi:.6g}"
            lines.append(
                f"  var {v.name}: {v.dimensions} {v.shape} "
                f"{v.source_dtype}->{v.canonical_dtype} units={v.units.canonical_units} "
                f"valid={v.valid_count} missing={v.missing_count} "
                f"valid_range({rng})"
            )
        if self.vector_consistency is not None:
            lines.append("  " + self.vector_consistency.describe())
        lines.append("  processing log:")
        lines.extend(f"    - {s}" for s in self.processing_log)
        return "\n".join(lines)
