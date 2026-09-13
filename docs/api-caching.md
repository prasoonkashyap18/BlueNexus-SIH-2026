# Step 57 — CDN caching for immutable API responses

**Type:** read-only infrastructure hardening. No response body, schema,
scientific value, endpoint, environment variable, or frontend behaviour is
changed. This step only adds an HTTP response **header** to a set of
already-existing GET endpoints.

**Trigger:** Vercel reported the `bluenexus-sih-2026-api` project at 100% of
its Hobby "Fast Origin Transfer" (10 GB) allowance. Investigation found that
every API response — including the ~5 MB `current_u` / `current_v` /
`current_speed` slice responses fetched together on every page load — carried
no caching directive at all, so Vercel's edge network re-invoked the origin
Function and re-transferred the full response on every single hit, even
though the underlying data never changes between deployments.

---

## 1. What makes a response eligible for CDN caching here

All of this application's real data is loaded **once, at process startup**,
from files fixed for the life of a deployment:

- the D9 `.bnx` containers (`app/services/catalog.py`),
- the D4 raw CSV observation snapshots (`app/services/observations.py`),
- the one configured NetCDF file (`app/services/netcdf_service.py`).

There is no write path anywhere in this API: no database, no per-request file
mutation, no user session, no auth, no cookies. A GET response is eligible for
long-lived CDN caching when, and only when, **all** of the following hold:

1. It reads only the fixed, load-once-at-startup data above.
2. Its content is a pure function of the request URL (path segments + query
   string) — nothing else (no header, no cookie, no caller identity) affects
   it.
3. It is not a liveness/operational signal.

`GET /api/health` fails test 3 on purpose: its whole job is to answer "is
this process serving right now?", so it must never be answered from a stale
cache, even though its `data_layer` payload rarely changes.

Every error response (any non-`200`) is excluded regardless of route: a
transient `404` / `422` / `503` must be retried by the caller, never cached
and replayed to someone else.

## 2. Endpoints now marked cacheable

| Endpoint | Route file |
|---|---|
| `GET /api/datasets` | `routes/datasets.py` |
| `GET /api/datasets/{dataset_id}` | `routes/datasets.py` |
| `GET /api/datasets/{dataset_id}/parameters` | `routes/datasets.py` |
| `GET /api/datasets/{dataset_id}/coordinates` | `routes/datasets.py` |
| `GET /api/datasets/{dataset_id}/parameters/{parameter_id}/slice` | `routes/slices.py` — **the primary target**: this is the ~5 MB `current_u`/`current_v`/`current_speed` response |
| `GET /api/observations/argo` | `routes/observations.py` |
| `GET /api/observations/argo/{platform_id}` | `routes/observations.py` |
| `GET /api/observations/argo/{platform_id}/temperature-profile` | `routes/observations.py` |
| `GET /api/observations/gliders` | `routes/observations.py` |
| `GET /api/observations/gliders/{platform_id}` | `routes/observations.py` |
| `GET /api/netcdf/dataset` | `routes/netcdf.py` |
| `GET /api/netcdf/variables/{variable_name}` | `routes/netcdf.py` |
| `GET /api/netcdf/variables/{variable_name}/slice` | `routes/netcdf.py` — the other multi-MB response (GLORYS `thetao`) |
| `GET /api/model-observations/argo/{platform_id}/temperature` | `routes/model_observations.py` |
| `GET /api/model-observations/argo/{platform_id}/temperature-comparison` | `routes/model_observations.py` |
| `GET /api/sources` | `routes/sources.py` |

**Deliberately excluded:** `GET /api/health` (liveness, see above), and every
non-`200` response from any of the routes above.

## 3. The header, and why these exact directives

```
Cache-Control: public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400
```

- **`public`** — cacheable by shared/CDN caches (Vercel's edge network), not
  only the requesting browser.
- **`max-age=3600`** — the browser may reuse its own copy for up to 1 hour
  without even asking the CDN.
- **`s-maxage=2592000`** (30 days) — the CDN edge may serve its cached copy
  for up to 30 days **without invoking the origin Function at all**. This is
  the directive that directly removes Fast Origin Transfer: a request served
  from the edge cache never reaches the FastAPI function, so it is not
  billed as origin transfer.
- **`stale-while-revalidate=86400`** — if a CDN entry does expire, it may
  still serve the (still-correct) stale copy for up to one more day while
  revalidating in the background, instead of forcing a blocking origin hit
  the instant the TTL lapses.

The value is defined once, as `IMMUTABLE_CACHE_CONTROL` in
`backend/app/api/caching.py`, and applied verbatim everywhere it's used.

## 4. Distinct cache entries per parameter

Nothing extra was needed for this: every value the task calls out —
`dataset_id`, `parameter_id`, `variable_name`, `platform_id`, `time_index`,
`depth_index`, `latitude_index`, `longitude_index` — is already either a path
segment or a query-string parameter, and a CDN's cache key is the full
request URL. Two requests differing in any of these are, by construction,
different URLs and therefore different cache entries. No `Vary` header is
needed because nothing besides the URL affects any of these responses (no
auth, no cookies, no per-user state) — see `test_caching.py`'s
`DistinctRequestsAreDistinctURLs` for a direct check.

## 5. How it's implemented

- `backend/app/api/caching.py` — the allow-list (as compiled regexes matched
  against `request.url.path` only) and the `IMMUTABLE_CACHE_CONTROL` constant.
- `backend/app/api/app.py` — one `@app.middleware("http")` function,
  `add_immutable_cache_headers`, registered in `create_app`. It calls
  `call_next(request)` exactly as before, and — only when the method is
  `GET`, the status is `200`, and the path matches the allow-list — sets one
  response header. It never touches the response body, and every other
  request (every error, every other route, `/api/health`) passes through
  completely unmodified.

No route handler was changed. No response model, error slug, or scientific
value changed. No compression, downsampling, or decimation was added — those
remain explicitly out of scope for this step.

## 6. Known trade-off

Because the cache key is the URL and nothing signals a deploy boundary, a CDN
entry populated just before a future data update could theoretically outlive
that update by up to `s-maxage` (30 days) if the update ships without a cache
purge. Today nothing in this codebase ever changes a dataset's values without
a full redeploy of new files, so this is a non-issue in practice; if a future
step needs an instant-invalidation guarantee, the fix is a manual Vercel
cache purge (or a version token in the URL) at deploy time — not a change to
this header.

## 7. Tests

`backend/tests/test_caching.py` (real HTTP against uvicorn, same harness as
`test_api.py`):

- every allow-listed endpoint returns `200` with exactly
  `IMMUTABLE_CACHE_CONTROL`;
- `GET /api/health` never carries the header;
- every error case tried (`404 unknown_dataset`, `422 invalid_index`,
  `404 unknown_argo_platform`, `422 malformed_request`) never carries the
  header;
- repeated calls to every allow-listed endpoint return byte-identical bodies;
- different `time_index` / `parameter_id` / `platform_id` values produce
  different response bodies (proving distinct cache keys are actually
  necessary and actually honoured).

`backend/tests/_httpserver.py` gained one additive method,
`get_with_headers`, so tests can inspect response headers; every existing
`SRV.get(...)` call site is untouched.
