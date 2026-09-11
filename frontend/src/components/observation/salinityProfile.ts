/* ==================================================================== *
 *  Step 33 — pure extraction of the real measured salinity profile.
 *
 *  A sibling of `temperatureProfile.ts`: same architecture, same "real data
 *  only" guarantee, kept out of the chart component (no React) so it can be
 *  unit-tested in isolation.
 * ==================================================================== */

/** One raw measured row — structurally an `ArgoLevel` or a `GliderSample`. */
export interface SalinityProfileRow {
  /** decibar (native — never converted to depth). */
  pressure: number | null
  /** PSU / practical salinity (native). */
  salinity: number | null
}

/** One plottable measurement. Both values are real and finite. */
export interface SalinityProfilePoint {
  pressure: number
  salinity: number
}

/**
 * The real `(pressure, salinity)` pairs to plot, from an Argo profile's
 * `levels` or a glider deployment's `samples`.
 *
 *  - A pair is dropped **only** when its pressure OR salinity is
 *    `null` / non-finite. QC flags are ignored — a bad-flagged but present
 *    real value is kept (Steps 28–29 carry QC through verbatim).
 *  - No interpolation, no gap in-fill, no resampling, no smoothing.
 *  - No unit change: pressure stays in dbar, salinity in PSU.
 *  - Ordered by ascending pressure so the polyline reads down the water
 *    column. This is a pure reordering of the kept points — every value is
 *    exactly the one the API returned.
 */
export function measuredSalinityPoints(
  rows: readonly SalinityProfileRow[],
): SalinityProfilePoint[] {
  const points: SalinityProfilePoint[] = []
  for (const row of rows) {
    const { pressure, salinity } = row
    if (pressure === null || salinity === null) continue
    if (!Number.isFinite(pressure) || !Number.isFinite(salinity)) continue
    points.push({ pressure, salinity })
  }
  points.sort((a, b) => a.pressure - b.pressure)
  return points
}
