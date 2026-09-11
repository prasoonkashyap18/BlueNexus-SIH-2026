import { useId } from 'react'
import { ControlField } from './ControlField'
import styles from './TimeStepControl.module.css'

interface TimeStepControlProps {
  value: string
  steps: readonly string[]
  onChange: (time: string) => void
  label?: string
}

/**
 * Steps through the discrete times available in the dataset.
 *
 * A stepper rather than a slider: the temporal axis is a short ordered list of
 * real acquisition times, not a continuous range, and each one needs to be
 * readable. Scales to a longer axis without changing shape.
 */
export function TimeStepControl({
  value,
  steps,
  onChange,
  label = 'Time',
}: TimeStepControlProps) {
  const labelId = useId()
  const index = steps.indexOf(value)
  const atStart = index <= 0
  const atEnd = index < 0 || index >= steps.length - 1

  const go = (delta: number) => {
    const next = steps[index + delta]
    if (next !== undefined) onChange(next)
  }

  return (
    <ControlField
      label={label}
      labelId={labelId}
      value={index < 0 ? '—' : `${index + 1} / ${steps.length}`}
    >
      <div className={styles.stepper} role="group" aria-labelledby={labelId}>
        <button
          type="button"
          className={styles.step}
          onClick={() => go(-1)}
          disabled={atStart}
          aria-label="Previous time step"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14 6-6 6 6 6" />
          </svg>
        </button>

        <span className={styles.value} aria-live="polite">
          {value}
        </span>

        <button
          type="button"
          className={styles.step}
          onClick={() => go(1)}
          disabled={atEnd}
          aria-label="Next time step"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m10 6 6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className={styles.ticks} aria-hidden="true">
        {steps.map((step, i) => (
          <span key={step} className={i === index ? styles.tickOn : styles.tick} />
        ))}
      </div>
    </ControlField>
  )
}
