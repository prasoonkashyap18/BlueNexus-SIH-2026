import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client'
import { TIME_STEPS, useVisualizationState } from './visualizationState'
import {
  INITIAL_SALINITY_DATA_STATE,
  SALINITY_DATASET_ID,
  SALINITY_PARAMETER_ID,
  SalinityDataContext,
  type SalinityDataError,
  type SalinityDataState,
  type SalinityGridSlice,
  type SalinityQuality,
} from './salinityDataState'

/* ==================================================================== *
 *  D13 — fetches the real INCOIS salinity grid through the D11 client.
 *
 *  Same shape as the D12 temperature provider (they share the analysis
 *  dataset), see docs/salinity-current-integration.md:
 *
 *    mount
 *      → GET /api/datasets/incois_argo_10day_analysis/coordinates
 *          (time / depth / latitude / longitude — stored exactly)
 *      → GET /api/datasets/incois_argo_10day_analysis/parameters
 *          (confirm units = PSU, product_type = analysis)
 *      → for each of the 24 depth indices, at the selected time index:
 *          GET .../parameters/salinity/slice?time_index=T&depth_index=D
 *      → success: the 24 real lat×lon slices + the normalisation range
 *
 *  No mock fallback. Any failure → phase `'error'` with a description; the
 *  ocean scene keeps rendering (with the salinity field simply absent).
 *
 *  No polling, no animation, no automatic refresh. The depth slider never
 *  triggers a fetch (all 24 depths are already loaded); only changing the
 *  selected time index refetches the 24-slice stack, and only once per index.
 * ==================================================================== */

interface SalinityDataProviderProps {
  children: ReactNode
}

interface LoadedCoordinates {
  latitudes: number[]
  longitudes: number[]
  depthMetres: number[]
  timeIsoValues: string[]
  units: string
  productType: SalinityDataState['productType']
}

/** Map the UI's ordered time identifier onto a real D10 time index. */
function resolveTimeIndex(selectedTime: string, realTimeCount: number): number {
  if (realTimeCount <= 0) return 0
  const position = TIME_STEPS.indexOf(selectedTime)
  const index = position < 0 ? 0 : position
  return Math.min(index, realTimeCount - 1)
}

function describeError(stage: SalinityDataError['stage'], cause: unknown): SalinityDataError {
  if (ApiError.is(cause)) {
    return { stage, type: cause.type, message: cause.message }
  }
  return {
    stage,
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

export function SalinityDataProvider({ children }: SalinityDataProviderProps) {
  const { selectedTime } = useVisualizationState()
  const [state, setState] = useState<SalinityDataState>(() => ({
    ...INITIAL_SALINITY_DATA_STATE,
    phase: 'loading',
  }))

  const coordsRef = useRef<LoadedCoordinates | null>(null)
  const [coordsReady, setCoordsReady] = useState(false)
  const loadedKeyRef = useRef<string | null>(null)

  // Step 48 — user-triggered retry (see the temperature provider for notes).
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => {
    coordsRef.current = null
    loadedKeyRef.current = null
    setCoordsReady(false)
    setState(() => ({ ...INITIAL_SALINITY_DATA_STATE, phase: 'loading' }))
    setReloadNonce((n) => n + 1)
  }, [])

  const timeIndex = resolveTimeIndex(selectedTime, state.timeIsoValues.length)

  // --- 1. coordinates + parameter metadata (once) -----------------
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadCoordinates(): Promise<void> {
      try {
        const [coordsResponse, paramsResponse] = await Promise.all([
          dataApi.getCoordinates(SALINITY_DATASET_ID, controller.signal),
          dataApi.getParameters(SALINITY_DATASET_ID, controller.signal),
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

        const salinity = paramsResponse.parameters.find(
          (p) => p.parameter_id === SALINITY_PARAMETER_ID,
        )
        const units = salinity?.units ?? 'PSU'

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
              .getParameterSlice(SALINITY_DATASET_ID, SALINITY_PARAMETER_ID, {
                timeIndex,
                depthIndex,
                signal,
              })
              .then((slice): SalinityGridSlice => ({
                timeIndex,
                depthIndex,
                depthMetres: slice.depth.value ?? coords!.depthMetres[depthIndex],
                timeIso: slice.time.iso,
                values: slice.values.map((row) => row.map((cell) => (cell === null ? null : cell))),
                quality: slice.quality.map(
                  (row) => row.map((q) => (q === 1 ? 1 : 0)) as SalinityQuality[],
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

  return <SalinityDataContext value={value}>{children}</SalinityDataContext>
}
