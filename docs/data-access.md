# BlueNexus INCOIS Data Access & Formats (Data Track D3)

**Data Track step:** D3 — Understand Data Access & Formats
**Type:** Access and format investigation only. No ingestion layer, no backend, no frontend wiring, no mock-data replacement, no changes to Steps 1–20 or D4+.
**Prepared:** 2026-09-05
**Builds on:** `docs/data-sources.md` (D1) and `docs/data-availability.md` (D2) — both unchanged.

---

## 1. D3 Summary

D1 asked *which official sources exist*. D2 asked *which datasets are actually available*. D3 asks
the engineering question: **exactly how would a backend fetch this, in what format, and is that
mechanism dependable?**

Every claim below was produced by a live, read-only request on 2026-09-05. Where a request was
made, its HTTP status, byte count and wall time are recorded.

### The four-way distinction this document enforces

| Level | Meaning | Example found here |
| --- | --- | --- |
| **Dataset existence** | INCOIS says the product exists | HF Radar current vectors ("2008 – till date") |
| **Human / web access** | A person can see it in a browser | ChloroGIN product viewer; OSF forecast maps |
| **Machine-readable access** | A program can retrieve structured values | ERDDAP `griddap` → NetCDF; GeoServer WCS → GeoTIFF |
| **Automated backend access** | Reliable, subsettable, unattended, no manual step | **Only the Argo gridded product qualifies today** |

### Headline findings

| Parameter | Access verdict | Mechanism |
| --- | --- | --- |
| **Temperature** | 🟢 **Solved** | INCOIS ERDDAP `griddap` → NetCDF-3. Full 3-D volume in **523 KB / 0.50 s**, no auth, subsettable on all five axes. |
| **Salinity** | 🟢 **Solved** | Same dataset, same request — `T_ANALYZED` and `S_ANALYZED` can be fetched in **one** call. |
| **Chlorophyll** | 🔴 **No verified public machine-readable access route found** for a usable, time-stamped INCOIS product. ChloroGIN is a web viewer + email request. A *lead* was found (GeoServer WCS GeoTIFF, ~1 km) but it is undated, unscaled and undocumented. | — |
| **Ocean Currents** | 🔴 / 🟠 **Not feasible today.** GODAS OPeNDAP **hangs (HTTP 000 after 70 s, twice)**; GODAS FTP denies anonymous login; HF Radar needs a signed requisition form; **OSF/HOOFS forecast fields are not published as data at all** — only the viewer's sector polygons are on GeoServer. | — |

### Three new facts D3 established that D1/D2 could not

1. **The TLS problem is fully diagnosed and has a proper fix.** The server sends only the leaf
   certificate. Node.js fails; curl and Python succeed *on this machine* only because Windows had
   cached the intermediate. **A clean Linux container with `certifi` would fail too** — proven by
   a root-only trust test. Fix is to supply the intermediate, never to disable verification (§11).
2. **INCOIS chlorophyll resolution is 1 km** — read from INCOIS's own `resolution.js`. This closes
   a "Not yet verified" item carried since D1.
3. **OSF/HOOFS forecast data is definitively not machine-readable.** All 340 GeoServer WMS layers
   were enumerated: the `OSF_*` workspaces contain only sector polygons and location points, and
   **no current-velocity, U/V or forecast-field layer exists anywhere on the server**.

---

## 2. Access Method Matrix

| Parameter | Dataset | Access Method | Endpoint | Format | Auth? | Registration? | Automated? | Subsetting? | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Temperature + Salinity | `incois_argo_10day_McCreary` | ERDDAP **griddap** (REST) | `https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.{nc,csv,json,…}` | NetCDF-3, CSV, JSON, .mat, .dods, GeoTIFF (2-D only) | **No** | **No** | ✅ **Yes** | ✅ time, depth, lat, lon, variable, stride | 🟢 **Verified working** |
| Temperature + Salinity | `incois_argo_10d_VAM` | ERDDAP griddap | `…/griddap/incois_argo_10d_VAM.nc` | same | No | No | ✅ Yes | ✅ all axes | 🟢 Verified working |
| Temperature + Salinity | `incois_argo_mnt_McCreary` / `_VAM` | ERDDAP griddap | `…/griddap/incois_argo_mnt_McCreary.nc` | same | No | No | ✅ Yes | ✅ all axes | 🟢 Verified working |
| Temperature + Salinity (profiles) | `Indian_ARGO_Floats` | ERDDAP **tabledap** | `…/tabledap/Indian_ARGO_Floats.csv?vars&constraints` | CSV, JSON, NetCDF | No | No | ✅ Yes | ✅ constraint operators | 🟢 Works (but data ends 2025-04-23) |
| Currents / T / S (3-D) | INCOIS-GODAS | LAS **OPeNDAP** (THREDDS) | `https://las.incois.gov.in/thredds/dodsC/las/id-cbbdd5ab07/…jnl` | (NetCDF via DAP) | No | No | ❌ **No** | (n/a — never responded) | 🔴 **HTTP 000 after 70 s, twice** |
| Currents / T / S (3-D) | INCOIS-GODAS | INCOIS **FTP** | `ftpser.incois.gov.in` | NetCDF | **Yes** | **Yes** (contact on `godas.jsp`) | ⚠️ Unknown | Unknown | 🟠 **Anonymous login denied (FTP 530)** |
| Currents (surface, observed) | HF Radar / ICORN | **Signed Data Requisition Form** | postal/email → `uday@incois.gov.in` | NetCDF | **Yes** | **Yes** | ❌ Not without approval | Unknown | 🟠 Registration required |
| Currents (forecast) | OSF / HOOFS | Web viewer only | `incois.gov.in/site/services/osf.jsp` | rendered maps | No | No | ❌ **No** | ❌ | 🔴 **No data layer published** |
| Currents (surface, geostrophic) | `incois_valueadded_products_datasets` | ERDDAP griddap | `…/griddap/incois_valueadded_products_datasets.nc` | NetCDF, CSV, … | No | No | ✅ Yes | ✅ all axes | 🟢 Access works — 🔴 **data ends 2019-03-30** |
| Chlorophyll (current) | INCOIS Ocean Colour Products (ChloroGIN) | Web viewer + **email request** | `…/site/services/ChloroGIN_SP.jsp`; `samanta.a@incois.gov.in` | Not stated | No (viewer) | **Yes** (archive) | ❌ **No** | ❌ | 🔴 **No verified machine route** |
| Chlorophyll (lead) | `PFZ-TUNA-SST-CHL:chl` | GeoServer **WCS** | `https://incois.gov.in/geoserver/wcs?…GetCoverage&coverageId=PFZ-TUNA-SST-CHL__chl` | **GeoTIFF**, TIFF, PNG, JPEG, GIF | No | No | ⚠️ Technically yes | ✅ lat/lon only — **no time axis** | 🟠 **Works but undated/unscaled/undocumented** |
| Chlorophyll (historical) | `incois_oceansat2_datasets` | ERDDAP griddap | `…/griddap/incois_oceansat2_datasets.nc` | NetCDF, CSV, … | No | No | ✅ Yes | ✅ all axes | 🟢 Access works — 🔴 **ends 2020-05-01, DoS-restricted** |

---

## 3. Temperature Access

### 3.1 The endpoint

| Item | Value |
| --- | --- |
| **Dataset ID** | `incois_argo_10day_McCreary` |
| **Base endpoint** | `https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary` |
| **Human/HTML form** | `…/incois_argo_10day_McCreary.html` |
| **Metadata (JSON)** | `https://erddap.incois.gov.in/erddap/info/incois_argo_10day_McCreary/index.json` (13,165 B) |
| **Metadata (DAS/DDS)** | `…/griddap/incois_argo_10day_McCreary.das` (6,882 B) · `.dds` (3,297 B) |
| **Authentication** | **None** — `accessible = public` |
| **Registration / token** | **None** |

### 3.2 Dimensions and coordinates (from `.dds` / `.das`, verified)

```
Dataset {
  Float64 time[time = 921];
  Float64 ZAX[ZAX = 24];
  Float64 latitude[latitude = 60];
  Float64 longitude[longitude = 90];
  GRID { Float32 T_ANALYZED[time][ZAX][latitude][longitude]; } T_ANALYZED;
  ... 12 variables, all Float32, all on the same 4 axes
}
```

**Axis order is `[time][ZAX][latitude][longitude]` — this order is mandatory in every query.**

| Coordinate | Name | Type | Units / attributes | Range |
| --- | --- | --- | --- | --- |
| Time | `time` | Float64 | `seconds since 1970-01-01T00:00:00Z`, `standard_name=time`, `axis=T`, `calendar=standard` | 921 steps, 2001-01-10 → 2026-07-30 |
| Depth | **`ZAX`** | Float64 | `units=METERS`, `axis=Z`, `point_spacing=uneven` | 24 levels, 5 → 2000 m |
| Latitude | `latitude` | Float64 | `degrees_north`, `standard_name=latitude`, `axis=Y` | 60 nodes, −29.5 → 29.5 |
| Longitude | `longitude` | Float64 | `degrees_east`, `standard_name=longitude`, `axis=X` | 90 nodes, 30.5 → 119.5 |

> ⚠️ **CF gotcha for D4/D7:** the vertical coordinate is named **`ZAX`**, not `depth`. It carries
> `axis = "Z"` and `units = "METERS"` but has **no `standard_name` and no `positive = "down"`
> attribute**. CF-aware tooling (`cf-xarray`, some auto-plotting paths) will not recognise it as a
> depth axis automatically — it must be renamed/annotated on ingest.

### 3.3 Variables

| Variable | Meaning | Units | Notes |
| --- | --- | --- | --- |
| **`T_ANALYZED`** | Objectively Analyzed Temperature | `degs` (i.e. °C) | **the temperature variable to use** |
| `T_MEAN` | Statistical mean temperature | `degs` | diagnostic |
| `T_STDEV`, `T_RMSE` | Spread / error vs analysed mean | `degs` | quality context |
| `T_ROIOBS`, `T_BOXOBS` | Observation counts in ROI / 1×1 box | count | data-density mask |
| `S_ANALYZED` + 5 salinity counterparts | see §4 | PSU | — |

`_FillValue = missing_value = 9999.0`; ERDDAP renders these as `NaN` in CSV/JSON and preserves
the fill value in NetCDF.

### 3.4 Query syntax (ERDDAP griddap)

```
{base}.{format}?{VARIABLE}[{time}][{ZAX}][{latitude}][{longitude}]
```

Each bracket accepts:

| Form | Meaning | Verified |
| --- | --- | --- |
| `[]` | entire axis | ✅ |
| `[(2026-07-30)]` | coordinate-space value | ✅ |
| `[(last)]` | newest index | ✅ |
| `[(5.0):(2000.0)]` | coordinate-space range | ✅ |
| `[(-29.5):2:(29.5)]` | range with **stride** | ✅ |
| `[0:1:23]` | index-space range | ✅ |
| `var1[...],var2[...]` | **multiple variables in one request** | ✅ |

Brackets must be URL-encoded (`%5B` / `%5D`) when passed through a shell or a strict client.

### 3.5 Verified requests (all HTTP 200 unless noted)

| Request | Bytes | Time |
| --- | --- | --- |
| `T_ANALYZED[(last)][(5.0)][][]` — one depth slice, full grid | 26,560 | 0.26 s |
| `T_ANALYZED[…],S_ANALYZED[…]` — **T+S together**, one depth slice | 48,600 | 0.24 s |
| `T_ANALYZED[(2026-06-20):(2026-07-30)][(5.0)][][]` — 3 time steps | 113,012 | 0.51 s |
| `T_ANALYZED[(last)][(5.0):(500.0)][][]` — depth 5–500 m | 307,472 | 0.55 s |
| `T_ANALYZED[(last)][][(0):(25)][]` — lat subset | 229,516 | 0.54 s |
| `T_ANALYZED[(last)][][][(60):(90)]` — lon subset | 183,236 | 0.47 s |
| **`T+S[(last)][(5):(2000)][(-10):(25)][(50):(100)]` — typical BlueNexus regional query** | **357,648** | **0.56 s** |
| `T_ANALYZED[(last)][][][]` — **full 3-D volume** (24×60×90) | 523,584 | 0.50 s |
| `T_ANALYZED[(last)][(5.0)][(-29.5):2:(29.5)][(30.5):2:(119.5)]` — stride | 9,792 | 0.21 s |
| `time[(last-2):(last)]` — axis-only discovery | 160 | 0.61 s |
| `T_ANALYZED[][][(10.5)][(72.5)]` — **all 921 times at one point** | 99,740 | ⚠️ **31.10 s** |

> ⚠️ **Performance cliff — the single most important D7 design input.** A request confined to
> *one* time step is sub-second. A request spanning *all* time steps takes **31 s for only 100 KB**,
> because ERDDAP must open one source file per time step. **Ingestion must iterate time step by
> time step; it must never request a long time series in a single call.**

### 3.6 Suitability

Machine-readable ✅ · automated ✅ · no auth ✅ · subsettable on every axis ✅ · sub-second for
realistic queries ✅. **This is a fully solved access path** — the only caveat is TLS chain
handling (§11).

---

## 4. Salinity Access

**Salinity requires no separate access path.** It is a sibling variable in the same grid:

| Item | Value |
| --- | --- |
| Variable | **`S_ANALYZED`** — "Objectively Analyzed Salinity" |
| Units | `PSU`; `standard_name = sea_water_practical_salinity` |
| Companions | `S_MEAN`, `S_STDEV`, `S_RMSE`, `S_ROIOBS`, `S_BOXOBS` |
| Grid | identical — `[time][ZAX][latitude][longitude]`, 921 × 24 × 60 × 90 |
| VAM variant | `incois_argo_10d_VAM` → `SAL` (PSU) + `SERR` |

**Fetching T and S in one request is verified and cheap** (48,600 B / 0.24 s for a depth slice;
357,648 B / 0.56 s for a full regional 3-D volume of both). Sample values returned at
2026-07-30, 5 m: `29.734 °C / 35.902 PSU` at 8.5°N 70.5°E.

D7 should issue **one combined request per time step**, not two.

---

## 5. Chlorophyll Access

This was the priority investigation. The conclusion is unchanged from D2 but now rests on much
stronger evidence, and one new lead was found.

### 5.1 ChloroGIN / INCOIS Ocean Colour Products — reverse-engineered

The viewer at `https://incois.gov.in/site/services/ChloroGIN_SP.jsp` is a **GET form** with
parameters `product`, `roll`, `region`, `resolution`. Its supporting assets were read directly:

**Verified from `chlorophyllregion1.jsp?product=CHL` (live AJAX endpoint, HTTP 200, 429 B):**
the region vocabulary is `Entire`, `IndiaSriLanka`, `Iran`, `Kenya`, `Maldives`, `Oman`,
`Tanzania`, `Thailand` — matching the IOGOOS member states named on `ChloroGIN.jsp`.

**Verified from `https://incois.gov.in/site/assets/js/resolution.js` (HTTP 200, 1,825 B):**

| Resolution | Products |
| --- | --- |
| **1 KM** | **CHL**, ANGSTROM, AOT, CDOM, FLH, IPAR, PAR, PIC, POC, SST, K490, ABI |
| 4 KM | BRS, BI, TSM, Phyto |

> ✅ **This closes a D1/D2 unknown: INCOIS chlorophyll (CHL) is served at 1 km.**

**What the viewer does *not* offer.** Submitting the form
(`ChloroGIN_SP.jsp?product=CHL&resolution=1KM&region=…`) returned the page with **no data link and
no product image**. Across both `ChloroGIN_SP.jsp` and `ChloroGIN_VP.jsp`:

- data-file extension strings (`.nc`, `.hdf`, `.h5`, `.tif`, `.zip`, `.gz`): **NONE**
- occurrences of `ftp`: **0** · `download`: **0** · `opendap`: **0** · `wms`: **0**
- the only access statement on the page: **"For archive data kindly contact samanta.a@incois.gov.in"**

### 5.2 ERDDAP / LAS — re-confirmed

| Dataset | Latest | Verdict |
| --- | --- | --- |
| `incois_oceansat2_datasets` (OCM-2 CHL, KD490, TSM) | 2020-05-01 | Machine-readable and public, but **5 years stale** and OCM is *"Restricted; as per DoS guidelines"* |
| `IRS_chlorophyll_datasets` (IRS-P4) | 2006-03-21 | Historical |
| LAS *"Corrected INCOIS BIO ROMS"* | 2019-12-24 | Model output, historical |

**No current INCOIS chlorophyll dataset exists on ERDDAP or LAS.**

### 5.3 New D3 lead — GeoServer WCS raster (promising, but not yet usable)

Enumerating the INCOIS GeoServer revealed a chlorophyll raster reachable over standard OGC
services. Verified end-to-end:

| Test | Result |
| --- | --- |
| WMS `GetMap` (400×200 PNG over 35–103°E, −5–31°N) | HTTP 200, **59,139 B PNG** |
| WCS `DescribeCoverage` (2.0.1 and 1.0.0) | HTTP 200 |
| **WCS `GetCoverage`, subset Lat(10,12) Long(70,72), `image/tiff`** | HTTP 200, **201,088 B, valid GeoTIFF (`MM\0*`), 0.66 s** |

| Property | Value |
| --- | --- |
| Coverage ID | `PFZ-TUNA-SST-CHL__chl` (WMS layer `PFZ-TUNA-SST-CHL:chl`) |
| Description | *"Generated from GeoTIFF"* |
| Grid | **7555 × 4000** pixels |
| Resolution | **0.009° ≈ 1 km** (matches the ChloroGIN 1 KM product) |
| Extent | 35.0 – 102.99 °E, −5.0 – 31.0 °N, EPSG:4326 |
| Bands | **one**, named `GRAY_INDEX`, uom `W.m-2.Sr-1` |
| **Time dimension** | **NONE advertised** |
| Formats | GeoTIFF (native), TIFF, PNG, JPEG, GIF |

**Why this is a lead and not a solution:**

1. **No time axis.** Only one undated snapshot is retrievable — no history, no acquisition date,
   no way to build a time series or even know what day the data is from.
2. **Band semantics are undocumented.** `GRAY_INDEX` with a `W.m-2.Sr-1` placeholder unit is
   GeoServer's default for an unannotated GeoTIFF. There is **no published scaling to mg/m³**.
3. **It is a PFZ advisory input layer**, not a documented scientific chlorophyll product. Its
   workspace (`PFZ-TUNA-SST-CHL`) sits alongside GeoServer's stock demo layers (`sf__sfdem`,
   `nurc__mosaic`, `tasmania`, `tiger-ny`), and the sibling `sst` layer has a **broken bounding
   box** (−103.87 to −103.63 °E, 44.37–44.50 °N — GeoServer's South Dakota sample extent),
   indicating the server is not a curated data service.
4. **Access intent is ambiguous.** The Apache front-end returns **403** for `/geoserver/ows` and
   `/geoserver/web` while `/geoserver/wms` and `/geoserver/wcs` pass through to Jetty. That
   asymmetry suggests INCOIS intends to limit this service. **D4/D7 must obtain explicit INCOIS
   permission before depending on it** (see §9).

### 5.4 Chlorophyll verdict

> **No verified public machine-readable access route found** for a current, time-stamped,
> documented INCOIS chlorophyll dataset.

The routes that exist are: a **web viewer** (human access), an **email request** for the archive
(`samanta.a@incois.gov.in`), a **5-year-stale, DoS-restricted** ERDDAP series, and an **undated,
unscaled GeoServer raster** of uncertain standing.

*Third-party sources (NASA OB.DAAC, ISRO MOSDAC) remain possible future fallbacks and were
catalogued in D2 §5.5. They are **not** INCOIS sources and are deliberately excluded from the
recommendation tables in this document.*

---

## 6. Current Access

### 6.1 INCOIS-GODAS

| Item | Finding |
| --- | --- |
| **Location** | LAS only — *"Godas 2025"*, LAS catalog id **`id-cbbdd5ab07`**. Not on ERDDAP. |
| **Variables** | `TEMP`, `SALT`, **`U` (zonal current)**, **`V` (meridional current)**, `WT` (vertical velocity), `SSH`, `SSS`, `SST`, `MLD`, `ETA_T` — **U/V components confirmed present** |
| **Depth levels** | 40, 5 → ~4478 m |
| **Spatial resolution** | 0.5° zonal; 0.25° meridional within 10° of the equator (D2) |
| **Temporal resolution** | daily (claimed); latest step on LAS **2025-05-22** |
| **LAS catalog access** | ✅ `getDatasets.do` HTTP 200, 17,007,907 B, 16.3 s · THREDDS `catalog.xml` HTTP 200, 835 B, 0.23 s |
| **OPeNDAP access** | 🔴 **FAILS.** `…/thredds/dodsC/las/id-cbbdd5ab07/data_home_las_datasets_godas_2025.nc.jnl.dds` → **HTTP 000, 0 bytes, 70.0 s timeout**. Repeated twice. The Argo journal on the same path failed identically (**HTTP 000, 0 B, 70.0 s**). |
| **Is it the network?** | **No.** Control requests to the *same host* in the *same batch* returned HTTP 200 (catalog 17 MB; THREDDS XML 835 B). The failure is isolated to the `/thredds/dodsC/` Ferret F-TDS data path. |
| **FTP access** | 🟠 `ftpser.incois.gov.in` — **anonymous login denied, FTP 530** (D2). `godas.jsp` names a contact for access. |
| **Registration / auth** | Required for FTP; contact named on the INCOIS GODAS page |
| **Download format** | NetCDF |
| **Automated access feasibility** | ❌ **Not feasible today** — the only no-auth machine route (OPeNDAP) does not respond |

> **D2 warned "do not assume LAS listing implies working OPeNDAP." D3 tested it four times across
> two sessions. It never returned a byte.**

### 6.2 HF Radar / ICORN

| Item | Finding |
| --- | --- |
| **Machine endpoint** | **None.** Absent from ERDDAP, absent from LAS, and absent from all 340 GeoServer WMS layers. |
| **Official access mechanism** | INCOIS Data Holdings (re-read live): *"HF Radar · Current Vector · Real-time · 2008 - till date · **Registered access through Website**"*. The Data Holdings page carries a **Data Requisition Form** link. |
| **Requisition requirement** | A **duly signed Data Requisition Form** sent to Dr. Udaya Bhaskar TVS, Head, Ocean Data Management Division, INCOIS, Hyderabad — `uday@incois.gov.in` (D2, archived form page) |
| **Data format** | NetCDF (per archived INCOIS HF-radar page) |
| **Temporal resolution** | Hourly *(peer-reviewed literature; not stated on a current INCOIS page)* |
| **Spatial resolution** | ~6 km *(literature; not INCOIS-stated)* |
| **Geographic coverage** | Indian coastal waters ≤200 km offshore — Andhra Pradesh, Tamil Nadu, Gujarat, Odisha, Andaman |
| **U/V components** | Data Holdings says *"Current Vector"* → speed + direction + U/V. Not independently verifiable without access. |
| **Automated retrieval** | ❌ Not possible pre-approval; unknown whether approved users receive a scriptable endpoint |
| **Public visualization vs data** | Visualization is public; **downloadable data is gated behind the requisition form** |
| **Appropriate for BlueNexus?** | Only after a successful requisition, and only as a coastal surface overlay |

### 6.3 OSF / HOOFS

**This is the most decisive new finding in D3.** All 340 WMS layers and all 9 WCS coverages on the
INCOIS GeoServer were enumerated and searched for current/velocity/U/V/forecast-field layers.

What the `OSF_*` workspaces actually contain:

```
OSF_CoastalForecast:SECTORNAME_ANDHRAPRADESH, …_GUJARAT, …_KERALA, …_TAMILNADU, (12 states/UTs)
OSF_RegionalForecast:NAME_Arabian SeaHA, NAME_Bay of Bengal, NAME_Indian Ocean,
                     NAME_Persian Gulf, NAME_Red Sea, NAME_South China Sea
OSF_GlobalForecast:OSF_GLOBALFORECAST, eez_boundaries_v12
OSF_LocationSpecific:LOCATION_SPECIFIC
shapefiles_LandingCenters_OSF:LandingCenters_29Apr2024
```

These are **sector polygons, EEZ boundaries and landing-centre points** — the map furniture the
OSF web viewer draws so a user can click a region. **The forecast fields themselves (current
speed, SST, MLD, D20) are not published as WMS layers or WCS coverages.**

| Item | Finding |
| --- | --- |
| **Machine-readable current data?** | ❌ **No.** No forecast-field layer exists on the GeoServer; no OPeNDAP; no download service found. |
| **Only visualization available?** | ✅ Yes — `osf.jsp` and its linked viewers |
| **Current variables (as published to humans)** | "Current Speed (m/s)"; direction is not a named OSF parameter |
| **Spatial resolution (model)** | IO-HOOFS 1/12° (~9.2 km); NIO-HOOFS 1/48° (~2.3 km) |
| **Temporal resolution** | daily run, 3-hourly steps, +5 (to +10) days |
| **Forecast vs analysis** | Both — HOOFS produces a daily analysis and a forecast |
| **API / GeoServer** | WMS/WCS reachable but publish no OSF fields; `/geoserver/rest/` correctly returns **401** (admin API — not touched) |
| **Authentication** | n/a — there is nothing to authenticate *to* |
| **Automated retrieval feasibility** | 🔴 **Not feasible** |

**On the 403 (investigated, not bypassed).** The `403 Forbidden` reported in D2 comes from the
**Apache 2.4.63 front-end** (`Server: Apache/2.4.63 (Red Hat Enterprise Linux)`) and applies to
`/geoserver/ows` and `/geoserver/web`. Other paths (`/geoserver/wms`, `/geoserver/wcs`) are
proxied through to **Jetty 9.4.52** and respond normally. No credentials were guessed, no headers
were spoofed, and the protected admin API at `/geoserver/rest/` (401) was left alone. The
asymmetry is documented in §9 as an access-intent question for INCOIS.

### 6.4 Other official INCOIS candidates

| Candidate | Access | Verdict |
| --- | --- | --- |
| `incois_valueadded_products_datasets` — `GEO_U`, `GEO_V` (surface geostrophic, cm/s) | ERDDAP griddap, **no auth, works perfectly** | 🔴 Data ends **2019-03-30**. The *access* is the best of any current dataset; the *data* is 6.5 years stale. |
| LAS `u` / `v` — GODAS/MOM monthly reanalysis, 40 levels | LAS OPeNDAP | 🔴 Same OPeNDAP failure; ends 2023-12-15 |
| OMNI / RAMA moored buoys | INCOIS: visualisation only, no download | 🔴 Not a field; no INCOIS download |
| GeoServer layer sweep for any other current source | 340 layers enumerated | 🔴 **No ocean-current layer exists on the server** |

**No stronger official INCOIS current source was discovered.** No source was introduced merely
because it is easier to access.

---

## 7. ERDDAP Technical Details

| Item | Value |
| --- | --- |
| **Version** | **2.30** — `GET /erddap/version` → `ERDDAP_version=2.30`; response header `erddap-server: 2.30.0` |
| **DAP layer** | header `xdods-server: dods/3.7` |
| **Catalog endpoints** | `/erddap/info/index.json?page=1&itemsPerPage=1000` · `/erddap/tabledap/allDatasets.json?datasetID,accessible,title,minTime,maxTime,…` |
| **Per-dataset metadata** | `/erddap/info/{id}/index.json` · `/erddap/griddap/{id}.das` · `/erddap/griddap/{id}.dds` |
| **Documentation** | `/erddap/griddap/documentation.html` (146 KB) · `/erddap/tabledap/documentation.html` (166 KB) · `/erddap/rest.html` (52 KB) · `/erddap/information.html` (70 KB) — all HTTP 200 |
| **griddap vs tabledap** | **griddap** for the gridded Argo/OCM/value-added products (multidimensional arrays). **tabledap** for `Indian_ARGO_Floats` (point/profile rows). |
| **Authentication** | **None on any dataset** — all 16 report `accessible = public` |

### 7.1 Response formats — measured on one full 3-D volume (1 time × 24 depth × 60 lat × 90 lon = 129,600 points)

| Format | HTTP | Size | Time | Content-Type | Note |
| --- | --- | --- | --- | --- | --- |
| **`.nc`** | 200 | **523,584 B** | **0.50 s** | `application/x-netcdf` | **NetCDF-3 classic** (magic `CDF\x01`) — smallest + fastest |
| `.mat` | 200 | 520,472 B | 0.71 s | `application/x-download` | Matlab |
| `.dods` | 200 | 520,149 B | 0.69 s | `application/octet-stream` | OPeNDAP binary |
| `.csv` | 200 | 5,517,794 B | 1.34 s | `text/csv` | 10.5× larger than NetCDF |
| `.nccsv` | 200 | 5,719,367 B | 1.74 s | `text/csv` | CSV + metadata header |
| `.json` | 200 | 7,268,729 B | 2.26 s | `application/json` | 13.9× larger than NetCDF |
| `.htmlTable` | 200 | 11,799,848 B | 3.89 s | `text/html` | human-facing |
| `.xhtml` | 200 | 17,100,969 B | 3.98 s | `application/xhtml+xml` | human-facing |
| `.geotif` | **400** | 119 B | — | — | `"For .geotif requests, the size of axis=ZAX must be 1."` — works for a single-depth 2-D slice (verified: 6,280 B) |
| `.das` / `.dds` | 200 | 6,882 / 3,297 B | 0.16 s | metadata | — |

### 7.2 Transport behaviour

| Feature | Finding |
| --- | --- |
| **Compression** | ✅ Server honours `Accept-Encoding: gzip`. CSV **5,517,794 B → 507,824 B on the wire** (10.9×). `.nc` responses are returned with `Content-Encoding: gzip` automatically. |
| **HTTP caching** | ❌ **No `ETag`, no `Cache-Control`.** `Last-Modified` equals the response timestamp, not the data's modification time — **conditional GET is useless here.** Track dataset currency by querying the `time` axis (`?time[(last)]`, 160 B). |
| **Content-Disposition** | `attachment; filename=incois_argo_10day_McCreary_<hash>_<serial>.nc` — filenames are request-specific, not stable identifiers |
| **Concurrency / rate limits** | 6 parallel requests → all HTTP 200, **547 ms wall clock**. No throttling, 429, or block observed at modest concurrency. No published rate-limit policy was found; D7 should still stay polite (small pool, backoff). |
| **Empty results (tabledap)** | Returns **HTTP 404** with body `Error { code=404; message="Not Found: Your query produced no matching results. (nRows = 0)"; }`. **A 404 here means "no rows matched", not "dataset gone"** — D7 must distinguish these. |

### 7.3 tabledap specifics (`Indian_ARGO_Floats`)

Query form: `?{columns}&{constraints}` with `>=`, `<=`, `=`, `!=`, `>`, `<` (URL-encoded).
Verified request returned 6,118 B in 0.28 s:

```
/erddap/tabledap/Indian_ARGO_Floats.csv
  ?PLATFORM_NUMBER,time,latitude,longitude,PRES,TEMP,PSAL,TEMP_QC,PSAL_QC
  &time>=2025-04-01&time<=2025-04-23
  &latitude>=5&latitude<=20&longitude>=60&longitude<=80
```

Sample output (units row is CSV line 2 — a parser must skip it):

```
PLATFORM_NUMBER,time,latitude,longitude,PRES,TEMP,PSAL,TEMP_QC,PSAL_QC
,UTC,degrees_north,degrees_east,decibar,degree_Celsius,PSU,,
6990715,2025-04-01T19:52:02Z,9.4,68.45,0.4,30.137,34.274,1,1
```

Note `PRES` is in **decibar** (pressure), not metres — conversion is required if profiles are ever
plotted on the same depth axis as the gridded product.

### 7.4 Does each parameter exist on ERDDAP?

| Parameter | Present? | Current? |
| --- | --- | --- |
| **Temperature** | ✅ `T_ANALYZED` / `TEMP` in 4 Argo datasets | ✅ to 2026-07-30 |
| **Salinity** | ✅ `S_ANALYZED` / `SAL` in the same 4 datasets | ✅ to 2026-07-30 |
| **Currents** | ⚠️ only surface geostrophic `GEO_U`/`GEO_V` | ❌ ends 2019-03-30 |
| **Chlorophyll** | ⚠️ only `CHL` in Oceansat-2 / IRS-P4 | ❌ ends 2020-05-01 |

**Verdict: INCOIS ERDDAP is fully suitable for temperature and salinity, and unsuitable for
currents and chlorophyll.**

---

## 8. Data Formats

| Dataset | Native Format | Available Response Formats | Recommended for D4/D7 | Reason |
| --- | --- | --- | --- | --- |
| `incois_argo_10day_McCreary` (T + S) | NetCDF (CDI/CDO-written, CF-1.6/COARDS/ACDD-1.3) | **NetCDF-3** (`.nc`), CSV, JSON, NCCSV, `.mat`, `.dods`, GeoTIFF (2-D only), htmlTable, xhtml | **NetCDF-3 via `.nc`** | 10.5× smaller than CSV, 13.9× smaller than JSON, fastest (0.50 s), self-describing, typed, preserves `_FillValue`, reads directly with `xarray`/`netCDF4`/`scipy` |
| `incois_argo_10d_VAM`, `incois_argo_mnt_*` | NetCDF | same | **NetCDF-3 (`.nc`)** | identical rationale |
| `Indian_ARGO_Floats` (profiles) | tabular | CSV, JSON, NetCDF, `.mat`, htmlTable | **CSV** (or JSON) | row-oriented data; CSV is compact over gzip and trivially parsed; skip the units row |
| INCOIS-GODAS (LAS) | NetCDF | (OPeNDAP → NetCDF) | **None — route unavailable** | OPeNDAP never responded; FTP requires credentials |
| `PFZ-TUNA-SST-CHL:chl` (GeoServer) | **GeoTIFF** | **GeoTIFF**, TIFF, PNG, JPEG, GIF | **Do not adopt yet** | GeoTIFF is a fine format, but the band (`GRAY_INDEX`, placeholder units) has no documented mapping to mg/m³ and there is no time axis |
| INCOIS Ocean Colour (ChloroGIN) | **Not stated by INCOIS** | none exposed | **None — no machine route** | Web viewer only; archive by email |
| HF Radar / ICORN | NetCDF (per archived INCOIS page) | unknown | **None until requisition approved** | No endpoint exists |

> No format is recommended above unless it was **actually returned** by the source during this
> investigation.

### Format note for D4/D7

`.nc` responses arrive **already gzip-compressed** (`Content-Encoding: gzip`), so a client that
sets `Accept-Encoding: gzip` gets both the binary compactness of NetCDF and transport compression.
A full 3-D volume is ~0.5 MB — small enough to hold in memory and reshape without streaming
machinery.

---

## 9. Authentication and Registration

| Resource | Auth | Registration | Credential/token | Evidence |
| --- | --- | --- | --- | --- |
| INCOIS ERDDAP — all datasets | **None** | **None** | None | `accessible = public` on all 16 datasets; anonymous data requests returned real values |
| INCOIS LAS catalog (`getDatasets.do`, THREDDS `catalog.xml`) | None | None | None | HTTP 200 anonymously |
| INCOIS LAS OPeNDAP (`/thredds/dodsC/`) | None *(it simply never responds)* | None | None | HTTP 000 after 70 s ×2 |
| INCOIS-GODAS FTP (`ftpser.incois.gov.in`) | **Yes** | **Yes** | Unknown — contact named on `godas.jsp` | Anonymous login → **FTP 530 Access denied** |
| HF Radar / ICORN | **Yes** | **Yes — signed Data Requisition Form** | Approval-based | Data Holdings *"Registered access through Website"*; requisition form → `uday@incois.gov.in` |
| INCOIS Ocean Colour archive (chlorophyll) | — | **Yes — email request** | — | `ChloroGIN_SP.jsp`: *"For archive data kindly contact samanta.a@incois.gov.in"* |
| INCOIS GeoServer WMS/WCS | **None on `/wms`, `/wcs`** | None | None | Anonymous `GetCapabilities`, `GetMap`, `DescribeCoverage`, `GetCoverage` all HTTP 200 |
| INCOIS GeoServer `/ows`, `/web` | **Blocked** | — | — | **HTTP 403** from Apache front-end |
| INCOIS GeoServer `/rest/` (admin API) | **Yes** | — | — | **HTTP 401** — correctly protected; **not touched** |
| Digital Ocean (`do.incois.gov.in`) | **Yes — JWT login** | **Yes** | JWT cookie | SPA redirects to `/login` on 401 (D2) |

### Access-intent question for INCOIS (D4 action, not a D3 conclusion)

The GeoServer front-end blocks `/geoserver/ows` and `/geoserver/web` while leaving `/geoserver/wms`
and `/geoserver/wcs` open. That may be deliberate (serve the maps, hide the admin/dispatcher) or an
incomplete rule. **BlueNexus should ask INCOIS before building anything on that endpoint**, and
should combine the question with the chlorophyll archive request in §5.

---

## 10. Automation Feasibility

| Dataset | Class | Evidence |
| --- | --- | --- |
| **`incois_argo_10day_McCreary` (T + S)** | 🟢 **Easy** | No auth, no registration. 11 distinct subsetting patterns verified HTTP 200. Typical regional query 357,648 B in 0.56 s; full 3-D volume 523,584 B in 0.50 s. 6 concurrent requests all succeeded. NetCDF-3 output reads directly into xarray. *(One caveat: TLS chain must be supplied — §11.)* |
| `incois_argo_10d_VAM`, `incois_argo_mnt_*` | 🟢 **Easy** | Same server, same query grammar, same formats; verified returning data at 2026-07-30 / 2026-07-15 |
| `Indian_ARGO_Floats` (profiles) | 🟢 **Easy** *(access)* | Constrained tabledap query returned 6,118 B in 0.28 s. **But data ends 2025-04-23** — easy to automate, not useful as a live feed |
| `incois_valueadded_products_datasets` (`GEO_U`/`GEO_V`) | 🟢 **Easy** *(access)* / 🔴 *(data)* | Access is as good as the Argo product; the data stops at 2019-03-30 |
| `incois_oceansat2_datasets` (CHL) | 🟢 **Easy** *(access)* / 🔴 *(data + licence)* | Public griddap works; ends 2020-05-01 and is DoS-restricted |
| **`PFZ-TUNA-SST-CHL:chl` (GeoServer WCS)** | 🟠 **Restricted** | Technically automatable — `GetCoverage` returned a **201,088 B valid GeoTIFF in 0.66 s** with lat/lon subsetting. But: no time axis, `GRAY_INDEX` band with no documented mg/m³ scaling, and ambiguous access intent (403 on sibling paths). **Not safe to depend on without INCOIS confirmation.** |
| **INCOIS Ocean Colour / ChloroGIN (current CHL)** | 🔴 **Not currently feasible** | Zero machine endpoints. Zero occurrences of `ftp`/`download`/`opendap`/`wms` and zero data-file extensions across both viewer pages. Archive access is an email request. |
| **INCOIS-GODAS via LAS OPeNDAP** | 🔴 **Not currently feasible** | `/thredds/dodsC/…dds` → **HTTP 000, 0 B, 70 s**, twice, for two different datasets, while catalog controls on the same host returned 200 |
| **INCOIS-GODAS via FTP** | 🟠 **Restricted** | Anonymous **FTP 530**; credentials/approval required via a named contact |
| **HF Radar / ICORN** | 🟠 **Restricted** | No endpoint of any kind; a signed Data Requisition Form is the documented route |
| **OSF / HOOFS forecast fields** | 🔴 **Not currently feasible** | All 340 WMS layers and 9 WCS coverages enumerated — **the OSF workspaces contain only sector polygons and location points; no forecast field is published** |

---

## 11. TLS / Certificate Findings

### 11.1 What the server presents

```
Certificate chain
 0 s:C=IN, ST=Telangana, L=Hyderabad,
     O=Indian National Centre for Ocean Information Services (INCOIS), CN=*.incois.gov.in
   i:C=BE, O=GlobalSign nv-sa, CN=GlobalSign RSA OV SSL CA 2018
---
verify error:num=20:unable to get local issuer certificate
Verify return code: 21 (unable to verify the first certificate)
```

| Property | Value |
| --- | --- |
| Subject | `CN=*.incois.gov.in` |
| SAN | `DNS:*.incois.gov.in`, `DNS:incois.gov.in` |
| Issuer | `GlobalSign RSA OV SSL CA 2018` (intermediate) |
| Root | `GlobalSign Root CA - R3` |
| Validity | 2026-02-18 → 2027-03-21 (**currently valid**) |
| **Certificates sent in handshake** | **1 — the leaf only** |
| **AIA extension** | ✅ present: `CA Issuers - URI: http://secure.globalsign.com/cacert/gsrsaovsslca2018.crt` |

**The certificate is valid and correctly issued. The server simply fails to send the intermediate
CA certificate alongside it.**

### 11.2 Is the chain incomplete? — Yes, and it is per-vhost

| Host | Certs in chain | openssl verify |
| --- | --- | --- |
| `erddap.incois.gov.in` | **1** | ❌ code 21 |
| `las.incois.gov.in` | **1** | ❌ code 21 |
| **`incois.gov.in`** | **2** | ✅ **code 0 (ok)** |

The main site is configured correctly. **This proves the problem is a server-side vhost
misconfiguration on the `erddap` and `las` hosts, not a CA problem and not a client problem.**

### 11.3 Which clients reject it, which accept it — all verified

| Client | Result |
| --- | --- |
| `curl 8.21.0` (Schannel, Windows) | ✅ HTTP 200 |
| Python 3.14 `urllib`, default context (Windows store) | ✅ HTTP 200 |
| **Python, trusting GlobalSign Root R3 only** | ❌ **FAIL — `unable to get local issuer certificate`** |
| Python, trusting root **+ intermediate** | ✅ OK |
| `openssl verify -CAfile r3.pem leaf.pem` | ❌ `error 20 at 0 depth` |
| `openssl verify -CAfile r3.pem -untrusted gsint.pem leaf.pem` | ✅ **`leaf.pem: OK`** |
| **Node.js v24.20.0 `https` module** | ❌ **`UNABLE_TO_VERIFY_LEAF_SIGNATURE`** |
| **Node.js v24.20.0 global `fetch` (undici)** | ❌ **`UNABLE_TO_VERIFY_LEAF_SIGNATURE`** |
| Node.js `--use-system-ca` | ✅ HTTP 200 |
| Node.js `NODE_EXTRA_CA_CERTS=<intermediate.pem>` | ✅ HTTP 200 |

### 11.4 Why curl and Python "work" here — and why that is misleading

Inspecting Python's default trust store on this machine found
**`GlobalSign RSA OV SSL CA 2018` already present in it.** Windows/Schannel performs AIA chasing
and caches fetched intermediates into the Windows CA store, which Python's
`create_default_context()` then loads. The client is not completing the chain from the handshake —
it already had the missing piece.

> ⚠️ **Consequence for D4/D7: the BlueNexus backend is Python/FastAPI and will very likely deploy
> on Linux, where `certifi` ships roots only, no intermediates are cached, and OpenSSL does not do
> AIA chasing. The root-only test above shows that configuration FAILS.** The fact that it works on
> this Windows dev machine must not be mistaken for it working in production.

### 11.5 Classification

| Question | Answer |
| --- | --- |
| Server certificate-chain issue? | ✅ **Yes — this is the root cause.** Incomplete chain on the `erddap`/`las` vhosts. |
| Client/environment issue? | Partly — success depends on whether the client can obtain the intermediate (AIA chasing or a cached/bundled copy) |
| Node/undici compatibility issue? | Node is **strict and correct**; it does no AIA chasing and uses its own bundled roots. Not a Node bug — a predictable consequence of the server's misconfiguration. |
| Something else? | No. Certificate validity, hostname and SAN are all fine. |
| Does a proper CA-chain solution exist? | ✅ **Yes — verified two of them** (§11.6) |

### 11.6 Proper solutions (documented, NOT implemented in this step)

1. **Preferred long-term:** report the incomplete chain to INCOIS so `erddap`/`las` serve the
   intermediate as `incois.gov.in` already does. One server-side fix removes the problem for every
   client.
2. **Python (the BlueNexus backend):** build a CA bundle containing the normal roots **plus** the
   `GlobalSign RSA OV SSL CA 2018` intermediate, and point the HTTP client's `verify` at it
   (`httpx.Client(verify=<bundle>)` / `requests(..., verify=<bundle>)`). Verification stays fully
   enabled. Verified working via `load_verify_locations`.
3. **Node tooling (if any):** `NODE_EXTRA_CA_CERTS=<intermediate.pem>` or `--use-system-ca`. Both
   verified working.

### 11.7 What was explicitly NOT done

Per the D3 constraints, **no verification-disabling technique was used anywhere**:

- ❌ `NODE_TLS_REJECT_UNAUTHORIZED=0` — not used
- ❌ `rejectUnauthorized: false` — not used
- ❌ `verify=False` / `curl -k` — not used in any test reported in this document
- ❌ No insecure certificate-bypass code was written into the project

All findings above come from either a client that legitimately completed the chain, or an explicit
trust-store configuration that *added* the missing intermediate. No workaround was implemented in
project code — this step is investigation only.

---

## 12. Recommended Access Architecture for D4–D7

> **These are D3 technical recommendations — design inputs for D4 and D7. Nothing here is
> implemented, and no ingestion code has been written.**

| Parameter | Preferred Dataset | Preferred Access Method | Format | Automation Feasibility | Reason |
| --- | --- | --- | --- | --- | --- |
| **Temperature** | `incois_argo_10day_McCreary` | **ERDDAP `griddap` HTTPS GET**, one request per time step, bbox + depth-range subset | **NetCDF-3 (`.nc`)** | 🟢 **Easy** | Only verified public, no-auth, current, depth-resolved INCOIS temperature route. 523 KB / 0.50 s for a full volume. |
| **Salinity** | `incois_argo_10day_McCreary` | **Same request** — `T_ANALYZED,S_ANALYZED` in one call | **NetCDF-3 (`.nc`)** | 🟢 **Easy** | One dataset, one loader, one request serves both parameters (357,648 B / 0.56 s for a regional 3-D volume of both) |
| **Chlorophyll** | *(none adoptable)* | **Do not implement yet.** D4 should keep the existing demo path and open an INCOIS request (`samanta.a@incois.gov.in`) asking for the machine-readable NRT CHL feed, its format, cadence and the `PFZ-TUNA-SST-CHL:chl` band semantics. | *(TBD)* | 🔴 **Not feasible** | No verified public machine-readable route; the GeoServer raster is undated and unscaled |
| **Ocean Currents** | *(none adoptable)* | **Do not implement yet.** D4 should pursue, in parallel: (a) GODAS FTP credentials via the `godas.jsp` contact, (b) a signed HF Radar Data Requisition Form, (c) a question to INCOIS about any OSF/HOOFS gridded output. | *(TBD)* | 🔴 / 🟠 | GODAS OPeNDAP does not respond; FTP and HF Radar are gated; OSF/HOOFS publishes no data layer |

### What D7 should eventually implement (for temperature + salinity)

1. **Discovery:** `GET /erddap/griddap/{id}.das` once at startup to read the axes, `_FillValue` and
   units, rather than hard-coding them.
2. **Currency check:** `GET …?time[(last)]` (**160 B**) to learn the newest available step. HTTP
   caching cannot be used — there is no `ETag` or meaningful `Last-Modified`.
3. **Fetch:** one `.nc` request per time step, subset to the frontend's bbox and depth range, with
   `T_ANALYZED` and `S_ANALYZED` requested together, `Accept-Encoding: gzip` set.
4. **Never** request a multi-time-step series in one call (31 s vs 0.5 s).
5. **TLS:** a CA bundle containing the GlobalSign intermediate, with verification left **on**.
6. **Handle:** `9999.0` fill values → `NaN`; rename `ZAX` → `depth` and add `positive="down"`;
   treat tabledap `404 / nRows = 0` as "empty", not "missing dataset".
7. **Be polite:** small concurrency, backoff, and cache fetched volumes locally — the data only
   changes every ~10 days.

---

## 13. Remaining Unknowns

1. **INCOIS Ocean Colour (ChloroGIN) machine feed** — does one exist at all? What format, cadence,
   domain and file naming? What does the `samanta.a@incois.gov.in` archive request actually yield,
   and how quickly? *(D2 unknown, still open; D3 narrowed it — resolution is 1 km, regions are the
   8 IOGOOS states — but found no endpoint.)*
2. **`PFZ-TUNA-SST-CHL:chl` semantics** — what does `GRAY_INDEX` mean numerically? Is there a
   scaling to mg/m³? What date is the snapshot from, and how often is it replaced? Is BlueNexus
   permitted to consume it programmatically?
3. **GeoServer access intent** — is the 403 on `/geoserver/ows` and `/geoserver/web` deliberate?
   Are `/wms` and `/wcs` intended to be open to third-party applications?
4. **INCOIS-GODAS OPeNDAP** — is `/thredds/dodsC/` broken server-side, or blocked/slow from this
   network? Does it work from an Indian network or a different client?
5. **INCOIS-GODAS FTP** — are credentials issued on request? What is the directory layout, file
   granularity and actual currency (LAS stops at 2025-05-22 despite a "1-day delay" claim)?
6. **HF Radar requisition** — turnaround time, whether approved users receive a scriptable
   endpoint, current operational station count, real grid resolution from an INCOIS source, and
   public archive latency.
7. **OSF / HOOFS** — is there *any* non-public gridded output (FTP, internal THREDDS) obtainable by
   request? INCOIS is a WMO RSMC, so an operational data route may exist off the public web.
8. **Digital Ocean (`do.incois.gov.in`)** — what does it expose behind the JWT login, and can
   BlueNexus obtain an account? *(Carried from D2.)*
9. **ERDDAP rate limits** — no published policy found; 6 concurrent requests were fine, but the
   real ceiling is unknown.
10. **Argo gridded update cadence** — still no official schedule; needs observation over weeks.
11. **Licensing for BlueNexus's specific use** — non-commercial coverage under the INCOIS
    disclaimer vs. written permission. *(Carried from D1/D2.)*

---

## 14. D3 Status

**D3 STATUS: COMPLETE**

| D3 completion criterion | Met? | Notes |
| --- | --- | --- |
| Access mechanisms investigated for all four parameters | ✅ | Temperature, salinity (ERDDAP griddap); chlorophyll (ChloroGIN viewer, ERDDAP, GeoServer WMS/WCS); currents (LAS OPeNDAP, FTP, HF Radar requisition, GeoServer layer sweep) |
| Machine-readable access distinguished from web visualization | ✅ | Four-level model applied throughout (§1); OSF and ChloroGIN shown to be visualization-only |
| Formats identified | ✅ | §8, with measured sizes and timings for 10 ERDDAP response formats |
| Authentication / registration requirements investigated | ✅ | §9 — including FTP 530, requisition form, JWT login, GeoServer 401/403 |
| Automation feasibility assessed | ✅ | §10 — 🟢/🟡/🟠/🔴 with evidence per dataset |
| ERDDAP technically investigated | ✅ | §7 — version 2.30, endpoints, query grammar, formats, compression, caching, concurrency, tabledap |
| Chlorophyll access specifically investigated | ✅ | §5 — viewer reverse-engineered, 1 km resolution established, GeoServer WCS lead found and assessed |
| Current-data access candidates compared | ✅ | §6 — GODAS, HF Radar/ICORN, OSF/HOOFS, plus a full 340-layer GeoServer sweep for alternatives |
| TLS issues documented | ✅ | §11 — root cause, per-host comparison, 10-client matrix, two verified proper fixes, no bypass used |
| No production ingestion / API / frontend implementation performed | ✅ | Read-only investigation. Only file created is this document. |

### Files created / modified

- **Created:** `docs/data-access.md` (this file)
- **Unchanged:** `docs/data-sources.md` (D1), `docs/data-availability.md` (D2)
- No code, config, backend or frontend files touched.

**Do not proceed to D4 automatically.**
