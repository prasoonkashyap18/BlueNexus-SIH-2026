import { useId } from 'react'
import type { ArgoObservationsPhase } from '../../state/argoObservationsState'
import { useProfileVariable } from '../../hooks/useProfileVariable'
import { ProfileVariableSwitcher } from './ProfileVariableSwitcher'
import { TemperatureProfileChart } from './TemperatureProfileChart'
import { SalinityProfileChart } from './SalinityProfileChart'
import type { ProfileRow } from './temperatureProfile'
import type { SalinityProfileRow } from './salinityProfile'
import styles from './ProfileSection.module.css'

/* ==================================================================== *
 *  Step 34 — the observation panel's measured-profile section.
 *
 *  One profile is shown at a time. A compact switcher picks the variable
 *  (temperature | salinity, default temperature); only the matching chart is
 *  mounted — never both. The `rows` are exactly the real profile rows the
 *  panel already loaded (`useArgoProfile` / `useGliderDeployment`), so
 *  switching the variable mounts a different chart over the SAME data and
 *  makes no new request. Loading / error / empty states are the charts' own
 *  (Steps 32–33) and are unchanged.
 * ==================================================================== */

interface ProfileSectionProps {
  /** Selected platform id — resets the variable to the default when it changes. */
  observationKey: string
  phase: ArgoObservationsPhase
  /**
   * `detail.levels` (Argo) or `detail.samples` (glider) — the real measured
   * rows, `null` until loaded. Each row carries both `temperature` and
   * `salinity`, so one array feeds whichever chart is active.
   */
  rows: readonly (ProfileRow & SalinityProfileRow)[] | null
  /** `level_count` / `sample_count`, for the chart's valid-count readout. */
  measuredCount: number | null
  /** Step 48 — the profile fetch's error object (an `ApiError` / provider error). */
  error?: unknown
  /** Step 48 — re-fetch this profile (from `useArgoProfile` / `useGliderDeployment`). */
  onRetry?: () => void
  platformId: string
}

export function ProfileSection({
  observationKey,
  phase,
  rows,
  measuredCount,
  error,
  onRetry,
  platformId,
}: ProfileSectionProps) {
  const [variable, setVariable] = useProfileVariable(observationKey)
  const labelId = useId()

  const chartProps = { phase, rows, measuredCount, error, onRetry, platformId }

  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <span id={labelId} className={styles.label}>
          Depth Profile
        </span>
        <ProfileVariableSwitcher value={variable} onChange={setVariable} labelId={labelId} />
      </div>

      {variable === 'temperature' ? (
        <TemperatureProfileChart {...chartProps} />
      ) : (
        <SalinityProfileChart {...chartProps} />
      )}
    </section>
  )
}
