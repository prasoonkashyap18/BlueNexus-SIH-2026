import { useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_VISUALIZATION_STATE,
  VisualizationContext,
  type LayerId,
  type OceanVariable,
  type VisualizationActions,
  type VisualizationState,
} from './visualizationState'

interface VisualizationProviderProps {
  children: ReactNode
  /** Overrides the defaults — used by tests and by deep links later on. */
  initialState?: VisualizationState
}

/**
 * Owns the shared visualization state for the whole application.
 *
 * Everything the ocean scene needs to draw a frame lives here, so the control
 * panel and the (future) 3D scene never talk to each other directly — they
 * both talk to this store. Swapping `useState` for a reducer, URL sync or a
 * server-driven store later is a change confined to this file.
 */
export function VisualizationProvider({
  children,
  initialState = DEFAULT_VISUALIZATION_STATE,
}: VisualizationProviderProps) {
  const [state, setState] = useState<VisualizationState>(initialState)

  // Every action uses a functional update, so the object is stable for the
  // lifetime of the provider and never invalidates a consumer's memo.
  const actions = useMemo<VisualizationActions>(
    () => ({
      setVariable: (selectedVariable: OceanVariable) =>
        setState((current) => ({ ...current, selectedVariable })),

      setDepth: (selectedDepth: number) =>
        setState((current) => ({ ...current, selectedDepth })),

      setTime: (selectedTime: string) =>
        setState((current) => ({ ...current, selectedTime })),

      setOpacity: (opacity: number) => setState((current) => ({ ...current, opacity })),

      setVerticalExaggeration: (verticalExaggeration: number) =>
        setState((current) => ({ ...current, verticalExaggeration })),

      setLayer: (layer: LayerId, visible: boolean) =>
        setState((current) => ({
          ...current,
          layers: { ...current.layers, [layer]: visible },
        })),

      toggleLayer: (layer: LayerId) =>
        setState((current) => ({
          ...current,
          layers: { ...current.layers, [layer]: !current.layers[layer] },
        })),

      reset: () => setState(DEFAULT_VISUALIZATION_STATE),
    }),
    [],
  )

  const value = useMemo(() => ({ state, actions }), [state, actions])

  return <VisualizationContext value={value}>{children}</VisualizationContext>
}
