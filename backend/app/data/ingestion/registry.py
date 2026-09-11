"""Registry of the real INCOIS datasets acquired in D4.

Each :class:`DatasetSpec` describes *one* raw file: where it lives, what axes
and variables it is expected to contain, how its axes map onto BlueNexus roles
(time / depth / latitude / longitude), and the D6-authoritative unit
interpretation for every variable.

Adding a future parameter (e.g. an approved INCOIS chlorophyll file) is a
matter of appending one ``DatasetSpec`` here -- no ingestor changes needed.
Chlorophyll is intentionally **absent**: no approved acquired dataset exists
yet (see ``docs/data-availability.md`` / ``docs/data-acquisition.md``).

Nothing in this file reads or writes data; it is pure configuration derived
from D4/D5/D6 documentation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Optional

from .models import UnitInfo


def project_root() -> Path:
    """Walk up from this file until we find the repo root (has ``data/raw``)."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "data" / "raw").is_dir() and (parent / ".git").exists():
            return parent
    # Fallback: repo layout is backend/app/data/ingestion/registry.py
    return here.parents[4]


@dataclass(frozen=True)
class VariableSpec:
    name: str
    raw_units: Optional[str]          # what D5/D6 saw in the file ("degs", "PSU", None)
    normalized_units: Optional[str]   # D6 interpretation ("degC", "PSU", "m s-1")
    units_source: str
    role: str                         # "field" (all D4 scientific vars are fields)


@dataclass(frozen=True)
class DatasetSpec:
    name: str                         # BlueNexus-internal short name
    filename: str                     # basename inside data/raw/
    source_name: str
    source_url: str
    dataset_id: str
    product_title: str
    product_type: str                 # "analysis" | "forecast"
    temporal_semantics: str
    expected_dimensions: Mapping[str, int]     # name -> D4/D5 size (advisory check)
    axis_roles: Mapping[str, str]              # dim/coord name -> role
    expected_coordinates: tuple[str, ...]
    variables: tuple[VariableSpec, ...]
    expected_fill_values: Mapping[str, float]  # var name -> fill value seen in D6
    ingest_notes: tuple[str, ...] = ()

    # -- helpers -------------------------------------------------------
    def path(self) -> Path:
        return project_root() / "data" / "raw" / self.filename

    def variable(self, name: str) -> VariableSpec:
        for v in self.variables:
            if v.name == name:
                return v
        raise KeyError(name)

    def unit_info(self, var_name: str, raw_units_from_file: Optional[str]) -> UnitInfo:
        vs = self.variable(var_name)
        return UnitInfo(
            raw_units=raw_units_from_file,
            normalized_units=vs.normalized_units,
            units_source=vs.units_source,
        )


# ---------------------------------------------------------------------------
# 1. Temperature + Salinity  (INCOIS ERDDAP -- incois_argo_10day_McCreary)
# ---------------------------------------------------------------------------
TEMPERATURE_SALINITY = DatasetSpec(
    name="incois_argo_10day_analysis",
    filename="temperature_salinity_incois_argo_sample.nc",
    source_name="INCOIS ERDDAP",
    source_url="https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.html",
    dataset_id="incois_argo_10day_McCreary",
    product_title="INCOIS ARGO 10 Day data Kessler-McCreary Methodology",
    product_type="analysis",
    temporal_semantics=(
        "Objective-analysis nominal dates: each timestamp is the reference date of a "
        "10-day Argo objective analysis (not an observation time, not a forecast)."
    ),
    expected_dimensions={"time": 3, "ZAX": 24, "latitude": 36, "longitude": 51},
    axis_roles={
        "time": "time",
        "ZAX": "depth",
        "latitude": "latitude",
        "longitude": "longitude",
    },
    expected_coordinates=("time", "ZAX", "latitude", "longitude"),
    variables=(
        VariableSpec(
            name="T_ANALYZED",
            raw_units="degs",
            normalized_units="degC",
            units_source=(
                "D6 validation: raw 'degs' is a FERRET/COARDS legacy label; value "
                "structure (surface ~24-33, 2000 m ~2.5-3.2, monotonic with depth) "
                "and product context confirm degrees Celsius."
            ),
            role="field",
        ),
        VariableSpec(
            name="S_ANALYZED",
            raw_units="PSU",
            normalized_units="PSU",
            units_source=(
                "D6 validation: standard_name 'sea_water_practical_salinity' -- "
                "Practical Salinity Unit, kept as-is."
            ),
            role="field",
        ),
    ),
    expected_fill_values={"T_ANALYZED": 9999.0, "S_ANALYZED": 9999.0},
    ingest_notes=(
        "24 depth levels are irregular (5..2000 m); spacing must not be assumed even.",
        "~36% of cells are fill (9999.0): land, sub-bathymetry, and deep levels the "
        "Argo analysis does not populate. Fill values are preserved, never replaced (D8).",
        "T_ANALYZED has no standard_name in the raw file; normalized_units is metadata only.",
    ),
)


# ---------------------------------------------------------------------------
# 2. Surface currents  (INCOIS THREDDS -- IO-HOOFS)
# ---------------------------------------------------------------------------
_CURRENT_UNITS_SOURCE = (
    "D6 authoritative INCOIS validation: CURRENT.long_name = 'Surface Currents (m/s)' "
    "(identical in the INCOIS THREDDS OPeNDAP DAS); CURRENT == sqrt(U^2+V^2) to machine "
    "precision over all valid cells, so U and V share CURRENT's unit; INCOIS Ocean State "
    "Forecast docs state current speed is in metres per second. U/V carry NO units "
    "attribute in the raw file -- 'm s-1' is a working-representation annotation only."
)

SURFACE_CURRENTS = DatasetSpec(
    name="incois_io_hoofs_surface_currents",
    filename="currents_incois_io-hoofs_sample.nc",
    source_name="INCOIS THREDDS (IO-HOOFS)",
    source_url="https://incois.gov.in/thredds/catalog/osf/currents/catalog.html",
    dataset_id="CURRENTS_IO_20260904.nc",
    product_title="IO-HOOFS operational surface-current forecast",
    product_type="forecast",
    temporal_semantics=(
        "Forecast-valid times from the IO-HOOFS operational forecast (ROMS-based) run "
        "initialised ~2026-09-04. The sample keeps every 10th step of a natively "
        "3-hourly forecast (D4 timeStride=10), hence a 30-hour spacing. Not observations."
    ),
    expected_dimensions={"TAXIS": 4, "DEPTH1_1": 1, "LAT": 421, "LON": 601},
    axis_roles={
        "TAXIS": "time",
        "DEPTH1_1": "depth",
        "LAT": "latitude",
        "LON": "longitude",
    },
    expected_coordinates=("TAXIS", "DEPTH1_1", "LAT", "LON"),
    variables=(
        VariableSpec("U", None, "m s-1", _CURRENT_UNITS_SOURCE, "field"),
        VariableSpec("V", None, "m s-1", _CURRENT_UNITS_SOURCE, "field"),
        VariableSpec("CURRENT", None, "m s-1", _CURRENT_UNITS_SOURCE, "field"),
    ),
    expected_fill_values={"U": -1e34, "V": -1e34, "CURRENT": -1e34},
    ingest_notes=(
        "Surface-only: exactly one depth level at 0.0 m. No subsurface current data "
        "exists and none is invented.",
        "U, V and CURRENT are kept as three separate variables. CURRENT is the INCOIS-"
        "supplied speed and is preserved as-is -- it is NOT recomputed from U/V.",
        "Missing cells are stored as IEEE NaN in the data buffer, even though the "
        "_FillValue / missing_value attributes declare -1e34 (a netCDF-Java CDM "
        "translation artefact from the D4 THREDDS NCSS download). The ingestion layer "
        "treats BOTH NaN and the -1e34 sentinel as missing. ~20% of cells are missing "
        "(the land mask). Preserved, never replaced (D8).",
        "Grid spacing is stored as exactly 0.0833 deg (approx 1/12 deg); downstream code "
        "must use the stored coordinate arrays, not assume an exact 1/12 deg step.",
    ),
)


ALL_SPECS: tuple[DatasetSpec, ...] = (TEMPERATURE_SALINITY, SURFACE_CURRENTS)


def spec_by_name(name: str) -> DatasetSpec:
    for s in ALL_SPECS:
        if s.name == name:
            return s
    raise KeyError(name)
