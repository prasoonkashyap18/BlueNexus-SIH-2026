# D15 — Full Data Validation (end-to-end quality gate)

**Type:** validation / quality gate only. No feature code, no schema change, no
new dataset, no scheduler, no frontend polling, no UI change, no database, no
provider replacement, no mock/fallback data, no "real-time" claim, no commit.

**Builds on (all unchanged):** D1–D14 and their docs, especially
`docs/data-acquisition.md` (D4 source identities) and `docs/data-validation.md`
(the D6 validated numeric baseline).

**Suite:** `backend/tests/test_d15_validation.py` — 47 deterministic tests.
Re-runs the existing D7→D8→D9 pipeline from the **pristine D4 raw files**
(`convert_temperature_salinity()` / `convert_surface_currents()`), stands up the
real D10 FastAPI over the installed `.bnx` set, and checks every stage against
the D6 baseline and the documented source identities. Also asserts the
D11–D13 frontend contract (the dataset/parameter ids and units the providers
hard-code) against what the API actually serves, and exercises D14's
manifest / atomic-publish / partial-update logic with fixture sources (no
network, no production `.bnx` touched).

---

## Datasets validated

| Logical id | Product | Parameters | Source variables | Grid | Depth | Times |
|---|---|---|---|---|---|---|
| `incois_argo_10day_analysis` | **analysis** | `temperature`, `salinity` | `T_ANALYZED`, `S_ANALYZED` | 36 × 51 (1.0°) | 24 levels, 5–2000 m (irregular, ascending) | 3 × 10-day |
| `incois_io_hoofs_surface_currents` | **forecast** | `current_u`, `current_v`, `current_speed` | `U`, `V`, `CURRENT` | 421 × 601 (≈0.0833°) | 1 level, **0 m surface-only** | 4 forecast-valid |

**Chlorophyll is intentionally excluded** — see "Known limitations".

## Official source identities (verified through the pipeline)

| | Temperature / salinity | Currents |
|---|---|---|
| Source | **INCOIS ERDDAP** | **INCOIS THREDDS — IO-HOOFS** |
| Source dataset id | `incois_argo_10day_McCreary` | `CURRENTS_IO_YYYYMMDD.nc` |
| Source URL host | `erddap.incois.gov.in` | `incois.gov.in` (THREDDS) |
| Raw file SHA-256 | `17f5caa8…e6d` (D4) | `40d8cdce…a7d` (D4) |
| Product classification | `analysis` (objective analysis; *"not an observation time, not a forecast"*) | `forecast` (IO-HOOFS operational; *"Not observations"*) |
| Real-time claim | **none** — `freshness.is_real_time` is always `false`; metadata notes state *"NOT real-time"* | **none** |

Provenance (`source_name`, `source_url`, `source_dataset_id`, raw SHA-256, raw
byte count, pipeline stages, `time_coverage`) is intact in the D9 `.bnx` and in
every D10 response. No machine-specific absolute path leaks through the API.

---

## Structural checks (all pass)

**Analysis (temperature + salinity)** — axes `{time, depth, latitude, longitude}`
present, all ascending; sizes exactly `3 / 24 / 36 / 51`; 3 analysis times
`2026-07-10/20/30T00:00:00Z` at an exact 864 000 s step, timezone explicit
(not assumed); 24 depths equal to the documented irregular ladder 5…2000 m,
strictly ascending, `regular_step = None`, all > 0; lat −9.5…25.5 / lon
50.5…100.5 at an exact 1.0° step, all in valid geographic bounds; units `degC`
and `PSU`; missing represented as canonical IEEE NaN mirrored 1:1 by
`quality == 1`.

**Currents** — axes present and ascending; sizes exactly `4 / 1 / 421 / 601`;
**depth is one level, exactly 0.0 m**, every parameter `surface_only = true`;
4 forecast times `2026-09-05…08` at an exact 30 h step; 421 × 601 lat/lon
strictly ascending, ≈0.0833° spacing (its **own** grid — never forced onto the
1° analysis grid); units `m s-1` for U/V/CURRENT; missing represented
canonically.

**Cross-dataset:** the two datasets keep distinct grids and distinct time-axis
units — no shared grid, no merged time system.

## Numerical checks (all pass, against the D6 baseline in `docs/data-validation.md` §2–§8)

| Parameter | Units | Valid cells | Missing cells | Valid min | Valid max |
|---|---|---|---|---|---|
| `temperature` | degC | 84 490 | 47 702 | 2.540 | 32.586 |
| `salinity` | PSU | 84 548 | 47 644 | 30.930 | 37.353 |
| `current_u` | m s⁻¹ | 805 692 | 206 392 | −1.13419 | 1.68921 |
| `current_v` | m s⁻¹ | 806 328 | 205 756 | −1.33055 | 2.47688 |
| `current_speed` | m s⁻¹ | 804 196 | 207 888 | 0.00038 | 2.63063 |

- Every valid/missing count and min/max reproduces the D6 figures **exactly**
  (in the fresh pipeline artifact, the installed `.bnx`, and the D10 API).
- The D8 range diagnostic reports **0 cells outside** the D6 reference range for
  all five parameters.
- `CURRENT ≡ √(U² + V²)` over **all** 804 196 jointly-valid cells: max absolute
  difference **< 1 × 10⁻⁹** (D6 measured 4.4 × 10⁻¹⁶); source `CURRENT` kept
  authoritative, no recomputed field created.
- **No infinities** anywhere.
- Missing cells are **canonical NaN only** — never coerced to `0`, `-1`,
  `-9999`, or `-1e34`; valid `0.0` stays `0.0` with `quality == 0`.
- The D6 §12 follow-up item (2000 m constant-2.54 °C cells) is **resolved,
  non-blocking**: the 2000 m level's valid range is 2.54…≤3.3 °C (matches the D6
  per-level table 2.54…3.18); the constant value equals the level minimum — an
  objective-analysis first-guess floor in a data-sparse region, not corruption.

## D7–D9 artifact / round-trip checks (all pass)

- Both installed `.bnx` open with `BnxReader`; `schema_version ==
  "bluenexus.dataset/1"`; dataset id matches.
- Every parameter's shape and unit metadata is intact.
- `generation.contract_sha256` equals the recomputed contract hash of the
  read-back model; a fresh convert → write → read reproduces the same
  `contract_sha256` (deterministic, `generated_at` excluded from the contract).
- A full `.bnx` round-trip preserves values and quality bytes (NaN-safe).
- Raw D4 `.nc` files are **byte-identical** before and after the entire D15 run
  (SHA-256 asserted at the start and in a final gate test).

## D10 API checks (all pass — live server over the installed `.bnx`)

`/api/health` → `status: ok`, all datasets present · `/api/datasets` → exactly
the two logical ids, correct product types · `/api/datasets/{id}` → provenance +
`freshness` present · `/api/datasets/{id}/parameters` → canonical ids only,
aliases rejected · `/api/datasets/{id}/coordinates` → exact counts, ISO times,
depth ladder, `depth.values == [0.0]` for currents · `.../parameters/{pid}/slice`
→ correct `shape`, `values`/`quality` same dimensions, correct selected
time/depth metadata and units, **missing cells are JSON `null` iff
`quality == 1`**, a served slice equals the same plane in the fresh pipeline
artifact to < 1e-9. Invalid dataset / parameter / alias / out-of-range index all
still rejected (404 / 422), error envelopes carry no traceback.

`freshness` is additive (D14) and never claims real-time: `is_real_time:false`,
`freshness_label` = "Latest available INCOIS analysis" / "Latest INCOIS IO-HOOFS
forecast", distinct `source_time_* / acquired_at / published_at / last_checked_at`.

## Frontend integration checks (D11–D13)

- Existing frontend unit tests: **43 / 43 pass** (`npm test` — D11 client, D12
  temperature, D13 salinity + currents).
- Live integration checks against the running D10 API — **all pass**:
  `test:integration` (D11), `test:integration:d12` (temperature),
  `test:integration:d13` (salinity + U/V/CURRENT).
- D15 backend-side contract parity: the ids and units the providers hard-code
  (`TEMPERATURE_DATASET_ID`, `SALINITY_DATASET_ID`, `CURRENT_DATASET_ID`,
  `*_PARAMETER_ID`, `degC` / `PSU` / `m s-1`) match exactly what the API serves;
  no `chlorophyll` string anywhere in the served contract.
- Frontend build (`npm run build`) and lint (`oxlint`) clean.
- Browser (headless SwiftShader): the app loads, connects to the API, and
  renders — no shader errors. Providers/timeline/UI unchanged.

## D14 compatibility checks (all pass — no live update, no production `.bnx` touched)

Updater module + public API (`Updater`, `make_updater`, `ManifestStore`,
`atomic_publish`, `verify_artifact`, `MANIFEST_SCHEMA`) intact; `.bnx` discovery
still finds both datasets; a deterministic fixture-source run proves
manifest handling, artifact verification, atomic publication (no `.bnx.updating`
left), and **partial update** (temperature/salinity advances while currents
fails → currents `.bnx` byte-identical, manifest records each dataset's own
status); `freshness` still served after all D15 checks. The production
`data/bluenexus/*.bnx` set is byte-identical before and after D15.

---

## Test results

| Suite | Total | Passed | Failed | Skipped | Warnings |
|---|---|---|---|---|---|
| Backend `unittest discover -s tests` (D7…D15) | **190** | 190 | 0 | 0 | none |
| — of which D15 (`test_d15_validation.py`) | 47 | 47 | 0 | 0 | none |
| Frontend `npm test` (D11/D12/D13) | **43** | 43 | 0 | 0 | none |
| Frontend `npm run build` | — | ✓ | — | — | 1 advisory (bundle > 500 kB, pre-existing) |
| Frontend `npm run lint` (oxlint) | — | ✓ (exit 0) | — | — | 0 |
| `npm run test:integration` (D11, live API) | — | PASSED | — | — | — |
| `npm run test:integration:d12` (temperature, live API) | — | PASSED | — | — | — |
| `npm run test:integration:d13` (salinity + currents, live API) | — | PASSED | — | — | — |

## Files created / modified

**Created**
- `backend/tests/test_d15_validation.py` — the 47-test D15 validation suite.
- `docs/data-validation-d15.md` — this document.

**Modified** — none. (D15 adds no feature code, no schema change, no config
change. `docs/data-validation.md` is the D6 record and is left intact; this
D15 document is separate and cross-references it.)

## Validation coverage

| Area | Covered by | Result |
|---|---|---|
| 1. Source / provenance | `D15_1_SourceProvenance` (5 tests) | ✅ |
| 2. Dataset structure | `D15_2_DatasetStructure` (12 tests) | ✅ |
| 3. Numerical | `D15_3_Numerical` (6 tests) | ✅ |
| 4. D7–D9 round-trip / artifact | `D15_4_ArtifactRoundTrip` (6 tests) | ✅ |
| 5. D10 API | `D15_5_ApiValidation` (9 tests) | ✅ |
| 6. D11–D13 integration | `D15_6_FrontendContract` (4) + `npm test` (43) + 3 live integration checks | ✅ |
| 7. D14 compatibility | `D15_7_D14Compatibility` (4 tests) + full `test_updater.py` (23) | ✅ |
| Final gate | `D15_Gate` (1 test) — raw + installed artifacts unchanged | ✅ |

## Known limitations

1. **Chlorophyll is not validated.** D13 explicitly excluded it: there is no
   verified public machine-readable INCOIS chlorophyll series
   (`docs/data-acquisition.md` §7, `docs/data-validation.md` §11). No substitute
   provider was introduced. When an approved INCOIS chlorophyll dataset is
   acquired it will get its own D5/D6/D15-style validation.
2. **The D6 numeric baseline covers the D4 sample only.** D15's exact
   count/range asserts against the *installed* `.bnx` are guarded by a check
   that its `provenance.source_file_sha256` still equals the D4 acquisition hash
   (currently true). After a D14 `--update` replaces an installed artifact, D15
   still validates that dataset's structure, provenance, missing-value
   canonicalisation, CURRENT identity and API behaviour, but the D4-specific
   exact-figure assertions (`test_43`) skip with a message — a fresh source
   would need its own D6-style range baseline.
3. **`test:integration` checks need a running backend.** They are run manually
   in the D15 report, not inside `unittest discover` (which stays offline-safe).
4. **Currents THREDDS rolling window.** The exact D4 source file
   (`CURRENTS_IO_20260904.nc`) rolls off the INCOIS server ~2026-09-11; the
   preserved `data/raw/` copy remains the validation input regardless.
5. **The D14 live source check** (`test_updater.test_90`) hits real INCOIS
   services and self-skips when they are unreachable; it passed during this run.

---

## Verdict

**D15 PASSES.**

Official INCOIS data travels reliably and losslessly through the full
D1→D14 pipeline. Every stage was validated deterministically against the D6
scientific baseline and the documented source identities:

- provenance points to the correct INCOIS ERDDAP / IO-HOOFS THREDDS sources and
  survives D7→D10; products are classified `analysis` / `forecast`; nothing
  claims real-time observational status;
- both datasets keep their exact documented structure, their own native grids,
  irregular/surface depth axes, correct units, and canonical NaN missing values;
- all valid/missing counts and value ranges reproduce the D6 figures exactly;
  `CURRENT ≡ √(U²+V²)` to < 1e-9; no infinities; no sentinel leakage;
- `.bnx` artifacts open, carry `schema_version bluenexus.dataset/1`, round-trip
  losslessly, and have internally consistent contract hashes;
- all six D10 endpoints serve correct metadata, slice dimensions, JSON-`null`
  missing values, and provenance + freshness for both datasets, and still
  reject invalid requests;
- the D11–D13 frontend contract matches the served API exactly; existing
  frontend tests, build, lint and the D11/D12/D13 live integration checks all
  pass;
- D14 updater, manifest, atomic-publish and partial-update logic are intact and
  the production `.bnx` set is byte-identical before and after D15.

**190 / 190 backend tests and 43 / 43 frontend tests pass with 0 failures and 0
skips.** The raw D4 files and the installed `.bnx` artifacts were not modified.
No commit or push was performed.
