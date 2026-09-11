import { createContext, useContext } from 'react'

/* ------------------------------------------------------------------ *
 * Domain
 * ------------------------------------------------------------------ */

export interface GeoPoint {
  /** Degrees north of the equator, -90 to 90. */
  latitude: number
  /** Degrees east of the prime meridian, -180 to 180. */
  longitude: number
}

/** What kind of place a region is — used for grouping and for its icon. */
export type RegionKind = 'sea' | 'ocean' | 'coordinates'

/**
 * Whether a dataset exists for the selected region.
 *
 * A placeholder for the catalogue stage of the workflow (search → locate →
 * *check data* → select dataset → load), which is not built yet. Nothing
 * queries a catalogue today: `available` and `unavailable` come from static
 * demo metadata, and `loading` is rendered but never set, so the component
 * that eventually performs the check has a state to move through rather than
 * a new one to introduce.
 */
export type DataAvailability = 'available' | 'loading' | 'unavailable'

export interface AvailabilityMeta {
  id: DataAvailability
  label: string
  hint: string
}

export const DATA_AVAILABILITY: Record<DataAvailability, AvailabilityMeta> = {
  available: {
    id: 'available',
    label: 'Data available',
    hint: 'A demo dataset is registered for this region',
  },
  loading: {
    id: 'loading',
    label: 'Checking datasets',
    hint: 'Looking for datasets covering this region',
  },
  unavailable: {
    id: 'unavailable',
    label: 'No data available',
    hint: 'No demo dataset is registered for this region',
  },
}

/**
 * An ocean area the visualization can be pointed at.
 *
 * The shape is deliberately close to what a real gazetteer entry or a dataset
 * catalogue record would carry, so the loader added in a later step can return
 * this same type and nothing downstream has to change. What it is *not* is a
 * geographic footprint: `centre` and `span` describe where to look and how
 * wide a window to draw, not a coastline, a basin boundary or a data extent.
 */
export interface OceanRegion {
  id: string
  name: string
  kind: RegionKind
  /** Where the visualization is centred. */
  centre: GeoPoint
  /**
   * Degrees of latitude the modelled domain covers.
   *
   * Sets the scale of the geographic reference frame: a marginal sea spans a
   * few degrees and gets a fine graticule, a basin spans tens of degrees and
   * gets a coarse one.
   */
  span: number
  /**
   * Degrees within which a searched coordinate is treated as belonging to this
   * region. A search radius, not a boundary — deliberately generous, and never
   * drawn.
   */
  reach: number
  /** Extra search terms: coastal names, countries, alternative spellings. */
  aliases: readonly string[]
  /** Short descriptor shown under the name. Never a claim about data. */
  note: string
  availability: DataAvailability
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** `12.94` → `12.94° N`. */
export function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? 'S' : 'N'}`
}

/** `74.86` → `74.86° E`. */
export function formatLongitude(longitude: number): string {
  return `${Math.abs(longitude).toFixed(2)}° ${longitude < 0 ? 'W' : 'E'}`
}

/** `12.94° N · 74.86° E` — the one-line form used wherever space is tight. */
export function formatGeoPoint(point: GeoPoint): string {
  return `${formatLatitude(point.latitude)} · ${formatLongitude(point.longitude)}`
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface LocationState {
  /** The region every other consumer reads: the scene, the HUD, the search. */
  activeRegion: OceanRegion
  /**
   * Availability of the active region.
   *
   * Held on the state rather than read straight off `activeRegion` because
   * this is the value a catalogue lookup will own: selecting a region will set
   * it to `loading` and an async check will settle it. Today it is copied
   * from the region's static metadata on selection.
   */
  availability: DataAvailability
}

export interface LocationActions {
  /** Point the visualization at a region. The only way the active area changes. */
  selectRegion: (region: OceanRegion) => void
}

export interface LocationContextValue {
  state: LocationState
  actions: LocationActions
}

export const LocationContext = createContext<LocationContextValue | null>(null)

function useLocationContext(hook: string): LocationContextValue {
  const value = useContext(LocationContext)
  if (value === null) {
    throw new Error(`${hook} must be used inside <LocationProvider>`)
  }
  return value
}

/** Read the active region — the scene, the HUD and the search all do. */
export function useLocationState(): LocationState {
  return useLocationContext('useLocationState').state
}

/** Change the active region. Used by the search box and the region presets. */
export function useLocationControls(): LocationActions {
  return useLocationContext('useLocationControls').actions
}
