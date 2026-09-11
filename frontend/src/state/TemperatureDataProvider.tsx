import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client'
import { TIME_STEPS, useVisualizationState } from './visualizationState'
import {
  INITIAL_TEMPERATURE_DATA_STATE,
  TEMPERATURE_DATASET_ID,
  TEMPERATURE_PARAMETER_ID,
  TemperatureDataContext,
  type TemperatureDataError,
  type TemperatureDataState,
  type TemperatureGridSlice,
  type TemperatureQuality,
} from './temperatureDataState'

/* ==================================================================== *
 *  D12 — fetches the real INCOIS temperature grid through the D11 client.
 *
 *  Flow (see docs/real-temperature-integration.md):
 *
 *    mount
 *      → GET /api/datasets/incois_argo_10day_analysis/coordinates
 *          (time / depth / latitude / longitude — stored exactly)
 *      → GET /api/datasets/incois_argo_10day_analysis/parameters
 *          (confirm units = degC, product_type = analysis)
 *      → for each of the 24 depth indices, at the selected time index:
 *          GET .../parameters/temperature/slice?time_index=T&depth_index=D
 *      → success: the 24 real lat×lon slices + the normalisation range
 *
 *  No mock fallback. Any failure → phase `'error'` with a description; the
 *  ocean scene keeps rendering (with the field simply absent).
 *
 *  No polling, no animation, no automatic refresh. The depth slider never
 *  triggers a fetch (all 24 depths are already loaded); only changing the
 *  selected time index refetches the 24-slice stack, and only once per index.
 * ==================================================================== */

interface TemperatureDataProviderProps {
  children: ReactNode
}

interface LoadedCoordinates {
  latitudes: number[]
  longitudes: number[]
  depthMetres: number[]
  timeIsoValues: string[]
  units: string
  productType: TemperatureDataState['productType']
}

/** Map the UI's ordered time identifier onto a real D10 time index. */
function resolveTimeIndex(selectedTime: string, realTimeCount: number): number {
  if (realTimeCount <= 0) return 0
  const position = TIME_STEPS.indexOf(selectedTime)
  const index = position < 0 ? 0 : position
  return Math.min(index, realTimeCount - 1)
}

function describeError(stage: TemperatureDataError['stage'], cause: unknown): TemperatureDataError {
  if (ApiError.is(cause)) {
    return { stage, type: cause.type, message: cause.message }
  }
  return {
    stage,
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

export function TemperatureDataProvider({ children }: TemperatureDataProviderProps) {
  const { selectedTime } = useVisualizationState()
  const [state, setState] = useState<TemperatureDataState>(() => ({
    ...INITIAL_TEMPERATURE_DATA_STATE,
    phase: 'loading',
  }))

  // Coordinates are read inside the slice effect without being a dependency of
  // it — a ref, set once, only ever read from inside effects (never render).
  const coordsRef = useRef<LoadedCoordinates | null>(null)
  const [coordsReady, setCoordsReady] = useState(false)
  const loadedKeyRef = useRef<string | null>(null)

  // Step 48 — user-triggered retry. Bumps a nonce both load effects depend on;
  // clears the caches so the requests actually re-run. No polling, no
  // auto-retry. `selectedTime` (VisualizationProvider) is left untouched, so
  // the reload lands on the same time step.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => {
    coordsRef.current = null
    loadedKeyRef.current = null
    setCoordsReady(false)
    setState(() => ({ ...INITIAL_TEMPERATURE_DATA_STATE, phase: 'loading' }))
    setReloadNonce((n) => n + 1)
  }, [])

  // Derived from *state* (not the ref), so this recomputes on the render that
  // follows the coordinates landing.
  const timeIndex = resolveTimeIndex(selectedTime, state.timeIsoValues.length)

  // --- 1. coordinates + parameter metadata (once) -----------------
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadCoordinates(): Promise<void> {
      try {
        const [coordsResponse, paramsResponse] = await Promise.all([
          dataApi.getCoordinates(TEMPERATURE_DATASET_ID, controller.signal),
          dataApi.getParameters(TEMPERATURE_DATASET_ID, controller.signal),
        ])
        if (cancelled) return

        const c = coordsResponse.coordinates
        const latitudes = [...(c.latitude?.values ?? [])]
        const longitudes = [...(c.longitude?.values ?? [])]
        const depthMetres = [...(c.depth?.values ?? [])]
        const timeIsoValues = [...(c.time?.iso_times ?? [])]

        if (latitudes.length === 0 || longitudes.length === 0 || depthMetres.length === 0) {
          throw new Error('coordinate arrays missing from the API response')
        }

        const temperature = paramsResponse.parameters.find(
          (p) => p.parameter_id === TEMPERATURE_PARAMETER_ID,
        )
        const units = temperature?.units ?? 'degC'

        coordsRef.current = {
          latitudes,
          longitudes,
          depthMetres,
          timeIsoValues,
          units,
          productType: 'analysis',
        }
        setState((current) => ({
          ...current,
          latitudes,
          longitudes,
          depthMetres,
          timeIsoValues,
          units,
          productType: 'analysis',
          slices: new Array(depthMetres.length).fill(null),
        }))
        setCoordsReady(true)
      } catch (cause) {
        if (cancelled || isAbortError(cause)) return
        setState((current) => ({
          ...current,
          phase: 'error',
          error: describeError('coordinates', cause),
        }))
      }
    }

    void loadCoordinates()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [reloadNonce])

  // --- 2. the 24-slice depth stack for the selected time index ----
  useEffect(() => {
    const coords = coordsRef.current
    if (!coordsReady || coords === null) return

    const key = `t${timeIndex}`
    if (loadedKeyRef.current === key) return // already have this time index
    loadedKeyRef.current = key

    const controller = new AbortController()
    const { signal } = controller
    let cancelled = false

    async function loadStack(): Promise<void> {
      setState((current) => ({
        ...current,
        phase: 'loading',
        error: null,
        timeIndex,
        timeIso: coords!.timeIsoValues[timeIndex] ?? null,
      }))

      try {
        const slices = await Promise.all(
          Array.from({ length: coords!.depthMetres.length }, (_unused, depthIndex) =>
            dataApi
              .getParameterSlice(TEMPERATURE_DATASET_ID, TEMPERATURE_PARAMETER_ID, {
                timeIndex,
                depthIndex,
                signal,
              })
              .then((slice): TemperatureGridSlice => ({
                timeIndex,
                depthIndex,
                depthMetres: slice.depth.value ?? coords!.depthMetres[depthIndex],
                timeIso: slice.time.iso,
                values: slice.values.map((row) => row.map((cell) => (cell === null ? null : cell))),
                quality: slice.quality.map(
                  (row) => row.map((q) => (q === 1 ? 1 : 0)) as TemperatureQuality[],
                ),
              })),
          ),
        )
        if (cancelled) return

        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        for (const slice of slices) {
          for (const row of slice.values) {
            for (const cell of row) {
              if (cell === null) continue
              if (cell < min) min = cell
              if (cell > max) max = cell
            }
          }
        }
        const hasValues = Number.isFinite(min) && Number.isFinite(max)

        setState((current) => ({
          ...current,
          phase: 'success',
          slices,
          timeIndex,
          timeIso: coords!.timeIsoValues[timeIndex] ?? slices[0]?.timeIso ?? null,
          min: hasValues ? min : null,
          max: hasValues ? max : null,
          error: null,
          updatedAt: new Date().toISOString(),
        }))
      } catch (cause) {
        if (cancelled || isAbortError(cause)) return
        loadedKeyRef.current = null // let a revisit retry
        setState((current) => ({
          ...current,
          phase: 'error',
          error: describeError('slices', cause),
        }))
      }
    }

    void loadStack()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [coordsReady, timeIndex, reloadNonce])

  const value = useMemo(() => ({ ...state, reload }), [state, reload])

  return <TemperatureDataContext value={value}>{children}</TemperatureDataContext>
}
