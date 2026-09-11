import { useCallback, useState } from 'react'
import { describeDataFailure } from './dataFailure'
import styles from './DataErrorState.module.css'

/* ==================================================================== *
 *  Step 48 — the reusable failure state for a panel or data region.
 *
 *  Renders a calm, BlueNexus-consistent notice when a data flow could not
 *  load: a headline, one plain sentence, and — only when a retry could
 *  plausibly succeed and the caller passed an `onRetry` — a Retry button that
 *  repeats *that flow's* request (never a page reload).
 *
 *  It shows no stack trace and no raw exception text; the copy comes from
 *  {@link describeDataFailure}. It never renders fabricated data — a failed
 *  region stays failed until the user retries or the cause clears.
 * ==================================================================== */

interface DataErrorStateProps {
  /** The thrown cause — an `ApiError`, a provider error object, or anything. */
  error: unknown
  /**
   * Repeats the failed request only. Omit when there is nothing sensible to
   * retry; the button is also hidden when the failure is not retryable
   * (e.g. a 404).
   */
  onRetry?: () => void
  /** Override the generic headline, e.g. "Temperature data unavailable". */
  title?: string
  /** Small monospaced identifier under the message (a platform id, say). */
  contextId?: string
  /** Tighter padding for an inline slot (a chart area, a HUD corner). */
  compact?: boolean
  retryLabel?: string
}

/** Distinct from any real `error` value, so "nothing pending" compares false. */
const NOTHING_PENDING = Symbol('nothing-pending')

export function DataErrorState({
  error,
  onRetry,
  title,
  contextId,
  compact = false,
  retryLabel = 'Retry',
}: DataErrorStateProps) {
  const failure = describeDataFailure(error)
  const showRetry = onRetry !== undefined && failure.canRetry

  // Guard against a double-fire: the button is disabled while a retry for THIS
  // exact cause is outstanding. A retry that fails produces a fresh error
  // object (so the guard clears); a retry that succeeds unmounts this notice.
  // No effect, no timer — nothing to loop.
  const [pending, setPending] = useState<unknown>(NOTHING_PENDING)
  const busy = pending === error

  const handleRetry = useCallback(() => {
    if (pending === error) return
    setPending(error)
    onRetry?.()
  }, [pending, error, onRetry])

  return (
    <div
      className={`${styles.box} ${compact ? styles.compact : ''}`}
      role="alert"
      aria-live="polite"
    >
      <span className={styles.icon} aria-hidden="true">
        {failure.kind === 'offline' ? '⚡' : failure.kind === 'notFound' ? '◎' : '⚠'}
      </span>
      <div className={styles.text}>
        <span className={styles.title}>{title ?? failure.title}</span>
        <span className={styles.detail}>{failure.detail}</span>
        {contextId ? <span className={styles.contextId}>{contextId}</span> : null}
        {showRetry ? (
          <button type="button" className={styles.retry} onClick={handleRetry} disabled={busy}>
            {busy ? 'Retrying…' : retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
