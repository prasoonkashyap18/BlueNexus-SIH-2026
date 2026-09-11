import { useRef, type KeyboardEvent } from 'react'
import {
  PROFILE_VARIABLES,
  PROFILE_VARIABLE_LABEL,
  otherProfileVariable,
  type ProfileVariable,
} from './profileVariable'
import styles from './ProfileVariableSwitcher.module.css'

interface ProfileVariableSwitcherProps {
  value: ProfileVariable
  onChange: (variable: ProfileVariable) => void
  /** Id of the element naming this group. */
  labelId: string
}

/**
 * Step 34 — chooses which measured profile the observation panel plots:
 * Temperature or Salinity. A compact radio group (both options describe the
 * same selected platform; they do not switch between panels of content).
 *
 * This is the profile section's own control — it has nothing to do with the
 * global 3D ocean-variable selector.
 */
export function ProfileVariableSwitcher({
  value,
  onChange,
  labelId,
}: ProfileVariableSwitcherProps) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowUp':
        break
      default:
        return
    }
    event.preventDefault()
    const next = otherProfileVariable(value)
    onChange(next)
    buttonsRef.current[PROFILE_VARIABLES.indexOf(next)]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className={styles.group}
      onKeyDown={handleKeyDown}
    >
      {PROFILE_VARIABLES.map((variable, index) => {
        const selected = variable === value
        return (
          <button
            key={variable}
            ref={(node) => {
              buttonsRef.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`${styles.option} ${selected ? styles.optionOn : ''}`}
            onClick={() => onChange(variable)}
          >
            {PROFILE_VARIABLE_LABEL[variable]}
          </button>
        )
      })}
    </div>
  )
}
