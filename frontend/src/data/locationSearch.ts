import type { GeoPoint, OceanRegion } from '../state/locationState'
import { OCEAN_REGIONS } from './oceanRegions'

/* ==================================================================== *
 *  DEMO SEARCH — DEVELOPMENT ONLY
 *
 *  Resolves what a reader types into one of the demo regions. There is no
 *  geocoder behind it and no request leaves the browser: names are matched
 *  against the hand-written catalogue in `oceanRegions.ts`, and coordinates
 *  are parsed locally.
 *
 *  It is replaced by a real gazetteer lookup in the data phase. Everything
 *  above it goes through `resolveSearch()` and `searchRegions()`, so the
 *  swap is confined to this file.
 * ==================================================================== */

const DEGREES = Math.PI / 180

/* ------------------------------------------------------------------ *
 * Coordinates
 * ------------------------------------------------------------------ */

/**
 * A latitude/longitude pair, in the shapes a reader actually types:
 * `12.94, 74.86`, `12.94 74.86`, `12.94 N, 74.86 E`, `12.94° N, 74.86° E`,
 * and the same with the hemispheres reversed or the signs written out.
 */
const COORDINATE_PAIR =
  /^([+-]?\d{1,3}(?:\.\d+)?)\s*([nsew]?)\s*(?:,\s*|\s+)([+-]?\d{1,3}(?:\.\d+)?)\s*([nsew]?)$/i

/**
 * Characters a coordinate search may contain.
 *
 * What separates "this is a malformed coordinate" from "this is the name of a
 * place": a query built only from digits, signs, separators and hemisphere
 * letters was meant to be a position, so failing to parse it is an error worth
 * reporting rather than a reason to fall through to the name search.
 */
const COORDINATE_SHAPED = /^[\s\d.,+\-°ºnsew]+$/i

export type CoordinateParse =
  | { status: 'none' }
  | { status: 'point'; point: GeoPoint }
  | { status: 'invalid'; message: string }

/** Signed value of one parsed component, applying its hemisphere letter. */
function signed(value: number, hemisphere: string): number {
  const letter = hemisphere.toLowerCase()
  if (letter === 's' || letter === 'w') return -Math.abs(value)
  if (letter === 'n' || letter === 'e') return Math.abs(value)
  return value
}

const isLatitudeLetter = (letter: string) => letter === 'n' || letter === 's'
const isLongitudeLetter = (letter: string) => letter === 'e' || letter === 'w'

/**
 * Reads a coordinate pair out of a search query.
 *
 * Returns `none` for anything that was never meant to be a position, so the
 * caller can fall through to the name search, and `invalid` with a message for
 * something that was.
 */
export function parseCoordinates(query: string): CoordinateParse {
  const text = query.trim().replace(/[°º]/g, ' ').replace(/\s+/g, ' ').trim()

  if (text === '' || !/\d/.test(text) || !COORDINATE_SHAPED.test(text)) {
    return { status: 'none' }
  }

  const match = COORDINATE_PAIR.exec(text)
  if (match === null) {
    return {
      status: 'invalid',
      message: 'Enter coordinates as latitude, longitude — for example 12.94, 74.86.',
    }
  }

  const [, firstValue = '', firstLetter = '', secondValue = '', secondLetter = ''] = match
  const first = { value: Number(firstValue), letter: firstLetter.toLowerCase() }
  const second = { value: Number(secondValue), letter: secondLetter.toLowerCase() }

  // Hemisphere letters, when given, decide which number is which — so
  // `74.86 E, 12.94 N` reads the same as `12.94 N, 74.86 E`.
  const reversed = isLongitudeLetter(first.letter) || isLatitudeLetter(second.letter)

  const latitudePart = reversed ? second : first
  const longitudePart = reversed ? first : second

  if (
    (isLongitudeLetter(latitudePart.letter) || isLatitudeLetter(longitudePart.letter)) &&
    latitudePart.letter !== '' &&
    longitudePart.letter !== ''
  ) {
    return {
      status: 'invalid',
      message: 'Give one latitude (N or S) and one longitude (E or W).',
    }
  }

  const latitude = signed(latitudePart.value, latitudePart.letter)
  const longitude = signed(longitudePart.value, longitudePart.letter)

  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return { status: 'invalid', message: 'Latitude must be between 90° S and 90° N.' }
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return { status: 'invalid', message: 'Longitude must be between 180° W and 180° E.' }
  }

  return { status: 'point', point: { latitude, longitude } }
}

/**
 * Rough angular separation in degrees, longitude squeezed by latitude.
 *
 * Good enough to decide which demo region a searched coordinate belongs to,
 * and deliberately not a geodesic — nothing here is a distance measurement.
 */
function separation(a: GeoPoint, b: GeoPoint): number {
  const latitudeGap = a.latitude - b.latitude

  let longitudeGap = a.longitude - b.longitude
  if (longitudeGap > 180) longitudeGap -= 360
  if (longitudeGap < -180) longitudeGap += 360

  const squeeze = Math.cos(((a.latitude + b.latitude) / 2) * DEGREES)
  return Math.hypot(latitudeGap, longitudeGap * squeeze)
}

/** A region centred on a searched coordinate, for positions off the catalogue. */
export function coordinateRegion(point: GeoPoint): OceanRegion {
  return {
    id: `coordinates:${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`,
    name: 'Custom location',
    kind: 'coordinates',
    centre: point,
    span: 8,
    reach: 0,
    aliases: [],
    note: 'Searched coordinates',
    availability: 'unavailable',
  }
}

/**
 * The region a coordinate belongs to: the nearest catalogue entry that reaches
 * it, or a custom location pinned to the coordinate itself.
 */
export function regionForPoint(point: GeoPoint): OceanRegion {
  let nearest: OceanRegion | undefined
  let nearestGap = Infinity

  for (const region of OCEAN_REGIONS) {
    const gap = separation(point, region.centre)
    if (gap <= region.reach && gap < nearestGap) {
      nearest = region
      nearestGap = gap
    }
  }

  return nearest ?? coordinateRegion(point)
}

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

const normalise = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

/** True when any word of `text` starts with `term`. */
function hasWordStarting(text: string, term: string): boolean {
  return text.split(' ').some((word) => word.startsWith(term))
}

/**
 * How well a region matches a term — lower is better, `null` is no match.
 *
 * The order encodes what a reader means by typing a few letters: the name they
 * typed, then a name it begins, then a name containing the word, and only then
 * the alias list, so `india` offers the Arabian Sea and the Bay of Bengal
 * after every sea whose own name starts with those letters.
 */
function matchRank(region: OceanRegion, term: string): number | null {
  const name = normalise(region.name)

  if (name === term) return 0
  if (name.startsWith(term)) return 1
  if (hasWordStarting(name, term)) return 2
  if (name.includes(term)) return 3

  for (const alias of region.aliases) {
    const value = normalise(alias)
    if (value.startsWith(term) || hasWordStarting(value, term)) return 4
    if (value.includes(term)) return 5
  }

  return null
}

/** Regions matching a name, coastal area or country, best match first. */
export function searchRegions(
  query: string,
  catalogue: readonly OceanRegion[] = OCEAN_REGIONS,
): OceanRegion[] {
  const term = normalise(query)
  if (term === '') return []

  return catalogue
    .map((region) => ({ region, rank: matchRank(region, term) }))
    .filter((entry): entry is { region: OceanRegion; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.region.name.localeCompare(b.region.name))
    .map((entry) => entry.region)
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

export type SearchOutcome =
  | { status: 'empty' }
  | { status: 'region'; region: OceanRegion }
  | { status: 'error'; message: string }

/**
 * Resolves a submitted query to a region.
 *
 * Coordinates are tried first: they are unambiguous, and a query that was
 * clearly meant to be a position should report why it failed rather than
 * silently becoming a failed name search.
 */
export function resolveSearch(query: string): SearchOutcome {
  const text = query.trim()
  if (text === '') return { status: 'empty' }

  const coordinates = parseCoordinates(text)
  if (coordinates.status === 'invalid') {
    return { status: 'error', message: coordinates.message }
  }
  if (coordinates.status === 'point') {
    return { status: 'region', region: regionForPoint(coordinates.point) }
  }

  const [best] = searchRegions(text)
  if (best === undefined) {
    return {
      status: 'error',
      message: `No region matches “${text}”. Try an ocean, a sea, a coastal country, or coordinates such as 12.94, 74.86.`,
    }
  }

  return { status: 'region', region: best }
}
