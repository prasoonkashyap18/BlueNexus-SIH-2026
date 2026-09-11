import { useMemo } from 'react'
import { temperatureRampCssGradient } from './scene/temperatureField'
import styles from './TemperatureColorbar.module.css'

interface ColorbarTick {
  value: number
  /** 0 at the range minimum, 1 at the maximum — position along the bar. */
  fraction: number
}

/**
 * A handful of evenly-spaced, round-number ticks between `min` and `max`.
 *
 * Mirrors the classic "nice ticks" approach (round the step to 1/2/5 x a
 * power of ten) rather than dividing the range into N equal, ugly slices —
 * so a range spanning roughly 2-33°C reads as 5, 10, 15, 20, 25, 30 and
 * relabels itself for whatever range the real data produces.
 */
function niceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!(max > min)) return [min]

  const rawStep = (max - min) / targetCount
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  const step = niceResidual * magnitude

  const ticks: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    ticks.push(Math.round(value * 10) / 10)
  }
  return ticks
}

interface FieldColorbarProps {
  /** Range minimum in the field's own units. `null` → a `0-1` placeholder. */
  min: number | null
  /** Range maximum in the field's own units. `null` → a `0-1` placeholder. */
  max: number | null
  /** Display unit — formatting only, never a conversion (`°C` / `PSU` / `m/s`). */
  unit: string
  /** Cold / warm pole labels, top-down. Defaults to the temperature framing. */
  poles?: { low: string; high: string }
  /** Spoken name of the quantity, for the aria label. */
  ariaLabel?: string
}

/**
 * Compact legend for the scalar colour mapping used inside the 3D ocean volume
 * (`temperatureField.ts`).
 *
 * The same shared ramp (`TEMPERATURE_RAMP_STOPS` → `temperatureRampCssGradient()`)
 * colours temperature (D12), salinity (D13) and current speed (D13): it is a
 * neutral cold→warm / low→high ramp. The min/max/tick labels come from the
 * **real** data's own range — the normalisation the shader / vector layer uses.
 * Nothing here hard-codes a value, and the `unit` is display formatting only —
 * the underlying numbers are never converted.
 *
 * `ViewportOverlay` only mounts this once the data has loaded, so `min`/`max`
 * are normally finite — but it degrades to a `0-1` placeholder rather than
 * throwing if that ever changes.
 */
export function TemperatureColorbar({
  min: rawMin,
  max: rawMax,
  unit,
  poles = { low: 'Cold', high: 'Warm' },
  ariaLabel = 'Temperature',
}: FieldColorbarProps) {
  const min = rawMin ?? 0
  const max = rawMax ?? 1

  const gradient = useMemo(() => temperatureRampCssGradient('to top'), [])

  const ticks = useMemo<ColorbarTick[]>(() => {
    const span = max - min
    return niceTicks(min, max).map((value) => ({
      value,
      fraction: span > 0 ? (value - min) / span : 0,
    }))
  }, [min, max])

  return (
    <div
      className={styles.colorbar}
      role="img"
      aria-label={`${ariaLabel} colour scale, ${min.toFixed(1)} to ${max.toFixed(1)} ${unit}, low to high`}
    >
      <span className={styles.pole}>{poles.high}</span>

      <div className={styles.body}>
        <span className={styles.endValue}>
          {max.toFixed(1)}
          <span className={styles.unit}>{unit}</span>
        </span>

        <div className={styles.track}>
          <div className={styles.gradient} style={{ background: gradient }} aria-hidden="true" />
          {ticks.map((tick) => (
            <div key={tick.value} className={styles.tick} style={{ bottom: `${tick.fraction * 100}%` }}>
              <span className={styles.tickMark} aria-hidden="true" />
              <span className={styles.tickLabel}>{tick.value}</span>
            </div>
          ))}
        </div>

        <span className={styles.endValue}>
          {min.toFixed(1)}
          <span className={styles.unit}>{unit}</span>
        </span>
      </div>

      <span className={styles.pole}>{poles.low}</span>
    </div>
  )
}
