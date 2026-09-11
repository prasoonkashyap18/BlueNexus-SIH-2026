# D14 — Controlled Data Updating

A controlled, observable, safe, reproducible mechanism for BlueNexus to detect,
acquire and process newly available official INCOIS data and republish it
through the existing D10 API — **without** claiming any of the data is
real-time, and **without** an automatic scheduler.

```
new/updated official INCOIS source
        │  D14 check  (catalog / metadata only — a few KB)
        ▼
   is there a newer source?  ──no──▶  "up to date", nothing is written
        │ yes
        ▼
   D14 acquire  (download only the D4 regional/temporal subset, verify it)
        ▼
   D7 ingest → D8 process → D9 convert     (the existing pipeline, unchanged)
        ▼
   verify the generated .bnx  (identity / parameters / dimensions / readable)
        ▼
   ATOMIC publish  (os.replace)  ──▶  D10 API serves it on next load
        ▼
   update data/update-state/manifest.json
```

If **any** stage fails, the previously working `.bnx` stays exactly as it was.

---

## 1. What was inspected (the D4–D13 pipeline, reused not duplicated)

| Stage | Module | Reused entry point |
|---|---|---|
| D4 acquisition | `docs/data-acquisition.md` | ERDDAP griddap `.nc` subset; THREDDS NCSS `.nc` subset |
| Registry | `app/data/ingestion/registry.py` | `DatasetSpec` (`TEMPERATURE_SALINITY`, `SURFACE_CURRENTS`) — file, axes, unit interpretation, expected fill values |
| D7 ingestion | `app/data/ingestion/netcdf_ingestor.py` | `ingest_dataset(spec)` → `IngestedDataset`; `sha256_of(path)` |
| D7 schema checks | `app/data/ingestion/validation.py` | `validate_or_raise` — dimension-size differences are **WARNING** ("a newer sample may legitimately differ") |
| D8 processing | `app/data/processing/cleaner.py` | `process_dataset(ingested, spec)` → `CleanedDataset` (missing→NaN+quality, coords verbatim, full provenance) |
| D9 conversion | `app/data/bluenexus/converter.py` | `convert_to_bluenexus(cleaned)` → `BlueNexusDataset` |
| D9 serialisation | `app/data/bluenexus/serialization.py` | `write_bluenexus(ds, path)` (refuses `data/raw/`), `BnxReader`, `read_bluenexus`, `contract_sha256` |
| D10 catalog | `app/services/catalog.py` | discovers `data/bluenexus/*.bnx` at startup |

D14 adds **no** NetCDF parsing, **no** cleaning, **no** conversion logic. It runs
the acquired file through `ingest_dataset` → `process_dataset` →
`convert_to_bluenexus` exactly as D9's own `convert_all()` does, using a frozen
copy of the registry `DatasetSpec` with only `filename` (→ the staged file) and
`dataset_id` (→ the acquired source's own identifier, for accurate provenance)
overridden. Generated `.bnx` files are deterministic apart from the
`generation.generated_at_utc` stamp (which is intentionally outside the
contract hash).

D14 module: **`backend/app/data/updater/`** (`sources.py`, `manifest.py`,
`core.py`, `__main__.py`).

---

## 2. Source discovery

Only official, machine-readable INCOIS services are used — no HTML scraping.

### Temperature + salinity — INCOIS ERDDAP

* Endpoint: `GET https://erddap.incois.gov.in/erddap/info/incois_argo_10day_McCreary/index.json`
* Freshness signal: the `NC_GLOBAL/time_coverage_end` global attribute — the
  nominal date of the newest 10-day objective-analysis step. It advances when
  INCOIS publishes a new step.
* `version_id` = that ISO timestamp (e.g. `2026-07-30T00:00:00Z`). Newer ⇔
  ISO-lexically greater than the installed artifact's `time_coverage.end_iso`.

### Currents — INCOIS THREDDS (IO-HOOFS)

* Endpoint: `GET https://incois.gov.in/thredds/catalog/osf/currents/catalog.xml`
* Freshness signal: the newest `CURRENTS_IO_YYYYMMDD.nc` entry in the catalog
  listing (the `CURRENTS_NIO_*` regional family is excluded). Each entry also
  carries `<date type="modified">` and `<dataSize>`.
* `version_id` = the filename (e.g. `CURRENTS_IO_20260905.nc`). Newer ⇔ its
  embedded `YYYYMMDD` is greater than the installed source file's.

Both checks download only the small catalog / metadata document. The 597 MB
whole forecast file is never downloaded; acquisition uses the D4 NetCDF Subset
Service regional/temporal subset (~24 MB).

Live check result at implementation time:

```
incois_argo_10day_analysis        up to date            (installed 2026-07-30T00:00:00Z == latest)
incois_io_hoofs_surface_currents  NEWER SOURCE AVAILABLE (installed CURRENTS_IO_20260904.nc, latest CURRENTS_IO_20260905.nc,
                                                          source modified 2026-09-05T22:37:07Z)
```

---

## 3. Temperature / salinity update process

`incois_argo_10day_analysis` holds **both** `temperature` (`T_ANALYZED`) and
`salinity` (`S_ANALYZED`) — one source file, one artifact, updated together
(D14 §20). The updater never downloads or processes the Argo source twice.

* This is a periodic **analysis** product, not a live feed. D14 does **not**
  invent a "live temperature" feed.
* `discover_latest()` compares the installed artifact's newest analysis
  timestamp against ERDDAP's `time_coverage_end`.
* `acquire()` reproduces the D4 ERDDAP griddap query for the newest 3 steps:
  `T_ANALYZED[(start):1:(end)][(5.0):1:(2000.0)][(-10):1:(25)][(50):1:(100)]`
  and the same for `S_ANALYZED` (axis order `[time][depth][lat][lon]`).
* Grid, 24 irregular depth levels, units (`degC` / `PSU`), missing values
  (`9999.0` → `null` + `quality 1`) — all handled by the **existing** D7/D8/D9.
  Nothing is regridded, resampled, smoothed or filled.

Freshness wording: **"Latest available INCOIS analysis"** — never "live".

---

## 4. Current update process

`incois_io_hoofs_surface_currents` holds `current_u` (`U`), `current_v` (`V`)
and `current_speed` (`CURRENT`) — one IO-HOOFS forecast file, one atomic update
(D14 §21). `U`, `V` and `CURRENT` always come from the same acquired file, so a
mixed-version vector (`U` new, `V` old) is structurally impossible: the
published `.bnx` has one `provenance.source_file_sha256`.

* This is an **operational model forecast** (ROMS-based IO-HOOFS), not an
  observation and not real-time.
* `discover_latest()` picks the newest `CURRENTS_IO_YYYYMMDD.nc` from the
  THREDDS catalog.
* `acquire()` reproduces the D4 NCSS request:
  `ncss/grid/osf/currents/<file>?var=U&var=V&var=CURRENT&north=25&south=-10&east=100&west=50&time=all&timeStride=10&accept=netcdf3`
* Its **own** grid (≈0.0833°, 421 × 601), surface-only (1 depth level, 0 m),
  4 forecast times — carried through the existing pipeline unchanged. `CURRENT`
  stays authoritative and is never recomputed. Missing cells (`-1e34`) → `null`.

Freshness wording: **"Latest INCOIS IO-HOOFS forecast"** — never "live
observation".

A verified live end-to-end update ran during implementation:
`CURRENTS_IO_20260905.nc` was detected, its 24 MB regional subset downloaded,
run through D7→D8→D9, verified (3 params, 4×1×421×601), and atomically
published to a sandbox — forecast coverage advanced
`2026-09-05→08` → `2026-09-06→09`. The installed `data/bluenexus/` was not
touched by that demonstration.

---

## 5. Commands (CLI)

```bash
# from backend/
python -m app.data.updater --check                        # dry run (default). No download, no writes.
python -m app.data.updater --update                        # controlled update of everything newer
python -m app.data.updater --check  --dataset currents
python -m app.data.updater --update --dataset temperature-salinity
python -m app.data.updater --check  --json                 # machine-readable

# base-URL overrides (testing / mirrors)
python -m app.data.updater --check --thredds-url https://... --erddap-url https://...
```

`--dataset` accepts `all` (default), `temperature-salinity`, `currents`.

Exit codes: `--check` → `0` ok / `2` a source check failed. `--update` → `0` all
ok / `1` at least one dataset failed (the others may still have updated).

### Dry-run / check behaviour (D14 §14)

`--check` (and every code path in `--update` up to "newer source?") only fetches
the small catalog/metadata document. It **never** downloads bulk data, **never**
writes a `.bnx`, and **never** creates a staging file. It records the check
result (`latest_checked`, `newer_available`) in the manifest and prints, e.g.:

```
incois_argo_10day_analysis        up to date
incois_io_hoofs_surface_currents  NEWER SOURCE AVAILABLE
  -> run:  python -m app.data.updater --update  (incois_io_hoofs_surface_currents would update)
```

### Update execution (D14 §15)

`--update` per dataset: check → (if newer) acquire the subset → verify the
download is NetCDF-3 → D7 → D8 → D9 → write `<name>.bnx.updating` → verify the
artifact → `os.replace` → record success → print a concise result. If not
newer: `"up to date"`, the `.bnx` is **not** rewritten.

---

## 6. Atomic publication (D14 §9)

```
data/bluenexus/incois_io_hoofs_surface_currents.bnx            (installed — untouched during generation)
data/bluenexus/incois_io_hoofs_surface_currents.bnx.updating   (new artifact, written + verified here)
        │  os.replace(.bnx.updating, .bnx)   — atomic within the filesystem, POSIX & Windows
        ▼
data/bluenexus/incois_io_hoofs_surface_currents.bnx            (new)
```

A reader (the D10 API's `BnxReader`) always sees either the whole old file or
the whole new file, never a partially written one. The temp file is deleted in
a `finally` block whether the update succeeds or fails, so a partially written
`.bnx.updating` is never left behind and is never served.

---

## 7. Failure behaviour (D14 §24)

Failure at any stage — `discover`, `acquire`, `verify-acquisition`, `ingest`,
`process`, `convert`, `verify-artifact`, `publish`:

* the installed `.bnx` is **not** replaced (it is never opened for writing;
  only the `.updating` temp file is);
* the temp artifact is removed;
* `manifest.datasets.<group>.last_update` is set to
  `{"status": "failed", "stage": "<stage>", "message": "<short reason>"}`;
* the CLI prints the stage + reason and
  `"the previously installed dataset was NOT replaced."`;
* the manifest's `installed` block is **not** modified — it still describes the
  working artifact.

Stack traces are never surfaced through the public API (the D10 error handlers
already guarantee JSON-only error envelopes).

---

## 8. Partial-update behaviour (D14 §25)

The two logical datasets are **independent products**. If
`--update --dataset all` updates temperature/salinity successfully but currents
fails:

```
incois_argo_10day_analysis        -> latest successful version   (published + manifest updated)
incois_io_hoofs_surface_currents  -> previous successful version  (untouched; manifest.last_update = failed)
```

Each dataset's freshness metadata reports its own state accurately. There is no
cross-dataset rollback.

---

## 9. Update manifest / state (D14 §11, §13)

`data/update-state/manifest.json` — small, machine-readable, no DB, no secrets,
no absolute machine paths. Per logical dataset:

```jsonc
{
  "schema": "bluenexus.update-manifest/1",
  "datasets": {
    "currents": {
      "logical_dataset_id": "incois_io_hoofs_surface_currents",
      "product_type": "forecast",
      "source": { "name": "...", "url": "...", "dataset_id": "CURRENTS_IO_20260904.nc" },
      "installed": {
        "source_version": "CURRENTS_IO_20260904.nc",
        "source_time_start": "2026-09-05T01:30:00Z",     // the SCIENCE time
        "source_time_end":   "2026-09-08T19:30:00Z",
        "source_file_sha256": "40d8...",                  // raw source hash
        "source_file_bytes": 24300572,
        "artifact_sha256": "2440...",                     // generated .bnx hash
        "artifact_contract_sha256": "5d31...",
        "acquired_at":  "2026-09-05T18:49:56Z",           // when it was DOWNLOADED
        "published_at": "2026-09-05T20:39:12Z"            // when the .bnx was GENERATED
      },
      "latest_checked": {
        "source_version": "CURRENTS_IO_20260905.nc",
        "checked_at": "2026-09-06T05:58:36Z",             // when we last LOOKED
        "newer_available": true
      },
      "last_update": { "status": "up-to-date", "at": "...", "error": null }
    }
  }
}
```

Three timestamps are kept **strictly distinct** (D14 §11): `source_time_*`
(the science), `acquired_at` (download), `published_at` (artifact generation).
On first run the updater synthesises a `"baseline"` entry from the installed
`.bnx` (its provenance + generation stamp) plus the D4 acquisition timestamps
recorded in `docs/data-acquisition.md`, so freshness is always answerable even
before the first D14 update. Every manifest write is atomic (temp file +
`os.replace`) and happens **only after** a successful publish (or a check /
failure record).

---

## 10. Provenance (D14 §12)

Every successful update preserves provenance:

* in the `.bnx` itself — `provenance`: `source_url`, `source_dataset_id` (the
  acquired file's own id), `source_file_sha256`, `source_file_bytes`,
  `source_file_format`, `conventions`, `pipeline_stages`, `original_units`,
  `canonical_units`; `metadata.time_coverage` (source time); `generation`
  (generator, contract hash, `generated_at_utc`).
* in the manifest — additionally `acquired_at`, `remote_last_modified`,
  `latest_checked`, `artifact_sha256`.

No machine-specific absolute path appears in any API response (the D9 provenance
already exposes only a repo-relative `source_file` / a logical
`source_identifier`; the D10 `_client_provenance` strips the rest).

---

## 11. API freshness visibility (D14 §17, §20)

Additive, non-breaking: `GET /api/datasets` and `GET /api/datasets/{id}` now
include an extra `freshness` object (existing clients ignore unknown fields):

```jsonc
"freshness": {
  "product_type": "forecast",
  "freshness_label": "Latest INCOIS IO-HOOFS forecast",
  "is_real_time": false,                      // ALWAYS false
  "source_name": "INCOIS THREDDS (IO-HOOFS)",
  "source_url": "https://incois.gov.in/thredds/catalog/osf/currents/catalog.html",
  "source_dataset_id": "CURRENTS_IO_20260904.nc",
  "source_version": "CURRENTS_IO_20260904.nc",
  "source_time_start": "2026-09-05T01:30:00Z",
  "source_time_end": "2026-09-08T19:30:00Z",
  "acquired_at": "2026-09-05T18:49:56Z",
  "published_at": "2026-09-05T20:39:12Z",
  "last_checked_at": "2026-09-06T05:58:36Z",
  "latest_available_version": "CURRENTS_IO_20260905.nc",
  "newer_source_available": true,
  "source_file_sha256": "40d8...",
  "artifact_sha256": "2440...",
  "update_status": "up-to-date"
}
```

Values come from the manifest when present, otherwise a `"baseline"` view
derived from the installed `.bnx`. No absolute paths, no secrets, no stack
traces. The existing `/api/datasets` contract, error envelopes, and every slice
/ parameter / coordinate response are unchanged.

---

## 12. Freshness semantics — what "latest" means, and why NOT "real-time"

* **Temperature / salinity**: "latest available INCOIS analysis" = the newest
  10-day Argo objective-analysis step INCOIS has published on ERDDAP. It is a
  periodic analysis product; each timestamp is an analysis reference date, not
  an observation time.
* **Currents**: "latest INCOIS IO-HOOFS forecast" = the newest daily IO-HOOFS
  operational forecast file in the THREDDS catalog. It is a model forecast, not
  an observation.
* `freshness.is_real_time` is **always** `false`. No label anywhere in the
  system says `LIVE`, `REAL-TIME` or `LIVE OBSERVATION`.
* "Latest" is bounded by whatever INCOIS has published **and** by when the
  updater was last run — `last_checked_at` and `published_at` make both
  visible.

---

## 13. Frontend behaviour (D14 §18, §32)

Unchanged. No frontend file was modified for D14.

* The frontend keeps consuming the D10 API exactly as in D12/D13. Its
  providers (`TemperatureDataProvider`, `SalinityDataProvider`,
  `CurrentDataProvider`) already fetch on mount, so a **newly loaded / reloaded
  session automatically receives whatever `.bnx` the API is serving** — no
  code change needed for the frontend to pick up a republished dataset.
* **No polling was added.** There is no `setInterval`, no "refetch every N
  seconds", no background refresh.
* The browser never acquires or processes source data and never downloads raw
  NetCDF — that is entirely backend/data-processing side.
* The `freshness` API field is available for a future minimal "data updated at"
  display; wiring it into the HUD is intentionally left out of D14 to avoid any
  UI change.

A running API process caches its `BnxReader`s at startup, so it serves a
freshly published `.bnx` after the next process start (`uvicorn` restart). This
is deliberate: D14 is *controlled* updating, not hot-swapping.

---

## 14. No automatic scheduler (D14 §16) — and how one could be added later

D14 implements the update **mechanism** only. It adds **no** cron, Windows Task
Scheduler entry, GitHub Actions workflow, cloud scheduler, `setInterval`,
browser polling or background service. A reliable command is sufficient to
prove D14.

A future step (or an operator) could schedule it with any of:

* **cron** (Linux): `17 3 * * *  cd /srv/bluenexus/backend && ./.venv/bin/python -m app.data.updater --update --json >> /var/log/bluenexus-update.log 2>&1`
* **systemd timer**: a `bluenexus-update.service` running the same command + a
  daily `bluenexus-update.timer`.
* **Windows Task Scheduler**: a daily task running
  `backend\.venv\Scripts\python.exe -m app.data.updater --update`.
* **CI** (GitHub Actions `schedule:`): run `--update`, then commit the new
  `data/bluenexus/*.bnx` + `data/update-state/manifest.json` and restart the
  service.

In every case the scheduled job is just the existing `--update` command; the
safety guarantees (atomic publish, fail-safe, per-dataset independence) hold
unchanged. Scheduling is deferred because it is an operational-deployment
concern, not part of proving that controlled updating works, and because the
IO-HOOFS catalog only keeps a rolling ~7-day window — an unattended scheduler
needs a retention/log policy that belongs with deployment.

---

## 15. Validation scope (D14 §23) — D15 stays separate

D14 performs only the **minimal safety checks required before publication**:

* acquired file exists, is non-empty, is NetCDF-3 classic;
* D7 schema checks pass (expected variables/coordinates present, shapes
  consistent) — a dimension-size *difference* from the D4 sample is a warning,
  not a failure;
* the generated `.bnx` is a readable BlueNexus container;
* its `dataset_id` matches the expected logical id;
* it declares parameters, each with all-nonzero dimensions;
* one real `(time, depth)` slice actually reads back;
* latitude/longitude coordinates are present;
* the artifact hash is computable; the manifest is valid JSON.

D14 does **not** do physical-range validation, missing-fraction thresholds,
cross-variable science, source comparison, long-term monitoring or data-quality
reporting — that is **D15**.

---

## 16. Tests

`backend/tests/test_updater.py` — 23 tests, stdlib `unittest`. Deterministic:
every update-pipeline test uses a `FixtureSource` (no network) and the real D4
sample NetCDF files as the "newly acquired" bytes (no fake scientific values).
Controlled fixtures cover: new source, no new source, download failure
(`fail_stage="acquire"`), corrupt acquisition, conversion failure (wrong file
type), publication path.

Covered: source discovery (newer / not newer / per-group ordering / THREDDS XML
parsing / ERDDAP JSON parsing / metadata-failure handling); the pipeline
(acquire → D7 → D8 → D9 → verify → publish, with D7/D8/D9 call assertions and a
`.bnx` round-trip); safety (failed download / corrupt file / failed conversion
all leave the old `.bnx` byte-identical; no temp file left; publication atomic;
manifest written only after a successful publish; `--check` never writes a
`.bnx`); identity/provenance (logical id stable across source versions; source
hash + artifact hash recorded; `acquired_at` distinct from source/publish
times; provenance preserved and names the real source file); combined datasets
(T+S from one artifact; U/V/CURRENT together; no mixed-version currents);
partial update; and **`test_29`** — a real `--check` plus a forced-failure
`--update` against the *real* `data/bluenexus/*.bnx`, asserting every installed
artifact is byte-identical afterwards.

`test_90_live_source_check` hits the real INCOIS ERDDAP + THREDDS services and
is skipped automatically if they are unreachable.

Regression: the full backend suite is **141 tests** (118 D7–D10 baseline + 23
D14), all passing. Frontend `npm test` (43), `npm run build`, `npm run lint`,
and the D12/D13 integration checks are unchanged and green.

---

## 17. What D14 did NOT add

* No scheduler / cron / Task Scheduler / GitHub Actions / cloud scheduler / any
  automatic refresh.
* No frontend polling, no `setInterval`, no UI redesign.
* No `LIVE` / `REAL-TIME` / `LIVE OBSERVATION` labels.
* No second storage format; still `.bnx` via the existing D9 reader/writer.
* No SQLite / PostgreSQL / Supabase / MongoDB / Redis / any database.
* No AWS / Firebase / Docker / Kubernetes / external cloud dependency.
* No chlorophyll (still no verified public machine-readable INCOIS series).
* No new daily dataset IDs — the logical ids `incois_argo_10day_analysis` and
  `incois_io_hoofs_surface_currents` are permanent; only their
  source/version/provenance changes.
* No scientific transformation — grid, dimensions, units, coordinates, depth
  levels, values and missing values are whatever D7/D8/D9 already produce.
* No D15 validation framework.
