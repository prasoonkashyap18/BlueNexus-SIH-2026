# Provenance — `temperature_cmems_glorys12v1_arabiansea.nc`

Real ocean‑**model** potential‑temperature subset, preserved **exactly as
downloaded** (no rescale / regrid / interpolate / smooth / resample — those
belong to later steps). Downloaded with the Copernicus Marine Toolbox; the
toolbox does not surface raw HTTP headers, so this sidecar is the acquisition
record (there is no `.headers.txt`).

## Identity

| | |
| --- | --- |
| Model | **MERCATOR GLORYS12V1** — Global Ocean Physics Reanalysis (1/12°, "GL12") |
| Distributor | **Copernicus Marine Service (CMEMS)** — <https://marine.copernicus.eu/> |
| Producer | Mercator Ocean International — <http://www.mercator-ocean.fr> |
| Product | `GLOBAL_MULTIYEAR_PHY_001_030` — "Global Ocean Physics Reanalysis" (processing level L4, source "Numerical models") |
| **Dataset ID** | **`cmems_mod_glo_phy_my_0.083deg_P1D-m`** (dataset version `202311`, part `default`) |
| **DOI / citation** | **`https://doi.org/10.48670/moi-00021`** — E.U. Copernicus Marine Service Information; Global Ocean Physics Reanalysis (GLORYS12V1). |
| Variable | **`thetao`** — `standard_name = sea_water_potential_temperature`, `units = degrees_C` |
| Retrieval tool | Copernicus Marine Toolbox **`copernicusmarine` v2.4.1** (installed into `backend/.venv` only — not global, not a runtime requirement) |
| Download date | **2026‑09‑08** |
| Downloaded by | project account (Copernicus Marine login) |

**This is NOT INCOIS‑generated data.** It is a Mercator Ocean / Copernicus
Marine numerical‑model reanalysis product. It is used only as the *model* side of
the (later) model‑vs‑observation workflow and is kept entirely separate from the
INCOIS `.bnx` datasets and the INCOIS Argo / glider observations.

## Request (what was asked for)

| Parameter | Requested |
| --- | --- |
| variable | `thetao` |
| longitude | 61.5 → 70.0 °E |
| latitude | 8.0 → 20.5 °N |
| time | 2025‑03‑24T00:00:00 → 2025‑04‑02T00:00:00 |
| depth | 0 → 600 m |
| coordinates selection | `inside` (strictly within bounds; no snapping outside) |

Toolbox call (Python API, equivalent CLI in `docs/glorys-model-temperature.md`):
`copernicusmarine.subset(dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
variables=["thetao"], minimum_longitude=61.5, maximum_longitude=70.0,
minimum_latitude=8.0, maximum_latitude=20.5, minimum_depth=0, maximum_depth=600,
start_datetime="2025-03-24T00:00:00", end_datetime="2025-04-02T00:00:00",
coordinates_selection_method="inside", …)`

## Result (what was actually returned — verbatim from the file)

| Coordinate | Actual returned extent | Count |
| --- | --- | --- |
| longitude | **61.5000 → 70.0000 °E** (native 1/12°, exactly on k/12) | **103** |
| latitude | **8.0000 → 20.5000 °N** (native 1/12°) | **151** |
| time | **2025‑03‑24 → 2025‑04‑02**, daily means, spacing exactly 1 day | **10** |
| depth | **0.49402 → 541.08893 m**, `positive = down` — the **native GLORYS12V1 top 32 levels**, unchanged (0 → 600 m request returns levels ≤ 541.089 m) | **32** |

`thetao` shape `(time 10, depth 32, latitude 151, longitude 103)` =
**4 976 960 grid cells**.

| Property | Value |
| --- | --- |
| File format | NetCDF‑4 / HDF5, `Conventions = CF-1.4` |
| **File size** | **9 978 696 bytes** (9.52 MiB) |
| **SHA‑256** | **`08aee6649b2dbfa34a1a553310ae02902c27c5bbcfcb4afba8fa5e1370ecd1ea`** |
| `thetao` storage | packed **`int16`**, `scale_factor ≈ 7.324442e-04`, `add_offset = 21.0`, `_FillValue = -32767` |
| Decoded (CF mask‑and‑scale, in memory only) | **`float64`, `degrees_C`** |
| Missing cells | **11 670 / 4 976 960 (0.23 %)** — land / below‑seafloor mask near the coasts; raw `_FillValue` count matches the decoded NaN count exactly |
| Finite cells | 4 965 290 (99.77 %) |
| **Decoded temperature range** | **10.0697 °C … 30.6998 °C** (mean 24.45; surface mean 28.65 °C, 541 m mean 11.78 °C) |
| Stale global attrs | `bulletin_date` 2021‑07‑07, `field_date` 2021‑06‑30, `history` 2023‑06‑01 — CMEMS template boilerplate; the **authoritative dates are the `time` coordinate** (2025‑03‑24…04‑02) |

## Relationship to the tiny validation sample

`temperature_cmems_glorys12v1_sample.nc` (SHA‑256 `ab79f439…cffede994`,
13×13×31×1) is the **same product** (`cmems_mod_glo_phy_my_0.083deg_P1D-m`,
`source = "MERCATOR GLORYS12V1"`, identical `scale_factor` / `add_offset` /
`_FillValue`, identical native grid & depth levels). Verified: in the overlapping
region (19–20 °N, 64–65 °E, 31 levels, 2025‑03‑31) the two files hold
**bit‑identical `thetao` values** (max |difference| = 0.0 over 5 239 cells). They
differ only in spatial / depth / time extent. The tiny sample is **preserved
unchanged**.

## Observation overlap (space + time; NO comparison computed)

Designed to overlap 4 real INCOIS Argo profiles — all inside the box and the
10‑day window:

| Argo profile | Lat | Lon | Date | In box | In window |
| --- | --- | --- | --- | --- | --- |
| `3902669_4` | 19.667 °N | 64.650 °E | 2025‑03‑31 | ✓ | ✓ |
| `5907180_3` | 16.533 °N | 68.667 °E | 2025‑03‑26 | ✓ | ✓ |
| `5907179_3` | 12.317 °N | 68.150 °E | 2025‑03‑28 | ✓ | ✓ |
| `6990715_3` | 9.400 °N | 68.450 °E | 2025‑04‑01 | ✓ | ✓ |

Model‑vs‑observation extraction / differencing is **Step 43+**, not done here.

## Usage in BlueNexus

Served through the existing Step 37–39 scientific / NetCDF layer at `/api/netcdf`
as dataset id **`glorys12v1_model`**, identity **`GLORYS12V1 / Copernicus
Marine`**, CF‑decoded to `degrees_C`. It is the **default** model file
(`backend/app/api/config.py` → `MODEL_NETCDF_FILENAME`); the tiny sample is the
fallback. Dimensions and coverage are always read from the file — nothing is
hard‑coded to a subset size. Not part of the `.bnx` pipeline; does not touch the
INCOIS temperature / salinity / current / Argo / glider datasets.
