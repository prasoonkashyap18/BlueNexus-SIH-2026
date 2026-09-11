# Step 32 — Real Vertical Temperature Profile

Adds a compact temperature-vs-pressure profile chart to the Step 31 observation
panel, driven by the **real measured levels / samples** of the currently
selected Argo float or glider deployment.

```
Argo / glider marker selected (Steps 30–31)
        │  selection.id  (real platform_id, verbatim)
        ▼
ObservationPanel.tsx
        │  useArgoProfile(id)        → GET /api/observations/argo/{id}      → detail.levels
        │  useGliderDeployment(id)   → GET /api/observations/gliders/{id}   → detail.samples
        ▼
components/observation/temperatureProfile.ts   measuredProfilePoints(rows)
        │  real finite (pressure, temperature) pairs, ordered by pressure
        ▼
components/observation/TemperatureProfileChart.tsx   hand-drawn SVG
```

## Where the real data comes from

| | Endpoint | Hook | Field used |
|---|---|---|---|
| Argo | `GET /api/observations/argo/{platform_id}` | `useArgoProfile(id)` (`argoObservationsState.ts`, added in Step 28) | `detail.levels[]` — `{ pressure, temperature, … }` |
| Glider | `GET /api/observations/gliders/{platform_id}` | `useGliderDeployment(id)` (`gliderObservationsState.ts`, added in Step 29) | `detail.samples[]` — `{ pressure, temperature, … }` |

These are the existing per-profile endpoints/hooks — no new API, no new dataset,
no new provider. The Step 31 summary panel is unchanged; the chart is a sibling
below it. The backend (`app/data/observations/*`, D15 pipeline) is untouched.

## How pressure & temperature are handled

* **Native units only** — pressure stays in **dbar**, temperature in **°C**,
  exactly as the API returns them. `units` from the response confirms
  `pressure: decibar`, `temperature: degree_Celsius`.
* **Pairing** — a level/sample is plotted only when **both** its `pressure` and
  `temperature` are non-null and finite. Null/`NaN`/`Infinity` in either field
  drops that pair. Nothing else is filtered — **QC flags are ignored**, so a
  bad-flagged but present real value is kept (consistent with Steps 28–29, which
  carry QC through verbatim, and with Step 32's "do not smooth" rule).
* **No interpolation, no in-fill, no resampling, no smoothing, no decimation** —
  every kept point is exactly one measurement from the response.
* **No pressure→depth conversion.** The vertical axis is pressure (dbar). The
  chart never implies pressure equals depth.
* **Ordering** — the kept points are sorted by ascending pressure so the
  polyline reads down the water column. This is a pure reordering of real
  points (Argo levels already arrive in this order; a glider deployment is a
  multi-dive series, so ordering turns its time-series into a readable profile
  envelope). No value is added, removed or altered by it.

`measuredProfilePoints()` is a pure function in its own module, covered by
`tests/temperature-profile.test.ts` (8 tests).

## The chart

Hand-drawn SVG (`TemperatureProfileChart.tsx`) — **no charting dependency was
added**; none is installed and the previous demo profile chart was also
hand-drawn SVG.

* Horizontal axis: **Temperature (°C)**, data extent + 8 % padding, 1/2/5×10ⁿ ticks.
* Vertical axis: **Pressure (dbar)**, anchored at 0 (surface), **increasing downward**.
* Heading **"Temperature Profile"** + a `N valid measurements` readout
  (`N of M valid` when some pairs were dropped).
* One `<polyline>` through the real points; vertex dots when ≤ 140 points
  (Argo yes, a multi-thousand-sample glider deployment: line only, for weight).
* `viewBox`-scaled — responsive within the existing right dock; the panel body
  scrolls (existing `Panel` behaviour), the chart sitting below the metadata.
* Honest states: `phase` `idle`/`loading` → "Loading the real measured
  profile…"; `error` → the request's error message; `success` with < 2 valid
  pairs → "No valid pressure / temperature pairs in this record." Never a demo
  fallback.

## Selection behaviour

The chart re-derives from `useArgoProfile(selection.id)` /
`useGliderDeployment(selection.id)`, whose effects re-fetch when the id changes.
So it updates automatically on a different Argo marker, a different glider
marker, an Argo↔glider switch (the inactive hook gets `null` → idle, no
request), and on **Clear** (both get `null`; the `ready` branch unmounts and the
chart with it — the Step 31 "No observation selected" empty state returns).

## Not done in Step 32 (later steps)

Salinity profile · variable switching · profile comparison · model-vs-observation
comparison · profile editing · interpolation · depth conversion · new sources /
datasets. The 3D scene and the dashboard/observation-panel layout are unchanged.

## Known limitations

* **Glider duplicate request.** Step 30 `ObservationMarkers` already fetches every
  deployment's detail (for the 3D tracks) into component-local state; the panel
  additionally fetches the *selected* deployment via `useGliderDeployment`. The
  detail hooks are self-contained (not provider state), so there is nothing to
  reuse — one extra GET to a fast in-memory endpoint when a glider is selected.
  Argo has no duplication (`useArgoProfile` was previously unused).
* **Bad-sensor outliers are shown as-is.** e.g. `sea057_20220707` contains real
  near-surface temperatures up to ~44 °C (bad in-situ readings, not null); per
  the "exclude only null/missing" + "do not smooth" rules these are plotted,
  which stretches that chart's temperature axis. A QC-aware view is a later step.
* The pressure-ordered polyline for a glider connects points from different dive
  cycles; it is a profile envelope, not a single cast.

## Tests

`tsc -b`, `oxlint`, `npm test` (74 — +8 new), `npm run build`, backend `pytest`
(223) — all green. Browser-verified over CDP: Argo `5907179_3` / `3902669_4` /
`5907180_3` and glider `sea057_20220707` profiles match the API's
pressure/temperature values (shallowest & deepest pairs, valid counts); Argo↔Argo,
glider↔Argo and Clear all update the chart; no new console errors.
