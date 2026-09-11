# Step 43 — Real GLORYS12V1 Model Temperature at an Argo Observation Location

Connects **one real INCOIS Argo profile** to the **nearest-native GLORYS12V1
`thetao` column** and returns explicit matching metadata plus the model profile.

**Extraction layer only.** Step 43 does **not** compute model − observation
differences, reformat the observed profile, or render anything — those are
Steps 44–47.

## Endpoint

```
GET /api/model-observations/argo/{platform_id}/temperature
```

`platform_id` is the project's **composite** Argo id
`<platform_number>_<cycle_number>` — identical to
`/api/observations/argo/{platform_id}` (the roadmap's
`.../{platform_id}/{cycle_number}/...` shape is not used because the project has
always addressed an Argo profile by one composite id). Example: `3902669_4`.

## Architecture (audit — everything reused, nothing duplicated)

```
platform_id
  → ArgoObservationCatalog.get_platform()      (Step 28 — real profile, 404/422 errors)
  → ModelObservationExtractionService          (NEW — app/services/model_observation_service.py)
       ├─ NetCDFDataService.coverage()          (Steps 39/42 — validate space & time)
       └─ NetCDFDataService.nearest_profile()   (NEW method — nearest native cell + native column, CF-decoded)
  → GET /api/model-observations/argo/{id}/temperature   (app/api/routes/model_observations.py)
  → ModelAtArgoTemperatureResponse             (app/api/schemas.py — existing conventions)
```

- The **new service** knows about "an Argo profile" and "a model profile at an
  observation". It never opens the NetCDF, parses Argo, or implements
  nearest-neighbour selection itself.
- The **new `NetCDFDataService.nearest_profile()`** is where all NetCDF/xarray
  access lives. It delegates to `xarray .sel(method="nearest")`, which **snaps to
  existing grid coordinates** — it cannot interpolate.
- Errors are the project's existing typed `ApiError` subclasses; one new type,
  `ObservationOutsideModelCoverageError` (422, slug
  `observation_outside_model_coverage`), was added to `app/api/errors.py`.

## Matching method

| Dimension | Method | Guarantee |
| --- | --- | --- |
| **Spatial** | nearest native GLORYS 1/12° grid cell (`xarray .sel(method="nearest")` on `latitude` + `longitude`) | no bilinear interpolation, no regridding, no synthetic coordinates. Response gives requested vs matched lat/lon, the per-axis difference in degrees, and the great-circle distance in km. |
| **Temporal** | nearest available GLORYS **daily-mean** timestep (`.sel(method="nearest")` on `time`) | no temporal interpolation. Response gives the Argo timestamp *and* the matched GLORYS daily timestamp (both ISO-8601 UTC) and the absolute difference in seconds. A note states GLORYS `thetao` is a daily mean, not an instantaneous value. |
| **Vertical** | all native GLORYS depth levels at the matched (time, lat, lon), unchanged | no interpolation onto Argo pressure levels, no conversion to Argo levels, no smoothing or decimation. 32 native levels for the current subset (0.494 → 541.089 m). `null` preserved for masked (land / below-seafloor) cells. |

## Response structure

```jsonc
{
  "observation": {
    "source": "INCOIS Argo float profile",
    "dataset_id": "incois_indian_argo_floats",
    "platform_id": "3902669_4", "platform_number": "3902669", "cycle_number": 4,
    "latitude": 19.666…, "longitude": 64.65,          // verbatim, unchanged
    "timestamp": "2025-03-31T15:00:20Z",              // verbatim
    "level_count": 102, "pressure_min": 0.1, "pressure_max": 1977.1
  },
  "model": {
    "dataset_id": "glorys12v1_model",
    "source": "GLORYS12V1 / Copernicus Marine",
    "product_id": "GLOBAL_MULTIYEAR_PHY_001_030",
    "copernicus_dataset_id": "cmems_mod_glo_phy_my_0.083deg_P1D-m",
    "doi": "https://doi.org/10.48670/moi-00021",
    "file_name": "temperature_cmems_glorys12v1_arabiansea.nc",
    "variable": "thetao", "standard_name": "sea_water_potential_temperature",
    "units": "degrees_C",
    "latitude": 19.66666…, "longitude": 64.66666…,    // nearest native cell
    "timestamp": "2025-04-01T00:00:00Z",              // nearest daily mean
    "spatial_match": {
      "method": "nearest native GLORYS 1/12 grid cell (no interpolation)",
      "requested": { "latitude": …, "longitude": … },
      "matched":   { "latitude": …, "longitude": … },
      "latitude_difference_deg": …, "longitude_difference_deg": …,
      "distance_km": …
    },
    "temporal_match": {
      "method": "nearest available GLORYS daily-mean timestep (no interpolation)",
      "requested": "2025-03-31T15:00:20Z",
      "matched":   "2025-04-01T00:00:00Z",
      "difference_seconds": 32380.0,
      "note": "GLORYS thetao is a DAILY MEAN, not an instantaneous value"
    },
    "decoding": { … CF scale_factor / add_offset / _FillValue block … },
    "level_count": 32, "finite_level_count": 32, "null_level_count": 0,
    "depth_units": "m", "depth_positive": "down"
  },
  "profile": [ { "depth": 0.494…, "temperature": 27.362… }, … 32 rows … ],
  "coverage": { … the configured GLORYS file's real extent … },
  "warnings": [],
  "notes": [ … scientific-transparency statements … ],
  "nan_encoding": "…"
}
```

## Errors (all typed; no fallback, ever)

| Situation | Status | `error.type` |
| --- | --- | --- |
| `platform_id` not `<number>_<cycle>` | 422 | `malformed_request` |
| unknown platform **or** unknown cycle (composite id not in the snapshot) | 404 | `unknown_argo_platform` |
| observation position outside the model box | 422 | `observation_outside_model_coverage` (`detail.outside` = `["longitude"]` etc., `detail.model_coverage`) |
| observation time outside the model window | 422 | `observation_outside_model_coverage` (`detail.outside` includes `"time"`) |
| no GLORYS file configured / not openable | 503 | `netcdf_not_configured` / `netcdf_unavailable` |
| Argo snapshot not loaded | 503 | `data_unavailable` |
| nearest model cell fully masked | **200** | not an error — every `profile[].temperature` is `null`, `model.null_level_count == 32`, and `warnings` says so |

There is **no** fallback to synthetic data, to the tiny GLORYS sample, or to any
other dataset — an unavailable configured file is a hard 503.

## Scientific transparency

Every 200 response carries `notes[]`:

- Observation source: real INCOIS Argo float profile (in-situ CTD).
- Model source: MERCATOR GLORYS12V1 reanalysis, distributed by Copernicus Marine.
- GLORYS `thetao` is `sea_water_potential_temperature` (potential temperature), in `degrees_C`.
- GLORYS values are **daily means** — not instantaneous, and not an observation.
- Spatial matching: nearest native GLORYS 1/12 grid cell. **No spatial interpolation / regridding.**
- Temporal matching: nearest available GLORYS daily timestep. **No temporal interpolation.**
- Vertical values: native GLORYS depth levels, unchanged. **No vertical interpolation** onto Argo pressure levels.
- Missing model values (land / below-seafloor) are preserved as `null`.
- **Step 43 does NOT compute model-minus-observation differences** (that is a later step).

The actual spatial (`latitude_difference_deg`, `longitude_difference_deg`,
`distance_km`) and temporal (`difference_seconds`) mismatch is always in the
response — a client can see exactly how far the model cell is from the float.

## Results — the 4 real target Argo profiles

| Argo | Argo pos / time | Matched GLORYS cell | Δlat, Δlon (°) | dist | Matched day | Δt | levels (finite / null) | model surface → 541 m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `3902669_4` | 19.6667 °N, 64.65 °E · 2025-03-31 15:00:20Z | 19.66667 °N, 64.66666 °E | −0.0000, +0.0167 | 1.74 km | **2025-04-01** | 32 380 s (9.0 h) | 32 / 0 | 27.36 → 12.86 °C |
| `5907180_3` | 16.5333 °N, 68.6667 °E · 2025-03-26 20:12:45Z | 16.50000 °N, 68.66666 °E | −0.0333, −0.0000 | 3.71 km | **2025-03-27** | 13 635 s (3.8 h) | 32 / 0 | 29.37 → 12.11 °C |
| `5907179_3` | 12.3167 °N, 68.15 °E · 2025-03-28 20:10:01Z | 12.33333 °N, 68.16666 °E | +0.0167, +0.0167 | 2.59 km | **2025-03-29** | 13 799 s (3.8 h) | 32 / 0 | 29.92 → 11.61 °C |
| `6990715_3` | 9.4000 °N, 68.45 °E · 2025-04-01 19:52:02Z | 9.41667 °N, 68.41666 °E | +0.0167, −0.0333 | 4.10 km | **2025-04-02** | 14 878 s (4.1 h) | 32 / 0 | 30.52 → 11.11 °C |

All four return a full 32-level real model column; every value is **bit-identical**
to `xarray .sel(method="nearest")` on the raw NetCDF. Sample decoded values
(`3902669_4`, first / mid / last level): `27.362011`, `25.703757` (34.4 m),
`12.860347` °C (541.089 m).

## Frontend

Typed **API boundary only** — no UI. `src/api/types.ts` gains
`ModelAtArgoTemperatureResponse` (+ `ModelObsProfileLevel`,
`ModelObsSpatialMatch`, `ModelObsTemporalMatch`); `src/api/client.ts` gains
`getModelTemperatureAtArgo(platformId, signal?)`. No charts, difference
visualisation, comparison panels, controls or navigation were added.

## Tests

**Backend** — `backend/tests/test_model_observations.py` (20, against the **real**
files): all 4 targets succeed; identity / variable / units; Argo coords verbatim;
matched coords are real grid points; spatial difference recomputed; nearest daily
timestep + Δseconds recomputed independently; 32 native levels unchanged;
**profile == `xarray .sel(method="nearest")` on the NetCDF, bit-for-bit**;
decoding block + transparency notes; 404 unknown platform / unknown cycle; 422
malformed; **422 out-of-coverage (spatial: `2903988_7` Bay of Bengal; temporal:
`6990679_15` 2025-04-20)**; 503 unavailable model with **no fallback to the tiny
sample**; every pre-existing endpoint still 200.

Full backend suite: **327 pass**.

**Frontend** — `frontend/tests/model-observation.test.ts` (4): correct
composite-id URL; identity / variable / units; Argo coords + both timestamps +
Δseconds + native profile pass through verbatim, all values physical; the "no
model−observation difference" note is present; out-of-coverage / unknown /
unavailable all surface as `ApiError`, never synthetic data.

Full frontend suite: **131 pass**. `tsc -b` clean, `oxlint` clean, `vite build`
succeeds.

## Limitations

1. **Nearest-neighbour, not co-located.** The model cell is up to ~half a grid
   step (~4 km) from the float and up to ~½ day from the observation time — the
   response states the exact offsets. GLORYS `thetao` is a daily mean.
2. **Regional / short-window model.** Only 4 of the 17 Argo profiles fall inside
   the current Arabian Sea subset; the rest return
   `observation_outside_model_coverage`. Gliders are not wired in (Step 43 is
   Argo-only, and both glider deployments are outside the box/window anyway).
3. **Vertical axes are not aligned.** The model profile is on GLORYS depth
   levels (m); the Argo profile is on pressure levels (dbar). Step 43 returns
   them independently — pairing/interpolating for a comparison is Step 44+.
4. **No difference computed.** `model` and `observation` are returned
   side-by-side; there is no `model_minus_obs` anywhere.

## Steps 44–47 were NOT implemented

No observed-temperature extraction/reformatting (44), no model − observation
difference (45), no comparison visualisation/UI (46), no comparison-specific
loading states (47). The GLORYS dataset was not expanded; the validated raw
files are unchanged; nothing was committed.
