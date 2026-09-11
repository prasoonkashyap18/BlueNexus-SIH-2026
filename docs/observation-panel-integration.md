# Step 31 — Real Observation Information Panel

Replaces the development-only demo observation panel with a real-data panel
driven by the Step 30 Argo / glider markers. Every value on screen is read
verbatim from the real `/api/observations/*` records (Steps 28–29). There is no
demo catalogue any more.

```
Argo / glider marker click (Step 30)
        │  selectObservation → selectPlatform(realId, type)
        ▼
state/ObservationProvider.tsx        { platformType, selectedPlatformId }
        │
        ▼
hooks/useSelectedObservation.ts      resolves the id against the real providers
        │   useArgoObservations()  →  findArgoPlatform(state, id)
        │   useGliderObservations() → findGliderPlatform(state, id)
        ▼
components/observation/ObservationPanel.tsx
        └─ ObservationDetails.tsx   ArgoObservationDetails / GliderObservationDetails
```

## What the panel shows

Resolved from the **summary** record already loaded by the list providers
(`GET /api/observations/argo`, `GET /api/observations/gliders`) plus that
response's `provenance` block. No per-selection fetch is needed — the summary
carries every field below.

| Argo | Source field |
|---|---|
| Observation type | `PLATFORM_TYPE_BY_ID.argo` (`"Argo profiling float"`) |
| Platform ID | `platform_id` (verbatim) |
| Float number / type | `platform_number` / `platform_type` |
| Cycle number | `cycle_number` |
| Latitude / Longitude | `latitude` / `longitude` |
| Observation time | `time` (ISO-8601 UTC, reformatted `YYYY-MM-DD HH:MM UTC`) |
| Measured levels | `level_count` |
| Pressure range | `pressure_min`–`pressure_max` **dbar (native, no depth conversion)** |
| Source | `provenance.source_name` / `source_dataset_id` / `access_protocol` / `source_file_name` |

| Glider | Source field |
|---|---|
| Observation type | `PLATFORM_TYPE_BY_ID.glider` (`"Underwater glider"`) |
| Deployment ID | `platform_id` (verbatim) |
| Samples | `sample_count` |
| Observation start / end | `time_start` / `time_end` |
| Latitude / Longitude range | `latitude_min…max` / `longitude_min…max` |
| Pressure range | `pressure_min`–`pressure_max` **dbar (native)** |
| Source | `provenance.*` (as above) |

## Data rules honoured

* Pressure stays in **dbar** — no pressure→depth conversion in this step.
* A `null` field renders as `Not reported` — never `0`, never a guess.
* No interpolation, no synthetic values, no demo fallback. If a provider is
  loading → `Loading observation data…`; on error, or an id absent from the
  snapshot → an honest "Observation data unavailable" block naming the id.
* Real ids are stored and displayed exactly as the API served them.

## States

| Condition | Panel |
|---|---|
| Nothing selected | `No observation selected. Click an Argo float or glider track…` |
| Provider loading | compact `Loading observation data…` |
| Provider error / id not in snapshot | `Observation data unavailable` + message + id |
| Argo selected | `ArgoObservationDetails` |
| Glider selected | `GliderObservationDetails` |

**Clear** (panel header) returns to the empty state.

**Layer toggles (Step 30 preserved):** if the layer carrying the current
selection (`layers.argo` / `layers.gliders`) is switched off, the selection is
dropped and the panel returns to the empty state — the panel never describes a
platform whose marker is not on screen. Toggling the *other* family's layer does
not affect the selection.

## Removed (demo scaffolding this step replaces)

`data/demoObservations.ts`, `hooks/useSelectedPlatform.ts`, and the demo-only
panel parts: `PlatformSelector`, `PlatformTypeTabs`, `PlatformMetadata`,
`DepthProfileChart`, `ProfileVariableToggle` (+ their CSS). `observationState.ts`
lost its demo-profile types (`ObservationPlatform`, `ProfileSample`,
`ProfileVariable`, …) and the `profileVariable` slice.

## Not done in Step 31 (later steps)

* No depth-profile chart wired to the real `levels` / `samples`.
* No variable switching, no model-vs-observation comparison.
* No pressure→depth conversion.
* No change to the 3D visualization or the dashboard layout.
* `useArgoProfile(id)` / `useGliderDeployment(id)` (per-profile fetch) are left in
  place as the seam for a future depth-profile view.

## Tests

`tsc -b`, `oxlint`, `npm test` (66), backend `pytest` (223) all green — the
panel is presentation over existing typed provider state, and the Step 30
`observation-markers.test.ts` still passes unchanged. Browser-verified over CDP:
real Argo (`5907179_3`) and glider (`sea057_20220707`) selection from a marker
click, Clear, and both layer toggles.
