"""BlueNexus catalog -- the only thing D10 routes talk to.

Responsibilities:

* discover the D9 ``*.bnx`` files in the configured data directory,
* (optionally) build a dataset's ``.bnx`` from D9 if it is missing -- via the
  D9 API (``convert_*`` + ``write_bluenexus``), never by reading raw NetCDF from
  a route,
* keep a light ``BnxReader`` per dataset (manifest only; no bulk arrays),
* resolve ``dataset_id`` / ``parameter_id`` **only** against this in-memory
  registry -- they are never turned into filesystem paths,
* validate parameter/dataset compatibility and time/depth indices,
* answer catalog / detail / parameter / coordinate / slice queries.

All data access goes through the D9 ``.bnx`` format. The raw NetCDF files are
never opened here.
"""

from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Optional

from ..api.config import ApiConfig
from ..api.errors import (
    DataUnavailableError,
    InvalidIndexError,
    ParameterNotInDatasetError,
    UnknownDatasetError,
    UnknownParameterError,
)
from ..data.bluenexus import BnxReader, ParameterSpec, convert_all, write_bluenexus
from ..data.bluenexus.parameters import ALL_PARAMETERS

# dataset_id / parameter_id must look like a canonical slug -- defence in depth
# on top of "only ever used as a dict key, never as a path".
_SLUG = re.compile(r"^[a-z0-9][a-z0-9_]{0,63}$")

# The datasets D10 is allowed to serve, and which D9 converter builds each.
_KNOWN_DATASETS = ("incois_argo_10day_analysis", "incois_io_hoofs_surface_currents")

# D14: the controlled-update manifest, keyed by logical update group.
_UPDATE_GROUP_BY_DATASET_ID = {
    "incois_argo_10day_analysis": "temperature-salinity",
    "incois_io_hoofs_surface_currents": "currents",
}
_FRESHNESS_LABEL = {
    "analysis": "Latest available INCOIS analysis",
    "forecast": "Latest INCOIS IO-HOOFS forecast",
}


def _project_root_from(data_dir: Path) -> Path:
    """`<repo>/data/bluenexus` -> `<repo>`; tolerant of a custom data dir."""
    p = data_dir.resolve()
    if p.name == "bluenexus" and p.parent.name == "data":
        return p.parent.parent
    return p.parent


class BlueNexusCatalog:
    def __init__(self, config: ApiConfig) -> None:
        self._config = config
        self._lock = threading.Lock()
        self._readers: dict[str, BnxReader] = {}
        self._errors: dict[str, str] = {}

    # -- lifecycle --------------------------------------------------
    def load(self) -> None:
        """Discover ``.bnx`` files; build missing ones from D9 when configured."""
        with self._lock:
            self._readers.clear()
            self._errors.clear()
            data_dir = self._config.data_dir

            if self._config.build_on_startup:
                self._build_missing(data_dir)

            if not data_dir.is_dir():
                return
            for path in sorted(data_dir.glob("*.bnx")):
                try:
                    reader = BnxReader(path)
                    self._readers[reader.dataset_id] = reader
                except Exception as exc:  # corrupt / truncated container
                    self._errors[path.name] = f"{type(exc).__name__}: {exc}"

    def _build_missing(self, data_dir: Path) -> None:
        existing_ids: set[str] = set()
        if data_dir.is_dir():
            for path in data_dir.glob("*.bnx"):
                try:
                    existing_ids.add(BnxReader(path).dataset_id)
                except Exception:
                    pass
        missing = [d for d in _KNOWN_DATASETS if d not in existing_ids]
        if not missing:
            return
        try:
            built = convert_all()   # D9: raw -> D7 -> D8 -> D9 (build time only)
        except Exception as exc:
            self._errors["_build"] = f"D9 convert_all failed: {type(exc).__name__}: {exc}"
            return
        for dataset_id in missing:
            ds = built.get(dataset_id)
            if ds is None:
                continue
            try:
                write_bluenexus(ds, data_dir / f"{dataset_id}.bnx")
            except Exception as exc:
                self._errors[dataset_id] = f"write failed: {type(exc).__name__}: {exc}"

    # -- id resolution (safe) -------------------------------------
    def _reader(self, dataset_id: str) -> BnxReader:
        if not isinstance(dataset_id, str) or not _SLUG.match(dataset_id):
            raise UnknownDatasetError(
                f"unknown dataset {dataset_id!r}",
                {"known_datasets": self.dataset_ids()},
            )
        reader = self._readers.get(dataset_id)
        if reader is None:
            raise UnknownDatasetError(
                f"unknown dataset {dataset_id!r}",
                {"known_datasets": self.dataset_ids()},
            )
        return reader

    # -- discovery ------------------------------------------------
    def dataset_ids(self) -> list[str]:
        return sorted(self._readers)

    def is_empty(self) -> bool:
        return not self._readers

    def load_errors(self) -> dict[str, str]:
        return dict(self._errors)

    def dataset_summary(self, dataset_id: str) -> dict:
        r = self._reader(dataset_id)
        c = r.contract
        md = c["metadata"]
        return {
            "dataset_id": c["dataset_id"],
            "title": c["title"],
            "product_type": c["product_type"],
            "data_status": md["data_status"],
            "schema_version": c["schema_version"],
            "parameter_ids": list(md["parameter_ids"]),
            "dimensions": [
                {"name": d["name"], "role": d["role"], "size": d["size"]}
                for d in c["dimensions"]
            ],
            "shape_by_parameter": {
                pid: list(p["shape"]) for pid, p in c["parameters"].items()
            },
            "time_coverage": md["time_coverage"],
            "depth_coverage": md["depth_coverage"],
            "latitude_coverage": md["latitude_coverage"],
            "longitude_coverage": md["longitude_coverage"],
            "source": md["source"],
            "temporal_semantics": md["temporal_semantics"],
            "provenance_summary": self._provenance_summary(c["provenance"]),
            "freshness": self._freshness(r),
        }

    # -- D14 freshness ------------------------------------------------
    def _manifest_path(self) -> Path:
        return (
            _project_root_from(self._config.data_dir)
            / "data"
            / "update-state"
            / "manifest.json"
        )

    def _read_manifest_entry(self, dataset_id: str) -> Optional[dict]:
        group = _UPDATE_GROUP_BY_DATASET_ID.get(dataset_id)
        if group is None:
            return None
        path = self._manifest_path()
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return (data.get("datasets") or {}).get(group)

    def _freshness(self, reader: "BnxReader") -> dict:
        """Additive, read-only freshness view for the frontend (D14 §17, §20).

        Never a "real-time" / "live" claim: analysis products report the latest
        available analysis, the forecast reports the latest IO-HOOFS forecast.
        No absolute paths, no secrets -- source url/id, ISO times and hashes only.
        The three times stay distinct: source time (science) vs acquired_at
        (download) vs published_at (artifact generation).
        """
        c = reader.contract
        md, prov = c["metadata"], c["provenance"]
        tc = md.get("time_coverage", {})
        gen = reader.generation
        product_type = c["product_type"]

        out = {
            "product_type": product_type,
            "freshness_label": _FRESHNESS_LABEL.get(product_type, "Latest available INCOIS data"),
            "is_real_time": False,
            "source_name": md["source"].get("name"),
            "source_url": md["source"].get("url"),
            "source_dataset_id": prov.get("source_dataset_id"),
            "source_time_start": tc.get("start_iso"),
            "source_time_end": tc.get("end_iso"),
            "source_file_sha256": prov.get("source_file_sha256"),
            "artifact_contract_sha256": gen.get("contract_sha256"),
            "published_at": gen.get("generated_at_utc"),
            "acquired_at": None,
            "last_checked_at": None,
            "newer_source_available": None,
            "update_status": "baseline",
        }

        entry = self._read_manifest_entry(reader.dataset_id)
        if entry:
            installed = entry.get("installed") or {}
            checked = entry.get("latest_checked") or {}
            last = entry.get("last_update") or {}
            out.update(
                {
                    "source_version": installed.get("source_version"),
                    "acquired_at": installed.get("acquired_at"),
                    "published_at": installed.get("published_at") or out["published_at"],
                    "artifact_sha256": installed.get("artifact_sha256"),
                    "source_file_sha256": installed.get("source_file_sha256")
                    or out["source_file_sha256"],
                    "last_checked_at": checked.get("checked_at"),
                    "latest_available_version": checked.get("source_version"),
                    "newer_source_available": checked.get("newer_available"),
                    "update_status": last.get("status") or "baseline",
                }
            )
        return out

    def list_summaries(self) -> list[dict]:
        return [self.dataset_summary(d) for d in self.dataset_ids()]

    def dataset_detail(self, dataset_id: str) -> dict:
        r = self._reader(dataset_id)
        c = r.contract
        return {
            "schema_version": c["schema_version"],
            "dataset_id": c["dataset_id"],
            "title": c["title"],
            "product_type": c["product_type"],
            "dimensions": c["dimensions"],
            "coordinates": c["coordinates"],
            "parameters": c["parameters"],
            "metadata": c["metadata"],
            "provenance": self._client_provenance(c["provenance"]),
            "generation": {
                k: r.generation.get(k)
                for k in ("generator", "contract_sha256", "byte_order")
            },
            "freshness": self._freshness(r),
        }

    def parameters(self, dataset_id: str) -> dict:
        r = self._reader(dataset_id)
        c = r.contract
        registry = {p.parameter_id: p for p in ALL_PARAMETERS}
        out = []
        for pid, p in c["parameters"].items():
            spec: Optional[ParameterSpec] = registry.get(pid)
            out.append(
                {
                    **p,
                    "canonical_id": pid,
                    "accepts_aliases": False,
                    "registered": spec is not None,
                }
            )
        return {
            "dataset_id": dataset_id,
            "canonical_parameter_ids": list(c["metadata"]["parameter_ids"]),
            "note": (
                "Only canonical ids are accepted by the API. Aliases such as "
                "'temp', 'sst', 'salt', 'current', 'velocity' are display-only "
                "and are rejected as lookup keys."
            ),
            "parameters": out,
        }

    def coordinates(self, dataset_id: str) -> dict:
        r = self._reader(dataset_id)
        c = r.contract
        return {
            "dataset_id": dataset_id,
            "coordinates": c["coordinates"],   # exact D9 arrays, untouched
        }

    # -- the slice endpoint --------------------------------------
    def slice(
        self,
        dataset_id: str,
        parameter_id: str,
        *,
        time_index: int,
        depth_index: int,
    ) -> dict:
        r = self._reader(dataset_id)
        c = r.contract

        if not isinstance(parameter_id, str) or not _SLUG.match(parameter_id):
            raise UnknownParameterError(
                f"unknown parameter {parameter_id!r}",
                {"canonical_parameter_ids": _all_canonical_ids()},
            )
        if parameter_id not in _all_canonical_ids():
            raise UnknownParameterError(
                f"unknown parameter {parameter_id!r}; not a canonical BlueNexus id",
                {"canonical_parameter_ids": _all_canonical_ids()},
            )
        if parameter_id not in c["parameters"]:
            raise ParameterNotInDatasetError(
                f"parameter {parameter_id!r} is not in dataset {dataset_id!r}",
                {
                    "dataset_id": dataset_id,
                    "available_parameters": list(c["metadata"]["parameter_ids"]),
                },
            )

        nt, nz, ny, nx = r.shape(parameter_id)
        if not (0 <= time_index < nt):
            raise InvalidIndexError(
                f"time_index {time_index} out of range",
                {"parameter": parameter_id, "valid_range": [0, nt - 1]},
            )
        if not (0 <= depth_index < nz):
            raise InvalidIndexError(
                f"depth_index {depth_index} out of range",
                {"parameter": parameter_id, "valid_range": [0, nz - 1]},
            )

        try:
            payload = r.slice(
                parameter_id, time_index=time_index, depth_index=depth_index
            )
        except (KeyError, IndexError) as exc:  # should not happen after checks above
            raise InvalidIndexError(str(exc)) from None
        except Exception as exc:
            raise DataUnavailableError(
                f"could not read slice for {dataset_id}/{parameter_id}",
                {"reason": f"{type(exc).__name__}"},
            ) from None

        pmeta = c["parameters"][parameter_id]
        payload["parameter_metadata"] = {
            "display_name": pmeta["display_name"],
            "kind": pmeta["kind"],
            "vector_group": pmeta["vector_group"],
            "vector_role": pmeta["vector_role"],
            "authoritative": pmeta["authoritative"],
            "surface_only": pmeta["surface_only"],
            "standard_name": pmeta["standard_name"],
            "long_name": pmeta["long_name"],
            "raw_units": pmeta["raw_units"],
        }
        payload["shape"] = {"latitude": ny, "longitude": nx}
        payload["bytes_read"] = r.last_bytes_read
        payload["provenance"] = self._client_provenance(c["provenance"])
        return payload

    # -- health -------------------------------------------------
    def health(self) -> dict:
        data_dir = self._config.data_dir
        found = sorted(p.name for p in data_dir.glob("*.bnx")) if data_dir.is_dir() else []
        return {
            "data_dir_exists": data_dir.is_dir(),
            "bnx_files_found": found,
            "datasets_loaded": self.dataset_ids(),
            "expected_datasets": list(_KNOWN_DATASETS),
            "all_expected_present": all(d in self._readers for d in _KNOWN_DATASETS),
            "load_errors": self.load_errors(),
        }

    # -- helpers -----------------------------------------------
    @staticmethod
    def _provenance_summary(prov: dict) -> dict:
        return {
            "source_name": prov["source_name"],
            "source_dataset_id": prov["source_dataset_id"],
            "product_pipeline": prov["pipeline_stages"][-1],
        }

    @staticmethod
    def _client_provenance(prov: dict) -> dict:
        """Client-facing provenance -- a logical source id instead of a raw path."""
        return {
            "source_name": prov["source_name"],
            "source_url": prov["source_url"],
            "source_dataset_id": prov["source_dataset_id"],
            "source_identifier": f"incois:{prov['source_dataset_id']}",
            "source_file_name": Path(prov["source_file"]).name,
            "source_file_sha256": prov["source_file_sha256"],
            "source_file_format": prov["source_file_format"],
            "conventions": prov["conventions"],
            "pipeline_stages": prov["pipeline_stages"],
            "original_units": prov["original_units"],
            "canonical_units": prov["canonical_units"],
        }


def _all_canonical_ids() -> list[str]:
    return sorted(p.parameter_id for p in ALL_PARAMETERS)


# -- module singleton wiring (used by the FastAPI app) ----------------
_catalog: Optional[BlueNexusCatalog] = None


def get_catalog() -> BlueNexusCatalog:
    if _catalog is None:
        raise DataUnavailableError("catalog not initialised")
    return _catalog


def init_catalog(config: ApiConfig) -> BlueNexusCatalog:
    global _catalog
    _catalog = BlueNexusCatalog(config)
    _catalog.load()
    return _catalog
