# BlueNexus INCOIS Dataset Availability (Data Track D2)

**Data Track step:** D2 — Determine Dataset Availability
**Type:** Availability investigation only. No ingestion pipeline, no API, no frontend wiring, no mock‑data replacement, no changes to Steps 1–20 or D3+.
**Prepared:** 2026-09-05
**Builds on:** `docs/data-sources.md` (D1) — that document is unchanged.

---

## 1. D2 Summary

D1 identified *which* official INCOIS sources exist for temperature, salinity, chlorophyll and
currents. D2 asked a narrower question: **for each of those, is there an actual dataset that is
available right now and realistically usable by BlueNexus** — verified against live catalogs,
metadata and (where possible) real data requests, not against a webpage that merely describes a
product.

### Headline findings

| Parameter | Verdict | One‑line reason |
| --- | --- | --- |
| **Temperature** | ✅ **Available now, publicly, verified** | INCOIS Argo gridded analysis on ERDDAP (`incois_argo_10day_McCreary`) returned real depth‑resolved data for 2026‑07‑30 — CSV and NetCDF, no login. |
| **Salinity** | ✅ **Available now, publicly, verified** | Same dataset carries `S_ANALYZED` (PSU); verified data pull. No separate INCOIS salinity source exists or is needed. |
| **Chlorophyll** | ⚠️ **No current, open, machine‑readable INCOIS dataset verified** | The only INCOIS chlorophyll NetCDF on a machine interface (Oceansat‑2 OCM on ERDDAP/LAS) **stops at 2020‑05‑01** and is DoS‑restricted. The live INCOIS "Ocean Colour Products" service is a web viewer; its archive is **by email request only**. |
| **Ocean Currents** | ⚠️ **Not reliably available from INCOIS via an open interface** | INCOIS‑GODAS (the only INCOIS 3‑D current field) is on LAS but the latest step is **2025‑05‑22** and the LAS OPeNDAP endpoint **timed out repeatedly**; HF Radar and OSF/HOOFS have **no verified machine endpoint** (request / login gated). |

### What this means for D3

- Temperature and salinity can proceed straight to "how do we ingest it" — one dataset, one
  interface (ERDDAP `griddap`), verified working.
- Chlorophyll and currents each need a D3 **access‑resolution task** (email requests, credential
  tests, or a decision to use a non‑INCOIS fallback) **before** ingestion design is meaningful.

### Verification method

Live checks on 2026‑09‑05 against `erddap.incois.gov.in` (ERDDAP v2.30), `las.incois.gov.in`
(LAS + THREDDS), `incois.gov.in`, `do.incois.gov.in`, and `ftpser.incois.gov.in`, using `curl`
and Python. Where a dataset was reachable, an actual data subset was requested (not just
metadata). TLS/DNS anomalies are recorded in §10 and are **not** treated as "dataset unavailable".

---

## 2. Dataset Availability Matrix

Access classification key: **A** publicly available (no registration/auth) · **B** public but
restricted (visible/reachable but download/usage/reliability limits) · **C** registration or
approval required · **D** appears to exist but current access not verified · **E** unavailable /
discontinued / unusable.

| Parameter | Dataset | Official Source | Exists? | Currently Accessible? | Latest Data | Spatial Coverage | Depth | Data Type | Access Class | BlueNexus Suitability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Temperature / Salinity | **INCOIS Argo 10‑Day gridded — Kessler–McCreary** (`incois_argo_10day_McCreary`) | INCOIS ERDDAP; LAS *"ARGO DATA PRODUCTS (10 DAYS)"* (catid `id-a292ce89c6`) | Yes | **Yes — verified** (CSV + `.nc` returned real values) | **2026‑07‑30** (10‑day step; ~37‑day lag) | Tropical Indian Ocean, lon 30.5–119.5°E, lat 29.5°S–29.5°N | 24 levels, 5–2000 m | Observational (Argo), objectively analysed / gridded | **A** (TLS note §10) | **High** — `time×depth×lat×lon`, ~1:1 with the frontend `TemperatureDataset` |
| Temperature / Salinity | **INCOIS Argo 10‑Day gridded — Variational Analysis (VAM)** (`incois_argo_10d_VAM`) | INCOIS ERDDAP; LAS *"VAM 10DAY ARGO"* (`id-76d076139f`) | Yes | **Yes — verified** (28.85 °C / 35.47 PSU at 2026‑07‑30) | **2026‑07‑30** | Same as above | 24 levels, 5–2000 m | Observational, objectively analysed | **A** | High (fewer diagnostic vars than McCreary: `TEMP`,`TERR`,`SAL`,`SERR`) |
| Temperature / Salinity | **INCOIS Argo Monthly gridded** (`incois_argo_mnt_McCreary`, `incois_argo_mnt_VAM`) | INCOIS ERDDAP; LAS *"ARGO DATA PRODUCTS (Monthly)"*, *"VAM MNT ARGO"* | Yes | **Yes — verified** (full 24‑level column returned) | **2026‑07‑15** | Same as above | 24 levels, 5–2000 m | Observational, objectively analysed | **A** | High for a coarse (monthly) time axis |
| Temperature / Salinity / **Currents** | **INCOIS‑GODAS** (global MOM4 analysis) | INCOIS LAS *"Godas 2025"* (`id-cbbdd5ab07`); INCOIS FTP `ftpser.incois.gov.in` | Yes | LAS **catalog** yes; LAS **OPeNDAP timed out (>90 s, 0 bytes)**; FTP **anonymous denied (530)** | **2025‑05‑22** (≈15.5‑month lag; no "Godas 2026" file) | Global | **40 levels, 5–~4478 m** | Model analysis + data assimilation | LAS: **B/D** · FTP: **C** | Medium — only INCOIS 3‑D current+T+S field, but stale on the public mirror and OPeNDAP unreliable |
| Temperature / Salinity / Currents | **INCOIS GODAS/MOM monthly reanalysis** (`temp`, `sal`, `u`, `v`) | INCOIS LAS | Yes | LAS catalog yes; OPeNDAP flaky | **2023‑12‑15** | Global | 40 levels, 5–~4478 m | Reanalysis / hindcast (monthly) | **B/D** | Low for "current"; strong multi‑decadal hindcast (1979–2023) |
| Currents (surface, geostrophic) | **INCOIS Argo Value‑Added Products** — `GEO_U`, `GEO_V` (cm/s) | INCOIS ERDDAP `incois_valueadded_products_datasets`; LAS *"ARGO Value Added Products"* | Yes | **Yes — verified** (GEO_U 21.5 cm/s at 2019‑03‑30) | **2019‑03‑30** (≈6.5‑yr lag) | lon 30.5–119.5°E, lat 29.5°S–29.5°N, 1° | Surface only | Derived from Argo (geostrophy) | **E** (no longer updated) | Low — surface, 2‑D, not current |
| Currents (surface, observed) | **HF Radar / ICORN** — coastal surface current vectors | `incois.gov.in/site/dataholdings.jsp` ("Registered access through Website"); Data Requisition Form | Yes (per Data Holdings: 2008–"till date") | **Not machine‑verified** — no ERDDAP/LAS entry; signed Data Requisition Form to ODM Division required | Not discoverable without access | Indian coastal waters ≤200 km offshore (AP, TN, Gujarat, Odisha, Andaman) | Surface only | Observational (real‑time acquisition) | **C** | Coastal surface overlay only; not automatable pre‑approval |
| Currents / SST (forecast) | **OSF / HOOFS** — surface currents, SST, MLD, D20 | `incois.gov.in/site/services/osf.jsp`; `…/modelling/hoofs.jsp` | Yes (web maps) | **Web viewer only** — no verified gridded download; INCOIS GeoServer `GetCapabilities` → HTTP 403 | Daily run, forecast to +5 (–10) days | Indian Ocean, N Indian Ocean, South China Sea, coastal states | HOOFS: 40 sigma levels (subsurface exists internally) | Model forecast (ROMS + LETKF) | **D** | Potentially high (IO 1/12°, NIO 1/48°, 3‑hourly) **iff** a data route is found in D3 |
| Currents (point, with depth) | **OMNI / RAMA moored buoys** | `incois.gov.in/site/datainfo/jointportal.jsp` | Yes | **INCOIS: visualisation only, no download.** RAMA subset downloadable from NOAA/PMEL | real‑time transmission | Bay of Bengal, eastern Arabian Sea (point moorings) | currents to ~100 m; T/S to ~500 m | Observational | INCOIS: **E** (no download) · PMEL: **B** | Validation points only, not a field |
| Chlorophyll | **INCOIS Oceansat‑2 OCM** (`incois_oceansat2_datasets`) | INCOIS ERDDAP; LAS *"OCM 2"* (`id-b36be55868`) | Yes | Machine‑readable, public, **verified query** (but returns only up to 2020‑05) | **2020‑05‑01** (discontinued) | lon 46.7–99.3°E, lat 0.1–27.9°N, ~0.04° (~4 km) | Surface (2‑D) | Satellite (Oceansat‑2 OCM) | **E** for current data; historical archive is **A** to read **but** OCM is *"Restricted; as per DoS guidelines"* → **not redistributable** | No (stale **and** restricted) |
| Chlorophyll | **INCOIS IRS‑P4 OCM chlorophyll** (`IRS_chlorophyll_datasets`) | INCOIS ERDDAP; LAS *"OCM 1 DATA"* | Yes | Public, verified | **2006‑03‑21** | lon 60.0–103.9°E, lat 0.0–26.0°N, ~0.01° | Surface | Satellite (IRS‑P4 OCM) | **E** (historical) | No |
| Chlorophyll | **INCOIS Ocean Colour Products** (ChloroGIN‑IO) — CHL from MODIS‑Aqua, NRT | `incois.gov.in/site/services/ChloroGIN_SP.jsp` | Yes (as a **web viewer**) | Viewer renders selectable products (CHL, K490, SST, …) by region + resolution; **"For archive data kindly contact samanta.a@incois.gov.in"** | Not exposed on any machine interface | North Indian Ocean / IOGOOS domain (not stated numerically) | Surface | Satellite‑derived, near‑real‑time | **C** (email request) · a machine feed is **D. Not currently verified** | Unknown — resolution, format, domain, cadence all unstated by INCOIS |
| Chlorophyll (model) | **"Corrected INCOIS BIO ROMS"** — sea‑surface chlorophyll | INCOIS LAS (`id-d272905813`) | Yes | LAS catalog yes; OPeNDAP flaky | **2019‑12‑24** | lon 30–120°E, ~1/12° | Surface | Model (biogeochemical ROMS) | **B/D** | No (model, historical) |
| Chlorophyll (fallback, **non‑INCOIS**) | ISRO **MOSDAC** Oceansat‑3 (EOS‑06) OCM‑3 CHL | `mosdac.gov.in/oceansat-3` | Yes | Registration required | Current (2‑day global revisit) | Global | Surface | Satellite (OCM‑3) | **C** | D3 fallback candidate |
| Chlorophyll (fallback, **non‑INCOIS**) | NASA **OB.DAAC** MODIS‑Aqua / VIIRS / PACE L3 | `oceancolor.gsfc.nasa.gov`; NASA ERDDAPs | Yes | Public | Current | Global | Surface | Satellite | **A** | D3 fallback candidate |
| Argo profiles (observation panel) | **INCOIS ERDDAP `Indian_ARGO_Floats`** | INCOIS ERDDAP (tabledap) | Yes | **Yes — public**, but lags | **2025‑04‑23** (≈16‑month lag) | Global (lon −180…180, lat −70…48) | profile `PRES`/`TEMP`/`PSAL` + QC | Observational (individual profiles) | **A** but not current | Wiring/schema only; use global Argo GDAC for live profiles |
| SST (context, **NOAA data on INCOIS LAS**) | LAS *"NOAA High Resolution SST AVHRR only"* (`id-a153fb198f`) | INCOIS LAS (NOAA OISST) | Yes | LAS catalog yes; OPeNDAP flaky | **2026‑08‑11** (current) | lon 20.1–139.9°E, lat 69.9°S–29.9°N, 0.25° | Surface | Satellite/analysis (NOAA) | **B** | Optional sharp surface layer; NOAA (not INCOIS) is the authority |
| SST (context) | LAS *"AMSR2 OCEAN DATA PRODUCTS (3 Day composite)"* | INCOIS LAS | Yes | LAS catalog yes | **2026‑08‑28** (current) | Global 0.25° | Surface | Satellite (AMSR2) | **B** | Optional surface layer |

---

## 3. Temperature Dataset Availability

### 3.1 INCOIS Argo 10‑Day gridded — Kessler–McCreary — **PRIMARY, verified available**

| Field | Value | Evidence |
| --- | --- | --- |
| Exact name | *"INCOIS ARGO 10 Day data Kessler‑McCreary Methodology"* | ERDDAP dataset title |
| Dataset ID | `incois_argo_10day_McCreary` (ERDDAP); LAS catid `id-a292ce89c6` | ERDDAP `allDatasets`; LAS `getDatasets.do` |
| Official source URL | `https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.html` · `https://las.incois.gov.in/` | direct |
| Currently exists? | **Yes** | present in ERDDAP catalog + LAS catalog on 2026‑09‑05 |
| Currently accessible? | **Yes** — `griddap` returned real `T_ANALYZED`/`S_ANALYZED` values (e.g. 29.73 °C / 35.90 PSU at 8.5°N, 70.5°E, 5 m, 2026‑07‑30); `.nc` request returned `Content-Type: application/x-netcdf` | live `curl` |
| Earliest data | 2001‑01‑10 | ERDDAP `time` axis |
| Latest data | **2026‑07‑30** (10‑day steps; 921 steps) | ERDDAP `time` axis + verified pull |
| Data lag on 2026‑09‑05 | ~37 days; NetCDF `history` showed regeneration 2026‑08‑17 | ERDDAP metadata |
| Temporal coverage | continuous 10‑day fields, 2001→present | ERDDAP |
| Spatial coverage | Tropical Indian Ocean | ERDDAP `geospatial_*` |
| Latitude range | 29.5°S → 29.5°N (`geospatial_lat_resolution = 1.0`) | ERDDAP |
| Longitude range | 30.5°E → 119.5°E (`geospatial_lon_resolution = 1.0`) | ERDDAP |
| Depth coverage | 5 m → 2000 m | ERDDAP `ZAX` |
| Number of depth levels | **24** (5,10,20,30,50,75,100,125,150,200,250,300,400,500,600,700,800,900,1000,1200,1400,1600,1800,2000) | ERDDAP `ZAX` values |
| Variables | `T_ANALYZED`, `S_ANALYZED`, `T_MEAN`, `S_MEAN`, `T_STDEV`, `S_STDEV`, `T_RMSE`, `S_RMSE`, `T_ROIOBS`, `S_ROIOBS`, `T_BOXOBS`, `S_BOXOBS` | ERDDAP `.das` |
| BlueNexus parameter present? | **Yes** — temperature (`T_ANALYZED`, units `degs` = °C) and salinity (`S_ANALYZED`, PSU) | ERDDAP |
| Data type | observational (Argo floats) · objectively analysed / gridded · **not** real‑time · historical + current | ERDDAP; D1 |
| Update frequency | new 10‑day field added periodically; **no fixed schedule published by INCOIS** | inferred from `time` axis + `history` |
| Historical data available? | **Yes** — full record from 2001 | verified |
| Current/latest data available? | **Yes** — to 2026‑07‑30 | verified |
| Suitable for 3‑D visualization? | **Yes** — exactly the frontend's grid shape; regional Indian‑Ocean box; land/no‑obs cells are `NaN`/`9999.0` | verified full‑column pull showed a realistic thermocline (29 °C @5 m → 5.2 °C @1400 m → NaN below) |
| **Access classification** | **A — Publicly available** (all INCOIS ERDDAP datasets report `accessible = public`) | ERDDAP `allDatasets.accessible` |

### 3.2 INCOIS Argo 10‑Day gridded — Variational Analysis (VAM) — verified available

`incois_argo_10d_VAM` (LAS `id-76d076139f`). Same grid, same 24 depth levels, earliest 2004‑01‑10,
latest **2026‑07‑30**, variables `TEMP`, `TERR`, `SAL`, `SERR`. Verified pull returned 28.85 °C /
35.47 PSU. **Access class: A.** Slightly leaner (no per‑cell statistics); a useful cross‑check
against the McCreary analysis.

### 3.3 INCOIS Argo Monthly gridded — verified available

`incois_argo_mnt_McCreary`, `incois_argo_mnt_VAM` (LAS *"ARGO DATA PRODUCTS (Monthly)"*, *"VAM MNT
ARGO"*). Same grid/depths, latest **2026‑07‑15**. Verified: full 24‑level column returned.
**Access class: A.** Use if a monthly cadence is preferred over 10‑day.

### 3.4 INCOIS‑GODAS — available but stale + unreliable interface

Only on LAS (not ERDDAP). *"Godas 2025"* (`id-cbbdd5ab07`) carries `Potential temperature`,
`Salinity`, 40 levels 5–~4478 m, global. **Latest step 2025‑05‑22** — no 2026 file exists on LAS.
The LAS `getDatasets.do` catalog responds fine, but the LAS **OPeNDAP** endpoint
(`/thredds/dodsC/las/id-cbbdd5ab07/…`) **timed out at >90 s with 0 bytes** on repeated attempts.
`godas.jsp` claims a "1‑day delayed daily‑averaged ocean analysis" and lists the INCOIS FTP
(`ftpser.incois.gov.in`) as the distribution point — but **anonymous FTP login was denied (530)**.
**Access class: B/D via LAS; C via FTP.** Deeper than Argo (to sea floor) and daily in principle,
but not currently usable through a verified open interface.

### 3.5 Not usable for current temperature

| Dataset | Why |
| --- | --- |
| `incois_argo_sst_weekly` | surface only; ends 2010‑12‑29 (**E**) |
| `NOAA_AVHRR_AMSR_datasets` (ERDDAP) | ends 2011‑10‑04 (**E**) |
| LAS `temp` (GODAS reanalysis) | monthly hindcast; ends 2023‑12‑15 |
| LAS "NOAA High Resolution SST AVHRR only" | current (to 2026‑08‑11) but **surface only** and NOAA‑owned, not an INCOIS product |

---

## 4. Salinity Dataset Availability

**Salinity availability is identical to temperature** — it is the *same* datasets:

- `incois_argo_10day_McCreary` / `incois_argo_10d_VAM` — `S_ANALYZED` / `SAL`, PSU, 24 levels
  5–2000 m, latest **2026‑07‑30**, **Access class A**, verified pull (35.90 PSU at 5 m).
- Monthly variants — latest **2026‑07‑15**, **A**.
- INCOIS‑GODAS — `Salinity` + `sea surface salinity`, 40 levels, but latest **2025‑05‑22** and
  interface unreliable (**B/D**).

**No independent INCOIS salinity dataset exists.** There is no INCOIS satellite salinity product.
Moored‑buoy salinity profiles (to ~500 m) exist but are *"visualisation only, no download"* per
INCOIS Data Holdings (**E** for our purposes).

**Depth note:** below 2000 m there is no Argo salinity; the verified full‑column pull returned
`NaN` from 1600 m downward at the sample point (float sampling), so real coverage is often
shallower than the nominal 2000 m maximum.

---

## 5. Chlorophyll Dataset Availability

This section resolves the D1 open item ("ChloroGIN‑IO machine‑readable access not yet verified").
**Outcome: still not available as an open machine‑readable INCOIS dataset.**

### 5.1 INCOIS Oceansat‑2 OCM — machine‑readable but discontinued and restricted

| Field | Value |
| --- | --- |
| Name / ID | *"INCOIS Oceansat 2 OCM Data"* · ERDDAP `incois_oceansat2_datasets` · LAS *"OCM 2"* (`id-b36be55868`) |
| Exists / accessible? | Yes / **Yes** (public ERDDAP `griddap`, verified request) |
| Variables | `CHL` (chlorophyll‑a, mg/m³), `KD490`, `TSM` |
| Earliest → Latest | 2011‑02‑02 → **2020‑05‑01** — **no data for >5 years** |
| Spatial | lon 46.68–99.32°E, lat 0.11–27.89°N; step ≈0.04° (~4 km) — North Indian Ocean only, no southern hemisphere |
| Data type | satellite (Oceansat‑2 OCM), historical |
| Restriction | INCOIS Data Holdings marks OCM chlorophyll *"Restricted; as per DoS guidelines"* → **not redistributable** by BlueNexus |
| **Access class** | **E** for current data. The historical archive is technically **A** to read, but the DoS restriction makes it unsuitable as a BlueNexus source. |

### 5.2 INCOIS IRS‑P4 OCM chlorophyll — historical only

ERDDAP `IRS_chlorophyll_datasets` / LAS *"OCM 1 DATA"*. `IRS P4 OCM-Chlorophyll`, 2003‑01‑05 →
**2006‑03‑21**. **Access class E.**

### 5.3 INCOIS Ocean Colour Products (ChloroGIN‑IO) — live service, but viewer + email only

| Field | Value | Evidence |
| --- | --- | --- |
| Name | *"Ocean Colour Products (previously known as ChloroGIN)"* — Standard Products & Value Added Products | `ChloroGIN.jsp`, `ChloroGIN_SP.jsp`, `ChloroGIN_VP.jsp` |
| Source sensor | MODIS‑Aqua (NASA GSFC data) | `ChloroGIN.jsp` |
| Products in the viewer | Standard: ANGSTROM, AOT, BRS, CDOM, **CHL**, FLH, IPAR, K490, PAR, PIC, POC, SST · Value‑added: adds ABI, BI, Phyto, TSM | `ChloroGIN_SP.jsp` / `_VP.jsp` product selectors |
| Viewer controls | "Select Product", "Select Region", "Select Resolution" | `ChloroGIN_SP.jsp` |
| Classification | satellite‑derived, **near‑real‑time (NRT)** (INCOIS's own wording), surface only | `ChloroGIN.jsp` |
| Machine‑readable feed | **None found.** No ERDDAP/LAS entry for a current INCOIS chlorophyll product. The pages expose only the viewer. | ERDDAP + LAS catalog review |
| Archive access | **"For archive data kindly contact samanta.a@incois.gov.in"** | `ChloroGIN_SP.jsp` (verbatim) |
| Resolution / domain / cadence / format | **Not stated by INCOIS anywhere** — Not currently verified | — |
| **Access class** | **C** (email request for archive) · a machine‑readable/download feed is **D. Not currently verified** | — |

### 5.4 Model chlorophyll (LAS "Corrected INCOIS BIO ROMS")

Sea‑surface chlorophyll from a biogeochemical ROMS model, lon 30–120°E ~1/12°, 1980‑01‑24 →
**2019‑12‑24**. Model, historical. **Access class B/D** (LAS catalog yes, OPeNDAP flaky). Not
suitable — it is a model output, not an observation, and it stops in 2019.

### 5.5 Non‑INCOIS fallbacks (for D3 to weigh — NOT adopted here)

| Source | Access | Notes |
| --- | --- | --- |
| ISRO **MOSDAC** — Oceansat‑3 (EOS‑06) OCM‑3 CHL | **C** — sign‑up at `mosdac.gov.in` | Current Indian sensor; 13‑band OCM; ~2‑day global revisit. The authoritative Indian *satellite* ocean‑colour route (SAC/NRSC), which INCOIS is not. |
| NASA **OB.DAAC** — MODIS‑Aqua / VIIRS / PACE L3 SMI | **A** — public (NetCDF, OPeNDAP, several ERDDAPs) | Same MODIS‑Aqua stream INCOIS's own product is built from; openly licensed. |

### 5.6 Chlorophyll conclusion

There is **no currently‑updating, openly‑accessible, machine‑readable INCOIS chlorophyll
dataset**. The live INCOIS product (Ocean Colour Products / ChloroGIN) is a viewer with
email‑request archive access; the machine‑readable INCOIS chlorophyll (Oceansat OCM) is both
stale and DoS‑restricted. D3 must either (a) obtain the ChloroGIN feed by request, or (b) adopt
a non‑INCOIS fallback (MOSDAC or NASA OB.DAAC).

---

## 6. Current Dataset Availability

D1 named three candidate current sources. Each is evaluated separately below; **none is currently
available to BlueNexus through a verified open machine interface.**

### 6.1 INCOIS‑GODAS (3‑D model currents) — the strongest INCOIS candidate, but impaired

| Field | Value | Evidence |
| --- | --- | --- |
| Name / ID | INCOIS‑GODAS · LAS *"Godas 2025"* `id-cbbdd5ab07` (also 2022/2023/2024 files) | LAS `getDatasets.do` |
| Current variables | `zonal current` (`U`), `meridional current` (`V`), `vertical velocity` (`WT`), + `Potential temperature`, `Salinity`, `SSH`, `MLD`, `SST`, `SSS` | LAS variable list |
| Exists? | **Yes** | LAS catalog |
| Accessible? | LAS **catalog** yes. LAS **OPeNDAP** (`/thredds/dodsC/…`) **timed out (>90 s, 0 bytes)** on repeated tries. FTP `ftpser.incois.gov.in` **denied anonymous login (530)**. | live tests 2026‑09‑05 |
| Earliest → Latest | 2003 (per `godas.jsp`); on LAS the newest file *"Godas 2025"* runs **2024‑12‑31 → 2025‑05‑22** | LAS `t` axis |
| Data lag on 2026‑09‑05 | **≈15.5 months** on the public LAS mirror (despite `godas.jsp` claiming "1‑day delayed daily") | LAS vs. `godas.jsp` |
| Spatial / vertical | Global · **40 levels 5–~4478 m** · 0.5° zonal / 0.25° meridional near the equator | LAS `z` axis; Ravichandran et al. 2013 |
| Data type | model analysis + 3DVAR data assimilation (Argo/buoy/XBT T&S in top 700 m; SST nudged to satellite) | `godas.jsp` |
| Update frequency | claimed daily (1‑day delay); **public mirror not current** | `godas.jsp` |
| Suitable for 3‑D viz? | In principle **yes** (full‑depth U/V/T/S), in practice blocked by staleness + OPeNDAP timeouts + FTP auth | — |
| **Access class** | LAS: **B/D** · FTP: **C** (contact Dr. Abhisek Chatterjee per `godas.jsp`) | — |

Also present: LAS `u` / `v` (GODAS/MOM **monthly reanalysis**, 40 levels, **1979‑01 → 2023‑12‑15**).
A consistent multi‑decadal hindcast — but not "current" and not a forecast.

### 6.2 INCOIS Argo Value‑Added geostrophic currents — discontinued

ERDDAP `incois_valueadded_products_datasets` — `GEO_U`, `GEO_V` (cm/s), surface geostrophic
currents derived from Argo, lon 30.5–119.5°E / lat 29.5°S–29.5°N / 1°. **Verified pull:** GEO_U =
21.5 cm/s, GEO_V = 3.95 cm/s at 10.5°N/72.5°E — but the latest timestamp is **2019‑03‑30**.
Publicly readable, no longer updated. **Access class E.** 2‑D surface only.

### 6.3 HF Radar / ICORN (observed coastal surface currents) — registration‑gated

| Field | Value | Evidence |
| --- | --- | --- |
| Name | Indian Coastal Ocean Radar Network (ICORN) / *"Coastal HF Radar"* | Data Holdings |
| Exists? | **Yes** — Data Holdings lists *"HF Radar — Current Vector — Real‑time — 2008 – till date"* | `dataholdings.jsp` |
| Machine endpoint? | **None found** — no ERDDAP/LAS/THREDDS entry; no open FTP/WMS discovered | ERDDAP + LAS review |
| Access mechanism | *"Registered access through Website"* → **signed Data Requisition Form** to Dr. Udaya Bhaskar TVS, Head, Ocean Data Management Division (`uday@incois.gov.in`), "Ocean Valley", Hyderabad | `dataholdings.jsp`; archived Data Requisition Form page (`drform.jsp`, 2024‑03 snapshot) |
| Parameters | surface current vectors (speed, direction, U/V) | Data Holdings ("Current Vector") |
| Resolution / cadence | ~6 km, hourly — **from peer‑reviewed literature, not an INCOIS page** (the INCOIS detail page is retired; only a ~2014 archived copy exists, which itself listed "2009–2013" and "02 active pairs") | literature; Web Archive |
| Coverage | Indian coastal waters ≤200 km offshore — AP, TN, Gujarat (Gulf of Khambhat), Odisha, Andaman | archived INCOIS page |
| Latest data / current station count | **Not verifiable** without access | — |
| Format | NetCDF (per archived INCOIS page) | Web Archive |
| **Access class** | **C — Registration/approval required** | — |

### 6.4 OSF / HOOFS forecast currents — web viewer only

| Field | Value | Evidence |
| --- | --- | --- |
| Products | OSF public parameters include **"Current Speed (m/s)"** and **SST (°C)**, MLD, D20 | `osf.jsp` |
| Model | HOOFS — ROMS 3.7 + LETKF; IO‑HOOFS 1/12° (~9.2 km) tropical Indian Ocean; NIO‑HOOFS 1/48° (~2.3 km) Arabian Sea + Bay of Bengal; 40 sigma levels; 3‑hourly to +5 days | `hoofs.jsp` |
| Dissemination | *"images and data posted on the Ocean State Forecast (OSF) services webpage"* — primary mode is the INCOIS website / interactive maps | `hoofs.jsp` |
| Machine endpoint? | **None verified.** No public OPeNDAP/ERDDAP/download. INCOIS runs a GeoServer at `incois.gov.in/geoserver` but an anonymous `GetCapabilities` returned **HTTP 403**. | live test |
| **Access class** | **D — Not currently verified** for gridded data | — |

### 6.5 OMNI / RAMA moored‑buoy currents — no INCOIS download

Currents to ~100 m at ~12 point moorings. INCOIS Data Holdings: *"Public Access with only
visualisation option. No download option."* The RAMA subset is downloadable from **NOAA/PMEL**
(`pmel.noaa.gov/tao/drupal/disdel/`), not INCOIS. **Access class E via INCOIS; B via PMEL.**
Point data only — not a field.

### 6.6 Currents conclusion

| Candidate | Available now via open interface? | Class |
| --- | --- | --- |
| INCOIS‑GODAS (LAS) | No — latest 2025‑05‑22, OPeNDAP timing out | B/D |
| INCOIS‑GODAS (FTP) | No — anonymous denied | C |
| Argo geostrophic (ERDDAP) | Readable but ends 2019‑03‑30 | E |
| HF Radar / ICORN | No — Data Requisition Form required | C |
| OSF / HOOFS gridded | No — web viewer only, GeoServer 403 | D |
| Moored buoys (INCOIS) | No — visualisation only | E |

**No INCOIS current dataset is currently usable by BlueNexus without a data request, credentials,
or accepting stale data.** This is the single biggest gap coming out of D2.

---

## 7. ERDDAP Availability

**Server:** `https://erddap.incois.gov.in/erddap/` — **ERDDAP v2.30**, reachable and responsive
on 2026‑09‑05 (see §10 for the TLS nuance). **16 data products + the `allDatasets` catalog;
every dataset reports `accessible = public`** (no login, no key). Verified by real `griddap`
data requests, not just metadata.

| Dataset ID | Title | Struct | Variables (BlueNexus‑relevant) | Lon | Lat | Depth | Time span | Suitable? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `incois_argo_10day_McCreary` | INCOIS ARGO 10 Day (Kessler‑McCreary) | grid | **`T_ANALYZED`**, **`S_ANALYZED`** (+ stats) | 30.5–119.5°E | 29.5°S–29.5°N | 24 lvl, 5–2000 m | 2001‑01‑10 → **2026‑07‑30** | **Yes (T + S)** |
| `incois_argo_10d_VAM` | INCOIS ARGO 10 day (VAM) | grid | **`TEMP`**, **`SAL`** (+ err) | 30.5–119.5°E | 29.5°S–29.5°N | 24 lvl, 5–2000 m | 2004‑01‑10 → **2026‑07‑30** | **Yes (T + S)** |
| `incois_argo_mnt_McCreary` | INCOIS ARGO Monthly (Kessler‑McCreary) | grid | `T_ANALYZED`, `S_ANALYZED` | 30.5–119.5°E | 29.5°S–29.5°N | 24 lvl, 5–2000 m | 2001‑01‑15 → **2026‑07‑15** | Yes (coarse time) |
| `incois_argo_mnt_VAM` | INCOIS ARGO Monthly (VAM) | grid | `TEMP`, `SAL` | 30.5–119.5°E | 29.5°S–29.5°N | 24 lvl, 5–2000 m | 2004‑01‑15 → **2026‑07‑15** | Yes (coarse time) |
| `incois_valueadded_products_datasets` | INCOIS Value Added Products | grid | `GEO_U`, `GEO_V` (cm/s), `MLD`, `D20`, `D26`, `HTCNT`, `DYN_HT` | 30.5–119.5°E | 29.5°S–29.5°N | surface | 2004‑01‑10 → **2019‑03‑30** | No (stale; surface geostrophic) |
| `incois_oceansat2_datasets` | INCOIS Oceansat 2 OCM | grid | **`CHL`**, `KD490`, `TSM` | 46.7–99.3°E | 0.1–27.9°N | surface | 2011‑02‑02 → **2020‑05‑01** | No (discontinued + DoS‑restricted) |
| `IRS_chlorophyll_datasets` | IRS P4 OCM‑Chlorophyll | grid | `IRS P4 OCM-Chlorophyll` | 60.0–103.9°E | 0.0–26.0°N | surface | 2003‑01‑05 → **2006‑03‑21** | No (historical) |
| `Indian_ARGO_Floats` | INDIAN ARGO Floats Data | table | `TEMP`,`PSAL`,`PRES` + `*_ADJUSTED` + QC | −180…180 | −70…48 | profile | 2002‑10‑24 → **2025‑04‑23** | Schema only (16‑month lag) |
| `incois_argo_sst_weekly` | INCOIS argo SST data Weekly | grid | `ASST` | 30–120°E | 30°S–30°N | surface | 2009‑01‑07 → 2010‑12‑29 | No (historical) |
| `NOAA_AVHRR_AMSR_datasets` | Daily‑OI‑V2 (AVHRR+AMSR) | grid | `sst`, `anom` | 20.1–139.9°E | 29.9°S–29.9°N | surface | 2002‑06‑01 → 2011‑10‑04 | No (historical) |
| `AMSRE_MONTHLY_GLOBAL`, `incois_tmi_3day_datasets`, `incois_quickscat_*`, `ascat_*` | AMSR‑E / TMI / QuikSCAT / ASCAT | grid | SST (historical) / winds | global / IO | — | surface | all end 2009–2023 | No (winds / historical SST) |

**Does ERDDAP have it?**

| Parameter | On INCOIS ERDDAP? | Current? |
| --- | --- | --- |
| **Temperature** | **Yes** — `incois_argo_10day_McCreary`, `incois_argo_10d_VAM`, monthly variants | **Yes — to 2026‑07‑30** |
| **Salinity** | **Yes** — same datasets (`S_ANALYZED` / `SAL`) | **Yes — to 2026‑07‑30** |
| **Currents** | Only surface geostrophic (`GEO_U`/`GEO_V` in `incois_valueadded_products_datasets`) | **No — ends 2019‑03‑30**. No 3‑D currents, no GODAS on ERDDAP. |
| **Chlorophyll** | Only historical (`incois_oceansat2_datasets` to 2020‑05; `IRS_chlorophyll_datasets` to 2006) | **No** |

**Dataset exists ≠ Claude's environment can access it.** In this case they coincided for ERDDAP —
every relevant ERDDAP dataset was both listed *and* returned real data. The gap is content
(currents/chlorophyll are stale on ERDDAP), not connectivity.

---

## 8. Temporal Availability

"Latest data" and "data lag" are as observed on **2026‑09‑05**. Per D2 rules, nothing here is
called "real‑time" — INCOIS applies the term "near real‑time" **only** to its Ocean Colour
Products, and even that could not be verified against a machine feed.

| Dataset | Earliest Data | Latest Data | Update Frequency | Data Lag (2026‑09‑05) |
| --- | --- | --- | --- | --- |
| ERDDAP `incois_argo_10day_McCreary` (T/S) | 2001‑01‑10 | **2026‑07‑30** | new 10‑day field; cadence not officially published (observed ≈ monthly regen) | ~37 days |
| ERDDAP `incois_argo_10d_VAM` (T/S) | 2004‑01‑10 | **2026‑07‑30** | as above | ~37 days |
| ERDDAP `incois_argo_mnt_McCreary` / `_VAM` (T/S) | 2001‑01 / 2004‑01 | **2026‑07‑15** | monthly | ~7 weeks |
| LAS *"Godas 2025"* (T/S/U/V, 3‑D) | 2003 (service); file from 2024‑12‑31 | **2025‑05‑22** | claimed daily (1‑day delay); **public mirror not current** | **≈15.5 months** |
| LAS `temp` / `sal` / `u` / `v` (GODAS reanalysis, monthly) | 1979‑01‑15 | **2023‑12‑15** | monthly (hindcast) | ≈21 months (not intended to be current) |
| ERDDAP `incois_valueadded_products_datasets` (geostrophic U/V) | 2004‑01‑10 | **2019‑03‑30** | was 10‑day; **not updated** | ≈6.5 years |
| ERDDAP `incois_oceansat2_datasets` (CHL) | 2011‑02‑02 | **2020‑05‑01** | was ~daily/composite; **discontinued** | ≈5.3 years |
| ERDDAP `Indian_ARGO_Floats` (profiles) | 2002‑10‑24 | **2025‑04‑23** | **not current** | ≈16 months |
| INCOIS Ocean Colour Products (ChloroGIN, CHL) | MODIS era (2007–) | **not machine‑discoverable** | INCOIS says "NRT" | Not verified |
| HF Radar / ICORN | 2008/2009 | **not machine‑discoverable** | hourly (literature) | Not verified |
| OSF / HOOFS forecast (currents, SST) | — | daily run, forecast to +5 (–10) days | daily | forecast product (no "lag" concept); gridded data not accessible |
| LAS "NOAA High Resolution SST AVHRR only" (context) | 1981‑09‑01 | **2026‑08‑11** | daily | ~25 days |
| LAS "AMSR2 3‑Day composite" SST (context) | 2012‑07‑02 | **2026‑08‑28** | 3‑day composite | ~8 days |

---

## 9. Spatial and Depth Availability

**Frontend target box** (from `frontend/src/data/temperatureDataset.ts`): latitude −35…25,
longitude 40…100, depth 0–5000 m.

| Dataset | Longitude | Latitude | Covers frontend box? | Depth | Levels |
| --- | --- | --- | --- | --- | --- |
| INCOIS Argo gridded (10‑day & monthly) | 30.5–119.5°E | 29.5°S–29.5°N | **Mostly** — the strip **35°S–29.5°S is outside coverage**; **no data below 2000 m** | 5–2000 m | 24 (uneven) |
| INCOIS‑GODAS | global | global | Yes | 5–~4478 m | 40 (27 in upper 400 m) |
| INCOIS‑GODAS monthly reanalysis | global | global | Yes | 5–~4478 m | 40 |
| INCOIS Oceansat‑2 OCM (CHL, historical) | 46.7–99.3°E | 0.1–27.9°N | **Northern half only** — no southern hemisphere | surface | — |
| INCOIS Value‑Added geostrophic (historical) | 30.5–119.5°E | 29.5°S–29.5°N | mostly (as Argo) | surface | — |
| HF Radar / ICORN | Indian coast, ≤200 km offshore | 5 coastal segments | narrow coastal strips only | surface | — |
| LAS "NOAA High Resolution SST AVHRR only" (context) | 20.1–139.9°E | 69.9°S–29.9°N | Yes | surface | — |

**Depth implications for the 3‑D scene**

- The only depth‑resolved INCOIS observational data (Argo) reaches **2000 m nominal**, often less
  in practice (`NaN` below the deepest float sample at a given location). The frontend's 2000–5000 m
  range would be empty unless GODAS (model) is used.
- Argo depth levels are **uneven and thin near the surface** (5, 10, 20, 30, 50 m…) — this matches
  the frontend's stated intent ("thins towards the surface, where a real thermocline carries most
  of its structure") but the *specific* levels differ from the frontend's demo axis
  (`0, 50, 100, 250, 500, 1000, …`), so a resample is required (D3).
- GODAS sigma‑to‑z is not an issue for the LAS product (it is served on z‑levels 5–4478 m), but
  HOOFS is on **40 terrain‑following sigma levels** and would need vertical interpolation.

---

## 10. Access Restrictions

### 10.1 Registration / authentication / request gates

| Resource | Gate |
| --- | --- |
| INCOIS ERDDAP (all datasets) | **None** — `accessible = public`, verified by anonymous data requests |
| INCOIS LAS catalog (`getDatasets.do`) | **None** — public, fast |
| INCOIS LAS OPeNDAP (`/thredds/dodsC/…`) | No auth, **but see 10.3 — requests timed out** |
| INCOIS‑GODAS FTP (`ftpser.incois.gov.in`) | **Anonymous login denied (FTP 530)** → credentials/approval; `godas.jsp` says contact Dr. Abhisek Chatterjee |
| HF Radar / ICORN | **Signed Data Requisition Form** → Head, Ocean Data Management Division (`uday@incois.gov.in`) |
| INCOIS Ocean Colour archive (chlorophyll) | **Email request** → `samanta.a@incois.gov.in` |
| Digital Ocean (`do.incois.gov.in`) | **JWT login required** — the SPA redirects to `/login` on 401; no anonymous data |
| OMNI / RAMA moored buoys (INCOIS) | **No download offered at all** (visualisation only) |
| OSF / HOOFS gridded forecast | No public download found; GeoServer `GetCapabilities` → **HTTP 403** |
| MOSDAC (fallback) | **Sign‑up required** at `mosdac.gov.in` |
| NASA OB.DAAC (fallback) | Public (Earthdata login for bulk/authenticated APIs; L3 via ERDDAP is open) |

### 10.2 Usage restrictions

- **INCOIS site disclaimer** (`disclaimer.jsp`, verbatim): *"Reproducing the material published in
  this website for commercial purpose is not permitted, unless and otherwise permission is
  obtained from the competent authority."* → BlueNexus must confirm non‑commercial use or obtain
  permission.
- **INCOIS ERDDAP dataset license** (per‑dataset attribute): *"The data may be used and
  redistributed for free but is not intended for legal use, since it may contain inaccuracies…"*
- **OCM / Oceansat chlorophyll**: *"Restricted; as per DoS guidelines"* (Data Holdings) — do not
  redistribute.
- **MODIS‑Aqua** (source of the INCOIS Ocean Colour Products): NASA GSFC data, acknowledged by
  INCOIS *"for research purpose"*.
- **Argo data** (gridded product inputs): the standard Argo data statement applies (freely
  available; acknowledge Argo + the national programmes).

### 10.3 Certificate / TLS / connectivity issues (documented, not treated as "unavailable")

| Observation | Detail | Impact |
| --- | --- | --- |
| **INCOIS ERDDAP omits the intermediate CA cert** | `openssl s_client` → *"Verify return code: 21 (unable to verify the first certificate)"*. Leaf `CN=*.incois.gov.in`, issuer `GlobalSign RSA OV SSL CA 2018`, but the server sends only the leaf. | **`curl` and Python `urllib` connect fine (HTTP 200)** — they chase/complete the chain. A strict TLS stack (Node/undici — used by the D1 research tool) fails without the intermediate supplied. **D3 backend client must be tested; may need the GlobalSign intermediate bundled.** ERDDAP is **not** "unavailable" — it is fully usable from standard clients. |
| **LAS OPeNDAP (`/thredds/dodsC/`) timed out** | `.dds` requests for the Argo and GODAS journals returned **0 bytes after 90 s** on repeated attempts. The LAS `getDatasets.do` catalog (17 MB JSON) returned fine. | LAS OPeNDAP is **not practically usable from this environment right now**. Unknown whether this is the server (Ferret/F‑TDS backend) or this network. **ERDDAP is the reliable machine route for the Argo product.** |
| **LAS `ProductServer.do`** | HTTP 500 on a minimal/malformed request XML. | The LAS Ferret product API needs a correctly‑formed request; use ERDDAP or OPeNDAP instead. |
| **`incois.gov.in/geoserver`** | Anonymous `GetCapabilities` → **HTTP 403**. | INCOIS runs a GeoServer but it is not anonymously queryable — WMS/WFS access unverified. |
| **DNS resolution limits in this environment** | `odis.incois.gov.in` (cited by search results as the ODIS in‑situ portal) and several guessed subdomains (`oceancolor.`, `thredds.`, `data.`, `argo.`…) **did not resolve** here. `do.incois.gov.in` failed to connect on the first attempt, then succeeded later. | **Absence of resolution here is not proof the host is down.** `odis.incois.gov.in` and its HF‑radar data‑access page must be re‑checked from a normal network in D3. |
| Internal INCOIS hostnames | `services.incois.gov.in` / `vacancies.incois.gov.in` (in search results) resolve to private IPs (172.16.x) — **not public**; do not hard‑code. `/portal/*` on the public host is retired (404). | Use `incois.gov.in`, `erddap.incois.gov.in`, `las.incois.gov.in`, `do.incois.gov.in`. |

---

## 11. D2 Recommendations

> **These are D2 availability recommendations — what is usable *today* — not final architecture
> decisions. D3 confirms access mechanics; the architecture choice is later still.**

| Parameter | Best *available* dataset (D2) | Access | Confidence |
| --- | --- | --- | --- |
| **Temperature** | **INCOIS Argo 10‑Day gridded, Kessler–McCreary** — ERDDAP `incois_argo_10day_McCreary`, variable `T_ANALYZED` | **A — public, verified**, ERDDAP `griddap` → NetCDF/CSV, to 2026‑07‑30 | **High** |
| **Salinity** | **Same dataset**, variable `S_ANALYZED` (PSU) | **A — public, verified** | **High** |
| **Chlorophyll** | **None currently suitable from INCOIS.** Availability recommendation: (1) in D3, request the INCOIS Ocean Colour Products feed (`samanta.a@incois.gov.in`) and determine format/resolution/cadence; (2) for interim wiring only, the historical `incois_oceansat2_datasets` is the sole real INCOIS chlorophyll NetCDF (stale to 2020‑05, DoS‑restricted — not for redistribution); (3) carry a non‑INCOIS fallback (NASA OB.DAAC public, or MOSDAC Oceansat‑3 with sign‑up). | ChloroGIN archive **C** · fallbacks **A**/**C** | **Low — unresolved** |
| **Ocean Currents** | **No INCOIS current dataset is currently usable via an open interface.** Ranked by potential: (1) **INCOIS‑GODAS** — best data content (3‑D U/V/T/S, 40 levels) but **stale to 2025‑05‑22** on LAS and LAS OPeNDAP is timing out; D3 must test the FTP with credentials and confirm whether an operational near‑current feed exists; (2) **OSF/HOOFS** — highest resolution + genuine forecast, but **no machine endpoint verified** (GeoServer 403); (3) **HF Radar / ICORN** — observed, but **Data Requisition Form required**, coastal only. | GODAS LAS **B/D** / FTP **C** · HOOFS **D** · HF Radar **C** | **Low — unresolved** |

**Cross‑cutting recommendation:** the Argo gridded temperature/salinity dataset is the one place
where D2 → D3 can proceed without an access negotiation. Sequence D3 so that temperature/salinity
ingestion is designed first (against ERDDAP `griddap`), while chlorophyll and currents run in
parallel as **access‑resolution tasks** (emails, credential requests, fallback evaluation).

---

## 12. D2 Unknowns (to resolve in D3)

1. **INCOIS Ocean Colour Products (chlorophyll) — machine access.** Does an FTP/WMS/download feed
   exist for CHL? What resolution, domain, cadence, and file format? What does the
   `samanta.a@incois.gov.in` archive request actually provide, and how quickly? (Currently: viewer
   + email only; everything else unstated.)
2. **INCOIS‑GODAS — real currency and FTP access.** `ftpser.incois.gov.in` denied anonymous login
   (530). Are credentials issued on request (contact on `godas.jsp`)? Is the operational feed
   actually ~1‑day‑delayed as claimed, given LAS stops at 2025‑05‑22? What is the FTP directory
   layout and file granularity?
3. **LAS OPeNDAP reliability.** Requests timed out (>90 s) from this environment. Is the LAS
   `/thredds/dodsC/` (Ferret F‑TDS) backend generally slow/broken, or is this a local network
   issue? If it works elsewhere it becomes a viable GODAS route.
4. **HF Radar / ICORN.** The Data Requisition Form process — turnaround, whether approved users get
   a scriptable endpoint (FTP/HTTP) or only manual files, current number of operational radar
   stations, the true grid resolution from an INCOIS source (not literature), and the public
   archive latency.
5. **OSF / HOOFS gridded forecast.** Is there *any* OPeNDAP / WMS / download for forecast currents
   and SST? Can the GeoServer (`incois.gov.in/geoserver`, currently 403) be accessed with a
   referer/whitelist or an account?
6. **Digital Ocean (`do.incois.gov.in`).** What datasets and formats does it expose behind the JWT
   login? Is an account obtainable for a project like BlueNexus? Does it offer bulk/multi‑format
   download of gridded model + satellite data as its launch material claims?
7. **INCOIS ERDDAP TLS from the backend.** Confirm the chosen backend HTTP client (httpx / aiohttp /
   requests) completes the chain despite the missing intermediate; if not, bundle the GlobalSign
   `RSA OV SSL CA 2018` intermediate.
8. **Argo gridded update cadence.** INCOIS publishes no fixed schedule — observe over a few weeks
   to characterise it (new 10‑day step frequency and typical lag).
9. **`odis.incois.gov.in` reachability and content** — did not resolve here; re‑check from a normal
   network (it is the documented ODIS in‑situ / HF‑radar data‑access portal).
10. **Licensing for BlueNexus specifically.** Is the intended use non‑commercial (covered by the
    INCOIS disclaimer) or does it need written permission? Required citations/acknowledgements for
    each dataset.
11. **Southern‑hemisphere gap.** The frontend box reaches 35°S; Argo gridded stops at 29.5°S. Decide
    whether to clip the scene, or backfill the strip from GODAS.

---

## 13. D2 Status

**D2 STATUS: COMPLETE**

| D2 completion criterion | Met? | Notes |
| --- | --- | --- |
| Actual dataset availability investigated for all four parameters | ✅ | Temperature, salinity, chlorophyll, currents each investigated against live ERDDAP + LAS catalogs and (where reachable) real data requests |
| Serious candidate datasets evaluated | ✅ | Argo 10‑day (McCreary + VAM), Argo monthly, INCOIS‑GODAS (operational + reanalysis), Argo geostrophic, HF Radar/ICORN, OSF/HOOFS, moored buoys, Oceansat‑2/IRS OCM, ChloroGIN, BIO‑ROMS, + non‑INCOIS fallbacks |
| Current/latest availability investigated where possible | ✅ | Verified data pulls returned values dated 2026‑07‑30 (Argo T/S), 2020‑05‑01 (OCM CHL), 2019‑03‑30 (geostrophic U/V); GODAS latest 2025‑05‑22 from catalog |
| Spatial / depth / temporal coverage documented | ✅ | §§8–9 |
| Access classification assigned | ✅ | §2 matrix + per‑dataset in §§3–7 (A–E scheme) |
| Unknowns explicitly documented | ✅ | §12 (11 items) |
| No ingestion / API / frontend implementation performed | ✅ | Read‑only investigation; only file created is this document |

### Files created / modified

- **Created:** `docs/data-availability.md` (this file)
- **Unchanged:** `docs/data-sources.md` (D1) — not edited, not deleted
- No code, config, or frontend files touched.

### What was discovered (short form)

- **Temperature + salinity are solved for availability:** the INCOIS Argo gridded analysis is
  live on ERDDAP, public, current to 2026‑07‑30, depth‑resolved (24 levels 5–2000 m), and
  returned real data on request. One dataset covers both parameters.
- **Chlorophyll has no currently‑usable INCOIS machine dataset:** the machine‑readable INCOIS
  chlorophyll (Oceansat OCM) ended in 2020 and is DoS‑restricted; the live ChloroGIN service is a
  viewer with email‑request archive access.
- **Currents have no currently‑usable INCOIS open interface:** GODAS (the only 3‑D field) is
  stale on LAS (2025‑05‑22) and its OPeNDAP timed out; HF Radar and OSF/HOOFS need a data request
  or account.
- **The D1 "ERDDAP TLS problem" is milder than feared:** the server omits an intermediate cert,
  but `curl` and Python connect normally; only strict stacks (Node/undici) fail.

### Important limitations

- LAS OPeNDAP and `ftpser.incois.gov.in` could not be exercised (timeouts / auth) — GODAS
  currency and FTP access remain unverified.
- `odis.incois.gov.in` and `do.incois.gov.in` behaviour is partly limited by DNS/connectivity in
  this environment; findings there are provisional.
- HF Radar and ChloroGIN specifics (resolution, cadence, latency, station count) come from
  literature/older archives, not current INCOIS pages.

**Do not proceed to D3 automatically.**
