# Step 45 — GLORYS12V1 Model − Argo Observation Temperature Difference

The scientific comparison layer. Takes the Step 43 real **GLORYS12V1 model**
temperature column and the Step 44 real **INCOIS Argo observed** temperature
profile and produces a transparent

```
difference_c = model_temperature_c − observed_temperature_c        (positive ⇒ model warmer)
```

**This is a model / reanalysis‑versus‑observation comparison — NOT validation
against a simultaneous, co‑located, instantaneous model observation.** GLORYS
`thetao` is a daily mean.

Step 46 (comparison UI) and Step 47 (comparison loading states) are **not**
implemented.

## Endpoint

```
GET /api/model-observations/argo/{platform_id}/temperature-comparison
```
`platform_id` = the project's composite `<platform_number>_<cycle_number>`
(e.g. `3902669_4`). `operationId = get_model_observation_temperature_comparison`;
responses `200 / 404 / 422 / 503` (same typed errors as Step 43).

## Architecture

```
platform_id
  → ModelObservationExtractionService.extract_argo_temperature()   (Step 43 — model column + spatial/temporal match, unchanged)
  → ArgoObservationCatalog.observed_temperature_profile()          (Step 44 — observed profile, unchanged)
  → app.data.comparison  (NEW, pure)  — TEOS-10 depth, adaptive matching, difference, statistics
  → ModelObservationComparisonService  (NEW)  — orchestration + response assembly
  → GET …/temperature-comparison   (app.api.routes.model_observations)
  → ModelObsTemperatureComparisonResponse   (app.api.schemas — existing conventions)
```

Kept separate from `NetCDFDataService`, `ModelObservationExtractionService` and
the Argo reader. **No new spatial or temporal matching** — the model cell, the
model daily timestamp and the reported spatial/temporal separations are Step 43's,
verbatim.

## Scientific methodology

### Sources

| | |
|---|---|
| Observation | real **INCOIS Argo** float temperature (in‑situ CTD), `Indian_ARGO_Floats` snapshot — Step 44 output, verbatim |
| Model | **MERCATOR GLORYS12V1** reanalysis potential temperature `thetao`, Copernicus Marine product `GLOBAL_MULTIYEAR_PHY_001_030` / `cmems_mod_glo_phy_my_0.083deg_P1D-m`, DOI `10.48670/moi-00021` — Step 43 output, verbatim |

### Spatial matching — reused from Step 43

Nearest native GLORYS 1/12° grid cell to the Argo position. **No new spatial
interpolation.** The response carries Step 43's `spatial_match` block (requested
vs matched lat/lon, `distance_km`).

### Temporal matching — reused from Step 43

Nearest available GLORYS **daily‑mean** timestep. **No new temporal
interpolation.** The response carries Step 43's `temporal_match` block (Argo
timestamp, GLORYS daily timestamp, `difference_seconds`). GLORYS `thetao` is a
daily mean — the comparison is *not* between two instantaneous measurements.

### Pressure → depth — TEOS‑10 (GSW)

Argo pressure is on the **native `pressure_dbar`** coordinate. It is converted to
depth with the **TEOS‑10 GSW toolbox** (`gsw` **3.6.23**, installed into
`backend/.venv` only):

```
comparison_depth_m = -gsw.z_from_p(pressure_dbar, argo_latitude)
```

`gsw.z_from_p` returns geometric **height** (metres, negative below the surface);
depth is its negation. The Argo latitude is used. The **original
`pressure_dbar` is never modified** — `argo_depth_m` is a **separate field** on
every comparison row. (Depth is ~0.4–0.8 % shallower than the numeric pressure at
these depths, e.g. 538 dbar → ~534.0 m — the real TEOS‑10 correction, not 1:1.)

### Common comparison grid — the native GLORYS depth levels

The comparison grid is the **GLORYS native depth levels, unchanged** (32 levels,
0.494 → 541.089 m for the current subset). GLORYS data is never regridded or
interpolated.

### Vertical matching — adaptive nearest‑observation

For each GLORYS native depth `d[i]`, the **single nearest Argo observation** by

```
argmin_k  abs(argo_comparison_depth_m[k] − d[i])
```

is selected. **No interpolation of either dataset. No index pairing.**

A GLORYS level is **matched** only when that nearest observation is within an
**adaptive maximum vertical separation**:

```
max_separation_m[i] = local_spacing_m[i] / 2

local_spacing_m[i] = (d[i+1] − d[i−1]) / 2      for an interior level
                   = d[1]   − d[0]               for the first level (i = 0)
                   = d[−1]  − d[−2]              for the last level  (i = N−1)
```

so an interior level's tolerance is `(d[i+1] − d[i−1]) / 4`. This is **strict**
where the GLORYS grid is fine (≈ 0.52 m near the surface) and **looser** where it
is coarse (≈ 43.6 m at the bottom of the subset). It is deterministic, documented
and tested; the full per‑level array is returned as
`matching.maximum_vertical_separation_m`.

*(For the current GLORYS subset + the 4 target profiles this matches **26 of 32**
GLORYS levels; the 6 unmatched are in the 11–40 m band where the Argo float
sampled at ~5 dbar intervals and no observation falls within the sub‑2 m
tolerance. Those rows carry `matched: false`, `difference_c: null`, `reason:
"no Argo observation within the adaptive vertical tolerance"`.)*

### Depth‑coverage limitation

The current GLORYS subset ends at **~541.089 m**. Argo profiles reach ~2000 dbar.
Only the overlapping range is compared — Argo observations whose derived depth
exceeds the deepest GLORYS level are counted (`argo_observations_below_model_depth`,
≈ 58–60 per target profile) but **never compared**.

### Difference definition

```
difference_c = model_temperature_c − observed_temperature_c
```

`difference_definition` in the response is exactly that string, with *"positive ⇒
model warmer than observation"*. **Signed is the primary field.** Mean absolute
difference is a *secondary* statistic only.

### Missing values

A `null` model temperature (land / below seafloor) or a `null` observed
temperature yields `difference_c = null` and `matched: false` — **never a
fabricated difference**.

### QC handling — no new policy

Step 44 retained every finite Argo temperature and preserved the raw QC codes.
Step 45 **inherits that**: `observed_temperature_qc` / `observed_pressure_qc` are
carried on every matched comparison row, `observation.qc.filtering_applied` is
`false`, and **no QC threshold is applied**. If a non‑good‑flagged observation is
used, its flag is visible on the row (nothing is hidden). QC decisions are for a
later step.

## Statistics

Over **valid matched comparison points only** (`matched: true` ⇒ model & observed
both finite, within the adaptive tolerance, within GLORYS depth coverage):

| Field | Definition |
|---|---|
| `matched_count` | number of valid matched points |
| `mean_difference_c` | mean of the signed differences |
| `mean_absolute_difference_c` | mean of `abs(difference)` |
| `minimum_difference_c` / `maximum_difference_c` | signed extremes |
| `rmse_c` | `sqrt(mean(difference²))` |

`population` names the set explicitly. With `matched_count == 0` all statistics
are `null` with an explanation; with `matched_count < 3` they are reported plus a
"not robust" note.

## Response structure

```jsonc
{
  "comparison": {
    "platform_id", "model_dataset_id", "model_source", "observation_source",
    "model_variable" (thetao), "observation_variable" (sea_water_temperature),
    "model_units" (degrees_C), "observation_units" (degree_Celsius),
    "difference_units" (degree_Celsius), "difference_units_note",
    "difference_definition": "difference_c = model_temperature_c - observed_temperature_c (positive => model warmer than observation)",
    "kind": "model/reanalysis-versus-observation comparison -- NOT validation against a simultaneous co-located instantaneous model observation"
  },
  "matching": {
    "vertical_method", "model_depth_coordinate", "observation_depth_method",
    "gsw_version": "3.6.23", "gsw_function": "gsw.z_from_p",
    "adaptive_tolerance_rule", "maximum_vertical_separation_m": [ …32… ],
    "model_level_count": 32, "matched_level_count", "unmatched_level_count",
    "model_depth_range_m", "argo_comparison_depth_range_m",
    "argo_levels_in_comparison_depth_band", "argo_observations_below_model_depth",
    "temporal_matching": "reused from Step 43 …", "spatial_matching": "reused from Step 43 …"
  },
  "model": { … Step 43 matched GLORYS cell: dataset/source/ids, matched lat/lon/timestamp,
             spatial_match, temporal_match, decoding, depth_units … verbatim },
  "observation": { … verbatim Argo position / timestamp / platform ids …,
                   variable, units, vertical_coordinate: "pressure_dbar", qc block },
  "profile": [
    {
      "model_depth_m", "model_temperature_c",
      "argo_pressure_dbar",           // ORIGINAL Argo pressure, unchanged
      "argo_depth_m",                 // derived (TEOS-10), separate
      "observed_temperature_c",
      "observed_temperature_qc", "observed_pressure_qc",
      "vertical_separation_m", "max_vertical_separation_m",
      "difference_c",                 // model - observed, or null
      "matched", "reason"
    }
    // … one row per native GLORYS depth level (32) …
  ],
  "statistics": { "population", "matched_count", "mean_difference_c",
                  "mean_absolute_difference_c", "minimum_difference_c",
                  "maximum_difference_c", "rmse_c" },
  "provenance": { "model": {…doi…}, "observation": {…} },
  "notes": [ … 12 scientific-transparency statements … ],
  "nan_encoding": "…"
}
```

## Results — the 4 real target Argo profiles

| Argo | Argo ts / GLORYS day | spatial sep | temporal sep | matched / 32 | Argo obs below model | mean diff | MAE | RMSE | min / max diff |
|---|---|---|---|---|---|---|---|---|---|
| `3902669_4` | 2025‑03‑31 15:00Z / **2025‑04‑01** | 1.74 km | 32 380 s | **26** | 58 | **+0.0452** | 0.2284 | 0.3733 | −0.4350 / +1.4938 |
| `5907180_3` | 2025‑03‑26 20:13Z / **2025‑03‑27** | 3.71 km | 13 635 s | **26** | 60 | **+0.3324** | 0.5138 | 0.7598 | −0.6302 / +2.2275 |
| `5907179_3` | 2025‑03‑28 20:10Z / **2025‑03‑29** | 2.59 km | 13 799 s | **26** | 59 | **+0.2219** | 0.4798 | 0.7506 | −0.7478 / +2.4241 |
| `6990715_3` | 2025‑04‑01 19:52Z / **2025‑04‑02** | 4.10 km | 14 878 s | **26** | 59 | **−0.1727** | 0.3900 | 0.6070 | −1.9520 / +0.6484 |

All in °C. Comparison depth range: model 0.494 → 541.089 m; Argo derived depths
0.10 → ~1955–2009 m (only p ≲ 545 dbar overlaps).

### Sample comparison points — `3902669_4`

| GLORYS depth | model °C | Argo pressure | Argo depth (TEOS‑10) | observed °C | QC | vert. sep | difference_c |
|---|---|---|---|---|---|---|---|
| 0.494 m | 27.3620 | 0.1 dbar | 0.099 m | 27.4040 | 1 | 0.395 m | **−0.04199** |
| 1.541 m | 27.3598 | 1.8 dbar | 1.789 m | 27.4210 | 1 | 0.248 m | **−0.06119** |
| 65.807 m | 24.0462 | 65.0 dbar | 64.594 m | 24.2720 | 1 | 1.213 m | **−0.22576** |
| 541.089 m | 12.8603 | 538.0 dbar | 534.031 m | 12.5830 | 1 | 7.058 m | **+0.27735** |
| *11.405 m (unmatched)* | 27.3041 | — | — | — | — | — | *null — "no Argo observation within the adaptive vertical tolerance"* |

Each `difference_c` is exactly `model_temperature_c − observed_temperature_c`
(verified in tests and by hand).

## Frontend

Typed **API boundary only** — no UI. `src/api/types.ts` gains
`ModelObsTemperatureComparisonResponse` + `ModelObsComparisonLevel`;
`src/api/client.ts` gains `getModelObservationTemperatureComparison(platformId,
signal?)`. **No** Compare tab behaviour, charts, overlays, difference colour
scales or comparison controls.

## Tests

**Backend** — `backend/tests/test_temperature_comparison.py` (28, real data,
every expected value **independently recomputed** with `xarray` + `gsw`): all 4
targets compare; sources/variables/units; the exact `model − observation`
definition; model depth = native GLORYS unchanged; original Argo pressure
unchanged and `argo_depth_m` a *different* (shallower) number; TEOS‑10
`gsw.z_from_p` is the documented method; **no index subtraction**; every point
has a vertical separation + tolerance; **adaptive tolerance matches the documented
formula** (`(d[i+1]−d[i−1])/4` interior, adjacent‑gap/2 at the ends); points
deeper than GLORYS excluded; **`difference_c == model − observed` exactly** for
every matched row and `null` for every unmatched row; whole profile matches an
independent recompute; missing model/obs → no fake difference; QC flags on
matched points, `filtering_applied: false`; statistics over matched points only;
**mean / MAE / RMSE independently reproducible**; spatial/temporal match reused
from Step 43 verbatim; transparency notes; no NaN token in JSON; numeric
spot‑check of `3902669_4` first / middle / deepest by hand; 404 unknown platform
/ cycle, 422 malformed, **422 out‑of‑coverage (spatial `2903988_7`, temporal
`6990679_15`)**, 503 no model file with no synthetic fallback; **Step 43 and
Step 44 endpoints unchanged**; all data endpoints still 200.

Full backend suite: **376 pass**.

**Frontend** — `frontend/tests/temperature-comparison.test.ts` (3): correct
endpoint URL; identity / `difference_definition`; per‑level rows +
`gsw`/adaptive‑tolerance metadata + stats pass through; a matched row's
`difference_c ≈ model − observed` and `argo_depth_m < argo_pressure_dbar`; an
unmatched row is `null` with a reason; Step 43 spatial/temporal match present;
"daily mean / not validation" note; 404 / 422 / 503 → `ApiError`.

Full frontend suite: **137 pass**. `tsc -b` clean, `oxlint` clean, `vite build`
succeeds.

## Dependency

`gsw==3.6.23` (TEOS‑10 seawater toolbox) — installed into `backend/.venv` **only**
(single 2.2 MB abi3 wheel, no new transitive deps; numpy already present). Because
it is now a **runtime** dependency of the comparison endpoint, it is added to
`backend/requirements.txt` with a comment. Not installed globally.

## Scientific limitations

1. **Not co‑located, not simultaneous.** The model cell is up to ~4 km from the
   float and up to ~9 h from the observation; GLORYS is a daily mean. The offsets
   are all in the response. This is a reanalysis‑vs‑observation comparison.
2. **Regional / shallow GLORYS subset.** Only 4 of 17 Argo profiles are inside
   the GLORYS box/window; comparison depth stops at ~541 m; ~58–60 of each
   profile's ~100 levels are below coverage.
3. **Strict near‑surface tolerance.** The adaptive rule leaves ~6 of 32 GLORYS
   levels unmatched for these profiles (the two grids genuinely lack a close
   observation there). Those are `null`, not forced.
4. **Nearest observation, not a layer mean.** Each GLORYS level is compared to
   one Argo sample (the nearest by depth), not an average over the level's
   thickness — no interpolation is performed by design.
5. **TEOS‑10 vs the (removed) native‑pressure principle.** The project otherwise
   keeps pressure native; the derived `comparison_depth_m` exists **only** for
   matching and is a separate field — the observed profile's own coordinate
   (Step 44) is still `pressure_dbar`.

## Steps 46 and 47 were NOT implemented

No Compare UI / visualization (46), no comparison‑specific loading states (47).
No data downloaded, no GLORYS expansion, no raw‑file change, no change to Step 43
matching or Step 44 extraction, no synthetic data. `gsw` installed venv‑local
only. Not committed or pushed.
