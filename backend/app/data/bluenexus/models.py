"""The BlueNexus data model (D9).

This is the **canonical data contract** the future D10 API will serve and the
frontend will consume. It is intentionally explicit, deterministic and
versionable.

Layout::

    BlueNexusDataset
      schema_version
      dataset_id
      product_type            "analysis" | "forecast"   (never "real-time")
      title
      dimensions[]            (name, role, size, is_unlimited)  -- source order kept
      coordinates{role}       time / depth / latitude / longitude, values copied exactly
      parameters{param_id}    canonical ids only
      metadata
      provenance
      arrays{param_id}        BlueNexusArray(values float64 NaN-missing, quality uint8)
      generation             non-deterministic bookkeeping (NOT part of the contract hash)

``BlueNexusDataset.contract()`` returns the deterministic dict (no bulk arrays,
no timestamps). ``manifest()`` = contract + an arrays index + generation info.
Missing data is IEEE NaN in ``BlueNexusArray.values`` and ``1`` in
``.quality``; any JSON projection renders it as ``null`` (never 0 / -1 /
-9999 / -1e34).
"""

from __future__ import annotations

import array
import math
from dataclasses import dataclass, field
from typing import Iterator, Mapping, Optional

SCHEMA_VERSION = "bluenexus.dataset/1"

# canonical quality vocabulary -- exactly two states, data-availability only
QUALITY_DEFINITION: dict[str, str] = {"0": "VALID", "1": "MISSING"}

MISSING_VALUE_DEFINITION = (
    "Missing cells are IEEE-754 NaN in the binary `values` array and 1 in the "
    "parallel `quality` array (0 = VALID). In any JSON projection a missing "
    "cell is `null`. The source sentinels (9999.0 for temperature/salinity, "
    "-1e34 declared for currents) and source NaN are all normalised away in D8 "
    "and never appear in the BlueNexus format. 0 is a real value, never a "
    "missing marker."
)

# JSON missing marker for projections (Python None -> JSON null)
JSON_MISSING = None


@dataclass(frozen=True)
class BlueNexusDimension:
    name: str            # source dimension name (e.g. "ZAX", "TAXIS")
    role: str            # "time" | "depth" | "latitude" | "longitude"
    size: int
    is_unlimited: bool


@dataclass(frozen=True)
class BlueNexusCoordinate:
    role: str                          # "time" | "depth" | "latitude" | "longitude"
    name: str                          # source coordinate variable name
    units: Optional[str]               # raw source units string, unchanged
    calendar: Optional[str]
    direction: Optional[str]           # e.g. depth "down"
    ordering: str                      # "ascending" | "descending" | "single" | "unordered"
    count: int
    values: tuple[float, ...]          # EXACT copy of the D8 coordinate values
    regular_step: Optional[float]      # constant step if evenly spaced, else None
    # time-only extras (None for other roles)
    iso_times: Optional[tuple[str, ...]] = None
    reference_epoch_iso: Optional[str] = None
    timezone: Optional[str] = None
    timezone_is_assumed: bool = False

    def to_contract(self) -> dict:
        d: dict = {
            "role": self.role,
            "name": self.name,
            "units": self.units,
            "calendar": self.calendar,
            "direction": self.direction,
            "ordering": self.ordering,
            "count": self.count,
            "values": [float(v) for v in self.values],
            "regular_step": self.regular_step,
        }
        if self.role == "time":
            d["iso_times"] = list(self.iso_times or ())
            d["reference_epoch_iso"] = self.reference_epoch_iso
            d["timezone"] = self.timezone
            d["timezone_is_assumed"] = self.timezone_is_assumed
        return d


@dataclass(frozen=True)
class BlueNexusParameter:
    parameter_id: str                  # canonical id
    display_name: str
    display_aliases: tuple[str, ...]    # cosmetic only -- never a lookup key
    source_variable: str
    source_dataset: str
    units: str                         # canonical
    raw_units: Optional[str]           # provenance
    units_source: str
    dimensions: tuple[str, ...]        # ("time","depth","latitude","longitude")
    shape: tuple[int, ...]
    standard_name: Optional[str]
    long_name: Optional[str]
    kind: str                          # scalar_field | vector_component | vector_magnitude
    vector_group: Optional[str]
    vector_role: Optional[str]
    authoritative: bool
    surface_only: bool
    valid_count: int
    missing_count: int
    valid_min: Optional[float]
    valid_max: Optional[float]
    notes: tuple[str, ...]

    @property
    def missing_fraction(self) -> float:
        n = self.valid_count + self.missing_count
        return self.missing_count / n if n else 0.0

    def to_contract(self) -> dict:
        return {
            "parameter_id": self.parameter_id,
            "display_name": self.display_name,
            "display_aliases": list(self.display_aliases),
            "source_variable": self.source_variable,
            "source_dataset": self.source_dataset,
            "units": self.units,
            "raw_units": self.raw_units,
            "units_source": self.units_source,
            "dimensions": list(self.dimensions),
            "shape": list(self.shape),
            "standard_name": self.standard_name,
            "long_name": self.long_name,
            "kind": self.kind,
            "vector_group": self.vector_group,
            "vector_role": self.vector_role,
            "authoritative": self.authoritative,
            "surface_only": self.surface_only,
            "valid_count": self.valid_count,
            "missing_count": self.missing_count,
            "missing_fraction": round(self.missing_fraction, 9),
            "valid_min": self.valid_min,
            "valid_max": self.valid_max,
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class BlueNexusArray:
    """Bulk payload for one parameter -- kept out of the deterministic contract."""

    parameter_id: str
    shape: tuple[int, ...]
    values: array.array = field(repr=False)     # 'd' float64, missing == NaN
    quality: array.array = field(repr=False)    # 'B' uint8, 0 VALID / 1 MISSING

    @property
    def size(self) -> int:
        return len(self.values)

    def iter_valid(self) -> Iterator[float]:
        for q, v in zip(self.quality, self.values):
            if q == 0:
                yield v

    def valid_min_max(self) -> tuple[Optional[float], Optional[float]]:
        lo = hi = None
        for v in self.iter_valid():
            if lo is None or v < lo:
                lo = v
            if hi is None or v > hi:
                hi = v
        return lo, hi


@dataclass(frozen=True)
class BlueNexusProvenance:
    source_name: str
    source_url: str
    source_dataset_id: str
    source_file: str                   # repo-relative
    source_file_sha256: str
    source_file_bytes: int
    source_file_format: str
    conventions: Optional[str]
    pipeline_stages: tuple[str, ...]
    d8_processing_log: tuple[str, ...]
    original_units: Mapping[str, Optional[str]]   # param_id -> raw units
    canonical_units: Mapping[str, str]            # param_id -> canonical units

    def to_contract(self) -> dict:
        return {
            "source_name": self.source_name,
            "source_url": self.source_url,
            "source_dataset_id": self.source_dataset_id,
            "source_file": self.source_file,
            "source_file_sha256": self.source_file_sha256,
            "source_file_bytes": self.source_file_bytes,
            "source_file_format": self.source_file_format,
            "conventions": self.conventions,
            "pipeline_stages": list(self.pipeline_stages),
            "d8_processing_log": list(self.d8_processing_log),
            "original_units": dict(self.original_units),
            "canonical_units": dict(self.canonical_units),
        }


@dataclass(frozen=True)
class BlueNexusMetadata:
    dataset_id: str
    display_name: str
    parameter_ids: tuple[str, ...]
    product_type: str                  # "analysis" | "forecast"
    data_status: str                   # "analysis" | "forecast" (never "real-time")
    temporal_semantics: str
    time_coverage: dict
    depth_coverage: dict
    latitude_coverage: dict
    longitude_coverage: dict
    source: dict
    quality_definition: Mapping[str, str]
    missing_value_definition: str
    vector_groups: Mapping[str, dict]
    notes: tuple[str, ...]

    def to_contract(self) -> dict:
        return {
            "dataset_id": self.dataset_id,
            "display_name": self.display_name,
            "parameter_ids": list(self.parameter_ids),
            "product_type": self.product_type,
            "data_status": self.data_status,
            "temporal_semantics": self.temporal_semantics,
            "time_coverage": self.time_coverage,
            "depth_coverage": self.depth_coverage,
            "latitude_coverage": self.latitude_coverage,
            "longitude_coverage": self.longitude_coverage,
            "source": self.source,
            "quality_definition": dict(self.quality_definition),
            "missing_value_definition": self.missing_value_definition,
            "vector_groups": {k: dict(v) for k, v in self.vector_groups.items()},
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class BlueNexusDataset:
    schema_version: str
    dataset_id: str
    product_type: str
    title: str
    dimensions: tuple[BlueNexusDimension, ...]
    coordinates: Mapping[str, BlueNexusCoordinate]      # keyed by role
    parameters: Mapping[str, BlueNexusParameter]        # keyed by canonical id
    metadata: BlueNexusMetadata
    provenance: BlueNexusProvenance
    arrays: Mapping[str, BlueNexusArray]                # keyed by canonical id
    generation: Mapping[str, object] = field(default_factory=dict)

    # -- lookups ----------------------------------------------------
    def parameter(self, parameter_id: str) -> BlueNexusParameter:
        return self.parameters[parameter_id]

    def array(self, parameter_id: str) -> BlueNexusArray:
        return self.arrays[parameter_id]

    def coordinate(self, role: str) -> BlueNexusCoordinate:
        return self.coordinates[role]

    @property
    def dimension_sizes(self) -> dict[str, int]:
        return {d.name: d.size for d in self.dimensions}

    # -- the deterministic contract -------------------------------
    def contract(self) -> dict:
        """Pure function of the scientific content -- no timestamps, no paths
        beyond the repo-relative source file, key order fixed by
        ``json.dumps(sort_keys=True)`` at serialisation time."""
        return {
            "schema_version": self.schema_version,
            "dataset_id": self.dataset_id,
            "product_type": self.product_type,
            "title": self.title,
            "dimensions": [
                {
                    "name": d.name,
                    "role": d.role,
                    "size": d.size,
                    "is_unlimited": d.is_unlimited,
                }
                for d in self.dimensions
            ],
            "coordinates": {
                role: c.to_contract() for role, c in self.coordinates.items()
            },
            "parameters": {
                pid: p.to_contract() for pid, p in self.parameters.items()
            },
            "metadata": self.metadata.to_contract(),
            "provenance": self.provenance.to_contract(),
        }

    def summary(self) -> str:
        lines = [
            f"{self.dataset_id}  ({self.product_type})  schema={self.schema_version}",
            f"  title      : {self.title}",
            f"  source     : {self.provenance.source_name} / {self.provenance.source_dataset_id}",
            f"  raw sha256 : {self.provenance.source_file_sha256}",
            "  dimensions : "
            + ", ".join(f"{d.name}={d.size}[{d.role}]" for d in self.dimensions),
        ]
        for role in ("time", "depth", "latitude", "longitude"):
            c = self.coordinates.get(role)
            if not c:
                continue
            extra = ""
            if role == "time" and c.iso_times:
                extra = f"  {c.iso_times[0]} .. {c.iso_times[-1]} ({c.timezone})"
            lines.append(
                f"  coord {role} ({c.name}): n={c.count} "
                f"[{c.values[0]:g}..{c.values[-1]:g}] units={c.units} "
                f"step={c.regular_step}{extra}"
            )
        for pid, p in self.parameters.items():
            lines.append(
                f"  param {pid}: <- {p.source_variable} {p.shape} {p.units} "
                f"valid={p.valid_count} missing={p.missing_count} "
                f"range=[{p.valid_min:g}..{p.valid_max:g}] "
                f"{'AUTHORITATIVE' if p.authoritative else ''} "
                f"{'surface-only' if p.surface_only else ''}"
            )
        return "\n".join(lines)
