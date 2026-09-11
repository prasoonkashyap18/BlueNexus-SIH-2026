# BlueNexus — Data Dimensions

**Data Track step:** D5 — Inspect Dataset Dimensions
**Type:** Structural inspection + documentation only. No ingestion, no backend, no API, no
frontend change, no mock-data replacement, no cleaning / regridding / interpolation / unit
conversion / normalization, no D6 scientific validation.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** `docs/data-sources.md` (D1) · `docs/data-availability.md` (D2) ·
`docs/data-access.md` (D3) · `docs/data-access-followup.md` (D3 follow-up) ·
`docs/data-acquisition.md` (D4)

---

## D5 Status

**D5 COMPLETE.**

Both D4 raw NetCDF files were opened read-only and their structure recorded. The files were not
modified — SHA-256 checksums are identical to those recorded in D4:

| File | SHA-256 | Bytes |
| --- | --- | --- |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | 1,062,744 |
| `data/raw/currents_incois_io-hoofs_sample.nc` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | 24,300,572 |

**Inspection method:** both files are NetCDF-3 classic (file magic `CDF\x01`, 32-bit offset).
They were parsed with a small read-only pure-Python NetCDF-3 reader (no third-party packages
were installed; the environment has no `netCDF4` / `xarray` / `numpy`). The reader only reads
bytes — it never writes to the files. All integers in these files are big-endian.

Any value ranges below are **structural observations only** (what bytes are in the arrays).
Judging whether those values are scientifically plausible — units sanity, physical range,
missing-value fraction, land masking correctness — is **D6** and was not done here.

---

## 1. Temperature Dataset

### Source

- **Official source:** INCOIS ERDDAP — `https://erddap.incois.gov.in/erddap/`
- **Dataset ID:** `incois_argo_10day_McCreary`
- **Product title (global attr `title` / `summary`):** *"INCOIS ARGO 10 Day data Kessler-McCreary
  Methodology"*
- **`institution`:** `INCOIS`
- **`Conventions`:** `CF-1.6, COARDS, ACDD-1.3`
- **`cdm_data_type`:** `Grid`
- Produced by objective analysis of Argo floats (variable `long_name = "Objectively Analyzed
  Temperature"`). Provenance chain in global `history`: FERRET → `cdo merge` of
  `MackessWithStats_Sal10dys.nc` + `MackessWithStats_Tmp10dys.nc` → ERDDAP griddap subset.

### File

- `data/raw/temperature_salinity_incois_argo_sample.nc`
- NetCDF-3 classic (`CDF\x01`), 1,062,744 bytes.
- **One file contains both temperature and salinity.** Section 2 (Salinity) refers to the same
  physical file.
- ERDDAP subset query recorded in global `history`:
  `T_ANALYZED[(2026-07-10):1:(2026-07-30)][(5.0):1:(2000.0)][(-10):1:(25)][(50):1:(100)]`
  (axis order on the wire: `[time][ZAX][latitude][longitude]`).

### Dimensions

Four dimensions, all fixed-size (none unlimited — the file has no record dimension,
`numrecs = 0`).

| Order in file | Name | Size | Kind | Represents |
| --- | --- | --- | --- | --- |
| 0 | `time` | 3 | fixed | Time |
| 1 | `ZAX` | 24 | fixed | Depth (Z axis) |
| 2 | `latitude` | 36 | fixed | Latitude (Y axis) |
| 3 | `longitude` | 51 | fixed | Longitude (X axis) |

### Coordinates

All four coordinate variables are 1-D, `NC_DOUBLE` (float64), one per dimension, and share the
dimension's name.

| Coord | Dim(s) | N | Min | Max | Spacing | Order | `units` | Key attributes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `time` | `time` | 3 | `1783641600` | `1785369600` | 864000 s = **10 days**, regular | ascending | `seconds since 1970-01-01T00:00:00Z` | `standard_name=time`, `axis=T`, `calendar=standard`, `_CoordinateAxisType=Time`, `long_name=TAXIS`, `time_origin=01-JAN-1970 00:00:00`, `actual_range=[1.78364e9, 1.78537e9]` |
| `ZAX` | `ZAX` | 24 | `5` | `2000` | **irregular** (see §1 Depth) | ascending | `METERS` | `axis=Z`, `point_spacing=uneven`, `actual_range=[5, 2000]`, `ioos_category=Location`. **No `positive` attribute present.** |
| `latitude` | `latitude` | 36 | `-9.5` | `25.5` | `1.0` deg, regular | ascending | `degrees_north` | `standard_name=latitude`, `axis=Y`, `_CoordinateAxisType=Lat`, `long_name=Latitude`, `source_name=YAXIS`, `actual_range=[-9.5, 25.5]` |
| `longitude` | `longitude` | 51 | `50.5` | `100.5` | `1.0` deg, regular | ascending | `degrees_east` | `standard_name=longitude`, `axis=X`, `_CoordinateAxisType=Lon`, `long_name=Longitude`, `source_name=XAXIS`, `actual_range=[50.5, 100.5]` |

No `bounds` variables and no `cell_methods` are present, so the file does not explicitly declare
cell-center vs cell-edge. The global attrs `geospatial_lat_min/max = -9.5 / 25.5` and
`geospatial_lon_min/max = 50.5 / 100.5` match the coordinate end values exactly, and
`geospatial_lat_resolution = geospatial_lon_resolution = 1`.

### Time

- **Variable name:** `time`
- **Number of steps:** 3
- **Values (`units = seconds since 1970-01-01T00:00:00Z`, `calendar = standard`):**

  | Index | Raw value (s) | UTC |
  | --- | --- | --- |
  | 0 | 1783641600 | 2026-07-10 00:00:00Z |
  | 1 | 1784505600 | 2026-07-20 00:00:00Z |
  | 2 | 1785369600 | 2026-07-30 00:00:00Z |

- **Temporal spacing:** exactly 864000 s = 10 days, regular. Matches global
  `time_coverage_start = 2026-07-10T00:00:00Z`, `time_coverage_end = 2026-07-30T00:00:00Z`.
- **Meaning of time:** the file does not carry an explicit attribute labelling these as
  observation / analysis / forecast times. Documented context: `title` / `summary` =
  *"INCOIS ARGO 10 Day data Kessler-McCreary Methodology"* and variable `long_name =
  "Objectively Analyzed Temperature"` → each timestamp is the nominal date of a 10-day
  **objective analysis** of Argo observations. It is not a forecast product. No timezone
  ambiguity — units end in `Z`.

### Depth

- **Coordinate:** `ZAX`, 24 levels, `units = METERS`, ordering **ascending** (shallow → deep),
  `point_spacing = uneven`.
- **Exact level values (m):**
  `5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000,
  1200, 1400, 1600, 1800, 2000`
- **Regular or irregular:** irregular. Successive differences take the values
  `{5, 10, 20, 25, 50, 100, 200}` m — fine near the surface, coarsening with depth.
- **Positive direction:** **not stated in metadata.** `ZAX` has `axis = Z` but no `positive`
  attribute and no `standard_name`. Values increase downward from 5 m to 2000 m and `units` is
  `METERS`; treat "positive = down" as an inference to be confirmed in D6, not a documented fact.

### Spatial Grid

- **Latitude:** 36 values, `-9.5` … `25.5` `degrees_north`, step `1.0`°, regular, ascending.
- **Longitude:** 51 values, `50.5` … `100.5` `degrees_east`, step `1.0`°, regular, ascending.
- **Regular grid:** yes — uniform 1° × 1° lat/lon.
- **Cell centers vs boundaries:** not explicitly stated (no `bounds`). Values sit on the
  half-degree (`x.5`), consistent with 1°-cell centers, but this is not asserted by metadata.
- **Geographic coverage:** north-western / equatorial Indian Ocean — roughly the Arabian Sea,
  Bay of Bengal, and equatorial Indian Ocean between 9.5°S–25.5°N and 50.5°E–100.5°E.

### T_ANALYZED Structure

| Property | Value |
| --- | --- |
| **Dimensions (order in file)** | `time`, `ZAX`, `latitude`, `longitude` |
| **Shape** | `3 × 24 × 36 × 51` |
| **Array ordering** | **time × depth × latitude × longitude** (row-major / C order; longitude varies fastest) |
| **Data type** | `NC_FLOAT` (float32) |
| **`units` (exactly as stored)** | `degs` |
| **`_FillValue`** | `9999.0` |
| **`missing_value`** | `9999.0` |
| **`long_name`** | `Objectively Analyzed Temperature` |
| **`standard_name`** | *(absent)* |
| **`ioos_category`** | `Temperature` |
| **`history`** | `From Tmp.grd` |
| **Structural value read** | of 132,192 cells, 47,702 equal the fill value `9999`; remaining finite values span min `2.54`, max `32.586`. Recorded as structure only — plausibility, land-mask correctness and the non-CF `units = "degs"` string are **D6** questions. |

---

## 2. Salinity Dataset

### Source

Same product and file as temperature — INCOIS ERDDAP `incois_argo_10day_McCreary`,
*"INCOIS ARGO 10 Day data Kessler-McCreary Methodology"*, `institution = INCOIS`,
`Conventions = CF-1.6, COARDS, ACDD-1.3`, `cdm_data_type = Grid`. Variable `long_name =
"Objectively Analyzed Salinity"`.

### File

- `data/raw/temperature_salinity_incois_argo_sample.nc` (identical physical file as §1;
  1,062,744 bytes; NetCDF-3 classic).
- ERDDAP subset query (global `history`):
  `S_ANALYZED[(2026-07-10):1:(2026-07-30)][(5.0):1:(2000.0)][(-10):1:(25)][(50):1:(100)]`.

### Dimensions

Identical to §1 — `time = 3`, `ZAX = 24`, `latitude = 36`, `longitude = 51`, all fixed, none
unlimited. `S_ANALYZED` uses the same four dimensions in the same order.

### Coordinates

Identical to §1 (`time`, `ZAX`, `latitude`, `longitude` — the same coordinate variables serve
both scientific variables). See §1 Coordinates table.

### Time

Identical to §1 Time: `time` variable, 3 steps — 2026-07-10, 2026-07-20, 2026-07-30 (00:00:00Z),
regular 10-day spacing, `calendar = standard`, objective-analysis nominal dates.

### Depth

Identical to §1 Depth: `ZAX`, 24 irregular levels 5 m … 2000 m, ascending, `units = METERS`,
`point_spacing = uneven`, no `positive` attribute.

### Spatial Grid

Identical to §1 Spatial Grid: regular 1° × 1° grid, latitude `-9.5`…`25.5` `degrees_north`,
longitude `50.5`…`100.5` `degrees_east`, both ascending. Same north-western / equatorial Indian
Ocean coverage.

### S_ANALYZED Structure

| Property | Value |
| --- | --- |
| **Dimensions (order in file)** | `time`, `ZAX`, `latitude`, `longitude` |
| **Shape** | `3 × 24 × 36 × 51` |
| **Array ordering** | **time × depth × latitude × longitude** (row-major; longitude fastest) |
| **Data type** | `NC_FLOAT` (float32) |
| **`units` (exactly as stored)** | `PSU` |
| **`_FillValue`** | `9999.0` |
| **`missing_value`** | `9999.0` |
| **`long_name`** | `Objectively Analyzed Salinity` |
| **`standard_name`** | `sea_water_practical_salinity` |
| **`ioos_category`** | `Salinity` |
| **`colorBarMinimum` / `colorBarMaximum`** | `32` / `37` |
| **`history`** | `From Sal.grd` |
| **Structural value read** | of 132,192 cells, 47,644 equal the fill value `9999`; remaining finite values span min `30.93`, max `37.353`. Structure only — scientific range checking is **D6**. |

---

## 3. Surface Current Dataset

### Source

- **Official source:** INCOIS THREDDS — IO-HOOFS (Indian Ocean — High-resolution Operational
  Ocean Forecast System). Original server file `CURRENTS_IO_20260904.nc`
  (path `osf/currents/`), derived from OGCM output `ioout_20260904.nc` (per variable `history`
  attrs: `From /home/osf/OperationalWork/Models/NetCDF/OGCM/IO_HOOFS/ioout_20260904.nc`).
- **Global attrs:** `Conventions = CF-1.6`; `History = "Translated to CF-1.0 Conventions by
  Netcdf-Java CDM (CFGridCoverageWriter). Original Dataset = CURRENTS_IO_20260904.nc;
  Translation Date = 2026-09-05T18:49:55.955Z"`; `history = "PyFerret V7.63 (optimized)
  5-Sep-26"`. No `title` / `institution` / `source` global attribute is present in the file.

### File

- `data/raw/currents_incois_io-hoofs_sample.nc`
- NetCDF-3 classic (`CDF\x01`), 24,300,572 bytes.
- Contains three scientific variables: `U`, `V`, `CURRENT`.
- **Rolling availability:** per D4 notes this exact forecast file leaves the THREDDS catalog
  around 2026-09-11 and cannot be re-downloaded afterward.

### Dimensions

Four dimensions, all fixed-size (none unlimited; `numrecs = 0`). Note the order the dimensions
are **declared** in the file differs from the order they appear in the data variables.

| Order in file (declaration) | Name | Size | Kind | Represents |
| --- | --- | --- | --- | --- |
| 0 | `DEPTH1_1` | 1 | fixed | Depth (Z axis) — single level |
| 1 | `LON` | 601 | fixed | Longitude (X axis) |
| 2 | `TAXIS` | 4 | fixed | Time |
| 3 | `LAT` | 421 | fixed | Latitude (Y axis) |

Data variables use the order **`TAXIS`, `DEPTH1_1`, `LAT`, `LON`** (see §3 U/V/CURRENT).

### Coordinates

Four 1-D coordinate variables, one per dimension, same name as their dimension.

| Coord | Dim(s) | Type | N | Min | Max | Spacing | Order | `units` | Key attributes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TAXIS` | `TAXIS` | float64 | 4 | `48` | `138` | 30 (hours), regular | ascending | `hours since 2026-09-03 01:30` | `standard_name=time`, `axis=T`, `calendar=standard`, `long_name=Time` |
| `DEPTH1_1` | `DEPTH1_1` | float32 | 1 | `0` | `0` | n/a (single value) | n/a | `meters` | `standard_name=depth`, `axis=Z`, `positive=down`, `long_name=Depth`, `point_spacing=uneven` |
| `LAT` | `LAT` | float64 | 421 | `-10.008` | `24.978` | `0.0833`°, regular | ascending | `degrees_north` | `standard_name=latitude`, `axis=Y`, `long_name=latitude`, `point_spacing=even` |
| `LON` | `LON` | float64 | 601 | `49.992` | `99.972` | `0.0833`°, regular | ascending | `degrees_east` | `standard_name=longitude`, `axis=X`, `long_name=longitude`, `point_spacing=even`, `modulo=360` |

**Cell centers vs boundaries:** not declared (no `bounds` variable). The global attrs
`geospatial_lat_min/max = -10.04965 / 25.01965` and `geospatial_lon_min/max = 49.95035 /
100.01365` sit exactly half a grid step (`0.0833 / 2 = 0.04165`) outside the first/last
coordinate values. That half-cell offset is consistent with the coordinate variables being
**cell centers** and the `geospatial_*` bounds being the outer **cell edges**, but the file does
not state this explicitly — treat it as an observation, confirm in D6 if it matters.

### Time

- **Variable name:** `TAXIS`
- **Number of steps:** 4
- **`units`:** `hours since 2026-09-03 01:30` (no timezone / `Z` suffix in the string),
  `calendar = standard`.
- **Values and derived timestamps** (interpreting the units string literally):

  | Index | Raw value (h) | Derived timestamp |
  | --- | --- | --- |
  | 0 | 48 | 2026-09-05 01:30 |
  | 1 | 78 | 2026-09-06 07:30 |
  | 2 | 108 | 2026-09-07 13:30 |
  | 3 | 138 | 2026-09-08 19:30 |

- **Temporal spacing:** exactly 30 hours, regular. (Recorded as-is — the 30-hour step is
  unusual for an operational forecast; that is a D6 observation, not something to "fix" here.)
- **Meaning of time:** the file carries **no attribute** stating whether these are forecast
  initialization times, forecast-valid times, analysis times, or observation times. Documented
  context only: the source is the IO-HOOFS operational **forecast** system and the underlying
  file is dated 2026-09-04 (`ioout_20260904.nc`, `CURRENTS_IO_20260904.nc`). No undocumented
  meaning is asserted here.

### Spatial Grid

- **Latitude (`LAT`):** 421 values, `-10.008` … `24.978` `degrees_north`, step `0.0833`°,
  regular, ascending.
- **Longitude (`LON`):** 601 values, `49.992` … `99.972` `degrees_east`, step `0.0833`°,
  regular, ascending; `modulo = 360`.
- **Regular grid:** yes. Successive spacings are constant at `0.0833`° to within ~1e-14
  (float rounding); span ÷ (N−1) = `0.0833`° on both axes.
- **Native grid resolution (confirmed from the actual file):** the file contains **no explicit
  resolution attribute**. The measured coordinate spacing is exactly **`0.0833`°** on both
  axes, which is approximately **1/12°** (`0.08333…`°). The D4 characterization "≈ 1/12°" is
  therefore consistent with the file; the file stores it as the rounded value `0.0833`.
- **Cell centers vs boundaries:** see §3 Coordinates — half-cell offset suggests centers, not
  stated by metadata.
- **Geographic coverage:** tropical Indian Ocean, ~10°S–25°N and ~50°E–100°E — a slightly wider
  and far denser grid than the temperature/salinity product covering the same region.

### Depth

- **Coordinate:** `DEPTH1_1`, **1 level**, value **`0.0`**, `units = meters`,
  `standard_name = depth`, `positive = down`.
- **Number of depth levels:** 1.
- **Exact depth value:** `0.0` m (surface).
- **Surface-only:** **yes.** Every data variable has `DEPTH1_1` of length 1 at 0 m, and
  `CURRENT.long_name = "Surface Currents (m/s)"`. There are **no subsurface current levels** in
  this file and none are to be invented.
- **Positive direction:** stated — `positive = down` (only meaningful degenerate case here since
  the single level is 0 m).

### U Structure

| Property | Value |
| --- | --- |
| **Dimensions (order in file)** | `TAXIS`, `DEPTH1_1`, `LAT`, `LON` |
| **Shape** | `4 × 1 × 421 × 601` |
| **Array ordering** | **time × depth × latitude × longitude** (row-major; longitude fastest) |
| **Data type** | `NC_DOUBLE` (float64) |
| **`units`** | *(no `units` attribute present)* |
| **`_FillValue`** | `-1e+34` |
| **`missing_value`** | `-1e+34` |
| **`long_name`** | `U Component` |
| **`standard_name`** | `eastward_current` |
| **`coordinates`** | `TAXIS DEPTH1_1 LAT LON` |
| **`history`** | `From /home/osf/OperationalWork/Models/NetCDF/OGCM/IO_HOOFS/ioout_20260904.nc` |
| **Structural value read** | of 1,012,084 cells, 206,392 equal the fill value `-1e+34`; remaining finite values span min `-1.134`, max `1.689`. Structure only — units (absent), sign convention and magnitude are **D6**. |

### V Structure

| Property | Value |
| --- | --- |
| **Dimensions (order in file)** | `TAXIS`, `DEPTH1_1`, `LAT`, `LON` |
| **Shape** | `4 × 1 × 421 × 601` |
| **Array ordering** | **time × depth × latitude × longitude** |
| **Data type** | `NC_DOUBLE` (float64) |
| **`units`** | *(no `units` attribute present)* |
| **`_FillValue`** | `-1e+34` |
| **`missing_value`** | `-1e+34` |
| **`long_name`** | `V Component` |
| **`standard_name`** | `northward_current` |
| **`coordinates`** | `TAXIS DEPTH1_1 LAT LON` |
| **`history`** | `From /home/osf/OperationalWork/Models/NetCDF/OGCM/IO_HOOFS/ioout_20260904.nc` |
| **Structural value read** | of 1,012,084 cells, 205,756 equal the fill value `-1e+34`; remaining finite values span min `-1.331`, max `2.477`. Structure only. |

### CURRENT Structure

| Property | Value |
| --- | --- |
| **Dimensions (order in file)** | `TAXIS`, `DEPTH1_1`, `LAT`, `LON` |
| **Shape** | `4 × 1 × 421 × 601` |
| **Array ordering** | **time × depth × latitude × longitude** |
| **Data type** | `NC_DOUBLE` (float64) |
| **`units`** | *(no `units` attribute present; `long_name` embeds "(m/s)")* |
| **`_FillValue`** | `-1e+34` |
| **`missing_value`** | `-1e+34` |
| **`long_name`** | `Surface Currents (m/s)` |
| **`standard_name`** | *(absent)* |
| **`coordinates`** | `TAXIS DEPTH1_1 LAT LON` |
| **`history`** | `From /home/osf/OperationalWork/Models/NetCDF/OGCM/IO_HOOFS/ioout_20260904.nc` |
| **Structural value read** | of 1,012,084 cells, 207,888 equal the fill value `-1e+34`; remaining finite values span min `0.00038`, max `2.631`. Non-negative, consistent with a speed = √(U²+V²); confirming that relationship is **D6**. |

---

## 4. Dataset Comparison

| Parameter | Source (dataset) | Time dimension | Depth dimension | Latitude dimension | Longitude dimension | Variable structure (dim order) |
| --- | --- | --- | --- | --- | --- | --- |
| **Temperature** (`T_ANALYZED`) | INCOIS ERDDAP `incois_argo_10day_McCreary` | `time` = 3 (10-day step; 2026-07-10/20/30) | `ZAX` = 24 (5–2000 m, irregular, ascending) | `latitude` = 36 (−9.5…25.5°N, 1.0°) | `longitude` = 51 (50.5…100.5°E, 1.0°) | `time × ZAX × latitude × longitude` → `3 × 24 × 36 × 51`, float32 |
| **Salinity** (`S_ANALYZED`) | INCOIS ERDDAP `incois_argo_10day_McCreary` (same file) | `time` = 3 (same as temperature) | `ZAX` = 24 (same as temperature) | `latitude` = 36 (same) | `longitude` = 51 (same) | `time × ZAX × latitude × longitude` → `3 × 24 × 36 × 51`, float32 |
| **Surface currents** (`U`, `V`, `CURRENT`) | INCOIS THREDDS IO-HOOFS (`CURRENTS_IO_20260904.nc`) | `TAXIS` = 4 (30-hour step; 2026-09-05→08) | `DEPTH1_1` = 1 (single level, 0 m, surface-only) | `LAT` = 421 (−10.008…24.978°N, 0.0833°) | `LON` = 601 (49.992…99.972°E, 0.0833°) | `TAXIS × DEPTH1_1 × LAT × LON` → `4 × 1 × 421 × 601`, float64 (each of U, V, CURRENT) |

**Array ordering discovered (identical logical order across both files):**

```
temperature / salinity :  time × depth × latitude × longitude   (4-D)
currents (U, V, CURRENT):  time × depth × latitude × longitude   (4-D, depth length 1)
```

Both files are row-major (C order): the **longitude axis varies fastest**, then latitude, then
depth, then time. The dimension **declaration** order inside the currents file
(`DEPTH1_1, LON, TAXIS, LAT`) is not the same as the **variable** dimension order
(`TAXIS, DEPTH1_1, LAT, LON`); the variable order is the one that matters for reading arrays.

---

## 5. BlueNexus Data Model Implications

Observations only. Nothing here is to be implemented in D5.

- **Temperature and salinity are full 4-D ocean fields:** time × depth × latitude × longitude,
  with 24 real subsurface depth levels (5–2000 m). Any future model must carry a depth axis for
  these parameters.
- **The temperature/salinity depth axis is irregular** (5, 10, 20, 30, 50, 75, 100, … 2000 m).
  The pipeline must store explicit per-level depth values, not a start/step.
- **Currents are surface-only in the acquired data:** a single depth level at 0 m. The data
  model must not assume currents have the same depth structure as temperature/salinity, and
  must not fabricate subsurface current levels.
- **The two products do not share a grid.** Temperature/salinity is a coarse regular 1°×1° grid
  (36×51); currents are a dense ~1/12° grid (421×601). Latitude/longitude counts, spacing, and
  exact extents all differ. Aligning them (regridding/interpolation) is explicitly out of scope
  until later steps.
- **The two products do not share a time axis.** Temperature/salinity: 3 steps, 10-day spacing,
  July 2026, `seconds since 1970`. Currents: 4 steps, 30-hour spacing, September 2026,
  `hours since 2026-09-03 01:30`. The backend must preserve each parameter's own time vector and
  units.
- **Missing data uses different sentinels:** `9999.0` (float32) for temperature/salinity;
  `-1e+34` (float64) for currents; both also set `missing_value`. Ingestion must mask per
  variable, not with one global constant.
- **Units are inconsistent / partly absent:** temperature `units = "degs"` (non-CF string),
  salinity `units = "PSU"`, currents `U`/`V`/`CURRENT` have **no `units` attribute** at all
  (only `long_name` mentions m/s). A future ingestion step will need a unit-normalization
  decision — not made here.
- **Conventions differ:** temp/sal is `CF-1.6, COARDS, ACDD-1.3` with rich ACDD global
  metadata; currents is `CF-1.6` only, with almost no global metadata (no `title`,
  `institution`, or `source`).
- **`standard_name` coverage is partial:** present for `S_ANALYZED`, `U`, `V` and all coordinate
  variables; **absent** for `T_ANALYZED` and `CURRENT`.
- **The backend must eventually preserve parameter-specific dimensionality** rather than forcing
  every parameter into one shared (time, depth, lat, lon) cube.

---

## 6. Chlorophyll Status

**Chlorophyll is not included in the D5 dimensional inspection because no approved acquired
chlorophyll dataset exists yet.**

Chlorophyll remains pending official INCOIS access/licensing clarification (carried over from
D2/D3/D4). It was **not** downloaded during D5, and **no** NASA, NOAA, Copernicus, MOSDAC, or
other external source was substituted. When an approved INCOIS chlorophyll dataset is acquired,
its dimensions will be inspected and added here.

---

## 7. D5 Scope Boundary

> **D5 only inspected dataset dimensions and structure. No application integration, data
> transformation, ingestion, API, or scientific validation was performed.**

Specifically, during D5:

- No frontend, backend, `package.json`, configuration, database, or mock-data files were changed.
- The real datasets were not connected to the BlueNexus website; mock temperature was not
  replaced; salinity, currents, and chlorophyll were not added to the UI.
- No API, ingestion script, or processing/cleaning/regridding/interpolation/unit-conversion/
  normalization was created or run.
- The raw NetCDF files were opened read-only and are byte-for-byte unchanged (SHA-256 verified
  against D4 — see D5 Status above).
- No additional datasets were downloaded; no external datasets were substituted.
- Suspicious-looking values (e.g. `T_ANALYZED units = "degs"`, the 30-hour current time step,
  missing `units` on `U`/`V`/`CURRENT`, large missing-data fractions) were **recorded only**;
  their scientific validation belongs to **D6**.

**Recommended next step: D6 — Verify units, ranges & missing values.**
