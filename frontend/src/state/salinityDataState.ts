import { createContext, useContext } from 'react'
import type { ProductType } from '../api/types'
import { sampleBilinear, type SampledValue } from './gridSampling.ts'

/* ==================================================================== *
 *  D13 — real INCOIS salinity data state
 *
 *  Holds the real salinity grid fetched through the D11 API client from the
 *  D10 backend (dataset `incois_argo_10day_analysis`, parameter `salinity`,
 *  source variable `S_ANALYZED`). Built on exactly the D12 temperature pattern
 *  — the two share the analysis dataset's dimensions, depths and times.
 *
 *  What it does NOT do: regrid, interpolate, resample, or invent
 *  latitude/longitude points. The 36 × 51 grid, the 24 irregular depth levels
 *  and the 3 analysis time steps are stored exactly as the API returns them.
 *  `missing` values stay `null`; `quality` stays aligned. Units stay `PSU`.
 * ==================================================================== */

/** Canonical ids — never `salt`, never an alias. */
export const SALINITY_DATASET_ID = 'incois_argo_10day_analysis'
export const SALINITY_PARAMETER_ID = 'salinity' as const

export type SalinityDataPhase = 'idle' | 'loading' | 'success' | 'error'

/** 0 = VALID, 1 = MISSING (D10 quality vocabulary, unchanged). */
export type SalinityQuality = 0 | 1

/**
 * One real latitude × longitude slice, exactly as returned by
 * `GET /api/datasets/{id}/parameters/salinity/slice`.
 *
 * `values[latIndex][lonIndex]` — a missing cell is `null`, never a number.
 * `latIndex` addresses `SalinityDataState.latitudes` (ascending °N),
 * `lonIndex` addresses `SalinityDataState.longitudes` (ascending °E).
 */
export interface SalinityGridSlice {
  timeIndex: number
  depthIndex: number
  /** Metres below the surface, from the D10 depth coordinate array. */
  depthMetres: number
  /** ISO-8601 UTC of this time index, from the D10 time metadata. */
  timeIso: string | null
  /** `[latIndex][lonIndex]`, PSU, `null` where missing. */
  values: ReadonlyArray<ReadonlyArray<number | null>>
  /** `[latIndex][lonIndex]`, aligned 1:1 with `values` — 1 iff the value is `null`. */
  quality: ReadonlyArray<ReadonlyArray<SalinityQuality>>
}

export interface SalinityDataError {
  stage: 'coordinates' | 'slices'
  type: string
  message: string
}

export interface SalinityDataState {
  phase: SalinityDataPhase
  datasetId: string
  parameterId: typeof SALINITY_PARAMETER_ID
  /** `'PSU'` once loaded. */
  units: string | null
  /** `'analysis'` once loaded. */
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
  slices: readonly (SalinityGridSlice | null)[]
  /** Min / max across every valid value in every loaded slice — the normalisation range. */
  min: number | null
  max: number | null
  error: SalinityDataError | null
  /** ISO timestamp of the last successful load — bookkeeping only, not scientific data. */
  updatedAt: string | null
  /**
   * Step 48 — re-run this provider's load. User-triggered only: no polling,
   * no auto-retry. The UI's selected time / depth / variable are untouched.
   */
  reload: () => void
}

export const INITIAL_SALINITY_DATA_STATE: SalinityDataState = {
  phase: 'idle',
  datasetId: SALINITY_DATASET_ID,
  parameterId: SALINITY_PARAMETER_ID,
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

export const SalinityDataContext = createContext<SalinityDataState | null>(null)

/**
 * Read the real salinity data state. Used by the 3D scene bridge (the shared
 * scalar-field atlas in `temperatureField.ts` via `OceanScene`), the colorbar
 * and the HUD tag.
 */
export function useSalinityData(): SalinityDataState {
  const value = useContext(SalinityDataContext)
  if (value === null) {
    throw new Error('useSalinityData must be used inside <SalinityDataProvider>')
  }
  return value
}

/**
 * Real salinity at an arbitrary (latitude, longitude) inside one slice —
 * bilinearly interpolated between the four surrounding grid cells for the 3D
 * atlas only. The stored 36 × 51 values are never modified. Missing corners
 * (`null`) are dropped; if all four are missing, `valid` is `0`.
 *
 * Identical resampling to D12 temperature (`sampleBilinear` is the shared
 * implementation), so salinity and temperature reach the scene the same way.
 */
export function sampleSliceSalinity(
  slice: SalinityGridSlice,
  latitudes: readonly number[],
  longitudes: readonly number[],
  latitude: number,
  longitude: number,
): SampledValue {
  return sampleBilinear(slice.values, latitudes, longitudes, latitude, longitude)
}
