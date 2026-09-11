/* ==================================================================== *
 *  Step 48 — user-facing data-failure classifier.
 *
 *  Turns any failure a data flow can produce — an {@link ApiError} from the
 *  Step 36 client, one of the providers' `{ stage, type, message }` error
 *  objects, or an unknown throw — into a small, plain-language descriptor the
 *  UI renders. It NEVER surfaces a stack trace, an exception message, or a
 *  backend `detail` blob to the user: the copy here is written for a reader,
 *  and the raw cause is left in the console where the client already logs it.
 *
 *  It classifies only. It does not fetch, retry, or fall back to any data —
 *  the "no mock fallback" rule (Step 36) is unchanged.
 * ==================================================================== */

import { ApiError } from '../../api/client.ts'

/** Coarse failure category — drives the copy and whether Retry is offered. */
export type DataFailureKind =
  | 'offline' // transport never reached the API (backend down, no network, CORS)
  | 'server' // the API answered 5xx / "unavailable" — usually transient
  | 'notFound' // the API answered 404 / "unknown …" — retrying will not help
  | 'malformed' // a 2xx body that was not the JSON the endpoint is contracted to return
  | 'unknown' // anything else (a rejected request, an unexpected throw)

export interface DataFailure {
  kind: DataFailureKind
  /** Short headline, e.g. "Can't reach the data service". */
  title: string
  /** One sentence of plain-language detail. Never technical. */
  detail: string
  /** `true` when repeating the *same* request could plausibly succeed. */
  canRetry: boolean
}

interface NormalisedCause {
  /** ApiError.kind when we have it. */
  kind: ApiError['kind'] | null
  status: number | null
  /** ApiError.type / provider error `type` — a slug, never shown to the user. */
  type: string | null
}

/** Backend `error.type` slugs (Step 35) that mean "the thing does not exist". */
const NOT_FOUND_TYPES = new Set([
  'unknown_dataset',
  'unknown_parameter',
  'unknown_coordinate',
  'parameter_not_in_dataset',
  'unknown_argo_platform',
  'unknown_glider_deployment',
  'unknown_variable',
])

/** Backend slugs that mean "temporarily unavailable" — a retry is worthwhile. */
const UNAVAILABLE_TYPES = new Set([
  'data_unavailable',
  'service_unavailable',
  'netcdf_not_configured',
  'netcdf_unavailable',
])

function normalise(cause: unknown): NormalisedCause {
  if (ApiError.is(cause)) {
    return { kind: cause.kind, status: cause.status, type: cause.type }
  }
  if (typeof cause === 'object' && cause !== null && 'type' in cause) {
    const type = (cause as { type?: unknown }).type
    if (typeof type === 'string') {
      const httpMatch = type.match(/^http_(\d{3})$/)
      return {
        kind: null,
        status: httpMatch ? Number(httpMatch[1]) : null,
        type,
      }
    }
  }
  return { kind: null, status: null, type: null }
}

const COPY: Record<DataFailureKind, { title: string; detail: string; canRetry: boolean }> = {
  offline: {
    title: "Can't reach the data service",
    detail:
      'The BlueNexus data API is not responding. Check that the backend is running, then try again.',
    canRetry: true,
  },
  server: {
    title: 'The data service had a problem',
    detail: "This request didn't complete. It is usually temporary — try again in a moment.",
    canRetry: true,
  },
  notFound: {
    title: 'Data not available',
    detail: 'The requested data is not part of the current dataset.',
    canRetry: false,
  },
  malformed: {
    title: 'Unexpected response',
    detail: "The data service returned something BlueNexus couldn't read. Trying again may help.",
    canRetry: true,
  },
  unknown: {
    title: "Couldn't load this data",
    detail: 'Something went wrong while loading this data.',
    canRetry: true,
  },
}

/** Classify a failure into the descriptor the UI renders. */
export function describeDataFailure(cause: unknown): DataFailure {
  const { kind, status, type } = normalise(cause)

  let category: DataFailureKind
  if (kind === 'network' || type === 'network_error') {
    category = 'offline'
  } else if (kind === 'malformed' || type === 'invalid_response') {
    category = 'malformed'
  } else if (
    status === 404 ||
    (type !== null && (NOT_FOUND_TYPES.has(type) || type === 'not_found' || type.endsWith('_not_found')))
  ) {
    category = 'notFound'
  } else if (
    (status !== null && status >= 500) ||
    (type !== null && (UNAVAILABLE_TYPES.has(type) || type.endsWith('_unavailable')))
  ) {
    category = 'server'
  } else {
    category = 'unknown'
  }

  const base = COPY[category]

  // A 4xx that is not a 404 (400 / 401 / 403 / 422) is a rejected request:
  // repeating it unchanged will fail the same way, so do not offer Retry.
  const rejected =
    category === 'unknown' && status !== null && status >= 400 && status < 500
  const canRetry = rejected ? false : base.canRetry

  return {
    kind: category,
    title: base.title,
    detail: rejected
      ? 'The data service rejected this request.'
      : base.detail,
    canRetry,
  }
}
