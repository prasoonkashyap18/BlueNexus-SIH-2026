"""BlueNexus Data Track **D9 -- convert data to a BlueNexus-friendly format**.

Consumes the D8 cleaning layer and produces the canonical, versioned,
deterministic **BlueNexus data contract** that D10 will serve and the frontend
will consume:

``raw NetCDF -> D7 ingestion -> D8 cleaned -> [D9 BlueNexus format] -> D10 backend/API``

D9 does not regrid / interpolate / merge grids / merge time systems / change
scientific values, and it does **not** provide an HTTP API.

Quick start::

    from app.data.bluenexus import convert_all, write_bluenexus, read_bluenexus

    for name, ds in convert_all().items():
        write_bluenexus(ds, f"data/bluenexus/{name}.bnx")

    loaded = read_bluenexus("data/bluenexus/incois_argo_10day_analysis.bnx")
    temp = loaded.parameter("temperature")     # canonical id
    arr = loaded.array("temperature")          # float64, missing == NaN, + quality mask
"""

from .converter import (
    convert_all,
    convert_surface_currents,
    convert_temperature_salinity,
    convert_to_bluenexus,
)
from .models import (
    JSON_MISSING,
    MISSING_VALUE_DEFINITION,
    QUALITY_DEFINITION,
    SCHEMA_VERSION,
    BlueNexusArray,
    BlueNexusCoordinate,
    BlueNexusDataset,
    BlueNexusDimension,
    BlueNexusMetadata,
    BlueNexusParameter,
    BlueNexusProvenance,
)
from .parameters import (
    ALL_PARAMETERS,
    ParameterSpec,
    parameter,
    parameter_for_source,
    parameters_for_dataset,
)
from .serialization import (
    MAGIC,
    BnxReader,
    contract_sha256,
    parameter_slice,
    read_bluenexus,
    read_manifest,
    write_bluenexus,
)
from .timeaxis import TimeAxisNormalisation, normalise_time_axis

__all__ = [
    "SCHEMA_VERSION",
    "QUALITY_DEFINITION",
    "MISSING_VALUE_DEFINITION",
    "JSON_MISSING",
    "MAGIC",
    "BnxReader",
    "convert_all",
    "convert_surface_currents",
    "convert_temperature_salinity",
    "convert_to_bluenexus",
    "BlueNexusArray",
    "BlueNexusCoordinate",
    "BlueNexusDataset",
    "BlueNexusDimension",
    "BlueNexusMetadata",
    "BlueNexusParameter",
    "BlueNexusProvenance",
    "ALL_PARAMETERS",
    "ParameterSpec",
    "parameter",
    "parameter_for_source",
    "parameters_for_dataset",
    "contract_sha256",
    "parameter_slice",
    "read_bluenexus",
    "read_manifest",
    "write_bluenexus",
    "TimeAxisNormalisation",
    "normalise_time_axis",
]
