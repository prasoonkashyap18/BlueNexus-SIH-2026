# BlueNexus — D3 Follow-Up: Chlorophyll & Ocean Currents

**Task:** D3 FOLLOW-UP (targeted). Resolve the two parameters D3 left unresolved.
**Type:** Investigation and documentation only. No ingestion, no backend, no API, no frontend, no mock-data replacement, no D4 work.
**Prepared:** 2026-09-05
**Companions (all unchanged):** `docs/data-sources.md` (D1) · `docs/data-availability.md` (D2) · `docs/data-access.md` (D3)

---

## 1. Objective

D3 closed temperature and salinity but left two parameters open:

- **Chlorophyll** — "No verified public machine-readable access route found."
- **Ocean currents** — GODAS OPeNDAP dead, HF Radar gated, "OSF/HOOFS forecast fields are not published as data at all."

This follow-up re-opens both questions with deeper technical probing, and reaches a materially
different answer for currents and a substantially better-informed answer for chlorophyll.

### Headline result

> **A previously undiscovered INCOIS THREDDS Data Server at `https://incois.gov.in/thredds/`
> publishes the OSF/HOOFS ocean-current forecast as CF-compliant NetCDF with U and V components,
> updated daily, over OPeNDAP, NetCDF Subset Service, WMS, WCS and direct file download —
> with no authentication.**

This **corrects D3 §6.3**. D3's conclusion was correct *about the GeoServer* (which genuinely
publishes no forecast fields) but wrong as a statement about INCOIS overall: the forecast data
lives on a **different server** that D3 did not reach. D3 observed that
`https://incois.gov.in/thredds/catalog.html` returned HTTP 302 but did not follow the redirect.
Following it exposes the whole catalog.

| Parameter | D3 verdict | D3 follow-up verdict |
| --- | --- | --- |
| **Ocean currents (surface)** | 🔴 Not feasible | 🟢 **Easy — INCOIS confirmed**, U/V, 1/12°, 3-hourly, daily updated, no auth |
| **Ocean currents (subsurface)** | 🔴 Not feasible | 🔴 Still not available from INCOIS openly — fallback needed |
| **Chlorophyll** | 🔴 No route found | 🟠 **INCOIS routes exist but none is simultaneously current + Indian Ocean + dated** — access request needed |

---

## 2. Existing D3 Findings Carried Forward

Preserved unchanged and not re-litigated here:

| Finding | Source | Status |
| --- | --- | --- |
| Temperature + salinity solved via ERDDAP `griddap` on `incois_argo_10day_McCreary` (NetCDF-3, 24 levels 5–2000 m, no auth) | D3 §3–4 | Unchanged |
| ERDDAP v2.30 query grammar, formats, gzip, no ETag/Cache-Control, 31 s cross-time performance cliff | D3 §7 | Unchanged |
| TLS: `erddap`/`las` vhosts send leaf-only chain; Node fails; proper fix is to supply the GlobalSign intermediate, never to disable verification | D3 §11 | Unchanged, and see §8 below for the new host |
| ChloroGIN CHL resolution = 1 km; regions = 8 IOGOOS states; archive by email to `samanta.a@incois.gov.in` | D3 §5.1 | Unchanged, reconfirmed |
| INCOIS GeoServer publishes no ocean-current layer among 340 WMS layers | D3 §6.3 | Unchanged and re-verified — but **not the whole story** (§5) |
| GODAS via LAS OPeNDAP returns HTTP 000 after 70 s | D3 §6.1 | Re-tested, unchanged, and now explained (§5.2) |
| HF Radar requires a signed Data Requisition Form | D3 §6.2 | Unchanged |
| Oceansat-2 OCM chlorophyll ends 2020-05-01 and is DoS-restricted | D2/D3 | Unchanged |

---

## 3. Chlorophyll Investigation

### 3.1 Candidate A — INCOIS ChloroGIN / Ocean Colour Products (web viewer)

Re-confirmed, nothing new. **VERIFIED:** GET form with `product`/`roll`/`region`/`resolution`;
CHL served at 1 KM; region vocabulary `Entire, IndiaSriLanka, Iran, Kenya, Maldives, Oman,
Tanzania, Thailand`; page states *"For archive data kindly contact samanta.a@incois.gov.in"*;
no `.nc`/`.hdf`/`.tif` strings and zero occurrences of `ftp`/`download`/`opendap`/`wms` in either
viewer page.

**This is human/web access, not a dataset.** Classification: **Restricted** (email request).

### 3.2 Candidate B — INCOIS GeoServer WCS `PFZ-TUNA-SST-CHL:chl` — substantially upgraded

D3 flagged this as an undated, unscaled lead. Deeper probing resolved the scientific-meaning
question decisively.

**It is real float32 scientific data, not a rendered image — VERIFIED.**
Parsing the returned GeoTIFF's own tags:

| TIFF tag | Value | Meaning |
| --- | --- | --- |
| `BitsPerSample` | **32** | 32-bit samples |
| `SampleFormat` | **3** | **IEEE FLOAT** |
| `SamplesPerPixel` | **1** | single band (not RGB) |
| `Photometric` | 1 | BlackIsZero continuous grayscale |
| `GeoKeyDirectory` | EPSG **4326** | geographic CRS |
| ModelTransformation | pixel scale **0.009°** | ≈ 1 km |
| `DateTime`, `ImageDescription`, `GDAL_METADATA`, `GDAL_NODATA` | **absent** | **no embedded date, no declared nodata** |

**The units are officially declared by INCOIS — VERIFIED.** The WCS `swe:uom` of `W.m-2.Sr-1`
that D3 flagged is a GeoServer default artifact; it is contradicted by the layer's own published
metadata in `GetCapabilities`:

> Title: **`Chlorophyll Concentration`**
> Style: `PFZ-TUNA-SST-CHL:pfz_tuna_chl_sld`
> Abstract: *"… **Chlorophyll Concentration CHL visualization (mg/m3)**"*

**The values behave like chlorophyll-a — VERIFIED.** WMS `GetFeatureInfo` point sampling:

| Location | `GRAY_INDEX` | Expectation |
| --- | --- | --- |
| Central Arabian Sea (71°E, 11°N) | **0.2858** | ✅ plausible mg/m³ |
| Off Kerala (75.5°E, 10°N) | **0.1430** | ✅ plausible |
| Equatorial Indian Ocean (60°E, 5°N) | **0.1006** | ✅ oligotrophic |
| 55°E, 3°S | **0.0975** | ✅ oligotrophic |
| Land — central India (78°E, 22°N) | `NaN` | ✅ correct land mask |
| Land — Saudi Arabia (45°E, 25°N) | `NaN` | ✅ correct land mask |
| Open ocean, 4 further points | `NaN` | ⚠️ cloud gaps (single-pass product) |

The magnitude and the oligotrophic→Arabian-Sea gradient are both physically correct.

**What remains wrong with it:**

| Issue | Status |
| --- | --- |
| **No time dimension** | **VERIFIED** — a scan of the full 1.3 MB `GetCapabilities` found **zero `<Dimension>` elements across all 340 layers**. The GeoServer is architecturally a "latest snapshot" map server. |
| No acquisition date anywhere | **VERIFIED** — absent from WMS metadata *and* from the GeoTIFF tags |
| Refresh cadence unknown | **UNVERIFIED** — cannot be determined from a single session |
| Source sensor undeclared | **UNVERIFIED** |
| Intermittent `HTTP 503` | **VERIFIED** — one 503 observed, then 3 consecutive retries all HTTP 200 |
| Redistribution permission | **UNVERIFIED** — Apache 403s `/geoserver/ows` and `/geoserver/web` while `/wms` and `/wcs` pass through; intent is ambiguous |

### 3.3 Candidate C — INCOIS THREDDS `remotesensing/…-Entire-CHL.nc` — best metadata, wrong date

**NEW in this follow-up.** Found on the newly discovered THREDDS server. This is the most
scientifically complete INCOIS chlorophyll object located anywhere.

`https://incois.gov.in/thredds/dodsC/remotesensing/VIIRS-SNPP-Mar2025-d27-4KM-Entire-CHL.nc`

**VERIFIED** from its own DAS:

| Attribute | Value |
| --- | --- |
| Variable | **`chl_abi`** |
| `long_name` | "Chlorophyll Concentration, ABI Algorithm" |
| **`units`** | **`mg m^-3`** |
| **`standard_name`** | **`mass_concentration_of_chlorophyll_in_sea_water`** (CF) |
| `_FillValue` | **−32767.0** |
| `valid_min` / `valid_max` | 0.001 / 100.0 |
| `display_scale` | `log` (display_min 0.01, display_max 100.0) |
| `reference` | **Shanmugam P. (2011), JGR 116(C4), C04016, doi:10.1029/2010JC006796** |
| `instrument` | **VIIRS** · title "VIIRSN Level-3 Standard Mapped Image" |
| Grid | lat **6816** × lon **6528** |
| **Extent** | lat **30.99 → −39.99**, lon **35.01 → 102.99** — **Indian Ocean** |
| Resolution | ≈ **0.0104° ≈ 1.16 km** (`product_name` says 1KM; the catalog filename says 4KM — a naming discrepancy) |
| File size | 27,364,556 B |

> ✅ **This extent covers the entire BlueNexus frontend box (lat −35…25, lon 40…100) — including
> the southern strip below 29.5°S that the Argo product cannot reach.**

**The blocker — VERIFIED:** `Last-Modified: Fri, 04 Jul 2025 13:25:51 GMT`, data from **March 2025
day 27**. It is a **single static sample pinned in the root catalog**, not a series.
`/thredds/catalog/remotesensing/catalog.xml` returns **404** — there is no browsable directory, so
no other dates can be enumerated. Sibling pinned files exist for K490, POC, PIC, AOT.

### 3.4 Candidate D — INCOIS THREDDS `osf/chl/…` — live daily, but the wrong ocean

**NEW.** `https://incois.gov.in/thredds/catalog/osf/chl/catalog.xml`

**VERIFIED:** 8 files, `VIIRS-SNPP-Roll-{start}-{end}-4KM-PICountries-CHL.nc`, 3-day rolling
composites, 8.657 MB each, variable **`chlor_a`**, grid lat 1057 × lon 2043, modification dates
running to **2026-09-05T14:12Z** — a genuinely **daily-updated** series.

**The blocker — VERIFIED:** extent is lat −25.98 → 18.02, **lon 129.98 → 215.02**. That is the
**Pacific Ocean** — "PICountries" = Pacific Island Countries, INCOIS's Pacific ocean-services
programme. Every other `osf/*` satellite catalog (`sst2`, `k490`, `pic`, `poc`, `aot`) is likewise
PICountries.

**Significance despite the wrong region:** it proves INCOIS's ocean-colour processing chain
**does** publish dated NetCDF rolling composites over open OPeNDAP. The mechanism BlueNexus needs
exists and is operating — it is simply not pointed at the Indian Ocean in any public catalog.

### 3.5 Candidate E — ISRO / MOSDAC (other official Indian source)

**DOCUMENTED** (from D2, not re-tested in this follow-up): ISRO's MOSDAC (`mosdac.gov.in`) is the
official archive for Oceansat-3 / EOS-06 OCM-3 chlorophyll, ~2-day global revisit. **Registration
required.** This is an official *Indian government* source but **not an INCOIS source**.

### 3.6 Candidate F — NOAA/NASA (clearly labelled non-INCOIS fallback)

**VERIFIED reachable:** NOAA CoastWatch ERDDAP exposes science-quality VIIRS chlorophyll:
`nesdisVHNSQchlaDaily`, `nesdisVHNSQchlaWeekly`, `nesdisVHNSQchlaMonthly` — *"Chlorophyll, NOAA
S-NPP VIIRS, Science Quality, Global 4km, Level 3"*. Public ERDDAP, no authentication, same
query grammar BlueNexus already uses for Argo.

**This is explicitly NOT an INCOIS source** and is recorded only as a fallback candidate.

---

## 4. Chlorophyll Candidate Comparison

| # | Candidate | Exists | Current? | Region | Machine-readable | Variable / units | Resolution | Time axis | Auth | Automation | Evidence class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | ChloroGIN viewer | ✅ | ✅ (NRT) | Indian Ocean + IOGOOS | ❌ viewer only | CHL (1 km) | 1 km | n/a | Email request | 🟠 Restricted | VERIFIED |
| B | **GeoServer WCS `PFZ-TUNA-SST-CHL:chl`** | ✅ | ⚠️ undated snapshot | **35–103°E, −5–31°N** | ✅ **WCS GeoTIFF / WMS** | float32, **mg/m³** (per style abstract) | **0.009° ≈ 1 km** | ❌ **none** | **None** | 🟠 Moderate (permission ambiguous) | VERIFIED (data + units) / UNVERIFIED (date, permission) |
| C | **THREDDS `remotesensing/…Entire-CHL.nc`** | ✅ | ❌ **Mar 2025, static** | **35–103°E, −40–31°N** | ✅ **OPeNDAP + fileServer** | **`chl_abi`, `mg m^-3`**, CF standard_name | ≈1.16 km | ❌ single file | **None** | 🟢 Easy (but historical) | VERIFIED |
| D | THREDDS `osf/chl/…PICountries` | ✅ | ✅ **daily** | ❌ **Pacific (130–215°E)** | ✅ OPeNDAP | `chlor_a` | 4 km | ✅ per-file dates | **None** | 🟢 Easy (wrong region) | VERIFIED |
| E | ISRO MOSDAC OCM-3 | ✅ | ✅ | Global | ✅ (portal) | chlorophyll | — | ✅ | **Registration** | 🟠 Restricted | DOCUMENTED |
| F | *(fallback, non-INCOIS)* NOAA ERDDAP `nesdisVHNSQchlaDaily` | ✅ | ✅ daily | Global | ✅ ERDDAP griddap | chlorophyll | 4 km | ✅ | None | 🟢 Easy | VERIFIED (existence) |

**The structural problem:** INCOIS has every ingredient — a 1 km Indian-Ocean chlorophyll raster
(B), a fully CF-documented Indian-Ocean NetCDF (C), and a live daily NetCDF pipeline (D) — but
**no single public route delivers current + Indian Ocean + dated at once.**

---

## 5. Current Investigation

### 5.1 INCOIS THREDDS `osf/currents` — OSF / HOOFS — **the resolution**

**Server discovered in this follow-up:** `https://incois.gov.in/thredds/`
(reached by following the HTTP 302 from `/thredds/catalog.html` → `/thredds/catalog/catalog.html`).
It was found by reverse-engineering the OSF forecast viewer at
`https://incois.gov.in/oceanservices/osfforecast.jsp`, whose JavaScript references
`/thredds/wms/osf/currents/` and uses `leaflet-velocity` (a U/V vector renderer) plus
`leaflet.timedimension`.

**Catalog:** `https://incois.gov.in/thredds/catalog/osf/currents/catalog.xml`

#### A. Current representation — VERIFIED

| Item | Finding |
| --- | --- |
| **U component** | ✅ **`U`** — `long_name "U Component"`, `standard_name "eastward_current"` |
| **V component** | ✅ **`V`** — `long_name "V Component"`, `standard_name "northward_current"` |
| **Speed** | ✅ also supplied directly as **`CURRENT`** — `long_name "Surface Currents (m/s)"` |
| **Direction** | Not stored — derive from U/V |
| **Vector field** | ✅ WMS publishes a **`U:V-group`** layer with `default-vector` styling |
| **Surface / subsurface** | **Surface only** — `DEPTH1_1` has exactly one level, value `0.0` |

> **BlueNexus can derive `current_speed = sqrt(U² + V²)`** — confirmed, both components are present
> as separate float64 variables on an identical grid. INCOIS additionally ships the pre-computed
> magnitude as `CURRENT`, which D4 should cross-check against the derived value rather than assume
> they are identical.
>
> **Direction** should be derived as `atan2` and stored with an explicit stated convention. The
> recommended representation is the **oceanographic "toward" convention** — degrees clockwise from
> true north indicating the direction the water flows *toward*:
> `direction_deg = (90 − degrees(atan2(V, U))) mod 360`.
> This must be labelled in the UI, because the meteorological convention (direction the flow comes
> *from*) is the opposite and mixing them silently inverts every arrow.

#### B. Dimensions — VERIFIED

```
Float64 LON[LON = 1080];
Float64 LAT[LAT = 720];
Float32 DEPTH1_1[DEPTH1_1 = 1];
Float64 TAXIS[TAXIS = 32];
Grid { Float64 U[TAXIS=32][DEPTH1_1=1][LAT=720][LON=1080]; } U;   (same for V and CURRENT)
```

| Axis | Name | Range | Attributes |
| --- | --- | --- | --- |
| Longitude | `LON` | **30.0 → 119.8807 °E** | `degrees_east`, `standard_name longitude`, `modulo 360`, even spacing |
| Latitude | `LAT` | **−30.0 → 29.8927 °N** | `degrees_north`, `standard_name latitude`, even spacing |
| **Depth** | `DEPTH1_1` | **[0.0] — one level** | `meters`, **`positive "down"`**, `standard_name "depth"` |
| Time | `TAXIS` | 48.0 → 141.0 | `hours since 2026-09-03 01:30`, `calendar standard`, `standard_name time` |

Fill: `_FillValue = missing_value = −1.0E34`. `Conventions = "CF-1.6"`.
This product is **better CF-annotated than the ERDDAP Argo dataset** (which lacks `positive` and
`standard_name` on its `ZAX` axis).

#### C. Resolution — VERIFIED

| Dimension | Value |
| --- | --- |
| **Spatial** | **0.0833° = 1/12° ≈ 9.2 km** (measured: 30.0, 30.0833, 30.1666) — matches the documented IO-HOOFS configuration |
| **Temporal** | **3-hourly** — 32 steps from 48 h to 141 h ⇒ (141−48)/31 = 3.0 h; span **2026-09-05T01:30Z → 2026-09-08T22:30Z** (~4-day forecast) |
| **Vertical** | Single surface level (0 m) |

Two domain variants are published daily: **`CURRENTS_IO_*`** (Indian Ocean, 1/12°) and
**`CURRENTS_NIO_*`** (Northern Indian Ocean). Each file is **597.2 MB**.

#### D. Provenance and currency — VERIFIED

- `history = "From /home/osf/OperationalWork/Models/NetCDF/OGCM/IO_HOOFS/ioout_20260904.nc"` —
  **explicitly IO-HOOFS operational model output.**
- `NC_GLOBAL history = "PyFerret V7.63 (optimized) 5-Sep-26"` — generated today.
- Catalog holds 2026-08-28 → 2026-09-04 for both IO and NIO, with `<date type="modified">`
  timestamps running to **2026-09-05T06:00:37Z**. **Daily cadence confirmed.**

#### E. Machine-readable access — all VERIFIED, all no-auth

The catalog declares a compound service set. Each was tested:

| Service | Endpoint | Test result |
| --- | --- | --- |
| **OPeNDAP** | `/thredds/dodsC/osf/currents/{file}` | ✅ `.dds` 939 B / 0.30 s · `.das` 1,857 B / 0.38 s · `.ascii` returned real values |
| **NCSS (grid)** | `/thredds/ncss/grid/osf/currents/{file}` | ✅ `dataset.xml` 6,678 B · **bbox subset `var=U&north=25&south=-10&east=100&west=50` → HTTP 200, 2,034,044 B** |
| **WMS** | `/thredds/wms/osf/currents/{file}` | ✅ `GetCapabilities` 39,034 B; layers `CURRENT`, **`U:V-group`**; **time dimension `2026-09-05T01:30:00Z/2026-09-08T22:30:00Z/PT3H`**; `elevation 0.0` |
| **HTTPServer** | `/thredds/fileServer/osf/currents/{file}` | ✅ HTTP 200, `Content-Length: 597,213,224`, `Content-Type: application/x-netcdf`, **`Accept-Ranges: bytes`** |
| Byte-range | same | ✅ **HTTP 206**, first 4 bytes = `CDF\x01` (NetCDF-3 classic) |
| WCS / DAP4 / cdmremote | advertised | Declared in the catalog; not individually exercised |

**Proof of actual data — VERIFIED:** an OPeNDAP `.ascii` read of `U` at ~19.98–20.06 °N,
71.65–71.73 °E (Arabian Sea off Gujarat), first forecast step, returned
**`U = 0.06075696490120944, 0.054113255036209576` m/s** — physically plausible surface currents.

> ⚠️ **NCSS parameter caution for D4/D7:** adding `time=all` or `time_start`/`time_end` to an NCSS
> request produced **HTTP 400** from the **Apache front-end** (an Apache error page, not a TDS
> error). Dropping those parameters gave HTTP 200. The time-selection syntax must be worked out
> carefully; OPeNDAP index-based selection is the more predictable route.

#### F. Authentication — VERIFIED

**None.** No registration, no credential, no token, no requisition form. Every request above was
anonymous.

#### G. Automation feasibility — 🟢 **Easy**

Anonymous, CF-compliant NetCDF, four independent working access mechanisms, server-side bbox
subsetting, byte-range support, daily refresh with predictable filenames
(`CURRENTS_{IO|NIO}_{YYYYMMDD}.nc`), and a catalog that can be polled for currency.

#### H. Suitability for BlueNexus

| Use | Verdict |
| --- | --- |
| Automated acquisition | ✅ Yes — poll the catalog, then NCSS/OPeNDAP subset (never fetch the 597 MB whole file) |
| Scientific visualization | ✅ Yes — real model output with declared units, CF conventions, provenance |
| Local processed copy | ✅ Yes — subset to the BlueNexus bbox, keep U/V/speed |
| Display in BlueNexus | ✅ Yes for the **surface** `currentSpeed` layer and vector overlays |
| **3-D / depth-resolved currents** | ❌ **No — surface only.** The frontend's depth axis cannot be driven by this product. |
| SIH demonstration | ✅ Strong — an official INCOIS operational forecast, current to today, with a genuine forecast time axis |

### 5.2 INCOIS-GODAS — re-tested, still blocked, now explained

| Test | Result |
| --- | --- |
| THREDDS `godas` catalog (`/thredds/catalog/godas/catalog.xml`) | ✅ HTTP 200, 11 files — but only **`ssha_`, `sst_`, `tchp_`**. **No U/V, no 3-D T/S.** |
| LAS OPeNDAP `.dds` (GODAS + Argo journals) | 🔴 **HTTP 000, 0 bytes, 70 s timeout** — re-confirmed |
| LAS catalog controls (same host, same batch) | ✅ HTTP 200 (17 MB in 16.3 s; catalog.xml 835 B in 0.23 s) — so it is not the network |
| **LAS THREDDS `fileServer`** — **NEW** | ✅ HTTP 200 but returns only a **40-byte Ferret journal**: `USE "/home/las/datasets/godas/2025.nc"` |
| FTP `ftpser.incois.gov.in` | 🟠 anonymous login denied (**FTP 530**) — from D2 |

> **New explanation (VERIFIED):** the LAS datasetScan exposes only `.jnl` Ferret *journal stubs*.
> The actual GODAS NetCDF sits at the server-side path `/home/las/datasets/godas/2025.nc`, which is
> **not published over HTTP at all**. So the LAS OPeNDAP timeout is not a transient fault — there is
> no exposed file for THREDDS to serve, and no direct-download route exists.

**Classification: 🔴 Not currently feasible.** GODAS remains the only INCOIS source of *subsurface*
U/V, and it is unreachable without FTP credentials.

### 5.3 HF Radar / ICORN — unchanged

**VERIFIED (re-read live):** Data Holdings still states *"HF Radar · Current Vector · Real-time ·
2008 – till date · **Registered access through Website**"*. No ERDDAP, LAS, THREDDS or GeoServer
presence. Access requires a **signed Data Requisition Form** to the Head, Ocean Data Management
Division (`uday@incois.gov.in`). Format NetCDF; ~6 km, hourly, ≤200 km offshore (literature, not
INCOIS-stated). U/V presumed from *"Current Vector"* but **UNVERIFIED** without access.

**Classification: 🟠 Restricted.** Would be a valuable coastal surface overlay after approval.

### 5.4 Other official INCOIS candidates — checked

| Candidate | Finding | Verdict |
| --- | --- | --- |
| `osf/currents2` | **VERIFIED:** `UV_pacific_hycom_*`, `MLD_pacific_hycom_*`, 49 files, daily — has U/V but is **HYCOM Pacific**, wrong region | Not applicable |
| `roms`, `hycom` catalogs | **VERIFIED:** only `ssha`, `sst`, `tchp`, `ssh` — no currents | Not applicable |
| `pfz/CURRENTS_IO_*` | **VERIFIED:** pinned old files (2024-12-22/23, 2025-06-03) | Superseded by `osf/currents` |
| GeoServer 340-layer sweep | **VERIFIED:** no ocean-current layer | Unchanged from D3 |
| ERDDAP `incois_valueadded_products_datasets` (`GEO_U`/`GEO_V`) | Access perfect, data ends 2019-03-30 | Unchanged from D3 |

### 5.5 Fallbacks for **subsurface** currents (clearly non-INCOIS)

| Source | Status | Notes |
| --- | --- | --- |
| **Copernicus Marine** | **VERIFIED reachable** — `data.marine.copernicus.eu/products` HTTP 200; `stac.marine.copernicus.eu` HTTP 200 | Global 3-D analysis/forecast with `uo`/`vo` on depth levels. **Free registration required.** The realistic route if BlueNexus needs depth-resolved currents. |
| **NOAA/JPL OSCAR** via ERDDAP | **VERIFIED existence:** `jplOscar` — *"OSCAR Sea Surface Velocity, 1/3°, L4, Global, 1992-present, 5 Day Composite"* | Public, no auth, but **surface only** — adds nothing over the INCOIS OSF product |

---

## 6. Current Candidate Comparison

| Candidate | U/V | Speed | Depth | Spatial | Temporal | Access | Auth | Automation | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **INCOIS THREDDS `osf/currents` (HOOFS)** | ✅ **`U`,`V`** | ✅ `CURRENT` | ❌ surface (0 m) | **1/12° ≈ 9.2 km** | **3-hourly, ~4-day forecast, daily refresh** | **OPeNDAP · NCSS · WMS · WCS · fileServer (range)** | **None** | 🟢 **Easy** | **VERIFIED** (real values read) |
| INCOIS-GODAS (LAS) | ✅ U/V | — | ✅ 40 levels to 4478 m | 0.5°/0.25° | daily (claimed) | OPeNDAP dead; real file not web-exposed; FTP 530 | FTP creds | 🔴 Not feasible | **BLOCKED** |
| INCOIS HF Radar / ICORN | ⚠️ presumed | ⚠️ | ❌ surface | ~6 km | hourly | Requisition form only | **Yes** | 🟠 Restricted | DOCUMENTED |
| INCOIS ERDDAP `GEO_U`/`GEO_V` | ✅ | — | ❌ surface | 1° | 10-day, **ends 2019** | ERDDAP griddap | None | 🔴 stale | VERIFIED |
| INCOIS `osf/currents2` (HYCOM) | ✅ | — | ⚠️ | — | daily | OPeNDAP | None | wrong region (Pacific) | VERIFIED |
| *(fallback)* Copernicus Marine | ✅ `uo`/`vo` | derive | ✅ multi-level | ~1/12° | daily/hourly | Toolbox / OPeNDAP / STAC | **Registration** | 🟠 Restricted | VERIFIED (reachable) |
| *(fallback)* NOAA/JPL OSCAR | ✅ | derive | ❌ surface | 1/3° | 5-day composite | ERDDAP | None | 🟢 Easy | VERIFIED (existence) |

---

## 7. Machine-Readable Access Findings

The four-level distinction from D3 §1, re-applied:

| Level | Chlorophyll | Ocean currents |
| --- | --- | --- |
| **Dataset exists** | ✅ ChloroGIN NRT product; GeoServer raster; THREDDS IO + Pacific NetCDFs | ✅ HOOFS forecast; GODAS; HF Radar |
| **Human / web access** | ✅ ChloroGIN viewer; GeoServer WMS | ✅ OSF forecast viewer (`osfforecast.jsp`) |
| **Machine-readable access** | ✅ GeoServer WCS GeoTIFF (undated); THREDDS OPeNDAP (Mar 2025 IO file; daily Pacific files) | ✅ **OPeNDAP, NCSS, WMS, WCS, fileServer on `osf/currents`** |
| **Automated backend access** | ⚠️ **Only for the wrong date or the wrong ocean** | ✅ **Fully — surface currents solved** |

**Key architectural insight:** INCOIS operates **two distinct spatial servers with different roles**,
and D1–D3 only found one of them.

| Server | Role | Time-aware? |
| --- | --- | --- |
| `incois.gov.in/geoserver` | Thematic GIS / map furniture / latest-snapshot rasters | ❌ **zero** time dimensions across 340 layers |
| **`incois.gov.in/thredds`** | **Operational model + satellite NetCDF archive** | ✅ dated files, WMS time dimensions, full TDS service suite |

---

## 8. Authentication and Access Requirements

| Resource | Auth | Registration | Form / contact | Evidence |
| --- | --- | --- | --- | --- |
| **INCOIS THREDDS `incois.gov.in/thredds/*`** | **None** | **None** | — | **VERIFIED** — every catalog, OPeNDAP, NCSS, WMS and fileServer request anonymous |
| INCOIS GeoServer `/wms`, `/wcs` | **None** | **None** | — | VERIFIED |
| INCOIS GeoServer `/ows`, `/web` | Blocked (Apache 403) | — | — | VERIFIED |
| INCOIS GeoServer `/rest/` | Yes (401) | — | — | VERIFIED — admin API, **not touched** |
| INCOIS ChloroGIN archive | — | **Yes** | `samanta.a@incois.gov.in` | VERIFIED (stated on page) |
| INCOIS HF Radar | **Yes** | **Yes** | Signed Data Requisition Form → `uday@incois.gov.in` | VERIFIED |
| INCOIS-GODAS FTP | **Yes** | **Yes** | Contact on `godas.jsp` | BLOCKED (FTP 530) |
| ISRO MOSDAC | — | **Yes** | Portal sign-up | DOCUMENTED |
| Copernicus Marine | **Yes** | **Yes** (free) | Account | DOCUMENTED |
| NOAA CoastWatch ERDDAP | None | None | — | VERIFIED |

### TLS note for the newly discovered host

`incois.gov.in` — the host serving the THREDDS server — **sends a complete certificate chain
(2 certificates, `Verify return code: 0 (ok)`)**, per D3 §11.2. **The leaf-only chain problem
affects only `erddap.incois.gov.in` and `las.incois.gov.in`.**

> ✅ **This means the currents route has no TLS obstacle at all** — unlike the temperature/salinity
> route on ERDDAP, which still needs the GlobalSign intermediate supplied to the client.
>
> No certificate verification was disabled at any point in this investigation. No
> `NODE_TLS_REJECT_UNAUTHORIZED=0`, no `rejectUnauthorized:false`, no `verify=False`, no `curl -k`.

---

## 9. Formats

| Dataset | Native | Available response formats | Recommended for D4/D7 | Reason |
| --- | --- | --- | --- | --- |
| **`osf/currents/CURRENTS_IO_*.nc`** | **NetCDF-3 classic** (`CDF\x01`), CF-1.6 | NetCDF (OPeNDAP/NCSS/fileServer), DAP4, WMS images, WCS coverages, DAP ASCII | **NetCDF via NCSS bbox subset** (fall back to OPeNDAP index slicing) | Server-side spatial subsetting cut a full-grid request from 6.2 MB to 2.0 MB; avoids the 597 MB whole file entirely |
| `remotesensing/…Entire-CHL.nc` | NetCDF, CF | OPeNDAP, fileServer | NetCDF | Full CF metadata, declared units and fill value |
| GeoServer `PFZ-TUNA-SST-CHL:chl` | **GeoTIFF** float32 | GeoTIFF, TIFF, PNG, JPEG, GIF (WCS); PNG (WMS); JSON/text (GetFeatureInfo) | **GeoTIFF** *if adopted* | Preserves float32 values; PNG/JPEG would destroy them |
| ChloroGIN viewer | — | none | **n/a** | No data format is offered |

**Never** request the raw 597 MB current file when NCSS or OPeNDAP can subset server-side.

---

## 10. Dimensions and Resolution

| Dataset | Time | Depth | Latitude | Longitude | Resolution |
| --- | --- | --- | --- | --- | --- |
| **`osf/currents` IO** | 32 steps, **3-hourly**, 2026-09-05T01:30Z → 2026-09-08T22:30Z | **1 level, 0 m (surface)** | −30.0 → 29.8927 (720) | 30.0 → 119.8807 (1080) | **1/12° ≈ 9.2 km** |
| `osf/currents` NIO | same cadence | surface | (Northern Indian Ocean) | — | finer (NIO-HOOFS) — not separately measured |
| `remotesensing/…CHL` | **none** (single file, Mar 2025) | surface | 30.99 → −39.99 (6816) | 35.01 → 102.99 (6528) | ≈ 0.0104° ≈ 1.16 km |
| GeoServer `chl` | **none** | surface | −4.9955 → 31.0045 (4000) | 34.9955 → 102.9905 (7555) | **0.009° ≈ 1 km** |
| `osf/chl` (Pacific) | dated, daily | surface | −25.98 → 18.02 (1057) | 129.98 → 215.02 (2043) | 4 km |

**Coverage against the BlueNexus frontend box (lat −35…25, lon 40…100):**

| Dataset | Covers the box? |
| --- | --- |
| `osf/currents` IO (30°S–29.9°N, 30–119.9°E) | ✅ **fully**, including the southern strip |
| `remotesensing/…CHL` (−40–31°N, 35–103°E) | ✅ **fully** |
| GeoServer `chl` (−5–31°N, 35–103°E) | ⚠️ **northern part only** — nothing south of 5°S |
| Argo T/S (carried from D3) | ⚠️ nothing south of 29.5°S |

---

## 11. Automation Feasibility

| Source | Class | Evidence |
| --- | --- | --- |
| **INCOIS THREDDS `osf/currents`** | 🟢 **Easy** | No auth; 4 working access services; NCSS bbox subset HTTP 200 / 2,034,044 B; OPeNDAP returned real U values; predictable daily filenames; catalog pollable; byte-range supported; host has a valid TLS chain |
| INCOIS THREDDS `remotesensing/…CHL` | 🟢 Easy *(access)* / 🔴 *(currency)* | OPeNDAP + fileServer both HTTP 200; but `Last-Modified 2025-07-04`, single file |
| INCOIS THREDDS `osf/chl` (Pacific) | 🟢 Easy *(access)* / ❌ *(region)* | Daily-updated series verified; extent is 130–215 °E |
| INCOIS GeoServer `chl` | 🟠 **Moderate–Restricted** | WCS GetCoverage works and returns float32 mg/m³; but no time axis, no date, intermittent 503, and permission intent ambiguous (403 on sibling paths) |
| INCOIS ChloroGIN archive | 🟠 Restricted | Email request only |
| INCOIS-GODAS | 🔴 **Not currently feasible** | OPeNDAP HTTP 000; the real NetCDF is not web-exposed (journal stub proves it); FTP 530 |
| INCOIS HF Radar | 🟠 Restricted | Signed requisition form |
| *(fallback)* Copernicus Marine | 🟠 Restricted | Free registration required |
| *(fallback)* NOAA ERDDAP chlorophyll / OSCAR | 🟢 Easy | Public ERDDAP |

---

## 12. Licensing and Usage Observations

**"Publicly viewable" is not "freely redistributable."** Nothing found in this follow-up changes
the restrictions recorded in D1/D2, and one new gap was identified.

| Item | Observation |
| --- | --- |
| INCOIS site disclaimer | *"Reproducing the material published in this website for commercial purpose is not permitted, unless and otherwise permission is obtained from the competent authority."* — applies to BlueNexus unless non-commercial use is confirmed |
| **INCOIS THREDDS** | **No licence, terms, or attribution statement is published on the THREDDS server or in the NetCDF global attributes.** Open access is not the same as an open licence — **UNVERIFIED** |
| INCOIS GeoServer | No licence statement; access intent ambiguous (403 on `/ows`, `/web`) — **UNVERIFIED** |
| `chl_abi` algorithm | Carries an explicit citation requirement in spirit: Shanmugam P. (2011), JGR 116(C4), C04016 — should be credited if used |
| OCM / Oceansat chlorophyll | *"Restricted; as per DoS guidelines"* — do not adopt |
| Copernicus Marine | Free but requires accepting its licence and attribution terms |
| NOAA / NASA products | US Government open data; attribution expected |

> **Action for D4 (not this step):** a single message to INCOIS covering (a) permission to consume
> `incois.gov.in/thredds` programmatically for BlueNexus, (b) the required attribution wording,
> (c) whether a dated Indian-Ocean chlorophyll series can be published or supplied, and
> (d) whether the GeoServer `chl` layer may be used and what its date/refresh is.

---

## 13. Recommended Source Strategy

| Parameter | Preferred source | Backup source | Access method | Format | Resolution | Auth | Automation | BlueNexus suitability | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Temperature** *(settled in D3)* | INCOIS ERDDAP `incois_argo_10day_McCreary` (`T_ANALYZED`) | INCOIS-GODAS (if FTP granted) | ERDDAP `griddap` | NetCDF-3 | 1°, 24 levels 5–2000 m | None | 🟢 Easy | ✅ 3-D volume | **High** |
| **Salinity** *(settled in D3)* | Same dataset (`S_ANALYZED`) | — | Same request | NetCDF-3 | 1°, 24 levels | None | 🟢 Easy | ✅ 3-D volume | **High** |
| **Chlorophyll** | **INCOIS request** for a dated Indian-Ocean series (`samanta.a@incois.gov.in`); interim development against **THREDDS `remotesensing/…Entire-CHL.nc`** (`chl_abi`, mg m⁻³, full CF metadata, covers the whole box) | GeoServer WCS `chl` (current-ish, 1 km, undated) — *then* NOAA ERDDAP `nesdisVHNSQchlaDaily` **(non-INCOIS)** | OPeNDAP / WCS | NetCDF / GeoTIFF | ~1 km | None | 🟠 Moderate | ✅ surface field, ❌ no time axis | **Medium** |
| **Ocean currents (surface)** | **INCOIS THREDDS `osf/currents/CURRENTS_IO_*.nc`** (OSF/HOOFS) — `U`, `V`, `CURRENT` | `CURRENTS_NIO_*` for coastal detail; HF Radar after requisition | **NCSS bbox subset** (or OPeNDAP) | NetCDF-3, CF-1.6 | **1/12°, 3-hourly, ~4-day forecast** | **None** | 🟢 **Easy** | ✅ surface layer + vectors | **High** |
| **Ocean currents (subsurface)** | *No INCOIS route* — GODAS blocked | **Copernicus Marine** (`uo`/`vo`, multi-level) **(non-INCOIS, registration)** | Toolbox / OPeNDAP | NetCDF | ~1/12°, multi-level | Registration | 🟠 Restricted | needed for a true 3-D current volume | **Medium** |

### Decision per parameter

**CHLOROPHYLL → *INCOIS requires access request*.**
An INCOIS machine-readable chlorophyll route **does exist and is open** — but no single route is
simultaneously current, Indian-Ocean, and dated. The THREDDS `chl_abi` file is perfectly
documented and covers the whole BlueNexus box but is frozen at March 2025; the GeoServer raster is
current-ish and 1 km but carries no date and ambiguous permission; the live daily NetCDF series is
Pacific-only. A request to INCOIS is the correct next action, with the March-2025 THREDDS file as
a scientifically honest interim for development and the NOAA ERDDAP series as a clearly labelled
fallback if INCOIS cannot supply a dated Indian-Ocean series.

**OCEAN CURRENTS → *INCOIS confirmed* (surface).**
`https://incois.gov.in/thredds/` publishes the OSF/HOOFS surface-current forecast with U and V
components, at 1/12° and 3-hourly, refreshed daily, over four working machine-readable services,
with no authentication and a valid TLS chain. Verified end-to-end including a real data read.
**For subsurface currents the INCOIS route remains not feasible** and a fallback (Copernicus
Marine) would be required if BlueNexus insists on a depth-resolved current volume.

> **No source switch is being made in this step.** These are recommendations only. BlueNexus still
> runs on its existing demo data, unchanged.

---

## 14. Remaining Blockers

1. **Chlorophyll: no dated Indian-Ocean series.** The one Indian-Ocean CHL NetCDF is static
   (Mar 2025, `Last-Modified` 2025-07-04); the live daily series is Pacific. **BLOCKED pending an
   INCOIS response.**
2. **GeoServer `chl` date and refresh cadence.** No time dimension, no `DateTime` TIFF tag, no
   metadata. Cannot tell whether it updates. **UNVERIFIED.**
3. **GeoServer usage permission.** The Apache 403 on `/ows` and `/web` makes access intent
   ambiguous. **UNVERIFIED — must ask before depending on it.**
4. **THREDDS licence and attribution.** No licence statement anywhere on the server or in the file
   global attributes. **UNVERIFIED.**
5. **Subsurface currents.** GODAS is the only INCOIS source and its NetCDF is not web-exposed
   (proved by the 40-byte Ferret journal stub); FTP needs credentials. **BLOCKED.**
6. **NCSS time-parameter syntax.** `time=all` / `time_start` / `time_end` return HTTP 400 from the
   Apache front-end. Needs to be worked out, or OPeNDAP index slicing used instead. **UNVERIFIED.**
7. **HF Radar requisition outcome** — turnaround, and whether approved users get a scriptable
   endpoint. **BLOCKED.**
8. **`CURRENT` vs derived `sqrt(U²+V²)`** — assumed equivalent, not numerically cross-checked.
   **UNVERIFIED.**
9. **NIO-HOOFS grid** — the `CURRENTS_NIO_*` variant was catalogued but its grid and resolution
   were not separately measured. **UNVERIFIED.**
10. **GeoServer 503 intermittency** — one 503 in roughly five requests. Frequency unknown; retry
    logic would be required. **VERIFIED as occurring, rate UNVERIFIED.**

---

## 15. Evidence and References Used

All requests were read-only, anonymous, and made on 2026-09-05. No security control was bypassed.

### INCOIS THREDDS (newly discovered)
- `https://incois.gov.in/thredds/catalog.html` → 302 → `/thredds/catalog/catalog.html`
- `https://incois.gov.in/thredds/catalog/catalog.xml` — root catalog, service definitions
- `https://incois.gov.in/thredds/catalog/osf/currents/catalog.xml` — IO + NIO current files
- `https://incois.gov.in/thredds/dodsC/osf/currents/CURRENTS_IO_20260904.nc.dds` / `.das` / `.ascii`
- `https://incois.gov.in/thredds/ncss/grid/osf/currents/CURRENTS_IO_20260904.nc/dataset.xml`
- `https://incois.gov.in/thredds/ncss/grid/osf/currents/CURRENTS_IO_20260904.nc?var=U&north=25&south=-10&east=100&west=50&accept=netcdf3`
- `https://incois.gov.in/thredds/wms/osf/currents/CURRENTS_IO_20260904.nc?service=WMS&request=GetCapabilities`
- `https://incois.gov.in/thredds/fileServer/osf/currents/CURRENTS_IO_20260904.nc` (HEAD + byte-range)
- `https://incois.gov.in/thredds/dodsC/remotesensing/VIIRS-SNPP-Mar2025-d27-4KM-Entire-CHL.nc.dds` / `.das`
- `https://incois.gov.in/thredds/catalog/osf/chl/catalog.xml` and its `.dds` / `.ascii`
- `https://incois.gov.in/thredds/catalog/{godas,roms,hycom,osf/currents2,osf/sst,osf/winds,…}/catalog.xml`
- `https://incois.gov.in/thredds/dodsC/abis/LatestBloom.nc.das`

### INCOIS GeoServer
- `https://incois.gov.in/geoserver/wms?service=WMS&version=1.3.0&request=GetCapabilities`
- `https://incois.gov.in/geoserver/wms?…request=GetFeatureInfo&query_layers=PFZ-TUNA-SST-CHL:chl&info_format=application/json`
- `https://incois.gov.in/geoserver/wcs?…request=DescribeCoverage&coverageId=PFZ-TUNA-SST-CHL__chl`
- `https://incois.gov.in/geoserver/wcs?…request=GetCoverage&coverageId=PFZ-TUNA-SST-CHL__chl&subset=Lat(…)&subset=Long(…)&format=image/tiff`

### INCOIS web pages / viewers
- `https://incois.gov.in/oceanservices/osfforecast.jsp` (+ `forecast_js/*`) — led to the THREDDS discovery
- `https://sarat.incois.gov.in/OSF/` and `js/app.js` — ports viewer, static GIFs only
- `https://incois.gov.in/site/services/ChloroGIN_SP.jsp`, `ChloroGIN_VP.jsp`
- `https://incois.gov.in/site/services/chlorophyllregion1.jsp?product=CHL`
- `https://incois.gov.in/site/assets/js/resolution.js`
- `https://incois.gov.in/site/dataholdings.jsp`, `https://incois.gov.in/site/disclaimer.jsp`
- `https://incois.gov.in/site/datainfo/modelling/godas.jsp`

### INCOIS LAS (re-tested)
- `https://las.incois.gov.in/thredds/dodsC/las/id-cbbdd5ab07/…jnl.dds` — HTTP 000
- `https://las.incois.gov.in/thredds/fileServer/las/id-cbbdd5ab07/…jnl` — 40-byte journal stub
- `https://las.incois.gov.in/las/getDatasets.do` — control, HTTP 200

### Non-INCOIS fallbacks (existence/reachability only)
- `https://coastwatch.pfeg.noaa.gov/erddap/search/index.json?searchFor=chlorophyll+VIIRS+science+quality` → `nesdisVHNSQchlaDaily/Weekly/Monthly`
- `https://coastwatch.pfeg.noaa.gov/erddap/search/index.json?searchFor=OSCAR+ocean+surface+current` → `jplOscar`
- `https://data.marine.copernicus.eu/products` · `https://stac.marine.copernicus.eu/`
- `https://www.mosdac.gov.in/oceansat-3` (DOCUMENTED from D2, not re-tested)

### Literature reference embedded in INCOIS data
- Shanmugam P. (2011), *A new bio-optical algorithm for the remote sensing of algal blooms in
  complex ocean waters*, JGR 116(C4), C04016, doi:10.1029/2010JC006796 — cited in `chl_abi`

---

## 16. Final Decision Status

**D3 FOLLOW-UP STATUS: COMPLETE**

| Requirement | Met | Note |
| --- | --- | --- |
| Chlorophyll investigated in the required priority order | ✅ | ChloroGIN → GeoServer/WCS → ISRO/MOSDAC → NASA/NOAA fallback |
| Currents investigated in the required priority order | ✅ | GODAS → HOOFS/OSF → HF Radar → other INCOIS → Copernicus → NOAA |
| Machine-readable access distinguished from visualization | ✅ | §7 four-level table; two-server architecture identified |
| Variables, units, scientific meaning determined | ✅ | `chl_abi` mg m⁻³ CF standard_name; `U`/`V` eastward/northward_current |
| Access requirements determined | ✅ | §8 |
| Automation feasibility classified | ✅ | §11 |
| Licensing examined | ✅ | §12 — and an open licence gap flagged |
| Evidence classified VERIFIED / DOCUMENTED / UNVERIFIED / BLOCKED | ✅ | Applied throughout |
| Fallback decision made without switching sources | ✅ | §13 — recommendation only |
| No TLS/security control bypassed | ✅ | §8 — none used |
| No application code modified | ✅ | Only this document was created |

**Do not start D4. Awaiting further instructions.**
