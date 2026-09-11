import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client'
import {
  GliderObservationsContext,
  INITIAL_GLIDER_OBSERVATIONS_STATE,
  type GliderObservationsError,
  type GliderObservationsState,
} from './gliderObservationsState'

/* ==================================================================== *
 *  Step 29 — loads the real EGO / OceanGliders glider-deployment list through
 *  the D11 client, once on mount:
 *
 *    mount → GET /api/observations/gliders
 *          → success: every real deployment (summary) + source units + provenance
 *
 *  No mock fallback, no polling, no automatic refresh. One `AbortController`
 *  for the lifetime of the mount. A deployment's full trajectory (every CTD
 *  sample) is fetched on demand by `useGliderDeployment(id)` — see
 *  `gliderObservationsState.ts`.
 *
 *  Mirrors `ArgoObservationsProvider` (Step 28) exactly. Sits inside
 *  `<ObservationProvider>` so a later step can react to the shared
 *  `selectedPlatformId`; it holds no selection state of its own, and is
 *  independent of the Argo provider.
 * ==================================================================== */

interface GliderObservationsProviderProps {
  children: ReactNode
}

function describeError(cause: unknown): GliderObservationsError {
  if (ApiError.is(cause)) {
    return { stage: 'platforms', type: cause.type, message: cause.message }
  }
  return {
    stage: 'platforms',
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

export function GliderObservationsProvider({ children }: GliderObservationsProviderProps) {
  const [state, setState] = useState<GliderObservationsState>(() => ({
    ...INITIAL_GLIDER_OBSERVATIONS_STATE,
    phase: 'loading',
  }))

  // Step 48 — user-triggered retry of the one-shot list request.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => {
    setState(() => ({ ...INITIAL_GLIDER_OBSERVATIONS_STATE, phase: 'loading' }))
    setReloadNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    dataApi
      .getGliderPlatforms(controller.signal)
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

  return <GliderObservationsContext value={value}>{children}</GliderObservationsContext>
}
