"""Service layer for the in-situ observation data (Argo floats + gliders).

Sits between the HTTP routes and ``app.data.observations``, exactly as
``app.services.catalog.BlueNexusCatalog`` does for the gridded datasets. Routes
never open the CSV or parse rows themselves.

Both paths are deliberately additive and separate: they do not touch the
BlueNexus catalog, the model grid, or the temperature/salinity/current
datasets. The Argo and glider catalogs are independent of each other -- glider
data is never served from the Argo catalog or vice versa.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional

from ..api.errors import (
    DataUnavailableError,
    MalformedRequestError,
    UnknownArgoPlatformError,
    UnknownGliderDeploymentError,
)
from ..data.observations import (
    ARGO_DATASET_ID,
    GLIDER_DATASET_ID,
    ArgoProfileNotFoundError,
    ArgoProfilesReader,
    GliderDeploymentNotFoundError,
    GliderTrajectoriesReader,
)
from ..data.observations.argo import PLATFORM_ID_RE, UNITS as ARGO_UNITS
from ..data.observations.glider import (
    PLATFORM_ID_RE as GLIDER_PLATFORM_ID_RE,
    UNITS as GLIDER_UNITS,
)


class ArgoObservationCatalog:
    """Loads the Argo snapshot once at startup; answers list / detail queries."""

    def __init__(self, csv_path: Optional[Path] = None) -> None:
        self._csv_path = csv_path
        self._lock = threading.Lock()
        self._reader: Optional[ArgoProfilesReader] = None
        self._error: Optional[str] = None

    # -- lifecycle ----------------------------------------------------
    def load(self) -> None:
        with self._lock:
            self._reader = None
            self._error = None
            try:
                self._reader = ArgoProfilesReader(self._csv_path).load()
            except Exception as exc:  # missing / malformed raw file
                self._error = f"{type(exc).__name__}: {exc}"

    def _require_reader(self) -> ArgoProfilesReader:
        if self._reader is None:
            raise DataUnavailableError(
                "Argo observation snapshot is not loaded",
                {"reason": self._error or "not initialised"},
            )
        return self._reader

    # -- queries ----------------------------------------------------
    def list_platforms(self) -> dict:
        reader = self._require_reader()
        summaries = reader.summaries()
        return {
            "dataset_id": ARGO_DATASET_ID,
            "count": len(summaries),
            "units": dict(ARGO_UNITS),
            "platform_type": "argo",
            "note": (
                "One entry per real Argo float profile (ascent cycle) from the "
                "INCOIS ERDDAP Indian_ARGO_Floats snapshot. Point/profile data - "
                "not on the model grid."
            ),
            "provenance": reader.provenance(),
            "platforms": summaries,
        }

    def get_platform(self, platform_id: str) -> dict:
        reader = self._require_reader()
        if not isinstance(platform_id, str) or not PLATFORM_ID_RE.match(platform_id):
            raise MalformedRequestError(
                f"invalid Argo platform id {platform_id!r}",
                {"expected": "<platform_number>_<cycle_number>, digits only"},
            )
        try:
            return reader.detail(platform_id)
        except ArgoProfileNotFoundError:
            raise UnknownArgoPlatformError(
                f"no Argo profile {platform_id!r} in the snapshot",
                {"known_platform_ids": reader.platform_ids()},
            ) from None

    def observed_temperature_profile(self, platform_id: str) -> dict:
        """Step 44: comparison-ready observed *temperature* profile for one real
        Argo profile. Same id validation / 404 as :meth:`get_platform`; the
        payload is native ``pressure_dbar`` + real temperature, ascending
        pressure, QC preserved. No model, no difference."""
        reader = self._require_reader()
        if not isinstance(platform_id, str) or not PLATFORM_ID_RE.match(platform_id):
            raise MalformedRequestError(
                f"invalid Argo platform id {platform_id!r}",
                {"expected": "<platform_number>_<cycle_number>, digits only"},
            )
        try:
            return reader.observed_temperature_profile(platform_id)
        except ArgoProfileNotFoundError:
            raise UnknownArgoPlatformError(
                f"no Argo profile {platform_id!r} in the snapshot",
                {"known_platform_ids": reader.platform_ids()},
            ) from None

    # -- health ---------------------------------------------------
    def health(self) -> dict:
        if self._reader is None:
            return {"available": False, "error": self._error}
        return {"available": True, **self._reader.health()}


class GliderObservationCatalog:
    """Loads the glider snapshot once at startup; answers list / detail queries.

    Same shape as :class:`ArgoObservationCatalog` (Step 28). A glider "platform"
    is one **deployment**; its detail carries the ordered trajectory samples.
    """

    def __init__(self, csv_path: Optional[Path] = None) -> None:
        self._csv_path = csv_path
        self._lock = threading.Lock()
        self._reader: Optional[GliderTrajectoriesReader] = None
        self._error: Optional[str] = None

    def load(self) -> None:
        with self._lock:
            self._reader = None
            self._error = None
            try:
                self._reader = GliderTrajectoriesReader(self._csv_path).load()
            except Exception as exc:  # missing / malformed raw file
                self._error = f"{type(exc).__name__}: {exc}"

    def _require_reader(self) -> GliderTrajectoriesReader:
        if self._reader is None:
            raise DataUnavailableError(
                "glider observation snapshot is not loaded",
                {"reason": self._error or "not initialised"},
            )
        return self._reader

    def list_platforms(self) -> dict:
        reader = self._require_reader()
        summaries = reader.summaries()
        return {
            "dataset_id": GLIDER_DATASET_ID,
            "count": len(summaries),
            "units": dict(GLIDER_UNITS),
            "platform_type": "glider",
            "note": (
                "One entry per real underwater-glider deployment from the EGO / "
                "OceanGliders GDAC (OceanGlidersGDACTrajectories) snapshot. "
                "Trajectory/point data - not on the model grid, and not Argo."
            ),
            "provenance": reader.provenance(),
            "platforms": summaries,
        }

    def get_platform(self, platform_id: str) -> dict:
        reader = self._require_reader()
        if not isinstance(platform_id, str) or not GLIDER_PLATFORM_ID_RE.match(platform_id):
            raise MalformedRequestError(
                f"invalid glider platform id {platform_id!r}",
                {"expected": "a deployment id, e.g. sea057_20220707"},
            )
        try:
            return reader.detail(platform_id)
        except GliderDeploymentNotFoundError:
            raise UnknownGliderDeploymentError(
                f"no glider deployment {platform_id!r} in the snapshot",
                {"known_platform_ids": reader.platform_ids()},
            ) from None

    def health(self) -> dict:
        if self._reader is None:
            return {"available": False, "error": self._error}
        return {"available": True, **self._reader.health()}


# -- module singletons (mirror app.services.catalog) --------------------
_argo_catalog: Optional[ArgoObservationCatalog] = None
_glider_catalog: Optional[GliderObservationCatalog] = None


def get_argo_catalog() -> ArgoObservationCatalog:
    if _argo_catalog is None:
        raise DataUnavailableError("Argo observation catalog not initialised")
    return _argo_catalog


def init_argo_catalog(csv_path: Optional[Path] = None) -> ArgoObservationCatalog:
    global _argo_catalog
    _argo_catalog = ArgoObservationCatalog(csv_path)
    _argo_catalog.load()
    return _argo_catalog


def get_glider_catalog() -> GliderObservationCatalog:
    if _glider_catalog is None:
        raise DataUnavailableError("glider observation catalog not initialised")
    return _glider_catalog


def init_glider_catalog(csv_path: Optional[Path] = None) -> GliderObservationCatalog:
    global _glider_catalog
    _glider_catalog = GliderObservationCatalog(csv_path)
    _glider_catalog.load()
    return _glider_catalog
