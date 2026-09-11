import { createContext, useContext } from 'react'
import { DEMO_TIMESTAMPS, formatDemoTimestampLong } from '../data/demoTimeDataset.ts'

/* ------------------------------------------------------------------ *
 * Domain
 * ------------------------------------------------------------------ */

export type OceanVariable = 'temperature' | 'salinity' | 'currentSpeed' | 'chlorophyll'

export interface OceanVariableMeta {
  id: OceanVariable
  label: string
  /** Display unit — shown beside the field name once values are rendered. */
  unit: string
  hint: string
}

export const OCEAN_VARIABLES: readonly OceanVariableMeta[] = [
  {
    id: 'temperature',
    label: 'Temperature',
    unit: '°C',
    hint: 'Potential temperature of the water column',
  },
  {
    id: 'salinity',
    label: 'Salinity',
    unit: 'PSU',
    hint: 'Practical salinity of the water column',
  },
  {
    id: 'currentSpeed',
    label: 'Current',
    unit: 'm s⁻¹',
    hint: 'Surface current — direction from U/V, speed from CURRENT (INCOIS IO-HOOFS forecast)',
  },
  {
    id: 'chlorophyll',
    label: 'Chlorophyll',
    unit: 'mg m⁻³',
    hint: 'Chlorophyll-a concentration',
  },
]

/**
 * The variables the UI actually lets a reader pick.
 *
 * Chlorophyll is intentionally absent: there is no verified public
 * machine-readable INCOIS chlorophyll series yet, so the selector must never
 * imply it is available (D13 §22). `chlorophyll` stays in `OceanVariable` /
 * `OCEAN_VARIABLES` only so lookups by id stay total; it is not selectable.
 *
 * Temperature and salinity are real INCOIS Argo analysis fields (D12 / D13);
 * "Current" is the real INCOIS IO-HOOFS surface-current forecast (D13),
 * presented as one layer that internally uses `current_u` / `current_v` /
 * `current_speed`.
 */
export const SELECTABLE_OCEAN_VARIABLES: readonly OceanVariableMeta[] = OCEAN_VARIABLES.filter(
  (variable) => variable.id !== 'chlorophyll',
)

/**
 * Metadata by id, for consumers that hold only the selected variable — the
 * viewport overlay and, later, the scene's colour-map lookup.
 */
export const OCEAN_VARIABLE_BY_ID = Object.fromEntries(
  OCEAN_VARIABLES.map((variable) => [variable.id, variable]),
) as Record<OceanVariable, OceanVariableMeta>

export type LayerId = 'model' | 'argo' | 'gliders' | 'bathymetry'

export interface LayerMeta {
  id: LayerId
  label: string
  hint: string
}

export const VISUALIZATION_LAYERS: readonly LayerMeta[] = [
  { id: 'model', label: 'Ocean Model', hint: 'Numerical model field' },
  { id: 'argo', label: 'Argo Floats', hint: 'Argo profiling float positions' },
  { id: 'gliders', label: 'Gliders', hint: 'Glider tracks and surfacings' },
  { id: 'bathymetry', label: 'Bathymetry', hint: 'Sea-floor topography' },
]

/**
 * The temporal axis the whole visualization selects against.
 *
 * This is the DEMO/SAMPLE time dataset from Step 21 (`data/demoTimeDataset.ts`)
 * — an ordered list of opaque time identifiers, not a fixed window. It is the
 * single source of truth for time: the left time stepper, the centre HUD
 * date and the bottom timeline all derive their display from the one
 * `selectedTime` that indexes into this array, and the data providers map
 * that same index onto their real time coordinate.
 *
 * Re-exported here (rather than imported directly everywhere) so the many
 * existing `TIME_STEPS` consumers keep working unchanged when the demo axis
 * is swapped for a real one.
 */
export const TIME_STEPS: readonly string[] = DEMO_TIMESTAMPS

/**
 * `2026-07-10` → `10 Jul 2026`.
 *
 * A stable re-export of the demo dataset's long formatter, kept under this
 * name for callers that format an ISO calendar date outside the time axis
 * (the observation panel's profile date, for one).
 */
export const formatTimeStep = formatDemoTimestampLong

/** Bounds for the numeric controls, kept next to the state they constrain. */
export const DEPTH_RANGE = { min: 0, max: 5000, step: 10 } as const
export const OPACITY_RANGE = { min: 0, max: 100, step: 1 } as const
export const EXAGGERATION_RANGE = { min: 1, max: 10, step: 1 } as const

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface VisualizationState {
  selectedVariable: OceanVariable
  /** Depth below the surface, in metres. */
  selectedDepth: number
  /** One of TIME_STEPS. */
  selectedTime: string
  /** Normalised 0–1. The UI presents this as a percentage. */
  opacity: number
  /** Multiplier applied to the vertical axis of the scene. */
  verticalExaggeration: number
  layers: Record<LayerId, boolean>
}

export const DEFAULT_VISUALIZATION_STATE: VisualizationState = {
  selectedVariable: 'temperature',
  selectedDepth: 100,
  selectedTime: TIME_STEPS[0],
  opacity: 0.7,
  verticalExaggeration: 3,
  layers: {
    model: true,
    argo: true,
    gliders: true,
    bathymetry: false,
  },
}

export interface VisualizationActions {
  setVariable: (variable: OceanVariable) => void
  /** Metres. */
  setDepth: (depth: number) => void
  setTime: (time: string) => void
  /** Normalised 0–1. */
  setOpacity: (opacity: number) => void
  setVerticalExaggeration: (factor: number) => void
  setLayer: (layer: LayerId, visible: boolean) => void
  toggleLayer: (layer: LayerId) => void
  /** Restores every control to DEFAULT_VISUALIZATION_STATE. */
  reset: () => void
}

export interface VisualizationContextValue {
  state: VisualizationState
  actions: VisualizationActions
}

export const VisualizationContext = createContext<VisualizationContextValue | null>(null)

function useVisualizationContext(hook: string): VisualizationContextValue {
  const value = useContext(VisualizationContext)
  if (value === null) {
    throw new Error(`${hook} must be used inside <VisualizationProvider>`)
  }
  return value
}

/**
 * Read the shared visualization state. This is the hook the 3D scene, the
 * comparison view and the profile view will call — they need the values, not
 * the setters.
 */
export function useVisualizationState(): VisualizationState {
  return useVisualizationContext('useVisualizationState').state
}

/** Mutate the shared visualization state. Used by the control surfaces. */
export function useVisualizationControls(): VisualizationActions {
  return useVisualizationContext('useVisualizationControls').actions
}

/** True when every control still holds its default value. */
export function isDefaultState(state: VisualizationState): boolean {
  const defaults = DEFAULT_VISUALIZATION_STATE
  return (
    state.selectedVariable === defaults.selectedVariable &&
    state.selectedDepth === defaults.selectedDepth &&
    state.selectedTime === defaults.selectedTime &&
    state.opacity === defaults.opacity &&
    state.verticalExaggeration === defaults.verticalExaggeration &&
    VISUALIZATION_LAYERS.every(({ id }) => state.layers[id] === defaults.layers[id])
  )
}
