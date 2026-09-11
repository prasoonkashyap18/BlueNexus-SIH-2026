"""D9 conversion: D8 :class:`CleanedDataset` -> :class:`BlueNexusDataset`.

No NetCDF parsing, no cleaning, no regridding, no interpolation, no grid or
time-system merging. The scientific arrays are taken **as-is** from D8 (float64,
missing already canonical NaN, quality mask already built). D9 only:

* re-labels variables to canonical parameter ids,
* copies coordinate arrays verbatim (the current grid is **not** regenerated),
* adds ISO-8601 UTC time strings alongside the raw numeric time values,
* assembles explicit metadata + provenance,
* keeps U / V / CURRENT as three separate parameters, CURRENT authoritative.
"""

from __future__ import annotations

import array
import math
from typing import Optional

from ..processing import process_all, process_surface_currents, process_temperature_salinity
from ..processing.models import CleanedCoordinate, CleanedDataset, CleanedVariable
from .models import (
    MISSING_VALUE_DEFINITION,
    QUALITY_DEFINITION,
    SCHEMA_VERSION,
    BlueNexusArray,
    BlueNexusCoordinate,
    BlueNexusDataset,
    BlueNexusDimension,
    BlueNexusMetadata,
    BlueNexusParameter,
    BlueNexusProvenance,
)
from .parameters import ParameterSpec, parameters_for_dataset
from .timeaxis import normalise_time_axis

_PIPELINE_STAGES = (
    "D4 acquisition",
    "D5 dimension inspection",
    "D6 units/range/missing validation",
    "D7 read-only ingestion",
    "D8 cleaning / canonical representation",
    "D9 BlueNexus format",
)

_TITLES = {
    "incois_argo_10day_analysis": "INCOIS Argo 10-Day Analysis - Temperature & Salinity",
    "incois_io_hoofs_surface_currents": "INCOIS IO-HOOFS Surface Current Forecast",
}


def _ordering(values) -> str:
    if len(values) <= 1:
        return "single"
    if all(values[i] < values[i + 1] for i in range(len(values) - 1)):
        return "ascending"
    if all(values[i] > values[i + 1] for i in range(len(values) - 1)):
        return "descending"
    return "unordered"


def _regular_step(values, *, rel_tol: float = 1e-6) -> Optional[float]:
    if len(values) < 2:
        return None
    step = values[1] - values[0]
    if step == 0:
        return None
    for i in range(1, len(values) - 1):
        if not math.isclose(
            values[i + 1] - values[i], step, rel_tol=rel_tol, abs_tol=abs(step) * rel_tol
        ):
            return None
    return float(step)


def _depth_direction(coord: CleanedCoordinate) -> Optional[str]:
    positive = coord.attributes.get("positive")
    if isinstance(positive, str):
        return positive
    return None


def _build_coordinate(role: str, coord: CleanedCoordinate) -> BlueNexusCoordinate:
    values = tuple(float(v) for v in coord.values)   # exact copy from D8
    bnc_kwargs = dict(
        role=role,
        name=coord.name,
        units=coord.units,
        calendar=coord.calendar,
        direction=_depth_direction(coord) if role == "depth" else None,
        ordering=_ordering(values),
        count=len(values),
        values=values,
        regular_step=_regular_step(values),
    )
    if role == "time" and coord.units:
        norm = normalise_time_axis(coord.units, values)
        bnc_kwargs.update(
            iso_times=norm.iso_times,
            reference_epoch_iso=norm.reference_iso,
            timezone=norm.assumed_timezone or "UTC",
            timezone_is_assumed=not norm.had_explicit_timezone,
        )
    return BlueNexusCoordinate(**bnc_kwargs)


def _build_parameter(
    spec: ParameterSpec, var: CleanedVariable
) -> tuple[BlueNexusParameter, BlueNexusArray]:
    lo, hi = var.valid_min_max()
    param = BlueNexusParameter(
        parameter_id=spec.parameter_id,
        display_name=spec.display_name,
        display_aliases=spec.display_aliases,
        source_variable=var.name,
        source_dataset=spec.source_dataset,
        units=spec.canonical_units,
        raw_units=var.units.raw_units,
        units_source=var.units.units_source,
        dimensions=_roles_for_dims(var.dimensions),
        shape=var.shape,
        standard_name=var.standard_name,
        long_name=var.long_name,
        kind=spec.kind,
        vector_group=spec.vector_group,
        vector_role=spec.vector_role,
        authoritative=spec.authoritative,
        surface_only=spec.surface_only,
        valid_count=var.valid_count,
        missing_count=var.missing_count,
        valid_min=lo,
        valid_max=hi,
        notes=spec.notes,
    )
    # arrays: reuse D8's buffers (already float64 / uint8, missing == NaN)
    payload = BlueNexusArray(
        parameter_id=spec.parameter_id,
        shape=var.shape,
        values=array.array("d", var.values),     # copy: D9 owns its buffer
        quality=array.array("B", var.quality),
    )
    return param, payload


_ROLE_BY_SOURCE_DIM = {
    "time": "time", "ZAX": "depth", "latitude": "latitude", "longitude": "longitude",
    "TAXIS": "time", "DEPTH1_1": "depth", "LAT": "latitude", "LON": "longitude",
}


def _roles_for_dims(dims: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(_ROLE_BY_SOURCE_DIM.get(d, d) for d in dims)


def _coverage(coord: BlueNexusCoordinate) -> dict:
    return {
        "min": min(coord.values),
        "max": max(coord.values),
        "n": coord.count,
        "step": coord.regular_step,
        "units": coord.units,
        "ordering": coord.ordering,
    }


def convert_to_bluenexus(cleaned: CleanedDataset) -> BlueNexusDataset:
    specs = parameters_for_dataset(cleaned.name)
    if not specs:
        raise ValueError(f"no BlueNexus parameters registered for dataset {cleaned.name!r}")

    dimensions = tuple(
        BlueNexusDimension(name=n, role=r or _ROLE_BY_SOURCE_DIM.get(n, n),
                           size=s, is_unlimited=u)
        for (n, s, u, r) in cleaned.dimensions
    )

    coordinates: dict[str, BlueNexusCoordinate] = {}
    for role in ("time", "depth", "latitude", "longitude"):
        src = {"time": cleaned.time, "depth": cleaned.depth,
               "latitude": cleaned.latitude, "longitude": cleaned.longitude}[role]
        if src is not None:
            coordinates[role] = _build_coordinate(role, src)

    parameters: dict[str, BlueNexusParameter] = {}
    arrays: dict[str, BlueNexusArray] = {}
    for spec in specs:
        var = cleaned.variables[spec.source_variable]
        param, payload = _build_parameter(spec, var)
        parameters[spec.parameter_id] = param
        arrays[spec.parameter_id] = payload

    prov = cleaned.provenance
    provenance = BlueNexusProvenance(
        source_name=prov.source_name,
        source_url=prov.source_url,
        source_dataset_id=prov.dataset_id,
        source_file=prov.raw_file,
        source_file_sha256=prov.raw_file_sha256,
        source_file_bytes=prov.raw_file_bytes,
        source_file_format=prov.raw_file_format,
        conventions=prov.conventions,
        pipeline_stages=_PIPELINE_STAGES,
        d8_processing_log=cleaned.processing_log,
        original_units={p.parameter_id: parameters[p.parameter_id].raw_units for p in specs},
        canonical_units={p.parameter_id: parameters[p.parameter_id].units for p in specs},
    )

    tcoord = coordinates.get("time")
    dcoord = coordinates.get("depth")
    latc = coordinates["latitude"]
    lonc = coordinates["longitude"]

    time_coverage = {
        "start": tcoord.values[0] if tcoord else None,
        "end": tcoord.values[-1] if tcoord else None,
        "start_iso": tcoord.iso_times[0] if tcoord and tcoord.iso_times else None,
        "end_iso": tcoord.iso_times[-1] if tcoord and tcoord.iso_times else None,
        "n": tcoord.count if tcoord else 0,
        "step": tcoord.regular_step if tcoord else None,
        "units": tcoord.units if tcoord else None,
        "calendar": tcoord.calendar if tcoord else None,
        "timezone": tcoord.timezone if tcoord else None,
        "timezone_is_assumed": tcoord.timezone_is_assumed if tcoord else False,
    }
    surface_only = all(s.surface_only for s in specs)
    depth_coverage = {
        "min": min(dcoord.values) if dcoord else None,
        "max": max(dcoord.values) if dcoord else None,
        "levels": list(dcoord.values) if dcoord else [],
        "n": dcoord.count if dcoord else 0,
        "units": dcoord.units if dcoord else None,
        "direction": dcoord.direction if dcoord else None,
        "ordering": dcoord.ordering if dcoord else None,
        "surface_only": surface_only,
        "regular": (dcoord.regular_step is not None) if dcoord else None,
    }
    lat_coverage = _coverage(latc)
    lon_coverage = dict(_coverage(lonc))
    lon_coverage["convention"] = (
        "degrees_east, positive east" if min(lonc.values) >= 0 else "degrees_east, signed"
    )

    vector_groups: dict[str, dict] = {}
    for spec in specs:
        if spec.vector_group:
            g = vector_groups.setdefault(
                spec.vector_group,
                {"components": {}, "magnitude": None, "surface_only": spec.surface_only,
                 "identity": "speed == sqrt(u**2 + v**2); magnitude is source-authoritative"},
            )
            if spec.kind == "vector_component":
                g["components"][spec.vector_role] = spec.parameter_id
            elif spec.kind == "vector_magnitude":
                g["magnitude"] = spec.parameter_id

    data_status = cleaned.product_type   # "analysis" | "forecast" -- never "real-time"
    metadata = BlueNexusMetadata(
        dataset_id=cleaned.name,
        display_name=_TITLES.get(cleaned.name, cleaned.name),
        parameter_ids=tuple(parameters),
        product_type=cleaned.product_type,
        data_status=data_status,
        temporal_semantics=prov.temporal_semantics,
        time_coverage=time_coverage,
        depth_coverage=depth_coverage,
        latitude_coverage=lat_coverage,
        longitude_coverage=lon_coverage,
        source={
            "name": prov.source_name,
            "url": prov.source_url,
            "dataset_id": prov.dataset_id,
            "product_title": prov.product_title,
        },
        quality_definition=QUALITY_DEFINITION,
        missing_value_definition=MISSING_VALUE_DEFINITION,
        vector_groups=vector_groups,
        notes=(
            "Temporal systems of the analysis and forecast datasets are distinct "
            "and are never merged.",
            "Datasets keep their native grids; no regrid, resample or grid merge.",
            f"data_status={data_status!r}; this dataset is NOT real-time.",
        ),
    )

    return BlueNexusDataset(
        schema_version=SCHEMA_VERSION,
        dataset_id=cleaned.name,
        product_type=cleaned.product_type,
        title=_TITLES.get(cleaned.name, cleaned.name),
        dimensions=dimensions,
        coordinates=coordinates,
        parameters=parameters,
        metadata=metadata,
        provenance=provenance,
        arrays=arrays,
        generation={},
    )


# -- convenience wrappers -------------------------------------------------
def convert_temperature_salinity() -> BlueNexusDataset:
    return convert_to_bluenexus(process_temperature_salinity())


def convert_surface_currents() -> BlueNexusDataset:
    return convert_to_bluenexus(process_surface_currents())


def convert_all() -> dict[str, BlueNexusDataset]:
    return {name: convert_to_bluenexus(ds) for name, ds in process_all().items()}
