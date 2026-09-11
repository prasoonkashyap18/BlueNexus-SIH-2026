/**
 * Data-API client — the frontend's single boundary to the production backend
 * (Step 35 FastAPI contract). Components, hooks and providers call these
 * functions; nothing else in the app calls `fetch()` or builds an `/api/...`
 * URL.
 *
 * Failure policy: the client NEVER falls back to mock data and NEVER swallows a
 * failure. Every failure is thrown as an {@link ApiError} whose `kind`
 * classifies it — `network` (transport never reached the server), `http` (the
 * server answered non-2xx; the backend `{type,message,detail}` envelope is
 * preserved when present), or `malformed` (2xx but the body is not the JSON we
 * expect). Callers decide what to show; they must not render fabricated values.
 */

import { API_BASE_URL } from './config.ts'
import type {
  ApiErrorEnvelope,
  ApiErrorType,
  ArgoObservedTemperatureProfileResponse,
  ArgoPlatformDetail,
  ArgoPlatformList,
  CoordinateList,
  DatasetDetail,
  DatasetList,
  GliderPlatformDetail,
  GliderPlatformList,
  HealthResponse,
  ModelAtArgoTemperatureResponse,
  ModelObsTemperatureComparisonResponse,
  ModelDatasetResponse,
  ModelSliceResponse,
  ModelVariableResponse,
  ParameterList,
  SliceResponse,
  SourceCatalogResponse,
} from './types.ts'

/**
 * How an {@link ApiError} was produced:
 * - `network` — the request never got an HTTP response (offline, DNS, CORS,
 *   connection refused). `status` is `null`. (A caller-initiated abort is a
 *   separate `AbortError`, not an `ApiError` — see {@link isAbortError}.)
 * - `http` — the server answered with a non-2xx status. `status` is set, and
 *   `type` / `detail` come from the backend envelope when it sent one.
 * - `malformed` — a 2xx response whose body could not be parsed as the JSON the
 *   endpoint is contracted to return.
 */
export type ApiErrorKind = 'network' | 'http' | 'malformed'

/** Error thrown for any failed API call. Preserves the backend error envelope. */
export class ApiError extends Error {
  /** Which class of failure this is. */
  readonly kind: ApiErrorKind
  /** HTTP status, or `null` for a network / transport failure. */
  readonly status: number | null
  /** Backend `error.type` (e.g. `"unknown_parameter"`), or a synthetic slug. */
  readonly type: ApiErrorType
  /** Backend `error.detail`, when present. */
  readonly detail: unknown
  /** The request URL. */
  readonly url: string

  constructor(
    message: string,
    init: {
      kind: ApiErrorKind
      status: number | null
      type: ApiErrorType
      detail?: unknown
      url: string
      cause?: unknown
    },
  ) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status
    this.type = init.type
    this.detail = init.detail
    this.url = init.url
  }

  static is(value: unknown): value is ApiError {
    return value instanceof ApiError
  }
}

/** Thrown request abort — re-exported so callers can ignore it on unmount. */
export function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}

/**
 * Shape check for the backend's error envelope (`{ error: { type, message } }`).
 * Used to read `type` / `detail` off a non-2xx body only when they are actually
 * there — a proxy/HTML 502 page or an empty body falls through to a generic
 * `http_<status>` error instead of a misleading cast.
 */
function isErrorEnvelope(body: unknown): body is ApiErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const err = (body as { error: unknown }).error
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { type?: unknown }).type === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  )
}

export interface ParameterSliceQuery {
  timeIndex?: number
  depthIndex?: number
  signal?: AbortSignal
}

/**
 * Indexed selection of one model variable (Step 41 `/api/netcdf/.../slice`).
 * Every index is optional and 0-based; an omitted axis is returned in full.
 * Indices are never clamped — an out-of-range index is a `422`.
 */
export interface ModelSliceQuery {
  timeIndex?: number
  depthIndex?: number
  latitudeIndex?: number
  longitudeIndex?: number
  signal?: AbortSignal
}

export interface DataApiClient {
  readonly baseUrl: string
  getHealth(signal?: AbortSignal): Promise<HealthResponse>
  getDatasets(signal?: AbortSignal): Promise<DatasetList>
  getDataset(datasetId: string, signal?: AbortSignal): Promise<DatasetDetail>
  getParameters(datasetId: string, signal?: AbortSignal): Promise<ParameterList>
  getCoordinates(datasetId: string, signal?: AbortSignal): Promise<CoordinateList>
  getParameterSlice(
    datasetId: string,
    parameterId: string,
    query?: ParameterSliceQuery,
  ): Promise<SliceResponse>
  /** Step 28: real INCOIS Argo float profiles (summary list). */
  getArgoPlatforms(signal?: AbortSignal): Promise<ArgoPlatformList>
  /** Step 28: one real Argo float profile with every measured level. */
  getArgoPlatform(platformId: string, signal?: AbortSignal): Promise<ArgoPlatformDetail>
  /**
   * Step 44: the comparison-ready OBSERVED temperature profile for one real Argo
   * profile — real `(pressure_dbar, temperature)` pairs on the native pressure
   * coordinate (decibar, never depth), ascending pressure, both finite, raw QC
   * codes retained. No interpolation / smoothing / decimation / QC filtering,
   * no model temperature, no model−observation difference. `platformId` is the
   * composite `<platform_number>_<cycle_number>`. Throws {@link ApiError}
   * `unknown_argo_platform` (404) / `malformed_request` (422).
   */
  getArgoObservedTemperatureProfile(
    platformId: string,
    signal?: AbortSignal,
  ): Promise<ArgoObservedTemperatureProfileResponse>
  /** Step 29: real EGO / OceanGliders glider deployments (summary list). */
  getGliderPlatforms(signal?: AbortSignal): Promise<GliderPlatformList>
  /** Step 29: one real glider deployment with every trajectory sample. */
  getGliderPlatform(platformId: string, signal?: AbortSignal): Promise<GliderPlatformDetail>
  /**
   * Step 42: the real ocean MODEL dataset (GLORYS12V1 / Copernicus Marine) —
   * identity + `source.label`, dimensions, native coordinates, variables,
   * global metadata, and the sample's real `coverage` extent. Throws
   * {@link ApiError} `netcdf_not_configured` / `netcdf_unavailable` if the
   * backend has no model file — there is no synthetic fallback.
   */
  getModelDataset(signal?: AbortSignal): Promise<ModelDatasetResponse>
  /**
   * Step 42: one model variable's metadata (dimensions, shape, dtype, units)
   * plus its `decoding` block. For GLORYS `thetao` the values are CF-decoded to
   * `degrees_C` (`dtype: "float64"`), never packed `int16`.
   */
  getModelVariable(variableName: string, signal?: AbortSignal): Promise<ModelVariableResponse>
  /**
   * Step 42: an indexed selection of one model variable, with real values —
   * CF-decoded `degrees_C` for GLORYS `thetao`. Missing cells are `null`.
   */
  getModelVariableSlice(
    variableName: string,
    query?: ModelSliceQuery,
  ): Promise<ModelSliceResponse>
  /**
   * Step 43: the GLORYS12V1 `thetao` model-temperature profile at a real Argo
   * profile's location & time — nearest native grid cell, nearest daily-mean
   * timestep, native depth levels. Extraction only (no model−observation
   * difference). `platformId` is the composite `<platform_number>_<cycle_number>`
   * (e.g. `"3902669_4"`). Throws {@link ApiError}:
   * `unknown_argo_platform` (404), `malformed_request` (422),
   * `observation_outside_model_coverage` (422),
   * `netcdf_not_configured` / `netcdf_unavailable` (503). Never synthetic data.
   */
  getModelTemperatureAtArgo(
    platformId: string,
    signal?: AbortSignal,
  ): Promise<ModelAtArgoTemperatureResponse>
  /**
   * Step 45: GLORYS12V1 `thetao` **minus** the real Argo observed temperature,
   * one row per native GLORYS depth level. Argo pressure → depth via TEOS-10
   * (GSW); each GLORYS level matched to the nearest Argo obs by derived depth
   * within an adaptive tolerance of half the local GLORYS spacing — no
   * interpolation, no index pairing. `difference_c = model − observed`
   * (positive ⇒ model warmer). Reuses Step 43's spatial/temporal match.
   * `platformId` is the composite `<platform_number>_<cycle_number>`. Throws
   * {@link ApiError} `unknown_argo_platform` (404), `malformed_request` (422),
   * `observation_outside_model_coverage` (422),
   * `netcdf_not_configured` / `netcdf_unavailable` (503).
   */
  getModelObservationTemperatureComparison(
    platformId: string,
    signal?: AbortSignal,
  ): Promise<ModelObsTemperatureComparisonResponse>
  /**
   * Step 51: the real data-source / provenance catalogue — one entry per real
   * scientific dataset the app uses (INCOIS temperature/salinity analysis,
   * INCOIS IO-HOOFS currents, INCOIS Indian_ARGO_Floats, EGO/OceanGliders GDAC,
   * and the GLORYS12V1 / Copernicus Marine model used for the comparison), with
   * dataset/product identity, variable, units, temporal semantics and coverage.
   * Metadata only — no scientific value, no filesystem path.
   */
  getSourceCatalog(signal?: AbortSignal): Promise<SourceCatalogResponse>
}

export interface CreateDataApiClientOptions {
  /** Override the base URL (defaults to {@link API_BASE_URL}). */
  baseUrl?: string
  /** Inject a `fetch` implementation (defaults to the global). Used by tests. */
  fetch?: typeof fetch
}

export function createDataApiClient(options: CreateDataApiClientOptions = {}): DataApiClient {
  const baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/+$/, '')
  const doFetch = options.fetch ?? globalThis.fetch

  async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = `${baseUrl}${path}`

    let response: Response
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (cause) {
      if (isAbortError(cause)) {
        throw cause
      }
      throw new ApiError(`Could not reach the data API at ${url}.`, {
        kind: 'network',
        status: null,
        type: 'network_error',
        url,
        cause,
      })
    }

    const raw = await response.text()
    let body: unknown = null
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = null
      }
    }

    if (!response.ok) {
      const envelope = isErrorEnvelope(body) ? body : null
      const err = envelope?.error
      throw new ApiError(
        err?.message ?? `Request to ${url} failed with HTTP ${response.status}.`,
        {
          kind: 'http',
          status: response.status,
          type: err?.type ?? `http_${response.status}`,
          detail: err?.detail,
          url,
        },
      )
    }

    if (body === null && raw.trim() !== 'null') {
      throw new ApiError(`The data API returned an unparseable response from ${url}.`, {
        kind: 'malformed',
        status: response.status,
        type: 'invalid_response',
        url,
      })
    }

    return body as T
  }

  function encode(segment: string): string {
    return encodeURIComponent(segment)
  }

  return {
    baseUrl,

    getHealth: (signal) => request<HealthResponse>('/api/health', signal),

    getDatasets: (signal) => request<DatasetList>('/api/datasets', signal),

    getDataset: (datasetId, signal) =>
      request<DatasetDetail>(`/api/datasets/${encode(datasetId)}`, signal),

    getParameters: (datasetId, signal) =>
      request<ParameterList>(`/api/datasets/${encode(datasetId)}/parameters`, signal),

    getCoordinates: (datasetId, signal) =>
      request<CoordinateList>(`/api/datasets/${encode(datasetId)}/coordinates`, signal),

    getParameterSlice: (datasetId, parameterId, query = {}) => {
      const timeIndex = query.timeIndex ?? 0
      const depthIndex = query.depthIndex ?? 0
      const search = `?time_index=${encode(String(timeIndex))}&depth_index=${encode(String(depthIndex))}`
      return request<SliceResponse>(
        `/api/datasets/${encode(datasetId)}/parameters/${encode(parameterId)}/slice${search}`,
        query.signal,
      )
    },

    getArgoPlatforms: (signal) => request<ArgoPlatformList>('/api/observations/argo', signal),

    getArgoPlatform: (platformId, signal) =>
      request<ArgoPlatformDetail>(`/api/observations/argo/${encode(platformId)}`, signal),

    getArgoObservedTemperatureProfile: (platformId, signal) =>
      request<ArgoObservedTemperatureProfileResponse>(
        `/api/observations/argo/${encode(platformId)}/temperature-profile`,
        signal,
      ),

    getGliderPlatforms: (signal) =>
      request<GliderPlatformList>('/api/observations/gliders', signal),

    getGliderPlatform: (platformId, signal) =>
      request<GliderPlatformDetail>(`/api/observations/gliders/${encode(platformId)}`, signal),

    getModelDataset: (signal) => request<ModelDatasetResponse>('/api/netcdf/dataset', signal),

    getModelVariable: (variableName, signal) =>
      request<ModelVariableResponse>(
        `/api/netcdf/variables/${encode(variableName)}`,
        signal,
      ),

    getModelVariableSlice: (variableName, query = {}) => {
      const params = new URLSearchParams()
      if (query.timeIndex !== undefined) params.set('time_index', String(query.timeIndex))
      if (query.depthIndex !== undefined) params.set('depth_index', String(query.depthIndex))
      if (query.latitudeIndex !== undefined)
        params.set('latitude_index', String(query.latitudeIndex))
      if (query.longitudeIndex !== undefined)
        params.set('longitude_index', String(query.longitudeIndex))
      const search = params.toString() ? `?${params.toString()}` : ''
      return request<ModelSliceResponse>(
        `/api/netcdf/variables/${encode(variableName)}/slice${search}`,
        query.signal,
      )
    },

    getModelTemperatureAtArgo: (platformId, signal) =>
      request<ModelAtArgoTemperatureResponse>(
        `/api/model-observations/argo/${encode(platformId)}/temperature`,
        signal,
      ),

    getModelObservationTemperatureComparison: (platformId, signal) =>
      request<ModelObsTemperatureComparisonResponse>(
        `/api/model-observations/argo/${encode(platformId)}/temperature-comparison`,
        signal,
      ),

    getSourceCatalog: (signal) => request<SourceCatalogResponse>('/api/sources', signal),
  }
}

/** The app-wide client instance, bound to {@link API_BASE_URL}. */
export const dataApi: DataApiClient = createDataApiClient()

/** Canonical ids of the datasets D10 is known to serve (D10 `_KNOWN_DATASETS`). */
export const KNOWN_DATASET_IDS = [
  'incois_argo_10day_analysis',
  'incois_io_hoofs_surface_currents',
] as const
