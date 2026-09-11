/**
 * Step 42 — model-coverage helpers.
 *
 * The validated GLORYS12V1 file wired to `/api/netcdf` is a small VALIDATION
 * SUBSET, not basin-wide coverage. These pure helpers turn the backend's
 * `coverage` block (`ModelDatasetResponse.coverage`) into something the app can
 * state plainly — "the model sample only covers 19–20°N, 64–65°E, 2025-03-31,
 * 0.5–453.9 m" — and answer whether a point falls inside it, so nothing ever
 * implies the model has data where it does not.
 *
 * Nothing here fetches, transforms scientific values, or renders. It is a thin
 * read-only view over the API response.
 */

import type { ModelCoverage, ModelDatasetResponse } from './types.ts'

/** The GLORYS model temperature variable name (CF `sea_water_potential_temperature`). */
export const MODEL_TEMPERATURE_VARIABLE = 'thetao'

export interface Range {
  readonly min: number
  readonly max: number
}

export interface ModelCoverageSummary {
  /** Explicit model identity, e.g. `"GLORYS12V1 / Copernicus Marine"`. */
  readonly sourceLabel: string | null
  /** ISO-8601 UTC strings; `start === end` for a single-step sample. */
  readonly time: { readonly start: string | null; readonly end: string | null; readonly count: number } | null
  readonly depth: (Range & { readonly units: string | null; readonly positive: string | null }) | null
  readonly latitude: (Range & { readonly units: string | null }) | null
  readonly longitude: (Range & { readonly units: string | null }) | null
  /**
   * `true` when this is clearly a partial sample rather than full coverage —
   * a single time step, or a spatial box under ~5° on a side.
   */
  readonly isSubset: boolean
  readonly note: string | null
}

const roundTo = (value: number, dp = 2): number => {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/** `19.0` → `"19.00°N"`, `-3.08` → `"3.08°S"`. */
export function formatLatitude(value: number): string {
  return `${roundTo(Math.abs(value)).toFixed(2)}°${value >= 0 ? 'N' : 'S'}`
}

/** `64.0` → `"64.00°E"`. */
export function formatLongitude(value: number): string {
  return `${roundTo(Math.abs(value)).toFixed(2)}°${value >= 0 ? 'E' : 'W'}`
}

function readSourceLabel(dataset: ModelDatasetResponse): string | null {
  const label = dataset.source?.label
  return typeof label === 'string' && label.trim() !== '' ? label : null
}

/**
 * Collapse `ModelDatasetResponse.coverage` into a typed summary. Returns `null`
 * when the response carries no coverage block (an older backend, or a custom
 * NetCDF file without resolvable axes).
 */
export function summarizeModelCoverage(
  dataset: ModelDatasetResponse,
): ModelCoverageSummary | null {
  const coverage: ModelCoverage | undefined = dataset.coverage
  if (!coverage) return null

  const asRange = <T extends { min: number; max: number }>(entry: T | undefined): T | null =>
    entry && Number.isFinite(entry.min) && Number.isFinite(entry.max) ? entry : null

  const latitude = asRange(coverage.latitude)
  const longitude = asRange(coverage.longitude)
  const depth = asRange(coverage.depth)
  const time = coverage.time ?? null

  // A subset unless it spans essentially the whole globe. The backend also
  // ships an explicit `coverage.note` for any partial sample — honour that too,
  // so the flag stays right regardless of how large the sample grows.
  const nearGlobal =
    !!latitude &&
    !!longitude &&
    latitude.max - latitude.min >= 150 &&
    longitude.max - longitude.min >= 350
  const isSubset = !!coverage.note || !nearGlobal

  return {
    sourceLabel: readSourceLabel(dataset),
    time: time ? { start: time.start, end: time.end, count: time.count } : null,
    depth: depth
      ? { min: depth.min, max: depth.max, units: depth.units, positive: depth.positive ?? null }
      : null,
    latitude: latitude
      ? { min: latitude.min, max: latitude.max, units: latitude.units }
      : null,
    longitude: longitude
      ? { min: longitude.min, max: longitude.max, units: longitude.units }
      : null,
    isSubset,
    note: coverage.note ?? null,
  }
}

/**
 * Is `(latitude, longitude)` inside the model sample's bounding box? `false`
 * when there is no spatial coverage information (fail closed — never claim the
 * model covers a point it may not).
 */
export function isPointInModelCoverage(
  coverage: ModelCoverage | ModelCoverageSummary | null | undefined,
  latitude: number,
  longitude: number,
): boolean {
  if (!coverage) return false
  const lat = coverage.latitude
  const lon = coverage.longitude
  if (!lat || !lon) return false
  return (
    latitude >= lat.min &&
    latitude <= lat.max &&
    longitude >= lon.min &&
    longitude <= lon.max
  )
}

/**
 * One-line, human-readable statement of exactly what the model sample covers.
 * Used wherever the app needs to be honest that this is a limited extent.
 */
export function describeModelCoverage(dataset: ModelDatasetResponse): string {
  const summary = summarizeModelCoverage(dataset)
  const name = summary?.sourceLabel ?? dataset.dataset_id
  if (!summary) return name

  const parts: string[] = []
  if (summary.latitude && summary.longitude) {
    parts.push(
      `${formatLatitude(summary.latitude.min)}–${formatLatitude(summary.latitude.max)}, ` +
        `${formatLongitude(summary.longitude.min)}–${formatLongitude(summary.longitude.max)}`,
    )
  }
  if (summary.time?.start) {
    parts.push(
      summary.time.start === summary.time.end
        ? summary.time.start.slice(0, 10)
        : `${summary.time.start.slice(0, 10)} → ${(summary.time.end ?? '').slice(0, 10)}`,
    )
  }
  if (summary.depth) {
    parts.push(`${roundTo(summary.depth.min, 1)}–${roundTo(summary.depth.max, 1)} m`)
  }

  const extent = parts.join(', ')
  const suffix = summary.isSubset ? ' (regional subset — not full-basin coverage)' : ''
  return extent ? `${name} — ${extent}${suffix}` : name
}
