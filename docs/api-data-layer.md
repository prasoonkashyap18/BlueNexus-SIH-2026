# BlueNexus D10 Backend / API Data Layer

**Data Track step:** D10 — Build the Backend/API Data Layer
**Type:** FastAPI HTTP layer over the D9 BlueNexus `.bnx` data + service layer +
tests + docs. No database, no ORM, no Supabase, no automatic updating, no
frontend change.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** D1–D6 docs · `docs/data-ingestion.md` (D7) ·
`docs/data-processing.md` (D8) · `docs/data-format.md` (D9)

---

## 1. Purpose

D10 is the first step where the BlueNexus data becomes reachable over HTTP:

```
official INCOIS source → raw NetCDF → D7 ingestion → D8 cleaning → D9 BlueNexus .bnx → [ D10 backend/API ] → D11 frontend
```

The API lets a future frontend **discover** datasets, read their **metadata**,
**parameters** and **coordinates**, and pull **targeted lat×lon slices** — while
never shipping a whole multi-megabyte array and never emitting invalid JSON.

The API only ever reads the D9 `.bnx` containers. It does **not** open the raw
NetCDF files from a request, does not implement a second data format, and does
not regrid / interpolate / merge anything.

---

## 2. Architecture

```
HTTP request
   │
   ▼
backend/app/api/routes/*         thin handlers — parse path/query, call the service, return
   │
   ▼
backend/app/services/catalog.py  BlueNexusCatalog — discovery, id resolution, validation, slicing
   │
   ▼
backend/app/data/bluenexus/      D9: BnxReader (partial reads) + convert_* / write_bluenexus (build)
   │
   ▼
data/bluenexus/*.bnx             the data source
```

```
backend/
  main.py                         MODIFIED — 2-line re-export of app.api.app:app (keeps `uvicorn main:app`)
  requirements.txt                UNCHANGED — no dependency added
  app/
    api/
      __init__.py
      app.py                      create_app() → FastAPI: CORS, error handlers, routers, startup catalog init
      config.py                   ApiConfig (env-overridable: data dir, CORS origins, build-on-startup)
      errors.py                   ApiError hierarchy + JSON-envelope handlers (no tracebacks)
      schemas.py                  Pydantic response models (drive the OpenAPI docs)
      routes/
        health.py                 GET /api/health   (preserved + extended)
        datasets.py               GET /api/datasets[...]
        slices.py                 GET .../slice
    services/
      catalog.py                  BlueNexusCatalog + module singleton
  tests/
    _httpserver.py                run the app under real uvicorn in a thread (no httpx/TestClient)
    test_api.py                   35 D10 tests = the integration test
```

**Framework:** the existing FastAPI + uvicorn (already in `requirements.txt`).
Nothing was added. `fastapi.testclient` needs `httpx`, which is **not**
installed; rather than add it, the tests boot the real app under the installed
`uvicorn` and hit it with stdlib `urllib` — genuine HTTP round-trips.

---

## 3. Endpoints

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness + D9 data-layer discoverability (preserved from the original backend) |
| `GET /api/datasets` | List datasets — metadata only |
| `GET /api/datasets/{dataset_id}` | Full D9 contract/metadata for one dataset |
| `GET /api/datasets/{dataset_id}/parameters` | Canonical parameters in the dataset (aliases rejected) |
| `GET /api/datasets/{dataset_id}/coordinates` | Exact D9 coordinate arrays (time / depth / lat / lon) |
| `GET /api/datasets/{dataset_id}/parameters/{parameter_id}/slice` | One lat×lon plane; `?time_index=&depth_index=` |
| `GET /api/observations/argo` | List real INCOIS Argo float profiles (added Step 28) |
| `GET /api/observations/argo/{platform_id}` | One Argo profile + every measured level |
| `GET /api/observations/gliders` | List real EGO / OceanGliders glider deployments (added Step 29) |
| `GET /api/observations/gliders/{platform_id}` | One deployment + every trajectory sample |

Interactive OpenAPI docs: `http://localhost:8000/docs` (and `/openapi.json`).
The API contract was audited and hardened in **Step 35** — see
`docs/production-data-api.md`.

### Path / query parameters

| Name | Where | Rules |
| --- | --- | --- |
| `dataset_id` | path | must match `^[a-z0-9][a-z0-9_]{0,63}$` **and** resolve in the catalog; else `404 unknown_dataset` |
| `parameter_id` | path | canonical id only — `temperature`, `salinity`, `current_u`, `current_v`, `current_speed`. Aliases (`temp`, `sst`, `salt`, `current`, `velocity`) → `404 unknown_parameter` |
| `time_index` | query | integer `≥ 0` (FastAPI `ge=0`); `≥ time-dim size` → `422 invalid_index` (no clamping) |
| `depth_index` | query | integer `≥ 0`; `≥ depth-dim size` → `422 invalid_index` |

---

## 4. Request / response examples

### `GET /api/health`

```json
{
  "status": "ok",
  "service": "bluenexus-data-api",
  "data_layer": {
    "data_dir_exists": true,
    "bnx_files_found": ["incois_argo_10day_analysis.bnx", "incois_io_hoofs_surface_currents.bnx"],
    "datasets_loaded": ["incois_argo_10day_analysis", "incois_io_hoofs_surface_currents"],
    "expected_datasets": ["incois_argo_10day_analysis", "incois_io_hoofs_surface_currents"],
    "all_expected_present": true,
    "load_errors": {}
  }
}
```

`status` is always `"ok"` while the process is up — the existing frontend
`useHealthCheck` only reads `data.status`, so its behaviour is unchanged.

### `GET /api/datasets` (abridged)

```json
{
  "count": 2,
  "datasets": [
    {
      "dataset_id": "incois_argo_10day_analysis",
      "title": "INCOIS Argo 10-Day Analysis - Temperature & Salinity",
      "product_type": "analysis",
      "data_status": "analysis",
      "parameter_ids": ["temperature", "salinity"],
      "dimensions": [
        {"name": "time", "role": "time", "size": 3},
        {"name": "ZAX", "role": "depth", "size": 24},
        {"name": "latitude", "role": "latitude", "size": 36},
        {"name": "longitude", "role": "longitude", "size": 51}
      ],
      "shape_by_parameter": {"temperature": [3,24,36,51], "salinity": [3,24,36,51]},
      "time_coverage": {"start_iso": "2026-07-10T00:00:00Z", "end_iso": "2026-07-30T00:00:00Z", "n": 3, "step": 864000.0},
      "depth_coverage": {"min": 5.0, "max": 2000.0, "n": 24, "surface_only": false},
      "latitude_coverage": {"min": -9.5, "max": 25.5, "n": 36, "step": 1.0},
      "longitude_coverage": {"min": 50.5, "max": 100.5, "n": 51, "step": 1.0},
      "source": {"name": "INCOIS ERDDAP", "dataset_id": "incois_argo_10day_McCreary", "product_title": "..."},
      "provenance_summary": {"source_name": "INCOIS ERDDAP", "source_dataset_id": "incois_argo_10day_McCreary", "product_pipeline": "D9 BlueNexus format"}
    }
  ]
}
```

### `GET /api/datasets/incois_argo_10day_analysis/parameters` (abridged)

```json
{
  "dataset_id": "incois_argo_10day_analysis",
  "canonical_parameter_ids": ["temperature", "salinity"],
  "note": "Only canonical ids are accepted by the API. Aliases such as 'temp', 'sst', 'salt', 'current', 'velocity' are display-only and are rejected as lookup keys.",
  "parameters": [
    {
      "parameter_id": "temperature", "canonical_id": "temperature", "accepts_aliases": false,
      "display_name": "Sea Water Temperature", "display_aliases": ["temp"],
      "units": "degC", "raw_units": "degs", "kind": "scalar_field",
      "dimensions": ["time","depth","latitude","longitude"], "shape": [3,24,36,51],
      "surface_only": false, "authoritative": true,
      "valid_count": 84490, "missing_count": 47702,
      "notes": ["Multi-depth objective-analysis field (24 levels, 5-2000 m). This is NOT sea-surface temperature ..."]
    }
  ]
}
```

### `GET .../parameters/temperature/slice?time_index=0&depth_index=0` (abridged)

```json
{
  "schema_version": "bluenexus.dataset/1",
  "dataset_id": "incois_argo_10day_analysis",
  "parameter": "temperature",
  "units": "degC",
  "product_type": "analysis",
  "data_status": "analysis",
  "missing_value": null,
  "quality_definition": {"0": "VALID", "1": "MISSING"},
  "time":  {"index": 0, "value": 1783641600.0, "iso": "2026-07-10T00:00:00Z", "units": "seconds since 1970-01-01T00:00:00Z"},
  "depth": {"index": 0, "value": 5.0, "units": "METERS"},
  "shape": {"latitude": 36, "longitude": 51},
  "latitude": [-9.5, -8.5, "..."],
  "longitude": [50.5, 51.5, "..."],
  "values": [[null, null, 27.5, "..."], "..."],
  "quality": [[1, 1, 0, "..."], "..."],
  "parameter_metadata": {"display_name": "Sea Water Temperature", "kind": "scalar_field", "surface_only": false, "authoritative": true, "raw_units": "degs", "standard_name": null, "long_name": "Objectively Analyzed Temperature"},
  "provenance": {"source_name": "INCOIS ERDDAP", "source_identifier": "incois:incois_argo_10day_McCreary", "source_file_name": "temperature_salinity_incois_argo_sample.nc", "source_file_sha256": "17f5caa8...bb6c9e6d", "pipeline_stages": ["D4 acquisition", "...", "D9 BlueNexus format"]},
  "bytes_read": 16524
}
```

### Error envelope

Every error (404 / 422 / 500 / 503) returns the same shape:

```json
{ "error": { "type": "invalid_index", "message": "time_index 99 out of range", "detail": { "parameter": "temperature", "valid_range": [0, 2] } } }
```

| `type` | HTTP | When |
| --- | --- | --- |
| `unknown_dataset` | 404 | `dataset_id` not in the catalog |
| `unknown_parameter` | 404 | `parameter_id` is not a canonical BlueNexus id (includes every alias) |
| `parameter_not_in_dataset` | 404 | canonical id, but not one this dataset carries (e.g. `temperature` on the currents dataset) |
| `invalid_index` | 422 | `time_index` / `depth_index` is a non-negative int but ≥ the axis size |
| `malformed_request` | 422 | negative or non-integer `time_index` / `depth_index` |
| `data_unavailable` | 503 | the backing `.bnx` is missing or unreadable |
| `internal_error` | 500 | anything else — message is generic, never a traceback |

---

## 5. Dataset discovery behaviour

`BlueNexusCatalog.load()` scans `config.data_dir` for `*.bnx`, opens each with
the D9 `BnxReader` (header + manifest only — a few KB, **no** bulk arrays), and
keys them by `manifest.contract.dataset_id` (not by filename). If
`BLUENEXUS_BUILD_ON_STARTUP` is on (default) and a known dataset's `.bnx` is
missing, it is built once via the D9 API (`convert_all()` + `write_bluenexus`)
before the scan. A corrupt container is skipped and surfaced in
`health.data_layer.load_errors`.

`GET /api/datasets` answers from the cached manifests — it never reads a blob,
so a catalog request costs kilobytes even though the currents `.bnx` is ~27 MB.

---

## 6. Parameter discovery behaviour

`GET /api/datasets/{id}/parameters` returns the D9 parameter contract for that
dataset plus `canonical_parameter_ids`. **Only canonical ids are accepted
anywhere in the API.** `temp`, `sst`, `salt`, `current`, `velocity` — and any
other non-canonical string — return `404 unknown_parameter`. Aliases appear only
in each parameter's `display_aliases` (cosmetic, for UI labels).

`temperature` is a depth-dependent analysis field (`surface_only: false`, shape
`[3,24,36,51]`); it is never labelled SST. `current_speed` is
`kind: "vector_magnitude"`, `authoritative: true`, `surface_only: true` — the
INCOIS-supplied `CURRENT` field, not a recomputed one.

---

## 7. Coordinate behaviour

`GET /api/datasets/{id}/coordinates` returns the D9 coordinate block verbatim —
`time` / `depth` / `latitude` / `longitude`, each with `values`, `units`,
`calendar`, `ordering`, `regular_step`, and (for `time`) `iso_times`,
`reference_epoch_iso`, `timezone`, `timezone_is_assumed`.

Coordinates are **not** regenerated. The currents grid keeps its stored
`0.0833°` spacing (longitude starts at `49.992`, step `0.0833`, **not** `1/12°`
and **not** a synthetic `50.0`). The analysis and currents datasets are served
as separate resources with separate grids; nothing merges them.

---

## 8. Slice behaviour

`GET /api/datasets/{id}/parameters/{pid}/slice?time_index=&depth_index=` returns
a single latitude × longitude plane:

- `values` — `latitude × longitude` nested lists; a missing cell is **`null`**.
- `quality` — same shape; `0` = VALID, `1` = MISSING; `values[i][j] is None`
  **iff** `quality[i][j] == 1`.
- `latitude` / `longitude` — returned **once**, not repeated per cell.
- `time` / `depth` — the selected index, its raw value, ISO string, units.
- `units` — canonical (`degC` / `PSU` / `m s-1`).
- `parameter_metadata`, `provenance`, `bytes_read`.

Backed by D9 `BnxReader.slice()` — see §10.

---

## 9. Missing-value handling & quality flags

The API **never** emits raw `NaN`/`Infinity` (invalid JSON): FastAPI's response
path plus D9's `BnxReader` both convert every missing cell to `null` before
serialisation. It never substitutes `0`, `-1`, `-9999` or `-1e34`. A genuine
`0.0` stays `0.0` and `quality == 0`.

`quality`: `0 = VALID`, `1 = MISSING` — the D8/D9 vocabulary, two states only,
no oceanographic grades. `metadata.quality_definition` carries the mapping and
`metadata.missing_value_definition` spells out the contract.

---

## 10. Performance / data-loading strategy

The problem: the currents `.bnx` is ~27 MB; `read_bluenexus()` loads the whole
thing. Answering one slice per request that way is unacceptable.

The fix: **D9 gained a `BnxReader`** (documented in `docs/data-format.md` §"BnxReader").
It parses the header + manifest once (KB) and then, per slice:

```
plane      = latitude_size * longitude_size
base       = (time_index * depth_size + depth_index) * plane
values ← seek(blob_base + values_offset + base*8); read(plane*8)     # float64 LE
quality← seek(blob_base + quality_offset + base*1); read(plane)      # uint8
```

So a request reads only `plane * 9` payload bytes:

| Slice | `bytes_read` | `.bnx` file size |
| --- | --- | --- |
| temperature / salinity (36×51) | **16,524 B** | 2.4 MB |
| current u/v/speed (421×601) | **2,277,189 B** | 27.4 MB |

The catalog also caches one `BnxReader` per dataset for the process lifetime, so
the manifest is parsed once, not per request. No D9 redesign — only the
additive `BnxReader` and its `__init__.py` export.

Catalog requests (`/api/datasets`, `/…/parameters`, `/…/coordinates`,
`/…/{id}`) touch **zero** blob bytes — manifest only.

---

## 11. CORS

`create_app` adds `CORSMiddleware` with:

- `allow_origins` = `config.cors_origins`, default the local Vite dev servers
  (`http://localhost:5173`, `http://127.0.0.1:5173`, and the `:5174` fallback of
  both). Override with
  `BLUENEXUS_CORS_ORIGINS="https://a.example,https://b.example"`.
  **Never `"*"`** — since Step 35 a `*` in the list is rejected at startup
  (`ValueError`).
- `allow_methods` = `["GET", "OPTIONS"]` (OPTIONS for the browser preflight).
- `allow_headers` = `["*"]`; credentials are **not** allowed, so wildcard
  headers are safe.

No frontend file was changed — D11 will wire the frontend to these endpoints.

---

## 12. Error handling

`install_error_handlers` registers four handlers:

- `ApiError` → its `status_code` + the `{"error": {...}}` envelope.
- `RequestValidationError` → `422 malformed_request` with a `fields` list
  (which param, what's wrong) — used for negative / non-integer indices.
- Starlette `HTTPException` → the envelope (e.g. a 404 for an unmatched path).
- bare `Exception` → `500 internal_error`, generic message, **no traceback,
  no internal detail**.

---

## 13. Security

| Risk | Mitigation |
| --- | --- |
| Path traversal via `dataset_id` / `parameter_id` | Regex-validated (`^[a-z0-9][a-z0-9_]{0,63}$`) in the route **and** the service; only ever used as an in-memory dict key, never concatenated into a path. `/api/datasets/..%2f..%2fetc/...` → 404. |
| Arbitrary file access | `.bnx` files are only ever opened from `config.data_dir.glob("*.bnx")`. `write_bluenexus()` refuses any path under `data/raw/`. |
| Internal path disclosure | Slice/detail provenance exposes `source_file_name` (basename) + `source_identifier` (`incois:<dataset>`), **not** the server-side path (`source_file` key is dropped). |
| Traceback / stack disclosure | Global `Exception` handler returns a generic 500 envelope. |
| Out-of-range / malformed indices | `Query(ge=0)` + explicit range checks → 422, never silently clamped. |
| Arbitrary CORS | Explicit dev origin; env-overridable; never `"*"`; no credentials. |
| Route reading raw NetCDF | Routes → catalog → `BnxReader` (`.bnx` only). A test disables `NetCDF3File.open` and every endpoint still serves. |
| Unknown dataset id resolving to a file | Ids resolve only against the catalog built from a fixed directory + a `_KNOWN_DATASETS` allow-list. |

---

## 14. D9 integration

- Discovery / metadata: D9 `BnxReader` (manifest) — `contract`, `dataset_id`,
  `generation`.
- Slices: D9 `BnxReader.slice()` — partial reads.
- Missing `.bnx`: D9 `convert_all()` + `write_bluenexus()` at startup (build
  step, uses the D9 API, not a route).
- The API imports nothing from `app.data.ingestion` / `app.data.processing`
  except `project_root` (path helper) and, at build time, the D9 converters.
  Routes never touch D7/D8.

---

## 15. Local development usage

```bash
cd backend
# one-time (or whenever the raw data changes): materialise the D9 containers
./.venv/Scripts/python.exe -m app.data.bluenexus

# run the API (frontend expects port 8000)
./.venv/Scripts/python.exe -m uvicorn main:app --port 8000 --reload

# try it
curl http://localhost:8000/api/health
curl http://localhost:8000/api/datasets
curl "http://localhost:8000/api/datasets/incois_argo_10day_analysis/parameters/temperature/slice?time_index=0&depth_index=0"
curl "http://localhost:8000/api/datasets/incois_io_hoofs_surface_currents/parameters/current_speed/slice?time_index=1"
open http://localhost:8000/docs
```

Environment overrides: `BLUENEXUS_DATA_DIR`, `BLUENEXUS_CORS_ORIGINS`,
`BLUENEXUS_BUILD_ON_STARTUP`.

### Tests

```bash
cd backend
./.venv/Scripts/python.exe -m unittest discover -s tests     # 118: D7 29 + D8 30 + D9 24 + D10 35
```

---

## 16. What D10 does NOT implement

- ❌ database / Supabase / PostgreSQL / SQLite / MongoDB / ORM / migrations —
  the `.bnx` files are the data source.
- ❌ automatic updating — no scheduled downloads, cron, background workers,
  polling, or INCOIS refresh (that is D14).
- ❌ a second data format — the API consumes D9 `.bnx` only.
- ❌ direct raw-NetCDF reads from a request.
- ❌ regrid / interpolate / smooth / resample / merge grids / merge time systems
  / change scientific values.
- ❌ chlorophyll — pending official INCOIS access clarification; no NASA / NOAA /
  Copernicus / MOSDAC / synthetic / mock substitute. The API exposes only the
  confirmed D9 parameters.
- ❌ current **direction** computation — components (`current_u`, `current_v`)
  and speed (`current_speed`) are served as-is; direction visualisation is a
  later concern.
- ❌ any frontend change (D11), mock-temperature replacement (D12), UI wiring
  for salinity/currents/chlorophyll (D13), or final validation (D15).
- ❌ full data validation in `/api/health` — it confirms discoverability only.

---

## 17. Scope boundary

> **D10 added a read-only FastAPI layer over the D9 BlueNexus `.bnx` data:
> dataset discovery, dataset detail, parameter discovery, coordinate access, and
> an efficient parameter-slice endpoint, with strict validation, safe
> null-for-missing JSON, canonical units, provenance, CORS for the dev origin,
> and clean error envelopes. It added no database, no automatic updating, no
> second data format, and changed no frontend file. The preserved
> `GET /api/health` still returns `{"status": "ok", ...}`. D11–D15 were not
> started. Chlorophyll was not added or substituted.**

**Next step: D11 — Connect the BlueNexus frontend to the real data.**
