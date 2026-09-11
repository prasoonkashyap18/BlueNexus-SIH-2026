import styles from './ObservationEmptyState.module.css'

interface ObservationEmptyStateProps {
  message: string
  /** Decorative glyph. Defaults to the panel's target mark. */
  icon?: string
  /** Tighter padding, for the profile slot where the message is secondary. */
  compact?: boolean
}

/**
 * Waiting state for a panel section with nothing selected yet.
 *
 * Written and styled as an invitation, not a failure — no warning tone, no
 * error colour.
 */
export function ObservationEmptyState({
  message,
  icon = '◎',
  compact = false,
}: ObservationEmptyStateProps) {
  return (
    <p className={`${styles.empty} ${compact ? styles.compact : ''}`}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span>{message}</span>
    </p>
  )
}
