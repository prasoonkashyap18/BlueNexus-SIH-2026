import type { OceanVariable } from '../state/visualizationState'

/* ==================================================================== *
 *  ⚠️  UNUSED AS OF D12 — NOT THE SOURCE OF THE RENDERED TEMPERATURE
 *
 *  The 3D visualization now draws real INCOIS temperature fetched through
 *  the D11 API client (see `src/state/temperatureDataState.ts` +
 *  `TemperatureDataProvider.tsx`, and `docs/real-temperature-integration.md`).
 *  Nothing in the active render path imports this file any more.
 *
 *  It is kept here only so unrelated code and history stay intact; it is
 *  safe to delete once nothing references it. It must never be wired back
 *  in as a fallback for a failed API request.
 * ==================================================================== *
 *
 *  DEMO TEMPERATURE DATASET — DEVELOPMENT ONLY
 *
 *  A small, synthetic, gridded ocean-temperature field — time x depth x
 *  latitude x longitude — generated from smooth closed-form profiles rather
 *  than sampled from any real archive. It is NOT INCOIS data, and it is NOT
 *  derived from any ocean model, satellite product or in-situ observation:
 *  every value below is invented to look like a plausible ocean temperature
 *  field, so the data-consuming side of the visualization can be built and
 *  reviewed before the real data pipeline exists.
 *
 *  The shape is deliberately close to what a NetCDF ocean-model file looks
 *  like once opened with xarray: fixed coordinate axes (time, depth,
 *  latitude, longitude) plus one 4-D array for a named variable. Replacing
 *  the demo source with a real one means rewriting `buildDemoTemperatureField()`
 *  and the axis constants above it to instead read a NetCDF/xarray dataset —
 *  `getTemperatureDataset()` and `getTemperatureAt()` are the only two
 *  functions the rest of the application is meant to call, and neither
 *  signature has to change for that swap.
 * ==================================================================== */

/** Shown wherever the demo temperature field reaches the screen. */
export const TEMPERATURE_DATASET_NOTICE =
  'Demo temperature field for development only — a smooth synthetic profile, not real INCOIS or ocean-model data.'

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

/**
 * How this dataset's values were produced.
 *
 * `getTemperatureDataset()` always reports this honestly, and the one place
 * it is read for display (the viewport HUD) shows a "Demo Dataset" tag only
 * while it says `demo`. The day a real loader lands and sets this to `model`
 * or `observed`, that tag disappears on its own — nothing about the display
 * logic has to change along with the data source.
 */
export type TemperatureDataStatus = 'demo' | 'model' | 'observed'

export interface TemperatureDatasetMetadata {
  readonly variable: Extract<OceanVariable, 'temperature'>
  readonly unit: '°C'
  readonly status: TemperatureDataStatus
  /** Short label the UI can print as-is, e.g. "Demo Dataset". */
  readonly statusLabel: string
  readonly description: string
  /** Coldest value anywhere in `values`, °C. */
  readonly minTemperature: number
  /** Warmest value anywhere in `values`, °C. */
  readonly maxTemperature: number
}

/** A 4-dimensional grid indexed `[time][depth][latitude][longitude]`. */
type TemperatureGrid = readonly (readonly (readonly (readonly number[])[])[])[]

export interface TemperatureDataset {
  readonly metadata: TemperatureDatasetMetadata
  /** ISO calendar dates, ascending — the sample times the field is defined at. */
  readonly times: readonly string[]
  /** Metres below the surface, ascending. 0 is the sea surface. */
  readonly depths: readonly number[]
  /** Degrees north, ascending. */
  readonly latitudes: readonly number[]
  /** Degrees east, ascending. */
  readonly longitudes: readonly number[]
  /**
   * `values[timeIndex][depthIndex][latitudeIndex][longitudeIndex]`, °C.
   *
   * Indices line up 1:1 with `times`, `depths`, `latitudes` and
   * `longitudes` — the value for `times[2]`, `depths[5]` at
   * `(latitudes[3], longitudes[7])` is `values[2][5][3][7]`. Nothing outside
   * this file is meant to index into it directly; go through
   * `getTemperatureAt()` instead, which resolves an arbitrary coordinate to
   * these indices and interpolates.
   */
  readonly values: TemperatureGrid
}

/* ------------------------------------------------------------------ *
 * Coordinate axes
 * ------------------------------------------------------------------ */

/**
 * Sample timestamps.
 *
 * Five monthly snapshots — enough to exercise a time dimension without
 * building the time control this step explicitly leaves for later. Kept
 * separate from `TIME_STEPS` in `visualizationState.ts`: that axis already
 * drives the existing (daily, five-step) time control, and conflating the
 * two would make one of them lie about what it represents. A later step can
 * point the control at this axis instead, once the temperature field is
 * actually wired into the scene.
 */
const TEMPERATURE_TIMES: readonly string[] = [
  '2026-01-01',
  '2026-02-01',
  '2026-03-01',
  '2026-04-01',
  '2026-05-01',
]

/**
 * Sample depths, metres below the surface.
 *
 * Matches the water column's own depth range (`DEPTH_RANGE` in
 * `visualizationState.ts` runs 0-5000 m) and thins towards the surface,
 * where a real thermocline carries most of its structure.
 */
const TEMPERATURE_DEPTHS_M: readonly number[] = [
  0, 50, 100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000,
]

/**
 * Regular axis from `min` to `max` inclusive, spaced `step` apart.
 *
 * Built by index rather than by repeated addition, so the axis lands on
 * exact round numbers instead of accumulating floating-point drift over a
 * dozen steps.
 */
function regularAxis(min: number, max: number, step: number): readonly number[] {
  const count = Math.round((max - min) / step) + 1
  return Array.from({ length: count }, (_, index) => {
    const value = min + index * step
    return Math.round(value * 1000) / 1000
  })
}

/**
 * Latitude/longitude coverage.
 *
 * A regional grid, not a global one: latitude -35 to 25 and longitude 40 to
 * 100 comfortably contains the Arabian Sea and Bay of Bengal (both well
 * inside the box) and the working centre of the North Indian Ocean, while
 * reaching far enough south and east to cover the demo Indian Ocean region's
 * own centre point too. Five-degree spacing keeps the grid small (13 x 13
 * points) while still leaving every demo region's centre well clear of an
 * edge, where interpolation would otherwise be clamped rather than smooth.
 */
const TEMPERATURE_LATITUDES: readonly number[] = regularAxis(-35, 25, 5)
const TEMPERATURE_LONGITUDES: readonly number[] = regularAxis(40, 100, 5)

/* ------------------------------------------------------------------ *
 * The synthetic field
 * ------------------------------------------------------------------ *
 *
 * Every constant below shapes a smooth, closed-form approximation of upper-
 * ocean structure — not a fit to any real dataset. The intent is a field
 * that behaves the way a reader expects an ocean to behave (warm at the
 * surface, cooling with depth, varying gradually across the map) without
 * ever being mistaken for a measurement.
 */

/** Surface temperature at the equator, before any other term is applied. */
const EQUATOR_SURFACE_C = 29.5
/** How fast surface temperature falls away from the equator, degrees C per degree-squared of latitude. */
const LATITUDE_COOLING_RATE = 0.0065
/** Amplitude of a gentle east-west undulation layered over the surface field. */
const LONGITUDE_WAVE_C = 0.6
/** Longitude the east-west wave is centred on, degrees east. */
const LONGITUDE_WAVE_CENTER = 70
/** Full period of the east-west wave, degrees of longitude. */
const LONGITUDE_WAVE_PERIOD = 120
/**
 * Total surface warming from the first to the last sample time, degrees C.
 *
 * Direction only, not a forecast: the Arabian Sea and Bay of Bengal both
 * tend to warm through a January-May window ahead of monsoon onset, which is
 * what a smoothly increasing rather than oscillating term should look like
 * over just five monthly samples.
 */
const SEASONAL_WARMING_C = 1.2
/** Temperature the field settles towards in deep water, degrees C. */
const DEEP_OCEAN_FLOOR_C = 2.0
/**
 * e-folding depth of the vertical decay, metres.
 *
 * Sets how quickly the warm surface layer gives way to cold deep water.
 * Chosen so the curve passes near typical upper-ocean orders of magnitude for
 * this region — roughly 6-7 degrees C by 1000 m and 2.5-3 degrees C by
 * 2000 m — without being fitted to any particular profile.
 */
const THERMOCLINE_SCALE_M = 550

/** Surface temperature at one point in space and time, before vertical decay. */
function surfaceTemperatureC(
  latitude: number,
  longitude: number,
  timeIndex: number,
  timeCount: number,
): number {
  const latitudeTerm = EQUATOR_SURFACE_C - LATITUDE_COOLING_RATE * latitude * latitude
  const longitudeTerm =
    LONGITUDE_WAVE_C *
    Math.sin(((longitude - LONGITUDE_WAVE_CENTER) / LONGITUDE_WAVE_PERIOD) * 2 * Math.PI)
  const seasonalTerm = timeCount > 1 ? SEASONAL_WARMING_C * (timeIndex / (timeCount - 1)) : 0

  return latitudeTerm + longitudeTerm + seasonalTerm
}

/** Temperature at one grid point: the surface term decayed exponentially with depth. */
function temperatureAtC(
  latitude: number,
  longitude: number,
  depthMetres: number,
  timeIndex: number,
  timeCount: number,
): number {
  const surface = surfaceTemperatureC(latitude, longitude, timeIndex, timeCount)
  const decay = Math.exp(-depthMetres / THERMOCLINE_SCALE_M)

  return DEEP_OCEAN_FLOOR_C + (surface - DEEP_OCEAN_FLOOR_C) * decay
}

/** Two decimal places — plenty for a synthetic field, and easy to read while debugging. */
function roundTemperature(value: number): number {
  return Math.round(value * 100) / 100
}

interface BuiltField {
  values: TemperatureGrid
  min: number
  max: number
}

/** Fills the full time x depth x latitude x longitude grid, once, at module load. */
function buildDemoTemperatureField(): BuiltField {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  const values = TEMPERATURE_TIMES.map((_time, timeIndex) =>
    TEMPERATURE_DEPTHS_M.map((depthMetres) =>
      TEMPERATURE_LATITUDES.map((latitude) =>
        TEMPERATURE_LONGITUDES.map((longitude) => {
          const value = roundTemperature(
            temperatureAtC(latitude, longitude, depthMetres, timeIndex, TEMPERATURE_TIMES.length),
          )
          if (value < min) min = value
          if (value > max) max = value
          return value
        }),
      ),
    ),
  )

  return { values, min, max }
}

const FIELD = buildDemoTemperatureField()

/**
 * The dataset singleton.
 *
 * Built once at module load rather than on every call — nine thousand-odd
 * numbers is cheap to hold in memory but there is no reason to recompute it,
 * and every consumer is meant to treat the result as read-only regardless.
 */
export const TEMPERATURE_DATASET: TemperatureDataset = {
  metadata: {
    variable: 'temperature',
    unit: '°C',
    status: 'demo',
    statusLabel: 'Demo Dataset',
    description: 'Sample ocean temperature field for visualization development.',
    minTemperature: FIELD.min,
    maxTemperature: FIELD.max,
  },
  times: TEMPERATURE_TIMES,
  depths: TEMPERATURE_DEPTHS_M,
  latitudes: TEMPERATURE_LATITUDES,
  longitudes: TEMPERATURE_LONGITUDES,
  values: FIELD.values,
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ *
 *
 * The functions below are the only supported way to read this file's data.
 * Later steps (17-20) are expected to call `getTemperatureAt()` with
 * whatever depth/coordinate the scene or a control is currently showing, and
 * `getTemperatureDataset()` to discover the axes it can ask for — neither has
 * to know the field is a nested array under the hood, so replacing this demo
 * generator with a real NetCDF-backed loader changes this file only.
 */

/** The structured demo temperature dataset described at the top of this file. */
export function getTemperatureDataset(): TemperatureDataset {
  return TEMPERATURE_DATASET
}

/** The sample times the dataset is defined at, ascending. */
export function getAvailableTemperatureTimes(): readonly string[] {
  return TEMPERATURE_DATASET.times
}

/** The sample depths the dataset is defined at, metres below the surface, ascending. */
export function getAvailableTemperatureDepths(): readonly number[] {
  return TEMPERATURE_DATASET.depths
}

interface AxisLocation {
  lowerIndex: number
  upperIndex: number
  /** 0 at the lower sample, 1 at the upper. */
  fraction: number
}

/**
 * Where `value` falls on an ascending axis, for linear interpolation.
 *
 * Values outside the axis clamp to the nearest end rather than extrapolate:
 * a caller may pass a coordinate from anywhere the camera can point, and this
 * dataset's grid is regional, not global.
 */
function locate(axis: readonly number[], value: number): AxisLocation {
  const lastIndex = axis.length - 1
  if (lastIndex <= 0) return { lowerIndex: 0, upperIndex: 0, fraction: 0 }

  if (value <= axis[0]) return { lowerIndex: 0, upperIndex: 0, fraction: 0 }
  if (value >= axis[lastIndex]) return { lowerIndex: lastIndex, upperIndex: lastIndex, fraction: 0 }

  for (let index = 0; index < lastIndex; index += 1) {
    const upper = axis[index + 1]
    if (value <= upper) {
      const lower = axis[index]
      const span = upper - lower
      return {
        lowerIndex: index,
        upperIndex: index + 1,
        fraction: span === 0 ? 0 : (value - lower) / span,
      }
    }
  }

  // Unreachable: the bounds checks above cover every value the loop could see.
  return { lowerIndex: lastIndex, upperIndex: lastIndex, fraction: 0 }
}

/** Linear interpolation between `a` (t=0) and `b` (t=1). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Resolves a time to its index in `TEMPERATURE_DATASET.times`.
 *
 * An exact match is the common case — callers are expected to pass a value
 * from `getAvailableTemperatureTimes()` — but an unrecognised string falls
 * back to the calendar-nearest sample rather than throwing, the same way
 * `findRegion()` and `findDemoPlatform()` elsewhere in `data/` resolve an
 * unknown id to nothing rather than fail loudly.
 */
function resolveTimeIndex(time: string): number {
  const exact = TEMPERATURE_DATASET.times.indexOf(time)
  if (exact !== -1) return exact

  const target = Date.parse(time)
  if (Number.isNaN(target)) return 0

  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  TEMPERATURE_DATASET.times.forEach((candidate, index) => {
    const distance = Math.abs(Date.parse(candidate) - target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}

/**
 * Temperature at an arbitrary point in the dataset, degrees C.
 *
 * Depth, latitude and longitude are trilinearly interpolated between the
 * surrounding grid nodes, so the result varies smoothly as a caller sweeps a
 * slider rather than stepping between grid cells; time resolves to its
 * nearest sample rather than interpolating, matching how the rest of the
 * application already treats time as a discrete, named step rather than a
 * continuous one.
 *
 * This is the one function later steps should call to read the field — it
 * hides the array layout in `TemperatureDataset.values` entirely, which is
 * what lets `buildDemoTemperatureField()` above be replaced by a real
 * NetCDF/xarray-backed loader without any caller changing.
 */
export function getTemperatureAt(
  time: string,
  depthMetres: number,
  latitude: number,
  longitude: number,
): number {
  const timeIndex = resolveTimeIndex(time)
  const depth = locate(TEMPERATURE_DATASET.depths, depthMetres)
  const lat = locate(TEMPERATURE_DATASET.latitudes, latitude)
  const lon = locate(TEMPERATURE_DATASET.longitudes, longitude)

  const atDepth = (depthIndex: number): number => {
    const depthLayer = TEMPERATURE_DATASET.values[timeIndex][depthIndex]

    const atLatitude = (latIndex: number): number => {
      const row = depthLayer[latIndex]
      return lerp(row[lon.lowerIndex], row[lon.upperIndex], lon.fraction)
    }

    return lerp(atLatitude(lat.lowerIndex), atLatitude(lat.upperIndex), lat.fraction)
  }

  return lerp(atDepth(depth.lowerIndex), atDepth(depth.upperIndex), depth.fraction)
}
