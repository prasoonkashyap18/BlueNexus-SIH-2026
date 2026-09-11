import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

/**
 * Text drawn into the 3D scene, as canvas textures.
 *
 * The scene needs a handful of short, static strings — a depth ladder and a
 * compass letter — and nothing else. That is far below the point where a text
 * mesher earns its keep: `troika-three-text` (what drei's `<Text>` uses) means
 * an SDF pipeline, a worker and a font file to fetch at runtime, none of which
 * this scene would exercise.
 *
 * A 2D canvas has the same typeface the rest of the interface is set in, needs
 * no network at all, and produces one small texture per string. The cost is
 * that the labels are bitmaps: they are sized so that the plate is comfortably
 * larger than the type on screen at the camera distances the rig allows, and
 * they carry mipmaps so they stay clean when the view pulls back.
 */

/** Typeface, matching `--font-sans` in the stylesheet. */
const FONT_STACK = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export interface LabelOptions {
  /** Canvas size in pixels. Keep the aspect equal to the plate's. */
  width: number
  height: number
  /** Type size in canvas pixels. */
  fontSize: number
  /** Fill colour. */
  color: string
  /** Where the text sits in the plate. */
  align: 'left' | 'centre'
  /**
   * A short rule drawn at the left edge, aligned with the text's baseline
   * centre — the tick of a depth mark. Zero for no rule.
   */
  rule: number
}

const DEFAULTS: LabelOptions = {
  width: 384,
  height: 96,
  fontSize: 56,
  color: '#d9f2f7',
  align: 'left',
  rule: 0,
}

/**
 * Renders one string to a texture.
 *
 * The caller owns the result and must dispose it: these are created per label
 * and never shared, because a texture carries its own GPU upload.
 */
export function labelTexture(text: string, options: Partial<LabelOptions> = {}): CanvasTexture {
  const { width, height, fontSize, color, align, rule } = { ...DEFAULTS, ...options }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (context !== null) {
    context.font = `600 ${fontSize}px ${FONT_STACK}`
    context.textBaseline = 'middle'
    context.fillStyle = color

    // The water behind a label ranges from near-black to a lit surface, so the
    // type carries its own shadow rather than a plate: a plate would be a
    // rectangle floating in the scene, which is exactly the kind of clutter
    // the axis is trying not to be.
    context.shadowColor = 'rgba(3, 16, 26, 0.9)'
    context.shadowBlur = 10
    context.shadowOffsetY = 1

    if (rule > 0) {
      context.fillRect(0, height / 2 - 2, rule, 3)
    }

    if (align === 'centre') {
      context.textAlign = 'center'
      context.fillText(text, width / 2, height / 2)
    } else {
      context.textAlign = 'left'
      context.fillText(text, rule + fontSize * 0.28, height / 2)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  // Mipmapped down, sharp up: the labels are read close to their authored size
  // at the default framing and shrink from there.
  texture.magFilter = LinearFilter

  return texture
}
