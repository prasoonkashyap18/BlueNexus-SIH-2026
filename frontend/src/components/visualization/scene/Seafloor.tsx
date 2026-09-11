import { useEffect, useMemo } from 'react'
import { PlaneGeometry } from 'three'
import { DOMAIN } from './sceneConfig'

/**
 * Demo bathymetry: a shelf breaking into a slope on one flank, a seamount, and
 * two octaves of swell over the abyssal plain. Deterministic and closed-form —
 * there is no dataset behind it and none is implied.
 *
 * Returned in unit-column space, where 1.0 would be the full depth of the box.
 */
function bathymetry(x: number, z: number): number {
  const nx = x / (DOMAIN.width / 2)
  const nz = z / (DOMAIN.depth / 2)

  let height = 0

  // Abyssal relief.
  height += Math.sin(nx * 2.3 + 0.7) * Math.cos(nz * 1.9 - 0.4) * 0.055
  height += Math.sin(nx * 5.1 - 1.2) * Math.cos(nz * 4.3 + 0.9) * 0.022
  height += Math.sin((nx + nz) * 7.7) * 0.01

  // Continental shelf climbing towards one edge.
  height += Math.max(0, -nx - 0.3) * 0.3

  // An isolated seamount, so the relief reads as three-dimensional from every
  // camera angle rather than as a tilted plane.
  const distance = Math.hypot(nx - 0.34, nz + 0.28)
  height += Math.exp(-distance * distance * 9) * 0.15

  return height
}

/** A plane of the given resolution, displaced by the bathymetry above. */
function relief(segments: number): PlaneGeometry {
  const plane = new PlaneGeometry(DOMAIN.width, DOMAIN.depth, segments, segments)
  const position = plane.attributes.position

  // The plane is displaced along its own +Z, which the -90° X rotation on the
  // group turns into world +Y.
  for (let index = 0; index < position.count; index += 1) {
    position.setZ(index, bathymetry(position.getX(index), position.getY(index)))
  }

  position.needsUpdate = true
  plane.computeVertexNormals()

  return plane
}

/** Shaded relief, dense enough that the seamount reads as a smooth dome. */
const SURFACE_SEGMENTS = 96

/**
 * The sampling grid drawn over it.
 *
 * Deliberately far coarser than the surface it sits on. The wireframe is there
 * to say "this is a sampled field", and at the surface's own resolution it says
 * nothing — it just turns the sea floor into a solid haze of lines, at nearly
 * twenty thousand segments per frame.
 */
const GRID_SEGMENTS = 24

/**
 * Sea floor closing the bottom of the water column.
 *
 * Uses a lit standard material — this is the surface the key light actually
 * models, so the relief is legible as shape and not as a texture. The
 * hemisphere light does the rest of the work here: it puts sky on the upward
 * faces and deep water on the flanks, which is what separates the seamount
 * from the plain it stands on.
 */
export function Seafloor() {
  const surface = useMemo(() => relief(SURFACE_SEGMENTS), [])
  const grid = useMemo(() => relief(GRID_SEGMENTS), [])

  // Built here rather than by R3F, so they have to be given back here too.
  useEffect(() => () => surface.dispose(), [surface])
  useEffect(() => () => grid.dispose(), [grid])

  return (
    <group position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={surface}>
        <meshStandardMaterial color="#1b3a4f" roughness={0.92} metalness={0.05} />
      </mesh>

      <mesh geometry={grid}>
        <meshBasicMaterial
          color="#7fd4d0"
          wireframe
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
