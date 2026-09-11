/* ==================================================================== *
 *  DEMO / SAMPLE TIME AXIS — DEVELOPMENT ONLY  (Step 21)
 *
 *  A short, fixed list of sample timestamps for the visualization's time
 *  control. This is NOT a real INCOIS time coordinate and is NOT read from
 *  any dataset, model run or observation archive — the three dates below
 *  are written here by hand so the time stepper, the centre HUD date and
 *  the bottom timeline can all move together against one ordered set of
 *  times while the real temporal-coordinate plumbing is built out.
 *
 *  The values line up with the 10-day cadence of the INCOIS Argo analysis
 *  the data providers fetch (2026-07-10 / -20 / -30), so stepping the
 *  control also advances the real grid: each demo step maps 1:1 onto a real
 *  analysis time index. Providers already clamp any step with no matching
 *  real index to the last one, so the axis length is free to change here
 *  without touching them.
 *
 *  `getDemoTimestamps()` plus the `formatDemoTimestamp*` helpers are the
 *  only supported way to read this. Replacing the demo axis with a real
 *  time coordinate is a change confined to this file.
 * ==================================================================== */

/** Shown (as a tooltip / note) wherever the demo time axis reaches the screen. */
export const DEMO_TIME_DATASET_NOTICE =
  'Demo time axis — sample timestamps for the time control, not a real INCOIS time coordinate.'

/**
 * Sample timestamps, ascending. ISO calendar dates, each at 00:00 UTC.
 *
 * Treat this as "the times the control can select", not as a fixed
 * three-day window — the list is expected to grow when a real time
 * coordinate replaces it.
 */
export const DEMO_TIMESTAMPS: readonly string[] = [
  '2026-07-10',
  '2026-07-20',
  '2026-07-30',
]

/** The wall-clock time-of-day every demo timestamp sits at. Display only. */
export const DEMO_TIMESTAMP_TIME_OF_DAY = '00:00 UTC'

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

interface TimestampParts {
  year: string
  month: string
  day: string
  monthLabel: string
}

/**
 * Splits `2026-07-10` into its fields without going through `Date`, so a
 * timestamp never renders as the previous day in a negative-offset
 * timezone. Returns `null` for anything that is not `YYYY-MM-DD`.
 */
function partsOf(timestamp: string): TimestampParts | null {
  const [year, month, day] = timestamp.split('-')
  const monthLabel = MONTH_LABELS[Number(month) - 1]
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    monthLabel === undefined
  ) {
    return null
  }
  return { year, month, day, monthLabel }
}

/** `2026-07-10` → `2026-07-10` (validated / normalised). Left time-stepper format. */
export function formatDemoTimestampISO(timestamp: string): string {
  const parts = partsOf(timestamp)
  return parts === null ? timestamp : `${parts.year}-${parts.month}-${parts.day}`
}

/** `2026-07-10` → `10 Jul 2026`. Centre HUD format. */
export function formatDemoTimestampLong(timestamp: string): string {
  const parts = partsOf(timestamp)
  return parts === null ? timestamp : `${parts.day} ${parts.monthLabel} ${parts.year}`
}

/** `2026-07-10` → `2026 · Jul · 10`. Bottom timeline format. */
export function formatDemoTimestampStacked(timestamp: string): string {
  const parts = partsOf(timestamp)
  return parts === null ? timestamp : `${parts.year} · ${parts.monthLabel} · ${parts.day}`
}

/** `2026-07-10` → `10 Jul`. Bottom timeline tick format (year omitted for width). */
export function formatDemoTimestampTick(timestamp: string): string {
  const parts = partsOf(timestamp)
  return parts === null ? timestamp : `${parts.day} ${parts.monthLabel}`
}

/** The sample timestamps the time control can select, ascending. */
export function getDemoTimestamps(): readonly string[] {
  return DEMO_TIMESTAMPS
}

/** Clamp an arbitrary number to a valid index into `DEMO_TIMESTAMPS`. */
export function clampDemoTimeIndex(index: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), DEMO_TIMESTAMPS.length - 1)
}

/** Index of `timestamp` in `DEMO_TIMESTAMPS`, or `0` when it is not one of them. */
export function demoTimeIndexOf(timestamp: string): number {
  const index = DEMO_TIMESTAMPS.indexOf(timestamp)
  return index < 0 ? 0 : index
}
