/**
 * BlueNexus data-API layer (D11).
 *
 * The frontend's single path to the D10 backend. Import from here rather than
 * from the individual modules.
 */

export { API_BASE_URL, API_BASE_URL_IS_CONFIGURED } from './config.ts'
export {
  ApiError,
  KNOWN_DATASET_IDS,
  createDataApiClient,
  dataApi,
  isAbortError,
} from './client.ts'
export type {
  ApiErrorKind,
  CreateDataApiClientOptions,
  DataApiClient,
  ModelSliceQuery,
  ParameterSliceQuery,
} from './client.ts'
export {
  MODEL_TEMPERATURE_VARIABLE,
  summarizeModelCoverage,
  isPointInModelCoverage,
  describeModelCoverage,
  formatLatitude as formatModelLatitude,
  formatLongitude as formatModelLongitude,
} from './modelCoverage.ts'
export type { ModelCoverageSummary, Range as ModelCoverageRange } from './modelCoverage.ts'
export { useDataApiConnection } from './useDataApiConnection.ts'
export type {
  CoordinateSummary,
  DataApiConnectionError,
  DataApiConnectionState,
  DataApiPhase,
  TemperatureSliceSummary,
} from './useDataApiConnection.ts'
export { DataApiConnectionProbe } from './DataApiConnectionProbe.tsx'
export type * from './types.ts'
