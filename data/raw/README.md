# `data/raw/` — Raw acquired ocean datasets (Data Track D4)

These files are **real data downloaded from official / authoritative public services** (INCOIS,
and — where INCOIS has no suitable machine-readable feed — the relevant international data
assembly centre), preserved here **exactly as received**. They must not be rescaled, regridded,
renamed, unit-converted, or have missing values removed — those operations belong to later Data
Track steps (D5+).

Full provenance (source, endpoint, exact query, verification results) is in
[`../../docs/data-acquisition.md`](../../docs/data-acquisition.md).

| File | Parameter(s) | Source | Bytes | SHA-256 (short) |
| --- | --- | --- | --- | --- |
| `temperature_salinity_incois_argo_sample.nc` | Temperature, Salinity | INCOIS ERDDAP — `incois_argo_10day_McCreary` | 1,062,744 | `17f5caa8…bb6c9e6d` |
| `currents_incois_io-hoofs_sample.nc` | Surface ocean currents (U, V, speed) | INCOIS THREDDS — `osf/currents/CURRENTS_IO_20260904.nc` (IO-HOOFS) | 24,300,572 | `40d8cdce…c0d5ba7d` |
| `temperature_cmems_glorys12v1_sample.nc` | Ocean **model** potential temperature (`thetao`) — tiny validation sample | Copernicus Marine — MERCATOR **GLORYS12V1** (`source = "MERCATOR GLORYS12V1"`, `domain_name = "GL12"`), via the `copernicusmarine` toolbox | 35,292 | `ab79f439…cffede994` |
| `temperature_cmems_glorys12v1_arabiansea.nc` | Ocean **model** potential temperature (`thetao`) — Arabian Sea subset (Step 42 expansion) | Copernicus Marine — `GLOBAL_MULTIYEAR_PHY_001_030` / **`cmems_mod_glo_phy_my_0.083deg_P1D-m`** (GLORYS12V1 reanalysis), DOI `10.48670/moi-00021`, via `copernicusmarine` v2.4.1 | 9,978,696 | `08aee664…70ecd1ea` |
| `argo_profiles_incois_indian_argo_floats_sample.csv` | Argo float profiles (PRES, TEMP, PSAL + QC) — observation panel | INCOIS ERDDAP — `Indian_ARGO_Floats` (tabledap CSV) | 158,059 | `5ec0d432…f0da5979` |
| `glider_ego_oceangliders_gdac_sample.csv` | Underwater-glider trajectories (PRES, TEMP, PSAL + QC) — observation panel | EGO / OceanGliders GDAC — `OceanGlidersGDACTrajectories` via IFREMER ERDDAP (tabledap CSV) | 668,767 | `3ec6aecf…21017643` |

`*.headers.txt` — the raw HTTP response headers captured at download time (acquisition evidence).
`*.query.txt` — the exact request URL(s) used (Argo, glider snapshots).

**Re-acquisition note:** the ERDDAP temperature/salinity subset is reproducible at any time (it is
a stable historical analysis). The IO-HOOFS current source file `CURRENTS_IO_20260904.nc` sits on a
rolling ~7-day window on the INCOIS THREDDS catalog and will be removed from the server around
**2026-09-11**; after that this exact forecast file cannot be re-downloaded (a newer daily forecast
file would be used instead).

**Argo snapshot (Step 28):** `argo_profiles_incois_indian_argo_floats_sample.csv` is the INCOIS
ERDDAP `Indian_ARGO_Floats` tabledap CSV, constrained to the Indian-Ocean box (lat −15…30,
lon 45…100) over **2025-03-25 → 2025-04-23** (the last month of the public mirror's coverage; that
feed lags the live Argo array by ~16 months). It holds **17 real float profiles from 11 real floats**
(PROVOR_III / ARVOR), 1,643 measured levels. `time`, `latitude`, `longitude`, `PRES`, `TEMP`, `PSAL`
and the per-level `*_QC` flags are verbatim; the Argo `_FillValue` (99999) is preserved as-is in the
file. The constrained query is stable and re-runnable; the full URL is in the `.query.txt` file.

**Glider snapshot (Step 29):** `glider_ego_oceangliders_gdac_sample.csv` is the
`OceanGlidersGDACTrajectories` tabledap CSV from the **EGO / OceanGliders GDAC** (the international
glider Global Data Assembly Centre, hosted at IFREMER/Coriolis) — INCOIS has **no** machine-readable
glider feed (verified: its ERDDAP returns nothing for "glider", and the D2/D3 source survey lists
none). It holds **two real deployments in the INCOIS domain**: `sea057_20220707` (SeaExplorer, Gulf
of Oman / N Arabian Sea, 2022-07-03 → 2022-07-09, 2,740 CTD samples, EGO QC populated) and
`Bellatrix_368` (Slocum, central Bay of Bengal, 2016 ASIRI/OMM campaign, 2016-07-06 00–06 UTC,
3,296 samples). `time`, `latitude`, `longitude`, `PRES`, `TEMP`, `PSAL` and the `*_QC` flags are
verbatim; ERDDAP renders missing values as `NaN` (EGO `_FillValue` 99999) and these are preserved
as-is in the file. **This GDAC is a delayed-mode / NRT assembly centre, not a live feed.** Full URLs
in the `.query.txt` file.

**GLORYS12V1 model temperature (Step 42):** `temperature_cmems_glorys12v1_sample.nc` is a real
**MERCATOR GLORYS12V1** ocean-model file from **Copernicus Marine (CMEMS)**, downloaded with the
`copernicusmarine` toolbox (v2.4.1, per the file's `copernicusmarine_version` global attribute) and
preserved here **exactly as received** — packed `int16` and all. It is the model temperature source
for Step 42 (INCOIS has no suitable machine-readable model-temperature feed; the IO-HOOFS file above
is surface currents only, and the INCOIS Argo analysis is an observation analysis, not a model).
Sidecar: `temperature_cmems_glorys12v1_sample.provenance.md` (no `.headers.txt` — the toolbox does
not expose raw HTTP headers; no `.query.txt` — the exact toolbox command was not captured).

- **Variable:** `thetao` — `standard_name = sea_water_potential_temperature`, `units = degrees_C`.
- **Native storage:** packed `int16` with `scale_factor ≈ 7.324442e-04`, `add_offset = 21.0`,
  `_FillValue = -32767`. The file is **not** decoded on disk; the backend CF-decodes it in memory
  (`app/api/config.py` `MODEL_NETCDF_CF_DECODE = True`) so `/api/netcdf` serves real `degrees_C`.
- **Extent (this subset):** `time = 1` step at **2025-03-31 00:00 UTC** (the decoded `time`
  coordinate — the stale global `bulletin_date` / `field_date` of 2021 are template boilerplate and
  are ignored); `depth = 31` levels **0.494 → 453.938 m** (`positive = down`); `latitude = 13` pts
  **19.0 → 20.0 °N**; `longitude = 13` pts **64.0 → 65.0 °E** (native GLORYS 1/12° grid). A small
  **validation subset**, not basin-wide coverage.
- **Values:** verbatim. `time`, `depth`, `latitude`, `longitude`, `thetao` and all attributes are
  preserved as-is. Decoded temperature range **12.872 – 27.870 °C**; this subset has **no** fill
  cells (all open ocean, above the seafloor).
- **SHA-256:** `ab79f4394c5e6fd35bd205185831fb5ed45e8730f8d6589573e1cd9cffede994` (validated Step 42).
- **Re-acquisition:** GLORYS12V1 is a stable published reanalysis product; an equivalent
  `thetao` subset for this box/date is reproducible from Copernicus Marine at any time (account
  required).

**GLORYS12V1 Arabian Sea subset (Step 42 data-coverage expansion):**
`temperature_cmems_glorys12v1_arabiansea.nc` is the **same product** as the tiny sample above —
MERCATOR **GLORYS12V1** reanalysis, Copernicus Marine product `GLOBAL_MULTIYEAR_PHY_001_030`,
dataset **`cmems_mod_glo_phy_my_0.083deg_P1D-m`** (version `202311`), **DOI `10.48670/moi-00021`** —
downloaded with the `copernicusmarine` toolbox v2.4.1 on **2026-09-08** and preserved verbatim.
Full acquisition record: `temperature_cmems_glorys12v1_arabiansea.provenance.md`. **This is NOT
INCOIS-generated data** — it is a Mercator Ocean / Copernicus Marine numerical-model reanalysis.

- **Requested:** `thetao`, lon 61.5→70.0 °E, lat 8.0→20.5 °N, 2025-03-24→2025-04-02, depth 0→600 m,
  `coordinates_selection_method="inside"`.
- **Returned (verbatim):** lon 61.5→70.0 °E (**103** pts), lat 8.0→20.5 °N (**151** pts), all on the
  native GLORYS 1/12° grid; **10** daily-mean time steps 2025-03-24→2025-04-02; depth
  0.494→541.089 m = the **native GLORYS12V1 top 32 levels** (no regrid, no interpolation, no
  resampling). `thetao` shape `(10, 32, 151, 103)` = **4,976,960 cells**.
- **Storage:** packed `int16` (`scale_factor ≈ 7.324442e-04`, `add_offset = 21.0`,
  `_FillValue = -32767`); CF-decoded in memory by the backend to real `degrees_C`.
- **Missing:** 11,670 cells (0.23 %) — coastal land / below-seafloor mask; raw `_FillValue` count
  equals the decoded NaN count.
- **Decoded temperature range:** **10.070 – 30.700 °C**.
- **Bytes:** 9,978,696 · **SHA-256:** `08aee6649b2dbfa34a1a553310ae02902c27c5bbcfcb4afba8fa5e1370ecd1ea`.
- **Same-product check:** in the overlap with the tiny sample (19–20 °N, 64–65 °E, 31 levels,
  2025-03-31) the two files hold **bit-identical `thetao` values**.
- **Observation overlap:** contains 4 real INCOIS Argo profiles — `3902669_4`, `5907180_3`,
  `5907179_3`, `6990715_3` — inside the box and the 10-day window (no comparison computed; Step 43+).
