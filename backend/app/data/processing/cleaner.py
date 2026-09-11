"""D8 processing/cleaning entry points.

``raw NetCDF -> D7 ingestion -> [D8 clean/canonical] -> D9 BlueNexus format``

Public API::

    from app.data.processing import (
        process_temperature_salinity,
        process_surface_currents,
        process_all,
        process_dataset,       # generic: (IngestedDataset, DatasetSpec) -> CleanedDataset
        write_manifest,
    )

D8 reuses the D7 ingestion layer verbatim (no NetCDF parsing is duplicated) and
produces :class:`~app.data.processing.models.CleanedDataset` objects:

* valid scientific values preserved exactly (float32 -> float64 is lossless),
* every missing cell -> canonical IEEE NaN + a VALID/MISSING quality byte,
* coordinates copied verbatim (no synthetic grid, no regrid/resample),
* U/V/CURRENT kept as three separate variables; source CURRENT stays
  authoritative (never recomputed),
* range + vector-consistency diagnostics attached (report only),
* full provenance back to the raw file.

It does **not** build the BlueNexus data format -- that is D9.
"""

from __future__ import annotations

import array
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..ingestion import (
    DatasetSpec,
    IngestedDataset,
    SURFACE_CURRENTS,
    TEMPERATURE_SALINITY,
    ingest_dataset,
    project_root,
)
from ..ingestion.models import CoordinateVariable, DataVariable
from .diagnostics import range_diagnostic, vector_consistency
from .missing import canonicalise
from .models import (
    CanonicalUnitInfo,
    CleanedCoordinate,
    CleanedDataset,
    CleanedVariable,
    ProvenanceRecord,
    QualityFlag,
    VectorConsistencyDiagnostic,
)
from .ranges import reference_for

# D8 canonical units (from the D6/D7 unit determination). D8 does NOT perform a
# numeric unit conversion for any current parameter -- the raw fields are
# already in these units; "canonical" here means "the agreed working unit".
CANONICAL_UNITS: dict[str, str] = {
    "T_ANALYZED": "degC",
    "S_ANALYZED": "PSU",
    "U": "m s-1",
    "V": "m s-1",
    "CURRENT": "m s-1",
}


def _copy_coordinate(cv: CoordinateVariable) -> CleanedCoordinate:
    # exact element-wise copy -- same typecode, same values
    values = array.array(cv.values.typecode, cv.values)
    return CleanedCoordinate(
        name=cv.name,
        axis_role=cv.axis_role,
        dtype=cv.dtype,
        units=cv.units.raw_units,          # raw source string, unchanged
        standard_name=cv.standard_name,
        long_name=cv.long_name,
        axis=cv.axis,
        calendar=cv.calendar,
        shape=cv.shape,
        values=values,
        attributes=dict(cv.attributes),
    )


def _clean_variable(var: DataVariable, log: list[str]) -> CleanedVariable:
    canonical_unit = CANONICAL_UNITS.get(var.name, var.units.normalized_units or "")
    raw_unit = var.units.raw_units

    values, quality, policy = canonicalise(var)
    valid_count = sum(1 for q in quality if q == QualityFlag.VALID)
    missing_count = len(quality) - valid_count

    log.append(
        f"{var.name}: {policy.describe()}"
    )
    if var.dtype == "float32":
        log.append(
            f"{var.name}: widened float32 -> float64 (exact); valid values unchanged"
        )
    else:
        log.append(
            f"{var.name}: kept {var.dtype}; valid values unchanged"
        )

    units_note = var.units.units_source
    unit_info = CanonicalUnitInfo(
        raw_units=raw_unit,
        canonical_units=canonical_unit,
        units_source=units_note,
        converted=False,      # no numeric unit conversion performed in D8
    )
    if raw_unit == canonical_unit:
        log.append(f"{var.name}: units already canonical ({canonical_unit}); metadata only")
    elif raw_unit is None:
        log.append(
            f"{var.name}: raw file has no units attribute; canonical units "
            f"'{canonical_unit}' recorded as metadata (no conversion)"
        )
    else:
        log.append(
            f"{var.name}: raw units '{raw_unit}' -> canonical label '{canonical_unit}' "
            f"(metadata normalisation only, values unchanged)"
        )

    cleaned = CleanedVariable(
        name=var.name,
        dimensions=var.dimensions,
        shape=var.shape,
        source_dtype=var.dtype,
        canonical_dtype="float64",
        units=unit_info,
        standard_name=var.standard_name,
        long_name=var.long_name,
        missing_policy=policy,
        valid_count=valid_count,
        missing_count=missing_count,
        values=values,
        quality=quality,
        source_values=var.values,        # REFERENCE to the untouched D7 buffer
        attributes=dict(var.attributes),
        range_diagnostic=None,
    )

    ref = reference_for(var.name)
    if ref is not None:
        diag = range_diagnostic(cleaned, ref)
        cleaned = _attach_range_diagnostic(cleaned, diag)
        log.append(diag.describe())
    return cleaned


def _attach_range_diagnostic(var: CleanedVariable, diag) -> CleanedVariable:
    # frozen dataclass -> rebuild with the diagnostic attached
    return CleanedVariable(
        name=var.name,
        dimensions=var.dimensions,
        shape=var.shape,
        source_dtype=var.source_dtype,
        canonical_dtype=var.canonical_dtype,
        units=var.units,
        standard_name=var.standard_name,
        long_name=var.long_name,
        missing_policy=var.missing_policy,
        valid_count=var.valid_count,
        missing_count=var.missing_count,
        values=var.values,
        quality=var.quality,
        source_values=var.source_values,
        attributes=var.attributes,
        range_diagnostic=diag,
    )


def process_dataset(
    ingested: IngestedDataset, spec: DatasetSpec
) -> CleanedDataset:
    """Turn one D7 :class:`IngestedDataset` into a :class:`CleanedDataset`."""
    log: list[str] = [
        f"consumed D7 IngestedDataset '{ingested.name}' "
        f"(raw file sha256 {ingested.metadata.file_sha256})",
        "coordinates copied verbatim from D7 -- no regrid, resample, "
        "interpolation, smoothing or synthetic grid generation",
    ]

    coordinates = {
        name: _copy_coordinate(cv) for name, cv in ingested.coordinates.items()
    }
    for c in coordinates.values():
        log.append(
            f"coordinate {c.name} [{c.axis_role}]: {c.count} values copied exactly "
            f"([{c.values[0]:g}..{c.values[-1]:g}])"
        )

    variables = {
        name: _clean_variable(var, log) for name, var in ingested.variables.items()
    }

    # currents: U/V/CURRENT vector-consistency diagnostic (report only)
    vector_diag: Optional[VectorConsistencyDiagnostic] = None
    if {"U", "V", "CURRENT"}.issubset(variables):
        vector_diag = vector_consistency(
            variables["U"], variables["V"], variables["CURRENT"]
        )
        log.append(
            "retained U, V and CURRENT as separate variables; source CURRENT is "
            "authoritative and was NOT recomputed"
        )
        log.append(vector_diag.describe())

    by_role = {c.axis_role: c for c in coordinates.values()}
    depth_levels = tuple(by_role["depth"].values) if "depth" in by_role else ()
    time_cov = None
    if "time" in by_role and by_role["time"].count:
        tv = by_role["time"].values
        time_cov = (tv[0], tv[-1])

    prov = ProvenanceRecord(
        dataset_name=ingested.name,
        source_name=ingested.metadata.source_name,
        source_url=ingested.metadata.source_url,
        dataset_id=ingested.metadata.dataset_id,
        product_title=ingested.metadata.product_title,
        product_type=ingested.metadata.product_type,
        temporal_semantics=ingested.metadata.temporal_semantics,
        raw_file=str(ingested.file_path.relative_to(project_root())).replace("\\", "/"),
        raw_file_sha256=ingested.metadata.file_sha256,
        raw_file_bytes=ingested.file_path.stat().st_size,
        raw_file_format=ingested.file_format,
        conventions=ingested.metadata.conventions,
        variables_processed=tuple(variables),
        original_units={n: v.units.raw_units for n, v in variables.items()},
        normalized_units={n: v.units.canonical_units for n, v in variables.items()},
        dimensions=ingested.dimension_sizes,
        coordinate_axes={c.name: c.axis_role for c in coordinates.values()},
        time_units=by_role["time"].units if "time" in by_role else None,
        time_calendar=by_role["time"].calendar if "time" in by_role else None,
        time_coverage=time_cov,
        depth_levels=depth_levels,
        processed_at_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )

    dims = tuple(
        (d.name, d.size, d.is_unlimited, d.axis_role) for d in ingested.dimensions
    )

    return CleanedDataset(
        name=ingested.name,
        product_type=ingested.metadata.product_type,
        dimensions=dims,
        coordinates=coordinates,
        variables=variables,
        provenance=prov,
        processing_log=tuple(log),
        vector_consistency=vector_diag,
        time=by_role.get("time"),
        depth=by_role.get("depth"),
        latitude=by_role.get("latitude"),
        longitude=by_role.get("longitude"),
    )


# -- named wrappers (ingest via D7, then clean) -------------------------
def process_temperature_salinity() -> CleanedDataset:
    return process_dataset(ingest_dataset(TEMPERATURE_SALINITY), TEMPERATURE_SALINITY)


def process_surface_currents() -> CleanedDataset:
    return process_dataset(ingest_dataset(SURFACE_CURRENTS), SURFACE_CURRENTS)


def process_all() -> dict[str, CleanedDataset]:
    return {
        "incois_argo_10day_analysis": process_temperature_salinity(),
        "incois_io_hoofs_surface_currents": process_surface_currents(),
    }


# -- optional intermediate artifact -----------------------------------
def processed_dir() -> Path:
    d = project_root() / "data" / "processed"
    return d


def write_manifest(cleaned: CleanedDataset, out_dir: Optional[Path] = None) -> Path:
    """Write a small JSON manifest (metadata + diagnostics, **no bulk arrays**)
    under ``data/processed/``. Never writes into ``data/raw/``."""
    out_dir = out_dir or processed_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_root = (project_root() / "data" / "raw").resolve()
    target = (out_dir / f"{cleaned.name}.d8.json").resolve()
    if raw_root in target.parents:
        raise RuntimeError("refusing to write a D8 artifact inside data/raw/")
    target.write_text(json.dumps(cleaned.manifest(), indent=2), encoding="utf-8")
    return target
