"""Pydantic response models for the data API (drive the OpenAPI docs at /docs).

Every endpoint declares a ``response_model`` here, so ``/openapi.json`` fully
describes the contract and FastAPI validates each response on the way out.

Nested D9-contract fragments (``coordinates``, ``parameters``, ``metadata``,
``provenance``) are deliberately passed through as typed ``dict[str, Any]``:
they are already the stable, documented D9 contract (see ``docs/data-format.md``)
and re-modelling every field here would only risk drift. Focused models are
added only for the API's own envelope shapes (errors, health, slice geometry).

No model transforms a scientific value. Real numbers, ``null`` for missing,
canonical units (``degC`` / ``PSU`` / ``m s-1``), ISO-8601 timestamps and
verbatim identifiers pass straight through.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class ErrorBody(BaseModel):
    type: str = Field(examples=["unknown_dataset"])
    message: str
    detail: dict[str, Any] = {}


class ErrorResponse(BaseModel):
    error: ErrorBody


class DimensionInfo(BaseModel):
    name: str
    role: str
    size: int


class DatasetSummary(BaseModel):
    dataset_id: str
    title: str
    product_type: str = Field(description='"analysis" or "forecast" -- never "real-time"')
    data_status: str
    schema_version: str
    parameter_ids: list[str]
    dimensions: list[DimensionInfo]
    shape_by_parameter: dict[str, list[int]]
    time_coverage: dict[str, Any]
    depth_coverage: dict[str, Any]
    latitude_coverage: dict[str, Any]
    longitude_coverage: dict[str, Any]
    source: dict[str, Any]
    temporal_semantics: str
    provenance_summary: dict[str, Any]
    freshness: Optional[dict[str, Any]] = Field(
        default=None,
        description=(
            "D14 controlled-update freshness: source version / times, acquired_at "
            "vs published_at, last check, and whether a newer official source "
            "exists. Never a real-time claim (`is_real_time` is always false)."
        ),
    )


class DatasetList(BaseModel):
    count: int
    datasets: list[DatasetSummary]


class DatasetDetail(BaseModel):
    schema_version: str
    dataset_id: str
    title: str
    product_type: str
    dimensions: list[dict[str, Any]]
    coordinates: dict[str, Any]
    parameters: dict[str, Any]
    metadata: dict[str, Any]
    provenance: dict[str, Any]
    generation: dict[str, Any]
    freshness: Optional[dict[str, Any]] = Field(
        default=None, description="D14 controlled-update freshness (see DatasetSummary.freshness)."
    )


class ParameterList(BaseModel):
    dataset_id: str
    canonical_parameter_ids: list[str]
    note: str
    parameters: list[dict[str, Any]]


class CoordinateList(BaseModel):
    dataset_id: str
    coordinates: dict[str, Any]


class SliceTime(BaseModel):
    index: int
    value: Optional[float]
    iso: Optional[str]
    units: Optional[str]


class SliceDepth(BaseModel):
    index: int
    value: Optional[float]
    units: Optional[str]


class SliceShape(BaseModel):
    latitude: int = Field(description="number of latitude rows in `values` / `quality`")
    longitude: int = Field(description="number of longitude columns in each row")


class SliceResponse(BaseModel):
    schema_version: str
    dataset_id: str
    parameter: str
    units: str = Field(examples=["degC", "PSU", "m s-1"])
    product_type: str
    data_status: str
    missing_value: None = Field(
        default=None,
        description="Missing cells in `values` are JSON null; quality[i][j] == 1 marks them.",
    )
    quality_definition: dict[str, str]
    time: SliceTime
    depth: SliceDepth
    shape: SliceShape
    latitude: list[float]
    longitude: list[float]
    values: list[list[Optional[float]]] = Field(
        description="latitude x longitude plane; missing cells are null, never 0/-1/-9999/-1e34."
    )
    quality: list[list[int]] = Field(description="0 = VALID, 1 = MISSING")
    parameter_metadata: dict[str, Any]
    provenance: dict[str, Any]
    bytes_read: int = Field(
        description="payload bytes read from the .bnx file for this slice (efficiency indicator)."
    )


class HealthDataLayer(BaseModel):
    """BlueNexus ``.bnx`` discoverability -- **not** a scientific-content check.

    Reports whether the expected datasets' D9 containers are present and loaded.
    Per-cell / value validation is D15, never this endpoint.
    """

    # Tolerate future additive keys from the catalog without breaking the
    # response contract.
    model_config = ConfigDict(extra="allow")

    data_dir_exists: bool
    bnx_files_found: list[str] = Field(description="`*.bnx` file names discovered in the data dir")
    datasets_loaded: list[str] = Field(description="canonical dataset ids successfully opened")
    expected_datasets: list[str] = Field(description="dataset ids the API is expected to serve")
    all_expected_present: bool = Field(
        description="true iff every expected dataset is loaded -- the machine-readable readiness signal"
    )
    load_errors: dict[str, str] = Field(
        default_factory=dict, description="file name -> error string for any container that failed to open"
    )


class HealthDataLayerUnavailable(BaseModel):
    """Returned only if the data layer could not be inspected at all."""

    model_config = ConfigDict(extra="forbid")

    available: Literal[False] = Field(description="always false; the catalog is not initialised")


class HealthResponse(BaseModel):
    status: str = Field(
        examples=["ok"],
        description=(
            '"ok" while the API process is serving requests. This is process '
            "liveness, NOT data readiness -- read `data_layer.all_expected_present` "
            "for that."
        ),
    )
    service: str = Field(examples=["bluenexus-data-api"])
    data_layer: Union[HealthDataLayer, HealthDataLayerUnavailable] = Field(
        description="BlueNexus `.bnx` dataset availability (discoverability only, never a value scan)."
    )


# ---------------------------------------------------------------------------
# Argo profiling-float observations (Step 28) -- point/profile data, separate
# from the gridded datasets above and never merged with the model grid.
# ---------------------------------------------------------------------------


class ArgoPlatformSummary(BaseModel):
    platform_id: str = Field(examples=["2903951_10"], description="<platform_number>_<cycle_number>")
    platform_number: str = Field(examples=["2903951"], description="WMO float id (verbatim)")
    cycle_number: int
    platform_type: Optional[str] = Field(examples=["PROVOR_III", "ARVOR"])
    direction: Optional[str] = Field(examples=["A"], description="A = ascending profile")
    time: Optional[str] = Field(description="ISO-8601 UTC observation time, verbatim")
    latitude: Optional[float] = Field(description="degrees_north; null if the fix is missing")
    longitude: Optional[float] = Field(description="degrees_east; null if the fix is missing")
    level_count: int
    pressure_min: Optional[float] = Field(description="decibar")
    pressure_max: Optional[float] = Field(description="decibar")


class ArgoLevel(BaseModel):
    pressure: Optional[float] = Field(description="decibar; null == real missing value (never 0/-999)")
    pressure_qc: Optional[str] = Field(description="raw Argo QC code, e.g. '1'")
    temperature: Optional[float] = Field(description="degree_Celsius; null == missing")
    temperature_qc: Optional[str] = None
    salinity: Optional[float] = Field(description="PSU; null == missing")
    salinity_qc: Optional[str] = None


class ArgoPlatformList(BaseModel):
    dataset_id: str = Field(examples=["incois_indian_argo_floats"])
    count: int
    units: dict[str, str]
    platform_type: str = Field(examples=["argo"])
    note: str
    provenance: dict[str, Any]
    platforms: list[ArgoPlatformSummary]


class ArgoPlatformDetail(ArgoPlatformSummary):
    dataset_id: str
    units: dict[str, str]
    standard_names: dict[str, str]
    quality_definition: dict[str, str]
    missing_value: None = Field(default=None, description="missing levels use JSON null")
    levels: list[ArgoLevel]
    provenance: dict[str, Any]


# -- Step 44: comparison-ready OBSERVED temperature profile ------------------
# The observation side of the model-vs-observation pipeline. Real Argo
# temperature on its NATIVE pressure coordinate (`pressure_dbar`, decibar),
# ascending pressure, both values finite. No interpolation / smoothing /
# decimation / gap-fill / unit conversion / QC filtering. No model temperature,
# no model-minus-observation difference (that is Step 45).


class ArgoObservedTemperatureLevel(BaseModel):
    pressure_dbar: float = Field(description="native Argo pressure, decibar (NOT depth / metres)")
    temperature: float = Field(description="real observed temperature, degree_Celsius (verbatim)")
    pressure_qc: Optional[str] = Field(default=None, description="raw Argo QC code, e.g. '1'")
    temperature_qc: Optional[str] = Field(default=None, description="raw Argo QC code, retained not applied")


class ArgoObservedTemperatureProfileResponse(BaseModel):
    observation: dict[str, Any] = Field(
        description=(
            "the real Argo profile: `source`, `dataset_id`, `platform_id`, "
            "`platform_number`, `cycle_number`, `latitude`, `longitude`, "
            "`timestamp` -- all verbatim from the INCOIS snapshot"
        )
    )
    profile: list[ArgoObservedTemperatureLevel] = Field(
        description="real (pressure_dbar, temperature) measurements, ascending pressure, both finite"
    )
    metadata: dict[str, Any] = Field(
        description=(
            "`variable` (sea_water_temperature), `units` (degree_Celsius), "
            "`vertical_coordinate` (`pressure_dbar`), `source_level_count`, "
            "`point_count`, `finite_temperature_count`, `null_temperature_count`, "
            "value ranges, and a `qc` block (flags retained, no filtering applied)"
        )
    )
    provenance: dict[str, Any]
    notes: list[str] = Field(description="scientific-transparency statements")
    missing_value: None = Field(default=None, description="missing values use JSON null")


# ---------------------------------------------------------------------------
# Underwater-glider observations (Step 29) -- EGO / OceanGliders GDAC trajectory
# data. Same shape as Argo above; a "platform" is one deployment and its detail
# carries the ordered trajectory samples. Separate from the model grid and from
# the Argo data.
# ---------------------------------------------------------------------------


class GliderPlatformSummary(BaseModel):
    platform_id: str = Field(examples=["sea057_20220707"], description="platform_deployment, verbatim")
    platform_type: str = Field(examples=["glider"])
    sample_count: int
    time_start: Optional[str] = Field(description="ISO-8601 UTC of the first sample, verbatim")
    time_end: Optional[str] = Field(description="ISO-8601 UTC of the last sample, verbatim")
    latitude_min: Optional[float] = Field(description="degrees_north")
    latitude_max: Optional[float] = None
    longitude_min: Optional[float] = Field(description="degrees_east")
    longitude_max: Optional[float] = None
    pressure_min: Optional[float] = Field(description="decibar")
    pressure_max: Optional[float] = Field(description="decibar")


class GliderSample(BaseModel):
    time: Optional[str] = Field(description="ISO-8601 UTC, verbatim")
    latitude: Optional[float] = Field(description="degrees_north; null == missing")
    longitude: Optional[float] = Field(description="degrees_east; null == missing")
    position_qc: Optional[str] = Field(description="raw EGO QC code (ref. table 2.1), e.g. '1'")
    pressure: Optional[float] = Field(description="decibar; null == real missing value (never 0/-999)")
    pressure_qc: Optional[str] = None
    temperature: Optional[float] = Field(description="degree_Celsius; null == missing")
    temperature_qc: Optional[str] = None
    salinity: Optional[float] = Field(description="PSU; null == missing")
    salinity_qc: Optional[str] = None


class GliderPlatformList(BaseModel):
    dataset_id: str = Field(examples=["ego_oceangliders_gdac"])
    count: int
    units: dict[str, str]
    platform_type: str = Field(examples=["glider"])
    note: str
    provenance: dict[str, Any]
    platforms: list[GliderPlatformSummary]


class GliderPlatformDetail(GliderPlatformSummary):
    dataset_id: str
    units: dict[str, str]
    standard_names: dict[str, str]
    quality_definition: dict[str, str]
    missing_value: None = Field(default=None, description="missing sample values use JSON null")
    samples: list[GliderSample]
    provenance: dict[str, Any]


# ---------------------------------------------------------------------------
# NetCDF-backed scientific dataset (Step 39) -- an ADDITIVE namespace under
# `/api/netcdf`. One configured NetCDF file, opened once via the Step 38
# ingestion layer and exposed through the Step 37 ScientificDataset. It does not
# touch the BlueNexus `.bnx` datasets, the model grid, or the observation paths.
#
# Scientific values are verbatim. The ONLY boundary conversion: non-finite
# floats (NaN / Infinity) are serialized as JSON `null` -- see `nan_encoding` on
# every payload. Values are never rounded, scaled or unit-converted.
# ---------------------------------------------------------------------------


class NetCDFCoordinateAxis(BaseModel):
    name: str
    role: Optional[str] = Field(
        default=None,
        description='best-effort axis role: "time" | "depth" | "latitude" | "longitude" | null',
    )
    dimensions: list[str]
    size: int
    dtype: str
    units: Optional[str] = None
    attributes: dict[str, Any] = {}
    values: Any = Field(description="coordinate values verbatim; time axes as ISO-8601 UTC strings")


class NetCDFDatasetResponse(BaseModel):
    dataset_id: str
    source: dict[str, Any] = Field(
        description=(
            "file name + read mode + explicit model `label` (Step 42) -- never "
            "an absolute path"
        )
    )
    dimensions: dict[str, int] = Field(description="dimension name -> length")
    coordinates: list[NetCDFCoordinateAxis]
    variables: list[str] = Field(description="data-variable names (coordinates excluded)")
    variable_count: int
    global_attributes: dict[str, Any]
    coverage: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Step 42: the real extent of the configured sample (time range, "
            "depth range, lat/lon bounding box) -- NOT basin-wide coverage."
        ),
    )
    decoding: dict[str, Any] = Field(
        default_factory=dict,
        description="Step 42: whether CF scale_factor/add_offset/_FillValue decoding is applied",
    )
    nan_encoding: str


class NetCDFVariableResponse(BaseModel):
    dataset_id: str
    name: str
    dimensions: list[str]
    shape: list[int]
    dtype: str
    units: Optional[str] = None
    attributes: dict[str, Any] = {}
    axis_roles: dict[str, str] = Field(
        description="dimension name -> resolved role (time/depth/latitude/longitude)"
    )
    decoding: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Step 42: CF decoding applied to this variable's values "
            "(scale_factor / add_offset / _FillValue), with the source packing"
        ),
    )
    nan_encoding: str


class NetCDFSliceSelection(BaseModel):
    role: str = Field(examples=["time", "depth", "latitude", "longitude"])
    dimension: str
    index: int
    value: Any = Field(description="coordinate value at this index (null if the axis has no coordinate)")
    iso: Optional[str] = Field(default=None, description="ISO-8601 UTC string when the axis is time")


class NetCDFSliceResponse(BaseModel):
    dataset_id: str
    variable: str
    units: Optional[str] = None
    dtype: str
    selection: list[NetCDFSliceSelection] = Field(
        description="the indices applied, with the coordinate value at each"
    )
    dimensions: list[str] = Field(description="dimensions remaining after selection")
    shape: list[int]
    element_count: int
    coordinates: dict[str, Any] = Field(
        description="coordinate values for the remaining (and selected) axes, verbatim"
    )
    values: Any = Field(
        description=(
            "scientific values; NaN/Infinity as null (see nan_encoding). "
            "CF-decoded to physical units when `decoding.cf_mask_and_scale` is "
            "true, verbatim otherwise -- never rounded or unit-converted."
        )
    )
    missing_value: None = Field(default=None, description="missing cells are JSON null")
    decoding: dict[str, Any] = Field(
        default_factory=dict,
        description="Step 42: CF decoding applied to these values",
    )
    variable_metadata: dict[str, Any]
    nan_encoding: str


# ---------------------------------------------------------------------------
# Model-at-observation extraction (Step 43) -- `/api/model-observations`.
# Connects ONE real INCOIS Argo profile to the nearest-native GLORYS12V1
# `thetao` column. Extraction only: NO model-minus-observation difference, no
# reformatting of the observed profile (Steps 44+). Every value verbatim;
# nearest-neighbour matching only (no spatial / temporal / vertical
# interpolation); the exact spatial & temporal mismatch is in the response.
# ---------------------------------------------------------------------------


class ModelObsProfileLevel(BaseModel):
    depth: Optional[float] = Field(description="native GLORYS depth level, metres (positive down)")
    temperature: Optional[float] = Field(
        description="decoded GLORYS potential temperature, degrees_C; null == missing (land/seafloor)"
    )


class ModelAtArgoTemperatureResponse(BaseModel):
    observation: dict[str, Any] = Field(
        description=(
            "the real Argo profile being matched: `platform_id`, "
            "`platform_number`, `cycle_number`, `latitude`, `longitude`, "
            "`timestamp` (verbatim, unchanged), plus level/pressure summary"
        )
    )
    model: dict[str, Any] = Field(
        description=(
            "the matched GLORYS cell: `dataset_id`, `source` "
            "(\"GLORYS12V1 / Copernicus Marine\"), `variable` (`thetao`), "
            "`units` (`degrees_C`), matched native `latitude` / `longitude` / "
            "`timestamp`, and `spatial_match` / `temporal_match` blocks giving "
            "the requested vs matched coordinate and the exact difference "
            "(degrees / seconds). Also the CF `decoding` block and level counts."
        )
    )
    profile: list[ModelObsProfileLevel] = Field(
        description="the GLORYS thetao column on its native depth levels (32 for this subset)"
    )
    coverage: dict[str, Any] = Field(
        description="the configured GLORYS file's real extent (space / time / depth)"
    )
    warnings: list[str] = Field(default_factory=list)
    notes: list[str] = Field(description="scientific-transparency statements (see docs)")
    nan_encoding: str


# ---------------------------------------------------------------------------
# Model - observation temperature difference (Step 45) -- `/api/model-observations`.
# GLORYS12V1 thetao MINUS the real Argo observed temperature, matched vertically
# by DERIVED DEPTH (TEOS-10 GSW pressure->depth), one row per native GLORYS
# depth level, within an adaptive tolerance of half the local GLORYS spacing.
# NO interpolation, NO index pairing. difference_c = model - observed.
# ---------------------------------------------------------------------------


class ModelObsComparisonLevel(BaseModel):
    model_depth_m: float = Field(description="native GLORYS depth level, metres (unchanged)")
    model_temperature_c: Optional[float] = Field(description="GLORYS thetao at this level, degree_Celsius; null == missing")
    argo_pressure_dbar: Optional[float] = Field(description="nearest Argo observation's ORIGINAL pressure, decibar (unchanged)")
    argo_depth_m: Optional[float] = Field(description="derived depth of that Argo obs (TEOS-10 GSW); separate from pressure")
    observed_temperature_c: Optional[float] = Field(description="that Argo obs's temperature, degree_Celsius (verbatim); null == missing")
    observed_temperature_qc: Optional[str] = Field(default=None, description="raw Argo QC code, retained not applied")
    observed_pressure_qc: Optional[str] = None
    vertical_separation_m: Optional[float] = Field(description="abs(argo_depth_m - model_depth_m)")
    max_vertical_separation_m: float = Field(description="adaptive tolerance for this GLORYS level (half local spacing)")
    difference_c: Optional[float] = Field(
        description="model_temperature_c - observed_temperature_c (positive => model warmer); null when unmatched"
    )
    matched: bool
    reason: Optional[str] = Field(default=None, description="why this level was not matched (null when matched)")


class ModelObsTemperatureComparisonResponse(BaseModel):
    comparison: dict[str, Any] = Field(
        description=(
            "`platform_id`, model/observation sources & variables & units, "
            "`difference_units`, and the exact `difference_definition` "
            "(model - observed, positive => model warmer). States this is a "
            "reanalysis-vs-observation comparison, not co-located validation."
        )
    )
    matching: dict[str, Any] = Field(
        description=(
            "`vertical_method`, `model_depth_coordinate`, "
            "`observation_depth_method` (TEOS-10 GSW `gsw.z_from_p`, "
            "`gsw_version`), `adaptive_tolerance_rule` + per-level "
            "`maximum_vertical_separation_m`, matched / unmatched level counts, "
            "depth ranges, `argo_observations_below_model_depth`, and that the "
            "spatial / temporal match is reused from Step 43 unchanged"
        )
    )
    model: dict[str, Any] = Field(
        description="the Step 43 matched GLORYS cell (dataset, source, matched lat/lon/timestamp, spatial_match, temporal_match, decoding) -- verbatim"
    )
    observation: dict[str, Any] = Field(
        description="the real Argo profile (verbatim position / timestamp) + variable / units / vertical coordinate / QC block"
    )
    profile: list[ModelObsComparisonLevel] = Field(
        description="one row per native GLORYS depth level (32 for this subset)"
    )
    statistics: dict[str, Any] = Field(
        description=(
            "over VALID matched comparison points only: `matched_count`, "
            "`mean_difference_c`, `mean_absolute_difference_c`, "
            "`minimum_difference_c`, `maximum_difference_c`, `rmse_c` "
            "(null + explanation when there are too few points)"
        )
    )
    provenance: dict[str, Any]
    notes: list[str] = Field(description="scientific-transparency statements (see docs)")
    nan_encoding: str


# -- Step 51: real data-source / provenance catalogue (/api/sources) ---------
class DataSourceVariable(BaseModel):
    name: str = Field(description="raw scientific variable id(s), verbatim (e.g. `T_ANALYZED`, `thetao`)")
    display: str = Field(description="plain-language name for the variable")
    standard_name: Optional[str] = None


class DataSourceEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str = Field(examples=["temperature", "argo", "model_comparison"])
    category: str = Field(description='"field" | "observation" | "comparison"')
    context_label: str = Field(description="what this source supplies, e.g. `Temperature`")
    label: str = Field(description='display name, e.g. `INCOIS Ocean Analysis` / `GLORYS12V1 / Copernicus Marine`')
    kind: str = Field(description='"analysis" | "forecast" | "reanalysis" | "observation"')
    is_model: bool
    is_incois: bool = Field(description="true only for genuine INCOIS products (never for GLORYS12V1)")
    organization: Optional[str] = None
    dataset_id: Optional[str] = None
    product_identifier: Optional[str] = Field(default=None, description="the real upstream dataset/product id")
    product_title: Optional[str] = None
    variable: DataSourceVariable
    units: Any = Field(description="canonical unit string, or a per-quantity unit map for observations")
    temporal_semantics: Optional[str] = None
    coverage: Optional[dict[str, Any]] = Field(default=None, description="compact time/depth/lat/lon extent when known")
    subset_note: Optional[str] = Field(default=None, description="set when the loaded file is a partial subset")
    url: Optional[str] = None
    attribution: Optional[str] = None


class SourceCatalogResponse(BaseModel):
    count: int
    sources: list[DataSourceEntry]
    notes: list[str] = Field(description="plain-language provenance statements for the whole catalogue")
