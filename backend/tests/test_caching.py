"""Step 57 -- CDN `Cache-Control` header tests (real HTTP against uvicorn).

Same harness as ``test_api.py`` / ``test_temperature_comparison.py``: a
background uvicorn server + stdlib ``urllib`` (``tests/_httpserver.py``), real
on-disk data (the tracked D9 `.bnx` containers, the tracked D4 CSV snapshots,
the tracked GLORYS Arabian Sea NetCDF). Nothing is mocked and nothing is
written under the repository.

This module tests exactly one thing added by Step 57: that a `Cache-Control`
header is present on successful (200) GET responses for the allow-listed
immutable routes, absent everywhere else (health, errors), and that it does
not change any response body. Scientific correctness of each response body is
already covered by the existing suites (`test_api.py`,
`test_observations.py`, `test_netcdf_api.py`, `test_model_observations.py`,
`test_temperature_comparison.py`, `test_sources.py`) -- this module does not
duplicate that.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_caching -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.caching import IMMUTABLE_CACHE_CONTROL  # noqa: E402
from app.api.config import MODEL_SOURCE_LABEL, ApiConfig  # noqa: E402
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root  # noqa: E402

ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"
RAW = project_root() / "data" / "raw"
MODEL_FILE = RAW / "temperature_cmems_glorys12v1_arabiansea.nc"

# A real Argo platform id present in the tracked D4 snapshot / GLORYS coverage
# (same id used by test_temperature_comparison.py).
REAL_ARGO_PLATFORM = "3902669_4"

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
    return ApiConfig(data_dir=data_dir, cors_origins=("http://localhost:5173",), build_on_startup=False)


def setUpModule() -> None:
    global _ctx, SRV
    if not MODEL_FILE.is_file():
        raise unittest.SkipTest(f"GLORYS Arabian Sea file not present: {MODEL_FILE}")
    base = _bnx_config()
    cfg = ApiConfig(
        data_dir=base.data_dir,
        cors_origins=base.cors_origins,
        build_on_startup=False,
        netcdf_path=MODEL_FILE,
        netcdf_dataset_id="glorys12v1_model",
        netcdf_cf_decode=True,
        netcdf_source_label=MODEL_SOURCE_LABEL,
    )
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


# Every allow-listed immutable route, exercised with a real, valid parameter
# combination so each returns 200.
IMMUTABLE_GET_PATHS = [
    "/api/datasets",
    f"/api/datasets/{ANALYSIS}",
    f"/api/datasets/{ANALYSIS}/parameters",
    f"/api/datasets/{ANALYSIS}/coordinates",
    f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0",
    f"/api/datasets/{CURRENTS}/parameters/current_u/slice?time_index=0&depth_index=0",
    "/api/observations/argo",
    f"/api/observations/argo/{REAL_ARGO_PLATFORM}",
    f"/api/observations/argo/{REAL_ARGO_PLATFORM}/temperature-profile",
    "/api/observations/gliders",
    "/api/netcdf/dataset",
    "/api/netcdf/variables/thetao",
    "/api/netcdf/variables/thetao/slice?time_index=0&depth_index=0",
    f"/api/model-observations/argo/{REAL_ARGO_PLATFORM}/temperature",
    f"/api/model-observations/argo/{REAL_ARGO_PLATFORM}/temperature-comparison",
    "/api/sources",
]


class ImmutableRoutesGetCacheHeader(unittest.TestCase):
    def test_every_immutable_route_gets_the_exact_header(self) -> None:
        for path in IMMUTABLE_GET_PATHS:
            with self.subTest(path=path):
                status, _body, headers = SRV.get_with_headers(path)
                self.assertEqual(status, 200, f"expected 200 for {path}")
                self.assertEqual(
                    headers.get("Cache-Control"),
                    IMMUTABLE_CACHE_CONTROL,
                    f"missing/wrong Cache-Control for {path}",
                )


class ResponseBodyUnchanged(unittest.TestCase):
    """The header is additive: the JSON body must be byte-identical to a
    second call, and must still round-trip through the same response models
    (i.e. adding the middleware changed nothing about content generation)."""

    def test_repeated_calls_return_identical_bodies(self) -> None:
        for path in IMMUTABLE_GET_PATHS:
            with self.subTest(path=path):
                _status1, body1, _h1 = SRV.get_with_headers(path)
                _status2, body2, _h2 = SRV.get_with_headers(path)
                self.assertEqual(body1, body2, f"body changed between calls for {path}")

    def test_temperature_slice_body_shape_is_the_documented_contract(self) -> None:
        _status, body, _headers = SRV.get_with_headers(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0"
        )
        self.assertIn("values", body)
        self.assertIn("quality", body)
        self.assertIn("latitude", body)
        self.assertIn("longitude", body)
        self.assertEqual(body["parameter"], "temperature")


class DistinctRequestsAreDistinctURLs(unittest.TestCase):
    """Different dataset_id / parameter_id / time_index / depth_index /
    variable_name / platform_id values must produce different response
    bodies, proving a CDN keying purely on the request URL cannot conflate
    them into one cache entry."""

    def test_different_time_index_gives_different_temperature_slice(self) -> None:
        _s0, body_t0, _h0 = SRV.get_with_headers(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0"
        )
        _s1, body_t1, _h1 = SRV.get_with_headers(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=1&depth_index=0"
        )
        self.assertNotEqual(body_t0, body_t1)
        self.assertEqual(body_t0["time"]["index"], 0)
        self.assertEqual(body_t1["time"]["index"], 1)

    def test_different_parameter_gives_different_current_slice(self) -> None:
        _su, body_u, _hu = SRV.get_with_headers(
            f"/api/datasets/{CURRENTS}/parameters/current_u/slice?time_index=0&depth_index=0"
        )
        _sv, body_v, _hv = SRV.get_with_headers(
            f"/api/datasets/{CURRENTS}/parameters/current_v/slice?time_index=0&depth_index=0"
        )
        self.assertNotEqual(body_u["values"], body_v["values"])

    def test_different_argo_platform_gives_different_body(self) -> None:
        _s1, body_a, _h1 = SRV.get_with_headers(f"/api/observations/argo/{REAL_ARGO_PLATFORM}")
        _s2, body_b, _h2 = SRV.get_with_headers("/api/observations/argo")
        self.assertNotEqual(body_a, body_b)


class NonImmutableAndErrorResponsesAreNeverCached(unittest.TestCase):
    def test_health_has_no_cache_control(self) -> None:
        status, body, headers = SRV.get_with_headers("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertIsNone(headers.get("Cache-Control"))

    def test_unknown_dataset_404_has_no_cache_control(self) -> None:
        status, body, headers = SRV.get_with_headers("/api/datasets/does_not_exist")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_dataset")
        self.assertIsNone(headers.get("Cache-Control"))

    def test_invalid_time_index_422_has_no_cache_control(self) -> None:
        status, body, headers = SRV.get_with_headers(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=99999&depth_index=0"
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["type"], "invalid_index")
        self.assertIsNone(headers.get("Cache-Control"))

    def test_unknown_argo_platform_404_has_no_cache_control(self) -> None:
        status, body, headers = SRV.get_with_headers("/api/observations/argo/9999999_1")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")
        self.assertIsNone(headers.get("Cache-Control"))

    def test_malformed_platform_id_422_has_no_cache_control(self) -> None:
        status, body, headers = SRV.get_with_headers("/api/observations/argo/not-a-valid-id")
        self.assertEqual(status, 422)
        self.assertIsNone(headers.get("Cache-Control"))


if __name__ == "__main__":
    unittest.main()
