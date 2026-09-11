"""D14 -- the update manifest / state file.

A single small JSON file (default ``data/update-state/manifest.json``) that
records, per logical dataset:

* what source version is **installed** (source id, source-time coverage, raw
  SHA-256, generated ``.bnx`` SHA-256, acquisition time, publish time),
* what the **latest checked** source version was, and whether it was newer,
* the **last update** attempt's status and (on failure) a short reason.

It is NOT a database. No secrets, no credentials, no absolute machine paths.
Every write is atomic (temp file + ``os.replace``). Three timestamps are kept
deliberately distinct (D14 §11):

* ``source_time_*``   -- the time the *science* represents,
* ``acquired_at``     -- when the raw file was downloaded from INCOIS,
* ``published_at``    -- when this ``.bnx`` artifact was generated & published.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..ingestion.netcdf_ingestor import sha256_of
from .sources import AcquiredFile, SourceVersion, baseline_acquired_at, logical_dataset_id

MANIFEST_SCHEMA = "bluenexus.update-manifest/1"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_manifest_path(project_root: Path) -> Path:
    return project_root / "data" / "update-state" / "manifest.json"


class ManifestStore:
    """Read / atomically write the update manifest."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    # -- io ---------------------------------------------------------------
    def load(self) -> dict:
        if not self.path.is_file():
            return {"schema": MANIFEST_SCHEMA, "datasets": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return {"schema": MANIFEST_SCHEMA, "datasets": {}}
        data.setdefault("schema", MANIFEST_SCHEMA)
        data.setdefault("datasets", {})
        return data

    def save(self, data: dict) -> Path:
        data["schema"] = MANIFEST_SCHEMA
        data["updated_at"] = _utc_now_iso()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(
            json.dumps(data, indent=2, sort_keys=True, ensure_ascii=True), encoding="utf-8"
        )
        os.replace(tmp, self.path)  # atomic
        return self.path

    # -- per-dataset read ----------------------------------------------
    def dataset(self, group: str) -> Optional[dict]:
        return self.load().get("datasets", {}).get(group)

    def installed_version_id(self, group: str) -> Optional[str]:
        entry = self.dataset(group)
        if entry:
            return (entry.get("installed") or {}).get("source_version")
        return None

    # -- baseline (before any D14 update) ----------------------------
    def ensure_baseline(self, group: str, bnx_reader) -> dict:
        """If this group has no manifest entry, synthesise one from the installed
        ``.bnx`` (its provenance + generation stamp) so freshness is always
        answerable. Returns the (possibly new) entry."""
        data = self.load()
        datasets = data.setdefault("datasets", {})
        if group in datasets:
            return datasets[group]

        c = bnx_reader.contract
        md, prov = c["metadata"], c["provenance"]
        tc = md.get("time_coverage", {})
        gen = bnx_reader.generation
        try:
            artifact_sha = sha256_of(bnx_reader.path)
        except OSError:
            artifact_sha = None
        entry = {
            "logical_dataset_id": logical_dataset_id(group),
            "product_type": c["product_type"],
            "source": {
                "name": md["source"].get("name"),
                "url": md["source"].get("url"),
                "dataset_id": md["source"].get("dataset_id"),
            },
            "installed": {
                "source_version": _baseline_version_id(group, c),
                "source_identifier": prov.get("source_dataset_id"),
                "source_time_start": tc.get("start_iso"),
                "source_time_end": tc.get("end_iso"),
                "source_file_sha256": prov.get("source_file_sha256"),
                "source_file_bytes": prov.get("source_file_bytes"),
                "artifact_sha256": artifact_sha,
                "artifact_contract_sha256": gen.get("contract_sha256"),
                "acquired_at": baseline_acquired_at(group),
                "published_at": gen.get("generated_at_utc"),
            },
            "latest_checked": None,
            "last_update": {"status": "baseline", "at": None, "error": None},
        }
        datasets[group] = entry
        self.save(data)
        return entry

    # -- record a --check ------------------------------------------
    def record_check(self, group: str, latest: SourceVersion, newer: bool) -> None:
        data = self.load()
        entry = data.setdefault("datasets", {}).setdefault(group, {})
        entry["latest_checked"] = {
            "source_version": latest.version_id,
            "source_identifier": latest.source_identifier,
            "source_time_start": latest.source_time_start_iso,
            "source_time_end": latest.source_time_end_iso,
            "remote_last_modified": latest.remote_last_modified,
            "checked_at": latest.discovered_at,
            "newer_available": bool(newer),
        }
        self.save(data)

    # -- record a successful publish (only AFTER atomic publish, D14 §13) --
    def record_success(
        self,
        group: str,
        acquired: AcquiredFile,
        *,
        artifact_sha256: str,
        artifact_contract_sha256: str,
        published_time_coverage: tuple[Optional[str], Optional[str]],
    ) -> None:
        data = self.load()
        entry = data.setdefault("datasets", {}).setdefault(group, {})
        v = acquired.version
        entry["logical_dataset_id"] = logical_dataset_id(group)
        entry["source"] = {
            "name": v.source_name,
            "url": v.source_url,
            "dataset_id": v.source_identifier,
        }
        entry["installed"] = {
            "source_version": v.version_id,
            "source_identifier": v.source_identifier,
            "source_time_start": published_time_coverage[0] or v.source_time_start_iso,
            "source_time_end": published_time_coverage[1] or v.source_time_end_iso,
            "remote_last_modified": v.remote_last_modified,
            "source_file_sha256": acquired.sha256,
            "source_file_bytes": acquired.size_bytes,
            "artifact_sha256": artifact_sha256,
            "artifact_contract_sha256": artifact_contract_sha256,
            "acquired_at": acquired.acquired_at,
            "published_at": _utc_now_iso(),
        }
        entry["latest_checked"] = {
            "source_version": v.version_id,
            "checked_at": v.discovered_at,
            "newer_available": False,
        }
        entry["last_update"] = {"status": "success", "at": _utc_now_iso(), "error": None}
        self.save(data)

    def record_no_update(self, group: str, latest: SourceVersion) -> None:
        data = self.load()
        entry = data.setdefault("datasets", {}).setdefault(group, {})
        entry["last_update"] = {
            "status": "up-to-date",
            "at": _utc_now_iso(),
            "error": None,
        }
        self.save(data)

    def record_failure(self, group: str, stage: str, message: str) -> None:
        data = self.load()
        entry = data.setdefault("datasets", {}).setdefault(group, {})
        entry["last_update"] = {
            "status": "failed",
            "at": _utc_now_iso(),
            "error": {"stage": stage, "message": message[:500]},
        }
        self.save(data)


def _baseline_version_id(group: str, contract: dict) -> Optional[str]:
    """The version id equivalent to what a fresh ``discover_latest`` would return
    for the installed artifact: the newest analysis timestamp, or the currents
    source filename."""
    if group == "currents":
        return contract["provenance"].get("source_dataset_id")
    return contract["metadata"].get("time_coverage", {}).get("end_iso")
