import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  type Group,
  type LineSegments,
  type SpriteMaterial,
} from 'three'
import { AXIS, DEPTH_MARKS, DOMAIN, RENDER_ORDER, depthFraction } from './sceneConfig'
import { labelTexture } from './sceneLabels'

/** The rail, authored in the unit column and scaled to the current height. */
function railGeometry(): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 0, -1, 0], 3),
  )
}

interface DepthAxisProps {
  /**
   * The column's current world height, written every frame by `OceanVolume`.
   *
   * A ref rather than a prop value because the exaggeration eases in: the axis
   * has to track the water frame by frame, and a prop would re-render the
   * component sixty times a second to do it.
   */
  heightRef: RefObject<number>
}

/**
 * The depth ruler standing beside the water column.
 *
 * The scene already says *that* it is three-dimensional — the strata, the
 * fading corners and the orbit all do that. What it could not say before is
 * *how deep*: this is the piece that turns the vertical axis from an
 * impression into a reading, and it is why the column now scans as surface →
 * 500 m → 1000 m → abyss rather than as a tall block of blue.
 *
 * Three decisions keep it from becoming clutter:
 *
 * - **It stands outside the domain.** The rail and every label sit beyond the
 *   +x/+z corner, so nothing in the ruler is ever drawn over the water it
 *   measures. That corner is the one facing the default three-quarter view.
 * - **It refines as the column stretches.** Marks carry the height at which
 *   they have room to be read (see `DEPTH_MARKS`), so 1× shows only the
 *   surface and the floor, and 500 m and 200 m appear as the exaggeration
 *   control opens the upper ocean up. The alternative — printing all eight at
 *   every setting — is a stack of overlapping type at anything below 7×.
 * - **It is nine draw calls.** One rail plus one sprite per mark, each mark's
 *   tick drawn into its own label texture rather than as separate geometry.
 *
 * It lives *outside* the exaggerated column group on purpose: a sprite takes
 * its size from its world matrix, so a group scaled 10× on y would stretch
 * every label into a smear. Positions are computed against the reported height
 * instead, which is the same number the group is being scaled by.
 */
export function DepthAxis({ heightRef }: DepthAxisProps) {
  const rail = useMemo(() => railGeometry(), [])

  const labels = useMemo(
    () =>
      DEPTH_MARKS.map((mark) =>
        labelTexture(mark.label, { rule: AXIS.rulePixels, color: AXIS.color }),
      ),
    [],
  )

  // Canvas textures and hand-built geometry are ours, not R3F's, so they have
  // to be given back when the axis unmounts.
  useEffect(() => () => rail.dispose(), [rail])
  useEffect(() => () => labels.forEach((texture) => texture.dispose()), [labels])

  const railRef = useRef<LineSegments>(null)
  const markRefs = useRef<(Group | null)[]>([])
  const materialRefs = useRef<(SpriteMaterial | null)[]>([])

  useFrame(() => {
    const height = heightRef.current

    if (railRef.current !== null) railRef.current.scale.y = height

    DEPTH_MARKS.forEach((mark, index) => {
      const group = markRefs.current[index]
      const material = materialRefs.current[index]
      if (group === undefined || group === null) return

      group.position.y = -depthFraction(mark.metres) * height

      // Faded in over a short band above the threshold rather than switched
      // on at it, so dragging the exaggeration slider reveals a mark instead
      // of popping it into existence.
      const presence =
        mark.minHeight <= 0
          ? 1
          : MathUtils.smoothstep(height, mark.minHeight, mark.minHeight * 1.1)

      group.visible = presence > 0.01
      if (material !== undefined && material !== null) {
        material.opacity = AXIS.labelOpacity * presence
      }
    })
  })

  return (
    <group
      position={[
        AXIS.edgeX * (DOMAIN.width / 2 + AXIS.offset),
        0,
        AXIS.edgeZ * (DOMAIN.depth / 2 + AXIS.offset),
      ]}
    >
      <lineSegments ref={railRef} geometry={rail} renderOrder={RENDER_ORDER.axis}>
        <lineBasicMaterial
          color={AXIS.color}
          transparent
          opacity={AXIS.railOpacity}
          depthWrite={false}
        />
      </lineSegments>

      {DEPTH_MARKS.map((mark, index) => (
        <group
          key={mark.metres}
          ref={(node) => {
            markRefs.current[index] = node
          }}
        >
          {/* The plate reads left to right from the rail, which is why the
              axis is authored for the +x corner. */}
          <sprite
            position={[(AXIS.edgeX * AXIS.labelWidth) / 2, 0, 0]}
            scale={[AXIS.labelWidth, AXIS.labelHeight, 1]}
            renderOrder={RENDER_ORDER.label}
          >
            <spriteMaterial
              ref={(node) => {
                materialRefs.current[index] = node
              }}
              map={labels[index]}
              transparent
              opacity={AXIS.labelOpacity}
              depthWrite={false}
            />
          </sprite>
        </group>
      ))}
    </group>
  )
}
