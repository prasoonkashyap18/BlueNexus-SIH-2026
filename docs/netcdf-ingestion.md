# Step 38 — NetCDF Ingestion

```
NetCDF file  ->  xarray.open_dataset(engine="netcdf4")  ->  ScientificDataset  (Step 37 wrapper)
```

A small, reusable helper that opens a NetCDF file with xarray and returns the
Step 37 `ScientificDataset` abstraction. It is **not** wired into FastAPI, the
`BlueNexusCatalog` or the `.bnx` pipeline — Step 38 is only `NetCDF → xarray →
ScientificDataset`.

## Location

`backend/app/data/scientific/netcdf.py`

| Export | What it does |
| --- | --- |
| `open_netcdf(path, *, engine="netcdf4", mask_and_scale=False, decode_times=True, load=False, **open_kwargs)` | Opens the file, returns a `ScientificDataset`. Caller owns the handle (`result.dataset.close()`), unless `load=True`. |
| `open_scientific_netcdf(path, ...)` | Context manager yielding a `ScientificDataset`; **always closes** the NetCDF file handle on exit. Preferred. |
| `DEFAULT_ENGINE` | `"netcdf4"` |

All three are re-exported from `app.data.scientific`.

## NetCDF engine / dependency

`netCDF4==1.7.4` added to `backend/requirements.txt` — the standard xarray
NetCDF backend. Chosen over `scipy` (a large, mostly-unrelated scientific
dependency) and `h5netcdf` (cannot read the project's classic NetCDF-3 files).

- Reads classic **NetCDF-3** (what `data/raw/*.nc` are today, magic `CDF\x01`)
  and **NetCDF-4 / HDF5** (future-proof).
- Wheel: `netcdf4-1.7.4-cp311-abi3` (abi3 → runs on Python 3.14).
- Transitive deps: `cftime==1.6.5` (CF time decoding), `certifi`.
- No Dask, Zarr, database or other libraries added.

Verified: `xr.backends.list_engines()` → `['netcdf4', 'store']`; both real sample
files open with the expected dims/vars.

## Losslessness

| Concern | How it is handled |
| --- | --- |
| `scale_factor` / `add_offset` | `mask_and_scale=False` → **not applied**. Values are bit-for-bit the on-disk data. |
| `_FillValue` / `missing_value` | Preserved verbatim in the data **and** left visible as variable attributes (not consumed into `.encoding`). |
| Genuine IEEE NaN (e.g. IO-HOOFS land mask) | Passes straight through. |
| Dimensions / coordinates / variables | Preserved exactly (order included). |
| Variable + global attributes, units | Preserved. Attribute accessors return shallow copies (Step 37). |
| Time coordinate | Decoded to `datetime64` (`decode_times=True`) — makes the coordinate readable, does not touch any scientific field. Pass `decode_times=False` to keep raw numeric time. |
| Interpolation / smoothing / regridding / normalization / unit conversion | None. Never. |

## Resource handling

- `open_scientific_netcdf(...)` (context manager) — closes the file handle on
  exit, even on exception. Use this by default.
- `open_netcdf(..., load=False)` (default) — lazy; caller must
  `result.dataset.close()`.
- `open_netcdf(..., load=True)` — reads every array into memory and releases the
  file handle before returning; the wrapper no longer references the file.

## Tests

`backend/tests/test_scientific_netcdf.py` — 15 tests (stdlib `unittest`).

Each test writes a **tiny** `time × depth × lat × lon` NetCDF file into a
`tempfile.TemporaryDirectory()` from an in-memory `xarray.Dataset` and deletes
it in `tearDown`. **No generated NetCDF is committed; no external data is
downloaded.**

Covered: file opens → `ScientificDataset`; missing-file raises; dimensions
preserved; coordinate names + values preserved; variable names preserved;
temperature-style 4-D data survives bit-for-bit; units + variable + global
attributes preserved; time/depth/lat/lon coordinates survive (time as
`datetime64`); NaN/missing survive (count + positions); indexed slicing through
the wrapper works after ingestion (dataset- and variable-level); source file can
be safely closed (context manager) and deleted; `load=True` releases the handle
immediately; scientific values unchanged (values + dtype); read access does not
mutate the returned dataset.

`RealNetCDFSmoke` — read-only metadata check against
`data/raw/temperature_salinity_incois_argo_sample.nc` (1 MB, already in the
repo): asserts dims `{time:3, ZAX:24, latitude:36, longitude:51}`, vars
`{T_ANALYZED, S_ANALYZED}`, a lazy indexed read works, and the file bytes are
byte-for-byte identical before/after (nothing written). Skipped if the file is
absent.

Full backend suite: **256 tests pass** (241 before + 15 new).

## Compatibility limitations

- xarray 2026.7.0's `netCDF4` backend emits a `DeprecationWarning` ("Setting the
  shape on a NumPy array has been deprecated in NumPy 2.5") during lazy array
  reads, under numpy 2.5.3. It is upstream (xarray ↔ numpy 2.5), cosmetic, and
  does not affect correctness — values are verified bit-exact. It will clear
  when xarray ships the numpy-2.5 fix.
- `netCDF4` cannot open remote OPeNDAP URLs unless built with DAP support; this
  helper is filesystem-path only by design.
