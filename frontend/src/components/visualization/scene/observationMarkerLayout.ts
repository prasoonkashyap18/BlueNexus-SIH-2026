import { Vector3 } from 'three'
import type { ArgoPlatformSummary, GliderSample } from '../../../api/types.ts'
import type { OceanRegion } from '../../../state/locationState.ts'
import { geoFrame, projectGeo } from './geography.ts'

/* ==================================================================== *
 *  Step 30 — pure layout for the real observation markers.
 *
 *  Turns the real `latitude` / `longitude` from the Argo / glider providers
 *  (Steps 28–29) into scene positions using the scene's existing `projectGeo`
 *  geographic→world transform. No fabrication, no interpolation: a missing
 *  position fix drops the marker; a glider track is a decimated *subset* of the
 *  real fixes (stride only — no in-fills).
 *
 *  Kept in its own module (no React components) so `ObservationMarkers.tsx`
 *  stays a components-only file.
 * ==================================================================== */

/**
 * Marker colours sit **outside** the temperature/salinity/current ramp
 * (blue→cyan→green→yellow→orange→red) and the cyan graticule, so a marker
 * never disappears against a warm patch of the scalar field or the frame.
 */
export const ARGO_COLOR = '#ffffff' // Argo — bright white point
export const GLIDER_COLOR = '#ff37c3' // Glider — magenta (off-ramp)
/** A dark rim so a white/magenta glyph still reads on a pale surface. */
export const MARKER_RIM = '#0a1622'
/** World-unit lift above the mean surface, clear of the procedural swell. */
export const MARKER_Y = 0.32
export const ARGO_RADIUS = 0.12
export const GLIDER_NODE_RADIUS = 0.15
/** Cap on trajectory vertices — real samples are decimated, never in-filled. */
export const MAX_TRAJECTORY_POINTS = 240

const _scratch = new Vector3()

/** Real (lat, lon) → scene position on the surface plane, via `projectGeo`. */
export function surfacePoint(
  frame: ReturnType<typeof geoFrame>,
  latitude: number,
  longitude: number,
): [number, number, number] {
  projectGeo(frame, latitude, longitude, _scratch)
  return [_scratch.x, _scratch.y + MARKER_Y, _scratch.z]
}

export interface ArgoMarker {
  id: string
  /** `[x, y, z]` from the real lat/lon via `projectGeo`. */
  position: [number, number, number]
}

/** One marker per Argo summary that has a real position fix. Null fixes drop. */
export function argoMarkersFor(
  region: OceanRegion,
  platforms: readonly ArgoPlatformSummary[],
): ArgoMarker[] {
  const frame = geoFrame(region)
  const out: ArgoMarker[] = []
  for (const p of platforms) {
    if (p.latitude === null || p.longitude === null) continue
    out.push({ id: p.platform_id, position: surfacePoint(frame, p.latitude, p.longitude) })
  }
  return out
}

/**
 * The real glider fixes to draw, decimated to at most `max` by an even stride
 * (plus the last fix). Every element is a source sample — samples are dropped,
 * never added or interpolated. Samples without a position fix are excluded.
 */
export function decimateFixes(
  samples: readonly GliderSample[],
  max = MAX_TRAJECTORY_POINTS,
): GliderSample[] {
  const fixes = samples.filter((s) => s.latitude !== null && s.longitude !== null)
  if (fixes.length === 0) return []
  const step = Math.max(1, Math.ceil(fixes.length / max))
  const picked = fixes.filter((_s, i) => i % step === 0)
  const last = fixes[fixes.length - 1]
  if (picked[picked.length - 1] !== last) picked.push(last)
  return picked
}

/** A glider deployment's decimated real track as a flat `lineSegments` buffer. */
export function gliderTrackPositions(
  region: OceanRegion,
  samples: readonly GliderSample[],
): { positions: Float32Array; start: [number, number, number] } | null {
  const picked = decimateFixes(samples)
  if (picked.length === 0) return null
  const frame = geoFrame(region)
  const points = picked.map((s) =>
    surfacePoint(frame, s.latitude as number, s.longitude as number),
  )
  const positions: number[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    positions.push(...points[i], ...points[i + 1])
  }
  return { positions: new Float32Array(positions), start: points[0] }
}
