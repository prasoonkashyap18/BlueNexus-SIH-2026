# BlueNexus D6 Data Validation

**Data Track step:** D6 — Verify Units, Ranges & Missing Values
**Type:** Read-only scientific validation + documentation. No raw-data modification, no ingestion,
no cleaning / regridding / interpolation / normalization / unit conversion, no backend, no API,
no frontend change, no mock-data replacement.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** `docs/data-sources.md` (D1) · `docs/data-availability.md` (D2) ·
`docs/data-access.md` (D3) · `docs/data-access-followup.md` (D3 follow-up) ·
`docs/data-acquisition.md` (D4) · `docs/data-dimensions.md` (D5)

---

## 1. D6 Status

**D6 COMPLETE.**

Both D4 raw NetCDF files were opened **read-only** and their scientific content validated:
units, valid ranges, missing/fill behaviour, coordinate validity, and time-axis semantics.
**No raw data was modified.** SHA-256 checksums are identical before and after analysis (see
§13 Raw File Integrity).

**Method.** Both files are NetCDF-3 classic (`CDF\x01`). They were read with the same small
read-only pure-Python NetCDF-3 reader used in D5 (`scratchpad/nc3inspect.py`) plus a read-only
analysis script (`scratchpad/d6validate.py`). **No Python packages were installed.** The
environment has no `netCDF4` / `xarray` / `numpy`; all statistics were computed in plain Python.
The scratch scripts live outside the project tree and are not application code.

**External evidence.** For the current-velocity unit question (the D5 open item — `U`/`V` have
no `units` attribute) three authoritative INCOIS sources were consulted:

1. The dataset's own metadata (local file + the INCOIS THREDDS OPeNDAP DAS for the exact same
   file — `https://incois.gov.in/thredds/dodsC/osf/currents/CURRENTS_IO_20260904.nc.das`).
2. INCOIS Ocean State Forecast product documentation — `https://www.incois.gov.in/site/services/osf.jsp`.
3. INCOIS HOOFS model description — `https://odis.incois.gov.in/site/datainfo/modelling/hoofs.jsp`
   (reached via INCOIS site search; see §4).

No third-party / blog sources were used to establish units.

---

## 2. Temperature Validation

**Variable:** `T_ANALYZED` · float32 · dims `time × ZAX × latitude × longitude` (`3 × 24 × 36 × 51`)

| Item | Finding |
| --- | --- |
| **Stored `units`** | `"degs"` (exactly as stored) |
| **Authoritative interpretation of "degs"** | **degrees Celsius (°C).** `"degs"` is a FERRET/COARDS-legacy label (the file's `history` shows a FERRET → `cdo` provenance chain). Interpretation is **CONFIRMED by value structure**: surface (5 m) values 24.6–32.6 °C, 2000 m values 2.5–3.2 °C, monotonic cooling with depth at every level (see per-level table below). These are textbook tropical-Indian-Ocean temperatures in °C. They are impossible in Kelvin (would be ~275–305) and not Fahrenheit (surface would be ~76–90 and the deep ocean far above freezing-scale values). Product context: `title`/`summary` = *"INCOIS ARGO 10 Day data Kessler-McCreary Methodology"*, `ioos_category = Temperature`. **No `standard_name`** is present (D5 finding). |
| **Fill value** | `_FillValue = 9999.0`, `missing_value = 9999.0` (both float32, identical) |
| **Missing-value behaviour** | Every missing cell is **exactly** `9999.0`. No NaNs, no negative sentinels, no alternate codes. Missing cells are land, sub-bathymetry, and depth levels where the Argo-based analysis has no coverage (only 682 of 3 672 cells are valid at 2000 m). |
| **Missing / fill cells** | 47 702 of 132 192 |
| **Missing %** | **36.09 %** |
| **Valid cells** | 84 490 |
| **Minimum valid value** | **2.540 °C** — at `time=2026-07-20`, `ZAX=2000 m`, `lat=-9.5`, `lon=72.5` |
| **Maximum valid value** | **32.586 °C** — at `time=2026-07-30`, `ZAX=5 m`, `lat=25.5`, `lon=57.5` (far-northern Arabian Sea, peak summer SST) |
| **Distribution (valid only)** | mean 15.31, median 12.28, p01 3.01, p05 3.63, p95 29.62, p99 29.92 |
| **Representative valid values** | 5 m: 24.6–32.6 · 100 m: 15.8–28.3 · 500 m: 8.3–13.3 · 1000 m: 5.2–9.4 · 2000 m: 2.5–3.2 |

**Per-depth-level valid range (°C):**

| Level | Depth | min | max | Level | Depth | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 5 m | 24.57 | 32.59 | 12 | 400 m | 9.33 | 14.58 |
| 1 | 10 m | 23.28 | 32.58 | 13 | 500 m | 8.29 | 13.35 |
| 2 | 20 m | 21.72 | 32.27 | 14 | 600 m | 7.54 | 12.35 |
| 3 | 30 m | 19.66 | 30.06 | 15 | 700 m | 6.88 | 11.49 |
| 4 | 50 m | 18.74 | 30.25 | 16 | 800 m | 6.26 | 10.77 |
| 5 | 75 m | 17.28 | 30.18 | 17 | 900 m | 5.66 | 10.18 |
| 6 | 100 m | 15.80 | 28.26 | 18 | 1000 m | 5.18 | 9.45 |
| 7 | 125 m | 13.98 | 25.46 | 19 | 1200 m | 4.50 | 7.51 |
| 8 | 150 m | 13.10 | 23.33 | 20 | 1400 m | 3.82 | 6.07 |
| 9 | 200 m | 12.10 | 21.92 | 21 | 1600 m | 3.16 | 4.81 |
| 10 | 250 m | 11.55 | 19.74 | 22 | 1800 m | 2.77 | 3.89 |
| 11 | 300 m | 10.79 | 16.53 | 23 | 2000 m | 2.54 | 3.18 |

**Classification of findings:**

- **VALID:** the entire valid range 2.54–32.586 °C, at every level. Vertical structure is
  physically correct (warm mixed layer → thermocline → cold deep water).
- **MISSING/FILL:** 36.09 % of cells = exactly `9999.0` (land / sub-bathymetry / uncovered deep
  levels).
- **SUSPICIOUS:** none that survive inspection. A cluster of cells at 2000 m read exactly
  `2.5400` (identical to 4 dp); this is consistent with an objective-analysis background/first
  guess floor in a data-sparse region (only ~19 % of 2000 m cells are valid) — **not an error**.
  Recorded for a second look during D15; **non-blocking**.
- **INVALID:** none.

---

## 3. Salinity Validation

**Variable:** `S_ANALYZED` · float32 · dims `time × ZAX × latitude × longitude` (`3 × 24 × 36 × 51`)

| Item | Finding |
| --- | --- |
| **Stored `units`** | `"PSU"` (exactly as stored) |
| **Authoritative interpretation of PSU** | **Practical Salinity Unit** (Practical Salinity Scale 1978) — dimensionless conductivity-ratio salinity. **CONFIRMED by metadata**: `standard_name = "sea_water_practical_salinity"` (a canonical CF standard name whose quantity is exactly practical salinity), `ioos_category = "Salinity"`, `long_name = "Objectively Analyzed Salinity"`, display hints `colorBarMinimum/Maximum = 32 / 37`. |
| **Fill value** | `_FillValue = 9999.0`, `missing_value = 9999.0` (both float32, identical) |
| **Missing-value behaviour** | Every missing cell is **exactly** `9999.0`. Same land / bathymetry / deep-coverage pattern as temperature. |
| **Missing / fill cells** | 47 644 of 132 192 |
| **Missing %** | **36.04 %** |
| **Valid cells** | 84 548 |
| **Minimum valid value** | **30.930 PSU** — at `time=2026-07-20`, `ZAX=20 m`, `lat=20.5`, `lon=90.5` (northern Bay of Bengal) |
| **Maximum valid value** | **37.353 PSU** — at `time=2026-07-10`, `ZAX=200 m`, `lat=25.5`, `lon=57.5` (northern Arabian Sea / Gulf of Oman) |
| **Distribution (valid only)** | mean 35.06, median 35.00, p01 32.96, p05 34.13, p95 36.13, p99 36.50 |
| **Representative valid values** | 5 m: 31.6–37.0 · 100 m: 34.4–37.1 · 200 m: 34.6–37.4 · 1000 m: 34.6–35.5 · 2000 m: 34.7–34.9 |

**Classification of findings:**

- **VALID:** the entire valid range 30.93–37.353 PSU.
- **MISSING/FILL:** 36.04 % of cells = exactly `9999.0`.
- **SUSPICIOUS → explained, reclassified VALID:**
  - **Low extreme 30.93 PSU** (northern Bay of Bengal, 20 m, July): the Bay of Bengal receives
    very large summer-monsoon river discharge (Ganga–Brahmaputra–Meghna); a near-surface
    low-salinity lens of 28–32 PSU there in July is a well-documented feature. Legitimate
    oceanographic extreme.
  - **High extreme 37.353 PSU** (northern Arabian Sea, 200 m): the subsurface salinity maximum
    from Persian Gulf Water (~200 m core in the northern Arabian Sea) routinely reaches
    ~36.5–37+ PSU. Legitimate oceanographic feature. It exceeds the file's own
    `colorBarMaximum = 37` slightly — but that attribute is only a **display hint**, not a
    valid-range limit.
- **INVALID:** none.

---

## 4. Current Validation

**File:** `data/raw/currents_incois_io-hoofs_sample.nc`
**Variables:** `U`, `V`, `CURRENT` — all float64, all dims `TAXIS × DEPTH1_1 × LAT × LON`
(`4 × 1 × 421 × 601`), all `_FillValue = missing_value = -1e+34`.

### 4.1 Per-variable results

| | `U` | `V` | `CURRENT` |
| --- | --- | --- | --- |
| `long_name` | `U Component` | `V Component` | `Surface Currents (m/s)` |
| `standard_name` | `eastward_current` | `northward_current` | *(absent)* |
| explicit `units` attr | **none** (confirmed absent in local file **and** in the INCOIS THREDDS OPeNDAP DAS) | **none** (same) | **none** (but `long_name` embeds "m/s") |
| Fill / missing sentinel | `-1e+34` (both `_FillValue` and `missing_value`) | `-1e+34` | `-1e+34` |
| Total cells | 1 012 084 | 1 012 084 | 1 012 084 |
| Missing / fill cells | 206 392 | 205 756 | 207 888 |
| Missing % | **20.39 %** | **20.33 %** | **20.54 %** |
| Valid cells | 805 692 | 806 328 | 804 196 |
| Min valid | **−1.13419** (13.7°N–approx, `TAXIS[3]`, off the eastern Bay of Bengal) | **−1.33055** (`TAXIS[3]`, ~10.6°N 54.7°E) | **0.00038** (near-slack cell) |
| Max valid | **+1.68921** (`TAXIS[1]`, ~14.8°N 82.4°E) | **+2.47688** (`TAXIS[2]`, ~11.1°N 51.9°E) | **2.63063** (`TAXIS[1]`, ~10.9°N 51.9°E) |
| Distribution (valid) | mean −0.068, median −0.051, p01 −0.89, p99 +0.85 | mean −0.061, median −0.078, p01 −0.56, p99 +0.78 | mean 0.333, median 0.275, p95 0.80, p99 1.16 |

Missing cells are the land mask; the ~20 % fraction and its spatial pattern are consistent
across all three variables.

### 4.2 Units determination — **CONFIRMED: metres per second (m s⁻¹)**

`U` and `V` carry **no `units` attribute** anywhere — not in the local file and not in the
authoritative INCOIS THREDDS OPeNDAP DAS for the identical source file. The unit is nonetheless
established with confidence by a convergent chain of authoritative evidence:

1. **Dataset metadata (evidence tier 1).** The sibling variable `CURRENT` has
   `long_name = "Surface Currents (m/s)"` — an explicit m/s statement, **identical in the INCOIS
   THREDDS DAS** for this exact file.
2. **Exact magnitude identity (evidence tier 1, derived from the data itself).**
   `CURRENT ≡ sqrt(U² + V²)` holds for **100.000 %** of the 804 196 cells where all three are
   valid, to a worst-case absolute difference of **4.4 × 10⁻¹⁶** (floating-point epsilon).
   Therefore `U` and `V` are in the **same physical unit as `CURRENT`** → m/s. (This is an
   observation about the acquired file; **no derived field was created**.)
3. **CF-style variable semantics (evidence tier 2).** `U.standard_name = eastward_current`,
   `V.standard_name = northward_current` — velocity-component names (the closest canonical CF
   table entries, `eastward_sea_water_velocity` / `northward_sea_water_velocity`, carry the
   canonical unit `m s-1`).
4. **Official INCOIS documentation (evidence tier 2).** INCOIS Ocean State Forecast product
   page (`incois.gov.in/site/services/osf.jsp`): *"Current Speed (m/s) … The units of this
   parameter are meters per second."* The same page states OSF forecasts are issued *"at
   3-hour intervals for the next 5–10 days"* — consistent with §6 below. INCOIS HOOFS is a
   ROMS-v3.7 based operational ocean forecast system.
5. **Physical plausibility (corroboration).** Valid speeds: mean 0.33, median 0.27, p99 1.16,
   max 2.63 m/s. The peak `V`/`CURRENT` cells (~10–12°N, 51–52°E, `TAXIS[1]`–`TAXIS[2]`,
   i.e. 2026-09-06/07) sit in the **Somali Current** off the Horn of Africa, which during the
   south-west monsoon (through September) is among the fastest currents in the world ocean at
   2–3.5 m/s at the surface. Values are consistent **only** with m/s — cm/s would imply a mean
   speed of 33 cm/s… no: cm/s would make these numbers 0.3 cm/s mean, absurdly slow; and if the
   stored numbers were cm/s the real speeds would be ~30 m/s, impossible.

**Interpretation of each variable (CONFIRMED):**

- `U` = **eastward** component of surface current velocity, m s⁻¹ (signed; negative = westward).
- `V` = **northward** component of surface current velocity, m s⁻¹ (signed; negative = southward).
- `CURRENT` = **current speed / magnitude** = √(U²+V²), m s⁻¹, ≥ 0. Supplied directly by INCOIS
  in the file; verified equal to the vector magnitude, **not** recomputed or substituted here.

**Caveat carried forward (non-blocking):** because `U`/`V` have no `units` attribute, D7 should
**annotate** `units = "m s-1"` on all three variables when it writes its own working copy — a
metadata addition, not a change to any value.

### 4.3 Classification

- **VALID:** the full valid ranges of `U` (−1.134…+1.689), `V` (−1.331…+2.477),
  `CURRENT` (0.0004…2.631) m/s.
- **MISSING/FILL:** ~20 % of cells = exactly `-1e+34` (land mask).
- **SUSPICIOUS → explained, reclassified VALID:** the 2.4–2.6 m/s peak speeds — located in the
  Somali Current during the SW monsoon; a legitimate seasonal extreme.
- **INVALID:** none.
- **UNCONFIRMED:** none remain. The units question is resolved to **CONFIRMED m s⁻¹**.

---

## 5. Coordinate Validation

### 5.1 Temperature / Salinity file

| Coord | N | Range | Spacing | Order | Verdict |
| --- | --- | --- | --- | --- | --- |
| `latitude` | 36 | −9.5 … 25.5 °N | **exactly 1.0°** (min diff = max diff = 1.0) | ascending | **VALID** — within [−90, 90]; regular |
| `longitude` | 51 | 50.5 … 100.5 °E | **exactly 1.0°** | ascending | **VALID** — positive-east convention, all values 0–360 (here 50–101); regular |
| `ZAX` (depth) | 24 | 5 … 2000 m | **irregular** (steps 5, 10, 20, 25, 50, 100, 200 m; fine near surface, coarse at depth) | ascending (shallow→deep) | **VALID** — all values positive and physically sensible; `units = METERS`; **no `positive` attribute** (D5 finding) but values increase downward → consistent with positive-down. No negative or zero depths. |

`geospatial_lat_min/max`, `geospatial_lon_min/max` global attrs (−9.5/25.5, 50.5/100.5) match
the coordinate end-values exactly. No `bounds` variables → cell-centre vs edge not explicitly
declared (values lie on `x.5`, consistent with 1° cell centres — not asserted by metadata).

### 5.2 Currents file

| Coord | N | Range | Spacing | Order | Verdict |
| --- | --- | --- | --- | --- | --- |
| `LAT` | 421 | −10.008 … 24.978 °N | **0.0833°**, regular (max deviation from uniform = 5.3 × 10⁻¹⁵) | ascending | **VALID** — within [−90, 90]; regular |
| `LON` | 601 | 49.992 … 99.972 °E | **0.0833°**, regular (max deviation = 2.1 × 10⁻¹⁴) | ascending | **VALID** — positive-east; `modulo = 360`; regular |
| `DEPTH1_1` | **1** | **exactly 0.0 m** | n/a | n/a | **VALID / surface-only CONFIRMED** — single level, value `0.0`, `positive = down`, `standard_name = depth` |

**Grid-resolution note (non-blocking):** the stored spacing is **exactly `0.0833°`**, i.e. the
value `0.0833` truncated to 4 dp, *not* the exact `1/12 = 0.08333…°`. Over 600 intervals the
grid therefore spans 49.98°, not 50.00°. The product is nominally a ~1/12° grid, but D8/D9 must
use the **stored coordinate arrays**, not synthesise coordinates from an assumed exact 1/12°
step. `geospatial_*` global attrs (−10.04965 / 25.01965, 49.95035 / 100.01365) sit exactly half
a grid step outside the first/last coordinate values → consistent with the coordinate variables
being **cell centres**, not stated explicitly (no `bounds`).

**Depth confirmation for currents:** number of levels = **1**; exact value = **0.0 m**; the
dataset is **surface-only**. No subsurface current levels exist and none were invented.

---

## 6. Time Validation

| | Temperature / Salinity | Currents |
| --- | --- | --- |
| Time variable | `time` | `TAXIS` |
| `units` (exactly as stored) | `seconds since 1970-01-01T00:00:00Z` | `hours since 2026-09-03 01:30` *(no timezone in the string)* |
| `calendar` | `standard` | `standard` |
| N steps | 3 | 4 |
| Raw values | 1 783 641 600 · 1 784 505 600 · 1 785 369 600 | 48 · 78 · 108 · 138 |
| Decoded timestamps | 2026-07-10 00:00:00Z · 2026-07-20 00:00:00Z · 2026-07-30 00:00:00Z | 2026-09-05 01:30 · 2026-09-06 07:30 · 2026-09-07 13:30 · 2026-09-08 19:30 |
| Interval | **exactly 864 000 s = 10.0 days**, uniform | **exactly 30 h**, uniform |
| Consistency | ✅ matches global `time_coverage_start/end` (2026-07-10 … 2026-07-30) | ✅ uniform; see note below |
| **Temporal classification** | **ANALYSIS** | **FORECAST** |
| Basis for classification | Product is an **objective analysis** — `title`/`summary` *"INCOIS ARGO 10 Day data Kessler-McCreary Methodology"*, variable `long_name` *"Objectively Analyzed Temperature/Salinity"*. Each timestamp is the nominal date of a 10-day analysis window. **Not** observation (it is gridded, not raw profiles); **not** forecast. | Product is the **IO-HOOFS operational forecast** (INCOIS Ocean State Forecast, ROMS-based). Variable `history` → `ioout_20260904.nc`; source file `CURRENTS_IO_20260904.nc` (model run ~2026-09-04). INCOIS OSF docs: forecasts issued "at 3-hour intervals for the next 5–10 days". These four timestamps are **forecast-valid times**. **Not** real-time observations; **not** a reanalysis for these lead times. |

**30-hour interval — explained, benign.** The native IO-HOOFS current forecast is **3-hourly**
(≈32 steps per run). The D4 acquisition (`docs/data-acquisition.md` §4.1) used the THREDDS NCSS
parameter **`timeStride=10`**, i.e. it deliberately kept **every 10th** forecast step → 4 steps
spaced 30 h apart. This is a **documented D4 sampling choice**, not a data-quality problem. The
absolute timestamps are unambiguous and uniformly spaced.

**Timezone note (non-blocking).** The currents `units` string has no `Z`/offset. INCOIS OSF /
HOOFS operates in UTC and the D4 documentation treats these as UTC; D6 adopts the same
assumption. D7 may annotate the reference time as UTC explicitly.

---

## 7. Missing Data Summary

Missing/fill cells were **excluded** from every valid-range and distribution statistic. Fill
values are reported exactly as stored; **no missing value was replaced**.

| Variable | Total cells | Missing/fill cells | Missing % | Valid cells | Fill value (as stored) |
| --- | --- | --- | --- | --- | --- |
| `T_ANALYZED` | 132 192 | 47 702 | 36.09 % | 84 490 | `9999.0` (float32) |
| `S_ANALYZED` | 132 192 | 47 644 | 36.04 % | 84 548 | `9999.0` (float32) |
| `U` | 1 012 084 | 206 392 | 20.39 % | 805 692 | `-1e+34` (float64) |
| `V` | 1 012 084 | 205 756 | 20.33 % | 806 328 | `-1e+34` (float64) |
| `CURRENT` | 1 012 084 | 207 888 | 20.54 % | 804 196 | `-1e+34` (float64) |

All missing cells match their sentinel **exactly** (`9999.0`, or `-1e+34`). No secondary
missing codes, no NaNs, no out-of-range stand-ins were found. Temperature/salinity missing
fraction is higher because it includes deep levels the Argo analysis does not populate (e.g.
2000 m is ~81 % missing); the currents missing fraction is essentially the land mask.

---

## 8. Valid Range Summary

| Variable | Units | Minimum valid | Maximum valid | Status |
| --- | --- | --- | --- | --- |
| `T_ANALYZED` | °C (stored as `"degs"`; interpretation CONFIRMED) | 2.540 | 32.586 | **VALID** — physically reasonable at every depth |
| `S_ANALYZED` | PSU (Practical Salinity; CONFIRMED via `standard_name`) | 30.930 | 37.353 | **VALID** — extremes are real BoB / Arabian-Sea features |
| `U` | m s⁻¹ (no `units` attr; CONFIRMED — §4.2) | −1.13419 | +1.68921 | **VALID** |
| `V` | m s⁻¹ (no `units` attr; CONFIRMED — §4.2) | −1.33055 | +2.47688 | **VALID** |
| `CURRENT` | m s⁻¹ (`long_name` "m/s"; CONFIRMED) | 0.00038 | 2.63063 | **VALID** — `CURRENT ≡ √(U²+V²)` verified |

---

## 9. Scientific / Data-Quality Findings

### CONFIRMED

- **Temperature units = °C.** `"degs"` is a legacy label; value structure and product context
  are unambiguous.
- **Salinity units = PSU** (Practical Salinity), from `standard_name = sea_water_practical_salinity`.
- **Current components `U`, `V` and speed `CURRENT` are in m s⁻¹** — established from
  `CURRENT.long_name` ("m/s", also in the INCOIS THREDDS DAS), the exact identity
  `CURRENT ≡ √(U²+V²)` over 804 196 cells (max error 4.4 × 10⁻¹⁶), CF-style component
  `standard_name`s, and INCOIS OSF documentation ("Current Speed (m/s) … meters per second").
- **`CURRENT` is the current speed / vector magnitude**, ≥ 0, supplied by INCOIS in the file.
- **`U` = eastward velocity component, `V` = northward velocity component** (signed).
- **Fill/missing sentinels** are exact and consistent: `9999.0` (T/S), `-1e+34` (U/V/CURRENT).
- **Coordinates are geographically valid and monotonic ascending** on all axes of both files.
  Horizontal grids are regular (1.0° for T/S; 0.0833° for currents). T/S depth axis is
  irregular but physically sensible (5–2000 m, positive-down).
- **Currents are surface-only** — one depth level, exactly 0.0 m.
- **Time axes:** T/S = 10-day **analysis** steps (Jul 2026); currents = 30-h-sampled
  **forecast-valid** steps (Sep 2026) from a natively 3-hourly IO-HOOFS forecast.
- **Datasets do not share a grid or a time axis** — see §10.

### SUSPICIOUS (inspected; each resolved to VALID, none blocking)

| Observation | Where | Assessment |
| --- | --- | --- |
| Salinity as low as 30.93 PSU | northern Bay of Bengal, 20 m, Jul | Real monsoon river-plume freshening. **Legitimate oceanographic extreme.** |
| Salinity as high as 37.35 PSU (> file's `colorBarMaximum = 37`) | northern Arabian Sea, 200 m | Real Persian Gulf Water subsurface salinity maximum. `colorBarMaximum` is a display hint only. **Legitimate.** |
| Current speed up to 2.63 m/s | Somali Current, ~11°N 52°E, 6–7 Sep | SW-monsoon Somali Current routinely 2–3.5 m/s. **Legitimate seasonal extreme.** |
| Temperature 2000 m cells all reading exactly 2.5400 °C | 2000 m, data-sparse cells | Consistent with an objective-analysis background/first-guess floor where Argo coverage is thin (~81 % of 2000 m cells are fill). **Not an error;** flagged for a glance in D15. |
| 30-hour current time step | currents `TAXIS` | Artefact of D4's `timeStride=10` on a 3-hourly forecast. **Documented D4 choice, benign.** |
| Current grid spacing stored as exactly 0.0833° (not 1/12°) | currents `LAT`/`LON` | Truncated-precision coordinate encoding; grid spans 49.98° over 600 steps. **Use stored coords in D8/D9; do not synthesise a 1/12° axis.** |

### UNCONFIRMED

- **None.** The one D5 open item (current-velocity units) is now **CONFIRMED** (§4.2).

### METADATA GAPS (annotation work for D7/D8 — not data problems)

- `T_ANALYZED` has **no `standard_name`** and a non-CF `units` string `"degs"`. D7/D8 should
  annotate `standard_name = "sea_water_temperature"`, `units = "degC"` on the working copy.
- `U`, `V`, `CURRENT` have **no `units` attribute**. D7 should annotate `units = "m s-1"`.
- Currents file has almost no global metadata (no `title`/`institution`/`source`); `CURRENT`
  has no `standard_name`. Cosmetic; provenance is fully captured in `docs/data-acquisition.md`.
- Currents time reference has no explicit timezone; treat as UTC (INCOIS OSF convention).

**None of the above alters a single stored value; all are additive metadata to be applied in
later steps, never in D6.**

---

## 10. Important Dataset Differences

| Aspect | Temperature / Salinity | Currents |
| --- | --- | --- |
| Horizontal grid | regular **1.0° × 1.0°** (36 × 51) | regular **~1/12° (0.0833°)** (421 × 601) |
| Vertical | **24 irregular depth levels**, 5–2000 m | **surface only**, 1 level at 0 m |
| Time | **3 steps, 10-day interval**, Jul 2026 | **4 steps, 30-h sampled** (native 3-hourly), Sep 2026 |
| Time semantics | **ANALYSIS** (objective analysis of Argo) | **FORECAST** (IO-HOOFS operational forecast-valid times) |
| Product type | Argo-based objective analysis (Kessler–McCreary) | ROMS-based operational ocean forecast (IO-HOOFS) |
| Fill sentinel | `9999.0` (float32) | `-1e+34` (float64) |
| Missing fraction | ~36 % (incl. unpopulated deep levels) | ~20 % (land mask) |
| Data type | float32 | float64 |
| Conventions / metadata | `CF-1.6, COARDS, ACDD-1.3`, rich ACDD globals | `CF-1.6` only, minimal globals |

**These datasets must NOT be forced into identical dimensions at this stage.** They are
different products with different native grids, vertical coverage, time bases and time
semantics. **No regridding, interpolation, resampling or vertical extension was performed in D6,
and none should be performed until the appropriate later step.** The backend must preserve each
parameter's own dimensionality: temperature/salinity as 4-D `(time, depth, lat, lon)` fields,
currents as a surface `(time, lat, lon)` field with a degenerate depth level.

---

## 11. Chlorophyll Status

**Chlorophyll remains pending official INCOIS data-access clarification and is not part of D6
validation.**

There is currently **no approved acquired INCOIS chlorophyll dataset in `data/raw/`**. No NASA,
NOAA, Copernicus, MOSDAC or other substitute data was downloaded or validated. When an approved
INCOIS chlorophyll dataset is acquired, it will be dimensionally inspected (D5-style) and
validated (D6-style) and the results added here and to `docs/data-dimensions.md`.

---

## 12. D6 Conclusion — ready for D7

**The two acquired datasets are structurally and physically sound and are SUITABLE to proceed
to D7 (build the data ingestion layer).**

- Units are known for every scientific variable (temperature °C, salinity PSU, currents m s⁻¹ —
  the last established from convergent authoritative evidence despite the missing `units`
  attribute).
- Valid value ranges are physically reasonable at every depth and time step. Every apparent
  outlier was investigated and explained as a legitimate oceanographic feature or a documented
  sampling artefact.
- Missing data uses a single exact sentinel per file (`9999.0` / `-1e+34`), consistently
  applied, easy to mask.
- Coordinates are geographically valid, monotonic and (horizontally) regular; the currents grid
  is surface-only as expected; the T/S depth axis is irregular but sensible.
- Time axes are internally consistent and their semantics (analysis vs forecast) are documented.

**No blocking issues.** The items to handle later — and explicitly **not** now — are:

| Item | Handle in |
| --- | --- |
| Annotate `units`/`standard_name` on T, U, V, CURRENT (metadata only) | D7 / D8 |
| Mask fill values (`9999.0`, `-1e+34`) on read | D7 / D8 |
| Use stored currents coordinates (do not assume exact 1/12°) | D8 / D9 |
| Decide unit-normalisation policy (e.g. keep °C/PSU/m·s⁻¹) | D8 / D9 |
| Preserve parameter-specific dimensionality; no cross-parameter regrid yet | D9 / D10 |
| Second look at the 2000 m constant-temperature cells | D15 |
| Re-acquire currents before ~2026-09-11 rolling-window expiry if a fresh sample is needed | D7 (acquisition concern only) |

---

## 13. Raw File Integrity

SHA-256, computed **before** and **after** all D6 analysis:

| File | SHA-256 (before) | SHA-256 (after) | Match |
| --- | --- | --- | --- |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | ✅ |
| `data/raw/currents_incois_io-hoofs_sample.nc` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | ✅ |

Both files are **byte-for-byte unchanged** and match the D4 acquisition hashes. All access was
read-only.

---

## 14. Scope Boundary

> **D6 validated units, ranges, missing values, coordinates and time structure. No raw data was
> modified and no application, ingestion, API or frontend integration was performed.**

Specifically, during D6:

- No frontend, backend, `package.json`, configuration, database, or mock-data files were
  changed.
- No data was connected to the BlueNexus website; mock temperature was not replaced; salinity,
  currents and chlorophyll were not added to the UI.
- No ingestion layer, API, or processing/cleaning/regridding/interpolation/normalization/
  unit-conversion code was created or run.
- The raw NetCDF files were opened read-only and are byte-for-byte unchanged (§13).
- **No Python packages were installed.** Analysis used a read-only pure-Python NetCDF-3 reader.
- No additional datasets were downloaded (three INCOIS web pages and one INCOIS THREDDS DAS were
  *read* for units evidence — no files saved).
- D7–D15 were **not** started.

**Recommended next step: D7 — Build the data ingestion layer.**

---

## 15. Addendum (added during D7, 2026-09-06) — correction to the currents missing-value description

D7's byte-level read of `data/raw/currents_incois_io-hoofs_sample.nc` refined one point in this
document. Sections 4, 7, 8 and 9 above describe the currents missing cells as equal to the fill
value `-1e+34`. **That is the value of the `_FillValue` / `missing_value` *attributes*, but it is
not how the file encodes missing cells.**

- `U` / `V` / `CURRENT` declare `_FillValue = missing_value = -1e+34` (confirmed here and in the
  INCOIS THREDDS OPeNDAP DAS).
- The data buffers contain **zero** cells equal to `-1e34`. Missing cells are stored as **IEEE
  NaN** (`0x7ff8000000000000`): 206,392 in `U`, 205,756 in `V`, 207,888 in `CURRENT` — exactly
  the "missing/fill" counts already reported in §7.
- Cause: the D4 file was written by the INCOIS THREDDS NetCDF Subset Service
  (`History = "Translated to CF-1.0 Conventions by Netcdf-Java CDM (CFGridCoverageWriter)"`); the
  netCDF-Java CDM writer emits missing floats as NaN while passing the source `_FillValue` /
  `missing_value` attributes through unchanged.
- **No impact on D6's conclusions.** Missing cells remain unambiguous, the counts and the
  fill-excluded valid ranges in §7 and §8 are unchanged, and the datasets remain suitable for
  D7+. Temperature / salinity are unaffected — they store the literal `9999.0` sentinel (0 NaN).

Full detail: `docs/data-ingestion.md` §8.2. The D7 ingestion layer treats both NaN and the
declared sentinel as missing.
