# Step 33 — Real Vertical Salinity Profile

Adds a salinity-vs-pressure profile chart to the observation panel, a sibling of
the Step 32 temperature chart, driven by the **real measured levels / samples**
of the currently selected Argo float or glider deployment. No new API, dataset,
provider or dependency.

```
Argo / glider marker selected (Steps 30–31)
        │  selection.id  (real platform_id, verbatim)
        ▼
ObservationPanel.tsx
        │  useArgoProfile(id)        → GET /api/observations/argo/{id}      → detail.levels
        │  useGliderDeployment(id)   → GET /api/observations/gliders/{id}   → detail.samples
        ▼
components/observation/salinityProfile.ts   measuredSalinityPoints(rows)
        │  real finite (pressure, salinity) pairs, ordered by pressure
        ▼
components/observation/SalinityProfileChart.tsx   hand-drawn SVG
```

## Exact real data path

| | Endpoint | Hook | Field used |
|---|---|---|---|
| Argo | `GET /api/observations/argo/{platform_id}` | `useArgoProfile(id)` (`argoObservationsState.ts`) | `detail.levels[].salinity` (PSU) + `detail.levels[].pressure` (dbar) |
| Glider | `GET /api/observations/gliders/{platform_id}` | `useGliderDeployment(id)` (`gliderObservationsState.ts`) | `detail.samples[].salinity` (PSU) + `detail.samples[].pressure` (dbar) |

`ObservationPanel.tsx` passes `argoProfile.detail?.levels` / `gliderProfile.detail?.samples`
straight to `<SalinityProfileChart rows=… />` — the same rows already feeding the
temperature chart. The backend (`app/data/observations/*`, D15 pipeline) is untouched.

## How pressure & salinity are handled (`measuredSalinityPoints`)

* **Native units only** — pressure stays in **dbar**, salinity in **PSU**.
* **Pairing** — a level/sample is plotted only when **both** its `pressure` and
  `salinity` are non-null and finite. `null` / `NaN` / `Infinity` in either
  field drops that pair. Salinity is filtered independently of temperature, so a
  glider with more salinity gaps shows fewer valid points (e.g. `sea057_20220707`:
  2665 salinity vs 2740 temperature — the readout reads `2665 of 2740 valid`).
* **QC flags ignored** — a bad-flagged but present real value is kept (matches
  Steps 28–29 / Step 32).
* **No interpolation, in-fill, resampling, smoothing, decimation, or QC filtering.**
* **No pressure→depth conversion.** Vertical axis is pressure (dbar).
* **Ordering** — kept points sorted by ascending pressure so the polyline reads
  down the water column. Pure reordering of real points.

`measuredSalinityPoints()` is a pure function in its own module, covered by
`tests/salinity-profile.test.ts` (8 tests).

## The chart (`SalinityProfileChart.tsx`)

Hand-drawn SVG — **no charting dependency**. Structurally identical to
`TemperatureProfileChart.tsx`, its own CSS module mirrors `TemperatureProfileChart.module.css`.

* Horizontal axis: **Salinity (PSU)**, data extent + 8 % padding, 1/2/5×10ⁿ ticks.
* Vertical axis: **Pressure (dbar)**, anchored at 0 (surface), **increasing downward**.
* Heading **"Salinity Profile"** + a `N valid measurements` / `N of M valid` readout.
* One `<polyline>` through the real points; vertex dots when ≤ 140 points.
* States: `idle`/`loading` → "Loading the real measured profile…"; `error` → the
  request's error message; `success` with < 2 valid pairs → "No valid pressure /
  salinity pairs in this record." Never a demo fallback.

Rendered in `ObservationPanel.tsx` directly below `TemperatureProfileChart` for
both the Argo and glider `ready` branches. Both charts are visible together;
variable switching (Step 34) is **not** implemented.

## Verification

* `npm test` — 82 (+8 new), `tsc -b`, `oxlint`, `npm run build` — all green.
* Browser (headless Chrome + CDP, backend on offline sample CSVs):
  * Argo `3902669_4` — salinity profile renders; `36.44 PSU @ 0.1 dbar → 34.85 PSU @ 1977.1 dbar`,
    102 valid levels — matches `/api/observations/argo/3902669_4`. Temperature chart still correct.
  * Glider `sea057_20220707` — salinity profile renders; `36.82 PSU @ 0.2 dbar → 35.68 PSU @ 664.7 dbar`,
    `2665 of 2740 valid` — matches `/api/observations/gliders/sea057_20220707`.
  * Clear selection → both charts unmount, Step 31 empty state returns.
  * No new console errors in any state.

## Known limitations

* **Bad-sensor outliers shown as-is** — same rule as Step 32. A near-surface real
  salinity spike (bad reading, not null) is plotted and can stretch the axis.
* The pressure-ordered polyline for a glider connects points from different dive
  cycles; it is a profile envelope, not a single cast.
* **Glider duplicate request** — unchanged from Step 32 (the panel re-fetches the
  selected deployment); the salinity chart reuses the same `rows`, no extra fetch.
