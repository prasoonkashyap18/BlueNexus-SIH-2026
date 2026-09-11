# Step 40 — Realistic Spatial Grid

Makes the 3D scene's geographic context legible as a **real latitude/longitude
ocean domain** by naming the existing graticule with real degree values.

## What changed

| File | Change |
| --- | --- |
| `frontend/src/components/visualization/scene/geography.ts` | + `GraticuleLabel` type, `graticuleLabels(frame)` (pure), `formatGridDegree`, `thinTo`; + `GEO.label*` tuning constants |
| `frontend/src/components/visualization/scene/GeoContext.tsx` | renders the labels as memoized sprites; opacity tracks the existing camera-distance / arrival fade; textures disposed on region change |
| `frontend/tests/geography.test.ts` | new — 6 unit tests for the label logic |
| `frontend/package.json` | `test` script runs the new file |

No other file changed. The scientific-data files (`temperatureField.ts`,
`CurrentField.tsx`, `observationMarkerLayout.ts`, `gridSampling.ts`, every state
provider, the API client) and the backend are **untouched**.

## Not a new grid — the existing graticule, named

A full lat/lon graticule already existed (`buildGraticule`, drawn by
`GeoContext`), tied to `geoFrame(activeRegion)`. Step 40 adds **coordinate
labels only**:

- A few real degree values (e.g. `76°E`, `78°E`, `12°N`, `14°N`) on the grid
  lines that bound the visible window.
- **Longitude labels** off the domain's **south edge** (+z); **latitude labels**
  off the **west edge** (−x) — the two edges the default camera faces, and the
  two the depth axis (east edge) and the `N` compass (north edge) leave free.
- At most `GEO.maxLabelsPerAxis` (5) per family — `thinTo` drops whole lines
  (never shifts them) when the graticule is finer. Typically 3–4 per axis.
- Subtle: `GEO.labelOpacity` 0.66, dim blue `#a4c8dc`, sprite text ~0.38 world
  units, no plate/fill/glow, `depthWrite={false}`. Opacity rides the same
  camera-distance presence and region-arrival fade as the graticule, so the
  labels come up when the reader pulls back to ask *where am I* and recede
  when they close in on the water.

## How geographic coordinates map to the grid

The values come straight from `geoFrame(region)`:

```
unitsPerDegree = DOMAIN.width / region.span          // 13 / 8 for the Arabian Sea
spacing        = niceSpacing(targetSpacing / unitsPerDegree)   // → 2° here
```

`graticuleLabels` walks `gridValues(centre, reach, spacing, …)` — the same
multiples-of-spacing helper `buildGraticule` uses — so every label is an exact
grid value (`12°N`, not `12.94°N`). Each label's world position is computed with
**`projectGeo`**, the identical transform used by:

- the graticule lines,
- the temperature / salinity scalar-field texture sampling (`temperatureField.ts`
  via `domainPointToGeo`, the affine inverse of the same frame),
- the surface-current arrows (`CurrentField.tsx`),
- the Argo markers and glider trajectories (`observationMarkerLayout.ts`).

So there is **one coordinate system**: `+x` = east, `−z` = north, `y` = depth.
A label lands on its own grid line, and the ocean volume, both scalar fields,
the current vectors and every observation marker stay geographically aligned
with it because they are all placed by the same `geoFrame` / `projectGeo`.

`formatGridDegree`: `74` → `"74°E"`, `-18` → `"18°S"`, `0.5` → `"0.5°N"` — real
value, hemisphere suffix, trailing zeros trimmed, no fabricated precision.

## Reuse of existing utilities

`geoFrame`, `projectGeo`, `gridValues` and the `GEO` constants are reused
verbatim; `geoFrame` / `projectGeo` / `domainPointToGeo` were **not modified**
(changing them would change field sampling and marker placement). Label
rendering reuses `sceneLabels.ts` `labelTexture` + the `<sprite>` pattern
already used for the depth axis and the `N` compass. No map library, no Cesium,
no Leaflet, no second projection.

## Tests

- **`frontend/tests/geography.test.ts`** (6, `node:test`): labels are exact
  multiples of the frame spacing (nothing fabricated); hemisphere formatting
  (`°E`/`°N`, and `°S` for a southern-hemisphere region); orientation
  (latitude → west of the box, longitude → south of the box); world positions
  move monotonically with the coordinate along `+x` (east) and `−z` (north);
  the set stays ≤ 5 per family.
- Full frontend suite: **103 pass** (was 97 + 6).
- `tsc -b` clean, `oxlint --deny-warnings` clean, `vite build` succeeds.

## Browser verification (headless Chrome + SwiftShader, backend live)

1. Geographic grid visible — graticule + `76°E`, `78°E`, `12°N`, `14°N` labels. ✓
2. Grid corresponds to the real Arabian Sea window (centre 74.86°E / 12.94°N,
   2° graticule). ✓
3. Longitude increases left→right (east = +x); latitude labels recede toward
   the back (north = −z). ✓
4. Ocean volume unchanged / aligned. ✓
5. Argo markers in the same geographic positions. ✓
6. Glider trajectories aligned (same `geoFrame`). ✓
7–9. Temperature (default) and salinity (checked at 1200 m) fields render;
   currents unaffected (same transform). ✓
10. Depth change to 1200 m — grid unchanged (it is a surface-plane layer,
    independent of the depth slider). ✓
11. Time is not an input to the graticule or the labels — unchanged. ✓
12. No new console errors (only the pre-existing offline/CORS messages when the
    backend is down). ✓

## Limitations

- The graticule scale still comes from `region.span` (a demo navigation hint),
  because `geoFrame` also drives field sampling and marker placement and must
  not change in this step. The grid *lines and labels* are nonetheless genuine
  integer-degree coordinates on that frame — the window centre is approximate,
  the coordinate values on it are real.
- Labels are 2D canvas sprites (like the depth axis): crisp at the default
  framing, mip-filtered when the camera pulls back.
- At a steep top-down camera the west-edge latitude labels can pass near the
  colourbar HUD; they are faint there by design and clear as the view returns
  to the default three-quarter angle.
