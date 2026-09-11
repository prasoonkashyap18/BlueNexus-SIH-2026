# BlueNexus D12 — Real INCOIS Temperature in the Visualization

**Data Track step:** D12 — Replace mock temperature data with the real INCOIS temperature
**Type:** Frontend data-source replacement + tests + docs. **No** visualization redesign, **no**
salinity/currents/chlorophyll, **no** automatic updating, **no** backend change, **no** new
dependency.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** D1–D9 · `docs/api-data-layer.md` (D10) ·
`docs/frontend-data-connection.md` (D11)

---

## 1. Objective

The 3D ocean now draws **real INCOIS temperature** fetched through the D11 API client, not the
synthetic field in `src/data/temperatureDataset.ts`.

```
Existing BlueNexus visualization
        │
        ▼
useTemperatureData()  (state/temperatureDataState.ts + TemperatureDataProvider.tsx)
        │
        ▼
D11 API client (dataApi.getCoordinates / getParameters / getParameterSlice)
        │
        ▼
D10 FastAPI  →  D9 .bnx  →  INCOIS Argo 10-day analysis temperature
```

D12 is a data-source swap: the rendering architecture (the depth-tiled atlas texture, the
colour ramp, the shell/strata/slice shaders, the camera, every control) is intact.

---

## 2. Old mock data path (removed from the active render)

```
src/data/temperatureDataset.ts              synthetic closed-form 4-D field
  getTemperatureAt(time, depthM, lat, lon)   trilinear interpolation of the synthetic grid
        │
  scene/temperatureField.ts                 buildTemperatureFieldTexture(region, time)
        │   sampled the synthetic field into an 11-tile atlas
        ▼
  VolumeShell / DepthStrata / DepthSlice     temperatureFieldColor(vPlan, depthT)
```

`ViewportOverlay` and `TemperatureColorbar` read `getTemperatureDataset().metadata` for the
"Demo Dataset" tag and the min/max labels.

**As of D12, nothing in the active path imports `src/data/temperatureDataset.ts`.** The file is
kept (with a prominent "unused as of D12" header) so history and unrelated code stay intact; it
must never be wired back in as a fallback. `grep -r "data/temperatureDataset" src` returns only
the file itself.

---

## 3. New real-data path

```
state/temperatureDataState.ts     types + `useTemperatureData()` + the grid sampler
state/TemperatureDataProvider.tsx  fetches coordinates + parameters + the 24-slice depth stack
        │
scene/temperatureField.ts         buildTemperatureFieldTexture(region, temperatureData)
        │   bakes the real slices into a `tileCount`-tile atlas (one tile per real depth level)
        ▼
VolumeShell / DepthStrata / DepthSlice   temperatureFieldColor(vPlan, depthT) -> vec4(rgb, validity)
        │
ViewportOverlay   tag: "INCOIS analysis" / "Loading…" / "Data unavailable"
TemperatureColorbar   min/max from temperatureData.min/max
```

**D10 endpoints used** (all via the D11 client — no new `fetch`):

| Call | Endpoint |
| --- | --- |
| `dataApi.getCoordinates('incois_argo_10day_analysis')` | `GET /api/datasets/incois_argo_10day_analysis/coordinates` |
| `dataApi.getParameters('incois_argo_10day_analysis')` | `GET /api/datasets/incois_argo_10day_analysis/parameters` |
| `dataApi.getParameterSlice('incois_argo_10day_analysis', 'temperature', { timeIndex, depthIndex })` × 24 | `GET .../parameters/temperature/slice?time_index=T&depth_index=D` |

- **Dataset id:** `incois_argo_10day_analysis` (constant, never derived from user input)
- **Parameter id:** `temperature` — exactly. Never `sst`, never an alias. `surface_only` is
  `false`: this is a multi-depth analysis field, and the code / HUD never call it SST or
  real-time.

---

## 4. Coordinate dimensions (stored exactly — no regrid, no interpolation of the data)

From `GET /coordinates`, kept verbatim in `TemperatureDataState`:

| Axis | Count | Values |
| --- | --- | --- |
| time | 3 | `2026-07-10T00:00:00Z`, `2026-07-20T…`, `2026-07-30T…` |
| depth | 24 | 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000 m — **irregular** (7 distinct step sizes) |
| latitude | 36 | −9.5 … 25.5 °N, ascending |
| longitude | 51 | 50.5 … 100.5 °E, ascending |

The 36 × 51 grid is used as-is. D12 does **not** convert it to the current dataset's
421 × 601 grid or add latitude/longitude points.

---

## 5. Time mapping

The UI's `TIME_STEPS` is an ordered list of opaque identifiers (its own comment says so). D12
maps it to a real D10 time index by position, clamped:

```
timeIndex = clamp(TIME_STEPS.indexOf(selectedTime), 0, 2)
```

`selectedTime = '2026-01-01'` (the default, step 1/5) → `timeIndex 0` → **2026-07-10T00:00:00Z**,
read from `coordinates.time.iso_times[0]` — never hard-coded. Stepping the Time control to 2 or
3 loads `timeIndex` 1 / 2; steps 4–5 clamp to 2. Changing the time index refetches the 24-slice
stack **once** for that index (see §11). No animation, no playback, no polling.

---

## 6. Depth mapping

The depth **slider** stays exactly as it was — metres over `DEPTH_RANGE` (0–5000 m), default
100 m. It is **not** used to pick which slice to fetch: all 24 depth slices are loaded up front,
so the atlas carries the whole column and the slider only chooses emphasis (identical to the
demo behaviour).

Each atlas tile's depth fraction comes from the **real** depth-level metres via
`depthFraction(metres)` (`(metres − 0) / (5000 − 0)`), so tile spacing follows the irregular
INCOIS axis — never `index × constant`. `nearestIndex(depthMetres, selectedDepth)` (a helper,
tested) is available for the profile view and later steps; the 3D atlas does not need it because
it holds every level.

Real depths reach 2000 m; the column reaches 5000 m. Below 2000 m the shader clamps to the
deepest tile (2000 m) rather than inventing data — documented, minor, honest.

---

## 7. Latitude / longitude mapping (orientation — verified, §21)

```
D10 slice:   values[latIndex][lonIndex]         latIndex → latitude[36] (asc °N), lonIndex → longitude[51] (asc °E)
                    │
renderer:    the water shaders read only vPlan (x, z) and depthT — no lat/lon
                    │
bridge:      temperatureField.ts, per atlas texel:
               domainPointToGeo(frame, x, z)  →  { latitude, longitude }
               sampleSliceTemperature(slice, latitudes, longitudes, latitude, longitude)
```

`sampleSliceTemperature` resolves orientation **by coordinate value**: it brackets `latitude`
in `latitudes` and `longitude` in `longitudes`, so a swapped or reversed axis is impossible to
introduce there. The atlas builder's row loop maps texture bottom → `z = −halfZ` → north
(matching `domainPointToGeo`, where `latitude = centre − z/…`), so the field is right-side up
with no shader flip.

**Proof** (unit test 21 + `npm run test:integration:d12`): sampling exactly on a real grid node
`(latitudes[r], longitudes[c])` returns `values[r][c]` (or validity 0 if that node is missing),
for `[0][0]`, `[0][50]`, `[35][0]`, `[35][50]`, `[17][25]` — no swap, no reverse. A between-nodes
sample is the bilinear blend of the four surrounding cells.

---

## 8. Grid dimensions in the renderer

- Data state: 24 × (36 × 51) real slices, stored exactly.
- Atlas texture: `tileCount` (= 24) tiles of 48 × 48 texels — a *visualization* resampling of the
  36 × 51 grid onto the region window, the same class of transform the demo bridge did. The real
  36 × 51 values are never modified; they stay in `temperatureDataState`.

---

## 9. Missing-value handling

- Data state: `values[i][j]` is `null` where the API says `null`; `quality[i][j]` is `1` there,
  `0` elsewhere. Never coerced to `0` / `−1` / `−9999` / `−1e34`. A real `0.0` stays `0.0` with
  `quality 0` (unit test 10).
- `sampleSliceTemperature` drops missing corners from the weighted mean and returns
  `valid ∈ [0, 1]` (0 when every contributing cell is missing) — it never fabricates a value.
- Atlas texel: R = normalised °C (0 where invalid), **A = validity** (0 = missing). The shaders
  blend `mix(baseWater, fieldColor.rgb, uFieldMix * fieldColor.a)`, so a no-data region shows the
  base water colour, never an invented temperature. The GPU placeholder (0 in R) is thus never
  read as temperature — the scientific missingness lives in the A channel and, upstream, in the
  untouched `quality` arrays.

---

## 10. Quality flags & Celsius

- `quality` is stored and used unchanged as `(0 | 1)[][]`, aligned 1:1 with `values`
  (`values[i][j] === null` iff `quality[i][j] === 1` — asserted). No re-derivation, no new grades.
- Units: `degC`, from the API. The renderer's existing pipeline —
  `normalizeTemperature(°C, min, max)` → `TEMPERATURE_RAMP_STOPS` → colour — is unchanged. `min`
  and `max` are now the real data's own range across all 24 loaded slices (for `timeIndex 0`,
  ≈ 2.6 … 32.1 °C; the D6 full-dataset range across all 3 times is 2.540 … 32.586 °C). Physical
  °C values are never modified; normalisation is a visualization transform only. The colour
  palette (`TEMPERATURE_RAMP_STOPS`) is untouched — no D24 palette work here.

---

## 11. Loading / error behaviour & request control

`useTemperatureData()` exposes `phase: 'idle' | 'loading' | 'success' | 'error'` plus the grids,
coordinates, `timeIndex`, `timeIso`, `units`, `min`, `max`, and `error { stage, type, message }`.

| Phase | 3D scene | HUD tag | Colorbar |
| --- | --- | --- | --- |
| `loading` / `idle` | procedural water (`fieldMix` eases to 0) | "Loading…" | hidden |
| `success` | real temperature field (`fieldMix` eases to 1) | "INCOIS analysis" | shown, real min/max |
| `error` | procedural water — **scene stays up** | "Data unavailable" | hidden |

- **No mock fallback.** On any failure the client throws an `ApiError`, the provider goes to
  `phase: 'error'`, and the scene renders the procedural placeholder — never the synthetic field.
- **Request control:** the coordinates effect runs once (`[]` deps). The slice-stack effect
  runs on `[coordsReady, timeIndex]` (primitives) and a `loadedKeyRef` skips a time index that
  is already loaded — so React re-renders do not refetch, and dragging the depth slider fetches
  nothing. Every fetch cycle has an `AbortController`, aborted on unmount / time-index change.
- **Sanity checks (dev):** `null` ⟺ `quality 1` is asserted in the integration check; values are
  numeric-or-null; `units === 'degC'`. The D6 range (≈ 2.540–32.586 °C) is diagnostic context in
  the checks, never a filter — no value is rejected or altered.

---

## 12. Files

### Created
```
frontend/src/state/temperatureDataState.ts       types, `useTemperatureData`, `sampleSliceTemperature`, `nearestIndex`
frontend/src/state/TemperatureDataProvider.tsx    fetches coordinates + params + 24-slice stack
frontend/tests/temperature.test.ts               8 unit tests (node:test, mocked fetch)
frontend/tests/temperature.check.mjs             real end-to-end check against a running backend
docs/real-temperature-integration.md
```

### Modified
```
frontend/src/App.tsx                                          + <TemperatureDataProvider>
frontend/src/components/visualization/scene/temperatureField.ts   mock → real; GLSL now depth-count-agnostic (uniform array); vec4(rgb, validity)
frontend/src/components/visualization/scene/OceanScene.tsx         builds the atlas from `useTemperatureData()`; `temperatureField` is null until loaded
frontend/src/components/visualization/scene/OceanVolume.tsx        `temperatureField` prop is nullable
frontend/src/components/visualization/scene/VolumeShell.tsx        nullable field + `uTempTileCount` / `uTempDepthFractions` uniforms + validity blend
frontend/src/components/visualization/scene/DepthStrata.tsx        (same)
frontend/src/components/visualization/scene/DepthSlice.tsx         (same)
frontend/src/components/visualization/ViewportOverlay.tsx          tag reads real data phase, not the mock's `status`
frontend/src/components/visualization/TemperatureColorbar.tsx      min/max from real data
frontend/src/data/temperatureDataset.ts                           header note: unused as of D12 (file kept)
frontend/package.json                                             + `test:integration:d12`; `test` also runs temperature.test.ts
```

No `frontend/package.json` dependency was added. No backend file was touched.

---

## 13. Renderer integration detail

The one architectural change: the atlas depth-tile count is now the **real** depth-level count,
which the API reports at runtime and which differs from the demo's 11. Rather than unroll the
depth-blend `if`/`else if` chain from a build-time constant (the demo approach), the shader now
reads `uniform int uTempTileCount` and `uniform float uTempDepthFractions[32]` and blends in a
bounded loop (`for i < MAX_TEMP_TILES`, every array access by the loop index — valid GLSL
ES 1.00). The count and the fractions come straight from `GET /coordinates`; nothing is assumed.
`MAX_TEMP_TILES = 32` (24 needed). When no field is loaded, `uTempTileCount = 0` and
`temperatureFieldColor` returns validity 0, so the water is purely procedural.

Verified in a real headless browser (SwiftShader): the shaders compile with no `ERROR: 0:`,
the scene renders, and the temperature field shows the real slice.

---

## 14. Testing

```
cd frontend
npm test                        # 24 unit tests (16 D11 + 8 D12) — mocked fetch
npm run test:integration        # D11 end-to-end — backend on :8000
npm run test:integration:d12    # D12 end-to-end — backend on :8000
npm run build                   # tsc -b && vite build
npm run lint                    # oxlint
```

D12 unit coverage (`temperature.test.ts`): D11 client used with canonical ids + indices (1–5);
36 × 51 preserved, row = latitude (6–7); `null` stays `null` + quality 1 (8–9); real `0.0` stays
`0.0` + quality 0 (10); orientation — grid nodes reproduced exactly, no swap/reverse (21);
bilinear blend (21b); partial-validity over missing (21c); irregular depth-index mapping (22).

The 3D-render assertions (13, 15) are covered by the browser verification below plus the shader
compile check; the "no duplicate requests" behaviour (14) is the effect-dependency design in
§11.

---

## 15. Real browser verification (recorded)

Backend `uvicorn main:app --port 8000`, frontend `npm run dev` (`:5173`), headless Chrome load:

- **Network / probe:** the app fetches `/api/datasets/incois_argo_10day_analysis/coordinates`,
  `/parameters`, and 24× `/parameters/temperature/slice?time_index=0&depth_index=D` — all HTTP
  200. `test:integration:d12` reproduces the exact set: 36 × 51, `degC`, 1277 valid / 559 null
  at 5 m, `2026-07-10T00:00:00Z`, and confirms the 1000 m slice is a distinct colder field.
- **Renderer consumes it:** the HUD tag reads **"INCOIS analysis"**, the colorbar relabels to
  the real range (≈ 2.6 … 32.1 °C, vs the mock's 2.0 … 31.3), and the 3D volume is coloured by
  the baked real slices (`fieldMix = 1` requires `phase === 'success'` + slices loaded + a
  non-null atlas).
- **No shader errors, no uncaught exceptions.**
- **Failure path:** with the backend stopped, the tag reads **"Data unavailable"**, the header
  pill reads **"Offline"**, the colorbar is hidden, and the **3D ocean still renders** on its
  procedural placeholder — no mock temperature, no crash.
- **Existing UI intact:** camera / orbit controls, depth slice plane, geographic graticule,
  Reset View, control panel, timeline, observation panel, layout and styling all unchanged.

---

## 16. Backend regression

`python -m unittest discover -s backend/tests` → **118/118** (D7 29 + D8 30 + D9 24 + D10 35),
unchanged. D12 modified no backend file. Raw NetCDF SHA-256 hashes unchanged.

---

## 17. Limitations (honest scope notes)

- The atlas is a 48 × 48-per-tile visualization resampling of the 36 × 51 grid onto the region
  window (pre-existing architecture). The exact 36 × 51 values remain in `temperatureDataState`
  for any consumer that needs them.
- Real depths stop at 2000 m; below that the volume clamps to the 2000 m field.
- Time steps 4–5 of the UI clamp to real time index 2 (the dataset has 3).
- The 24-slice stack is fetched on load and on each time-index change (≤ 3 times ever). This is
  bounded and cached per index — not a "storm" — but it is not lazy per depth.

---

## 18. Scope boundary

> **D12 replaced the mock temperature field with the real INCOIS Argo 10-day analysis
> temperature, fetched through the D11 client from the D10 API. The existing 3D renderer now
> consumes real `temperature` slices (verified end-to-end and in a browser). Missing values stay
> `null` / `quality 1`, a real `0.0` stays `0.0`, units stay `degC`, coordinates are used
> exactly, and the latitude/longitude/depth mapping is verified. There is no mock fallback. No
> salinity, currents, current vectors, chlorophyll, charts, insights, animation, automatic
> updating, or database was added; no backend file changed; no dependency was added; the UI was
> not redesigned. D13–D15 were not started.**

**D12 complete. D13 is next** — connect salinity and surface currents to the visualization.
