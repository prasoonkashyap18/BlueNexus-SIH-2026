import { createContext, useContext } from 'react'
import type { ProductType } from '../api/types'
import { nearestIndex } from './gridSampling.ts'

/* ==================================================================== *
 *  D13 — real INCOIS surface-current data state
 *
 *  Holds the real ocean-current grid fetched through the D11 API client from
 *  the D10 backend (dataset `incois_io_hoofs_surface_currents`, parameters
 *  `current_u` / `current_v` / `current_speed`, source variables U / V /
 *  CURRENT). This is INCOIS IO-HOOFS — an **operational model forecast**, not a
 *  real-time observation.
 *
 *  It is fundamentally different from temperature/salinity:
 *    • surface-only: one depth level, depth = 0 m. No subsurface currents exist.
 *    • its own grid: ≈0.0833° spacing, 421 × 601 — NOT the 1° analysis grid.
 *    • 4 forecast times, NOT the 3 analysis times.
 *    • a vector field: U = eastward, V = northward, CURRENT = authoritative
 *      magnitude. CURRENT is used verbatim for speed — never recomputed from
 *      sqrt(U² + V²) in the frontend. U/V are used only for direction.
 *
 *  The 421 × 601 grid is stored exactly as the API returns it: no regridding,
 *  no interpolation, no resampling. `missing` values stay `null`; a vector is
 *  valid only where U, V and CURRENT are all present.
 * ==================================================================== */

/** Canonical ids — never `current`, never `velocity`, never an alias. */
export const CURRENT_DATASET_ID = 'incois_io_hoofs_surface_currents'
export const CURRENT_U_PARAMETER_ID = 'current_u' as const
export const CURRENT_V_PARAMETER_ID = 'current_v' as const
export const CURRENT_SPEED_PARAMETER_ID = 'current_speed' as const
export const CURRENT_PARAMETER_IDS = [
  CURRENT_U_PARAMETER_ID,
  CURRENT_V_PARAMETER_ID,
  CURRENT_SPEED_PARAMETER_ID,
] as const

/** Currents are surface-only: the depth axis has exactly one level, at 0 m. */
export const CURRENT_SURFACE_DEPTH_INDEX = 0
export const CURRENT_SURFACE_DEPTH_METRES = 0

export type CurrentDataPhase = 'idle' | 'loading' | 'success' | 'error'

/** 0 = VALID, 1 = MISSING (D10 quality vocabulary, unchanged). */
export type CurrentQuality = 0 | 1

type Plane = ReadonlyArray<ReadonlyArray<number | null>>
type QualityPlane = ReadonlyArray<ReadonlyArray<CurrentQuality>>

/**
 * The three real `[latIndex][lonIndex]` planes for one forecast time at the
 * surface, stored exactly as the API returns them. `latIndex` addresses
 * `CurrentDataState.latitudes` (ascending °N), `lonIndex` addresses
 * `CurrentDataState.longitudes` (ascending °E).
 */
export interface CurrentGrid {
  timeIndex: number
  /** ISO-8601 UTC of this forecast time index. */
  timeIso: string | null
  /** Eastward component, m s⁻¹. `null` where missing. */
  u: Plane
  /** Northward component, m s⁻¹. `null` where missing. */
  v: Plane
  /** Authoritative current magnitude from the API, m s⁻¹. `null` where missing. Never recomputed. */
  speed: Plane
  /** Quality planes, aligned 1:1 with `u` / `v` / `speed`. 1 iff that cell is `null`. */
  quality: { u: QualityPlane; v: QualityPlane; speed: QualityPlane }
}

export interface CurrentDataError {
  stage: 'coordinates' | 'slices'
  type: string
  message: string
}

export interface CurrentDataState {
  phase: CurrentDataPhase
  datasetId: string
  parameterIds: typeof CURRENT_PARAMETER_IDS
  /** `'m s-1'` once loaded. */
  units: string | null
  /** `'forecast'` once loaded — INCOIS IO-HOOFS is an operational model forecast. */
  productType: ProductType | null
  /** Always `true` — no subsurface current data exists. */
  surfaceOnly: true
  /** Always `0` — the single depth level. */
  depthMetres: number
  /** Ascending °N — the exact D10 coordinate array (length 421). */
  latitudes: readonly number[]
  /** Ascending °E — the exact D10 coordinate array (length 601). */
  longitudes: readonly number[]
  /** ISO-8601 UTC per real forecast time index (length 4). */
  timeIsoValues: readonly string[]
  /** The real forecast time index currently loaded (mapped from the UI's selected time). */
  timeIndex: number
  /** ISO-8601 UTC of `timeIndex`. */
  timeIso: string | null
  /** The three planes for `timeIndex`, or `null` until they have loaded. */
  grid: CurrentGrid | null
  /** Min / max across every valid authoritative `speed` cell — the magnitude normalisation range. */
  speedMin: number | null
  speedMax: number | null
  error: CurrentDataError | null
  /** ISO timestamp of the last successful load — bookkeeping only. */
  updatedAt: string | null
  /**
   * Step 48 — re-run this provider's load. User-triggered only: no polling,
   * no auto-retry. The UI's selected time / variable are untouched.
   */
  reload: () => void
}

export const INITIAL_CURRENT_DATA_STATE: CurrentDataState = {
  phase: 'idle',
  datasetId: CURRENT_DATASET_ID,
  parameterIds: CURRENT_PARAMETER_IDS,
  units: null,
  productType: null,
  surfaceOnly: true,
  depthMetres: CURRENT_SURFACE_DEPTH_METRES,
  latitudes: [],
  longitudes: [],
  timeIsoValues: [],
  timeIndex: 0,
  timeIso: null,
  grid: null,
  speedMin: null,
  speedMax: null,
  error: null,
  updatedAt: null,
  reload: () => {},
}

export const CurrentDataContext = createContext<CurrentDataState | null>(null)

/**
 * Read the real surface-current data state. Used by the 3D current-vector layer
 * (`CurrentField.tsx` via `OceanScene`), the colorbar and the HUD tag.
 */
export function useCurrentData(): CurrentDataState {
  const value = useContext(CurrentDataContext)
  if (value === null) {
    throw new Error('useCurrentData must be used inside <CurrentDataProvider>')
  }
  return value
}

export interface SampledCurrent {
  /** Eastward component, m s⁻¹. Meaningful only when `valid` is `1`. */
  u: number
  /** Northward component, m s⁻¹. Meaningful only when `valid` is `1`. */
  v: number
  /** Authoritative magnitude, m s⁻¹, straight from the API. Meaningful only when `valid` is `1`. */
  speed: number
  /** `1` iff U, V and the authoritative speed are all present at the nearest cell; `0` otherwise. */
  valid: 0 | 1
}

/**
 * The current vector at the **nearest** real grid cell to (latitude, longitude).
 *
 * No interpolation, no regridding, no resampling — D13 forbids all three for
 * currents. Orientation is resolved by coordinate value via `nearestIndex`, so
 * the axes cannot be swapped or reversed here.
 *
 * `speed` is the API's authoritative `current_speed`, returned verbatim — it is
 * never recomputed from `sqrt(u² + v²)`.
 *
 * A vector is valid only where U, V **and** the authoritative speed are all
 * present. Where any is missing the caller gets `valid: 0` and must not draw a
 * vector there — never a fabricated zero vector.
 */
export function nearestCurrentVector(
  grid: CurrentGrid,
  latitudes: readonly number[],
  longitudes: readonly number[],
  latitude: number,
  longitude: number,
): SampledCurrent {
  const latI = nearestIndex(latitudes, latitude)
  const lonI = nearestIndex(longitudes, longitude)

  const u = grid.u[latI]?.[lonI]
  const v = grid.v[latI]?.[lonI]
  const speed = grid.speed[latI]?.[lonI]

  if (u === null || u === undefined || v === null || v === undefined || speed === null || speed === undefined) {
    return { u: 0, v: 0, speed: 0, valid: 0 }
  }
  return { u, v, speed, valid: 1 }
}

/**
 * Heading of a current vector as a rotation about the scene's +Y axis, so a
 * glyph pointing along +X ends up pointing along the flow.
 *
 * The current flows towards (`u` east, `v` north). In the scene east is +X and
 * north is -Z (see `geography.ts`), and a +Y rotation of θ sends +X to
 * (cos θ, 0, -sin θ) — matching (u, -v) — so θ = atan2(v, u). Pure geometry:
 * `u` and `v` are used for direction only, never scaled or recombined into a
 * magnitude (that is the API's authoritative `speed`).
 */
export function currentHeadingRadians(u: number, v: number): number {
  return Math.atan2(v, u)
}
