/* ==================================================================== *
 *  Step 32 — pure extraction of the real measured temperature profile.
 *
 *  Kept out of the chart component (no React) so it can be unit-tested and so
 *  the "real data only" guarantee lives in one small, inspectable place.
 * ==================================================================== */

/** One raw measured row — structurally an `ArgoLevel` or a `GliderSample`. */
export interface ProfileRow {
  /** decibar (native — never converted to depth). */
  pressure: number | null
  /** degree_Celsius (native). */
  temperature: number | null
}

/** One plottable measurement. Both values are real and finite. */
export interface ProfilePoint {
  pressure: number
  temperature: number
}

/**
 * The real `(pressure, temperature)` pairs to plot, from an Argo profile's
 * `levels` or a glider deployment's `samples`.
 *
 *  - A pair is dropped **only** when its pressure OR temperature is
 *    `null` / non-finite. QC flags are ignored — a bad-flagged but present
 *    real value is kept (Steps 28–29 carry QC through verbatim).
 *  - No interpolation, no gap in-fill, no resampling, no smoothing.
 *  - No unit change: pressure stays in dbar, temperature in °C.
 *  - Ordered by ascending pressure so the polyline reads down the water
 *    column. This is a pure reordering of the kept points — every value is
 *    exactly the one the API returned.
 */
export function measuredProfilePoints(rows: readonly ProfileRow[]): ProfilePoint[] {
  const points: ProfilePoint[] = []
  for (const row of rows) {
    const { pressure, temperature } = row
    if (pressure === null || temperature === null) continue
    if (!Number.isFinite(pressure) || !Number.isFinite(temperature)) continue
    points.push({ pressure, temperature })
  }
  points.sort((a, b) => a.pressure - b.pressure)
  return points
}
