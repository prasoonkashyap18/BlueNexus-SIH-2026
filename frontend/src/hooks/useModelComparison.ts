import { useCallback, useEffect, useState } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client.ts'
import type { ModelObsTemperatureComparisonResponse } from '../api/types.ts'
import { isArgoPlatformId } from '../state/argoObservationsState.ts'

/* ==================================================================== *
 *  Step 46 — on-demand fetch of the Step 45 model ↔ observation comparison.
 *
 *  Self-contained (no context), modelled on `useArgoProfile`: given a valid
 *  composite Argo id it requests
 *  `GET /api/model-observations/argo/{id}/temperature-comparison` through the
 *  existing D11 client, and cancels an in-flight request on unmount / id change.
 *
 *  The comparison is user-initiated: the observation panel passes `null` until
 *  the operator presses "Compare with Model", and a fresh selection remounts
 *  the section (keyed by platform id) so a stale comparison never shows.
 *
 *  No synthetic fallback. Any failure → phase `'error'` with an inspectable
 *  cause; the section fails safe (renders nothing fabricated). Full
 *  comparison-specific loading / error UX is deferred to Step 47.
 * ==================================================================== */

export type ModelComparisonPhase = 'idle' | 'loading' | 'success' | 'error'

export interface ModelComparisonError {
  type: string
  message: string
}

export interface ModelComparisonState {
  phase: ModelComparisonPhase
  platformId: string | null
  data: ModelObsTemperatureComparisonResponse | null
  error: ModelComparisonError | null
  /** Re-issue the request for the same id. No-op while no valid id is set. */
  retry: () => void
}

function describe(cause: unknown): ModelComparisonError {
  if (ApiError.is(cause)) {
    return { type: cause.type, message: cause.message }
  }
  return {
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

type ModelComparisonResult = Omit<ModelComparisonState, 'retry'>

const IDLE: ModelComparisonResult = {
  phase: 'idle',
  platformId: null,
  data: null,
  error: null,
}

const NOOP = () => {}

export function useModelComparison(platformId: string | null): ModelComparisonState {
  const valid = platformId !== null && isArgoPlatformId(platformId)

  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  const [resolved, setResolved] = useState<{ key: string; value: ModelComparisonResult }>(() => ({
    key: '',
    value: IDLE,
  }))

  const key = valid ? `${platformId}#${nonce}` : ''

  useEffect(() => {
    if (!valid) return

    const controller = new AbortController()
    let cancelled = false

    dataApi
      .getModelObservationTemperatureComparison(platformId, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setResolved({ key, value: { phase: 'success', platformId, data, error: null } })
        }
      })
      .catch((cause) => {
        if (cancelled || isAbortError(cause)) return
        setResolved({
          key,
          value: { phase: 'error', platformId, data: null, error: describe(cause) },
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key, platformId, valid])

  if (!valid) return { ...IDLE, retry: NOOP }
  const value =
    resolved.key === key
      ? resolved.value
      : { phase: 'loading' as const, platformId, data: null, error: null }
  return { ...value, retry }
}
