import { Color, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three'
import type { OceanRegion } from '../../../state/locationState'
import { sampleBilinear } from '../../../state/gridSampling'
import { DOMAIN, depthFraction } from './sceneConfig'
import { domainPointToGeo, geoFrame } from './geography'

/**
 * Bridges a **real INCOIS analysis scalar grid** into the Step 15 water
 * shaders. D12 introduced this for temperature; D13 reuses it unchanged for
 * salinity — the two share the `incois_argo_10day_analysis` dataset's 36 × 51
 * grid, 24 irregular depth levels and 3 analysis times, and both render as a
 * normalised scalar field coloured by the same ramp. (The atlas, uniforms and
 * GLSL below keep "temperature" in their names for continuity with D12; they
 * carry whichever analysis scalar `OceanScene` currently feeds them.)
 *
 * The data is the D10 `temperature` / `salinity` slices, held in
 * `state/temperatureDataState.ts` / `state/salinityDataState.ts` exactly as the
 * API returns them — 36 × 51 per depth, 24 irregular depth levels, `null` for
 * missing cells. The shaders that draw the water know nothing about
 * latitude/longitude, only the unit column's own `x`/`z` (plan position) and
 * `t` (depth fraction). This file is the one place that knows both sides: it
 * bakes the real slices, for one region and one time, into a small depth-tiled
 * texture the shaders can address the way they already address everything else,
 * and it defines the colour ramp both the GPU and plain JS (the colorbar) turn
 * a value into a colour with.
 *
 *     real slices(depthIndex) at latitude/longitude
 *         │  buildScalarFieldTexture()        — CPU, on region/time change
 *         ▼
 *     normalised + validity texel in a depth-tiled atlas
 *         │  temperatureFieldColor()          — this file's GLSL, per fragment
 *         ▼
 *     colour in VolumeShell / DepthStrata / DepthSlice
 *
 * A missing atlas texel carries a low validity in its alpha channel; the
 * shaders blend those regions back to the base water colour rather than showing
 * a made-up temperature (see the `mix(base, fieldColor.rgb, uFieldMix * a)` in
 * each consumer). The stored 36 × 51 values are never modified — the atlas is a
 * visualization resampling onto the scene's own grid, and the real numbers are
 * still in `temperatureDataState`.
 */

/* ------------------------------------------------------------------ *
 * Colour ramp
 * ------------------------------------------------------------------ */

/**
 * The scientific colour ramp temperature is drawn in: cool blues for cold
 * water, through cyan and green, to yellow, orange and red for warm water.
 * The single place the ramp is defined — `temperatureToColor` (plain JS) and
 * `TEMPERATURE_FIELD_GLSL` (in-shader) are both generated from it, so the
 * volume and the legend can never drift apart.
 */
const TEMPERATURE_RAMP_STOPS: ReadonlyArray<{ t: number; hex: string }> = [
  { t: 0.0, hex: '#1e3a8a' }, // cold — deep blue
  { t: 0.2, hex: '#0891b2' }, // cool — cyan / teal
  { t: 0.4, hex: '#22c55e' }, // moderate — green
  { t: 0.6, hex: '#eab308' }, // moderate-warm — yellow
  { t: 0.8, hex: '#f97316' }, // warm — orange
  { t: 1.0, hex: '#dc2626' }, // warmest — red
]

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Temperature, normalised to the given range — 0 coldest, 1 warmest. A pure
 *  visualization transform: the physical °C value is never changed. */
export function normalizeTemperature(temperatureC: number, min: number, max: number): number {
  if (max <= min) return 0
  return clamp01((temperatureC - min) / (max - min))
}

/** Temperature → colour, using a range and the ramp above. Reused by the colorbar. */
export function temperatureToColor(temperatureC: number, min: number, max: number): Color {
  const t = normalizeTemperature(temperatureC, min, max)

  let lower = TEMPERATURE_RAMP_STOPS[0]
  let upper = TEMPERATURE_RAMP_STOPS[TEMPERATURE_RAMP_STOPS.length - 1]

  for (let index = 0; index < TEMPERATURE_RAMP_STOPS.length - 1; index += 1) {
    const a = TEMPERATURE_RAMP_STOPS[index]
    const b = TEMPERATURE_RAMP_STOPS[index + 1]
    if (t >= a.t && t <= b.t) {
      lower = a
      upper = b
      break
    }
  }

  const span = upper.t - lower.t
  const local = span === 0 ? 0 : (t - lower.t) / span

  return new Color(lower.hex).lerp(new Color(upper.hex), local)
}

/** The colour ramp as a CSS `linear-gradient(...)` value — used by the colorbar. */
export function temperatureRampCssGradient(direction: string): string {
  const stops = TEMPERATURE_RAMP_STOPS.map((stop) => `${stop.hex} ${(stop.t * 100).toFixed(1)}%`)
  return `linear-gradient(${direction}, ${stops.join(', ')})`
}

/** One ramp stop as a GLSL `vec3(...)` literal, 0-1 components. */
function stopToGlslVec3(hex: string): string {
  const color = new Color(hex)
  return `vec3(${color.r.toFixed(6)}, ${color.g.toFixed(6)}, ${color.b.toFixed(6)})`
}

/** `temperatureRamp(t)` GLSL, generated from `TEMPERATURE_RAMP_STOPS`. */
function buildTemperatureRampGlsl(): string {
  const branches = TEMPERATURE_RAMP_STOPS.slice(0, -1)
    .map((stop, index) => {
      const next = TEMPERATURE_RAMP_STOPS[index + 1]
      return `    if (t <= ${next.t.toFixed(4)}) {
      return mix(${stopToGlslVec3(stop.hex)}, ${stopToGlslVec3(next.hex)}, (t - ${stop.t.toFixed(4)}) / ${(next.t - stop.t).toFixed(4)});
    }`
    })
    .join('\n')

  const warmest = TEMPERATURE_RAMP_STOPS[TEMPERATURE_RAMP_STOPS.length - 1]

  return `
  vec3 temperatureRamp(float t) {
    t = clamp(t, 0.0, 1.0);
${branches}
    return ${stopToGlslVec3(warmest.hex)};
  }
`
}

/* ------------------------------------------------------------------ *
 * Atlas
 * ------------------------------------------------------------------ */

/**
 * Texels per depth tile, along both plan axes. The atlas exists to show smooth
 * horizontal structure over the region window, not to resolve fine detail —
 * the real grid is 1° spacing, so anything finer than this is interpolation,
 * not information. Unchanged from the demo bridge.
 */
const TILE_RESOLUTION = 48

/**
 * Largest depth-level count the shader's uniform array is sized for. The real
 * INCOIS temperature axis has 24 levels; 32 leaves headroom without inflating
 * the fragment shader's uniform footprint.
 */
export const MAX_TEMP_TILES = 32

/** Zero-filled depth-fraction array for the "no data yet" case. */
export const EMPTY_TEMP_DEPTH_FRACTIONS = new Float32Array(MAX_TEMP_TILES)

/**
 * The structural slice of a real analysis field this bridge needs. Both
 * `TemperatureDataState` (D12) and `SalinityDataState` (D13) satisfy it — it is
 * the read-only projection the atlas builder resamples from. The stored grid is
 * never modified.
 */
export interface ScalarFieldData {
  /** Ascending °N — the exact D10 latitude coordinate array. */
  latitudes: readonly number[]
  /** Ascending °E — the exact D10 longitude coordinate array. */
  longitudes: readonly number[]
  /** Metres, ascending — the exact D10 depth coordinate array (irregular). */
  depthMetres: readonly number[]
  /** One entry per real depth index; `null` until that depth's slice has loaded. */
  slices: readonly ({
    depthMetres: number
    /** `[latIndex][lonIndex]`, `null` where missing. */
    values: ReadonlyArray<ReadonlyArray<number | null>>
  } | null)[]
  /** Min / max across every valid value in every loaded slice — the normalisation range. */
  min: number | null
  max: number | null
}

export interface TemperatureFieldTexture {
  /** RGBA atlas: `tileCount` depth tiles side by side. R = normalised value, A = validity. */
  texture: DataTexture
  /** The normalisation range the texture's R channel was built against, °C. */
  min: number
  max: number
  /** Number of depth tiles actually in `texture` (= real depth-level count). */
  tileCount: number
  /** Depth fraction (0 surface … 1 floor) of each tile, ascending. Length `MAX_TEMP_TILES`. */
  depthFractions: Float32Array
}

/** Shared 1×1 stand-in bound while no real field is available. Never sampled for colour. */
export const PLACEHOLDER_TEMPERATURE_TEXTURE: DataTexture = (() => {
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType)
  texture.needsUpdate = true
  return texture
})()

/**
 * Bakes the real INCOIS temperature slices into one small texture for the
 * region and time currently in view.
 *
 * Layout: `data.slices.length` square tiles of `TILE_RESOLUTION` texels, laid
 * out left to right in the dataset's own depth order — shallowest first. Each
 * tile covers the region's full plan footprint (the `[-HALF_EXTENT,
 * HALF_EXTENT]` box every water shader reads `vPlan` against), so a fragment
 * shader locates a texel from the plan position and depth fraction it already
 * carries. The tile's depth fraction comes from the real depth-level metres via
 * `depthFraction()` — never from a constant spacing.
 *
 * Each texel: `sampleBilinear()` (the shared grid sampler) bilinearly
 * interpolates the real 36 × 51 grid at the texel's latitude/longitude
 * (resolved from the plan position through `domainPointToGeo`). This resamples
 * onto the scene's display atlas only — the stored slice values are never
 * modified. R holds the value normalised to
 * `[data.min, data.max]`; A holds the interpolation's validity (0 where every
 * contributing cell was missing).
 *
 * Rebuilt only when the region or the loaded time changes — a few thousand
 * lookups, once, on the CPU.
 */
/** A closed value range, `min` < `max`. */
export interface ScalarRange {
  min: number
  max: number
}

/**
 * The min/max of the **real** grid cells whose coordinates fall inside
 * `region`'s domain window (plus a one-cell margin, so the bilinear sampler's
 * edge reads are covered).
 *
 * This is the range the region's atlas actually spans — not the whole loaded
 * grid's. It matters for salinity: ocean practical salinity varies by ~1 PSU
 * across a coastal window but ~5 PSU across the full grid, so normalising one
 * region against the global min/max collapses every colour into a narrow band.
 * Normalising against this range instead spreads the region's real spatial
 * structure across the ramp. Nothing is invented — every value considered is a
 * real cell already in `data.slices`; missing cells (`null`) are skipped.
 *
 * Returns `null` when the window holds no valid cell or the range is
 * degenerate; the caller then falls back to the dataset range.
 */
export function regionScalarRange(
  region: OceanRegion,
  data: Pick<ScalarFieldData, 'latitudes' | 'longitudes' | 'slices'>,
): ScalarRange | null {
  const frame = geoFrame(region)
  const halfX = DOMAIN.width / 2
  const halfZ = DOMAIN.depth / 2

  // `domainPointToGeo` is affine, so the two opposite corners bound the window.
  const cornerA = domainPointToGeo(frame, -halfX, -halfZ)
  const cornerB = domainPointToGeo(frame, halfX, halfZ)
  const MARGIN_DEG = 1
  const latMin = Math.min(cornerA.latitude, cornerB.latitude) - MARGIN_DEG
  const latMax = Math.max(cornerA.latitude, cornerB.latitude) + MARGIN_DEG
  const lonMin = Math.min(cornerA.longitude, cornerB.longitude) - MARGIN_DEG
  const lonMax = Math.max(cornerA.longitude, cornerB.longitude) + MARGIN_DEG

  const { latitudes, longitudes, slices } = data
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const slice of slices) {
    if (!slice) continue
    for (let i = 0; i < latitudes.length; i += 1) {
      const lat = latitudes[i]
      if (lat < latMin || lat > latMax) continue
      const row = slice.values[i]
      if (row === undefined) continue
      for (let j = 0; j < longitudes.length; j += 1) {
        const lon = longitudes[j]
        if (lon < lonMin || lon > lonMax) continue
        const cell = row[j]
        if (cell === null || cell === undefined) continue
        if (cell < min) min = cell
        if (cell > max) max = cell
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  return { min, max }
}

/**
 * @param range Optional override for the value range the atlas's R channel is
 *   normalised against — and the range returned in `min`/`max`. When omitted
 *   (temperature), the whole loaded grid's `data.min`/`data.max` is used,
 *   exactly as before. Salinity passes `regionScalarRange(...)` so a single
 *   region's ~1 PSU spread is not flattened against the global ~5 PSU range.
 */
export function buildScalarFieldTexture(
  region: OceanRegion,
  data: ScalarFieldData,
  range?: ScalarRange | null,
): TemperatureFieldTexture {
  const frame = geoFrame(region)
  const { latitudes, longitudes, slices } = data
  const useRange = range != null && range.max > range.min
  const min = useRange ? range.min : (data.min ?? 0)
  const max = useRange ? range.max : (data.max ?? 1)

  const tileCount = Math.min(slices.length, MAX_TEMP_TILES)

  const depthFractions = new Float32Array(MAX_TEMP_TILES)
  for (let tile = 0; tile < tileCount; tile += 1) {
    const metres = slices[tile]?.depthMetres ?? data.depthMetres[tile] ?? 0
    depthFractions[tile] = depthFraction(metres)
  }

  const width = TILE_RESOLUTION * Math.max(tileCount, 1)
  const height = TILE_RESOLUTION
  const bytes = new Uint8Array(width * height * 4)

  const halfX = DOMAIN.width / 2
  const halfZ = DOMAIN.depth / 2

  for (let tile = 0; tile < tileCount; tile += 1) {
    const slice = slices[tile]
    if (!slice) continue

    for (let row = 0; row < TILE_RESOLUTION; row += 1) {
      // Texel rows run bottom-to-top in a WebGL texture; plan z runs -halfZ
      // (north) to +halfZ (south) — matching that here keeps the field
      // right-side up without a flip in the shader.
      const z = (row / (TILE_RESOLUTION - 1)) * 2 * halfZ - halfZ

      for (let col = 0; col < TILE_RESOLUTION; col += 1) {
        const x = (col / (TILE_RESOLUTION - 1)) * 2 * halfX - halfX

        const geo = domainPointToGeo(frame, x, z)
        const sampled = sampleBilinear(
          slice.values,
          latitudes,
          longitudes,
          geo.latitude,
          geo.longitude,
        )
        const normalised = sampled.valid > 0 ? normalizeTemperature(sampled.value, min, max) : 0
        const value = Math.round(clamp01(normalised) * 255)
        const validity = Math.round(clamp01(sampled.valid) * 255)

        const texel = (row * width + tile * TILE_RESOLUTION + col) * 4
        bytes[texel] = value
        bytes[texel + 1] = value
        bytes[texel + 2] = value
        bytes[texel + 3] = validity
      }
    }
  }

  const texture = new DataTexture(bytes, width, height, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true

  return { texture, min, max, tileCount, depthFractions }
}

/* ------------------------------------------------------------------ *
 * GLSL
 * ------------------------------------------------------------------ */

/**
 * GLSL for sampling the atlas and colouring the result.
 *
 * Concatenated into `VolumeShell`, `DepthStrata` and `DepthSlice` alongside
 * `WATER_GLSL`. Every material that includes it expects these uniforms:
 *
 *   uTemperatureAtlas       the RGBA atlas above (or the 1×1 placeholder)
 *   uFieldMix               0 keeps the material's procedural colour, 1 is the field
 *   uTempTileCount          number of real depth tiles in the atlas (0 disables it)
 *   uTempDepthFractions[32] each tile's depth fraction, ascending
 *
 * Depth is a uniform array + a bounded loop rather than an unrolled
 * `if`/`else if` chain (the demo bridge's approach), so the shader compiles
 * once and works for whatever depth-level count the API reports — the count and
 * the fractions come straight from `GET /coordinates`, nothing is assumed. The
 * loop bound is the compile-time constant `MAX_TEMP_TILES`; every array access
 * is by the loop index, so this stays valid GLSL ES 1.00.
 */
export const TEMPERATURE_FIELD_GLSL = `
  uniform sampler2D uTemperatureAtlas;
  uniform float uFieldMix;
  uniform int uTempTileCount;
  uniform float uTempDepthFractions[${MAX_TEMP_TILES}];

  const int TEMP_MAX_TILES = ${MAX_TEMP_TILES};
  const float TEMP_TILE_INSET = ${(0.5 / TILE_RESOLUTION).toFixed(6)};
${buildTemperatureRampGlsl()}
  /** One tile's UV, given plan position already mapped to [0, 1]. Inset by half
   *  a texel so linear filtering never bleeds a neighbouring depth's data in. */
  vec2 temperatureAtlasUV(vec2 plan01, int tileIndex, int tileCount) {
    vec2 inset = mix(vec2(TEMP_TILE_INSET), vec2(1.0 - TEMP_TILE_INSET), plan01);
    float u = (float(tileIndex) + inset.x) / float(max(tileCount, 1));
    return vec2(u, inset.y);
  }

  /** Normalised value (.x) and validity (.y) at a plan position and depth
   *  fraction, linearly interpolated between the two bracketing depth tiles. */
  vec2 sampleTemperatureField(vec2 plan, float depthT) {
    int count = uTempTileCount;
    if (count <= 0) {
      return vec2(0.0, 0.0);
    }

    vec2 plan01 = clamp(plan * 0.5 + 0.5, 0.0, 1.0);
    float d = clamp(depthT, 0.0, 1.0);

    // Default: clamp to the shallowest tile (covers d below the first fraction).
    vec4 shallow = texture2D(uTemperatureAtlas, temperatureAtlasUV(plan01, 0, count));
    vec2 result = vec2(shallow.r, shallow.a);

    for (int i = 0; i < TEMP_MAX_TILES; i += 1) {
      if (i >= count) {
        break;
      }

      vec4 here = texture2D(uTemperatureAtlas, temperatureAtlasUV(plan01, i, count));

      // Beyond the deepest tile -> clamp to it.
      if (i == count - 1 && d >= uTempDepthFractions[i]) {
        result = vec2(here.r, here.a);
      }

      // Between tile i and tile i+1.
      if (i < count - 1) {
        float fa = uTempDepthFractions[i];
        float fb = uTempDepthFractions[i + 1];
        if (d >= fa && d <= fb) {
          vec4 next = texture2D(uTemperatureAtlas, temperatureAtlasUV(plan01, i + 1, count));
          float span = max(fb - fa, 1e-6);
          float w = clamp((d - fa) / span, 0.0, 1.0);
          result = vec2(mix(here.r, next.r, w), mix(here.a, next.a, w));
        }
      }
    }

    return result;
  }

  /** The field's colour (.rgb) and validity (.a) at a plan position and depth
   *  fraction. A caller blends: mix(baseColour, colour.rgb, uFieldMix * colour.a). */
  vec4 temperatureFieldColor(vec2 plan, float depthT) {
    vec2 sampled = sampleTemperatureField(plan, depthT);
    return vec4(temperatureRamp(sampled.x), sampled.y);
  }
`
