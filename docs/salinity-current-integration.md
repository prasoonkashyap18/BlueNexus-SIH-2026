# D13 — Real Salinity & Ocean-Current Integration

Connects the BlueNexus frontend to two more verified INCOIS data sources through
the existing D10 backend / D11 API client, without disturbing the D12 real
temperature visualization.

```
                         BLUE NEXUS
                             │
              ┌──────────────┼───────────────┐
         Temperature      Salinity        Currents
          (D12)            (D13)            (D13)
              │              │               │
              ▼              ▼               ▼
          D10 API          D10 API         D10 API
              │              │               │
              ▼              ▼               ▼
     incois_argo_10day  incois_argo_10day  incois_io_hoofs
       /temperature       /salinity        /current_u,_v,_speed
       (T_ANALYZED)       (S_ANALYZED)     (U / V / CURRENT)
```

Nothing is regridded, interpolated onto a foreign grid, resampled, or unit-
converted. There is **no mock fallback** for any of the three fields.

---

## Salinity

| | |
|---|---|
| Dataset | `incois_argo_10day_analysis` (same as temperature) |
| Parameter | `salinity` (canonical id — never `salt`) |
| Source variable | `S_ANALYZED` |
| Units | `PSU` |
| Product type | `analysis` |
| `surface_only` | `false` |
| Dimensions | time 3 · depth 24 · latitude 36 · longitude 51 |
| API endpoint | `GET /api/datasets/incois_argo_10day_analysis/parameters/salinity/slice?time_index=T&depth_index=D` |

### Depth structure

The 24 depth levels are **irregular** — from 5 m at the surface to 2000 m, with
several distinct spacings (verified: 7 distinct step sizes). They come from
`GET .../coordinates` and are stored verbatim — no constant spacing is ever
assumed. The shared depth slider (0–5000 m) maps to the
nearest real index with `nearestIndex()`; there is no second slider, and the
irregular metres drive the 3D atlas's depth tiles directly (`depthFraction()`).

### Time structure

3 analysis times (`2026-07-10`, `-07-20`, `-07-30` UTC), read from the time
coordinate metadata — never hard-coded as scientific state. The existing global
time stepper's ordinal position is mapped onto a real time index and clamped
(`resolveTimeIndex`), exactly as D12 does. No new timeline, no auto-advance.

### Coordinate mapping

`values[latIndex][longitudeIndex]`. `latIndex` addresses the ascending °N
`latitude` array, `lonIndex` the ascending °E `longitude` array — resolved **by
coordinate value** (`sampleBilinear` in `state/gridSampling.ts`), so an axis
swap or reversal is impossible to introduce. Verified in
`tests/salinity.test.ts` (grid nodes reproduced exactly) and
`tests/salinity-current.check.mjs` against the live backend.

### Missing values & quality

`null` stays `null` (never `0` / `-1` / `-9999` / `-1e34`). `quality` is stored
as `(0|1)[][]` aligned 1:1 with `values` (`values[i][j] === null` iff
`quality[i][j] === 1`). The 3D atlas drops missing corners from its bilinear
blend and carries a validity in the texture's alpha; a fully-missing region
shows the base water colour, never a fabricated salinity.

### Frontend integration

```
state/salinityDataState.ts      types, useSalinityData(), sampleSliceSalinity()
state/SalinityDataProvider.tsx   coords + params once, then the 24-slice depth
                                 stack for the selected time index (loadedKeyRef
                                 dedupes; AbortController per cycle)
scene/temperatureField.ts        buildScalarFieldTexture() — the D12 analysis
                                 bridge, now parameter-agnostic (temperature OR
                                 salinity; identical 36×51 / 24-depth / atlas)
scene/OceanScene.tsx             builds both atlases; picks salinity's when
                                 "Salinity" is selected; fieldMix → 1
components/visualization/TemperatureColorbar.tsx   PSU range, Fresh↔Salty poles
components/visualization/ViewportOverlay.tsx       "INCOIS analysis" tag
```

Salinity renders through the **same** volumetric water shaders as temperature
(`VolumeShell` / `DepthStrata` / `DepthSlice`) — a normalised scalar field on
the shared cold→warm / low→high ramp. The base water hue also shifts to
salinity's own colour (`FIELD_HUE`, unchanged from Step 9).

---

## Currents

| | |
|---|---|
| Dataset | `incois_io_hoofs_surface_currents` (**separate** dataset) |
| Parameters | `current_u`, `current_v`, `current_speed` |
| Source variables | `U` (eastward), `V` (northward), `CURRENT` (authoritative magnitude) |
| Units | `m s-1` |
| Product type | `forecast` — INCOIS IO-HOOFS operational model forecast |
| `surface_only` | `true` |
| Dimensions | time 4 · depth 1 (`0 m`) · latitude 421 · longitude 601 |
| Grid | ≈ 0.0833° (≈ 8× finer than the analysis grid) |
| API endpoints | `GET /api/datasets/incois_io_hoofs_surface_currents/parameters/{current_u\|current_v\|current_speed}/slice?time_index=T&depth_index=0` |

### U / V / CURRENT meaning

* `current_u` — **eastward** component (`vector_role: eastward`).
* `current_v` — **northward** component (`vector_role: northward`).
* `current_speed` — the **authoritative** current magnitude (`authoritative:
  true`). D9 established `CURRENT ≈ sqrt(U² + V²)` to floating-point precision.

The frontend **never recomputes** `current_speed`. `nearestCurrentVector()`
returns the API's stored `speed` verbatim; `U`/`V` are used **only** for
direction, via `currentHeadingRadians(u, v) = atan2(v, u)` (a pure geometry
helper — the components are never scaled or recombined into a magnitude).
`tests/current.test.ts` proves this with a fixture where `speed = 99` while
`sqrt(u²+v²) = 5`.

### Forecast nature

Labelled **"INCOIS IO-HOOFS forecast"** in the HUD — never "real-time
observation" or "live observed current". It is an operational model forecast.

### Surface-only

Depth axis has exactly one level, `0 m`. Every arrow is drawn on the sea-surface
plane. Dragging the depth slider **does not invent** deeper currents:

* the arrows stay at the surface (`SURFACE_Y`);
* below the surface threshold (`isSurfaceDepth`, 10 m) they fade to 40 % opacity
  as a cue, and the HUD adds *"Surface currents shown at 0 m"*;
* the HUD's depth line always reads *"· surface only"* while Current is selected.

This is option 1 from the brief (least UI disruption, explicit labelling). No
subsurface current is ever fabricated.

### Time structure

**4 forecast times** (`2026-09-05T01:30Z`, `-09-06T07:30Z`, `-09-07T13:30Z`,
`-09-08T19:30Z`) — distinct from temperature/salinity's 3 analysis times. Each
dataset uses its own real time coordinate. The global time stepper's ordinal
position is mapped and clamped **per dataset** (`resolveTimeIndex` with that
dataset's own count): step 4/5 → current time index 3, analysis time index 2.
This is the minimum mapping for D13 — the temporal UI is not redesigned and
there is no auto-advance.

### Coordinate grid — kept separate

The 421 × 601 current grid is **never** merged with, or copied onto, the 36 × 51
analysis grid (or vice versa). `CurrentField.tsx` does its geographic conversion
independently: each arrow's world `(x, z)` → `(lat, lon)` via the pure,
dataset-independent `geoFrame` / `domainPointToGeo`, then `nearestCurrentVector`
reads the **nearest real current cell** — `nearestIndex()` on the current
dataset's own 421 / 601 coordinate arrays. No interpolation, no regridding, no
resampling. Points outside the real current coverage window get no arrow (never
extrapolated).

Orientation (`lat → lat`, `lon → lon`, no swap/reverse) is verified
independently for the current grid in `tests/current.test.ts` and against the
live backend in `tests/salinity-current.check.mjs` (§26 — a known
coordinate/value pair is checked for *each* data family).

### Missing vectors

A vector is drawn **only** where `U`, `V` **and** the authoritative `speed` are
all present at that cell. Missing cells (≈ 52 k of 253 k at the surface — land /
outside model domain) are skipped entirely — never a fabricated `(0, 0)` vector.
`quality` planes for all three parameters are stored aligned 1:1 with their
values.

### Frontend integration

```
state/currentDataState.ts      types, useCurrentData(), nearestCurrentVector(),
                               currentHeadingRadians()
state/CurrentDataProvider.tsx  coords + params once, then the 3 surface planes
                               (u, v, speed) for the selected forecast time —
                               one Promise.all, loadedKeyRef dedupes, one
                               AbortController per cycle. The depth slider never
                               triggers a fetch.
scene/CurrentField.tsx         instanced flat-arrow glyphs on the surface plane;
                               heading from U/V, length + colour from CURRENT
                               (shared speed ramp). 26×26 sample lattice,
                               rebuilt only on grid / region / range change —
                               never per frame or per React render.
scene/OceanScene.tsx           mounts <CurrentField> as a sibling of the water
                               volume; visible only while "Current" is selected
components/visualization/TemperatureColorbar.tsx   m/s range, Slow↔Fast poles
components/visualization/ViewportOverlay.tsx       "INCOIS IO-HOOFS forecast" tag
```

Currents are a **minimal viable** representation (per the brief): surface
vectors, not a streamline / particle-advection system.

### Performance

The current slice is 421 × 601 (≈ 2.3 MB per parameter). Only the **three**
slices for the **selected forecast time** are fetched, **once** per time index
(`loadedKeyRef` keyed by `t{index}`). React re-renders do not refetch; the depth
slider fetches nothing. Effect deps are primitives (`[coordsReady, timeIndex]`).

---

## Combined behaviour

### Variable selection

The Explore panel's variable selector now offers exactly **Temperature ·
Salinity · Current** (`SELECTABLE_OCEAN_VARIABLES`). "Current" is one layer;
the user never picks `current_u` / `current_v` manually. Chlorophyll is **not**
offered (no verified public machine-readable INCOIS series) — `chlorophyll`
remains in the `OceanVariable` type only so id lookups stay total.

### Shared vs separate coordinate systems

* Temperature + salinity **share** the `incois_argo_10day_analysis` grid (36×51),
  24 irregular depths and 3 analysis times → one bridge, `buildScalarFieldTexture`.
* Currents have their **own** grid (421×601), one surface depth and 4 forecast
  times → a completely separate path (`currentDataState` + `CurrentField`).
* Neither grid is ever forced onto the other. World↔geographic conversion is
  performed independently for each dataset.

### Depth behaviour

One shared physical depth slider (0–5000 m).

* Temperature / salinity: mapped to the nearest of the 24 real analysis depths.
* Currents: ignored for data selection (surface-only); arrows stay at 0 m and
  fade below the surface threshold, with a HUD note.

### Time behaviour

One shared ordinal time stepper. Its position is mapped and **clamped per
dataset**: analysis → 3 times, currents → 4 forecast times. Documented
difference, minimum mapping, no auto-advance.

### Error handling — no mock fallback

Each provider: `phase: 'idle' | 'loading' | 'success' | 'error'`. On any failure
the D11 client throws an `ApiError`, the provider goes to `phase: 'error'`, the
HUD tag reads **"Data unavailable"**, and the scene keeps rendering its
procedural view. There is **no** substitution — not a synthetic field, not NASA
/ NOAA / Copernicus / MOSDAC / any other provider.

### Explicitly NOT done in D13

* **No chlorophyll** — and the UI never implies it is available.
* **No automatic updating** (D14) — no polling, refresh, scheduled downloads,
  background jobs.
* **No final validation framework** (D15) — the D13 tests prove D13 works; they
  are not a monitoring / source-comparison / data-quality-reporting system.
* No Supabase / database. No second API client (the D11 `dataApi` is reused).
* No redesign of the control panel or the temporal UI.

---

## Tests

| File | What |
|---|---|
| `frontend/tests/salinity.test.ts` | 13 assertions — canonical ids, D11 client used, 36×51, 24 irregular depths, PSU, `null`/`0`/quality preserved, no mock fallback, lat/lon orientation |
| `frontend/tests/current.test.ts` | 13 assertions — dataset id, u/v/speed requested at depth 0, grid preserved, m/s, U=eastward / V=northward, CURRENT verbatim (fixture speed ≠ √(u²+v²)), missing → no fake zero vector, orientation, no mock fallback |
| `frontend/tests/salinity-current.check.mjs` | live end-to-end against a running backend — real salinity 36×51 PSU + 24-depth coords + null/quality; real currents 421×601 at 0 m, m/s, forecast, 4 times, U/V/CURRENT, authoritative speed verbatim, per-family coordinate/value pair |

Run: `npm test` (43 unit tests incl. D11/D12 regression) · `npm run
test:integration` (D11) · `npm run test:integration:d12` · `npm run
test:integration:d13` · backend `python -m unittest discover -s tests` (118).
