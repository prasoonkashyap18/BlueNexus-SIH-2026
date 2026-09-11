# Step 29 — Real Underwater-Glider Observation Integration

Adds real underwater-glider observations to the application data flow, as a path
that is **separate** from the gridded BlueNexus datasets, **separate** from the
Step 28 Argo data, and never merged with the model grid.

```
EGO / OceanGliders GDAC  ->  OceanGlidersGDACTrajectories  (IFREMER ERDDAP, tabledap)
        │  D4 acquisition — CSV, verbatim
        ▼
data/raw/glider_ego_oceangliders_gdac_sample.csv   (+ .headers.txt, .query.txt)
        │  app/data/observations/glider.py   — group rows by deployment
        │                                      NaN / 99999 _FillValue → null
        │                                      per-sample EGO QC flags preserved (incl. 4 = bad)
        ▼
app/services/observations.py  GliderObservationCatalog   (loaded once at startup)
        ▼
GET /api/observations/gliders                → list of deployments (summary)
GET /api/observations/gliders/{platform_id}  → one deployment + every trajectory sample
        │  frontend/src/api/client.ts  — getGliderPlatforms() / getGliderPlatform(id)
        ▼
state/GliderObservationsProvider.tsx  → useGliderObservations()   (deployment list, on mount)
state/gliderObservationsState.ts      → useGliderDeployment(id)    (one deployment, on demand)
```

## Why this source

INCOIS has **no** machine-readable glider dataset. Verified:

* `https://erddap.incois.gov.in/erddap/search/…?searchFor=glider` → 404, no results.
* The project's own D2/D3 source survey (`docs/data-sources.md`,
  `docs/data-availability.md`) evaluated Argo, GODAS, HOOFS, HF-radar, OMNI/RAMA
  moored buoys and satellite ocean colour — **no glider entry anywhere**.

The **EGO / OceanGliders GDAC** is the authoritative international data assembly
centre for glider observations — the glider analogue of the Argo GDAC. It is
operated by IFREMER / Coriolis for the OceanGliders programme (GOOS/GCOS
endorsed; `www.ego-network.org`). It is public, no-auth, and served over the
same ERDDAP `tabledap` mechanism the Step 28 Argo integration uses. This is not
an arbitrary third-party dataset — it is *the* GDAC.

`source = "Glider observation"`, `data_type = "EGO glider time-series data"`,
`featureType = Trajectory` — confirmed **observations, not model output**.

## Source

| | |
|---|---|
| GDAC | EGO / OceanGliders — Global Data Assembly Centre, IFREMER / Coriolis |
| Dataset | `OceanGlidersGDACTrajectories` |
| Access | `https://erddap.ifremer.fr/erddap/tabledap/OceanGlidersGDACTrajectories.csv?…` — public, no auth |
| Conventions / QC | `CF-1.6 EGO-1.2`; QC = EGO reference table 2.1 (DOI `10.13155/51485`) — same 0–9 vocabulary as Argo |
| Nature | Individual glider CTD samples along the deployment trajectory, at their real observation times. **Delayed-mode / near-real-time assembly centre, not a live feed.** |
| Retrieved | **2026-09-06** |
| Snapshot | two real deployments in the INCOIS domain: |
| — `sea057_20220707` | SeaExplorer, **Gulf of Oman / N Arabian Sea** (~24.1°N, 57.7°E). Window 2022-07-03 → 2022-07-09. 2,740 CTD samples. EGO QC populated (flags `1` good, `4` bad, plus `null`). |
| — `Bellatrix_368` | Slocum, **central Bay of Bengal** (~8.0°N, 88.0°E), 2016 ASIRI / OMM monsoon campaign. Window 2016-07-06 00:00–06:00 UTC. 3,296 samples. QC not populated in the GDAC for this deployment → all `null` (preserved honestly, never fabricated). |
| Snapshot file | `glider_ego_oceangliders_gdac_sample.csv`, 668,767 B, SHA-256 `3ec6aecfd8ef2add9b3ee0a57c597929ffaa882f51d09036ebe9c02821017643` |

## Variables & units (source units, never converted)

| Field | Source column | Units | Standard name |
|---|---|---|---|
| pressure | `PRES` | `decibar` | `sea_water_pressure` |
| temperature | `TEMP` | `degree_Celsius` (ITS-90) | `sea_water_temperature` |
| salinity | `PSAL` | `PSU` | `sea_water_practical_salinity` |
| time | `time` | ISO-8601 UTC (verbatim) | `time` |
| latitude / longitude | `latitude` / `longitude` | `degrees_north` / `degrees_east` | — |
| platform id | `platform_deployment` | verbatim (e.g. `sea057_20220707`) | — |
| QC | `PRES_QC` / `TEMP_QC` / `PSAL_QC` / `POSITION_QC` | raw EGO single-char code | — |

Pressure (decibar) is the glider's native vertical coordinate and is carried as
such — no pressure→depth conversion here (that is a display concern for a later
step, exactly as for Argo).

## Structure

* **Platform** = one glider **deployment**, addressed by `platform_deployment`.
* Each deployment: an ordered list of `samples` (trajectory time-series — glider
  data is a continuous sawtooth, not discrete cycles), each sample
  `{time, latitude, longitude, position_qc, pressure, pressure_qc, temperature,
  temperature_qc, salinity, salinity_qc}`.
* No grid, no fixed depth axis.

## Missing / QC handling

* ERDDAP renders an absent measurement as `NaN`; the EGO `_FillValue` is
  `99999.0`. Both — and an empty cell — become JSON `null`. Never `0`, `-999`,
  `-9999`, `-1e34`.
* QC flags are carried through **verbatim**, bad flags included: in
  `sea057_20220707` the pre-deployment on-deck samples carry `TEMP_QC = 4` on
  physically-impossible ~40 °C readings — the flag *and* the value are both
  preserved, nothing is dropped or interpolated.
* Where the GDAC did not populate QC (`Bellatrix_368`), every QC field is
  `null` — the real state of the source, not a fabricated "good".

## Not done in Step 29 (later steps)

* No glider marker layer in the 3D scene, no marker clicking.
* No profile / trajectory charts wired to this source.
* No model-vs-observation comparison.
* Argo/Glider layer buttons remain non-functional.
* `ObservationPanel` / `demoObservations.ts` / `useSelectedPlatform.ts` /
  marker rendering — untouched. The panel still shows its clearly-labelled demo
  catalogue.
* No new dependency (backend stays FastAPI + stdlib `csv`).

## Tests

| File | What |
|---|---|
| `backend/tests/test_glider_observations.py` | 17 tests — raw snapshot SHA-256 unchanged; reader groups 2 real deployments / 6,036 samples; real coords/timestamps/pressure verbatim; source units; QC preserved incl. flag `4`; `NaN`/`99999`/blank → `None`; QC-absent deployment reports `null` QC (not fabricated); provenance names the EGO / OceanGliders GDAC; endpoints serve the real list + one deployment; 404 envelope; no fill/NaN numbers on the wire; glider path independent of Argo and the grid; Argo/temperature/salinity/currents still 200 |
| `frontend/tests/glider.test.ts` | 9 tests — client hits `/api/observations/gliders[...]` with the deployment id; real values & source units pass through; missing sample value stays `null`; bad-QC sample keeps value + flag `4`; `findGliderPlatform` / `isGliderPlatformId`; no mock fallback (throws `ApiError` on failure); glider types distinct from Argo |
