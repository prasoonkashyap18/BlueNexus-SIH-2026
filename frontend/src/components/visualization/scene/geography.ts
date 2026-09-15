import { BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from 'three'
import type { GeoPoint, OceanRegion } from '../../../state/locationState'
import { DOMAIN } from './sceneConfig.ts'

/**
 * The geographic reference frame drawn around the water column.
 *
 * What it is: a latitude/longitude graticule for the selected region, laid out
 * on a gently curved surface so the domain reads as a window cut into a
 * planet rather than a block floating in space.
 *
 * What it is **not**: a map. No coastline, landmass, bathymetry or basin
 * boundary is represented anywhere in this file, and none is implied — the
 * only geographic quantities it uses are the region's centre coordinate and
 * the width of the window drawn around it. The curvature is a visual cue at a
 * fixed radius rather than an Earth-scale projection, which is what keeps a
 * basin-scale region from turning the viewport into a globe.
 */
export const GEO = {
  /** Radius of the reference sphere the surface is bent onto, world units. */
  planetRadius: 130,
  /** How far the graticule reaches from the domain centre, world units. */
  extent: 38,
  /** Preferred spacing between graticule lines, world units. */
  targetSpacing: 3.4,
  /** The spacing snaps to one of these, in degrees, so it reads as a grid. */
  spacingSteps: [0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30],
  /** World distance between samples along a line — sets how smooth it curves. */
  sampleStep: 1.6,

  /** Distance over which lines rise out of nothing beyond the domain edge. */
  fadeIn: 4.5,
  /** Distance over which they fade back out before the rim. */
  fadeOut: 16,

  /** How far outside the domain the region brackets sit. */
  markerOffset: 0.55,
  /** Length of one bracket arm, world units. */
  markerArm: 2.4,

  /** Orbit distances between which the whole context fades up. */
  nearDistance: 14,
  farDistance: 32,
  /** Presence floor when the camera is right up against the water. */
  nearPresence: 0.22,
  /** Presence floor the region brackets keep — they mark the selection. */
  markerFloor: 0.62,
  /** Seconds the graticule takes to fade in after a region change. */
  arrivalSeconds: 0.85,
  /**
   * How far past their resting weight the brackets swing while a new region
   * arrives. A single hump over the arrival, so the selection announces itself
   * once and then goes quiet — enough to catch the eye, not enough to be an
   * animation the reader has to wait out.
   */
  arrivalEmphasis: 0.5,

  /** Weight of an ordinary graticule line, and of the region's own two. */
  lineWeight: 0.34,
  markedWeight: 1,
  /** Opacity ceiling of the region brackets. */
  markerOpacity: 0.52,

  /** The compass letters off each edge: how far out, how big, how present. */
  compassOffset: 1.6,
  compassSize: 0.46,
  compassOpacity: 0.44,

  /* ---- Step 40: coordinate labels on the graticule ---------------- *
   * A few real degree values (e.g. "74°E", "12°N") set just outside the
   * domain on the lines that bound the visible window — so the reader can
   * see the volume is a real latitude/longitude ocean domain, not a cube.
   * They ARE the graticule lines, named; no second grid, no second frame. */
  /** How far past the domain edge a coordinate label sits, world units. */
  labelOffset: 1.15,
  /** Small lift so the sprite clears the curved reference surface. */
  labelLift: 0.06,
  /** Text height of a coordinate label, world units (compare compassSize 0.46). */
  labelSize: 0.38,
  /** At most this many labels per axis — every other line is dropped first. */
  maxLabelsPerAxis: 5,
  /** Dimmer than the accent so the labels read as annotation, not structure. */
  labelColor: '#a4c8dc',
  labelOpacity: 0.66,

  lineColor: '#5c93b4',
  markedColor: '#3fd8d0',
} as const

const DEGREES = Math.PI / 180

const HALF_X = DOMAIN.width / 2
const HALF_Z = DOMAIN.depth / 2

/* Scratch. The builders run on a region change, not per frame, but they run
   over thousands of samples and there is no reason to allocate per sample. */
const _from = new Vector3()
const _to = new Vector3()
const _clipA = new Vector3()
const _clipB = new Vector3()
const _interval: [number, number] = [0, 0]

/* ------------------------------------------------------------------ *
 * Frame
 * ------------------------------------------------------------------ */

export interface GeoFrame {
  centre: GeoPoint
  /** World units per degree of latitude. */
  unitsPerDegree: number
  /** Interval between graticule lines, degrees. */
  spacing: number
}

/**
 * Snaps a spacing to the nearest value a reader would expect on a chart.
 *
 * Nearest on a log scale rather than the next one up: rounding up alone turns
 * a wanted 2.6° into 5°, which is not one step coarser but twice as coarse,
 * and the grid ends up sparse in exactly the regions that fall just above a
 * step. Measuring the ratio instead keeps every region within a third of the
 * spacing the scene was designed around.
 */
function niceSpacing(degrees: number): number {
  const steps = GEO.spacingSteps
  let best: number = steps[0] ?? 1

  for (const step of steps) {
    if (Math.abs(Math.log(step / degrees)) < Math.abs(Math.log(best / degrees))) best = step
  }
  return best
}

/**
 * The projection the scene is drawn in, for one region.
 *
 * The domain is a fixed 13 world units across whatever it contains, so the
 * scale comes from the region: a marginal sea spanning six degrees gets a
 * half-degree graticule, a basin spanning thirty gets a ten-degree one. That
 * single number is what makes the same geometry read as a coastal window in
 * one region and an ocean basin in another.
 */
export function geoFrame(region: OceanRegion): GeoFrame {
  const unitsPerDegree = DOMAIN.width / region.span

  return {
    centre: region.centre,
    unitsPerDegree,
    spacing: niceSpacing(GEO.targetSpacing / unitsPerDegree),
  }
}

/** How far the reference surface has fallen away at a horizontal radius. */
function surfaceDrop(radius: number): number {
  const clamped = Math.min(radius, GEO.planetRadius)
  return Math.sqrt(GEO.planetRadius * GEO.planetRadius - clamped * clamped) - GEO.planetRadius
}

/**
 * Latitude/longitude → scene position on the curved reference surface.
 *
 * North runs towards -z and east towards +x, matching the default camera's
 * three-quarter view from the south-east. Longitude is squeezed by the cosine
 * of the sample's own latitude, so meridians converge the way they do on a
 * globe — the one piece of real geographic behaviour the frame carries.
 */
export function projectGeo(
  frame: GeoFrame,
  latitude: number,
  longitude: number,
  out: Vector3,
): Vector3 {
  const north = (latitude - frame.centre.latitude) * frame.unitsPerDegree
  const east =
    (longitude - frame.centre.longitude) * Math.cos(latitude * DEGREES) * frame.unitsPerDegree

  return out.set(east, surfaceDrop(Math.hypot(east, north)), -north)
}

/**
 * World x/z inside the flat domain box → latitude/longitude.
 *
 * The inverse of `projectGeo`, but for the *interior* of the column rather
 * than the curved reference surface outside it: the water body is a flat box
 * (`VolumeShell`, `DepthStrata`, `DepthSlice` all read depth and plan position
 * straight off untouched vertex coordinates), so anything sampled into it —
 * the Step 16 temperature field included — has to be located with the same
 * flat, uncurved mapping the box itself uses, not the bent one the graticule
 * draws beyond the domain edge.
 *
 * The longitude squeeze is evaluated once at the region's own centre latitude
 * rather than per sample, which is what keeps this a plain affine map: exact
 * at the centre of the domain and within a fraction of a degree of
 * `projectGeo`'s own squeeze everywhere else a demo region's span reaches.
 * That is well inside the honesty budget of a synthetic field already
 * described as a smooth approximation, and it means a straight line in world
 * space is a straight line in latitude/longitude too — which a texture atlas
 * sampled on a regular grid needs.
 */
export function domainPointToGeo(frame: GeoFrame, x: number, z: number): GeoPoint {
  const squeeze = Math.max(0.15, Math.cos(frame.centre.latitude * DEGREES))

  return {
    latitude: frame.centre.latitude - z / frame.unitsPerDegree,
    longitude: frame.centre.longitude + x / (frame.unitsPerDegree * squeeze),
  }
}

/* ------------------------------------------------------------------ *
 * Graticule
 * ------------------------------------------------------------------ */

/**
 * Fade applied to a vertex by its distance from the column.
 *
 * The graticule has no business being drawn over the water, and a hard edge
 * where it stops would read as a second frame competing with the cage — so it
 * rises out of nothing a few units beyond the domain and sinks back out before
 * the rim, leaving the fog to finish the job.
 */
function graticuleAlpha(radius: number): number {
  const rise = MathUtils.smoothstep(radius, HALF_X, HALF_X + GEO.fadeIn)
  const fall = 1 - MathUtils.smoothstep(radius, GEO.extent - GEO.fadeOut, GEO.extent)
  return rise * fall
}

/**
 * The stretch of `a → b` that lies inside the domain footprint, if any.
 *
 * Slab clipping, written into `_interval` rather than returned, because it is
 * called once per sample. The caller emits what is left over — which is how
 * the domain ends up as a clean hole in the grid instead of a ragged one.
 */
function insideDomain(ax: number, az: number, bx: number, bz: number): boolean {
  let enter = 0
  let exit = 1

  const dx = bx - ax
  if (dx === 0) {
    if (Math.abs(ax) > HALF_X) return false
  } else {
    const low = (-HALF_X - ax) / dx
    const high = (HALF_X - ax) / dx
    enter = Math.max(enter, Math.min(low, high))
    exit = Math.min(exit, Math.max(low, high))
  }

  const dz = bz - az
  if (dz === 0) {
    if (Math.abs(az) > HALF_Z) return false
  } else {
    const low = (-HALF_Z - az) / dz
    const high = (HALF_Z - az) / dz
    enter = Math.max(enter, Math.min(low, high))
    exit = Math.min(exit, Math.max(low, high))
  }

  if (enter >= exit) return false

  _interval[0] = enter
  _interval[1] = exit
  return true
}

function emit(
  positions: number[],
  colors: number[],
  a: Vector3,
  b: Vector3,
  color: Color,
  weight: number,
): void {
  const alphaA = weight * graticuleAlpha(Math.hypot(a.x, a.z))
  const alphaB = weight * graticuleAlpha(Math.hypot(b.x, b.z))

  // Past the fade there is nothing to draw. Dropping these keeps the buffer to
  // the disc that is actually visible rather than the square the lines were
  // swept over — the corners of which reach half again as far as the rim.
  if (alphaA <= 0 && alphaB <= 0) return

  positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
  colors.push(color.r, color.g, color.b, alphaA)
  colors.push(color.r, color.g, color.b, alphaB)
}

/** Emits `a → b`, minus whatever part of it crosses the domain footprint. */
function pushSegment(
  positions: number[],
  colors: number[],
  a: Vector3,
  b: Vector3,
  color: Color,
  weight: number,
): void {
  if (!insideDomain(a.x, a.z, b.x, b.z)) {
    emit(positions, colors, a, b, color, weight)
    return
  }

  const [enter, exit] = _interval
  if (enter > 0.002) emit(positions, colors, a, _clipA.lerpVectors(a, b, enter), color, weight)
  if (exit < 0.998) emit(positions, colors, _clipB.lerpVectors(a, b, exit), b, color, weight)
}

/** Multiples of `spacing` within `reach` of `centre`, capped in magnitude. */
function gridValues(centre: number, reach: number, spacing: number, limit: number): number[] {
  const values: number[] = []
  const first = Math.ceil((centre - reach) / spacing)
  const last = Math.floor((centre + reach) / spacing)

  for (let index = first; index <= last; index += 1) {
    const value = index * spacing
    if (Math.abs(value) <= limit) values.push(value)
  }
  return values
}

/** One line of constant latitude, swept across the longitude window. */
function traceParallel(
  positions: number[],
  colors: number[],
  frame: GeoFrame,
  latitude: number,
  reach: number,
  color: Color,
  weight: number,
): void {
  const squeeze = Math.max(0.15, Math.cos(latitude * DEGREES))
  const step = GEO.sampleStep / (frame.unitsPerDegree * squeeze)
  const count = Math.max(2, Math.ceil((2 * reach) / step))

  let from = _from
  let to = _to
  projectGeo(frame, latitude, frame.centre.longitude - reach, from)

  for (let index = 1; index <= count; index += 1) {
    const longitude = frame.centre.longitude - reach + (index / count) * 2 * reach
    projectGeo(frame, latitude, longitude, to)
    pushSegment(positions, colors, from, to, color, weight)

    const swap = from
    from = to
    to = swap
  }
}

/** One line of constant longitude, swept across the latitude window. */
function traceMeridian(
  positions: number[],
  colors: number[],
  frame: GeoFrame,
  longitude: number,
  reach: number,
  color: Color,
  weight: number,
): void {
  const start = Math.max(-89.5, frame.centre.latitude - reach)
  const end = Math.min(89.5, frame.centre.latitude + reach)
  const count = Math.max(2, Math.ceil((end - start) / (GEO.sampleStep / frame.unitsPerDegree)))

  let from = _from
  let to = _to
  projectGeo(frame, start, longitude, from)

  for (let index = 1; index <= count; index += 1) {
    projectGeo(frame, start + (index / count) * (end - start), longitude, to)
    pushSegment(positions, colors, from, to, color, weight)

    const swap = from
    from = to
    to = swap
  }
}

/**
 * The graticule for one region, as a single line-segment buffer.
 *
 * Everything is merged into one geometry and one draw call — the grid, and the
 * region's own parallel and meridian picked out in the accent colour. The
 * weight and the distance fade travel in the vertex colour's alpha channel, so
 * the material stays a plain `LineBasicMaterial` and the component is left
 * with one number to animate.
 */
export function buildGraticule(frame: GeoFrame): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []

  const line = new Color(GEO.lineColor)
  const marked = new Color(GEO.markedColor)

  const latitudeReach = GEO.extent / frame.unitsPerDegree
  const squeeze = Math.max(0.25, Math.cos(frame.centre.latitude * DEGREES))
  const longitudeReach = latitudeReach / squeeze

  for (const latitude of gridValues(frame.centre.latitude, latitudeReach, frame.spacing, 89)) {
    traceParallel(positions, colors, frame, latitude, longitudeReach, line, GEO.lineWeight)
  }
  for (const longitude of gridValues(
    frame.centre.longitude,
    longitudeReach,
    frame.spacing,
    Infinity,
  )) {
    traceMeridian(positions, colors, frame, longitude, latitudeReach, line, GEO.lineWeight)
  }

  // The region's own coordinate, drawn over the grid rather than snapped to
  // it: the reader searched for 12.94° N, not for the nearest round number.
  traceParallel(
    positions,
    colors,
    frame,
    frame.centre.latitude,
    longitudeReach,
    marked,
    GEO.markedWeight,
  )
  traceMeridian(
    positions,
    colors,
    frame,
    frame.centre.longitude,
    latitudeReach,
    marked,
    GEO.markedWeight,
  )

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  return geometry
}

/* ------------------------------------------------------------------ *
 * Coordinate labels (Step 40)
 * ------------------------------------------------------------------ */

export interface GraticuleLabel {
  /** Real degree value, formatted for display — e.g. `"74°E"`, `"12°N"`. */
  text: string
  /** World position, just outside the domain box, sitting on the grid line. */
  position: [number, number, number]
  /** Which family of line the label belongs to. */
  axis: 'latitude' | 'longitude'
}

/**
 * A graticule value → a compact hemisphere label.
 *
 * `74` → `"74°E"`, `-5` → `"5°S"`, `0.5` → `"0.5°N"`. The grid values are
 * multiples of `GEO.spacingSteps`, so trimming trailing zeros off two decimals
 * always lands on the exact value the reader would expect on a chart axis.
 */
function formatGridDegree(value: number, axis: GraticuleLabel['axis']): string {
  const hemisphere =
    axis === 'longitude' ? (value < 0 ? 'W' : 'E') : value < 0 ? 'S' : 'N'
  const magnitude = Math.abs(value)
  const digits = magnitude
    .toFixed(2)
    .replace(/\.?0+$/, '')
  return `${digits || '0'}°${hemisphere}`
}

/** Keeps at most `max` evenly-spaced entries — drops whole lines, never shifts them. */
function thinTo<T>(values: readonly T[], max: number): T[] {
  if (values.length <= max) return [...values]
  const stride = Math.ceil(values.length / max)
  return values.filter((_value, index) => index % stride === 0)
}

/**
 * The handful of coordinate labels for one region's graticule.
 *
 * Latitude labels sit off the domain's **west** edge (-x), longitude labels off
 * its **south** edge (+z) — the two edges the default three-quarter camera
 * faces, and the two the depth axis (east edge) and the compass (north edge)
 * leave free. Each label is placed with `projectGeo`, the same transform the
 * graticule, the scalar fields and the observation markers all use, so it lands
 * on its line and shares the one coordinate system. Nothing here is a new grid:
 * it is the existing graticule, annotated.
 */
export function graticuleLabels(frame: GeoFrame): GraticuleLabel[] {
  const out: GraticuleLabel[] = []
  const upd = frame.unitsPerDegree
  const centreSqueeze = Math.max(0.15, Math.cos(frame.centre.latitude * DEGREES))

  // Latitudes whose parallel crosses the domain footprint.
  const latReach = HALF_Z / upd
  const latitudes = thinTo(
    gridValues(frame.centre.latitude, latReach, frame.spacing, 89),
    GEO.maxLabelsPerAxis,
  )
  for (const latitude of latitudes) {
    const squeeze = Math.max(0.15, Math.cos(latitude * DEGREES))
    const westLon = frame.centre.longitude - (HALF_X + GEO.labelOffset) / (upd * squeeze)
    projectGeo(frame, latitude, westLon, _from)
    out.push({
      text: formatGridDegree(latitude, 'latitude'),
      position: [_from.x, _from.y + GEO.labelLift, _from.z],
      axis: 'latitude',
    })
  }

  // Longitudes whose meridian crosses the domain footprint.
  const lonReach = HALF_X / (upd * centreSqueeze)
  const longitudes = thinTo(
    gridValues(frame.centre.longitude, lonReach, frame.spacing, Infinity),
    GEO.maxLabelsPerAxis,
  )
  const southLat = frame.centre.latitude - (HALF_Z + GEO.labelOffset) / upd
  for (const longitude of longitudes) {
    projectGeo(frame, southLat, longitude, _from)
    out.push({
      text: formatGridDegree(longitude, 'longitude'),
      position: [_from.x, _from.y + GEO.labelLift, _from.z],
      axis: 'longitude',
    })
  }

  return out
}

/* ------------------------------------------------------------------ *
 * Region marker
 * ------------------------------------------------------------------ */

/** Samples one straight run across the surface into line segments. */
function traceRun(
  positions: number[],
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  steps: number,
): void {
  const point = (t: number, out: Vector3) => {
    const x = fromX + (toX - fromX) * t
    const z = fromZ + (toZ - fromZ) * t
    return out.set(x, surfaceDrop(Math.hypot(x, z)), z)
  }

  for (let index = 0; index < steps; index += 1) {
    point(index / steps, _from)
    point((index + 1) / steps, _to)
    positions.push(_from.x, _from.y, _from.z, _to.x, _to.y, _to.z)
  }
}

/**
 * Corner brackets just outside the domain, marking the selected region.
 *
 * Brackets rather than a full outline: the water column already carries a
 * reference cage, and a second complete rectangle beside it would read as a
 * doubled frame. Four corners read as a selection.
 *
 * Fixed in scene space, so this is built once and never rebuilt — the domain
 * is always the same 13 units wherever on Earth it is pointed.
 */
export function buildRegionMarker(): BufferGeometry {
  const positions: number[] = []
  const x = HALF_X + GEO.markerOffset
  const z = HALF_Z + GEO.markerOffset

  for (const signX of [-1, 1]) {
    for (const signZ of [-1, 1]) {
      traceRun(positions, signX * x, signZ * z, signX * (x - GEO.markerArm), signZ * z, 4)
      traceRun(positions, signX * x, signZ * z, signX * x, signZ * (z - GEO.markerArm), 4)
    }
  }

  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  )
}
