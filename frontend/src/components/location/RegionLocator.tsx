import { useMemo } from 'react'
import type { GeoPoint } from '../../state/locationState'
import styles from './RegionLocator.module.css'

const DEGREES = Math.PI / 180

/** Degrees between samples along a graticule line. */
const SAMPLE = 4

export interface LocatorMarker {
  id: string
  point: GeoPoint
}

interface RegionLocatorProps {
  /** The globe is turned so this point faces the reader. */
  centre: GeoPoint
  /** Rendered size in pixels, square. */
  size: number
  /** Interval between graticule lines, degrees. Coarser reads better small. */
  graticule?: number
  /** Places to plot. Anything on the far side of the globe is dropped. */
  markers?: readonly LocatorMarker[]
  /** The marker drawn as the current selection. */
  activeId?: string
  /** A marker to pick out under the pointer, if any. */
  highlightId?: string
  /** Describes the picture for readers who cannot see it. */
  label: string
  className?: string
}

/** Orthographic projection of the globe as seen from above `centre`. */
function projector(centre: GeoPoint, radius: number, origin: number) {
  const centreLatitude = centre.latitude * DEGREES
  const centreLongitude = centre.longitude * DEGREES
  const sinCentre = Math.sin(centreLatitude)
  const cosCentre = Math.cos(centreLatitude)

  return (latitude: number, longitude: number): [number, number] | null => {
    const phi = latitude * DEGREES
    const delta = longitude * DEGREES - centreLongitude
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const cosDelta = Math.cos(delta)

    // Everything on the far hemisphere is behind the globe.
    if (sinCentre * sinPhi + cosCentre * cosPhi * cosDelta < 0) return null

    const x = cosPhi * Math.sin(delta)
    const y = cosCentre * sinPhi - sinCentre * cosPhi * cosDelta
    return [origin + x * radius, origin - y * radius]
  }
}

/** Joins projected samples into an SVG path, breaking it where the globe turns away. */
function polyline(points: readonly ([number, number] | null)[]): string {
  let path = ''
  let drawing = false

  for (const point of points) {
    if (point === null) {
      drawing = false
      continue
    }
    path += `${drawing ? 'L' : 'M'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`
    drawing = true
  }
  return path
}

/**
 * A locator globe — where on Earth the selected region is.
 *
 * Drawn as an orthographic graticule with a marker on it, and nothing else:
 * there is no coastline, landmass or border here, because none of that exists
 * in this application yet and drawing an approximation of it would be a claim
 * the platform cannot back. A grid and a marker answer the question a locator
 * is asked — *roughly where is this* — without pretending to answer any other.
 *
 * Plain SVG rather than a second WebGL scene: it is a few hundred line
 * segments that change only when the region does, it stays crisp at any pixel
 * ratio, and it costs the viewport nothing.
 */
export function RegionLocator({
  centre,
  size,
  graticule = 30,
  markers = [],
  activeId,
  highlightId,
  label,
  className,
}: RegionLocatorProps) {
  const origin = size / 2
  const radius = origin - 1.5

  const { grid, equator } = useMemo(() => {
    const project = projector(centre, radius, origin)
    const lines: string[] = []

    // Parallels, skipping the poles where they collapse to a point.
    for (let latitude = -90 + graticule; latitude < 90; latitude += graticule) {
      if (latitude === 0) continue
      const samples: ([number, number] | null)[] = []
      // Swept from the far side, so the seam is always the hidden hemisphere.
      for (let offset = -180; offset <= 180; offset += SAMPLE) {
        samples.push(project(latitude, centre.longitude + offset))
      }
      lines.push(polyline(samples))
    }

    // Meridians.
    for (let longitude = -180; longitude < 180; longitude += graticule) {
      const samples: ([number, number] | null)[] = []
      for (let latitude = -90; latitude <= 90; latitude += SAMPLE) {
        samples.push(project(latitude, longitude))
      }
      lines.push(polyline(samples))
    }

    const equatorSamples: ([number, number] | null)[] = []
    for (let offset = -180; offset <= 180; offset += SAMPLE) {
      equatorSamples.push(project(0, centre.longitude + offset))
    }

    return { grid: lines.join(''), equator: polyline(equatorSamples) }
  }, [centre, graticule, origin, radius])

  const plotted = useMemo(() => {
    const project = projector(centre, radius, origin)

    return markers
      .map((marker) => ({
        id: marker.id,
        position: project(marker.point.latitude, marker.point.longitude),
      }))
      .filter(
        (marker): marker is { id: string; position: [number, number] } =>
          marker.position !== null,
      )
  }, [centre, markers, origin, radius])

  return (
    <svg
      className={`${styles.locator} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
    >
      <circle className={styles.globe} cx={origin} cy={origin} r={radius} />
      <path className={styles.grid} d={grid} />
      <path className={styles.equator} d={equator} />
      <circle className={styles.limb} cx={origin} cy={origin} r={radius} />

      {plotted.map((marker) => {
        const active = marker.id === activeId
        const highlighted = marker.id === highlightId

        return (
          <g key={marker.id}>
            {active ? (
              <circle
                className={styles.halo}
                cx={marker.position[0]}
                cy={marker.position[1]}
                r={Math.max(5, size * 0.055)}
              />
            ) : null}
            <circle
              className={
                active ? styles.active : highlighted ? styles.highlight : styles.marker
              }
              cx={marker.position[0]}
              cy={marker.position[1]}
              r={active ? Math.max(2.4, size * 0.022) : Math.max(1.6, size * 0.016)}
            />
          </g>
        )
      })}
    </svg>
  )
}
