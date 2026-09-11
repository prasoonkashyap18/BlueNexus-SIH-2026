# BlueNexus — Data Track D4: Real INCOIS Dataset Acquisition

**Data Track step:** D4 — Obtain Real INCOIS Dataset(s)
**Type:** Acquisition + local preservation + acquisition-verification only. No ingestion, no
backend, no API, no frontend, no mock-data replacement, no scientific validation, no
processing/cleaning/regridding, no automatic updating.
**Prepared:** 2026-09-06 (local) / acquisitions performed 2026-09-05 UTC
**Builds on (all unchanged):** `docs/data-sources.md` (D1) · `docs/data-availability.md` (D2) ·
`docs/data-access.md` (D3) · `docs/data-access-followup.md` (D3 follow-up)

---

## 1. Summary

| Parameter | Status | File | Bytes |
| --- | --- | --- | --- |
| **Temperature** | ✅ **Real INCOIS data acquired** | `data/raw/temperature_salinity_incois_argo_sample.nc` | 1,062,744 |
| **Salinity** | ✅ **Real INCOIS data acquired** (same file) | `data/raw/temperature_salinity_incois_argo_sample.nc` | 1,062,744 |
| **Surface ocean currents** | ✅ **Real INCOIS data acquired** | `data/raw/currents_incois_io-hoofs_sample.nc` | 24,300,572 |
| **Chlorophyll** | ⏸️ **PENDING** — source identified but not acquired (see §7) | — | — |

Three of the four confirmed parameters were acquired as small, representative, real NetCDF
subsets from official INCOIS services, verified locally, and preserved unchanged. Chlorophyll
remains pending official INCOIS access/licensing clarification and **was not acquired or
substituted**.

- No authentication was required for any acquisition.
- **No TLS/verification bypass was used** — no `-k`, no `verify=False`, no
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, no `rejectUnauthorized:false`. Standard certificate
  verification was in effect for every request (see §6).
- Files were saved byte-for-byte as the servers returned them; the only local additions are the
  captured HTTP response headers (`*.headers.txt`).

---

## 2. Temperature + Salinity

### 2.1 Provenance

| Field | Value |
| --- | --- |
| **Parameter(s)** | Temperature and Salinity (one file, both variables) |
| **Official source** | INCOIS ERDDAP — `https://erddap.incois.gov.in/erddap/` (ERDDAP server v2.30) |
| **Dataset / product name** | *"INCOIS ARGO 10 Day data Kessler-McCreary Methodology"* |
| **Dataset ID** | `incois_argo_10day_McCreary` |
| **Data type (per official metadata)** | Observational (Argo profiling floats), objectively analysed onto a 1° grid. `cdm_data_type = Grid`. **Not real-time** — a 10-day analysis product. |
| **Service used** | ERDDAP **`griddap`** (RESTful subsetting), NetCDF response |
| **Exact endpoint** | `https://erddap.incois.gov.in/erddap/griddap/incois_argo_10day_McCreary.nc` |
| **Exact query / subset** | `?T_ANALYZED[(2026-07-10):1:(2026-07-30)][(5.0):1:(2000.0)][(-10):1:(25)][(50):1:(100)],S_ANALYZED[(2026-07-10):1:(2026-07-30)][(5.0):1:(2000.0)][(-10):1:(25)][(50):1:(100)]` |
| | (axis order `[time][ZAX][latitude][longitude]`; brackets URL-encoded `%5B`/`%5D` on the wire) |
| **Acquisition date/time** | **2026-09-05 18:48:37 UTC** (`Date` / `Last-Modified` response header) — local IST ≈ 2026-09-06 00:18 |
| **HTTP result** | `200`, `Content-Type: application/x-netcdf`, `Content-Encoding: identity`, `Transfer-Encoding: chunked` |
| **Original filename (server `Content-Disposition`)** | `incois_argo_10day_McCreary_1f07_35a9_a6d5_U1788634117350.nc` |
| **Local filename** | `data/raw/temperature_salinity_incois_argo_sample.nc` |
| **Format** | NetCDF-3 classic (file magic `CDF\x01`) |
| **File size** | 1,062,744 bytes |
| **SHA-256** | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` |
| **Authentication requirement** | **None** — all INCOIS ERDDAP datasets are `accessible = public` |
| **Acquisition result** | **Real INCOIS data acquired** |
| **Access limitations observed** | None. Sub-second response. This subset is reproducible at any time — it is stable historical analysis, not a rolling feed. |

### 2.2 Structure (from local read + cross-checked against the ERDDAP `.ncHeader` for the same query)

**Dimensions:** `time = 3`, `ZAX = 24`, `latitude = 36`, `longitude = 51`

**Coordinate variables:**

| Coordinate | Size | Values | Attributes |
| --- | --- | --- | --- |
| `time` | 3 | 2026-07-10, 2026-07-20, 2026-07-30 (00:00:00Z) | `units "seconds since 1970-01-01T00:00:00Z"`, `standard_name time`, `axis T`, `calendar standard` |
| `ZAX` (depth) | 24 | 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000 | `units "METERS"`, `axis Z`, `point_spacing uneven` (no `standard_name`, no `positive` — a known CF gap noted in D3 §3.2) |
| `latitude` | 36 | −9.5 → 25.5, step 1.0 | `units degrees_north`, `standard_name latitude`, `axis Y` |
| `longitude` | 51 | 50.5 → 100.5, step 1.0 | `units degrees_east`, `standard_name longitude`, `axis X` |

**Data variables:**

| Variable | Type | Shape | Units | Attributes |
| --- | --- | --- | --- | --- |
| **`T_ANALYZED`** | float | `[time=3, ZAX=24, latitude=36, longitude=51]` | `degs` (i.e. °C) | `long_name "Objectively Analyzed Temperature"`, `_FillValue 9999.0`, `missing_value 9999.0`, `ioos_category Temperature` |
| **`S_ANALYZED`** | float | `[time=3, ZAX=24, latitude=36, longitude=51]` | `PSU` | `long_name "Objectively Analyzed Salinity"`, `standard_name "sea_water_practical_salinity"`, `_FillValue 9999.0`, `missing_value 9999.0` |

**Selected global attributes (preserved from source):** `institution = "INCOIS"`,
`title = "INCOIS ARGO 10 Day data Kessler-McCreary Methodology"`, `Conventions = "CF-1.6, COARDS,
ACDD-1.3"`, `time_coverage_start = "2026-07-10T00:00:00Z"`, `time_coverage_end =
"2026-07-30T00:00:00Z"`, `license = "The data may be used and redistributed for free but is not
intended for legal use, since it may contain inaccuracies. …"`

**Time period represented:** 2026-07-10 to 2026-07-30 — the **three most recent 10-day analysis
steps** available on the server at acquisition time (dataset newest step = 2026-07-30).

### 2.3 Acquisition-verification (NOT scientific validation — that is D6)

| Check | Result |
| --- | --- |
| File exists | ✅ `data/raw/temperature_salinity_incois_argo_sample.nc` |
| Opens / reads as a valid format | ✅ NetCDF-3 classic; header parsed; matches server `.ncHeader` exactly |
| Expected variables present | ✅ `T_ANALYZED`, `S_ANALYZED` |
| Expected coordinates present | ✅ `time`, `ZAX`, `latitude`, `longitude` |
| Contains actual data values | ✅ — representative reads below |

**Representative non-missing values** (newest time step, 2026-07-30; point 12.5 °N, 68.5 °E,
central Arabian Sea; vertical profile):

| Depth (m) | T (°C) | S (PSU) |
| --- | --- | --- |
| 5 | 29.078 | 36.180 |
| 50 | 29.046 | 36.212 |
| 150 | 19.381 | 35.589 |
| 400 | 12.068 | 35.383 |
| 800 | 9.315 | 35.310 |
| 1400 | 5.507 | 35.000 |

Fill value `9999.0` observed in some near-coast cells (e.g. around 10.5 °N / 74.5 °E, near
Lakshadweep) — **preserved, not removed.** Surface-layer values in a 4×5 lat/lon window ranged
27.7–29.9 °C. All values are physically plausible for the region and season and are consistent
with the independent spot-check recorded in D3 §3.5.

---

## 3. Salinity

Salinity was acquired **in the same file and the same request** as temperature — see §2. The
salinity variable is `S_ANALYZED` (units `PSU`, `standard_name sea_water_practical_salinity`,
`_FillValue 9999.0`), on the identical `[time=3, ZAX=24, latitude=36, longitude=51]` grid.

| Field | Value |
| --- | --- |
| Official source | INCOIS ERDDAP |
| Dataset ID | `incois_argo_10day_McCreary` |
| Variable | `S_ANALYZED` |
| Acquired file | `data/raw/temperature_salinity_incois_argo_sample.nc` (1,062,744 bytes) |
| Format | NetCDF-3 classic |
| Time represented | 2026-07-10, 2026-07-20, 2026-07-30 |
| Raw data preserved | ✅ unchanged — no rescale, regrid, rename, unit change, or fill-value removal |

**Representative non-missing salinity values:** see the profile table in §2.3 (36.180 PSU at 5 m
down to 35.000 PSU at 1400 m at 12.5 °N / 68.5 °E).

---

## 4. Surface Ocean Currents

### 4.1 Provenance

| Field | Value |
| --- | --- |
| **Parameter** | Ocean currents — **surface only** |
| **Official source** | INCOIS THREDDS Data Server — `https://incois.gov.in/thredds/` |
| **Dataset family** | `osf/currents/CURRENTS_IO_YYYYMMDD.nc` |
| **Source file used** | `CURRENTS_IO_20260904.nc` (THREDDS catalog: `dataSize 597.2 Mbytes`, `date modified 2026-09-05T06:00:37Z`) — the most recent Indian-Ocean file in the catalog at acquisition time |
| **Product** | **IO-HOOFS** (Indian Ocean High-resolution Operational Ocean Forecast and reanalysis System). Per the file's own variable `history`: `From /home/osf/OperationalWork/Models/NetCDF/OGCM/IO_HOOFS/ioout_20260904.nc` |
| **Data type (per official metadata)** | **Operational ocean-current forecast product** from an ocean general circulation model (ROMS-based IO-HOOFS). Not observational; **not "real-time"** — it is a model forecast. `Conventions = "CF-1.6"`. |
| **Service used** | **NetCDF Subset Service** (`ncss/grid`), NetCDF-3 response |
| **Exact endpoint** | `https://incois.gov.in/thredds/ncss/grid/osf/currents/CURRENTS_IO_20260904.nc` |
| **Exact query / subset** | `?var=U&var=V&var=CURRENT&north=25&south=-10&east=100&west=50&time=all&timeStride=10&accept=netcdf3` |
| | (server-side bounding-box subset over the Arabian Sea + Bay of Bengal region; every 10th forecast time step; all three current variables) |
| **Acquisition date/time** | **2026-09-05 18:49:56 UTC** (`Date` response header) — local IST ≈ 2026-09-06 00:19 |
| **HTTP result** | `200`, `Content-Type: application/x-netcdf`, `Content-Length: 24300572` |
| **Original filename (server `Content-Disposition`)** | `CURRENTS_IO_20260904.nc` |
| **Local filename** | `data/raw/currents_incois_io-hoofs_sample.nc` |
| **Format** | NetCDF-3 classic (file magic `CDF\x01`) |
| **File size** | 24,300,572 bytes |
| **SHA-256** | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` |
| **Authentication requirement** | **None** — anonymous access, no registration, no token |
| **Acquisition result** | **Real INCOIS data acquired** |
| **Access limitations observed** | The INCOIS THREDDS `osf/currents` catalog holds only a **rolling ~7-day window** of daily forecast files. `CURRENTS_IO_20260904.nc` is expected to be removed from the server around **2026-09-11**; this exact source file cannot be re-downloaded after that. The 597 MB whole file was **not** downloaded — only the server-side regional/time subset above. Adding ISO-timestamp time parameters (`time_start`/`time_end`) to an NCSS request returns HTTP 400 from the Apache front-end (documented in D3 §6.3); `time=all` with `timeStride` works and was used. |

### 4.2 Structure (from local read; cross-checked against the NCSS `dataset.xml` and OPeNDAP `.das`)

**Dimensions:** `TAXIS = 4`, `DEPTH1_1 = 1`, `LAT = 421`, `LON = 601`

**Coordinate variables:**

| Coordinate | Size | Values | Attributes |
| --- | --- | --- | --- |
| `TAXIS` (time) | 4 | 48, 78, 108, 138 (hours) → forecast valid **2026-09-05 01:30Z, 2026-09-06 07:30Z, 2026-09-07 13:30Z, 2026-09-08 19:30Z** | `units "hours since 2026-09-03 01:30"`, `standard_name time`, `calendar standard`, `axis T` |
| `DEPTH1_1` (depth) | **1** | **0.0 m** | `units "meters"`, `positive "down"`, `standard_name "depth"`, `axis Z` |
| `LAT` | 421 | −10.008 → 25.020, even spacing ≈ **0.0833° (1/12°)** | `units degrees_north`, `standard_name latitude`, `axis Y` |
| `LON` | 601 | 49.992 → 100.014, even spacing ≈ **0.0833° (1/12°)** | `units degrees_east`, `standard_name longitude`, `axis X`, `modulo 360.0` |

> The NCSS bounding-box subset returned the **native grid cells** falling within/around the
> requested bounds (hence `LON` starts at 49.992 rather than exactly 50.0). Grid spacing is
> unchanged at 1/12°. This is server-side subsetting, **not a regrid**.

**Data variables:**

| Variable | Type | Shape | Units / meaning | Attributes |
| --- | --- | --- | --- | --- |
| **`U`** | double | `[TAXIS=4, DEPTH1_1=1, LAT=421, LON=601]` | eastward current, m/s | `long_name "U Component"`, `standard_name "eastward_current"`, `_FillValue -1e34`, `missing_value -1e34` |
| **`V`** | double | `[TAXIS=4, DEPTH1_1=1, LAT=421, LON=601]` | northward current, m/s | `long_name "V Component"`, `standard_name "northward_current"`, `_FillValue -1e34`, `missing_value -1e34` |
| **`CURRENT`** | double | `[TAXIS=4, DEPTH1_1=1, LAT=421, LON=601]` | current speed, m/s (supplied by INCOIS) | `long_name "Surface Currents (m/s)"`, `_FillValue -1e34`, `missing_value -1e34` |

**Global attributes (preserved as received):** `Conventions = "CF-1.6"`,
`history = "PyFerret V7.63 (optimized)  5-Sep-26"`, and an NCSS-added
`History = "Translated to CF-1.0 Conventions by Netcdf-Java CDM (CFGridCoverageWriter) … Original
Dataset = CURRENTS_IO_20260904.nc; Translation Date = 2026-09-05T…"` (this line was written by the
INCOIS server's subsetting tool and is part of the file exactly as received — nothing was changed
locally).

**Time period represented:** forecast steps valid **2026-09-05 01:30 UTC → 2026-09-08 19:30 UTC**
(4 of the 32 3-hourly steps of the forecast run initialised on ~2026-09-04).

### 4.3 U / V confirmation and surface-only confirmation

| Check | Result |
| --- | --- |
| **Eastward component (`U`)** | ✅ present, `standard_name eastward_current`, m/s |
| **Northward component (`V`)** | ✅ present, `standard_name northward_current`, m/s |
| **Current speed** | ✅ INCOIS supplies it directly as `CURRENT` — **preserved as-is**; not recalculated |
| **`CURRENT` vs `sqrt(U²+V²)`** | Observed equal to 4 decimal places at every sampled point (informational only — no derived field was created, no substitution made) |
| **Surface only** | ✅ `DEPTH1_1` has exactly **one** level, value **0.0 m**. **No subsurface levels exist in this product and none were invented.** |
| Multiple current products combined? | ❌ No — a single IO-HOOFS file only |

### 4.4 Acquisition-verification

| Check | Result |
| --- | --- |
| File exists | ✅ `data/raw/currents_incois_io-hoofs_sample.nc` |
| Opens / reads as a valid format | ✅ NetCDF-3 classic; header parsed; dimensions/vars match NCSS `dataset.xml` |
| Expected variables present | ✅ `U`, `V`, `CURRENT` |
| Expected coordinates present | ✅ `TAXIS` (time), `LAT`, `LON`, `DEPTH1_1` (surface) |
| Contains actual data values | ✅ — representative reads below |

**Representative non-missing values** (first forecast step, valid 2026-09-05 01:30 UTC):

| Location | U (m/s) | V (m/s) | `CURRENT` (m/s) |
| --- | --- | --- | --- |
| Open Arabian Sea (15.0 °N, 65.0 °E) | +0.0130 | −0.0762 | 0.0773 |
| N Bay of Bengal (18.0 °N, 88.0 °E) | +0.0614 | −0.0995 | 0.1169 |
| South of India (8.0 °N, 77.0 °E) | +0.2584 | −0.2174 | 0.3377 |
| Somali coast (12.0 °N, 50.5 °E) | +0.1504 | +0.1014 | 0.1814 |

Fill value `-1e34` observed over land cells — **preserved, not removed.** Magnitudes (stronger
flow near the southern tip of India and off the Somali coast, weaker in the open Arabian Sea) are
physically plausible for the south-west monsoon season.

---

## 5. Raw Data Preservation

| Rule | Status |
| --- | --- |
| Files kept in `data/raw/` | ✅ |
| Clear filenames | ✅ `temperature_salinity_incois_argo_sample.nc`, `currents_incois_io-hoofs_sample.nc` |
| No rescaling | ✅ |
| No interpolation | ✅ |
| No regridding | ✅ (NCSS returned native-grid cells; ERDDAP returned native 1° grid) |
| No scientific variable renaming | ✅ (`T_ANALYZED`, `S_ANALYZED`, `U`, `V`, `CURRENT` as received) |
| No unit changes | ✅ (`degs`, `PSU`, `m/s`, `METERS`, hours-since as received) |
| No missing-value removal | ✅ (`9999.0` and `-1e34` fill values retained) |
| No format conversion | ✅ (saved as the NetCDF-3 bytes the servers sent) |
| Original response headers captured | ✅ `*.headers.txt` alongside each file |
| Integrity recorded | ✅ SHA-256 in this document and in `data/raw/README.md` |

**Nothing in `data/raw/` may be modified by later steps.** D5+ must read these files and write
their outputs elsewhere.

---

## 6. Security / TLS

**No certificate-verification bypass of any kind was used.** Every request in this step ran with
standard TLS verification enabled (`curl` on Windows via the Schannel backend, default system CA
store). Specifically not used: `curl -k`, `--insecure`, `verify=False`,
`NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`.

Carrying forward the D3 §11 finding:

| Host | Certificate chain | This acquisition |
| --- | --- | --- |
| `erddap.incois.gov.in` (temperature/salinity) | **Leaf-only** — server omits the `GlobalSign RSA OV SSL CA 2018` intermediate | Succeeded here because the Windows CA store already had the intermediate cached. **A clean Linux/`certifi` client (i.e. the eventual D7 backend) would fail** unless the intermediate is supplied to the client — this is a documented D7 task, not a D4 blocker, and was **not** worked around. |
| `incois.gov.in` (currents THREDDS) | **Complete** (2 certs, `Verify return code: 0 (ok)`) | No TLS issue. |

No acquisition failed for authentication, network, server, certificate, or permission reasons.
Both downloads returned HTTP 200 on the first attempt.

---

## 7. Chlorophyll Status

**CHLOROPHYLL: PENDING — not acquired in D4.**

- Official INCOIS chlorophyll products **have been identified** (D1–D3 follow-up):
  the INCOIS Ocean Colour Products / ChloroGIN service (MODIS/VIIRS-derived, 1 km), an INCOIS
  GeoServer WCS chlorophyll raster (`PFZ-TUNA-SST-CHL:chl`, float32, mg/m³, ~1 km), an INCOIS
  THREDDS Indian-Ocean VIIRS file (`remotesensing/…-Entire-CHL.nc`, full CF metadata), and a live
  daily INCOIS THREDDS VIIRS series that currently covers only the Pacific.
- **Unresolved blockers** (from the D3 follow-up, §14):
  - No single INCOIS route is simultaneously **current + Indian-Ocean + dated**. The
    Indian-Ocean THREDDS file is frozen at March 2025; the GeoServer raster carries **no
    acquisition date and no time dimension**; the live daily series is Pacific-only.
  - **Licensing / redistribution permission is unresolved** — the INCOIS THREDDS and GeoServer
    carry no published licence or attribution statement, and the GeoServer's Apache front-end
    returns 403 on `/geoserver/ows` and `/geoserver/web`, making access intent ambiguous.
  - Machine-readable access for the *current NRT* INCOIS chlorophyll product is via an **email
    request** to `samanta.a@incois.gov.in`, which has not been made.
- **No unsupported third-party replacement has been introduced.** NASA, NOAA, Copernicus and ISRO
  MOSDAC products were catalogued only as clearly-labelled potential fallbacks in earlier steps
  and were **not downloaded or placed in `data/raw/`**.
- The undated GeoServer raster has **not** been acquired or treated as a time-aware operational
  feed. The March 2025 THREDDS file has **not** been acquired or presented as current.

**Chlorophyll integration remains pending official INCOIS access/usage clarification.** Chlorophyll
acquisition is **not** complete.

---

## 8. Files Created / Modified

**Created:**

| Path | What |
| --- | --- |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | Real INCOIS ERDDAP Argo T+S subset (raw) |
| `data/raw/temperature_salinity_incois_argo_sample.headers.txt` | HTTP response headers for the above |
| `data/raw/currents_incois_io-hoofs_sample.nc` | Real INCOIS THREDDS IO-HOOFS surface-current subset (raw) |
| `data/raw/currents_incois_io-hoofs_sample.headers.txt` | HTTP response headers for the above |
| `data/raw/README.md` | Directory pointer + integrity table |
| `docs/data-acquisition.md` | This provenance document |

**Modified:** none.

**Application code changed:** none (no frontend, backend, API, database, visualization,
mock-dataset, ingestion, or data-processing code was touched).

**Existing D1/D2/D3 documentation changed:** none — `docs/data-sources.md`,
`docs/data-availability.md`, `docs/data-access.md`, `docs/data-access-followup.md` are unchanged.

**Git note:** the root `.gitignore` does not exclude `data/`, so both `.nc` files are currently
stageable. They were **not committed** in this step. Recommendation for a later decision:
committing `currents_incois_io-hoofs_sample.nc` is worthwhile because its source file rolls off the
INCOIS server around 2026-09-11 and cannot be re-acquired; the temperature/salinity subset is
fully reproducible from ERDDAP at any time.

---

## 9. D4 Status

**D4 STATUS: COMPLETE** (for the three confirmed parameters; chlorophyll explicitly PENDING).

| Requirement | Met |
| --- | --- |
| Existing D1–D3 documentation read and used | ✅ |
| Temperature + salinity acquired as a small real subset from INCOIS ERDDAP `incois_argo_10day_McCreary` (≥1 time, multiple depths/lats/lons) | ✅ |
| Surface currents acquired as a small real subset from the confirmed INCOIS IO-HOOFS THREDDS source | ✅ |
| Raw files preserved unchanged in `data/raw/` with clear names | ✅ |
| Local acquisition-verification performed (exists / opens / valid format / expected vars + coords / real values) | ✅ |
| Provenance documented in `docs/data-acquisition.md` | ✅ |
| Chlorophyll documented as PENDING, no third-party substitution | ✅ |
| No TLS/security bypass | ✅ |
| No ingestion / backend / API / frontend / mock-data / processing work | ✅ |
| No D5+ work started | ✅ |

**D4 is complete. Do not start D5. Awaiting further instructions.**
