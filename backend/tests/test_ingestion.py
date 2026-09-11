"""D7 ingestion-layer tests (stdlib ``unittest`` -- no test framework added).

Run from the ``backend/`` directory::

    python -m unittest -v

or just::

    python -m unittest discover -s tests

The tests operate against the real D4 raw files in ``data/raw/`` and never
write to them; :class:`RawFilesUnchanged` asserts their SHA-256 hashes are
identical before and after the whole run.
"""

from __future__ import annotations

import array
import math
import sys
import unittest
from pathlib import Path

# make ``app`` importable when run from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.ingestion import (  # noqa: E402
    SURFACE_CURRENTS,
    TEMPERATURE_SALINITY,
    IngestedDataset,
    NetCDF3File,
    UnsupportedNetCDFError,
    ingest_surface_currents,
    ingest_temperature_salinity,
    run_checks,
    sha256_of,
)

# D4 acquisition hashes (docs/data-acquisition.md, re-verified in D5 and D6)
D4_HASHES = {
    "temperature_salinity_incois_argo_sample.nc":
        "17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d",
    "currents_incois_io-hoofs_sample.nc":
        "40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d",
}


class RawFileIntegrity(unittest.TestCase):
    """(10) Raw files remain byte-for-byte unchanged."""

    def test_hashes_match_d4(self) -> None:
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            with self.subTest(spec.name):
                path = spec.path()
                self.assertTrue(path.is_file(), f"missing raw file: {path}")
                self.assertEqual(sha256_of(path), D4_HASHES[path.name])


class TemperatureSalinityIngest(unittest.TestCase):
    """(1)(2)(3)(6)(7)(9) temperature/salinity file + variables + coords."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.ds: IngestedDataset = ingest_temperature_salinity()

    def test_file_loads(self) -> None:
        self.assertEqual(self.ds.name, "incois_argo_10day_analysis")
        self.assertTrue(self.ds.file_format.startswith("NetCDF-3"))
        self.assertEqual(
            self.ds.metadata.file_sha256,
            D4_HASHES["temperature_salinity_incois_argo_sample.nc"],
        )

    def test_dimensions(self) -> None:
        self.assertEqual(
            self.ds.dimension_sizes,
            {"time": 3, "ZAX": 24, "latitude": 36, "longitude": 51},
        )
        # file order preserved
        self.assertEqual(
            [d.name for d in self.ds.dimensions],
            ["time", "ZAX", "latitude", "longitude"],
        )
        self.assertFalse(any(d.is_unlimited for d in self.ds.dimensions))

    def test_temperature_variable_loads(self) -> None:
        t = self.ds.variables["T_ANALYZED"]
        self.assertEqual(t.dtype, "float32")
        self.assertEqual(t.dimensions, ("time", "ZAX", "latitude", "longitude"))
        self.assertEqual(t.shape, (3, 24, 36, 51))
        self.assertEqual(t.size, 3 * 24 * 36 * 51)
        self.assertIsInstance(t.values, array.array)

    def test_salinity_variable_loads(self) -> None:
        s = self.ds.variables["S_ANALYZED"]
        self.assertEqual(s.dtype, "float32")
        self.assertEqual(s.dimensions, ("time", "ZAX", "latitude", "longitude"))
        self.assertEqual(s.shape, (3, 24, 36, 51))
        self.assertEqual(s.standard_name, "sea_water_practical_salinity")

    def test_dimension_order_preserved_in_variables(self) -> None:
        for name in ("T_ANALYZED", "S_ANALYZED"):
            self.assertEqual(
                self.ds.variables[name].dimensions,
                ("time", "ZAX", "latitude", "longitude"),
            )

    def test_coordinate_arrays_load(self) -> None:
        c = self.ds.coordinates
        self.assertEqual(set(c), {"time", "ZAX", "latitude", "longitude"})
        self.assertEqual(c["time"].count, 3)
        self.assertEqual(c["ZAX"].count, 24)
        self.assertEqual(c["latitude"].count, 36)
        self.assertEqual(c["longitude"].count, 51)
        # roles wired up
        self.assertIs(self.ds.time, c["time"])
        self.assertIs(self.ds.depth, c["ZAX"])
        self.assertIs(self.ds.latitude, c["latitude"])
        self.assertIs(self.ds.longitude, c["longitude"])

    def test_depth_levels_irregular_and_preserved(self) -> None:
        z = self.ds.depth
        self.assertEqual(z.count, 24)
        self.assertTrue(z.is_monotonic_ascending)
        self.assertAlmostEqual(z.values[0], 5.0, places=5)
        self.assertAlmostEqual(z.values[-1], 2000.0, places=3)
        # not evenly spaced -- D7 must not assume it is
        self.assertIsNone(z.step_if_regular())

    def test_lat_lon_regular(self) -> None:
        self.assertAlmostEqual(self.ds.latitude.step_if_regular(), 1.0, places=6)
        self.assertAlmostEqual(self.ds.longitude.step_if_regular(), 1.0, places=6)

    def test_fill_values_recognised(self) -> None:
        for name in ("T_ANALYZED", "S_ANALYZED"):
            v = self.ds.variables[name]
            self.assertEqual(v.fill_value, 9999.0)
            self.assertEqual(v.missing_value_attr, 9999.0)
            mask = v.missing_mask()
            self.assertEqual(len(mask), v.size)
            self.assertEqual(sum(mask), v.missing_count())
            self.assertGreater(v.missing_count(), 0)
            self.assertEqual(v.valid_count(), v.size - v.missing_count())
            # temp/salinity really do store 9999.0 literally (unlike currents)
            self.assertEqual(v.missing_representation, "sentinel")
            self.assertEqual(v.observed_nan_count, 0)

    def test_missing_values_not_applied_to_buffer(self) -> None:
        v = self.ds.variables["T_ANALYZED"]
        # the raw buffer still contains literal 9999.0 fill entries
        self.assertIn(9999.0, v.values)
        # derived valid range excludes them
        lo, hi = v.valid_range()
        self.assertLess(hi, 9999.0)
        self.assertGreater(lo, -100.0)

    def test_unit_metadata_raw_and_normalized(self) -> None:
        t = self.ds.variables["T_ANALYZED"]
        self.assertEqual(t.units.raw_units, "degs")          # exactly as stored
        self.assertEqual(t.units.normalized_units, "degC")   # D6 interpretation
        self.assertIn("Celsius", t.units.units_source)

        s = self.ds.variables["S_ANALYZED"]
        self.assertEqual(s.units.raw_units, "PSU")
        self.assertEqual(s.units.normalized_units, "PSU")

    def test_metadata_product_type(self) -> None:
        self.assertEqual(self.ds.metadata.product_type, "analysis")
        self.assertEqual(self.ds.metadata.dataset_id, "incois_argo_10day_McCreary")

    def test_schema_report_passes(self) -> None:
        report = run_checks(self.ds, TEMPERATURE_SALINITY)
        self.assertTrue(report.ok, msg=str(report))
        self.assertEqual(report.errors, ())


class SurfaceCurrentsIngest(unittest.TestCase):
    """(4)(5)(6)(7)(9) currents file + U/V/CURRENT + coords."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.ds: IngestedDataset = ingest_surface_currents()

    def test_file_loads(self) -> None:
        self.assertEqual(self.ds.name, "incois_io_hoofs_surface_currents")
        self.assertTrue(self.ds.file_format.startswith("NetCDF-3"))
        self.assertEqual(
            self.ds.metadata.file_sha256,
            D4_HASHES["currents_incois_io-hoofs_sample.nc"],
        )

    def test_dimensions(self) -> None:
        self.assertEqual(
            self.ds.dimension_sizes,
            {"TAXIS": 4, "DEPTH1_1": 1, "LAT": 421, "LON": 601},
        )

    def test_u_v_current_load_as_separate_variables(self) -> None:
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            self.assertEqual(v.dtype, "float64")
            self.assertEqual(v.dimensions, ("TAXIS", "DEPTH1_1", "LAT", "LON"))
            self.assertEqual(v.shape, (4, 1, 421, 601))
            self.assertEqual(v.size, 4 * 1 * 421 * 601)
        # three distinct buffers
        self.assertIsNot(self.ds.variables["U"].values, self.ds.variables["CURRENT"].values)

    def test_current_is_not_recomputed(self) -> None:
        """CURRENT must be the INCOIS-supplied field, not sqrt(U^2+V^2) we made."""
        cur = self.ds.variables["CURRENT"]
        u = self.ds.variables["U"].values
        v = self.ds.variables["V"].values
        c = cur.values
        # CURRENT was actually read from the file (it carries its own long_name)
        self.assertEqual(cur.long_name, "Surface Currents (m/s)")
        self.assertIsNone(cur.standard_name)  # file has no standard_name on CURRENT
        # spot-check the D6 identity on a handful of present cells (read-only)
        checked = 0
        for i in range(0, len(c), 9973):
            if cur.is_missing(u[i]) or cur.is_missing(v[i]) or cur.is_missing(c[i]):
                continue
            self.assertAlmostEqual(math.hypot(u[i], v[i]), c[i], places=6)
            checked += 1
        self.assertGreater(checked, 0)

    def test_missing_cells_stored_as_nan_not_sentinel(self) -> None:
        """D7 finding: IO-HOOFS missing cells are IEEE NaN; _FillValue attr says -1e34."""
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            self.assertEqual(v.fill_value, -1e34)             # declared attribute
            self.assertEqual(v.missing_representation, "nan")  # actual buffer encoding
            self.assertGreater(v.observed_nan_count, 0)
            self.assertEqual(v.observed_sentinel_count, 0)
            self.assertEqual(v.missing_count(), v.observed_nan_count)
            # raw buffer really contains NaN, never -1e34
            self.assertTrue(any(x != x for x in v.values))
            self.assertNotIn(-1e34, v.values)

    def test_dimension_order_preserved(self) -> None:
        self.assertEqual(
            [d.name for d in self.ds.dimensions],
            ["DEPTH1_1", "LON", "TAXIS", "LAT"],  # declaration order in the file
        )
        # but variables use the logical order
        self.assertEqual(
            self.ds.variables["U"].dimensions, ("TAXIS", "DEPTH1_1", "LAT", "LON")
        )

    def test_coordinate_arrays_load(self) -> None:
        c = self.ds.coordinates
        self.assertEqual(set(c), {"TAXIS", "DEPTH1_1", "LAT", "LON"})
        self.assertEqual(c["TAXIS"].count, 4)
        self.assertEqual(c["LAT"].count, 421)
        self.assertEqual(c["LON"].count, 601)

    def test_surface_only_single_depth_level(self) -> None:
        z = self.ds.depth
        self.assertEqual(z.count, 1)
        self.assertAlmostEqual(z.values[0], 0.0, places=9)

    def test_fill_values_recognised(self) -> None:
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            self.assertEqual(v.fill_value, -1e34)
            self.assertGreater(v.missing_count(), 0)
            self.assertEqual(sum(v.missing_mask()), v.missing_count())

    def test_unit_metadata_normalized_only(self) -> None:
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            self.assertIsNone(v.units.raw_units)           # absent in the raw file
            self.assertEqual(v.units.normalized_units, "m s-1")
            self.assertIn("D6", v.units.units_source)

    def test_metadata_product_type_forecast(self) -> None:
        self.assertEqual(self.ds.metadata.product_type, "forecast")
        self.assertIn("forecast", self.ds.metadata.temporal_semantics.lower())

    def test_schema_report_passes(self) -> None:
        report = run_checks(self.ds, SURFACE_CURRENTS)
        self.assertTrue(report.ok, msg=str(report))
        self.assertEqual(report.errors, ())


class ReaderBehaviour(unittest.TestCase):
    """Low-level reader guarantees the ingestor relies on."""

    def test_values_are_native_endian_and_sane(self) -> None:
        with NetCDF3File(TEMPERATURE_SALINITY.path()) as nc:
            lat = nc.read_values("latitude")
            self.assertIsInstance(lat, array.array)
            self.assertAlmostEqual(lat[0], -9.5, places=5)
            self.assertAlmostEqual(lat[-1], 25.5, places=5)

    def test_hdf5_rejected(self) -> None:
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as fh:
            fh.write(b"\x89HDF\r\n\x1a\n" + b"\x00" * 64)
            tmp = fh.name
        try:
            with self.assertRaises(UnsupportedNetCDFError):
                NetCDF3File(tmp).open()
        finally:
            Path(tmp).unlink(missing_ok=True)


class RawFilesUnchangedAtEnd(unittest.TestCase):
    """Runs last (name sorts high): the ingest run touched nothing on disk."""

    def test_zzz_hashes_still_match(self) -> None:
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            with self.subTest(spec.name):
                self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name])


if __name__ == "__main__":
    unittest.main(verbosity=2)
