"""Step 44 -- comparison-ready OBSERVED Argo temperature profile.

    GET /api/observations/argo/{platform_id}/temperature-profile

Real Argo temperature on its native pressure coordinate (`pressure_dbar`,
decibar), ascending pressure, both values finite, raw QC retained. No
interpolation / smoothing / decimation / gap-fill / unit conversion / QC
filtering. **No model temperature, no model-minus-observation difference.**

Tests run against the **real** Argo snapshot and compare directly to the raw
parsed profile -- no synthetic fixtures.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_observed_temperature_profile -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import ApiConfig  # noqa: E402
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402
from app.data.observations import ArgoProfilesReader  # noqa: E402
from app.data.observations.observed_profile import (  # noqa: E402
    extract_observed_temperature_profile,
    observed_temperature_points,
)

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"
GLORYS = project_root() / "data" / "raw" / "temperature_cmems_glorys12v1_arabiansea.nc"

TARGETS = ["3902669_4", "5907180_3", "5907179_3", "6990715_3"]

_ctx = None
SRV = None
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
    global _ctx, SRV, READER
    base = _bnx_config()
    cfg = ApiConfig(
        data_dir=base.data_dir, cors_origins=base.cors_origins, build_on_startup=False,
        netcdf_path=GLORYS if GLORYS.is_file() else None,
        netcdf_dataset_id="glorys12v1_model", netcdf_cf_decode=True,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()
    READER = ArgoProfilesReader().load()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


class PureExtraction(unittest.TestCase):
    """The pure core against the raw parsed profile."""

    def test_01_points_are_verbatim_pairs_sorted_ascending(self) -> None:
        for pid in TARGETS:
            prof = READER.get(pid)
            pts = observed_temperature_points(prof.levels)
            # every kept point equals a real source level, both values finite
            src = [
                (lv.pressure, lv.temperature)
                for lv in prof.levels
                if lv.pressure is not None and lv.temperature is not None
            ]
            self.assertEqual(
                [(p["pressure_dbar"], p["temperature"]) for p in pts],
                sorted(src, key=lambda t: t[0]),
            )
            # ascending, and a pure reordering (same multiset of values)
            press = [p["pressure_dbar"] for p in pts]
            self.assertEqual(press, sorted(press))
            self.assertEqual(sorted(p["temperature"] for p in pts),
                             sorted(t for _, t in src))

    def test_02_only_pairs_finite_on_both_axes(self) -> None:
        # synthetic-level list (records only, still real ArgoLevel type) to
        # exercise the pairing rule -- no scientific values invented.
        from app.data.observations.argo import ArgoLevel

        levels = [
            ArgoLevel(5.0, "1", 25.0, "1", None, None),   # kept
            ArgoLevel(None, "9", 24.0, "1", None, None),  # dropped: pressure null
            ArgoLevel(10.0, "1", None, "9", None, None),  # dropped: temp null
            ArgoLevel(3.0, "1", 26.0, "3", None, None),   # kept, QC 3 retained
            ArgoLevel(float("nan"), "1", 20.0, "1", None, None),  # dropped: non-finite
        ]
        pts = observed_temperature_points(levels)
        self.assertEqual(
            pts,
            [
                {"pressure_dbar": 3.0, "temperature": 26.0, "pressure_qc": "1", "temperature_qc": "3"},
                {"pressure_dbar": 5.0, "temperature": 25.0, "pressure_qc": "1", "temperature_qc": "1"},
            ],
        )

    def test_03_payload_metadata_counts(self) -> None:
        prof = READER.get("3902669_4")
        d = extract_observed_temperature_profile(prof, {"x": 1})
        m = d["metadata"]
        self.assertEqual(m["vertical_coordinate"], "pressure_dbar")
        self.assertEqual(m["vertical_coordinate_units"], "decibar")
        self.assertEqual(m["units"], "degree_Celsius")
        self.assertEqual(m["variable"], "sea_water_temperature")
        self.assertEqual(m["source_level_count"], prof.level_count)
        self.assertEqual(m["point_count"], len(d["profile"]))
        self.assertEqual(
            m["finite_temperature_count"] + m["null_temperature_count"], prof.level_count
        )
        self.assertFalse(m["qc"]["filtering_applied"])
        self.assertTrue(m["qc"]["flags_retained"])
        self.assertEqual(d["provenance"], {"x": 1})


@unittest.skipUnless(True, "")
class ObservedTemperatureApi(unittest.TestCase):
    def _get(self, pid: str) -> dict:
        status, body = SRV.get(f"/api/observations/argo/{pid}/temperature-profile")
        self.assertEqual(status, 200, body)
        return body

    def test_01_all_four_targets_succeed(self) -> None:
        for pid in TARGETS:
            body = self._get(pid)
            self.assertGreater(len(body["profile"]), 90)

    def test_02_platform_cycle_metadata(self) -> None:
        for pid in TARGETS:
            o = self._get(pid)["observation"]
            num, cyc = pid.split("_")
            self.assertEqual(o["platform_id"], pid)
            self.assertEqual(o["platform_number"], num)
            self.assertEqual(o["cycle_number"], int(cyc))
            self.assertEqual(o["source"], "INCOIS Argo float profile (in-situ CTD)")
            self.assertEqual(o["dataset_id"], "incois_indian_argo_floats")

    def test_03_position_and_timestamp_preserved(self) -> None:
        for pid in TARGETS:
            src = READER.get(pid)
            o = self._get(pid)["observation"]
            self.assertEqual(o["latitude"], src.latitude)     # verbatim, unrounded
            self.assertEqual(o["longitude"], src.longitude)
            self.assertEqual(o["timestamp"], src.time)

    def test_04_units_and_vertical_coordinate(self) -> None:
        m = self._get("5907180_3")["metadata"]
        self.assertEqual(m["units"], "degree_Celsius")
        self.assertEqual(m["vertical_coordinate"], "pressure_dbar")
        self.assertEqual(m["vertical_coordinate_units"], "decibar")

    def test_05_pressure_and_temperature_values_unchanged(self) -> None:
        """Every returned pair equals a real source level exactly."""
        for pid in TARGETS:
            src_pairs = {
                (round(lv.pressure, 6), round(lv.temperature, 6))
                for lv in READER.get(pid).levels
                if lv.pressure is not None and lv.temperature is not None
            }
            for p in self._get(pid)["profile"]:
                self.assertIn(
                    (round(p["pressure_dbar"], 6), round(p["temperature"], 6)), src_pairs
                )

    def test_06_profile_is_ascending_pressure_no_reorder_of_values(self) -> None:
        for pid in TARGETS:
            prof = self._get(pid)["profile"]
            press = [p["pressure_dbar"] for p in prof]
            self.assertEqual(press, sorted(press))
            # same set of temperatures as the raw finite-pair set (pure reorder)
            raw = sorted(
                lv.temperature
                for lv in READER.get(pid).levels
                if lv.pressure is not None and lv.temperature is not None
            )
            self.assertEqual(sorted(p["temperature"] for p in prof), raw)

    def test_07_no_interpolation_or_smoothing(self) -> None:
        # point_count == number of finite (pressure & temp) source levels;
        # nothing added, nothing invented between levels.
        for pid in TARGETS:
            src_n = sum(
                1
                for lv in READER.get(pid).levels
                if lv.pressure is not None and lv.temperature is not None
            )
            body = self._get(pid)
            self.assertEqual(body["metadata"]["point_count"], src_n)
            self.assertEqual(len(body["profile"]), src_n)

    def test_08_no_synthetic_or_fallback_values(self) -> None:
        for pid in TARGETS:
            for p in self._get(pid)["profile"]:
                self.assertNotEqual(p["temperature"], 99999.0)  # Argo fill
                self.assertIsNotNone(p["temperature"])
                self.assertIsNotNone(p["pressure_dbar"])

    def test_09_missing_values_counted_consistently(self) -> None:
        for pid in TARGETS:
            m = self._get(pid)["metadata"]
            self.assertEqual(
                m["finite_temperature_count"] + m["null_temperature_count"],
                m["source_level_count"],
            )
            # these 4 target profiles are all-finite
            self.assertEqual(m["null_temperature_count"], 0)
            self.assertEqual(m["point_count"], m["finite_temperature_count"])

    def test_10_qc_metadata_retained_no_filtering(self) -> None:
        # 2903988_7 carries QC "3" ("probably bad data") on some levels
        body = SRV.get("/api/observations/argo/2903988_7/temperature-profile")[1]
        m = body["metadata"]
        self.assertFalse(m["qc"]["filtering_applied"])
        self.assertIn("3", m["qc"]["temperature_qc_codes_present"])
        self.assertIn("3", m["qc"]["definition"])
        kept_bad = [p for p in body["profile"] if p["temperature_qc"] == "3"]
        self.assertGreater(len(kept_bad), 0)  # bad-flagged values are NOT dropped
        # and its count still equals all finite source pairs
        src_n = sum(
            1
            for lv in READER.get("2903988_7").levels
            if lv.pressure is not None and lv.temperature is not None
        )
        self.assertEqual(m["point_count"], src_n)

    def test_11_transparency_notes_and_no_model(self) -> None:
        body = self._get("6990715_3")
        joined = " ".join(body["notes"]).lower()
        for phrase in ("observation", "no interpolation", "not converted to depth",
                       "ascending pressure", "no qc filtering", "step 45"):
            self.assertIn(phrase, joined)
        # nothing about GLORYS / model / difference in a Step 44 payload
        blob = repr(body).lower()
        self.assertNotIn("glorys", blob)
        self.assertNotIn("thetao", blob)
        self.assertNotIn("model_minus", blob)

    def test_12_unknown_platform_404(self) -> None:
        status, body = SRV.get("/api/observations/argo/9999999_1/temperature-profile")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")

    def test_13_unknown_cycle_404(self) -> None:
        status, body = SRV.get("/api/observations/argo/3902669_99/temperature-profile")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")

    def test_14_malformed_identifier_422(self) -> None:
        for bad in ("not-an-id", "abc_1", "3902669", "_1"):
            status, body = SRV.get(f"/api/observations/argo/{bad}/temperature-profile")
            self.assertEqual(status, 422, bad)
            self.assertEqual(body["error"]["type"], "malformed_request")

    def test_15_no_nan_token_in_json(self) -> None:
        import json

        status, raw = SRV.raw_get("/api/observations/argo/5907179_3/temperature-profile")
        self.assertEqual(status, 200)
        json.loads(raw, parse_constant=lambda t: (_ for _ in ()).throw(AssertionError(t)))


class ExistingEndpointsUntouched(unittest.TestCase):
    def test_01_argo_detail_endpoint_unchanged(self) -> None:
        status, body = SRV.get("/api/observations/argo/3902669_4")
        self.assertEqual(status, 200)
        # still the full level record, with salinity + all QC, in file order
        self.assertIn("levels", body)
        self.assertEqual(set(body["levels"][0].keys()),
                         {"pressure", "pressure_qc", "temperature", "temperature_qc",
                          "salinity", "salinity_qc"})
        self.assertEqual(body["level_count"], len(body["levels"]))

    def test_02_step43_model_observation_endpoint_unchanged(self) -> None:
        if not GLORYS.is_file():
            self.skipTest("GLORYS file not present")
        status, body = SRV.get("/api/model-observations/argo/3902669_4/temperature")
        self.assertEqual(status, 200)
        self.assertEqual(body["model"]["dataset_id"], "glorys12v1_model")
        self.assertEqual(len(body["profile"]), 32)

    def test_03_all_other_endpoints_still_ok(self) -> None:
        paths = [
            "/api/health",
            "/api/datasets",
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0",
            f"/api/datasets/{ANALYSIS}/parameters/salinity/slice?time_index=0&depth_index=0",
            f"/api/datasets/{CURRENTS}/parameters/current_speed/slice?time_index=0&depth_index=0",
            "/api/observations/argo",
            "/api/observations/gliders",
            "/api/observations/gliders/sea057_20220707",
        ]
        if GLORYS.is_file():
            paths += ["/api/netcdf/dataset", "/api/netcdf/variables/thetao/slice?time_index=0&depth_index=0"]
        for p in paths:
            self.assertEqual(SRV.get(p)[0], 200, p)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
