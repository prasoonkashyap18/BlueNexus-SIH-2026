import { useState } from 'react'

/** The three top-level workspace modes offered by the header navigation. */
export type WorkspaceView = 'explore' | 'compare' | 'profiles'

export interface WorkspaceViewMeta {
  id: WorkspaceView
  label: string
  /** Short description — used for tooltips and assistive descriptions. */
  hint: string
  /**
   * Whether the mode is fully implemented yet. Step 7 ships navigation only:
   * `compare` and `profiles` render a placeholder state until their own
   * roadmap steps land.
   */
  ready: boolean
}

export const WORKSPACE_VIEWS: readonly WorkspaceViewMeta[] = [
  {
    id: 'explore',
    label: 'Explore',
    hint: 'Navigate the ocean volume and inspect model fields',
    ready: true,
  },
  {
    id: 'compare',
    label: 'Compare',
    hint: 'Numerical model output against in-situ observations',
    ready: false,
  },
  {
    id: 'profiles',
    label: 'Profiles',
    hint: 'Depth profiles from Argo floats and gliders',
    ready: false,
  },
]

export const DEFAULT_WORKSPACE_VIEW: WorkspaceView = 'explore'

/** Stable DOM id for a view's tab button, shared by the tablist and its panel. */
export function workspaceTabId(view: WorkspaceView): string {
  return `workspace-tab-${view}`
}

/**
 * Owns the active workspace mode.
 *
 * Kept as a hook (rather than local state inside the header) because the mode
 * drives more than the navigation itself — the visualization stage already
 * reads it, and the compare / profile workspaces will read it in later steps.
 * Swapping this for a router or a context provider later touches one file.
 */
export function useWorkspaceView(initialView: WorkspaceView = DEFAULT_WORKSPACE_VIEW) {
  const [activeView, setActiveView] = useState<WorkspaceView>(initialView)

  return { activeView, setActiveView }
}
