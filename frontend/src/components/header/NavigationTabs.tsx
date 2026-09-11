import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import {
  WORKSPACE_VIEWS,
  workspaceTabId,
  type WorkspaceView,
} from '../../hooks/useWorkspaceView'
import styles from './NavigationTabs.module.css'

interface NavigationTabsProps {
  activeView: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  /** DOM id of the region these tabs control (the visualization stage). */
  panelId: string
}

/**
 * Workspace mode switcher.
 *
 * Implemented as an ARIA tablist rather than a link nav: there is no routing,
 * the modes swap content inside a single application view. Follows the APG
 * pattern — roving tabindex, arrow / Home / End keys, one selected tab.
 *
 * The active pill is a single absolutely-positioned element that slides
 * between tabs, so switching modes animates instead of snapping. Tabs are
 * equal-width (`flex: 1`) inside a fixed-width list, which lets the pill
 * translate by whole multiples of its own width with no DOM measurement.
 */
export function NavigationTabs({ activeView, onViewChange, panelId }: NavigationTabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = WORKSPACE_VIEWS.findIndex((view) => view.id === activeView)

  const selectAndFocus = (index: number) => {
    const target = WORKSPACE_VIEWS[index]
    onViewChange(target.id)
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${workspaceTabId(target.id)}`)
      ?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const lastIndex = WORKSPACE_VIEWS.length - 1
    let nextIndex: number

    switch (event.key) {
      case 'ArrowRight':
        nextIndex = activeIndex === lastIndex ? 0 : activeIndex + 1
        break
      case 'ArrowLeft':
        nextIndex = activeIndex === 0 ? lastIndex : activeIndex - 1
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = lastIndex
        break
      default:
        return
    }

    event.preventDefault()
    selectAndFocus(nextIndex)
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Workspace views"
      aria-orientation="horizontal"
      className={styles.tabs}
      onKeyDown={handleKeyDown}
    >
      <span
        className={styles.indicator}
        style={{ '--tab-index': activeIndex } as CSSProperties}
        aria-hidden="true"
      />

      {WORKSPACE_VIEWS.map((view) => {
        const selected = view.id === activeView
        return (
          <button
            key={view.id}
            id={workspaceTabId(view.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            title={view.ready ? view.hint : `${view.hint} — arrives in a later step`}
            className={`${styles.tab} ${selected ? styles.tabActive : ''}`}
            onClick={() => onViewChange(view.id)}
          >
            {view.label}
            {view.ready ? null : <span className={styles.pending} aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}
