import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client.ts'
import type { ArgoLevel, ArgoPlatformDetail, ArgoPlatformSummary } from '../api/types.ts'

/* ==================================================================== *
 *  Step 28 — real INCOIS Argo profiling-float observation state.
 *
 *  Holds the real Argo float profiles fetched through the D11 API client from
 *  the backend (`GET /api/observations/argo`), sourced from the INCOIS ERDDAP
 *  `Indian_ARGO_Floats` snapshot acquired in D4. This is **point / profile**
 *  data — individual float ascents at their real observation timestamps — and
 *  is deliberately kept apart from the gridded model datasets
 *  (`incois_argo_10day_analysis`, `incois_io_hoofs_surface_currents`): its own
 *  API surface, its own provider, never regridded onto or merged with the
 *  model grid.
 *
 *  No mock / demo / synthetic fallback. Any failure → phase `'error'`; the
 *  observation panel keeps working from its existing (clearly-labelled) demo
 *  catalogue until a later step wires it to this real source.
 *
 *  A missing measurement is `null` — never `0`, never the Argo `_FillValue`.
 *  The per-level Argo QC flags are carried through verbatim.
 * ==================================================================== */

export const ARGO_DATASET_ID = 'incois_indian_argo_floats'

export type ArgoObservationsPhase = 'idle' | 'loading' | 'success' | 'error'

export interface ArgoObservationsError {
  stage: 'platforms'
  type: string
  message: string
}

export interface ArgoObservationsState {
  phase: ArgoObservationsPhase
  datasetId: string
  /** Source units, once loaded — `pressure: 'decibar'`, `temperature: 'degree_Celsius'`, … */
  units: Record<string, string> | null
  /** Source/provenance block from the API, once loaded. */
  provenance: Record<string, unknown> | null
  /** Every real float profile in the snapshot (summary metadata). */
  platforms: readonly ArgoPlatformSummary[]
  error: ArgoObservationsError | null
  /** ISO timestamp of the last successful load — bookkeeping only. */
  updatedAt: string | null
  /** Step 48 — re-request the float list. User-triggered only, no auto-retry. */
  reload: () => void
}

export const INITIAL_ARGO_OBSERVATIONS_STATE: ArgoObservationsState = {
  phase: 'idle',
  datasetId: ARGO_DATASET_ID,
  units: null,
  provenance: null,
  platforms: [],
  error: null,
  updatedAt: null,
  reload: () => {},
}

export const ArgoObservationsContext = createContext<ArgoObservationsState | null>(null)

/**
 * Read the real Argo observation state (the profile list). Consumed by the
 * observation panel / 3D markers in a later step; available now so the data is
 * in the app's data flow.
 */
export function useArgoObservations(): ArgoObservationsState {
  const value = useContext(ArgoObservationsContext)
  if (value === null) {
    throw new Error('useArgoObservations must be used inside <ArgoObservationsProvider>')
  }
  return value
}

/** Look up one loaded summary by its composite id. */
export function findArgoPlatform(
  state: ArgoObservationsState,
  platformId: string | null,
): ArgoPlatformSummary | null {
  if (platformId === null) return null
  return state.platforms.find((p) => p.platform_id === platformId) ?? null
}

/** `<platform_number>_<cycle_number>` — the real composite id shape. */
export function isArgoPlatformId(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^[0-9]{1,12}_[0-9]{1,6}$/.test(id)
}

/* ------------------------------------------------------------------ *
 * One-profile fetch hook
 *
 * Self-contained (no context): fetches a single real Argo profile with its
 * measured levels when given a composite id, and cleans up on unmount / id
 * change. Step 31's observation panel resolves a selected marker from the
 * summary list (`useArgoObservations()`); this hook is the on-demand seam for
 * a later step that needs the per-level profile (e.g. a depth chart).
 * ------------------------------------------------------------------ */

export interface ArgoProfileState {
  phase: ArgoObservationsPhase
  platformId: string | null
  detail: ArgoPlatformDetail | null
  error: ArgoObservationsError | null
  /** Step 48 — re-fetch this profile. No-op while no valid id is selected. */
  retry: () => void
}

function describe(cause: unknown): ArgoObservationsError {
  if (ApiError.is(cause)) {
    return { stage: 'platforms', type: cause.type, message: cause.message }
  }
  return {
    stage: 'platforms',
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

type ArgoProfileResult = Omit<ArgoProfileState, 'retry'>

const IDLE_ARGO_PROFILE: ArgoProfileResult = {
  phase: 'idle',
  platformId: null,
  detail: null,
  error: null,
}

const NOOP = () => {}

export function useArgoProfile(platformId: string | null): ArgoProfileState {
  const valid = platformId !== null && isArgoPlatformId(platformId)

  // Step 48 — `retry()` bumps a nonce; the request is keyed by
  // `<id>#<nonce>`, so a retry re-runs the fetch for the SAME id and the hook
  // reports `loading` until it resolves. User-triggered only.
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  // Writes happen only in the async callbacks below (never synchronously in the
  // effect); `loading` / `idle` are derived during render. No ref dedupe — a
  // React StrictMode remount is covered by `cancelled` + abort, and the second
  // run completes normally.
  const [resolved, setResolved] = useState<{ key: string; value: ArgoProfileResult }>(() => ({
    key: '',
    value: IDLE_ARGO_PROFILE,
  }))

  const key = valid ? `${platformId}#${nonce}` : ''

  useEffect(() => {
    if (!valid) return

    const controller = new AbortController()
    let cancelled = false

    dataApi
      .getArgoPlatform(platformId, controller.signal)
      .then((detail) => {
        if (!cancelled) {
          setResolved({ key, value: { phase: 'success', platformId, detail, error: null } })
        }
      })
      .catch((cause) => {
        if (cancelled || isAbortError(cause)) return
        setResolved({
          key,
          value: { phase: 'error', platformId, detail: null, error: describe(cause) },
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key, platformId, valid])

  if (!valid) return { ...IDLE_ARGO_PROFILE, retry: NOOP }
  const value =
    resolved.key === key
      ? resolved.value
      : { phase: 'loading' as const, platformId, detail: null, error: null }
  return { ...value, retry }
}

export type { ArgoLevel, ArgoPlatformDetail, ArgoPlatformSummary }
