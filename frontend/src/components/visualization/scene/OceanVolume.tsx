import { memo, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Color, Group } from 'three'
import { DepthAxis } from './DepthAxis'
import { DepthSlice } from './DepthSlice'
import { DepthStrata } from './DepthStrata'
import { OceanSurface } from './OceanSurface'
import { SceneFrame } from './SceneFrame'
import { Seafloor } from './Seafloor'
import { VolumeShell } from './VolumeShell'
import { columnHeight, surfaceOpacity } from './sceneConfig'
import type { TemperatureFieldTexture } from './temperatureField'

interface OceanVolumeProps {
  /** Bright end of the field ramp — the near-surface water. */
  shallow: Color
  /** Dark end of the ramp — the abyss. */
  deep: Color
  /** Normalised 0–1, straight from the opacity control. */
  opacity: number
  /** Selected depth as a fraction of the column, 0 at the surface. */
  depth: number
  /** Multiplier on the vertical axis. */
  exaggeration: number
  /** The model-field layer: the water body itself, surface and slice aside. */
  showField?: boolean
  /** The bathymetry layer. */
  showBathymetry?: boolean
  /** Frozen when the viewer has asked for reduced motion. */
  animated?: boolean
  /** The real INCOIS temperature atlas, or `null` while loading / unavailable. */
  temperatureField: TemperatureFieldTexture | null
  /** 1 shows the real field's colour, 0 the placeholder hue ramp. Eased; 0 when field is null. */
  fieldMix: number
  /**
   * Called each frame with the column's current world height.
   *
   * Vertical exaggeration eases in rather than snapping, so a camera
   * controller that wants to stay centred on the water has to follow the
   * height frame by frame rather than compute it from the target factor. A
   * callback rather than a shared ref keeps the group this component animates
   * private to it — the caller reads a number, it does not get a handle on
   * the transform.
   */
  onColumnHeight?: (height: number) => void
}

/**
 * The ocean itself — surface, water body, stratification, depth slice, sea
 * floor, reference frame and depth axis as one reusable unit.
 *
 * Everything is procedural. No dataset stands behind any of it: the geometry
 * is closed-form and the shading is a depth ramp with analytic structure, a
 * stand-in for the gridded field that arrives in a later step. What it does
 * establish is the frame that field will be drawn into — the unit column, the
 * depth parameterisation and the three controls below.
 *
 * The component takes every parameter as a prop rather than reading the shared
 * store, so a comparison view can put two volumes side by side at different
 * times or variables without either of them fighting over global state.
 *
 * Composition, surface downwards:
 *
 *   OceanSurface   lit swell at y = 0, outside the exaggerated group
 *   DepthAxis      the depth ruler, also outside it — see below
 *   ├ VolumeShell  the enclosing body of water, corners faded out
 *   ├ DepthStrata  soft-edged layers filling the interior
 *   ├ DepthSlice   the plane at the selected depth
 *   ├ Seafloor     procedural bathymetry closing the column
 *   └ SceneFrame   reference cage, rims and depth tick rings
 *
 * Everything below the surface is authored in a unit column (y from 0 to -1)
 * and scaled by one group, so vertical exaggeration is a single transform and
 * no child has to know the current factor. Two things stay outside that group.
 * The surface, because the swell is physical and stretching it tenfold would
 * read as a storm rather than as an exaggerated axis. And the depth axis,
 * because its labels are sprites, which take their size from the world matrix
 * and would smear under a non-uniform scale; it follows the column through
 * `heightRef` instead.
 *
 * ### Controls
 *
 * - **opacity** reaches the shell and the strata as a shader uniform, scales
 *   the slice plane's fill, and sets the surface's transparency through
 *   `surfaceOpacity`. It is the transparency of the water, not a master fade:
 *   the slice outline, the reference frame and the depth axis stay readable at
 *   zero.
 * - **depth** is a fraction of the column. It positions the slice plane, and
 *   is passed to the shell and the strata as `uSlice` so the selected level
 *   also glows through the water around the plane.
 * - **exaggeration** scales the column group on y, eased in the frame loop so
 *   the water visibly stretches rather than snapping to a new height. The
 *   eased height is reported back through `onColumnHeight`, and it is also
 *   what refines the depth axis: stretching the column is how the reader asks
 *   for finer depth marks.
 * - **temperatureField** and **fieldMix** carry the Step 16 dataset into the
 *   shell, the strata and the slice: a texture already baked for the active
 *   region and time (see `temperatureField.ts`), and how much of it to show
 *   versus the older placeholder ramp — 1 while temperature is the selected
 *   variable, 0 for everything else. `OceanVolume` does not build or own
 *   either; it only passes them on, the same way it does every other prop.
 */
function OceanVolumeImpl({
  shallow,
  deep,
  opacity,
  depth,
  exaggeration,
  showField = true,
  showBathymetry = false,
  animated = true,
  temperatureField,
  fieldMix,
  onColumnHeight,
}: OceanVolumeProps) {
  const column = useRef<Group>(null)

  const targetHeight = columnHeight(exaggeration)

  /** Exaggeration at mount — read once, so the effect below has no dependency. */
  const initialHeight = useRef(targetHeight)

  /**
   * The eased height, for the parts of the volume that live outside the scaled
   * group and have to follow it by hand.
   */
  const heightRef = useRef(targetHeight)

  // Start the column at the current exaggeration instead of easing up from
  // zero. The frame loop owns the scale from here on, which is why the group
  // must not take it as a prop: React would write each new value straight to
  // the object and the easing would never run.
  useLayoutEffect(() => {
    column.current?.scale.setY(initialHeight.current)
  }, [])

  useFrame((_, delta) => {
    const group = column.current
    if (group === null) return

    group.scale.y += (targetHeight - group.scale.y) * Math.min(delta * 5, 1)
    heightRef.current = group.scale.y
    onColumnHeight?.(group.scale.y)
  })

  return (
    <group>
      <OceanSurface tint={shallow} animated={animated} opacity={surfaceOpacity(opacity)} />

      <DepthAxis heightRef={heightRef} />

      <group ref={column}>
        {showField ? (
          <>
            <VolumeShell
              shallow={shallow}
              deep={deep}
              opacity={opacity}
              slice={depth}
              animated={animated}
              temperatureField={temperatureField}
              fieldMix={fieldMix}
            />
            <DepthStrata
              shallow={shallow}
              deep={deep}
              opacity={opacity}
              slice={depth}
              temperatureField={temperatureField}
              fieldMix={fieldMix}
            />
          </>
        ) : null}

        <DepthSlice
          tint={shallow}
          fraction={depth}
          opacity={opacity}
          temperatureField={temperatureField}
          fieldMix={fieldMix}
        />

        {showBathymetry ? <Seafloor /> : null}

        <SceneFrame />
      </group>
    </group>
  )
}

/**
 * Step 49 — memoised. Every prop is a primitive, a memoised `Color`, a stable
 * `useCallback`, or the baked-field object (new identity only on a real
 * region/time data change). So an `OceanScene` re-render caused by something
 * this component does not consume — a layer toggle, an observation selection,
 * the camera's at-home flag — no longer reconciles the whole volume subtree
 * (shell, strata, slice, frame, axis). The eased per-frame animation is driven
 * by `useFrame` and is unaffected.
 */
export const OceanVolume = memo(OceanVolumeImpl)
