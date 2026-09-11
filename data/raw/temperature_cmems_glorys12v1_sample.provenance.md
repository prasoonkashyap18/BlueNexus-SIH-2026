# Provenance — `temperature_cmems_glorys12v1_sample.nc`

Real ocean-**model** potential-temperature file, preserved **exactly as received**
(no rescale / regrid / rename / unit-convert / fill-removal — those belong to
later steps). This sidecar stands in for the usual `.headers.txt` / `.query.txt`:
the file was retrieved with the Copernicus Marine toolbox, which does not surface
raw HTTP response headers, and the exact toolbox command line was not captured.

## Identity

| | |
| --- | --- |
| Model | **MERCATOR GLORYS12V1** — Global Ocean Physics (1/12°, "GL12") |
| Distributor | **Copernicus Marine Service (CMEMS)** — <https://marine.copernicus.eu/> |
| Producer | Mercator Ocean International — <http://www.mercator-ocean.fr> |
| Retrieval tool | `copernicusmarine` toolbox **v2.4.1** (from the file's `copernicusmarine_version` global attribute) |
| Product family | GLORYS12V1 daily-mean fields (file `title` = "daily mean fields from Global Ocean Physics Analysis and Forecast updated Daily"; `source` = "MERCATOR GLORYS12V1") |
| Local path | `data/raw/temperature_cmems_glorys12v1_sample.nc` |
| Bytes | 35,292 |
| Format | NetCDF-3 classic, `Conventions = CF-1.4` |
| **SHA-256** | `ab79f4394c5e6fd35bd205185831fb5ed45e8730f8d6589573e1cd9cffede994` |
| Validated | Step 42 (BlueNexus), 2026-09-08 — see `docs/glorys-model-temperature.md` |
| Downloaded to | `C:\copernicus\glorys_test.nc` (user), copied verbatim into `data/raw/` |

## Contents (verbatim)

| Variable | dims | dtype (on disk) | units | notes |
| --- | --- | --- | --- | --- |
| `thetao` | `time, depth, latitude, longitude` = `1, 31, 13, 13` | **`int16` packed** | `degrees_C` | `standard_name = sea_water_potential_temperature`; `scale_factor ≈ 7.324442e-04`, `add_offset = 21.0`, `_FillValue = -32767`; `valid_min/valid_max = -32766/21306` (packed units) |

| Coordinate | range | notes |
| --- | --- | --- |
| `time` | **2025-03-31 00:00:00 UTC** (1 step) | `hours since 1950-01-01`, gregorian; **authoritative** — the global `bulletin_date` (2021-07-07), `field_date` (2021-06-30) and `history` (2023-06-01) are stale CMEMS template attributes and must not be used as the data date |
| `depth` | **0.494 → 453.938 m**, 31 levels | `positive = down`, `units = m`, `axis = Z` |
| `latitude` | **19.0 → 20.0 °N**, 13 pts (~1/12°) | `units = degrees_north` |
| `longitude` | **64.0 → 65.0 °E**, 13 pts (~1/12°) | `units = degrees_east` |

Spatial box: **NE Arabian Sea, 19–20 °N / 64–65 °E** — a 1°×1° **validation
subset**, not basin-wide.

## Validation summary (Step 42, read-only)

- Opens cleanly with the project's xarray / netCDF4 stack (no errors/warnings of concern).
- `thetao` is real GLORYS potential temperature (`standard_name`, `source`, native packing & grid).
- CF-decoded (`scale_factor` / `add_offset`, `_FillValue → NaN`): **12.872 – 27.870 °C**,
  **100 % finite** in this subset (no land / below-seafloor cells), physically plausible for the
  region and season (warm ~28 °C surface, ~13 °C by 450 m).
- Raw file is **not modified** by the backend — decoding is in-memory only.

## Usage in BlueNexus

Served through the existing Step 37–39 scientific / NetCDF layer at `/api/netcdf`
as dataset id **`glorys12v1_model`**, identity **`GLORYS12V1 / Copernicus
Marine`**, CF-decoded to `degrees_C`. Config default in `backend/app/api/config.py`
(`MODEL_NETCDF_FILENAME`, `MODEL_NETCDF_DATASET_ID`, `MODEL_NETCDF_CF_DECODE`,
`MODEL_SOURCE_LABEL`). Not part of the `.bnx` pipeline; does not touch the INCOIS
temperature / salinity / current / Argo / glider datasets.
