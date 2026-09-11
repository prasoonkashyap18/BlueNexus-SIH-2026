import { useEffect, useMemo, useRef, useState } from 'react'
import { BackSide, BoxGeometry, ShaderMaterial, type Color } from 'three'
import { useFrame } from '@react-three/fiber'
import { DOMAIN, RENDER_ORDER } from './sceneConfig'
import {
  EMPTY_TEMP_DEPTH_FRACTIONS,
  PLACEHOLDER_TEMPERATURE_TEXTURE,
  TEMPERATURE_FIELD_GLSL,
  type TemperatureFieldTexture,
} from './temperatureField'
import { WATER_GLSL, fogUniforms } from './waterGlsl'

const VERTEX = /* glsl */ `
  ${WATER_GLSL}

  #include <fog_pars_vertex>

  varying float vDepthT;
  varying vec2 vPlan;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    // The geometry is translated at build time so local y runs from 0 at the
    // surface to -1 at the floor; depth is then read straight off the vertex.
    vDepthT = -position.y;
    vPlan = position.xz / HALF_EXTENT;

    // Named mvPosition because <fog_vertex> reads it by that name.
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;
    vViewNormal = normalize(normalMatrix * normal);

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
  uniform float uTime;

  varying float vDepthT;
  varying vec2 vPlan;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    float t = clamp(vDepthT, 0.0, 1.0);

    // The real INCOIS temperature colour where it applies (uFieldMix towards 1
    // — the temperature variable is selected and its data has loaded), the
    // Step 9 placeholder hue ramp otherwise (uFieldMix at 0, exactly as every
    // other scalar field still renders). The field's own alpha is its
    // interpolation validity, so a region with no data blends back to the base
    // water colour rather than showing an invented temperature. Everything
    // below layers on top of whichever this is.
    vec4 field = temperatureFieldColor(vPlan, t);
    vec3 color = mix(waterColor(uShallow, uDeep, t), field.rgb, uFieldMix * field.a);

    // Daylight through the column. Everything structural below is scaled by
    // it, so the upper ocean carries the detail and the abyss stays quiet —
    // the same falloff that makes a real profile legible.
    float light = photic(t);

    // A broad lift through the photic zone, so the top of the column reads as
    // lit water rather than as the same water drawn brighter.
    color += light * 0.06;

    // A pronounced density step in the upper column, standing in for the
    // seasonal pycnocline, plus a fine stratification ripple below it. Both
    // are closed-form: no field is being claimed here, only the layered
    // structure a real profile would show.
    //
    // The gaussian is squared by hand rather than through pow(), whose base
    // goes negative above the pycnocline — undefined in GLSL.
    float pycnocline = (t - 0.13) / 0.05;
    color += exp(-pycnocline * pycnocline) * 0.06;
    color += smoothstep(0.86, 1.0, abs(sin(t * 46.0 + vPlan.x * 0.35))) * 0.024 * (0.3 + light);

    // A very slow internal drift, so the volume is not perfectly static when
    // the camera is still. Amplitude is deliberately near the noise floor.
    color += sin(t * 9.0 - uTime * 0.25 + vPlan.y * 1.5) * 0.008;

    // The selected depth glows through the water itself, so the slice stays
    // legible from outside the column as well as inside it. For temperature,
    // the glow brightens the water's own true colour at this depth rather
    // than tinting it towards a fixed hue — so dragging the depth control
    // reads as "here is what the dataset says at the depth you picked", in
    // the dataset's own colour, not a generic highlight.
    float slice = 1.0 - smoothstep(0.0, 0.05, abs(t - uSlice));
    vec3 sliceGlow = mix(uShallow + 0.1, color * 1.6, uFieldMix);
    color = mix(color, sliceGlow, slice * 0.35);

    // Grazing faces pick up more light: the walls read as water thickness
    // rather than as flat panes. Brightest near the surface, where the light
    // that would scatter towards the eye actually is.
    float rim = 1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPosition)));
    color += pow(rim, 3.0) * (0.09 + 0.13 * light);

    // --- Opacity ------------------------------------------------------
    // Thickest just below the surface and thinning with depth, so the column
    // dissolves into the haze instead of ending at a visible wall.
    float body = 0.30 + 0.38 * exp(-t * 2.2);

    // The Step 16 field carries real information the placeholder ramp does
    // not, so it is allowed to read stronger through the same translucency —
    // a multiplier on the existing depth falloff, not a new one, so the body
    // still thins with depth exactly as before, just from a higher start.
    // Hue itself (the colour mix above) is untouched, so this only closes the
    // gap between how saturated the ramp's colours are and how little of them
    // was actually reaching the eye through the water's transparency.
    body *= mix(1.0, 1.45, uFieldMix);

    // The four vertical seams are what make a box read as a solid block, so
    // they are damped: the silhouette softens at the corners without the
    // geometry having to change. Damped rather than erased — the walls are
    // also the column's only boundary, and with them fully faded the volume
    // stopped reading as a body of water with sides at all.
    vec2 plan = abs(vPlan);
    float cornerFade = 1.0 - 0.55 * smoothstep(0.5, 1.0, min(plan.x, plan.y));

    // Kill the lid — the sea surface is the top of the ocean, not this face —
    // and dissolve the deepest water into darkness.
    float capFade = smoothstep(0.0, 0.006, t) * (1.0 - smoothstep(0.86, 1.0, t) * 0.55);

    // The selected depth's extra coverage counts for more while temperature
    // is showing too, so the highlighted band above is not just brighter but
    // solid enough to actually read from outside the column.
    float alpha = uOpacity * (body + slice * mix(0.22, 0.4, uFieldMix)) * cornerFade * capFade;
    if (alpha < 0.002) discard;

    gl_FragColor = vec4(color, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

interface VolumeShellProps {
  shallow: Color
  deep: Color
  /** Normalised 0–1, straight from the opacity control. */
  opacity: number
  /** Selected depth as a fraction of the column. */
  slice: number
  /** Frozen when the viewer has asked for reduced motion. */
  animated: boolean
  /** The real temperature atlas, baked for the active region and time — or
   *  `null` while it is loading, unavailable, or a different variable is shown. */
  temperatureField: TemperatureFieldTexture | null
  /** 1 shows the real field's colour, 0 the placeholder hue ramp. Eased, and
   *  forced to 0 whenever `temperatureField` is `null`. */
  fieldMix: number
}

/**
 * The enclosing body of seawater.
 *
 * Drawn as the *inside* of the domain box (`BackSide`, no depth write), which
 * is the cheapest honest way to read as a volume: the viewer always sees the
 * far walls through the near ones, so the water has thickness from every angle
 * and never flattens into a card.
 *
 * The box is only the container. What stops it from looking like one is in the
 * fragment shader — the corner seams and both caps fade out, so the silhouette
 * is a soft-edged mass of water rather than a rectangular solid. Paired with
 * `DepthStrata`, which fills the interior, that is the whole volume.
 *
 * Depth is communicated three ways at once and they reinforce each other: the
 * colour ramps towards the abyss, the daylight term (`photic`) dims every
 * structural detail with depth, and the body thins so the bottom of the column
 * dissolves into the scene's haze. The shader also opts the material into the
 * scene fog, which is what ties the water to the atmosphere the rest of the
 * scene is drawn in — see `waterGlsl.ts`.
 *
 * `waterColor(uShallow, uDeep, t)` is still what every other scalar field
 * renders as, but for temperature `uFieldMix` (eased, like everything else
 * here) crossfades the base colour to `temperatureFieldColor()` — the Step 16
 * dataset, baked per region and time into `temperatureField`'s atlas texture
 * — so the walls of the column show the real field's structure and the
 * photic lift, pycnocline bump, drift and rim light above continue to layer
 * over whichever base is showing. The geometry, the depth parameterisation
 * and every other control stay exactly as they were.
 */
export function VolumeShell({
  shallow,
  deep,
  opacity,
  slice,
  animated,
  temperatureField,
  fieldMix,
}: VolumeShellProps) {
  const materialRef = useRef<ShaderMaterial>(null)

  // Translated so local y spans [-1, 0] — the same unit column every other
  // component is authored in, which lets the shader read depth off `position`
  // without needing the model matrix.
  const geometry = useMemo(
    () => new BoxGeometry(DOMAIN.width, 1, DOMAIN.depth).translate(0, -0.5, 0),
    [],
  )

  // Built here rather than by R3F, so it has to be given back here too.
  useEffect(() => () => geometry.dispose(), [geometry])

  // Seeded from the state as it stands at mount, so the column appears at the
  // right colour and opacity instead of easing in from an arbitrary default.
  const [uniforms] = useState(() => ({
    uShallow: { value: shallow.clone() },
    uDeep: { value: deep.clone() },
    uOpacity: { value: opacity },
    uSlice: { value: slice },
    uTime: { value: 0 },
    uTemperatureAtlas: { value: temperatureField?.texture ?? PLACEHOLDER_TEMPERATURE_TEXTURE },
    uFieldMix: { value: temperatureField === null ? 0 : fieldMix },
    uTempTileCount: { value: temperatureField?.tileCount ?? 0 },
    uTempDepthFractions: { value: temperatureField?.depthFractions ?? EMPTY_TEMP_DEPTH_FRACTIONS },
    ...fogUniforms(),
  }))

  // Uniforms are pushed in the frame loop rather than through props: colour and
  // depth changes then reach the GPU without rebuilding the material, and the
  // slice can ease towards its target instead of jumping.
  useFrame((_, delta) => {
    const material = materialRef.current
    if (material === null) return

    const ease = Math.min(delta * 6, 1)

    material.uniforms.uShallow.value.lerp(shallow, ease)
    material.uniforms.uDeep.value.lerp(deep, ease)
    material.uniforms.uOpacity.value += (opacity - material.uniforms.uOpacity.value) * ease
    material.uniforms.uSlice.value += (slice - material.uniforms.uSlice.value) * ease

    // No real field yet -> ease the mix to 0 so the water shows its procedural
    // colour, never a stale or placeholder atlas read as temperature.
    const mixTarget = temperatureField === null ? 0 : fieldMix
    material.uniforms.uFieldMix.value += (mixTarget - material.uniforms.uFieldMix.value) * ease

    // A plain reference swap, not eased: a new texture (a region or time
    // change) is a cut, not a gradual reveal.
    material.uniforms.uTemperatureAtlas.value =
      temperatureField?.texture ?? PLACEHOLDER_TEMPERATURE_TEXTURE
    material.uniforms.uTempTileCount.value = temperatureField?.tileCount ?? 0
    material.uniforms.uTempDepthFractions.value =
      temperatureField?.depthFractions ?? EMPTY_TEMP_DEPTH_FRACTIONS

    if (animated) {
      // Clamped: a backgrounded tab resumes with one enormous delta, which
      // would jump the drift instead of continuing it.
      material.uniforms.uTime.value += Math.min(delta, 0.05)
    }
  })

  return (
    <mesh geometry={geometry} renderOrder={RENDER_ORDER.volume}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        side={BackSide}
        transparent
        depthWrite={false}
        fog
      />
    </mesh>
  )
}
