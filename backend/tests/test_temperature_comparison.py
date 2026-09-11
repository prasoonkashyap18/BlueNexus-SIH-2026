"""Step 45 -- GLORYS12V1 model - Argo observation temperature difference.

    GET /api/model-observations/argo/{platform_id}/temperature-comparison

TEOS-10 (GSW) pressure->depth, adaptive nearest-depth matching (half the local
GLORYS spacing), one row per native GLORYS depth level,
``difference_c = model - observed``. NO interpolation, NO index pairing.

Every expected value is **independently recomputed** here from the real
validated NetCDF + the real Argo snapshot (xarray + gsw), not from the service.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_temperature_comparison -v
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import gsw
import numpy as np
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import MODEL_SOURCE_LABEL, ApiConfig  # noqa: E402
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.comparison import adaptive_max_separation_m  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402
from app.data.observations import ArgoProfilesReader  # noqa: E402

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"
RAW = project_root() / "data" / "raw"
MODEL_FILE = RAW / "temperature_cmems_glorys12v1_arabiansea.nc"

# platform -> Step 43 matched (lat, lon, model day)  [from Step 43, unchanged]
TARGETS = {
    "3902669_4": (19.666666666666668, 64.65, "2025-04-01"),
    "5907180_3": (16.533333333333335, 68.66666666666667, "2025-03-27"),
    "5907179_3": (12.316666666666666, 68.15, "2025-03-29"),
    "6990715_3": (9.4, 68.45, "2025-04-02"),
}

_ctx = None
SRV = None
DS: xr.Dataset | None = None
READER: ArgoProfilesReader | None = None


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
    global _ctx, SRV, DS, READER
    if not MODEL_FILE.is_file():
        raise unittest.SkipTest(f"GLORYS Arabian Sea file not present: {MODEL_FILE}")
    base = _bnx_config()
    cfg = ApiConfig(
        data_dir=base.data_dir, cors_origins=base.cors_origins, build_on_startup=False,
        netcdf_path=MODEL_FILE, netcdf_dataset_id="glorys12v1_model",
        netcdf_cf_decode=True, netcdf_source_label=MODEL_SOURCE_LABEL,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()
    DS = xr.open_dataset(MODEL_FILE, mask_and_scale=True, decode_times=True)
    READER = ArgoProfilesReader().load()


def tearDownModule() -> None:
    if DS is not None:
        DS.close()
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


def _independent_comparison(pid: str) -> dict:
    """Recompute the whole comparison from raw data, independently of the service."""
    lat, lon, mday = TARGETS[pid]
    gdepth = DS["depth"].values.astype("float64")
    col = (
        DS["thetao"]
        .sel(time=np.datetime64(mday), latitude=lat, longitude=lon, method="nearest")
        .values.astype("float64")
    )
    prof = READER.get(pid)
    ap = np.array(
        [lv.pressure for lv in prof.levels if lv.pressure is not None and lv.temperature is not None],
        dtype="float64",
    )
    at = np.array(
        [lv.temperature for lv in prof.levels if lv.pressure is not None and lv.temperature is not None],
        dtype="float64",
    )
    az = -gsw.z_from_p(ap, lat)
    tol = adaptive_max_separation_m(gdepth)

    diffs = []
    matched = 0
    per_level = []
    for i, gd in enumerate(gdepth):
        k = int(np.argmin(np.abs(az - gd)))
        sep = float(abs(az[k] - gd))
        if sep <= tol[i] and math.isfinite(col[i]) and math.isfinite(at[k]):
            d = float(col[i]) - float(at[k])
            diffs.append(d)
            matched += 1
            per_level.append((i, gd, float(col[i]), float(ap[k]), float(az[k]), float(at[k]), sep, d))
        else:
            per_level.append((i, gd, float(col[i]) if math.isfinite(col[i]) else None,
                              None, None, None, None, None))
    diffs = np.array(diffs, dtype="float64")
    stats = {
        "matched_count": matched,
        "mean_difference_c": float(diffs.mean()),
        "mean_absolute_difference_c": float(np.abs(diffs).mean()),
        "minimum_difference_c": float(diffs.min()),
        "maximum_difference_c": float(diffs.max()),
        "rmse_c": float(np.sqrt(np.mean(diffs**2))),
    }
    argo_below = int((az > gdepth[-1]).sum())
    return {"stats": stats, "per_level": per_level, "argo_below": argo_below,
            "gdepth": gdepth, "tol": tol, "model_col": col}


@unittest.skipUnless(MODEL_FILE.is_file(), "model file not present")
class ComparisonApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bodies = {}
        for pid in TARGETS:
            status, body = SRV.get(f"/api/model-observations/argo/{pid}/temperature-comparison")
            assert status == 200, body
            cls.bodies[pid] = body
        cls.indep = {pid: _independent_comparison(pid) for pid in TARGETS}

    def test_01_all_four_profiles_compare(self) -> None:
        for pid in TARGETS:
            b = self.bodies[pid]
            self.assertEqual(len(b["profile"]), 32)
            self.assertGreater(b["matching"]["matched_level_count"], 0)

    def test_02_sources_variables_units(self) -> None:
        c = self.bodies["3902669_4"]["comparison"]
        self.assertEqual(c["model_source"], "GLORYS12V1 / Copernicus Marine")
        self.assertIn("Argo", c["observation_source"])
        self.assertEqual(c["model_variable"], "thetao")
        self.assertEqual(c["observation_variable"], "sea_water_temperature")
        self.assertEqual(c["model_units"], "degrees_C")
        self.assertEqual(c["observation_units"], "degree_Celsius")

    def test_03_difference_definition_is_model_minus_observation(self) -> None:
        c = self.bodies["5907180_3"]["comparison"]
        self.assertEqual(
            c["difference_definition"],
            "difference_c = model_temperature_c - observed_temperature_c "
            "(positive => model warmer than observation)",
        )

    def test_04_model_depth_is_native_glorys_unchanged(self) -> None:
        native = [round(float(x), 6) for x in self.indep["3902669_4"]["gdepth"]]
        for pid in TARGETS:
            got = [round(r["model_depth_m"], 6) for r in self.bodies[pid]["profile"]]
            self.assertEqual(got, native)

    def test_05_original_argo_pressure_unchanged_and_depth_is_separate(self) -> None:
        for pid in TARGETS:
            src_pres = {
                round(lv.pressure, 6)
                for lv in READER.get(pid).levels
                if lv.pressure is not None and lv.temperature is not None
            }
            for r in self.bodies[pid]["profile"]:
                if r["argo_pressure_dbar"] is not None:
                    self.assertIn(round(r["argo_pressure_dbar"], 6), src_pres)
                    # derived depth is a DIFFERENT number from the pressure
                    self.assertNotEqual(r["argo_depth_m"], r["argo_pressure_dbar"])
                    # and slightly shallower than the pressure value (TEOS-10)
                    self.assertLess(r["argo_depth_m"], r["argo_pressure_dbar"])

    def test_06_teos10_gsw_is_the_documented_method(self) -> None:
        m = self.bodies["3902669_4"]["matching"]
        self.assertEqual(m["gsw_function"], "gsw.z_from_p")
        self.assertEqual(m["gsw_version"], gsw.__version__)
        self.assertIn("gsw.z_from_p", m["observation_depth_method"])
        self.assertIn("local_spacing", m["adaptive_tolerance_rule"])

    def test_07_no_index_based_subtraction(self) -> None:
        """A matched row's Argo pressure is chosen by depth proximity, not by the
        GLORYS level index."""
        for pid in TARGETS:
            for i, r in enumerate(self.bodies[pid]["profile"]):
                if r["matched"]:
                    # the argo level index that produced this pressure is generally != i
                    self.assertIsNotNone(r["argo_depth_m"])
                    self.assertLessEqual(
                        r["vertical_separation_m"], r["max_vertical_separation_m"] + 1e-9
                    )

    def test_08_every_point_has_a_vertical_separation_and_tolerance(self) -> None:
        for pid in TARGETS:
            for r in self.bodies[pid]["profile"]:
                self.assertIsInstance(r["max_vertical_separation_m"], float)
                if r["argo_pressure_dbar"] is not None:
                    self.assertIsInstance(r["vertical_separation_m"], float)

    def test_09_adaptive_tolerance_matches_the_documented_formula(self) -> None:
        tol = self.indep["3902669_4"]["tol"]
        got = self.bodies["3902669_4"]["matching"]["maximum_vertical_separation_m"]
        np.testing.assert_allclose(got, tol, rtol=0, atol=1e-9)
        # spot: interior level i -> (d[i+1]-d[i-1])/4 ; ends -> adjacent gap / 2
        d = self.indep["3902669_4"]["gdepth"]
        self.assertAlmostEqual(got[0], (d[1] - d[0]) / 2, places=9)
        self.assertAlmostEqual(got[15], (d[16] - d[14]) / 4, places=9)
        self.assertAlmostEqual(got[-1], (d[-1] - d[-2]) / 2, places=9)

    def test_10_points_deeper_than_glorys_are_excluded(self) -> None:
        for pid in TARGETS:
            b = self.bodies[pid]
            gmax = b["matching"]["model_depth_range_m"]["max"]
            for r in b["profile"]:
                if r["argo_depth_m"] is not None and r["matched"]:
                    self.assertLessEqual(r["argo_depth_m"], gmax + r["max_vertical_separation_m"])
            self.assertEqual(
                b["matching"]["argo_observations_below_model_depth"],
                self.indep[pid]["argo_below"],
            )
            self.assertGreater(b["matching"]["argo_observations_below_model_depth"], 40)

    def test_11_difference_equals_model_minus_observed_exactly(self) -> None:
        for pid in TARGETS:
            for r in self.bodies[pid]["profile"]:
                if r["matched"]:
                    self.assertEqual(
                        r["difference_c"],
                        r["model_temperature_c"] - r["observed_temperature_c"],
                    )
                else:
                    self.assertIsNone(r["difference_c"])

    def test_12_values_match_an_independent_recompute(self) -> None:
        for pid in TARGETS:
            api = {i: r for i, r in enumerate(self.bodies[pid]["profile"])}
            for row in self.indep[pid]["per_level"]:
                i = row[0]
                r = api[i]
                if row[6] is None:  # independent: unmatched
                    self.assertFalse(r["matched"], f"{pid} L{i}")
                else:
                    _, gd, mc, ap, az, ot, sep, diff = row
                    self.assertTrue(r["matched"], f"{pid} L{i}")
                    self.assertAlmostEqual(r["argo_pressure_dbar"], ap, places=6)
                    self.assertAlmostEqual(r["argo_depth_m"], az, places=6)
                    self.assertAlmostEqual(r["observed_temperature_c"], ot, places=9)
                    self.assertAlmostEqual(r["vertical_separation_m"], sep, places=6)
                    self.assertAlmostEqual(r["difference_c"], diff, places=9)

    def test_13_missing_model_or_obs_never_produces_a_fake_difference(self) -> None:
        for pid in TARGETS:
            for r in self.bodies[pid]["profile"]:
                if r["model_temperature_c"] is None or r["observed_temperature_c"] is None:
                    self.assertIsNone(r["difference_c"])
                    self.assertFalse(r["matched"])

    def test_14_qc_flags_available_on_matched_points(self) -> None:
        b = self.bodies["3902669_4"]
        self.assertFalse(b["observation"]["qc"]["filtering_applied"])
        for r in b["profile"]:
            if r["matched"]:
                self.assertIsNotNone(r["observed_temperature_qc"])

    def test_15_statistics_use_only_valid_matched_points(self) -> None:
        for pid in TARGETS:
            b = self.bodies[pid]
            st = b["statistics"]
            n_matched = sum(1 for r in b["profile"] if r["matched"])
            self.assertEqual(st["matched_count"], n_matched)
            self.assertIn("valid matched", st["population"])

    def test_16_mean_mae_rmse_are_independently_reproducible(self) -> None:
        for pid in TARGETS:
            st = self.bodies[pid]["statistics"]
            exp = self.indep[pid]["stats"]
            self.assertEqual(st["matched_count"], exp["matched_count"])
            for k in ("mean_difference_c", "mean_absolute_difference_c",
                      "minimum_difference_c", "maximum_difference_c", "rmse_c"):
                self.assertAlmostEqual(st[k], exp[k], places=9, msg=f"{pid} {k}")

    def test_17_spatial_temporal_match_reused_from_step43(self) -> None:
        for pid in TARGETS:
            _, s43 = SRV.get(f"/api/model-observations/argo/{pid}/temperature")
            cmp = self.bodies[pid]["model"]
            self.assertEqual(cmp["latitude"], s43["model"]["latitude"])
            self.assertEqual(cmp["longitude"], s43["model"]["longitude"])
            self.assertEqual(cmp["timestamp"], s43["model"]["timestamp"])
            self.assertEqual(
                cmp["temporal_match"]["difference_seconds"],
                s43["model"]["temporal_match"]["difference_seconds"],
            )
            self.assertEqual(
                cmp["spatial_match"]["distance_km"],
                s43["model"]["spatial_match"]["distance_km"],
            )

    def test_18_transparency_notes(self) -> None:
        notes = " ".join(self.bodies["6990715_3"]["notes"]).lower()
        for phrase in ("daily mean", "teos-10", "no interpolation", "positive => model warmer",
                       "not validation against a simultaneous", "no qc filtering"):
            self.assertIn(phrase, notes)

    def test_19_no_nan_token_in_json(self) -> None:
        import json

        status, raw = SRV.raw_get("/api/model-observations/argo/5907179_3/temperature-comparison")
        self.assertEqual(status, 200)
        json.loads(raw, parse_constant=lambda t: (_ for _ in ()).throw(AssertionError(t)))


@unittest.skipUnless(MODEL_FILE.is_file(), "model file not present")
class ComparisonNumericSanity(unittest.TestCase):
    """3902669_4 -- first / middle / deepest matched levels, by hand."""

    def test_spot_check_3902669_4(self) -> None:
        _, body = SRV.get("/api/model-observations/argo/3902669_4/temperature-comparison")
        matched = [r for r in body["profile"] if r["matched"]]
        for r in [matched[0], matched[1], matched[len(matched) // 2], matched[-1]]:
            expected = r["model_temperature_c"] - r["observed_temperature_c"]
            self.assertEqual(r["difference_c"], expected)
        deepest = matched[-1]
        self.assertLessEqual(deepest["model_depth_m"], 541.09)
        self.assertGreater(deepest["model_depth_m"], 450.0)


@unittest.skipUnless(MODEL_FILE.is_file(), "model file not present")
class ComparisonErrors(unittest.TestCase):
    def test_01_unknown_platform_404(self) -> None:
        status, body = SRV.get("/api/model-observations/argo/9999999_1/temperature-comparison")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")

    def test_02_unknown_cycle_404(self) -> None:
        status, body = SRV.get("/api/model-observations/argo/3902669_99/temperature-comparison")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")

    def test_03_malformed_422(self) -> None:
        for bad in ("not-an-id", "abc_1", "3902669"):
            status, body = SRV.get(f"/api/model-observations/argo/{bad}/temperature-comparison")
            self.assertEqual(status, 422, bad)
            self.assertEqual(body["error"]["type"], "malformed_request")

    def test_04_out_of_model_coverage_422(self) -> None:
        # 2903988_7 -- Bay of Bengal, east of the box
        status, body = SRV.get("/api/model-observations/argo/2903988_7/temperature-comparison")
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "observation_outside_model_coverage")
        self.assertNotIn("profile", body)

    def test_05_out_of_temporal_coverage_422(self) -> None:
        status, body = SRV.get("/api/model-observations/argo/6990679_15/temperature-comparison")
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "observation_outside_model_coverage")

    def test_06_no_synthetic_when_model_absent(self) -> None:
        base = _bnx_config()
        cfg = ApiConfig(
            data_dir=base.data_dir, cors_origins=base.cors_origins, build_on_startup=False,
            netcdf_path=MODEL_FILE.with_name("nope.nc"),
            netcdf_dataset_id="glorys12v1_model", netcdf_cf_decode=True,
        )
        with live_server(create_app(cfg)) as srv:
            status, body = srv.get("/api/model-observations/argo/3902669_4/temperature-comparison")
            self.assertEqual(status, 503)
            self.assertEqual(body["error"]["type"], "netcdf_unavailable")
            self.assertNotIn("profile", body)


@unittest.skipUnless(MODEL_FILE.is_file(), "model file not present")
class ExistingEndpointsUntouched(unittest.TestCase):
    def test_01_step43_and_step44_unchanged(self) -> None:
        _, s43 = SRV.get("/api/model-observations/argo/3902669_4/temperature")
        self.assertEqual(len(s43["profile"]), 32)
        self.assertNotIn("difference_c", repr(s43))  # Step 43 has no difference
        _, s44 = SRV.get("/api/observations/argo/3902669_4/temperature-profile")
        self.assertEqual(s44["metadata"]["vertical_coordinate"], "pressure_dbar")
        self.assertNotIn("glorys", repr(s44).lower())  # Step 44 has no model

    def test_02_all_data_endpoints_ok(self) -> None:
        for p in (
            "/api/health", "/api/datasets", "/api/netcdf/dataset",
            "/api/netcdf/variables/thetao/slice?time_index=0&depth_index=0",
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0",
            f"/api/datasets/{ANALYSIS}/parameters/salinity/slice?time_index=0&depth_index=0",
            f"/api/datasets/{CURRENTS}/parameters/current_speed/slice?time_index=0&depth_index=0",
            "/api/observations/argo", "/api/observations/gliders",
            "/api/observations/gliders/sea057_20220707",
        ):
            self.assertEqual(SRV.get(p)[0], 200, p)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
