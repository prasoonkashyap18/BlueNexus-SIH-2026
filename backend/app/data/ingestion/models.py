"""Structured, read-only representation of an ingested INCOIS dataset.

Everything here is a plain dataclass -- no third-party dependency. The design
goals for D7:

* **Preserve the original dimensional structure.** Logical axis order
  (``time x depth x latitude x longitude``) is kept exactly as it appears in
  the source file.
* **Preserve raw scientific values.** ``DataVariable.values`` is the untouched
  flat buffer straight from the file, fill values included. Nothing in this
  module scales, masks, regrids or unit-converts anything -- that is D8/D9.
* **Expose -- not apply -- missing-value information.** ``fill_value`` is
  recorded and ``missing_mask()`` derives a fresh boolean mask on demand. The
  values buffer is never mutated, so the original fill information is always
  recoverable.
* **Record both raw and normalized units.** ``UnitInfo`` keeps the exact string
  from the file (or ``None`` when the file has no ``units`` attribute) next to
  the D6-authoritative interpretation and where that interpretation comes from.
"""

from __future__ import annotations

import array
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Mapping, Optional

AxisRole = str  # one of: "time", "depth", "latitude", "longitude", or "" (none)


@dataclass(frozen=True)
class UnitInfo:
    """Raw vs. normalized units for one variable."""

    raw_units: Optional[str]          # exactly as stored in the NetCDF file
    normalized_units: Optional[str]   # D6-authoritative interpretation (metadata only)
    units_source: str                 # provenance of ``normalized_units``

    def __str__(self) -> str:
        return self.normalized_units or self.raw_units or "(unknown)"


@dataclass(frozen=True)
class DimensionInfo:
    name: str
    size: int
    is_unlimited: bool
    axis_role: AxisRole = ""


@dataclass(frozen=True)
class CoordinateVariable:
    """A 1-D coordinate axis (time / depth / latitude / longitude)."""

    name: str
    dimensions: tuple[str, ...]
    dtype: str
    axis_role: AxisRole
    units: UnitInfo
    standard_name: Optional[str]
    long_name: Optional[str]
    axis: Optional[str]
    calendar: Optional[str]
    shape: tuple[int, ...]
    values: array.array = field(repr=False)   # raw, unchanged, native byte order
    attributes: Mapping[str, object] = field(repr=False, default_factory=dict)

    # -- convenience (structural, read-only) ------------------------------
    @property
    def count(self) -> int:
        return len(self.values)

    @property
    def minimum(self) -> float:
        return min(self.values)

    @property
    def maximum(self) -> float:
        return max(self.values)

    @property
    def is_monotonic_ascending(self) -> bool:
        v = self.values
        return all(v[i] < v[i + 1] for i in range(len(v) - 1))

    @property
    def is_monotonic_descending(self) -> bool:
        v = self.values
        return all(v[i] > v[i + 1] for i in range(len(v) - 1))

    def step_if_regular(self, *, rel_tol: float = 1e-6) -> Optional[float]:
        """Return the constant step if the axis is evenly spaced, else ``None``."""
        v = self.values
        if len(v) < 2:
            return None
        step = v[1] - v[0]
        if step == 0:
            return None
        for i in range(1, len(v) - 1):
            if not math.isclose(v[i + 1] - v[i], step, rel_tol=rel_tol, abs_tol=abs(step) * rel_tol):
                return None
        return step

    def as_list(self) -> list[float]:
        """A plain-``list`` copy (does not touch the stored buffer)."""
        return list(self.values)


@dataclass(frozen=True)
class DataVariable:
    """A scientific field (T_ANALYZED / S_ANALYZED / U / V / CURRENT)."""

    name: str
    dimensions: tuple[str, ...]       # logical order, preserved from the file
    dtype: str
    units: UnitInfo
    standard_name: Optional[str]
    long_name: Optional[str]
    fill_value: Optional[float]       # declared _FillValue (or missing_value fallback)
    missing_value_attr: Optional[float]
    shape: tuple[int, ...]
    values: array.array = field(repr=False)   # RAW flat buffer, fill values intact
    attributes: Mapping[str, object] = field(repr=False, default_factory=dict)
    # How missing cells are *actually* represented in the buffer (observed at
    # ingest, not applied). D7 found the IO-HOOFS file stores missing as IEEE
    # NaN even though its _FillValue attribute says -1e34 -- see docs.
    observed_nan_count: int = 0
    observed_sentinel_count: int = 0   # cells exactly == fill_value

    # -- size helpers ---------------------------------------------------
    @property
    def size(self) -> int:
        return len(self.values)

    @property
    def ndim(self) -> int:
        return len(self.shape)

    @property
    def missing_representation(self) -> str:
        """How missing cells appear in :attr:`values` (observed, not applied)."""
        nan, sent = self.observed_nan_count, self.observed_sentinel_count
        if nan and sent:
            return "nan+sentinel"
        if nan:
            return "nan"
        if sent:
            return "sentinel"
        return "none-observed"

    # -- missing-data: DERIVED, never applied --------------------------
    def is_missing(self, value: float) -> bool:
        if isinstance(value, float) and math.isnan(value):
            return True
        if self.fill_value is not None and value == self.fill_value:
            return True
        return False

    def missing_mask(self) -> array.array:
        """Fresh ``array('B')`` the same length as :attr:`values`.

        ``1`` = missing/fill, ``0`` = present. Recomputed on every call; the
        values buffer is not modified, so fill data stays fully recoverable.
        """
        fv = self.fill_value
        mask = array.array("B", bytes(len(self.values)))
        if fv is None:
            for i, v in enumerate(self.values):
                if isinstance(v, float) and math.isnan(v):
                    mask[i] = 1
            return mask
        for i, v in enumerate(self.values):
            if v == fv or (isinstance(v, float) and math.isnan(v)):
                mask[i] = 1
        return mask

    def missing_count(self) -> int:
        fv = self.fill_value
        if fv is None:
            return sum(1 for v in self.values if isinstance(v, float) and math.isnan(v))
        return sum(1 for v in self.values if v == fv or (isinstance(v, float) and math.isnan(v)))

    def valid_count(self) -> int:
        return self.size - self.missing_count()

    def iter_valid(self) -> Iterator[float]:
        """Yield present values only (fill values skipped, not removed)."""
        fv = self.fill_value
        for v in self.values:
            if isinstance(v, float) and math.isnan(v):
                continue
            if fv is not None and v == fv:
                continue
            yield v

    def valid_range(self) -> tuple[Optional[float], Optional[float]]:
        """``(min, max)`` over present values only -- a structural convenience,
        **not** the D6 scientific range check."""
        lo = hi = None
        for v in self.iter_valid():
            if lo is None or v < lo:
                lo = v
            if hi is None or v > hi:
                hi = v
        return lo, hi


@dataclass(frozen=True)
class DatasetMetadata:
    source_name: str                 # e.g. "INCOIS ERDDAP"
    source_url: str
    dataset_id: str                  # e.g. "incois_argo_10day_McCreary"
    product_title: str
    product_type: str                # "analysis" | "forecast" (from D6)
    temporal_semantics: str          # human sentence about what the time axis means
    conventions: Optional[str]
    file_sha256: str
    global_attributes: Mapping[str, object] = field(repr=False, default_factory=dict)
    ingest_notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class IngestedDataset:
    """The object D8 will consume."""

    name: str                        # BlueNexus-internal short name
    file_path: Path
    file_format: str
    dimensions: tuple[DimensionInfo, ...]
    coordinates: Mapping[str, CoordinateVariable]
    variables: Mapping[str, DataVariable]
    metadata: DatasetMetadata
    time: Optional[CoordinateVariable] = None
    depth: Optional[CoordinateVariable] = None
    latitude: Optional[CoordinateVariable] = None
    longitude: Optional[CoordinateVariable] = None

    # -- lookups ------------------------------------------------------
    def dimension(self, name: str) -> DimensionInfo:
        for d in self.dimensions:
            if d.name == name:
                return d
        raise KeyError(name)

    @property
    def dimension_sizes(self) -> dict[str, int]:
        return {d.name: d.size for d in self.dimensions}

    def summary(self) -> str:
        lines = [
            f"{self.name}  <-  {self.file_path.name}  ({self.file_format})",
            f"  source : {self.metadata.source_name} / {self.metadata.dataset_id}",
            f"  product: {self.metadata.product_type} -- {self.metadata.temporal_semantics}",
            "  dimensions: "
            + ", ".join(
                f"{d.name}={d.size}"
                + (f"[{d.axis_role}]" if d.axis_role else "")
                + ("(unlimited)" if d.is_unlimited else "")
                for d in self.dimensions
            ),
        ]
        for cv in self.coordinates.values():
            step = cv.step_if_regular()
            order = (
                "asc" if cv.is_monotonic_ascending
                else "desc" if cv.is_monotonic_descending
                else "non-monotonic"
            )
            lines.append(
                f"  coord {cv.name}: n={cv.count} [{cv.minimum:g}..{cv.maximum:g}] "
                f"{order} step={'irregular' if step is None else format(step, 'g')} "
                f"units={cv.units} ({cv.axis_role or 'no-role'})"
            )
        for dv in self.variables.values():
            lo, hi = dv.valid_range()
            rng = "all-missing" if lo is None else f"{lo:g}..{hi:g}"
            lines.append(
                f"  var {dv.name}: {tuple(dv.dimensions)} {dv.shape} {dv.dtype} "
                f"units={dv.units} fill={dv.fill_value} "
                f"missing={dv.missing_count()}/{dv.size} ({dv.missing_representation}) "
                f"valid_range({rng})"
            )
        if self.metadata.ingest_notes:
            lines.append("  notes:")
            lines.extend(f"    - {n}" for n in self.metadata.ingest_notes)
        return "\n".join(lines)
