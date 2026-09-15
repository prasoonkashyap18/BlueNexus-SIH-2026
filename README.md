# INCOIS Ocean 3D Visualization Platform ("BlueNexus")rajat :

**Smart India Hackathon 2026 — INCOIS problem statement.**

An interactive 3D web platform for exploring **real** operational ocean data for the
Indian Ocean: numerical-model fields, in-situ observations, and a side-by-side
**model-vs-observation temperature comparison**. Every value shown comes from an
official / authoritative public dataset — nothing is synthetic, and missing data is
shown as missing rather than filled.

---

## What problem it solves?

INCOIS publishes ocean analyses, forecasts and observations through several separate
services (ERDDAP, THREDDS) in formats (NetCDF, tabledap CSV) that are not directly
usable in a browser. Model output and in-situ profiles live in different places and are
hard to look at together. BlueNexus:

- ingests those real sources once, preserving them verbatim, and serves them through one
  small read-only REST API;
- renders a depth/time-navigable **3D ocean volume** (temperature, salinity, surface
  currents) with scientifically honest colour mapping and a real lat/lon graticule;
- overlays real **Argo float** and **underwater-glider** positions, with measured
  temperature / salinity depth profiles on selection;
- computes, for a selected Argo float, the **GLORYS12V1 model temperature minus the
  Argo observed temperature** at the model's nearest native cell/day and native depth
  levels, with mean / MAE / RMSE statistics and an explicit methodology note.

---

## Main features

| Area | Feature |
| --- | --- |
| 3D scene | Depth-sliced ocean volume; time axis; variable switch (temperature / salinity / surface current); real lat/lon graticule labels; single WebGL canvas |
| Observations | Real Argo float + glider markers; click to select; measured temperature and salinity vs pressure profiles (native levels, no interpolation/smoothing) |
| Model comparison | GLORYS12V1 `thetao` vs Argo observed temperature, per native GLORYS depth; signed difference profile; mean / MAE / RMSE; coverage + methodology disclosure |
| Provenance | `/api/sources` catalogue and an in-app "Data Source" panel — every dataset's identity, type (analysis / forecast / reanalysis / observation) and attribution |
| Robustness | Application-level React error boundary with a safe recoverable fallback; per-panel data-failure states with scoped retry; no mock-data fallback on error |

---

## Technology

**Frontend**

- React 19 + TypeScript, built with Vite
- Three.js via `@react-three/fiber` and `@react-three/drei` for the 3D scene
- No global state library — scoped React context providers
- Tests: Node's built-in test runner (`node --test`) over pure-logic modules

**Backend / scientific stack**

- Python + FastAPI + Uvicorn (ASGI), read-only REST
- `xarray` + `netCDF4` for NetCDF ingestion and the scientific data layer
- `numpy` for array handling; `gsw` (TEOS-10) for the Argo pressure → depth conversion
  used only by the model-vs-observation comparison
- Datasets are ingested to an internal `.bnx` container format; the API only ever reads
  the loaded containers and observation snapshots — it never opens raw NetCDF per request
  and never regrids, interpolates or merges anything

---

## Real-data architecture

```
official INCOIS / international source
        │  (downloaded once, preserved verbatim under data/raw/)
        ▼
   ingestion → cleaning → BlueNexus .bnx container         in-situ snapshots (CSV)
        │                                                          │
        ▼                                                          ▼
                 FastAPI read-only REST API  (/api/*)
                        │
                        ▼
        Vite/React frontend  ──(VITE_API_BASE_URL)──▶  the API
                        │
                        ▼
             Three.js 3D scene + panels
```

Key API namespaces (all `GET`, read-only):

| Path | Serves |
| --- | --- |
| `/api/health` | Liveness + dataset availability |
| `/api/datasets…` | Gridded dataset metadata + one lat×lon slice per parameter/time/depth |
| `/api/observations/argo…`, `/api/observations/gliders…` | Real Argo / glider platforms, profiles, trajectories |
| `/api/netcdf…` | Read-only view of the one configured model NetCDF file (GLORYS12V1 `thetao`) |
| `/api/model-observations/argo/{id}/…` | Model temperature column at an Argo location; model−observation temperature comparison |
| `/api/sources` | Data-source / provenance catalogue |

Contract guarantees: missing values are JSON `null` (never a sentinel); units are
canonical (`degC`, `PSU`, `m s-1`; observation pressure in `decibar`); timestamps are
verbatim ISO-8601 UTC; datasets are labelled `analysis` / `forecast` / `reanalysis`,
never "real-time"; every error is a single `{"error": {...}}` envelope with no traceback
or server path.

---

## Data sources

Full provenance — endpoints, exact queries, checksums, verification — is in
[`docs/data-acquisition.md`](docs/data-acquisition.md) and
[`data/raw/README.md`](data/raw/README.md). All raw files under `data/raw/` are preserved
**exactly as received**.

| Dataset | Provider | Role |
| --- | --- | --- |
| **INCOIS Ocean Analysis** (Argo objective analysis, via INCOIS ERDDAP) | **INCOIS** | Gridded temperature & salinity |
| **INCOIS IO-HOOFS** surface currents (via INCOIS THREDDS) | **INCOIS** | Gridded surface currents (U, V, speed) — forecast |
| **INCOIS `Indian_ARGO_Floats`** (INCOIS ERDDAP tabledap) | **INCOIS** | Real Argo float profiles (observations) |
| **EGO / OceanGliders GDAC** `OceanGlidersGDACTrajectories` (via IFREMER/Coriolis ERDDAP) | **OceanGliders / IFREMER** — *not INCOIS* | Real underwater-glider trajectories (INCOIS publishes no machine-readable glider feed) |
| **MERCATOR GLORYS12V1** ocean reanalysis, potential temperature `thetao` — product `GLOBAL_MULTIYEAR_PHY_001_030`, dataset `cmems_mod_glo_phy_my_0.083deg_P1D-m`, DOI `10.48670/moi-00021` | **Copernicus Marine Service (CMEMS) / Mercator Ocean** — *not INCOIS* | Numerical **model** temperature used for the model-vs-observation comparison |

> **GLORYS12V1 is a Copernicus Marine / Mercator Ocean product, not an INCOIS model.**
> It is used only because INCOIS has no suitable machine-readable model-temperature feed
> (IO-HOOFS is surface currents only; the INCOIS Argo analysis is an observational
> analysis, not a model). The UI attributes it to *Copernicus*, never to INCOIS.

### Model-vs-observation comparison

For a selected Argo float, the backend extracts the GLORYS12V1 `thetao` column at the
**nearest native GLORYS grid cell and nearest daily-mean timestep** (no spatial or
temporal interpolation), converts Argo pressure to depth with TEOS-10
(`gsw.z_from_p`), matches each GLORYS native depth to the nearest Argo level within half
the local GLORYS layer spacing, and reports `difference = model − observed` per depth
plus mean / MAE / RMSE. This is a **consistency comparison against a reanalysis**, not a
validation against a simultaneous co-located instrument — the UI states this explicitly.

---

## Local development setup

**Prerequisites**

- Node.js 20+ (developed on v24)
- Python 3.12+ (developed on 3.14)

**Frontend**

```bash
cd frontend
npm install            # first time only
npm run dev            # dev server at http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`, `npm test`.

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload        # http://localhost:8000  (docs at /docs)
```

The backend loads the `data/raw/` snapshots on startup and builds the `.bnx` containers
on first run. With both servers running, the frontend at `:5173` talks to the API at
`:8000` (its development default).

**Tests**

```bash
cd frontend && npm test          # frontend logic tests
cd backend  && pytest -q         # backend tests
```

---

## Production / deployment architecture (high level)

BlueNexus deploys as two independent pieces:

1. **Static frontend** — `cd frontend && npm run build` produces a static bundle in
   `frontend/dist/` that any static host / CDN can serve. The API location is **not**
   baked in: set `VITE_API_BASE_URL` to the deployed backend's URL at build time
   (see `frontend/.env.example`). Only `VITE_`-prefixed variables reach the bundle, and
   the API URL is a plain URL, never a secret.

2. **Backend API** — run `uvicorn main:app` (or any ASGI server) behind a reverse proxy.
   Every setting has a safe default and an environment-variable override; nothing needs
   editing to deploy. The ones a deployment normally sets:

   | Variable | Purpose |
   | --- | --- |
   | `BLUENEXUS_CORS_ORIGINS` | Comma-separated exact browser origin(s) of the deployed frontend. **Required in production** — `*` is rejected at startup. |
   | `BLUENEXUS_DATA_DIR` | Directory holding the `.bnx` containers (default: `data/bluenexus`) |
   | `BLUENEXUS_NETCDF_PATH` | Model NetCDF file for `/api/netcdf` (default: the GLORYS12V1 file in `data/raw/`) |
   | `BLUENEXUS_ARGO_RAW_CSV`, `BLUENEXUS_GLIDER_RAW_CSV` | Override the observation snapshot paths |
   | `BLUENEXUS_BUILD_ON_STARTUP` | Build missing `.bnx` from source at startup (default on) |

   The `data/raw/` scientific snapshots must be present on the backend host for the API
   to serve data; they are committed to this repository for reproducibility.

No database, no authentication layer, and no per-request file I/O beyond a bounded
partial read of one `.bnx` plane.

---

## Repository layout

```
INCOIS-Ocean-Visualization/
├── frontend/          # React + Vite + TypeScript + Three.js
├── backend/           # FastAPI app, scientific data layer, ingestion pipeline
├── data/
│   ├── raw/           # real source snapshots, preserved verbatim (tracked)
│   ├── processed/     # derived pipeline artifacts (git-ignored, regenerated)
│   └── bluenexus/     # .bnx containers (git-ignored, regenerated)
└── docs/              # data acquisition, provenance, and per-step design notes
```

Deployment pipeline verified via GitHub → Vercel.
