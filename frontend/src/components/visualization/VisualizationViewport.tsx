import { useElementSize } from '../../hooks/useElementSize'
import type { WorkspaceView } from '../../hooks/useWorkspaceView'
import { VisualizationCanvas } from './VisualizationCanvas'
import { ViewportOverlay } from './ViewportOverlay'
import styles from './VisualizationViewport.module.css'

interface VisualizationViewportProps {
  view: WorkspaceView
}

/**
 * The visualization viewport — the single container responsible for the 3D
 * scene and everything drawn over it.
 *
 *   VisualizationViewport            environment, sizing, layer order
 *     ├── VisualizationCanvas        the renderer's mount host
 *     │     └── <Canvas> → OceanScene
 *     └── ViewportOverlay            HUD readouts, aligned to the centre cell
 *
 * It fills whatever box the shell gives it and clips its own overflow, so the
 * page never gains a scrollbar however the window is resized.
 *
 * Nothing about the shared visualization state passes through this component.
 * The scene and the overlay each subscribe to the store themselves, so there is
 * one copy of every value and no prop chain to keep in step — the placeholder's
 * CSS custom properties are gone along with the placeholder.
 */
export function VisualizationViewport({ view }: VisualizationViewportProps) {
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>()

  return (
    <div className={styles.viewport} data-view={view}>
      <VisualizationCanvas ref={canvasRef} />
      <div className={styles.vignette} aria-hidden="true" />
      <ViewportOverlay view={view} size={canvasSize} />
    </div>
  )
}
