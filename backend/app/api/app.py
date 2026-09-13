"""FastAPI application factory for the production data API.

Assembles the app the historical ``main:app`` entry point re-exports:

* the preserved ``GET /api/health`` (with a typed ``data_layer`` block),
* the BlueNexus gridded-dataset endpoints (``/api/datasets`` ...),
* the in-situ observation endpoints (``/api/observations/argo|gliders`` ...),
* CORS driven by config (``BLUENEXUS_CORS_ORIGINS``), never ``*``,
* a single JSON error envelope for every failure (no tracebacks, no paths),
* Step 57: a CDN `Cache-Control` header on immutable GET responses (see
  ``app/api/caching.py``) -- headers only, no response body is affected.

The BlueNexus catalog and the Argo / glider snapshots are loaded once on
startup. Routes only ever read the loaded D9 ``.bnx`` containers and the loaded
observation snapshots -- never the raw NetCDF, and never per-request file I/O
beyond a bounded partial read of one ``.bnx`` plane.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from ..services.catalog import init_catalog
from ..services.netcdf_service import build_netcdf_service
from ..services.observations import init_argo_catalog, init_glider_catalog
from .caching import apply_immutable_response_headers, is_immutable_get_path
from .config import ApiConfig
from .errors import install_error_handlers
from .routes import api_router

API_DESCRIPTION = """
Read-only HTTP access to the **INCOIS Ocean Visualization** real datasets.

**Gridded model fields** (`/api/datasets`): temperature and salinity
(objective analysis) and IO-HOOFS surface currents (forecast). Data flow:
official INCOIS source -> raw NetCDF -> ingestion -> cleaning -> BlueNexus `.bnx`
-> **this API**. The API only reads the `.bnx` containers; it never opens raw
NetCDF from a request and never regrids, interpolates or merges anything.

**In-situ observations** (`/api/observations`): real Argo float profiles
(INCOIS ERDDAP) and EGO / OceanGliders glider deployments. Point / profile /
trajectory data, served separately and never merged onto the model grid.

**Contract guarantees**

* Missing values are JSON `null` (never `0` / `-1` / `-9999` / `-1e34`);
  gridded slices carry an aligned `quality` array (`0` = VALID, `1` = MISSING).
* Units are canonical: `degC`, `PSU`, `m s-1` (gridded); observation pressure is
  native `decibar`, temperature `degree_Celsius`, salinity `PSU`.
* Timestamps are verbatim ISO-8601 UTC. Datasets are `analysis` or `forecast` --
  never "real-time".
* Every error is `{"error": {"type": "...", "message": "...", "detail": {...}}}`
  with an appropriate status code; tracebacks and server paths are never
  exposed.
""".strip()

OPENAPI_TAGS = [
    {"name": "health", "description": "Liveness and BlueNexus dataset availability."},
    {"name": "datasets", "description": "Gridded dataset discovery, metadata, parameters and coordinates (metadata only -- no bulk arrays)."},
    {"name": "slice", "description": "One latitude x longitude plane of one parameter at a chosen time / depth index (bounded partial read)."},
    {"name": "observations", "description": "Real in-situ Argo float profiles and glider deployments -- point / profile / trajectory data, never on the model grid."},
    {"name": "netcdf", "description": "Additive, read-only view of one configured NetCDF file (Step 39): NetCDF -> xarray -> ScientificDataset -> JSON. Separate from the BlueNexus `.bnx` datasets; values verbatim, NaN as null."},
    {"name": "model-observations", "description": "Additive (Step 43): the GLORYS12V1 model temperature (`thetao`) column at a real Argo profile's location & time -- nearest native grid cell, nearest daily-mean timestep, native depth levels. Extraction only; no model-minus-observation difference."},
]


def create_app(config: ApiConfig | None = None) -> FastAPI:
    config = config or ApiConfig.from_env()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_catalog(config)
        # Step 28: real Argo profiling-float observations, loaded from the D4
        # raw CSV snapshot (default path under <repo>/data/raw). Additive and
        # independent of the BlueNexus catalog above.
        init_argo_catalog(config.argo_raw_csv)
        # Step 29: real EGO / OceanGliders GDAC underwater-glider trajectories,
        # same D4 snapshot pattern. Independent of the Argo catalog.
        init_glider_catalog(config.glider_raw_csv)
        # Step 39: additive NetCDF -> ScientificDataset -> /api/netcdf namespace.
        # Opens the one configured NetCDF file (if any) once, in memory; the
        # endpoints report a clean 503 when nothing is configured. Stored on
        # app.state (not a shared module global). Never touches the BlueNexus
        # catalog or the observation catalogs above.
        _app.state.netcdf_service = build_netcdf_service(config)
        try:
            yield
        finally:
            _app.state.netcdf_service.close()

    app = FastAPI(
        title="INCOIS Ocean Visualization API",
        summary="Read-only REST access to the real gridded and in-situ ocean datasets.",
        description=API_DESCRIPTION,
        version="1.0.0",
        openapi_tags=OPENAPI_TAGS,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        # From ApiConfig: an explicit allowlist, env-overridable
        # (BLUENEXUS_CORS_ORIGINS), validated to never contain "*".
        allow_origins=list(config.cors_origins),
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["*"],
    )

    install_error_handlers(app)
    app.include_router(api_router)

    # Step 57 -- add a long-lived, CDN-cacheable `Cache-Control` header to
    # successful (200) GET responses on the allow-listed immutable routes
    # (see app/api/caching.py for the full list + rationale). Step 58 --
    # also force `Access-Control-Allow-Origin: *` (and drop any inherited
    # `Vary: Origin`) on those same responses so a CDN cache slot's CORS
    # header can never depend on which request happened to populate it (see
    # app/api/caching.py's "Step 58" section for the incident + full
    # rationale). Every other response -- every error, `/api/health`, every
    # other route -- is returned completely untouched: no body, header, or
    # status code is altered besides these two additions, and this
    # middleware runs *after* `CORSMiddleware` in the response direction, so
    # it always has the final say on these two headers.
    @app.middleware("http")
    async def add_immutable_cache_headers(request: Request, call_next):
        response = await call_next(request)
        if (
            request.method == "GET"
            and response.status_code == 200
            and is_immutable_get_path(request.url.path)
        ):
            apply_immutable_response_headers(response.headers)
        return response

    # Stash config for introspection / tests.
    app.state.config = config
    return app


app = create_app()
