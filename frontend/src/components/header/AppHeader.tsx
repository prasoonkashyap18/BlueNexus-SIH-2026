import { useState, type ReactNode } from 'react'
import { useHealthCheck } from '../../hooks/useHealthCheck'
import type { WorkspaceView } from '../../hooks/useWorkspaceView'
import { ConnectionStatus } from './ConnectionStatus'
import { NavigationTabs } from './NavigationTabs'
import styles from './AppHeader.module.css'

interface AppHeaderProps {
  activeView: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  /** DOM id of the region the workspace tabs control. */
  stageId: string
}

/**
 * Application header: brand, workspace navigation, connectivity and the
 * utility toggles.
 *
 * The header owns no workspace state — the active view is passed in — so the
 * later compare / profile workspaces and the 3D scene can react to the same
 * value without routing it through this component.
 */
export function AppHeader({ activeView, onViewChange, stageId }: AppHeaderProps) {
  const { status, detail } = useHealthCheck()

  /*
   * Both toggles are presentation-only for Step 7. The layer manager and the
   * appearance system arrive in later steps and will lift this state out.
   */
  const [layersOpen, setLayersOpen] = useState(false)
  const [ambientLight, setAmbientLight] = useState(false)

  return (
    <div className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          <svg viewBox="0 0 32 32" width="20" height="20">
            <path
              d="M2 19c4 0 4-6 8-6s4 6 8 6 4-6 8-6 4 6 8 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M2 25c4 0 4-4 8-4s4 4 8 4 4-4 8-4 4 4 8 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.45"
            />
            <circle cx="16" cy="8" r="2.4" fill="currentColor" />
          </svg>
        </span>
        <span className={styles.wordmark}>
          <strong>INCOIS</strong>
          <span>Ocean Visualization</span>
        </span>
        <span className={styles.tag}>Numerical Model&nbsp;&times;&nbsp;In-situ Observations</span>
      </div>

      <NavigationTabs
        activeView={activeView}
        onViewChange={onViewChange}
        panelId={stageId}
      />

      <div className={styles.status}>
        <ConnectionStatus status={status} detail={detail} />
        <span className={styles.divider} aria-hidden="true" />

        <HeaderToggle
          label="Layers"
          hint="Layer manager arrives in a later step"
          pressed={layersOpen}
          onToggle={() => setLayersOpen((open) => !open)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3 3 8l9 5 9-5-9-5Z" />
            <path d="m3 13 9 5 9-5" />
          </svg>
        </HeaderToggle>

        <HeaderToggle
          label="Appearance"
          hint="Appearance settings arrive in a later step"
          pressed={ambientLight}
          onToggle={() => setAmbientLight((on) => !on)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3.4" />
            <path d="M12 2.6v2.6M12 18.8v2.6M4.6 4.6l1.9 1.9M17.5 17.5l1.9 1.9M2.6 12h2.6M18.8 12h2.6M4.6 19.4l1.9-1.9M17.5 6.5l1.9-1.9" />
          </svg>
        </HeaderToggle>
      </div>
    </div>
  )
}

interface HeaderToggleProps {
  label: string
  hint: string
  pressed: boolean
  onToggle: () => void
  children: ReactNode
}

/** Icon button with a pressed state — the shared shape for header utilities. */
function HeaderToggle({ label, hint, pressed, onToggle, children }: HeaderToggleProps) {
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${pressed ? styles.iconBtnOn : ''}`}
      aria-pressed={pressed}
      aria-label={label}
      title={`${label} — ${hint}`}
      onClick={onToggle}
    >
      {children}
    </button>
  )
}
