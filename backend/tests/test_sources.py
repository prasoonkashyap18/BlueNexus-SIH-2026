"""Step 51 -- ``GET /api/sources`` real data-source / provenance catalogue.

Verifies the endpoint reports the correct source identity for every real
dataset the application uses, that GLORYS12V1 is Copernicus Marine data (never
INCOIS), that units / dataset ids are accurate, and that nothing leaks a
filesystem path or a traceback.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_sources -v
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import MODEL_SOURCE_LABEL, ApiConfig  # noqa: E402
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"
RAW = project_root() / "data" / "raw"
MODEL_FILE = RAW / "temperature_cmems_glorys12v1_arabiansea.nc"

_ctx = None
SRV = None


def setUpModule() -> None:
    global _ctx, SRV
    data_dir = project_root() / "data" / "bluenexus"
    data_dir.mkdir(parents=True, exist_ok=True)
    have = set()
    for p in data_dir.glob("*.bnx"):
        try:
            have.add(BnxReader(p).dataset_id)
        except Exception:
            pass
    if {ANALYSIS, CURRENTS} - have:
        for name, ds in convert_all().items():
            write_bluenexus(ds, data_dir / f"{name}.bnx")

    kwargs = dict(data_dir=data_dir, cors_origins=("http://localhost:5173",), build_on_startup=False)
    if MODEL_FILE.is_file():
        kwargs.update(
            netcdf_path=MODEL_FILE,
            netcdf_dataset_id="glorys12v1_model",
            netcdf_cf_decode=True,
            netcdf_source_label=MODEL_SOURCE_LABEL,
        )
    _ctx = live_server(create_app(ApiConfig(**kwargs)))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


def _by_key(body: dict) -> dict:
    return {s["key"]: s for s in body["sources"]}


class Step51SourceCatalog(unittest.TestCase):
    def test_catalog_lists_all_six_real_sources(self) -> None:
        st, body = SRV.get("/api/sources")
        self.assertEqual(st, 200)
        self.assertEqual(body["count"], 6)
        self.assertEqual(
            set(_by_key(body)),
            {"temperature", "salinity", "currents", "argo", "gliders", "model_comparison"},
        )

    def test_temperature_and_salinity_are_incois_analysis(self) -> None:
        s = _by_key((SRV.get("/api/sources"))[1])
        for key, var in (("temperature", "T_ANALYZED"), ("salinity", "S_ANALYZED")):
            entry = s[key]
            self.assertEqual(entry["label"], "INCOIS Ocean Analysis")
            self.assertEqual(entry["kind"], "analysis")
            self.assertTrue(entry["is_incois"])
            self.assertEqual(entry["dataset_id"], ANALYSIS)
            self.assertEqual(entry["product_identifier"], "incois_argo_10day_McCreary")
            self.assertEqual(entry["variable"]["name"], var)
        self.assertEqual(s["temperature"]["units"], "degC")
        self.assertEqual(s["salinity"]["units"], "PSU")

    def test_currents_are_incois_io_hoofs_forecast(self) -> None:
        entry = _by_key((SRV.get("/api/sources"))[1])["currents"]
        self.assertEqual(entry["label"], "INCOIS IO-HOOFS")
        self.assertEqual(entry["kind"], "forecast")
        self.assertTrue(entry["is_incois"])
        self.assertEqual(entry["dataset_id"], CURRENTS)
        self.assertEqual(entry["variable"]["name"], "CURRENT")
        self.assertEqual(entry["units"], "m s-1")
        self.assertTrue(entry["coverage"]["depth"]["surface_only"])

    def test_argo_source_is_incois_indian_argo_floats(self) -> None:
        entry = _by_key((SRV.get("/api/sources"))[1])["argo"]
        self.assertEqual(entry["label"], "INCOIS Indian_ARGO_Floats")
        self.assertEqual(entry["kind"], "observation")
        self.assertFalse(entry["is_model"])
        self.assertTrue(entry["is_incois"])
        self.assertEqual(entry["product_identifier"], "Indian_ARGO_Floats")
        self.assertEqual(entry["units"]["temperature"], "degree_Celsius")
        self.assertEqual(entry["units"]["pressure"], "decibar")

    def test_glider_source_is_ego_oceangliders_gdac(self) -> None:
        entry = _by_key((SRV.get("/api/sources"))[1])["gliders"]
        self.assertEqual(entry["label"], "EGO / OceanGliders GDAC")
        self.assertEqual(entry["kind"], "observation")
        self.assertFalse(entry["is_model"])
        self.assertFalse(entry["is_incois"])
        self.assertEqual(entry["product_identifier"], "OceanGlidersGDACTrajectories")

    def test_model_comparison_is_glorys_copernicus_never_incois(self) -> None:
        body = (SRV.get("/api/sources"))[1]
        entry = _by_key(body)["model_comparison"]
        self.assertEqual(entry["label"], "GLORYS12V1 / Copernicus Marine")
        self.assertEqual(entry["kind"], "reanalysis")
        self.assertTrue(entry["is_model"])
        self.assertFalse(entry["is_incois"])
        self.assertNotIn("INCOIS", entry["label"])
        self.assertNotIn("INCOIS", (entry.get("organization") or ""))
        self.assertEqual(entry["dataset_id"], "glorys12v1_model")
        self.assertEqual(entry["product_identifier"], "GLOBAL_MULTIYEAR_PHY_001_030")
        self.assertEqual(entry["copernicus_dataset_id"], "cmems_mod_glo_phy_my_0.083deg_P1D-m")
        self.assertIn("10.48670/moi-00021", entry["doi"])
        self.assertEqual(entry["variable"]["name"], "thetao")
        self.assertEqual(entry["variable"]["standard_name"], "sea_water_potential_temperature")
        self.assertNotIn("in-situ", entry["variable"]["display"].lower())
        self.assertEqual(entry["units"], "degrees_C")
        # honest about the subset
        self.assertIn("subset", (entry.get("subset_note") or "").lower())
        # whole-catalogue note keeps GLORYS out of INCOIS
        joined = " ".join(body["notes"])
        self.assertIn("NOT INCOIS", joined)

    @unittest.skipUnless(MODEL_FILE.is_file(), "GLORYS file not present")
    def test_glorys_coverage_is_the_real_regional_extent(self) -> None:
        entry = _by_key((SRV.get("/api/sources"))[1])["model_comparison"]
        cov = entry["coverage"]
        self.assertAlmostEqual(cov["latitude"]["min"], 8.0, places=3)
        self.assertAlmostEqual(cov["latitude"]["max"], 20.5, places=3)
        self.assertAlmostEqual(cov["longitude"]["min"], 61.5, places=3)
        self.assertEqual(cov["depth"]["count"], 32)
        self.assertEqual(cov["time"]["start"], "2025-03-24T00:00:00Z")

    def test_no_filesystem_path_or_traceback_leaked(self) -> None:
        raw = SRV.raw_get("/api/sources")[1]
        low = raw.lower()
        for bad in ("traceback", "\\\\", "c:\\", "/users/", "/home/", ".venv", "site-packages", "data/raw/"):
            self.assertNotIn(bad, low, f"leaked {bad!r}")
        # the response is strict JSON (no NaN)
        json.loads(raw)

    def test_existing_endpoints_unaffected(self) -> None:
        for path in ("/api/health", "/api/datasets", "/api/observations/argo", "/api/observations/gliders"):
            st, _ = SRV.get(path)
            self.assertEqual(st, 200, path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
