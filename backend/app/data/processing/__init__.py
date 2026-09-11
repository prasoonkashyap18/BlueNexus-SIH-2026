"""BlueNexus Data Track **D8 -- process & clean the data**.

Consumes the D7 read-only ingestion layer and produces canonical *cleaned*
datasets for D9:

``raw NetCDF -> D7 ingestion -> [D8 clean/canonical] -> D9 BlueNexus format``

D8 preserves every valid scientific value exactly, maps every missing cell to a
single canonical marker (IEEE NaN + a VALID/MISSING quality byte), copies
coordinates verbatim, keeps U/V/CURRENT separate with the source CURRENT
authoritative, and attaches range + vector-consistency diagnostics. It does
**not** regrid, resample, smooth, interpolate, extrapolate, merge grids, clip,
or replace missing ocean values, and it does **not** build the BlueNexus format.

Quick start::

    from app.data.processing import process_temperature_salinity, process_surface_currents

    ts = process_temperature_salinity()
    print(ts.summary())
    temp = ts.variables["T_ANALYZED"]      # float64, missing == NaN, quality mask alongside

    cur = process_surface_currents()
    print(cur.vector_consistency.describe())   # CURRENT vs sqrt(U^2+V^2), report only
"""

from .cleaner import (
    CANONICAL_UNITS,
    process_all,
    process_dataset,
    process_surface_currents,
    process_temperature_salinity,
    processed_dir,
    write_manifest,
)
from .diagnostics import range_diagnostic, vector_consistency
from .missing import canonicalise, is_missing
from .models import (
    CANONICAL_MISSING,
    CanonicalUnitInfo,
    CleanedCoordinate,
    CleanedDataset,
    CleanedVariable,
    MissingValuePolicy,
    ProvenanceRecord,
    QualityFlag,
    RangeDiagnostic,
    VectorConsistencyDiagnostic,
)
from .ranges import REFERENCE_RANGES, ReferenceRange, reference_for

__all__ = [
    "CANONICAL_UNITS",
    "process_all",
    "process_dataset",
    "process_surface_currents",
    "process_temperature_salinity",
    "processed_dir",
    "write_manifest",
    "range_diagnostic",
    "vector_consistency",
    "canonicalise",
    "is_missing",
    "CANONICAL_MISSING",
    "CanonicalUnitInfo",
    "CleanedCoordinate",
    "CleanedDataset",
    "CleanedVariable",
    "MissingValuePolicy",
    "ProvenanceRecord",
    "QualityFlag",
    "RangeDiagnostic",
    "VectorConsistencyDiagnostic",
    "REFERENCE_RANGES",
    "ReferenceRange",
    "reference_for",
]
