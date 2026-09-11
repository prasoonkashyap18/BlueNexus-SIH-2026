import { useMemo } from 'react'
import type { ElementSize } from '../../hooks/useElementSize'
import type { WorkspaceView } from '../../hooks/useWorkspaceView'
import { useCurrentData } from '../../state/currentDataState'
import { useSalinityData } from '../../state/salinityDataState'
import { useTemperatureData } from '../../state/temperatureDataState'
import { DataErrorState } from '../feedback/DataErrorState'
import { FIELD_STATUS_TAG } from '../controls/dataSources'
import { AvailabilityBadge } from '../location/AvailabilityBadge'
import { RegionLocator, type LocatorMarker } from '../location/RegionLocator'
import { TemperatureColorbar } from './TemperatureColorbar'
import { regionScalarRange } from './scene/temperatureField'
import {
  formatLatitude,
  formatLongitude,
  useLocationState,
} from '../../state/locationState'
import {
  OCEAN_VARIABLE_BY_ID,
  VISUALIZATION_LAYERS,
  useVisualizationState,
} from '../../state/visualizationState'
import {
  DEMO_TIME_DATASET_NOTICE,
  formatDemoTimestampLong,
} from '../../data/demoTimeDataset'
import styles from './ViewportOverlay.module.css'

/** The camera gestures the scene binds. Informational — the scene owns the input. */
const INTERACTIONS = [
  { gesture: 'Drag', label: 'Rotate' },
  { gesture: 'Scroll', label: 'Zoom' },
  { gesture: 'Shift + drag', label: 'Pan' },
]

interface ViewStatus {
  /** Top-right badge. */
  badge: string
  /** Centre engine line. */
  engine: string
}

const VIEW_STATUS: Record<WorkspaceView, ViewStatus> = {
  explore: { badge: 'Model field', engine: '3D visualization engine ready' },
  compare: { badge: 'Model × observation', engine: 'Comparison workspace mounts here' },
  profiles: { badge: 'Depth profiles', engine: 'Profile workspace mounts here' },
}

type FieldPhase = 'idle' | 'loading' | 'success' | 'error'

/**
 * Per-variable "connected" (success) copy. Step 51 — the source strings now
 * live in one place (`controls/dataSources`), shared with the Data Source panel.
 */
const FIELD_SOURCE: Record<string, { tag: string; title: string }> = FIELD_STATUS_TAG

/** The small tag beside the field name, driven by the real data state — honest
 *  about loading and failure, never a "Demo" label. */
function fieldStatusTag(
  variable: string,
  phase: FieldPhase,
): { label: string; title: string } | null {
  const source = FIELD_SOURCE[variable]
  if (source === undefined) return null
  switch (phase) {
    case 'success':
      return { label: source.tag, title: source.title }
    case 'loading':
    case 'idle':
      return { label: 'Loading…', title: 'Requesting the real grid from the data API' }
    case 'error':
      return {
        label: 'Data unavailable',
        title: 'The data request to the API failed — showing the procedural view only',
      }
  }
}

interface ViewportOverlayProps {
  view: WorkspaceView
  /** Measured size of the canvas host, echoed in the scene readout. */
  size: ElementSize
}

/**
 * Heads-up readouts over the visualization.
 *
 * Reads the shared stores directly rather than taking them as props: it is a
 * sibling consumer of the same state the control panel and the location bar
 * write to, so there is exactly one copy of every value on screen.
 *
 * The bottom-left corner is the scene's *where*: the region the platform is
 * pointed at, its coordinate, whether a dataset exists for it, and a locator
 * globe placing it on Earth. It replaces the fixed coordinate the earlier
 * steps displayed — nothing on screen is hard-coded to one part of the ocean
 * any more.
 *
 * The HUD repeats the shell's grid and occupies only its centre cell, which
 * keeps the corner readouts inside the gap between the docked panels at every
 * breakpoint while the scene itself stays full-bleed behind them.
 *
 * The top-left corner's dataset tag reads the real temperature data state
 * (`useTemperatureData`, D12): "INCOIS analysis" once the D10 slices have
 * loaded, "Loading…" while they are in flight, and "Temperature data
 * unavailable" if the API request failed — never a fake "Demo" label and
 * never a silent success.
 */
export function ViewportOverlay({ view, size }: ViewportOverlayProps) {
  const state = useVisualizationState()
  const { activeRegion, availability } = useLocationState()
  const temperature = useTemperatureData()
  const salinity = useSalinityData()
  const current = useCurrentData()

  const variable = OCEAN_VARIABLE_BY_ID[state.selectedVariable]
  const status = VIEW_STATUS[view]
  const activeLayers = VISUALIZATION_LAYERS.filter((layer) => state.layers[layer.id]).length

  // Temperature (D12), salinity and surface currents (D13) all have real INCOIS
  // data behind them; chlorophyll is not selectable. The tag and the legend are
  // driven by whichever variable is selected.
  const selected = state.selectedVariable
  const fieldPhase: FieldPhase =
    selected === 'salinity'
      ? salinity.phase
      : selected === 'currentSpeed'
        ? current.phase
        : selected === 'temperature'
          ? temperature.phase
          : 'idle'
  const fieldTag = fieldStatusTag(selected, fieldPhase)

  // The legend range comes from the selected field's own real data: °C / PSU
  // from the analysis min/max, m s⁻¹ from the authoritative current speed.
  // Salinity uses the range of the real cells in this region's window (D25),
  // the same range the 3D atlas is normalised against — so the legend labels
  // match the colours in the volume. Falls back to the dataset min/max.
  const salinityRange = useMemo(() => {
    if (selected !== 'salinity' || salinity.phase !== 'success') return null
    const regional = regionScalarRange(activeRegion, salinity)
    if (regional !== null) return regional
    const { min, max } = salinity
    return min !== null && max !== null && max > min ? { min, max } : null
  }, [selected, salinity, activeRegion])

  const colorbar =
    selected === 'temperature' && temperature.phase === 'success'
      ? { min: temperature.min, max: temperature.max, unit: '°C', poles: { low: 'Cold', high: 'Warm' }, ariaLabel: 'Temperature' }
      : selected === 'salinity' && salinity.phase === 'success' && salinityRange !== null
        ? { min: salinityRange.min, max: salinityRange.max, unit: 'PSU', poles: { low: 'Fresh', high: 'Salty' }, ariaLabel: 'Salinity' }
        : selected === 'currentSpeed' && current.phase === 'success'
          ? { min: current.speedMin, max: current.speedMax, unit: 'm/s', poles: { low: 'Slow', high: 'Fast' }, ariaLabel: 'Current speed' }
          : null

  // Step 48 — the selected field's failure / empty state. The scene keeps
  // rendering underneath (the field is simply absent); this adds an honest,
  // actionable notice with a Retry that re-requests only that provider.
  let fieldError: unknown = null
  let fieldEmpty = false
  let reloadField: (() => void) | undefined
  if (selected === 'temperature') {
    reloadField = temperature.reload
    if (temperature.phase === 'error') fieldError = temperature.error
    else if (temperature.phase === 'success' && temperature.min === null && temperature.max === null)
      fieldEmpty = true
  } else if (selected === 'salinity') {
    reloadField = salinity.reload
    if (salinity.phase === 'error') fieldError = salinity.error
    else if (salinity.phase === 'success' && salinity.min === null && salinity.max === null)
      fieldEmpty = true
  } else if (selected === 'currentSpeed') {
    reloadField = current.reload
    if (current.phase === 'error') fieldError = current.error
    else if (
      current.phase === 'success' &&
      current.grid !== null &&
      current.speedMin === null &&
      current.speedMax === null
    )
      fieldEmpty = true
  }

  // Currents are surface-only: note it whenever the depth slider is off 0 m.
  const currentSurfaceNote =
    selected === 'currentSpeed' && current.phase === 'success' && state.selectedDepth > 10
      ? 'Surface currents shown at 0 m'
      : null

  const locatorMarkers = useMemo<LocatorMarker[]>(
    () => [{ id: activeRegion.id, point: activeRegion.centre }],
    [activeRegion],
  )

  // On the explore view the badge reports what is actually drawn; the other
  // workspaces have not been built yet, so they report their own mode.
  const badge = view === 'explore' && !state.layers.model ? 'Field hidden' : status.badge

  return (
    <div className={`${styles.hud} ov-app-grid`}>
      <div className={styles.frame}>
        <div className={`${styles.corner} ${styles.topLeft}`}>
          <span className={styles.variable}>
            {variable.label}
            <span className={styles.unit}>{variable.unit}</span>
            {fieldTag ? (
              <span className={styles.datasetTag} title={fieldTag.title}>
                {fieldTag.label}
              </span>
            ) : null}
          </span>
          <span className={styles.line}>
            Depth {state.selectedDepth} m
            {selected === 'currentSpeed' ? ' · surface only' : ''}
          </span>
          <span className={styles.line} title={DEMO_TIME_DATASET_NOTICE}>
            {formatDemoTimestampLong(state.selectedTime)}
          </span>
          {currentSurfaceNote ? (
            <span className={styles.line}>{currentSurfaceNote}</span>
          ) : null}
        </div>

        <div className={`${styles.corner} ${styles.topRight}`}>
          <span className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {badge}
          </span>
          <span className={styles.line}>
            {activeLayers} of {VISUALIZATION_LAYERS.length} layers
          </span>
        </div>

        <div className={styles.centre} aria-live="polite">
          <span key={view} className={styles.engine}>
            <span className={styles.engineDot} aria-hidden="true" />
            {status.engine}
          </span>
        </div>

        <div className={`${styles.corner} ${styles.bottomLeft}`}>
          <div className={styles.place}>
            <RegionLocator
              centre={activeRegion.centre}
              size={60}
              graticule={45}
              markers={locatorMarkers}
              activeId={activeRegion.id}
              label={`Locator globe centred on ${activeRegion.name}`}
            />

            <div className={styles.placeText}>
              <span className={styles.region}>{activeRegion.name}</span>
              <span className={styles.coord}>
                {formatLatitude(activeRegion.centre.latitude)}
                &nbsp;&nbsp;
                {formatLongitude(activeRegion.centre.longitude)}
              </span>
              <span className={styles.line}>Demo region&nbsp;·&nbsp;{activeRegion.note}</span>
              <AvailabilityBadge availability={availability} />
            </div>
          </div>

          <span className={`${styles.line} ${styles.scene}`}>
            {size.width > 0 ? `${size.width} × ${size.height}` : '—'} px&nbsp;·&nbsp;opacity{' '}
            {Math.round(state.opacity * 100)}%&nbsp;·&nbsp;{state.verticalExaggeration}× vertical
          </span>
        </div>

        {colorbar ? (
          <div className={styles.colorbarSlot}>
            <TemperatureColorbar
              min={colorbar.min}
              max={colorbar.max}
              unit={colorbar.unit}
              poles={colorbar.poles}
              ariaLabel={colorbar.ariaLabel}
            />
          </div>
        ) : null}

        {fieldError !== null ? (
          <div className={styles.fieldNotice}>
            <DataErrorState
              compact
              title={`${variable.label} data unavailable`}
              error={fieldError}
              onRetry={reloadField}
            />
          </div>
        ) : fieldEmpty ? (
          <div className={styles.fieldNotice}>
            <p className={styles.emptyNotice} role="status">
              No {variable.label.toLowerCase()} data available for this region and time.
            </p>
          </div>
        ) : null}

        <div
          className={`${styles.corner} ${styles.bottomRight}`}
          role="group"
          aria-label="Viewport camera gestures"
        >
          <div className={styles.hints}>
            {INTERACTIONS.map((interaction) => (
              <span key={interaction.label} className={styles.hint}>
                <span className={styles.hintKey}>{interaction.gesture}</span>
                {interaction.label}
              </span>
            ))}
          </div>
          <span className={styles.line}>R or Reset restores the view</span>
        </div>
      </div>
    </div>
  )
}
