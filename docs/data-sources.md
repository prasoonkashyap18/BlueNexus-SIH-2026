# BlueNexus Official INCOIS Data Sources

**Data Track step:** D1 — Identify and Lock Official INCOIS Data Sources
**Type:** Research and documentation only. No pipeline, no API integration, no frontend change.
**Prepared:** 2026-09-05
**Scope:** Temperature, Salinity, Chlorophyll, Ocean Currents — the four core BlueNexus parameters
(the frontend `OceanVariable` set is `temperature | salinity | currentSpeed | chlorophyll`).

---

## 0. How this was verified

Every "official INCOIS source" below was checked against an `incois.gov.in` page or an
INCOIS-operated service (`erddap.incois.gov.in`, `las.incois.gov.in`) on 2026-09-05. Where a
fact is stated by INCOIS it is cited to the INCOIS URL. Where a fact comes only from
peer‑reviewed literature, a third party, or an older archived INCOIS page, it is labelled as
such. Anything that could not be confirmed from a current official INCOIS source is marked
**"Not yet verified"** rather than guessed.

Primary INCOIS references used:

| Ref | URL | What it establishes |
| --- | --- | --- |
| Data Holdings | `https://incois.gov.in/site/dataholdings.jsp` | Master table of every INCOIS dataset: parameters, mode, availability, format, accessibility |
| Ocean Observation Network | `https://incois.gov.in/site/datainfo/OON.jsp` | INCOIS = National Oceanographic Data Centre, National + Regional Argo Data Centre |
| OMNI–RAMA Joint Portal | `https://incois.gov.in/site/datainfo/jointportal.jsp` | Moored‑buoy network (OMNI/RAMA) parameters and access |
| Ocean State Forecast | `https://incois.gov.in/site/services/osf.jsp` | Operational forecast parameters (currents, SST) and cadence |
| HOOFS | `https://incois.gov.in/site/datainfo/modelling/hoofs.jsp` | Operational ROMS ocean model: resolution, levels, DA, products |
| INCOIS‑GODAS | `https://incois.gov.in/site/datainfo/modelling/godas.jsp` | Global MOM4 analysis: T/S/currents full depth, FTP + LAS access |
| Ocean Colour Products (ChloroGIN) | `https://incois.gov.in/site/services/ChloroGIN.jsp` | MODIS‑Aqua NRT chlorophyll service |
| Remote Sensing | `https://incois.gov.in/site/datainfo/remotesensing.jsp` | Satellite product dissemination (SST, ocean colour) |
| ERDDAP | `https://erddap.incois.gov.in/erddap/` | Machine‑readable grid/table server; 16 data products (+ the catalog), all `accessible = public` |
| Live Access Server | `https://las.incois.gov.in/` | LAS + OPeNDAP/THREDDS (`/thredds/`); 52 dataset entries |
| Disclaimer | `https://incois.gov.in/site/disclaimer.jsp` | Usage restriction (no commercial reproduction without permission) |

---

## 1. Source Summary

| Parameter | Official INCOIS Source | Data Type | Resolution | Depth | Update | Format | Access Method |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Temperature** | INCOIS Argo gridded analysis — "ARGO 10 Day / Monthly data" (Kessler–McCreary & Variational Analysis methodologies) | Observational (Argo floats), objectively analysed / gridded. **Not real‑time** — periodic analysis | 1° × 1° | 24 levels, 5 m → 2000 m | New 10‑day (or monthly) field added periodically; latest field lags ≈ 4–6 weeks (see §7) | NetCDF (native); via ERDDAP also CSV/JSON/GeoTIFF/PNG | ERDDAP `griddap` (REST subsetting), LAS OPeNDAP/THREDDS. **No auth.** Verified working. |
| **Salinity** | Same INCOIS Argo gridded analysis (variables `S_ANALYZED` / `SAL`) | Same as temperature | 1° × 1° | 24 levels, 5 m → 2000 m | Same as temperature | NetCDF | Same as temperature. **No auth.** |
| **Chlorophyll** | INCOIS Ocean Colour Products (formerly ChloroGIN‑IO), from **MODIS‑Aqua**, run by OCAT/ADPC | Satellite‑derived, **near‑real‑time (NRT)**. Surface only (no depth) | **Not stated by INCOIS** (MODIS‑Aqua L3 is generically ~4 km — Not yet verified for this product) | Surface (2‑D field) | NRT + composites (cadence Not yet verified) | Not stated by INCOIS (Data Holdings lists HDF/netCDF/GeoTIFF/JPEG/ASCII for satellite products generally) | Web viewer (`ChloroGIN_SP.jsp`). Machine‑readable endpoint **Not yet verified** — see §6. Historic Oceansat‑2 series is on ERDDAP but ended 2020‑05. |
| **Currents** | Primary observed (coastal surface): **INCOIS HF Radar network (ICORN)**. Primary 3‑D: **INCOIS‑GODAS** (global MOM4 analysis). Forecast surface: **OSF / HOOFS**. | HF radar = observational (real‑time acquisition). GODAS = model analysis + data assimilation. HOOFS/OSF = model forecast. | HF radar: hourly, ~6 km (6 km from literature, Not yet verified from INCOIS). GODAS: 0.5° zonal / 0.25° meridional near equator. HOOFS: 1/12° (IO) & 1/48° (NIO). | HF radar: surface only. GODAS: 40 levels, surface → ~4478 m. HOOFS: 40 sigma levels. OMNI buoys: currents to ~100 m. | HF radar: real‑time acquisition; public latency undocumented. GODAS: INCOIS states "1‑day delayed daily" (public mirror currency Not yet verified). HOOFS/OSF: daily run, 3‑hourly steps, +5 days. | HF radar: NetCDF. GODAS: NetCDF. OSF: web maps. | HF radar: **registered access / on request**. GODAS: INCOIS FTP `ftpser.incois.gov.in` + LAS (contact named on page). OSF: web viewer. |

> **U/V question (currents):** INCOIS‑GODAS and HOOFS provide **U and V components** (zonal & meridional current) plus, in GODAS, vertical velocity. HF radar provides **surface current vectors** (Data Holdings: *"Current Vector"*), i.e. speed + direction + U/V / radial components. OSF's public parameter is documented only as **"Current Speed (m/s)"** (magnitude) — direction is not named on the OSF page (it is conventionally drawn as map arrows, but that is not an INCOIS statement → *Not yet verified*). The gridded model outputs (GODAS, HOOFS) are the ones that give clean U/V for a visualization.

---

## 2. Temperature Source

### 2.1 Recommended official source — INCOIS Argo gridded analysis

**Official name (as it appears on INCOIS services):**
- ERDDAP: *"INCOIS ARGO 10 Day data Kessler‑McCreary Methodology"* (`incois_argo_10day_McCreary`),
  *"INCOIS ARGO 10 day data Variational Analysis Methodology"* (`incois_argo_10d_VAM`), plus
  monthly equivalents (`incois_argo_mnt_McCreary`, `incois_argo_mnt_VAM`).
- LAS: *"ARGO DATA PRODUCTS (10 DAYS)"*, *"VAM 10DAY ARGO"*, *"ARGO DATA PRODUCTS (Monthly)"*, *"VAM MNT ARGO"*.
- INCOIS Data Holdings calls these *"Argo derived Products … Gridded product based on Kessler‑McCreary
  methodology / … Variational Analysis methodology"* under **LAS Products**.

**Why this is the authoritative INCOIS source.** INCOIS is the **National Argo Data Centre** and
**Indian Argo Regional Centre** (`OON.jsp`), and it is the agency that produces these objectively
analysed fields from the Argo float array. The Data Holdings page lists *"Argo Floats — Temperature
and Salinity Profiles — Real‑time — 2000 – till date — Public Access with visualisation, download
facilities for open Ocean data."*

**Evidence of parameters, grid, depth (from `erddap.incois.gov.in` dataset metadata, retrieved 2026‑09‑05):**

| Property | `incois_argo_10day_McCreary` | `incois_argo_10d_VAM` |
| --- | --- | --- |
| Temperature variable | `T_ANALYZED` (Objectively Analyzed Temperature) + `T_MEAN`, `T_STDEV`, `T_RMSE`, obs counts | `TEMP` + `TERR` (relative error) |
| Salinity variable | `S_ANALYZED` (Objectively Analyzed Salinity, PSU) + mean/stdev/RMSE/obs counts | `SAL` (PSU) + `SERR` |
| Horizontal grid | 1.0° × 1.0°, `geospatial_lat_resolution = 1.0`, `geospatial_lon_resolution = 1.0` | 1.0° × 1.0° |
| Domain | lon 30.5°E → 119.5°E, lat 29.5°S → 29.5°N | same |
| Depth axis `ZAX` | 24 levels, `5.0 … 2000.0` m, uneven spacing (5,10,20,30,50,75,100,125,150,200,250,300,400,500,600,700,800,900,1000,1200,1400,1600,1800,2000) | same 24 levels |
| Time axis | 921 steps, ≈ 10 days apart, `2001‑01‑10` → `2026‑07‑30` | `2004‑01‑10` → `2026‑07‑30` |
| Units | temperature `degs` (i.e. °C); salinity `PSU` | `degs`; `PSU` |
| `_FillValue` / `missing_value` | `9999.0` | `9999.0` |
| License (dataset attribute) | *"The data may be used and redistributed for free but is not intended for legal use, since it may contain inaccuracies…"* | same |

**Classification.** Observational (in‑situ Argo), objectively analysed onto a regular grid.
It is **not** "real‑time": it is a **periodically produced analysis**. On 2026‑09‑05 the latest
10‑day field was dated 2026‑07‑30, and the ERDDAP file `history` attribute showed the NetCDF was
regenerated on 2026‑08‑17 — i.e. a new 10‑day step is added roughly monthly with a lag of a few
weeks. INCOIS does not publish a fixed refresh schedule for this product → **update cadence "Not
yet verified" beyond "≈ 10‑day to monthly, few‑week latency"**.

**Machine‑readable access (verified 2026‑09‑05).**
- ERDDAP `griddap`, e.g.
  `https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.nc?T_ANALYZED[(2026-07-30)][(5.0):(2000.0)][(-29.5):(29.5)][(30.5):(119.5)]`
  — returns a subset NetCDF. `.json`, `.csv`, `.nc`, `.geotif`, `.png` and other response types
  are supported by ERDDAP. Scripted retrieval confirmed (time‑axis and data queries executed).
- LAS OPeNDAP/THREDDS: catalog at `https://las.incois.gov.in/thredds/catalog/las/catalog.html`
  (the Argo 10‑day product appears there under catalog id `id-a292ce89c6`).
- **Authentication:** none. All 17 INCOIS ERDDAP datasets report `accessible = public`.

**Fit to BlueNexus.** This product's shape (`time × depth × lat × lon`, one analysed value per
node, `_FillValue` land mask) is almost exactly the frontend's `TemperatureDataset`
(`values[time][depth][lat][lon]`, °C, regional Indian‑Ocean box). The demo generator in
`frontend/src/data/temperatureDataset.ts` is explicitly designed to be replaced by "a
NetCDF/xarray‑backed loader" — this is the dataset that loader should read.

### 2.2 Full‑depth alternative — INCOIS‑GODAS (see §5.3)

Global MOM‑4.0 analysis, 40 levels to ~4478 m, includes `Potential temperature`. Deeper than
Argo's 2000 m and daily rather than 10‑day, but coarser near the poles, model‑based, and the
public mirror currency is unverified.

### 2.3 High‑resolution surface layer (not INCOIS‑originated) — NOAA OISST via INCOIS LAS

INCOIS LAS re‑hosts *"NOAA High Resolution SST AVHRR only (data provided by NOAA OAR ESRL)"* —
daily SST + anomalies, ~0.25°, global, `1981‑09‑01 → 2026‑08‑11` (current as of retrieval).
Useful as an optional crisp surface field, but **NOAA, not INCOIS, is the authority** for it; keep
it clearly secondary.

### 2.4 Individual temperature profiles (for the observation panel)

- **Authoritative raw profiles:** the global Argo GDACs (Coriolis — `https://data-argo.ifremer.fr`
  / `ftp.ifremer.fr`; and US‑GODAE), NetCDF, FTP/HTTPS/S3, free, no auth. INCOIS's Indian‑Ocean
  float data flows into these as the India DAC.
- **INCOIS ERDDAP `Indian_ARGO_Floats`** (tabledap, Point): `PLATFORM_NUMBER`, `CYCLE_NUMBER`,
  time, lat/lon, `PRES`/`TEMP`/`PSAL` + `*_ADJUSTED` + QC flags. **Caveat:** latest profile in
  this table on 2026‑09‑05 was `2025‑04‑23` — it currently lags ≈ 16 months, so it is **not a
  live feed**. Use it for schema/wiring; use the global GDAC for currency.

---

## 3. Salinity Source

**Same product as temperature.** The INCOIS Argo gridded analysis carries salinity as a
first‑class variable in every variant:

- Kessler–McCreary: `S_ANALYZED` — *"Objectively Analyzed Salinity"*, `standard_name =
  sea_water_practical_salinity`, units **PSU**, same 1° × 1° grid, same 24 levels (5–2000 m),
  same 10‑day / monthly cadence.
- Variational Analysis: `SAL` (PSU) + `SERR`.

No separate salinity source is needed. Depth‑resolved salinity from INCOIS is **only** available
from Argo‑derived products (gridded analysis, or GODAS which assimilates it) — there is no
independent INCOIS satellite salinity product, and the moored‑buoy salinity (see §5.2) is
visualisation‑only with no download.

**Depth note.** Argo salinity, like temperature, is analysed 5–2000 m. Below 2000 m INCOIS has no
routine salinity observations; GODAS extends model salinity to the sea floor but that is a model
extrapolation.

---

## 4. Chlorophyll Source

### 4.1 Authoritative INCOIS source — Ocean Colour Products (ChloroGIN‑IO)

**Official page:** `https://incois.gov.in/site/services/ChloroGIN.jsp` — *"Ocean Colour Products
(previously known as ChloroGIN)"*.

**What INCOIS states (quoted / paraphrased from the page):**
- The **Ocean Colour Application Team (OCAT)** at INCOIS runs an **Automatic Data Processing Chain
  (ADPC)** for *"acquisition, processing and dissemination of ocean colour data products from
  **MODIS‑Aqua**"*.
- Standard products: **chlorophyll (CHL)**, diffuse attenuation coefficient at 490 nm (Kd490),
  aerosol optical thickness at 869 nm (AOT), sea surface temperature (SST), quasi‑true‑colour
  composites (BRS).
- Value‑added: total suspended matter (TSM), bloom indices (BI), rolled products, rolling anomaly
  in CHL and SST.
- Purpose: *"provide ocean colour data products to users at **near real‑time (NRT)**"* for research
  and operations such as **PFZ (Potential Fishing Zone) advisories**.
- Distributed to IOGOOS member states (India, Sri Lanka, Iran, Kenya, Maldives, Oman, Tanzania,
  Thailand). INCOIS is the ChloroGIN‑IO coordinating/implementing agency (endorsed by IOGOOS/GOOS).
- Acknowledgement on the page: *"OCAT at INCOIS humbly acknowledges NASA GSFC for making available
  MODIS‑Aqua data for research purpose."*

**Classification: satellite‑derived, near‑real‑time, surface only (2‑D).** Confirmed by INCOIS's
own "near real‑time (NRT)" wording. It is not model‑derived and not in‑situ. There is no vertical
dimension — chlorophyll is a surface ocean‑colour field.

**Supporting evidence from Data Holdings (`dataholdings.jsp`):**
- *"MODIS — Chlorophyll — Real‑time — 2007 – till date"* (Remote Sensing section; not flagged
  restricted).
- *"VIIRS — Chlorophyll and SST — Real‑time — April 2016 – till date — Non‑Sensitive"*.
- *"OCM‑2 — Chlorophyll — Real‑time — 2011 – till date — Restricted; as per DoS guidelines"*
  and *"OCM‑1 — Chlorophyll — 2000 – 2006 — Restricted; as per DoS guidelines"*.
- Satellite products' format column (shared): *HDF / netCDF / GeoTIFF / JPEG / ASCII*.

### 4.2 What is NOT verified for chlorophyll

| Item | Status |
| --- | --- |
| Spatial resolution of the INCOIS product | **Not yet verified.** The page gives no number. MODIS‑Aqua L3 is generically ~4 km but that is not an INCOIS statement. |
| Exact spatial domain / projection | **Not yet verified** (an image `images/ChloroGIN/ChloroGIN_Domain.jpg` shows a North‑Indian‑Ocean box; no coordinates stated). |
| Temporal cadence (daily / 3‑day / 8‑day / monthly composites) | **Not yet verified.** "NRT" + "rolled/rolling" products imply daily + composites but no schedule is published. |
| File format actually offered for CHL | **Not yet verified** (only the generic satellite format list). |
| Machine‑readable endpoint (FTP / WMS / download service) | **Not yet verified.** No current INCOIS chlorophyll dataset is on ERDDAP or LAS. The page exposes only viewer pages (`ChloroGIN_SP.jsp`, `ChloroGIN_VP.jsp`). |
| Whether automated retrieval is possible | **Not yet verified** — likely web viewer + request/FTP; must be established in D2. |
| Authentication | **Not yet verified.** |

### 4.3 Historic machine‑readable INCOIS chlorophyll (development use only)

- ERDDAP `incois_oceansat2_datasets` — *"INCOIS Oceansat 2 OCM Data"*: `CHL` (chlorophyll‑a,
  mg/m³), `KD490`, `TSM`. Grid ~46.7–99.3°E, 0.1–27.9°N. Time `2011‑02‑02 → 2020‑05‑01` —
  **discontinued.** Public, griddap. Also on LAS as *"OCM 2"*.
- ERDDAP `IRS_chlorophyll_datasets` — *"IRS P4 OCM‑Chlorophyll"*, `2003‑01 → 2006‑03` — historic.
- LAS *"Corrected INCOIS BIO ROMS"* — model sea‑surface chlorophyll, `1980 → 2019` — model, historic.

These are usable to build and test the chlorophyll‑ingestion code path against a real INCOIS
NetCDF, but **none is current**, and OCM/Oceansat chlorophyll is **DoS‑restricted** — do not adopt
it as the redistributable primary.

### 4.4 Upstream authority note

The ultimate Indian authority for *satellite* ocean colour (Oceansat‑3 / EOS‑06 OCM) is
**ISRO — NRSC / SAC**, disseminated via **MOSDAC (`mosdac.gov.in`)** and Bhoonidhi, not INCOIS.
INCOIS's authoritative role is specifically the **NRT MODIS‑Aqua‑derived ocean‑colour service**
above. If D2 cannot obtain a machine‑readable feed from INCOIS, the open, documented fallback is
**NASA OB.DAAC / OceanColor Web** (MODIS‑Aqua & VIIRS L3 SMI, NetCDF, ERDDAP/OPeNDAP, free) —
flagged here only as a fallback, not as an INCOIS source.

---

## 5. Ocean Current Source

INCOIS has **no single "the currents dataset"**. There are four distinct official sources, each
with a different role. BlueNexus will need to pick per use‑case.

### 5.1 INCOIS HF Radar network (ICORN) — observed surface currents, coastal

**Official name:** Indian Coastal Ocean Radar Network (ICORN) / *"Coastal HF Radar"*, operated by
INCOIS.
**Official page:** `https://incois.gov.in/site/dataholdings.jsp` (row *"HF Radar — Current Vector
— Real‑time — 2008 – till date — Registered access through Website"*). A dedicated description
page existed at `incois.gov.in/portal/datainfo/hfradar.jsp`; the `/portal/` tree is retired on the
public site (returns 404), and the text survives only in the Web Archive — treat that detail as
**archived, possibly stale**.

| Property | Value | Source / confidence |
| --- | --- | --- |
| Parameters | Surface **current vectors** — speed, direction, U/V (radial per station + combined total) | INCOIS Data Holdings ("Current Vector"); archived INCOIS page ("Surface currents") |
| Classification | Observational; *"received in real time at ESSO‑INCOIS, converted into … NetCDF and archived"* | Archived INCOIS HF‑radar page |
| Coverage | Indian coastal waters to ~200 km offshore; station pairs off Andhra Pradesh, Tamil Nadu, Gujarat (Gulf of Khambhat), Odisha, Andaman | Archived INCOIS page ("5 pairs … AP, TN, Gujarat, Orissa, Andaman") |
| Horizontal resolution | ~6 km grid | **Peer‑reviewed literature only — Not yet verified from an INCOIS page** |
| Temporal resolution | Hourly | Literature; archived INCOIS wording consistent |
| Depth | Surface only | — |
| Temporal coverage | Data Holdings: 2008 – till date. Archived page (≈2014): "2009 to 2013", "02 active pairs as on 31‑Jul‑2014" | **Current operational station count Not yet verified** |
| Format | NetCDF | Archived INCOIS page |
| Access | *"Registered access through Website"* / provided to researchers **on request** (Data Requisition Form) | INCOIS Data Holdings |
| Authentication | **Yes** — registration / request required | INCOIS Data Holdings |
| Automated retrieval | Not documented; no open API/FTP found | **Not yet verified** |

**Role in BlueNexus:** the only INCOIS *observed* current field. Best used as a coastal surface
overlay where the map is over Indian coastal waters. Not a basin‑scale source, and the registered
/ on‑request access makes it hard to automate — D2 must establish the request procedure and
whether a scriptable endpoint exists for approved users.

### 5.2 OMNI / RAMA moored buoys — observed currents with depth, point locations

**Official page:** `https://incois.gov.in/site/datainfo/jointportal.jsp` (MoES–NOAA OMNI–RAMA
Joint Data Portal).

- **Parameters:** *"vertical profiles of temperature, salinity (conductivity) and currents"* plus
  surface met and (selected buoys) waves. Data Holdings: *"Profiles of Temperature, Salinity up to
  500 m and Currents up to 100 m."*
- **Network:** ~12 OMNI buoys active at any time, Bay of Bengal and eastern Arabian Sea. Deployed
  by OOS‑NIOT; **data managed by INCOIS**. Legacy RAMA moorings (ADCP/ATLAS) also.
- **Classification:** observational, real‑time transmission. 1997 – present.
- **Access:** Data Holdings — *"Public Access with **only visualisation option. No download
  option.**"* RAMA subset is downloadable from **NOAA/PMEL** (GTMBA delivery portal
  `pmel.noaa.gov/tao/drupal/disdel/`), not from INCOIS.
- **Role in BlueNexus:** sparse validation / "observation panel" points only. **Not usable as a
  bulk gridded current source** — INCOIS offers no download; machine access to the RAMA subset is
  through PMEL, not INCOIS.

### 5.3 INCOIS‑GODAS — model currents, global, full depth (recommended 3‑D source)

**Official page:** `https://incois.gov.in/site/datainfo/modelling/godas.jsp`.

| Property | Value | Source |
| --- | --- | --- |
| System | INCOIS Global Ocean Data Assimilation System; OGCM = **MOM‑4.0**; assimilation = 3DVAR + Newtonian nudging | godas.jsp |
| Assimilated obs | In‑situ **T & S profiles in the top 700 m** from Argo, moored buoys (RAMA/PIRATA/TRITON/TAO/NIOT), XBT/CTD/XCTD; SST nudged to satellite blended fields | godas.jsp |
| Parameters (from LAS "Godas 2025" entry) | `Potential temperature`, `Salinity`, `zonal current`, `meridional current` (+ vector), `vertical velocity`, `sea surface height`, `mixed layer depth`, `SST`, `SSS` | LAS `getDatasets` (retrieved 2026‑09‑05) |
| Coverage | **Global** — "surface to the bottom of the ocean" | godas.jsp |
| Horizontal resolution | 0.5° zonal; 0.25° meridional within 10° of the equator, relaxing exponentially to 0.5° poleward of 30° | Ravichandran et al. 2013 (INCOIS‑authored, peer‑reviewed) |
| Vertical | **40 levels** (27 in the upper 400 m), max depth ≈ 4478 m | Ravichandran et al. 2013; LAS `ZAX 5 … 4478.478 m` |
| Classification | **Model analysis with data assimilation.** INCOIS: *"1‑day delayed daily‑averaged ocean analysis"* | godas.jsp |
| Temporal coverage | 2003 – "till date" per godas.jsp | godas.jsp |
| Format | NetCDF | godas.jsp / LAS |
| Access | *"available for free from 2003 to till date on INCOIS ftp server (`ftpser.incois.gov.in`) and also on INCOIS Live Access Server (`las.incois.gov.in`; under ocean analysis folder)"*. Page adds: *"For data access, users are requested to contact Dr. Abhisek Chatterjee, Scientist D, INCOIS."* | godas.jsp |
| Authentication | LAS: open. FTP: **Not yet verified** (the named‑contact wording implies an email request / possible credentials). | — |
| Currency caveat | On 2026‑09‑05 the LAS product *"Godas 2025"* ended `2025‑05‑22` — the **public LAS mirror appears to lag ≈ 15 months**. The "1‑day delayed" claim is **not verified against any public feed**; the real‑time FTP feed must be checked in D2. | LAS `getDatasets` |

There is also a **GODAS/MOM reanalysis** on LAS as monthly `temp` / `sal` / `u` / `v` (40 levels
5–4478 m, `1979‑01 → 2023‑12`) — a long, consistent hindcast, but it stops in 2023.

### 5.4 HOOFS + Ocean State Forecast — model currents, forecast, high‑resolution

**Official pages:** `https://incois.gov.in/site/datainfo/modelling/hoofs.jsp`,
`https://incois.gov.in/site/services/osf.jsp`.

| Property | Value | Source |
| --- | --- | --- |
| System | **HOOFS** — High‑resolution Operational Ocean Forecast and reanalysis System. ROMS 3.7 + LETKF ensemble data assimilation (assimilates Argo & moored‑buoy T/S, satellite SST & SLA) | hoofs.jsp |
| IO‑HOOFS | Entire tropical Indian Ocean, **1/12° (~9.2 km)**, **40 sigma levels** | hoofs.jsp |
| NIO‑HOOFS | Arabian Sea east of 65°E + entire Bay of Bengal, **1/48° (~2.3 km)**, 40 sigma levels; tidal forcing (TPXO 7.0) | hoofs.jsp |
| Products | Daily analysis + **3‑hourly forecasts to +5 days** of currents, temperature, salinity (surface **and subsurface**); general fields SST, MLD, surface currents, D20 | hoofs.jsp |
| OSF public parameters | Wind, significant wave height, wave/swell period, **Current Speed (m/s)**, **SST (°C)**, **MLD (m)**, **D20 (m)**, cyclone heat potential | osf.jsp |
| OSF cadence / horizon | *"information at 3‑hour intervals for the next 5–10 days"* | osf.jsp |
| OSF regions | Indian Ocean, Northern Indian Ocean, South China Sea; coastal states/UTs; ports, harbours, fish‑landing centres; global | osf.jsp |
| Dissemination | *"images **and data** posted on the Ocean State Forecast (OSF) services webpage"* (hoofs.jsp). Primary mode = INCOIS website / interactive maps. | hoofs.jsp / osf.jsp |
| Gridded full‑field download | **Not documented on either page.** An INCOIS GeoServer exists at `incois.gov.in/geoserver` but an anonymous `GetCapabilities` request returned **HTTP 403** — open WMS access **Not yet verified**. | direct check 2026‑09‑05 |
| Authentication | Web viewer: open. Bulk/gridded forecast data: likely on request — **Not yet verified**. | — |
| Standing | INCOIS is a **WMO Regional Specialised Meteorological Centre (RSMC)** for numerical ocean wave prediction and global numerical ocean prediction | osf.jsp |

**Role in BlueNexus:** HOOFS is the highest‑resolution INCOIS current field and the only one with
a genuine forecast. If a data‑access route can be secured in D2 it is attractive for a coastal
India focus; otherwise GODAS (§5.3) is the more openly documented 3‑D option.

---

## 6. Data Access Findings

What can *actually* be reached, by mechanism, verified on 2026‑09‑05.

### 6.1 Web visualization (no bulk data)
- **OSF web maps** (`osf.jsp` and linked viewers) — currents (speed), SST, MLD, D20, waves.
- **Remote Sensing viewer** (`remotesensing.jsp`) — SST and related AVHRR imagery, "Download" button
  for images.
- **Ocean Colour viewers** (`ChloroGIN_SP.jsp`, `ChloroGIN_VP.jsp`) — chlorophyll, SST, Kd490, etc.
- **OMNI–RAMA Joint Portal** — buoy plots. **Visualisation only, no download** (Data Holdings).
- **Digital Ocean** (`do.incois.gov.in`) — INCOIS's own 3‑D/4‑D ocean‑data platform with
  *"multi‑format download of disparate data from multiple sources (in‑situ, remote sensing, model)…
  rendered on a georeferenced 3‑D Ocean"* (PIB launch release, 2020). Directly analogous to
  BlueNexus. **The host did not resolve/connect from the research environment on 2026‑09‑05 →
  reachability and its download API are "Not yet verified"; worth a dedicated look in D2.**

### 6.2 Downloadable files
- **INCOIS FTP `ftpser.incois.gov.in`** — named on `godas.jsp` as the GODAS distribution point
  ("ocean analysis" from 2003). Directory layout, credentials, and currency **Not yet verified**.
- **Remote‑sensing image downloads** — per‑scene images (not gridded science data) from the RS viewer.

### 6.3 API — machine‑readable subsetting (verified working)
- **INCOIS ERDDAP** `https://erddap.incois.gov.in/erddap/` — a standard ERDDAP server.
  - `griddap` REST interface for all gridded datasets (`.nc`, `.json`, `.csv`, `.geotif`, `.png`, …).
  - `tabledap` for `Indian_ARGO_Floats`.
  - 16 data products (plus the `allDatasets` catalog), **every one `accessible = public`** — no login, no key.
  - Directly relevant, current datasets: `incois_argo_10day_McCreary`, `incois_argo_10d_VAM`,
    `incois_argo_mnt_McCreary`, `incois_argo_mnt_VAM` (T & S, to 2026‑07‑30).
  - Discontinued but useful for wiring: `incois_oceansat2_datasets` (chlorophyll, to 2020‑05),
    `NOAA_AVHRR_AMSR_datasets` (SST, to 2011), `incois_valueadded_products_datasets`
    (MLD/D20/geostrophic U,V, to 2019).
  - **TLS note:** `curl` and browsers connect fine, but a stricter TLS stack (Node/undici, via the
    research tool) rejected the chain with *"unable to verify the first certificate"* — the server
    likely omits an intermediate CA certificate. **The backend HTTP client must be tested against
    this host and may need the intermediate cert or a full CA bundle.**
- **INCOIS LAS + OPeNDAP/THREDDS** `https://las.incois.gov.in/` and
  `https://las.incois.gov.in/thredds/` — 52 dataset entries incl. the Argo gridded products
  (24 levels, to 2026‑07‑30), GODAS (`Godas 2025`, 40 levels, to 2025‑05‑22), NOAA OISST daily
  (to 2026‑08‑11), AMSR2 SST 3‑day (to 2026‑08‑28), TropFlux air–sea fluxes.
  LAS `getDatasets.do` returns a full JSON catalogue; THREDDS gives OPeNDAP endpoints per dataset.

### 6.4 FTP / other machine‑readable
- `ftpser.incois.gov.in` (GODAS) — see 6.2.
- Global **Argo GDACs** (Coriolis / US‑GODAE) — FTP/HTTPS/S3, NetCDF, free, no auth — the
  authoritative route for individual Argo profiles that INCOIS itself feeds into.
- **NOAA/PMEL GTMBA** delivery portal — the machine route for the RAMA moored‑buoy subset.

### 6.5 Authentication requirements (summary)
| Source | Auth to read |
| --- | --- |
| INCOIS ERDDAP (Argo gridded, etc.) | **None** (verified `public`) |
| INCOIS LAS / OPeNDAP | **None** observed |
| INCOIS‑GODAS via LAS | None; **via `ftpser.incois.gov.in` — Not yet verified** (contact named) |
| HF Radar currents | **Yes** — registered access / Data Requisition Form |
| OMNI / RAMA buoys (INCOIS) | No download at all; RAMA via PMEL (no auth) |
| OSF / HOOFS gridded forecast | Web viewer open; bulk data **Not yet verified** |
| Ocean Colour / chlorophyll (machine‑readable) | **Not yet verified** |
| Digital Ocean (`do.incois.gov.in`) | **Not yet verified** (did not connect) |

---

## 7. Real-Time / Near-Real-Time Assessment

Per the D1 rule, nothing below is called "real‑time" without evidence. INCOIS's Data Holdings uses
"Real‑time" for the **mode of reception** (sensor → INCOIS), which is **not** the same as the
public product being real‑time; that distinction is applied here.

| Parameter (source) | True real-time? | Near-real-time? | Periodic? | Historical? | Evidence |
| --- | --- | --- | --- | --- | --- |
| **Temperature — Argo gridded (McCreary/VAM)** | **No** | Partly — it is an *analysis* that trails the observations by weeks | **Yes** — 10‑day and monthly fields | **Yes** — from 2001 (McCreary) / 2004 (VAM) | ERDDAP: latest 10‑day field `2026‑07‑30` on retrieval date `2026‑09‑05`; NetCDF `history` regenerated `2026‑08‑17`. No fixed refresh schedule published. |
| **Salinity — Argo gridded** | **No** | Partly (same as temperature) | **Yes** | **Yes** | Same product/metadata as temperature. |
| **Temperature/Salinity/Currents — INCOIS‑GODAS** | **No** | INCOIS *claims* "1‑day delayed daily" — **unverified against any public feed** | **Yes** — daily analysis | **Yes** — from 2003 | `godas.jsp` claims 1‑day delay; but LAS `Godas 2025` ends `2025‑05‑22` (≈15‑month lag on the public mirror). |
| **Currents — HF Radar (ICORN)** | Acquisition real‑time; **public‑product latency undocumented** | Likely (hourly product), **not verified** | Hourly files | **Yes** — 2008/2009 – present | Data Holdings: *"Current Vector — Real‑time — 2008 – till date — Registered access"*; archived page: real‑time reception, NetCDF archive. |
| **Currents — OMNI/RAMA moored buoys** | Transmission real‑time | Buoy feeds are NRT (via PMEL for RAMA) | — | **Yes** — 1997 – present | `jointportal.jsp` ("high‑resolution real‑time … data"); Data Holdings ("Real‑time"). INCOIS: visualisation only. |
| **Currents / SST — HOOFS / OSF forecast** | **No** (it is a *forecast*, issued once per day) | The daily analysis step is NRT‑ish | **Yes** — daily run, 3‑hourly steps, +5 (to +10) days | Reanalysis component: **Yes** | `hoofs.jsp` ("Daily, 3‑hourly forecasts … subsequent five days"); `osf.jsp` ("3‑hour intervals for the next 5–10 days"). |
| **Chlorophyll — INCOIS Ocean Colour Products** | **No** | **Yes** — INCOIS explicitly says *"near real‑time (NRT)"* | **Yes** — rolled / rolling composites | **Yes** — MODIS from 2007; Oceansat archives earlier | `ChloroGIN.jsp`: *"provide ocean colour data products to users at near real‑time (NRT)"*; Data Holdings: MODIS Chlorophyll "Real‑time — 2007 – till date". |
| **SST — NOAA OISST via INCOIS LAS** (secondary) | No (daily, ~1‑day latency) | **Yes** | Daily | **Yes** — from 1981 | LAS: latest `2026‑08‑11` on retrieval date `2026‑09‑05`. NOAA product, INCOIS‑rehosted. |

**Bottom line on "real‑time":** BlueNexus should describe its temperature and salinity as
**"observation‑based analysis, updated periodically (≈10‑day)"**, its currents as **"model
analysis / forecast"** (or "coastal HF‑radar observations" where that layer is used), and its
chlorophyll as **"satellite, near‑real‑time"**. No BlueNexus parameter should be labelled "live"
or "real‑time" in the UI on the basis of these INCOIS sources.

---

## 8. Recommended BlueNexus Source Architecture

| Parameter | Primary INCOIS source | Why | Secondary / fallback |
| --- | --- | --- | --- |
| **Temperature** (3‑D volume) | **INCOIS Argo gridded 10‑day, Kessler–McCreary** (`incois_argo_10day_McCreary`), via **ERDDAP `griddap`** | Authoritative (INCOIS is National Argo Data Centre); observation‑based; `time × depth(5–2000 m, 24 lvl) × lat × lon` maps 1:1 onto the frontend `TemperatureDataset`; NetCDF; no auth; verified retrievable | Monthly variant for slow cadence; **VAM** variant as cross‑check; INCOIS‑GODAS for > 2000 m; NOAA OISST (via LAS) for a sharp surface layer |
| **Salinity** (3‑D volume) | **Same Argo gridded product** (`S_ANALYZED`, PSU) | One dataset covers T and S on an identical grid — a single loader serves both | VAM `SAL`; INCOIS‑GODAS salinity for full depth |
| **Chlorophyll** (surface field) | **INCOIS Ocean Colour Products (MODIS‑Aqua, NRT)** — `ChloroGIN.jsp` | The authoritative INCOIS ocean‑colour service; explicitly NRT; MODIS source is openly acknowledged and not DoS‑restricted | **Interim for wiring:** `incois_oceansat2_datasets` on ERDDAP (real INCOIS NetCDF, but ended 2020). **Open fallback if no INCOIS feed:** NASA OB.DAAC MODIS/VIIRS L3 SMI. **Avoid** OCM/Oceansat as primary (DoS‑restricted) |
| **Currents** (3‑D volume `currentSpeed`) | **INCOIS‑GODAS** (`u`, `v` → speed; 40 levels to ~4478 m), via **LAS/OPeNDAP** (and FTP once verified) | Only openly documented INCOIS source with full‑depth U/V; global; NetCDF | **HOOFS** (1/12° & 1/48°, forecast) if a data route is secured in D2; open fallback: Copernicus Marine global analysis or OSCAR surface currents (non‑INCOIS) |
| **Currents** (coastal surface overlay) | **INCOIS HF Radar (ICORN)** where the view is over Indian coastal waters | Only INCOIS *observed* current field; hourly; genuine surface vectors | OSF "Current Speed" web layer for a quick surface picture |
| **Currents** (forecast, optional) | **OSF / HOOFS** surface currents + SST | Genuine forecast, 3‑hourly to +5 days; INCOIS is WMO RSMC | — |

**Design consequences that follow from this choice**

- One NetCDF/xarray loader (ERDDAP `griddap` → NetCDF subset) serves **temperature + salinity**
  from a single dataset. This is the smallest possible first integration and is the natural D2/D3
  target.
- The frontend's regional box (lat −35…25, lon 40…100 in `temperatureDataset.ts`) sits **inside**
  the Argo grid domain (lat −29.5…29.5, lon 30.5…119.5) except for the far south (< −29.5°) — the
  visualization's southern edge will be outside Argo coverage and must render as "no data", not as
  clamped values.
- Currents and chlorophyll are **surface‑ or model‑only** relative to the depth‑resolved
  temperature/salinity; the 3‑D scene should treat `currentSpeed` (from a model) and `chlorophyll`
  (surface) differently from the observation‑analysis `temperature`/`salinity`.

---

## 9. Data Integration Risks (affecting D2–D15)

| # | Risk | Detail / where it bites |
| --- | --- | --- |
| 1 | **Authentication / gated access** | HF radar = registered access + Data Requisition Form. GODAS FTP names a contact person (email request likely). OSF/HOOFS gridded data access path unknown. Ocean‑colour machine feed unknown. → several parameters cannot be fully automated until D2 clears the access route. |
| 2 | **INCOIS ERDDAP TLS chain** | Observed *"unable to verify the first certificate"* from a strict TLS stack (Node/undici); `curl`/browsers are fine. The server likely omits an intermediate CA cert. Backend HTTP client (httpx/requests/aiohttp) must be tested; may need the intermediate cert bundled or `verify` pointed at a fuller CA set. |
| 3 | **Stale / lagging public mirrors** | INCOIS‑GODAS on LAS ends 2025‑05‑22 (≈15‑month lag) despite a "1‑day delay" claim. `Indian_ARGO_Floats` on ERDDAP ends 2025‑04 (≈16‑month lag). Argo gridded lags ≈4–6 weeks (expected for an analysis). BlueNexus must show real data dates, never "now". |
| 4 | **Large binary files, NetCDF/HDF processing** | Argo gridded full file, GODAS global 40‑level fields, HOOFS 1/48° fields are large. Backend needs `xarray` + `netCDF4`/`h5netcdf` (and GDAL for GeoTIFF/HDF). Use ERDDAP/OPeNDAP server‑side subsetting (bbox + depth + time) to avoid downloading whole files. |
| 5 | **Missing values / masks / QC** | `_FillValue = 9999.0` on Argo analysis; land + no‑observation cells both masked. Argo profile files carry per‑level QC flags (`*_QC`, use `*_ADJUSTED` in delayed mode). Chlorophyll has cloud gaps; HF radar has coverage gaps (antenna geometry, RF interference). The renderer must distinguish "land", "below sensor range", and "gap". |
| 6 | **Heterogeneous horizontal resolution** | Argo 1°; GODAS 0.5°/0.25°; IO‑HOOFS 1/12°; NIO‑HOOFS 1/48°; HF radar ~6 km; MODIS ocean colour ~4 km (unverified). Any multi‑layer view needs a common target grid / regridding step. |
| 7 | **Heterogeneous vertical coordinates** | Argo & GODAS = depth (z) levels but *different* level sets (24 vs 40, different values). HOOFS = 40 **sigma** (terrain‑following) levels — needs conversion to z before it can share the scene's depth axis. Frontend depth axis is currently 0–5000 m with 11 sample depths. |
| 8 | **Heterogeneous temporal frequency** | Argo 10‑day / monthly; GODAS daily; HOOFS/OSF 3‑hourly forecast steps; HF radar hourly; chlorophyll NRT + composites; NOAA OISST daily. A single "time" control cannot map onto all of them — expect per‑layer time handling (the frontend already separates `TEMPERATURE_TIMES` from the global `TIME_STEPS`). |
| 9 | **Coordinate system / grid geometry** | Argo, GODAS, satellite products are regular lat/lon (easy). ROMS/HOOFS output is on a **curvilinear** grid — needs proper regridding, not naive indexing. Confirm longitude convention (0–360 vs −180…180): Argo grid is 30.5–119.5°E (fine); some global products use 0–360. |
| 10 | **Units** | Temperature `degs` (°C, but non‑standard label) vs °C vs K. Salinity PSU. Currents: GODAS/HOOFS in m/s, but the Argo value‑added geostrophic currents are **cm/s**. Chlorophyll mg/m³. Normalise on ingest. |
| 11 | **Domain mismatch** | Frontend southern edge (< −29.5°) is outside Argo coverage; must render as no‑data. Oceansat chlorophyll grid (~0–28°N) does not cover the frontend's southern hemisphere box at all. |
| 12 | **API / service limitations** | ERDDAP has request‑size and rate limits (large `griddap` requests can time out or be throttled). LAS Product Server returned an HTTP 500 on a minimal probe request — its request XML must be formed correctly. INCOIS GeoServer WMS returned 403 to anonymous requests. |
| 13 | **Access / usage restrictions** | INCOIS site disclaimer: *"Reproducing the material published in this website for **commercial purpose is not permitted**, unless … permission is obtained from the competent authority."* ERDDAP dataset license: free redistribution but *"not intended for legal use."* OCM/Oceansat chlorophyll: *"Restricted; as per DoS guidelines."* MODIS chlorophyll: NASA source, "for research purpose." BlueNexus must (a) confirm its use is non‑commercial or obtain permission, (b) carry the required attributions/citations, (c) not adopt OCM data. |
| 14 | **Host / DNS fragility** | Internal INCOIS hostnames (`services.incois.gov.in`, `vacancies.incois.gov.in`) leak into search results but resolve to private IPs — never hard‑code them. `do.incois.gov.in` and `odis.incois.gov.in` did not resolve/connect from the research environment. The `/portal/` URL tree is retired (404). Pin to `incois.gov.in`, `erddap.incois.gov.in`, `las.incois.gov.in`. |
| 15 | **Single points of failure** | Argo gridded, GODAS, and (for profiles) the global Argo GDAC are separate services with separate uptime. The pipeline should cache the last good field and degrade gracefully. |

---

## 10. D1 Conclusion

**Recommended official INCOIS source per parameter**

- **Temperature:** INCOIS **Argo gridded analysis** — *"ARGO 10 Day data, Kessler–McCreary
  Methodology"* (`incois_argo_10day_McCreary` on INCOIS ERDDAP; *"ARGO DATA PRODUCTS (10 DAYS)"*
  on INCOIS LAS). Observation‑based, 1° × 1°, 24 depth levels 5–2000 m, tropical Indian Ocean,
  updated ≈ every 10 days with a few weeks' lag, NetCDF, no authentication.
- **Salinity:** the **same** INCOIS Argo gridded product (`S_ANALYZED`, PSU). No separate salinity
  source exists or is needed.
- **Chlorophyll:** INCOIS **Ocean Colour Products** (formerly ChloroGIN‑IO), MODIS‑Aqua,
  near‑real‑time — `https://incois.gov.in/site/services/ChloroGIN.jsp`. Authoritative INCOIS
  ocean‑colour service; **its machine‑readable access method is not yet verified** and is the main
  open item for D2.
- **Currents:** no single dataset. **INCOIS‑GODAS** (global MOM‑4.0 analysis, U/V, 40 levels to
  ~4478 m; FTP `ftpser.incois.gov.in` + LAS) for the depth‑resolved field; **INCOIS HF Radar
  network / ICORN** (hourly, ~6 km, NetCDF, registered access) for observed coastal surface
  currents; **OSF / HOOFS** (ROMS, 1/12° & 1/48°, 3‑hourly forecast) for forecast surface currents.

**What D2 should investigate (access methods)**

1. **INCOIS ERDDAP `griddap`** as the temperature + salinity pipeline: exact request URLs for a
   bbox + depth‑range + time subset, response format (`.nc`), the **TLS/intermediate‑certificate**
   behaviour from the backend HTTP client, and request‑size / rate limits.
2. **INCOIS‑GODAS**: the real feed on `ftpser.incois.gov.in` — directory structure, whether
   credentials or an email request to the named contact are required, and its actual currency
   (the LAS copy lags ~15 months). Compare with LAS OPeNDAP as a no‑auth alternative.
3. **INCOIS HF Radar**: the registration / Data Requisition Form process, and whether approved
   users get a scriptable endpoint (FTP/HTTP) or only manual downloads; current station list.
4. **INCOIS Ocean Colour / chlorophyll**: find the machine‑readable endpoint — FTP, WMS/WCS,
   a download service, or a request process — plus the product's resolution, cadence, format and
   domain (none of which are stated on the public page). Evaluate `do.incois.gov.in` (Digital
   Ocean) as a possible multi‑parameter download source once it is reachable.
5. **LAS OPeNDAP/THREDDS** (`las.incois.gov.in/thredds/`) as a uniform no‑auth fallback for Argo,
   GODAS and NOAA OISST if ERDDAP or FTP prove unreliable.

**Sources that should NOT be used (and why)**

- **OCM / Oceansat chlorophyll** (`incois_oceansat2_datasets`, OCM‑1/OCM‑2) as a redistributable
  primary — *"Restricted; as per DoS guidelines"* per INCOIS Data Holdings, and the ERDDAP series
  ended 2020‑05. (Acceptable only for local, non‑redistributed development wiring.)
- **OMNI / moored‑buoy currents (and T/S) as a bulk gridded source** — INCOIS provides
  *"visualisation only, no download."* Machine access to the RAMA subset is via NOAA/PMEL, not
  INCOIS. Use buoys only as sparse validation points.
- **INCOIS ERDDAP `Indian_ARGO_Floats` as a live profile feed** — it lags ≈ 16 months. For current
  individual Argo profiles use the global Argo GDACs (Coriolis / US‑GODAE) that INCOIS feeds.
- **Internal INCOIS hostnames** `services.incois.gov.in` / `vacancies.incois.gov.in` and the
  retired `incois.gov.in/portal/*` tree — not public, not stable.
- **Scraped web‑viewer images / map tiles** from any INCOIS portal as a data source — against the
  D1 rules and the site's no‑commercial‑reproduction clause; use the NetCDF/OPeNDAP services
  instead.
- **Non‑INCOIS products (NASA OB.DAAC, Copernicus Marine, OSCAR, NOAA OISST)** — allowed only as
  explicitly labelled fallbacks where an INCOIS source cannot be accessed, never as the stated
  primary.

---

## D1 STATUS: COMPLETE

An authoritative, official INCOIS source has been identified for all four core parameters, and at
least one concrete potential access path has been documented for each:

| Parameter | Authoritative INCOIS source identified | Access path documented |
| --- | --- | --- |
| Temperature | ✅ Argo gridded analysis (McCreary/VAM) | ✅ ERDDAP `griddap` + LAS OPeNDAP — verified reachable, no auth |
| Salinity | ✅ Same Argo gridded analysis | ✅ Same as temperature — verified |
| Chlorophyll | ✅ INCOIS Ocean Colour Products (MODIS‑Aqua NRT) | ⚠️ Web viewer verified; **machine‑readable endpoint "Not yet verified"** — D2 must resolve. Historic Oceansat‑2 ERDDAP path verified for development. |
| Currents | ✅ INCOIS‑GODAS (3‑D) + INCOIS HF Radar (coastal surface) + OSF/HOOFS (forecast) | ✅ GODAS via LAS (no auth) + FTP (contact); HF radar registered access; OSF web viewer — all documented, some with caveats |

Residual unknowns are recorded explicitly above as **"Not yet verified"** (chlorophyll machine
access; GODAS FTP currency/credentials; HF radar automation and current station count; OSF/HOOFS
bulk download; `do.incois.gov.in` reachability; ERDDAP TLS handling from the backend). These are
D2 tasks, not D1 blockers.

**Do not proceed to D2 or any other data‑track step from this document.**
