# Step 36 — Frontend API Integration (boundary hardening)

**Type:** frontend transport-layer audit + small additive strengthening of the
API boundary. **No** UI change, **no** scientific-code change, **no** backend
change, **no** new dependency, **no** duplicate request.
**Builds on (unchanged):** `docs/frontend-data-connection.md` (D11) ·
`docs/production-data-api.md` (Step 35).

---

## 1. Audit — the boundary was already centralized

A full sweep of `frontend/src` for `fetch(`, `XMLHttpRequest`, `axios`,
`http://localhost:8000`, `127.0.0.1`, and `"/api/..."` strings:

| Concern | Finding |
|---|---|
| `fetch()` calls | **0** outside `src/api/client.ts` (the client's own `doFetch`). Other hits are the word "fetch" in prose comments. |
| `XMLHttpRequest` / `axios` | none — not imported, not in `package.json`. |
| `/api/...` URL construction | **only** in `src/api/client.ts` (10 endpoint functions). Elsewhere it appears only in doc comments. |
| `http://localhost:8000` | **only** in `src/api/config.ts` as `DEVELOPMENT_DEFAULT` (documented, intentional). |
| Providers / hooks | every one imports `dataApi` + `ApiError` + `isAbortError` from `src/api/client` — `TemperatureDataProvider`, `SalinityDataProvider`, `CurrentDataProvider`, `ArgoObservationsProvider`, `GliderObservationsProvider`, `useArgoProfile`, `useGliderDeployment`, `useDataApiConnection`, `useHealthCheck`. |
| Types | `src/api/types.ts` — explicit interfaces, no `any`, nullable scientific values preserved. |
| Error handling | `ApiError` already carried `status` / `type` / `detail` / `url` and distinguished network vs HTTP vs unparseable by `type` string. |
| `VITE_API_BASE_URL` | resolved once in `config.ts`; `.env.example` documents it. |

**Conclusion:** the single-boundary requirement was already met. No direct
request needed to be moved. This step only made the error contract *explicit*
and tightened the types against the Step 35 backend.

## 2. Changes made (all additive, transport only)

### `src/api/client.ts`
* **`ApiErrorKind` = `'network' | 'http' | 'malformed'`** — a new discriminant
  on `ApiError`, set at each throw site:
  * transport threw → `kind: 'network'`, `status: null` (`type` still
    `'network_error'`)
  * non-2xx response → `kind: 'http'`, `status` set, backend
    `{type,message,detail}` preserved when the envelope is present
  * 2xx body that is not the expected JSON → `kind: 'malformed'`
    (`type: 'invalid_response'`)
  `status` / `type` / `detail` / `url` are unchanged, so every existing consumer
  (`ApiError.is(e)` + read `.type` / `.message` / `.status`) keeps working.
* **`isErrorEnvelope(body)`** — a small type guard. A non-2xx body is now only
  read as `{error:{type,message,detail}}` when it *actually* has that shape; a
  proxy HTML page or empty body falls through to a clean `http_<status>` error
  instead of a misleading cast.

### `src/api/types.ts`
* **`BackendErrorSlug`** — documents the `error.type` values the Step 35 backend
  emits, including the new `unknown_argo_platform` / `unknown_glider_deployment`
  (Step 35 split these out of the generic `unknown_dataset`).
* **`ClientErrorSlug`** (`network_error` | `invalid_response`) and
  **`ApiErrorType = BackendErrorSlug | ClientErrorSlug | (string & {})`** — the
  union is deliberately open: a future backend slug stays assignable and the
  frontend never branches scientific behaviour on the slug.
* `ApiErrorEnvelope.error.type` and `ApiError.type` are now `ApiErrorType`
  instead of bare `string`.

### `src/api/index.ts`
* re-exports `ApiErrorKind`.

**Nothing else changed.** No provider, no chart, no scene, no state module, no
`config.ts` behaviour, no `package.json`.

## 3. Direct HTTP calls removed / moved

**None.** There were no direct backend calls outside `src/api/client.ts` before
this step. If one is ever added, it belongs in the client.

## 4. API-client architecture (after)

```
components / hooks / providers
        │  (import { dataApi, ApiError, isAbortError })
        ▼
src/api/client.ts   createDataApiClient({ baseUrl?, fetch? }) → dataApi
        │  request<T>(path, signal):
        │    - GET, Accept: application/json
        │    - transport throw            → ApiError{kind:'network', status:null}
        │    - !response.ok               → ApiError{kind:'http',  status, type/detail from envelope}
        │    - 2xx, unparseable body      → ApiError{kind:'malformed', type:'invalid_response'}
        │    - AbortError                 → rethrown as-is (never an ApiError)
        ▼
src/api/config.ts   API_BASE_URL  ←  VITE_API_BASE_URL  ||  http://localhost:8000
        ▼
Step 35 FastAPI  (/api/health, /api/datasets…, /api/observations/argo|gliders…)
```

Endpoint functions (unchanged, one per backend resource): `getHealth`,
`getDatasets`, `getDataset`, `getParameters`, `getCoordinates`,
`getParameterSlice`, `getArgoPlatforms`, `getArgoPlatform`, `getGliderPlatforms`,
`getGliderPlatform`.

## 5. TypeScript API types improved

* `error.type` is now the documented `ApiErrorType` union (was `string`),
  covering the Step 35 slugs; still open-ended.
* `SliceResponse.shape` (`{latitude,longitude}`), `HealthResponse.data_layer`
  (`HealthDataLayer | {available:false}`) were already accurate against the
  Step 35 models — confirmed, left as-is.
* Nullable scientific values, units, ISO timestamps, coordinate arrays, dataset
  / parameter / observation ids, and the error envelope are all preserved. No
  value is typed as a string-for-convenience. No `any` introduced.

## 6. Error-handling behaviour

| Situation | `kind` | `status` | `type` | UI sees |
|---|---|---|---|---|
| backend unreachable / CORS / offline | `network` | `null` | `network_error` | "Backend unreachable" — never data |
| unknown dataset / parameter | `http` | 404 | `unknown_dataset` / `unknown_parameter` | error text, no chart values |
| parameter not in dataset | `http` | 404 | `parameter_not_in_dataset` | error text |
| invalid slice index | `http` | 422 | `invalid_index` / `malformed_request` | error text |
| unknown Argo platform | `http` | 404 | `unknown_argo_platform` | panel error state |
| unknown glider deployment | `http` | 404 | `unknown_glider_deployment` | panel error state |
| 2xx non-JSON (proxy page) | `malformed` | 200 | `invalid_response` | honest failure, no fabricated data |
| 5xx without envelope | `http` | 5xx | `http_<status>` | error text |

Raw stack traces / server internals are never surfaced (the backend never sends
them; the client only reads `type` / `message` / `detail`).

## 7. `VITE_API_BASE_URL` remains configurable

Unchanged. `config.ts` resolves, in order: `import.meta.env.VITE_API_BASE_URL`
→ `process.env.VITE_API_BASE_URL` (Node test runner) → `http://localhost:8000`.
Dev default preserved; production sets `VITE_API_BASE_URL` at build time; no
production URL is hard-coded; `VITE_`-only so nothing secret is bundled. Backend
CORS untouched.

## 8. No duplicate requests introduced

The client was not re-wired — only `ApiError` gained a field and the types
gained a union. Every provider still makes exactly the requests it made before
(one Argo/glider list per mount; one profile request per selected observation
via `useArgoProfile` / `useGliderDeployment`). No retry, no poll, no cache added.

## 9. Tests / checks

* `npm test` → **97 pass / 0 fail** (`tests/api.test.ts` 16 → 23: + Argo list &
  profile, glider list & deployment, unknown-platform 404 slugs, `ApiError.kind`
  network/http classification, `malformed` on non-JSON 2xx, clean `http_<status>`
  on an envelope-less 5xx).
* `tsc -b` clean · `oxlint` clean · `npm run build` succeeds.

## 10. Browser verification (headless Chrome + CDP, backend `:8000` + vite `:5174`)

A. "Online" shown, `[BlueNexus data API] connected → http://localhost:8000`.
B–D. Temperature field renders; salinity / currents providers load (no error
state). E–F. Argo + glider markers render in the scene. G–H. Select Argo
`3902669_4` → Temperature profile shows. I–J. Switch to Salinity → salinity
profile shows, temperature chart unmounts. K–L. Select glider `sea057_20220707`
→ profile + switching work. M. Clear → panel returns to the empty state, 0
charts mounted. N. **No new console errors / warnings** in any step.

## 11. Real-data integrity

Frontend chart readout vs. the raw backend response:

| | frontend shows | `GET /api/observations/...` | match |
|---|---|---|---|
| Argo `3902669_4` shallow temp | `27.40 °C` @ 0.1 dbar | `27.404` @ `0.1` | ✅ (2-dp display) |
| Argo `3902669_4` shallow salinity | `36.44 PSU` @ 0.1 dbar | `36.439` @ `0.1` | ✅ |
| Glider `sea057_20220707` shallow temp | `42.59 °C` | `42.5903` | ✅ |
| Glider `sea057_20220707` shallow salinity | `36.82 PSU` | `36.822258` | ✅ |

The only transform between wire and screen is display rounding to 2 decimals;
the value's meaning and units are unchanged. Missing salinity stays `null`
(never plotted as 0).

## 12. Known limitations

* **`ApiErrorKind` is not consumed yet.** `useHealthCheck` still branches on
  `error.type !== 'network_error'` (works unchanged). Migrating consumers to
  `error.kind` is a cosmetic follow-up, deliberately out of scope here.
* **No runtime schema validation.** Per the brief, no validation dependency was
  added. The client checks HTTP status and JSON-parseability; field-level
  correctness rests on the TypeScript types and the Step 35 `response_model`
  validation on the backend. A structurally-wrong-but-parseable 2xx body would
  pass the client and surface as a downstream `TypeError` in the consumer, not a
  clean `malformed` `ApiError`.
* **`demoTimeDataset.ts`** provides UI time-axis *labels* (2026-07-10/-20/-30),
  not scientific data and not an HTTP path — left untouched, out of scope.
