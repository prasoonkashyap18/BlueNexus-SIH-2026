"""D9 BlueNexus-format tests (stdlib ``unittest``).

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest -v                     # D7 + D8 + D9
    ./.venv/Scripts/python.exe -m unittest tests.test_format -v

Operate against the real D4 files via the D7/D8 layers; never write to them.
Floating-point comparisons use exact round-trip equality for values that must
survive serialisation losslessly (binary float64) and ``assertAlmostEqual`` for
derived quantities.
"""

from __future__ import annotations

import array
import hashlib
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.ingestion import sha256_of  # noqa: E402
from app.data.ingestion.registry import SURFACE_CURRENTS, TEMPERATURE_SALINITY  # noqa: E402
from app.data.processing import process_surface_currents, process_temperature_salinity  # noqa: E402
from app.data.bluenexus import (  # noqa: E402
    SCHEMA_VERSION,
    BlueNexusDataset,
    contract_sha256,
    convert_surface_currents,
    convert_temperature_salinity,
    convert_to_bluenexus,
    parameter,
    parameter_slice,
    read_bluenexus,
    read_manifest,
    write_bluenexus,
)

D4_HASHES = {
    "temperature_salinity_incois_argo_sample.nc":
        "17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d",
    "currents_incois_io-hoofs_sample.nc":
        "40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d",
}
FIXED_TS = "2026-01-01T00:00:00Z"


def _values_equal(a: array.array, b: array.array) -> bool:
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if math.isnan(x) and math.isnan(y):
            continue
        if x != y:
            return False
    return True


class D9Conversion(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ts = convert_temperature_salinity()
        cls.cur = convert_surface_currents()

    # 1-3 conversions succeed
    def test_01_temperature_converts(self) -> None:
        self.assertIn("temperature", self.ts.parameters)
        self.assertEqual(self.ts.parameter("temperature").shape, (3, 24, 36, 51))

    def test_02_salinity_converts(self) -> None:
        self.assertIn("salinity", self.ts.parameters)
        self.assertEqual(self.ts.parameter("salinity").units, "PSU")

    def test_03_currents_convert(self) -> None:
        for pid in ("current_u", "current_v", "current_speed"):
            self.assertIn(pid, self.cur.parameters)
            self.assertEqual(self.cur.parameter(pid).shape, (4, 1, 421, 601))

    # 4 parameter ids canonical
    def test_04_parameter_ids_are_canonical(self) -> None:
        self.assertEqual(set(self.ts.parameters), {"temperature", "salinity"})
        self.assertEqual(
            set(self.cur.parameters), {"current_u", "current_v", "current_speed"}
        )
        # aliases stored but not usable as ids
        self.assertIn("temp", self.ts.parameter("temperature").display_aliases)
        with self.assertRaises(KeyError):
            parameter("temp")
        with self.assertRaises(KeyError):
            parameter("sst")
        # temperature is not labelled SST
        self.assertNotIn("sst", self.ts.parameter("temperature").display_aliases)
        self.assertFalse(self.ts.parameter("temperature").surface_only)

    # 5-6 dims & shapes preserved
    def test_05_dimensions_preserved(self) -> None:
        self.assertEqual(
            [(d.name, d.role, d.size) for d in self.ts.dimensions],
            [("time", "time", 3), ("ZAX", "depth", 24),
             ("latitude", "latitude", 36), ("longitude", "longitude", 51)],
        )
        self.assertEqual(
            [(d.name, d.role, d.size) for d in self.cur.dimensions],
            [("DEPTH1_1", "depth", 1), ("LON", "longitude", 601),
             ("TAXIS", "time", 4), ("LAT", "latitude", 421)],
        )

    def test_06_shapes_preserved_and_not_padded(self) -> None:
        self.assertEqual(self.ts.parameter("temperature").shape, (3, 24, 36, 51))
        self.assertEqual(self.cur.parameter("current_u").shape, (4, 1, 421, 601))
        # currents depth stays length 1 -- not padded to 24
        self.assertEqual(self.cur.coordinate("depth").count, 1)
        self.assertEqual(self.ts.coordinate("depth").count, 24)

    # 7-9 coordinates preserved exactly
    def test_07_coordinates_preserved_exactly(self) -> None:
        cleaned = process_temperature_salinity()
        for role, src_name in (("time", "time"), ("depth", "ZAX"),
                               ("latitude", "latitude"), ("longitude", "longitude")):
            src = list(cleaned.coordinates[src_name].values)
            out = list(self.ts.coordinate(role).values)
            self.assertEqual(src, out, f"{role} changed")
        cleaned_c = process_surface_currents()
        for role, src_name in (("time", "TAXIS"), ("depth", "DEPTH1_1"),
                               ("latitude", "LAT"), ("longitude", "LON")):
            src = list(cleaned_c.coordinates[src_name].values)
            out = list(self.cur.coordinate(role).values)
            self.assertEqual(src, out, f"{role} changed")

    def test_08_current_grid_spacing_is_0_0833_not_one_twelfth(self) -> None:
        lon = self.cur.coordinate("longitude").values
        lat = self.cur.coordinate("latitude").values
        self.assertAlmostEqual(lon[1] - lon[0], 0.0833, places=7)
        self.assertAlmostEqual(lat[1] - lat[0], 0.0833, places=7)
        self.assertNotAlmostEqual(lon[1] - lon[0], 1.0 / 12.0, places=7)
        # endpoints are the stored values, not a generated 50.0 / 100.0
        self.assertAlmostEqual(lon[0], 49.992, places=6)
        self.assertNotAlmostEqual(lon[0], 50.0, places=6)

    def test_09_depth_arrays_preserved(self) -> None:
        z = self.ts.coordinate("depth")
        self.assertEqual(z.count, 24)
        self.assertEqual(z.values[0], 5.0)
        self.assertEqual(z.values[-1], 2000.0)
        self.assertEqual(z.regular_step, None)          # irregular kept irregular
        self.assertEqual(self.cur.coordinate("depth").values, (0.0,))
        self.assertTrue(self.cur.metadata.depth_coverage["surface_only"])

    # 10 time metadata
    def test_10_time_metadata_preserved(self) -> None:
        t = self.ts.coordinate("time")
        self.assertEqual(t.units, "seconds since 1970-01-01T00:00:00Z")
        self.assertEqual(t.calendar, "standard")
        self.assertEqual(t.iso_times[0], "2026-07-10T00:00:00Z")
        self.assertEqual(t.iso_times[-1], "2026-07-30T00:00:00Z")
        self.assertFalse(t.timezone_is_assumed)          # units had explicit Z
        tc = self.cur.coordinate("time")
        self.assertEqual(tc.units, "hours since 2026-09-03 01:30")
        self.assertEqual(tc.iso_times,
                         ("2026-09-05T01:30:00Z", "2026-09-06T07:30:00Z",
                          "2026-09-07T13:30:00Z", "2026-09-08T19:30:00Z"))
        self.assertTrue(tc.timezone_is_assumed)          # no offset in the string
        self.assertEqual(tc.timezone, "UTC")

    # 11 units
    def test_11_units_preserved(self) -> None:
        self.assertEqual(self.ts.parameter("temperature").units, "degC")
        self.assertEqual(self.ts.parameter("temperature").raw_units, "degs")
        self.assertEqual(self.ts.parameter("salinity").units, "PSU")
        for pid in ("current_u", "current_v", "current_speed"):
            self.assertEqual(self.cur.parameter(pid).units, "m s-1")
            self.assertIsNone(self.cur.parameter(pid).raw_units)

    # 12 product types
    def test_12_product_types_preserved(self) -> None:
        self.assertEqual(self.ts.product_type, "analysis")
        self.assertEqual(self.ts.metadata.data_status, "analysis")
        self.assertEqual(self.cur.product_type, "forecast")
        self.assertEqual(self.cur.metadata.data_status, "forecast")
        for ds in (self.ts, self.cur):
            for n in ds.metadata.notes:
                self.assertNotIn("real-time", n.lower().replace("not real-time", ""))

    # 13-15 missing / quality
    def test_13_missing_values_not_zero(self) -> None:
        arr = self.cur.array("current_u")
        for i, q in enumerate(arr.quality):
            if q == 1:
                self.assertTrue(math.isnan(arr.values[i]))
        # a real zero-ish value stays a value, not flagged missing
        n_zeroish = sum(1 for i, q in enumerate(arr.quality)
                        if q == 0 and abs(arr.values[i]) < 1e-6)
        self.assertGreater(n_zeroish, 0)

    def test_14_missing_serialises_safely_as_null(self) -> None:
        import json
        sl = parameter_slice(self.ts, "temperature", time_index=1, depth_index=10)
        flat = [x for row in sl["values"] for x in row]
        self.assertIn(None, flat)                         # missing -> null
        for x in flat:
            self.assertNotIn(x, (0.0, -1.0, -9999.0, -1e34) if x is not None else (1,))
        json.dumps(sl)                                    # must not raise
        # null cells line up with quality == 1
        for vrow, qrow in zip(sl["values"], sl["quality"]):
            for v, q in zip(vrow, qrow):
                self.assertEqual(v is None, q == 1)

    def test_15_quality_flags_survive_serialisation(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = write_bluenexus(self.cur, Path(d) / "c.bnx", generated_at=FIXED_TS)
            back = read_bluenexus(p)
        for pid in ("current_u", "current_v", "current_speed"):
            self.assertEqual(
                list(self.cur.array(pid).quality), list(back.array(pid).quality)
            )
            self.assertEqual(set(back.array(pid).quality) <= {0, 1}, True)

    # 16-17 vector handling
    def test_16_u_v_current_separate(self) -> None:
        u = self.cur.array("current_u").values
        v = self.cur.array("current_v").values
        c = self.cur.array("current_speed").values
        self.assertIsNot(u, v)
        self.assertIsNot(u, c)
        self.assertIsNot(v, c)
        self.assertNotEqual(
            self.cur.parameter("current_u").missing_count,
            self.cur.parameter("current_speed").missing_count,
        )
        grp = self.cur.metadata.vector_groups["surface_current"]
        self.assertEqual(grp["components"], {"eastward": "current_u", "northward": "current_v"})
        self.assertEqual(grp["magnitude"], "current_speed")

    def test_17_source_current_authoritative(self) -> None:
        speed = self.cur.parameter("current_speed")
        self.assertTrue(speed.authoritative)
        self.assertEqual(speed.kind, "vector_magnitude")
        self.assertEqual(speed.source_variable, "CURRENT")
        # values are the source field, not a bit-exact recompute of hypot(u,v)
        u = self.cur.array("current_u").values
        v = self.cur.array("current_v").values
        c = self.cur.array("current_speed").values
        differs = 0
        for i in range(0, len(c), 137):
            if self.cur.array("current_speed").quality[i]:
                continue
            if c[i] != math.hypot(u[i], v[i]):
                differs += 1
        self.assertGreater(differs, 0)

    # 18 provenance
    def test_18_provenance_survives_serialisation(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = write_bluenexus(self.ts, Path(d) / "t.bnx", generated_at=FIXED_TS)
            back = read_bluenexus(p)
        pr = back.provenance
        self.assertEqual(pr.source_file, "data/raw/temperature_salinity_incois_argo_sample.nc")
        self.assertEqual(pr.source_file_sha256,
                         D4_HASHES["temperature_salinity_incois_argo_sample.nc"])
        self.assertEqual(pr.source_name, "INCOIS ERDDAP")
        self.assertEqual(pr.source_dataset_id, "incois_argo_10day_McCreary")
        self.assertIn("D9 BlueNexus format", pr.pipeline_stages)
        self.assertTrue(pr.d8_processing_log)
        self.assertEqual(pr.canonical_units["temperature"], "degC")
        self.assertEqual(pr.original_units["temperature"], "degs")


class D9RoundTrip(unittest.TestCase):
    """18. Full round-trip: convert -> write -> read -> compare."""

    def _roundtrip(self, ds: BlueNexusDataset) -> BlueNexusDataset:
        with tempfile.TemporaryDirectory() as d:
            p = write_bluenexus(ds, Path(d) / f"{ds.dataset_id}.bnx", generated_at=FIXED_TS)
            return read_bluenexus(p)

    def test_19_values_preserved_through_serialisation(self) -> None:
        for ds in (convert_temperature_salinity(), convert_surface_currents()):
            back = self._roundtrip(ds)
            for pid in ds.parameters:
                self.assertTrue(
                    _values_equal(ds.array(pid).values, back.array(pid).values),
                    f"{ds.dataset_id}/{pid} values changed",
                )
                self.assertEqual(
                    list(ds.array(pid).quality), list(back.array(pid).quality)
                )

    def test_20_metadata_preserved_through_serialisation(self) -> None:
        for ds in (convert_temperature_salinity(), convert_surface_currents()):
            back = self._roundtrip(ds)
            self.assertEqual(ds.contract(), back.contract())
            self.assertEqual(contract_sha256(ds), contract_sha256(back))
            self.assertEqual(ds.schema_version, SCHEMA_VERSION)
            # dimensions, coordinates, parameter ids, product type, provenance
            self.assertEqual([d.name for d in ds.dimensions],
                             [d.name for d in back.dimensions])
            for role in ds.coordinates:
                self.assertEqual(ds.coordinate(role).values, back.coordinate(role).values)
            self.assertEqual(set(ds.parameters), set(back.parameters))
            self.assertEqual(ds.product_type, back.product_type)

    def test_21_output_is_deterministic(self) -> None:
        # (a) contract is a pure function of the data
        self.assertEqual(
            contract_sha256(convert_temperature_salinity()),
            contract_sha256(convert_temperature_salinity()),
        )
        self.assertEqual(
            contract_sha256(convert_surface_currents()),
            contract_sha256(convert_surface_currents()),
        )
        # (b) serialised bytes are identical given a fixed generation timestamp
        with tempfile.TemporaryDirectory() as d:
            a = write_bluenexus(convert_surface_currents(),
                                Path(d) / "a.bnx", generated_at=FIXED_TS)
            b = write_bluenexus(convert_surface_currents(),
                                Path(d) / "b.bnx", generated_at=FIXED_TS)
            ha = hashlib.sha256(a.read_bytes()).hexdigest()
            hb = hashlib.sha256(b.read_bytes()).hexdigest()
        self.assertEqual(ha, hb)

    def test_manifest_readable_without_full_load(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = write_bluenexus(convert_surface_currents(),
                                Path(d) / "c.bnx", generated_at=FIXED_TS)
            m = read_manifest(p)
        self.assertEqual(m["contract"]["schema_version"], SCHEMA_VERSION)
        self.assertEqual(m["generation"]["generated_at_utc"], FIXED_TS)
        keys = {e["key"] for e in m["arrays_index"]}
        self.assertEqual(
            keys,
            {"current_u.values", "current_u.quality", "current_v.values",
             "current_v.quality", "current_speed.values", "current_speed.quality"},
        )

    def test_write_refuses_data_raw(self) -> None:
        with self.assertRaises(RuntimeError):
            write_bluenexus(convert_temperature_salinity(),
                            Path("data/raw/should_not_write.bnx"))


class D9RawFileIntegrity(unittest.TestCase):
    def test_22_raw_hashes_unchanged(self) -> None:
        convert_temperature_salinity()
        convert_surface_currents()
        with tempfile.TemporaryDirectory() as d:
            write_bluenexus(convert_surface_currents(), Path(d) / "x.bnx", generated_at=FIXED_TS)
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            with self.subTest(spec.name):
                self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name])


if __name__ == "__main__":
    unittest.main(verbosity=2)
