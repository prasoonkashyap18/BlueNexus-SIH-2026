import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ApiError, dataApi, isAbortError } from '../api/client.ts'
import type {
  GliderPlatformDetail,
  GliderPlatformSummary,
  GliderSample,
} from '../api/types.ts'

/* ==================================================================== *
 *  Step 29 — real EGO / OceanGliders GDAC underwater-glider observation state.
 *
 *  Holds the real glider deployments fetched through the D11 API client from
 *  the backend (`GET /api/observations/gliders`), sourced from the
 *  `OceanGlidersGDACTrajectories` snapshot (IFREMER ERDDAP) acquired in D4.
 *  This is **trajectory / point** data — individual CTD samples along each
 *  glider's path at their real observation timestamps — kept apart from the
 *  gridded model datasets AND from the Step 28 Argo data: its own API surface,
 *  its own provider, never regridded onto or merged with anything.
 *
 *  No mock / demo / synthetic fallback. Any failure → phase `'error'`; the
 *  observation panel keeps working from its existing (clearly-labelled) demo
 *  catalogue until a later step wires it to this real source.
 *
 *  A missing measurement is `null` — never `0`, never the EGO `_FillValue`
 *  (99999). The per-sample EGO QC flags are carried through verbatim, bad
 *  flags included.
 * ==================================================================== */

export const GLIDER_DATASET_ID = 'ego_oceangliders_gdac'

export type GliderObservationsPhase = 'idle' | 'loading' | 'success' | 'error'

export interface GliderObservationsError {
  stage: 'platforms'
  type: string
  message: string
}

export interface GliderObservationsState {
  phase: GliderObservationsPhase
  datasetId: string
  /** Source units, once loaded — `pressure: 'decibar'`, `temperature: 'degree_Celsius'`, … */
  units: Record<string, string> | null
  /** Source/provenance block from the API, once loaded. */
  provenance: Record<string, unknown> | null
  /** Every real glider deployment in the snapshot (summary metadata). */
  platforms: readonly GliderPlatformSummary[]
  error: GliderObservationsError | null
  /** ISO timestamp of the last successful load — bookkeeping only. */
  updatedAt: string | null
  /** Step 48 — re-request the deployment list. User-triggered only. */
  reload: () => void
}

export const INITIAL_GLIDER_OBSERVATIONS_STATE: GliderObservationsState = {
  phase: 'idle',
  datasetId: GLIDER_DATASET_ID,
  units: null,
  provenance: null,
  platforms: [],
  error: null,
  updatedAt: null,
  reload: () => {},
}

export const GliderObservationsContext = createContext<GliderObservationsState | null>(null)

/**
 * Read the real glider observation state (the deployment list). Consumed by the
 * observation panel / 3D markers in a later step; available now so the data is
 * in the app's data flow.
 */
export function useGliderObservations(): GliderObservationsState {
  const value = useContext(GliderObservationsContext)
  if (value === null) {
    throw new Error('useGliderObservations must be used inside <GliderObservationsProvider>')
  }
  return value
}

/** Look up one loaded deployment summary by its id. */
export function findGliderPlatform(
  state: GliderObservationsState,
  platformId: string | null,
): GliderPlatformSummary | null {
  if (platformId === null) return null
  return state.platforms.find((p) => p.platform_id === platformId) ?? null
}

/** A glider deployment id — letters/digits with `_`, `-` or `.` (e.g. `sea057_20220707`). */
export function isGliderPlatformId(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)
}

/* ------------------------------------------------------------------ *
 * One-deployment fetch hook
 *
 * Self-contained (no context): fetches a single real glider deployment with its
 * trajectory samples when given an id, and cleans up on unmount / id change.
 * This is the seam a later step wires into the panel / markers — every consumer
 * keeps working because it only ever sees a typed detail or `null`.
 * ------------------------------------------------------------------ */

export interface GliderDeploymentState {
  phase: GliderObservationsPhase
  platformId: string | null
  detail: GliderPlatformDetail | null
  error: GliderObservationsError | null
  /** Step 48 — re-fetch this deployment. No-op while no valid id is selected. */
  retry: () => void
}

function describe(cause: unknown): GliderObservationsError {
  if (ApiError.is(cause)) {
    return { stage: 'platforms', type: cause.type, message: cause.message }
  }
  return {
    stage: 'platforms',
    type: 'unexpected_error',
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

/* ------------------------------------------------------------------ *
 * Step 49 — shared one-deployment request cache
 *
 * The 3D trajectory layer mounts one `useGliderDeployment(id)` per deployment
 * to draw each track; the observation panel then mounts *another*
 * `useGliderDeployment(id)` for whichever deployment the reader selects. Before
 * this, that second hook re-requested the identical
 * `GET /api/observations/gliders/{id}` the track layer had already fetched.
 *
 * This module-level map lets every `useGliderDeployment` for the same id share
 * one in-flight (or already-settled) promise. It is a request-dedupe only — not
 * a data store: a rejected request is evicted immediately so a later mount (or
 * an explicit `retry()`) re-issues it, and `retry()` evicts the entry first so
 * it always performs a real re-fetch. Nothing here changes what is fetched, the
 * URL, or the shape of the result.
 * ------------------------------------------------------------------ */

const deploymentRequests = new Map<string, Promise<GliderPlatformDetail>>()

function requestGliderDeployment(platformId: string): Promise<GliderPlatformDetail> {
  let request = deploymentRequests.get(platformId)
  if (request === undefined) {
    request = dataApi.getGliderPlatform(platformId)
    // A failure must not stick — drop it so the next consumer re-tries.
    request.catch(() => {
      if (deploymentRequests.get(platformId) === request) {
        deploymentRequests.delete(platformId)
      }
    })
    deploymentRequests.set(platformId, request)
  }
  return request
}

/** Drop any cached request for `platformId` so the next fetch really hits the API. */
function evictGliderDeployment(platformId: string): void {
  deploymentRequests.delete(platformId)
}

type GliderDeploymentResult = Omit<GliderDeploymentState, 'retry'>

const IDLE_STATE: GliderDeploymentResult = {
  phase: 'idle',
  platformId: null,
  detail: null,
  error: null,
}

const NOOP = () => {}

export function useGliderDeployment(platformId: string | null): GliderDeploymentState {
  const valid = platformId !== null && isGliderPlatformId(platformId)

  // Step 48 — `retry()` bumps a nonce; the request is keyed by `<id>#<nonce>`,
  // so a retry re-runs the fetch for the SAME id. User-triggered only.
  // Step 49 — it also evicts the shared cache entry first, so the retry is a
  // real network re-fetch and not a replay of the failed/stale promise.
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => {
    if (platformId !== null && isGliderPlatformId(platformId)) {
      evictGliderDeployment(platformId)
    }
    setNonce((n) => n + 1)
  }, [platformId])

  // Holds the last resolved result. `state` writes happen only in the async
  // callbacks below (never synchronously in the effect); the `loading` / `idle`
  // phases are derived during render.
  const [resolved, setResolved] = useState<{ key: string; value: GliderDeploymentResult }>(() => ({
    key: '',
    value: IDLE_STATE,
  }))

  const key = valid ? `${platformId}#${nonce}` : ''

  useEffect(() => {
    if (!valid) return

    let cancelled = false

    // Step 49 — the request is shared through `requestGliderDeployment` so
    // several `useGliderDeployment(id)` for the same id (the track layer plus
    // the panel) issue exactly one `GET /api/observations/gliders/{id}`. There
    // is no per-consumer abort: the shared request must run to completion to
    // settle the cache, and an unmounted / superseded consumer simply ignores
    // the result via `cancelled`. A StrictMode remount re-subscribes to the
    // same promise. The effect still re-runs on `platformId` / retry-nonce
    // change, and `retry()` has already evicted the entry by then.
    requestGliderDeployment(platformId)
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
    }
  }, [key, platformId, valid])

  if (!valid) return { ...IDLE_STATE, retry: NOOP }
  // The resolved result is for this id + nonce once its request has come back;
  // until then (including right after the id changes or a retry) it is loading.
  const value =
    resolved.key === key
      ? resolved.value
      : { phase: 'loading' as const, platformId, detail: null, error: null }
  return { ...value, retry }
}

export type { GliderPlatformDetail, GliderPlatformSummary, GliderSample }
