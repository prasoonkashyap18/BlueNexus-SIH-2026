import { useMemo } from 'react'
import type { ArgoPlatformSummary, GliderPlatformSummary } from '../api/types'
import { findArgoPlatform, useArgoObservations } from '../state/argoObservationsState'
import { findGliderPlatform, useGliderObservations } from '../state/gliderObservationsState'
import { useObservationState } from '../state/observationState'

/* ==================================================================== *
 *  Step 31 — resolve the shared observation selection to its REAL record.
 *
 *  The selection is an id + family, written by a 3D marker click (Step 30).
 *  This hook is the single seam between that id and the observation source:
 *  it looks the id up in the real Argo / glider providers (Steps 28–29),
 *  which are already loaded from `/api/observations/argo` and
 *  `/api/observations/gliders`.
 *
 *  There is no demo catalogue any more. A selected id that the loaded
 *  snapshot does not contain resolves to `error`, never to a stand-in
 *  record. While a provider is still loading, the selection is `loading`.
 *  Nothing here invents, interpolates or converts a value — the summary
 *  record and the source provenance / units are passed through verbatim.
 * ==================================================================== */

export type ObservationKind = 'argo' | 'glider'

interface SelectionBase {
  kind: ObservationKind
  /** The real API id, exactly as the marker supplied it. */
  id: string
}

export interface ReadyArgoObservation extends SelectionBase {
  status: 'ready'
  kind: 'argo'
  record: ArgoPlatformSummary
  provenance: Record<string, unknown> | null
  units: Record<string, string> | null
}

export interface ReadyGliderObservation extends SelectionBase {
  status: 'ready'
  kind: 'glider'
  record: GliderPlatformSummary
  provenance: Record<string, unknown> | null
  units: Record<string, string> | null
}

export type SelectedObservation =
  | { status: 'empty' }
  | ({ status: 'loading' } & SelectionBase)
  | ({
      status: 'error'
      message: string
      /**
       * Step 48 — `'not_found'` when the id is simply absent from the loaded
       * snapshot (a retry will not help), otherwise the provider error's
       * `type` slug so the failure UI can classify it.
       */
      errorType: string
    } & SelectionBase)
  | ReadyArgoObservation
  | ReadyGliderObservation

const EMPTY: SelectedObservation = { status: 'empty' }

export function useSelectedObservation(): SelectedObservation {
  const { platformType, selectedPlatformId } = useObservationState()
  const argo = useArgoObservations()
  const glider = useGliderObservations()

  return useMemo<SelectedObservation>(() => {
    if (selectedPlatformId === null) return EMPTY

    if (platformType === 'argo') {
      if (argo.phase === 'idle' || argo.phase === 'loading') {
        return { status: 'loading', kind: 'argo', id: selectedPlatformId }
      }
      if (argo.phase === 'error') {
        return {
          status: 'error',
          kind: 'argo',
          id: selectedPlatformId,
          message: argo.error?.message ?? 'Argo observations could not be loaded.',
          errorType: argo.error?.type ?? 'unexpected_error',
        }
      }
      const record = findArgoPlatform(argo, selectedPlatformId)
      if (record === null) {
        return {
          status: 'error',
          kind: 'argo',
          id: selectedPlatformId,
          message: 'This Argo profile is not in the loaded snapshot.',
          errorType: 'not_found',
        }
      }
      return {
        status: 'ready',
        kind: 'argo',
        id: selectedPlatformId,
        record,
        provenance: argo.provenance,
        units: argo.units,
      }
    }

    if (glider.phase === 'idle' || glider.phase === 'loading') {
      return { status: 'loading', kind: 'glider', id: selectedPlatformId }
    }
    if (glider.phase === 'error') {
      return {
        status: 'error',
        kind: 'glider',
        id: selectedPlatformId,
        message: glider.error?.message ?? 'Glider observations could not be loaded.',
        errorType: glider.error?.type ?? 'unexpected_error',
      }
    }
    const record = findGliderPlatform(glider, selectedPlatformId)
    if (record === null) {
      return {
        status: 'error',
        kind: 'glider',
        id: selectedPlatformId,
        message: 'This glider deployment is not in the loaded snapshot.',
        errorType: 'not_found',
      }
    }
    return {
      status: 'ready',
      kind: 'glider',
      id: selectedPlatformId,
      record,
      provenance: glider.provenance,
      units: glider.units,
    }
  }, [platformType, selectedPlatformId, argo, glider])
}
