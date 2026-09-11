import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocationControls, useLocationState, type OceanRegion } from '../../state/locationState'
import { LocationSearch } from './LocationSearch'
import { RegionPresets } from './RegionPresets'
import styles from './LocationBar.module.css'

/**
 * The location control: search on the left, the region catalogue behind one
 * button on the right.
 *
 * It floats over the top of the viewport rather than docking into a panel,
 * because it drives *where* the platform is looking and every panel around it
 * describes what is being drawn there. Compact by design — this is the first
 * of the platform's stages (find a place, then find its data), and it should
 * not grow into a map browser that competes with the water column for the
 * screen.
 */
export function LocationBar() {
  const { activeRegion } = useLocationState()
  const { selectRegion } = useLocationControls()

  const [presetsOpen, setPresetsOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const presetsId = useId()
  const labelId = useId()

  const handleSelect = useCallback(
    (region: OceanRegion) => {
      selectRegion(region)
      setPresetsOpen(false)
    },
    [selectRegion],
  )

  // Dismiss the catalogue the way every other popover on the web dismisses:
  // a click outside it, or Escape.
  useEffect(() => {
    if (!presetsOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && barRef.current?.contains(target)) return
      setPresetsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresetsOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [presetsOpen])

  return (
    <div className={styles.bar} ref={barRef}>
      <LocationSearch onSelect={handleSelect} />

      <span className={styles.divider} aria-hidden="true" />

      <button
        type="button"
        className={`${styles.regions} ${presetsOpen ? styles.regionsOn : ''}`}
        aria-expanded={presetsOpen}
        aria-controls={presetsId}
        title="Demo ocean regions"
        onClick={() => setPresetsOpen((open) => !open)}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.4" />
          <ellipse cx="12" cy="12" rx="3.6" ry="8.4" />
          <path d="M3.9 9.2h16.2M3.9 14.8h16.2" />
        </svg>
        <span className={styles.regionsLabel}>Regions</span>
      </button>

      {presetsOpen ? (
        <div className={styles.catalogue} id={presetsId}>
          <RegionPresets
            activeRegion={activeRegion}
            onSelect={handleSelect}
            labelId={labelId}
          />
        </div>
      ) : null}
    </div>
  )
}
