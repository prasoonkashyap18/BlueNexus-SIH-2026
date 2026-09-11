"""Reader for the real INCOIS Argo profiling-float observations (Step 28).

Parses the D4 raw snapshot
``data/raw/argo_profiles_incois_indian_argo_floats_sample.csv`` -- an INCOIS
ERDDAP ``Indian_ARGO_Floats`` (tabledap) response, preserved verbatim -- into
per-profile records for the D10-style API.

Design mirrors ``app.data.bluenexus`` conventions:

* **Real values only.** Numbers are the exact ASCII values from the CSV, parsed
  to ``float`` / ``int`` with no rounding, scaling or unit conversion.
* **Missing stays missing.** ERDDAP writes the Argo ``_FillValue`` (``99999.0``)
  or an empty cell for an absent value; both become ``None`` -- never ``0`` /
  ``-999`` / a guessed number.
* **QC preserved.** The per-level Argo quality flags (``PRES_QC`` / ``TEMP_QC`` /
  ``PSAL_QC``) are carried through as their raw single-character codes.
* **Kept separate from the model grid.** This is point/profile data; it is never
  regridded onto or merged with the gridded BlueNexus datasets.

One "platform" in the API == one float **profile** (one ascent cycle),
addressed by the composite id ``<PLATFORM_NUMBER>_<CYCLE_NUMBER>`` (e.g.
``2903951_10``).
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

# ---------------------------------------------------------------------------
# Identity / provenance
# ---------------------------------------------------------------------------

ARGO_DATASET_ID = "incois_indian_argo_floats"

#: ERDDAP's Argo missing-value marker (see the dataset's ``_FillValue`` attrs).
_FILL_VALUE = 99999.0

#: Composite platform id: ``<digits>_<digits>``. Also the route-level guard.
PLATFORM_ID_RE = re.compile(r"^[0-9]{1,12}_[0-9]{1,6}$")

RAW_CSV_NAME = "argo_profiles_incois_indian_argo_floats_sample.csv"

SOURCE = {
    "source_name": "INCOIS ERDDAP",
    "source_url": "https://erddap.incois.gov.in/erddap/tabledap/Indian_ARGO_Floats.html",
    "source_dataset_id": "Indian_ARGO_Floats",
    "source_identifier": "incois:Indian_ARGO_Floats",
    "access_protocol": "ERDDAP tabledap (CSV)",
    "product_title": "INDIAN ARGO Floats Data",
    "product_type": "observation",
    "temporal_semantics": (
        "Individual Argo float profiles at their real observation timestamps. "
        "Not an analysis, not a forecast, not real-time (this public mirror "
        "lags the live Argo array)."
    ),
    "pipeline_stages": [
        "D4 acquisition (ERDDAP tabledap CSV, verbatim)",
        "Step 28 profile grouping (fill values -> null, QC preserved)",
    ],
}

#: Units exactly as the ERDDAP units row / dataset attributes report them.
UNITS = {
    "pressure": "decibar",
    "temperature": "degree_Celsius",
    "salinity": "PSU",
    "time": "UTC (ISO 8601)",
    "latitude": "degrees_north",
    "longitude": "degrees_east",
}

STANDARD_NAMES = {
    "pressure": "sea_water_pressure",
    "temperature": "sea_water_temperature",
    "salinity": "sea_water_practical_salinity",
}

QUALITY_DEFINITION = {
    "1": "good data",
    "2": "probably good data",
    "3": "probably bad data",
    "4": "bad data",
    "5": "value changed",
    "8": "interpolated value",
    "9": "missing value",
}


class ArgoProfileNotFoundError(LookupError):
    """Raised when a composite platform id is not present in the snapshot."""


def default_raw_csv_path() -> Path:
    """``<repo>/data/raw/argo_profiles_incois_indian_argo_floats_sample.csv``."""
    from ..ingestion import project_root

    return project_root() / "data" / "raw" / RAW_CSV_NAME


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ArgoLevel:
    """One measured pressure level of a profile. ``None`` == real missing value."""

    pressure: Optional[float]
    pressure_qc: Optional[str]
    temperature: Optional[float]
    temperature_qc: Optional[str]
    salinity: Optional[float]
    salinity_qc: Optional[str]

    def as_dict(self) -> dict:
        return {
            "pressure": self.pressure,
            "pressure_qc": self.pressure_qc,
            "temperature": self.temperature,
            "temperature_qc": self.temperature_qc,
            "salinity": self.salinity,
            "salinity_qc": self.salinity_qc,
        }


@dataclass(frozen=True)
class ArgoProfile:
    """One float profile (one ascent cycle) and its measured levels."""

    platform_id: str
    platform_number: str
    cycle_number: int
    platform_type: Optional[str]
    direction: Optional[str]
    time: Optional[str]           # ISO-8601 UTC, verbatim from the CSV
    latitude: Optional[float]
    longitude: Optional[float]
    levels: tuple[ArgoLevel, ...]

    # -- derived, read-only helpers (no science invented) --------------
    @property
    def level_count(self) -> int:
        return len(self.levels)

    def _pressures(self) -> list[float]:
        return [lv.pressure for lv in self.levels if lv.pressure is not None]

    @property
    def pressure_min(self) -> Optional[float]:
        vals = self._pressures()
        return min(vals) if vals else None

    @property
    def pressure_max(self) -> Optional[float]:
        vals = self._pressures()
        return max(vals) if vals else None

    def summary(self) -> dict:
        return {
            "platform_id": self.platform_id,
            "platform_number": self.platform_number,
            "cycle_number": self.cycle_number,
            "platform_type": self.platform_type,
            "direction": self.direction,
            "time": self.time,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "level_count": self.level_count,
            "pressure_min": self.pressure_min,
            "pressure_max": self.pressure_max,
        }

    def detail(self, provenance: dict) -> dict:
        return {
            "dataset_id": ARGO_DATASET_ID,
            **self.summary(),
            "units": dict(UNITS),
            "standard_names": dict(STANDARD_NAMES),
            "quality_definition": dict(QUALITY_DEFINITION),
            "missing_value": None,
            "levels": [lv.as_dict() for lv in self.levels],
            "provenance": provenance,
        }


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_EXPECTED_COLUMNS = [
    "PLATFORM_NUMBER",
    "CYCLE_NUMBER",
    "PLATFORM_TYPE",
    "DIRECTION",
    "time",
    "latitude",
    "longitude",
    "PRES",
    "PRES_QC",
    "TEMP",
    "TEMP_QC",
    "PSAL",
    "PSAL_QC",
]


def _num(raw: str) -> Optional[float]:
    """CSV cell -> float, with the Argo fill value and blanks mapped to None."""
    text = raw.strip()
    if text == "":
        return None
    value = float(text)
    if value == _FILL_VALUE:
        return None
    return value


def _qc(raw: str) -> Optional[str]:
    """QC flag cell -> its raw code, or None when absent."""
    text = raw.strip()
    return text or None


def _text(raw: str) -> Optional[str]:
    text = raw.strip()
    return text or None


def parse_profiles(rows: Iterable[list[str]]) -> list[ArgoProfile]:
    """Group ordered tabledap rows into profiles. Input excludes the header rows."""
    grouped: "dict[tuple[str, str], list[list[str]]]" = {}
    order: list[tuple[str, str]] = []
    for row in rows:
        if not row or all(cell.strip() == "" for cell in row):
            continue
        key = (row[0].strip(), row[1].strip())
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(row)

    profiles: list[ArgoProfile] = []
    for platform_number, cycle_text in order:
        member_rows = grouped[(platform_number, cycle_text)]
        first = member_rows[0]
        levels = tuple(
            ArgoLevel(
                pressure=_num(r[7]),
                pressure_qc=_qc(r[8]),
                temperature=_num(r[9]),
                temperature_qc=_qc(r[10]),
                salinity=_num(r[11]),
                salinity_qc=_qc(r[12]),
            )
            for r in member_rows
        )
        profiles.append(
            ArgoProfile(
                platform_id=f"{platform_number}_{cycle_text}",
                platform_number=platform_number,
                cycle_number=int(cycle_text),
                platform_type=_text(first[2]),
                direction=_text(first[3]),
                time=_text(first[4]),
                latitude=_num(first[5]),
                longitude=_num(first[6]),
                levels=levels,
            )
        )
    return profiles


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


class ArgoProfilesReader:
    """Loads the raw CSV once and answers list / detail queries in memory."""

    def __init__(self, csv_path: Optional[Path] = None) -> None:
        self._path = Path(csv_path) if csv_path is not None else default_raw_csv_path()
        self._profiles: list[ArgoProfile] = []
        self._by_id: dict[str, ArgoProfile] = {}
        self._source_file_sha256: Optional[str] = None
        self._loaded = False

    # -- lifecycle ------------------------------------------------------
    def load(self) -> "ArgoProfilesReader":
        from ..ingestion import sha256_of

        with open(self._path, "r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh)
            all_rows = list(reader)

        if not all_rows:
            raise ValueError(f"{self._path} is empty")
        header = [c.strip() for c in all_rows[0]]
        if header != _EXPECTED_COLUMNS:
            raise ValueError(
                f"unexpected column layout in {self._path.name}: {header!r}"
            )
        # all_rows[1] is the ERDDAP units row -- skipped, units are pinned above.
        self._profiles = parse_profiles(all_rows[2:])
        self._by_id = {p.platform_id: p for p in self._profiles}
        self._source_file_sha256 = sha256_of(self._path)
        self._loaded = True
        return self

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def path(self) -> Path:
        return self._path

    # -- provenance ---------------------------------------------------
    def provenance(self) -> dict:
        return {
            **SOURCE,
            "source_file_name": self._path.name,
            "source_file_format": "CSV (ERDDAP tabledap)",
            "source_file_sha256": self._source_file_sha256,
        }

    # -- queries ------------------------------------------------------
    def profiles(self) -> list[ArgoProfile]:
        return list(self._profiles)

    def platform_ids(self) -> list[str]:
        return [p.platform_id for p in self._profiles]

    def summaries(self) -> list[dict]:
        return [p.summary() for p in self._profiles]

    def get(self, platform_id: str) -> ArgoProfile:
        try:
            return self._by_id[platform_id]
        except KeyError:
            raise ArgoProfileNotFoundError(platform_id) from None

    def detail(self, platform_id: str) -> dict:
        return self.get(platform_id).detail(self.provenance())

    def observed_temperature_profile(self, platform_id: str) -> dict:
        """Step 44: the comparison-ready observed *temperature* profile for one
        real Argo profile (native ``pressure_dbar`` + real temperature, sorted,
        no interpolation, QC preserved). No model, no difference."""
        from .observed_profile import extract_observed_temperature_profile

        return extract_observed_temperature_profile(
            self.get(platform_id), self.provenance()
        )

    # -- health -----------------------------------------------------
    def health(self) -> dict:
        floats = sorted({p.platform_number for p in self._profiles})
        return {
            "raw_file": self._path.name,
            "raw_file_present": self._path.is_file(),
            "raw_file_sha256": self._source_file_sha256,
            "profiles_loaded": len(self._profiles),
            "distinct_floats": len(floats),
            "float_numbers": floats,
        }
