import type { HealthStatus } from '../../hooks/useHealthCheck'
import styles from './ConnectionStatus.module.css'

const LABELS: Record<HealthStatus, string> = {
  loading: 'Connecting',
  online: 'Online',
  offline: 'Offline',
}

interface ConnectionStatusProps {
  status: HealthStatus
  /** Human-readable explanation, surfaced on hover and to assistive tech. */
  detail: string
  /**
   * What is being reported. Today there is a single backend; later steps add
   * per-source pills (model grid, Argo feed, glider feed) that render this
   * same component with a different source and status.
   */
  source?: string
}

/**
 * Presentational connectivity pill — it renders whatever status it is handed
 * and performs no fetching of its own, so the source of truth can be swapped
 * (health poll, websocket, aggregated data-source registry) without touching
 * the header.
 */
export function ConnectionStatus({ status, detail, source = 'Backend' }: ConnectionStatusProps) {
  return (
    <span
      className={`${styles.pill} ${styles[status]}`}
      title={`${source}: ${detail}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.srOnly}>{source} connection: </span>
      <span className={styles.label}>{LABELS[status]}</span>
    </span>
  )
}
