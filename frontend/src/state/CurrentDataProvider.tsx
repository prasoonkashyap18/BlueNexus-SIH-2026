import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client'
import type { SliceResponse } from '../api/types'
import { TIME_STEPS, useVisualizationState } from './visualizationState'
import {
  CURRENT_DATASET_ID,
  CURRENT_PARAMETER_IDS,
  CURRENT_SPEED_PARAMETER_ID,
  CURRENT_SURFACE_DEPTH_INDEX,
  CurrentDataContext,
  INITIAL_CURRENT_DATA_STATE,
  type CurrentDataError,
  type CurrentDataState,
  type CurrentGrid,
  type CurrentQuality,
} from './currentDataState'

/* ==================================================================== *
 *  D13 — fetches the real INCOIS IO-HOOFS surface-current grid through the
 *  D11 client. See docs/salinity-current-integration.md.
 *
 *    mount
 *      → GET /api/datasets/incois_io_hoofs_surface_currents/coordinates
 *          (time / depth / latitude / longitude — stored exactly; its OWN grid)
 *      → GET /api/datasets/incois_io_hoofs_surface_currents/parameters
 *          (confirm units = m s-1, product_type = forecast, surface_only = true)
 *      → for the selected forecast time index, depth_index = 0:
 *          GET .../parameters/current_u/slice?time_index=T&depth_index=0
 *          GET .../parameters/current_v/slice?time_index=T&depth_index=0
 *          GET .../parameters/current_speed/slice?time_index=T&depth_index=0
 *      → success: the three real 421 × 601 planes + the speed normalisation range
 *
 *  No mock fallback. Any failure → phase `'error'`; the ocean scene keeps
 *  rendering (with the current layer simply absent).
 *
 *  Performance (D13 §25): the current slice is 421 × 601 — far larger than the
 *  36 × 51 analysis grid. Only the three slices for the *selected forecast
 *  time* are fetched, once per time index (`loadedKeyRef`). The depth slider
 *  never triggers a fetch — currents are surface-only. Stable effect deps, one
 *  `AbortController` per cycle. No polling, no automatic refresh.
 * ==================================================================== */

interface CurrentDataProviderProps {
  children: ReactNode
}

interface LoadedCoordinates {
  latitudes: number[]
  longitudes: number[]
  timeIsoValues: string[]
  units: string
}

/** Map the UI's ordered time identifier onto a real D10 forecast time index. */
function resolveTimeIndex(selectedTime: string, realTimeCount: number): number {
  if (realTimeCount <= 0) return 0
  const position = TIME_STEPS.indexOf(selectedTime)
  const index = position < 0 ? 0 : position
  return Math.min(index, realTimeCount - 1)
}

function describeError(stage: CurrentDataError['stage'], cause: unknown): CurrentDataError {
  if (ApiError.is(cause)) {
    return { stage, type: cause.type, message: cause.message }
  }
  return {
    stage,
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

/** `null` stays `null`; a number (including a real `0`) stays a number. */
function preserveValues(values: SliceResponse['values']): CurrentGrid['u'] {
  return values.map((row) => row.map((cell) => (cell === null ? null : cell)))
}

function preserveQuality(quality: SliceResponse['quality']): ReadonlyArray<ReadonlyArray<CurrentQuality>> {
  return quality.map((row) => row.map((q) => (q === 1 ? 1 : 0)) as CurrentQuality[])
}

export function CurrentDataProvider({ children }: CurrentDataProviderProps) {
  const { selectedTime } = useVisualizationState()
  const [state, setState] = useState<CurrentDataState>(() => ({
    ...INITIAL_CURRENT_DATA_STATE,
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
    setState(() => ({ ...INITIAL_CURRENT_DATA_STATE, phase: 'loading' }))
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
          dataApi.getCoordinates(CURRENT_DATASET_ID, controller.signal),
          dataApi.getParameters(CURRENT_DATASET_ID, controller.signal),
        ])
        if (cancelled) return

        const c = coordsResponse.coordinates
        const latitudes = [...(c.latitude?.values ?? [])]
        const longitudes = [...(c.longitude?.values ?? [])]
        const timeIsoValues = [...(c.time?.iso_times ?? [])]

        if (latitudes.length === 0 || longitudes.length === 0) {
          throw new Error('coordinate arrays missing from the API response')
        }

        const speed = paramsResponse.parameters.find(
          (p) => p.parameter_id === CURRENT_SPEED_PARAMETER_ID,
        )
        const units = speed?.units ?? 'm s-1'

        coordsRef.current = { latitudes, longitudes, timeIsoValues, units }
        setState((current) => ({
          ...current,
          latitudes,
          longitudes,
          timeIsoValues,
          units,
          productType: 'forecast',
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

  // --- 2. the three surface planes for the selected forecast time -
  useEffect(() => {
    const coords = coordsRef.current
    if (!coordsReady || coords === null) return

    const key = `t${timeIndex}`
    if (loadedKeyRef.current === key) return // already have this forecast time
    loadedKeyRef.current = key

    const controller = new AbortController()
    const { signal } = controller
    let cancelled = false

    async function loadPlanes(): Promise<void> {
      setState((current) => ({
        ...current,
        phase: 'loading',
        error: null,
        timeIndex,
        timeIso: coords!.timeIsoValues[timeIndex] ?? null,
      }))

      try {
        const [uSlice, vSlice, speedSlice] = await Promise.all(
          CURRENT_PARAMETER_IDS.map((parameterId) =>
            dataApi.getParameterSlice(CURRENT_DATASET_ID, parameterId, {
              timeIndex,
              depthIndex: CURRENT_SURFACE_DEPTH_INDEX,
              signal,
            }),
          ),
        )
        if (cancelled) return

        const grid: CurrentGrid = {
          timeIndex,
          timeIso: speedSlice.time.iso,
          u: preserveValues(uSlice.values),
          v: preserveValues(vSlice.values),
          speed: preserveValues(speedSlice.values),
          quality: {
            u: preserveQuality(uSlice.quality),
            v: preserveQuality(vSlice.quality),
            speed: preserveQuality(speedSlice.quality),
          },
        }

        // Normalisation range from the AUTHORITATIVE speed only — never sqrt(u²+v²).
        let speedMin = Number.POSITIVE_INFINITY
        let speedMax = Number.NEGATIVE_INFINITY
        for (const row of grid.speed) {
          for (const cell of row) {
            if (cell === null) continue
            if (cell < speedMin) speedMin = cell
            if (cell > speedMax) speedMax = cell
          }
        }
        const hasSpeed = Number.isFinite(speedMin) && Number.isFinite(speedMax)

        setState((current) => ({
          ...current,
          phase: 'success',
          grid,
          timeIndex,
          timeIso: coords!.timeIsoValues[timeIndex] ?? speedSlice.time.iso ?? null,
          speedMin: hasSpeed ? speedMin : null,
          speedMax: hasSpeed ? speedMax : null,
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

    void loadPlanes()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [coordsReady, timeIndex, reloadNonce])

  const value = useMemo(() => ({ ...state, reload }), [state, reload])

  return <CurrentDataContext value={value}>{children}</CurrentDataContext>
}
