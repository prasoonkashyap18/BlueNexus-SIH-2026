import { useCallback, useState } from 'react'
import {
  DEFAULT_PROFILE_VARIABLE,
  initialProfileVariableSelection,
  resolveProfileVariableSelection,
  type ProfileVariable,
  type ProfileVariableSelection,
} from '../components/observation/profileVariable'

/* ==================================================================== *
 *  Step 34 — the observation panel's profile-variable UI state.
 *
 *  Local component state, nothing global: which measured profile
 *  (temperature | salinity) the panel is showing for the currently selected
 *  observation. Defaults to temperature and resets to it whenever
 *  `observationKey` changes, so switching platforms never carries a stale
 *  variable across (React's documented "adjust state during render" pattern —
 *  `resolveProfileVariableSelection` returns the same reference when the key is
 *  unchanged, so the extra `setSelection` is a no-op bail-out).
 * ==================================================================== */

export function useProfileVariable(
  observationKey: string | null,
): readonly [ProfileVariable, (variable: ProfileVariable) => void] {
  const [selection, setSelection] = useState<ProfileVariableSelection>(() =>
    initialProfileVariableSelection(observationKey),
  )

  const resolved = resolveProfileVariableSelection(selection, observationKey)
  if (resolved !== selection) {
    setSelection(resolved)
  }

  const setVariable = useCallback((variable: ProfileVariable) => {
    setSelection((current) =>
      current.variable === variable ? current : { ...current, variable },
    )
  }, [])

  return [resolved.variable, setVariable] as const
}

export { DEFAULT_PROFILE_VARIABLE }
