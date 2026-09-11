import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, MathUtils, type FogExp2 } from 'three'
import { ATMOSPHERE } from './sceneConfig'

/**
 * The scene's distance haze, and the one effect that changes with where the
 * camera is.
 *
 * Above the water it is atmosphere: it sets the far edge of the geographic
 * frame, keeps the domain from ending on a hard rim, and gives the backdrop
 * the same colour the viewport's CSS gradient is painted in, so the WebGL
 * scene and the page behind it share one horizon.
 *
 * Below the water it is the water. As the eye sinks past the surface the haze
 * thickens and darkens towards the abyss colour, so descending the column
 * looks like a descent rather than a downward translation — the far wall of
 * the domain closes in, the graticule goes, and the reader is left inside the
 * volume rather than beside it. That is the depth cue the brief asks to grow
 * stronger the deeper the view goes, and it is exactly two numbers a frame:
 * no volumetric pass, no post-processing, no second render target.
 *
 * It is eased rather than set, so crossing the surface is a transition and not
 * a cut — including when the camera crosses it during a Reset View flight.
 */
export function SceneAtmosphere() {
  const fogRef = useRef<FogExp2>(null)

  // Scratch, held across frames so the loop allocates nothing.
  const [palette] = useState(() => ({
    surface: new Color(ATMOSPHERE.surfaceColor),
    deep: new Color(ATMOSPHERE.deepColor),
    target: new Color(),
  }))

  useFrame((state, delta) => {
    const fog = fogRef.current
    if (fog === null) return

    // How far under the surface the eye is, 0 above it and 1 well below.
    const submersion = MathUtils.clamp(
      -state.camera.position.y / ATMOSPHERE.submergedRange,
      0,
      1,
    )

    palette.target.copy(palette.surface).lerp(palette.deep, submersion)

    const density = MathUtils.lerp(
      ATMOSPHERE.surfaceDensity,
      ATMOSPHERE.deepDensity,
      submersion,
    )

    const ease = Math.min(delta * ATMOSPHERE.damping, 1)
    fog.density += (density - fog.density) * ease
    fog.color.lerp(palette.target, ease)
  })

  return (
    <fogExp2
      ref={fogRef}
      attach="fog"
      args={[ATMOSPHERE.surfaceColor, ATMOSPHERE.surfaceDensity]}
    />
  )
}
