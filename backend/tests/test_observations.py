"""Step 28 -- real INCOIS Argo profiling-float observation integration.

Two layers, mirroring ``test_api.py``:

* unit  -- the CSV reader/parser (``app.data.observations.argo``): grouping,
           fill-value -> None, QC preserved, units, real ids/coords/times.
* HTTP  -- ``GET /api/observations/argo[...]`` under a real uvicorn server.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_observations -v
"""

from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import ApiConfig  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402
from app.data.observations import ArgoProfilesReader, default_raw_csv_path  # noqa: E402
from app.data.observations.argo import parse_profiles  # noqa: E402

RAW_CSV = default_raw_csv_path()
RAW_SHA256 = "5ec0d4323b78f2748138f38396b931c231911625c803852fdcc47dbcf0da5979"


# ---------------------------------------------------------------------------
# unit: the raw file exists and is the exact D4 snapshot
# ---------------------------------------------------------------------------
class ArgoRawSnapshot(unittest.TestCase):
    def test_raw_csv_present_and_unmodified(self) -> None:
        from app.data.ingestion import sha256_of

        self.assertTrue(RAW_CSV.is_file(), f"missing D4 snapshot: {RAW_CSV}")
        self.assertEqual(sha256_of(RAW_CSV), RAW_SHA256)

    def test_raw_csv_is_erddap_tabledap_layout(self) -> None:
        head = RAW_CSV.read_text(encoding="utf-8-sig").splitlines()[:2]
        self.assertEqual(
            head[0],
            "PLATFORM_NUMBER,CYCLE_NUMBER,PLATFORM_TYPE,DIRECTION,time,latitude,"
            "longitude,PRES,PRES_QC,TEMP,TEMP_QC,PSAL,PSAL_QC",
        )
        # row 2 is ERDDAP's units row
        self.assertIn("degree_Celsius", head[1])
        self.assertIn("decibar", head[1])
        self.assertIn("PSU", head[1])


# ---------------------------------------------------------------------------
# unit: the reader preserves real values, units and missing data
# ---------------------------------------------------------------------------
class ArgoReader(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reader = ArgoProfilesReader().load()

    def test_groups_rows_into_real_profiles(self) -> None:
        profiles = self.reader.profiles()
        self.assertEqual(len(profiles), 17)
        self.assertEqual(len({p.platform_number for p in profiles}), 11)
        # real WMO ids and cycle numbers, verbatim
        ids = self.reader.platform_ids()
        self.assertIn("2903951_10", ids)
        self.assertIn("7902250_12", ids)
        for p in profiles:
            self.assertRegex(p.platform_id, r"^[0-9]+_[0-9]+$")
            self.assertIsInstance(p.cycle_number, int)
            self.assertGreater(p.level_count, 0)

    def test_real_coordinates_and_timestamps_preserved(self) -> None:
        p = self.reader.get("2903951_10")
        self.assertEqual(p.time, "2025-04-01T13:29:00Z")          # verbatim ISO
        self.assertAlmostEqual(p.latitude, -3.0807516666666666, places=10)
        self.assertAlmostEqual(p.longitude, 77.83276333333333, places=10)
        self.assertEqual(p.platform_type, "PROVOR_III")
        self.assertEqual(p.direction, "A")

    def test_units_are_source_units_not_converted(self) -> None:
        d = self.reader.detail("2903951_10")
        self.assertEqual(d["units"]["pressure"], "decibar")
        self.assertEqual(d["units"]["temperature"], "degree_Celsius")
        self.assertEqual(d["units"]["salinity"], "PSU")

    def test_level_values_are_verbatim(self) -> None:
        d = self.reader.detail("2903951_10")
        first = d["levels"][0]
        # straight from the CSV: 2.5,1,29.995,1,34.858,1
        self.assertEqual(first["pressure"], 2.5)
        self.assertEqual(first["temperature"], 29.995)
        self.assertEqual(first["salinity"], 34.858)
        self.assertEqual(first["pressure_qc"], "1")
        self.assertEqual(first["temperature_qc"], "1")
        self.assertEqual(first["salinity_qc"], "1")

    def test_real_qc_flags_carried_through(self) -> None:
        seen = {
            lv.temperature_qc
            for p in self.reader.profiles()
            for lv in p.levels
        }
        # the snapshot really contains flag 3 (probably bad) and 4 (bad)
        self.assertTrue({"3", "4"}.issubset(seen), seen)

    def test_fill_value_becomes_null_never_a_number(self) -> None:
        # A constructed tabledap fragment (parser unit test -- not app data):
        # ERDDAP writes the Argo _FillValue 99999.0 and/or a blank cell.
        csv_rows = list(
            __import__("csv").reader(
                io.StringIO(
                    "5900001,7,ARVOR,A,2025-04-10T00:00:00Z,10.0,72.0,5.0,1,28.1,1,35.0,1\n"
                    "5900001,7,ARVOR,A,2025-04-10T00:00:00Z,10.0,72.0,99999.0,4,99999.0,4,,\n"
                )
            )
        )
        [profile] = parse_profiles(csv_rows)
        good, missing = profile.levels
        self.assertEqual(good.temperature, 28.1)
        self.assertIsNone(missing.pressure)
        self.assertIsNone(missing.temperature)
        self.assertIsNone(missing.salinity)
        self.assertIsNone(missing.salinity_qc)     # blank QC -> None
        self.assertEqual(missing.temperature_qc, "4")  # real QC still kept
        # nothing invented
        self.assertNotIn(99999.0, (missing.pressure, missing.temperature, missing.salinity))

    def test_provenance_names_the_real_source(self) -> None:
        prov = self.reader.provenance()
        self.assertEqual(prov["source_name"], "INCOIS ERDDAP")
        self.assertEqual(prov["source_dataset_id"], "Indian_ARGO_Floats")
        self.assertEqual(prov["source_file_sha256"], RAW_SHA256)
        self.assertEqual(prov["product_type"], "observation")

    def test_no_demo_or_random_identifiers(self) -> None:
        blob = json.dumps(
            [self.reader.detail(i) for i in self.reader.platform_ids()]
        ).lower()
        for banned in ("demo", "mock", "synthetic", "random", "placeholder", "fake", "dummy"):
            self.assertNotIn(banned, blob)


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
        argo_raw_csv=RAW_CSV,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


class ArgoEndpoints(unittest.TestCase):
    def test_list_returns_real_float_profiles(self) -> None:
        st, body = SRV.get("/api/observations/argo")
        self.assertEqual(st, 200)
        self.assertEqual(body["dataset_id"], "incois_indian_argo_floats")
        self.assertEqual(body["platform_type"], "argo")
        self.assertEqual(body["count"], 17)
        self.assertEqual(len(body["platforms"]), 17)
        self.assertEqual(body["units"]["pressure"], "decibar")
        self.assertEqual(body["provenance"]["source_dataset_id"], "Indian_ARGO_Floats")
        one = body["platforms"][0]
        for key in (
            "platform_id", "platform_number", "cycle_number", "time",
            "latitude", "longitude", "level_count", "pressure_min", "pressure_max",
        ):
            self.assertIn(key, one)
        self.assertRegex(one["platform_id"], r"^[0-9]+_[0-9]+$")

    def test_detail_returns_real_profile_levels(self) -> None:
        st, body = SRV.get("/api/observations/argo/2903951_10")
        self.assertEqual(st, 200)
        self.assertEqual(body["platform_number"], "2903951")
        self.assertEqual(body["cycle_number"], 10)
        self.assertEqual(body["time"], "2025-04-01T13:29:00Z")
        self.assertEqual(body["missing_value"], None)
        self.assertEqual(len(body["levels"]), body["level_count"])
        lv = body["levels"][0]
        self.assertEqual(lv["pressure"], 2.5)
        self.assertEqual(lv["temperature"], 29.995)
        self.assertEqual(lv["salinity"], 34.858)
        # deepest level is a real, distinct measurement
        deep = body["levels"][-1]
        self.assertGreater(deep["pressure"], 1500)
        self.assertLess(deep["temperature"], 10)

    def test_unknown_platform_is_404_with_envelope(self) -> None:
        st, body = SRV.get("/api/observations/argo/9999999_1")
        self.assertEqual(st, 404)
        # Step 35: a resource-specific slug (was the generic "unknown_dataset").
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")
        self.assertIn("known_platform_ids", body["error"]["detail"])

    def test_malformed_platform_id_is_rejected(self) -> None:
        st, body = SRV.get("/api/observations/argo/not-an-id")
        self.assertEqual(st, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")

    def test_missing_values_are_json_null_in_the_wire_format(self) -> None:
        _, raw = SRV.raw_get("/api/observations/argo/2903951_10")
        # never the Argo fill value, never a sentinel
        self.assertNotIn("99999", raw)
        self.assertNotIn("-999", raw)
        self.assertNotIn("-1e34", raw)

    def test_argo_path_does_not_disturb_the_gridded_datasets(self) -> None:
        st, body = SRV.get("/api/datasets")
        self.assertEqual(st, 200)
        self.assertEqual(body["count"], 2)
        ids = {d["dataset_id"] for d in body["datasets"]}
        self.assertEqual(
            ids, {"incois_argo_10day_analysis", "incois_io_hoofs_surface_currents"}
        )


if __name__ == "__main__":
    unittest.main()
