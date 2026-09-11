import { useState } from 'react'
import styles from './ModelComparisonNotice.module.css'

/* ==================================================================== *
 *  Step 47 — the comparison feature's compact status / failure notice.
 *
 *  One small presentational component for every non-success state of the
 *  "Compare with Model" flow, styled from the shared BlueNexus tokens and
 *  modelled on the Step 48 `DataErrorState` (icon + headline + one sentence +
 *  optional Retry). It renders no chart, no fabricated value.
 *
 *   - `loading`  — the request is in flight (`role="status"`, `aria-busy`)
 *   - `error`    — the request failed (`role="alert"`), Retry when it may help
 *   - `coverage` — an EXPECTED data-coverage limit (`role="status"`), calm tone
 *   - `empty`    — the comparison succeeded but matched no levels
 *
 *  Status is never carried by colour alone: each variant has a distinct glyph
 *  and the headline states the condition in words.
 * ==================================================================== */

export type ComparisonNoticeVariant = 'loading' | 'error' | 'coverage' | 'empty'

interface ModelComparisonNoticeProps {
  variant: ComparisonNoticeVariant
  title: string
  detail?: string
  /** The Argo id under comparison — shown so the user knows which profile. */
  platformId?: string
  /** Only for `error` — repeats the SAME request. Omit when a retry cannot help. */
  onRetry?: () => void
}

const ICON: Record<ComparisonNoticeVariant, string> = {
  loading: '◌',
  error: '⚠',
  coverage: '◍',
  empty: '◎',
}

export function ModelComparisonNotice({
  variant,
  title,
  detail,
  platformId,
  onRetry,
}: ModelComparisonNoticeProps) {
  // The Retry button unmounts as soon as the click flips the flow back to
  // `loading`, so a single disable is enough to make a duplicate request
  // impossible — no timer, no external guard.
  const [retried, setRetried] = useState(false)
  const isLoading = variant === 'loading'

  return (
    <div
      className={`${styles.box} ${styles[variant]}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={isLoading ? 'polite' : variant === 'error' ? 'assertive' : 'polite'}
      {...(isLoading ? { 'aria-busy': true } : {})}
    >
      <span
        className={`${styles.icon} ${isLoading ? styles.spin : ''}`}
        aria-hidden="true"
      >
        {ICON[variant]}
      </span>
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {detail ? <span className={styles.detail}>{detail}</span> : null}
        {platformId ? <span className={styles.ctx}>Argo {platformId}</span> : null}
        {onRetry ? (
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              setRetried(true)
              onRetry()
            }}
            disabled={retried}
          >
            {retried ? 'Retrying…' : 'Retry comparison'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
