"""Step 39 -- ``/api/netcdf`` API tests (real HTTP against uvicorn).

Same harness as ``test_api.py``: a background uvicorn server + stdlib ``urllib``
(``tests/_httpserver.py``). A **tiny** NetCDF file is generated in a temp dir
from an in-memory xarray Dataset and is deleted after the module runs. Nothing
is written under the repository and no external data is downloaded.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_netcdf_api -v
"""

from __future__ import annotations

import json
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
from app.api.config import ApiConfig  # noqa: E402
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402
from app.data.scientific import open_scientific_netcdf  # noqa: E402

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"


def _reject_const(token: str):
    raise AssertionError(f"non-JSON constant in response body: {token}")


def _strict_json(raw: str):
    """Parse ``raw`` rejecting the JS-only ``NaN`` / ``Infinity`` constants."""
    return json.loads(raw, parse_constant=_reject_const)
_REAL_NC = (
    project_root() / "data" / "raw" / "temperature_salinity_incois_argo_sample.nc"
)

_tmpdir: tempfile.TemporaryDirectory | None = None
_ctx = None
SRV = None
NC_PATH: Path | None = None
SOURCE: xr.Dataset | None = None


def _ensure_bnx() -> ApiConfig:
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


def _make_cube() -> xr.Dataset:
    time = np.array(
        ["2026-01-01", "2026-01-11", "2026-01-21"], dtype="datetime64[ns]"
    )
    depth = np.array([5.0, 100.0, 500.0, 2000.0])
    lat = np.array([-5.0, -2.5, 0.0, 2.5, 5.0])
    lon = np.array([60.0, 62.5, 65.0, 67.5])
    shape = (time.size, depth.size, lat.size, lon.size)
    temp = (np.arange(np.prod(shape), dtype="float64").reshape(shape) / 7.0) + 3.0
    temp[0, 3, 0, 0] = np.nan
    temp[1, 0, 4, 3] = np.nan
    temp[2, 2, 1, 2] = np.nan
    salt = temp / 10.0 + 34.0
    ssh = np.arange(time.size * lat.size * lon.size, dtype="float32").reshape(
        (time.size, lat.size, lon.size)
    )
    return xr.Dataset(
        {
            "T_ANALYZED": (
                ("time", "depth", "lat", "lon"),
                temp,
                {"units": "degC", "long_name": "analyzed temperature",
                 "standard_name": "sea_water_temperature"},
            ),
            "S_ANALYZED": (
                ("time", "depth", "lat", "lon"),
                salt,
                {"units": "PSU", "long_name": "analyzed salinity"},
            ),
            "SSH": (
                ("time", "lat", "lon"),
                ssh,
                {"units": "m", "long_name": "sea surface height (no depth axis)"},
            ),
        },
        coords={
            "time": ("time", time, {"standard_name": "time"}),
            "depth": ("depth", depth, {"units": "m", "positive": "down"}),
            "lat": ("lat", lat, {"units": "degrees_north"}),
            "lon": ("lon", lon, {"units": "degrees_east"}),
        },
        attrs={"title": "tiny synthetic netcdf-api cube", "Conventions": "CF-1.8"},
    )


def setUpModule() -> None:
    global _tmpdir, _ctx, SRV, NC_PATH, SOURCE
    base_cfg = _ensure_bnx()
    _tmpdir = tempfile.TemporaryDirectory()
    NC_PATH = Path(_tmpdir.name) / "scientific_cube.nc"
    SOURCE = _make_cube()
    SOURCE.to_netcdf(NC_PATH, engine="netcdf4")

    cfg = ApiConfig(
        data_dir=base_cfg.data_dir,
        cors_origins=base_cfg.cors_origins,
        build_on_startup=False,
        netcdf_path=NC_PATH,
        netcdf_dataset_id="scientific_cube",
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)
    if _tmpdir is not None:
        _tmpdir.cleanup()


class NetCDFDatasetEndpoint(unittest.TestCase):
    def test_01_dataset_identity_and_structure(self) -> None:
        status, body = SRV.get("/api/netcdf/dataset")
        self.assertEqual(status, 200)
        self.assertEqual(body["dataset_id"], "scientific_cube")
        self.assertEqual(body["source"]["file_name"], "scientific_cube.nc")
        # no absolute path / temp dir leaked anywhere in the payload
        self.assertNotIn(str(NC_PATH), json.dumps(body))
        self.assertNotIn(tempfile.gettempdir(), json.dumps(body))
        self.assertEqual(
            body["dimensions"], {"time": 3, "depth": 4, "lat": 5, "lon": 4}
        )
        self.assertEqual(set(body["variables"]), {"T_ANALYZED", "S_ANALYZED", "SSH"})
        self.assertEqual(body["variable_count"], 3)
        self.assertEqual(body["global_attributes"]["title"], "tiny synthetic netcdf-api cube")

    def test_02_coordinates_have_roles_and_values(self) -> None:
        _, body = SRV.get("/api/netcdf/dataset")
        by_name = {c["name"]: c for c in body["coordinates"]}
        self.assertEqual(
            {n: by_name[n]["role"] for n in by_name},
            {"time": "time", "depth": "depth", "lat": "latitude", "lon": "longitude"},
        )
        self.assertEqual(by_name["depth"]["values"], [5.0, 100.0, 500.0, 2000.0])
        self.assertEqual(by_name["depth"]["units"], "m")
        self.assertEqual(
            by_name["time"]["values"],
            ["2026-01-01T00:00:00Z", "2026-01-11T00:00:00Z", "2026-01-21T00:00:00Z"],
        )

    def test_03_no_raw_nan_token_in_json(self) -> None:
        status, raw = SRV.raw_get("/api/netcdf/dataset")
        self.assertEqual(status, 200)
        _strict_json(raw)  # rejects bare NaN / Infinity constants


class NetCDFVariableEndpoint(unittest.TestCase):
    def test_01_variable_metadata(self) -> None:
        status, body = SRV.get("/api/netcdf/variables/T_ANALYZED")
        self.assertEqual(status, 200)
        self.assertEqual(body["name"], "T_ANALYZED")
        self.assertEqual(body["dimensions"], ["time", "depth", "lat", "lon"])
        self.assertEqual(body["shape"], [3, 4, 5, 4])
        self.assertEqual(body["dtype"], "float64")
        self.assertEqual(body["units"], "degC")
        self.assertEqual(body["attributes"]["long_name"], "analyzed temperature")
        self.assertEqual(
            body["axis_roles"],
            {"time": "time", "depth": "depth", "lat": "latitude", "lon": "longitude"},
        )

    def test_02_unknown_variable_is_404(self) -> None:
        status, body = SRV.get("/api/netcdf/variables/NOPE")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_variable")
        self.assertIn("available_variables", body["error"]["detail"])

    def test_03_malformed_variable_name_is_422(self) -> None:
        status, body = SRV.get("/api/netcdf/variables/1bad-name")
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")


class NetCDFSliceEndpoint(unittest.TestCase):
    def _expected(self, var: str):
        return SOURCE[var].values

    def test_01_2d_slice_matches_source_exactly(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=0&depth_index=3"
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["dimensions"], ["lat", "lon"])
        self.assertEqual(body["shape"], [5, 4])
        self.assertEqual(body["units"], "degC")

        expected = self._expected("T_ANALYZED")[0, 3]
        got = body["values"]
        for i in range(expected.shape[0]):
            for j in range(expected.shape[1]):
                ev = expected[i, j]
                if math.isnan(ev):
                    self.assertIsNone(got[i][j], f"cell {i},{j} should be null")
                else:
                    self.assertEqual(got[i][j], float(ev))  # exact, unrounded

        sel = {s["role"]: s for s in body["selection"]}
        self.assertEqual(sel["time"]["iso"], "2026-01-01T00:00:00Z")
        self.assertEqual(sel["depth"]["value"], 2000.0)
        self.assertEqual(body["coordinates"]["lat"], [-5.0, -2.5, 0.0, 2.5, 5.0])

    def test_02_nan_to_null_only_at_json_boundary(self) -> None:
        # the API says null where the source has NaN ...
        _, body = SRV.get(
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=1&depth_index=0"
        )
        got = body["values"]
        self.assertIsNone(got[4][3])
        # ... but the underlying NetCDF/xarray data is unchanged: reopen it fresh
        with open_scientific_netcdf(NC_PATH) as sci:
            raw = sci.variable("T_ANALYZED").isel(time=1, depth=0).values()
        self.assertTrue(math.isnan(raw[4, 3]))
        finite = ~np.isnan(raw)
        np.testing.assert_array_equal(
            raw[finite], SOURCE["T_ANALYZED"].values[1, 0][finite]
        )

    def test_03_multidimensional_slice_to_1d(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/S_ANALYZED/slice"
            "?time_index=2&latitude_index=1&longitude_index=2"
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["dimensions"], ["depth"])
        self.assertEqual(body["shape"], [4])
        expected = SOURCE["S_ANALYZED"].values[2, :, 1, 2]
        for k, ev in enumerate(expected):
            if math.isnan(ev):
                self.assertIsNone(body["values"][k])
            else:
                self.assertEqual(body["values"][k], float(ev))
        self.assertEqual(
            [s["role"] for s in body["selection"]],
            ["time", "latitude", "longitude"],
        )

    def test_04_no_indices_returns_full_variable(self) -> None:
        status, body = SRV.get("/api/netcdf/variables/T_ANALYZED/slice")
        self.assertEqual(status, 200)
        self.assertEqual(body["shape"], [3, 4, 5, 4])
        self.assertEqual(body["selection"], [])
        arr = np.array(
            [[[[np.nan if v is None else v for v in row]
               for row in plane]
              for plane in vol]
             for vol in body["values"]],
            dtype="float64",
        )
        src = SOURCE["T_ANALYZED"].values
        np.testing.assert_array_equal(np.isnan(arr), np.isnan(src))
        np.testing.assert_array_equal(arr[~np.isnan(arr)], src[~np.isnan(src)])

    def test_05_invalid_index_is_422(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=99"
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "invalid_index")
        self.assertEqual(body["error"]["detail"]["valid_range"], [0, 2])

    def test_06_index_for_missing_axis_is_422(self) -> None:
        # SSH is (time, lat, lon) -- it has no depth axis.
        status, body = SRV.get(
            "/api/netcdf/variables/SSH/slice?time_index=0&depth_index=0"
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "invalid_index")
        self.assertIn("depth", body["error"]["message"])
        self.assertEqual(body["error"]["detail"]["dimensions"], ["time", "lat", "lon"])

    def test_06b_all_four_indices_gives_scalar(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/T_ANALYZED/slice"
            "?time_index=0&depth_index=0&latitude_index=0&longitude_index=0"
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["shape"], [])
        self.assertEqual(body["dimensions"], [])
        expected = float(SOURCE["T_ANALYZED"].values[0, 0, 0, 0])
        self.assertEqual(body["values"], expected)

    def test_07_negative_index_is_malformed_422(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/T_ANALYZED/slice?depth_index=-1"
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")

    def test_08_non_integer_index_is_malformed_422(self) -> None:
        status, body = SRV.get(
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=abc"
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")

    def test_09_slice_json_has_no_nan_token(self) -> None:
        # this slice HAS missing cells -> they must be null, not a NaN token
        status, raw = SRV.raw_get(
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=0&depth_index=3"
        )
        self.assertEqual(status, 200)
        body = _strict_json(raw)
        self.assertIsNone(body["values"][0][0])

    def test_10_no_traceback_or_path_leakage_in_errors(self) -> None:
        for path in (
            "/api/netcdf/variables/NOPE",
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=99",
            "/api/netcdf/variables/T_ANALYZED/slice?time_index=x",
        ):
            _, raw = SRV.raw_get(path)
            low = raw.lower()
            self.assertNotIn("traceback", low)
            self.assertNotIn("file \"", low)
            self.assertNotIn(str(NC_PATH).lower(), low)
            self.assertNotIn(tempfile.gettempdir().lower(), low)


class NetCDFResourceHandling(unittest.TestCase):
    def test_01_many_requests_do_not_hold_the_file_open(self) -> None:
        for _ in range(15):
            status, _ = SRV.get(
                "/api/netcdf/variables/T_ANALYZED/slice?time_index=0&depth_index=0"
            )
            self.assertEqual(status, 200)
        # load=True in the service => the OS handle was released at startup.
        # We can open the same file again exclusively-ish and read it.
        with open_scientific_netcdf(NC_PATH) as sci:
            self.assertEqual(sci.dimensions()["time"], 3)


class NetCDFNotConfigured(unittest.TestCase):
    def test_01_unset_path_returns_503_not_configured(self) -> None:
        cfg = _ensure_bnx()  # netcdf_path is None
        with live_server(create_app(cfg)) as srv:
            status, body = srv.get("/api/netcdf/dataset")
            self.assertEqual(status, 503)
            self.assertEqual(body["error"]["type"], "netcdf_not_configured")
            status, body = srv.get("/api/netcdf/variables/x/slice")
            self.assertEqual(status, 503)
            self.assertEqual(body["error"]["type"], "netcdf_not_configured")
            # existing API unaffected
            self.assertEqual(srv.get("/api/health")[0], 200)
            self.assertEqual(srv.get("/api/datasets")[0], 200)

    def test_02_missing_file_returns_503_unavailable(self) -> None:
        base = _ensure_bnx()
        cfg = ApiConfig(
            data_dir=base.data_dir,
            cors_origins=base.cors_origins,
            build_on_startup=False,
            netcdf_path=Path(tempfile.gettempdir()) / "does_not_exist_bnx39.nc",
            netcdf_dataset_id="missing",
        )
        with live_server(create_app(cfg)) as srv:
            status, body = srv.get("/api/netcdf/dataset")
            self.assertEqual(status, 503)
            self.assertEqual(body["error"]["type"], "netcdf_unavailable")
            _, raw = srv.raw_get("/api/netcdf/dataset")
            self.assertNotIn("traceback", raw.lower())


class ExistingApiRegression(unittest.TestCase):
    """The pre-Step-39 endpoints must be untouched (same shared server)."""

    def test_01_core_endpoints_still_ok(self) -> None:
        for path in (
            "/api/health",
            "/api/datasets",
            f"/api/datasets/{ANALYSIS}",
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


@unittest.skipUnless(_REAL_NC.is_file(), f"real sample not present: {_REAL_NC}")
class RealNetCDFApiSmoke(unittest.TestCase):
    """Read-only: point the API at the small real NetCDF-3 sample, compare a
    representative slice with the xarray source, confirm only NaN -> null."""

    def test_01_real_slice_matches_xarray_source(self) -> None:
        before = _REAL_NC.read_bytes()
        base = _ensure_bnx()
        cfg = ApiConfig(
            data_dir=base.data_dir,
            cors_origins=base.cors_origins,
            build_on_startup=False,
            netcdf_path=_REAL_NC,
            netcdf_dataset_id="incois_argo_ts_sample",
        )
        with live_server(create_app(cfg)) as srv:
            status, ds = srv.get("/api/netcdf/dataset")
            self.assertEqual(status, 200)
            self.assertEqual(
                ds["dimensions"],
                {"time": 3, "ZAX": 24, "latitude": 36, "longitude": 51},
            )
            self.assertIn("T_ANALYZED", ds["variables"])

            status, body = srv.get(
                "/api/netcdf/variables/T_ANALYZED/slice?time_index=0&ZAX=0"
                if False
                else "/api/netcdf/variables/T_ANALYZED/slice?time_index=0&depth_index=0"
            )
            self.assertEqual(status, 200)
            self.assertEqual(body["shape"], [36, 51])
            got = body["values"]

        with open_scientific_netcdf(_REAL_NC) as sci:
            expected = sci.variable("T_ANALYZED").isel(time=0, ZAX=0).values()

        for i in range(expected.shape[0]):
            for j in range(expected.shape[1]):
                ev = float(expected[i, j])
                if math.isnan(ev):
                    self.assertIsNone(got[i][j])
                else:
                    self.assertEqual(got[i][j], ev)  # verbatim, unrounded

        self.assertEqual(_REAL_NC.read_bytes(), before)  # file untouched


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
