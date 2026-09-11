import { useId, type CSSProperties } from 'react'
import { ControlField } from './ControlField'
import styles from './RangeControl.module.css'

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /**
   * Formats the value for display. Also used for `aria-valuetext` and for the
   * track's end labels, so a slider always announces units rather than a bare
   * number.
   */
  format: (value: number) => string
  hint?: string
}

/**
 * Reusable numeric slider — the shape shared by depth, opacity and vertical
 * exaggeration. Keeps native `<input type="range">` semantics (arrow keys,
 * Home/End, Page Up/Down all work for free) and paints the filled portion of
 * the track from a `--fill` custom property.
 */
export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: RangeControlProps) {
  const id = useId()
  const display = format(value)
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100

  return (
    <ControlField label={label} controlId={id} value={display} hint={hint}>
      <input
        id={id}
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className={styles.bounds} aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </ControlField>
  )
}
