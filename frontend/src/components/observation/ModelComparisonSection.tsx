import { useState } from 'react'
import { useModelComparison } from '../../hooks/useModelComparison'
import { describeComparisonFailure } from './comparisonFailure'
import {
  comparisonHasMatchedLevels,
  formatCelsius,
  formatComparisonTime,
  formatSignedCelsius,
  formatSpatialSeparation,
  formatTemporalSeparation,
  toComparisonViewModel,
} from './modelComparison'
import { ModelComparisonNotice } from './ModelComparisonNotice'
import { DifferenceProfileChart, ModelComparisonChart } from './ModelComparisonChart'
import type { ModelObsTemperatureComparisonResponse } from '../../api/types'
import styles from './ModelComparisonSection.module.css'

/* ==================================================================== *
 *  Step 46 + 47 — "Compare with Model" for the selected real Argo profile.
 *
 *  Lives inside the existing Observation panel, below the measured Depth
 *  Profile section, and only for an Argo selection (Step 45 compares GLORYS12V1
 *  `thetao` against Argo temperature only — a glider selection never reaches
 *  this component; see ObservationPanel + `isModelComparisonSupported`).
 *
 *  Flow:
 *    selected Argo id  →  operator presses "Compare with Model"
 *      →  <ComparisonFlow> mounts  →  useModelComparison(id)
 *      →  GET /api/model-observations/argo/{id}/temperature-comparison
 *      →  loading → (success | error | coverage | empty)
 *
 *  Step 47 responsibilities handled here:
 *   - the flow is a child component mounted only while requested, so "Hide"
 *     unmounts it (aborting any in-flight request via the hook's cleanup) and
 *     a later "Compare" mounts a fresh request rather than replaying a cache;
 *   - the parent (`ObservationPanel`) keys this section by platform id, so a
 *     new Argo selection remounts to the neutral state — a stale comparison is
 *     never shown against a different profile;
 *   - every non-success state is the compact `ModelComparisonNotice`
 *     (loading / error / coverage / empty), classified by
 *     `describeComparisonFailure`; an aborted request is silent.
 * ==================================================================== */

interface ModelComparisonSectionProps {
  /** The selected real Argo composite id (`<platform_number>_<cycle_number>`). */
  platformId: string
}

export function ModelComparisonSection({ platformId }: ModelComparisonSectionProps) {
  const [requested, setRequested] = useState(false)

  // The parent keys this component by platform id, so a new Argo selection
  // remounts it here. This render-phase guard is the belt-and-braces case:
  // if the id ever changes without a remount, drop the pending request so a
  // stale comparison is never shown (React's "adjust state during render").
  const [seenId, setSeenId] = useState(platformId)
  if (platformId !== seenId) {
    setSeenId(platformId)
    setRequested(false)
  }

  return (
    <section className={styles.section} aria-label="Model comparison">
      <div className={styles.head}>
        <span className={styles.label}>Model ↔ Observation</span>
        {requested && (
          <button
            type="button"
            className={styles.reset}
            onClick={() => setRequested(false)}
          >
            Hide
          </button>
        )}
      </div>

      {requested ? (
        <ComparisonFlow platformId={platformId} />
      ) : (
        <>
          <p className={styles.intro}>
            Compare this Argo profile with the GLORYS12V1 reanalysis temperature
            at its nearest native model cell and day.
          </p>
          <button
            type="button"
            className={styles.cta}
            onClick={() => setRequested(true)}
          >
            Compare with Model
          </button>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * The request lifecycle — mounted only while a comparison is requested.
 * ------------------------------------------------------------------ */

function ComparisonFlow({ platformId }: { platformId: string }) {
  const comparison = useModelComparison(platformId)

  if (comparison.phase === 'success' && comparison.data !== null) {
    if (!comparisonHasMatchedLevels(comparison.data)) {
      return (
        <ModelComparisonNotice
          variant="empty"
          title="No matched model levels"
          detail={
            'The comparison completed, but no GLORYS12V1 depth level fell within the ' +
            'adaptive vertical tolerance of an Argo measurement for this profile. ' +
            'Unmatched levels are never interpolated or fabricated, so there is nothing ' +
            'to plot and no difference statistics to report.'
          }
          platformId={platformId}
        />
      )
    }
    return <ComparisonResult response={comparison.data} />
  }

  if (comparison.phase === 'error') {
    const failure = describeComparisonFailure(comparison.error)
    // An intentionally aborted / superseded request is not shown to the user.
    if (failure.silent) return null
    return (
      <ModelComparisonNotice
        variant={failure.tone === 'coverage' ? 'coverage' : 'error'}
        title={failure.title}
        detail={failure.detail}
        platformId={platformId}
        onRetry={failure.canRetry ? comparison.retry : undefined}
      />
    )
  }

  // idle (transient, before the effect runs) and loading both read as "in flight".
  return (
    <ModelComparisonNotice
      variant="loading"
      title="Loading model comparison…"
      detail="Fetching the GLORYS12V1 reanalysis temperature at this profile's nearest model cell and day."
      platformId={platformId}
    />
  )
}

/* ------------------------------------------------------------------ *
 * The rendered comparison — unchanged Step 46 visualisation.
 * ------------------------------------------------------------------ */

function ComparisonResult({
  response,
}: {
  response: ModelObsTemperatureComparisonResponse
}) {
  const view = toComparisonViewModel(response)
  const stats = view.statistics
  const { matched, total, unmatched } = view.levels

  return (
    <div className={styles.result}>
      <ModelComparisonChart
        platformId={view.platformId}
        model={view.model}
        observed={view.observed}
      />

      <DifferenceProfileChart
        platformId={view.platformId}
        difference={view.difference}
      />

      <div className={styles.statsBlock}>
        <span className={styles.blockHead}>Difference statistics</span>
        <p className={styles.blockNote}>
          Model − Observation (reanalysis–observation comparison), matched
          levels only. Values are the Step 45 backend results, not recomputed.
        </p>
        <dl className={styles.stats}>
          <Stat label="Mean difference" value={formatSignedCelsius(stats.mean_difference_c)} />
          <Stat label="MAE" value={formatCelsius(stats.mean_absolute_difference_c)} />
          <Stat label="RMSE" value={formatCelsius(stats.rmse_c)} />
          <Stat
            label="Range"
            value={`${formatSignedCelsius(stats.minimum_difference_c)} … ${formatSignedCelsius(
              stats.maximum_difference_c,
            )}`}
          />
          <Stat label="Matched levels" value={`${matched} / ${total}`} />
        </dl>
        {unmatched > 0 && (
          <p className={styles.blockNote}>
            {unmatched} model level{unmatched === 1 ? '' : 's'} unmatched — no Argo
            observation within the adaptive vertical tolerance; excluded from the
            statistics and not drawn.
          </p>
        )}
      </div>

      <dl className={styles.meta}>
        <Stat label="Argo platform" value={view.platformId} />
        <Stat label="Argo time" value={formatComparisonTime(view.observationTimestamp)} />
        <Stat label="GLORYS time" value={formatComparisonTime(view.modelTimestamp)} />
        <Stat label="Spatial separation" value={formatSpatialSeparation(view.spatialSeparationKm)} />
        <Stat
          label="Temporal separation"
          value={formatTemporalSeparation(view.temporalSeparationSeconds)}
        />
        <Stat label="Model source" value={view.modelSource} />
        <Stat label="Observation source" value={view.observationSource} />
      </dl>

      <details className={styles.method}>
        <summary>Methodology &amp; limitations</summary>
        <ul className={styles.methodList}>
          <li>
            GLORYS12V1 is a Copernicus Marine global ocean reanalysis (variable{' '}
            <code>thetao</code>); it is not INCOIS model data.
          </li>
          <li>
            The observation is a real INCOIS <em>Indian_ARGO_Floats</em> profile
            (in-situ CTD); temperature and QC flags are passed through unfiltered.
          </li>
          <li>
            Spatial matching uses the nearest native GLORYS 1/12° grid cell — no
            horizontal interpolation.
          </li>
          <li>
            Temporal matching uses the nearest GLORYS daily-mean timestep; GLORYS{' '}
            <code>thetao</code> is a daily mean, not an instantaneous value.
          </li>
          <li>
            Each native GLORYS depth level is matched to the nearest Argo
            observation by derived depth (TEOS-10 <code>gsw.z_from_p</code>),
            within an adaptive tolerance of half the local level spacing. There is
            no vertical interpolation of either dataset.
          </li>
          <li>
            Unmatched model levels are not forced; only valid matched pairs
            contribute to the statistics.
          </li>
          <li>
            This is a reanalysis–observation comparison, not instantaneous
            co-located validation.
          </li>
        </ul>
        {view.notes.length > 0 && (
          <ul className={styles.methodList}>
            {view.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
