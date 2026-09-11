# Step 42 — GLORYS12V1 Model Temperature Integration

Wires a **validated real ocean-model temperature** dataset — MERCATOR
**GLORYS12V1** potential temperature (`thetao`), from **Copernicus Marine** —
into the existing BlueNexus scientific/NetCDF architecture, CF-decoded to real
`degrees_C`, and exposes it through the Step 39 `/api/netcdf` API and the
frontend model-data client boundary.

**Integration only.** No model-vs-observation comparison, no difference maps, no
interpolation/regridding of the source, no 3-D rendering (Steps 43–46).

> **Data-coverage expansion (2026-09-08).** The default model file is now the
> larger **Arabian Sea subset** `temperature_cmems_glorys12v1_arabiansea.nc`
> (61.5–70 °E, 8–20.5 °N, 2025-03-24→2025-04-02, 0.494–541.089 m; 32 native
> levels; 10 daily steps; 4 976 960 cells; 9.52 MiB; SHA-256
> `08aee664…70ecd1ea`), chosen to overlap **4 real INCOIS Argo profiles**. The
> original tiny validation sample is preserved unchanged and remains the
> fallback. Dataset id, decoding, provenance and the API surface are identical —
> only the extent grew. See *Data-coverage expansion* below.

## Why GLORYS replaces the Step 41 placeholder

Step 41 pointed `/api/netcdf` at `currents_incois_io-hoofs_sample.nc` (INCOIS
IO-HOOFS) — a genuine model, but the acquired subset is **surface currents
only, no temperature**, which is exactly why Step 42 was blocked. The user
downloaded and Step 42 validated a real GLORYS12V1 `thetao` file; it becomes the
configured model dataset. The IO-HOOFS file is **not** deleted or altered — it
stays in `data/raw/` and is still served if `BLUENEXUS_NETCDF_PATH` points at it.

## The dataset

| Field | Value |
| --- | --- |
| Model / source | **MERCATOR GLORYS12V1** — Global Ocean Physics **Reanalysis**, distributed by **Copernicus Marine** (CMEMS). Product `GLOBAL_MULTIYEAR_PHY_001_030`, dataset **`cmems_mod_glo_phy_my_0.083deg_P1D-m`** (v `202311`), **DOI `10.48670/moi-00021`**. Identity string: **`GLORYS12V1 / Copernicus Marine`** (never "INCOIS" / "INCOIS-GODAS"). |
| Default file | `data/raw/temperature_cmems_glorys12v1_arabiansea.nc` (Step 42 expansion) |
| Fallback file | `data/raw/temperature_cmems_glorys12v1_sample.nc` (tiny validation sample, preserved) |
| Variable | **`thetao`** — `standard_name = sea_water_potential_temperature`, `units = degrees_C` |
| Native storage | packed **`int16`**, `scale_factor ≈ 7.324442e-04`, `add_offset = 21.0`, `_FillValue = -32767` (both files) |
| | **Arabian Sea subset** | **Tiny sample** |
| Bytes / format | 9,978,696 · NetCDF-4/HDF5 · CF-1.4 | 35,292 · NetCDF-3 · CF-1.4 |
| SHA-256 | `08aee6649b2dbfa34a1a553310ae02902c27c5bbcfcb4afba8fa5e1370ecd1ea` | `ab79f4394c5e6fd35bd205185831fb5ed45e8730f8d6589573e1cd9cffede994` |
| Dimensions | `time 10 × depth 32 × lat 151 × lon 103` = 4,976,960 | `time 1 × depth 31 × lat 13 × lon 13` = 5,239 |
| Time | **2025-03-24 → 2025-04-02**, 10 daily means (decoded `time` coord; stale 2021 `bulletin_date` ignored) | 2025-03-31, 1 step |
| Depth | **0.494 → 541.089 m**, native GLORYS **top 32 levels**, `positive = down` | 0.494 → 453.938 m, top 31 levels |
| Spatial | **8.0–20.5 °N, 61.5–70.0 °E** — Arabian Sea, native 1/12° grid | 19.0–20.0 °N, 64.0–65.0 °E |
| Missing cells | 11,670 (0.23 %) — coastal land / seafloor mask | 0 (all open ocean) |
| Decoded range | **10.070 °C … 30.700 °C** | 12.872 °C … 27.870 °C |

Both files are the **same product** — identical packing, native grid and depth
levels; in their overlapping region the `thetao` values are **bit-identical**.

Native values and coordinates are preserved exactly — nothing is regridded,
smoothed, interpolated, normalized or unit-converted. The **raw file on disk is
never modified**; CF decoding happens in memory only.

## CF decoding (the one scientific requirement)

Step 38's reader defaults to `mask_and_scale=False` (lossless) — which for a
packed variable yields raw `int16`. Exposing those as `degrees_C` would be
wrong. So Step 42 adds an **opt-in CF-decode flag** that the GLORYS default file
turns on:

```
data/raw/temperature_cmems_glorys12v1_sample.nc
  → app.data.scientific.open_netcdf(path, load=True, mask_and_scale=True)   (Step 38, unchanged API)
  → ScientificDataset / ScientificVariable                                  (Step 37, unchanged)
  → NetCDFDataService(cf_decode=True, source_label="GLORYS12V1 / Copernicus Marine")   (Step 39 service, extended)
  → GET /api/netcdf/*                                                       (Step 39 route, unchanged)
```

`scale_factor` / `add_offset` are applied and the integer `_FillValue` becomes
`NaN` → JSON `null`. Every payload carries a **`decoding`** block stating what
was applied (`cf_mask_and_scale`, `raw_dtype: "int16"`, `decoded_dtype:
"float64"`, `applied`, `packing`). `dtype` in the variable/slice response is the
**decoded** `float64`, and `units` is `degrees_C`. With `cf_decode=False`
(a custom file), behaviour is unchanged and `decoding.note` explicitly warns if
the served values are packed integers.

## Config

`app/api/config.py`:

| Constant / field | Value |
| --- | --- |
| `MODEL_NETCDF_FILENAME` | `temperature_cmems_glorys12v1_sample.nc` |
| `MODEL_NETCDF_DATASET_ID` | `glorys12v1_model` |
| `MODEL_NETCDF_CF_DECODE` | `True` |
| `MODEL_SOURCE_LABEL` | `GLORYS12V1 / Copernicus Marine` |
| `ApiConfig.netcdf_cf_decode` | new `bool` field (default `False`) |
| `ApiConfig.netcdf_source_label` | new `Optional[str]` field (default `None`) |

Env overrides: `BLUENEXUS_NETCDF_PATH` (custom file → no label, decode off unless
`BLUENEXUS_NETCDF_CF_DECODE=1`), `BLUENEXUS_NETCDF_DATASET_ID`,
`BLUENEXUS_NETCDF_CF_DECODE`. No machine-specific path is baked in — the default
resolves from the repo root; if the file is absent the endpoints still return
`503 netcdf_not_configured`.

## API (Step 39 endpoints — no new routes)

| Endpoint | Notes for Step 42+ |
| --- | --- |
| `GET /api/netcdf/dataset` | `dataset_id = "glorys12v1_model"`; `source.label = "GLORYS12V1 / Copernicus Marine"`; `dimensions`; coordinate axes (`time`/`depth`/`latitude`/`longitude` with roles, values, units); `variables = ["thetao"]`; verbatim `global_attributes`; **`coverage`** block; **`decoding`** summary |
| `GET /api/netcdf/variables/thetao` | decoded metadata — `dtype: "float64"`, `units: "degrees_C"`, `axis_roles`, and the `decoding` block with the source packing |
| `GET /api/netcdf/variables/thetao/slice?time_index=&depth_index=&latitude_index=&longitude_index=` | indexed selection of the native `time × depth × latitude × longitude` grid; **decoded `degrees_C`**; missing cells JSON `null`; `decoding` block |

### `coverage` — graceful reporting of the limited extent

`GET /api/netcdf/dataset` returns a `coverage` object derived only from the real
coordinate vectors:

```json
"coverage": {
  "time":      { "start": "2025-03-31T00:00:00Z", "end": "2025-03-31T00:00:00Z", "count": 1 },
  "depth":     { "min": 0.494, "max": 453.938, "count": 31, "units": "m", "positive": "down" },
  "latitude":  { "min": 19.0, "max": 20.0, "count": 13, "units": "degrees_north" },
  "longitude": { "min": 64.0, "max": 65.0, "count": 13, "units": "degrees_east" },
  "bounding_box": { "latitude": [19.0, 20.0], "longitude": [64.0, 65.0] },
  "note": "This is the full extent of the configured NetCDF sample -- it is not basin-wide coverage."
}
```

The application must not imply model data exists outside this box / time / depth.

## Frontend (typed client boundary only — no UI, no rendering)

- `src/api/types.ts` — `ModelDecoding`, `ModelCoverage`; `coverage?` + `decoding?`
  on `ModelDatasetResponse`; `decoding?` on `ModelVariableResponse` /
  `ModelSliceResponse`; `source.label` typed.
- `src/api/modelCoverage.ts` *(pure)* — `MODEL_TEMPERATURE_VARIABLE` (`"thetao"`),
  `summarizeModelCoverage()`, `isPointInModelCoverage(lat, lon)` (fails closed),
  `describeModelCoverage()` → e.g.
  `"GLORYS12V1 / Copernicus Marine — 8.00°N–20.50°N, 61.50°E–70.00°E,
  2025-03-24 → 2025-04-02, 0.5–541.1 m (regional subset — not full-basin
  coverage)"`. `isSubset` is `true` unless the field is near-global.
- `src/api/client.ts` / `index.ts` — doc-comment updates + exports. The existing
  `getModelDataset()` / `getModelVariable()` / `getModelVariableSlice()` methods
  are unchanged and now reach GLORYS `thetao` end-to-end.

Same failure policy as the rest of the client — never a mock fallback; every
failure is a thrown `ApiError`.

## Data-coverage expansion (larger Arabian Sea subset)

Acquired with the venv-local Copernicus Marine Toolbox (`copernicusmarine`
v2.4.1, installed into `backend/.venv` only, **not** in `requirements.txt` — an
acquisition/provenance tool). Dataset ID **verified via `copernicusmarine
describe`** (not assumed): `cmems_mod_glo_phy_my_0.083deg_P1D-m`, whose `source`,
native 1/12° grid, native 50-level vertical grid and now-extended time coverage
(1993 → 2026-06) all match the tiny sample.

| | Requested | Returned (verbatim from the file) |
| --- | --- | --- |
| longitude | 61.5 → 70.0 °E | 61.5 → 70.0 °E, **103** native points |
| latitude | 8.0 → 20.5 °N | 8.0 → 20.5 °N, **151** native points |
| time | 2025-03-24 → 2025-04-02 | **10** daily means, exactly 1-day spacing |
| depth | 0 → 600 m | 0.494 → 541.089 m — **32 native GLORYS levels**, unchanged |

`thetao` `(10, 32, 151, 103)` = **4,976,960 cells**; file **9,978,696 bytes**;
SHA-256 `08aee6649b2dbfa34a1a553310ae02902c27c5bbcfcb4afba8fa5e1370ecd1ea`.
Validation: NetCDF opens clean; `source = "MERCATOR GLORYS12V1"`;
`thetao`/`standard_name`/`units` correct; **CF decode == first-principles
`raw·scale + offset`** exactly; `_FillValue = -32767` → 11,670 NaN cells
(= raw fill count — a real coastal/seafloor mask, unlike the tiny sample);
decoded range **10.070 – 30.700 °C**, physically plausible; grid points on the
native k/12 lattice and depth on the native levels (**no regrid / interp /
smooth / resample**); overlap with the tiny sample is **bit-identical**.

**Config:** `MODEL_NETCDF_FILENAME` now names the Arabian Sea file;
`default_model_netcdf_path()` prefers it and **falls back** to the tiny sample.
Dataset id, decoding flag and source label are unchanged. The service reads
dimensions and coverage from whichever file is present — nothing is hard-coded to
a subset size (a test points the same code at the tiny sample and gets the
smaller dims back).

**Observation overlap (space + time only — no comparison):** the subset was
designed around, and is verified to contain, 4 real INCOIS Argo profiles:
`3902669_4` (19.667 °N, 64.65 °E, 2025-03-31), `5907180_3` (16.533 °N, 68.667 °E,
2025-03-26), `5907179_3` (12.317 °N, 68.15 °E, 2025-03-28), `6990715_3`
(9.400 °N, 68.45 °E, 2025-04-01). Model-vs-observation extraction/differencing is
**Step 43+**.

## What is untouched

- The `.bnx` D1–D15 pipeline, `BlueNexusCatalog`, every `/api/datasets/*`
  endpoint — INCOIS temperature / salinity / current products unchanged. The
  `.bnx` analysis-temperature product and the GLORYS model temperature are
  **distinct** (different endpoint, id, grid, units string).
- The Argo / glider observation providers and endpoints.
- `data/raw/currents_incois_io-hoofs_sample.nc` and all other existing raw files.
- **The tiny validation sample** `temperature_cmems_glorys12v1_sample.nc` —
  byte-for-byte unchanged (SHA-256 re-verified), still selectable via
  `BLUENEXUS_NETCDF_PATH` and used as the automatic fallback.
- The INCOIS Argo / glider observation datasets and endpoints (17 Argo profiles,
  2 glider deployments) — inspected read-only, not modified.
- The frontend 3-D scene, layout and controls — no component renders the model
  field yet.
- `backend/requirements.txt` — the Copernicus Marine Toolbox is **not** added
  there (venv-local acquisition tool only).

## Testing

**Backend** — `backend/tests/test_model_data.py` (`unittest`): dataset discovery
from `from_env()` (no env var) → the Arabian Sea file, `cf_decode` on, GLORYS
label; SHA-256 of **both** repo files; `thetao` + native
`time × depth × latitude × longitude` dims (`10 × 32 × 151 × 103`); **no regrid**
(grid points on the native k/12 lattice, depth on the native 32 GLORYS levels,
1/12° spacing); 10 daily time steps; **CF decode == first-principles
`raw·scale + offset`** with `_FillValue → NaN`; fill cells present and decode to
NaN (0.23 %); decoded °C physically plausible + surface-warmer-than-deep; raw
files byte-unchanged; **same-product check** — overlap with the tiny sample is
bit-identical; a **packed-`int16` fixture** (fill → `null`, others → °C;
`cf_decode=False` never mislabels packed ints); `/api/netcdf/*` responses
(identity, `source.label`, **coverage == actual file extent**, decoded slice
matching the source, depth-column monotonic decrease, `503` when absent, no NaN
token in JSON); **`test_10_architecture_is_subset_size_independent`** — same
service code pointed at the tiny sample reports the smaller dims/coverage;
**`test_06_target_argo_profiles_are_inside_model_coverage`** — the 4 Argo
profiles fall inside the box + window (no comparison); regression — `/api/health`,
`/api/datasets`, INCOIS T/S/current slices, `/api/observations/*` all `200`
(Argo count 17, glider count 2 unchanged), `.bnx` ids exclude `glorys12v1_model`,
IO-HOOFS raw file still loadable.

Full backend suite: **307 pass**.

**Frontend** — `frontend/tests/model-data.test.ts` + `model-coverage.test.ts`
(GLORYS Arabian Sea mocks): client URLs + identity + coverage pass-through;
`thetao` as decoded `degrees_C` / `float64` with its `decoding` block; slice
keeps decoded °C and `null` verbatim, all values physical; full 4-axis index
query; `503` → `ApiError`; coverage helpers extract the real extent, flag it a
**regional subset** (and do **not** flag a near-global field), place Argo points
inside the box and the demo Arabian-Sea region + gliders **outside**, render the
one-line statement.

Full frontend suite: **127 pass**. `tsc -b` clean, `oxlint` clean, `vite build`
succeeds.

## Limitations

1. **Still a regional subset**, not full-basin: 8–20.5 °N / 61.5–70 °E, a 10-day
   window (2025-03-24→04-02), 0–541 m. Meaningful for 4 Argo profiles in the
   Arabian Sea; the other 13 Argo profiles (Bay of Bengal, southern Indian
   Ocean, later cycles) and both gliders (2016 / 2022, different regions) are
   **outside** and would each need their own subset. The `coverage` block and
   `describeModelCoverage()` state the real extent.
2. **Region offset from the app's demo region.** The app's "Arabian Sea" preset
   centres near 12.9 °N / 74.9 °E — east of this box, so
   `isPointInModelCoverage` returns `false` there. Region/slice alignment is
   Step 43+.
3. **No visible surfacing yet.** The coverage limitation is retrievable and
   typed, but nothing renders it in the UI — Step 43+ (this step must not change
   UI / 3-D behaviour).
4. **One model file per API instance** (Step 39 constraint), read fully into
   memory at startup (~9.5 MiB on disk, ~19 MiB decoded float32 — fine).
5. **No model-vs-observation** difference logic (Steps 43–46).
6. **Acquisition tool footprint.** `copernicusmarine` v2.4.1 pulled ~48 packages
   (boto3/dask/zarr/pyarrow/h5py/pystac-ext…) into `backend/.venv`. It is
   **not** in `requirements.txt`; the server runtime does not import it. Removable
   with `pip uninstall copernicusmarine` if re-acquisition is not needed.

## Step 42 verdict

**COMPLETE — data-acquisition / coverage-expansion portion.** The validated
GLORYS12V1 `thetao` model temperature — verified dataset ID
`cmems_mod_glo_phy_my_0.083deg_P1D-m` (DOI 10.48670/moi-00021), the larger
Arabian Sea subset — is preserved verbatim in `data/raw/` with full provenance,
served CF-decoded to real `degrees_C` through the existing `/api/netcdf` API as
`glorys12v1_model` with the explicit `GLORYS12V1 / Copernicus Marine` identity and
a dynamic `coverage` block, overlapping 4 real INCOIS Argo profiles, and reachable
through the existing typed frontend model-data client. The tiny validation
sample, the `.bnx` pipeline, the INCOIS observation datasets and the frontend
visualization are untouched. Model-vs-observation logic (Step 43+) is not
started.
