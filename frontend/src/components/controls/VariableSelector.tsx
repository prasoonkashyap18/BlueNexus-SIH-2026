import { useId } from 'react'
import { OCEAN_VARIABLES, type OceanVariable, type OceanVariableMeta } from '../../state/visualizationState'
import { ControlField } from './ControlField'
import styles from './VariableSelector.module.css'

interface VariableSelectorProps {
  value: OceanVariable
  onChange: (variable: OceanVariable) => void
  /** Defaults to the full catalogue; narrowed per view in later steps. */
  options?: readonly OceanVariableMeta[]
  label?: string
}

/**
 * Scalar field selector. Driven entirely by the options it is handed, so the
 * same component serves the explore panel today and any per-view subset of
 * variables later.
 */
export function VariableSelector({
  value,
  onChange,
  options = OCEAN_VARIABLES,
  label = 'Variable',
}: VariableSelectorProps) {
  const id = useId()
  const selected = options.find((option) => option.id === value)

  return (
    <ControlField label={label} controlId={id} value={selected?.unit} hint={selected?.hint}>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(event) => onChange(event.target.value as OceanVariable)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </ControlField>
  )
}
