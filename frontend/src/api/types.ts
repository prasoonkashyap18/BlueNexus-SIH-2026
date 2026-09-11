/**
 * TypeScript shapes for the production data API responses.
 *
 * These mirror the response models in `backend/app/api/schemas.py` (the
 * Step 35 contract, OpenAPI `version: "1.0.0"`) and the D9 contract
 * (`docs/data-format.md`). They are intentionally explicit — no blanket `any` —
 * but nested D9-contract fragments that the frontend does not yet index into
 * are typed loosely (`Record<string, unknown>`) rather than duplicating the
 * whole D9 schema here.
 *
 * IMPORTANT (D9/D10 guarantee, preserved by the client):
 *   - a missing scientific value is `null` in `values`, with `quality === 1`
 *   - a valid value is a `number` (including a real `0`), with `quality === 0`
 *   Never coerce `null` → 0 / -1 / -9999 / -1e34.
 */

export type ProductType = 'analysis' | 'forecast'

/** 0 = VALID, 1 = MISSING. */
export type QualityFlag = 0 | 1

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------
export interface HealthDataLayer {
  data_dir_exists: boolean
  bnx_files_found: string[]
  datasets_loaded: string[]
  expected_datasets: string[]
  all_expected_present: boolean
  load_errors: Record<string, string>
}

export interface HealthResponse {
  status: string
  service: string
  data_layer: HealthDataLayer | { available: false }
}

// ---------------------------------------------------------------------------
// GET /api/datasets  and  GET /api/datasets/{id}
// ---------------------------------------------------------------------------
export interface DimensionInfo {
  name: string
  role: 'time' | 'depth' | 'latitude' | 'longitude'
  size: number
}

export interface CoverageRange {
  min?: number
  max?: number
  n?: number
  step?: number | null
  units?: string | null
  ordering?: string
  [key: string]: unknown
}

export interface DatasetSummary {
  dataset_id: string
  title: string
  product_type: ProductType
  data_status: string
  schema_version: string
  parameter_ids: string[]
  dimensions: DimensionInfo[]
  shape_by_parameter: Record<string, number[]>
  time_coverage: CoverageRange
  depth_coverage: CoverageRange & { levels?: number[]; surface_only?: boolean }
  latitude_coverage: CoverageRange
  longitude_coverage: CoverageRange
  source: Record<string, unknown>
  temporal_semantics: string
  provenance_summary: Record<string, unknown>
}

export interface DatasetList {
  count: number
  datasets: DatasetSummary[]
}

export interface DatasetDetail {
  schema_version: string
  dataset_id: string
  title: string
  product_type: ProductType
  dimensions: Array<Record<string, unknown>>
  coordinates: DatasetCoordinates
  parameters: Record<string, ParameterContract>
  metadata: Record<string, unknown>
  provenance: Provenance
  generation: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
export interface ParameterContract {
  parameter_id: string
  display_name: string
  display_aliases: string[]
  source_variable: string
  source_dataset: string
  units: string
  raw_units: string | null
  units_source: string
  dimensions: string[]
  shape: number[]
  standard_name: string | null
  long_name: string | null
  kind: 'scalar_field' | 'vector_component' | 'vector_magnitude'
  vector_group: string | null
  vector_role: 'eastward' | 'northward' | null
  authoritative: boolean
  surface_only: boolean
  valid_count: number
  missing_count: number
  valid_min: number | null
  valid_max: number | null
  notes: string[]
}

export interface ParameterInfo extends ParameterContract {
  canonical_id: string
  accepts_aliases: false
  registered: boolean
}

export interface ParameterList {
  dataset_id: string
  canonical_parameter_ids: string[]
  note: string
  parameters: ParameterInfo[]
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------
export interface CoordinateAxis {
  role: 'time' | 'depth' | 'latitude' | 'longitude'
  name: string
  units: string | null
  calendar: string | null
  direction: string | null
  ordering: string
  count: number
  values: number[]
  regular_step: number | null
  /** time axis only */
  iso_times?: string[]
  reference_epoch_iso?: string
  timezone?: string
  timezone_is_assumed?: boolean
}

export interface DatasetCoordinates {
  time?: CoordinateAxis
  depth?: CoordinateAxis
  latitude?: CoordinateAxis
  longitude?: CoordinateAxis
}

export interface CoordinateList {
  dataset_id: string
  coordinates: DatasetCoordinates
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------
export interface SliceAxisSelection {
  index: number
  value: number | null
  units: string | null
}

export interface SliceTimeSelection extends SliceAxisSelection {
  iso: string | null
}

export interface Provenance {
  source_name: string
  source_url: string
  source_dataset_id: string
  source_identifier?: string
  source_file_name?: string
  source_file_sha256: string
  source_file_format?: string
  conventions: string | null
  pipeline_stages: string[]
  original_units: Record<string, string | null>
  canonical_units: Record<string, string>
}

export interface SliceParameterMetadata {
  display_name: string
  kind: string
  vector_group: string | null
  vector_role: string | null
  authoritative: boolean
  surface_only: boolean
  standard_name: string | null
  long_name: string | null
  raw_units: string | null
}

export interface SliceResponse {
  schema_version: string
  dataset_id: string
  parameter: string
  units: string
  product_type: ProductType
  data_status: string
  /** always `null` — the JSON missing marker */
  missing_value: null
  quality_definition: Record<string, string>
  time: SliceTimeSelection
  depth: SliceAxisSelection
  shape: { latitude: number; longitude: number }
  latitude: number[]
  longitude: number[]
  /** `[latitude][longitude]`; a missing cell is `null`, never a number */
  values: Array<Array<number | null>>
  /** `[latitude][longitude]`; 0 = VALID, 1 = MISSING */
  quality: QualityFlag[][]
  parameter_metadata: SliceParameterMetadata
  provenance: Provenance
  bytes_read: number
}

// ---------------------------------------------------------------------------
// Argo profiling-float observations (Step 28)
//
// Point/profile data from the INCOIS ERDDAP `Indian_ARGO_Floats` snapshot,
// served by `GET /api/observations/argo[...]`. This is NOT on the model grid
// and is never merged with it. A missing measurement is `null` — never a
// number, never the Argo `_FillValue` (99999).
// ---------------------------------------------------------------------------

/** One float profile (one ascent cycle), summary metadata only. */
export interface ArgoPlatformSummary {
  /** `<platform_number>_<cycle_number>`, e.g. `"2903951_10"`. */
  platform_id: string
  /** WMO float identifier, verbatim. */
  platform_number: string
  cycle_number: number
  /** e.g. `"PROVOR_III"`, `"ARVOR"`. */
  platform_type: string | null
  /** `"A"` = ascending profile. */
  direction: string | null
  /** ISO-8601 UTC observation time, verbatim from the source. */
  time: string | null
  /** degrees_north; `null` if the position fix is missing. */
  latitude: number | null
  /** degrees_east; `null` if the position fix is missing. */
  longitude: number | null
  level_count: number
  /** decibar. */
  pressure_min: number | null
  /** decibar. */
  pressure_max: number | null
}

/** One measured level of a profile. `null` == a real missing value. */
export interface ArgoLevel {
  /** decibar (Argo's native vertical coordinate — pressure, not depth). */
  pressure: number | null
  /** Raw Argo QC code, e.g. `"1"` (good), `"4"` (bad). */
  pressure_qc: string | null
  /** degree_Celsius (ITS-90). */
  temperature: number | null
  temperature_qc: string | null
  /** PSU (practical salinity). */
  salinity: number | null
  salinity_qc: string | null
}

export interface ArgoPlatformList {
  dataset_id: string
  count: number
  units: Record<string, string>
  platform_type: 'argo'
  note: string
  provenance: Record<string, unknown>
  platforms: ArgoPlatformSummary[]
}

export interface ArgoPlatformDetail extends ArgoPlatformSummary {
  dataset_id: string
  units: Record<string, string>
  standard_names: Record<string, string>
  quality_definition: Record<string, string>
  /** always `null` — the JSON missing marker for levels. */
  missing_value: null
  levels: ArgoLevel[]
  provenance: Record<string, unknown>
}

// GET /api/observations/argo/{platform_id}/temperature-profile — Step 44.
// The comparison-ready OBSERVED temperature profile: real Argo measurements on
// the native pressure coordinate (`pressure_dbar`, decibar — never depth), in
// ascending pressure order, both values finite. NO interpolation / smoothing /
// decimation / gap-fill / unit conversion / QC filtering. No model temperature,
// no model−observation difference (that is Step 45). Mirrors
// `ArgoObservedTemperatureProfileResponse` in `backend/app/api/schemas.py`.

/** One real observed measurement: native pressure + observed temperature. */
export interface ArgoObservedTemperatureLevel {
  /** decibar — Argo's native vertical coordinate (pressure, NOT depth/metres). */
  pressure_dbar: number
  /** degree_Celsius, verbatim from the source. */
  temperature: number
  /** raw Argo QC code, retained not applied. */
  pressure_qc: string | null
  temperature_qc: string | null
}

/** `GET /api/observations/argo/{platform_id}/temperature-profile` */
export interface ArgoObservedTemperatureProfileResponse {
  observation: {
    source: string
    dataset_id: string
    platform_id: string
    platform_number: string
    cycle_number: number
    platform_type?: string | null
    direction?: string | null
    latitude: number | null
    longitude: number | null
    /** ISO-8601 UTC, verbatim. */
    timestamp: string | null
  }
  /** Real (pressure_dbar, temperature) pairs — ascending pressure, both finite. */
  profile: ArgoObservedTemperatureLevel[]
  metadata: {
    /** `"sea_water_temperature"`. */
    variable: string
    /** `"degree_Celsius"`. */
    units: string
    /** Always `"pressure_dbar"`. */
    vertical_coordinate: string
    vertical_coordinate_units: string
    source_level_count: number
    point_count: number
    finite_temperature_count: number
    null_temperature_count: number
    finite_pressure_count?: number
    pressure_dbar_range: { min: number; max: number } | null
    temperature_range: { min: number; max: number } | null
    ordering: string
    pairing_rule: string
    qc: {
      filtering_applied: boolean
      flags_retained: boolean
      representation: string
      temperature_qc_codes_present: string[]
      definition: Record<string, string>
      note: string
    }
    transforms_applied: string
  }
  provenance: Record<string, unknown>
  notes: string[]
  /** always `null` — the JSON missing marker. */
  missing_value: null
}

// ---------------------------------------------------------------------------
// Underwater-glider observations (Step 29)
//
// Trajectory/point data from the EGO / OceanGliders GDAC dataset
// `OceanGlidersGDACTrajectories` (IFREMER ERDDAP), served by
// `GET /api/observations/gliders[...]`. A "platform" is one glider deployment;
// its detail carries the ordered CTD samples along the trajectory. NOT on the
// model grid, and NOT Argo. A missing measurement is `null` — never a number,
// never the EGO `_FillValue` (99999).
// ---------------------------------------------------------------------------

/** One glider deployment, summary metadata only. */
export interface GliderPlatformSummary {
  /** `platform_deployment`, verbatim — e.g. `"sea057_20220707"`. */
  platform_id: string
  platform_type: 'glider'
  sample_count: number
  /** ISO-8601 UTC of the first / last sample, verbatim. */
  time_start: string | null
  time_end: string | null
  latitude_min: number | null
  latitude_max: number | null
  longitude_min: number | null
  longitude_max: number | null
  /** decibar. */
  pressure_min: number | null
  pressure_max: number | null
}

/** One CTD sample along the trajectory. `null` == a real missing value. */
export interface GliderSample {
  /** ISO-8601 UTC, verbatim. */
  time: string | null
  latitude: number | null
  longitude: number | null
  /** Raw EGO QC code (reference table 2.1). */
  position_qc: string | null
  /** decibar (the glider's native vertical coordinate — pressure, not depth). */
  pressure: number | null
  pressure_qc: string | null
  /** degree_Celsius (ITS-90). */
  temperature: number | null
  temperature_qc: string | null
  /** PSU (practical salinity). */
  salinity: number | null
  salinity_qc: string | null
}

export interface GliderPlatformList {
  dataset_id: string
  count: number
  units: Record<string, string>
  platform_type: 'glider'
  note: string
  provenance: Record<string, unknown>
  platforms: GliderPlatformSummary[]
}

export interface GliderPlatformDetail extends GliderPlatformSummary {
  dataset_id: string
  units: Record<string, string>
  standard_names: Record<string, string>
  quality_definition: Record<string, string>
  /** always `null` — the JSON missing marker for samples. */
  missing_value: null
  samples: GliderSample[]
  provenance: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * `error.type` slugs the backend can return (Step 35 `app/api/errors.py` +
 * the FastAPI validation handler). Kept open (`| (string & {})`) so a new
 * backend slug is still assignable and never a compile error — the frontend
 * treats the slug as an opaque label for display / logging, it never branches
 * scientific behaviour on it.
 */
export type BackendErrorSlug =
  | 'unknown_dataset'
  | 'unknown_parameter'
  | 'parameter_not_in_dataset'
  | 'invalid_index'
  | 'malformed_request'
  | 'unknown_argo_platform' // Step 35: was folded into `unknown_dataset`
  | 'unknown_glider_deployment' // Step 35: was folded into `unknown_dataset`
  | 'data_unavailable'
  | 'internal_error'
  | 'http_error'

/** Client-synthesised slugs for failures that never reach an HTTP envelope. */
export type ClientErrorSlug = 'network_error' | 'invalid_response'

/** Any `ApiError.type` value. Non-exhaustive by design. */
export type ApiErrorType = BackendErrorSlug | ClientErrorSlug | (string & {})

/** The backend's single error envelope: `{ "error": { type, message, detail } }`. */
export interface ApiErrorEnvelope {
  error: {
    type: ApiErrorType
    message: string
    detail?: unknown
  }
}

// ---------------------------------------------------------------------------
// GET /api/netcdf/* — the real ocean MODEL dataset (Step 39 pipeline). Step 42
// wires this to the validated MERCATOR GLORYS12V1 potential-temperature file
// (`thetao`, from Copernicus Marine). Mirrors the `NetCDF*` models in
// `backend/app/api/schemas.py`.
//
// GLORYS `thetao` is stored packed as `int16`; the backend CF-decodes it
// (scale_factor / add_offset / _FillValue) to real `degrees_C` in memory — the
// raw file is untouched. `decoding` on every payload states what was applied.
// Non-finite floats are JSON `null` at the serialization boundary only
// (`nan_encoding`); decoded values are never rounded or unit-converted.
//
// This is a SEPARATE namespace from `/api/datasets` (the validated `.bnx`
// products) and never merged onto that grid.
// ---------------------------------------------------------------------------

/** One coordinate axis of the model dataset. */
export interface ModelCoordinateAxis {
  name: string
  /** `"time" | "depth" | "latitude" | "longitude" | null` (best-effort). */
  role: string | null
  dimensions: string[]
  size: number
  dtype: string
  units: string | null
  attributes: Record<string, unknown>
  /** Coordinate values verbatim; time axes as ISO-8601 UTC strings. */
  values: unknown
}

/**
 * Step 42 — whether CF `scale_factor` / `add_offset` / `_FillValue` decoding was
 * applied to a variable's values. When `cf_mask_and_scale` is `false` and
 * `source_packed` is `true`, the served values are raw packed integers, NOT
 * physical units.
 */
export interface ModelDecoding {
  cf_mask_and_scale: boolean
  source_packed?: boolean
  raw_dtype?: string | null
  decoded_dtype?: string
  applied?: string[]
  packing?: Record<string, unknown>
  note: string
}

/**
 * Step 42 — the real extent of the configured model sample. The current GLORYS
 * file is a small validation subset, so this is NOT basin-wide coverage;
 * requests outside it have no model data.
 */
export interface ModelCoverage {
  time?: { start: string | null; end: string | null; count: number }
  depth?: { min: number; max: number; count: number; units: string | null; positive?: string | null }
  latitude?: { min: number; max: number; count: number; units: string | null }
  longitude?: { min: number; max: number; count: number; units: string | null }
  bounding_box?: { latitude: [number, number]; longitude: [number, number] }
  note?: string
}

/** `GET /api/netcdf/dataset` */
export interface ModelDatasetResponse {
  dataset_id: string
  /**
   * File name + read mode + explicit model identity `label`
   * (e.g. `"GLORYS12V1 / Copernicus Marine"`) — never an absolute path.
   */
  source: Record<string, unknown> & { file_name?: string | null; label?: string | null }
  /** Dimension name → length. */
  dimensions: Record<string, number>
  coordinates: ModelCoordinateAxis[]
  /** Data-variable names (coordinates excluded). */
  variables: string[]
  variable_count: number
  global_attributes: Record<string, unknown>
  /** Step 42 — real extent of this sample (may be a small subset). */
  coverage?: ModelCoverage
  /** Step 42 — dataset-level CF decoding summary. */
  decoding?: Pick<ModelDecoding, 'cf_mask_and_scale' | 'note'>
  nan_encoding: string
}

/** `GET /api/netcdf/variables/{name}` */
export interface ModelVariableResponse {
  dataset_id: string
  name: string
  dimensions: string[]
  shape: number[]
  dtype: string
  units: string | null
  attributes: Record<string, unknown>
  /** Dimension name → resolved role (time/depth/latitude/longitude). */
  axis_roles: Record<string, string>
  /** Step 42 — CF decoding applied to this variable. */
  decoding?: ModelDecoding
  nan_encoding: string
}

export interface ModelSliceSelection {
  role: string
  dimension: string
  index: number
  value: unknown
  iso: string | null
}

/** `GET /api/netcdf/variables/{name}/slice` */
export interface ModelSliceResponse {
  dataset_id: string
  variable: string
  units: string | null
  dtype: string
  selection: ModelSliceSelection[]
  /** Dimensions remaining after selection. */
  dimensions: string[]
  shape: number[]
  element_count: number
  coordinates: Record<string, unknown>
  /**
   * Scientific values. CF-decoded to physical units (e.g. `degrees_C`) when
   * `decoding.cf_mask_and_scale` is `true`, verbatim otherwise. NaN/Infinity as
   * `null`; never rounded or unit-converted.
   */
  values: unknown
  /** Always `null` — the JSON missing marker. */
  missing_value: null
  /** Step 42 — CF decoding applied to these values. */
  decoding?: ModelDecoding
  variable_metadata: Record<string, unknown>
  nan_encoding: string
}

// ---------------------------------------------------------------------------
// GET /api/model-observations/argo/{platform_id}/temperature — Step 43.
// The GLORYS12V1 `thetao` model-temperature column at a real Argo profile's
// location & time: nearest native grid cell, nearest daily-mean timestep,
// native depth levels. Extraction ONLY — no model−observation difference, no
// reformatting of the observed profile. Mirrors `ModelAtArgoTemperatureResponse`
// in `backend/app/api/schemas.py`.
// ---------------------------------------------------------------------------

export interface ModelObsSpatialMatch {
  /** Always the nearest-native-cell description — no interpolation. */
  method: string
  requested: { latitude: number; longitude: number }
  matched: { latitude: number; longitude: number }
  latitude_difference_deg: number
  longitude_difference_deg: number
  /** Great-circle distance requested→matched, informational. */
  distance_km: number
}

export interface ModelObsTemporalMatch {
  method: string
  /** The Argo timestamp, verbatim ISO-8601 UTC. */
  requested: string | null
  /** The matched GLORYS daily-mean timestamp (…T00:00:00Z), or `null`. */
  matched: string | null
  /** Absolute |matched − requested| in seconds. */
  difference_seconds: number | null
  note: string
}

/** One native GLORYS depth level and its decoded temperature (`null` = missing). */
export interface ModelObsProfileLevel {
  depth: number | null
  temperature: number | null
}

/** `GET /api/model-observations/argo/{platform_id}/temperature` */
export interface ModelAtArgoTemperatureResponse {
  observation: {
    source: string
    dataset_id?: string
    platform_id: string
    platform_number?: string
    cycle_number: number
    latitude: number | null
    longitude: number | null
    /** ISO-8601 UTC, verbatim from the Argo snapshot. */
    timestamp: string | null
    level_count?: number
    pressure_min?: number | null
    pressure_max?: number | null
  }
  model: {
    dataset_id: string
    /** Always `"GLORYS12V1 / Copernicus Marine"`. */
    source: string
    product_id?: string
    copernicus_dataset_id?: string
    doi?: string
    file_name?: string | null
    variable: string
    standard_name: string | null
    units: string | null
    /** Nearest native grid coordinate. */
    latitude: number
    longitude: number
    /** Nearest daily-mean timestamp. */
    timestamp: string | null
    spatial_match: ModelObsSpatialMatch
    temporal_match: ModelObsTemporalMatch
    decoding?: ModelDecoding
    level_count: number
    finite_level_count: number
    null_level_count: number
    depth_units: string | null
    depth_positive?: string | null
  }
  /** The GLORYS thetao column on native depth levels (32 for the current subset). */
  profile: ModelObsProfileLevel[]
  /** The configured GLORYS file's real extent. */
  coverage?: ModelCoverage
  warnings: string[]
  /** Scientific-transparency statements. */
  notes: string[]
  nan_encoding: string
}

// GET /api/model-observations/argo/{platform_id}/temperature-comparison — Step 45.
// GLORYS12V1 thetao MINUS the real Argo observed temperature, one row per native
// GLORYS depth level. Argo pressure → depth via TEOS-10 (GSW `gsw.z_from_p`);
// original `pressure_dbar` preserved, `argo_depth_m` separate. Each GLORYS level
// matched to the nearest Argo obs by DERIVED DEPTH, within an ADAPTIVE tolerance
// of half the local GLORYS spacing — NO interpolation, NO index pairing.
// `difference_c = model_temperature_c - observed_temperature_c` (positive ⇒ model
// warmer). The nearest GLORYS cell / daily timestamp are Step 43's, unchanged.
// Mirrors `ModelObsTemperatureComparisonResponse` in `backend/app/api/schemas.py`.

/** One comparison row — a native GLORYS depth level and its matched Argo obs (if any). */
export interface ModelObsComparisonLevel {
  /** native GLORYS depth level, metres (unchanged). */
  model_depth_m: number
  model_temperature_c: number | null
  /** nearest Argo observation's ORIGINAL pressure, decibar (unchanged); null if unmatched. */
  argo_pressure_dbar: number | null
  /** derived depth of that Argo obs (TEOS-10 GSW) — separate from pressure. */
  argo_depth_m: number | null
  observed_temperature_c: number | null
  observed_temperature_qc: string | null
  observed_pressure_qc: string | null
  /** abs(argo_depth_m − model_depth_m). */
  vertical_separation_m: number | null
  /** adaptive tolerance for this GLORYS level (half the local spacing). */
  max_vertical_separation_m: number
  /** model_temperature_c − observed_temperature_c (positive ⇒ model warmer); null when unmatched. */
  difference_c: number | null
  matched: boolean
  /** why this level was not matched (null when matched). */
  reason: string | null
}

/** `GET /api/model-observations/argo/{platform_id}/temperature-comparison` */
export interface ModelObsTemperatureComparisonResponse {
  comparison: {
    platform_id: string
    model_dataset_id: string
    model_source: string
    observation_source: string
    model_variable: string
    observation_variable: string
    model_units: string | null
    observation_units: string | null
    difference_units: string
    difference_units_note?: string
    /** Exactly `"difference_c = model_temperature_c - observed_temperature_c (positive => model warmer than observation)"`. */
    difference_definition: string
    kind: string
  }
  matching: {
    vertical_method: string
    model_depth_coordinate: string
    observation_depth_method: string
    gsw_version: string
    gsw_function: string
    adaptive_tolerance_rule: string
    /** per-GLORYS-level adaptive tolerance (metres). */
    maximum_vertical_separation_m: number[]
    model_level_count: number
    matched_level_count: number
    unmatched_level_count: number
    model_depth_range_m: { min: number; max: number }
    argo_comparison_depth_range_m: { min: number; max: number } | null
    argo_levels_in_comparison_depth_band: number
    argo_observations_below_model_depth: number
    temporal_matching: string
    spatial_matching: string
  }
  /** The Step 43 matched GLORYS cell (verbatim). */
  model: Record<string, unknown> & {
    latitude: number
    longitude: number
    timestamp: string | null
    spatial_match: ModelObsSpatialMatch
    temporal_match: ModelObsTemporalMatch
  }
  observation: Record<string, unknown> & {
    platform_id: string
    latitude: number | null
    longitude: number | null
    timestamp: string | null
  }
  /** one row per native GLORYS depth level (32 for this subset). */
  profile: ModelObsComparisonLevel[]
  statistics: {
    population: string
    matched_count: number
    mean_difference_c: number | null
    mean_absolute_difference_c: number | null
    minimum_difference_c: number | null
    maximum_difference_c: number | null
    rmse_c: number | null
    note?: string
  }
  provenance: Record<string, unknown>
  notes: string[]
  nan_encoding: string
}

// ---------------------------------------------------------------------------
// GET /api/sources — Step 51.
// The real data-source / provenance catalogue: one entry per real scientific
// dataset the application uses, with dataset/product identity, variable, units,
// temporal semantics and coverage. GLORYS12V1 is Copernicus Marine data, never
// labelled as INCOIS. Metadata only — no scientific value, no filesystem path.
// Mirrors `SourceCatalogResponse` in `backend/app/api/schemas.py`.
// ---------------------------------------------------------------------------

export type DataSourceKey =
  | 'temperature'
  | 'salinity'
  | 'currents'
  | 'argo'
  | 'gliders'
  | 'model_comparison'

export interface DataSourceVariable {
  /** Raw scientific variable id(s), verbatim (e.g. `T_ANALYZED`, `thetao`). */
  name: string
  /** Plain-language name for the variable. */
  display: string
  standard_name: string | null
}

export interface DataSourceCoverageRange {
  min?: number | null
  max?: number | null
  units?: string | null
  count?: number | null
  surface_only?: boolean
}

export interface DataSourceCoverage {
  time?: { start: string | null; end: string | null; count: number | null }
  depth?: DataSourceCoverageRange
  latitude?: DataSourceCoverageRange
  longitude?: DataSourceCoverageRange
}

export interface DataSourceInfo {
  key: DataSourceKey
  category: 'field' | 'observation' | 'comparison'
  /** What this source supplies, e.g. `Temperature`. */
  context_label: string
  /** Display name, e.g. `INCOIS Ocean Analysis` / `GLORYS12V1 / Copernicus Marine`. */
  label: string
  kind: 'analysis' | 'forecast' | 'reanalysis' | 'observation'
  is_model: boolean
  /** `true` only for genuine INCOIS products — never for GLORYS12V1. */
  is_incois: boolean
  organization: string | null
  dataset_id: string | null
  /** The real upstream dataset/product id. */
  product_identifier: string | null
  product_title: string | null
  variable: DataSourceVariable
  /** Canonical unit string, or a per-quantity unit map for observations. */
  units: string | Record<string, string | null> | null
  temporal_semantics: string | null
  coverage: DataSourceCoverage | null
  /** Set when the loaded file is a partial subset (GLORYS regional subset). */
  subset_note: string | null
  url: string | null
  attribution: string | null
  /** GLORYS only — extra Copernicus identifiers. */
  copernicus_dataset_id?: string
  doi?: string
  /** Observation sources — the access portal (e.g. `INCOIS ERDDAP`). */
  access_via?: string
}

/** `GET /api/sources` */
export interface SourceCatalogResponse {
  count: number
  sources: DataSourceInfo[]
  notes: string[]
}
