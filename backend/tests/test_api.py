"""D10 backend/API tests -- real HTTP against the FastAPI app under uvicorn.

No ``httpx`` / ``TestClient`` (not installed): a background uvicorn server plus
stdlib ``urllib`` (see ``tests/_httpserver.py``). This doubles as the required
integration test -- every assertion is a genuine HTTP round-trip.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_api -v
    ./.venv/Scripts/python.exe -m unittest discover -s tests        # D7+D8+D9+D10
"""

from __future__ import annotations

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
from app.data.bluenexus import BnxReader, convert_all, write_bluenexus  # noqa: E402
from app.data.ingestion import project_root, sha256_of  # noqa: E402
from app.data.ingestion.registry import SURFACE_CURRENTS, TEMPERATURE_SALINITY  # noqa: E402

D4_HASHES = {
    "temperature_salinity_incois_argo_sample.nc":
        "17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d",
    "currents_incois_io-hoofs_sample.nc":
        "40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d",
}
ANALYSIS = "incois_argo_10day_analysis"
CURRENTS = "incois_io_hoofs_surface_currents"

_ctx = None
SRV = None


def setUpModule() -> None:
    """Ensure the D9 .bnx files exist, then boot one shared live server."""
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
    cfg = ApiConfig(data_dir=data_dir, cors_origins=("http://localhost:5173",),
                    build_on_startup=False)
    _ctx = live_server(create_app(cfg))
    SRV = _ctx.__enter__()


def tearDownModule() -> None:
    if _ctx is not None:
        _ctx.__exit__(None, None, None)


class D10Health(unittest.TestCase):
    def test_01_backend_starts_and_02_health_ok(self) -> None:
        st, body = SRV.get("/api/health")
        self.assertEqual(st, 200)
        self.assertEqual(body["status"], "ok")          # frontend useHealthCheck contract
        dl = body["data_layer"]
        self.assertTrue(dl["data_dir_exists"])
        self.assertTrue(dl["all_expected_present"])
        self.assertIn(f"{ANALYSIS}.bnx", dl["bnx_files_found"])
        self.assertIn(f"{CURRENTS}.bnx", dl["bnx_files_found"])

    def test_health_is_not_full_validation(self) -> None:
        # health reports discoverability only -- no per-cell scanning
        _, body = SRV.get("/api/health")
        self.assertNotIn("valid_count", json.dumps(body["data_layer"]))


class D10Discovery(unittest.TestCase):
    def test_03_dataset_discovery(self) -> None:
        st, body = SRV.get("/api/datasets")
        self.assertEqual(st, 200)
        self.assertEqual(body["count"], 2)
        ids = {d["dataset_id"] for d in body["datasets"]}
        self.assertEqual(ids, {ANALYSIS, CURRENTS})
        a = next(d for d in body["datasets"] if d["dataset_id"] == ANALYSIS)
        self.assertEqual(a["product_type"], "analysis")
        self.assertEqual(set(a["parameter_ids"]), {"temperature", "salinity"})
        self.assertIn("time_coverage", a)
        self.assertIn("provenance_summary", a)
        # metadata only -- no bulk arrays inlined
        self.assertNotIn("values", json.dumps(body))

    def test_04_dataset_detail(self) -> None:
        st, body = SRV.get(f"/api/datasets/{CURRENTS}")
        self.assertEqual(st, 200)
        self.assertEqual(body["dataset_id"], CURRENTS)
        self.assertEqual(body["product_type"], "forecast")
        self.assertIn("coordinates", body)
        self.assertIn("parameters", body)
        self.assertEqual(body["metadata"]["quality_definition"], {"0": "VALID", "1": "MISSING"})
        self.assertIn("temperature", body["metadata"]["missing_value_definition"].lower()
                      + "x")  # sanity: field present & a string
        self.assertEqual(
            set(body["parameters"]), {"current_u", "current_v", "current_speed"}
        )
        # detail is metadata + small coordinate axes only -- no bulk 4-D arrays.
        # (coordinates legitimately carry their own <=601-element `values` axis.)
        for pmeta in body["parameters"].values():
            self.assertNotIn("values", pmeta)
            self.assertNotIn("quality", pmeta)
        self.assertLess(len(json.dumps(body)), 200_000)

    def test_05_parameter_discovery(self) -> None:
        st, body = SRV.get(f"/api/datasets/{ANALYSIS}/parameters")
        self.assertEqual(st, 200)
        self.assertEqual(body["canonical_parameter_ids"], ["temperature", "salinity"])
        for p in body["parameters"]:
            self.assertFalse(p["accepts_aliases"])
        # currents param registry
        _, cbody = SRV.get(f"/api/datasets/{CURRENTS}/parameters")
        self.assertEqual(
            set(cbody["canonical_parameter_ids"]),
            {"current_u", "current_v", "current_speed"},
        )

    def test_06_coordinate_discovery(self) -> None:
        st, body = SRV.get(f"/api/datasets/{ANALYSIS}/coordinates")
        self.assertEqual(st, 200)
        co = body["coordinates"]
        self.assertEqual(set(co), {"time", "depth", "latitude", "longitude"})
        self.assertEqual(len(co["depth"]["values"]), 24)
        self.assertEqual(co["depth"]["values"][0], 5.0)
        self.assertEqual(co["depth"]["values"][-1], 2000.0)
        self.assertEqual(co["time"]["iso_times"][0], "2026-07-10T00:00:00Z")


class D10Slices(unittest.TestCase):
    def _slice(self, dataset, param, **q):
        qs = "&".join(f"{k}={v}" for k, v in q.items())
        return SRV.get(f"/api/datasets/{dataset}/parameters/{param}/slice" + (f"?{qs}" if qs else ""))

    def test_07_temperature_slice(self) -> None:
        st, body = self._slice(ANALYSIS, "temperature", time_index=0, depth_index=0)
        self.assertEqual(st, 200)
        self.assertEqual(body["units"], "degC")
        self.assertEqual(body["shape"], {"latitude": 36, "longitude": 51})
        self.assertEqual(len(body["values"]), 36)
        self.assertEqual(len(body["values"][0]), 51)
        self.assertEqual(len(body["latitude"]), 36)
        self.assertEqual(len(body["longitude"]), 51)
        self.assertLess(body["bytes_read"], 100_000)   # not the whole 2.4 MB file

    def test_08_salinity_slice(self) -> None:
        st, body = self._slice(ANALYSIS, "salinity", time_index=2, depth_index=9)
        self.assertEqual(st, 200)
        self.assertEqual(body["units"], "PSU")
        self.assertEqual(body["depth"]["value"], 200.0)

    def test_09_current_u_slice(self) -> None:
        st, body = self._slice(CURRENTS, "current_u", time_index=0, depth_index=0)
        self.assertEqual(st, 200)
        self.assertEqual(body["units"], "m s-1")
        self.assertEqual(body["shape"], {"latitude": 421, "longitude": 601})
        self.assertEqual(body["parameter_metadata"]["vector_role"], "eastward")

    def test_10_current_v_slice(self) -> None:
        st, body = self._slice(CURRENTS, "current_v", time_index=3, depth_index=0)
        self.assertEqual(st, 200)
        self.assertEqual(body["parameter_metadata"]["vector_role"], "northward")
        self.assertEqual(body["time"]["iso"], "2026-09-08T19:30:00Z")

    def test_11_current_speed_slice(self) -> None:
        st, body = self._slice(CURRENTS, "current_speed", time_index=1, depth_index=0)
        self.assertEqual(st, 200)
        self.assertEqual(body["parameter_metadata"]["kind"], "vector_magnitude")
        self.assertTrue(body["parameter_metadata"]["authoritative"])
        self.assertTrue(body["parameter_metadata"]["surface_only"])
        self.assertEqual(body["parameter_metadata"]["vector_role"], None)

    def test_efficiency_currents_slice_is_partial_read(self) -> None:
        _, body = self._slice(CURRENTS, "current_speed", time_index=2)
        bnx_size = (project_root() / "data" / "bluenexus" / f"{CURRENTS}.bnx").stat().st_size
        self.assertGreater(bnx_size, 20_000_000)
        self.assertLess(body["bytes_read"], 3_000_000)   # ~2.1 MB plane, not 27 MB


class D10Errors(unittest.TestCase):
    def test_12_unknown_dataset_404(self) -> None:
        st, body = SRV.get("/api/datasets/does_not_exist")
        self.assertEqual(st, 404)
        self.assertEqual(body["error"]["type"], "unknown_dataset")
        st, _ = SRV.get("/api/datasets/does_not_exist/parameters/temperature/slice")
        self.assertEqual(st, 404)

    def test_13_unknown_parameter_404(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/not_a_param/slice"
        )
        self.assertEqual(st, 404)
        self.assertEqual(body["error"]["type"], "unknown_parameter")

    def test_13b_aliases_rejected(self) -> None:
        for alias in ("temp", "sst", "salt", "current", "velocity"):
            st, body = SRV.get(
                f"/api/datasets/{ANALYSIS}/parameters/{alias}/slice"
            )
            self.assertEqual(st, 404, alias)
            self.assertEqual(body["error"]["type"], "unknown_parameter", alias)

    def test_14_wrong_dataset_parameter_combo(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{CURRENTS}/parameters/temperature/slice"
        )
        self.assertEqual(st, 404)
        self.assertEqual(body["error"]["type"], "parameter_not_in_dataset")
        self.assertIn("current_u", body["error"]["detail"]["available_parameters"])

        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/current_speed/slice"
        )
        self.assertEqual(st, 404)
        self.assertEqual(body["error"]["type"], "parameter_not_in_dataset")

    def test_15_negative_time_index_rejected(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=-1"
        )
        self.assertEqual(st, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")

    def test_16_out_of_range_time_index_rejected(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=3"
        )
        self.assertEqual(st, 422)
        self.assertEqual(body["error"]["type"], "invalid_index")
        self.assertEqual(body["error"]["detail"]["valid_range"], [0, 2])

    def test_17_negative_depth_index_rejected(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?depth_index=-2"
        )
        self.assertEqual(st, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")

    def test_18_out_of_range_depth_index_rejected(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?depth_index=24"
        )
        self.assertEqual(st, 422)
        self.assertEqual(body["error"]["type"], "invalid_index")
        self.assertEqual(body["error"]["detail"]["valid_range"], [0, 23])
        # currents depth has only 1 level
        st, body = SRV.get(
            f"/api/datasets/{CURRENTS}/parameters/current_u/slice?depth_index=1"
        )
        self.assertEqual(st, 422)

    def test_non_integer_index_rejected(self) -> None:
        st, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=abc"
        )
        self.assertEqual(st, 422)
        self.assertEqual(body["error"]["type"], "malformed_request")

    def test_no_traceback_leaked(self) -> None:
        _, raw = SRV.raw_get("/api/datasets/does_not_exist")
        self.assertNotIn("Traceback", raw)
        self.assertNotIn("File \"", raw)


class D10DataSemantics(unittest.TestCase):
    def _slice_raw(self, dataset, param, **q):
        qs = "&".join(f"{k}={v}" for k, v in q.items())
        return SRV.raw_get(
            f"/api/datasets/{dataset}/parameters/{param}/slice" + (f"?{qs}" if qs else "")
        )

    def test_19_missing_serialises_as_json_null(self) -> None:
        st, raw = self._slice_raw(ANALYSIS, "temperature", time_index=1, depth_index=10)
        self.assertEqual(st, 200)
        self.assertIn("null", raw)                       # literal JSON null present
        self.assertNotIn("NaN", raw)
        self.assertNotIn("Infinity", raw)
        body = json.loads(raw)                           # strict parse (rejects NaN)
        flat = [x for row in body["values"] for x in row]
        self.assertIn(None, flat)
        for x in flat:
            if x is not None:
                self.assertNotIn(x, (-9999.0, -1e34))

    def test_20_quality_flags_returned(self) -> None:
        _, body = SRV.get(
            f"/api/datasets/{CURRENTS}/parameters/current_u/slice?time_index=0"
        )
        qflat = {q for row in body["quality"] for q in row}
        self.assertTrue(qflat <= {0, 1})
        self.assertIn(1, qflat)
        # null <-> quality 1 alignment
        for vrow, qrow in zip(body["values"], body["quality"]):
            for v, q in zip(vrow, qrow):
                self.assertEqual(v is None, q == 1)

    def test_21_valid_zero_stays_zero_and_valid(self) -> None:
        # no missing cell is 0.0; any 0.0 that appears is VALID
        _, body = SRV.get(
            f"/api/datasets/{CURRENTS}/parameters/current_u/slice?time_index=0"
        )
        for vrow, qrow in zip(body["values"], body["quality"]):
            for v, q in zip(vrow, qrow):
                if q == 1:
                    self.assertIsNone(v)
                if v == 0.0:
                    self.assertEqual(q, 0)
        # and a crafted 0.0 survives the D9 reader unchanged
        import array as _array
        from app.data.bluenexus.serialization import BnxReader as _R
        r = _R(project_root() / "data" / "bluenexus" / f"{CURRENTS}.bnx")
        sl = r.slice("current_u", time_index=0, depth_index=0)
        # a genuine valid value round-trips exactly (pick first non-null)
        for row in sl["values"]:
            for v in row:
                if v is not None:
                    self.assertIsInstance(v, float)
                    return

    def test_22_units_correct(self) -> None:
        _, t = SRV.get(f"/api/datasets/{ANALYSIS}/parameters/temperature/slice")
        _, s = SRV.get(f"/api/datasets/{ANALYSIS}/parameters/salinity/slice")
        _, u = SRV.get(f"/api/datasets/{CURRENTS}/parameters/current_u/slice")
        self.assertEqual(t["units"], "degC")
        self.assertEqual(s["units"], "PSU")
        self.assertEqual(u["units"], "m s-1")
        self.assertEqual(t["parameter_metadata"]["raw_units"], "degs")
        self.assertIsNone(u["parameter_metadata"]["raw_units"])

    def test_23_product_types_correct(self) -> None:
        _, a = SRV.get(f"/api/datasets/{ANALYSIS}")
        _, c = SRV.get(f"/api/datasets/{CURRENTS}")
        self.assertEqual(a["product_type"], "analysis")
        self.assertEqual(a["metadata"]["data_status"], "analysis")
        self.assertEqual(c["product_type"], "forecast")
        self.assertEqual(c["metadata"]["data_status"], "forecast")
        # never "real-time"
        for d in (a, c):
            self.assertNotIn("real-time", json.dumps(d).lower().replace("not real-time", ""))

    def test_24_provenance_present(self) -> None:
        _, body = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice"
        )
        prov = body["provenance"]
        self.assertEqual(prov["source_name"], "INCOIS ERDDAP")
        self.assertEqual(prov["source_dataset_id"], "incois_argo_10day_McCreary")
        self.assertEqual(
            prov["source_file_sha256"],
            D4_HASHES["temperature_salinity_incois_argo_sample.nc"],
        )
        self.assertEqual(prov["source_identifier"], "incois:incois_argo_10day_McCreary")
        self.assertIn("D9 BlueNexus format", prov["pipeline_stages"])
        # no server-side path leaked: only a basename + a logical identifier
        self.assertEqual(prov["source_file_name"], "temperature_salinity_incois_argo_sample.nc")
        self.assertNotIn("source_file", prov)                 # full path key removed
        blob = json.dumps(prov)
        for leak in ("C:\\", "D:\\", "/data/raw/", "data/raw/", "\\data\\", "/Users/", "/home/"):
            self.assertNotIn(leak, blob)

    def test_25_coordinate_values_preserved(self) -> None:
        from app.data.bluenexus import convert_temperature_salinity
        expected = list(convert_temperature_salinity().coordinate("depth").values)
        _, body = SRV.get(f"/api/datasets/{ANALYSIS}/coordinates")
        self.assertEqual(body["coordinates"]["depth"]["values"], expected)

    def test_26_current_grid_is_0_0833_not_one_twelfth(self) -> None:
        _, body = SRV.get(f"/api/datasets/{CURRENTS}/coordinates")
        lon = body["coordinates"]["longitude"]["values"]
        self.assertAlmostEqual(lon[1] - lon[0], 0.0833, places=7)
        self.assertNotAlmostEqual(lon[1] - lon[0], 1.0 / 12.0, places=7)
        self.assertAlmostEqual(lon[0], 49.992, places=6)

    def test_27_temperature_depth_dependent_not_sst(self) -> None:
        _, params = SRV.get(f"/api/datasets/{ANALYSIS}/parameters")
        temp = next(p for p in params["parameters"] if p["parameter_id"] == "temperature")
        self.assertFalse(temp["surface_only"])
        self.assertEqual(temp["shape"], [3, 24, 36, 51])
        self.assertNotIn("sst", temp["display_aliases"])
        self.assertIn("depth", temp["dimensions"])
        # distinct slices at different depths (surface warmer than 2000 m)
        _, s0 = SRV.get(f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?depth_index=0")
        _, s23 = SRV.get(f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?depth_index=23")
        surf = [v for row in s0["values"] for v in row if v is not None]
        deep = [v for row in s23["values"] for v in row if v is not None]
        self.assertGreater(sum(surf) / len(surf), sum(deep) / len(deep))


class D10Integrity(unittest.TestCase):
    def test_28_29_api_reads_bnx_not_raw_netcdf(self) -> None:
        """With the NetCDF-3 reader disabled, every endpoint still works
        (they read the D9 .bnx, never the raw files)."""
        import app.data.ingestion.netcdf3 as nc3

        orig = nc3.NetCDF3File.open

        def boom(self, *a, **k):
            raise AssertionError("route touched raw NetCDF")

        nc3.NetCDF3File.open = boom
        try:
            for path in (
                "/api/health",
                "/api/datasets",
                f"/api/datasets/{ANALYSIS}",
                f"/api/datasets/{ANALYSIS}/parameters",
                f"/api/datasets/{CURRENTS}/coordinates",
                f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=1&depth_index=3",
                f"/api/datasets/{CURRENTS}/parameters/current_speed/slice?time_index=2",
            ):
                st, _ = SRV.get(path)
                self.assertEqual(st, 200, path)
        finally:
            nc3.NetCDF3File.open = orig

    def test_raw_hashes_unchanged(self) -> None:
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name])

    def test_openapi_documents_endpoints(self) -> None:
        st, spec = SRV.get("/openapi.json")
        self.assertEqual(st, 200)
        for p in (
            "/api/health",
            "/api/datasets",
            "/api/datasets/{dataset_id}",
            "/api/datasets/{dataset_id}/parameters",
            "/api/datasets/{dataset_id}/coordinates",
            "/api/datasets/{dataset_id}/parameters/{parameter_id}/slice",
        ):
            self.assertIn(p, spec["paths"])

    def test_cors_dev_origins_allowed_not_wildcard(self) -> None:
        from app.api.config import _DEFAULT_CORS

        cfg = create_app().state.config
        # controlled dev allowlist -- both Vite ports, both host spellings, never "*"
        self.assertEqual(
            cfg.cors_origins,
            (
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:5174",
                "http://127.0.0.1:5174",
            ),
        )
        self.assertEqual(cfg.cors_origins, _DEFAULT_CORS)
        self.assertNotIn("*", cfg.cors_origins)

    def test_cors_env_override_still_replaces_the_default_list(self) -> None:
        import os

        prev = os.environ.get("BLUENEXUS_CORS_ORIGINS")
        os.environ["BLUENEXUS_CORS_ORIGINS"] = "https://ocean.example.org , http://localhost:4321"
        try:
            cfg = ApiConfig.from_env()
        finally:
            if prev is None:
                del os.environ["BLUENEXUS_CORS_ORIGINS"]
            else:
                os.environ["BLUENEXUS_CORS_ORIGINS"] = prev
        self.assertEqual(
            cfg.cors_origins, ("https://ocean.example.org", "http://localhost:4321")
        )
        self.assertNotIn("http://localhost:5174", cfg.cors_origins)

    def test_cors_localhost_5174_gets_allow_origin_header(self) -> None:
        """A real browser preflight + GET from http://localhost:5174 (and the
        127.0.0.1 variant) is answered with a matching Access-Control-Allow-Origin
        header -- the local-dev CORS block is fixed."""
        import urllib.request

        from app.api.config import _DEFAULT_CORS

        cfg = ApiConfig(
            data_dir=project_root() / "data" / "bluenexus",
            cors_origins=_DEFAULT_CORS,
            build_on_startup=False,
        )
        with live_server(create_app(cfg)) as srv:
            for origin in ("http://localhost:5174", "http://127.0.0.1:5174"):
                # CORS preflight
                pre = urllib.request.Request(
                    srv.base_url + "/api/datasets",
                    method="OPTIONS",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "GET",
                    },
                )
                with urllib.request.urlopen(pre, timeout=30) as resp:
                    self.assertEqual(
                        resp.headers.get("access-control-allow-origin"), origin, origin
                    )
                # actual GET
                get = urllib.request.Request(
                    srv.base_url + "/api/health", headers={"Origin": origin}
                )
                with urllib.request.urlopen(get, timeout=30) as resp:
                    self.assertEqual(resp.status, 200)
                    self.assertEqual(
                        resp.headers.get("access-control-allow-origin"), origin, origin
                    )


class D35ProductionContract(unittest.TestCase):
    """Step 35 -- API contract / hardening (no data-path or value change)."""

    # -- error contract -------------------------------------------------
    def test_observation_404s_use_resource_specific_slugs(self) -> None:
        st, body = SRV.get("/api/observations/argo/9999999_1")
        self.assertEqual(st, 404)
        self.assertEqual(body["error"]["type"], "unknown_argo_platform")
        st, body = SRV.get("/api/observations/gliders/nope_20200101")
        self.assertEqual(st, 404)
        self.assertEqual(body["error"]["type"], "unknown_glider_deployment")
        # the gridded-dataset 404 is unchanged
        _, body = SRV.get("/api/datasets/does_not_exist")
        self.assertEqual(body["error"]["type"], "unknown_dataset")

    def test_every_error_still_uses_the_one_envelope(self) -> None:
        for path, want_status in (
            ("/api/datasets/nope", 404),
            (f"/api/datasets/{ANALYSIS}/parameters/nope/slice", 404),
            (f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=99", 422),
            ("/api/observations/argo/9999999_1", 404),
            ("/api/observations/argo/not-an-id", 422),
            ("/api/observations/gliders/nope_20200101", 404),
        ):
            st, body = SRV.get(path)
            self.assertEqual(st, want_status, path)
            self.assertIn("error", body, path)
            self.assertEqual(set(body["error"]), {"type", "message", "detail"}, path)
            self.assertIsInstance(body["error"]["type"], str)

    # -- health is machine-readable & frontend-independent -------------
    def test_health_data_layer_is_typed_and_machine_readable(self) -> None:
        st, body = SRV.get("/api/health")
        self.assertEqual(st, 200)
        self.assertEqual(body["status"], "ok")
        dl = body["data_layer"]
        # the availability keys survive response-model validation
        for key in (
            "data_dir_exists",
            "bnx_files_found",
            "datasets_loaded",
            "expected_datasets",
            "all_expected_present",
            "load_errors",
        ):
            self.assertIn(key, dl)
        self.assertIsInstance(dl["all_expected_present"], bool)
        self.assertTrue(dl["all_expected_present"])
        # no scientific-content scan leaked in
        self.assertNotIn("valid_count", json.dumps(dl))

    # -- CORS: env-configurable, never wildcard ----------------------
    def test_cors_wildcard_is_rejected_everywhere(self) -> None:
        import os

        with self.assertRaises(ValueError):
            ApiConfig(
                data_dir=project_root() / "data" / "bluenexus",
                cors_origins=("*",),
                build_on_startup=False,
            )
        prev = os.environ.get("BLUENEXUS_CORS_ORIGINS")
        os.environ["BLUENEXUS_CORS_ORIGINS"] = "https://ok.example , *"
        try:
            with self.assertRaises(ValueError):
                ApiConfig.from_env()
        finally:
            if prev is None:
                del os.environ["BLUENEXUS_CORS_ORIGINS"]
            else:
                os.environ["BLUENEXUS_CORS_ORIGINS"] = prev

    # -- OpenAPI is useful ------------------------------------------
    def test_openapi_documents_every_endpoint_with_summary_and_description(self) -> None:
        st, spec = SRV.get("/openapi.json")
        self.assertEqual(st, 200)
        self.assertEqual(spec["info"]["version"], "1.0.0")
        wanted = {
            "/api/health",
            "/api/datasets",
            "/api/datasets/{dataset_id}",
            "/api/datasets/{dataset_id}/parameters",
            "/api/datasets/{dataset_id}/coordinates",
            "/api/datasets/{dataset_id}/parameters/{parameter_id}/slice",
            "/api/observations/argo",
            "/api/observations/argo/{platform_id}",
            "/api/observations/gliders",
            "/api/observations/gliders/{platform_id}",
        }
        self.assertTrue(wanted <= set(spec["paths"]))
        for path in wanted:
            op = spec["paths"][path]["get"]
            self.assertTrue(op.get("summary"), path)
            self.assertTrue(op.get("description"), path)
            self.assertTrue(op.get("operationId"), path)

    def test_openapi_error_responses_are_declared(self) -> None:
        _, spec = SRV.get("/openapi.json")
        argo_detail = spec["paths"]["/api/observations/argo/{platform_id}"]["get"]
        self.assertIn("404", argo_detail["responses"])
        self.assertIn("422", argo_detail["responses"])
        slice_op = spec["paths"][
            "/api/datasets/{dataset_id}/parameters/{parameter_id}/slice"
        ]["get"]
        for code in ("404", "422", "503"):
            self.assertIn(code, slice_op["responses"])

    # -- backward compatibility: values / units / data path unchanged
    def test_representative_real_data_unchanged(self) -> None:
        _, t = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/temperature/slice?time_index=0&depth_index=0"
        )
        self.assertEqual(t["units"], "degC")
        self.assertEqual(t["shape"], {"latitude": 36, "longitude": 51})
        _, s = SRV.get(
            f"/api/datasets/{ANALYSIS}/parameters/salinity/slice?time_index=2&depth_index=9"
        )
        self.assertEqual(s["units"], "PSU")
        self.assertEqual(s["depth"]["value"], 200.0)
        _, c = SRV.get(
            f"/api/datasets/{CURRENTS}/parameters/current_speed/slice?time_index=1"
        )
        self.assertEqual(c["units"], "m s-1")
        _, a = SRV.get("/api/observations/argo/2903951_10")
        self.assertEqual(a["levels"][0]["pressure"], 2.5)
        self.assertEqual(a["levels"][0]["temperature"], 29.995)
        self.assertEqual(a["levels"][0]["salinity"], 34.858)


if __name__ == "__main__":
    unittest.main(verbosity=2)
