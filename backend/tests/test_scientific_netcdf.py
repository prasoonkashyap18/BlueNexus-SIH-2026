"""Step 38 -- NetCDF ingestion tests (stdlib ``unittest``).

Run from ``backend/``::

    ./.venv/Scripts/python.exe -m unittest tests.test_scientific_netcdf -v

Every test builds a **tiny** NetCDF file in a temporary directory from an
in-memory :class:`xarray.Dataset`, exercises
:func:`app.data.scientific.open_netcdf` /
:func:`app.data.scientific.open_scientific_netcdf`, and deletes the temp file in
``tearDown``. Nothing is written under the repository and no external data is
downloaded.

One lightweight, read-only smoke test opens the small real NetCDF-3 file that
already ships in ``data/raw/`` (if present) and only checks metadata -- it never
writes, converts or modifies it.
"""

from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import xarray as xr

# make ``app`` importable when run from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.scientific import (  # noqa: E402
    ScientificDataset,
    ScientificVariable,
    open_netcdf,
    open_scientific_netcdf,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_REAL_NC = _REPO_ROOT / "data" / "raw" / "temperature_salinity_incois_argo_sample.nc"


def _temperature_cube() -> xr.Dataset:
    """A small time x depth x lat x lon temperature+salinity cube with NaN holes."""
    time = np.array(
        ["2026-01-01", "2026-01-11", "2026-01-21"], dtype="datetime64[ns]"
    )
    depth = np.array([5.0, 100.0, 500.0, 2000.0])       # irregular, like the real file
    lat = np.array([0.0, 2.5, 5.0, 7.5, 10.0])
    lon = np.array([60.0, 62.5, 65.0, 67.5])

    shape = (time.size, depth.size, lat.size, lon.size)
    temp = np.arange(np.prod(shape), dtype="float64").reshape(shape)
    temp[0, 3, 0, 0] = np.nan       # deep / land hole
    temp[1, 0, 4, 3] = np.nan
    temp[2, 2, 2, 1] = np.nan
    salt = temp / 10.0 + 34.0

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
        },
        coords={
            "time": ("time", time, {"standard_name": "time"}),
            "depth": ("depth", depth, {"units": "m", "positive": "down"}),
            "lat": ("lat", lat, {"units": "degrees_north"}),
            "lon": ("lon", lon, {"units": "degrees_east"}),
        },
        attrs={"title": "tiny synthetic ingestion cube", "Conventions": "CF-1.8",
               "source": "test"},
    )


class NetCDFIngestion(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.path = Path(self._tmpdir.name) / "cube.nc"
        self.source = _temperature_cube()
        # keep a pristine reference of the raw values for "not changed" checks
        self.raw_temp = self.source["T_ANALYZED"].values.copy()
        self.raw_salt = self.source["S_ANALYZED"].values.copy()
        self.source.to_netcdf(self.path, engine="netcdf4")

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    # -- open + type --------------------------------------------------
    def test_01_file_opens_and_returns_scientific_dataset(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            self.assertIsInstance(sci, ScientificDataset)
            self.assertIsInstance(sci.dataset, xr.Dataset)

    def test_02_missing_file_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            open_netcdf(self.path.with_name("nope.nc"))

    # -- structure preserved ---------------------------------------
    def test_03_dimensions_preserved(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            self.assertEqual(
                sci.dimensions(),
                {"time": 3, "depth": 4, "lat": 5, "lon": 4},
            )
            self.assertEqual(
                sci.dimension_names(), ("time", "depth", "lat", "lon")
            )

    def test_04_coordinate_names_and_values_preserved(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            self.assertEqual(
                set(sci.coordinate_names()), {"time", "depth", "lat", "lon"}
            )
            np.testing.assert_array_equal(
                sci.coordinate("depth").values(), [5.0, 100.0, 500.0, 2000.0]
            )
            np.testing.assert_array_equal(
                sci.coordinate("lat").values(), [0.0, 2.5, 5.0, 7.5, 10.0]
            )
            np.testing.assert_array_equal(
                sci.coordinate("lon").values(), [60.0, 62.5, 65.0, 67.5]
            )

    def test_05_variable_names_preserved(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            self.assertEqual(
                set(sci.variable_names()), {"T_ANALYZED", "S_ANALYZED"}
            )

    def test_06_temperature_multidimensional_data_survives(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            temp = sci.variable("T_ANALYZED")
            self.assertEqual(temp.dimensions, ("time", "depth", "lat", "lon"))
            self.assertEqual(temp.shape, (3, 4, 5, 4))
            np.testing.assert_array_equal(temp.values(), self.raw_temp)

    def test_07_units_and_attributes_preserved(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            temp = sci.variable("T_ANALYZED")
            self.assertEqual(temp.units, "degC")
            self.assertEqual(temp.attributes["long_name"], "analyzed temperature")
            self.assertEqual(
                temp.attributes["standard_name"], "sea_water_temperature"
            )
            self.assertEqual(sci.units("S_ANALYZED"), "PSU")
            self.assertEqual(sci.units("depth"), "m")
            # global attributes
            self.assertEqual(sci.attributes["title"], "tiny synthetic ingestion cube")
            self.assertEqual(sci.attribute("Conventions"), "CF-1.8")

    def test_08_time_depth_lat_lon_coordinates_survive(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            self.assertEqual(
                set(sci.dimension_coordinate_names()),
                {"time", "depth", "lat", "lon"},
            )
            times = sci.coordinate("time").values()
            self.assertEqual(times.dtype.kind, "M")            # datetime64
            self.assertEqual(
                list(np.datetime_as_string(times, unit="D")),
                ["2026-01-01", "2026-01-11", "2026-01-21"],
            )
            self.assertEqual(sci.coordinate("depth").values()[-1], 2000.0)

    def test_09_nan_missing_values_survive(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            vals = sci.variable("T_ANALYZED").values()
            np.testing.assert_array_equal(
                np.isnan(vals), np.isnan(self.raw_temp)
            )
            self.assertEqual(int(np.isnan(vals).sum()), 3)
            hole = sci.variable("T_ANALYZED").isel(
                time=0, depth=3, lat=0, lon=0
            )
            self.assertTrue(math.isnan(hole.item()))

    def test_10_indexed_slicing_after_ingestion(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            # dataset-level positional slicing
            sub = sci.isel(time=1, depth=slice(0, 2))
            self.assertIsInstance(sub, ScientificDataset)
            self.assertEqual(sub.dimensions(), {"depth": 2, "lat": 5, "lon": 4})
            np.testing.assert_array_equal(
                sub.variable("T_ANALYZED").values(), self.raw_temp[1, 0:2]
            )
            # variable-level positional slicing
            col = sci.variable("S_ANALYZED").isel(time=2, lat=2, lon=1)
            np.testing.assert_array_equal(col.values(), self.raw_salt[2, :, 2, 1])
            self.assertEqual(col.dimensions, ("depth",))

    def test_11_source_file_can_be_safely_closed(self) -> None:
        # context manager closes the handle -> the file can then be deleted
        with open_scientific_netcdf(self.path) as sci:
            _ = sci.variable("T_ANALYZED").isel(time=0).values()
        self.path.unlink()                       # would raise if handle still open
        self.assertFalse(self.path.exists())

    def test_11b_eager_load_releases_handle_immediately(self) -> None:
        sci = open_netcdf(self.path, load=True)
        self.path.unlink()                       # handle already released by load=True
        # data is still fully usable after the file is gone
        np.testing.assert_array_equal(
            sci.variable("T_ANALYZED").values(), self.raw_temp
        )

    def test_12_scientific_values_not_changed_by_ingestion(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            np.testing.assert_array_equal(
                sci.variable("T_ANALYZED").values(), self.raw_temp
            )
            np.testing.assert_array_equal(
                sci.variable("S_ANALYZED").values(), self.raw_salt
            )
            # dtype unchanged, no scale/offset applied
            self.assertEqual(str(sci.variable("T_ANALYZED").dtype), "float64")

    def test_13_ingestion_does_not_mutate_returned_dataset_on_read(self) -> None:
        with open_scientific_netcdf(self.path) as sci:
            before = sci.dataset.copy(deep=True)
            _ = sci.isel(time=0).variable("T_ANALYZED").values()
            _ = sci.variable("S_ANALYZED").attributes
            for name in ("T_ANALYZED", "S_ANALYZED"):
                np.testing.assert_array_equal(
                    sci.dataset[name].values, before[name].values
                )
            self.assertEqual(sci.dataset.attrs, before.attrs)


@unittest.skipUnless(_REAL_NC.is_file(), f"real sample not present: {_REAL_NC}")
class RealNetCDFSmoke(unittest.TestCase):
    """Read-only metadata smoke test against the small real NetCDF-3 sample.

    Never writes, converts or modifies the file.
    """

    def test_01_real_file_metadata(self) -> None:
        sha_before = _REAL_NC.read_bytes()
        with open_scientific_netcdf(_REAL_NC) as sci:
            self.assertIsInstance(sci, ScientificDataset)
            dims = sci.dimensions()
            self.assertEqual(
                dims, {"time": 3, "ZAX": 24, "latitude": 36, "longitude": 51}
            )
            self.assertEqual(
                set(sci.variable_names()), {"T_ANALYZED", "S_ANALYZED"}
            )
            self.assertIn("time", sci.coordinate_names())
            temp = sci.variable("T_ANALYZED")
            self.assertEqual(temp.dimensions, ("time", "ZAX", "latitude", "longitude"))
            # a lazy indexed read works and stays lossless
            surface = temp.isel(time=0, ZAX=0)
            self.assertEqual(surface.shape, (36, 51))
        # file bytes are byte-for-byte identical -- nothing was written
        self.assertEqual(_REAL_NC.read_bytes(), sha_before)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
