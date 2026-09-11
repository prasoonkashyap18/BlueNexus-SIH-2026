# BlueNexus D9 Data Format

**Data Track step:** D9 — Convert Data to a BlueNexus-Friendly Format
**Type:** Canonical data-contract definition + converter + `.bnx` serializer/deserializer
+ JSON-projection helper + tests + documentation. No regridding, resampling,
interpolation, grid or time-system merging, scientific-value changes, **and no
HTTP API**.
**Prepared:** 2026-09-06 (local)
**Builds on (all unchanged):** D1–D6 docs · `docs/data-ingestion.md` (D7) ·
`docs/data-processing.md` (D8)

---

## 1. Purpose

D9 defines and produces the **canonical BlueNexus data contract** — the exact
structure D10 will serve through an API and the frontend will consume:

```
INCOIS raw NetCDF → D7 ingestion → D8 cleaned/canonical → [ D9 BlueNexus format ] → D10 backend/API → D11 frontend
```

D9 takes D8 `CleanedDataset` objects and:

1. re-labels each cleaned variable to a **canonical parameter id**,
2. copies coordinate arrays **verbatim** (the current grid is *not* regenerated),
3. adds ISO-8601 UTC time strings alongside the raw numeric time values,
4. assembles explicit, versioned **metadata** and **provenance**,
5. serialises to a compact, deterministic, dependency-free **`.bnx` container**,
6. offers a **JSON-projection helper** (`parameter_slice`) that shows how a
   single lat×lon slice should look on a JSON transport — with `null` for
   missing.

> **D9 does not regrid, interpolate, smooth, resample, merge grids, merge time
> systems, or change any scientific value. D9 does not provide an API.**

> **Chlorophyll remains pending official INCOIS access clarification and is not
> present or substituted here** (no NASA / NOAA / Copernicus / MOSDAC / other
> external source).

---

## 2. Why this storage format

| Option | Verdict |
| --- | --- |
| **Plain JSON for everything** | ❌ The currents arrays are ~3.0 M float64 values; as JSON text that is ~150 MB, and JSON cannot represent `NaN`. |
| **NPZ** (`numpy`) | ❌ Needs `numpy`; the backend venv is pure-stdlib and Python 3.14 wheels are thin. Rejected in D5–D8 for the same reason. |
| **NetCDF-4 / HDF5** | ❌ Needs `netCDF4` / `h5py` + the HDF5 C toolchain. The D7 reader is NetCDF-3 read-only. |
| **NetCDF-3 re-write** | ❌ Would re-encode the exact thing D7/D8 just decoded, and adds a writer to maintain. |
| **`.bnx` = tiny header + one JSON manifest + raw little-endian binary blobs** | ✅ **Chosen.** Deterministic, zero-dependency (stdlib `array` / `json` / `struct`), compact (float64 + uint8, no per-cell overhead), trivial for D10 to serve (read manifest → seek to a blob → stream a byte range) and for browser JS to read (`DataView` + `Float64Array` / `Uint8Array`). Coordinates and metadata are stored **once** in the manifest; bulk arrays are stored **once** each. |

Sizes produced from the real D4 samples:

| Bundle | `.bnx` size | Notes |
| --- | --- | --- |
| `incois_argo_10day_analysis.bnx` | ~2.4 MB | 2 params × 132 192 float64 + quality + manifest |
| `incois_io_hoofs_surface_currents.bnx` | ~27 MB | 3 params × 1 012 084 float64 + quality; same order as the 24 MB raw `.nc` |

Blobs are stored uncompressed (`values` are ~20–36 % NaN and don't compress
much anyway) which keeps the container **byte-reproducible**. D10 can gzip at
the transport layer if it wants.

---

## 3. Architecture

```
backend/app/data/bluenexus/          (D9 — new; D7 & D8 untouched)
  __init__.py       public API
  __main__.py       `python -m app.data.bluenexus` → convert all + write .bnx + round-trip check
  parameters.py     canonical parameter registry (ids, aliases, kinds, vector roles)
  timeaxis.py       minimal "<unit> since <epoch>" → ISO-8601 UTC
  models.py         BlueNexusDataset / Parameter / Coordinate / Dimension / Array / Metadata / Provenance
  converter.py      convert_to_bluenexus(CleanedDataset) → BlueNexusDataset  (+ named wrappers)
  serialization.py  write_bluenexus / read_bluenexus / read_manifest / parameter_slice
backend/tests/
  test_format.py    24 stdlib unittest cases (D7's 29 + D8's 30 still pass)
data/bluenexus/
  README.md         (tracked)
  *.bnx             generated containers (git-ignored)
```

**No third-party dependency added.** Same pure-stdlib stack as D7/D8.
`backend/main.py` and `backend/requirements.txt` untouched.

D9 reuses D8 directly — `from ..processing import process_all` — and never
touches NetCDF parsing or cleaning logic.

---

## 4. BlueNexus schema (`bluenexus.dataset/1`)

```
BlueNexusDataset
  schema_version          "bluenexus.dataset/1"
  dataset_id              "incois_argo_10day_analysis" | "incois_io_hoofs_surface_currents"
  product_type            "analysis" | "forecast"          (never "real-time")
  title
  dimensions[]            { name, role, size, is_unlimited }   — source declaration order kept
  coordinates{role}       role ∈ {time, depth, latitude, longitude}
    role, name, units, calendar, direction, ordering, count,
    values[]              exact copy of the D8 coordinate array
    regular_step          constant step if evenly spaced, else null
    (time only) iso_times[], reference_epoch_iso, timezone, timezone_is_assumed
  parameters{parameter_id}
    parameter_id          canonical (see §5)
    display_name, display_aliases[]        aliases are cosmetic, never a lookup key
    source_variable, source_dataset
    units                 canonical  ("degC" | "PSU" | "m s-1")
    raw_units             provenance ("degs" | "PSU" | null)
    units_source
    dimensions[]          ("time","depth","latitude","longitude")
    shape[]
    standard_name, long_name
    kind                  "scalar_field" | "vector_component" | "vector_magnitude"
    vector_group, vector_role
    authoritative         true = source field used as-is, not derived
    surface_only
    valid_count, missing_count, missing_fraction, valid_min, valid_max
    notes[]
  metadata                (see §13)
  provenance              (see §12)
  arrays{parameter_id}    BlueNexusArray { values: float64 (NaN=missing), quality: uint8 (0/1) }
  generation              { generated_at_utc, generator, contract_sha256 }  — NOT in the contract
```

`BlueNexusDataset.contract()` returns the deterministic dict (everything above
except `arrays` and `generation`). `contract_sha256()` hashes its canonical JSON.

### `.bnx` container layout

```
magic          12 bytes   b"BLUENEXUS/1\n"
manifest_len    8 bytes    uint64 little-endian
manifest       <len>       UTF-8 JSON, json.dumps(sort_keys=True, separators=(",",":"), allow_nan=False)
                           { "contract": {...}, "arrays_index": [...], "generation": {...} }
blobs          rest        concatenated in arrays_index order
```

`arrays_index` entries: `{ key: "temperature.values", parameter_id, kind:
"values"|"quality", dtype: "float64-le"|"uint8", count, byte_offset,
byte_length }`. `byte_offset` is relative to the first byte after the manifest.

---

## 5. Parameter mapping

| Canonical id | Source var | Dataset | `kind` | Units | Notes |
| --- | --- | --- | --- | --- | --- |
| `temperature` | `T_ANALYZED` | analysis | `scalar_field` | `degC` | **multi-depth (24 levels), NOT SST** |
| `salinity` | `S_ANALYZED` | analysis | `scalar_field` | `PSU` | multi-depth (24 levels) |
| `current_u` | `U` | forecast | `vector_component` (eastward) | `m s-1` | surface-only |
| `current_v` | `V` | forecast | `vector_component` (northward) | `m s-1` | surface-only |
| `current_speed` | `CURRENT` | forecast | `vector_magnitude` | `m s-1` | **authoritative — INCOIS-supplied, not recomputed**; surface-only |

- **Canonical ids are the only lookup key.** `parameter("temp")`,
  `parameter("sst")`, `parameter("velocity")`, `parameter("current")` all raise
  `KeyError`. `display_aliases` (`temp`, `salt`, `current`) are stored for UI
  labelling only and are never resolved.
- `temperature` ≠ SST: `surface_only = false`, and its `notes` say so
  explicitly. The surface is depth index 0 of 24.
- The three current parameters share `vector_group = "surface_current"`;
  `metadata.vector_groups["surface_current"]` records
  `{components: {eastward: current_u, northward: current_v}, magnitude: current_speed}`.

---

## 6. Dimension handling

Source **logical** dimensions are preserved for every parameter:
`time × depth × latitude × longitude`. The dataset-level `dimensions[]` list
keeps the source **declaration** order (which differs from the variable order in
the currents file — `DEPTH1_1, LON, TAXIS, LAT`) with a `role` on each entry.

- Temperature/salinity: `3 × 24 × 36 × 51`.
- Currents: `4 × 1 × 421 × 601` — **depth stays length 1**. It is **not** padded
  or reshaped to 24, the datasets are **not** merged onto a common grid, and
  their shapes are never assumed equal.

---

## 7. Coordinate handling

Every coordinate `values[]` array is an **exact element-wise copy** of the D8
coordinate (which was itself an exact copy of the D7 read). Tests compare the
full arrays for equality against `process_*()` output.

| | Temperature / Salinity | Currents |
| --- | --- | --- |
| `time` | 3 values, `seconds since 1970-01-01T00:00:00Z`, calendar `standard`, ascending, step 864000 | 4 values, `hours since 2026-09-03 01:30`, calendar `standard`, ascending, step 30 |
| `depth` | 24 values 5–2000 m, `METERS`, ascending, `regular_step = null` (irregular kept irregular) | 1 value `0.0`, `meters`, `direction` from `positive` attr, `surface_only = true` |
| `latitude` | 36 values −9.5…25.5 °N, `degrees_north`, step 1.0 | 421 values −10.008…24.978 °N, `degrees_north`, step ≈ 0.0833 |
| `longitude` | 51 values 50.5…100.5 °E, `degrees_east`, step 1.0 | 601 values 49.992…99.972 °E, `degrees_east`, step ≈ 0.0833 |

**The current grid is not regenerated.** `longitude.values[1] - values[0]` is
`≈ 0.0833`, **not** `1/12 = 0.08333…`, and `longitude.values[0]` is the stored
`49.992`, not a synthetic `50.0`. A test asserts both.

### Time normalisation

`timeaxis.normalise_time_axis()` turns `"<unit> since <epoch>"` + numeric
offsets into ISO-8601 UTC strings, deterministically. The raw numeric `values`
are kept; `iso_times` is an **additional** representation.

| | Reference epoch | `iso_times` | `timezone` | `timezone_is_assumed` |
| --- | --- | --- | --- | --- |
| Temp/Sal | `1970-01-01T00:00:00Z` | `2026-07-10T00:00:00Z` … `2026-07-30T00:00:00Z` | `UTC` | `false` (string ended in `Z`) |
| Currents | `2026-09-03T01:30:00Z` | `2026-09-05T01:30:00Z` … `2026-09-08T19:30:00Z` | `UTC` | **`true`** (string had no offset; D6: INCOIS OSF operates in UTC) |

The two time systems stay separate — different units, different reference
epochs, different `product_type`. They are never merged.

---

## 8. Missing-value handling

- **Binary (`.bnx`):** missing cell = IEEE-754 **NaN** in `values` **and** `1`
  in the parallel `quality` array. This is D8's canonical marker, carried
  through unchanged.
- **JSON projection:** missing cell = **`null`** (`parameter_slice()` renders it
  so; `manifest` JSON uses `allow_nan=False` and contains no bulk values).
- **Never** `0`, `-1`, `-9999`, or `-1e34`. The source sentinels (`9999.0` for
  temperature/salinity, `-1e34` declared for currents) and source NaN are all
  normalised away in D8 and **do not appear** anywhere in the BlueNexus format.
  `0.0` is a real value — a test confirms near-zero current cells stay `VALID`.
- `missing_value_definition` is spelled out in `metadata` for API/frontend
  consumers.

Counts (unchanged from D6/D7/D8): temperature 47 702 missing / 84 490 valid;
salinity 47 644 / 84 548; current_u 206 392 / 805 692; current_v 205 756 /
806 328; current_speed 207 888 / 804 196.

---

## 9. Quality flags

`BlueNexusArray.quality` — one `uint8` per cell, exactly two states:

| Value | Name | Meaning |
| --- | --- | --- |
| `0` | `VALID` | a real value is present in `values[i]` |
| `1` | `MISSING` | `values[i]` is NaN (land / no-data) |

`metadata.quality_definition = {"0": "VALID", "1": "MISSING"}`. No
"good/bad/excellent" grades — quality here is data availability, not
oceanographic interpretation (matches D8).

---

## 10. Large-array handling

- Coordinates and metadata are stored **once** in the manifest, never repeated
  per cell.
- Bulk arrays are raw binary blobs — no per-value JSON objects, no per-cell
  coordinates, no duplicated metadata.
- `U`, `V`, `CURRENT` are three separate blobs — no duplication, and
  `current_speed` is **not** a copy of a recomputed field.
- `read_manifest(path)` reads just the header + JSON (a few KB) without loading
  the ~27 MB of blobs — D10 can list parameters / coordinates / metadata
  cheaply and stream individual blob byte-ranges on demand.
- `parameter_slice(ds, pid, time_index=, depth_index=)` extracts a single
  lat×lon plane (e.g. 36×51 or 421×601) for a JSON response instead of shipping
  the whole 4-D array.

---

## 11. Determinism

- `BlueNexusDataset.contract()` is a **pure function** of the D8 cleaned data.
  `contract_sha256(convert_*())` is identical across runs (tested for both
  datasets).
- `.bnx` bytes are **identical** given a fixed `generated_at` (tested:
  `write_bluenexus(..., generated_at="2026-01-01T00:00:00Z")` twice → same
  SHA-256).
- The manifest JSON is emitted with `sort_keys=True, separators=(",",":")` —
  key order is fixed.
- Non-deterministic bookkeeping (`generated_at_utc`) lives only in
  `manifest.generation`, which is **excluded from the contract** and from the
  determinism guarantee. `generation.contract_sha256` lets a consumer verify
  the deterministic part.
- No random ids, no environment-specific absolute paths (the only path in the
  contract is the repo-relative `data/raw/…` source file).

---

## 12. Provenance

`BlueNexusDataset.provenance` answers *"where did this value come from?"*:

| Field | Example (temperature) |
| --- | --- |
| `source_name` / `source_url` | `INCOIS ERDDAP` / griddap dataset page |
| `source_dataset_id` | `incois_argo_10day_McCreary` |
| `source_file` | `data/raw/temperature_salinity_incois_argo_sample.nc` |
| `source_file_sha256` | `17f5caa8…bb6c9e6d` |
| `source_file_bytes` / `source_file_format` | `1062744` / `NetCDF-3 classic (CDF\x01, 32-bit offset)` |
| `conventions` | `CF-1.6, COARDS, ACDD-1.3` |
| `pipeline_stages` | `D4 acquisition → D5 → D6 → D7 → D8 → D9 BlueNexus format` |
| `d8_processing_log` | the full ordered D8 log (verbatim) |
| `original_units` / `canonical_units` | `{temperature: "degs"}` / `{temperature: "degC"}` |

Everything is copied from the raw file's own metadata (via D7/D8) or the D4/D6
documentation captured in the D7 registry — nothing is invented. Provenance
survives a `.bnx` round-trip (tested).

---

## 13. Dataset metadata

`BlueNexusDataset.metadata` carries, for API/frontend use:

`dataset_id`, `display_name`, `parameter_ids`, `product_type`, `data_status`,
`temporal_semantics`, `time_coverage` (`start`/`end`/`start_iso`/`end_iso`/`n`/
`step`/`units`/`calendar`/`timezone`/`timezone_is_assumed`), `depth_coverage`
(`min`/`max`/`levels`/`n`/`units`/`direction`/`ordering`/`surface_only`/
`regular`), `latitude_coverage` & `longitude_coverage` (`min`/`max`/`n`/`step`/
`units`/`ordering`, plus `convention` for longitude), `source`,
`quality_definition`, `missing_value_definition`, `vector_groups`, `notes`.

- **`data_status`** is `"analysis"` or `"forecast"` — **never `"real-time"`**.
  `notes` state `this dataset is NOT real-time`.
- Currents retain vector-component identity (`vector_role`), speed identity
  (`kind = "vector_magnitude"`, `authoritative = true`) and `surface_only = true`.
- Temperature/salinity retain the analysis indication (`data_status = "analysis"`,
  `temporal_semantics`) and full 24-level `depth_coverage`.

---

## 14. Serialization / deserialization

```python
from app.data.bluenexus import (
    convert_to_bluenexus, convert_all,
    write_bluenexus, read_bluenexus, read_manifest, parameter_slice,
)

bnds   = convert_to_bluenexus(cleaned_dataset)          # D8 CleanedDataset -> BlueNexusDataset
path   = write_bluenexus(bnds, "data/bluenexus/x.bnx")  # -> Path ; refuses data/raw/
loaded = read_bluenexus(path)                           # full reconstruction (arrays + metadata)
header = read_manifest(path)                            # header + JSON only, no blobs

slice_ = parameter_slice(loaded, "temperature", time_index=0, depth_index=0)
# -> { parameter, units, time:{index,value,iso}, depth:{...},
#      latitude:[...], longitude:[...], values:[[..|null..]], quality:[[0|1]], missing_value:null }
```

`write_bluenexus` raises `RuntimeError` for any path under `data/raw/`.

---

## 15. Example structure (`contract`, abridged)

```json
{
  "schema_version": "bluenexus.dataset/1",
  "dataset_id": "incois_argo_10day_analysis",
  "product_type": "analysis",
  "title": "INCOIS Argo 10-Day Analysis - Temperature & Salinity",
  "dimensions": [
    { "name": "time", "role": "time", "size": 3, "is_unlimited": false },
    { "name": "ZAX", "role": "depth", "size": 24, "is_unlimited": false },
    { "name": "latitude", "role": "latitude", "size": 36, "is_unlimited": false },
    { "name": "longitude", "role": "longitude", "size": 51, "is_unlimited": false }
  ],
  "coordinates": {
    "time": {
      "role": "time", "name": "time", "units": "seconds since 1970-01-01T00:00:00Z",
      "calendar": "standard", "ordering": "ascending", "count": 3,
      "values": [1783641600.0, 1784505600.0, 1785369600.0], "regular_step": 864000.0,
      "iso_times": ["2026-07-10T00:00:00Z", "2026-07-20T00:00:00Z", "2026-07-30T00:00:00Z"],
      "reference_epoch_iso": "1970-01-01T00:00:00Z", "timezone": "UTC", "timezone_is_assumed": false
    },
    "depth": { "role": "depth", "name": "ZAX", "units": "METERS", "ordering": "ascending",
               "count": 24, "values": [5.0, 10.0, 20.0, "…"], "regular_step": null }
  },
  "parameters": {
    "temperature": {
      "parameter_id": "temperature", "display_name": "Sea Water Temperature",
      "display_aliases": ["temp"], "source_variable": "T_ANALYZED",
      "units": "degC", "raw_units": "degs",
      "dimensions": ["time", "depth", "latitude", "longitude"], "shape": [3, 24, 36, 51],
      "kind": "scalar_field", "authoritative": true, "surface_only": false,
      "valid_count": 84490, "missing_count": 47702,
      "valid_min": 2.5399999618530273, "valid_max": 32.58599853515625,
      "notes": ["Multi-depth objective-analysis field (24 levels, 5-2000 m). This is NOT sea-surface temperature …"]
    }
  },
  "metadata": { "data_status": "analysis", "quality_definition": {"0": "VALID", "1": "MISSING"}, "…": "…" },
  "provenance": {
    "source_file": "data/raw/temperature_salinity_incois_argo_sample.nc",
    "source_file_sha256": "17f5caa8…bb6c9e6d",
    "pipeline_stages": ["D4 acquisition", "…", "D9 BlueNexus format"],
    "original_units": {"temperature": "degs", "salinity": "PSU"},
    "canonical_units": {"temperature": "degC", "salinity": "PSU"}
  }
}
```

*(`valid_min` shows the exact float64 widening of the float32 source value
`2.54`; display docs round it to `2.540`.)*

---

## 16. Round-trip validation (results)

`convert → write(.bnx) → read → compare`, for **both** datasets
(`test_format.py::D9RoundTrip`):

| Compared | Result |
| --- | --- |
| `contract()` dicts | **equal** |
| `contract_sha256` | **equal** |
| dimensions (names, roles, sizes) | **equal** |
| coordinates (`time`, `depth`, `latitude`, `longitude` full arrays) | **exactly equal** |
| parameter ids | **equal** (`{temperature, salinity}`, `{current_u, current_v, current_speed}`) |
| units (canonical + raw) | **equal** |
| product type / `data_status` | **equal** (`analysis` / `forecast`) |
| valid scientific values | **exactly equal** (float64, NaN-aware compare) |
| missing masks / quality flags | **exactly equal** (`uint8`) |
| provenance (source file, sha256, stages, units maps) | **equal** |

`python -m app.data.bluenexus` also runs this round-trip and prints
`round-trip contract match : True` / `round-trip array sample match : True` for
both datasets.

---

## 17. Determinism (result)

| Check | Result |
| --- | --- |
| `contract_sha256(convert_temperature_salinity())` across 2 runs | **identical** |
| `contract_sha256(convert_surface_currents())` across 2 runs | **identical** |
| `.bnx` SHA-256 across 2 writes with fixed `generated_at` (currents) | **identical** |

Contract shas from the current D4 samples:
`incois_argo_10day_analysis` → `89adb7ff…c23ca95`;
`incois_io_hoofs_surface_currents` → `5d31d050…d7d18c7d`.

---

## 18. Tests

Stdlib `unittest`, from `backend/`:

```
./.venv/Scripts/python.exe -m unittest discover -s tests -v
```

**83 tests pass** — D7: 29, D8: 30, **D9: 24**. The required D9 coverage:

| # | Requirement | Test |
| --- | --- | --- |
| 1–3 | Temperature / salinity / currents convert | `D9Conversion.test_01/02/03` |
| 4 | Parameter ids canonical (aliases rejected; not SST) | `test_04_parameter_ids_are_canonical` |
| 5–6 | Dimensions & shapes preserved (currents not padded) | `test_05`, `test_06` |
| 7 | Coordinate arrays preserved exactly | `test_07_coordinates_preserved_exactly` |
| 8 | Current `0.0833°` spacing preserved, not `1/12°` | `test_08_current_grid_spacing_is_0_0833_not_one_twelfth` |
| 9 | Depth arrays preserved | `test_09_depth_arrays_preserved` |
| 10 | Time metadata preserved (units, calendar, ISO, tz-assumed) | `test_10_time_metadata_preserved` |
| 11–12 | Units & product types preserved | `test_11`, `test_12` |
| 13 | Missing values not zero | `test_13_missing_values_not_zero` |
| 14 | Missing serialises safely as `null` | `test_14_missing_serialises_safely_as_null` |
| 15 | Quality flags survive serialisation | `test_15_quality_flags_survive_serialisation` |
| 16 | U/V/CURRENT remain separate | `test_16_u_v_current_separate` |
| 17 | Source CURRENT authoritative (not a recompute) | `test_17_source_current_authoritative` |
| 18 | Provenance survives serialisation | `test_18_provenance_survives_serialisation` |
| 19 | Round-trip preserves scientific values | `D9RoundTrip.test_19` |
| 20 | Round-trip preserves metadata | `test_20` |
| 21 | Output deterministic (contract + bytes) | `test_21_output_is_deterministic` |
| 22 | Raw-file hashes unchanged | `D9RawFileIntegrity.test_22` |
| 23–24 | All D7 & D8 tests still pass | full `unittest discover` run |
| + | Manifest readable without full load; write refuses `data/raw/` | `test_manifest_readable…`, `test_write_refuses_data_raw` |

---

## 19. Raw-data integrity

| File | SHA-256 before D9 | SHA-256 after D9 + tests | Match |
| --- | --- | --- | --- |
| `data/raw/temperature_salinity_incois_argo_sample.nc` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | `17f5caa863b34aa25ea72556f1ae186689a7d79fb748c8b936d0fd62bb6c9e6d` | ✅ |
| `data/raw/currents_incois_io-hoofs_sample.nc` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | `40d8cdce6aca95b066eb662221c5627e684fda06556b2c047776b5d7c0d5ba7d` | ✅ |

D9 never opens a `data/raw/` file. Its only disk output is
`data/bluenexus/*.bnx`, and `write_bluenexus()` refuses any path under
`data/raw/`.

---

## 20. How D10 will consume the D9 format

D10 (**Build the backend/API data layer**) is expected to:

1. On startup, run `app.data.bluenexus.convert_all()` (or read pre-built
   `data/bluenexus/*.bnx` with `read_bluenexus` / `read_manifest`).
2. Expose **catalog** endpoints from `contract()` — datasets, `parameter_ids`,
   `display_name`s, `units`, `dimensions`, `metadata`, `provenance`.
3. Expose **coordinate** endpoints from `coordinates` — time (`iso_times`),
   depth `levels`, latitude/longitude arrays — to drive parameter / depth /
   time / geographic selectors.
4. Expose **data** endpoints by calling `parameter_slice(ds, parameter_id,
   time_index=, depth_index=)` (or serving a blob byte-range) — a lat×lon grid
   with `null` for missing and a parallel quality grid.
5. Never re-clean or re-validate: D9 has already guaranteed canonical units,
   the canonical missing marker, preserved coordinates, and preserved
   dimensionality.

**D9 does not provide an API.** It defines and produces the contract only.

---

## 21. Scope boundary

> **D9 defined and produced the canonical BlueNexus data contract
> (`bluenexus.dataset/1`), a deterministic `.bnx` serializer/deserializer, and a
> JSON-projection helper. It did not regrid, resample, interpolate, smooth,
> merge grids, merge time systems, clip, or change any scientific value; it did
> not build an API, add FastAPI routes, touch `backend/main.py`, start a server,
> add a database or Supabase, or change the frontend. D10–D15 were not started.
> Chlorophyll remains pending official INCOIS access clarification and was not
> substituted.**

**Next step: D10 — Build the backend/API data layer.**
