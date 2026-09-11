import { Color, MathUtils, Vector3 } from 'three'
import { DEPTH_RANGE, type OceanVariable } from '../../../state/visualizationState.ts'

/**
 * The scene is authored in a **unit water column**: x and z span the domain in
 * world units, and y runs from 0 at the surface to -1 at the deepest modelled
 * level. Vertical exaggeration is then a single y-scale on the group holding
 * the column, and a depth in metres maps to a y coordinate without any
 * component needing to know the current exaggeration.
 */
export const DOMAIN = {
  /** Horizontal extent, world units. */
  width: 13,
  depth: 13,
  /** Height of the unit column at exaggeration = 1. */
  baseHeight: 1.1,
} as const

/** World height of the column at a given vertical exaggeration. */
export function columnHeight(exaggeration: number): number {
  return DOMAIN.baseHeight * exaggeration
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Depth in metres → 0 at the surface, 1 at the bottom of the column. */
export function depthFraction(metres: number): number {
  return clamp01((metres - DEPTH_RANGE.min) / (DEPTH_RANGE.max - DEPTH_RANGE.min))
}

/**
 * Whether a selected depth still counts as "the surface" for the surface-only
 * current layer (D13). One slider step, or 10 m, whichever is larger — enough
 * that a reader parked near 0 m keeps the currents at full strength, but a
 * deliberate drag into the water column fades them (they never move off 0 m).
 */
export function isSurfaceDepth(metres: number): boolean {
  return metres <= Math.max(DEPTH_RANGE.step, 10)
}

/**
 * Hue each scalar field is rendered in. Carried over unchanged from the Step 9
 * viewport tint, so switching variable shifts the scene to the colour the
 * placeholder used for the same field.
 */
const FIELD_HUE: Record<OceanVariable, number> = {
  temperature: 22,
  salinity: 268,
  currentSpeed: 186,
  chlorophyll: 138,
}

/** Bright end of the field ramp — the near-surface water. */
export function shallowColor(variable: OceanVariable): Color {
  return new Color().setHSL(FIELD_HUE[variable] / 360, 0.72, 0.56)
}

/**
 * Dark end of the ramp. Pulled well towards the abyss blue rather than simply
 * darkened, so every variable bottoms out in the same deep water and the
 * palette stays inside the application's ocean atmosphere.
 */
export function deepColor(variable: OceanVariable): Color {
  return new Color()
    .setHSL(FIELD_HUE[variable] / 360, 0.5, 0.22)
    .lerp(new Color('#05121f'), 0.62)
}

/* ------------------------------------------------------------------ *
 * Depth ladder
 * ------------------------------------------------------------------ */

export interface DepthMark {
  /** Depth below the surface, metres. */
  metres: number
  /** What the axis prints beside the tick. */
  label: string
  /**
   * Column world height at which this mark has room to be read.
   *
   * The depth axis is linear over DEPTH_RANGE, so at 1x exaggeration the whole
   * 5000 m column is 1.1 world units tall and a 1000 m interval is 0.2 of them
   * — closer together than the label plates are high. Rather than shrink the
   * type until nothing is legible, marks appear as the column is stretched:
   * each one names the height at which its own gap to the nearest coarser mark
   * clears AXIS.minSpacing, so the ladder refines from surface and floor, to
   * kilometres, to 500 m, to 200 m as the exaggeration control is raised.
   *
   * That progression is what turns vertical exaggeration into a read of the
   * upper ocean rather than a stretch of the picture.
   */
  minHeight: number
}

/**
 * The depth ladder, surface downwards.
 *
 * Thresholds are `AXIS.minSpacing × DEPTH_RANGE.max / gap`, where `gap` is the
 * mark's distance in metres from the nearest coarser one it has to clear. So
 * the reader sees the surface and the floor at 1×, kilometres from 2×, 500 m
 * from 3×, and 200 m once the column is stretched past 8×.
 */
export const DEPTH_MARKS: readonly DepthMark[] = [
  { metres: 0, label: 'Surface', minHeight: 0 },
  { metres: 200, label: '200 m', minHeight: 8 },
  { metres: 500, label: '500 m', minHeight: 2.9 },
  { metres: 1000, label: '1000 m', minHeight: 1.6 },
  { metres: 2000, label: '2000 m', minHeight: 1.6 },
  { metres: 3000, label: '3000 m', minHeight: 1.6 },
  { metres: 4000, label: '4000 m', minHeight: 1.6 },
  { metres: 5000, label: '5000 m', minHeight: 0 },
]

/**
 * Depths ringed on the column frame.
 *
 * Only the kilometre marks. A ring runs right around the domain, so ringing
 * every label would draw a horizontal line through the water wherever the axis
 * happened to refine; the finer marks get a short tick arm on the axis rail
 * instead, which is where that detail belongs.
 */
export const DEPTH_TICKS: readonly number[] = DEPTH_MARKS.filter(
  (mark) => mark.minHeight <= 1.6 && mark.metres > 0 && mark.metres < DEPTH_RANGE.max,
).map((mark) => mark.metres)

/** Appearance of the depth axis standing beside the domain. */
export const AXIS = {
  /**
   * Where the rail stands, as multiples of the domain's half-extent.
   *
   * The middle of the +x edge, not a corner. A corner is the obvious place
   * until the perspective is worked through: the near corner is the closest
   * point of the whole domain to the camera, so it is magnified hardest and
   * its axis runs straight off the bottom of the viewport, while the far
   * corner would put the ruler behind the water it measures. An edge midpoint
   * sits at roughly the orbit distance, projects beside the column at about
   * the height of the frame's centre, and stays clear of the docked panels.
   */
  edgeX: 1,
  edgeZ: 0,
  /** How far outside the domain edge the rail stands, world units. */
  offset: 0.42,
  /** Label plate size, world units — four to one, matching the canvas. */
  labelWidth: 1.2,
  labelHeight: 0.3,
  /**
   * Length of the tick rule, in canvas pixels of a 384-wide plate.
   *
   * The tick is drawn into the label's own texture rather than as scene
   * geometry: the plate's inner edge sits exactly on the rail, so a rule at
   * the left of the canvas lands on the rail at the mark's depth, and the axis
   * stays at one draw call per label instead of two.
   */
  rulePixels: 34,
  /** Vertical clearance a mark needs before it is worth printing. */
  minSpacing: 0.32,

  color: '#8fd8e2',
  railOpacity: 0.28,
  labelOpacity: 0.88,
} as const

/* ------------------------------------------------------------------ *
 * Lighting
 * ------------------------------------------------------------------ */

/**
 * The scene's three-light rig.
 *
 * A hemisphere for the environment, one directional key, one directional
 * fill — no shadow maps, no image-based lighting, no fourth light. Every lit
 * surface here (the swell, the sea floor) is large and smooth, so what it
 * needs from the rig is a legible gradient from sky above to water below
 * rather than a modelled sun, and a hemisphere gives exactly that for the cost
 * of the flat ambient it replaces.
 *
 * Deliberately cool and low in contrast. A warm key with a hard shadow would
 * read as a rendering *of* an ocean; sky-lit water under one soft sun
 * direction reads as an instrument pointed *at* one.
 */
export const LIGHTING = {
  /** Sky and water halves of the hemisphere. */
  skyColor: '#a9d9ef',
  waterColor: '#0b2c40',
  hemisphereIntensity: 1.1,

  /** The sun. High and to the south-east, so the swell reads across it. */
  keyColor: '#ffeccb',
  keyIntensity: 1.5,
  keyPosition: [7, 12, 5] as const,

  /**
   * Cold bounce from below and behind. Not a second sun: it is there so the
   * underside of the swell and the far flank of the sea floor keep some shape
   * instead of falling to black.
   */
  fillColor: '#3f92b8',
  fillIntensity: 0.62,
  fillPosition: [-9, -5, -8] as const,
} as const

/* ------------------------------------------------------------------ *
 * Atmosphere
 * ------------------------------------------------------------------ */

/** Backdrop the fog fades geometry into — matches the viewport's CSS gradient. */
export const FOG_COLOR = '#071a2a'

/**
 * Distance haze, and how it thickens as the camera sinks.
 *
 * Above the surface the fog is the atmosphere of the backdrop: it sets the far
 * edge of the graticule and stops the domain ending on a hard rim. Below the
 * surface the same fog becomes the water the camera is looking *through*, so
 * it grows denser and darker the deeper the eye goes.
 *
 * That one interpolation is what makes descending the column feel like a
 * descent rather than a translation downwards, and it costs two uniform writes
 * a frame — no volumetrics, no post-processing.
 */
export const ATMOSPHERE = {
  surfaceColor: FOG_COLOR,
  /** Where the haze is heading once the camera is well under the surface. */
  deepColor: '#04101c',

  surfaceDensity: 0.024,
  deepDensity: 0.04,

  /** Depth below the surface, world units, over which the change plays out. */
  submergedRange: 5,
  /** Per-second approach rate, so crossing the surface is not a step. */
  damping: 2.6,
} as const

/* ------------------------------------------------------------------ *
 * Volume appearance
 * ------------------------------------------------------------------ */

/**
 * Number of stratification layers drawn through the water column.
 *
 * They are the scene's main volumetric cue, so the count is a compromise: too
 * few and the column reads as a few floating sheets, too many and the stack
 * saturates into an opaque slab while every added layer costs another
 * full-domain pass of overdraw — which is this scene's real budget, not its
 * geometry or its draw calls. Sixteen accumulates to a believable body of
 * water and leaves fill-rate headroom for a near top-down camera on
 * integrated graphics, where all sixteen cover the viewport at once.
 */
export const STRATA_COUNT = 16

/**
 * Depth fraction of stratification layer `index` of `count`.
 *
 * Spaced by a power law rather than evenly: real profiles carry their
 * structure in the upper few hundred metres, so the layers cluster near the
 * surface and thin out into the abyss.
 */
export function strataFraction(index: number, count: number): number {
  return Math.pow((index + 0.5) / count, 1.7)
}

/**
 * Surface opacity for a given volume opacity.
 *
 * The sea surface is the scene's horizon: it tracks the opacity control, but
 * never disappears entirely, because a water column with no lid at the top
 * stops reading as an ocean.
 *
 * Both terms are lower than they were, because the surface is the largest
 * object in the frame and the water column is meant to be the subject. At the
 * old 0.2 + 0.5 it was a lit sheet covering the volume from the default
 * three-quarter view — the reader saw a tabletop, not an ocean. At this weight
 * the strata read straight through it and the surface is what it should be:
 * the lit film the column is seen through.
 */
export function surfaceOpacity(opacity: number): number {
  return 0.14 + 0.34 * opacity
}

/**
 * Draw order for the scene's transparent surfaces.
 *
 * Every one of them writes colour but not depth — that is what lets the water
 * accumulate instead of the nearest sheet winning — so their appearance
 * depends entirely on the order they are submitted in, and three.js's default
 * distance sort cannot resolve it: the stratification layers are a single
 * merged mesh, and the volume shell encloses everything else.
 *
 * The order below runs from the body of water outwards to the instrument
 * furniture, so the marks a reader is meant to measure against — the slice
 * outline, the frame, the depth axis — are never veiled by the water they are
 * measuring.
 *
 * The geographic context sits below the whole stack: it is the surface the
 * domain is cut out of, so everything in the scene composites over it.
 */
export const RENDER_ORDER = {
  geography: -1,
  volume: 1,
  strata: 2,
  surface: 3,
  slice: 4,
  sliceOutline: 5,
  frame: 6,
  axis: 7,
  label: 8,
} as const

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

/**
 * Navigation envelope for the viewport camera.
 *
 * The numbers are chosen against the domain above rather than picked to look
 * right at one exaggeration: the column is 13 world units across, so a pivot
 * that may wander 5 units off its axis can never carry the water out of
 * frame, and an eye that may never come closer than 8 units stays outside the
 * body of water it is meant to be reading.
 */
export const CAMERA = {
  fov: 42,
  near: 0.1,
  far: 220,

  /**
   * Dolly limits. The near limit keeps the eye outside the water — inside it
   * the fog and the stacked transparent layers turn to soup and the near plane
   * starts slicing through strata — and the far limit stops short of the
   * distance at which `fogExp2` has swallowed the column entirely.
   */
  minDistance: 8,
  maxDistance: 46,

  /**
   * Orbit limits. Stopping short of both poles keeps a horizon in the frame:
   * rolling over the top or right under the sea floor loses every orientation
   * cue at once and the scene stops reading as an ocean.
   */
  minPolarAngle: 0.15,
  maxPolarAngle: Math.PI * 0.86,

  /**
   * Default framing distance, as `base + perHeight × columnHeight`.
   *
   * It has to grow with vertical exaggeration or a 10× column overflows the
   * frustum at the distance that suits a 1× one, but it grows more slowly than
   * the column does: the domain is far wider than it is tall, so the
   * horizontal extent still dominates the framing at every exaggeration.
   *
   * Which of the two terms binds depends on the exaggeration, and both are
   * set from the domain rather than by eye:
   *
   * - **Flat columns are bound horizontally.** The footprint's diagonal is
   *   18.4 world units and this field of view shows 1.51 × the orbit distance
   *   across a 16:9 viewport, so the floor keeps the whole footprint inside
   *   about two thirds of the frame — clear of the docked side panels.
   * - **Tall columns are bound vertically**, and far more tightly, because the
   *   viewport's usable band is short and the near face of the column is
   *   magnified by perspective on top of that. Hence a per-height term twice
   *   the old one: at 10× it is the difference between the deep half of the
   *   column being in the frame and being behind the timeline bar.
   *
   * The old 13.2 + 1.25 framed the footprint edge to edge at every setting and
   * let the water column itself run off the bottom of the viewport.
   */
  homeDistanceBase: 14,
  homeDistancePerHeight: 2.6,
  /**
   * Closest the default framing ever sits, whatever the column height.
   *
   * This is the horizontal bound made explicit: below it the footprint's left
   * and right vertices pass behind the docked panels, which is what a flat
   * column would otherwise ask for.
   */
  homeDistanceFloor: 22,

  /** How far the orbit pivot may leave the column's axis, world units. */
  maxPivotRadius: 5,
  /** How far the pivot may rise above the sea surface. */
  maxPivotAboveSurface: 2,
  /** How far the pivot may sink below the bottom of the column. */
  maxPivotBelowFloor: 2.5,

  /** Duration of the flight back to the default framing, seconds. */
  flightSeconds: 0.7,

  /** Wheel delta → dolly factor, as `exp(delta × sensitivity)`. */
  zoomSensitivity: 0.0016,
  /** Per-second approach rate of the eased dolly. */
  zoomDamping: 9,

  /**
   * How far the camera may drift from the default framing before the view
   * stops counting as "home". Loose enough that a settling damped orbit does
   * not flicker in and out of it, tight enough to catch a deliberate nudge.
   */
  homeEpsilon: 0.1,
} as const

/**
 * Direction the default view looks from, as an azimuth around the column and
 * an elevation above the horizon.
 *
 * A three-quarter view rather than a face-on or a plan one: it shows two walls
 * of the domain and the surface at once, so depth, horizontal extent and the
 * slice plane are all legible in the first frame without the reader having to
 * orbit to discover that the scene has a third dimension.
 *
 * The elevation is the load-bearing number. The domain is 13 units across and
 * the column 3.3 tall at the default exaggeration, so the sea surface is by
 * far the largest thing in the scene — and from 26° it foreshortens into a
 * lid that covers almost the entire water column, which is how the opening
 * frame ended up reading as a flat plane rather than as an ocean. Dropping to
 * 20° splits the frame roughly evenly between the surface and the column
 * below it: still a plan-ish view of the domain, but with the body of water
 * standing clear underneath it.
 */
const HOME_AZIMUTH = MathUtils.degToRad(42)
const HOME_ELEVATION = MathUtils.degToRad(17)

const HOME_DIRECTION = new Vector3(
  Math.cos(HOME_ELEVATION) * Math.sin(HOME_AZIMUTH),
  Math.sin(HOME_ELEVATION),
  Math.cos(HOME_ELEVATION) * Math.cos(HOME_AZIMUTH),
)

/** Orbit distance of the default framing for a column of this world height. */
export function homeDistance(height: number): number {
  return MathUtils.clamp(
    Math.max(
      CAMERA.homeDistanceFloor,
      CAMERA.homeDistanceBase + CAMERA.homeDistancePerHeight * height,
    ),
    CAMERA.minDistance,
    CAMERA.maxDistance,
  )
}

/**
 * Orbit pivot of the default framing: mid-depth on the column's axis, so the
 * water is centred in the frame and rotation turns the column on the spot
 * rather than swinging it around a point near the surface.
 */
export function homeCameraTarget(height: number, out = new Vector3()): Vector3 {
  return out.set(0, -height / 2, 0)
}

/** Eye position of the default framing for a column of this world height. */
export function homeCameraPosition(height: number, out = new Vector3()): Vector3 {
  out.copy(HOME_DIRECTION).multiplyScalar(homeDistance(height))
  out.y -= height / 2
  return out
}
