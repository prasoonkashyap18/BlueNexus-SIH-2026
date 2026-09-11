import { createContext, useContext } from 'react'

/* ------------------------------------------------------------------ *
 * Domain
 * ------------------------------------------------------------------ */

/** In-situ platform families the observation panel can inspect. */
export type PlatformType = 'argo' | 'glider'

export interface PlatformTypeMeta {
  id: PlatformType
  label: string
  hint: string
}

export const PLATFORM_TYPE_BY_ID: Record<PlatformType, PlatformTypeMeta> = {
  argo: {
    id: 'argo',
    label: 'Argo profiling float',
    hint: 'Profiling float — one ascent cycle (profile)',
  },
  glider: {
    id: 'glider',
    label: 'Underwater glider',
    hint: 'Autonomous underwater glider — one deployment trajectory',
  },
}

/** `15.2` → `15.20° N`. */
export function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? 'N' : 'S'}`
}

/** `72.8` → `72.80° E`. */
export function formatLongitude(longitude: number): string {
  return `${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? 'E' : 'W'}`
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface ObservationState {
  /**
   * Which platform family the current selection belongs to. Written together
   * with `selectedPlatformId` by a 3D marker click, so the panel knows which
   * real provider to resolve the id against.
   */
  platformType: PlatformType
  /** `null` until a real Argo/glider marker is clicked — the panel's empty state. */
  selectedPlatformId: string | null
}

export const DEFAULT_OBSERVATION_STATE: ObservationState = {
  platformType: 'argo',
  selectedPlatformId: null,
}

export interface ObservationActions {
  /**
   * Selects one real platform by its API id, recording which family it belongs
   * to.
   *
   * This is the entry point a 3D Argo/glider marker calls (Step 30): a marker
   * knows its own real `platform_id` and family and nothing else about the
   * panel. The id is stored verbatim.
   */
  selectPlatform: (id: string, type: PlatformType) => void
  /** Returns the panel to its empty state. */
  clearSelection: () => void
}

export interface ObservationContextValue {
  state: ObservationState
  actions: ObservationActions
}

export const ObservationContext = createContext<ObservationContextValue | null>(null)

function useObservationContext(hook: string): ObservationContextValue {
  const value = useContext(ObservationContext)
  if (value === null) {
    throw new Error(`${hook} must be used inside <ObservationProvider>`)
  }
  return value
}

/**
 * Read the shared observation selection. Consumed by the observation panel and
 * by the 3D marker layer, so both agree on which platform is highlighted.
 */
export function useObservationState(): ObservationState {
  return useObservationContext('useObservationState').state
}

/** Mutate the shared observation selection. */
export function useObservationControls(): ObservationActions {
  return useObservationContext('useObservationControls').actions
}
