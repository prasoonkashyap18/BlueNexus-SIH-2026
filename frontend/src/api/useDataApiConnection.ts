/**
 * `useDataApiConnection` — the D11 connection probe.
 *
 * On mount it runs the real discovery flow against the D10 backend:
 *
 *   health → datasets → temperature parameters → coordinates → temperature slice
 *
 * and exposes an `idle | loading | success | error` state plus the parsed
 * results. It does NOT touch the 3D visualization or its mock data — replacing
 * the mock temperature field is D12. This hook only proves the frontend can
 * reach and parse the API, and gives later steps a ready-made data path.
 *
 * Failure is explicit: on any step failing, `phase` becomes `"error"` and
 * `error` describes which step and why. There is no mock fallback.
 */

import { useEffect, useState } from 'react'
import { KNOWN_DATASET_IDS, dataApi, isAbortError, ApiError } from './client.ts'
import type {
  CoordinateAxis,
  HealthResponse,
  ParameterInfo,
} from './types.ts'

export type DataApiPhase = 'idle' | 'loading' | 'success' | 'error'

const ANALYSIS_DATASET = 'incois_argo_10day_analysis'
const TEMPERATURE_PARAMETER = 'temperature'

export interface CoordinateSummary {
  time: { count: number; iso: string[] | null; units: string | null }
  depth: { count: number; first: number | null; last: number | null; units: string | null }
  latitude: { count: number; min: number | null; max: number | null }
  longitude: { count: number; min: number | null; max: number | null }
}

export interface TemperatureSliceSummary {
  rows: number
  columns: number
  validCount: number
  missingCount: number
  sampleValidValue: number | null
  containsExplicitNull: boolean
  timeIso: string | null
  depthValue: number | null
  units: string
  bytesRead: number
}

export interface DataApiConnectionError {
  step: string
  type: string
  message: string
  detail: unknown
}

export interface DataApiConnectionState {
  phase: DataApiPhase
  baseUrl: string
  checkedAt: string | null
  health: HealthResponse | null
  datasetIds: string[] | null
  temperatureParameter: ParameterInfo | null
  coordinates: CoordinateSummary | null
  temperatureSlice: TemperatureSliceSummary | null
  error: DataApiConnectionError | null
}

const INITIAL_STATE: DataApiConnectionState = {
  phase: 'idle',
  baseUrl: dataApi.baseUrl,
  checkedAt: null,
  health: null,
  datasetIds: null,
  temperatureParameter: null,
  coordinates: null,
  temperatureSlice: null,
  error: null,
}

function axisSummary(axis: CoordinateAxis | undefined) {
  const values = axis?.values ?? []
  return {
    count: axis?.count ?? 0,
    first: values.length ? values[0] : null,
    last: values.length ? values[values.length - 1] : null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    units: axis?.units ?? null,
  }
}

function toError(step: string, cause: unknown): DataApiConnectionError {
  if (ApiError.is(cause)) {
    return { step, type: cause.type, message: cause.message, detail: cause.detail }
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  return { step, type: 'unexpected_error', message, detail: null }
}

export function useDataApiConnection(): DataApiConnectionState {
  const [state, setState] = useState<DataApiConnectionState>(INITIAL_STATE)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let cancelled = false

    const commit = (patch: Partial<DataApiConnectionState>) => {
      if (!cancelled) {
        setState((current) => ({ ...current, ...patch }))
      }
    }

    async function run(): Promise<void> {
      commit({ phase: 'loading', error: null, checkedAt: null })

      // 1. health
      let health: HealthResponse
      try {
        health = await dataApi.getHealth(signal)
      } catch (cause) {
        if (isAbortError(cause)) return
        commit({ phase: 'error', error: toError('health', cause) })
        return
      }
      commit({ health })

      // 2. datasets
      let datasetIds: string[]
      try {
        const list = await dataApi.getDatasets(signal)
        datasetIds = list.datasets.map((d) => d.dataset_id)
      } catch (cause) {
        if (isAbortError(cause)) return
        commit({ phase: 'error', error: toError('datasets', cause) })
        return
      }
      commit({ datasetIds })
      const missingKnown = KNOWN_DATASET_IDS.filter((id) => !datasetIds.includes(id))
      if (missingKnown.length > 0) {
        commit({
          phase: 'error',
          error: {
            step: 'datasets',
            type: 'unexpected_catalog',
            message: `Backend did not report expected dataset(s): ${missingKnown.join(', ')}`,
            detail: { reported: datasetIds },
          },
        })
        return
      }

      // 3. temperature parameter metadata
      let temperatureParameter: ParameterInfo
      try {
        const params = await dataApi.getParameters(ANALYSIS_DATASET, signal)
        const found = params.parameters.find((p) => p.parameter_id === TEMPERATURE_PARAMETER)
        if (!found) {
          throw new Error(`'${TEMPERATURE_PARAMETER}' not present in ${ANALYSIS_DATASET}`)
        }
        temperatureParameter = found
      } catch (cause) {
        if (isAbortError(cause)) return
        commit({ phase: 'error', error: toError('parameters', cause) })
        return
      }
      commit({ temperatureParameter })

      // 4. coordinates
      let coordinates: CoordinateSummary
      try {
        const coords = await dataApi.getCoordinates(ANALYSIS_DATASET, signal)
        const time = axisSummary(coords.coordinates.time)
        const depth = axisSummary(coords.coordinates.depth)
        const latitude = axisSummary(coords.coordinates.latitude)
        const longitude = axisSummary(coords.coordinates.longitude)
        coordinates = {
          time: { count: time.count, iso: coords.coordinates.time?.iso_times ?? null, units: time.units },
          depth: { count: depth.count, first: depth.first, last: depth.last, units: depth.units },
          latitude: { count: latitude.count, min: latitude.min, max: latitude.max },
          longitude: { count: longitude.count, min: longitude.min, max: longitude.max },
        }
      } catch (cause) {
        if (isAbortError(cause)) return
        commit({ phase: 'error', error: toError('coordinates', cause) })
        return
      }
      commit({ coordinates })

      // 5. one real temperature slice (parsed, NOT rendered — D12 renders it)
      let temperatureSlice: TemperatureSliceSummary
      try {
        const slice = await dataApi.getParameterSlice(ANALYSIS_DATASET, TEMPERATURE_PARAMETER, {
          timeIndex: 0,
          depthIndex: 0,
          signal,
        })
        let validCount = 0
        let missingCount = 0
        let containsExplicitNull = false
        let sampleValidValue: number | null = null
        for (let r = 0; r < slice.values.length; r += 1) {
          const row = slice.values[r]
          for (let c = 0; c < row.length; c += 1) {
            const cell = row[c]
            if (cell === null) {
              missingCount += 1
              containsExplicitNull = true
            } else {
              validCount += 1
              if (sampleValidValue === null) sampleValidValue = cell
            }
          }
        }
        temperatureSlice = {
          rows: slice.values.length,
          columns: slice.values[0]?.length ?? 0,
          validCount,
          missingCount,
          sampleValidValue,
          containsExplicitNull,
          timeIso: slice.time.iso,
          depthValue: slice.depth.value,
          units: slice.units,
          bytesRead: slice.bytes_read,
        }
      } catch (cause) {
        if (isAbortError(cause)) return
        commit({ phase: 'error', error: toError('slice', cause) })
        return
      }

      commit({
        phase: 'success',
        temperatureSlice,
        checkedAt: new Date().toISOString(),
      })
    }

    void run()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return state
}
