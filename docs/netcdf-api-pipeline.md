# Step 39 — NetCDF → API Pipeline

```
NetCDF file
  → app.data.scientific.open_netcdf            (Step 38 ingestion, mask_and_scale=False)
  → ScientificDataset / ScientificVariable      (Step 37 abstraction)
  → NetCDFDataService                           (app/services/netcdf_service.py)
  → FastAPI route  /api/netcdf/*                (app/api/routes/netcdf.py)
  → JSON response
```

**Additive.** Nothing about `BlueNexusCatalog`, the `.bnx` pipeline, the model
grid, or the Argo/glider paths changes. The `/api/netcdf` namespace exposes
**one** configured NetCDF file, read-only.

## New endpoints

| Method + path | Returns |
| --- | --- |
| `GET /api/netcdf/dataset` | `dataset_id`, `source` (file name only), `dimensions` (name→length), `coordinates[]` (name, role, values, units, attributes), `variables[]`, `variable_count`, `global_attributes`, `nan_encoding` |
| `GET /api/netcdf/variables/{variable_name}` | `name`, `dimensions`, `shape`, `dtype`, `units`, `attributes`, `axis_roles` (dim→time/depth/latitude/longitude), `nan_encoding` |
| `GET /api/netcdf/variables/{variable_name}/slice` | Indexed selection. Query: `time_index`, `depth_index`, `latitude_index`, `longitude_index` (all optional, 0-based, `ge=0`). Returns `selection[]` (role, dimension, index, coordinate `value`/`iso`), remaining `dimensions`/`shape`, `element_count`, remaining `coordinates`, `values`, `variable_metadata`, `nan_encoding` |

Pydantic models: `NetCDFDatasetResponse`, `NetCDFCoordinateAxis`,
`NetCDFVariableResponse`, `NetCDFSliceResponse`, `NetCDFSliceSelection` in
`app/api/schemas.py`. OpenAPI tag `netcdf`.

### Axis selection

Each `*_index` maps to whichever variable dimension resolves to that role.
Roles are resolved CF-first (`axis`, `standard_name`, `units`, `positive`,
datetime dtype) then by dimension-name pattern — so `ZAX`/`DEPTH1_1` → depth,
`TAXIS`/`time` → time, `LAT`/`latitude` → latitude, `LON`/`longitude` →
longitude. An omitted index leaves that axis at full extent. Indices are never
clamped.

## NetCDF configuration mechanism

Consistent with the existing `BLUENEXUS_*` env-var config (`app/api/config.py`,
`ApiConfig`). **No machine-specific absolute path is baked into code.**

| Env var | Meaning | Default |
| --- | --- | --- |
| `BLUENEXUS_NETCDF_PATH` | filesystem path to one NetCDF file to expose | *unset* → endpoints return `503 netcdf_not_configured` |
| `BLUENEXUS_NETCDF_DATASET_ID` | identity reported for that dataset | sluggified file stem, else `netcdf_dataset` |

Tests pass an explicit `ApiConfig(netcdf_path=..., netcdf_dataset_id=...)`.

The service is built once per app instance in the FastAPI **lifespan** and
stored on `app.state.netcdf_service` (not a shared module global — the test
suite runs several app instances in one process). The route reads it from
`request.app.state`.

## Data flow / resource management

- The configured file is opened **once at startup** via Step 38
  `open_netcdf(path, load=True)`: `mask_and_scale=False` (lossless), all arrays
  read into memory, **OS file handle released immediately**. No handle is held
  for the process lifetime; no file is reopened per request.
- `NetCDFDataService.close()` (lifespan shutdown) closes the in-memory dataset
  defensively.
- Selections are capped at `MAX_SLICE_ELEMENTS = 300_000` values per response
  (consistent with the bounded `.bnx` slice endpoint — one lat×lon plane).
  Larger → `422 slice_too_large` with a hint to add indices.
- No Dask, no Zarr, no database.

## JSON NaN / null handling (the only boundary conversion)

Scientific values are **never transformed** — no scaling, `add_offset`,
interpolation, smoothing, regridding, normalization, unit conversion or
rounding. `float64` passes through exactly; `float32` widens to its exact
double.

JSON cannot represent `NaN` / `Infinity`. **At the serialization boundary only**,
non-finite floats become JSON `null`. The in-memory xarray/NetCDF data is not
modified — a fresh `open_scientific_netcdf` of the same file still shows the
original `NaN`s and identical finite values (verified by
`test_netcdf_api.NetCDFSliceEndpoint.test_02` and `RealNetCDFApiSmoke`).

Every payload carries a `nan_encoding` string stating this. `missing_value` on
the slice response is always `null`.

Implemented in `app/services/netcdf_service.py`: `_values_to_json` (vectorized
`astype(object)` + `~np.isfinite` mask → `None`) for value arrays;
`_json_safe` (recursive) for metadata/attributes/coordinates, which also
converts numpy scalars → builtins, `datetime64` → ISO-8601 UTC strings, and
bytes → text.

## Error handling

Shared `{"error": {"type", "message", "detail"}}` envelope
(`app/api/errors.py`). No tracebacks, no filesystem paths (verified).

| Situation | Status | `type` |
| --- | --- | --- |
| `BLUENEXUS_NETCDF_PATH` unset | 503 | `netcdf_not_configured` |
| configured file missing / unreadable | 503 | `netcdf_unavailable` |
| unknown variable name | 404 | `unknown_variable` |
| index out of range, or for an axis the variable lacks | 422 | `invalid_index` |
| selection exceeds the element cap | 422 | `slice_too_large` |
| malformed query/path param (negative, non-integer, bad name) | 422 | `malformed_request` |

## Tests

`backend/tests/test_netcdf_api.py` — 22 tests, real HTTP against uvicorn
(`tests/_httpserver.py`), tiny temp NetCDF built from an in-memory xarray
Dataset and deleted after the module. Covers: dataset endpoint (identity,
dimensions, coordinate roles/values, global attrs, strict-JSON), variable
metadata endpoint (dims/shape/dtype/units/attributes/axis_roles, unknown → 404,
bad name → 422), slice endpoint (2-D slice matches source bit-for-bit,
NaN→null + underlying data unchanged, multidimensional → 1-D, full variable,
scalar, invalid index → 422, index for missing axis → 422, negative/non-integer
→ 422, strict JSON, no traceback/path leakage), resource handling (many
requests then file still openable), not-configured → 503, missing file → 503,
existing-API regression (health/datasets/detail/temperature/salinity/current_u/
current_v/current_speed/argo/gliders all 200), and `RealNetCDFApiSmoke` (points
the API at `data/raw/temperature_salinity_incois_argo_sample.nc`, compares a
36×51 plane with the xarray source, confirms only NaN→null, file bytes
unchanged).

Full backend suite: **278 tests pass** (256 before Step 39 + 22 new).

## Limitations

- Same cosmetic upstream warnings as Step 38: a numpy-2.5 `DeprecationWarning`
  from xarray's netCDF4 backend on lazy reads, and a `RuntimeWarning:
  numpy.ndarray size changed` from `cftime` (built against an older numpy).
  Both are harmless — values are verified bit-exact and time strings are
  correct.
- One NetCDF file per API instance (matches the "one configured dataset" scope).
- The whole file is read into memory at startup — fine for the project's
  sample-sized files; a very large NetCDF would need a lazy/chunked strategy
  (out of scope, and would pull in Dask).
- No NetCDF data is wired into the `.bnx` datasets, the model grid, or any
  model-vs-observation comparison — that is later work.
