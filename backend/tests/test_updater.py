"""D14 -- controlled data updating tests (stdlib ``unittest``).

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_updater -v
    ./.venv/Scripts/python.exe -m unittest discover -s tests        # D7..D14

Determinism: every update-pipeline test uses a :class:`FixtureSource` and the
real D4 sample NetCDF files as the "newly acquired" bytes -- no network, no fake
scientific values. One test (``test_90_live_source_check``) hits the real INCOIS
services and is skipped automatically when they are unreachable.

Safety: the tests operate in a throwaway ``bnx_dir``; the real
``data/bluenexus/*.bnx`` is never written. ``test_29_*`` proves a ``--check``
and a failed update both leave the real installed artifact byte-identical.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.data.bluenexus import BnxReader, read_bluenexus  # noqa: E402
from app.data.ingestion import project_root, sha256_of  # noqa: E402
from app.data.ingestion.registry import SURFACE_CURRENTS, TEMPERATURE_SALINITY  # noqa: E402
from app.data.updater import (  # noqa: E402
    FixtureSource,
    ManifestStore,
    SourceVersion,
    Updater,
    run_d7_d8_d9,
)
from app.data.updater import sources as sources_mod  # noqa: E402
from app.data.updater.core import UpdateError  # noqa: E402
from app.data.updater.sources import (  # noqa: E402
    ErddapArgoSource,
    SourceError,
    ThreddsCurrentsSource,
)

ROOT = project_root()
FIXTURES = Path(__file__).resolve().parent / "fixtures"
CURRENTS_NC = ROOT / "data" / "raw" / "currents_incois_io-hoofs_sample.nc"
TS_NC = ROOT / "data" / "raw" / "temperature_salinity_incois_argo_sample.nc"
REAL_CURRENTS_BNX = ROOT / "data" / "bluenexus" / "incois_io_hoofs_surface_currents.bnx"
REAL_TS_BNX = ROOT / "data" / "bluenexus" / "incois_argo_10day_analysis.bnx"

CURRENTS_ID = "incois_io_hoofs_surface_currents"
ANALYSIS_ID = "incois_argo_10day_analysis"


def _newer_currents_version(version_id: str = "CURRENTS_IO_20260930.nc") -> SourceVersion:
    return SourceVersion(
        group="currents",
        version_id=version_id,
        source_name="INCOIS THREDDS (IO-HOOFS)",
        source_url="https://incois.gov.in/thredds/catalog/osf/currents/catalog.html",
        source_identifier=version_id,
        source_time_start_iso="2026-09-30T00:00:00Z",
        remote_last_modified="2026-10-01T06:00:00Z",
        remote_size_bytes=597_000_000,
    )


def _newer_analysis_version(end_iso: str = "2026-08-19T00:00:00Z") -> SourceVersion:
    return SourceVersion(
        group="temperature-salinity",
        version_id=end_iso,
        source_name="INCOIS ERDDAP",
        source_url="https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.html",
        source_identifier="incois_argo_10day_McCreary",
        source_time_start_iso="2026-07-30T00:00:00Z",
        source_time_end_iso=end_iso,
    )


class _UpdaterCase(unittest.TestCase):
    """Provides a throwaway updater whose installed baseline is the real .bnx."""

    def setUp(self) -> None:
        self._td = TemporaryDirectory()
        self.tmp = Path(self._td.name)
        self.bnx_dir = self.tmp / "bluenexus"
        self.bnx_dir.mkdir()
        self.manifest_path = self.tmp / "manifest.json"
        # The staged raw file must sit under the repo root so the reused D8
        # provenance step (repo-relative `raw_file`) works. Transient + cleaned up;
        # data/ is untracked so this never pollutes git.
        self.staging = ROOT / "data" / "update-state" / f"_test_staging_{os.getpid()}_{id(self)}"
        # Seed the "installed" dataset from the real artifact.
        (self.bnx_dir / f"{CURRENTS_ID}.bnx").write_bytes(REAL_CURRENTS_BNX.read_bytes())
        (self.bnx_dir / f"{ANALYSIS_ID}.bnx").write_bytes(REAL_TS_BNX.read_bytes())
        self.installed_currents_hash = sha256_of(self.bnx_dir / f"{CURRENTS_ID}.bnx")

    def tearDown(self) -> None:
        self._td.cleanup()
        shutil.rmtree(self.staging, ignore_errors=True)

    def _updater(self, sources: dict) -> Updater:
        return Updater(
            sources,
            bnx_dir=self.bnx_dir,
            staging_dir=self.staging,
            manifest=ManifestStore(self.manifest_path),
        )

    def _fixture_source(self, **kw) -> FixtureSource:
        base = dict(
            group="currents",
            spec=SURFACE_CURRENTS,
            version=_newer_currents_version(),
            fixture_file=CURRENTS_NC,
        )
        base.update(kw)
        return FixtureSource(**base)

    def _manifest(self) -> dict:
        return json.loads(self.manifest_path.read_text(encoding="utf-8"))


# ===========================================================================
# 1-3. source discovery
# ===========================================================================
class SourceDiscovery(_UpdaterCase):
    def test_01_detects_a_newer_source(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        [res] = upd.check(["currents"])
        self.assertTrue(res.newer_available)
        self.assertEqual(res.installed_version, "CURRENTS_IO_20260904.nc")
        self.assertEqual(res.latest_version, "CURRENTS_IO_20260930.nc")

    def test_02_detects_no_newer_source(self) -> None:
        same = _newer_currents_version("CURRENTS_IO_20260904.nc")  # == installed
        upd = self._updater({"currents": self._fixture_source(version=same)})
        [res] = upd.check(["currents"])
        self.assertFalse(res.newer_available)

    def test_03_version_ordering_is_per_group(self) -> None:
        installed = "CURRENTS_IO_20260904.nc"
        self.assertTrue(_newer_currents_version("CURRENTS_IO_20260905.nc").is_newer_than(installed))
        self.assertFalse(_newer_currents_version("CURRENTS_IO_20260901.nc").is_newer_than(installed))
        self.assertTrue(_newer_analysis_version("2026-08-19T00:00:00Z").is_newer_than("2026-07-30T00:00:00Z"))
        self.assertFalse(_newer_analysis_version("2026-07-10T00:00:00Z").is_newer_than("2026-07-30T00:00:00Z"))

    def test_03b_thredds_catalog_parsing(self) -> None:
        xml = (FIXTURES / "thredds_currents_catalog.xml").read_bytes()
        with mock.patch.object(sources_mod, "_http_get", return_value=xml):
            v = ThreddsCurrentsSource().discover_latest()
        # newest CURRENTS_IO_* by embedded date -- NIO family is excluded
        self.assertEqual(v.version_id, "CURRENTS_IO_20260907.nc")
        self.assertEqual(v.source_identifier, "CURRENTS_IO_20260907.nc")
        self.assertEqual(v.remote_last_modified, "2026-09-08T05:41:11.001Z")

    def test_03c_erddap_info_parsing(self) -> None:
        payload = (FIXTURES / "erddap_argo_info.json").read_bytes()
        with mock.patch.object(sources_mod, "_http_get", return_value=payload):
            v = ErddapArgoSource().discover_latest()
        self.assertEqual(v.version_id, "2026-08-19T00:00:00Z")
        self.assertEqual(v.source_time_end_iso, "2026-08-19T00:00:00Z")
        # subset start = 2 x 10-day steps before the newest step
        self.assertEqual(v.source_time_start_iso, "2026-07-30T00:00:00Z")

    def test_03d_source_metadata_failure_is_reported_not_raised(self) -> None:
        with mock.patch.object(
            sources_mod, "_http_get", side_effect=SourceError("discover", "boom")
        ):
            upd = self._updater(sources_mod.default_sources())
            results = upd.check(["currents"])
        self.assertFalse(results[0].ok)
        self.assertIn("boom", results[0].error)


# ===========================================================================
# 4-8. update pipeline
# ===========================================================================
class UpdatePipeline(_UpdaterCase):
    def test_04_05_new_source_acquired_and_published(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        [res] = upd.update(["currents"])
        self.assertEqual(res.action, "updated")
        target = self.bnx_dir / f"{CURRENTS_ID}.bnx"
        self.assertTrue(target.is_file())
        reader = BnxReader(target)
        self.assertEqual(reader.dataset_id, CURRENTS_ID)
        self.assertEqual(set(reader.parameter_ids()), {"current_u", "current_v", "current_speed"})
        self.assertEqual(list(reader.shape("current_speed")), [4, 1, 421, 601])

    def test_06_07_08_pipeline_stages_run_and_artifact_reads(self) -> None:
        import app.data.updater.core as core

        with mock.patch.object(core, "ingest_dataset", wraps=core.ingest_dataset) as ing, \
             mock.patch.object(core, "process_dataset", wraps=core.process_dataset) as proc, \
             mock.patch.object(core, "convert_to_bluenexus", wraps=core.convert_to_bluenexus) as conv:
            upd = self._updater({"currents": self._fixture_source()})
            [res] = upd.update(["currents"])
        self.assertEqual(res.action, "updated")
        ing.assert_called_once()   # D7
        proc.assert_called_once()  # D8
        conv.assert_called_once()  # D9
        # generated .bnx round-trips through the D9 reader
        back = read_bluenexus(self.bnx_dir / f"{CURRENTS_ID}.bnx")
        self.assertEqual(back.dataset_id, CURRENTS_ID)

    def test_08b_run_d7_d8_d9_directly(self) -> None:
        ds, cleaned = run_d7_d8_d9(SURFACE_CURRENTS, CURRENTS_NC)
        self.assertEqual(ds.dataset_id, CURRENTS_ID)
        self.assertEqual(cleaned.provenance.raw_file_sha256, sha256_of(CURRENTS_NC))


# ===========================================================================
# 9-13. safety
# ===========================================================================
class UpdateSafety(_UpdaterCase):
    def _assert_currents_bnx_unchanged(self) -> None:
        self.assertEqual(
            sha256_of(self.bnx_dir / f"{CURRENTS_ID}.bnx"), self.installed_currents_hash
        )
        self.assertFalse((self.bnx_dir / f"{CURRENTS_ID}.bnx.updating").exists())

    def test_09_failed_download_leaves_old_bnx_intact(self) -> None:
        upd = self._updater({"currents": self._fixture_source(fail_stage="acquire")})
        [res] = upd.update(["currents"])
        self.assertEqual(res.action, "failed")
        self.assertEqual(res.stage_failed, "acquire")
        self._assert_currents_bnx_unchanged()

    def test_10_corrupt_acquisition_is_rejected_before_publish(self) -> None:
        upd = self._updater({"currents": self._fixture_source(corrupt_acquire=True)})
        [res] = upd.update(["currents"])
        self.assertEqual(res.action, "failed")
        self.assertEqual(res.stage_failed, "verify-acquisition")
        self._assert_currents_bnx_unchanged()

    def test_11_publication_is_atomic_no_tmp_left(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        upd.update(["currents"])
        self.assertFalse((self.bnx_dir / f"{CURRENTS_ID}.bnx.updating").exists())
        for p in self.bnx_dir.iterdir():
            self.assertTrue(p.name.endswith(".bnx"), f"unexpected leftover: {p.name}")

    def test_12_failed_conversion_does_not_replace_old_data(self) -> None:
        # Hand the currents updater a *temperature/salinity* NetCDF: the D7 schema
        # checks fail (no U/V/CURRENT), so nothing is published.
        bad = self._fixture_source(fixture_file=TS_NC)
        upd = self._updater({"currents": bad})
        [res] = upd.update(["currents"])
        self.assertEqual(res.action, "failed")
        self.assertIn(res.stage_failed, {"ingest", "process", "convert"})
        self._assert_currents_bnx_unchanged()

    def test_13_manifest_written_only_after_successful_publish(self) -> None:
        upd = self._updater({"currents": self._fixture_source(fail_stage="acquire")})
        upd.update(["currents"])
        entry = self._manifest()["datasets"]["currents"]
        self.assertEqual(entry["last_update"]["status"], "failed")
        self.assertEqual(entry["last_update"]["error"]["stage"], "acquire")
        # installed block still describes the baseline artifact, not the new source
        self.assertEqual(entry["installed"]["source_version"], "CURRENTS_IO_20260904.nc")
        self.assertEqual(entry["installed"]["artifact_sha256"], self.installed_currents_hash)

    def test_13b_check_never_writes_a_bnx(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        upd.check(["currents"])
        self._assert_currents_bnx_unchanged()


# ===========================================================================
# 14-18. identity / provenance
# ===========================================================================
class IdentityProvenance(_UpdaterCase):
    def test_14_logical_dataset_id_is_stable(self) -> None:
        upd = self._updater({"currents": self._fixture_source(version=_newer_currents_version("CURRENTS_IO_20261231.nc"))})
        [res] = upd.update(["currents"])
        self.assertEqual(res.action, "updated")
        self.assertEqual(res.logical_dataset_id, CURRENTS_ID)
        # exactly one .bnx, named by the LOGICAL id -- not the dated source file
        names = sorted(p.name for p in self.bnx_dir.iterdir())
        self.assertEqual(names, [f"{ANALYSIS_ID}.bnx", f"{CURRENTS_ID}.bnx"])
        self.assertEqual(BnxReader(self.bnx_dir / f"{CURRENTS_ID}.bnx").dataset_id, CURRENTS_ID)

    def test_15_16_17_source_and_artifact_hashes_recorded(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        upd.update(["currents"])
        inst = self._manifest()["datasets"]["currents"]["installed"]
        self.assertEqual(inst["source_file_sha256"], sha256_of(CURRENTS_NC))
        self.assertEqual(inst["artifact_sha256"], sha256_of(self.bnx_dir / f"{CURRENTS_ID}.bnx"))
        # acquisition time is its own field, distinct from source/publish times
        self.assertIn("acquired_at", inst)
        self.assertNotEqual(inst["acquired_at"], inst["source_time_start"])
        self.assertNotEqual(inst["acquired_at"], inst["published_at"])

    def test_18_provenance_preserved_in_published_artifact(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        upd.update(["currents"])
        back = read_bluenexus(self.bnx_dir / f"{CURRENTS_ID}.bnx")
        self.assertEqual(back.provenance.source_file_sha256, sha256_of(CURRENTS_NC))
        self.assertIn("D9 BlueNexus format", back.provenance.pipeline_stages)
        # provenance names the file this artifact actually came from ...
        self.assertEqual(back.provenance.source_dataset_id, "CURRENTS_IO_20260930.nc")
        # ... while the LOGICAL dataset id stays stable
        self.assertEqual(back.dataset_id, CURRENTS_ID)


# ===========================================================================
# 19-21. combined datasets
# ===========================================================================
class CombinedDatasets(_UpdaterCase):
    def test_19_temperature_and_salinity_from_one_artifact(self) -> None:
        ts_source = FixtureSource(
            group="temperature-salinity",
            spec=TEMPERATURE_SALINITY,
            version=_newer_analysis_version(),
            fixture_file=TS_NC,
        )
        upd = self._updater({"temperature-salinity": ts_source})
        [res] = upd.update(["temperature-salinity"])
        self.assertEqual(res.action, "updated")
        reader = BnxReader(self.bnx_dir / f"{ANALYSIS_ID}.bnx")
        self.assertEqual(set(reader.parameter_ids()), {"temperature", "salinity"})
        back = read_bluenexus(self.bnx_dir / f"{ANALYSIS_ID}.bnx")
        # both parameters trace to the SAME acquired source file
        self.assertEqual(
            back.provenance.original_units.keys(), {"temperature", "salinity"}
        )

    def test_20_21_uvcurrent_update_together_no_mixed_version(self) -> None:
        upd = self._updater({"currents": self._fixture_source()})
        upd.update(["currents"])
        back = read_bluenexus(self.bnx_dir / f"{CURRENTS_ID}.bnx")
        self.assertEqual(
            set(back.parameters), {"current_u", "current_v", "current_speed"}
        )
        # one provenance record -> one source file -> U/V/CURRENT cannot be mixed-version
        self.assertEqual(back.provenance.source_file_sha256, sha256_of(CURRENTS_NC))
        self.assertEqual(
            set(back.provenance.canonical_units), {"current_u", "current_v", "current_speed"}
        )


# ===========================================================================
# partial-update behaviour (D14 §25)
# ===========================================================================
class PartialUpdate(_UpdaterCase):
    def test_partial_update_keeps_each_dataset_independent(self) -> None:
        good = FixtureSource(
            group="temperature-salinity", spec=TEMPERATURE_SALINITY,
            version=_newer_analysis_version(), fixture_file=TS_NC,
        )
        bad = self._fixture_source(fail_stage="acquire")
        upd = self._updater({"temperature-salinity": good, "currents": bad})
        results = {r.group: r for r in upd.update(["temperature-salinity", "currents"])}
        self.assertEqual(results["temperature-salinity"].action, "updated")
        self.assertEqual(results["currents"].action, "failed")
        # currents untouched, temp/salinity advanced
        self.assertEqual(
            sha256_of(self.bnx_dir / f"{CURRENTS_ID}.bnx"), self.installed_currents_hash
        )
        ds = self._manifest()["datasets"]
        self.assertEqual(ds["temperature-salinity"]["last_update"]["status"], "success")
        self.assertEqual(ds["currents"]["last_update"]["status"], "failed")


# ===========================================================================
# 29. the REAL installed datasets must never be disturbed by check / failed update
# ===========================================================================
class RealDataPreservation(unittest.TestCase):
    def test_29_check_and_failed_update_do_not_touch_real_bnx(self) -> None:
        """A --check and a failed --update against the REAL installed artifacts
        must leave every ``data/bluenexus/*.bnx`` byte-identical (D14 §29).

        Uses the real bnx dir but an isolated manifest / staging dir so the
        project's own update state is not disturbed by the test run.
        """
        real_bnx = ROOT / "data" / "bluenexus"
        before = {p.name: sha256_of(p) for p in real_bnx.glob("*.bnx")}

        with TemporaryDirectory() as td:
            staging = ROOT / "data" / "update-state" / f"_test29_{os.getpid()}"
            try:
                iso_manifest = ManifestStore(Path(td) / "m.json")

                def _iso_updater() -> Updater:
                    return Updater(
                        sources_mod.default_sources(),
                        bnx_dir=real_bnx,
                        staging_dir=staging,
                        manifest=iso_manifest,
                    )

                try:
                    _iso_updater().check()  # real live check (best effort)
                except Exception:  # noqa: BLE001 - offline is acceptable here
                    pass

                # forced-failure update: nothing is downloaded or written
                with mock.patch.object(
                    sources_mod, "_http_get", side_effect=SourceError("discover", "forced")
                ), mock.patch.object(
                    sources_mod, "_http_download", side_effect=SourceError("acquire", "forced")
                ):
                    results = _iso_updater().update()
                self.assertTrue(all(r.action == "failed" for r in results))
            finally:
                shutil.rmtree(staging, ignore_errors=True)

        after = {p.name: sha256_of(p) for p in real_bnx.glob("*.bnx")}
        self.assertEqual(before, after, "an installed .bnx changed -- D14 must be non-destructive")


# ===========================================================================
# 90. live source check against the official INCOIS services
# ===========================================================================
class LiveSourceCheck(unittest.TestCase):
    def test_90_live_source_check(self) -> None:
        with TemporaryDirectory() as td:
            updater = Updater(
                sources_mod.default_sources(),
                bnx_dir=ROOT / "data" / "bluenexus",
                staging_dir=Path(td) / "staging",
                manifest=ManifestStore(Path(td) / "m.json"),
            )
            try:
                results = updater.check()
            except SourceError as exc:  # pragma: no cover - network dependent
                self.skipTest(f"INCOIS source unreachable: {exc}")
        by_group = {r.group: r for r in results}
        self.assertEqual(set(by_group), {"temperature-salinity", "currents"})
        for r in results:
            if r.error:
                self.skipTest(f"{r.group} source check failed live: {r.error}")
            self.assertIsNotNone(r.latest_version)
        # the ERDDAP analysis dataset the project installed is stable historical
        # analysis -- its newest step should be >= what we shipped
        ts = by_group["temperature-salinity"]
        self.assertGreaterEqual(ts.latest_version, "2026-07-30T00:00:00Z")
        cur = by_group["currents"]
        self.assertRegex(cur.latest_version, r"^CURRENTS_IO_\d{8}\.nc$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
