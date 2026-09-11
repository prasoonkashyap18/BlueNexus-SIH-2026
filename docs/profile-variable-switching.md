# Step 34 — Profile Variable Switching

Replaces the Step 32–33 stacked "temperature + salinity" charts with a compact
switcher: the observation panel now shows **one** measured profile at a time —
**Temperature** or **Salinity** — for the selected real Argo float / glider
deployment.

```
ObservationPanel  (per selection.id)
  └─ <ProfileSection observationKey={selection.id} rows={detail.levels | detail.samples} …>
        useProfileVariable(observationKey)         → ['temperature' | 'salinity', setVariable]
        <ProfileVariableSwitcher value onChange />  → radio group: Temperature | Salinity
        variable === 'temperature'
          ? <TemperatureProfileChart …rows />       ← Step 32, unchanged
          : <SalinityProfileChart    …rows />       ← Step 33, unchanged
```

## Profile-variable state

* **Local UI state only.** `useProfileVariable(observationKey)`
  (`frontend/src/hooks/useProfileVariable.ts`) holds a `useState`; nothing global,
  nothing persisted. It does **not** touch `visualizationState.ts` / the 3D
  ocean-variable selector.
* **Allowed values:** `'temperature'`, `'salinity'` (`PROFILE_VARIABLES`).
  **Default:** `'temperature'` (`DEFAULT_PROFILE_VARIABLE`).
* **Reset on observation change.** The pure `resolveProfileVariableSelection(prev, key)`
  (`frontend/src/components/observation/profileVariable.ts`) returns `prev`
  unchanged while the key is the same, and a fresh `{ key, variable: 'temperature' }`
  the moment the key changes. The hook applies it with React's documented
  "adjust state during render" pattern (a no-op `setState` bail-out when the key
  is unchanged). So selecting a different Argo/glider — or clearing — always
  lands back on Temperature; a salinity view chosen for one platform never
  appears for the next.
* The pure module (`profileVariable.ts`) has no React import and is unit-tested
  directly.

## How switching works — Argo and glider, one control

`ProfileSection` is rendered in both the Argo and the glider `ready` branch of
`ObservationPanel`, with the same props shape. The only per-family difference is
the source of `rows` (`argoProfile.detail?.levels` vs
`gliderProfile.detail?.samples`) and `measuredCount`
(`level_count` vs `sample_count`) — exactly as before Step 34. The switcher,
the state hook and the conditional render are family-agnostic.

`variable === 'temperature' ? <TemperatureProfileChart/> : <SalinityProfileChart/>`
is a ternary — the two charts are **mutually exclusive**; both are never mounted.

## No additional API requests on switch

`rows` is a prop, threaded down from the panel's single
`useArgoProfile(id)` / `useGliderDeployment(id)` call (unchanged). Toggling the
variable is a local `setState` that swaps which chart component renders over the
**same** `rows` array. Neither chart fetches anything.

Verified over CDP (Network domain): **0** `/api/observations/*` requests during
4 consecutive Temperature↔Salinity toggles.

## Loading / error / empty

Unchanged. Each chart keeps its own Step 32–33 states (`idle`/`loading` →
"Loading the real measured profile…", `error` → the request message, `< 2 valid
pairs` → "No valid pressure / <var> pairs in this record."). If salinity has no
valid pairs for a platform whose temperature does (or vice-versa), switching to
that variable shows that chart's empty state — never a fabricated value. On
**Clear**, the whole `ready` branch unmounts, so `ProfileSection` (switcher +
chart) is gone and the panel's "No observation selected" empty state returns.

## Tests

`frontend/tests/profile-variable.test.ts` (8, `node:test`) — default is
temperature; the two values are the only valid ones; toggling moves between
them and back; the switcher labels; same-key keeps the selection (same
reference); **changed key / cleared key resets to temperature**; re-selecting a
key after a reset starts on temperature. Added to the `test` script.

Rendering "exactly one chart" and the Clear teardown are covered by the browser
verification below (the chart components import CSS modules and cannot be loaded
under `node:test`; the repo has no jsdom / RTL).

## Validation

* `npm test` — 90 (+8), `tsc -b`, `oxlint`, `npm run build` — all green.
* Browser (headless Chrome + CDP, isolated backend:8001 + vite:5178 on sample CSVs):

  | step | Argo `3902669_4` | Glider `sea057_20220707` |
  |---|---|---|
  | default | Temperature radio checked, only "Temperature Profile" mounted | same |
  | click Salinity | temperature chart gone; only "Salinity Profile" (real `36.44` / `36.82` PSU) | same |
  | click Temperature | temperature chart returns; salinity gone | same |
  | toggle ×4 | 0 new API requests | — |
  | Clear | 0 charts, 0 radiogroups, "No observation selected" shown | — |

  No console errors in any state.

## Not done in Step 34 (later)

Additional profile variables (density, oxygen, …) — the switcher is deliberately
two-valued. Profile comparison, model-vs-observation overlay, variable-aware QC,
depth conversion. The 3D scene, the temperature/salinity/current fields, marker
logic, selection architecture, backend and ingestion are untouched.

## Known limitations

* On an observation change the variable resets to Temperature (by design — the
  cleanest existing architecture, and explicitly allowed by the step brief). A
  user who was viewing Salinity for float A sees Temperature for float B and
  must re-pick Salinity.
* Re-selecting the *same* platform after Clear also starts on Temperature
  (`ProfileSection` unmounts on Clear, so its state is fresh on remount).
