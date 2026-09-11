# Step 44 — Real Argo Observed Temperature Extraction

Prepares the **real INCOIS Argo observed temperature profile** as a clean,
comparison‑ready representation for the (later) model‑vs‑observation comparison.

**Observation side only.** Step 44 involves **no** GLORYS / model temperature and
computes **no** model − observation difference. It does not align Argo pressure
levels with GLORYS depth levels, and it interpolates nothing. Step 45 will do the
scientific alignment/difference.

## Audit — everything reused

| Reused | How |
| --- | --- |
| Argo raw data | the existing `data/raw/argo_profiles_incois_indian_argo_floats_sample.csv` — **not** re‑downloaded, **not** modified |
| Argo parsing | `ArgoProfilesReader` / `parse_profiles` / `ArgoLevel` / `ArgoProfile` (Step 28) — no new parser |
| Argo service | `ArgoObservationCatalog` — the new method sits beside `get_platform()` and reuses its id validation + 404 |
| Argo endpoint | `GET /api/observations/argo/{platform_id}` is **unchanged**; the new endpoint is a sibling under the same router |
| Schemas / errors | existing Pydantic conventions; existing `UnknownArgoPlatformError` (404) / `MalformedRequestError` (422) |
| Units / QC | the project's existing `UNITS`, `STANDARD_NAMES`, `QUALITY_DEFINITION` — no new QC policy |
| Frontend | the existing `DataApiClient` + `types.ts` pattern (Step 28/32/43) |

The transform matches the frontend's `measuredProfilePoints()` helper (Step 32),
now available on the **backend** for the comparison pipeline.

## New endpoint (and why it is not redundant)

```
GET /api/observations/argo/{platform_id}/temperature-profile
```
`platform_id` = the project's composite `<platform_number>_<cycle_number>`
(e.g. `3902669_4`) — same as `/api/observations/argo/{platform_id}`.

`GET /api/observations/argo/{platform_id}` returns **every** level (temperature +
salinity + all QC), in **file order**, with `null` for missing. The comparison
pipeline needs a focused, **sorted**, temperature‑only, **finite‑pairs‑only**
view with explicit `vertical_coordinate` and point/finite/null counts — and a
shape **symmetric** with Step 43's `/api/model-observations/argo/{id}/temperature`
so Step 45 gets two parallel clean inputs. Hence a dedicated endpoint. It adds no
new data — every value is already on the detail endpoint.

## Observed‑profile representation

```jsonc
{
  "observation": {
    "source": "INCOIS Argo float profile (in-situ CTD)",
    "dataset_id": "incois_indian_argo_floats",
    "platform_id": "3902669_4", "platform_number": "3902669", "cycle_number": 4,
    "platform_type": "ARVOR", "direction": "A",
    "latitude": 19.666…, "longitude": 64.65,          // verbatim from the snapshot
    "timestamp": "2025-03-31T15:00:20Z"               // verbatim
  },
  "profile": [                                         // ascending pressure_dbar; both values finite
    { "pressure_dbar": 0.1,   "temperature": 27.404, "pressure_qc": "1", "temperature_qc": "1" },
    …
    { "pressure_dbar": 1977.1,"temperature": 3.408,  "pressure_qc": "1", "temperature_qc": "1" }
  ],
  "metadata": {
    "variable": "sea_water_temperature",
    "units": "degree_Celsius",
    "vertical_coordinate": "pressure_dbar",
    "vertical_coordinate_units": "decibar",
    "vertical_coordinate_standard_name": "sea_water_pressure",
    "source_level_count": 102,
    "point_count": 102,                                // pairs kept (both finite)
    "finite_temperature_count": 102,
    "null_temperature_count": 0,                       // finite + null == source_level_count
    "finite_pressure_count": 102,
    "pressure_dbar_range": { "min": 0.1, "max": 1977.1 },
    "temperature_range":   { "min": 3.408, "max": 27.426 },
    "ordering": "ascending pressure_dbar (pure reordering; source values unchanged)",
    "pairing_rule": "a point is kept only when pressure_dbar AND temperature are both finite",
    "qc": {
      "filtering_applied": false,
      "flags_retained": true,
      "representation": "raw Argo QC codes as strings, per point (pressure_qc / temperature_qc)",
      "temperature_qc_codes_present": ["1"],
      "definition": { "1": "good data", …, "9": "missing value" },
      "note": "Step 44 keeps every finite temperature regardless of QC flag …"
    },
    "transforms_applied": "none (no interpolation, smoothing, decimation, gap-fill or unit conversion)"
  },
  "provenance": { … the existing Argo provenance block … },
  "notes": [ … 9 scientific-transparency statements … ],
  "missing_value": null
}
```

## Pressure / temperature handling

- **Vertical coordinate: native Argo pressure in decibar**, named `pressure_dbar`.
  It is **not** converted to depth, **not** treated as metres, **not**
  interpolated / resampled / smoothed / decimated. (The project has no documented
  pressure→depth utility; none was introduced.)
- **Temperature: the real Argo measurements, verbatim.** No averaging, smoothing,
  interpolation, gap‑fill, outlier clipping or arbitrary QC filtering. A missing
  (`null` / non‑finite) source value is dropped from `profile[]` but **counted**
  in `metadata` (`null_temperature_count`, and `point_count` < `source_level_count`).
- **Pairing:** a `(pressure_dbar, temperature)` point is emitted **only when both
  are finite**. Documented in `metadata.pairing_rule`.
- **Order:** ascending `pressure_dbar`. The INCOIS ERDDAP rows are already
  ascending‑pressure; the sort is defensive and is a **pure reordering** of the
  kept points — verified in tests that the returned temperature multiset equals
  the raw finite‑pair multiset.

## QC handling

The Argo source carries per‑measurement QC codes (`PRES_QC`, `TEMP_QC`); the
project represents them as raw strings with `QUALITY_DEFINITION`
(`"1"`=good … `"9"`=missing). Step 44:

- **retains all finite temperature measurements** — a `"3"` ("probably bad") or
  `"4"` ("bad") flagged value is **kept**, not dropped (verified against
  `2903988_7`, which carries `"3"` flags);
- **retains the QC flags as metadata** — `pressure_qc` / `temperature_qc` on every
  point, plus `metadata.qc.temperature_qc_codes_present` and the full
  `definition`;
- **performs no additional QC filtering** — `metadata.qc.filtering_applied: false`.

QC decisions are deferred to Step 45+.

## Core function

`app/data/observations/observed_profile.py` (pure, no I/O, no model):

- `observed_temperature_points(levels) -> list[dict]` — the finite‑pairs‑only,
  ascending‑pressure, QC‑preserving transform.
- `extract_observed_temperature_profile(profile, provenance) -> dict` — assembles
  the full `{observation, profile, metadata, provenance, notes}` payload.

Wired: `ArgoProfilesReader.observed_temperature_profile()` →
`ArgoObservationCatalog.observed_temperature_profile()` (id validation + 404) →
the route. **Kept separate from the Step 43 model extraction.**

## Results — the 4 real target Argo profiles (no GLORYS comparison)

| Argo | Source levels | Temp points | Pressure min/max (dbar) | Observed temp min/max (°C) | First point | Deepest point | QC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `3902669_4` | 102 | 102 | 0.1 / 1977.1 | 3.408 / 27.426 | 0.1 dbar → 27.404 °C | 1977.1 dbar → 3.408 °C | all `"1"` |
| `5907180_3` | 104 | 104 | 0.4 / 2030.9 | 3.118 / 29.206 | 0.4 dbar → 29.190 °C | 2030.9 dbar → 3.118 °C | all `"1"` |
| `5907179_3` | 103 | 103 | 0.1 / 2004.6 | 3.067 / 29.996 | 0.1 dbar → 29.970 °C | 2004.6 dbar → 3.067 °C | all `"1"` |
| `6990715_3` | 103 | 103 | 0.4 / 2003.9 | 2.889 / 30.150 | 0.4 dbar → 30.137 °C | 2003.9 dbar → 2.889 °C | all `"1"` |

All 4 target profiles are all‑finite (no `null` temperature or pressure), so
`point_count == finite_temperature_count == source_level_count`. QC availability:
`temperature_qc` and `pressure_qc` present on every point (all `"1"` = good). No
comparison to GLORYS is performed in this step.

## Frontend

Typed **API boundary only** — no UI. `src/api/types.ts` gains
`ArgoObservedTemperatureProfileResponse` + `ArgoObservedTemperatureLevel`;
`src/api/client.ts` gains `getArgoObservedTemperatureProfile(platformId, signal?)`.
No comparison chart, difference chart, comparison panel, controls, navigation or
model/observation overlay. The existing Argo profile UI is unchanged.

## Tests

**Backend** — `backend/tests/test_observed_temperature_profile.py` (21, real data):
pure core produces verbatim ascending pairs (multiset unchanged); the
both‑finite pairing rule (incl. a `NaN` / `null` fixture using real `ArgoLevel`
records — no invented values); all 4 targets succeed; platform/cycle/position/
timestamp preserved; `units` = `degree_Celsius`; `vertical_coordinate` =
`pressure_dbar`; pressure & temperature values equal a real source level;
ascending order is a pure reorder; `point_count` == finite source pairs (no
interpolation/added points); no fill/synthetic values; missing counted
consistently; **QC "3" flagged points retained with flags** (`2903988_7`); notes
mention no interpolation / not converted to depth / Step 45, and the payload
contains no `glorys` / `thetao` / model reference; 404 unknown platform, 404
unknown cycle, 422 malformed; no NaN token in JSON. Regression: the Argo detail
endpoint keeps its full level record (temperature + salinity + all QC, file
order); the Step 43 model endpoint unchanged; all other endpoints still 200.

Full backend suite: **348 pass**.

**Frontend** — `frontend/tests/observed-temperature-profile.test.ts` (3): correct
`temperature-profile` URL; identity / variable / units / vertical coordinate;
real pairs + QC + counts pass through verbatim, ascending pressure, "no
model−observation difference" note present; 404 / 422 surface as `ApiError`,
never synthetic data.

Full frontend suite: **134 pass**. `tsc -b` clean, `oxlint` clean, `vite build`
succeeds.

## Scientific documentation

- Argo temperature here is an **observed measurement**, not a model value.
- Source: the existing real INCOIS Argo dataset (`Indian_ARGO_Floats` snapshot),
  unchanged.
- Temperature values are **preserved verbatim** from the source.
- Native vertical coordinate: **pressure in decibar** (`pressure_dbar`).
- Values are **sorted by pressure** for profile presentation (pure reordering).
- **No interpolation. No smoothing. No decimation.**
- **No model values** are involved in Step 44.
- **No model − observation difference** is calculated.
- QC information is **preserved** in the existing source representation (raw
  codes + definitions); **no additional QC filtering**.

## Scientific limitations

1. **No vertical alignment.** The observed profile is on pressure (dbar); the
   Step 43 model profile is on GLORYS depth levels (m). They are returned
   independently — pairing / interpolation for a comparison is Step 45.
2. **Pressure ≠ depth.** `pressure_dbar` is left as pressure; converting to depth
   needs a documented equation of state (deferred).
3. **QC not applied.** Bad‑flagged values are present in `profile[]`; a consumer
   that wants "good only" must filter on `temperature_qc` itself.
4. **Regional model coverage is irrelevant here** — Step 44 works for *any* Argo
   profile in the snapshot (all 17), independent of GLORYS coverage.

## Steps 45–47 were NOT implemented

No model − observation difference (45), no comparison UI / visualization (46), no
comparison‑specific loading states (47). No data downloaded, no GLORYS expansion,
no raw‑dataset change, no change to the Step 43 methodology, no interpolation, no
difference calculation. Not committed.
