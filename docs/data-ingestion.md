# BlueNexus D7 Data Ingestion

**Data Track step:** D7 — Build the Data Ingestion Layer
**Type:** Read-only ingestion module + tests + documentation. No cleaning,
transformation, regridding, interpolation, resampling, merging, unit conversion,
backend/API, frontend integration, or mock-data replacement.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** `docs/data-sources.md` (D1) · `docs/data-availability.md` (D2) ·
`docs/data-access.md` (D3) · `docs/data-access-followup.md` (D3 follow-up) ·
`docs/data-acquisition.md` (D4) · `docs/data-dimensions.md` (D5) · `docs/data-validation.md` (D6)

---

## 1. D7 Status

**D7 COMPLETE.**

A small, reusable, **read-only** ingestion layer now opens the two real INCOIS
NetCDF files acquired in D4 and returns structured, immutable Python objects for
the downstream pipeline. 29 tests pass. Both raw files are byte-for-byte
unchanged (SHA-256 verified before and after — see §11).

> **One notable finding during D7** (does not affect data validity, handled by
> the layer, reported here and back-annotated into D6): the IO-HOOFS currents
> file stores its missing cells as **IEEE NaN**, not as the `-1e34` value that
> its `_FillValue` / `missing_value` *attributes* declare. See §8.

---

## 2. Purpose

The ingestion layer is the first stage of the real-data pipeline:

```
INCOIS RAW DATA  ->  [D7 INGESTION]  ->  D8 processing/cleaning  ->  D9 BlueNexus format
                                                                      ->  D10 backend/API  ->  D11 frontend
```

It does exactly one job: **read the raw files reliably and expose their contents
in a structured form**, so D8 never has to touch NetCDF byte layout again. It:

- locates the known raw files (no downloading, no network),
- opens them read-only,
- reads dimensions, coordinate variables and scientific variables,
- preserves the original dimension order and the 24 irregular depth levels,
- keeps `U`, `V`, `CURRENT` as three separate variables (`CURRENT` is **never**
  recomputed from `U`/`V`),
- recognises fill/missing values **without applying them**,
- exposes raw *and* normalized unit metadata (working representation only),
- runs basic schema/ingestion checks.

It explicitly does **not** clean, mask, regrid, interpolate, resample, merge,
smooth, normalize or unit-convert anything. Those are D8/D9.

---

## 3. Input datasets

| | Temperature + Salinity | Surface currents |
| --- | --- | --- |
| File | `data/raw/temperature_salinity_incois_argo_sample.nc` | `data/raw/currents_incois_io-hoofs_sample.nc` |
| Source | INCOIS ERDDAP (`griddap`) | INCOIS THREDDS — NetCDF Subset Service |
| Dataset / product | `incois_argo_10day_McCreary` — *"INCOIS ARGO 10 Day data Kessler-McCreary Methodology"* | IO-HOOFS operational surface-current forecast (`CURRENTS_IO_20260904.nc`) |
| Format | NetCDF-3 classic (`CDF\x01`, 32-bit offset) | NetCDF-3 classic (`CDF\x01`, 32-bit offset) |
| Variables ingested | `T_ANALYZED`, `S_ANALYZED` | `U`, `V`, `CURRENT` |
| Product type (D6) | analysis | forecast |
| Registry name | `incois_argo_10day_analysis` | `incois_io_hoofs_surface_currents` |

Chlorophyll is **not** ingested — no approved acquired INCOIS chlorophyll
dataset exists (see §11 of `docs/data-validation.md`). The registry is designed
so a future approved file is added as one `DatasetSpec` entry; no adapter code
was written for it.

---

## 4. Architecture

### 4.1 Where it lives

The repository's only Python environment is the FastAPI backend
(`backend/.venv`, Python 3.14). The ingestion code therefore lives under the
backend as a self-contained package, kept well away from `backend/main.py`
(which is untouched — no API wiring until D10):

```
backend/
  main.py                       (UNCHANGED — FastAPI health stub)
  requirements.txt              (UNCHANGED — no new dependency added)
  app/
    __init__.py
    data/
      __init__.py
      ingestion/
        __init__.py             public API surface (re-exports)
        __main__.py             `python -m app.data.ingestion` -> read-only summary
        netcdf3.py              dependency-free NetCDF-3 classic reader
        models.py               dataclasses: IngestedDataset, DataVariable, ...
        registry.py             DatasetSpec for each known INCOIS file
        netcdf_ingestor.py      high-level ingest_* functions
        validation.py           basic schema / ingestion checks
  tests/
    __init__.py
    test_ingestion.py           29 stdlib unittest cases against the D4 files
```

### 4.2 Dependencies — **none added**

D4/D5/D6 established the backend venv has no `numpy` / `netCDF4` / `xarray` /
`scipy`. D7 **adds nothing**:

- **NetCDF reading:** `netcdf3.py` is a ~330-line pure-Python reader for the
  **NetCDF-3 classic** format. Justification: every real INCOIS file acquired in
  D4 is `CDF\x01` (confirmed in D5, and both INCOIS services return classic
  NetCDF-3 by default); the format is small and fully specified; and `netCDF4`
  would drag in the HDF5 / netcdf-c C toolchain plus wheels that do not yet
  exist for Python 3.14. The reader raises `UnsupportedNetCDFError` on
  NetCDF-4/HDF5 input, so if INCOIS ever serves HDF5-backed files a real library
  can be slotted in *then*, behind the same interface.
- **Array storage:** the stdlib `array` module (`array('f')` / `array('d')`) —
  compact typed buffers, no dependency. D8 can decide whether to bring in
  `numpy`.
- **Tests:** stdlib `unittest` (the project had no test framework).

### 4.3 How a call flows

```
ingest_temperature_salinity()
  -> registry.TEMPERATURE_SALINITY (DatasetSpec: path, expected schema, unit map)
  -> validation.check_file_present()          # exists / non-empty / is NetCDF-3
  -> netcdf3.NetCDF3File(path).open()          # read whole file, parse header
       .read_values(name)                      # raw big-endian bytes -> native array
  -> build DimensionInfo / CoordinateVariable / DataVariable  (models.py)
  -> observe missing-value representation (NaN vs sentinel) — record, don't apply
  -> validation.validate_or_raise()            # schema checks; raise on ERROR
  -> IngestedDataset
```

`ingest_dataset(spec)` is the generic entry point; `ingest_temperature_salinity`,
`ingest_surface_currents` and `ingest_all` are thin wrappers.

---

## 5. Data model

All dataclasses are `frozen=True`. Scientific buffers are the untouched values
from the file; callers must treat `.values` as read-only (call `.copy()` before
mutating in D8).

```
IngestedDataset
  name              "incois_argo_10day_analysis" | "incois_io_hoofs_surface_currents"
  file_path         Path to the raw file
  file_format       "NetCDF-3 classic (CDF\x01, 32-bit offset)"
  dimensions        tuple[DimensionInfo]     (file declaration order preserved)
  coordinates       {name: CoordinateVariable}
  variables         {name: DataVariable}
  time/depth/latitude/longitude   -> the CoordinateVariable for that role (or None)
  metadata          DatasetMetadata

DimensionInfo        name, size, is_unlimited, axis_role
                     axis_role in {"time","depth","latitude","longitude",""}

CoordinateVariable   name, dimensions, dtype, axis_role,
                     units: UnitInfo, standard_name, long_name, axis, calendar,
                     shape, values (array.array, raw), attributes
                     + count, minimum, maximum, is_monotonic_ascending/descending,
                       step_if_regular(), as_list()

DataVariable         name, dimensions (logical order), dtype,
                     units: UnitInfo, standard_name, long_name,
                     fill_value, missing_value_attr, shape,
                     values (array.array, RAW — fill values intact), attributes,
                     observed_nan_count, observed_sentinel_count
                     + size, ndim, missing_representation,
                       is_missing(v), missing_mask(), missing_count(),
                       valid_count(), iter_valid(), valid_range()

UnitInfo             raw_units          (exactly as stored, or None)
                     normalized_units   (D6 interpretation, metadata only)
                     units_source       (provenance of the interpretation)

DatasetMetadata      source_name, source_url, dataset_id, product_title,
                     product_type ("analysis" | "forecast"),
                     temporal_semantics (human sentence),
                     conventions, file_sha256, global_attributes, ingest_notes
```

`IngestedDataset.summary()` prints a one-screen human overview (see the output of
`python -m app.data.ingestion`).

---

## 6. Variables

Raw values are preserved exactly. `valid_range` below is a **structural
convenience** computed by skipping missing cells — it is not a re-run of the D6
scientific validation, and it matches D6.

| Variable | Dataset | Dimensions (logical order) | Shape | dtype | raw units | normalized units | fill (declared) | missing repr. | missing / total | valid range |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `T_ANALYZED` | temp/sal | `time × ZAX × latitude × longitude` | `3×24×36×51` | float32 | `"degs"` | `degC` | `9999.0` | sentinel | 47 702 / 132 192 | 2.540 … 32.586 |
| `S_ANALYZED` | temp/sal | `time × ZAX × latitude × longitude` | `3×24×36×51` | float32 | `"PSU"` | `PSU` | `9999.0` | sentinel | 47 644 / 132 192 | 30.930 … 37.353 |
| `U` | currents | `TAXIS × DEPTH1_1 × LAT × LON` | `4×1×421×601` | float64 | *(none)* | `m s-1` | `-1e34` | **NaN** | 206 392 / 1 012 084 | −1.13419 … +1.68921 |
| `V` | currents | `TAXIS × DEPTH1_1 × LAT × LON` | `4×1×421×601` | float64 | *(none)* | `m s-1` | `-1e34` | **NaN** | 205 756 / 1 012 084 | −1.33055 … +2.47688 |
| `CURRENT` | currents | `TAXIS × DEPTH1_1 × LAT × LON` | `4×1×421×601` | float64 | *(none)* | `m s-1` | `-1e34` | **NaN** | 207 888 / 1 012 084 | 0.00038 … 2.63063 |

- **`T_ANALYZED`** — `long_name = "Objectively Analyzed Temperature"`, no
  `standard_name` in the file. `normalized_units = "degC"` per D6.
- **`S_ANALYZED`** — `long_name = "Objectively Analyzed Salinity"`,
  `standard_name = "sea_water_practical_salinity"`. `normalized_units = "PSU"`.
- **`U` / `V`** — `standard_name = eastward_current` / `northward_current`,
  `long_name = "U Component"` / `"V Component"`. No `units` attribute anywhere
  (confirmed in D6 against the INCOIS THREDDS DAS).
- **`CURRENT`** — `long_name = "Surface Currents (m/s)"`, no `standard_name`.
  **Read straight from the file; not recomputed.** D6 verified
  `CURRENT ≡ √(U²+V²)`; D7 only re-confirms the identity as a read-only
  spot-check in the tests.

---

## 7. Dimensions

Both files' dimension **declaration order** is preserved on `IngestedDataset.dimensions`,
and each variable keeps its own **logical** dimension order.

**Temperature / Salinity** — 4 fixed dimensions, none unlimited:

| Order | Name | Size | Role |
| --- | --- | --- | --- |
| 0 | `time` | 3 | time |
| 1 | `ZAX` | 24 | depth (irregular: 5, 10, 20, 30, 50, 75, … 2000 m) |
| 2 | `latitude` | 36 | latitude (regular 1.0°, −9.5 … 25.5 °N) |
| 3 | `longitude` | 51 | longitude (regular 1.0°, 50.5 … 100.5 °E) |

`T_ANALYZED` / `S_ANALYZED` logical order: `time × ZAX × latitude × longitude`.

**Surface currents** — 4 fixed dimensions, none unlimited. Declaration order in
the file differs from the variable order:

| Declaration order | Name | Size | Role |
| --- | --- | --- | --- |
| 0 | `DEPTH1_1` | 1 | depth (single level, 0.0 m — surface only) |
| 1 | `LON` | 601 | longitude (regular 0.0833°, 49.992 … 99.972 °E) |
| 2 | `TAXIS` | 4 | time (30-h spacing; every 10th step of a 3-hourly forecast) |
| 3 | `LAT` | 421 | latitude (regular 0.0833°, −10.008 … 24.978 °N) |

`U` / `V` / `CURRENT` logical order: `TAXIS × DEPTH1_1 × LAT × LON`.

The ingestion layer's schema check asserts: currents depth has exactly **1**
level at 0.0 m; temp/salinity depth has **24** levels and is **not** evenly
spaced (`step_if_regular()` returns `None`, as it must — D7 never assumes even
depth).

---

## 8. Missing data

### 8.1 How the layer exposes it (without changing anything)

- `DataVariable.fill_value` = the **declared** `_FillValue` (falling back to
  `missing_value`; D6 confirmed the two agree).
- `DataVariable.values` always holds the **raw** buffer — fill entries are left
  exactly as the file has them. The original data is fully recoverable.
- `missing_mask()` returns a **fresh** `array('B')` (1 = missing) each call; it
  is derived, never stored back.
- `is_missing(v)`, `missing_count()`, `valid_count()`, `iter_valid()`,
  `valid_range()` all treat **both** IEEE NaN **and** an exact `== fill_value`
  match as missing.
- Nothing is interpolated, deleted, or replaced. That is D8's job.

### 8.2 D7 finding — currents missing cells are NaN, not `-1e34`

D6's documentation stated the currents missing cells "equal the fill value
`-1e+34`". **D7's byte-level read shows that is not how the file is encoded:**

| Fact | Evidence |
| --- | --- |
| `U` / `V` / `CURRENT` attributes declare `_FillValue = missing_value = -1e+34` | attribute table, matches the INCOIS THREDDS DAS |
| The data buffers contain **zero** cells equal to `-1e34` | `observed_sentinel_count == 0` for all three |
| The data buffers contain **206 392 / 205 756 / 207 888** IEEE NaN cells (`0x7ff8000000000000`) | `observed_nan_count`; these exactly equal D6's "missing/fill" counts |
| Temperature / salinity are unaffected — they store literal `9999.0` (0 NaN) | `observed_nan_count == 0`, `observed_sentinel_count == 47 702 / 47 644` |

**Cause:** the D4 currents file was produced by the INCOIS THREDDS NetCDF Subset
Service, whose `History` attribute records *"Translated to CF-1.0 Conventions by
Netcdf-Java CDM (CFGridCoverageWriter)"*. The netCDF-Java CDM writer emits
missing floating-point values as NaN while carrying the source product's
original `_FillValue` / `missing_value` attributes through unchanged.

**Impact:** none on data validity. Missing cells are unambiguous (NaN is, if
anything, safer to detect than a sentinel), the counts are identical to D6, and
D6's valid-range statistics already excluded them. The only inaccuracy was in
D6's *prose*, which is corrected by an addendum in `docs/data-validation.md`
(§15). The ingestion layer records the observed representation per variable
(`DataVariable.missing_representation` → `"nan"` / `"sentinel"` / `"nan+sentinel"`)
and its schema report surfaces it as an `INFO` line.

**For D8:** treat NaN as the missing marker for the currents dataset and the
`9999.0` sentinel as the missing marker for temperature/salinity — or, more
simply, use the `missing_mask()` / `iter_valid()` helpers, which already handle
both.

---

## 9. Units

Unit handling is **metadata-only**. The NetCDF files are not modified. Each
variable carries a `UnitInfo(raw_units, normalized_units, units_source)`.

| Variable | `raw_units` (exactly as stored) | `normalized_units` | `units_source` (abridged) |
| --- | --- | --- | --- |
| `T_ANALYZED` | `"degs"` | `"degC"` | D6: `"degs"` is a FERRET/COARDS legacy label; value structure + product context confirm degrees Celsius |
| `S_ANALYZED` | `"PSU"` | `"PSU"` | D6: `standard_name sea_water_practical_salinity` — kept as-is |
| `U` | `null` (no attribute) | `"m s-1"` | D6 authoritative INCOIS validation (see below) |
| `V` | `null` (no attribute) | `"m s-1"` | D6 authoritative INCOIS validation |
| `CURRENT` | `null` (no attribute; `long_name` embeds "m/s") | `"m s-1"` | D6 authoritative INCOIS validation |

The currents `units_source` string records the full D6 evidence chain:
`CURRENT.long_name = "Surface Currents (m/s)"` (also in the INCOIS THREDDS DAS);
`CURRENT ≡ √(U²+V²)` to machine precision so `U`/`V` share `CURRENT`'s unit; and
INCOIS Ocean State Forecast documentation stating current speed is in metres per
second. `raw_units` is `null` for all three because the raw file genuinely has
no `units` attribute on them — `"m s-1"` is a working-representation annotation
only.

Coordinate variables expose their raw `units` string unchanged
(`seconds since 1970-01-01T00:00:00Z`, `METERS`, `degrees_north`,
`degrees_east`, `hours since 2026-09-03 01:30`, `meters`).

---

## 10. Tests

Framework: stdlib `unittest`. Run from `backend/`:

```
./.venv/Scripts/python.exe -m unittest discover -s tests -v
```

**29 tests, all passing** (0.9 s). They run against the real D4 raw files and
never write to them.

| # | Requirement | Test(s) | Result |
| --- | --- | --- | --- |
| 1 | Temperature/salinity file loads | `TemperatureSalinityIngest.test_file_loads` | ✅ |
| 2 | Temperature variable loads | `test_temperature_variable_loads` | ✅ |
| 3 | Salinity variable loads | `test_salinity_variable_loads` | ✅ |
| 4 | Current file loads | `SurfaceCurrentsIngest.test_file_loads` | ✅ |
| 5 | U / V / CURRENT load | `test_u_v_current_load_as_separate_variables` | ✅ |
| 6 | Dimension order preserved | `test_dimension_order_preserved`, `test_dimension_order_preserved_in_variables` | ✅ |
| 7 | Coordinate arrays load | `test_coordinate_arrays_load` (both datasets) | ✅ |
| 8 | Fill values recognised | `test_fill_values_recognised` (both), `test_missing_cells_stored_as_nan_not_sentinel` | ✅ |
| 9 | Unit metadata exposed correctly | `test_unit_metadata_raw_and_normalized`, `test_unit_metadata_normalized_only` | ✅ |
| 10 | Raw files unchanged | `RawFileIntegrity.test_hashes_match_d4`, `RawFilesUnchangedAtEnd.test_zzz_hashes_still_match` | ✅ |
| — | Depth: 24 irregular levels, not assumed even | `test_depth_levels_irregular_and_preserved` | ✅ |
| — | Currents surface-only (1 level @ 0 m) | `test_surface_only_single_depth_level` | ✅ |
| — | CURRENT not recomputed from U/V | `test_current_is_not_recomputed` | ✅ |
| — | Missing values left in the raw buffer | `test_missing_values_not_applied_to_buffer` | ✅ |
| — | Schema reports pass with no ERRORs | `test_schema_report_passes` (both) | ✅ |
| — | Reader rejects NetCDF-4/HDF5 | `ReaderBehaviour.test_hdf5_rejected` | ✅ |
| — | Reader returns native-endian sane values | `test_values_are_native_endian_and_sane` | ✅ |
| — | Missing-value representation observed (NaN vs sentinel) | `test_missing_cells_stored_as_nan_not_sentinel`, `test_fill_values_recognised` | ✅ |
| — | Product type / temporal semantics recorded | `test_metadata_product_type`, `test_metadata_product_type_forecast` | ✅ |

Raw SHA-256 hashes: identical before the suite, after the suite, and after the
`python -m app.data.ingestion` summary run.

---

## 11. Raw-file integrity

| File | SHA-256 (before D7) | SHA-256 (after D7 + tests) | Match |
| --- | --- | --- | --- |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | ✅ |
| `data/raw/currents_incois_io-hoofs_sample.nc` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | ✅ |

Both match the D4 acquisition hashes. Every file open in the ingestion layer is
`open(path, "rb")`; nothing opens these files for writing.

---

## 12. Scope boundary

> **D7 created the read-only ingestion layer. No scientific cleaning,
> transformation, regridding, interpolation, backend/API integration, frontend
> integration, or mock-data replacement was performed.**

Specifically, D7 did **not**:

- connect data to the frontend, replace mock temperature, or add salinity /
  current / chlorophyll visualization;
- modify the 3D ocean visualization, the variable selector, routes, or frontend
  API calls;
- build an API, a backend service, or database tables; touch `backend/main.py`
  or `backend/requirements.txt`; introduce Supabase;
- regrid, interpolate, clean, normalize, resample, smooth, merge, or
  unit-convert any scientific value;
- create a BlueNexus visualization format or implement automatic updating;
- download new datasets or substitute external data;
- add a chlorophyll adapter (no approved dataset exists);
- install any package.

The existing BlueNexus website behaves exactly as before — no frontend file was
touched.

---

## 13. Next step

**D8 — Process & clean the data.** D8 will consume `IngestedDataset` objects,
apply the missing-value masks, and make the cleaning/normalization decisions
deliberately deferred here (fill handling, unit normalization policy,
parameter-specific dimensionality). D7 hands D8 a reliable, unmodified,
structured view of the raw INCOIS data and nothing more.
