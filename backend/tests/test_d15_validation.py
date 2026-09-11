"""D15 -- FULL DATA VALIDATION (end-to-end quality gate).

Deterministic, read-only validation that official INCOIS data travels reliably
through the whole D1-D14 pipeline:

    data/raw/*.nc (D4)
      -> D7 ingestion -> D8 processing -> D9 .bnx -> D10 FastAPI
      -> D11 client contract -> D12 temperature / D13 salinity+currents
      -> D14 controlled updating (compatibility only -- no live update here)

D15 adds **no feature code**. It re-runs the existing pipeline from the pristine
D4 raw files and checks every stage against the D6 validated baseline
(``docs/data-validation.md``) and the documented source identities
(``docs/data-acquisition.md``). It also exercises the live D10 API and asserts
the D11-D13 frontend contract (dataset ids / parameter ids / units the
providers hard-code) against what the API actually serves.

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_d15_validation -v
    ./.venv/Scripts/python.exe -m unittest discover -s tests            # D7..D15

Chlorophyll is intentionally NOT validated: D13 excluded it (no verified public
machine-readable INCOIS series). See ``docs/data-validation-d15.md`` §"Known
limitations".
"""

from __future__ import annotations

import json
import math
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _httpserver import live_server  # noqa: E402

from app.api.app import create_app  # noqa: E402
from app.api.config import ApiConfig  # noqa: E402
from app.data.bluenexus import (  # noqa: E402
    SCHEMA_VERSION,
    BnxReader,
    contract_sha256,
    convert_surface_currents,
    convert_temperature_salinity,
    read_bluenexus,
    write_bluenexus,
)
from app.data.ingestion import project_root, sha256_of  # noqa: E402
from app.data.ingestion.registry import SURFACE_CURRENTS, TEMPERATURE_SALINITY  # noqa: E402
from app.data.processing import (  # noqa: E402
    REFERENCE_RANGES,
    process_surface_currents,
    process_temperature_salinity,
    vector_consistency,
)

ROOT = project_root()
ANALYSIS_ID = "incois_argo_10day_analysis"
CURRENTS_ID = "incois_io_hoofs_surface_currents"

# --- D4 acquisition identity (docs/data-acquisition.md) --------------------
D4_HASHES = {
    "temperature_salinity_incois_argo_sample.nc":
        "17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d",
    "currents_incois_io-hoofs_sample.nc":
        "40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d",
}
ERDDAP_DATASET_ID = "incois_argo_10day_McCreary"
ERDDAP_HOST = "erddap.incois.gov.in"
THREDDS_HOST = "incois.gov.in"

# --- D6 validated baseline (docs/data-validation.md §2-§8) -----------------
# Verified identical to the installed .bnx at D15 time.
D6_BASELINE = {
    "temperature": dict(units="degC", shape=(3, 24, 36, 51), valid=84490, missing=47702,
                        vmin=2.540, vmax=32.586),
    "salinity":    dict(units="PSU", shape=(3, 24, 36, 51), valid=84548, missing=47644,
                        vmin=30.930, vmax=37.353),
    "current_u":   dict(units="m s-1", shape=(4, 1, 421, 601), valid=805692, missing=206392,
                        vmin=-1.13419, vmax=1.68921),
    "current_v":   dict(units="m s-1", shape=(4, 1, 421, 601), valid=806328, missing=205756,
                        vmin=-1.33055, vmax=2.47688),
    "current_speed": dict(units="m s-1", shape=(4, 1, 421, 601), valid=804196, missing=207888,
                          vmin=0.00038, vmax=2.63063),
}
_SOURCE_VAR = {"temperature": "T_ANALYZED", "salinity": "S_ANALYZED",
               "current_u": "U", "current_v": "V", "current_speed": "CURRENT"}

ANALYSIS_DEPTHS = [5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500,
                   600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000]
ANALYSIS_TIMES_ISO = ["2026-07-10T00:00:00Z", "2026-07-20T00:00:00Z", "2026-07-30T00:00:00Z"]
CURRENT_TIMES_ISO = ["2026-09-05T01:30:00Z", "2026-09-06T07:30:00Z",
                     "2026-09-07T13:30:00Z", "2026-09-08T19:30:00Z"]

# D11-D13 frontend contract (the ids/units the providers hard-code).
FRONTEND_CONTRACT = {
    "datasets": [ANALYSIS_ID, CURRENTS_ID],
    "temperature": (ANALYSIS_ID, "degC"),
    "salinity": (ANALYSIS_ID, "PSU"),
    "current_u": (CURRENTS_ID, "m s-1"),
    "current_v": (CURRENTS_ID, "m s-1"),
    "current_speed": (CURRENTS_ID, "m s-1"),
}


# =========================================================================
# shared: build the pipeline artifacts ONCE from the pristine D4 raw files
# =========================================================================
_TS_DS = None
_CUR_DS = None
_SRV = None
_SRV_CTX = None


def setUpModule() -> None:
    global _TS_DS, _CUR_DS, _SRV, _SRV_CTX
    # D7 -> D8 -> D9 straight from data/raw/ -- deterministic, no network.
    _TS_DS = convert_temperature_salinity()
    _CUR_DS = convert_surface_currents()

    # one live D10 server over the installed .bnx set (default config)
    data_dir = ROOT / "data" / "bluenexus"
    cfg = ApiConfig(data_dir=data_dir, cors_origins=("http://localhost:5173",),
                    build_on_startup=False)
    _SRV_CTX = live_server(create_app(cfg))
    _SRV = _SRV_CTX.__enter__()


def tearDownModule() -> None:
    if _SRV_CTX is not None:
        _SRV_CTX.__exit__(None, None, None)


def _param_ds(pid: str):
    return _TS_DS if pid in ("temperature", "salinity") else _CUR_DS


def _installed_reader(dataset_id: str) -> BnxReader:
    return BnxReader(ROOT / "data" / "bluenexus" / f"{dataset_id}.bnx")


def _installed_is_pristine_d4(dataset_id: str) -> bool:
    """True while the installed .bnx still traces to the exact D4 acquisition
    (i.e. no D14 update has replaced it). The D6 numeric baseline only covers
    the D4 sample, so exact-count asserts are guarded by this."""
    r = _installed_reader(dataset_id)
    src = r.contract["provenance"].get("source_file_sha256")
    return src in D4_HASHES.values()


# =========================================================================
# 1. SOURCE / PROVENANCE VALIDATION
# =========================================================================
class D15_1_SourceProvenance(unittest.TestCase):
    def test_11_temp_salinity_provenance_is_incois_erddap_argo(self) -> None:
        prov = _TS_DS.provenance
        self.assertEqual(prov.source_name, "INCOIS ERDDAP")
        self.assertEqual(prov.source_dataset_id, ERDDAP_DATASET_ID)
        self.assertIn(ERDDAP_HOST, prov.source_url)
        self.assertEqual(_TS_DS.metadata.source["dataset_id"], ERDDAP_DATASET_ID)

    def test_12_currents_provenance_is_incois_iohoofs_thredds(self) -> None:
        prov = _CUR_DS.provenance
        self.assertIn("IO-HOOFS", prov.source_name)
        self.assertIn(THREDDS_HOST, prov.source_url)
        self.assertRegex(prov.source_dataset_id, r"^CURRENTS_IO_\d{8}\.nc$")

    def test_13_product_types_analysis_vs_forecast(self) -> None:
        self.assertEqual(_TS_DS.product_type, "analysis")
        self.assertEqual(_TS_DS.metadata.data_status, "analysis")
        self.assertEqual(_CUR_DS.product_type, "forecast")
        self.assertEqual(_CUR_DS.metadata.data_status, "forecast")

    def test_14_no_dataset_claims_real_time_observation(self) -> None:
        for ds in (_TS_DS, _CUR_DS):
            # the only classification fields are analysis / forecast -- never
            # "real-time", "live" or "observation" as a status
            self.assertIn(ds.product_type, ("analysis", "forecast"))
            self.assertIn(ds.metadata.data_status, ("analysis", "forecast"))
            sem = ds.metadata.temporal_semantics.lower()
            self.assertNotIn("real-time observation", sem)
            self.assertNotIn("live observ", sem)
        # both datasets explicitly state they are NOT real-time
        notes = (" ".join(_TS_DS.metadata.notes) + " "
                 + " ".join(_CUR_DS.metadata.notes)).lower()
        self.assertIn("not real-time", notes)
        # analysis semantics deny "observation time" / "forecast";
        # forecast semantics deny "observations"
        self.assertIn("not an observation time", _TS_DS.metadata.temporal_semantics.lower())
        self.assertIn("not observ", _CUR_DS.metadata.temporal_semantics.lower())

    def test_15_provenance_survives_d7_to_d10(self) -> None:
        # raw hash recorded at D8/D9 == the file on disk == the D4 acquisition hash
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name])
        self.assertEqual(_TS_DS.provenance.source_file_sha256,
                         D4_HASHES["temperature_salinity_incois_argo_sample.nc"])
        self.assertEqual(_CUR_DS.provenance.source_file_sha256,
                         D4_HASHES["currents_incois_io-hoofs_sample.nc"])
        # and it is still there after D10 serves it
        _, detail = _SRV.get(f"/api/datasets/{ANALYSIS_ID}")
        self.assertEqual(detail["provenance"]["source_dataset_id"], ERDDAP_DATASET_ID)
        _, cdetail = _SRV.get(f"/api/datasets/{CURRENTS_ID}")
        self.assertRegex(cdetail["provenance"]["source_dataset_id"], r"^CURRENTS_IO_\d{8}\.nc$")
        # no machine-specific absolute path leaks through the API
        self.assertNotIn(str(ROOT), json.dumps(detail) + json.dumps(cdetail))


# =========================================================================
# 2. DATASET STRUCTURE VALIDATION
# =========================================================================
class D15_2_DatasetStructure(unittest.TestCase):
    def test_21_analysis_axes_present_ordered_sized(self) -> None:
        c = _TS_DS.coordinates
        self.assertEqual(set(c), {"time", "depth", "latitude", "longitude"})
        self.assertEqual((c["time"].count, c["depth"].count,
                          c["latitude"].count, c["longitude"].count), (3, 24, 36, 51))
        for role in ("time", "depth", "latitude", "longitude"):
            self.assertEqual(c[role].ordering, "ascending", role)

    def test_22_analysis_3_times_valid(self) -> None:
        self.assertEqual(list(_TS_DS.coordinates["time"].iso_times), ANALYSIS_TIMES_ISO)
        self.assertEqual(_TS_DS.coordinates["time"].regular_step, 864000.0)  # 10 days
        self.assertFalse(_TS_DS.coordinates["time"].timezone_is_assumed)

    def test_23_analysis_24_depths_ascending_irregular(self) -> None:
        d = list(_TS_DS.coordinates["depth"].values)
        self.assertEqual(d, [float(x) for x in ANALYSIS_DEPTHS])
        self.assertTrue(all(d[i] < d[i + 1] for i in range(len(d) - 1)))
        self.assertIsNone(_TS_DS.coordinates["depth"].regular_step)  # irregular
        self.assertGreater(d[0], 0.0)

    def test_24_analysis_lat_lon_grid_valid(self) -> None:
        lat = list(_TS_DS.coordinates["latitude"].values)
        lon = list(_TS_DS.coordinates["longitude"].values)
        self.assertAlmostEqual(lat[0], -9.5); self.assertAlmostEqual(lat[-1], 25.5)
        self.assertAlmostEqual(lon[0], 50.5); self.assertAlmostEqual(lon[-1], 100.5)
        self.assertAlmostEqual(_TS_DS.coordinates["latitude"].regular_step, 1.0)
        self.assertAlmostEqual(_TS_DS.coordinates["longitude"].regular_step, 1.0)
        self.assertTrue(all(-90 <= v <= 90 for v in lat))
        self.assertTrue(all(0 <= v <= 360 for v in lon))

    def test_25_analysis_units_correct(self) -> None:
        self.assertEqual(_TS_DS.parameter("temperature").units, "degC")
        self.assertEqual(_TS_DS.parameter("salinity").units, "PSU")

    def test_26_currents_axes_structure_preserved(self) -> None:
        c = _CUR_DS.coordinates
        self.assertEqual(set(c), {"time", "depth", "latitude", "longitude"})
        self.assertEqual((c["time"].count, c["depth"].count,
                          c["latitude"].count, c["longitude"].count), (4, 1, 421, 601))
        for role in ("time", "latitude", "longitude"):
            self.assertEqual(c[role].ordering, "ascending", role)

    def test_27_currents_surface_only_zero_metres(self) -> None:
        depth = _CUR_DS.coordinates["depth"]
        self.assertEqual(depth.count, 1)
        self.assertEqual(depth.values[0], 0.0)
        self.assertTrue(all(p.surface_only for p in _CUR_DS.parameters.values()))

    def test_28_currents_4_forecast_times_valid(self) -> None:
        self.assertEqual(list(_CUR_DS.coordinates["time"].iso_times), CURRENT_TIMES_ISO)
        self.assertEqual(_CUR_DS.coordinates["time"].regular_step, 30.0)  # 30 h

    def test_29_currents_lat_lon_grid_valid(self) -> None:
        lat = list(_CUR_DS.coordinates["latitude"].values)
        lon = list(_CUR_DS.coordinates["longitude"].values)
        self.assertEqual(len(lat), 421)
        self.assertEqual(len(lon), 601)
        self.assertTrue(all(lat[i] < lat[i + 1] for i in range(len(lat) - 1)))
        self.assertTrue(all(lon[i] < lon[i + 1] for i in range(len(lon) - 1)))
        self.assertTrue(all(-90 <= v <= 90 for v in lat))
        # ~1/12 deg spacing (stored 0.0833), NOT forced onto the analysis grid
        step = lat[1] - lat[0]
        self.assertAlmostEqual(step, 0.0833, places=4)

    def test_2a_currents_units_are_m_per_s(self) -> None:
        for pid in ("current_u", "current_v", "current_speed"):
            self.assertEqual(_CUR_DS.parameter(pid).units, "m s-1")

    def test_2b_missing_values_canonical_both_datasets(self) -> None:
        # missing == IEEE NaN in values, mirrored by quality byte 1; never a sentinel
        for ds in (_TS_DS, _CUR_DS):
            for pid, arr in ds.arrays.items():
                q1 = sum(1 for q in arr.quality if q == 1)
                nan = sum(1 for v in arr.values if v != v)
                self.assertEqual(q1, nan, pid)
                for v in arr.values:
                    if v == v:  # not NaN
                        self.assertNotIn(v, (9999.0, -9999.0, -1e34, -1.0))

    def test_2c_datasets_keep_their_own_grids(self) -> None:
        # D10 §"important differences": no shared grid, no shared time axis
        self.assertNotEqual(
            (_TS_DS.coordinates["latitude"].count, _TS_DS.coordinates["longitude"].count),
            (_CUR_DS.coordinates["latitude"].count, _CUR_DS.coordinates["longitude"].count),
        )
        self.assertNotEqual(_TS_DS.coordinates["time"].units, _CUR_DS.coordinates["time"].units)


# =========================================================================
# 3. NUMERICAL VALIDATION
# =========================================================================
class D15_3_Numerical(unittest.TestCase):
    def _valid_stats(self, ds, pid):
        arr = ds.arrays[pid]
        vmin = math.inf
        vmax = -math.inf
        valid = 0
        for v, q in zip(arr.values, arr.quality):
            if q == 1:
                continue
            valid += 1
            if v < vmin:
                vmin = v
            if v > vmax:
                vmax = v
        return valid, len(arr.quality) - valid, vmin, vmax

    def test_31_values_within_validated_source_ranges(self) -> None:
        # D8 attaches a range diagnostic per variable against the D6 reference
        # range (docs/data-validation.md §8). "Within source ranges" == that
        # diagnostic reporting zero cells outside the reference (with D8's own
        # 1e-3 relative tolerance, which absorbs D6's 5-dp documented rounding).
        cleaned = {
            "temperature": process_temperature_salinity().variables["T_ANALYZED"],
            "salinity": process_temperature_salinity().variables["S_ANALYZED"],
        }
        cur = process_surface_currents()
        cleaned["current_u"] = cur.variables["U"]
        cleaned["current_v"] = cur.variables["V"]
        cleaned["current_speed"] = cur.variables["CURRENT"]

        for pid, base in D6_BASELINE.items():
            var = cleaned[pid]
            self.assertIsNotNone(var.range_diagnostic, pid)
            self.assertEqual(var.range_diagnostic.values_outside_reference, 0, pid)
            self.assertTrue(var.range_diagnostic.within_reference, pid)
            # and the cleaned valid extremes reproduce the D6 §8 figures
            self.assertAlmostEqual(var.range_diagnostic.valid_min, base["vmin"], places=4, msg=pid)
            self.assertAlmostEqual(var.range_diagnostic.valid_max, base["vmax"], places=4, msg=pid)
            ref = REFERENCE_RANGES[_SOURCE_VAR[pid]]
            self.assertEqual(var.range_diagnostic.reference_min, ref.minimum, pid)
            self.assertEqual(var.range_diagnostic.reference_max, ref.maximum, pid)

    def test_32_valid_missing_counts_match_d6_baseline(self) -> None:
        for pid, base in D6_BASELINE.items():
            ds = _param_ds(pid)
            valid, missing, _, _ = self._valid_stats(ds, pid)
            self.assertEqual(valid, base["valid"], pid)
            self.assertEqual(missing, base["missing"], pid)
            self.assertEqual(ds.parameter(pid).valid_count, base["valid"], pid)
            self.assertEqual(ds.parameter(pid).missing_count, base["missing"], pid)

    def test_33_current_equals_hypot_uv_tight_tolerance(self) -> None:
        cl = process_surface_currents()
        vc = vector_consistency(cl.variables["U"], cl.variables["V"], cl.variables["CURRENT"])
        self.assertGreater(vc.jointly_valid_cells, 800_000)
        self.assertLess(vc.max_abs_difference, 1e-9)          # D6 saw 4.4e-16
        self.assertEqual(vc.cells_within_1e_6, vc.jointly_valid_cells)
        self.assertTrue(vc.source_current_is_authoritative)
        self.assertFalse(vc.recomputed_field_created)

    def test_34_no_unexpected_infinities(self) -> None:
        for ds in (_TS_DS, _CUR_DS):
            for pid, arr in ds.arrays.items():
                self.assertFalse(any(math.isinf(v) for v in arr.values), pid)

    def test_35_missing_never_becomes_a_scientific_sentinel(self) -> None:
        for ds in (_TS_DS, _CUR_DS):
            for pid, arr in ds.arrays.items():
                for v, q in zip(arr.values, arr.quality):
                    if q == 1:
                        self.assertTrue(math.isnan(v), pid)  # canonical NaN, not 0/-9999/-1e34
                    else:
                        self.assertFalse(math.isnan(v), pid)
                        self.assertFalse(math.isinf(v), pid)

    def test_36_temperature_2000m_floor_cluster_is_benign(self) -> None:
        # D6 §12 flagged the 2000 m constant-2.54 cells "for a second look in D15".
        # Confirm: the 2000 m level's valid range is physically sensible and the
        # constant value equals the level minimum (an objective-analysis first
        # guess floor, not corruption). Non-blocking.
        d = _TS_DS.parameter("temperature").shape          # (3,24,36,51)
        nt, nz, ny, nx = d
        arr = _TS_DS.arrays["temperature"]
        plane = ny * nx
        lo, hi = math.inf, -math.inf
        for t in range(nt):
            base = ((t * nz) + 23) * plane                 # depth_index 23 == 2000 m
            for i in range(plane):
                v = arr.values[base + i]
                q = arr.quality[base + i]
                if q == 1:
                    continue
                lo = min(lo, v)
                hi = max(hi, v)
        self.assertGreaterEqual(lo, 2.5)
        self.assertLessEqual(hi, 3.3)                       # D6 per-level table: 2.54..3.18
        self.assertAlmostEqual(lo, 2.54, places=2)


# =========================================================================
# 4. D7-D9 ROUND-TRIP / ARTIFACT VALIDATION
# =========================================================================
class D15_4_ArtifactRoundTrip(unittest.TestCase):
    def test_41_installed_bnx_open_and_schema(self) -> None:
        for did in (ANALYSIS_ID, CURRENTS_ID):
            r = _installed_reader(did)
            self.assertEqual(r.contract["schema_version"], SCHEMA_VERSION)
            self.assertEqual(SCHEMA_VERSION, "bluenexus.dataset/1")
            self.assertEqual(r.dataset_id, did)

    def test_42_dimensions_and_parameter_metadata_intact(self) -> None:
        for did, ds in ((ANALYSIS_ID, _TS_DS), (CURRENTS_ID, _CUR_DS)):
            r = _installed_reader(did)
            for pid in ds.parameters:
                self.assertEqual(tuple(r.shape(pid)), ds.parameter(pid).shape, pid)
                pmeta = r.contract["parameters"][pid]
                self.assertEqual(pmeta["units"], D6_BASELINE[pid]["units"], pid)
                self.assertIn(pmeta["kind"],
                              ("scalar_field", "vector_component", "vector_magnitude"))

    def test_43_representative_values_match_baseline(self) -> None:
        if not _installed_is_pristine_d4(CURRENTS_ID) or not _installed_is_pristine_d4(ANALYSIS_ID):
            self.skipTest("installed .bnx has been updated by D14 -- D6 numeric baseline "
                          "covers the D4 sample only (see docs/data-validation-d15.md)")
        for pid, base in D6_BASELINE.items():
            r = _installed_reader(ANALYSIS_ID if pid in ("temperature", "salinity") else CURRENTS_ID)
            self.assertEqual(r.contract["parameters"][pid]["valid_count"], base["valid"], pid)
            self.assertEqual(r.contract["parameters"][pid]["missing_count"], base["missing"], pid)
            self.assertAlmostEqual(r.contract["parameters"][pid]["valid_min"], base["vmin"],
                                   places=4, msg=pid)
            self.assertAlmostEqual(r.contract["parameters"][pid]["valid_max"], base["vmax"],
                                   places=4, msg=pid)

    def test_44_raw_source_files_not_modified_by_validation(self) -> None:
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name])

    def test_45_artifact_contract_hash_internally_consistent(self) -> None:
        for did, fresh in ((ANALYSIS_ID, _TS_DS), (CURRENTS_ID, _CUR_DS)):
            r = _installed_reader(did)
            back = read_bluenexus(r.path)
            # generation.contract_sha256 == recomputed contract hash of the read-back model
            self.assertEqual(r.generation["contract_sha256"], contract_sha256(back))
            # deterministic: a fresh conversion + write + read reproduces its own hash
            with TemporaryDirectory() as td:
                p = write_bluenexus(fresh, Path(td) / f"{did}.bnx",
                                    generated_at="2026-01-01T00:00:00Z")
                self.assertEqual(contract_sha256(read_bluenexus(p)), contract_sha256(fresh))

    def test_46_round_trip_preserves_values_and_quality(self) -> None:
        with TemporaryDirectory() as td:
            p = write_bluenexus(_CUR_DS, Path(td) / "c.bnx", generated_at="2026-01-01T00:00:00Z")
            back = read_bluenexus(p)
            a, b = _CUR_DS.arrays["current_speed"], back.arrays["current_speed"]
            self.assertEqual(len(a.values), len(b.values))
            step = max(1, len(a.values) // 4000)
            for x, y in zip(a.values[::step], b.values[::step]):
                self.assertTrue((math.isnan(x) and math.isnan(y)) or x == y)
            self.assertEqual(list(a.quality[::step]), list(b.quality[::step]))


# =========================================================================
# 5. D10 API VALIDATION
# =========================================================================
class D15_5_ApiValidation(unittest.TestCase):
    def test_51_health(self) -> None:
        st, body = _SRV.get("/api/health")
        self.assertEqual(st, 200)
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["data_layer"]["all_expected_present"])

    def test_52_datasets_present(self) -> None:
        st, body = _SRV.get("/api/datasets")
        self.assertEqual(st, 200)
        ids = {d["dataset_id"] for d in body["datasets"]}
        self.assertEqual(ids, {ANALYSIS_ID, CURRENTS_ID})
        by_id = {d["dataset_id"]: d for d in body["datasets"]}
        self.assertEqual(by_id[ANALYSIS_ID]["product_type"], "analysis")
        self.assertEqual(by_id[CURRENTS_ID]["product_type"], "forecast")

    def test_53_canonical_parameters_present(self) -> None:
        st, a = _SRV.get(f"/api/datasets/{ANALYSIS_ID}/parameters")
        self.assertEqual(st, 200)
        self.assertEqual(a["canonical_parameter_ids"], ["temperature", "salinity"])
        st, c = _SRV.get(f"/api/datasets/{CURRENTS_ID}/parameters")
        self.assertEqual(set(c["canonical_parameter_ids"]),
                         {"current_u", "current_v", "current_speed"})
        for p in a["parameters"] + c["parameters"]:
            self.assertFalse(p["accepts_aliases"])

    def test_54_coordinate_metadata_correct(self) -> None:
        st, a = _SRV.get(f"/api/datasets/{ANALYSIS_ID}/coordinates")
        self.assertEqual(st, 200)
        co = a["coordinates"]
        self.assertEqual(co["time"]["count"], 3)
        self.assertEqual(co["depth"]["count"], 24)
        self.assertEqual(co["latitude"]["count"], 36)
        self.assertEqual(co["longitude"]["count"], 51)
        self.assertEqual(co["time"]["iso_times"], ANALYSIS_TIMES_ISO)
        self.assertEqual([float(x) for x in co["depth"]["values"]],
                         [float(x) for x in ANALYSIS_DEPTHS])
        st, c = _SRV.get(f"/api/datasets/{CURRENTS_ID}/coordinates")
        cc = c["coordinates"]
        self.assertEqual(cc["depth"]["count"], 1)
        self.assertEqual(cc["depth"]["values"], [0.0])
        self.assertEqual(cc["latitude"]["count"], 421)
        self.assertEqual(cc["longitude"]["count"], 601)
        self.assertEqual(cc["time"]["iso_times"], CURRENT_TIMES_ISO)

    def test_55_slice_dimensions_and_selection_metadata(self) -> None:
        st, s = _SRV.get(
            f"/api/datasets/{ANALYSIS_ID}/parameters/temperature/slice?time_index=2&depth_index=23")
        self.assertEqual(st, 200)
        self.assertEqual(s["shape"], {"latitude": 36, "longitude": 51})
        self.assertEqual(len(s["values"]), 36)
        self.assertEqual(len(s["values"][0]), 51)
        self.assertEqual(len(s["quality"]), len(s["values"]))
        self.assertEqual(len(s["quality"][0]), len(s["values"][0]))
        self.assertEqual(s["time"]["index"], 2)
        self.assertEqual(s["time"]["iso"], "2026-07-30T00:00:00Z")
        self.assertEqual(s["depth"]["index"], 23)
        self.assertEqual(s["depth"]["value"], 2000.0)
        self.assertEqual(s["units"], "degC")

        st, cs = _SRV.get(
            f"/api/datasets/{CURRENTS_ID}/parameters/current_speed/slice?time_index=0&depth_index=0")
        self.assertEqual(cs["shape"], {"latitude": 421, "longitude": 601})
        self.assertEqual(len(cs["values"]), 421)
        self.assertEqual(len(cs["values"][0]), 601)
        self.assertEqual(cs["depth"]["value"], 0.0)
        self.assertEqual(cs["units"], "m s-1")

    def test_56_missing_is_json_null_and_zero_stays_zero(self) -> None:
        st, s = _SRV.get(
            f"/api/datasets/{ANALYSIS_ID}/parameters/temperature/slice?time_index=0&depth_index=23")
        flat = [v for row in s["values"] for v in row]
        self.assertIn(None, flat)                     # deep level has missing cells
        for row_v, row_q in zip(s["values"], s["quality"]):
            for v, q in zip(row_v, row_q):
                self.assertEqual(v is None, q == 1)
                if v is not None:
                    self.assertIsInstance(v, (int, float))
                    self.assertNotIn(v, (-9999, -1e34))

    def test_57_provenance_and_freshness_present(self) -> None:
        for did in (ANALYSIS_ID, CURRENTS_ID):
            _, summ = _SRV.get("/api/datasets")
            entry = next(d for d in summ["datasets"] if d["dataset_id"] == did)
            self.assertIn("provenance_summary", entry)
            self.assertIn("freshness", entry)
            fr = entry["freshness"]
            self.assertFalse(fr["is_real_time"])
            self.assertIn("source_name", fr)
            self.assertIn("source_time_end", fr)
            self.assertIn(fr["update_status"],
                          ("baseline", "up-to-date", "success", "failed"))
            _, detail = _SRV.get(f"/api/datasets/{did}")
            self.assertIn("freshness", detail)
            self.assertIn("provenance", detail)

    def test_58_invalid_requests_still_rejected(self) -> None:
        st, _ = _SRV.get("/api/datasets/not_a_dataset")
        self.assertEqual(st, 404)
        st, _ = _SRV.get(f"/api/datasets/{CURRENTS_ID}/parameters/temperature/slice")
        self.assertIn(st, (404, 422))
        st, _ = _SRV.get(f"/api/datasets/{ANALYSIS_ID}/parameters/temp/slice")   # alias
        self.assertEqual(st, 404)
        st, _ = _SRV.get(
            f"/api/datasets/{ANALYSIS_ID}/parameters/temperature/slice?time_index=99")
        self.assertEqual(st, 422)
        st, body = _SRV.get("/api/datasets/not_a_dataset")
        self.assertIn("error", body)
        self.assertNotIn("Traceback", json.dumps(body))

    def test_59_api_values_match_pipeline_values(self) -> None:
        # a slice served by D10 equals the same plane in the fresh D9 artifact
        st, s = _SRV.get(
            f"/api/datasets/{ANALYSIS_ID}/parameters/salinity/slice?time_index=1&depth_index=5")
        arr = _TS_DS.arrays["salinity"]
        nt, nz, ny, nx = _TS_DS.parameter("salinity").shape
        base = ((1 * nz) + 5) * ny * nx
        mism = 0
        for j in range(ny):
            for i in range(nx):
                q = arr.quality[base + j * nx + i]
                v = arr.values[base + j * nx + i]
                api_v = s["values"][j][i]
                if q == 1:
                    if api_v is not None:
                        mism += 1
                elif api_v is None or abs(api_v - v) > 1e-9:
                    mism += 1
        self.assertEqual(mism, 0)


# =========================================================================
# 6. D11-D13 FRONTEND CONTRACT VALIDATION (backend-side; frontend tests run
#    separately -- see docs/data-validation-d15.md)
# =========================================================================
class D15_6_FrontendContract(unittest.TestCase):
    FE = ROOT / "frontend" / "src"

    def _const(self, path: str, name: str) -> str:
        import re
        txt = (self.FE / path).read_text(encoding="utf-8")
        m = re.search(rf"{name}\s*=\s*'([^']+)'", txt)
        self.assertIsNotNone(m, f"{name} in {path}")
        return m.group(1)

    def test_61_frontend_dataset_ids_match_api(self) -> None:
        self.assertEqual(self._const("state/temperatureDataState.ts",
                                     "TEMPERATURE_DATASET_ID"), ANALYSIS_ID)
        self.assertEqual(self._const("state/salinityDataState.ts",
                                     "SALINITY_DATASET_ID"), ANALYSIS_ID)
        self.assertEqual(self._const("state/currentDataState.ts",
                                     "CURRENT_DATASET_ID"), CURRENTS_ID)
        _, body = _SRV.get("/api/datasets")
        self.assertEqual({d["dataset_id"] for d in body["datasets"]},
                         set(FRONTEND_CONTRACT["datasets"]))

    def test_62_frontend_parameter_ids_are_served(self) -> None:
        self.assertEqual(self._const("state/temperatureDataState.ts",
                                     "TEMPERATURE_PARAMETER_ID"), "temperature")
        self.assertEqual(self._const("state/salinityDataState.ts",
                                     "SALINITY_PARAMETER_ID"), "salinity")
        self.assertEqual(self._const("state/currentDataState.ts",
                                     "CURRENT_U_PARAMETER_ID"), "current_u")
        self.assertEqual(self._const("state/currentDataState.ts",
                                     "CURRENT_V_PARAMETER_ID"), "current_v")
        self.assertEqual(self._const("state/currentDataState.ts",
                                     "CURRENT_SPEED_PARAMETER_ID"), "current_speed")

    def test_63_each_provider_parameter_slices_with_expected_units(self) -> None:
        for pid, (did, units) in FRONTEND_CONTRACT.items():
            if pid == "datasets":
                continue
            st, s = _SRV.get(f"/api/datasets/{did}/parameters/{pid}/slice?time_index=0&depth_index=0")
            self.assertEqual(st, 200, pid)
            self.assertEqual(s["units"], units, pid)
            self.assertEqual(s["parameter"], pid)
            self.assertIsNone(s["missing_value"])

    def test_64_no_chlorophyll_anywhere_in_the_served_contract(self) -> None:
        _, body = _SRV.get("/api/datasets")
        self.assertNotIn("chlorophyll", json.dumps(body).lower())
        for did in (ANALYSIS_ID, CURRENTS_ID):
            _, p = _SRV.get(f"/api/datasets/{did}/parameters")
            self.assertNotIn("chlorophyll", json.dumps(p).lower())


# =========================================================================
# 7. D14 COMPATIBILITY VALIDATION (no live update, no production .bnx touched)
# =========================================================================
class D15_7_D14Compatibility(unittest.TestCase):
    def test_71_updater_module_and_public_api_intact(self) -> None:
        from app.data.updater import (
            MANIFEST_SCHEMA, ManifestStore, Updater, atomic_publish, make_updater,
            verify_artifact,
        )
        self.assertEqual(MANIFEST_SCHEMA, "bluenexus.update-manifest/1")
        self.assertTrue(callable(atomic_publish))
        self.assertTrue(callable(verify_artifact))
        self.assertIsInstance(make_updater(), Updater)
        _ = ManifestStore  # referenced

    def test_72_bnx_discovery_still_finds_both_datasets(self) -> None:
        _, body = _SRV.get("/api/datasets")
        self.assertEqual({d["dataset_id"] for d in body["datasets"]},
                         {ANALYSIS_ID, CURRENTS_ID})

    def test_73_manifest_and_atomic_publish_and_partial_update_deterministic(self) -> None:
        # exercise D14's manifest / verify / atomic-publish / partial-update logic
        # with fixture sources into a temp dir -- NO network, NO production .bnx.
        from app.data.updater import FixtureSource, ManifestStore, SourceVersion, Updater
        from app.data.updater import sources as smod

        before = {p.name: sha256_of(p) for p in (ROOT / "data" / "bluenexus").glob("*.bnx")}
        raw_cur = ROOT / "data" / "raw" / "currents_incois_io-hoofs_sample.nc"
        raw_ts = ROOT / "data" / "raw" / "temperature_salinity_incois_argo_sample.nc"

        with TemporaryDirectory() as td:
            tmp = Path(td)
            bnx = tmp / "bluenexus"
            bnx.mkdir()
            (bnx / f"{CURRENTS_ID}.bnx").write_bytes(
                (ROOT / "data" / "bluenexus" / f"{CURRENTS_ID}.bnx").read_bytes())
            (bnx / f"{ANALYSIS_ID}.bnx").write_bytes(
                (ROOT / "data" / "bluenexus" / f"{ANALYSIS_ID}.bnx").read_bytes())
            staging = ROOT / "data" / "update-state" / "_d15_staging"

            def ver(vid: str, group: str, ident: str) -> SourceVersion:
                return SourceVersion(group=group, version_id=vid, source_name="fixture",
                                     source_url="https://incois.gov.in/x", source_identifier=ident)

            good = FixtureSource(group="temperature-salinity", spec=TEMPERATURE_SALINITY,
                                 version=ver("2026-08-19T00:00:00Z", "temperature-salinity",
                                            ERDDAP_DATASET_ID),
                                 fixture_file=raw_ts)
            bad = FixtureSource(group="currents", spec=SURFACE_CURRENTS,
                                version=ver("CURRENTS_IO_20261231.nc", "currents",
                                            "CURRENTS_IO_20261231.nc"),
                                fixture_file=raw_cur, fail_stage="acquire")
            try:
                upd = Updater({"temperature-salinity": good, "currents": bad},
                              bnx_dir=bnx, staging_dir=staging,
                              manifest=ManifestStore(tmp / "m.json"))
                results = {r.group: r for r in upd.update(["temperature-salinity", "currents"])}
            finally:
                import shutil
                shutil.rmtree(staging, ignore_errors=True)

            # partial update: one advanced, one kept its previous version
            self.assertEqual(results["temperature-salinity"].action, "updated")
            self.assertEqual(results["currents"].action, "failed")
            # atomic publish: no temp artifact left behind
            self.assertFalse((bnx / f"{ANALYSIS_ID}.bnx.updating").exists())
            self.assertFalse((bnx / f"{CURRENTS_ID}.bnx.updating").exists())
            # the sandbox currents .bnx is byte-identical to what it started as
            self.assertEqual(
                sha256_of(bnx / f"{CURRENTS_ID}.bnx"),
                sha256_of(ROOT / "data" / "bluenexus" / f"{CURRENTS_ID}.bnx"))
            # manifest reflects each dataset's own state + freshness fields
            man = json.loads((tmp / "m.json").read_text(encoding="utf-8"))
            self.assertEqual(man["datasets"]["temperature-salinity"]["last_update"]["status"],
                             "success")
            self.assertEqual(man["datasets"]["currents"]["last_update"]["status"], "failed")
            back = read_bluenexus(bnx / f"{ANALYSIS_ID}.bnx")
            self.assertEqual(set(back.parameters), {"temperature", "salinity"})

        # D15 did not touch the production .bnx set
        after = {p.name: sha256_of(p) for p in (ROOT / "data" / "bluenexus").glob("*.bnx")}
        self.assertEqual(before, after)

    def test_74_freshness_metadata_still_served_after_all_d15_checks(self) -> None:
        _, body = _SRV.get("/api/datasets")
        for d in body["datasets"]:
            self.assertIn("freshness", d)
            self.assertIs(d["freshness"]["is_real_time"], False)


# =========================================================================
# final gate
# =========================================================================
class D15_Gate(unittest.TestCase):
    def test_zz_raw_files_byte_identical_at_end_of_d15(self) -> None:
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name],
                             "a raw D4 file changed during D15 validation")
        for did in (ANALYSIS_ID, CURRENTS_ID):
            self.assertEqual(_installed_reader(did).dataset_id, did)


if __name__ == "__main__":
    unittest.main(verbosity=2)
