"""D14 -- official INCOIS source discovery & acquisition.

Each :class:`DatasetSource` knows how to do two things for one logical BlueNexus
dataset, using **only** the official machine-readable INCOIS services already
established in D1-D4 (no HTML scraping):

* :meth:`discover_latest` -- ask the source "what is the newest dataset/file you
  have?" without downloading the bulk data (a few KB of catalog / metadata).
* :meth:`acquire` -- download exactly the regional/temporal subset D4 defined,
  to a staging path, and verify it is a readable NetCDF-3 file.

Two real sources:

* :class:`ErddapArgoSource` -- INCOIS ERDDAP ``incois_argo_10day_McCreary``
  (temperature + salinity, one analysis artifact). Freshness signal: the
  dataset's ``time_coverage_end`` global attribute (advances when a new 10-day
  objective-analysis step is published).
* :class:`ThreddsCurrentsSource` -- INCOIS THREDDS ``osf/currents`` catalog
  (U / V / CURRENT, one forecast artifact). Freshness signal: the newest
  ``CURRENTS_IO_YYYYMMDD.nc`` entry in the catalog listing.

A third, :class:`FixtureSource`, is for the deterministic update-pipeline tests
only -- it never touches the network.

Nothing here writes into ``data/raw/`` or touches an installed ``.bnx``.
"""

from __future__ import annotations

import json
import re
import shutil
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from ..ingestion import DatasetSpec
from ..ingestion.netcdf3 import peek_format
from ..ingestion.netcdf_ingestor import sha256_of
from ..ingestion.registry import SURFACE_CURRENTS, TEMPERATURE_SALINITY

# ---------------------------------------------------------------------------
# logical dataset groups (stable IDs -- never a new ID per day, D14 §19)
# ---------------------------------------------------------------------------
GROUP_TEMPERATURE_SALINITY = "temperature-salinity"
GROUP_CURRENTS = "currents"
ALL_GROUPS = (GROUP_TEMPERATURE_SALINITY, GROUP_CURRENTS)

_LOGICAL_DATASET_ID = {
    GROUP_TEMPERATURE_SALINITY: "incois_argo_10day_analysis",
    GROUP_CURRENTS: "incois_io_hoofs_surface_currents",
}

# D4 baseline acquisition timestamps (docs/data-acquisition.md §2.1 / §4.1) --
# recorded so the manifest can distinguish *acquisition* time from *source*
# time and *artifact generation* time even before the first D14 update runs.
_D4_BASELINE_ACQUIRED_AT = {
    GROUP_TEMPERATURE_SALINITY: "2026-09-05T18:48:37Z",
    GROUP_CURRENTS: "2026-09-05T18:49:56Z",
}

_HTTP_TIMEOUT = 30
_ACQUIRE_TIMEOUT = 600
_USER_AGENT = "BlueNexus-D14-updater/1 (+INCOIS Ocean Visualization)"


def logical_dataset_id(group: str) -> str:
    return _LOGICAL_DATASET_ID[group]


def baseline_acquired_at(group: str) -> Optional[str]:
    return _D4_BASELINE_ACQUIRED_AT.get(group)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# value objects
# ---------------------------------------------------------------------------
class SourceError(RuntimeError):
    """A source-discovery or acquisition failure. Carries the failing stage."""

    def __init__(self, stage: str, message: str) -> None:
        self.stage = stage
        super().__init__(f"[{stage}] {message}")


@dataclass(frozen=True)
class SourceVersion:
    """What the official source currently offers for one dataset group."""

    group: str
    #: Opaque, comparable id: an ISO date (analysis) or ``CURRENTS_IO_YYYYMMDD.nc`` (forecast).
    version_id: str
    source_name: str
    source_url: str
    #: The source's own dataset / file identifier.
    source_identifier: str
    #: The *source data* time coverage this version represents (ISO-8601 UTC).
    source_time_start_iso: Optional[str] = None
    source_time_end_iso: Optional[str] = None
    #: Source-side modification metadata, when the service exposes it.
    remote_last_modified: Optional[str] = None
    remote_size_bytes: Optional[int] = None
    #: When *this check* ran (never confused with source time or acquisition time).
    discovered_at: str = field(default_factory=_utc_now_iso)

    def is_newer_than(self, installed_version_id: Optional[str]) -> bool:
        """Is this a genuinely newer source than what is installed?

        Comparison is per-group: ISO-date lexical order for the analysis
        product, embedded ``YYYYMMDD`` order for the forecast files. An
        unrecognised / missing installed id counts as "older".
        """
        if not installed_version_id:
            return True
        if self.version_id == installed_version_id:
            return False
        if self.group == GROUP_CURRENTS:
            new = _currents_date(self.version_id)
            old = _currents_date(installed_version_id)
            return new is not None and (old is None or new > old)
        # analysis: ISO timestamps sort lexically
        return self.version_id > installed_version_id


@dataclass(frozen=True)
class AcquiredFile:
    """A verified, freshly downloaded raw source file staged on disk."""

    path: Path
    sha256: str
    size_bytes: int
    file_format: str
    acquired_at: str
    version: SourceVersion


def _currents_date(name: str) -> Optional[str]:
    m = re.search(r"(\d{8})", name or "")
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# HTTP (stdlib only -- the backend venv has no requests/httpx)
# ---------------------------------------------------------------------------
def _http_get(url: str, *, timeout: int, stage: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        # Default TLS verification (no bypass -- carries the D4 §6 discipline).
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:  # pragma: no cover - network dependent
        raise SourceError(stage, f"HTTP {exc.code} from {url}") from None
    except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as exc:
        raise SourceError(stage, f"could not reach {url}: {exc}") from None


def _http_download(url: str, dest: Path, *, timeout: int, stage: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".part")
            with open(tmp, "wb") as fh:
                shutil.copyfileobj(resp, fh, length=1 << 20)
            tmp.replace(dest)
    except urllib.error.HTTPError as exc:  # pragma: no cover - network dependent
        raise SourceError(stage, f"HTTP {exc.code} downloading {url}") from None
    except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as exc:
        raise SourceError(stage, f"download failed for {url}: {exc}") from None


def _verify_netcdf3(path: Path, *, stage: str) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        raise SourceError(stage, f"acquired file missing or empty: {path}")
    fmt = peek_format(path)
    if not fmt.startswith("NetCDF-3"):
        raise SourceError(stage, f"acquired file is not NetCDF-3 classic: {fmt}")
    return fmt


# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------
class DatasetSource:
    """One official INCOIS source for one logical BlueNexus dataset group."""

    group: str
    spec: DatasetSpec

    def discover_latest(self) -> SourceVersion:  # pragma: no cover - abstract
        raise NotImplementedError

    def acquire(self, version: SourceVersion, dest: Path) -> AcquiredFile:  # pragma: no cover
        raise NotImplementedError

    # shared: finalise a staged download into an AcquiredFile
    def _finalise(self, version: SourceVersion, dest: Path) -> AcquiredFile:
        fmt = _verify_netcdf3(dest, stage="verify-acquisition")
        return AcquiredFile(
            path=dest,
            sha256=sha256_of(dest),
            size_bytes=dest.stat().st_size,
            file_format=fmt,
            acquired_at=_utc_now_iso(),
            version=version,
        )


# ---------------------------------------------------------------------------
# INCOIS ERDDAP -- temperature + salinity (one analysis artifact, D14 §20)
# ---------------------------------------------------------------------------
class ErddapArgoSource(DatasetSource):
    group = GROUP_TEMPERATURE_SALINITY
    spec = TEMPERATURE_SALINITY

    DEFAULT_BASE = "https://erddap.incois.gov.in/erddap"
    DATASET_ID = "incois_argo_10day_McCreary"
    # D4 regional/vertical subset (docs/data-acquisition.md §2.1) -- reused verbatim.
    _DEPTH = "(5.0):1:(2000.0)"
    _LAT = "(-10):1:(25)"
    _LON = "(50):1:(100)"
    _STEP_DAYS = 10
    _STEPS = 3

    def __init__(self, base_url: Optional[str] = None) -> None:
        self.base_url = (base_url or self.DEFAULT_BASE).rstrip("/")

    def discover_latest(self) -> SourceVersion:
        url = f"{self.base_url}/info/{self.DATASET_ID}/index.json"
        raw = _http_get(url, timeout=_HTTP_TIMEOUT, stage="discover")
        try:
            rows = json.loads(raw)["table"]["rows"]
        except (ValueError, KeyError, TypeError) as exc:
            raise SourceError("discover", f"unexpected ERDDAP info payload: {exc}") from None

        attrs: dict[str, str] = {}
        for row in rows:
            # [row_type, variable_name, attribute_name, data_type, value]
            if len(row) >= 5 and row[0] == "attribute" and row[1] == "NC_GLOBAL":
                attrs[row[2]] = row[4]

        end_iso = attrs.get("time_coverage_end")
        start_iso = attrs.get("time_coverage_start")
        if not end_iso:
            raise SourceError("discover", "ERDDAP info has no time_coverage_end")

        # The subset D4/D13 use keeps only the newest 3 analysis steps.
        subset_start = _shift_iso_days(end_iso, -self._STEP_DAYS * (self._STEPS - 1)) or start_iso

        return SourceVersion(
            group=self.group,
            version_id=end_iso,
            source_name="INCOIS ERDDAP",
            source_url=f"{self.base_url}/griddap/{self.DATASET_ID}.html",
            source_identifier=self.DATASET_ID,
            source_time_start_iso=subset_start,
            source_time_end_iso=end_iso,
            remote_last_modified=attrs.get("date_created") or attrs.get("date_issued"),
        )

    def acquire(self, version: SourceVersion, dest: Path) -> AcquiredFile:
        end = version.source_time_end_iso or version.version_id
        start = version.source_time_start_iso or _shift_iso_days(
            end, -self._STEP_DAYS * (self._STEPS - 1)
        )
        if not start:
            raise SourceError("acquire", "could not determine the analysis subset start")

        def _sel(var: str) -> str:
            return (
                f"{var}[({_iso_date(start)}):1:({_iso_date(end)})]"
                f"[{self._DEPTH}][{self._LAT}][{self._LON}]"
            )

        query = f"{_sel('T_ANALYZED')},{_sel('S_ANALYZED')}"
        url = f"{self.base_url}/griddap/{self.DATASET_ID}.nc?{urllib.parse.quote(query, safe='()[]:,.-')}"
        _http_download(url, dest, timeout=_ACQUIRE_TIMEOUT, stage="acquire")
        return self._finalise(version, dest)


# ---------------------------------------------------------------------------
# INCOIS THREDDS -- IO-HOOFS surface currents (one forecast artifact, D14 §21)
# ---------------------------------------------------------------------------
class ThreddsCurrentsSource(DatasetSource):
    group = GROUP_CURRENTS
    spec = SURFACE_CURRENTS

    DEFAULT_BASE = "https://incois.gov.in/thredds"
    CATALOG = "catalog/osf/currents/catalog.xml"
    _NS = "{http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0}"
    _FILE_RE = re.compile(r"^CURRENTS_IO_(\d{8})\.nc$")
    # D4 NCSS regional subset (docs/data-acquisition.md §4.1) -- reused verbatim.
    _NCSS_QUERY = (
        "var=U&var=V&var=CURRENT&north=25&south=-10&east=100&west=50"
        "&time=all&timeStride=10&accept=netcdf3"
    )

    def __init__(self, base_url: Optional[str] = None) -> None:
        self.base_url = (base_url or self.DEFAULT_BASE).rstrip("/")

    def discover_latest(self) -> SourceVersion:
        url = f"{self.base_url}/{self.CATALOG}"
        raw = _http_get(url, timeout=_HTTP_TIMEOUT, stage="discover")
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as exc:
            raise SourceError("discover", f"could not parse THREDDS catalog: {exc}") from None

        candidates: list[tuple[str, str, Optional[str], Optional[int]]] = []
        for ds in root.iter(f"{self._NS}dataset"):
            name = ds.get("name") or ""
            if not self._FILE_RE.match(name):
                continue
            date_el = ds.find(f"{self._NS}date")
            size_el = ds.find(f"{self._NS}dataSize")
            size_bytes: Optional[int] = None
            if size_el is not None and size_el.text:
                try:
                    mb = float(size_el.text)
                    unit = (size_el.get("units") or "").lower()
                    size_bytes = int(mb * (1e6 if unit.startswith("mbyte") else 1))
                except ValueError:
                    size_bytes = None
            candidates.append(
                (name, ds.get("urlPath") or f"osf/currents/{name}",
                 date_el.text if date_el is not None else None, size_bytes)
            )

        if not candidates:
            raise SourceError("discover", "no CURRENTS_IO_*.nc entries in the THREDDS catalog")

        name, url_path, modified, size_bytes = max(
            candidates, key=lambda c: _currents_date(c[0]) or ""
        )
        day = _currents_date(name)
        init_iso = f"{day[0:4]}-{day[4:6]}-{day[6:8]}T00:00:00Z" if day else None

        return SourceVersion(
            group=self.group,
            version_id=name,
            source_name="INCOIS THREDDS (IO-HOOFS)",
            source_url=f"{self.base_url}/catalog/osf/currents/catalog.html",
            source_identifier=name,
            source_time_start_iso=init_iso,
            source_time_end_iso=None,  # forecast horizon -- known only after acquisition
            remote_last_modified=modified,
            remote_size_bytes=size_bytes,
        )

    def acquire(self, version: SourceVersion, dest: Path) -> AcquiredFile:
        url = (
            f"{self.base_url}/ncss/grid/osf/currents/{version.version_id}?{self._NCSS_QUERY}"
        )
        _http_download(url, dest, timeout=_ACQUIRE_TIMEOUT, stage="acquire")
        return self._finalise(version, dest)


# ---------------------------------------------------------------------------
# fixture source -- deterministic update-pipeline tests only (D14 §27)
# ---------------------------------------------------------------------------
class FixtureSource(DatasetSource):
    """A source backed by a local fixture file. No network. Test use only.

    ``fail_stage`` injects a controlled failure at ``"discover"`` or
    ``"acquire"``; ``corrupt_acquire`` writes non-NetCDF bytes so the
    acquisition-verification step rejects it.
    """

    def __init__(
        self,
        *,
        group: str,
        spec: DatasetSpec,
        version: SourceVersion,
        fixture_file: Optional[Path] = None,
        fail_stage: Optional[str] = None,
        corrupt_acquire: bool = False,
    ) -> None:
        self.group = group
        self.spec = spec
        self._version = version
        self._fixture_file = Path(fixture_file) if fixture_file else None
        self._fail_stage = fail_stage
        self._corrupt_acquire = corrupt_acquire

    def discover_latest(self) -> SourceVersion:
        if self._fail_stage == "discover":
            raise SourceError("discover", "injected discovery failure")
        return self._version

    def acquire(self, version: SourceVersion, dest: Path) -> AcquiredFile:
        if self._fail_stage == "acquire":
            raise SourceError("acquire", "injected download failure")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if self._corrupt_acquire:
            dest.write_bytes(b"not a netcdf file")
        else:
            if not self._fixture_file or not self._fixture_file.is_file():
                raise SourceError("acquire", f"fixture file missing: {self._fixture_file}")
            shutil.copyfile(self._fixture_file, dest)
        return self._finalise(version, dest)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _iso_date(iso: str) -> str:
    """``2026-07-30T00:00:00Z`` -> ``2026-07-30`` (ERDDAP griddap accepts a bare date)."""
    return (iso or "").split("T", 1)[0]


def _shift_iso_days(iso: str, days: int) -> Optional[str]:
    d = _iso_date(iso)
    try:
        base = datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (base + timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")


def default_sources(
    *, erddap_url: Optional[str] = None, thredds_url: Optional[str] = None
) -> dict[str, DatasetSource]:
    return {
        GROUP_TEMPERATURE_SALINITY: ErddapArgoSource(erddap_url),
        GROUP_CURRENTS: ThreddsCurrentsSource(thredds_url),
    }
