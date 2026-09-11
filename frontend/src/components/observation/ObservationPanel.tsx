import { useEffect } from 'react'
import { useObservationControls } from '../../state/observationState'
import { useVisualizationState } from '../../state/visualizationState'
import { useSelectedObservation } from '../../hooks/useSelectedObservation'
import { useArgoObservations, useArgoProfile } from '../../state/argoObservationsState'
import { useGliderObservations, useGliderDeployment } from '../../state/gliderObservationsState'
import { Panel } from '../layout/Panel'
import { DataErrorState } from '../feedback/DataErrorState'
import { ObservationEmptyState } from './ObservationEmptyState'
import { ArgoObservationDetails, GliderObservationDetails } from './ObservationDetails'
import { ProfileSection } from './ProfileSection'
import { ModelComparisonSection } from './ModelComparisonSection'
import styles from './ObservationPanel.module.css'

/**
 * Right observation panel — Step 31 metadata + the Step 34 measured-profile
 * section (a Temperature / Salinity switcher over the Step 32–33 charts; one
 * chart shown at a time).
 *
 * The flow is:
 *
 *     Argo/glider marker click (Step 30)
 *       → selectPlatform(realId, type)          [observation store]
 *       → useSelectedObservation()               [resolves id against the real
 *                                                 Argo/glider summary providers]
 *       → this panel renders the real record, and
 *       → useArgoProfile(id) / useGliderDeployment(id) fetch the full measured
 *         profile for the Step 32 chart (existing per-profile endpoints/hooks)
 *
 * The panel holds no observation state and no demo data. Every value shown —
 * metadata and profile alike — is read verbatim from the real
 * `/api/observations/*` responses. Pressure stays in native dbar: no depth
 * conversion, no interpolation, no synthetic fill.
 *
 * If the layer carrying the selection is switched off (Step 30 toggles), the
 * selection is dropped so the panel and the scene never disagree — it returns
 * to the neutral empty state rather than describing a platform with no marker.
 */
export function ObservationPanel() {
  const selection = useSelectedObservation()
  const { clearSelection } = useObservationControls()
  const { layers } = useVisualizationState()
  const { reload: reloadArgo } = useArgoObservations()
  const { reload: reloadGliders } = useGliderObservations()

  const hasSelection = selection.status !== 'empty'

  // One id at a time reaches each hook; the other gets `null` and stays idle
  // (no request). Passing `null` on clear/empty also cancels any in-flight one.
  const argoProfile = useArgoProfile(
    selection.status === 'ready' && selection.kind === 'argo' ? selection.id : null,
  )
  const gliderProfile = useGliderDeployment(
    selection.status === 'ready' && selection.kind === 'glider' ? selection.id : null,
  )

  const selectedLayerHidden =
    selection.status !== 'empty' &&
    ((selection.kind === 'argo' && !layers.argo) ||
      (selection.kind === 'glider' && !layers.gliders))

  useEffect(() => {
    if (selectedLayerHidden) clearSelection()
  }, [selectedLayerHidden, clearSelection])

  return (
    <Panel
      eyebrow="Observation"
      title="Selected Platform"
      actions={
        <button
          type="button"
          className={styles.clear}
          onClick={clearSelection}
          disabled={!hasSelection}
          title={
            hasSelection
              ? 'Deselect this platform and empty the panel'
              : 'No platform is selected'
          }
        >
          Clear
        </button>
      }
    >
      <div className={styles.body} aria-live="polite">
        {selection.status === 'empty' && (
          <ObservationEmptyState
            icon="◎"
            message="No observation selected. Click an Argo float or glider track in the visualization."
          />
        )}

        {selection.status === 'loading' && (
          <ObservationEmptyState
            compact
            icon="◌"
            message="Loading observation data…"
          />
        )}

        {selection.status === 'error' && (
          <DataErrorState
            title="Observation data unavailable"
            error={{ type: selection.errorType, message: selection.message }}
            contextId={selection.id}
            onRetry={selection.kind === 'argo' ? reloadArgo : reloadGliders}
          />
        )}

        {selection.status === 'ready' && selection.kind === 'argo' && (
          <>
            <ArgoObservationDetails selection={selection} />
            <ProfileSection
              observationKey={selection.id}
              phase={argoProfile.phase}
              rows={argoProfile.detail?.levels ?? null}
              measuredCount={selection.record.level_count}
              error={argoProfile.error}
              onRetry={argoProfile.retry}
              platformId={selection.id}
            />
            {/*
              Step 46 — GLORYS12V1 ↔ Argo temperature comparison. Keyed by the
              real platform id so selecting another float remounts it to the
              neutral "not requested" state (no stale comparison). Argo only:
              Step 45 has no glider comparison, so the glider branch omits it.
            */}
            <ModelComparisonSection key={selection.id} platformId={selection.id} />
          </>
        )}

        {selection.status === 'ready' && selection.kind === 'glider' && (
          <>
            <GliderObservationDetails selection={selection} />
            <ProfileSection
              observationKey={selection.id}
              phase={gliderProfile.phase}
              rows={gliderProfile.detail?.samples ?? null}
              measuredCount={selection.record.sample_count}
              error={gliderProfile.error}
              onRetry={gliderProfile.retry}
              platformId={selection.id}
            />
          </>
        )}
      </div>
    </Panel>
  )
}
