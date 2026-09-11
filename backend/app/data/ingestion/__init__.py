"""BlueNexus Data Track **D7 -- read-only ingestion layer**.

Opens the real INCOIS NetCDF files acquired in D4 and returns structured,
immutable Python objects for the downstream pipeline (D8 processing, D9 format,
D10 backend). It never modifies the raw files and never cleans, masks,
regrids, interpolates or unit-converts the science -- see ``docs/data-ingestion.md``.

Quick start::

    from app.data.ingestion import ingest_temperature_salinity, ingest_surface_currents

    ts = ingest_temperature_salinity()
    print(ts.summary())
    temp = ts.variables["T_ANALYZED"]        # raw float32 buffer, fill values intact
    mask = temp.missing_mask()               # derived; values buffer untouched

    cur = ingest_surface_currents()
    speed = cur.variables["CURRENT"]         # INCOIS-supplied, NOT recomputed
"""

from .models import (
    CoordinateVariable,
    DataVariable,
    DatasetMetadata,
    DimensionInfo,
    IngestedDataset,
    UnitInfo,
)
from .netcdf3 import NetCDF3File, NetCDFError, UnsupportedNetCDFError, peek_format
from .netcdf_ingestor import (
    ingest_all,
    ingest_dataset,
    ingest_surface_currents,
    ingest_temperature_salinity,
    schema_report,
    sha256_of,
)
from .registry import (
    ALL_SPECS,
    SURFACE_CURRENTS,
    TEMPERATURE_SALINITY,
    DatasetSpec,
    VariableSpec,
    project_root,
    spec_by_name,
)
from .validation import (
    Check,
    CheckReport,
    SchemaError,
    Severity,
    check_file_present,
    run_checks,
    validate_or_raise,
)

__all__ = [
    "CoordinateVariable",
    "DataVariable",
    "DatasetMetadata",
    "DimensionInfo",
    "IngestedDataset",
    "UnitInfo",
    "NetCDF3File",
    "NetCDFError",
    "UnsupportedNetCDFError",
    "peek_format",
    "ingest_all",
    "ingest_dataset",
    "ingest_surface_currents",
    "ingest_temperature_salinity",
    "schema_report",
    "sha256_of",
    "ALL_SPECS",
    "SURFACE_CURRENTS",
    "TEMPERATURE_SALINITY",
    "DatasetSpec",
    "VariableSpec",
    "project_root",
    "spec_by_name",
    "Check",
    "CheckReport",
    "SchemaError",
    "Severity",
    "check_file_present",
    "run_checks",
    "validate_or_raise",
]
