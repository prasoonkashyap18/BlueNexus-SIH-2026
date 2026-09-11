/* ==================================================================== *
 *  Step 34 — profile-variable switching (pure core).
 *
 *  The observation panel plots ONE measured profile at a time — temperature
 *  or salinity — for the selected real Argo float / glider deployment. This
 *  module owns the tiny bit of logic behind that choice so it can be
 *  unit-tested with no renderer:
 *
 *   - the allowed values and the default
 *   - the display labels for the switcher
 *   - `otherProfileVariable` (the keyboard-toggle target)
 *   - `resolveProfileVariableSelection` — resets the choice to the default
 *     whenever the selected observation changes, so a variable picked for one
 *     platform never carries onto the next.
 *
 *  This is UI state only. It is unrelated to — and must not touch — the global
 *  3D ocean-variable selector (`visualizationState.ts`). No data is read,
 *  fetched or transformed here.
 * ==================================================================== */

export const PROFILE_VARIABLES = ['temperature', 'salinity'] as const

export type ProfileVariable = (typeof PROFILE_VARIABLES)[number]

/** The panel opens on the temperature profile (Step 32 behaviour). */
export const DEFAULT_PROFILE_VARIABLE: ProfileVariable = 'temperature'

/** Switcher labels — native to this control, not shared with the 3D selector. */
export const PROFILE_VARIABLE_LABEL: Record<ProfileVariable, string> = {
  temperature: 'Temperature',
  salinity: 'Salinity',
}

export function isProfileVariable(value: unknown): value is ProfileVariable {
  return value === 'temperature' || value === 'salinity'
}

/** The other variable — used by the switcher's arrow-key toggle. */
export function otherProfileVariable(variable: ProfileVariable): ProfileVariable {
  return variable === 'temperature' ? 'salinity' : 'temperature'
}

/** Which observation a variable choice belongs to. */
export interface ProfileVariableSelection {
  /** The selected platform id, or `null` when nothing is selected. */
  observationKey: string | null
  variable: ProfileVariable
}

export function initialProfileVariableSelection(
  observationKey: string | null,
): ProfileVariableSelection {
  return { observationKey, variable: DEFAULT_PROFILE_VARIABLE }
}

/**
 * The selection to use for `observationKey`.
 *
 *  - same observation  → `prev` unchanged (referentially equal — the caller can
 *    bail out of a state update).
 *  - different (or first) observation → a fresh selection on
 *    `DEFAULT_PROFILE_VARIABLE`, so a variable chosen for the previous platform
 *    is never shown for the new one.
 */
export function resolveProfileVariableSelection(
  prev: ProfileVariableSelection,
  observationKey: string | null,
): ProfileVariableSelection {
  if (prev.observationKey === observationKey) return prev
  return initialProfileVariableSelection(observationKey)
}
