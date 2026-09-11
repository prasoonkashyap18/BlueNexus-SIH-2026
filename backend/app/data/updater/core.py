"""D14 -- the controlled update pipeline & atomic publisher.

Reuses the existing D7 -> D8 -> D9 code path **unchanged** (no logic is
duplicated, no scientific transformation is added):

    staged raw NetCDF
      -> ingestion.ingest_dataset(spec')      (D7, read-only, schema-checked)
      -> processing.process_dataset(...)      (D8, missing/quality canonical)
      -> bluenexus.convert_to_bluenexus(...)  (D9, .bnx contract)
      -> write_bluenexus(<target>.bnx.updating)
      -> verify the artifact is a readable .bnx with the right identity/shape
      -> os.replace(<target>.bnx.updating, <target>.bnx)     (ATOMIC)
      -> manifest.record_success(...)

If **any** stage raises, the installed ``.bnx`` is left exactly as it was, the
temp file is removed, and the failure is recorded. The two dataset groups are
independent: one can update while the other fails or stays put (D14 §25).
"""

from __future__ import annotations

import dataclasses
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..bluenexus import BnxReader, contract_sha256, convert_to_bluenexus, write_bluenexus
from ..ingestion import DatasetSpec, ingest_dataset, project_root, sha256_of
from ..ingestion.validation import SchemaError
from ..processing import process_dataset
from .manifest import ManifestStore, default_manifest_path
from .sources import (
    ALL_GROUPS,
    AcquiredFile,
    DatasetSource,
    SourceError,
    SourceVersion,
    default_sources,
    logical_dataset_id,
)

_TMP_SUFFIX = ".updating"


class UpdateError(RuntimeError):
    """A controlled failure at a named update stage. The installed data is safe."""

    def __init__(self, stage: str, message: str) -> None:
        self.stage = stage
        super().__init__(f"[{stage}] {message}")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# results
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CheckResult:
    group: str
    logical_dataset_id: str
    source_name: str
    installed_version: Optional[str]
    latest_version: Optional[str]
    newer_available: bool
    source_time_end: Optional[str] = None
    remote_last_modified: Optional[str] = None
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass(frozen=True)
class UpdateResult:
    group: str
    logical_dataset_id: str
    #: "up-to-date" | "updated" | "failed"
    action: str
    from_version: Optional[str] = None
    to_version: Optional[str] = None
    artifact_sha256: Optional[str] = None
    stage_failed: Optional[str] = None
    error: Optional[str] = None
    messages: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return self.action != "failed"


# ---------------------------------------------------------------------------
# pipeline steps (each raises UpdateError on its own stage)
# ---------------------------------------------------------------------------
def run_d7_d8_d9(spec: DatasetSpec, raw_path: Path, *, source_identifier: Optional[str] = None):
    """Run the acquired raw file through the real D7/D8/D9 pipeline.

    A frozen copy of the registry spec is used with ``filename`` pointed at the
    staged file and (when given) ``dataset_id`` set to the acquired source's own
    identifier so the ``.bnx`` provenance names the file this artifact actually
    came from. Every other field -- the stable BlueNexus dataset ``name``, axis
    roles, unit interpretation, the parameter registry -- is the D4-established
    configuration, untouched.
    """
    overrides: dict = {"filename": str(Path(raw_path).resolve())}
    if source_identifier:
        overrides["dataset_id"] = source_identifier
    staged_spec = dataclasses.replace(spec, **overrides)

    try:
        ingested = ingest_dataset(staged_spec, run_schema_checks=True)  # D7
    except SchemaError as exc:
        raise UpdateError("ingest", str(exc)) from None
    except (OSError, ValueError) as exc:
        raise UpdateError("ingest", f"could not ingest staged file: {exc}") from None

    try:
        cleaned = process_dataset(ingested, staged_spec)  # D8
    except (OSError, ValueError, KeyError) as exc:
        raise UpdateError("process", f"D8 processing failed: {exc}") from None

    try:
        ds = convert_to_bluenexus(cleaned)  # D9
    except (ValueError, KeyError) as exc:
        raise UpdateError("convert", f"D9 conversion failed: {exc}") from None

    return ds, cleaned


def verify_artifact(tmp_path: Path, *, expected_dataset_id: str) -> dict:
    """Minimal pre-publication safety checks (D14 §23) -- NOT D15 validation.

    file exists / is a readable ``.bnx`` / dataset id matches / declared
    parameters exist / dimensions are non-zero / one slice actually reads /
    artifact hash computable.
    """
    if not tmp_path.is_file() or tmp_path.stat().st_size == 0:
        raise UpdateError("verify-artifact", "generated .bnx is missing or empty")
    try:
        reader = BnxReader(tmp_path)
    except (OSError, ValueError) as exc:
        raise UpdateError("verify-artifact", f"generated .bnx is not readable: {exc}") from None

    if reader.dataset_id != expected_dataset_id:
        raise UpdateError(
            "verify-artifact",
            f"dataset id mismatch: got {reader.dataset_id!r}, expected {expected_dataset_id!r}",
        )

    param_ids = reader.parameter_ids()
    if not param_ids:
        raise UpdateError("verify-artifact", "artifact declares no parameters")

    contract = reader.contract
    for role in ("latitude", "longitude"):
        if role not in contract.get("coordinates", {}):
            raise UpdateError("verify-artifact", f"artifact has no {role} coordinate")

    for pid in param_ids:
        shape = reader.shape(pid)
        if not shape or any(int(n) <= 0 for n in shape):
            raise UpdateError("verify-artifact", f"parameter {pid!r} has a zero dimension: {shape}")
        try:
            reader.slice(pid, time_index=0, depth_index=0)  # proves a real partial read works
        except (OSError, ValueError, IndexError, KeyError) as exc:
            raise UpdateError("verify-artifact", f"parameter {pid!r} slice unreadable: {exc}") from None

    tc = contract["metadata"].get("time_coverage", {})
    return {
        "sha256": sha256_of(tmp_path),
        "contract_sha256": reader.generation.get("contract_sha256"),
        "parameter_ids": param_ids,
        "time_start": tc.get("start_iso"),
        "time_end": tc.get("end_iso"),
        "shapes": {pid: list(reader.shape(pid)) for pid in param_ids},
    }


def atomic_publish(tmp_path: Path, target_path: Path) -> None:
    """Replace the installed artifact with the verified temp file in one step.

    ``os.replace`` is atomic within a filesystem on both POSIX and Windows: a
    reader either sees the whole old file or the whole new file, never a
    partially written one (D14 §9).
    """
    if not tmp_path.is_file():
        raise UpdateError("publish", "temp artifact vanished before publish")
    try:
        os.replace(tmp_path, target_path)
    except OSError as exc:
        raise UpdateError("publish", f"atomic replace failed: {exc}") from None


# ---------------------------------------------------------------------------
# orchestrator
# ---------------------------------------------------------------------------
class Updater:
    """Controlled check / update over the logical BlueNexus datasets."""

    def __init__(
        self,
        sources: dict[str, DatasetSource],
        *,
        bnx_dir: Optional[Path] = None,
        staging_dir: Optional[Path] = None,
        manifest: Optional[ManifestStore] = None,
    ) -> None:
        root = project_root()
        self.sources = sources
        self.bnx_dir = Path(bnx_dir) if bnx_dir else root / "data" / "bluenexus"
        self.staging_dir = (
            Path(staging_dir) if staging_dir else root / "data" / "update-state" / "staging"
        )
        self.manifest = manifest or ManifestStore(default_manifest_path(root))

    # -- helpers ------------------------------------------------------
    def _target_bnx(self, group: str) -> Path:
        return self.bnx_dir / f"{logical_dataset_id(group)}.bnx"

    def _installed_version(self, group: str) -> Optional[str]:
        # Prefer the manifest; fall back to reading the installed .bnx directly.
        target = self._target_bnx(group)
        if target.is_file():
            try:
                self.manifest.ensure_baseline(group, BnxReader(target))
            except (OSError, ValueError):
                pass
        return self.manifest.installed_version_id(group)

    # -- CHECK (no download, no write to any .bnx) -------------------
    def check(self, groups: Optional[list[str]] = None) -> list[CheckResult]:
        out: list[CheckResult] = []
        for group in groups or list(ALL_GROUPS):
            src = self.sources[group]
            installed = self._installed_version(group)
            try:
                latest = src.discover_latest()
            except SourceError as exc:
                out.append(
                    CheckResult(
                        group=group,
                        logical_dataset_id=logical_dataset_id(group),
                        source_name=src.spec.source_name,
                        installed_version=installed,
                        latest_version=None,
                        newer_available=False,
                        error=str(exc),
                    )
                )
                continue
            newer = latest.is_newer_than(installed)
            self.manifest.record_check(group, latest, newer)
            out.append(
                CheckResult(
                    group=group,
                    logical_dataset_id=logical_dataset_id(group),
                    source_name=latest.source_name,
                    installed_version=installed,
                    latest_version=latest.version_id,
                    newer_available=newer,
                    source_time_end=latest.source_time_end_iso,
                    remote_last_modified=latest.remote_last_modified,
                )
            )
        return out

    # -- UPDATE (controlled; per-group; atomic; fail-safe) ----------
    def update(self, groups: Optional[list[str]] = None) -> list[UpdateResult]:
        out: list[UpdateResult] = []
        for group in groups or list(ALL_GROUPS):
            out.append(self._update_one(group))
        return out

    def _update_one(self, group: str) -> UpdateResult:
        src = self.sources[group]
        did = logical_dataset_id(group)
        installed = self._installed_version(group)
        messages: list[str] = []

        # 1. CHECK
        try:
            latest = src.discover_latest()
        except SourceError as exc:
            self.manifest.record_failure(group, exc.stage, str(exc))
            return UpdateResult(group, did, "failed", installed, None,
                                stage_failed=exc.stage, error=str(exc))

        if not latest.is_newer_than(installed):
            self.manifest.record_check(group, latest, False)
            self.manifest.record_no_update(group, latest)
            return UpdateResult(group, did, "up-to-date", installed, latest.version_id,
                                messages=("source is not newer than the installed artifact",))
        self.manifest.record_check(group, latest, True)
        messages.append(f"newer source: {latest.version_id} (installed: {installed})")

        staged = self.staging_dir / f"{group}.staged.nc"
        tmp_bnx = self._target_bnx(group).with_suffix(".bnx" + _TMP_SUFFIX)
        target_bnx = self._target_bnx(group)

        try:
            # 2. ACQUIRE (+ verify acquisition) -- only the required subset
            acquired = src.acquire(latest, staged)
            messages.append(
                f"acquired {acquired.size_bytes:,} B ({acquired.file_format}), "
                f"sha256 {acquired.sha256[:12]}"
            )

            # 3-5. D7 -> D8 -> D9 (existing pipeline, unchanged)
            ds, _cleaned = run_d7_d8_d9(
                src.spec, staged, source_identifier=latest.source_identifier
            )
            if ds.dataset_id != did:
                raise UpdateError("convert", f"pipeline produced dataset id {ds.dataset_id!r}")

            # 6. write the artifact to a TEMP path (never the live file)
            if tmp_bnx.exists():
                tmp_bnx.unlink()
            write_bluenexus(ds, tmp_bnx)

            # 7. verify the generated artifact before it can replace anything
            info = verify_artifact(tmp_bnx, expected_dataset_id=did)
            messages.append(
                f"artifact verified: {len(info['parameter_ids'])} parameters, "
                f"sha256 {info['sha256'][:12]}"
            )

            # 8. ATOMIC PUBLISH
            atomic_publish(tmp_bnx, target_bnx)
            messages.append(f"published -> {target_bnx.name} (atomic)")

            # 9. manifest -- only AFTER a successful publish
            self.manifest.record_success(
                group,
                acquired,
                artifact_sha256=info["sha256"],
                artifact_contract_sha256=contract_sha256(ds),
                published_time_coverage=(info["time_start"], info["time_end"]),
            )
            return UpdateResult(
                group, did, "updated", installed, latest.version_id,
                artifact_sha256=info["sha256"], messages=tuple(messages),
            )

        except (UpdateError, SourceError) as exc:
            stage = getattr(exc, "stage", "update")
            self.manifest.record_failure(group, stage, str(exc))
            return UpdateResult(
                group, did, "failed", installed, latest.version_id,
                stage_failed=stage, error=str(exc), messages=tuple(messages),
            )
        finally:
            # the live .bnx is never touched on failure; clean the temp artifact
            try:
                if tmp_bnx.exists():
                    tmp_bnx.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# convenience constructor for the live path
# ---------------------------------------------------------------------------
def make_updater(
    *, erddap_url: Optional[str] = None, thredds_url: Optional[str] = None
) -> Updater:
    return Updater(default_sources(erddap_url=erddap_url, thredds_url=thredds_url))
