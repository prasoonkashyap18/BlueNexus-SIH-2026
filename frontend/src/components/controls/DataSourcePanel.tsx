import { useId } from 'react'
import { useSourceCatalog } from '../../hooks/useSourceCatalog'
import { useVisualizationState, OCEAN_VARIABLE_BY_ID } from '../../state/visualizationState'
import { useObservationState } from '../../state/observationState'
import type { DataSourceInfo } from '../../api/types'
import {
  KIND_LABEL,
  fieldSource,
  formatDepthRange,
  formatLatLon,
  formatTimeCoverage,
  observationSource,
  primaryUnit,
} from './dataSources'
import styles from './DataSourcePanel.module.css'

/* ==================================================================== *
 *  Step 51 — "Data Source" section of the control panel.
 *
 *  Answers, for the CURRENT state: what am I looking at, where did it come
 *  from, which dataset/product, which variable, what units, and is it model,
 *  analysis or observation. The active-source card follows the selected 3D
 *  variable (and, if a platform is selected, the observation source too). A
 *  collapsible section lists every real dataset the app uses with its coverage.
 *
 *  All values come from the backend `GET /api/sources` catalogue
 *  (`useSourceCatalog`), with an identity-only static fallback so the names are
 *  always right even offline. GLORYS12V1 is shown as Copernicus Marine data and
 *  is never described as INCOIS.
 * ==================================================================== */

function KindBadge({ source }: { source: DataSourceInfo }) {
  return (
    <span
      className={`${styles.badge} ${source.is_incois ? styles.badgeIncois : styles.badgeExternal}`}
    >
      {KIND_LABEL[source.kind]}
    </span>
  )
}

function ActiveCard({ source }: { source: DataSourceInfo }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.context}>{source.context_label}</span>
        <KindBadge source={source} />
      </div>
      <span className={styles.sourceLabel}>{source.label}</span>
      <span className={styles.varLine}>
        {source.variable.name}
        {' · '}
        {primaryUnit(source.units)}
      </span>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function CatalogEntry({ source }: { source: DataSourceInfo }) {
  const cov = source.coverage
  const unitsText =
    typeof source.units === 'string'
      ? source.units
      : source.units
        ? Object.entries(source.units)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')
        : null

  return (
    <div className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryLabel}>{source.label}</span>
        <KindBadge source={source} />
      </div>
      <dl className={styles.rows}>
        <DetailRow label="Supplies" value={source.context_label} />
        <DetailRow label="Organisation" value={source.organization} />
        <DetailRow label="Dataset / product" value={source.product_identifier ?? source.dataset_id} />
        {source.copernicus_dataset_id ? (
          <DetailRow label="Copernicus dataset" value={source.copernicus_dataset_id} />
        ) : null}
        <DetailRow
          label="Variable"
          value={
            source.variable.display.includes(source.variable.name)
              ? source.variable.display
              : `${source.variable.display} (${source.variable.name})`
          }
        />
        <DetailRow label="Units" value={unitsText} />
        {cov ? (
          <>
            <DetailRow label="Latitude" value={formatLatLon(cov.latitude, 'lat')} />
            <DetailRow label="Longitude" value={formatLatLon(cov.longitude, 'lon')} />
            <DetailRow label="Depth" value={formatDepthRange(cov.depth)} />
            <DetailRow label="Time" value={formatTimeCoverage(cov.time)} />
          </>
        ) : null}
        <DetailRow label="Temporal" value={source.temporal_semantics} />
        <DetailRow label="Subset" value={source.subset_note} />
        <DetailRow label="Attribution" value={source.attribution} />
      </dl>
      {source.url ? (
        <a className={styles.link} href={source.url} target="_blank" rel="noreferrer noopener">
          Source / product page ↗
        </a>
      ) : null}
    </div>
  )
}

export function DataSourcePanel() {
  const { catalog, live } = useSourceCatalog()
  const { selectedVariable } = useVisualizationState()
  const { selectedPlatformId, platformType } = useObservationState()
  const detailsId = useId()

  const active = fieldSource(catalog, selectedVariable)
  const observation =
    selectedPlatformId !== null ? observationSource(catalog, platformType) : null

  const variableMeta = OCEAN_VARIABLE_BY_ID[selectedVariable]

  return (
    <section className={styles.panel} aria-label="Data source">
      <div className={styles.head}>
        <span className="ov-eyebrow">Data Source</span>
        {!live ? (
          <span className={styles.offlineHint} title="Showing dataset identity from the built-in catalogue; coverage details appear when the data service is reachable.">
            identity only
          </span>
        ) : null}
      </div>

      {active ? (
        <ActiveCard source={active} />
      ) : (
        <p className={styles.none}>
          No dataset is wired for {variableMeta.label.toLowerCase()}.
        </p>
      )}

      {observation ? <ActiveCard source={observation} /> : null}

      <details className={styles.details}>
        <summary aria-controls={detailsId}>All data sources &amp; coverage</summary>
        <div id={detailsId} className={styles.detailsBody}>
          {catalog.sources.map((source) => (
            <CatalogEntry key={source.key} source={source} />
          ))}
          {catalog.notes.map((note, i) => (
            <p key={i} className={styles.note}>
              {note}
            </p>
          ))}
        </div>
      </details>
    </section>
  )
}
