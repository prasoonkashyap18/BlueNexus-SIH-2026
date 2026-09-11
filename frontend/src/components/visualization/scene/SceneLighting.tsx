import { LIGHTING } from './sceneConfig'

/**
 * The scene's lighting rig.
 *
 * Three lights, no shadow maps, no image-based lighting. Only two objects in
 * the scene are lit at all — the sea surface and the sea floor — and both are
 * broad, smooth and seen from above, so what they need is a legible gradient
 * rather than a modelled sun.
 *
 * ### Why a hemisphere rather than an ambient
 *
 * A flat ambient adds the same colour to every face, which is precisely the
 * thing that makes a 3D scene read as a flat one: the trough of a swell and
 * its crest come back the same value, and the seamount stops standing off the
 * abyssal plain. A hemisphere costs the same — one shader term, no shadow
 * pass — and instead ramps between sky above and dark water below along the
 * surface normal. That single change is what gives the swell its shape and the
 * bathymetry its relief, and it is doing more work here than the key light.
 *
 * ### Why the key is not brighter
 *
 * This is an instrument, not a render. The key exists to put one consistent
 * light direction on the water so the crests read and the sea floor has a lit
 * side; past that, more intensity only blows the surface out and starts
 * competing with the depth ramp inside the volume, which is the thing the
 * reader is actually meant to be measuring.
 *
 * The rig is a component rather than lights inline in the scene so that the
 * view file stays about wiring, and so a second viewport — the comparison
 * workspace, later — lights its ocean identically by mounting the same
 * element rather than by copying four numbers.
 */
export function SceneLighting() {
  return (
    <>
      {/* Sky above, deep water below: the scene's environment term. */}
      <hemisphereLight
        args={[LIGHTING.skyColor, LIGHTING.waterColor, LIGHTING.hemisphereIntensity]}
      />

      {/* The sun. */}
      <directionalLight
        position={[...LIGHTING.keyPosition]}
        intensity={LIGHTING.keyIntensity}
        color={LIGHTING.keyColor}
      />

      {/* Cold bounce, so nothing facing away from the sun falls to black. */}
      <directionalLight
        position={[...LIGHTING.fillPosition]}
        intensity={LIGHTING.fillIntensity}
        color={LIGHTING.fillColor}
      />
    </>
  )
}
