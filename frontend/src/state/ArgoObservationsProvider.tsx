import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client'
import {
  ArgoObservationsContext,
  INITIAL_ARGO_OBSERVATIONS_STATE,
  type ArgoObservationsError,
  type ArgoObservationsState,
} from './argoObservationsState'

/* ==================================================================== *
 *  Step 28 — loads the real INCOIS Argo float-profile list through the D11
 *  client, once on mount:
 *
 *    mount → GET /api/observations/argo
 *          → success: every real float profile (summary) + source units + provenance
 *
 *  No mock fallback, no polling, no automatic refresh. One `AbortController`
 *  for the lifetime of the mount. The individual profile (with all its measured
 *  levels) is fetched on demand by `useArgoProfile(id)` — see
 *  `argoObservationsState.ts`.
 *
 *  Sits inside `<ObservationProvider>` so a later step can react to the shared
 *  `selectedPlatformId`; it holds no selection state of its own.
 * ==================================================================== */

interface ArgoObservationsProviderProps {
  children: ReactNode
}

function describeError(cause: unknown): ArgoObservationsError {
  if (ApiError.is(cause)) {
    return { stage: 'platforms', type: cause.type, message: cause.message }
  }
  return {
    stage: 'platforms',
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

export function ArgoObservationsProvider({ children }: ArgoObservationsProviderProps) {
  const [state, setState] = useState<ArgoObservationsState>(() => ({
    ...INITIAL_ARGO_OBSERVATIONS_STATE,
    phase: 'loading',
  }))

  // Step 48 — user-triggered retry of the one-shot list request.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => {
    setState(() => ({ ...INITIAL_ARGO_OBSERVATIONS_STATE, phase: 'loading' }))
    setReloadNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    dataApi
      .getArgoPlatforms(controller.signal)
      .then((response) => {
        if (cancelled) return
        setState((current) => ({
          ...current,
          phase: 'success',
          datasetId: response.dataset_id,
          units: response.units,
          provenance: response.provenance,
          platforms: response.platforms,
          error: null,
          updatedAt: new Date().toISOString(),
        }))
      })
      .catch((cause) => {
        if (cancelled || isAbortError(cause)) return
        setState((current) => ({
          ...current,
          phase: 'error',
          error: describeError(cause),
        }))
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [reloadNonce])

  const value = useMemo(() => ({ ...state, reload }), [state, reload])

  return <ArgoObservationsContext value={value}>{children}</ArgoObservationsContext>
}
