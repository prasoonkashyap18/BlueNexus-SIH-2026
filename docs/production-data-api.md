# Step 35 — Production Data API (contract hardening)

**Type:** backend audit + additive REST-contract hardening. No data-layer
rewrite, no `BlueNexusCatalog` replacement, no database, no Supabase, no new data
source, no scientific-value change, no endpoint rename, no frontend refactor.
**Builds on (all unchanged):** `docs/api-data-layer.md` (D10) · Steps 28–29
(observation endpoints).

---

## 1. Audit — what already existed and was kept

The FastAPI backend was already close to production shape; the audit confirmed:

| Area | State before Step 35 | Kept as-is |
|---|---|---|
| Layering | routes → `app/services/*` → `app/data/*`; routes never open files | ✅ |
| Routers | `health`, `datasets`, `slices`, `observations` under one `api_router` | ✅ |
| Response models | Pydantic model on every endpoint, driving `/openapi.json` | ✅ |
| Error envelope | single `{"error": {type, message, detail}}` shape, 4 handlers, **no tracebacks / no paths** | ✅ |
| Validation | path/query `pattern` + `ge=0`; explicit range checks; aliases rejected | ✅ |
| id safety | `dataset_id` / `parameter_id` regex-checked, only ever dict keys | ✅ |
| Health | machine-readable, `.bnx` discoverability only (never a value scan), frontend-independent | ✅ |
| CORS | `BLUENEXUS_CORS_ORIGINS` env override, 4-origin dev default, never `*` | ✅ |
| Performance | `.bnx` manifests + one cached `BnxReader` per dataset; slice = bounded partial read; observation snapshots loaded once at startup | ✅ |
| Real data | every endpoint serves the validated D9 `.bnx` / D4 CSV snapshots | ✅ |

**Endpoints audited (all preserved, none renamed):**

```
GET /api/health
GET /api/datasets
GET /api/datasets/{dataset_id}
GET /api/datasets/{dataset_id}/parameters
GET /api/datasets/{dataset_id}/coordinates
GET /api/datasets/{dataset_id}/parameters/{parameter_id}/slice   ?time_index= &depth_index=
GET /api/observations/argo
GET /api/observations/argo/{platform_id}
GET /api/observations/gliders
GET /api/observations/gliders/{platform_id}
```

---

## 2. Contract improvements made (all additive)

### 2.1 Error handling — resource-specific 404 slugs

`GET /api/observations/argo/{id}` and `.../gliders/{id}` returned **404** for an
unknown platform, but with the generic slug `unknown_dataset` (the id is not a
dataset). Now:

| Case | HTTP | `error.type` (before → after) |
|---|---|---|
| unknown Argo platform | 404 | `unknown_dataset` → **`unknown_argo_platform`** |
| unknown glider deployment | 404 | `unknown_dataset` → **`unknown_glider_deployment`** |
| malformed platform id | 422 | `malformed_request` (unchanged) |
| unknown gridded dataset / parameter | 404 | `unknown_dataset` / `unknown_parameter` (unchanged) |
| invalid slice index | 422 | `invalid_index` (unchanged) |

Status codes and `error.detail` (still carries `known_platform_ids`) are
unchanged. New `ApiError` subclasses `UnknownArgoPlatformError` /
`UnknownGliderDeploymentError` in `app/api/errors.py`.

### 2.2 Response models

Focused additions only (the "typed `dict` for D9 fragments" policy is kept):

* **`HealthDataLayer`** / **`HealthDataLayerUnavailable`** — `HealthResponse.data_layer`
  was `dict[str, Any]`; now a typed union that describes both real shapes
  (`data_dir_exists`, `bnx_files_found`, `datasets_loaded`, `expected_datasets`,
  `all_expected_present`, `load_errors` — or `{available: false}` if the catalog
  is not initialised). `extra="allow"` on the main model so a future catalog key
  can't break the response. **Wire format byte-identical.**
* **`SliceShape`** — `SliceResponse.shape` was `dict[str, int]`; now
  `{latitude: int, longitude: int}`. Wire format identical.

Nothing else was modelled — `coordinates` / `parameters` / `metadata` /
`provenance` stay as documented D9 passthroughs.

### 2.3 OpenAPI docs (`/docs`, `/openapi.json`)

* `title` / `summary` / `description` rewritten in production/scientific terms
  (data flow, canonical units, null-for-missing, error envelope, `analysis` /
  `forecast` never "real-time").
* `openapi_tags` metadata added (health / datasets / slice / observations).
* Every operation now has a `summary`, a `description` (units named where they
  are part of the contract), and a stable `operation_id`.
* `responses` declare the error codes each endpoint can return
  (`404` / `422` / `503` with the `ErrorResponse` model).
* `version` `0.10.0` → **`1.0.0`** (stable public contract).

### 2.4 CORS / configuration

Already env-configurable and never `*` by default — the audit finding is
"compliant". One hardening added: **`ApiConfig.__post_init__` rejects `*`** in
`cors_origins` from any source (default list or `BLUENEXUS_CORS_ORIGINS`) with a
clear `ValueError` at startup. Local development is unchanged — ports 5173/5174
on both `localhost` and `127.0.0.1` still work, still overridable wholesale by
the env var.

### 2.5 Health endpoint

Behaviour unchanged: `status` stays `"ok"` for process liveness (the frontend's
`useHealthCheck` reads only this); data readiness is
`data_layer.all_expected_present`. Now typed, and its docstring/description spell
out the liveness-vs-readiness split and that it never calls the frontend and
never scans values.

---

## 3. Confirmation — scientific values & data paths unchanged

* No change to `app/data/**` (ingestion, processing, BlueNexus, observations),
  `app/services/catalog.py`, or any `.bnx` / CSV file.
* `app/services/observations.py`: only the *exception type* raised for a
  not-found lookup changed — same 404, same detail payload, same success path.
* Slice `values` / `quality` / `units` / `latitude` / `longitude` / `bytes_read`
  and observation `levels` / `samples` are byte-identical (verified — §5).
* D15 validation suite: unchanged and green.

---

## 4. Files changed (backend only)

| File | Change |
|---|---|
| `app/api/errors.py` | + `UnknownArgoPlatformError`, `UnknownGliderDeploymentError` (both 404) |
| `app/services/observations.py` | raise the two new errors for not-found Argo / glider lookups |
| `app/api/config.py` | `__post_init__` rejects `*` CORS origin; docstring |
| `app/api/schemas.py` | + `HealthDataLayer`, `HealthDataLayerUnavailable`, `SliceShape`; typed `HealthResponse.data_layer` / `SliceResponse.shape`; docstring + field descriptions |
| `app/api/app.py` | production `title`/`summary`/`description`, `openapi_tags`, `version` 1.0.0; CORS comment |
| `app/api/routes/health.py` | `operation_id`, `summary`, `description` |
| `app/api/routes/datasets.py` | `operation_id`s, `description`s, `404`/`503` `responses`; dropped an unused import |
| `app/api/routes/slices.py` | `operation_id`, fuller `description`, query-param notes |
| `app/api/routes/observations.py` | `operation_id`s, `description`s (units), specific `404`/`422`/`503` `responses` |
| `tests/test_api.py` | + `D35ProductionContract` (7 tests) |
| `tests/test_observations.py` | unknown-platform slug → `unknown_argo_platform` |
| `tests/test_glider_observations.py` | unknown-deployment slug → `unknown_glider_deployment` |
| `docs/api-data-layer.md` | corrected stale CORS line; added observation endpoints to the table |

No frontend file changed. `main.py`, `requirements.txt` unchanged.

---

## 5. Verification

**Backend tests:** `python -m unittest discover -s tests` → **230 / 230 OK**
(223 prior + 7 new; 2 existing error-slug assertions updated). Includes D15.

**Frontend:** no file touched (`tsc` / frontend tests / build not required).
`oxlint` clean. Headless-Chrome smoke test on `localhost:5174` against the
updated backend: `[BlueNexus data API] connected → http://localhost:8000`,
temperature field + Argo/glider markers render, no console errors.

**Manual, against `uvicorn main:app`:**

| Request | Result |
|---|---|
| `GET /api/health` | `status: "ok"`, `data_layer.all_expected_present: true`, both `.bnx` listed |
| `GET /openapi.json` | `version 1.0.0`, 10 paths, 4 tags |
| temperature slice `t0 d0` | `units degC`, `shape {36,51}`, `bytes_read 16524` |
| salinity slice `t2 d9` | `units PSU`, `depth.value 200.0` |
| current_speed slice `t1` | `units m s-1`, `shape {421,601}` |
| `argo/2903951_10` | `levels[0] = {pressure 2.5, temperature 29.995, salinity 34.858, qc "1"}` |
| `gliders/sea057_20220707` | 2740 samples, `s0` verbatim (incl. `salinity: null`, `position_qc "4"`) |
| `argo/9999999_1` | 404 `unknown_argo_platform` |
| `gliders/nope_20200101` | 404 `unknown_glider_deployment` |
| `datasets/nope` | 404 `unknown_dataset` (unchanged) |
| slice `time_index=99` | 422 `invalid_index` |
| CORS preflight from `localhost:5173` | `Access-Control-Allow-Origin: http://localhost:5173` |
| request from `https://evil.example` | no `Access-Control-Allow-Origin` (blocked) |
| `BLUENEXUS_CORS_ORIGINS="*"` | `ValueError` at startup |
| any error body | no `Traceback`, no `File "..."`, no server path |

---

## 6. Known limitations

* **`data_layer` fallback shape.** If the catalog singleton is somehow not
  initialised, health still returns the minimal `{"available": false}` (a
  documented union member) rather than the full key set. This path is
  effectively unreachable in normal operation (lifespan always runs); enriching
  it would be a behaviour change to an error path, so it was left per the
  safety rule.
* **`error.type` slug change is a contract change** (though not a breaking one):
  the two observation 404s now report `unknown_argo_platform` /
  `unknown_glider_deployment` instead of `unknown_dataset`. The frontend does
  not branch on these slugs (only on `network_error`), so nothing breaks; a
  third-party client that hard-coded `unknown_dataset` for a missing platform
  would need to update.
* **No API versioning path** (`/v1`) was introduced — deliberately, per the
  brief ("do not create duplicate v1/v2 APIs just for appearance"). The
  `version` field in `/openapi.json` is the contract-version signal.
* **CORS default list** still names ports 5173/5174 only; other local ports need
  `BLUENEXUS_CORS_ORIGINS`. Not widened, to avoid loosening the default.
* **Auth / rate-limiting / request-id middleware** were not added — out of scope
  for Step 35 (read-only public scientific data) and not requested.
