/* ==================================================================== *
 *  Step 46 — pure extraction for the model ↔ observation comparison UI.
 *
 *  Kept out of the chart / section components (no React, no CSS import) so it
 *  can be unit-tested and so the "real Step 45 data only" guarantee lives in
 *  one small, inspectable place.
 *
 *  The Step 45 endpoint
 *  (`GET /api/model-observations/argo/{id}/temperature-comparison`) is
 *  authoritative: every value here is read verbatim from its response. This
 *  module NEVER interpolates, smooths, re-derives a difference, fabricates a
 *  level, or turns a `null` into `0`. It only:
 *    - selects the finite (depth, value) pairs each series can plot,
 *    - orders them by depth so a polyline reads down the water column,
 *    - and formats a few scalars (separations, signed °C) for display.
 * ==================================================================== */

import type {
  ModelObsComparisonLevel,
  ModelObsTemperatureComparisonResponse,
} from '../../api/types'

/** In-situ families for which Step 45/46 provides a model comparison. */
export const MODEL_COMPARISON_SUPPORTED_KINDS = ['argo'] as const
export type ModelComparisonKind = (typeof MODEL_COMPARISON_SUPPORTED_KINDS)[number]

/**
 * Step 45 currently compares GLORYS12V1 `thetao` against Argo temperature only.
 * A glider selection must NOT produce a fabricated comparison (Step 46 §14).
 */
export function isModelComparisonSupported(kind: string): kind is ModelComparisonKind {
  return (MODEL_COMPARISON_SUPPORTED_KINDS as readonly string[]).includes(kind)
}

/** One plottable point: a real depth (m, positive down) and a real value. */
export interface DepthValuePoint {
  /** metres, positive down. */
  depth: number
  /** °C — a model/observed temperature, or a signed model−observed difference. */
  value: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function byDepth(a: DepthValuePoint, b: DepthValuePoint): number {
  return a.depth - b.depth
}

/**
 * GLORYS12V1 model temperature vs its native depth level.
 * Every row with a finite `model_temperature_c` at its native `model_depth_m`
 * (unchanged) — matched or not, because the model column exists regardless of
 * whether an Argo observation was found nearby.
 */
export function modelProfilePoints(
  rows: readonly ModelObsComparisonLevel[],
): DepthValuePoint[] {
  const points: DepthValuePoint[] = []
  for (const row of rows) {
    if (isFiniteNumber(row.model_depth_m) && isFiniteNumber(row.model_temperature_c)) {
      points.push({ depth: row.model_depth_m, value: row.model_temperature_c })
    }
  }
  points.sort(byDepth)
  return points
}

/**
 * Argo observed temperature vs its TEOS-10 derived depth (`argo_depth_m`,
 * separate from the preserved `argo_pressure_dbar`). Only matched rows carry a
 * derived depth + observed value, so unmatched levels contribute nothing — no
 * fabricated point, no interpolation.
 */
export function observedProfilePoints(
  rows: readonly ModelObsComparisonLevel[],
): DepthValuePoint[] {
  const points: DepthValuePoint[] = []
  for (const row of rows) {
    if (
      row.matched &&
      isFiniteNumber(row.argo_depth_m) &&
      isFiniteNumber(row.observed_temperature_c)
    ) {
      points.push({ depth: row.argo_depth_m, value: row.observed_temperature_c })
    }
  }
  points.sort(byDepth)
  return points
}

/**
 * The signed model−observation difference (`difference_c`, verbatim) against
 * the native GLORYS depth level. `difference_c` is `null` for every unmatched
 * level and for a null model/observed temperature — those rows are excluded
 * here exactly as they are excluded from the Step 45 statistics.
 */
export function differenceProfilePoints(
  rows: readonly ModelObsComparisonLevel[],
): DepthValuePoint[] {
  const points: DepthValuePoint[] = []
  for (const row of rows) {
    if (row.matched && isFiniteNumber(row.model_depth_m) && isFiniteNumber(row.difference_c)) {
      points.push({ depth: row.model_depth_m, value: row.difference_c })
    }
  }
  points.sort(byDepth)
  return points
}

/* ------------------------------------------------------------------ *
 * Level accounting — read straight off the response, never recomputed
 * ------------------------------------------------------------------ */

export interface ComparisonLevelCounts {
  matched: number
  total: number
  unmatched: number
}

export function comparisonLevelCounts(
  response: ModelObsTemperatureComparisonResponse,
): ComparisonLevelCounts {
  const { model_level_count, matched_level_count, unmatched_level_count } = response.matching
  return {
    matched: matched_level_count,
    total: model_level_count,
    unmatched: unmatched_level_count,
  }
}

/**
 * Step 47 — did a successful comparison actually match any model level to an
 * Argo observation? When `false` there is no observed series, no difference
 * profile and no statistics population: the UI must show an explicit empty
 * state, not an axes-only chart. Read straight off the authoritative Step 45
 * `statistics.matched_count` (falls back to the per-level rows).
 */
export function comparisonHasMatchedLevels(
  response: ModelObsTemperatureComparisonResponse,
): boolean {
  const stat = response.statistics?.matched_count
  if (isFiniteNumber(stat)) return stat > 0
  return response.profile.some(
    (row) => row.matched && isFiniteNumber(row.difference_c),
  )
}

/* ------------------------------------------------------------------ *
 * Display formatting — never mutates a scientific value
 * ------------------------------------------------------------------ */

const EM_DASH = '—'

/** `0.045` → `"+0.045 °C"`, `-0.43` → `"-0.430 °C"`, `null` → `"—"`. */
export function formatSignedCelsius(value: number | null | undefined, digits = 3): string {
  if (!isFiniteNumber(value)) return EM_DASH
  const magnitude = value.toFixed(digits)
  const sign = value > 0 ? '+' : ''
  return `${sign}${magnitude} °C`
}

/** `0.228` → `"0.228 °C"`, `null` → `"—"` (unsigned — for MAE / RMSE). */
export function formatCelsius(value: number | null | undefined, digits = 3): string {
  if (!isFiniteNumber(value)) return EM_DASH
  return `${value.toFixed(digits)} °C`
}

/** Great-circle separation between the Argo fix and the matched GLORYS cell. */
export function formatSpatialSeparation(km: number | null | undefined): string {
  if (!isFiniteNumber(km)) return EM_DASH
  if (km < 1) return `${(km * 1000).toFixed(0)} m`
  return `${km.toFixed(1)} km`
}

/** |matched GLORYS day − Argo timestamp|, seconds → a human span. */
export function formatTemporalSeparation(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds)) return EM_DASH
  const abs = Math.abs(seconds)
  if (abs < 90) return `${abs.toFixed(0)} s`
  if (abs < 5400) return `${(abs / 60).toFixed(0)} min`
  if (abs < 172800) return `${(abs / 3600).toFixed(1)} h`
  return `${(abs / 86400).toFixed(1)} d`
}

/** ISO-8601 UTC → `2025-04-01 00:00 UTC`, or the raw string if unparseable. */
export function formatComparisonTime(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.trim() === '') return EM_DASH
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]} UTC` : iso
}

/* ------------------------------------------------------------------ *
 * One-call view model for the section — all real, all from Step 45
 * ------------------------------------------------------------------ */

export interface ComparisonViewModel {
  platformId: string
  modelSource: string
  observationSource: string
  modelTimestamp: string | null
  observationTimestamp: string | null
  spatialSeparationKm: number | null
  temporalSeparationSeconds: number | null
  levels: ComparisonLevelCounts
  statistics: ModelObsTemperatureComparisonResponse['statistics']
  model: DepthValuePoint[]
  observed: DepthValuePoint[]
  difference: DepthValuePoint[]
  notes: string[]
}

function numberOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null
}

export function toComparisonViewModel(
  response: ModelObsTemperatureComparisonResponse,
): ComparisonViewModel {
  const spatial = response.model?.spatial_match
  const temporal = response.model?.temporal_match
  return {
    platformId: response.comparison.platform_id,
    modelSource: response.comparison.model_source,
    observationSource: response.comparison.observation_source,
    modelTimestamp: response.model?.timestamp ?? null,
    observationTimestamp: response.observation?.timestamp ?? null,
    spatialSeparationKm: numberOrNull(spatial?.distance_km),
    temporalSeparationSeconds: numberOrNull(temporal?.difference_seconds),
    levels: comparisonLevelCounts(response),
    statistics: response.statistics,
    model: modelProfilePoints(response.profile),
    observed: observedProfilePoints(response.profile),
    difference: differenceProfilePoints(response.profile),
    notes: Array.isArray(response.notes) ? response.notes : [],
  }
}
