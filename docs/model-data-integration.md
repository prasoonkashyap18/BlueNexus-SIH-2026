# Step 41 — Real Model Data Integration

> **Superseded by Step 42 for the model dataset that `/api/netcdf` serves.**
> Step 41 pointed `/api/netcdf` at the INCOIS **IO-HOOFS surface-current** file
> (`currents_incois_io-hoofs_sample.nc`, id `incois_io_hoofs_model`) as an
> interim placeholder — that file has **no temperature**. Step 42 replaces the
> default with the validated **GLORYS12V1 potential-temperature** file
> (`temperature_cmems_glorys12v1_sample.nc`, id `glorys12v1_model`). The IO-HOOFS
> file is untouched on disk and still reachable via `BLUENEXUS_NETCDF_PATH`.
> The Step 37–39 pipeline, the `/api/netcdf` route surface and the frontend
> client boundary this step introduced are all still current — see
> [`glorys-model-temperature.md`](glorys-model-temperature.md).

Connects the authoritative real ocean **model** dataset into the existing
BlueNexus scientific-data architecture so it is available through the backend
API for the Step 42–44 model-vs-observation work. **Integration only** — no
comparison, no interpolation, no UI redesign.

## Audit (audit-first rule)

Inspected before any change: `data/raw/`, `data/processed/`, `data/bluenexus/`,
the two existing NetCDF files, the two `.bnx` files, `data/update-state/manifest.json`,
the D1–D15 pipeline (`app/data/{ingestion,processing,bluenexus,updater}`), the
Step 37–39 scientific/NetCDF layer (`app/data/scientific/`, `app/services/netcdf_service.py`,
`app/api/routes/netcdf.py`), the ingestion registry (`app/data/ingestion/registry.py`),
and the source docs `docs/data-sources.md` (D1), `docs/data-availability.md` (D2),
`docs/data-acquisition.md` (D4).

**Datasets found in the repo:**

| File | Product | Type | Suitable as "the model dataset"? |
| --- | --- | --- | --- |
| `data/raw/currents_incois_io-hoofs_sample.nc` | INCOIS **IO-HOOFS** (ROMS-based operational ocean forecast) | **Ocean general-circulation model** output | **Yes** — this is genuine model output (D4: *"Operational ocean-current forecast product from an ocean general circulation model (ROMS-based IO-HOOFS)"*) |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | INCOIS Argo 10-day gridded analysis | Observation-based objective analysis (Argo floats, gridded) — *not* a free-running model | No — it is the validated observation-analysis product, already the `.bnx` T/S dataset |
| `data/raw/argo_*.csv`, `data/raw/glider_*.csv` | Argo / glider profiles | In-situ observations | No |

**GODAS** — the doc-recommended global 3-D model (T/S/currents, 40 levels) — was
**not acquired** (D2: public LAS mirror stale at 2025-05-22, OPeNDAP times out).
Per the audit-first rule it was **not downloaded**; doing so needs explicit
confirmation and is future work.

**Conclusion: a suitable authoritative real model dataset already exists
(`currents_incois_io-hoofs_sample.nc`) — it is REUSED as-is. No new dataset was
downloaded, generated, duplicated or ingested.**

## The model dataset

| Field | Value |
| --- | --- |
| Authoritative source | **INCOIS** — Indian Ocean High-resolution Operational Ocean Forecast and reanalysis System (**IO-HOOFS**), ROMS 3.7 + LETKF ensemble data assimilation |
| Official endpoint | INCOIS THREDDS — `https://incois.gov.in/thredds/`, family `osf/currents/CURRENTS_IO_YYYYMMDD.nc` |
| Exact file | `data/raw/currents_incois_io-hoofs_sample.nc` — server-side NCSS subset of `CURRENTS_IO_20260904.nc` (from model run `ioout_20260904.nc`), 24,300,572 bytes, NetCDF-3 classic, SHA-256 `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` |
| Classification | Model forecast — **not observational, not "real-time"** |
| Conventions | `CF-1.6` |
| **Dimensions** | `TAXIS = 4` (time), `DEPTH1_1 = 1` (depth), `LAT = 421`, `LON = 601` |
| **Coordinates** | `TAXIS` — datetime, forecast valid **2026-09-05 01:30Z → 2026-09-08 19:30Z** (4 of the run's 3-hourly steps, every 10th kept); `DEPTH1_1` — **1 level, 0.0 m** (surface only, `units "meters"`, `positive "down"`); `LAT` −10.008 → 24.978 °N, even **1/12°**; `LON` 49.992 → 99.972 °E, even **1/12°** |
| **Variables** | `U` — eastward current, `standard_name "eastward_current"`, m/s (no `units` attr in file); `V` — northward current, `standard_name "northward_current"`, m/s; `CURRENT` — INCOIS-supplied surface current speed, `long_name "Surface Currents (m/s)"`, m/s. Shape `[TAXIS, DEPTH1_1, LAT, LON]` for all three. |
| Missing values | IEEE **NaN** (the land mask — ~207 k of 1.01 M `CURRENT` cells). `_FillValue`/`missing_value` attr is `-1e34` but **0 cells** hold the sentinel; all missing cells are already NaN in the file. |
| Temperature / Salinity | **Not present** in this acquired subset (surface currents only). See *Limitations*. |

Native values and metadata are preserved exactly — nothing is interpolated,
regridded, smoothed, normalized, unit-converted, or fill-substituted.

## How the backend exposes it

Reuses the Step 37–39 pipeline **unchanged**:

```
data/raw/currents_incois_io-hoofs_sample.nc
  → app.data.scientific.open_netcdf(path, load=True)   (Step 38, mask_and_scale=False — lossless)
  → ScientificDataset / ScientificVariable             (Step 37)
  → NetCDFDataService                                  (app/services/netcdf_service.py — Step 39)
  → GET /api/netcdf/*                                  (app/api/routes/netcdf.py — Step 39)
```

**The only change:** `ApiConfig` (`app/api/config.py`) now **defaults**
`netcdf_path` to the repo's IO-HOOFS model file when `BLUENEXUS_NETCDF_PATH` is
unset (resolved from the repo root — no absolute path baked in), and
`netcdf_dataset_id` defaults to **`incois_io_hoofs_model`**. So the model is
served at `/api/netcdf` out of the box, with no env var. If the file is absent,
the endpoints still return `503 netcdf_not_configured` (unchanged). An explicit
`BLUENEXUS_NETCDF_PATH` still overrides.

Endpoints (all from Step 39, no new API):

| Endpoint | For Steps 42–44 |
| --- | --- |
| `GET /api/netcdf/dataset` | model identity (`incois_io_hoofs_model`), `dimensions`, every coordinate (`TAXIS`/`DEPTH1_1`/`LAT`/`LON` with role + values + units), `variables` (`U`,`V`,`CURRENT`), global attributes |
| `GET /api/netcdf/variables/{U\|V\|CURRENT}` | dimensions, shape, dtype, units, attributes (incl. `standard_name`), `axis_roles` |
| `GET /api/netcdf/variables/{name}/slice?time_index=&depth_index=&latitude_index=&longitude_index=` | indexed selection of the native grid, real values, missing cells as JSON `null` |

Errors use the shared `{ "error": { type, message, detail } }` envelope
(`netcdf_not_configured` 503, `netcdf_unavailable` 503, `unknown_variable` 404,
`invalid_index` 422, `slice_too_large` 422). **No synthetic fallback** — a
missing/unreadable model file is a 503, never fabricated data.

## What is untouched

- The `.bnx` D1–D15 pipeline, `BlueNexusCatalog`, and every `/api/datasets/*`
  endpoint — the validated INCOIS temperature / salinity / current products are
  unchanged. The `.bnx` currents dataset id (`incois_io_hoofs_surface_currents`)
  is **distinct** from the raw model id (`incois_io_hoofs_model`).
- The Argo / glider observation providers and endpoints.
- The frontend visualization (temperature, salinity, currents, Argo/glider
  markers, profile switching, geographic grid). No component reads the model
  dataset yet.

## Frontend

Minimum to establish availability — a typed client boundary only, **no UI, no
rendering**:

- `frontend/src/api/types.ts` — `ModelDatasetResponse`, `ModelCoordinateAxis`,
  `ModelVariableResponse`, `ModelSliceResponse`, `ModelSliceSelection`
  (mirror the backend `NetCDF*` schemas).
- `frontend/src/api/client.ts` — `getModelDataset()`, `getModelVariable(name)`,
  `getModelVariableSlice(name, query)` on `DataApiClient` + `ModelSliceQuery`.
- `frontend/src/api/index.ts` — exports.

Same failure policy as the rest of the client: never falls back to mock data;
every failure is a thrown `ApiError`.

## How Steps 42–44 will consume it

1. `getModelDataset()` → discover the model grid (native `LAT`/`LON`/`TAXIS`,
   surface `DEPTH1_1`) and confirm availability.
2. `getModelVariableSlice('U'|'V'|'CURRENT', { timeIndex })` → the native
   surface current field at a forecast step.
3. Comparison logic (Step 42+) reads observation positions from the existing
   Argo/glider providers and samples the model **at** those native grid cells —
   *no* regridding of the model, *no* moving model values onto observation
   coordinates in this step.

## Testing

**Backend** — `backend/tests/test_model_data.py` (15, `unittest`):

- `from_env()` with no env var → `netcdf_path` is the real IO-HOOFS file,
  `netcdf_dataset_id == "incois_io_hoofs_model"`; `default_model_netcdf_path()`
  points at the real ~24 MB repo file.
- Scientific layer: loads; variables `{U,V,CURRENT}`; dims `{TAXIS:4, DEPTH1_1:1,
  LAT:421, LON:601}`; native coord ranges; `TAXIS` datetime64 with the 4 exact
  forecast steps; `DEPTH1_1` = `[0.0]`, `units "meters"`, `positive "down"`;
  `U.standard_name == "eastward_current"`; representative `CURRENT` slice is
  **bit-for-bit equal** to the xarray source (same NaN mask, same finite
  values); NaN count preserved, 0 sentinels.
- API (live uvicorn): `/api/netcdf/dataset` reports `incois_io_hoofs_model` +
  structure + coordinate roles + ISO time; `/api/netcdf/variables/U` metadata;
  `/api/netcdf/variables/CURRENT/slice` block of interior cells **matches the
  source exactly**; a real NaN cell is `null`; a missing model file → `503
  netcdf_unavailable` with no `variables` key (no synthetic fallback).
- Regression: `/api/health`, `/api/datasets`, temperature/salinity/current_u/
  current_v/current_speed slices, `/api/observations/argo|gliders` all 200; the
  `.bnx` currents dataset id is still present and distinct from the model id.

Full backend suite: **293 pass** (278 + 15).

**Frontend** — `frontend/tests/model-data.test.ts` (5, `node:test`, mocked
fetch): `getModelDataset()` URL + identity pass-through; `getModelVariable()`
path encoding; `getModelVariableSlice()` builds the indexed query and passes
real values + `null` through verbatim; absent indices omitted; a 503 surfaces as
`ApiError` (`kind: "http"`, `type: "netcdf_unavailable"`), never synthetic data.

Full frontend suite: **108 pass** (103 + 5). `tsc -b` clean, `oxlint` clean,
`vite build` succeeds.

## Limitations

1. **Currents only.** The acquired IO-HOOFS subset (D4) is surface `U`/`V`/`CURRENT`
   at a single depth level. The full IO-HOOFS product has 40 sigma levels and
   subsurface T/S, but only the surface-current NCSS subset was downloaded.
   Model-vs-observation for **temperature/salinity profiles** (Argo/glider)
   therefore needs a fuller IO-HOOFS acquisition or GODAS — a **new download**,
   out of scope for Step 41's audit-first rule and requiring explicit
   confirmation. Step 41 gives Steps 42–44 a real model **current** field.
2. **Source file is transient.** `CURRENTS_IO_20260904.nc` rolls off the INCOIS
   THREDDS ~7-day window around 2026-09-11; the committed local copy is the
   preserved record (D4 §5).
3. **One model file per API instance** (Step 39 constraint). The model is read
   fully into memory at startup (~24 MB — fine).
4. No `.bnx` was regenerated; `data/raw/` and `data/bluenexus/` are unchanged.

## Step 41 verdict

**PASS** — an authoritative real ocean model dataset (INCOIS IO-HOOFS) that
already existed in the repo is now exposed, losslessly, through the existing
scientific/NetCDF API at `/api/netcdf` as `incois_io_hoofs_model`, ready for
Steps 42–44, with the `.bnx` pipeline, observation providers and the frontend
visualization untouched.
