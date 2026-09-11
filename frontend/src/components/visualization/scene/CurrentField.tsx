import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  type InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import type { OceanRegion } from '../../../state/locationState'
import {
  currentHeadingRadians,
  nearestCurrentVector,
  type CurrentDataState,
} from '../../../state/currentDataState'
import { geoFrame, domainPointToGeo } from './geography'
import { DOMAIN, RENDER_ORDER } from './sceneConfig'
import { temperatureToColor } from './temperatureField'

/**
 * D13 — the real INCOIS IO-HOOFS **surface-current** vector layer.
 *
 * This is a deliberately minimal representation (D13 §12): one flat arrow glyph
 * per sample point on the sea surface, its heading from U/V and its length and
 * colour from the API's authoritative `current_speed`. It is NOT a streamline /
 * particle-advection system — that is out of scope.
 *
 * ### Kept separate from the water on purpose
 *
 * Currents have their **own** grid (≈0.0833°, 421 × 601) and their **own**
 * coordinate arrays — nothing here touches the 1° temperature/salinity grid.
 * The only shared machinery is `geoFrame` / `domainPointToGeo`, which are pure
 * world↔geographic mappings (dataset-independent): each arrow's world position
 * is converted to a latitude/longitude, then `nearestCurrentVector` reads the
 * **nearest real current cell** — no interpolation, no regridding, no
 * resampling (D13 §13).
 *
 * ### Surface-only
 *
 * Every arrow sits on the surface plane (`depth_index = 0`, `depth = 0 m`).
 * Dragging the depth slider below the surface does not invent deeper currents:
 * the arrows stay at the surface and fade back (`atSurface` false), and the HUD
 * states "surface only". No subsurface current is ever drawn.
 *
 * ### Missing data
 *
 * A vector is drawn only where U, V and the authoritative speed are all present
 * at that cell. Missing cells are simply skipped — never a fabricated zero
 * vector (D13 §16).
 */

/** How many arrows across each axis of the domain footprint. 26² = 676 max. */
const SAMPLES_PER_AXIS = 26
/** Arrow length in world units at zero / maximum speed. The floor keeps the
 *  slowest real vectors above sub-pixel size; the span still scales with the
 *  authoritative speed so a fast cell reads as ~3.7× a slow one. */
const ARROW_LEN_MIN = 0.17
const ARROW_LEN_MAX = 0.62
/** Height above the mean surface, clear of the procedural swell crests. */
const SURFACE_Y = 0.22
/**
 * Legibility floor for the glyph colour. The hue still comes entirely from the
 * shared speed ramp (`temperatureToColor`, same ramp as the HUD colorbar), so
 * speed reads identically — this only lifts brightness so the slow end
 * (deep blue) is not lost against the dark ocean surface.
 */
const GLYPH_TINT = new Color(1, 1, 1)
const GLYPH_TINT_MIX = 0.3

/** A flat dart in the XZ plane, tip at +X, unit length. */
function arrowGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        // arrowhead
        0.5, 0, 0.0, -0.15, 0, 0.28, -0.15, 0, -0.28,
        // shaft
        -0.15, 0, 0.1, -0.5, 0, 0.1, -0.5, 0, -0.1, -0.15, 0, 0.1, -0.5, 0, -0.1, -0.15, 0, -0.1,
      ],
      3,
    ),
  )
  return geometry
}

interface Arrow {
  x: number
  z: number
  /** Heading about +Y so the +X dart points along the flow. */
  heading: number
  /** Authoritative speed, m s⁻¹. */
  speed: number
}

interface CurrentFieldProps {
  region: OceanRegion
  data: CurrentDataState
  /** False hides the layer entirely (a non-current variable is selected). */
  visible: boolean
  /** False = the depth slider is below the surface; arrows fade but stay at 0 m. */
  atSurface: boolean
}

function CurrentFieldImpl({ region, data, visible, atSurface }: CurrentFieldProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => arrowGeometry(), [])

  useLayoutEffect(() => () => geometry.dispose(), [geometry])

  const { grid, latitudes, longitudes, speedMin, speedMax } = data

  /**
   * The arrows for the region and loaded forecast time. Recomputed only when
   * the current grid, the region or the normalisation range changes — never per
   * frame, and never per React render.
   */
  const arrows = useMemo<Arrow[]>(() => {
    if (grid === null || speedMax === null || latitudes.length === 0) return []

    const frame = geoFrame(region)
    const halfX = DOMAIN.width / 2
    const halfZ = DOMAIN.depth / 2
    const margin = 0.4
    const latLo = latitudes[0]
    const latHi = latitudes[latitudes.length - 1]
    const lonLo = longitudes[0]
    const lonHi = longitudes[longitudes.length - 1]

    const out: Arrow[] = []
    for (let i = 0; i < SAMPLES_PER_AXIS; i += 1) {
      const z = -halfZ + margin + (i / (SAMPLES_PER_AXIS - 1)) * (2 * (halfZ - margin))
      for (let j = 0; j < SAMPLES_PER_AXIS; j += 1) {
        const x = -halfX + margin + (j / (SAMPLES_PER_AXIS - 1)) * (2 * (halfX - margin))
        const geo = domainPointToGeo(frame, x, z)

        // Outside the real current coverage window → no arrow (never extrapolated).
        if (geo.latitude < latLo || geo.latitude > latHi) continue
        if (geo.longitude < lonLo || geo.longitude > lonHi) continue

        const sample = nearestCurrentVector(grid, latitudes, longitudes, geo.latitude, geo.longitude)
        if (sample.valid === 0) continue // missing U/V/speed — no fabricated vector

        out.push({
          x,
          z,
          heading: currentHeadingRadians(sample.u, sample.v),
          speed: sample.speed,
        })
      }
    }
    return out
  }, [grid, region, latitudes, longitudes, speedMax])

  // Push instance matrices + colours whenever the arrows change.
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (mesh === null) return

    const matrix = new Matrix4()
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    const axis = new Vector3(0, 1, 0)
    const lo = speedMin ?? 0
    const hi = speedMax ?? 1
    const span = hi - lo > 1e-9 ? hi - lo : 1

    arrows.forEach((arrow, index) => {
      const t = Math.min(1, Math.max(0, (arrow.speed - lo) / span))
      const len = ARROW_LEN_MIN + (ARROW_LEN_MAX - ARROW_LEN_MIN) * t
      position.set(arrow.x, SURFACE_Y, arrow.z)
      quaternion.setFromAxisAngle(axis, arrow.heading)
      scale.set(len, 1, Math.min(len, 0.4))
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, temperatureToColor(arrow.speed, lo, hi).lerp(GLYPH_TINT, GLYPH_TINT_MIX))
    })

    mesh.count = arrows.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  }, [arrows, speedMin, speedMax])

  // Kept mounted (not unmounted when hidden) so the instance buffers survive a
  // variable switch — `visible` toggles the draw, the layout effect owns count.
  return (
    <instancedMesh
      ref={meshRef}
      // A generous fixed capacity; `mesh.count` is set to the live arrow count.
      args={[undefined, undefined, SAMPLES_PER_AXIS * SAMPLES_PER_AXIS]}
      geometry={geometry}
      renderOrder={RENDER_ORDER.label + 1}
      frustumCulled={false}
      visible={visible && arrows.length > 0}
    >
      <meshBasicMaterial
        vertexColors
        transparent
        depthWrite={false}
        side={DoubleSide}
        toneMapped={false}
        // Surface-only cue: full strength at 0 m, faded once the depth slider is
        // dragged into the water column (the arrows never leave the surface).
        opacity={atSurface ? 1 : 0.45}
      />
    </instancedMesh>
  )
}

/**
 * Step 49 — memoised. `data` is the memoised `CurrentDataState` context value
 * (new identity only when the current provider's state actually changes);
 * `region`, `visible` and `atSurface` are a region ref and two booleans. So a
 * depth-slider drag or a playback tick that re-renders `OceanScene` while a
 * non-current variable is selected no longer reconciles this layer. The
 * per-arrow work already lived in `useMemo` / `useLayoutEffect`; this stops the
 * surrounding render from running at all.
 */
export const CurrentField = memo(CurrentFieldImpl)
