import type { ReactNode } from 'react'
import styles from './ControlField.module.css'

interface ControlFieldProps {
  label: string
  /** When set, the label becomes a real <label> bound to that control. */
  controlId?: string
  /** When set, the label element carries this id so a group can point at it. */
  labelId?: string
  value?: string
  hint?: string
  children: ReactNode
}

/**
 * Labelled row wrapper for a single control.
 *
 * Pass `controlId` for a single form control (the label is then a real
 * `<label for>`), or `labelId` when the children are a group of controls that
 * reference the label through `aria-labelledby`.
 */
export function ControlField({
  label,
  controlId,
  labelId,
  value,
  hint,
  children,
}: ControlFieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        {controlId ? (
          <label id={labelId} className={styles.label} htmlFor={controlId}>
            {label}
          </label>
        ) : (
          <span id={labelId} className={styles.label}>
            {label}
          </span>
        )}
        {value ? <span className={styles.value}>{value}</span> : null}
      </div>
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}
