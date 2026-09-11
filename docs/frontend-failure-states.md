# Step 48 — Frontend failure states & retry

**Type:** frontend robustness. A reusable data-failure UI wired into every
API-backed flow, with a scoped Retry. **No** scientific-data change, **no** API
contract change, **no** new dependency, **no** mock/demo fallback.
**Builds on (unchanged):** `docs/frontend-data-connection.md` (D11) ·
`docs/frontend-api-integration.md` (Step 36 — `ApiError` / `ApiErrorKind`).

---

## 1. The classifier — `src/components/feedback/dataFailure.ts`

`describeDataFailure(cause)` turns any failure a data flow can produce — an
`ApiError` from the Step 36 client, a provider's `{ stage, type, message }`
error object, or an unknown throw — into a small descriptor:

```ts
{ kind: 'offline' | 'server' | 'notFound' | 'malformed' | 'unknown',
  title: string, detail: string, canRetry: boolean }
```

| Cause | `kind` | `canRetry` |
|---|---|---|
| transport never reached the API (`ApiError.kind === 'network'` / `network_error`) | `offline` | yes |
| 5xx, or a slug ending `_unavailable` (`data_unavailable`, `netcdf_unavailable`, …) | `server` | yes |
| 404, or an `unknown_*` / `*_not_found` slug, or the "not in the loaded snapshot" case | `notFound` | **no** |
| a 2xx body that was not the contracted JSON (`ApiError.kind === 'malformed'`) | `malformed` | yes |
| a non-404 4xx (400 / 401 / 403 / 422) | `unknown` | **no** |
| anything else (an unexpected throw, `unexpected_error`) | `unknown` | yes |

The copy is written for a reader. **No stack trace, no exception message, and no
backend `detail` blob is ever shown** — those stay in the console where the
client already logs them.

## 2. The component — `src/components/feedback/DataErrorState.tsx`

A calm glass notice (icon · headline · one sentence · optional monospaced id ·
optional **Retry**), styled with the shared theme tokens and the amber "signal"
tone the rest of the UI already uses. The Retry button appears only when
`onRetry` is supplied **and** `failure.canRetry` is true, and is disabled while a
retry for that exact cause is outstanding (a failed retry produces a fresh error
object, which re-enables it; a successful retry unmounts the notice). No timer,
no auto-retry — nothing that can loop.

## 3. Retry plumbing (repeats one request, never a page reload)

| Flow | Retry mechanism | Scope of the repeat |
|---|---|---|
| Temperature grid | `useTemperatureData().reload()` | that provider's coordinates + the selected time's depth stack |
| Salinity grid | `useSalinityData().reload()` | same, salinity |
| Surface currents | `useCurrentData().reload()` | that provider's coordinates + the selected forecast time's U/V/speed planes |
| Argo float list | `useArgoObservations().reload()` | `GET /api/observations/argo` |
| Glider deployment list | `useGliderObservations().reload()` | `GET /api/observations/gliders` |
| Argo profile | `useArgoProfile(id).retry()` | `GET /api/observations/argo/{id}` for the same id |
| Glider deployment detail | `useGliderDeployment(id).retry()` | `GET /api/observations/gliders/{id}` for the same id |

Each provider gained a `reloadNonce` its load effect(s) depend on; `reload()`
clears the provider's caches and bumps the nonce. The profile hooks key their
request by `<id>#<nonce>`, so a retry re-runs the fetch for the **same** id and
the hook reports `loading` until it resolves. The UI's selected variable / depth
/ time / observation (all held in `VisualizationProvider` /
`ObservationProvider`) are untouched by a reload.

Retries are **user-triggered only** — no polling, no automatic retry anywhere.

## 4. Where the states surface

| Region | loading | success | empty | error |
|---|---|---|---|---|
| Viewport field (temperature / salinity / currents) | HUD "Loading…" tag | field renders + colourbar | `"No <field> data available for this region and time."` (grid loaded, every cell missing) | `DataErrorState` card under the field readout, with Retry; the 3D scene keeps rendering |
| Observation panel — selection | `ObservationEmptyState` "Loading…" | platform details | `ObservationEmptyState` "No observation selected" | `DataErrorState` ("Observation data unavailable" + id; Retry re-requests the list, hidden for the "not in snapshot" case) |
| Observation panel — depth profile | chart "Loading…" | SVG profile | chart "No valid pressure / … pairs" | `DataErrorState` compact ("Temperature/Salinity profile unavailable" + Retry) inside the chart frame |
| Backend reachability (global) | — | — | — | header `ConnectionStatus` badge — **unchanged** |

The model/NetCDF client methods (Step 41) are **not** consumed by any component
yet, so there is nothing to show a failure state for; when a later step renders
them, `DataErrorState` + `describeDataFailure` already handle `netcdf_*`.

## 5. Tests — `frontend/tests/data-failure.test.ts` (12, `node:test`)

network error · HTTP 404 → not-found (no retry) · 503 → server (retry) ·
`netcdf_unavailable` → retry · 422 → no retry · provider `http_502` object ·
malformed · unknown throw (no raw text leaked) · observation-detail 404 +
"not in snapshot" · **retry repeats only the same URL and a second attempt
succeeds** · **no mock fallback — every failing call throws, classified
retryable**.

Full frontend suite: **120 pass** (108 + 12). `tsc -b` clean, `oxlint` clean,
`vite build` succeeds. Browser-verified: offline build shows the field
`DataErrorState` with Retry over a still-rendering scene; online build
unchanged; observation panel + profile unaffected.

## 6. Files changed

New: `src/components/feedback/dataFailure.ts`,
`src/components/feedback/DataErrorState.tsx` (+ `.module.css`),
`tests/data-failure.test.ts`, this doc.

Modified: `state/{TemperatureDataProvider,SalinityDataProvider,CurrentDataProvider,ArgoObservationsProvider,GliderObservationsProvider}.tsx`
and `state/{temperatureDataState,salinityDataState,currentDataState,argoObservationsState,gliderObservationsState}.ts`
(add `reload` / profile `retry`); `hooks/useSelectedObservation.ts` (add
`errorType` to the error variant); `components/observation/{ObservationPanel,ProfileSection,TemperatureProfileChart,SalinityProfileChart}.tsx`
(use `DataErrorState`, thread retry); `components/observation/ObservationPanel.module.css`
(drop the old inline `.error*` rules); `components/visualization/ViewportOverlay.tsx`
(+ `.module.css`) (field error / empty notice); `package.json` (test script).
