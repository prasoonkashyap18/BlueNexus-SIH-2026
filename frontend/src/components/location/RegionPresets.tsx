import { useMemo, useState } from 'react'
import { DEMO_REGION_NOTICE, OCEAN_REGIONS } from '../../data/oceanRegions'
import { formatGeoPoint, type OceanRegion } from '../../state/locationState'
import { AvailabilityBadge } from './AvailabilityBadge'
import { RegionLocator, type LocatorMarker } from './RegionLocator'
import styles from './RegionPresets.module.css'

interface RegionPresetsProps {
  activeRegion: OceanRegion
  onSelect: (region: OceanRegion) => void
  /** Id of the heading that names the region group. */
  labelId: string
}

/**
 * The demo regions, with a locator showing where each of them is.
 *
 * The presets are the shortcut for a reader who does not yet know what to
 * search for — which is most of them, the first time. Pairing the list with a
 * globe answers the question the list on its own cannot: not what the regions
 * are called, but how far apart they are and which part of the world each one
 * belongs to.
 */
export function RegionPresets({ activeRegion, onSelect, labelId }: RegionPresetsProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  // A searched coordinate is not in the catalogue, so it is added to the
  // globe on its own — the locator should never lose the active region.
  const markers = useMemo<LocatorMarker[]>(() => {
    const catalogue = OCEAN_REGIONS.map((region) => ({
      id: region.id,
      point: region.centre,
    }))

    return OCEAN_REGIONS.some((region) => region.id === activeRegion.id)
      ? catalogue
      : [...catalogue, { id: activeRegion.id, point: activeRegion.centre }]
  }, [activeRegion])

  return (
    <div className={styles.presets}>
      <div className={styles.locator}>
        <RegionLocator
          centre={activeRegion.centre}
          size={148}
          markers={markers}
          activeId={activeRegion.id}
          highlightId={hovered ?? undefined}
          label={`Locator globe centred on ${activeRegion.name}`}
        />
        <span className={styles.caption}>{activeRegion.name}</span>
        <span className={styles.coordinates}>{formatGeoPoint(activeRegion.centre)}</span>
      </div>

      <div className={styles.catalogue}>
        <span className="ov-eyebrow" id={labelId}>
          Explore regions
        </span>

        <div className={`${styles.list} ov-scroll`} role="group" aria-labelledby={labelId}>
          {OCEAN_REGIONS.map((region) => {
            const active = region.id === activeRegion.id

            return (
              <button
                key={region.id}
                type="button"
                className={`${styles.region} ${active ? styles.regionOn : ''}`}
                aria-pressed={active}
                onMouseEnter={() => setHovered(region.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(region.id)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelect(region)}
              >
                <span className={styles.name}>{region.name}</span>
                <AvailabilityBadge availability={region.availability} compact />
                <span className={styles.meta}>{formatGeoPoint(region.centre)}</span>
              </button>
            )
          })}
        </div>

        <p className={styles.notice}>{DEMO_REGION_NOTICE}</p>
      </div>
    </div>
  )
}
