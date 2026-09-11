import { Color } from 'three'
import { DOMAIN } from './sceneConfig'

/**
 * The uniforms three.js writes the scene's fog into.
 *
 * `WebGLRenderer` refreshes `fogColor` and `fogDensity` on every material that
 * has `fog === true`, and it does so by assignment — the entries have to exist
 * or the refresh throws. A `ShaderMaterial` builds its own uniform object, so
 * each water material spreads this into it.
 *
 * A fresh object per call: uniform objects are per material, and sharing one
 * would silently couple two materials' state.
 */
export function fogUniforms() {
  return {
    fogColor: { value: new Color() },
    fogDensity: { value: 0 },
  }
}

/**
 * GLSL shared by every surface that draws seawater, so the volume shell, the
 * stratification layers and the depth slice all agree on what water at a given
 * depth looks like. Keeping one copy is what stops the column from banding
 * where two materials meet.
 *
 * Concatenated into each shader ahead of `main()` — there is no module system
 * in GLSL, and a `#include` would need a three.js shader-chunk registration
 * for what is a handful of lines.
 *
 * ### Working with three.js's own chunks
 *
 * The water materials are plain `ShaderMaterial`s, which three.js leaves out
 * of the fog and tone-mapping paths unless they opt in. They all opt in, so
 * that the water responds to the scene's atmosphere and sits on the same
 * response curve as the lit surface and sea floor:
 *
 * - the vertex shader names its view-space position `mvPosition` and includes
 *   `<fog_pars_vertex>` / `<fog_vertex>`;
 * - the fragment shader includes `<fog_pars_fragment>`, and finishes with
 *   `<tonemapping_fragment>`, `<colorspace_fragment>`, `<fog_fragment>` in
 *   that order — the order three's own materials use;
 * - the material carries `fog` and the uniforms from `fogUniforms()`, which the
 *   renderer writes the scene's fog into every frame.
 */
export const WATER_GLSL = /* glsl */ `
  /** Half the horizontal extent of the domain, in the same units as position. */
  const vec2 HALF_EXTENT = vec2(${(DOMAIN.width / 2).toFixed(4)}, ${(DOMAIN.depth / 2).toFixed(4)});

  /**
   * Colour of the water column at depth fraction t (0 surface, 1 floor).
   *
   * Exponential rather than linear: light is extinguished fastest in the first
   * few hundred metres, so a linear ramp leaves the upper ocean looking far too
   * bright and the abyss too varied.
   */
  vec3 waterColor(vec3 shallow, vec3 deep, float t) {
    return mix(shallow, deep, 1.0 - exp(-t * 2.7));
  }

  /**
   * Daylight reaching depth fraction t, normalised to 1 at the surface.
   *
   * The same Beer-Lambert falloff the colour ramp uses, but steeper and kept
   * separate: the ramp says what colour the water *is*, this says how much of
   * it the reader can see. Multiplying brightness by it is what gives the
   * column a lit photic zone over a dark interior instead of a flat wash, and
   * it is the single strongest depth cue in the volume.
   */
  float photic(float t) {
    return exp(-t * 3.1);
  }

  /**
   * Soft elliptical mask over horizontal coordinates normalised to [-1, 1].
   * Returns 1 in the middle of the domain and falls to 0 before the domain
   * boundary, which is what keeps a horizontal layer from reading as a
   * rectangle with cut edges.
   */
  float planMask(vec2 plan, float inner) {
    return 1.0 - smoothstep(inner, 1.0, length(plan));
  }
`
