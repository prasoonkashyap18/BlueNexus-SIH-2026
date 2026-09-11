import type { ReactNode } from 'react'
import type { ArgoPlatformSummary, GliderPlatformSummary } from '../../api/types'
import {
  PLATFORM_TYPE_BY_ID,
  formatLatitude,
  formatLongitude,
} from '../../state/observationState'
import type {
  ReadyArgoObservation,
  ReadyGliderObservation,
} from '../../hooks/useSelectedObservation'
import styles from './ObservationDetails.module.css'

/* ------------------------------------------------------------------ *
 * Formatting — display only, never alters a source value
 * ------------------------------------------------------------------ */

const MISSING = 'Not reported'

/** ISO-8601 UTC → `2025-04-12 06:30 UTC`, or the raw string if unparseable. */
function formatObservationTime(iso: string | null): string {
  if (iso === null || iso.trim() === '') return MISSING
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]} UTC` : iso
}

/** Native pressure in decibar — no conversion to depth (Step 31 data rule). */
function formatPressure(dbar: number | null): string {
  return dbar === null ? MISSING : `${round(dbar)} dbar`
}

function formatPressureRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return MISSING
  if (min === null || max === null) return formatPressure(min ?? max)
  if (min === max) return formatPressure(min)
  return `${round(min)}–${round(max)} dbar`
}

function round(value: number): string {
  // One decimal is enough for a dbar readout; `Number()` also collapses a
  // rounded `-0.0` back to `0`.
  return String(Number(value.toFixed(1)))
}

function formatLatRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return MISSING
  return min === max
    ? formatLatitude(min)
    : `${formatLatitude(min)} – ${formatLatitude(max)}`
}

function formatLonRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return MISSING
  return min === max
    ? formatLongitude(min)
    : `${formatLongitude(min)} – ${formatLongitude(max)}`
}

function formatCoord(
  value: number | null,
  fmt: (n: number) => string,
): string {
  return value === null ? MISSING : fmt(value)
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

interface RowProps {
  label: string
  value: ReactNode
  strong?: boolean
  muted?: boolean
}

function Row({ label, value, strong, muted }: RowProps) {
  const className = strong ? styles.strong : muted ? styles.muted : undefined
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Provenance — read verbatim from the source block the API returned
 * ------------------------------------------------------------------ */

function provString(block: Record<string, unknown> | null, key: string): string | null {
  if (block === null) return null
  const value = block[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

interface ProvenanceProps {
  block: Record<string, unknown> | null
}

function Provenance({ block }: ProvenanceProps) {
  const sourceName = provString(block, 'source_name')
  const sourceDataset = provString(block, 'source_dataset_id')
  const access = provString(block, 'access_protocol')
  const sourceFile = provString(block, 'source_file_name')
  const sourceUrl = provString(block, 'source_url')

  if (
    sourceName === null &&
    sourceDataset === null &&
    access === null &&
    sourceFile === null &&
    sourceUrl === null
  ) {
    return null
  }

  return (
    <div className={styles.provenance}>
      <span className={styles.provenanceHead}>Source</span>
      {sourceName !== null && (
        <div className={styles.provenanceRow}>
          <span>Provider</span>
          <span>
            {sourceUrl !== null ? (
              <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
                {sourceName}
              </a>
            ) : (
              sourceName
            )}
          </span>
        </div>
      )}
      {sourceDataset !== null && (
        <div className={styles.provenanceRow}>
          <span>Dataset</span>
          <span>{sourceDataset}</span>
        </div>
      )}
      {access !== null && (
        <div className={styles.provenanceRow}>
          <span>Access</span>
          <span>{access}</span>
        </div>
      )}
      {sourceFile !== null && (
        <div className={styles.provenanceRow}>
          <span>Snapshot</span>
          <span>{sourceFile}</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Argo
 * ------------------------------------------------------------------ */

interface ArgoDetailsProps {
  selection: ReadyArgoObservation
}

export function ArgoObservationDetails({ selection }: ArgoDetailsProps) {
  const record: ArgoPlatformSummary = selection.record

  return (
    <div className={styles.details}>
      <dl className={styles.meta}>
        <Row
          label="Observation type"
          value={<span className={styles.kind}>{PLATFORM_TYPE_BY_ID.argo.label}</span>}
        />
        <Row label="Platform ID" value={record.platform_id} strong />
        <Row label="Float number" value={record.platform_number} />
        {record.platform_type !== null && (
          <Row label="Float type" value={record.platform_type} />
        )}
        <Row label="Cycle number" value={record.cycle_number} />
        <Row label="Latitude" value={formatCoord(record.latitude, formatLatitude)} />
        <Row label="Longitude" value={formatCoord(record.longitude, formatLongitude)} />
        <Row label="Observation time" value={formatObservationTime(record.time)} />
        <Row label="Measured levels" value={record.level_count} />
        <Row
          label="Pressure range"
          value={formatPressureRange(record.pressure_min, record.pressure_max)}
        />
      </dl>
      <Provenance block={selection.provenance} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Glider
 * ------------------------------------------------------------------ */

interface GliderDetailsProps {
  selection: ReadyGliderObservation
}

export function GliderObservationDetails({ selection }: GliderDetailsProps) {
  const record: GliderPlatformSummary = selection.record

  return (
    <div className={styles.details}>
      <dl className={styles.meta}>
        <Row
          label="Observation type"
          value={<span className={styles.kind}>{PLATFORM_TYPE_BY_ID.glider.label}</span>}
        />
        <Row label="Deployment ID" value={record.platform_id} strong />
        <Row label="Samples" value={record.sample_count} />
        <Row label="Observation start" value={formatObservationTime(record.time_start)} />
        <Row label="Observation end" value={formatObservationTime(record.time_end)} />
        <Row
          label="Latitude range"
          value={formatLatRange(record.latitude_min, record.latitude_max)}
        />
        <Row
          label="Longitude range"
          value={formatLonRange(record.longitude_min, record.longitude_max)}
        />
        <Row
          label="Pressure range"
          value={formatPressureRange(record.pressure_min, record.pressure_max)}
        />
      </dl>
      <Provenance block={selection.provenance} />
    </div>
  )
}
