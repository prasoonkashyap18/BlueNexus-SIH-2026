import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, DoubleSide } from 'three'
import type { WebGLProgramParametersWithUniforms } from 'three'
import { DOMAIN, RENDER_ORDER } from './sceneConfig'

/**
 * Segments across the swell.
 *
 * The wave below tops out around six wavelengths across the domain, so this
 * leaves roughly sixteen vertices per wavelength — smooth at any camera
 * distance the rig allows, and a quarter of the triangles a denser grid would
 * cost for a picture no one can tell apart.
 */
const SURFACE_SEGMENTS = 96

/**
 * Four summed sines. Cheap, seamless in time, and — unlike a noise texture —
 * it needs no asset, which keeps the scene entirely procedural.
 *
 * Amplitudes are small on purpose: the tallest component is 0.06 world units
 * against a 13-unit domain. This is a calm sea read from above, not weather.
 */
const WAVE_GLSL = /* glsl */ `
  uniform float uTime;

  const vec2 SURFACE_HALF = vec2(${(DOMAIN.width / 2).toFixed(4)}, ${(DOMAIN.depth / 2).toFixed(4)});

  varying float vEdgeFade;

  float oceanWave(vec2 p) {
    float w = 0.0;
    w += sin(p.x * 1.60 + uTime * 0.78) * 0.062;
    w += sin(p.y * 2.00 - uTime * 0.57) * 0.050;
    w += sin((p.x + p.y) * 1.15 + uTime * 1.05) * 0.037;
    w += sin((p.x - p.y) * 3.10 - uTime * 0.88) * 0.018;
    return w;
  }

  /**
   * How present the surface is at a point, 1 in the body of the domain and
   * falling off towards the rim.
   *
   * Measured radially, so the corners thin the most — exactly the reasoning
   * behind the volume shell's own corner fade. Without it the sea surface is a
   * hard-edged rectangle sitting on top of a soft-edged body of water, which
   * is the one thing that gives the domain away as a box.
   */
  float surfacePresence(vec2 p) {
    return 1.0 - 0.68 * smoothstep(0.95, 1.45, length(p / SURFACE_HALF));
  }
`

interface OceanSurfaceProps {
  tint: Color
  /** Frozen when the viewer has asked for reduced motion. */
  animated: boolean
  opacity: number
}

/**
 * The sea surface: a plane whose vertices ride a procedural swell.
 *
 * The waves are injected into a `MeshStandardMaterial` with `onBeforeCompile`
 * rather than drawn with a standalone `ShaderMaterial`, so the surface is lit
 * by the scene's real hemisphere and directional lights — the sun streak
 * sliding across the crests is the key light, not a painted-on highlight.
 *
 * Normals are recomputed from the displaced height field, otherwise the mesh
 * would move while shading as if it were still flat.
 *
 * Two things beyond the swell make it read as *the top of the ocean* rather
 * than as a lid:
 *
 * - **A grazing-angle sheen.** Water seen at a shallow angle reflects the sky;
 *   seen from above it does not. A Fresnel term towards a sky tint gives that
 *   for the cost of one dot product, and without an environment map — which
 *   would mean an HDRI to fetch and a cube target to keep.
 * - **A soft rim.** The plane's presence falls off towards the domain
 *   boundary, so the surface dissolves into the geographic frame around it
 *   instead of stopping at four hard edges.
 */
export function OceanSurface({ tint, animated, opacity }: OceanSurfaceProps) {
  const uniforms = useRef({
    uTime: { value: 0 },
    /** Colour the grazing-angle reflection tends towards — the sky. */
    uSheen: { value: new Color('#bfe8f5') },
    uSheenStrength: { value: 0.24 },
  })

  // Stable for the lifetime of the material: three caches the compiled program
  // and only re-runs this when the shader is rebuilt.
  const onBeforeCompile = useMemo(
    () => (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = uniforms.current.uTime
      shader.uniforms.uSheen = uniforms.current.uSheen
      shader.uniforms.uSheenStrength = uniforms.current.uSheenStrength

      shader.vertexShader = WAVE_GLSL + shader.vertexShader

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
          float eps = 0.08;
          float h0 = oceanWave(position.xy);
          float hx = oceanWave(position.xy + vec2(eps, 0.0));
          float hy = oceanWave(position.xy + vec2(0.0, eps));
          vec3 objectNormal = normalize(vec3(-(hx - h0) / eps, -(hy - h0) / eps, 1.0));
        `,
      )

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
          vec3 transformed = vec3(position);
          transformed.z += oceanWave(position.xy);
          vEdgeFade = surfacePresence(position.xy);
        `,
      )

      shader.fragmentShader =
        /* glsl */ `
          uniform vec3 uSheen;
          uniform float uSheenStrength;
          varying float vEdgeFade;
        ` + shader.fragmentShader

      // `geometryNormal` and `geometryViewDir` are set up by
      // <lights_fragment_begin>, which has already run by this point.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
          float sheen = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.5);
          outgoingLight += uSheen * sheen * uSheenStrength;

          #include <opaque_fragment>

          gl_FragColor.a *= vEdgeFade;
        `,
      )
    },
    [],
  )

  useFrame((_, delta) => {
    if (animated) {
      // Clamped: a backgrounded tab resumes with one enormous delta, which
      // would teleport the swell instead of continuing it.
      uniforms.current.uTime.value += Math.min(delta, 0.05)
    }
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={RENDER_ORDER.surface}>
      <planeGeometry
        args={[DOMAIN.width, DOMAIN.depth, SURFACE_SEGMENTS, SURFACE_SEGMENTS]}
      />
      <meshStandardMaterial
        color={tint}
        emissive={tint}
        emissiveIntensity={0.06}
        // Low metalness on purpose. There is no environment map in this scene,
        // and a metal without one has nothing to reflect: at 0.45 the swell
        // went black everywhere the key light did not hit it. The sheen term
        // above supplies the reflection instead, at a fraction of the cost.
        roughness={0.26}
        metalness={0.18}
        side={DoubleSide}
        transparent
        opacity={opacity}
        depthWrite={false}
        onBeforeCompile={onBeforeCompile}
      />
    </mesh>
  )
}
