"""Step 43 -- model-at-observation extraction (GLORYS12V1 thetao @ a real Argo).

    GET /api/model-observations/argo/{platform_id}/temperature

Connects one real INCOIS Argo profile to the **nearest native** GLORYS12V1
`thetao` column. Extraction only -- no model-minus-observation difference.

These tests use the **real validated files** (`data/raw/temperature_cmems_glorys12v1_arabiansea.nc`
+ the real Argo snapshot) and check the API output against `xarray` reading the
same NetCDF -- no synthetic scientific fixtures.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_model_observations -v
"""

from __future__ import annotations

import math
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import (  # noqa: E402
    MODEL_NETCDF_DATASET_ID,
    MODEL_SOURCE_LABEL,
    ApiConfig,
)
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"
RAW = project_root() / "data" / "raw"
MODEL_FILE = RAW / "temperature_cmems_glorys12v1_arabiansea.nc"
SAMPLE_FILE = RAW / "temperature_cmems_glorys12v1_sample.nc"

# The 4 target profiles + the hand-computed nearest-native match.
TARGETS = {
    "3902669_4": dict(lat=19.666666666666668, lon=64.65, time="2025-03-31T15:00:20Z",
                      m_day="2025-04-01", dt_s=32380.0),
    "5907180_3": dict(lat=16.533333333333335, lon=68.66666666666667, time="2025-03-26T20:12:45Z",
                      m_day="2025-03-27", dt_s=13635.0),
    "5907179_3": dict(lat=12.316666666666666, lon=68.15, time="2025-03-28T20:10:01Z",
                      m_day="2025-03-29", dt_s=13799.0),
    "6990715_3": dict(lat=9.4, lon=68.45, time="2025-04-01T19:52:02Z",
                      m_day="2025-04-02", dt_s=14878.0),
}

_ctx = None
SRV = None


def _bnx_config() -> ApiConfig:
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
    return ApiConfig(data_dir=data_dir, cors_origins=("http://localhost:5173",),
                     build_on_startup=False)


def setUpModule() -> None:
    global _ctx, SRV
    if not MODEL_FILE.is_file():
        raise unittest.SkipTest(f"GLORYS Arabian Sea file not present: {MODEL_FILE}")
    base = _bnx_config()
    cfg = ApiConfig(
        data_dir=base.data_dir, cors_origins=base.cors_origins, build_on_startup=False,
        netcdf_path=MODEL_FILE, netcdf_dataset_id=MODEL_NETCDF_DATASET_ID,
        netcdf_cf_decode=True, netcdf_source_label=MODEL_SOURCE_LABEL,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


def _iso_to_dt(s: str) -> datetime:
    v = s[:-1] + "+00:00" if s.endswith("Z") else s
    d = datetime.fromisoformat(v)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ModelAtArgoSuccess(unittest.TestCase):
    """All 4 real target profiles extract a real native GLORYS thetao column."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.ds = xr.open_dataset(MODEL_FILE, mask_and_scale=True, decode_times=True)
        cls.native_depth = [round(float(x), 6) for x in cls.ds["depth"].values]

    @classmethod
    def tearDownClass(cls) -> None:
        cls.ds.close()

    def _get(self, pid: str) -> dict:
        status, body = SRV.get(f"/api/model-observations/argo/{pid}/temperature")
        self.assertEqual(status, 200, body)
        return body

    def test_01_all_four_profiles_succeed_with_real_model_data(self) -> None:
        for pid in TARGETS:
            body = self._get(pid)
            self.assertEqual(len(body["profile"]), 32)
            self.assertEqual(body["model"]["finite_level_count"], 32)  # all deep ocean
            self.assertEqual(body["model"]["null_level_count"], 0)

    def test_02_model_identity_variable_units(self) -> None:
        body = self._get("3902669_4")
        m = body["model"]
        self.assertEqual(m["dataset_id"], "glorys12v1_model")
        self.assertEqual(m["source"], "GLORYS12V1 / Copernicus Marine")
        self.assertEqual(m["variable"], "thetao")
        self.assertEqual(m["standard_name"], "sea_water_potential_temperature")
        self.assertEqual(m["units"], "degrees_C")
        self.assertEqual(m["copernicus_dataset_id"], "cmems_mod_glo_phy_my_0.083deg_P1D-m")
        blob = repr(body).lower()
        self.assertNotIn("godas", blob)
        self.assertNotIn("incois model", blob)

    def test_03_argo_coordinates_preserved_exactly(self) -> None:
        for pid, exp in TARGETS.items():
            o = self._get(pid)["observation"]
            self.assertEqual(o["platform_id"], pid)
            self.assertEqual(o["cycle_number"], int(pid.split("_")[1]))
            self.assertEqual(o["latitude"], exp["lat"])       # verbatim, no rounding
            self.assertEqual(o["longitude"], exp["lon"])
            self.assertEqual(o["timestamp"], exp["time"])

    def test_04_matched_coordinates_are_native_glorys_grid_points(self) -> None:
        lat_grid = self.ds["latitude"].values
        lon_grid = self.ds["longitude"].values
        for pid in TARGETS:
            m = self._get(pid)["model"]
            self.assertIn(np.float32(m["latitude"]), lat_grid)   # an actual grid coord
            self.assertIn(np.float32(m["longitude"]), lon_grid)

    def test_05_spatial_difference_is_correct(self) -> None:
        for pid, exp in TARGETS.items():
            sm = self._get(pid)["model"]["spatial_match"]
            self.assertAlmostEqual(
                sm["latitude_difference_deg"], sm["matched"]["latitude"] - exp["lat"], places=9
            )
            self.assertAlmostEqual(
                sm["longitude_difference_deg"], sm["matched"]["longitude"] - exp["lon"], places=9
            )
            # nearest native cell is within half a grid step (~0.0417 deg) each way
            self.assertLessEqual(abs(sm["latitude_difference_deg"]), 1 / 24 + 1e-6)
            self.assertLessEqual(abs(sm["longitude_difference_deg"]), 1 / 24 + 1e-6)
            self.assertGreater(sm["distance_km"], 0.0)
            self.assertLess(sm["distance_km"], 8.0)

    def test_06_temporal_matching_nearest_daily_and_difference(self) -> None:
        for pid, exp in TARGETS.items():
            tm = self._get(pid)["model"]["temporal_match"]
            self.assertEqual(tm["requested"], exp["time"])
            self.assertEqual(tm["matched"][:10], exp["m_day"])
            self.assertEqual(tm["matched"][11:], "00:00:00Z")  # a daily-mean label
            self.assertAlmostEqual(tm["difference_seconds"], exp["dt_s"], places=0)
            # recompute independently
            recomputed = abs((_iso_to_dt(tm["matched"]) - _iso_to_dt(exp["time"])).total_seconds())
            self.assertAlmostEqual(tm["difference_seconds"], recomputed, places=3)
            self.assertIn("DAILY MEAN", tm["note"])

    def test_07_matched_day_is_the_nearest_available_timestep(self) -> None:
        model_days = set(np.datetime_as_string(self.ds["time"].values, unit="D").tolist())
        for pid in TARGETS:
            m = self._get(pid)["model"]
            self.assertIn(m["timestamp"][:10], model_days)

    def test_08_32_native_depth_levels_unchanged(self) -> None:
        for pid in TARGETS:
            prof = self._get(pid)["profile"]
            self.assertEqual([round(r["depth"], 6) for r in prof], self.native_depth)
            self.assertEqual(self._get(pid)["model"]["depth_units"], "m")
            self.assertEqual(self._get(pid)["model"]["depth_positive"], "down")

    def test_09_temperatures_are_real_decoded_glorys_values(self) -> None:
        """API profile == xarray .sel(method='nearest') on the raw NetCDF, exactly."""
        for pid, exp in TARGETS.items():
            body = self._get(pid)
            col = (
                self.ds["thetao"]
                .sel(
                    time=np.datetime64(exp["m_day"]),
                    latitude=exp["lat"],
                    longitude=exp["lon"],
                    method="nearest",
                )
                .values.astype("float64")
            )
            got = [r["temperature"] for r in body["profile"]]
            self.assertEqual(len(got), col.size)
            for g, x in zip(got, col):
                if math.isnan(x):
                    self.assertIsNone(g)
                else:
                    self.assertEqual(g, x)  # bit-identical, no rounding / re-scaling
            # physically sensible: warm surface, monotone-ish cooling to depth
            finite = [t for t in got if t is not None]
            self.assertGreater(finite[0], 24.0)
            self.assertLess(finite[-1], 20.0)
            self.assertGreater(finite[0], finite[-1])

    def test_10_decoding_block_and_transparency_notes_present(self) -> None:
        body = self._get("5907179_3")
        dec = body["model"]["decoding"]
        self.assertTrue(dec["cf_mask_and_scale"])
        self.assertEqual(dec["raw_dtype"], "int16")
        joined = " ".join(body["notes"]).lower()
        for phrase in ("no spatial interpolation", "no temporal interpolation",
                       "native glorys depth levels", "daily mean",
                       "does not compute model-minus-observation"):
            self.assertIn(phrase, joined)

    def test_11_response_carries_the_model_coverage_block(self) -> None:
        cov = self._get("3902669_4")["coverage"]
        self.assertEqual(cov["time"]["count"], 10)
        self.assertEqual(cov["depth"]["count"], 32)
        self.assertAlmostEqual(cov["latitude"]["max"], 20.5, places=3)

    def test_12_no_null_token_in_json(self) -> None:
        import json

        status, raw = SRV.raw_get("/api/model-observations/argo/6990715_3/temperature")
        self.assertEqual(status, 200)
        json.loads(
            raw,
            parse_constant=lambda t: (_ for _ in ()).throw(AssertionError(f"bare {t}")),
        )


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ModelAtArgoErrors(unittest.TestCase):
    def test_01_unknown_platform_is_404(self) -> None:
        status, body = SRV.get("/api/model-observations/argo/9999999_1/temperature")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")
        self.assertIn("known_platform_ids", body["error"]["detail"])

    def test_02_unknown_cycle_is_404(self) -> None:
        # composite id convention: a real float, non-existent cycle
        status, body = SRV.get("/api/model-observations/argo/3902669_99/temperature")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")

    def test_03_malformed_identifier_is_422(self) -> None:
        for bad in ("not-an-id", "abc_1", "3902669", "3902669_"):
            status, body = SRV.get(f"/api/model-observations/argo/{bad}/temperature")
            self.assertEqual(status, 422, bad)
            self.assertEqual(body["error"]["type"], "malformed_request")

    def test_04_observation_outside_model_spatial_coverage_is_422(self) -> None:
        # 2903988_7: Bay of Bengal (85.85 E) -- east of the 61.5-70 E box
        status, body = SRV.get("/api/model-observations/argo/2903988_7/temperature")
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "observation_outside_model_coverage")
        self.assertIn("longitude", body["error"]["detail"]["outside"])
        self.assertIn("model_coverage", body["error"]["detail"])
        # no fallback, no fabricated profile
        self.assertNotIn("profile", body)

    def test_05_observation_outside_model_temporal_coverage_is_422(self) -> None:
        # 6990679_15: 2025-04-20, ~18 days after the model's last day
        status, body = SRV.get("/api/model-observations/argo/6990679_15/temperature")
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "observation_outside_model_coverage")
        self.assertIn("time", body["error"]["detail"]["outside"])

    def test_06_unavailable_model_dataset_is_503_no_fallback(self) -> None:
        base = _bnx_config()
        cfg = ApiConfig(
            data_dir=base.data_dir, cors_origins=base.cors_origins, build_on_startup=False,
            netcdf_path=MODEL_FILE.with_name("nope_not_here.nc"),
            netcdf_dataset_id="glorys12v1_model", netcdf_cf_decode=True,
        )
        with live_server(create_app(cfg)) as srv:
            status, body = srv.get("/api/model-observations/argo/3902669_4/temperature")
            self.assertEqual(status, 503)
            self.assertEqual(body["error"]["type"], "netcdf_unavailable")
            self.assertNotIn("profile", body)

    def test_07_does_not_fall_back_to_the_tiny_sample(self) -> None:
        # Even though the tiny sample would 'cover' 3902669_4, an unavailable
        # configured file must 503 -- never silently switch datasets.
        base = _bnx_config()
        cfg = ApiConfig(
            data_dir=base.data_dir, cors_origins=base.cors_origins, build_on_startup=False,
            netcdf_path=MODEL_FILE.with_name("nope_not_here.nc"),
            netcdf_dataset_id="glorys12v1_model", netcdf_cf_decode=True,
        )
        with live_server(create_app(cfg)) as srv:
            _, body = srv.get("/api/model-observations/argo/3902669_4/temperature")
            self.assertNotIn("temperature_cmems_glorys12v1_sample", repr(body))


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ExistingEndpointsUntouched(unittest.TestCase):
    def test_01_all_existing_endpoints_still_ok(self) -> None:
        for path in (
            "/api/health",
            "/api/datasets",
            "/api/netcdf/dataset",
            "/api/netcdf/variables/thetao",
            "/api/netcdf/variables/thetao/slice?time_index=0&depth_index=0",
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0",
            f"/api/datasets/{ANALYSIS}/parameters/salinity/slice?time_index=0&depth_index=0",
            f"/api/datasets/{CURRENTS}/parameters/current_speed/slice?time_index=0&depth_index=0",
            "/api/observations/argo",
            "/api/observations/argo/3902669_4",
            "/api/observations/gliders",
            "/api/observations/gliders/sea057_20220707",
        ):
            status, _ = SRV.get(path)
            self.assertEqual(status, 200, path)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
