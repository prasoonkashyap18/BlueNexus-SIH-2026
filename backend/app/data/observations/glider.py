"""Reader for the real EGO / OceanGliders underwater-glider observations (Step 29).

Parses the D4 raw snapshot
``data/raw/glider_ego_oceangliders_gdac_sample.csv`` -- an
``OceanGlidersGDACTrajectories`` (tabledap) response from the IFREMER ERDDAP,
preserved verbatim -- into per-deployment trajectory records for the D10-style
API.

Same conventions as the Step 28 Argo reader (``app.data.observations.argo``):

* **Real values only.** Numbers are the exact ASCII values from the CSV, parsed
  to ``float`` with no rounding, scaling or unit conversion.
* **Missing stays missing.** ERDDAP renders an absent value as ``NaN`` and the
  EGO ``_FillValue`` is ``99999.0``; both -- and an empty cell -- become
  ``None``. QC bytes are ``NaN`` / empty when absent -> ``None``.
* **QC preserved.** The EGO reference-table-2.1 quality flags (``PRES_QC`` /
  ``TEMP_QC`` / ``PSAL_QC`` / ``POSITION_QC``) are carried through as their raw
  single-digit codes -- including ``4`` (bad). Nothing is filtered or dropped.
* **Kept separate from the model grid.** This is trajectory/point data; it is
  never regridded onto or merged with the gridded BlueNexus datasets, and it is
  not Argo.

A glider "platform" here == one **deployment** (``platform_deployment``,
e.g. ``sea057_20220707``). Glider data is a continuous CTD time-series along a
sawtooth trajectory, not discrete cycles, so a deployment carries an ordered
list of ``samples`` (not "levels").
"""

from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

# ---------------------------------------------------------------------------
# Identity / provenance
# ---------------------------------------------------------------------------

GLIDER_DATASET_ID = "ego_oceangliders_gdac"

#: EGO / ERDDAP missing-value markers for the measurement columns.
_FILL_VALUE = 99999.0

#: A glider deployment id: letters/digits with '_' or '-' (e.g. sea057_20220707,
#: Bellatrix_368). Also the route-level guard.
PLATFORM_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$")

RAW_CSV_NAME = "glider_ego_oceangliders_gdac_sample.csv"

SOURCE = {
    "source_name": "EGO / OceanGliders GDAC",
    "source_url": "https://erddap.ifremer.fr/erddap/tabledap/OceanGlidersGDACTrajectories.html",
    "source_dataset_id": "OceanGlidersGDACTrajectories",
    "source_identifier": "ego:OceanGlidersGDACTrajectories",
    "access_protocol": "IFREMER ERDDAP tabledap (CSV)",
    "gdac_host": "IFREMER / Coriolis",
    "programme": "OceanGliders (GOOS) / EGO - Everyone's Gliding Observatories",
    "network_info_url": "http://www.ego-network.org/",
    "conventions": "CF-1.6 EGO-1.2",
    "qc_manual": "http://doi.org/10.13155/51485 (EGO reference table 2.1)",
    "product_type": "observation",
    "temporal_semantics": (
        "Individual underwater-glider CTD samples along the deployment "
        "trajectory, at their real observation timestamps. Not an analysis, "
        "not a forecast. The GDAC is a delayed-mode / near-real-time assembly "
        "centre, not a live feed."
    ),
    "pipeline_stages": [
        "D4 acquisition (IFREMER ERDDAP tabledap CSV, verbatim)",
        "Step 29 deployment grouping (missing markers and the EGO fill value 99999 mapped to null, QC preserved)",
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

#: EGO reference table 2.1 (same vocabulary as Argo).
QUALITY_DEFINITION = {
    "0": "no QC performed",
    "1": "good data",
    "2": "probably good data",
    "3": "bad data that are potentially correctable",
    "4": "bad data",
    "5": "value changed",
    "8": "interpolated value",
    "9": "missing value",
}


class GliderDeploymentNotFoundError(LookupError):
    """Raised when a deployment id is not present in the snapshot."""


def default_raw_csv_path() -> Path:
    """``<repo>/data/raw/glider_ego_oceangliders_gdac_sample.csv``."""
    from ..ingestion import project_root

    return project_root() / "data" / "raw" / RAW_CSV_NAME


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GliderSample:
    """One CTD sample along the trajectory. ``None`` == real missing value."""

    time: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    position_qc: Optional[str]
    pressure: Optional[float]
    pressure_qc: Optional[str]
    temperature: Optional[float]
    temperature_qc: Optional[str]
    salinity: Optional[float]
    salinity_qc: Optional[str]

    def as_dict(self) -> dict:
        return {
            "time": self.time,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "position_qc": self.position_qc,
            "pressure": self.pressure,
            "pressure_qc": self.pressure_qc,
            "temperature": self.temperature,
            "temperature_qc": self.temperature_qc,
            "salinity": self.salinity,
            "salinity_qc": self.salinity_qc,
        }


@dataclass(frozen=True)
class GliderDeployment:
    """One glider deployment and its ordered trajectory samples."""

    platform_id: str            # == platform_deployment, verbatim
    samples: tuple[GliderSample, ...]

    @property
    def sample_count(self) -> int:
        return len(self.samples)

    def _finite(self, pick) -> list[float]:
        return [v for v in (pick(s) for s in self.samples) if v is not None]

    @property
    def time_start(self) -> Optional[str]:
        times = [s.time for s in self.samples if s.time]
        return min(times) if times else None

    @property
    def time_end(self) -> Optional[str]:
        times = [s.time for s in self.samples if s.time]
        return max(times) if times else None

    def _bounds(self, pick) -> tuple[Optional[float], Optional[float]]:
        vals = self._finite(pick)
        return (min(vals), max(vals)) if vals else (None, None)

    def summary(self) -> dict:
        lat_min, lat_max = self._bounds(lambda s: s.latitude)
        lon_min, lon_max = self._bounds(lambda s: s.longitude)
        pres_min, pres_max = self._bounds(lambda s: s.pressure)
        return {
            "platform_id": self.platform_id,
            "platform_type": "glider",
            "sample_count": self.sample_count,
            "time_start": self.time_start,
            "time_end": self.time_end,
            "latitude_min": lat_min,
            "latitude_max": lat_max,
            "longitude_min": lon_min,
            "longitude_max": lon_max,
            "pressure_min": pres_min,
            "pressure_max": pres_max,
        }

    def detail(self, provenance: dict) -> dict:
        return {
            "dataset_id": GLIDER_DATASET_ID,
            **self.summary(),
            "units": dict(UNITS),
            "standard_names": dict(STANDARD_NAMES),
            "quality_definition": dict(QUALITY_DEFINITION),
            "missing_value": None,
            "samples": [s.as_dict() for s in self.samples],
            "provenance": provenance,
        }


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_EXPECTED_COLUMNS = [
    "platform_deployment",
    "time",
    "latitude",
    "longitude",
    "PRES",
    "PRES_QC",
    "TEMP",
    "TEMP_QC",
    "PSAL",
    "PSAL_QC",
    "POSITION_QC",
]


def _num(raw: str) -> Optional[float]:
    """CSV cell -> float; ERDDAP `NaN`, the EGO fill value and blanks -> None."""
    text = raw.strip()
    if text == "" or text.lower() == "nan":
        return None
    value = float(text)
    if not math.isfinite(value) or value == _FILL_VALUE:
        return None
    return value


def _qc(raw: str) -> Optional[str]:
    """QC flag cell -> its raw code; `NaN` / blank -> None."""
    text = raw.strip()
    if text == "" or text.lower() == "nan":
        return None
    return text


def _text(raw: str) -> Optional[str]:
    text = raw.strip()
    return text or None


def parse_deployments(rows: Iterable[list[str]]) -> list[GliderDeployment]:
    """Group ordered tabledap rows by ``platform_deployment``. Header rows excluded."""
    grouped: "dict[str, list[GliderSample]]" = {}
    order: list[str] = []
    for row in rows:
        if not row or all(cell.strip() == "" for cell in row):
            continue
        platform = row[0].strip()
        if platform == "":
            continue
        if platform not in grouped:
            grouped[platform] = []
            order.append(platform)
        grouped[platform].append(
            GliderSample(
                time=_text(row[1]),
                latitude=_num(row[2]),
                longitude=_num(row[3]),
                pressure=_num(row[4]),
                pressure_qc=_qc(row[5]),
                temperature=_num(row[6]),
                temperature_qc=_qc(row[7]),
                salinity=_num(row[8]),
                salinity_qc=_qc(row[9]),
                position_qc=_qc(row[10]),
            )
        )
    return [GliderDeployment(platform_id=p, samples=tuple(grouped[p])) for p in order]


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


class GliderTrajectoriesReader:
    """Loads the raw CSV once and answers list / detail queries in memory."""

    def __init__(self, csv_path: Optional[Path] = None) -> None:
        self._path = Path(csv_path) if csv_path is not None else default_raw_csv_path()
        self._deployments: list[GliderDeployment] = []
        self._by_id: dict[str, GliderDeployment] = {}
        self._source_file_sha256: Optional[str] = None
        self._loaded = False

    def load(self) -> "GliderTrajectoriesReader":
        from ..ingestion import sha256_of

        with open(self._path, "r", encoding="utf-8-sig", newline="") as fh:
            all_rows = list(csv.reader(fh))

        if not all_rows:
            raise ValueError(f"{self._path} is empty")
        header = [c.strip() for c in all_rows[0]]
        if header != _EXPECTED_COLUMNS:
            raise ValueError(
                f"unexpected column layout in {self._path.name}: {header!r}"
            )
        # all_rows[1] is the ERDDAP units row -- skipped, units are pinned above.
        self._deployments = parse_deployments(all_rows[2:])
        self._by_id = {d.platform_id: d for d in self._deployments}
        self._source_file_sha256 = sha256_of(self._path)
        self._loaded = True
        return self

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def path(self) -> Path:
        return self._path

    def provenance(self) -> dict:
        return {
            **SOURCE,
            "source_file_name": self._path.name,
            "source_file_format": "CSV (ERDDAP tabledap)",
            "source_file_sha256": self._source_file_sha256,
        }

    def deployments(self) -> list[GliderDeployment]:
        return list(self._deployments)

    def platform_ids(self) -> list[str]:
        return [d.platform_id for d in self._deployments]

    def summaries(self) -> list[dict]:
        return [d.summary() for d in self._deployments]

    def get(self, platform_id: str) -> GliderDeployment:
        try:
            return self._by_id[platform_id]
        except KeyError:
            raise GliderDeploymentNotFoundError(platform_id) from None

    def detail(self, platform_id: str) -> dict:
        return self.get(platform_id).detail(self.provenance())

    def health(self) -> dict:
        return {
            "raw_file": self._path.name,
            "raw_file_present": self._path.is_file(),
            "raw_file_sha256": self._source_file_sha256,
            "deployments_loaded": len(self._deployments),
            "platform_ids": self.platform_ids(),
            "total_samples": sum(d.sample_count for d in self._deployments),
        }
