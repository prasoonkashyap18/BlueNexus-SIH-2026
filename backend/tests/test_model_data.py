"""Step 42 -- real ocean MODEL TEMPERATURE integration (MERCATOR GLORYS12V1).

The validated GLORYS12V1 potential-temperature files (Copernicus Marine, product
``GLOBAL_MULTIYEAR_PHY_001_030`` / dataset ``cmems_mod_glo_phy_my_0.083deg_P1D-m``,
DOI 10.48670/moi-00021; variable ``thetao``, packed ``int16``) are served through
the existing Step 37-39 scientific / NetCDF layer at ``/api/netcdf``.

Two files, same product, different subsets:

* ``temperature_cmems_glorys12v1_arabiansea.nc`` -- Step 42 data-coverage
  expansion. Arabian Sea box 61.5-70 E, 8-20.5 N, 2025-03-24..2025-04-02,
  0.494-541.089 m (32 native levels); chosen to overlap 4 real INCOIS Argo
  profiles. **This is the default model file.**
* ``temperature_cmems_glorys12v1_sample.nc`` -- the original tiny validation
  sample, preserved unchanged; the fallback default.

These tests prove:

* the larger file is discovered from config with no env var,
* ``thetao`` + its native ``time x depth x latitude x longitude`` dims and real
  coordinate vectors are exposed with NO regridding (grid points stay on the
  native GLORYS 1/12 grid, depth on the native levels),
* CF ``scale_factor`` / ``add_offset`` / ``_FillValue`` decoding is applied --
  values are real ``degrees_C``, never packed ``int16``; packed fill -> ``null``,
* the raw files on disk are byte-for-byte unchanged,
* the larger file and the tiny sample are the same product (identical values in
  the overlapping cells),
* the API reports the file's *actual* coverage dynamically -- nothing is
  hard-coded to a subset size,
* the 4 target Argo profiles fall inside the model coverage (space + time) --
  NO model-vs-observation difference is computed (that is Step 43+),
* model source identity is the explicit ``"GLORYS12V1 / Copernicus Marine"``,
* the existing INCOIS ``.bnx`` datasets and observation endpoints are untouched.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_model_data -v
"""

from __future__ import annotations

import hashlib
import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import (  # noqa: E402
    MODEL_NETCDF_DATASET_ID,
    MODEL_NETCDF_SAMPLE_FILENAME,
    MODEL_SOURCE_LABEL,
    ApiConfig,
    default_model_netcdf_path,
)
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402
from app.data.scientific import open_scientific_netcdf  # noqa: E402
from app.services.netcdf_service import NetCDFDataService  # noqa: E402

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"
IO_HOOFS_FILE = project_root() / "data" / "raw" / "currents_incois_io-hoofs_sample.nc"

RAW = project_root() / "data" / "raw"
MODEL_FILE = RAW / "temperature_cmems_glorys12v1_arabiansea.nc"
SAMPLE_FILE = RAW / "temperature_cmems_glorys12v1_sample.nc"
SAMPLE_SHA256 = "ab79f4394c5e6fd35bd205185831fb5ed45e8730f8d6589573e1cd9cffede994"
ARABIANSEA_SHA256 = "08aee6649b2dbfa34a1a553310ae02902c27c5bbcfcb4afba8fa5e1370ecd1ea"

# The 4 Argo profiles the Step 42 subset was designed to overlap (lat, lon, date).
TARGET_ARGO = {
    "3902669_4": (19.66666667, 64.65, "2025-03-31"),
    "5907180_3": (16.53333333, 68.66666667, "2025-03-26"),
    "5907179_3": (12.31666667, 68.15, "2025-03-28"),
    "6990715_3": (9.4, 68.45, "2025-04-01"),
}

# Native GLORYS12V1 vertical grid, top 32 levels (0 -> ~541 m).
NATIVE_DEPTH_32 = [
    0.494, 1.541, 2.646, 3.819, 5.078, 6.441, 7.93, 9.573, 11.405, 13.467, 15.81,
    18.496, 21.599, 25.211, 29.445, 34.434, 40.344, 47.374, 55.764, 65.807, 77.854,
    92.326, 109.729, 130.666, 155.851, 186.126, 222.475, 266.04, 318.127, 380.213,
    453.938, 541.089,
]

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
    return ApiConfig(
        data_dir=data_dir,
        cors_origins=("http://localhost:5173",),
        build_on_startup=False,
    )


def setUpModule() -> None:
    global _ctx, SRV
    if not MODEL_FILE.is_file():
        raise unittest.SkipTest(f"GLORYS Arabian Sea file not present: {MODEL_FILE}")
    base = _bnx_config()
    # Mirror what ApiConfig.from_env() produces for the default model file.
    cfg = ApiConfig(
        data_dir=base.data_dir,
        cors_origins=base.cors_origins,
        build_on_startup=False,
        netcdf_path=MODEL_FILE,
        netcdf_dataset_id=MODEL_NETCDF_DATASET_ID,
        netcdf_cf_decode=True,
        netcdf_source_label=MODEL_SOURCE_LABEL,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ModelDatasetSelection(unittest.TestCase):
    """Step 42: the larger validated GLORYS file is the default -- no env var."""

    def test_01_from_env_defaults_to_the_arabiansea_file(self) -> None:
        cfg = ApiConfig.from_env()
        self.assertIsNotNone(cfg.netcdf_path)
        self.assertEqual(cfg.netcdf_path, MODEL_FILE.resolve())
        self.assertEqual(cfg.netcdf_dataset_id, "glorys12v1_model")
        self.assertTrue(cfg.netcdf_cf_decode)  # packed int16 -> must decode
        self.assertEqual(cfg.netcdf_source_label, "GLORYS12V1 / Copernicus Marine")

    def test_02_default_path_prefers_larger_falls_back_to_sample(self) -> None:
        self.assertEqual(default_model_netcdf_path(), MODEL_FILE)
        self.assertEqual(MODEL_NETCDF_SAMPLE_FILENAME, "temperature_cmems_glorys12v1_sample.nc")
        # The fallback file really exists and is a valid GLORYS file too.
        self.assertTrue(SAMPLE_FILE.is_file())

    def test_03_both_repo_files_match_their_validated_sha256(self) -> None:
        self.assertEqual(hashlib.sha256(MODEL_FILE.read_bytes()).hexdigest(), ARABIANSEA_SHA256)
        self.assertEqual(hashlib.sha256(SAMPLE_FILE.read_bytes()).hexdigest(), SAMPLE_SHA256)


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ModelScientificLayer(unittest.TestCase):
    """Loads through the Step 37/38 scientific layer; native grid preserved."""

    def test_01_discovery_thetao_and_native_dimensions(self) -> None:
        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            self.assertEqual(sci.variable_names(), ("thetao",))
            self.assertEqual(
                sci.dimensions(),
                {"time": 10, "depth": 32, "latitude": 151, "longitude": 103},
            )
            var = sci.variable("thetao")
            self.assertEqual(var.dimensions, ("time", "depth", "latitude", "longitude"))
            self.assertEqual(
                var.attributes.get("standard_name"), "sea_water_potential_temperature"
            )
            self.assertEqual(var.units, "degrees_C")

    def test_02_no_regrid_grid_on_native_glorys_twelfth_degree(self) -> None:
        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            lat = sci.coordinate("latitude").values().astype("float64")
            lon = sci.coordinate("longitude").values().astype("float64")
            # native GLORYS points sit exactly on k/12 in this region
            np.testing.assert_allclose(lat * 12, np.round(lat * 12), atol=1e-3)
            np.testing.assert_allclose(lon * 12, np.round(lon * 12), atol=1e-3)
            self.assertTrue(np.all(np.diff(lat) > 0) and np.all(np.diff(lon) > 0))
            self.assertAlmostEqual(float(lat.min()), 8.0, places=3)
            self.assertAlmostEqual(float(lat.max()), 20.5, places=3)
            self.assertAlmostEqual(float(lon.min()), 61.5, places=3)
            self.assertAlmostEqual(float(lon.max()), 70.0, places=3)
            # spacing == 1/12
            self.assertAlmostEqual(float(np.diff(lat).mean()), 1 / 12, places=5)

    def test_03_native_depth_levels_unchanged(self) -> None:
        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            dep = sci.coordinate("depth")
            dv = [round(float(x), 3) for x in dep.values()]
            self.assertEqual(dv, NATIVE_DEPTH_32)
            self.assertEqual(dep.units, "m")
            self.assertEqual(dep.attributes.get("positive"), "down")

    def test_04_time_is_10_daily_steps_decoded(self) -> None:
        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            tv = sci.coordinate("time").values()
            self.assertEqual(tv.dtype.kind, "M")
            self.assertEqual(tv.size, 10)
            days = np.datetime_as_string(tv, unit="D").tolist()
            self.assertEqual(days[0], "2025-03-24")
            self.assertEqual(days[-1], "2025-04-02")
            spacing = np.unique(np.diff(tv) / np.timedelta64(1, "D")).tolist()
            self.assertEqual(spacing, [1.0])

    def test_05_cf_decoding_matches_a_first_principles_decode(self) -> None:
        raw_ds = xr.open_dataset(MODEL_FILE, mask_and_scale=False, decode_times=False)
        try:
            raw = raw_ds["thetao"].values
            scale = float(raw_ds["thetao"].attrs["scale_factor"])
            offset = float(raw_ds["thetao"].attrs["add_offset"])
            fill = raw_ds["thetao"].attrs["_FillValue"]
        finally:
            raw_ds.close()
        self.assertEqual(raw.dtype, np.dtype("int16"))

        manual = raw.astype("float64") * scale + offset
        manual[raw == fill] = np.nan

        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            decoded = sci.variable("thetao").values().astype("float64")

        np.testing.assert_array_equal(np.isnan(decoded), np.isnan(manual))
        np.testing.assert_allclose(
            decoded[~np.isnan(decoded)], manual[~np.isnan(manual)], rtol=0, atol=0
        )

    def test_06_fill_values_present_and_decode_to_nan(self) -> None:
        raw_ds = xr.open_dataset(MODEL_FILE, mask_and_scale=False)
        try:
            raw = raw_ds["thetao"].values
            fill = raw_ds["thetao"].attrs["_FillValue"]
        finally:
            raw_ds.close()
        n_fill = int((raw == fill).sum())
        self.assertGreater(n_fill, 0)  # land / below-seafloor mask really present
        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            decoded = sci.variable("thetao").values()
        self.assertEqual(int(np.isnan(decoded).sum()), n_fill)

    def test_07_decoded_celsius_is_physically_plausible(self) -> None:
        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            a = sci.variable("thetao").values().astype("float64")
        finite = a[np.isfinite(a)]
        self.assertGreater(finite.min(), -3.0)
        self.assertLess(finite.max(), 40.0)
        self.assertGreater(finite.max(), 28.0)  # warm Arabian-Sea surface, spring
        self.assertLess(finite.min(), 15.0)     # cool at ~500 m
        # surface warmer than the deepest level (thermocline)
        surf = np.nanmean(a[:, 0])
        deep = np.nanmean(a[:, -1])
        self.assertGreater(surf, deep + 5.0)

    def test_08_raw_files_untouched(self) -> None:
        for f, want in ((MODEL_FILE, ARABIANSEA_SHA256), (SAMPLE_FILE, SAMPLE_SHA256)):
            before = f.read_bytes()
            with open_scientific_netcdf(f, mask_and_scale=True) as sci:
                sci.variable("thetao").isel(time=0, depth=0).values()
            self.assertEqual(f.read_bytes(), before)
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(), want)

    def test_09_same_product_as_the_tiny_sample(self) -> None:
        """The larger file and the tiny sample are genuinely the same GLORYS12V1
        product -- overlapping cells hold identical values."""
        with open_scientific_netcdf(SAMPLE_FILE, mask_and_scale=True) as tiny:
            self.assertEqual(tiny.attribute("source"), "MERCATOR GLORYS12V1")
            t_lat = tiny.coordinate("latitude").values()
            t_lon = tiny.coordinate("longitude").values()
            t_dep = tiny.coordinate("depth").values()
            tiny_vals = tiny.variable("thetao").isel(time=0).values().astype("float64")

        big = xr.open_dataset(MODEL_FILE, mask_and_scale=True, decode_times=True)
        try:
            self.assertEqual(big.attrs.get("source"), "MERCATOR GLORYS12V1")
            self.assertEqual(big.attrs.get("domain_name"), "GL12")
            sub = (
                big["thetao"]
                .sel(time=np.datetime64("2025-03-31"), method="nearest")
                .sel(latitude=t_lat, longitude=t_lon, depth=t_dep, method="nearest")
                .values.astype("float64")
            )
        finally:
            big.close()

        both = np.isfinite(sub) & np.isfinite(tiny_vals)
        self.assertGreater(int(both.sum()), 5000)
        np.testing.assert_array_equal(sub[both], tiny_vals[both])  # bit-identical


class PackedFillValueDecoding(unittest.TestCase):
    """Fill-value handling for a PACKED int16 variable (fixture)."""

    def _packed_ds(self) -> xr.Dataset:
        scale, offset, fill = 0.001, 20.0, np.int16(-32767)
        packed = np.array([[0, 1000, fill], [-5000, fill, 7000]], dtype="int16")
        da = xr.DataArray(
            packed,
            dims=("latitude", "longitude"),
            attrs={
                "units": "degrees_C",
                "standard_name": "sea_water_potential_temperature",
                "scale_factor": scale,
                "add_offset": offset,
                "_FillValue": fill,
            },
        )
        return xr.Dataset(
            {"thetao": da},
            coords={"latitude": [19.0, 19.5], "longitude": [64.0, 64.5, 65.0]},
        )

    def test_packed_fill_decodes_to_null_others_to_celsius(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "packed_fixture.nc"
            self._packed_ds().to_netcdf(p, engine="netcdf4")
            svc = NetCDFDataService(p, "packed_fixture", cf_decode=True)
            svc.load()
            try:
                body = svc.slice("thetao")
            finally:
                svc.close()
        self.assertEqual(body["units"], "degrees_C")
        self.assertTrue(body["decoding"]["cf_mask_and_scale"])
        self.assertIn("scale_factor", body["decoding"]["applied"])
        vals = body["values"]
        self.assertIsNone(vals[0][2])
        self.assertIsNone(vals[1][1])
        self.assertAlmostEqual(vals[0][0], 0 * 0.001 + 20.0, places=6)
        self.assertAlmostEqual(vals[0][1], 1000 * 0.001 + 20.0, places=6)
        self.assertAlmostEqual(vals[1][0], -5000 * 0.001 + 20.0, places=6)

    def test_same_file_without_decode_exposes_packed_integers(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "packed_raw.nc"
            self._packed_ds().to_netcdf(p, engine="netcdf4")
            svc = NetCDFDataService(p, "packed_raw", cf_decode=False)
            svc.load()
            try:
                body = svc.slice("thetao")
            finally:
                svc.close()
        self.assertFalse(body["decoding"]["cf_mask_and_scale"])
        self.assertTrue(body["decoding"]["source_packed"])
        self.assertIn("packed", body["decoding"]["note"].lower())
        self.assertEqual(body["values"][0][0], 0)  # the packed integer, verbatim


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ModelApi(unittest.TestCase):
    """The GLORYS model is exposed through the existing Step 39 /api/netcdf."""

    def test_01_dataset_endpoint_identity_structure_and_source_label(self) -> None:
        status, body = SRV.get("/api/netcdf/dataset")
        self.assertEqual(status, 200)
        self.assertEqual(body["dataset_id"], "glorys12v1_model")
        self.assertEqual(
            body["source"]["file_name"], "temperature_cmems_glorys12v1_arabiansea.nc"
        )
        self.assertEqual(body["source"]["label"], "GLORYS12V1 / Copernicus Marine")
        self.assertEqual(
            body["dimensions"],
            {"time": 10, "depth": 32, "latitude": 151, "longitude": 103},
        )
        self.assertEqual(body["variables"], ["thetao"])
        roles = {c["name"]: c["role"] for c in body["coordinates"]}
        self.assertEqual(
            roles,
            {"time": "time", "depth": "depth", "latitude": "latitude", "longitude": "longitude"},
        )
        self.assertEqual(body["global_attributes"]["source"], "MERCATOR GLORYS12V1")
        blob = repr(body).lower()
        self.assertNotIn("godas", blob)
        self.assertNotIn("incois model", blob)

    def test_02_coverage_is_the_actual_file_extent_not_hard_coded(self) -> None:
        _, body = SRV.get("/api/netcdf/dataset")
        cov = body["coverage"]
        self.assertEqual(
            cov["time"],
            {"start": "2025-03-24T00:00:00Z", "end": "2025-04-02T00:00:00Z", "count": 10},
        )
        self.assertAlmostEqual(cov["latitude"]["min"], 8.0, places=3)
        self.assertAlmostEqual(cov["latitude"]["max"], 20.5, places=3)
        self.assertEqual(cov["latitude"]["count"], 151)
        self.assertAlmostEqual(cov["longitude"]["min"], 61.5, places=3)
        self.assertAlmostEqual(cov["longitude"]["max"], 70.0, places=3)
        self.assertEqual(cov["longitude"]["count"], 103)
        self.assertAlmostEqual(cov["depth"]["min"], 0.494025, places=5)
        self.assertAlmostEqual(cov["depth"]["max"], 541.0889, places=3)
        self.assertEqual(cov["depth"]["count"], 32)
        self.assertEqual(cov["depth"]["positive"], "down")
        self.assertIn("not basin-wide", cov["note"].lower())

    def test_03_authoritative_time_is_the_decoded_coordinate(self) -> None:
        _, body = SRV.get("/api/netcdf/dataset")
        time_axis = next(c for c in body["coordinates"] if c["name"] == "time")
        self.assertEqual(len(time_axis["values"]), 10)
        self.assertEqual(time_axis["values"][0], "2025-03-24T00:00:00Z")
        # the stale global bulletin_date (2021) must NOT be the coverage time
        self.assertNotEqual(
            body["coverage"]["time"]["start"][:4],
            str(body["global_attributes"].get("bulletin_date", ""))[:4],
        )

    def test_04_variable_endpoint_reports_thetao_and_decoding(self) -> None:
        status, body = SRV.get("/api/netcdf/variables/thetao")
        self.assertEqual(status, 200)
        self.assertEqual(body["dimensions"], ["time", "depth", "latitude", "longitude"])
        self.assertEqual(body["shape"], [10, 32, 151, 103])
        self.assertEqual(body["units"], "degrees_C")
        self.assertEqual(body["dtype"], "float64")  # decoded, not int16
        dec = body["decoding"]
        self.assertTrue(dec["cf_mask_and_scale"])
        self.assertTrue(dec["source_packed"])
        self.assertEqual(dec["raw_dtype"], "int16")
        for k in ("scale_factor", "add_offset", "_FillValue"):
            self.assertIn(k, dec["applied"])
        self.assertAlmostEqual(dec["packing"]["add_offset"], 21.0, places=6)
        self.assertEqual(dec["packing"]["_FillValue"], -32767)

    def test_05_slice_returns_decoded_celsius_matching_the_source(self) -> None:
        # 2025-03-31 is time index 7 in this file
        status, body = SRV.get(
            "/api/netcdf/variables/thetao/slice?time_index=7&depth_index=0"
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["shape"], [151, 103])
        self.assertEqual(body["dimensions"], ["latitude", "longitude"])
        self.assertEqual(body["units"], "degrees_C")
        self.assertTrue(body["decoding"]["cf_mask_and_scale"])
        sel = {s["role"]: s for s in body["selection"]}
        self.assertEqual(sel["time"]["iso"], "2025-03-31T00:00:00Z")

        with open_scientific_netcdf(MODEL_FILE, mask_and_scale=True) as sci:
            expected = sci.variable("thetao").isel(time=7, depth=0).values()

        got = body["values"]
        # spot-check a block of interior cells, exact
        for i in range(60, 90):
            for j in range(30, 70):
                ev = float(expected[i, j])
                if math.isnan(ev):
                    self.assertIsNone(got[i][j])
                else:
                    self.assertEqual(got[i][j], ev)  # decoded, exact, unrounded
        flat = [v for row in got for v in row if v is not None]
        self.assertGreater(min(flat), 20.0)
        self.assertLess(max(flat), 33.0)

    def test_06_target_argo_profiles_are_inside_model_coverage(self) -> None:
        """The 4 profiles the subset was designed for fall inside the model's
        space AND time. NO model-vs-obs difference is computed here."""
        _, ds = SRV.get("/api/netcdf/dataset")
        cov = ds["coverage"]
        lat0, lat1 = cov["latitude"]["min"], cov["latitude"]["max"]
        lon0, lon1 = cov["longitude"]["min"], cov["longitude"]["max"]
        t0 = cov["time"]["start"][:10]
        t1 = cov["time"]["end"][:10]
        for pid, (plat, plon, pdate) in TARGET_ARGO.items():
            self.assertTrue(lat0 <= plat <= lat1, f"{pid} latitude outside coverage")
            self.assertTrue(lon0 <= plon <= lon1, f"{pid} longitude outside coverage")
            self.assertTrue(t0 <= pdate <= t1, f"{pid} date outside coverage")

    def test_07_full_column_slice_spans_the_native_depth_range(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/thetao/slice"
            "?time_index=7&latitude_index=140&longitude_index=38"  # ~19.67 N, 64.67 E
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["dimensions"], ["depth"])
        self.assertEqual(body["shape"], [32])
        col = [v for v in body["values"] if v is not None]
        self.assertEqual(len(col), 32)
        self.assertGreater(col[0], col[-1])   # warmer at the surface
        self.assertLess(col[-1], 20.0)

    def test_08_no_synthetic_fallback_when_model_file_is_absent(self) -> None:
        base = _bnx_config()
        cfg = ApiConfig(
            data_dir=base.data_dir,
            cors_origins=base.cors_origins,
            build_on_startup=False,
            netcdf_path=MODEL_FILE.with_name("not_a_real_glorys_file.nc"),
            netcdf_dataset_id="glorys12v1_model",
            netcdf_cf_decode=True,
        )
        with live_server(create_app(cfg)) as srv:
            status, body = srv.get("/api/netcdf/dataset")
            self.assertEqual(status, 503)
            self.assertEqual(body["error"]["type"], "netcdf_unavailable")
            self.assertNotIn("variables", body)

    def test_09_slice_json_has_no_nan_token(self) -> None:
        import json

        status, raw = SRV.raw_get(
            "/api/netcdf/variables/thetao/slice?time_index=7&depth_index=31"
        )
        self.assertEqual(status, 200)
        json.loads(
            raw,
            parse_constant=lambda t: (_ for _ in ()).throw(AssertionError(f"bare {t} in JSON")),
        )

    def test_10_architecture_is_subset_size_independent(self) -> None:
        """Point the SAME service code at the tiny sample -> it just reports the
        smaller dims/coverage. Nothing is hard-coded to the Arabian Sea size."""
        base = _bnx_config()
        cfg = ApiConfig(
            data_dir=base.data_dir,
            cors_origins=base.cors_origins,
            build_on_startup=False,
            netcdf_path=SAMPLE_FILE,
            netcdf_dataset_id="glorys12v1_model",
            netcdf_cf_decode=True,
            netcdf_source_label=MODEL_SOURCE_LABEL,
        )
        with live_server(create_app(cfg)) as srv:
            _, body = srv.get("/api/netcdf/dataset")
            self.assertEqual(
                body["dimensions"],
                {"time": 1, "depth": 31, "latitude": 13, "longitude": 13},
            )
            self.assertEqual(body["coverage"]["time"]["count"], 1)
            self.assertAlmostEqual(body["coverage"]["latitude"]["max"], 20.0, places=3)
            _, v = srv.get("/api/netcdf/variables/thetao")
            self.assertEqual(v["shape"], [1, 31, 13, 13])
            self.assertEqual(v["units"], "degrees_C")


@unittest.skipUnless(MODEL_FILE.is_file(), f"model file not present: {MODEL_FILE}")
class ExistingPipelineUntouched(unittest.TestCase):
    """The INCOIS .bnx datasets and observation endpoints must be unaffected."""

    def test_01_bnx_and_observation_endpoints_still_ok(self) -> None:
        for path in (
            "/api/health",
            "/api/datasets",
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0",
            f"/api/datasets/{ANALYSIS}/parameters/salinity/slice?time_index=0&depth_index=0",
            f"/api/datasets/{CURRENTS}/parameters/current_u/slice?time_index=0&depth_index=0",
            f"/api/datasets/{CURRENTS}/parameters/current_v/slice?time_index=0&depth_index=0",
            f"/api/datasets/{CURRENTS}/parameters/current_speed/slice?time_index=0&depth_index=0",
            "/api/observations/argo",
            "/api/observations/gliders",
        ):
            status, _ = SRV.get(path)
            self.assertEqual(status, 200, path)

    def test_02_bnx_dataset_ids_are_unchanged_and_exclude_the_model(self) -> None:
        _, datasets = SRV.get("/api/datasets")
        ids = {d["dataset_id"] for d in datasets["datasets"]}
        self.assertIn(ANALYSIS, ids)
        self.assertIn(CURRENTS, ids)
        self.assertNotIn("glorys12v1_model", ids)  # model is /api/netcdf only

    def test_03_incois_temperature_bnx_is_still_its_own_product(self) -> None:
        _, bnx = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0"
        )
        _, model = SRV.get(
            "/api/netcdf/variables/thetao/slice?time_index=0&depth_index=0"
        )
        self.assertNotEqual(model["dataset_id"], ANALYSIS)
        self.assertEqual(model["units"], "degrees_C")

    def test_04_iohoofs_currents_raw_file_still_present_and_loadable(self) -> None:
        self.assertTrue(IO_HOOFS_FILE.is_file())
        with open_scientific_netcdf(IO_HOOFS_FILE) as sci:
            self.assertEqual(set(sci.variable_names()), {"U", "V", "CURRENT"})

    def test_05_observation_endpoints_unchanged_by_the_expansion(self) -> None:
        _, argo = SRV.get("/api/observations/argo")
        _, gli = SRV.get("/api/observations/gliders")
        self.assertEqual(argo["count"], 17)
        self.assertEqual(gli["count"], 2)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
