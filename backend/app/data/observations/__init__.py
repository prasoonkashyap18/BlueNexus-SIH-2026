"""In-situ observation data (Argo profiling floats + underwater gliders).

Separate from the gridded BlueNexus datasets (``app.data.bluenexus``): these are
**point / profile / trajectory** data, not a regular ``time x depth x lat x
lon`` grid, so each has its own reader and API surface. Nothing here touches,
regrids onto, or is merged with the model grid -- and glider data is never
mixed with Argo data.

Sources (both acquired verbatim in Data Track D4):

* Argo profiles  -- INCOIS ERDDAP ``Indian_ARGO_Floats`` (tabledap)
  -> ``data/raw/argo_profiles_incois_indian_argo_floats_sample.csv``
* Glider trajectories -- EGO / OceanGliders GDAC ``OceanGlidersGDACTrajectories``
  via IFREMER ERDDAP (tabledap)
  -> ``data/raw/glider_ego_oceangliders_gdac_sample.csv``
"""

from . import argo, glider
from .argo import (
    ARGO_DATASET_ID,
    ArgoProfileNotFoundError,
    ArgoProfilesReader,
    default_raw_csv_path,  # Argo raw path -- kept here for back-compat with Step 28
)
from .observed_profile import (
    VERTICAL_COORDINATE,
    extract_observed_temperature_profile,
    observed_temperature_points,
)
from .glider import (
    GLIDER_DATASET_ID,
    GliderDeploymentNotFoundError,
    GliderTrajectoriesReader,
)

__all__ = [
    "argo",
    "glider",
    "ARGO_DATASET_ID",
    "ArgoProfilesReader",
    "ArgoProfileNotFoundError",
    "default_raw_csv_path",
    "extract_observed_temperature_profile",
    "observed_temperature_points",
    "VERTICAL_COORDINATE",
    "GLIDER_DATASET_ID",
    "GliderTrajectoriesReader",
    "GliderDeploymentNotFoundError",
]
