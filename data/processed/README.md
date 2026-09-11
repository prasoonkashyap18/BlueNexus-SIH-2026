# `data/processed/` — D8 intermediate artifacts

This directory holds **D8 (Process & Clean the Data)** output. It is *derived*
from the raw INCOIS files in [`../raw/`](../raw/) and can be regenerated at any
time:

```bash
cd backend
./.venv/Scripts/python.exe -m app.data.processing
```

## What lands here

| File | Contents |
| --- | --- |
| `incois_argo_10day_analysis.d8.json` | Manifest for the cleaned temperature + salinity dataset |
| `incois_io_hoofs_surface_currents.d8.json` | Manifest for the cleaned surface-current dataset |

Each `*.d8.json` is a **metadata + diagnostics manifest only** — provenance back
to the raw file, dimensions, coordinate summaries, per-variable missing-value
policy, range diagnostics, and (for currents) the `CURRENT` vs `sqrt(U²+V²)`
consistency diagnostic. **It does not contain the bulk scientific arrays.** The
full cleaned arrays live in memory as
`app.data.processing.CleanedDataset` objects and are handed to **D9** directly.

The `*.d8.json` files are git-ignored (they carry a `processed_at_utc`
timestamp and are cheap to regenerate). This README is tracked.

## What D8 does / does not do

D8 preserves every valid value exactly (float32 → float64 is lossless), maps
every missing cell to canonical IEEE **NaN** plus a `VALID`/`MISSING` quality
byte, and copies coordinates verbatim. **D8 does not regrid, interpolate,
smooth, resample, extrapolate, merge grids, clip, or replace missing ocean
values.** It does not build the BlueNexus format — that is D9. See
[`../../docs/data-processing.md`](../../docs/data-processing.md).

**Raw files in `../raw/` are never written to.** D8 verifies their SHA-256
hashes are unchanged.

Chlorophyll remains pending official INCOIS access clarification and is **not**
processed or substituted here.
