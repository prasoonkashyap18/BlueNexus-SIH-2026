import { createContext, useContext } from 'react'
import type { ProductType } from '../api/types'

/* ==================================================================== *
 *  D12 — real INCOIS temperature data state
 *
 *  Holds the real temperature grid fetched through the D11 API client from
 *  the D10 backend (dataset `incois_argo_10day_analysis`, parameter
 *  `temperature`). This replaces the synthetic field in
 *  `src/data/temperatureDataset.ts` as the source the 3D renderer draws from.
 *
 *  What it does NOT do: regrid, interpolate, resample, or invent
 *  latitude/longitude points. The 36 x 51 grid, the 24 irregular depth
 *  levels and the 3 analysis time steps are stored exactly as the API
 *  returns them. `missing` values stay `null`; `quality` stays aligned.
 * ==================================================================== */

/** Canonical ids — never `sst`, never an alias. */
export const TEMPERATURE_DATASET_ID = 'incois_argo_10day_analysis'
export const TEMPERATURE_PARAMETER_ID = 'temperature' as const

export type TemperatureDataPhase = 'idle' | 'loading' | 'success' | 'error'

/** 0 = VALID, 1 = MISSING (D10 quality vocabulary, unchanged). */
export type TemperatureQuality = 0 | 1

/**
 * One real latitude x longitude slice, exactly as returned by
 * `GET /api/datasets/{id}/parameters/temperature/slice`.
 *
 * `values[latIndex][lonIndex]` — a missing cell is `null`, never a number.
 * `latIndex` addresses `TemperatureDataState.latitudes` (ascending °N),
 * `lonIndex` addresses `TemperatureDataState.longitudes` (ascending °E).
 */
export interface TemperatureGridSlice {
  timeIndex: number
  depthIndex: number
  /** Metres below the surface, from the D10 depth coordinate array. */
  depthMetres: number
  /** ISO-8601 UTC of this time index, from the D10 time metadata. */
  timeIso: string | null
  /** `[latIndex][lonIndex]`, °C, `null` where missing. */
  values: ReadonlyArray<ReadonlyArray<number | null>>
  /** `[latIndex][lonIndex]`, aligned 1:1 with `values` — 1 iff the value is `null`. */
  quality: ReadonlyArray<ReadonlyArray<TemperatureQuality>>
}

export interface TemperatureDataError {
  stage: 'coordinates' | 'slices'
  type: string
  message: string
}

export interface TemperatureDataState {
  phase: TemperatureDataPhase
  datasetId: string
  parameterId: typeof TEMPERATURE_PARAMETER_ID
  /** `'degC'` once loaded. */
  units: string | null
  /** `'analysis'` once loaded — never `'real-time'`. */
  productType: ProductType | null
  /** Ascending °N — the exact D10 coordinate array (length 36). */
  latitudes: readonly number[]
  /** Ascending °E — the exact D10 coordinate array (length 51). */
  longitudes: readonly number[]
  /** Metres, ascending — the exact D10 depth coordinate array (length 24, irregular). */
  depthMetres: readonly number[]
  /** ISO-8601 UTC per real time index (length 3). */
  timeIsoValues: readonly string[]
  /** The real time index currently loaded (mapped from the UI's selected time). */
  timeIndex: number
  /** ISO-8601 UTC of `timeIndex`. */
  timeIso: string | null
  /** One entry per real depth index; `null` until that depth's slice has loaded. */
  slices: readonly (TemperatureGridSlice | null)[]
  /** Min / max across every valid value in every loaded slice — the normalisation range. */
  min: number | null
  max: number | null
  error: TemperatureDataError | null
  /** ISO timestamp of the last successful load — bookkeeping only, not scientific data. */
  updatedAt: string | null
  /**
   * Step 48 — re-run this provider's load (coordinates + the selected time's
   * depth stack). User-triggered only: no polling, no auto-retry. The UI's
   * selected time / depth / variable are untouched.
   */
  reload: () => void
}

export const INITIAL_TEMPERATURE_DATA_STATE: TemperatureDataState = {
  phase: 'idle',
  datasetId: TEMPERATURE_DATASET_ID,
  parameterId: TEMPERATURE_PARAMETER_ID,
  units: null,
  productType: null,
  latitudes: [],
  longitudes: [],
  depthMetres: [],
  timeIsoValues: [],
  timeIndex: 0,
  timeIso: null,
  slices: [],
  min: null,
  max: null,
  error: null,
  updatedAt: null,
  reload: () => {},
}

export const TemperatureDataContext = createContext<TemperatureDataState | null>(null)

/**
 * Read the real temperature data state. Used by the 3D scene bridge
 * (`temperatureField.ts` via `OceanScene`), the colorbar and the HUD tag.
 */
export function useTemperatureData(): TemperatureDataState {
  const value = useContext(TemperatureDataContext)
  if (value === null) {
    throw new Error('useTemperatureData must be used inside <TemperatureDataProvider>')
  }
  return value
}

/* ------------------------------------------------------------------ *
 * Coordinate helpers — all orientation-safe (they resolve by coordinate
 * value, never by array position, so a swapped or reversed axis is
 * impossible to introduce here).
 * ------------------------------------------------------------------ */

/** Nearest index in an ascending array, by absolute distance. */
export function nearestIndex(ascending: readonly number[], target: number): number {
  if (ascending.length === 0) return 0
  let best = 0
  let bestDist = Math.abs(ascending[0] - target)
  for (let i = 1; i < ascending.length; i += 1) {
    const dist = Math.abs(ascending[i] - target)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}

interface AxisBracket {
  lo: number
  hi: number
  /** 0 at `lo`, 1 at `hi`. Clamped — no extrapolation past the grid. */
  frac: number
}

/** Where `value` falls on an ascending axis, for bilinear interpolation. */
function bracket(ascending: readonly number[], value: number): AxisBracket {
  const last = ascending.length - 1
  if (last <= 0) return { lo: 0, hi: 0, frac: 0 }
  if (value <= ascending[0]) return { lo: 0, hi: 0, frac: 0 }
  if (value >= ascending[last]) return { lo: last, hi: last, frac: 0 }
  for (let i = 0; i < last; i += 1) {
    const hi = ascending[i + 1]
    if (value <= hi) {
      const lo = ascending[i]
      const span = hi - lo
      return { lo: i, hi: i + 1, frac: span === 0 ? 0 : (value - lo) / span }
    }
  }
  return { lo: last, hi: last, frac: 0 }
}

export interface SampledTemperature {
  /** °C. Meaningful only when `valid` > 0. */
  value: number
  /** 0 when every contributing cell is missing, 1 when all are valid, between otherwise. */
  valid: number
}

/**
 * Real temperature at an arbitrary (latitude, longitude) inside one slice,
 * bilinearly interpolated between the four surrounding grid cells.
 *
 * Orientation is resolved entirely by coordinate value: the function brackets
 * `latitude` in `latitudes` and `longitude` in `longitudes`, so the axes can
 * never be swapped or reversed by this code. Missing cells (`null`) are
 * dropped from the weighted mean rather than treated as `0`; if all four
 * corners are missing, `valid` is `0` and the renderer falls back to the base
 * water colour there.
 *
 * This is a *visualization* sampling of the grid onto the scene's atlas —
 * the stored 36 x 51 values are never modified.
 */
export function sampleSliceTemperature(
  slice: TemperatureGridSlice,
  latitudes: readonly number[],
  longitudes: readonly number[],
  latitude: number,
  longitude: number,
): SampledTemperature {
  const la = bracket(latitudes, latitude)
  const lo = bracket(longitudes, longitude)

  const corners: Array<{ w: number; latI: number; lonI: number }> = [
    { w: (1 - la.frac) * (1 - lo.frac), latI: la.lo, lonI: lo.lo },
    { w: (1 - la.frac) * lo.frac, latI: la.lo, lonI: lo.hi },
    { w: la.frac * (1 - lo.frac), latI: la.hi, lonI: lo.lo },
    { w: la.frac * lo.frac, latI: la.hi, lonI: lo.hi },
  ]

  let sum = 0
  let weight = 0
  let validWeight = 0
  let totalWeight = 0
  for (const corner of corners) {
    if (corner.w <= 0) continue
    totalWeight += corner.w
    const cell = slice.values[corner.latI]?.[corner.lonI]
    if (cell === null || cell === undefined) continue
    sum += cell * corner.w
    weight += corner.w
    validWeight += corner.w
  }

  if (weight === 0) {
    return { value: 0, valid: 0 }
  }
  return { value: sum / weight, valid: totalWeight > 0 ? validWeight / totalWeight : 0 }
}
