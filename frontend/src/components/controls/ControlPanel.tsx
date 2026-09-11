import { useCallback, useId } from 'react'
import { Panel } from '../layout/Panel'
import { useCameraView, useCameraViewControls } from '../../state/cameraViewState'
import {
  DEPTH_RANGE,
  EXAGGERATION_RANGE,
  OPACITY_RANGE,
  SELECTABLE_OCEAN_VARIABLES,
  TIME_STEPS,
  VISUALIZATION_LAYERS,
  isDefaultState,
  useVisualizationControls,
  useVisualizationState,
} from '../../state/visualizationState'
import { ControlField } from './ControlField'
import { DataSourcePanel } from './DataSourcePanel'
import { LayerToggle } from './LayerToggle'
import { RangeControl } from './RangeControl'
import { TimeStepControl } from './TimeStepControl'
import { VariableSelector } from './VariableSelector'
import styles from './ControlPanel.module.css'

const formatDepth = (metres: number) => `${metres} m`
const formatPercent = (percent: number) => `${percent}%`
const formatFactor = (factor: number) => `${factor}×`

/**
 * Left control panel.
 *
 * Holds no state of its own — every control reads from and writes to the
 * shared visualization store, so the values here are already the ones the 3D
 * scene renders from.
 *
 * Reset is the one control that spans two stores. Restoring the parameters
 * without restoring the camera leaves the reader looking at default values
 * from wherever they happened to have orbited to, which is not the state they
 * asked for — so the button drives the visualization store and the camera
 * store together, and stays live while *either* of them is off its default.
 */
export function ControlPanel() {
  const state = useVisualizationState()
  const controls = useVisualizationControls()
  const { atHome } = useCameraView()
  const { resetView } = useCameraViewControls()
  const layersLabelId = useId()

  const atDefaults = isDefaultState(state)
  const atRest = atDefaults && atHome

  const handleReset = useCallback(() => {
    controls.reset()
    resetView()
  }, [controls, resetView])

  return (
    <Panel
      eyebrow="Controls"
      title="Visualization Parameters"
      actions={
        <button
          type="button"
          className={styles.reset}
          onClick={handleReset}
          disabled={atRest}
          title={
            atRest
              ? 'Every control and the view are already at their defaults'
              : 'Restore every control and the 3D view to their defaults'
          }
        >
          Reset
        </button>
      }
    >
      <VariableSelector
        value={state.selectedVariable}
        onChange={controls.setVariable}
        options={SELECTABLE_OCEAN_VARIABLES}
      />

      {/* Step 51 — which real dataset supplies the selected variable / observation. */}
      <DataSourcePanel />

      <TimeStepControl
        value={state.selectedTime}
        steps={TIME_STEPS}
        onChange={controls.setTime}
      />

      <RangeControl
        label="Depth"
        value={state.selectedDepth}
        min={DEPTH_RANGE.min}
        max={DEPTH_RANGE.max}
        step={DEPTH_RANGE.step}
        onChange={controls.setDepth}
        format={formatDepth}
        hint="Horizontal slice through the water column"
      />

      <RangeControl
        label="Opacity"
        value={Math.round(state.opacity * 100)}
        min={OPACITY_RANGE.min}
        max={OPACITY_RANGE.max}
        step={OPACITY_RANGE.step}
        onChange={(percent) => controls.setOpacity(percent / 100)}
        format={formatPercent}
      />

      <RangeControl
        label="Vertical exaggeration"
        value={state.verticalExaggeration}
        min={EXAGGERATION_RANGE.min}
        max={EXAGGERATION_RANGE.max}
        step={EXAGGERATION_RANGE.step}
        onChange={controls.setVerticalExaggeration}
        format={formatFactor}
        hint="Amplifies bathymetry and isosurfaces for readability"
      />

      <ControlField label="Visualization layers" labelId={layersLabelId}>
        <div className={styles.layers} role="group" aria-labelledby={layersLabelId}>
          {VISUALIZATION_LAYERS.map((layer) => (
            <LayerToggle
              key={layer.id}
              label={layer.label}
              hint={layer.hint}
              checked={state.layers[layer.id]}
              onChange={(visible) => controls.setLayer(layer.id, visible)}
            />
          ))}
        </div>
      </ControlField>

      <p className={styles.note}>
        Controls drive the shared visualization state, which the 3D scene renders from.
        Reset also returns the camera to its default framing — as does pressing R over
        the viewport.
      </p>
    </Panel>
  )
}
