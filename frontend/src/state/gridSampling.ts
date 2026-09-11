/**
 * D13 — shared, dataset-agnostic grid sampling.
 *
 * Small pure numeric helpers used by every real INCOIS data family (temperature
 * — via the D12 bridge, salinity, and currents). They resolve a geographic
 * coordinate to grid indices **by coordinate value, never by array position**,
 * so a swapped or reversed axis cannot be introduced here.
 *
 * Two sampling modes, deliberately kept separate:
 *
 *   • `sampleBilinear()` — bilinear blend of the four surrounding cells. Used
 *     only to resample an analysis field (temperature / salinity, 1° grid) onto
 *     the 3D scene's own display atlas. The *stored* grid is never modified;
 *     this is a visualization transform, matching what D12 established.
 *
 *   • `nearestIndex()` — nearest grid index, no interpolation. Used for the
 *     current grid (≈0.0833°, 421×601), which D13 must NOT regrid, interpolate
 *     or resample. Current vectors are read straight from their own cells.
 *
 * Missing cells are `null` and are dropped from a bilinear blend rather than
 * treated as `0`; `valid` reports how much of the sample came from real data.
 */

/** Nearest index in an ascending array, by absolute distance. Clamps to the ends. */
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

export interface SampledValue {
  /** Meaningful only when `valid` > 0. */
  value: number
  /** 0 when every contributing cell is missing, 1 when all are valid, between otherwise. */
  valid: number
}

/**
 * Bilinearly interpolate a `[latIndex][lonIndex]` grid at an arbitrary
 * (latitude, longitude). Orientation is resolved entirely by coordinate value.
 * Missing cells (`null`) are excluded from the weighted mean; if all four
 * corners are missing, `valid` is `0` and the caller must not invent a value.
 */
export function sampleBilinear(
  values: ReadonlyArray<ReadonlyArray<number | null>>,
  latitudes: readonly number[],
  longitudes: readonly number[],
  latitude: number,
  longitude: number,
): SampledValue {
  const la = bracket(latitudes, latitude)
  const lo = bracket(longitudes, longitude)

  const corners: Array<{ w: number; latI: number; lonI: number }> = [
    { w: (1 - la.frac) * (1 - lo.frac), latI: la.lo, lonI: lo.lo },
    { w: (1 - la.frac) * lo.frac, latI: la.lo, lonI: lo.hi },
    { w: la.frac * (1 - lo.frac), latI: la.hi, lonI: lo.lo },
    { w: la.frac * lo.frac, latI: la.hi, lonI: lo.hi },
  ]

  let sum = 0
  let validWeight = 0
  let totalWeight = 0
  for (const corner of corners) {
    if (corner.w <= 0) continue
    totalWeight += corner.w
    const cell = values[corner.latI]?.[corner.lonI]
    if (cell === null || cell === undefined) continue
    sum += cell * corner.w
    validWeight += corner.w
  }

  if (validWeight === 0) return { value: 0, valid: 0 }
  return { value: sum / validWeight, valid: totalWeight > 0 ? validWeight / totalWeight : 0 }
}
