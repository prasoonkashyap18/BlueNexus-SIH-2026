import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  ShaderMaterial,
  type Color,
  type Group,
  type LineBasicMaterial,
} from 'three'
import { DOMAIN, RENDER_ORDER } from './sceneConfig'
import {
  EMPTY_TEMP_DEPTH_FRACTIONS,
  PLACEHOLDER_TEMPERATURE_TEXTURE,
  TEMPERATURE_FIELD_GLSL,
  type TemperatureFieldTexture,
} from './temperatureField'
import { WATER_GLSL, fogUniforms } from './waterGlsl'

/** Rectangle tracing the edge of the slice; `<lineLoop>` closes it. */
function outlineGeometry(): BufferGeometry {
  const x = DOMAIN.width / 2
  const z = DOMAIN.depth / 2

  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute([-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z], 3),
  )
}

/** Reference lines every eighth of the domain — eight cells across each axis. */
const GRID_SPACING = DOMAIN.width / 8

/**
 * Seconds the plane stays emphasised after the depth control moves.
 *
 * Long enough to follow a slider drag from the panel on the other side of the
 * screen, short enough that it is over before the reader's attention comes
 * back — the plane states where it is and then returns to being furniture.
 */
const EMPHASIS_SECONDS = 0.9

const VERTEX = /* glsl */ `
  ${WATER_GLSL}

  #include <fog_pars_vertex>

  varying vec2 vPlan;
  varying vec3 vLocal;

  void main() {
    // A rotated plane: the in-plane axes are local x and y, and the -90 deg X
    // rotation on the mesh turns local +y into world -z.
    vLocal = position;
    vPlan = position.xy / HALF_EXTENT;

    // Named mvPosition because <fog_vertex> reads it by that name.
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    #include <fog_vertex>

    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT = /* glsl */ `
  ${WATER_GLSL}
  ${TEMPERATURE_FIELD_GLSL}

  #include <fog_pars_fragment>

  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uEmphasis;
  /** Depth fraction of the plane itself — every fragment on it shares one. */
  uniform float uSliceDepthT;

  varying vec2 vPlan;
  varying vec3 vLocal;

  /**
   * Anti-aliased line every 'spacing' units along one axis, without leaning on
   * screen-space derivatives — the plane is drawn at every camera angle
   * including edge-on, where a derivative-based width blows up.
   */
  float gridLine(float coord, float spacing, float width) {
    float d = abs(fract(coord / spacing - 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(width * 0.4, width, d);
  }

  void main() {
    // The plane is exactly one depth, so temperature only has to vary across
    // it horizontally — this is a literal horizontal map of the real INCOIS
    // temperature at the selected depth where the field applies, the flat
    // placeholder tint everywhere else (and where the field has no data).
    vec4 field = temperatureFieldColor(vPlan, uSliceDepthT);
    vec3 tint = mix(uTint, field.rgb, uFieldMix * field.a);

    // Soft towards the middle of the domain, so the plane reads as a sheet of
    // water lit from its own depth rather than as a pane of glass.
    //
    // This is the plainest reading the scene gives of the Step 16 field — one
    // depth, coloured by latitude/longitude alone — so it is allowed a denser
    // fill than the placeholder tint's, without changing the horizontal mask
    // that keeps it a soft-edged sheet rather than a flat card.
    float body = mix(0.06, 0.16, uFieldMix) + mix(0.1, 0.22, uFieldMix) * planMask(vPlan, 0.1);

    float grid = max(
      gridLine(vLocal.x, ${GRID_SPACING.toFixed(4)}, 0.02),
      gridLine(vLocal.y, ${GRID_SPACING.toFixed(4)}, 0.02)
    );

    // While the depth control is moving, the plane's own grid comes forward.
    // It is the one mark in the scene that answers "which depth?", so it is
    // the one that should be easiest to find at the moment that changes.
    float alpha = (body * (1.0 + uEmphasis * 0.6) + grid * (0.22 + uEmphasis * 0.3)) * uOpacity;
    if (alpha < 0.002) discard;

    gl_FragColor = vec4(tint + grid * 0.25 + uEmphasis * 0.1, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

interface DepthSliceProps {
  tint: Color
  /** Selected depth as a fraction of the column, 0 at the surface. */
  fraction: number
  /** Normalised 0–1, straight from the opacity control. */
  opacity: number
  /** The real temperature atlas, or `null` while loading / unavailable / other variable. */
  temperatureField: TemperatureFieldTexture | null
  /** 1 shows the real field's colour, 0 the placeholder tint. Eased; 0 when field is null. */
  fieldMix: number
}

/**
 * The horizontal plane marking the selected depth.
 *
 * Real scene geometry rather than a screen-space rule — it has to sit at the
 * right height *inside* the volume and be occluded by the sea floor when the
 * camera drops below it, which is what makes the depth control read as a depth
 * rather than as a number. It is drawn over the water rather than through it
 * (see RENDER_ORDER): a marker that dims as it sinks would be worse at the one
 * job it has.
 *
 * Unlike the water around it this plane keeps hard edges and a reference grid:
 * it is the instrument in the picture, and the contrast against the soft-edged
 * volume is what lets the eye find it at any depth.
 *
 * Its height eases towards the target instead of snapping, so dragging the
 * depth slider sweeps the plane through the column — and while it is moving
 * the plane and its outline brighten, then settle back. That pulse is the
 * scene's answer to a control on the far side of the screen: the reader's eye
 * is drawn to the thing that changed rather than having to hunt for it.
 *
 * For temperature, its fill is also the plainest reading the scene offers of
 * the Step 16 dataset: every fragment on the plane shares one depth, so the
 * only thing left to vary is latitude/longitude, and `temperatureFieldColor`
 * turns that into a literal horizontal temperature map at whatever depth the
 * slider is currently pointed at — which is exactly the "emphasise the
 * selected depth" role this plane already had.
 */
export function DepthSlice({
  tint,
  fraction,
  opacity,
  temperatureField,
  fieldMix,
}: DepthSliceProps) {
  const groupRef = useRef<Group>(null)
  const materialRef = useRef<ShaderMaterial>(null)
  const outlineMaterialRef = useRef<LineBasicMaterial>(null)

  const outline = useMemo(() => outlineGeometry(), [])

  // Built here rather than by R3F, so it has to be given back here too.
  useEffect(() => () => outline.dispose(), [outline])

  const [uniforms] = useState(() => ({
    uTint: { value: tint.clone() },
    uOpacity: { value: opacity },
    uEmphasis: { value: 0 },
    uSliceDepthT: { value: fraction },
    uTemperatureAtlas: { value: temperatureField?.texture ?? PLACEHOLDER_TEMPERATURE_TEXTURE },
    uFieldMix: { value: temperatureField === null ? 0 : fieldMix },
    uTempTileCount: { value: temperatureField?.tileCount ?? 0 },
    uTempDepthFractions: { value: temperatureField?.depthFractions ?? EMPTY_TEMP_DEPTH_FRACTIONS },
    ...fogUniforms(),
  }))

  /** The depth the frame loop last saw, so it can notice the control moving. */
  const shownFraction = useRef(fraction)
  /** Emphasis, 1 at the moment of a change and decaying to 0. */
  const emphasis = useRef(0)

  useFrame((_, delta) => {
    const ease = Math.min(delta * 6, 1)

    // Noticed here rather than in an effect: the pulse belongs to the same
    // clock as the easing it accompanies.
    if (shownFraction.current !== fraction) {
      shownFraction.current = fraction
      emphasis.current = 1
    }
    emphasis.current = Math.max(0, emphasis.current - delta / EMPHASIS_SECONDS)

    const group = groupRef.current
    if (group !== null) {
      group.position.y += (-fraction - group.position.y) * ease
    }

    const material = materialRef.current
    if (material !== null) {
      material.uniforms.uTint.value.lerp(tint, ease)
      material.uniforms.uOpacity.value += (opacity - material.uniforms.uOpacity.value) * ease
      material.uniforms.uEmphasis.value = emphasis.current

      const mixTarget = temperatureField === null ? 0 : fieldMix
      material.uniforms.uFieldMix.value += (mixTarget - material.uniforms.uFieldMix.value) * ease

      material.uniforms.uTemperatureAtlas.value =
        temperatureField?.texture ?? PLACEHOLDER_TEMPERATURE_TEXTURE
      material.uniforms.uTempTileCount.value = temperatureField?.tileCount ?? 0
      material.uniforms.uTempDepthFractions.value =
        temperatureField?.depthFractions ?? EMPTY_TEMP_DEPTH_FRACTIONS

      // Read off the group rather than eased separately: the plane's own
      // depth fraction is exactly `-position.y`, already settling towards
      // `fraction` above, so this is the same easing curve at no extra cost.
      if (group !== null) {
        material.uniforms.uSliceDepthT.value = -group.position.y
      }
    }

    // The outline never fades all the way out with the water: at zero opacity
    // the selected depth is still the one thing the scene has to state.
    const outlineMaterial = outlineMaterialRef.current
    if (outlineMaterial !== null) {
      const target = Math.min(1, 0.45 + 0.45 * opacity + 0.35 * emphasis.current)
      outlineMaterial.opacity += (target - outlineMaterial.opacity) * ease
    }
  })

  return (
    <group ref={groupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RENDER_ORDER.slice}>
        <planeGeometry args={[DOMAIN.width, DOMAIN.depth]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={VERTEX}
          fragmentShader={FRAGMENT}
          side={DoubleSide}
          transparent
          depthWrite={false}
          fog
        />
      </mesh>

      {/* <lineLoop>, not <line>: the latter collides with the SVG intrinsic
          of the same name in React's JSX types. */}
      <lineLoop geometry={outline} renderOrder={RENDER_ORDER.sliceOutline}>
        <lineBasicMaterial
          ref={outlineMaterialRef}
          color={tint}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </lineLoop>
    </group>
  )
}
