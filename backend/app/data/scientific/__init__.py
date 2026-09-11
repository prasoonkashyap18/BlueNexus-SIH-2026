"""Step 37 -- xarray-backed **scientific data layer**.

A small, generic, read-only abstraction over :class:`xarray.Dataset` /
:class:`xarray.DataArray`. It exists so that future NetCDF ingestion work
(temperature, salinity, currents, and a future chlorophyll parameter) has one
consistent, lossless way to discover structure and pull scientific values out
of an xarray dataset.

What this layer does:

* discovers dimensions, coordinates, variables and their metadata/attributes,
* exposes ``units`` (and any other attribute) exactly as stored,
* offers indexed (positional) and label-based slicing on the time / depth /
  spatial axes,
* hands back the raw scientific array values with NaN / missing entries intact.

What this layer deliberately does **not** do: it never interpolates, smooths,
normalizes, regrids, unit-converts, fills or otherwise mutates values, and it
never mutates the wrapped :class:`xarray.Dataset`. Slicing returns new wrapper
objects around xarray's own (lazy) views; the original dataset is untouched.

This module does not replace the existing pure-stdlib D7 ingestion layer
(:mod:`app.data.ingestion`) or the BlueNexus ``.bnx`` pipeline -- it is a
sibling building block for later steps.

Quick start::

    import numpy as np, xarray as xr
    from app.data.scientific import ScientificDataset

    ds = xr.Dataset(
        {"temperature": (("time", "depth", "lat", "lon"), values)},
        coords={"time": times, "depth": [0.0, 10.0], "lat": lats, "lon": lons},
    )
    sci = ScientificDataset(ds)
    sci.dimensions()                 # {"time": 3, "depth": 2, "lat": 4, "lon": 5}
    sci.coordinate_names()           # ("time", "depth", "lat", "lon")
    sci.variable_names()             # ("temperature",)
    temp = sci.variable("temperature")
    temp.units                       # e.g. "degC" (or None)
    surface = temp.isel(depth=0)     # lazy view, values unchanged
    surface.values()                 # numpy array, NaNs preserved

Step 38 adds :mod:`app.data.scientific.netcdf`: open a NetCDF file with xarray
and get the same :class:`ScientificDataset` wrapper back::

    from app.data.scientific import open_scientific_netcdf

    with open_scientific_netcdf("cube.nc") as sci:
        sci.dimensions()
        sci.variable("T_ANALYZED").isel(time=0).values()   # NaNs preserved
    # NetCDF file handle closed on exit
"""

from __future__ import annotations

from .dataset import ScientificDataset, ScientificVariable
from .netcdf import DEFAULT_ENGINE, open_netcdf, open_scientific_netcdf

__all__ = [
    "ScientificDataset",
    "ScientificVariable",
    "DEFAULT_ENGINE",
    "open_netcdf",
    "open_scientific_netcdf",
]
