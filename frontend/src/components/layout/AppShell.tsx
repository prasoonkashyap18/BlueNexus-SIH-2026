import { useState } from 'react'
import { AppHeader } from '../header/AppHeader'
import { ControlPanel } from '../controls/ControlPanel'
import { LocationBar } from '../location/LocationBar'
import { VisualizationViewport } from '../visualization/VisualizationViewport'
import { ObservationPanel } from '../observation/ObservationPanel'
import { TimelineBar } from '../timeline/TimelineBar'
import { useObservationState } from '../../state/observationState'
import { useWorkspaceView, workspaceTabId } from '../../hooks/useWorkspaceView'
import styles from './AppShell.module.css'

/** Region the header's workspace tabs control. */
const STAGE_ID = 'workspace-stage'

const CONTROLS_DOCK_ID = 'controls-dock'
const OBSERVATION_DOCK_ID = 'observation-dock'

/** Which side panel is open as an overlay drawer (drawer mode only, < --bp-drawer). */
type OpenDock = 'controls' | 'observation' | null

/**
 * Full-screen application shell.
 *
 * Layer 0: the visualization viewport fills the entire window (the hero).
 * Layer 1: a non-interactive grid overlay holds the floating glass panels,
 *          so the ocean reads through and around the UI rather than behind
 *          an opaque dashboard.
 *
 * The location bar floats at the top of the centre cell rather than docking
 * into a panel: it chooses *where* the platform is looking, and every panel
 * around it describes what is being drawn there.
 *
 * The shell owns the active workspace view because it sits above both the
 * header (which switches it) and the viewport (which reflects it).
 *
 * ### Responsive behaviour
 *
 * On desktop (wider than `--bp-drawer`, 1180px) the three docked regions —
 * Controls | 3D Ocean | Observation — sit side by side exactly as before.
 * Narrower than that the CSS grid collapses to one column and the two side
 * panels become slide-in overlay drawers over the still-full-bleed scene,
 * toggled by the two edge buttons below. `openDock` is plain UI state, not a
 * viewport query — the drawer styling itself is entirely media-query driven,
 * so on desktop this state has no visual effect. Selecting an observation
 * opens the Observation drawer so a marker tap on a small screen is not
 * silently dropped.
 */
export function AppShell() {
  const { activeView, setActiveView } = useWorkspaceView()
  const { selectedPlatformId } = useObservationState()
  const [openDock, setOpenDock] = useState<OpenDock>(null)

  const toggleDock = (dock: 'controls' | 'observation') =>
    setOpenDock((current) => (current === dock ? null : dock))

  // A marker selection (Step 30) surfaces the Observation panel — on desktop it
  // is always visible so this is inert; in drawer mode it slides the panel in
  // so a marker tap on a small screen has a visible result. Tracked as a
  // previous-value comparison during render (not an effect): the drawer must
  // still be closable afterwards, so it cannot simply be derived.
  const [seenSelection, setSeenSelection] = useState(selectedPlatformId)
  if (selectedPlatformId !== seenSelection) {
    setSeenSelection(selectedPlatformId)
    if (selectedPlatformId !== null) setOpenDock('observation')
  }

  return (
    <div className={styles.shell}>
      <div
        className={styles.stageLayer}
        id={STAGE_ID}
        role="tabpanel"
        aria-labelledby={workspaceTabId(activeView)}
        tabIndex={0}
      >
        <VisualizationViewport view={activeView} />
      </div>

      <div className={`${styles.overlay} ov-app-grid`} data-dock-open={openDock ?? 'none'}>
        <header className={styles.header}>
          <AppHeader
            activeView={activeView}
            onViewChange={setActiveView}
            stageId={STAGE_ID}
          />
        </header>

        <div className={styles.locate}>
          <LocationBar />
        </div>

        {/* Dismisses an open drawer; only rendered / visible in drawer mode. */}
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close panel"
          tabIndex={openDock === null ? -1 : 0}
          onClick={() => setOpenDock(null)}
        />

        <aside
          id={CONTROLS_DOCK_ID}
          className={`${styles.dock} ${styles.left}`}
          data-open={openDock === 'controls'}
        >
          <ControlPanel />
        </aside>

        <aside
          id={OBSERVATION_DOCK_ID}
          className={`${styles.dock} ${styles.right}`}
          data-open={openDock === 'observation'}
        >
          <ObservationPanel />
        </aside>

        {/* Edge toggles — hidden by CSS on desktop, shown only in drawer mode. */}
        <div className={styles.dockToggles} role="group" aria-label="Panels">
          <button
            type="button"
            className={styles.dockToggle}
            aria-expanded={openDock === 'controls'}
            aria-controls={CONTROLS_DOCK_ID}
            onClick={() => toggleDock('controls')}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
              <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
              <circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
            </svg>
            Controls
          </button>
          <button
            type="button"
            className={styles.dockToggle}
            aria-expanded={openDock === 'observation'}
            aria-controls={OBSERVATION_DOCK_ID}
            onClick={() => toggleDock('observation')}
          >
            Observation
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.4" />
              <path d="M12 3.6v16.8M3.6 12h16.8" />
            </svg>
          </button>
        </div>

        <footer className={styles.timeline}>
          <TimelineBar />
        </footer>
      </div>
    </div>
  )
}
