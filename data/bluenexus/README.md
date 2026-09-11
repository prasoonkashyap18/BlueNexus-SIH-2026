# `data/bluenexus/` — D9 BlueNexus-format artifacts

This directory holds **D9 (Convert Data to a BlueNexus-Friendly Format)**
output. It is *derived* from [`../raw/`](../raw/) via the D7 → D8 → D9 pipeline
and can be regenerated at any time:

```bash
cd backend
./.venv/Scripts/python.exe -m app.data.bluenexus
```

## What lands here

| File | Contents |
| --- | --- |
| `incois_argo_10day_analysis.bnx` | Temperature + salinity BlueNexus dataset (`temperature`, `salinity`) |
| `incois_io_hoofs_surface_currents.bnx` | Surface-current BlueNexus dataset (`current_u`, `current_v`, `current_speed`) |

The `.bnx` files are **git-ignored** (the currents bundle is ~27 MB and both
carry a generation timestamp). This README is tracked.

## The `.bnx` container

A dependency-free binary container (see `docs/data-format.md` for the full
rationale and schema):

```
magic          12 bytes   b"BLUENEXUS/1\n"
manifest_len    8 bytes    uint64 little-endian
manifest       <len>       UTF-8 JSON: { contract, arrays_index, generation }
blobs          rest        little-endian float64 `values` + uint8 `quality`, per parameter
```

* `manifest.contract` — the **deterministic** scientific contract (schema,
  parameters, dimensions, coordinates, metadata, provenance). A pure function
  of the D8 cleaned data; no timestamps, no absolute paths.
* `manifest.generation` — non-deterministic bookkeeping (`generated_at_utc`,
  `contract_sha256`); **not** part of the contract.
* `blobs` — the bulk arrays. Missing cells are IEEE-754 **NaN** in `values` and
  `1` in `quality` (0 = VALID). Source sentinels (`9999.0`, `-1e34`) never
  appear.

Read it in Python with `app.data.bluenexus.read_bluenexus(path)` (or just the
header with `read_manifest(path)`); a browser can parse the header + JSON and
wrap each blob in a `Float64Array` / `Uint8Array`.

## What D9 does / does not do

D9 relabels D8's cleaned variables to canonical parameter ids, copies
coordinates **verbatim** (the current grid is **not** regenerated as `1/12°`),
adds ISO-8601 UTC time strings, and assembles explicit metadata + provenance.
**D9 does not regrid, interpolate, smooth, resample, merge grids, merge time
systems, or change scientific values, and it does not provide an API.**

**Raw files in `../raw/` are never written to.** `write_bluenexus()` refuses any
path under `data/raw/`.

Chlorophyll remains pending official INCOIS access clarification and is **not**
present or substituted.
