/* ==================================================================== *
 *  Step 55 — pure logic behind the application error boundary.
 *
 *  {@link ErrorBoundary} (the class component) is a thin React shell; every
 *  decision it makes lives here so it can be unit-tested under `node:test`
 *  without a DOM or a CSS-module loader (the same split the Step 47/48
 *  failure classifiers use).
 *
 *  Nothing in this module surfaces a stack trace, a file path, an exception
 *  message, a backend payload, or any other internal to the user. The
 *  fallback copy is written for a reader; the raw cause is only ever handed
 *  to the console, and only in a development build.
 * ==================================================================== */

/** Boundary state. `resetCount` is used as a React `key` on the subtree so a
 *  "Try again" fully remounts the application — no stale providers, no stale
 *  comparison state, no orphaned fetch, exactly one Three.js canvas. */
export interface ErrorBoundaryState {
  hasError: boolean
  /** Increments once per successful recovery; only ever moves forward. */
  resetCount: number
}

export const INITIAL_ERROR_BOUNDARY_STATE: ErrorBoundaryState = {
  hasError: false,
  resetCount: 0,
}

/** Reducer for `getDerivedStateFromError` — record the failure, keep the
 *  reset counter untouched so the current subtree identity is preserved
 *  until the user chooses to recover. */
export function reduceCaughtError(state: ErrorBoundaryState): ErrorBoundaryState {
  return { hasError: true, resetCount: state.resetCount }
}

/** Reducer for the "Try again" action — clear the error and bump the counter
 *  so the child subtree remounts from scratch. */
export function reduceRetry(state: ErrorBoundaryState): ErrorBoundaryState {
  return { hasError: false, resetCount: state.resetCount + 1 }
}

/** The only text the fallback UI ever shows. Deliberately free of anything
 *  technical: no cause, no code, no identifiers. */
export const ERROR_BOUNDARY_COPY = {
  eyebrow: 'BlueNexus',
  title: 'Something went wrong',
  detail: 'The visualization encountered an unexpected error.',
  hint: 'You can try to recover this view, or reload the application to start fresh.',
  retry: 'Try again',
  reload: 'Reload application',
} as const

/**
 * A minimal, safe one-line summary for a *development-only* console message.
 * Returns the error's constructor name and nothing else — never the message,
 * never the stack, never any interpolated value — so even the dev log cannot
 * leak a secret that happened to be in an exception string.
 */
export function safeDevErrorSummary(cause: unknown): string {
  if (cause instanceof Error && typeof cause.name === 'string' && cause.name.trim() !== '') {
    // Constructor names are safe identifiers ("TypeError", "RangeError", …);
    // guard anyway against an exotic overridden name carrying data.
    return /^[A-Za-z][A-Za-z0-9_$]*$/.test(cause.name) ? cause.name : 'Error'
  }
  return 'Error'
}

/**
 * Log a caught render error — development builds only, and only the safe
 * one-line summary (never the message, stack, or cause object). In
 * production this is a no-op. React itself still writes the full error to
 * the console in a development build; this line is just a labelled marker
 * that the application boundary handled it.
 */
export function logBoundaryError(
  cause: unknown,
  isDev: boolean,
  sink: Pick<Console, 'error'> = console,
): void {
  if (!isDev) return
  sink.error(
    `[BlueNexus] the application error boundary caught a render error (${safeDevErrorSummary(cause)}).`,
  )
}
