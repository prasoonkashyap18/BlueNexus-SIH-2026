# BlueNexus — SIH Demo Flow

**Purpose:** a rehearsable 3–5 minute live walk-through for a Smart India Hackathon
judge. Every screen shown below is the *real* application driven by the *real*
backend and *real* datasets — there is no slideware, no mock data and no scripted
fake state.

Validated end-to-end on 2026-09-09 (three fresh headless runs, all steps green).
See `Step 53` completion report for evidence.

---

## 0. Pre-demo setup (do this before the judge arrives)

```bash
# Terminal 1 — backend (from repo root)
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev            # serves http://localhost:5173
```

Checklist:

- [ ] `http://localhost:8000/api/health` → `{"status":"ok", ... "all_expected_present":true}`
- [ ] Open `http://localhost:5173/` in a **maximised** desktop Chrome window (≈1600 px wide).
- [ ] Wait for the 3D ocean box to appear and the top-left HUD to read
      **TEMPERATURE °C · INCOIS OCEAN ANALYSIS** (≈2–3 s after load).
- [ ] Header status pill shows **Online** (green).
- [ ] Hard-refresh once (Ctrl+Shift+R) so the demo starts from a clean state.

If the 3D box is blank or the pill is red → see **Recovery** at the bottom.

---

## 1. The 30-second problem statement (say this, don't click)

> "Operational ocean data at INCOIS lives in NetCDF files, ERDDAP tables and
> model output that you normally inspect as flat 2-D plots, one variable and one
> depth at a time. It is hard to see how the water column is structured, hard to
> put a float next to the model that is supposed to represent it, and hard to
> keep track of where each number came from.
>
> BlueNexus is a browser platform that puts the real analysis fields, the real
> in-situ observations and a reanalysis model into one 3-D view, lets you compare
> them quantitatively, and keeps the provenance of every dataset on screen."

---

## 2. The demo sequence (A → N)

Times in brackets are a rough budget; the whole run is ~4 minutes.

### A. Application load *(already done in setup — 10 s)*

- **Point at:** the 3-D ocean volume, the colour legend, the HUD, the docked
  Controls (left) and Observation (right) panels.
- **Say:** "This is one continuous 3-D scene — the Arabian Sea sector. Everything
  else in the demo happens inside it."
- **Expected state:** HUD = `TEMPERATURE / °C / INCOIS OCEAN ANALYSIS`,
  `Depth 100 m`, `10 Jul 2026`. Right panel = "No observation selected".

### B. Temperature *(20 s)*

- **Do:** nothing (Temperature is the default) — just walk through what is shown.
- **Point at:**
  - the vertical temperature legend (**2.6 °C → 32.1 °C**, warm/cold poles);
  - the top-left HUD tag **INCOIS OCEAN ANALYSIS**;
  - the left **Data Source** card: *Temperature · ANALYSIS · INCOIS Ocean
    Analysis · `T_ANALYZED` · °C*.
- **Say:** "Real ocean temperature in three dimensions, not an isolated 2-D plot.
  The field is the INCOIS 10-day Argo objective analysis; the tag and the legend
  are driven by that real data, never a placeholder."

### C. Depth *(20 s)*

- **Do:** drag the **Depth** slider (left panel) to **≈800 m**.
- **Point at:** the HUD line updating to `Depth 800 m`; the horizontal slice and
  colours changing; the in-scene depth axis on the right (Surface → 5000 m) stays
  readable.
- **Say:** "We move through the water column instead of being stuck at the
  surface. Each slice is the real analysis at that depth."

### D. Time *(15 s)*

- **Do:** click the **Time** stepper's right arrow once → **2026-07-20**.
- **Point at:** HUD date changes to `20 Jul 2026`; the field updates.
- **Say:** "The same interface steps through the available analysis time steps."
- **Caveat (say it):** "These are the three 10-day analysis snapshots in our
  sample — it is not a live feed."

### E. Salinity *(20 s)*

- **Do:** **Variable** dropdown → **Salinity**.
- **Point at:** legend switches to **PSU** (≈33.6 → 36.5, fresh/salty); HUD reads
  `SALINITY / PSU / INCOIS OCEAN ANALYSIS`; Data Source card now shows
  `S_ANALYZED · PSU`, still **INCOIS Ocean Analysis**.
- **Say:** "Same spatial framework, different variable, same 3-D environment —
  salinity from the same INCOIS analysis product."

### F. Currents *(20 s)*

- **Do:** **Variable** dropdown → **Current**.
- **Point at:** current vectors over the surface; legend in **m/s** (0 → ~2.6);
  HUD reads `CURRENT / m s⁻¹ / INCOIS IO-HOOFS` and **· surface only**, plus the
  note **"Surface currents shown at 0 m"**; Data Source card = *Surface current ·
  MODEL FORECAST · INCOIS IO-HOOFS · `CURRENT` · m/s*.
- **Say:** "Surface currents from the INCOIS IO-HOOFS operational forecast give
  flow context around the scalar fields."
- **Caveat (say it):** "This dataset is surface-only — the UI says so; we are not
  claiming full-depth currents."
- **Then:** switch **Variable** back to **Temperature** for the rest of the demo.

### G. Real observations *(15 s)*

- **Do:** confirm the **Argo Floats** and **Gliders** layer chips (left panel,
  bottom) are **on** (they are on by default). Toggle one off and on to show it
  is live.
- **Point at:** the white Argo point markers and the magenta glider track in the
  scene.
- **Say:** "Now real in-situ observations are overlaid on the model/analysis
  field — Argo profiling floats and an underwater glider deployment."

### H. Select a real Argo float *(20 s)*

- **Do:** click one of the white Argo markers. **Use one of the four floats that
  overlap our GLORYS model subset** so the later comparison works:
  **`3902669_4`**, `5907179_3`, `5907180_3`, or `6990715_3`.
  (`3902669_4` sits near 19.7 °N, 64.7 °E — upper-left of the marker cluster.)
- **Point at:** the right **Observation** panel filling in:
  - Platform ID **3902669_4**, Float number **3902669**, Float type **ARVOR**,
    Cycle number **4**
  - Latitude **19.67° N**, Longitude **64.65° E**
  - Observation time **2025-03-31 15:00 UTC**
  - Measured levels **102**, Pressure range **0.1–1977.1 dbar**
  - **SOURCE:** Provider **INCOIS ERDDAP**, Dataset **Indian_ARGO_Floats**
- **Say:** "One click resolves the marker to its real ERDDAP record — identity,
  position, time, and how deep it profiled."

### I. Temperature profile *(20 s)*

- **Do:** nothing — the **Depth Profile** section is already showing Temperature.
- **Point at:** the profile chart — **Temperature (°C)** on the x-axis,
  **Pressure (dbar)** increasing *downward* (surface at top), "102 valid
  measurements".
- **Say:** "The same observation opens as a vertical profile. These are the raw
  measured levels on native pressure — no interpolation, no smoothing, no depth
  conversion."

### J. Salinity profile *(15 s)*

- **Do:** in the Depth Profile header, click **Salinity**.
- **Point at:** the chart switches to salinity (**PSU**); only one chart is shown.
- **Say:** "Same profile, salinity channel — and switching it makes no new
  network request; it is the same record."
- **Then:** click **Temperature** to switch back.

### K. Model vs observation *(30 s)*

- **Do:** scroll the Observation panel down to **Model ↔ Observation** and click
  **Compare with Model**.
- **Point at:**
  - the dual chart — **GLORYS12V1 model** vs **Argo observation**, temperature
    vs depth;
  - the signed **Model − Observation** difference profile with the **0** line
    ("right of 0 = model warmer");
  - **Difference statistics**: Mean **+0.045 °C**, MAE **0.228 °C**,
    RMSE **0.373 °C**, Range **−0.435 … +1.494 °C**, **Matched levels 26 / 32**;
  - "6 model levels unmatched … excluded from the statistics and not drawn";
  - Spatial separation **1.7 km**, Temporal separation **9.0 h**.
- **Say:** "We pull the GLORYS12V1 reanalysis temperature at this float's nearest
  native model cell and nearest model day, match it level-by-level to the float,
  and show the signed difference. Here the model is on average 0.05 °C warm, with
  a ~0.37 °C RMS spread and a ~1.5 °C warm bias at one level."

### L. Methodology / scientific honesty *(20 s)*

- **Do:** expand **Methodology & limitations** under the comparison.
- **Point at / read the key lines:**
  - "GLORYS12V1 is a Copernicus Marine global ocean reanalysis (variable
    `thetao`); **it is not INCOIS model data**."
  - nearest native GLORYS 1/12° cell — **no horizontal interpolation**.
  - nearest GLORYS **daily-mean** timestep — `thetao` is a daily mean, not
    instantaneous.
  - each GLORYS level matched to the nearest Argo depth via **TEOS-10
    `gsw.z_from_p`**, within **half the local level spacing** (adaptive
    tolerance); **no vertical interpolation**.
  - unmatched levels are dropped, not forced.
  - "This is a **reanalysis–observation comparison, not instantaneous co-located
    validation**."
- **Say:** "The comparison is deliberately conservative and every assumption is
  on screen. We do not report a single 'model accuracy' number, because that
  would misrepresent what this is."

### M. Provenance *(20 s)*

- **Do:** in the left panel, expand **Data Source → All data sources & coverage**.
- **Point at:** the six dataset identities, each with organisation, dataset/
  product id, variable, units, and lat/lon/depth/time coverage:

  | Role | Source shown | Kind |
  |---|---|---|
  | Temperature | INCOIS Ocean Analysis (`T_ANALYZED`) | analysis |
  | Salinity | INCOIS Ocean Analysis (`S_ANALYZED`) | analysis |
  | Currents | INCOIS IO-HOOFS (`CURRENT`) | model forecast |
  | Argo | INCOIS `Indian_ARGO_Floats` (ERDDAP) | observation |
  | Gliders | EGO / OceanGliders GDAC | observation |
  | Model comparison | GLORYS12V1 / Copernicus Marine | reanalysis |

- **Say:** "Every dataset in the platform is named, attributed and bounded. No
  file paths, no credentials, no internal errors are ever exposed — this comes
  from a real `/api/sources` provenance endpoint."

### N. Return to normal exploration *(10 s)*

- **Do:** click **Hide** (collapses the comparison), then **Clear** (top of the
  Observation panel).
- **Point at:** panel returns to "No observation selected"; the 3-D scene is
  untouched and still interactive; no stale statistics remain.
- **Say:** "Back to a clean exploration state — and the platform is built to take
  more datasets and more variables the same way."

---

## 3. Recommended 3–5 minute cut

If you only have time for the essentials, run:
**A → B → C → E → G → H → I → K → L → M**
(skip Time, Currents, Salinity-profile, and the Return step). That still tells
the full story: real data → 3-D → depth → multiple variables → real observations
→ profile → model-vs-observation → scientific honesty → provenance.

---

## 4. Judge Q&A — talking points

| Question | Short answer |
|---|---|
| **What problem does BlueNexus solve?** | Ocean analysis, observations and model output are scattered across NetCDF/ERDDAP and usually seen as 2-D plots; BlueNexus unifies them in one 3-D view with quantitative model↔obs comparison and transparent provenance. |
| **Why is 3-D useful?** | You see the whole water column and the horizontal field at once, and you can place a float next to the model cell that represents it — impossible in a single 2-D slice. |
| **What real data is used?** | INCOIS 10-day Argo objective analysis (T/S), INCOIS IO-HOOFS surface currents, INCOIS `Indian_ARGO_Floats` (ERDDAP), EGO/OceanGliders GDAC gliders, and GLORYS12V1 (Copernicus Marine) for the model comparison. |
| **Where does the data come from?** | The Data Source panel + `/api/sources` name the organisation, dataset/product id, units and coverage for each. |
| **What are Argo and gliders?** | Argo = autonomous profiling floats that drift and periodically profile the top ~2000 m. Gliders = steerable autonomous vehicles that fly a saw-tooth trajectory collecting CTD data. Both are real in-situ instruments. |
| **What variables?** | Temperature and salinity (3-D analysis fields), surface currents (forecast). Chlorophyll is intentionally *not* offered — no verified public INCOIS series yet. |
| **How does depth/time work?** | A single shared state drives the scene; the depth slider picks a real analysis level, the time stepper picks a real analysis snapshot; both providers re-map to the real coordinate. |
| **How does model↔obs comparison work?** | GLORYS `thetao` at the float's nearest native cell + nearest model day, matched to Argo levels by TEOS-10-derived depth within an adaptive tolerance, differenced level-by-level. |
| **What does the difference mean?** | Signed `model − observed` temperature per matched depth, plus mean/MAE/RMSE/range over matched levels. It characterises reanalysis–observation agreement, *not* instantaneous validation. |
| **How is provenance maintained?** | Assembled server-side from the dataset catalogues and observation source constants; surfaced in the UI; no paths/secrets/tracebacks. |
| **What makes it extensible?** | Each dataset is a provider behind a typed API contract; the NetCDF→API pipeline (`/api/netcdf`), the source catalogue and the scene layers all take new entries without touching the others. |

---

## 5. Important scientific caveats (keep visible / say aloud)

- The **time axis is a 3-step sample**, not live data. The HUD date tooltip says so.
- **Currents are surface-only.** The HUD and Data Source panel say so.
- **GLORYS12V1 is Copernicus Marine / Mercator Ocean**, a reanalysis — **not**
  INCOIS model output. Never describe it as INCOIS.
- The model↔obs comparison is **reanalysis vs observation**, with spatial (~1.7 km)
  and temporal (~9 h) separation — **not** simultaneous co-located validation.
- GLORYS `thetao` is **potential temperature**, a **daily mean**.
- Only **4 Argo floats** (`3902669_4`, `5907179_3`, `5907180_3`, `6990715_3`)
  overlap the GLORYS subset; other floats correctly report
  "outside model coverage" for the comparison.

---

## 6. Recovery (during the demo)

| Situation | Fastest fix |
|---|---|
| Comparison shows an error / "outside model coverage" | You picked a float outside the GLORYS subset. Click **Hide**, then **Clear**, and select one of the 4 listed floats. |
| Wrong / unintended Argo or glider selected | Click **Clear** at the top of the Observation panel, or just click the marker you want. |
| Wrong variable selected | Re-pick in the **Variable** dropdown — it is stateless, no reload. |
| Camera drifted / lost the scene | Press **R** over the viewport, or click **Reset** in the Controls panel (restores parameters *and* camera). |
| Side panel stuck open (narrow window) | Click the **Controls** / **Observation** edge button again, or click outside the drawer. |
| 3-D box blank on load | Hard-refresh (Ctrl+Shift+R). If still blank, confirm the browser has WebGL (`chrome://gpu`) and that `npm run dev` is still running. |
| Header pill red / "Offline" | Backend is down or not on port 8000. Restart `uvicorn main:app --port 8000`; the frontend reconnects automatically (≈30 s health poll) or hard-refresh. |
| Everything feels stale | Hard-refresh. The app has no persisted state; a reload is always a clean start. |

---

## 7. Known limitations (be ready, don't volunteer)

- **Blocker:** none.
- **Major:** none.
- **Minor:**
  - No React error boundary — a render exception would blank the page (not
    reachable through any demo control; scheduled for a later hardening step).
  - The specific Argo marker is an unlabelled 3-D point; picking a particular
    float by eye takes care. Mitigation: only 4 floats matter for the comparison
    and they are listed above.
  - The model↔obs comparison lives below the fold in the Observation panel —
    scroll down after selecting the float.
- **Informational:**
  - `THREE.Clock` deprecation warning in the console (three.js internal, benign).
  - Production JS bundle is ~1.25 MB (347 KB gzip) — one Vite size warning; not a
    demo concern on localhost.
  - Provenance shows dataset *filenames* (e.g. `…argo_floats_sample.csv`), never
    paths — acceptable as attribution.

---

## 8. What NOT to claim

- Not "live ocean data" — it is real archived data on a sample time axis.
- Not "full-depth currents" — surface only.
- Not "INCOIS model validated to X accuracy" — it is a GLORYS reanalysis vs Argo
  comparison with stated caveats.
- Not "we forecast the ocean" — BlueNexus visualises and compares; it does not run
  models.
