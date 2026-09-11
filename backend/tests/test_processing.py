"""D8 processing-layer tests (stdlib ``unittest`` -- no test framework added).

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest -v                 # D7 + D8
    ./.venv/Scripts/python.exe -m unittest tests.test_processing -v

Tests run against the real D4 raw files via the D7 ingestion layer and never
write to them.
"""

from __future__ import annotations

import array
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.ingestion import (  # noqa: E402
    SURFACE_CURRENTS,
    TEMPERATURE_SALINITY,
    ingest_surface_currents,
    ingest_temperature_salinity,
    sha256_of,
)
from app.data.processing import (  # noqa: E402
    CANONICAL_MISSING,
    QualityFlag,
    process_dataset,
    process_surface_currents,
    process_temperature_salinity,
)

D4_HASHES = {
    "temperature_salinity_incois_argo_sample.nc":
        "17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d",
    "currents_incois_io-hoofs_sample.nc":
        "40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d",
}


class D8TemperatureSalinity(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ingested = ingest_temperature_salinity()
        cls.ds = process_dataset(cls.ingested, TEMPERATURE_SALINITY)

    def test_01_temperature_processing_succeeds(self) -> None:
        t = self.ds.variables["T_ANALYZED"]
        self.assertEqual(t.shape, (3, 24, 36, 51))
        self.assertIsInstance(t.values, array.array)
        self.assertEqual(t.values.typecode, "d")
        self.assertEqual(t.size, 3 * 24 * 36 * 51)

    def test_02_salinity_processing_succeeds(self) -> None:
        s = self.ds.variables["S_ANALYZED"]
        self.assertEqual(s.shape, (3, 24, 36, 51))
        self.assertEqual(s.valid_count + s.missing_count, s.size)

    def test_04_nan_recognised_as_missing(self) -> None:
        # temp/salinity have no NaN in source, so synthesise one via the shared
        # missing helper to prove NaN is recognised.
        from app.data.processing import is_missing

        self.assertTrue(is_missing(float("nan"), 9999.0, 9999.0))

    def test_05_declared_fill_recognised_as_missing(self) -> None:
        t = self.ds.variables["T_ANALYZED"]
        self.assertEqual(t.missing_policy.recognised_fill_value, 9999.0)
        self.assertEqual(t.missing_policy.recognised_missing_value, 9999.0)
        self.assertEqual(t.missing_policy.source_sentinel_cells, 47702)
        self.assertEqual(t.missing_count, 47702)
        # every source 9999.0 cell is now canonical NaN + MISSING quality
        src = self.ingested.variables["T_ANALYZED"].values
        for i, raw in enumerate(src):
            if raw == 9999.0:
                self.assertTrue(math.isnan(t.values[i]))
                self.assertEqual(t.quality[i], QualityFlag.MISSING)

    def test_06_missing_not_converted_to_zero(self) -> None:
        for name in ("T_ANALYZED", "S_ANALYZED"):
            v = self.ds.variables[name]
            for i, q in enumerate(v.quality):
                if q == QualityFlag.MISSING:
                    self.assertTrue(math.isnan(v.values[i]), f"{name}[{i}] not NaN")
            # zero must not have leaked in as a missing marker
            self.assertFalse(v.missing_policy.replacement_with_zero)
            self.assertFalse(v.missing_policy.interpolation)
            self.assertFalse(v.missing_policy.fill_forward_or_backward)

    def test_07_valid_values_preserved_exactly(self) -> None:
        src = self.ingested.variables["T_ANALYZED"].values
        out = self.ds.variables["T_ANALYZED"].values
        checked = 0
        for i in range(0, len(src), 733):
            if src[i] == 9999.0:
                continue
            self.assertEqual(out[i], float(src[i]))   # exact float32 -> float64
            checked += 1
        self.assertGreater(checked, 50)

    def test_08_temperature_units_normalise_to_degC(self) -> None:
        u = self.ds.variables["T_ANALYZED"].units
        self.assertEqual(u.raw_units, "degs")           # provenance retained
        self.assertEqual(u.canonical_units, "degC")
        self.assertFalse(u.converted)                   # metadata only, no math

    def test_09_salinity_units_normalise_to_PSU(self) -> None:
        u = self.ds.variables["S_ANALYZED"].units
        self.assertEqual(u.raw_units, "PSU")
        self.assertEqual(u.canonical_units, "PSU")
        self.assertFalse(u.converted)

    def test_11_coordinates_preserved_exactly(self) -> None:
        for name in ("ZAX", "latitude", "longitude", "time"):
            src = list(self.ingested.coordinates[name].values)
            out = list(self.ds.coordinates[name].values)
            self.assertEqual(src, out, f"coordinate {name} changed")

    def test_11b_depth_levels_verbatim_not_synthetic(self) -> None:
        z = self.ds.coordinates["ZAX"]
        self.assertEqual(z.count, 24)
        self.assertEqual(z.values[0], 5.0)
        self.assertEqual(z.values[-1], 2000.0)
        # irregular spacing kept (not resampled to an even grid)
        diffs = {round(z.values[i + 1] - z.values[i], 6) for i in range(z.count - 1)}
        self.assertGreater(len(diffs), 1)

    def test_12_time_coordinates_preserved(self) -> None:
        t_src = list(self.ingested.coordinates["time"].values)
        t_out = list(self.ds.coordinates["time"].values)
        self.assertEqual(t_src, t_out)
        self.assertEqual(self.ds.coordinates["time"].units,
                         "seconds since 1970-01-01T00:00:00Z")
        self.assertEqual(self.ds.coordinates["time"].calendar, "standard")
        self.assertEqual(self.ds.provenance.product_type, "analysis")

    def test_13_dimensions_unchanged(self) -> None:
        self.assertEqual(
            self.ds.dimension_sizes,
            {"time": 3, "ZAX": 24, "latitude": 36, "longitude": 51},
        )
        for v in self.ds.variables.values():
            self.assertEqual(v.dimensions, ("time", "ZAX", "latitude", "longitude"))

    def test_range_diagnostic_reports_only(self) -> None:
        t = self.ds.variables["T_ANALYZED"]
        d = t.range_diagnostic
        self.assertIsNotNone(d)
        self.assertEqual(d.values_outside_reference, 0)
        # valid range equals the D6 reference (same data), nothing clipped
        lo, hi = t.valid_min_max()
        self.assertAlmostEqual(lo, 2.540, places=3)
        self.assertAlmostEqual(hi, 32.586, places=3)

    def test_provenance_points_to_raw_file(self) -> None:
        p = self.ds.provenance
        self.assertEqual(p.raw_file, "data/raw/temperature_salinity_incois_argo_sample.nc")
        self.assertEqual(p.raw_file_sha256,
                         D4_HASHES["temperature_salinity_incois_argo_sample.nc"])
        self.assertEqual(p.source_name, "INCOIS ERDDAP")
        self.assertEqual(p.dataset_id, "incois_argo_10day_McCreary")


class D8SurfaceCurrents(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ingested = ingest_surface_currents()
        cls.ds = process_dataset(cls.ingested, SURFACE_CURRENTS)

    def test_03_current_processing_succeeds(self) -> None:
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            self.assertEqual(v.shape, (4, 1, 421, 601))
            self.assertEqual(v.values.typecode, "d")
            self.assertEqual(v.quality.typecode, "B")

    def test_04_nan_recognised_as_missing(self) -> None:
        # the currents file genuinely stores missing as NaN
        u = self.ds.variables["U"]
        self.assertEqual(u.missing_policy.source_nan_cells, 206392)
        self.assertEqual(u.missing_policy.source_sentinel_cells, 0)
        self.assertEqual(u.missing_count, 206392)
        src = self.ingested.variables["U"].values
        for i in range(0, len(src), 997):
            if math.isnan(src[i]):
                self.assertTrue(math.isnan(u.values[i]))
                self.assertEqual(u.quality[i], QualityFlag.MISSING)

    def test_05_declared_fill_recognised(self) -> None:
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            self.assertEqual(v.missing_policy.recognised_fill_value, -1e34)
            self.assertEqual(v.missing_policy.recognised_missing_value, -1e34)

    def test_06_missing_not_zero(self) -> None:
        for name in ("U", "V", "CURRENT"):
            v = self.ds.variables[name]
            n_missing_zero = sum(
                1 for i, q in enumerate(v.quality)
                if q == QualityFlag.MISSING and v.values[i] == 0.0
            )
            self.assertEqual(n_missing_zero, 0)
            self.assertFalse(v.missing_policy.replacement_with_zero)

    def test_07_valid_values_preserved_exactly(self) -> None:
        src = self.ingested.variables["CURRENT"].values
        out = self.ds.variables["CURRENT"].values
        checked = 0
        for i in range(0, len(src), 971):
            if math.isnan(src[i]):
                continue
            self.assertEqual(out[i], src[i])
            checked += 1
        self.assertGreater(checked, 100)

    def test_10_current_units_normalise_to_m_s(self) -> None:
        for name in ("U", "V", "CURRENT"):
            u = self.ds.variables[name].units
            self.assertIsNone(u.raw_units)          # no units attr in raw file
            self.assertEqual(u.canonical_units, "m s-1")
            self.assertFalse(u.converted)

    def test_11_coordinates_preserved_exactly(self) -> None:
        for name in ("TAXIS", "DEPTH1_1", "LAT", "LON"):
            src = list(self.ingested.coordinates[name].values)
            out = list(self.ds.coordinates[name].values)
            self.assertEqual(src, out, f"coordinate {name} changed")

    def test_11c_grid_not_regenerated_as_exact_twelfth_degree(self) -> None:
        lon = self.ds.coordinates["LON"]
        # stored spacing is 0.0833 exactly, NOT 1/12 = 0.08333...
        step = lon.values[1] - lon.values[0]
        self.assertAlmostEqual(step, 0.0833, places=7)
        self.assertNotAlmostEqual(step, 1.0 / 12.0, places=7)

    def test_12_time_preserved_and_forecast(self) -> None:
        t = self.ds.coordinates["TAXIS"]
        self.assertEqual(list(t.values), [48.0, 78.0, 108.0, 138.0])
        self.assertEqual(t.units, "hours since 2026-09-03 01:30")
        self.assertEqual(t.calendar, "standard")
        self.assertEqual(self.ds.product_type, "forecast")
        self.assertIn("forecast", self.ds.provenance.temporal_semantics.lower())

    def test_14_current_dimensions_unchanged(self) -> None:
        self.assertEqual(
            self.ds.dimension_sizes,
            {"TAXIS": 4, "DEPTH1_1": 1, "LAT": 421, "LON": 601},
        )
        for v in self.ds.variables.values():
            self.assertEqual(v.dimensions, ("TAXIS", "DEPTH1_1", "LAT", "LON"))
        # surface-only preserved
        self.assertEqual(self.ds.coordinates["DEPTH1_1"].count, 1)
        self.assertEqual(self.ds.coordinates["DEPTH1_1"].values[0], 0.0)

    def test_15_u_v_current_remain_separate(self) -> None:
        vs = self.ds.variables
        self.assertEqual(set(vs), {"U", "V", "CURRENT"})
        self.assertIsNot(vs["U"].values, vs["V"].values)
        self.assertIsNot(vs["U"].values, vs["CURRENT"].values)
        self.assertIsNot(vs["V"].values, vs["CURRENT"].values)

    def test_16_current_not_overwritten_by_recalculation(self) -> None:
        u = self.ds.variables["U"].values
        v = self.ds.variables["V"].values
        c = self.ds.variables["CURRENT"].values
        cq = self.ds.variables["CURRENT"].quality
        # CURRENT retains its source identity/attrs and its own missing pattern
        self.assertEqual(self.ds.variables["CURRENT"].long_name, "Surface Currents (m/s)")
        self.assertEqual(self.ds.variables["CURRENT"].missing_count, 207888)
        self.assertNotEqual(
            self.ds.variables["CURRENT"].missing_count,
            self.ds.variables["U"].missing_count,
        )
        # A recomputed field would be bit-identical to hypot(U, V); the source
        # CURRENT is not -- it carries its own tiny rounding (D6: up to ~4e-16).
        exact_matches = 0
        differs = 0
        for i in range(0, len(c), 101):
            if cq[i] != QualityFlag.VALID:
                continue
            if c[i] == math.hypot(u[i], v[i]):
                exact_matches += 1
            else:
                differs += 1
        self.assertGreater(differs, 0,
                           "CURRENT is bit-identical to sqrt(U^2+V^2) -- looks recomputed")
        # a cell where U and V are valid but source CURRENT is missing must stay
        # missing -- a recomputed field would have filled it
        for i in range(len(c)):
            if (self.ds.variables["U"].quality[i] == QualityFlag.VALID
                    and self.ds.variables["V"].quality[i] == QualityFlag.VALID
                    and cq[i] == QualityFlag.MISSING):
                self.assertTrue(math.isnan(c[i]))
                break
        self.assertTrue(self.ds.vector_consistency.source_current_is_authoritative)
        self.assertFalse(self.ds.vector_consistency.recomputed_field_created)

    def test_17_vector_consistency_diagnostic_works(self) -> None:
        vc = self.ds.vector_consistency
        self.assertIsNotNone(vc)
        self.assertEqual(vc.jointly_valid_cells, 804196)
        self.assertLess(vc.max_abs_difference, 1e-9)
        self.assertEqual(vc.cells_within_1e_6, vc.jointly_valid_cells)

    def test_range_diagnostics_report_only_no_clip(self) -> None:
        for name in ("U", "V", "CURRENT"):
            d = self.ds.variables[name].range_diagnostic
            self.assertIsNotNone(d)
            self.assertEqual(d.values_outside_reference, 0)


class D8RawFileImmutability(unittest.TestCase):
    def test_18_raw_hashes_unchanged(self) -> None:
        process_temperature_salinity()
        process_surface_currents()
        for spec in (TEMPERATURE_SALINITY, SURFACE_CURRENTS):
            with self.subTest(spec.name):
                self.assertEqual(sha256_of(spec.path()), D4_HASHES[spec.path().name])

    def test_source_buffer_reference_is_untouched(self) -> None:
        ing = ingest_temperature_salinity()
        before = list(ing.variables["T_ANALYZED"].values)
        cleaned = process_dataset(ing, TEMPERATURE_SALINITY)
        # cleaned.source_values IS the D7 buffer, still holding raw 9999.0 etc.
        self.assertIs(
            cleaned.variables["T_ANALYZED"].source_values,
            ing.variables["T_ANALYZED"].values,
        )
        self.assertEqual(list(ing.variables["T_ANALYZED"].values), before)
        self.assertIn(9999.0, cleaned.variables["T_ANALYZED"].source_values)


if __name__ == "__main__":
    unittest.main(verbosity=2)
