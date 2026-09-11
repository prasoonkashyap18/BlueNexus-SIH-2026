"""Step 38 -- NetCDF ingestion for the scientific data layer.

    NetCDF file  ->  xarray.open_dataset(...)  ->  ScientificDataset

A tiny, reusable helper that opens a NetCDF file with xarray and hands back the
Step 37 :class:`~app.data.scientific.ScientificDataset` wrapper. Nothing here
touches the scientific values: dimensions, coordinates, variables, per-variable
attributes / units, global attributes and NaN / missing entries all survive the
round trip unchanged.

Design notes
------------
* **Engine:** ``netcdf4`` (the standard xarray NetCDF backend). It reads both
  the classic NetCDF-3 files the project currently has and NetCDF-4 / HDF5
  files a future acquisition might bring.
* **Lossless by default:** ``mask_and_scale=False`` -- xarray does *not* apply
  ``scale_factor`` / ``add_offset`` and does *not* rewrite ``_FillValue``
  sentinels, so ``ScientificVariable.values()`` is bit-for-bit the on-disk
  data. Genuine IEEE NaNs (e.g. the IO-HOOFS land mask) pass straight through.
  ``_FillValue`` / ``missing_value`` stay visible as variable attributes.
  A caller that explicitly wants CF mask-and-scale decoding can pass
  ``mask_and_scale=True``.
* **Times** are decoded to ``datetime64`` by default (``decode_times=True``) --
  this only makes the time *coordinate* human-readable; it does not alter any
  scientific field.
* **Resource ownership is explicit.** :func:`open_netcdf` returns a dataset the
  caller owns and must close (``sci.dataset.close()``). Prefer
  :func:`open_scientific_netcdf`, a context manager that always closes the
  underlying file handle on exit. Pass ``load=True`` to read everything into
  memory up front and release the file handle immediately.

This module does **not** touch the FastAPI routes, the ``BlueNexusCatalog``,
the ``.bnx`` pipeline, or the pure-stdlib D7 ingestion layer. It only produces
``NetCDF -> xarray -> ScientificDataset``.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import xarray as xr

from .dataset import ScientificDataset

__all__ = ["DEFAULT_ENGINE", "open_netcdf", "open_scientific_netcdf"]

#: The xarray backend used to read NetCDF files. ``netcdf4`` handles both
#: NetCDF-3 (classic, what the project has today) and NetCDF-4 / HDF5.
DEFAULT_ENGINE = "netcdf4"


def _resolve_path(path: str | Path) -> Path:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"NetCDF file not found: {p}")
    if not p.is_file():
        raise IsADirectoryError(f"Not a file: {p}")
    return p


def open_netcdf(
    path: str | Path,
    *,
    engine: str = DEFAULT_ENGINE,
    mask_and_scale: bool = False,
    decode_times: bool = True,
    load: bool = False,
    **open_kwargs: Any,
) -> ScientificDataset:
    """Open ``path`` with xarray and wrap it in a :class:`ScientificDataset`.

    Parameters
    ----------
    path:
        Filesystem path to a NetCDF file (NetCDF-3 or NetCDF-4).
    engine:
        xarray backend, ``"netcdf4"`` by default.
    mask_and_scale:
        ``False`` (default) keeps values exactly as stored -- no
        ``scale_factor`` / ``add_offset``, ``_FillValue`` sentinels preserved
        and left visible as attributes. Set ``True`` for CF mask-and-scale
        decoding.
    decode_times:
        Decode the time coordinate to ``datetime64`` (default ``True``). Does
        not affect scientific fields.
    load:
        If ``True``, eagerly read all arrays into memory and close the file
        handle before returning, so the returned wrapper no longer references
        the file. If ``False`` (default) the dataset stays lazy and the caller
        owns the open handle -- close it via ``result.dataset.close()`` or use
        :func:`open_scientific_netcdf`.
    **open_kwargs:
        Forwarded verbatim to :func:`xarray.open_dataset`.

    Returns
    -------
    ScientificDataset
        The Step 37 wrapper around the opened :class:`xarray.Dataset`.
    """
    resolved = _resolve_path(path)

    if load:
        # Read everything, then let the handle close -- the data stays usable.
        with xr.open_dataset(
            resolved,
            engine=engine,
            mask_and_scale=mask_and_scale,
            decode_times=decode_times,
            **open_kwargs,
        ) as ds:
            ds.load()
        return ScientificDataset(ds)

    ds = xr.open_dataset(
        resolved,
        engine=engine,
        mask_and_scale=mask_and_scale,
        decode_times=decode_times,
        **open_kwargs,
    )
    return ScientificDataset(ds)


@contextmanager
def open_scientific_netcdf(
    path: str | Path,
    *,
    engine: str = DEFAULT_ENGINE,
    mask_and_scale: bool = False,
    decode_times: bool = True,
    **open_kwargs: Any,
) -> Iterator[ScientificDataset]:
    """Context manager: open ``path`` as a :class:`ScientificDataset` and always
    close the underlying NetCDF file handle on exit.

    ::

        with open_scientific_netcdf("cube.nc") as sci:
            sci.dimensions()
            sci.variable("T_ANALYZED").isel(time=0).values()
        # file handle is now closed
    """
    sci = open_netcdf(
        path,
        engine=engine,
        mask_and_scale=mask_and_scale,
        decode_times=decode_times,
        load=False,
        **open_kwargs,
    )
    try:
        yield sci
    finally:
        sci.dataset.close()
