"""Step 29 -- real EGO / OceanGliders GDAC underwater-glider integration.

Same two layers as ``test_observations.py`` (Step 28):

* unit  -- the CSV reader/parser (``app.data.observations.glider``): grouping by
           deployment, NaN / fill -> None, QC preserved (incl. bad flag 4),
           source units, real ids / coords / timestamps / pressures.
* HTTP  -- ``GET /api/observations/gliders[...]`` under a real uvicorn server.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_glider_observations -v
"""

from __future__ import annotations

import io
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import ApiConfig  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402
from app.data.observations.glider import (  # noqa: E402
    GliderTrajectoriesReader,
    default_raw_csv_path,
    parse_deployments,
)

RAW_CSV = default_raw_csv_path()
RAW_SHA256 = "3ec6aecfd8ef2add9b3ee0a57c597929ffaa882f51d09036ebe9c02821017643"


def _numbers(obj):
    """Every numeric leaf in a parsed-JSON structure."""
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _numbers(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _numbers(v)


# ---------------------------------------------------------------------------
# unit: raw snapshot is the exact D4 file
# ---------------------------------------------------------------------------
class GliderRawSnapshot(unittest.TestCase):
    def test_raw_csv_present_and_unmodified(self) -> None:
        from app.data.ingestion import sha256_of

        self.assertTrue(RAW_CSV.is_file(), f"missing D4 snapshot: {RAW_CSV}")
        self.assertEqual(sha256_of(RAW_CSV), RAW_SHA256)

    def test_raw_csv_is_erddap_tabledap_layout(self) -> None:
        head = RAW_CSV.read_text(encoding="utf-8-sig").splitlines()[:2]
        self.assertEqual(
            head[0],
            "platform_deployment,time,latitude,longitude,PRES,PRES_QC,TEMP,TEMP_QC,"
            "PSAL,PSAL_QC,POSITION_QC",
        )
        self.assertIn("decibar", head[1])
        self.assertIn("degree_Celsius", head[1])
        self.assertIn("PSU", head[1])


# ---------------------------------------------------------------------------
# unit: reader preserves real values, units, QC and missing data
# ---------------------------------------------------------------------------
class GliderReader(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reader = GliderTrajectoriesReader().load()

    def test_groups_rows_into_real_deployments(self) -> None:
        deps = self.reader.deployments()
        self.assertEqual(self.reader.platform_ids(), ["sea057_20220707", "Bellatrix_368"])
        self.assertEqual(sum(d.sample_count for d in deps), 6036)
        for d in deps:
            self.assertGreater(d.sample_count, 0)

    def test_real_coordinates_timestamps_pressure_preserved(self) -> None:
        d = self.reader.get("sea057_20220707")
        s0 = d.samples[0]
        self.assertEqual(s0.time, "2022-07-03T14:02:26Z")            # verbatim ISO
        self.assertAlmostEqual(s0.latitude, 23.5904, places=6)
        self.assertAlmostEqual(s0.longitude, 58.16826666666666, places=10)
        # a deep sample later in the mission
        deep = max(d.samples, key=lambda s: s.pressure or -1)
        self.assertGreater(deep.pressure, 600)                        # decibar, real dive
        self.assertLess(deep.temperature, 20)

    def test_source_units_not_converted(self) -> None:
        d = self.reader.detail("sea057_20220707")
        self.assertEqual(d["units"]["pressure"], "decibar")
        self.assertEqual(d["units"]["temperature"], "degree_Celsius")
        self.assertEqual(d["units"]["salinity"], "PSU")

    def test_qc_preserved_including_bad_flag(self) -> None:
        d = self.reader.get("sea057_20220707")
        temp_qc = {s.temperature_qc for s in d.samples}
        pos_qc = {s.position_qc for s in d.samples}
        self.assertIn("1", temp_qc)       # good data
        self.assertIn("4", temp_qc)       # bad data -- kept, not dropped
        self.assertIn("4", pos_qc)
        # the row flagged bad still carries its (implausible on-deck) value
        bad = next(s for s in d.samples if s.temperature_qc == "4")
        self.assertIsNotNone(bad.temperature)
        self.assertGreater(bad.temperature, 35)

    def test_missing_values_become_null_never_a_number(self) -> None:
        d = self.reader.get("sea057_20220707")
        # PSAL is genuinely absent for the early surface samples in this snapshot
        missing = next(s for s in d.samples if s.salinity is None)
        self.assertIsNone(missing.salinity)
        self.assertIsNone(missing.salinity_qc)
        # never the fill value, never zero-substituted
        for s in d.samples:
            for v in (s.pressure, s.temperature, s.salinity, s.latitude, s.longitude):
                self.assertNotEqual(v, 99999.0)

    def test_qc_absent_deployment_reports_null_qc_not_fabricated(self) -> None:
        # Bellatrix_368 (2016 Bay of Bengal) has no QC populated in the GDAC.
        d = self.reader.get("Bellatrix_368")
        self.assertTrue(all(s.temperature_qc is None for s in d.samples))
        # ...but the T/S/P values themselves are real and present
        real = [s for s in d.samples if s.temperature is not None]
        self.assertGreater(len(real), 1000)

    def test_parser_maps_nan_and_fill_and_blank_to_none(self) -> None:
        # constructed tabledap fragment -- parser unit test, not app data
        rows = list(csv_reader(
            "g1_20240101,2024-01-01T00:00:00Z,10.0,72.0,5.0,1,28.1,1,35.0,1,1\n"
            "g1_20240101,2024-01-01T00:00:10Z,10.0,72.0,NaN,9,99999.0,4,,,4\n"
        ))
        [dep] = parse_deployments(rows)
        good, missing = dep.samples
        self.assertEqual(good.temperature, 28.1)
        self.assertIsNone(missing.pressure)       # NaN
        self.assertIsNone(missing.temperature)    # 99999.0 fill
        self.assertIsNone(missing.salinity)       # blank
        self.assertIsNone(missing.salinity_qc)    # blank QC
        self.assertEqual(missing.temperature_qc, "4")   # real QC kept
        self.assertEqual(missing.pressure_qc, "9")

    def test_provenance_names_the_real_source(self) -> None:
        prov = self.reader.provenance()
        self.assertEqual(prov["source_name"], "EGO / OceanGliders GDAC")
        self.assertEqual(prov["source_dataset_id"], "OceanGlidersGDACTrajectories")
        self.assertEqual(prov["product_type"], "observation")
        self.assertEqual(prov["source_file_sha256"], RAW_SHA256)
        self.assertIn("ego-network.org", prov["network_info_url"])

    def test_no_demo_or_random_identifiers(self) -> None:
        blob = json.dumps(
            [self.reader.detail(i) for i in self.reader.platform_ids()]
        ).lower()
        for banned in ("demo", "mock", "synthetic", "random", "placeholder", "fake", "dummy"):
            self.assertNotIn(banned, blob)


def csv_reader(text: str):
    import csv

    return csv.reader(io.StringIO(text))


# ---------------------------------------------------------------------------
# HTTP: the endpoints serve the real snapshot
# ---------------------------------------------------------------------------
_ctx = None
SRV = None


def setUpModule() -> None:
    global _ctx, SRV
    cfg = ApiConfig(
        data_dir=project_root() / "data" / "bluenexus",
        cors_origins=("http://localhost:5173",),
        build_on_startup=False,
        argo_raw_csv=(project_root() / "data" / "raw"
                      / "argo_profiles_incois_indian_argo_floats_sample.csv"),
        glider_raw_csv=RAW_CSV,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


class GliderEndpoints(unittest.TestCase):
    def test_list_returns_real_deployments(self) -> None:
        st, body = SRV.get("/api/observations/gliders")
        self.assertEqual(st, 200)
        self.assertEqual(body["dataset_id"], "ego_oceangliders_gdac")
        self.assertEqual(body["platform_type"], "glider")
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["units"]["pressure"], "decibar")
        self.assertEqual(
            body["provenance"]["source_dataset_id"], "OceanGlidersGDACTrajectories"
        )
        ids = {p["platform_id"] for p in body["platforms"]}
        self.assertEqual(ids, {"sea057_20220707", "Bellatrix_368"})
        one = next(p for p in body["platforms"] if p["platform_id"] == "sea057_20220707")
        for key in (
            "sample_count", "time_start", "time_end",
            "latitude_min", "longitude_min", "pressure_min", "pressure_max",
        ):
            self.assertIn(key, one)

    def test_detail_returns_real_trajectory_samples(self) -> None:
        st, body = SRV.get("/api/observations/gliders/sea057_20220707")
        self.assertEqual(st, 200)
        self.assertEqual(body["platform_id"], "sea057_20220707")
        self.assertEqual(body["missing_value"], None)
        self.assertEqual(len(body["samples"]), body["sample_count"])
        s0 = body["samples"][0]
        self.assertEqual(s0["time"], "2022-07-03T14:02:26Z")
        self.assertAlmostEqual(s0["latitude"], 23.5904, places=6)
        # QC flags present on the wire, including a bad one somewhere
        self.assertIn("4", {s["temperature_qc"] for s in body["samples"]})

    def test_unknown_deployment_is_404_with_envelope(self) -> None:
        st, body = SRV.get("/api/observations/gliders/nope_20200101")
        self.assertEqual(st, 404)
        # Step 35: a resource-specific slug (was the generic "unknown_dataset").
        self.assertEqual(body["error"]["type"], "unknown_glider_deployment")
        self.assertIn("known_platform_ids", body["error"]["detail"])

    def test_no_fill_or_nan_leaks_into_the_json(self) -> None:
        st, body = SRV.get("/api/observations/gliders/sea057_20220707")
        self.assertEqual(st, 200)
        seen = list(_numbers(body))
        self.assertGreater(len(seen), 5000)
        for n in seen:
            self.assertTrue(math.isfinite(n))     # no NaN / inf numbers
            self.assertNotEqual(n, 99999.0)       # the EGO fill value never appears
            self.assertNotEqual(n, -9999.0)
        # a missing measurement is JSON null, not omitted and not a sentinel
        missing = next(s for s in body["samples"] if s["salinity"] is None)
        self.assertIsNone(missing["salinity_qc"])

    def test_glider_path_is_independent_of_argo_and_the_grid(self) -> None:
        # gliders != argo
        _, gl = SRV.get("/api/observations/gliders")
        _, ar = SRV.get("/api/observations/argo")
        self.assertNotEqual(
            gl["provenance"]["source_dataset_id"],
            ar["provenance"]["source_dataset_id"],
        )
        gl_ids = {p["platform_id"] for p in gl["platforms"]}
        ar_ids = {p["platform_id"] for p in ar["platforms"]}
        self.assertEqual(gl_ids & ar_ids, set())
        # gridded datasets untouched
        _, ds = SRV.get("/api/datasets")
        self.assertEqual(ds["count"], 2)

    def test_argo_temp_salinity_current_still_work(self) -> None:
        self.assertEqual(SRV.get("/api/observations/argo")[0], 200)
        self.assertEqual(
            SRV.get("/api/datasets/incois_argo_10day_analysis/parameters/temperature/slice?time_index=0&depth_index=0")[0],
            200,
        )
        self.assertEqual(
            SRV.get("/api/datasets/incois_argo_10day_analysis/parameters/salinity/slice?time_index=0&depth_index=0")[0],
            200,
        )
        self.assertEqual(
            SRV.get("/api/datasets/incois_io_hoofs_surface_currents/parameters/current_speed/slice?time_index=0&depth_index=0")[0],
            200,
        )


if __name__ == "__main__":
    unittest.main()
