"""High-level, read-only ingestion of the D4 INCOIS NetCDF files.

Public API::

    from app.data.ingestion import (
        ingest_temperature_salinity,
        ingest_surface_currents,
        ingest_all,
        ingest_dataset,          # generic: any registered DatasetSpec
        sha256_of,
    )

Each ``ingest_*`` returns an :class:`~app.data.ingestion.models.IngestedDataset`
whose scientific values are the **raw** buffers from the file (fill values
intact). The ingestor:

* locates the known file via the registry (no downloading),
* opens it read-only through :mod:`app.data.ingestion.netcdf3`,
* preserves dimension order and the 24 irregular depth levels,
* keeps ``U``, ``V`` and ``CURRENT`` as three separate variables (``CURRENT``
  is never recomputed from ``U``/``V``),
* records ``_FillValue`` / ``missing_value`` without applying them,
* attaches raw + normalized unit metadata (working representation only -- the
  NetCDF file is not modified),
* runs the D7 schema checks and raises on ERROR-level failures.

It does **not** clean, mask, regrid, interpolate, resample, merge or
unit-convert anything. That is D8/D9.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

from .models import (
    CoordinateVariable,
    DataVariable,
    DatasetMetadata,
    DimensionInfo,
    IngestedDataset,
)
from .netcdf3 import NetCDF3File, peek_format
from .registry import (
    ALL_SPECS,
    SURFACE_CURRENTS,
    TEMPERATURE_SALINITY,
    DatasetSpec,
)
from .validation import CheckReport, check_file_present, validate_or_raise

_CHUNK = 1 << 20


def sha256_of(path: str | Path) -> str:
    """Streaming SHA-256 of a file (opened read-only)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(_CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def _attr_str(attrs: dict, key: str) -> Optional[str]:
    val = attrs.get(key)
    if val is None:
        return None
    return val if isinstance(val, str) else str(val)


def _attr_float(attrs: dict, key: str) -> Optional[float]:
    val = attrs.get(key)
    if val is None:
        return None
    if isinstance(val, (list, tuple)):
        val = val[0] if val else None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _build_coordinate(
    nc: NetCDF3File, name: str, role: str
) -> CoordinateVariable:
    var = nc.variables[name]
    attrs = dict(var.attributes)
    values = nc.read_values(name)
    if isinstance(values, str):  # a char coordinate is not something we expect
        raise ValueError(f"coordinate {name!r} is char-typed; cannot use as an axis")
    raw_units = _attr_str(attrs, "units")
    return CoordinateVariable(
        name=name,
        dimensions=var.dimensions,
        dtype=var.dtype,
        axis_role=role,
        units=_make_unit_info(raw_units, raw_units, "raw NetCDF 'units' attribute"),
        standard_name=_attr_str(attrs, "standard_name"),
        long_name=_attr_str(attrs, "long_name"),
        axis=_attr_str(attrs, "axis"),
        calendar=_attr_str(attrs, "calendar"),
        shape=var.shape,
        values=values,
        attributes=attrs,
    )


def _make_unit_info(raw, normalized, source):
    from .models import UnitInfo

    return UnitInfo(raw_units=raw, normalized_units=normalized, units_source=source)


def _build_variable(
    nc: NetCDF3File, spec: DatasetSpec, name: str
) -> DataVariable:
    var = nc.variables[name]
    attrs = dict(var.attributes)
    values = nc.read_values(name)
    if isinstance(values, str):
        raise ValueError(f"scientific variable {name!r} is char-typed; unexpected")

    raw_units = _attr_str(attrs, "units")
    fill = _attr_float(attrs, "_FillValue")
    miss = _attr_float(attrs, "missing_value")
    # Prefer _FillValue; fall back to missing_value. D6 confirmed they agree.
    fill_value = fill if fill is not None else miss

    # Observe -- do not apply -- how missing cells are actually encoded. D7
    # discovered the IO-HOOFS file uses IEEE NaN in the buffer while declaring
    # _FillValue = -1e34 in its attributes (a netCDF-Java CDM translation
    # artefact). Both forms are treated as missing by the model helpers.
    nan_count = 0
    sentinel_count = 0
    for x in values:
        if x != x:                       # NaN
            nan_count += 1
        elif fill_value is not None and x == fill_value:
            sentinel_count += 1

    return DataVariable(
        name=name,
        dimensions=var.dimensions,
        dtype=var.dtype,
        units=spec.unit_info(name, raw_units),
        standard_name=_attr_str(attrs, "standard_name"),
        long_name=_attr_str(attrs, "long_name"),
        fill_value=fill_value,
        missing_value_attr=miss,
        shape=var.shape,
        values=values,
        attributes=attrs,
        observed_nan_count=nan_count,
        observed_sentinel_count=sentinel_count,
    )


def ingest_dataset(
    spec: DatasetSpec, *, run_schema_checks: bool = True
) -> IngestedDataset:
    """Ingest any registered :class:`DatasetSpec`. Generic entry point."""
    pre = check_file_present(spec)
    if not pre.ok:
        from .validation import SchemaError

        raise SchemaError(pre)

    path = spec.path()
    with NetCDF3File(path) as nc:
        # dimensions (file order preserved)
        dims = tuple(
            DimensionInfo(
                name=d.name,
                size=d.size,
                is_unlimited=d.is_unlimited,
                axis_role=spec.axis_roles.get(d.name, ""),
            )
            for d in nc.dimensions
        )

        # coordinates
        coordinates: dict[str, CoordinateVariable] = {}
        for cname in spec.expected_coordinates:
            if cname in nc.variables:
                role = spec.axis_roles.get(cname, "")
                coordinates[cname] = _build_coordinate(nc, cname, role)

        # scientific variables
        variables: dict[str, DataVariable] = {}
        for vs in spec.variables:
            if vs.name in nc.variables:
                variables[vs.name] = _build_variable(nc, spec, vs.name)

        # role shortcuts
        by_role = {cv.axis_role: cv for cv in coordinates.values()}

        metadata = DatasetMetadata(
            source_name=spec.source_name,
            source_url=spec.source_url,
            dataset_id=spec.dataset_id,
            product_title=spec.product_title,
            product_type=spec.product_type,
            temporal_semantics=spec.temporal_semantics,
            conventions=_attr_str(dict(nc.global_attributes), "Conventions"),
            file_sha256=sha256_of(path),
            global_attributes=dict(nc.global_attributes),
            ingest_notes=spec.ingest_notes,
        )

        ds = IngestedDataset(
            name=spec.name,
            file_path=path,
            file_format=peek_format(path),
            dimensions=dims,
            coordinates=coordinates,
            variables=variables,
            metadata=metadata,
            time=by_role.get("time"),
            depth=by_role.get("depth"),
            latitude=by_role.get("latitude"),
            longitude=by_role.get("longitude"),
        )

    if run_schema_checks:
        validate_or_raise(ds, spec)
    return ds


def schema_report(spec: DatasetSpec) -> CheckReport:
    """Ingest without raising and return the schema-check report."""
    from .validation import run_checks

    ds = ingest_dataset(spec, run_schema_checks=False)
    return run_checks(ds, spec)


# -- named convenience wrappers -----------------------------------------
def ingest_temperature_salinity(*, run_schema_checks: bool = True) -> IngestedDataset:
    """INCOIS ERDDAP ``incois_argo_10day_McCreary`` -> ``T_ANALYZED`` + ``S_ANALYZED``."""
    return ingest_dataset(TEMPERATURE_SALINITY, run_schema_checks=run_schema_checks)


def ingest_surface_currents(*, run_schema_checks: bool = True) -> IngestedDataset:
    """INCOIS THREDDS IO-HOOFS -> ``U`` + ``V`` + ``CURRENT`` (surface only)."""
    return ingest_dataset(SURFACE_CURRENTS, run_schema_checks=run_schema_checks)


def ingest_all(*, run_schema_checks: bool = True) -> dict[str, IngestedDataset]:
    """Ingest every registered dataset -> ``{spec.name: IngestedDataset}``."""
    return {
        spec.name: ingest_dataset(spec, run_schema_checks=run_schema_checks)
        for spec in ALL_SPECS
    }
