import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  NormalBlending,
  ShaderMaterial,
  type Color,
} from 'three'
import { useFrame } from '@react-three/fiber'
import { DOMAIN, RENDER_ORDER, STRATA_COUNT, strataFraction } from './sceneConfig'
import {
  EMPTY_TEMP_DEPTH_FRACTIONS,
  PLACEHOLDER_TEMPERATURE_TEXTURE,
  TEMPERATURE_FIELD_GLSL,
  type TemperatureFieldTexture,
} from './temperatureField'
import { WATER_GLSL, fogUniforms } from './waterGlsl'

/**
 * One horizontal quad per layer, merged into a single buffer.
 *
 * A merged buffer rather than N meshes because these are the scene's most
 * numerous objects and they never move relative to each other: one draw call
 * of sixty-four vertices costs nothing, sixteen draw calls of four cost
 * sixteen state changes a frame for the same picture.
 *
 * Each vertex carries its own depth fraction, so the shader can shade a layer
 * without knowing which layer it is.
 */
function strataGeometry(count: number): BufferGeometry {
  const x = DOMAIN.width / 2
  const z = DOMAIN.depth / 2

  const positions: number[] = []
  const depths: number[] = []
  const indices: number[] = []

  for (let layer = 0; layer < count; layer += 1) {
    const y = -strataFraction(layer, count)
    const base = layer * 4

    positions.push(-x, y, -z, x, y, -z, x, y, z, -x, y, z)
    depths.push(-y, -y, -y, -y)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aDepth', new Float32BufferAttribute(depths, 1))
  geometry.setIndex(indices)

  return geometry
}

const VERTEX = /* glsl */ `
  ${WATER_GLSL}

  #include <fog_pars_vertex>

  attribute float aDepth;

  varying float vDepthT;
  varying vec2 vPlan;

  void main() {
    vDepthT = aDepth;
    vPlan = position.xz / HALF_EXTENT;

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

  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uOpacity;
  uniform float uSlice;

  varying float vDepthT;
  varying vec2 vPlan;

  void main() {
    // Same base-colour choice as the shell: the real INCOIS temperature field
    // where uFieldMix says so, the placeholder ramp everywhere else. The
    // field's alpha is its validity, so no-data regions keep the base colour.
    vec4 field = temperatureFieldColor(vPlan, vDepthT);
    vec3 color = mix(
      waterColor(uShallow, uDeep, vDepthT),
      field.rgb,
      uFieldMix * field.a
    );

    // Each layer is an irregular soft-edged patch rather than a full-domain
    // rectangle. This is what stops the stack from reading as a stack of
    // cards, and with the shell's faded corners it is why the volume has no
    // visible box around it.
    float wobble = 0.07 * sin(vPlan.x * 3.1 + vDepthT * 21.0)
                        * cos(vPlan.y * 2.7 - vDepthT * 17.0);
    float mask = planMask(vPlan, 0.52 + wobble);
    if (mask <= 0.0) discard;

    // Layers thin out with depth: the upper ocean carries the structure, the
    // abyss is meant to read as uniform dark water. The floor of 0.26 is what
    // keeps the deep layers present enough to still read as a stack.
    float fade = 0.26 + 0.74 * photic(vDepthT);

    // Layers near the selected depth brighten, which gives the depth control
    // an effect inside the volume and not only on the slice plane.
    float near = 1.0 - smoothstep(0.0, 0.09, abs(vDepthT - uSlice));

    // Each layer is individually near-invisible by design — the stack reads
    // through sixteen of them overlapping, not through any one being strong.
    // For the Step 16 field that adds up to too faint a result, so its base
    // density is raised well above the placeholder ramp's; the depth fade and
    // per-layer mask above are unchanged, so the stack still thins with depth
    // and keeps its soft, layered edges.
    float density = mix(0.085, 0.2, uFieldMix);

    // The selected depth's own layers stand out more while temperature is
    // showing, on top of the density lift above — the depth control's effect
    // inside the stack should be as legible as it is on the slice plane.
    float nearWeight = mix(0.055, 0.12, uFieldMix);
    float nearGlow = mix(0.07, 0.16, uFieldMix);

    float alpha = uOpacity * mask * (density * fade + near * nearWeight);
    if (alpha < 0.002) discard;

    gl_FragColor = vec4(color + near * nearGlow, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

interface DepthStrataProps {
  shallow: Color
  deep: Color
  /** Normalised 0–1, straight from the opacity control. */
  opacity: number
  /** Selected depth as a fraction of the column. */
  slice: number
  /** The real temperature atlas, or `null` while loading / unavailable / other variable. */
  temperatureField: TemperatureFieldTexture | null
  /** 1 shows the real field's colour, 0 the placeholder hue ramp. Eased; 0 when field is null. */
  fieldMix: number
}

/**
 * Stratification layers suspended through the water column.
 *
 * These carry the scene's sense of depth. Sixteen faint, soft-edged sheets at
 * power-law spacing accumulate into something that reads as a body of water
 * seen from outside: the near layers veil the far ones, the stack thickens
 * where the layers bunch up near the surface, and rotating the camera changes
 * how many are seen edge-on — all cues a single translucent box cannot give.
 *
 * They share the shell's daylight falloff, so the layered structure is bright
 * in the photic zone and settles into flat dark water below it, and they take
 * the scene fog, so the far side of the stack recedes into the same haze
 * everything else does.
 *
 * Deliberately not particles. A field of motes would read as debris or as
 * decoration; horizontal layers read as an oceanographic section, which is
 * what the depth axis of this scene actually is.
 */
export function DepthStrata({
  shallow,
  deep,
  opacity,
  slice,
  temperatureField,
  fieldMix,
}: DepthStrataProps) {
  const materialRef = useRef<ShaderMaterial>(null)
  const geometry = useMemo(() => strataGeometry(STRATA_COUNT), [])

  // Built here rather than by R3F, so it has to be given back here too.
  useEffect(() => () => geometry.dispose(), [geometry])

  const [uniforms] = useState(() => ({
    uShallow: { value: shallow.clone() },
    uDeep: { value: deep.clone() },
    uOpacity: { value: opacity },
    uSlice: { value: slice },
    uTemperatureAtlas: { value: temperatureField?.texture ?? PLACEHOLDER_TEMPERATURE_TEXTURE },
    uFieldMix: { value: temperatureField === null ? 0 : fieldMix },
    uTempTileCount: { value: temperatureField?.tileCount ?? 0 },
    uTempDepthFractions: { value: temperatureField?.depthFractions ?? EMPTY_TEMP_DEPTH_FRACTIONS },
    ...fogUniforms(),
  }))

  // Eased on the GPU side for the same reason as the shell: the two share a
  // colour ramp, so they have to arrive at a new variable's palette together
  // or the layers would visibly lead the water they sit in.
  useFrame((_, delta) => {
    const material = materialRef.current
    if (material === null) return

    const ease = Math.min(delta * 6, 1)

    material.uniforms.uShallow.value.lerp(shallow, ease)
    material.uniforms.uDeep.value.lerp(deep, ease)
    material.uniforms.uOpacity.value += (opacity - material.uniforms.uOpacity.value) * ease
    material.uniforms.uSlice.value += (slice - material.uniforms.uSlice.value) * ease

    const mixTarget = temperatureField === null ? 0 : fieldMix
    material.uniforms.uFieldMix.value += (mixTarget - material.uniforms.uFieldMix.value) * ease

    material.uniforms.uTemperatureAtlas.value =
      temperatureField?.texture ?? PLACEHOLDER_TEMPERATURE_TEXTURE
    material.uniforms.uTempTileCount.value = temperatureField?.tileCount ?? 0
    material.uniforms.uTempDepthFractions.value =
      temperatureField?.depthFractions ?? EMPTY_TEMP_DEPTH_FRACTIONS
  })

  return (
    <mesh geometry={geometry} renderOrder={RENDER_ORDER.strata}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        side={DoubleSide}
        blending={NormalBlending}
        transparent
        depthWrite={false}
        fog
      />
    </mesh>
  )
}
