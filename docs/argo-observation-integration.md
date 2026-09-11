# Step 28 — Real Argo Profiling-Float Observation Integration

Adds the real INCOIS Argo **profile** observations to the application data flow,
as a path that is deliberately **separate** from the gridded BlueNexus datasets
and never merged with the model grid.

```
INCOIS ERDDAP  Indian_ARGO_Floats  (tabledap, Point)
        │  D4 acquisition — CSV, verbatim
        ▼
data/raw/argo_profiles_incois_indian_argo_floats_sample.csv   (+ .headers.txt, .query.txt)
        │  app/data/observations/argo.py   — group rows → profiles
        │                                    99999 _FillValue / blank → null
        │                                    per-level QC flags preserved
        ▼
app/services/observations.py  ArgoObservationCatalog   (loaded once at startup)
        ▼
GET /api/observations/argo              → list of float profiles (summary)
GET /api/observations/argo/{id}         → one profile + every measured level
        │  frontend/src/api/client.ts  — getArgoPlatforms() / getArgoPlatform(id)
        ▼
state/ArgoObservationsProvider.tsx  → useArgoObservations()   (profile list, on mount)
state/argoObservationsState.ts      → useArgoProfile(id)       (one profile, on demand)
```

## Source

| | |
|---|---|
| Dataset | INCOIS ERDDAP `Indian_ARGO_Floats` (tabledap, `cdm_data_type = Point`) |
| Access | `https://erddap.incois.gov.in/erddap/tabledap/Indian_ARGO_Floats.csv?…` — public, no auth |
| Nature | Individual Argo profiling-float ascents at their real observation times. **Not** an analysis, **not** a forecast, **not** real-time — this public mirror lags the live Argo array by ≈ 16 months (coverage ends 2025-04-23). |
| Snapshot | lat −15…30, lon 45…100, time 2025-03-25 → 2025-04-23 — **17 real profiles from 11 real floats** (PROVOR_III / ARVOR), 1,643 measured levels, 158 KB. SHA-256 `5ec0d432…f0da5979`. |

The gridded `incois_argo_10day_analysis` dataset (temperature / salinity model
volume) is a *different* product — a 1° objective **analysis** of the float
array. It is untouched by this step.

## Variables & units (source units, never converted)

| Field | Source column | Units | Standard name |
|---|---|---|---|
| pressure | `PRES` | `decibar` | `sea_water_pressure` |
| temperature | `TEMP` | `degree_Celsius` (ITS-90) | `sea_water_temperature` |
| salinity | `PSAL` | `PSU` | `sea_water_practical_salinity` |
| time | `time` | ISO-8601 UTC (verbatim) | `time` |
| latitude / longitude | `latitude` / `longitude` | `degrees_north` / `degrees_east` | — |
| platform id | `PLATFORM_NUMBER` | WMO id, verbatim | — |
| cycle | `CYCLE_NUMBER` | integer | — |
| QC | `PRES_QC` / `TEMP_QC` / `PSAL_QC` | raw Argo single-char code (`1` good … `4` bad …) | — |

Pressure (decibar) is Argo's **native vertical coordinate** and is carried as
such — no pressure→depth conversion is done here (that is a display concern for
a later step).

## Structure

* **Profile** = one float ascent cycle, addressed by the composite id
  `<PLATFORM_NUMBER>_<CYCLE_NUMBER>` (e.g. `2903951_10`).
* Each profile: one `time` / `latitude` / `longitude`, and an ordered list of
  `levels` (shallowest → deepest), each level `{pressure, pressure_qc,
  temperature, temperature_qc, salinity, salinity_qc}`.
* No grid, no fixed depth axis — profiles have different level counts (88–104
  here) at their own real pressures.

## Missing data

ERDDAP writes the Argo `_FillValue` `99999.0` (or a blank cell) for an absent
measurement. Both become JSON `null` — never `0`, `-999`, `-1e34`, and never the
fill value itself. The per-level QC flag is still carried even when the value is
`null`. Nothing is interpolated or back-filled.

## Not done in Step 28 (later steps)

* No Argo marker layer in the 3D scene.
* No profile charts wired to this source (the observation panel still shows its
  clearly-labelled demo catalogue — `ObservationPanel` / `useSelectedPlatform`
  are untouched).
* No model-vs-observation comparison.
* No change to the temperature / salinity / current model visualization.
* No new dependency (the backend stays FastAPI + stdlib `csv`).

## Tests

| File | What |
|---|---|
| `backend/tests/test_observations.py` | 16 tests — raw snapshot SHA-256 unchanged; reader groups 17 real profiles / 11 floats; real coords/timestamps/units verbatim; `99999`/blank → `None`; real QC flags 3 & 4 present; provenance names INCOIS ERDDAP `Indian_ARGO_Floats`; endpoints serve the real list + one profile; 404 / 422 envelopes; `null` on the wire (no `99999`); gridded `/api/datasets` still returns exactly 2 |
| `frontend/tests/argo.test.ts` | 7 tests — client hits `/api/observations/argo[...]` with the composite id; real values & source units pass through; missing level value stays `null`; `findArgoPlatform` / `isArgoPlatformId`; no mock fallback (throws `ApiError` on failure) |
