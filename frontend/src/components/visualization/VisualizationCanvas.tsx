import type { Ref } from 'react'
import { Canvas } from '@react-three/fiber'
import { OceanScene } from './scene/OceanScene'
import styles from './VisualizationCanvas.module.css'

interface VisualizationCanvasProps {
  /** Attached to the mount host so the viewport can measure it. */
  ref?: Ref<HTMLDivElement>
}

/**
 * The renderer's mount host — one plain, fully-sized, positioned box that owns
 * nothing but the scene.
 *
 *   VisualizationViewport
 *     └── VisualizationCanvas          ← this file
 *           └── <Canvas> (R3F)
 *                 └── <OceanScene />
 *
 * The host deliberately carries no padding, border or transform: the WebGL
 * canvas fills it exactly, or the projection and the pointer coordinates
 * disagree.
 *
 * The drawing buffer keeps its alpha channel and the scene sets no background,
 * so the viewport's CSS environment gradient and its drifting caustics stay
 * visible *behind* the geometry. The atmosphere is still painted by CSS; only
 * the ocean itself is WebGL.
 */
export function VisualizationCanvas({ ref }: VisualizationCanvasProps) {
  return (
    <div
      ref={ref}
      id="visualization-canvas-container"
      className={styles.host}
      data-engine="r3f"
    >
      <Canvas
        // Capped at 2: beyond that the win is invisible and the fill cost on a
        // full-window canvas is not.
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <OceanScene />
      </Canvas>
    </div>
  )
}
