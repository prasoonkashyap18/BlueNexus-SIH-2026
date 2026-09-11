"""D10 API configuration.

Everything here has a safe development default and an environment-variable
override, so nothing needs editing to deploy.

* ``BLUENEXUS_DATA_DIR``    -- directory holding the D9 ``*.bnx`` files
                               (default: ``<repo>/data/bluenexus``).
* ``BLUENEXUS_CORS_ORIGINS`` -- comma-separated allowed browser origins
                               (default: the local Vite dev server on ports
                               5173/5174, as both ``localhost`` and
                               ``127.0.0.1``). Never defaults to ``*``; setting
                               the variable replaces the default list entirely.
                               ``*`` is rejected outright (``ValueError`` at
                               startup) -- production must name its front-end
                               origin(s) explicitly, e.g.
                               ``BLUENEXUS_CORS_ORIGINS="https://ocean.incois.gov.in"``.
* ``BLUENEXUS_BUILD_ON_STARTUP`` -- ``1``/``0``; when a dataset's ``.bnx`` is
                               missing, build it from D9 at startup
                               (default: ``1``).
* ``BLUENEXUS_ARGO_RAW_CSV`` -- path to the D4 Argo raw CSV snapshot
                               (default: ``<repo>/data/raw/argo_profiles_incois_indian_argo_floats_sample.csv``).
* ``BLUENEXUS_GLIDER_RAW_CSV`` -- path to the D4 glider raw CSV snapshot
                               (default: ``<repo>/data/raw/glider_ego_oceangliders_gdac_sample.csv``).
* ``BLUENEXUS_NETCDF_PATH``   -- filesystem path to ONE NetCDF file to expose
                               read-only through the additive ``/api/netcdf``
                               namespace (Step 39). **Step 42:** when this is
                               unset, it defaults to the validated real ocean
                               *model temperature* dataset -- the larger Step 42
                               Arabian Sea subset
                               ``<repo>/data/raw/temperature_cmems_glorys12v1_arabiansea.nc``
                               (MERCATOR GLORYS12V1 potential temperature
                               ``thetao``, from Copernicus Marine), falling back
                               to the tiny validation sample
                               ``temperature_cmems_glorys12v1_sample.nc`` if the
                               larger file is absent -- so the model is available
                               at ``/api/netcdf`` for the Step 42-44 model work
                               without any env var.
                               (Step 41 pointed this at the INCOIS IO-HOOFS
                               *currents* file as an interim placeholder; that
                               file carries no temperature, so Step 42 replaces
                               it with the GLORYS temperature model. The IO-HOOFS
                               file is untouched on disk and still reachable by
                               setting ``BLUENEXUS_NETCDF_PATH`` to it.)
                               If the default file is absent, the NetCDF
                               endpoints return ``503 netcdf_not_configured``
                               (unchanged). No machine-specific absolute path is
                               baked in -- the default is resolved from the repo
                               root.
* ``BLUENEXUS_NETCDF_DATASET_ID`` -- Step 39: the identity reported for that
                               NetCDF dataset. Default: ``glorys12v1_model``
                               for either Step 42 model file (the larger subset
                               and the tiny sample are the same product, so they
                               share the id); the sluggified file stem for a
                               custom ``BLUENEXUS_NETCDF_PATH``.
* ``BLUENEXUS_NETCDF_CF_DECODE`` -- ``1``/``0``; apply CF ``scale_factor`` /
                               ``add_offset`` / ``_FillValue`` decoding when the
                               NetCDF file is opened (Step 42). The GLORYS
                               default file stores ``thetao`` as packed
                               ``int16`` and MUST be decoded to real
                               ``degrees_C`` -- so this defaults to ``1`` for the
                               default model file. For a custom
                               ``BLUENEXUS_NETCDF_PATH`` it defaults to ``0``
                               (lossless, verbatim -- the Step 38/39 behaviour),
                               overridable with this variable. The raw file on
                               disk is never modified either way; decoding
                               happens in memory.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..data.ingestion import project_root

_SLUG_SAFE = re.compile(r"[^a-z0-9_]+")


def _sluggify(text: str) -> str:
    slug = _SLUG_SAFE.sub("_", text.strip().lower()).strip("_")
    return slug or "netcdf_dataset"


# Step 42 -- the validated real ocean MODEL TEMPERATURE dataset: MERCATOR
# GLORYS12V1 potential temperature (``thetao``), from the Copernicus Marine
# "Global Ocean Physics Reanalysis" product ``GLOBAL_MULTIYEAR_PHY_001_030``
# (dataset ``cmems_mod_glo_phy_my_0.083deg_P1D-m``, DOI 10.48670/moi-00021),
# downloaded with the Copernicus Marine Toolbox and validated in Step 42,
# preserved verbatim under ``data/raw/``. Served through the existing Step 37-39
# scientific / NetCDF layer at ``/api/netcdf``; ``thetao`` is stored as packed
# ``int16`` and is CF-decoded to real ``degrees_C`` at the scientific/API
# boundary (the raw file is never modified). This is the model source the
# Step 42-44 work consumes. It does not touch the ``.bnx`` pipeline, its
# endpoints, or the observation providers.
#
# Step 42 data-coverage expansion: the default is the larger Arabian Sea subset
# (``...arabiansea.nc`` -- 61.5-70 E, 8-20.5 N, 2025-03-24..2025-04-02,
# 0.494-541.089 m, 32 native levels) chosen to overlap 4 real INCOIS Argo
# profiles. The original tiny validation sample (``...sample.nc``) is preserved
# unchanged and is still selectable via ``BLUENEXUS_NETCDF_PATH``. Nothing here
# is size-specific: dimensions and coverage are always read from the file.
#
# (Step 41 pointed ``/api/netcdf`` at ``currents_incois_io-hoofs_sample.nc`` as
# an interim placeholder -- that INCOIS IO-HOOFS file is currents-only and has no
# temperature. It stays on disk untouched and is still reachable by setting
# ``BLUENEXUS_NETCDF_PATH`` to it explicitly.)
MODEL_NETCDF_FILENAME = "temperature_cmems_glorys12v1_arabiansea.nc"
#: The tiny validation sample -- preserved, used as the fallback default if the
#: larger Arabian Sea file is not present.
MODEL_NETCDF_SAMPLE_FILENAME = "temperature_cmems_glorys12v1_sample.nc"
MODEL_NETCDF_DATASET_ID = "glorys12v1_model"
#: ``thetao`` is packed int16 (scale_factor / add_offset) -> decode to degrees_C.
MODEL_NETCDF_CF_DECODE = True
#: Explicit, human-readable model identity. Never "INCOIS-GODAS" / INCOIS model.
MODEL_SOURCE_LABEL = "GLORYS12V1 / Copernicus Marine"
#: Copernicus Marine identifiers for the model product (provenance / transparency).
MODEL_PRODUCT_ID = "GLOBAL_MULTIYEAR_PHY_001_030"
MODEL_COPERNICUS_DATASET_ID = "cmems_mod_glo_phy_my_0.083deg_P1D-m"
MODEL_DOI = "https://doi.org/10.48670/moi-00021"
#: The model potential-temperature variable served for the Step 43 model-at-Argo
#: extraction. Never silently renamed.
MODEL_TEMPERATURE_VARIABLE = "thetao"


def default_model_netcdf_path() -> Optional[Path]:
    """The repo's GLORYS12V1 model-temperature file.

    Prefers the larger Step 42 Arabian Sea subset; falls back to the tiny
    validation sample; ``None`` if neither is present (endpoints then report
    ``503 netcdf_not_configured``). No dimension or coordinate assumption is made
    here -- whichever file exists is served as-is.
    """
    raw = project_root() / "data" / "raw"
    for name in (MODEL_NETCDF_FILENAME, MODEL_NETCDF_SAMPLE_FILENAME):
        candidate = raw / name
        if candidate.is_file():
            return candidate
    return None

# Local Vite dev server. Vite serves on 5173 and falls back to 5174 when that
# port is taken; browsers treat `localhost` and `127.0.0.1` as distinct origins,
# so all four are allowed for local development. Not `*`; overridden wholesale by
# BLUENEXUS_CORS_ORIGINS. (See frontend/src/hooks/useHealthCheck.ts.)
_DEFAULT_CORS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ApiConfig:
    data_dir: Path
    cors_origins: tuple[str, ...]
    build_on_startup: bool
    #: D4 Argo raw CSV snapshot; ``None`` -> the reader's default repo path.
    argo_raw_csv: Optional[Path] = None
    #: D4 glider raw CSV snapshot; ``None`` -> the reader's default repo path.
    glider_raw_csv: Optional[Path] = None
    #: Step 39: one NetCDF file to expose read-only via ``/api/netcdf``.
    #: ``None`` -> the NetCDF endpoints report ``503 netcdf_not_configured``.
    netcdf_path: Optional[Path] = None
    #: Step 39: identity reported for the NetCDF dataset.
    netcdf_dataset_id: str = "netcdf_dataset"
    #: Step 42: apply CF ``scale_factor`` / ``add_offset`` / ``_FillValue``
    #: decoding when opening the NetCDF file. Default ``False`` keeps the
    #: lossless Step 38/39 behaviour; the GLORYS default model file needs
    #: ``True`` (packed int16 ``thetao`` -> ``degrees_C``).
    netcdf_cf_decode: bool = False
    #: Step 42: explicit human-readable model identity for the NetCDF dataset
    #: (e.g. ``"GLORYS12V1 / Copernicus Marine"``); ``None`` for a custom file.
    netcdf_source_label: Optional[str] = None

    def __post_init__(self) -> None:
        # A wildcard CORS origin is never acceptable for this API (no `*`,
        # whatever the source -- default list or env override). Fail loudly at
        # construction rather than silently serving every website.
        if any(o.strip() == "*" for o in self.cors_origins):
            raise ValueError(
                "CORS origin '*' is not allowed. Set BLUENEXUS_CORS_ORIGINS to an "
                "explicit list of browser origins (scheme + host + port)."
            )

    @classmethod
    def from_env(cls) -> "ApiConfig":
        data_dir = os.environ.get("BLUENEXUS_DATA_DIR")
        resolved = (
            Path(data_dir).expanduser().resolve()
            if data_dir
            else (project_root() / "data" / "bluenexus")
        )
        origins_raw = os.environ.get("BLUENEXUS_CORS_ORIGINS")
        origins = (
            tuple(o.strip() for o in origins_raw.split(",") if o.strip())
            if origins_raw
            else _DEFAULT_CORS
        )
        argo_csv = os.environ.get("BLUENEXUS_ARGO_RAW_CSV")
        glider_csv = os.environ.get("BLUENEXUS_GLIDER_RAW_CSV")

        netcdf_raw = os.environ.get("BLUENEXUS_NETCDF_PATH")
        is_default_model = not netcdf_raw
        if netcdf_raw:
            netcdf_path = Path(netcdf_raw).expanduser().resolve()
        else:
            # Step 42: default to the validated GLORYS12V1 model-temperature file
            # in the repo (or None if it is not present -> 503).
            netcdf_path = default_model_netcdf_path()

        netcdf_id = os.environ.get("BLUENEXUS_NETCDF_DATASET_ID")
        if netcdf_id:
            netcdf_dataset_id = _sluggify(netcdf_id)
        elif netcdf_raw and netcdf_path:
            netcdf_dataset_id = _sluggify(netcdf_path.stem)
        elif netcdf_path:
            netcdf_dataset_id = MODEL_NETCDF_DATASET_ID
        else:
            netcdf_dataset_id = "netcdf_dataset"

        # Step 42: CF decode is ON for the default GLORYS model file (packed
        # int16 thetao), OFF for a custom file unless explicitly enabled. The
        # env var, when set, wins in both cases.
        cf_decode = _env_bool(
            "BLUENEXUS_NETCDF_CF_DECODE",
            MODEL_NETCDF_CF_DECODE if (is_default_model and netcdf_path) else False,
        )
        source_label = (
            MODEL_SOURCE_LABEL if (is_default_model and netcdf_path) else None
        )

        return cls(
            data_dir=resolved,
            cors_origins=origins,
            build_on_startup=_env_bool("BLUENEXUS_BUILD_ON_STARTUP", True),
            argo_raw_csv=Path(argo_csv).expanduser().resolve() if argo_csv else None,
            glider_raw_csv=Path(glider_csv).expanduser().resolve() if glider_csv else None,
            netcdf_path=netcdf_path,
            netcdf_dataset_id=netcdf_dataset_id,
            netcdf_cf_decode=cf_decode,
            netcdf_source_label=source_label,
        )
