import { DATA_AVAILABILITY, type DataAvailability } from '../../state/locationState'
import styles from './AvailabilityBadge.module.css'

interface AvailabilityBadgeProps {
  availability: DataAvailability
  /** Drop the wording and keep the dot — for dense lists. */
  compact?: boolean
}

/**
 * Whether a dataset exists for a region.
 *
 * Reports the conceptual availability state and nothing more: no catalogue is
 * queried anywhere in the application yet, so "Data available" means a demo
 * region carries the flag, never that real coverage has been checked.
 */
export function AvailabilityBadge({ availability, compact = false }: AvailabilityBadgeProps) {
  const meta = DATA_AVAILABILITY[availability]

  if (compact) {
    return (
      <span
        className={`${styles.dot} ${styles[availability]}`}
        role="img"
        aria-label={meta.label}
        title={meta.hint}
      />
    )
  }

  return (
    <span className={`${styles.badge} ${styles[availability]}`} title={meta.hint}>
      <span className={styles.dot} aria-hidden="true" />
      {meta.label}
    </span>
  )
}
