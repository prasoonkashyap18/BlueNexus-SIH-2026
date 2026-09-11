import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { DEPTH_TICKS, DOMAIN, RENDER_ORDER, depthFraction } from './sceneConfig'

const HALF_X = DOMAIN.width / 2
const HALF_Z = DOMAIN.depth / 2

/** The domain footprint, anticlockwise from the -x/-z corner. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-HALF_X, -HALF_Z],
  [HALF_X, -HALF_Z],
  [HALF_X, HALF_Z],
  [-HALF_X, HALF_Z],
]

/** Appends the four sides of the footprint at height `y`. */
function pushRing(vertices: number[], y: number): void {
  CORNERS.forEach(([x, z], index) => {
    const next = CORNERS[(index + 1) % CORNERS.length]
    if (next === undefined) return
    vertices.push(x, y, z, next[0], y, next[1])
  })
}

function geometryFrom(vertices: number[]): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(vertices, 3),
  )
}

/**
 * The two rims: the sea surface at y = 0 and the deep boundary at y = -1.
 *
 * Drawn as their own object, and brighter than the rest of the cage, because
 * they are the only two horizontal planes in the scene that mean something
 * physical — where the water starts and where the modelled column stops. The
 * surface rim doubles as the seam between the ocean window and the geographic
 * frame outside it.
 */
function rimGeometry(): BufferGeometry {
  const vertices: number[] = []
  pushRing(vertices, 0)
  pushRing(vertices, -1)
  return geometryFrom(vertices)
}

/** The four vertical corner posts joining the rims. */
function postGeometry(): BufferGeometry {
  const vertices: number[] = []
  for (const [x, z] of CORNERS) vertices.push(x, 0, z, x, -1, z)
  return geometryFrom(vertices)
}

/**
 * Rings at the marked depths, as one line-segment buffer rather than a mesh
 * per ring — four draw calls for static furniture is three too many.
 */
function tickGeometry(): BufferGeometry {
  const vertices: number[] = []
  for (const metres of DEPTH_TICKS) pushRing(vertices, -depthFraction(metres))
  return geometryFrom(vertices)
}

/**
 * The wireframe cage around the water column, plus rings at each marked depth.
 *
 * This is what keeps the scene reading as an instrument rather than as an
 * illustration: it states where the domain ends, and it makes the vertical
 * exaggeration control legible — the cage stretches with the column, so the
 * viewer can see the axis being scaled rather than just the water changing.
 *
 * Drawn in three weights rather than one. The water is deliberately
 * soft-edged and cornerless, so a uniformly bright cage would put the
 * rectangular block straight back into the picture; instead the two rims carry
 * most of the weight, the corner posts are barely there, and the depth rings
 * are fainter still. The eye reads a top, a bottom and a scale between them,
 * and never a box.
 */
export function SceneFrame() {
  const rims = useMemo(() => rimGeometry(), [])
  const posts = useMemo(() => postGeometry(), [])
  const ticks = useMemo(() => tickGeometry(), [])

  // Built here rather than by R3F, so they have to be given back here too.
  useEffect(() => () => rims.dispose(), [rims])
  useEffect(() => () => posts.dispose(), [posts])
  useEffect(() => () => ticks.dispose(), [ticks])

  return (
    <group>
      <lineSegments geometry={rims} renderOrder={RENDER_ORDER.frame}>
        <lineBasicMaterial color="#8fe0dc" transparent opacity={0.34} depthWrite={false} />
      </lineSegments>

      <lineSegments geometry={posts} renderOrder={RENDER_ORDER.frame}>
        <lineBasicMaterial color="#7fd4d0" transparent opacity={0.2} depthWrite={false} />
      </lineSegments>

      <lineSegments geometry={ticks} renderOrder={RENDER_ORDER.frame}>
        <lineBasicMaterial color="#7fd4d0" transparent opacity={0.1} depthWrite={false} />
      </lineSegments>
    </group>
  )
}
