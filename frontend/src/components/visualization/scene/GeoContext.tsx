import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, type BufferGeometry, type LineBasicMaterial, type SpriteMaterial } from 'three'
import type { OceanRegion } from '../../../state/locationState'
import { GEO, buildGraticule, buildRegionMarker, geoFrame, graticuleLabels } from './geography'
import { DOMAIN, RENDER_ORDER } from './sceneConfig'
import { labelTexture } from './sceneLabels'

interface GeoContextProps {
  /** The area the graticule is drawn for. */
  region: OceanRegion
  /** Frozen when the viewer has asked for reduced motion. */
  animated?: boolean
}

/**
 * Geographic context for the water column.
 *
 * A latitude/longitude graticule laid on a gently curved surface that runs out
 * from the edge of the domain and dissolves into the haze, with the region's
 * own coordinate picked out, its footprint bracketed at the corners, and a
 * compass letter off each edge. That is the whole of it: no
 * coastline, no landmass, no bathymetry and no basin outline is drawn or
 * implied — see `geography.ts` for what the geometry actually represents.
 *
 * Three rules keep it in its place behind the science:
 *
 * - **It never crosses the domain.** The grid is clipped to a clean hole
 *   around the column, so the water, the depth slice and anything drawn into
 *   the domain later have the frame entirely to themselves. The frame's own
 *   surface rim, drawn by `SceneFrame`, is the seam between the two.
 * - **It yields to the camera.** Closing in on the water fades it down towards
 *   a trace; pulling back brings it up, because that is when a reader is
 *   asking where they are rather than what the water is doing.
 * - **It is lines and a few letters.** No fill, no depth writes, one draw call
 *   each for the grid and the brackets, and nothing that can occlude a surface.
 *
 * Arriving somewhere new is the one moment the frame is allowed to speak up:
 * the brackets overshoot their resting weight as the graticule fades in and
 * settle back over about a second, so a region change reads as *this* place
 * rather than as the grid quietly redrawing itself.
 */
function GeoContextImpl({ region, animated = true }: GeoContextProps) {
  const frame = useMemo(() => geoFrame(region), [region])
  const graticule = useMemo(() => buildGraticule(frame), [frame])
  const marker = useMemo(() => buildRegionMarker(), [])

  // One label per cardinal direction, off the matching edge of the domain.
  // East is +x and north is -z throughout the scene (see `projectGeo`), so
  // south and west are simply the opposite edges.
  const compass = useMemo(() => {
    const halfX = DOMAIN.width / 2 + GEO.compassOffset
    const halfZ = DOMAIN.depth / 2 + GEO.compassOffset
    return [
      { letter: 'N', position: [0, 0.06, -halfZ] as const },
      { letter: 'S', position: [0, 0.06, halfZ] as const },
      { letter: 'E', position: [halfX, 0.06, 0] as const },
      { letter: 'W', position: [-halfX, 0.06, 0] as const },
    ].map((entry) => ({
      ...entry,
      texture: labelTexture(entry.letter, {
        width: 96,
        height: 96,
        fontSize: 58,
        align: 'centre',
        color: GEO.markedColor,
      }),
    }))
  }, [])

  // Step 40: a few real coordinate values (e.g. "74°E", "12°N") on the lines
  // that bound the visible window — the graticule, named. Rebuilt with the
  // frame; each texture is owned here and disposed on a region change.
  const coordinateLabels = useMemo(() => {
    return graticuleLabels(frame).map((label) => ({
      ...label,
      texture: labelTexture(label.text, {
        width: 128,
        height: 64,
        fontSize: 34,
        align: 'centre',
        color: GEO.labelColor,
      }),
    }))
  }, [frame])

  const graticuleMaterial = useRef<LineBasicMaterial>(null)
  const markerMaterial = useRef<LineBasicMaterial>(null)
  const compassMaterials = useRef<(SpriteMaterial | null)[]>([])
  const labelMaterials = useRef<(SpriteMaterial | null)[]>([])

  /** Arrival fade, 0 → 1, restarted whenever the graticule is rebuilt. */
  const arrival = useRef(1)
  /** The geometry the frame loop last saw, so it can notice a new region. */
  const shown = useRef<BufferGeometry | null>(null)

  // The graticule is rebuilt on every region change, so unlike the rest of the
  // scene's static furniture it has to give the old buffers back.
  useEffect(() => () => graticule.dispose(), [graticule])
  useEffect(() => () => marker.dispose(), [marker])
  useEffect(
    () => () => compass.forEach((entry) => entry.texture.dispose()),
    [compass],
  )
  useEffect(
    () => () => coordinateLabels.forEach((label) => label.texture.dispose()),
    [coordinateLabels],
  )

  useFrame((state, delta) => {
    // Noticed here rather than in an effect: the fade has to be reset before
    // the first frame the new geometry is drawn in, not after it.
    if (shown.current !== graticule) {
      shown.current = graticule
      arrival.current = animated ? 0 : 1
    }
    arrival.current = Math.min(1, arrival.current + delta / GEO.arrivalSeconds)

    // Distance to the column rather than to the orbit pivot: the graticule
    // lies at the surface, and following the pivot would make it fade as the
    // exaggeration slider pushed mid-depth away from it.
    const range = MathUtils.smoothstep(
      state.camera.position.length(),
      GEO.nearDistance,
      GEO.farDistance,
    )
    const arrived = MathUtils.smoothstep(arrival.current, 0, 1)
    const presence = MathUtils.lerp(GEO.markerFloor, 1, range)

    // A single hump over the arrival: zero at both ends, so the brackets rise
    // past their resting weight and come back to it without a second cue.
    const emphasis = Math.sin(Math.PI * arrived) * GEO.arrivalEmphasis

    if (graticuleMaterial.current !== null) {
      graticuleMaterial.current.opacity = MathUtils.lerp(GEO.nearPresence, 1, range) * arrived
    }
    if (markerMaterial.current !== null) {
      markerMaterial.current.opacity = Math.min(
        1,
        GEO.markerOpacity * (presence + emphasis) * arrived,
      )
    }
    // The compass is not part of the selection, so it holds its weight through
    // a region change instead of re-announcing itself with the brackets.
    const compassOpacity = GEO.compassOpacity * presence
    for (const material of compassMaterials.current) {
      if (material !== null) material.opacity = compassOpacity
    }

    // Coordinate labels track the graticule: they fade in with it on arrival
    // and yield to the camera the same way, so they never outweigh the water.
    const labelOpacity = GEO.labelOpacity * presence * arrived
    for (const material of labelMaterials.current) {
      if (material !== null) material.opacity = labelOpacity
    }
  })

  return (
    <group>
      <lineSegments geometry={graticule} renderOrder={RENDER_ORDER.geography}>
        <lineBasicMaterial
          ref={graticuleMaterial}
          // Weight, colour and the radial fade all ride in the vertex colours,
          // which leaves this material with a single animated number.
          vertexColors
          transparent
          opacity={0}
          depthWrite={false}
        />
      </lineSegments>

      <lineSegments geometry={marker} renderOrder={RENDER_ORDER.geography}>
        <lineBasicMaterial
          ref={markerMaterial}
          color={GEO.markedColor}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </lineSegments>

      {/* One letter per cardinal direction, off the matching edge, so the
          reader can tell which way the graticule runs without guessing from
          north alone. */}
      {compass.map((entry, index) => (
        <sprite
          key={entry.letter}
          position={entry.position}
          scale={[GEO.compassSize, GEO.compassSize, 1]}
          renderOrder={RENDER_ORDER.label}
        >
          <spriteMaterial
            ref={(material) => {
              compassMaterials.current[index] = material
            }}
            map={entry.texture}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </sprite>
      ))}

      {/* Step 40: real degree values on the lines that bound the window, placed
          with the same `projectGeo` transform as everything else in the scene.
          Lines and a few short strings — no plate, no fill, no depth writes. */}
      {coordinateLabels.map((label, index) => (
        <sprite
          key={`${label.axis}-${label.text}`}
          position={label.position}
          scale={[GEO.labelSize * 2, GEO.labelSize, 1]}
          renderOrder={RENDER_ORDER.label}
        >
          <spriteMaterial
            ref={(material) => {
              labelMaterials.current[index] = material
            }}
            map={label.texture}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  )
}

/**
 * Step 49 — memoised so an unrelated store change (a depth-slider drag, a
 * playback tick, a layer toggle) that re-renders `OceanScene` does not also
 * reconcile the graticule. Its props (`region`, `animated`) only change on a
 * region switch or a reduced-motion change; the fade lives in `useFrame` and
 * is unaffected by React render frequency.
 */
export const GeoContext = memo(GeoContextImpl)
