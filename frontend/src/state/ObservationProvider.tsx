import { useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_OBSERVATION_STATE,
  ObservationContext,
  type ObservationActions,
  type ObservationState,
  type PlatformType,
} from './observationState'

interface ObservationProviderProps {
  children: ReactNode
  /** Overrides the defaults — used by tests and by deep links later on. */
  initialState?: ObservationState
}

/**
 * Owns which in-situ platform is under inspection.
 *
 * Kept beside the visualization store rather than inside it: the control
 * panel's Reset restores rendering parameters, and clearing the observation
 * selection is a separate user intent that must not ride along with it. The
 * two stores are siblings, and a consumer subscribes to whichever it needs.
 *
 * The selection is written by the 3D Argo/glider markers (Step 30) and read by
 * the observation panel (Step 31). Both go through `selectPlatform()` /
 * `clearSelection()`; the id is whatever the real API served.
 */
export function ObservationProvider({
  children,
  initialState = DEFAULT_OBSERVATION_STATE,
}: ObservationProviderProps) {
  const [state, setState] = useState<ObservationState>(initialState)

  // Functional updates throughout, so the action object is stable for the
  // lifetime of the provider and never invalidates a consumer's memo.
  const actions = useMemo<ObservationActions>(
    () => ({
      selectPlatform: (selectedPlatformId: string, platformType: PlatformType) =>
        setState((current) =>
          current.selectedPlatformId === selectedPlatformId &&
          current.platformType === platformType
            ? current
            : { ...current, platformType, selectedPlatformId },
        ),

      clearSelection: () =>
        setState((current) =>
          current.selectedPlatformId === null
            ? current
            : { ...current, selectedPlatformId: null },
        ),
    }),
    [],
  )

  const value = useMemo(() => ({ state, actions }), [state, actions])

  return <ObservationContext value={value}>{children}</ObservationContext>
}
