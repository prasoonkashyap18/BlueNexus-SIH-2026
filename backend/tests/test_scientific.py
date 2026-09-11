"""Step 37 -- xarray scientific-layer tests (stdlib ``unittest``).

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_scientific -v

These tests build a tiny in-memory :class:`xarray.Dataset` (no file I/O, no
real NetCDF) and exercise :class:`app.data.scientific.ScientificDataset`:

1. dimensions are discovered correctly
2. coordinates are discovered correctly
3. variables are discovered correctly
4. variable units / attributes are preserved
5. indexed (positional) slicing returns the expected values
6. multidimensional time / depth / lat / lon slicing works
7. NaN / missing values remain unchanged
8. the layer never mutates the original xarray Dataset
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np
import xarray as xr

# make ``app`` importable when run from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.scientific import ScientificDataset, ScientificVariable  # noqa: E402


def _tiny_dataset() -> xr.Dataset:
    """A 4-D (time, depth, lat, lon) dataset that mimics the shape of the real
    temperature / salinity / current products -- with deliberate NaN holes."""
    time = np.array(
        ["2026-01-01", "2026-01-11", "2026-01-21"], dtype="datetime64[ns]"
    )
    depth = np.array([5.0, 100.0, 2000.0])          # irregular, like the real files
    lat = np.array([0.0, 2.5, 5.0, 7.5])
    lon = np.array([60.0, 62.5, 65.0, 67.5, 70.0])

    shape = (time.size, depth.size, lat.size, lon.size)
    temp = np.arange(np.prod(shape), dtype="float64").reshape(shape)
    # punch a few missing cells (land / below-bathymetry style holes)
    temp[0, 2, 0, 0] = np.nan
    temp[1, 0, 3, 4] = np.nan
    temp[2, 1, 1, 2] = np.nan

    salt = (temp / 10.0) + 34.0    # NaNs propagate to the same cells

    ds = xr.Dataset(
        {
            "temperature": (("time", "depth", "lat", "lon"), temp,
                            {"units": "degC", "long_name": "sea water temperature",
                             "standard_name": "sea_water_temperature"}),
            "salinity": (("time", "depth", "lat", "lon"), salt,
                         {"units": "PSU", "long_name": "sea water salinity"}),
        },
        coords={
            "time": ("time", time, {"standard_name": "time"}),
            "depth": ("depth", depth, {"units": "m", "positive": "down"}),
            "lat": ("lat", lat, {"units": "degrees_north"}),
            "lon": ("lon", lon, {"units": "degrees_east"}),
        },
        attrs={"title": "tiny synthetic test cube", "Conventions": "CF-1.8"},
    )
    return ds


class ScientificDatasetStructure(unittest.TestCase):
    def setUp(self) -> None:
        self.ds = _tiny_dataset()
        self.sci = ScientificDataset(self.ds)

    def test_01_dimensions_discovered(self) -> None:
        self.assertEqual(
            self.sci.dimensions(),
            {"time": 3, "depth": 3, "lat": 4, "lon": 5},
        )
        self.assertEqual(
            self.sci.dimension_names(), ("time", "depth", "lat", "lon")
        )

    def test_02_coordinates_discovered(self) -> None:
        self.assertEqual(
            set(self.sci.coordinate_names()), {"time", "depth", "lat", "lon"}
        )
        self.assertEqual(
            set(self.sci.dimension_coordinate_names()),
            {"time", "depth", "lat", "lon"},
        )
        depth = self.sci.coordinate("depth")
        self.assertIsInstance(depth, ScientificVariable)
        np.testing.assert_array_equal(depth.values(), [5.0, 100.0, 2000.0])
        with self.assertRaises(KeyError):
            self.sci.coordinate("not_a_coord")

    def test_03_variables_discovered(self) -> None:
        self.assertEqual(
            set(self.sci.variable_names()), {"temperature", "salinity"}
        )
        self.assertTrue(self.sci.has_variable("temperature"))
        self.assertFalse(self.sci.has_variable("depth"))   # a coord, not a data var
        with self.assertRaises(KeyError):
            self.sci.variable("depth")

    def test_04_units_and_attributes_preserved(self) -> None:
        temp = self.sci.variable("temperature")
        self.assertEqual(temp.units, "degC")
        self.assertEqual(temp.attributes["long_name"], "sea water temperature")
        self.assertEqual(temp.attributes["standard_name"], "sea_water_temperature")
        self.assertEqual(temp.dimensions, ("time", "depth", "lat", "lon"))
        self.assertEqual(str(temp.dtype), "float64")

        self.assertEqual(self.sci.units("salinity"), "PSU")
        self.assertEqual(self.sci.units("depth"), "m")
        self.assertIsNone(self.sci.units("time"))   # no units attr on time

        # dataset-level global attributes
        self.assertEqual(self.sci.attributes["title"], "tiny synthetic test cube")
        self.assertEqual(self.sci.attribute("Conventions"), "CF-1.8")

    def test_04b_attribute_copies_do_not_leak(self) -> None:
        attrs = self.sci.variable("temperature").attributes
        attrs["units"] = "MUTATED"
        # original xarray attrs untouched
        self.assertEqual(self.ds["temperature"].attrs["units"], "degC")


class ScientificDatasetSlicing(unittest.TestCase):
    def setUp(self) -> None:
        self.ds = _tiny_dataset()
        self.sci = ScientificDataset(self.ds)

    def test_05_indexed_slicing_returns_expected_values(self) -> None:
        # single indexed cell, compared against the raw numpy source
        raw = self.ds["temperature"].values
        picked = self.sci.variable("temperature").isel(
            time=1, depth=2, lat=3, lon=4
        )
        self.assertEqual(picked.values().shape, ())
        self.assertEqual(picked.item(), raw[1, 2, 3, 4])

        # a slab: time=0, all depth/lat/lon
        slab = self.sci.variable("temperature").isel(time=0)
        self.assertEqual(slab.dimensions, ("depth", "lat", "lon"))
        np.testing.assert_array_equal(slab.values(), raw[0])

    def test_06_multidimensional_time_depth_lat_lon(self) -> None:
        raw = self.ds["temperature"].values
        sub = self.sci.isel(
            time=slice(0, 2), depth=slice(1, 3), lat=2, lon=slice(None)
        )
        self.assertIsInstance(sub, ScientificDataset)
        self.assertEqual(sub.dimensions(), {"time": 2, "depth": 2, "lon": 5})
        np.testing.assert_array_equal(
            sub.variable("temperature").values(),
            raw[0:2, 1:3, 2, :],
        )
        # coordinates come along for the ride, unchanged
        np.testing.assert_array_equal(
            sub.coordinate("depth").values(), [100.0, 2000.0]
        )
        # label-based slicing agrees with the positional result
        sub_sel = self.sci.sel(depth=[100.0, 2000.0]).isel(
            time=slice(0, 2), lat=2
        )
        np.testing.assert_array_equal(
            sub_sel.variable("temperature").values(),
            sub.variable("temperature").values(),
        )

    def test_07_nan_missing_values_unchanged(self) -> None:
        raw = self.ds["temperature"].values
        vals = self.sci.variable("temperature").values()

        # exact same NaN mask, exact same finite values (bit-for-bit)
        np.testing.assert_array_equal(np.isnan(vals), np.isnan(raw))
        np.testing.assert_array_equal(vals, raw)   # NaN==NaN treated as equal here

        # the known holes are still NaN after slicing
        hole = self.sci.variable("temperature").isel(time=0, depth=2, lat=0, lon=0)
        self.assertTrue(math.isnan(hole.item()))

        # nothing was filled / masked: count of NaNs is preserved
        self.assertEqual(int(np.isnan(vals).sum()), 3)

    def test_08_original_dataset_not_mutated(self) -> None:
        before = self.ds.copy(deep=True)

        # exercise every accessor + slicing path
        self.sci.dimensions()
        self.sci.coordinate_names()
        self.sci.variable_names()
        self.sci.attributes
        _ = self.sci.variable("temperature").attributes
        _ = self.sci.variable("temperature").isel(time=0).values()
        _ = self.sci.isel(time=0, depth=0).sel(lat=0.0).variable("salinity").values()
        _ = self.sci.coordinate("depth").values()

        # identity: still the very same object we wrapped
        self.assertIs(self.sci.dataset, self.ds)
        # structural + value equality against the pre-run deep copy
        self.assertEqual(list(self.ds.sizes.items()), list(before.sizes.items()))
        self.assertEqual(self.ds["temperature"].attrs, before["temperature"].attrs)
        self.assertEqual(self.ds.attrs, before.attrs)
        for name in ("temperature", "salinity"):
            np.testing.assert_array_equal(
                self.ds[name].values, before[name].values
            )
        for coord in ("time", "depth", "lat", "lon"):
            np.testing.assert_array_equal(
                self.ds[coord].values, before[coord].values
            )


class ScientificLayerGuards(unittest.TestCase):
    def test_09_type_guards(self) -> None:
        with self.assertRaises(TypeError):
            ScientificDataset({"not": "a dataset"})   # type: ignore[arg-type]
        with self.assertRaises(TypeError):
            ScientificVariable([1, 2, 3])             # type: ignore[arg-type]

    def test_10_generic_over_a_currents_style_cube(self) -> None:
        # single depth level, U/V/CURRENT kept separate -- the layer must not
        # care what the variables mean.
        t = np.array(["2026-09-04"], dtype="datetime64[ns]")
        z = np.array([0.0])
        lat = np.array([8.0, 8.5])
        lon = np.array([76.0, 76.5, 77.0])
        block = np.full((1, 1, 2, 3), 0.25)
        block[0, 0, 0, 0] = np.nan
        ds = xr.Dataset(
            {
                "U": (("t", "z", "lat", "lon"), block.copy(), {"units": "m s-1"}),
                "V": (("t", "z", "lat", "lon"), block.copy() * -1, {"units": "m s-1"}),
                "CURRENT": (("t", "z", "lat", "lon"), block.copy(), {"units": "m s-1"}),
            },
            coords={"t": t, "z": z, "lat": lat, "lon": lon},
        )
        sci = ScientificDataset.from_dataset(ds)
        self.assertEqual(set(sci.variable_names()), {"U", "V", "CURRENT"})
        self.assertEqual(sci.variable("CURRENT").units, "m s-1")
        surface = sci.isel(t=0, z=0)
        self.assertEqual(surface.dimensions(), {"lat": 2, "lon": 3})
        self.assertTrue(math.isnan(surface.variable("U").values()[0, 0]))


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
