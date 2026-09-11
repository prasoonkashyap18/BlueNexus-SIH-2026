/* ==================================================================== *
 *  Step 47 — comparison-specific failure classifier.
 *
 *  A thin domain layer over the Step 36 {@link ApiError} structure, for the
 *  ONE flow that is the model ↔ observation comparison
 *  (`GET /api/model-observations/argo/{id}/temperature-comparison`). It mirrors
 *  the Step 48 `describeDataFailure` pattern — classify only, never fetch,
 *  retry or fabricate — but the copy is written for this feature:
 *
 *   - an Argo id the snapshot does not contain            → "not found"
 *   - a malformed id / request                            → "could not be processed"
 *   - the profile is outside the configured GLORYS extent → an EXPECTED
 *     data-coverage situation, explained as such (tone `'coverage'`, no Retry)
 *   - the GLORYS file could not be loaded (503)           → "temporarily
 *     unavailable", Retry offered, "no fallback / mock data" stated
 *   - the comparison service was unreachable              → "unable to reach",
 *     Retry offered
 *
 *  It NEVER surfaces a stack trace, a Python error, an HTTP body or a backend
 *  `detail` blob — those stay in the console where the client logs the raw
 *  cause. A caller-initiated abort is not a failure and must never reach here
 *  (the hook swallows it); if one does, it is treated as a silent non-error.
 * ==================================================================== */

import { ApiError, isAbortError } from '../../api/client.ts'

/**
 * `'error'`    — something went wrong; render as an alert.
 * `'coverage'` — an expected scientific / data-coverage limit; render calmly,
 *                this is not a system fault.
 */
export type ComparisonFailureTone = 'error' | 'coverage'

export interface ComparisonFailure {
  tone: ComparisonFailureTone
  /** Short headline. */
  title: string
  /** One or two plain-language sentences. Never technical, never a raw payload. */
  detail: string
  /** `true` only when repeating the SAME request could plausibly succeed. */
  canRetry: boolean
  /** `true` for an intentionally aborted / superseded request — show nothing. */
  silent: boolean
}

interface NormalisedCause {
  kind: ApiError['kind'] | null
  status: number | null
  type: string | null
}

function normalise(cause: unknown): NormalisedCause {
  if (ApiError.is(cause)) {
    return { kind: cause.kind, status: cause.status, type: cause.type }
  }
  if (typeof cause === 'object' && cause !== null && 'type' in cause) {
    const type = (cause as { type?: unknown }).type
    if (typeof type === 'string') {
      const httpMatch = type.match(/^http_(\d{3})$/)
      return { kind: null, status: httpMatch ? Number(httpMatch[1]) : null, type }
    }
  }
  return { kind: null, status: null, type: null }
}

const SILENT: ComparisonFailure = {
  tone: 'error',
  title: '',
  detail: '',
  canRetry: false,
  silent: true,
}

/** Classify a comparison failure into the descriptor the notice renders. */
export function describeComparisonFailure(cause: unknown): ComparisonFailure {
  // A request aborted because the user moved on / the component unmounted is
  // not an error the user should ever see.
  if (isAbortError(cause)) return SILENT

  const { kind, status, type } = normalise(cause)

  // Transport never reached the service.
  if (kind === 'network' || type === 'network_error') {
    return {
      tone: 'error',
      title: 'Unable to reach the comparison service',
      detail:
        'BlueNexus could not reach the model-comparison service. Check that the backend is running, then try again.',
      canRetry: true,
      silent: false,
    }
  }

  // Unknown Argo platform / cycle.
  if (status === 404 || type === 'unknown_argo_platform') {
    return {
      tone: 'error',
      title: 'Argo observation not found',
      detail: 'That Argo observation could not be found in the current snapshot.',
      canRetry: false,
      silent: false,
    }
  }

  // Expected: the profile is outside the configured GLORYS12V1 extent.
  if (type === 'observation_outside_model_coverage') {
    return {
      tone: 'coverage',
      title: 'Outside model coverage',
      detail:
        'This observation is outside the currently available GLORYS12V1 model coverage. ' +
        'Only the configured regional, depth and time subset of the reanalysis is loaded, ' +
        'and this Argo profile falls outside it, so no model comparison can be produced. ' +
        'No fallback or substitute values are shown.',
      canRetry: false,
      silent: false,
    }
  }

  // Malformed id / request.
  if (type === 'malformed_request' || type === 'invalid_index' || status === 400 || status === 422) {
    return {
      tone: 'error',
      title: 'Comparison request could not be processed',
      detail: 'The comparison request could not be processed for this Argo observation.',
      canRetry: false,
      silent: false,
    }
  }

  // GLORYS model data could not be loaded.
  if (
    (status !== null && status >= 500) ||
    type === 'netcdf_unavailable' ||
    type === 'netcdf_not_configured' ||
    (type !== null && type.endsWith('_unavailable'))
  ) {
    return {
      tone: 'error',
      title: 'Model comparison unavailable',
      detail:
        'Model comparison is temporarily unavailable because the GLORYS12V1 model data could not be loaded. ' +
        'No fallback or mock data is used.',
      canRetry: true,
      silent: false,
    }
  }

  // A 2xx body that was not the contracted JSON.
  if (kind === 'malformed' || type === 'invalid_response') {
    return {
      tone: 'error',
      title: 'Unexpected response',
      detail:
        'The comparison service returned a response BlueNexus could not read. Trying again may help.',
      canRetry: true,
      silent: false,
    }
  }

  return {
    tone: 'error',
    title: 'Comparison failed',
    detail: 'The model comparison request did not complete.',
    canRetry: true,
    silent: false,
  }
}
