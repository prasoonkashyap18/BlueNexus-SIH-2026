# BlueNexus D8 Data Processing

**Data Track step:** D8 — Process & Clean the Data
**Type:** Canonical cleaning layer + diagnostics + tests + documentation. No
regridding, resampling, smoothing, interpolation, extrapolation, grid merging,
clipping, missing-value replacement, BlueNexus format, backend/API, frontend
change, or mock-data replacement.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** D1–D6 docs · `docs/data-ingestion.md` (D7)

---

## 1. Purpose

D8 turns the D7 read-only ingestion objects into **canonical cleaned datasets**
that D9 can convert to the BlueNexus format:

```
INCOIS RAW NetCDF  ->  D7 ingestion  ->  [ D8 clean / canonical ]  ->  D9 BlueNexus format
                                                                        ->  D10 backend/API  ->  D11 frontend
```

"Cleaning" in D8 means exactly three safe operations:

1. **Canonicalise missing data** — every missing cell (IEEE NaN, declared
   `_FillValue`, or declared `missing_value`) becomes one marker: IEEE **NaN**,
   with a matching `VALID`/`MISSING` quality byte.
2. **Canonicalise the numeric representation** — all scientific fields are
   widened to float64. For the float32 temperature/salinity fields this is an
   exact, lossless widening; the currents fields are already float64.
3. **Normalise unit *metadata*** — attach canonical unit labels
   (`degC` / `PSU` / `m s-1`) while keeping the raw source unit string as
   provenance. **No numeric unit conversion is performed** (none is needed).

Everything else is preserved verbatim.

> **D8 does not regrid, interpolate, smooth, resample, or replace missing ocean
> values.**

> **Chlorophyll remains pending official INCOIS access clarification and is not
> substituted here** (no NASA / NOAA / Copernicus / MOSDAC or other source).

---

## 2. Input datasets

| | Temperature + Salinity | Surface currents |
| --- | --- | --- |
| Raw file | `data/raw/temperature_salinity_incois_argo_sample.nc` | `data/raw/currents_incois_io-hoofs_sample.nc` |
| SHA-256 | `17f5caa8…bb6c9e6d` | `40d8cdce…c0d5ba7d` |
| Source | INCOIS ERDDAP `incois_argo_10day_McCreary` | INCOIS THREDDS IO-HOOFS (`CURRENTS_IO_20260904.nc`) |
| Product type (D6) | **analysis** (10-day Argo objective analysis) | **forecast** (IO-HOOFS operational, ROMS-based) |
| Variables processed | `T_ANALYZED`, `S_ANALYZED` | `U`, `V`, `CURRENT` |
| Consumed via | `app.data.ingestion.ingest_temperature_salinity()` | `app.data.ingestion.ingest_surface_currents()` |

D8 does **not** open the NetCDF files itself — it reuses the D7 ingestion layer
so no parsing logic is duplicated.

---

## 3. Architecture / processing flow

```
backend/app/data/
  ingestion/            (D7 — unchanged)
  processing/           (D8 — new)
    __init__.py         public API
    __main__.py         `python -m app.data.processing` -> summary + manifests
    ranges.py           D6 reference ranges (diagnostic context only)
    models.py           CleanedDataset, CleanedVariable, QualityFlag, ...
    missing.py          canonical missing-value normalisation
    diagnostics.py      range + vector-consistency diagnostics (report only)
    cleaner.py          process_temperature_salinity / process_surface_currents / process_dataset
backend/tests/
  test_processing.py    30 stdlib unittest cases (D7's 29 still pass too)
data/processed/
  README.md             (tracked)
  *.d8.json             generated manifests (git-ignored)
```

**No third-party dependency added.** Same stack as D7: pure Python, stdlib
`array` for buffers, stdlib `unittest` for tests. `backend/main.py` and
`backend/requirements.txt` are untouched.

Flow for one dataset (`cleaner.process_dataset`):

1. `app.data.ingestion.ingest_dataset(spec)` → D7 `IngestedDataset` (raw values,
   fill markers intact, SHA-256 recorded).
2. Copy every coordinate **verbatim** (`missing.py` is not involved — coordinates
   have no missing cells) into `CleanedCoordinate` (same typecode, same values).
3. For each scientific variable, `missing.canonicalise()`:
   - walk the raw buffer (read-only),
   - NaN / `== _FillValue` / `== missing_value` → canonical NaN + quality
     `MISSING`,
   - otherwise → `float(raw)` (exact widen) + quality `VALID`,
   - record a `MissingValuePolicy` audit object.
4. Attach a `RangeDiagnostic` (valid min/max vs the D6 reference range).
5. For currents, attach a `VectorConsistencyDiagnostic`
   (`CURRENT` vs `sqrt(U²+V²)` on jointly-valid cells).
6. Build a `ProvenanceRecord` and an ordered `processing_log`.
7. Return a `CleanedDataset`.

---

## 4. Data model (`app.data.processing.models`)

| Type | Role |
| --- | --- |
| `CleanedDataset` | name, product type, dimensions (unchanged from D7), `coordinates`, `variables`, `provenance`, `processing_log`, `vector_consistency`, `time/depth/latitude/longitude` role shortcuts, `.manifest()`, `.summary()` |
| `CleanedVariable` | `dimensions`/`shape` (unchanged), `source_dtype` → `canonical_dtype` (`float64`), `units: CanonicalUnitInfo`, `missing_policy`, `valid_count`, `missing_count`, `values` (float64, missing = NaN), `quality` (`array('B')`: 0/1), `source_values` (**reference** to the untouched D7 buffer), `range_diagnostic` |
| `CleanedCoordinate` | exact element-wise copy of the D7 coordinate (`values`, `units`, `calendar`, `standard_name`, `long_name`, `axis`, attributes) |
| `QualityFlag` | `VALID = 0`, `MISSING = 1` — nothing else |
| `CanonicalUnitInfo` | `raw_units` (provenance), `canonical_units`, `units_source`, `converted` (always `False` in D8) |
| `MissingValuePolicy` | what was recognised as missing + counts + explicit `replacement_with_zero=False`, `interpolation=False`, `fill_forward_or_backward=False` |
| `RangeDiagnostic` | valid min/max, D6 reference min/max, counts below/above (with tolerance) — **report only** |
| `VectorConsistencyDiagnostic` | jointly-valid cell count, max/mean \|CURRENT − √(U²+V²)\|, `source_current_is_authoritative=True`, `recomputed_field_created=False` |
| `ProvenanceRecord` | source, dataset id, raw file path + SHA-256 + bytes + format, conventions, variables processed, original vs normalized units, dimensions, coordinate roles, time units/calendar/coverage, depth levels, `processed_at_utc` |

`CANONICAL_MISSING = float("nan")`.

---

## 5. Missing-value policy

**Recognised as missing** (per variable, from D6/D7 metadata):

| Variable | IEEE NaN | `_FillValue` | `missing_value` | Source encoding actually seen |
| --- | --- | --- | --- | --- |
| `T_ANALYZED` | yes | `9999.0` | `9999.0` | sentinel `9999.0` (47 702 cells) |
| `S_ANALYZED` | yes | `9999.0` | `9999.0` | sentinel `9999.0` (47 644 cells) |
| `U` | yes | `-1e34` | `-1e34` | **NaN** (206 392 cells) |
| `V` | yes | `-1e34` | `-1e34` | **NaN** (205 756 cells) |
| `CURRENT` | yes | `-1e34` | `-1e34` | **NaN** (207 888 cells) |

(The currents file declares `-1e34` but stores NaN — the D7 finding. D8
recognises **both** forms regardless, so it is robust to either encoding.)

**Outcome:** every recognised missing cell → canonical **NaN** in
`CleanedVariable.values`, and `quality[i] = MISSING (1)`. Valid cells →
`quality[i] = VALID (0)`.

**Explicitly NOT done:**

- no missing cell set to `0` (or any other number),
- no linear/spline/nearest interpolation,
- no forward-fill, no backward-fill,
- no gap filling of any kind.

`valid` vs `missing` is preserved two ways at once — the NaN in `values` and the
byte in `quality` — so downstream code can use whichever is convenient.

**Raw immutability:** `missing.canonicalise()` only *reads*
`DataVariable.values`. `CleanedVariable.source_values` is that same D7 `array`
object by reference (not copied then mutated), so the original values —
`9999.0` / NaN markers included — remain fully recoverable. A test asserts this
(`test_source_buffer_reference_is_untouched`).

---

## 6. Unit normalization

Metadata only — **no numeric conversion**, and the raw NetCDF files are not
rewritten.

| Variable | `raw_units` (kept as provenance) | `canonical_units` | `converted` |
| --- | --- | --- | --- |
| `T_ANALYZED` | `"degs"` | `degC` | `False` |
| `S_ANALYZED` | `"PSU"` | `PSU` | `False` |
| `U` | `null` (no attribute in raw file) | `m s-1` | `False` |
| `V` | `null` | `m s-1` | `False` |
| `CURRENT` | `null` (`long_name` embeds "m/s") | `m s-1` | `False` |

`CanonicalUnitInfo.units_source` carries the D6/D7 rationale (e.g. for the
currents: `CURRENT.long_name = "Surface Currents (m/s)"`, the exact
`CURRENT ≡ √(U²+V²)` identity, and INCOIS Ocean State Forecast documentation).
The temperature values (2.54–32.586) are already Celsius, so the `degs → degC`
step is a label change only; nothing is scaled or offset.

---

## 7. Quality flags

A compact per-cell mask, `CleanedVariable.quality` (`array('B')`):

| Value | Name | Meaning |
| --- | --- | --- |
| `0` | `VALID` | a real scientific value is present in `values[i]` |
| `1` | `MISSING` | `values[i]` is canonical NaN (land / no-data / fill) |

That is the entire vocabulary. D8 does **not** invent grades such as
"excellent" / "good" / "bad" — the source metadata does not support them, and
D8 quality is about *data availability*, not oceanographic interpretation.

Per-variable counts (cleaned):

| Variable | total cells | `VALID` | `MISSING` | missing fraction |
| --- | --- | --- | --- | --- |
| `T_ANALYZED` | 132 192 | 84 490 | 47 702 | 36.09 % |
| `S_ANALYZED` | 132 192 | 84 548 | 47 644 | 36.04 % |
| `U` | 1 012 084 | 805 692 | 206 392 | 20.39 % |
| `V` | 1 012 084 | 806 328 | 205 756 | 20.33 % |
| `CURRENT` | 1 012 084 | 804 196 | 207 888 | 20.54 % |

(Identical to the D6/D7 counts — nothing was added or removed.)

---

## 8. Coordinate preservation

Every coordinate is an **exact element-wise copy** of the D7 array (same
`typecode`, same values). No synthetic grid is generated.

**Temperature / Salinity:**

| Axis | n | Range | Notes |
| --- | --- | --- | --- |
| `time` | 3 | 2026-07-10 / -20 / -30 (00:00Z) | `seconds since 1970-01-01T00:00:00Z`, calendar `standard`, 10-day step |
| `ZAX` (depth) | 24 | 5 m … 2000 m | **irregular** — copied verbatim, not resampled to an even grid |
| `latitude` | 36 | −9.5 … 25.5 °N | regular 1.0° |
| `longitude` | 51 | 50.5 … 100.5 °E | regular 1.0° |

**Surface currents:**

| Axis | n | Range | Notes |
| --- | --- | --- | --- |
| `TAXIS` (time) | 4 | 48, 78, 108, 138 h since 2026-09-03 01:30 | calendar `standard`, 30-h spacing (every 10th step of a 3-hourly forecast) |
| `DEPTH1_1` (depth) | 1 | 0.0 m | **surface only** — preserved, no subsurface levels invented |
| `LAT` | 421 | −10.008 … 24.978 °N | stored spacing **exactly 0.0833°** |
| `LON` | 601 | 49.992 … 99.972 °E | stored spacing **exactly 0.0833°** |

**The currents grid is NOT regenerated as an exact `1/12°` grid.** A test
(`test_11c_grid_not_regenerated_as_exact_twelfth_degree`) asserts the cleaned
spacing is `0.0833` and is *not* `1/12 = 0.08333…`.

---

## 9. Time handling

The two temporal systems are kept **separate** and are **not** merged or
reconciled:

| | Temperature / Salinity | Surface currents |
| --- | --- | --- |
| units (verbatim) | `seconds since 1970-01-01T00:00:00Z` | `hours since 2026-09-03 01:30` |
| calendar | `standard` | `standard` |
| steps | 3 (10-day) | 4 (30-hour) |
| classification | **ANALYSIS** | **FORECAST** |

`ProvenanceRecord.product_type` and `.temporal_semantics` carry the D6
classification. D8 does not pretend the two datasets share timestamps.

---

## 10. Range diagnostics

For each variable D8 attaches a `RangeDiagnostic` comparing the cleaned valid
values to the D6 reference range (`docs/data-validation.md` §8), with a small
relative tolerance (`1e-3 × span`). **It reports; it never clips or discards.**

| Variable | Cleaned valid range | D6 reference | Outside reference |
| --- | --- | --- | --- |
| `T_ANALYZED` | 2.540 … 32.586 °C | 2.540 … 32.586 | 0 |
| `S_ANALYZED` | 30.930 … 37.353 PSU | 30.930 … 37.353 | 0 |
| `U` | −1.13419 … +1.68921 m/s | −1.13419 … +1.68921 | 0 |
| `V` | −1.33055 … +2.47688 m/s | −1.33055 … +2.47688 | 0 |
| `CURRENT` | 0.00038 … 2.63063 m/s | 0.00038 … 2.63063 | 0 |

The cleaned valid ranges equal the D6 ranges exactly (same underlying data), so
nothing sits outside the reference. D6 already judged the extremes (Bay of
Bengal freshening, Persian Gulf Water salinity max, Somali Current speeds)
scientifically plausible — D8 does not second-guess them.

---

## 11. Current-vector validation

`VectorConsistencyDiagnostic` re-confirms the D6 identity on the **cleaned**
data, over cells where `U`, `V` and `CURRENT` are all `VALID`:

| Metric | Value |
| --- | --- |
| jointly-valid cells | 804 196 |
| max \|CURRENT − √(U²+V²)\| | **4.44 × 10⁻¹⁶** |
| mean \|CURRENT − √(U²+V²)\| | 1.44 × 10⁻¹⁷ |
| cells within 1 × 10⁻⁶ | 804 196 / 804 196 (100 %) |
| `source_current_is_authoritative` | `True` |
| `recomputed_field_created` | `False` |

**The source `CURRENT` array is authoritative and is never replaced by a
computed `sqrt(U²+V²)` field.** `U`, `V` and `CURRENT` remain three separate
variables, each with its own quality mask (their missing counts differ:
206 392 / 205 756 / 207 888). A cell where `U` and `V` are valid but the source
`CURRENT` is missing stays missing in the cleaned output — a recomputed field
would have wrongly filled it.

---

## 12. Provenance

Every `CleanedDataset` carries a `ProvenanceRecord` answering:

| Question | Field |
| --- | --- |
| Which INCOIS source? | `source_name`, `source_url`, `dataset_id`, `product_title` |
| Which raw file? | `raw_file` (`data/raw/…`), `raw_file_sha256`, `raw_file_bytes`, `raw_file_format` |
| Which variables? | `variables_processed` |
| Original units? | `original_units` (`{var: raw string or null}`) |
| Normalized units? | `normalized_units` (`{var: canonical}`) |
| Dimensions? | `dimensions` (`{name: size}`) |
| Grid / coordinate system? | `coordinate_axes` (`{coord: role}`) + the copied coordinate arrays |
| Time range? | `time_units`, `time_calendar`, `time_coverage` |
| Analysis or forecast? | `product_type`, `temporal_semantics` |
| What cleaning was applied? | `CleanedDataset.processing_log` (ordered) |

Nothing in the provenance is fabricated — every field is copied from the raw
file's own metadata (via D7) or from the D4/D6 documentation captured in the D7
registry.

A JSON copy (metadata + diagnostics, **no bulk arrays**) is written to
`data/processed/<name>.d8.json` by `python -m app.data.processing` or
`write_manifest()`.

---

## 13. Raw-data immutability

| File | SHA-256 before D8 | SHA-256 after D8 + tests | Match |
| --- | --- | --- | --- |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | ✅ |
| `data/raw/currents_incois_io-hoofs_sample.nc` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | ✅ |

D8 never opens a file under `data/raw/` for writing. Its only disk output is
`data/processed/*.d8.json`, and `write_manifest()` explicitly refuses a target
path inside `data/raw/`.

---

## 14. What D8 deliberately does NOT do

- ❌ regrid, resample, or change grid resolution
- ❌ interpolate, extrapolate, or smooth
- ❌ merge temperature/salinity and currents onto a common grid
- ❌ reconcile or merge the two time systems
- ❌ alter current vectors, or recompute `CURRENT` as the primary field
- ❌ change any coordinate value
- ❌ replace missing values with zero, or fill them by any method
- ❌ clip values to the D6 range or discard "extreme" values
- ❌ perform a numeric unit conversion
- ❌ rewrite the raw NetCDF files
- ❌ build the BlueNexus data format (D9)
- ❌ create an API / FastAPI route / touch `backend/main.py` (D10)
- ❌ connect the frontend, replace mock temperature, add Supabase, create DB tables
- ❌ add or substitute chlorophyll

---

## 15. How D9 will consume this

D9 (`Convert data to BlueNexus-friendly format`) takes `CleanedDataset` objects
from `app.data.processing.process_all()` (or the per-dataset functions) and:

- reads `CleanedVariable.values` (float64, missing = NaN) and `.quality`,
- reads the verbatim coordinate arrays from `CleanedDataset.coordinates`,
- reads `ProvenanceRecord` for source/units/time metadata,
- reshapes / serialises into whatever on-the-wire structure the BlueNexus
  frontend needs (e.g. per-depth-level slices, JSON/typed-array payloads),
  **keeping temperature/salinity 4-D and currents surface-only** — D8 has
  already guaranteed the dimensionality and the canonical missing marker, so D9
  does not need to revisit cleaning.

D8 is complete and its tests pass; D9 is **not** started.

---

## 16. Tests

Stdlib `unittest`, run from `backend/`:

```
./.venv/Scripts/python.exe -m unittest discover -s tests -v
```

**59 tests pass** (D7: 29, D8: 30), ~4 s. The required D8 coverage:

| # | Requirement | Test |
| --- | --- | --- |
| 1 | Temperature processing succeeds | `D8TemperatureSalinity.test_01…` |
| 2 | Salinity processing succeeds | `test_02…` |
| 3 | Current processing succeeds | `D8SurfaceCurrents.test_03…` |
| 4 | NaN recognised as missing | `test_04…` (both classes) |
| 5 | Declared fill values recognised as missing | `test_05…` (both) |
| 6 | Missing values not converted to zero | `test_06…` (both) |
| 7 | Valid values preserved | `test_07…` (both) |
| 8 | Temperature units → `degC` | `test_08…` |
| 9 | Salinity units → `PSU` | `test_09…` |
| 10 | Current units → `m s-1` | `test_10…` |
| 11 | Coordinates preserved exactly | `test_11…`, `test_11b…`, `test_11c…` |
| 12 | Time coordinates preserved | `test_12…` (both) |
| 13 | Temp/salinity dimensions unchanged | `test_13…` |
| 14 | Current dimensions unchanged | `test_14…` |
| 15 | U/V/CURRENT remain separate | `test_15…` |
| 16 | CURRENT not overwritten by recalculation | `test_16…` |
| 17 | Vector-consistency diagnostic works | `test_17…` |
| 18 | Raw-file hashes unchanged | `D8RawFileImmutability.test_18…` |
| + | Range diagnostics report only (no clip) | `test_range_diagnostic…` (both) |
| + | Provenance points to the raw file | `test_provenance_points_to_raw_file` |
| + | D7 source buffer left untouched | `test_source_buffer_reference_is_untouched` |

All 29 pre-existing D7 tests continue to pass.

---

## 17. Scope boundary

> **D8 produced a canonical cleaned representation of the D7-ingested INCOIS
> data: canonical missing marker (NaN + quality mask), lossless float64
> widening, and unit-metadata normalisation, with range and vector-consistency
> diagnostics. It did not regrid, resample, interpolate, smooth, extrapolate,
> merge grids, clip values, replace missing ocean values, convert units
> numerically, rewrite raw files, build the BlueNexus format, create an API,
> touch the backend service or frontend, or add a database. D9–D15 were not
> started. Chlorophyll remains pending official INCOIS access clarification and
> was not substituted.**

**Next step: D9 — Convert data to BlueNexus-friendly format.**
