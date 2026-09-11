# Step 37 — xarray Scientific Data Layer

A small, generic, **read-only** abstraction over `xarray.Dataset` /
`xarray.DataArray`, added as a building block for future NetCDF ingestion work
(temperature, salinity, currents, and a future chlorophyll parameter).

It does **not** replace anything: the pure-stdlib D7 ingestion layer
(`app.data.ingestion`), the BlueNexus `.bnx` pipeline, the FastAPI routes and
the Argo / glider observation paths are all untouched. No real NetCDF file is
opened by this layer yet — that is Step 38+.

## Location

`backend/app/data/scientific/`

| File | Purpose |
| --- | --- |
| `__init__.py` | package docstring + exports (`ScientificDataset`, `ScientificVariable`) |
| `dataset.py` | the two wrapper classes |

Tests: `backend/tests/test_scientific.py` (stdlib `unittest`, tiny in-memory
dataset, no file I/O).

## Dependency

`xarray==2026.7.0` added to `backend/requirements.txt`. Transitively pulls
`numpy` (2.5.3) and `pandas` (3.0.5). cp314 wheels are available, so it installs
cleanly into the Python 3.14 backend venv. No Dask, netCDF4 or h5netcdf added.

## API

### `ScientificDataset(xr.Dataset)` / `.from_dataset(ds)`

Holds a *reference* to the dataset — never copied, never `.load()`ed.

| Method | Returns |
| --- | --- |
| `dataset` | the wrapped `xr.Dataset` (identity-preserved) |
| `dimensions()` | `{dim: length}` for every dimension |
| `dimension_names()` | dimension names in dataset order |
| `coordinate_names()` | every coordinate (dimension + auxiliary) |
| `dimension_coordinate_names()` | coordinates that are also a dimension (the axes) |
| `coordinate(name)` | one axis as a `ScientificVariable` |
| `variable_names()` / `has_variable(name)` | data variables (coords excluded) |
| `variable(name)` | one data variable as a `ScientificVariable` |
| `attributes` / `attribute(k, default)` | global attrs (shallow copy) |
| `variable_attributes(name)` / `units(name)` | per-variable attrs / `units` string |
| `isel(indexers, **kw)` | positional/indexed slice → new `ScientificDataset` |
| `sel(indexers, **kw)` | label-based slice → new `ScientificDataset` |

### `ScientificVariable(xr.DataArray)`

| Member | Meaning |
| --- | --- |
| `data_array`, `name` | wrapped array / its name |
| `dimensions`, `sizes`, `shape`, `ndim`, `dtype` | structure |
| `attributes`, `units`, `attribute(k, default)`, `coordinate_names` | metadata (shallow copy) |
| `isel(...)`, `sel(...)` | slice → new `ScientificVariable` |
| `values()` / `to_numpy()` | scientific values as a NumPy array, **NaN/missing preserved bit-for-bit** |
| `item()` | scalar of a 0-d selection |

## Lossless guarantees

- No interpolation, smoothing, normalization, regridding or unit conversion.
- `values()` returns exactly what xarray holds; NaN mask and finite values are
  bit-for-bit identical to the source (`test_07`).
- Slicing delegates to xarray's own `isel` / `sel` (lazy views); the wrapped
  dataset is identity-preserved and value-equal before/after every accessor
  (`test_08`).
- Attribute accessors hand back shallow copies, so callers can't mutate the
  dataset's metadata through the wrapper (`test_04b`).

## Tests (11, all passing)

1. dimensions discovered · 2. coordinates discovered · 3. variables discovered ·
4. units/attributes preserved (+4b copy isolation) · 5. indexed slicing values ·
6. multidimensional time/depth/lat/lon slicing (positional == label) ·
7. NaN/missing unchanged · 8. original dataset not mutated · 9. type guards ·
10. generic over a currents-style U/V/CURRENT cube.

Full backend suite: **241 tests pass** (230 existing + 11 new).
