import { useEffect, useRef, useState } from 'react'
import {
  DEMO_TIMESTAMP_TIME_OF_DAY,
  DEMO_TIME_DATASET_NOTICE,
  formatDemoTimestampStacked,
  formatDemoTimestampTick,
} from '../../data/demoTimeDataset'
import {
  TIME_STEPS,
  useVisualizationControls,
  useVisualizationState,
} from '../../state/visualizationState'
import styles from './TimelineBar.module.css'

const SPEEDS = ['1×', '4×', '12×']

/** Dwell on each timestamp at the "1×" speed, in ms. Higher speeds divide it. */
const BASE_TICK_MS = 1600

/** `'4×'` → 4. Anything unexpected falls back to 1×. */
function speedMultiplier(label: string): number {
  const value = Number.parseFloat(label)
  return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * Bottom temporal navigation.
 *
 * Step 22: the scrubber and the date read-out are bound to the shared
 * `selectedTime` — the same state the left time stepper and the centre HUD
 * derive from — so all three stay in lock-step. The scrubber commits whole
 * timestamp indices only (no interpolation); during a drag the handle glides
 * under the pointer (`dragValue`) and settles onto the selected timestamp on
 * release.
 *
 * Step 23: the existing Play button now runs a single `setInterval` that
 * advances `selectedTime` to the next demo timestamp, wrapping past the last
 * one back to the first, through the same `setTime` mechanism the slider
 * uses. Pause clears the interval and leaves `selectedTime` where it is. The
 * speed buttons pick the interval length (`1× / 4× / 12×`). There is no
 * second time state and never more than one interval — the timer reads the
 * live index through a ref, so a manual drag mid-play just moves where the
 * next tick continues from. This animates the DEMO time axis only; it is not
 * a real-time ocean feed.
 */
export function TimelineBar() {
  const { selectedTime } = useVisualizationState()
  const { setTime } = useVisualizationControls()

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(SPEEDS[0])
  /** Fractional handle position while dragging; `null` when the handle is at rest. */
  const [dragValue, setDragValue] = useState<number | null>(null)

  const lastIndex = TIME_STEPS.length - 1
  const selectedIndex = Math.max(0, TIME_STEPS.indexOf(selectedTime))
  const handleValue = dragValue ?? selectedIndex

  // The animation timer reads the live selection through this ref, so one
  // interval can advance from wherever time currently is — including a spot
  // the user just dragged to — without being recreated on every tick.
  const indexRef = useRef(selectedIndex)
  useEffect(() => {
    indexRef.current = selectedIndex
  }, [selectedIndex])

  useEffect(() => {
    if (!playing) return

    const tickMs = Math.max(60, Math.round(BASE_TICK_MS / speedMultiplier(speed)))
    const timer = window.setInterval(() => {
      const next = TIME_STEPS[(indexRef.current + 1) % TIME_STEPS.length]
      if (next !== undefined) setTime(next)
    }, tickMs)

    return () => window.clearInterval(timer)
  }, [playing, speed, setTime])

  /** Round an arbitrary handle position to a timestamp index and select it. */
  const commitIndex = (raw: number) => {
    const index = Math.min(Math.max(Math.round(raw), 0), lastIndex)
    const next = TIME_STEPS[index]
    if (next !== undefined && next !== selectedTime) setTime(next)
  }

  const onScrub = (raw: number) => {
    setDragValue(raw)
    commitIndex(raw)
  }

  /** Handle comes to rest — drop the drag position so it sits on the tick. */
  const endScrub = () => setDragValue(null)

  const stepBy = (delta: number) => {
    setDragValue(null)
    commitIndex(selectedIndex + delta)
  }

  return (
    <div className={styles.bar}>
      <div className={styles.transport}>
        <button
          type="button"
          className={styles.play}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
          aria-pressed={playing}
          title={playing ? 'Pause' : 'Play through the demo timestamps'}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className={styles.clock} title={DEMO_TIME_DATASET_NOTICE}>
          <span className={styles.date}>{formatDemoTimestampStacked(selectedTime)}</span>
          <span className={styles.time}>{DEMO_TIMESTAMP_TIME_OF_DAY}</span>
        </div>
      </div>

      <div className={styles.track}>
        <input
          type="range"
          className={styles.scrub}
          min={0}
          max={lastIndex}
          step="any"
          value={handleValue}
          onChange={(e) => onScrub(Number(e.target.value))}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onBlur={endScrub}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault()
              stepBy(-1)
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault()
              stepBy(1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              stepBy(-lastIndex)
            } else if (e.key === 'End') {
              e.preventDefault()
              stepBy(lastIndex)
            }
          }}
          aria-label="Timeline position"
          aria-valuetext={formatDemoTimestampStacked(selectedTime)}
        />
        <div className={styles.ticks} aria-hidden="true">
          {TIME_STEPS.map((step) => (
            <span key={step}>{formatDemoTimestampTick(step)}</span>
          ))}
        </div>
      </div>

      <div className={styles.speed} role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.speedBtn} ${s === speed ? styles.speedOn : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
