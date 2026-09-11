# BlueNexus D11 Frontend Data Connection

**Data Track step:** D11 — Connect the BlueNexus Frontend to the Real Data API
**Type:** Frontend API/data layer + dev connection probe + tests + docs. **No**
visualization change, **no** mock-data replacement, **no** new UI, **no** state
library, **no** dependency added.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** D1–D10 · `docs/api-data-layer.md` (D10)

---

## 1. Purpose

D11 wires the existing BlueNexus frontend to the D10 backend through a single,
typed API/data layer:

```
Existing BlueNexus UI
        │
        ▼
frontend/src/api/*   ── the only path to the backend
        │
        ▼
D10 FastAPI (http://localhost:8000)  →  D9 .bnx  →  INCOIS-derived data
```

At the end of D11 the frontend **can** check backend health, discover datasets,
read dataset metadata / parameters / coordinates, and pull and parse a real
temperature slice — but the 3D visualization still draws its existing mock
temperature field. **Replacing the mock is D12.**

---

## 2. Frontend architecture (what was already there)

| Aspect | Finding |
| --- | --- |
| Framework | React 19 + Vite 8 + TypeScript 6 (`tsconfig.app.json`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) |
| 3D | `@react-three/fiber` + `@react-three/drei` + `three` |
| Package manager | npm (`package-lock.json`) |
| Entry | `src/main.tsx` → `src/App.tsx` → provider stack → `<AppShell />` |
| State | React Context, one provider per domain (`src/state/*Provider.tsx` + `*State.ts`). No Redux / Zustand / React Query. |
| Existing backend call | `src/hooks/useHealthCheck.ts` — polled `GET /api/health` once, **hard-coded** `http://localhost:8000` |
| Mock data | `src/data/temperatureDataset.ts` (synthetic 4-D field), `src/components/visualization/scene/temperatureField.ts` |
| HTTP client | none — native `fetch` |
| Tests | none |
| Env config | none (`.env*` did not exist) |

D11 preserved all of this. React/Vite were not migrated, no provider was
rewritten, no visualization file was touched, and the mock data files were left
exactly as they were.

---

## 3. Files created

```
frontend/src/api/
  config.ts                 API base URL resolution (env → default)
  types.ts                  TypeScript shapes for every D10 response
  client.ts                 createDataApiClient() + `dataApi` + ApiError + KNOWN_DATASET_IDS
  useDataApiConnection.ts    hook: runs health→datasets→params→coordinates→slice, exposes idle/loading/success/error
  DataApiConnectionProbe.tsx  renders null; runs the hook + logs a summary (dev only)
  index.ts                  barrel re-export
frontend/tests/
  api.test.ts               16 unit tests (Node's built-in `node:test`, mocked fetch)
  integration.check.mjs      real end-to-end check against a running backend
frontend/.env.example        documents VITE_API_BASE_URL
docs/frontend-data-connection.md
```

## 4. Files modified

| File | Change |
| --- | --- |
| `frontend/src/hooks/useHealthCheck.ts` | Rewired to call `dataApi.getHealth()` / `src/api/config.ts` instead of a hard-coded URL. **Observable behaviour unchanged** — same `loading → online / offline` states, same `status === 'ok'` check, same detail strings; now also uses `AbortController` for cleanup. |
| `frontend/src/App.tsx` | +7 lines: mounts `<DataApiConnectionProbe />` when `import.meta.env.DEV`. Renders nothing; does not wrap or alter `<AppShell />`. |
| `frontend/package.json` | +2 scripts: `test` (`node --test tests/api.test.ts`) and `test:integration` (`node tests/integration.check.mjs`). No dependency added. |

---

## 5. API base URL configuration

`src/api/config.ts` resolves the base URL once:

1. `import.meta.env.VITE_API_BASE_URL` (Vite) — or `process.env.VITE_API_BASE_URL` under the Node test runner,
2. `http://localhost:8000` (the D10 development default).

Trailing slashes are stripped. Nothing else in the app hard-codes the URL —
`useHealthCheck` and every future consumer import `API_BASE_URL` or use
`src/api/client.ts`.

### Environment variable

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Only `VITE_`-prefixed vars reach the client bundle. **Not a secret** — it is inlined into the shipped JS; never put credentials in `VITE_*`. |

Set it via `frontend/.env.local` (git-ignored): `cp .env.example .env.local`.

---

## 6. API functions

`src/api/client.ts` → `dataApi` (bound to `API_BASE_URL`), or
`createDataApiClient({ baseUrl?, fetch? })` for tests:

| Function | Endpoint |
| --- | --- |
| `getHealth(signal?)` | `GET /api/health` |
| `getDatasets(signal?)` | `GET /api/datasets` |
| `getDataset(datasetId, signal?)` | `GET /api/datasets/{id}` |
| `getParameters(datasetId, signal?)` | `GET /api/datasets/{id}/parameters` |
| `getCoordinates(datasetId, signal?)` | `GET /api/datasets/{id}/coordinates` |
| `getParameterSlice(datasetId, parameterId, { timeIndex?, depthIndex?, signal? })` | `GET /api/datasets/{id}/parameters/{pid}/slice?time_index=&depth_index=` |

All are `GET`, all accept an `AbortSignal`, all `encodeURIComponent` their path
segments.

---

## 7. TypeScript response types (`src/api/types.ts`)

Explicit interfaces for every response — no blanket `any`:
`HealthResponse`, `DatasetList` / `DatasetSummary`, `DatasetDetail`,
`ParameterList` / `ParameterInfo` / `ParameterContract`, `CoordinateList` /
`CoordinateAxis`, `SliceResponse` (with `SliceTimeSelection`,
`SliceParameterMetadata`, `Provenance`), `ApiErrorEnvelope`.

The load-bearing one:

```ts
interface SliceResponse {
  parameter: string
  units: string                       // "degC" | "PSU" | "m s-1"
  product_type: 'analysis' | 'forecast'
  missing_value: null
  time: { index: number; value: number | null; iso: string | null; units: string | null }
  depth: { index: number; value: number | null; units: string | null }
  shape: { latitude: number; longitude: number }
  latitude: number[]
  longitude: number[]
  values: Array<Array<number | null>>   // [lat][lon]; missing cell is `null`, NEVER a number
  quality: (0 | 1)[][]                  // [lat][lon]; 0 = VALID, 1 = MISSING
  parameter_metadata: SliceParameterMetadata
  provenance: Provenance
  bytes_read: number
}
```

Deeply nested D9-contract fragments the frontend does not yet index into
(`DatasetDetail.metadata`, `DatasetSummary.source`, …) are typed as
`Record<string, unknown>` rather than re-modelling the whole D9 schema.

---

## 8. Loading / error handling

Phases: **`idle` → `loading` → `success` | `error`**.

- `useHealthCheck` → `loading` / `online` / `offline` (unchanged contract; the
  header "Backend Online/Offline" pill reads this).
- `useDataApiConnection` → the full state machine with per-step results and, on
  failure, `error: { step, type, message, detail }` naming which of
  `health | datasets | parameters | coordinates | slice` failed and why.

Distinct failure cases surface distinctly: *Backend unreachable* (network),
*unknown_dataset* / *unknown_parameter* / *parameter_not_in_dataset* (404),
*invalid_index* / *malformed_request* (422), *data_unavailable* (503),
*unexpected_catalog* (backend didn't report the expected datasets). A backend
outage does not crash the app — the visualization keeps running on its mock
data and the probe logs the error.

---

## 9. Missing-value handling

The client passes D10's JSON straight through — `JSON.parse` keeps `null` as
`null` and `0` as `0`. Nothing in `src/api/*` coerces `null → 0`, and no
`-1` / `-9999` / `-1e34` substitution exists anywhere. `values` is typed
`Array<Array<number | null>>` so a consumer that tries to treat a cell as
always-numeric is a compile error. `useDataApiConnection` counts `null` cells
as missing and never as zero. Unit tests 12–14 and the integration check assert
`null` stays `null`, a real `0.0` stays `0.0` with `quality === 0`, and
`values[i][j] === null` iff `quality[i][j] === 1`.

---

## 10. Quality flags

`quality` is returned and stored unchanged as `(0 | 1)[][]` — `0 = VALID`,
`1 = MISSING`, matching `SliceResponse.quality_definition`. No re-derivation, no
extra grades.

---

## 11. Backend error parsing

`ApiError` (thrown for every failure) preserves the D10 envelope:

```ts
class ApiError extends Error {
  status: number | null   // HTTP status, or null for a transport failure
  type: string            // D10 error.type, e.g. "unknown_parameter"; "network_error" for transport
  detail: unknown          // D10 error.detail
  url: string
}
```

Given `{"error":{"type":"parameter_not_in_dataset","message":"...","detail":{"available_parameters":[...]}}}`
the client throws `ApiError` with `.type`, `.message` and `.detail` intact — it
never collapses to "Something went wrong".

---

## 12. No mock fallback

There is **no** `try real API / catch → mock` anywhere in `src/api/`. Every
client method throws on failure; `useDataApiConnection` moves to `phase: "error"`.
Unit test 15 asserts all six methods reject (never resolve with fabricated
data) when the backend returns 503. The *existing* mock visualization is still
present only because D12 has not happened — the new API path itself has no
fallback.

---

## 13. CORS

D10 already allows `http://localhost:5173` (the Vite dev origin). The client
makes ordinary CORS requests with `Accept: application/json` — no
`mode: "no-cors"` (which would make the response body unreadable). Verified in a
real headless browser: with the frontend on `:5173` the probe reports
`[BlueNexus data API] connected → http://localhost:8000`; on any other port
D10's CORS correctly blocks it and the probe reports a `network_error` (proving
the no-fallback behaviour). The backend CORS config was not weakened.

---

## 14. Abort / cancellation

Every client method takes an `AbortSignal`. `useHealthCheck` and
`useDataApiConnection` each create an `AbortController` in their effect and
abort it on unmount; an `AbortError` is recognised (`isAbortError`) and swallowed
rather than shown as a failure.

---

## 15. Local startup & verification

```bash
# Terminal 1 — backend (D10)
cd backend
./.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
#   check: curl http://localhost:8000/api/health

# Terminal 2 — frontend
cd frontend
npm run dev            # http://localhost:5173
```

Open `http://localhost:5173`. In the browser console (dev build) the probe
logs, on success:

```
[BlueNexus data API] connected → http://localhost:8000
  { health: "ok",
    datasets: ["incois_argo_10day_analysis", "incois_io_hoofs_surface_currents"],
    temperature: { units: "degC", surface_only: false, shape: [3,24,36,51] },
    coordinates: { time: {count:3,...}, depth: {count:24,...}, latitude: {count:36}, longitude: {count:51} },
    temperatureSlice: { rows: 36, columns: 51, validCount: 1277, missingCount: 559, timeIso: "2026-07-10T00:00:00Z", ... } }
```

The Network tab shows the five requests to `localhost:8000`:
`/api/health`, `/api/datasets`,
`/api/datasets/incois_argo_10day_analysis/parameters`,
`/api/datasets/incois_argo_10day_analysis/coordinates`,
`/api/datasets/incois_argo_10day_analysis/parameters/temperature/slice?time_index=0&depth_index=0`.

### Tests

```bash
cd frontend
npm test                 # 16 unit tests (mocked fetch)
npm run test:integration   # real end-to-end — backend must be running on :8000
```

---

## 16. Real integration verification (recorded result)

`npm run test:integration` against a live D10 backend on `:8000`:

```
D11 integration check → http://localhost:8000
  ✔ GET /api/health → status "ok" (service bluenexus-data-api)
  ✔ GET /api/datasets → 2: incois_argo_10day_analysis, incois_io_hoofs_surface_currents
  ✔ GET /api/datasets/incois_argo_10day_analysis/parameters → temperature: units degC, analysis, surface_only=false (not SST)
  ✔ GET /api/datasets/incois_argo_10day_analysis/coordinates → time 3, depth 24, lat 36, lon 51
  ✔ GET .../parameters/temperature/slice?time_index=0&depth_index=0 → 36 x 51, 1277 valid / 559 null, iso 2026-07-10T00:00:00Z, depth 5 m, bytes_read 16524
D11 integration check PASSED
```

And a real headless-browser load of the dev app confirmed the probe's
`connected` log, no shader errors, no CORS errors, and the 3D ocean rendering
unchanged (still tagged "DEMO DATASET").

---

## 17. What D11 deliberately does NOT implement

- ❌ replacing the mock temperature field in the visualization (D12)
- ❌ salinity / current / chlorophyll rendering, current vectors, new charts (D13)
- ❌ time animation, automatic refresh/polling, alerts, "insights" (D14)
- ❌ any change to the 3D algorithm, camera controls, depth slice, geographic
  context, Reset View, or existing controls
- ❌ a UI redesign or any permanent visible UI change (the dev probe renders
  `null`; the existing "Backend Online" pill is the connection indicator)
- ❌ a state-management library, an HTTP client library, or any other dependency
- ❌ a database / Supabase
- ❌ reading the raw NetCDF or the `.bnx` files from the frontend — it only
  calls the D10 HTTP API

---

## 18. Scope boundary

> **D11 added a typed frontend API/data layer (`src/api/*`) and a dev-only
> connection probe. The frontend now makes real HTTP requests to the D10
> backend and parses real D9-derived responses (verified end-to-end and in a
> browser). The 3D visualization, its mock temperature data, the UI, and all
> existing behaviour are unchanged. No dependency, database, or automatic
> updating was added. D12–D15 were not started. Chlorophyll was not added or
> substituted.**

**D11 complete. D12 is next** — replace the mock temperature field with the real
INCOIS temperature via `dataApi.getParameterSlice('incois_argo_10day_analysis', 'temperature', …)`.
