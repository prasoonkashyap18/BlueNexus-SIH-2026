import type { OceanRegion } from '../state/locationState'

/* ==================================================================== *
 *  DEMO REGIONS — DEVELOPMENT ONLY
 *
 *  A hand-written gazetteer with just enough entries to build and review
 *  the location workflow. It is NOT a geographic dataset: the centres are
 *  round numbers picked to sit in open water, `span` and `reach` are
 *  drawing and search hints rather than boundaries, and no entry carries a
 *  coastline, a basin outline or a real data extent.
 *
 *  Nothing here has been checked against a real gazetteer, and no part of
 *  it describes real INCOIS coverage. It is replaced wholesale by the
 *  catalogue lookup added in the data phase; `findRegion()` is the single
 *  entry point the rest of the application goes through.
 * ==================================================================== */

/** Shown wherever a demo region reaches the screen, so nothing reads as real. */
export const DEMO_REGION_NOTICE =
  'Demo regions for development only — approximate centres for navigation, not surveyed boundaries.'

/**
 * The searchable catalogue.
 *
 * Aliases carry the terms a reader is likely to type but that are not the
 * region's name — neighbouring countries, coastal areas, adjacent seas and
 * common alternatives. They are search hints only: an alias does not claim
 * the place lies inside the region.
 */
export const OCEAN_REGIONS: readonly OceanRegion[] = [
  {
    id: 'arabian-sea',
    name: 'Arabian Sea',
    kind: 'sea',
    centre: { latitude: 12.94, longitude: 74.86 },
    span: 8,
    reach: 13,
    aliases: [
      'india',
      'west coast of india',
      'karnataka',
      'kerala',
      'mangalore',
      'oman',
      'gulf of oman',
      'laccadive sea',
      'arabia',
    ],
    note: 'North Indian Ocean',
    availability: 'available',
  },
  {
    id: 'bay-of-bengal',
    name: 'Bay of Bengal',
    kind: 'sea',
    centre: { latitude: 15.0, longitude: 87.0 },
    span: 10,
    reach: 14,
    aliases: [
      'india',
      'east coast of india',
      'odisha',
      'andhra pradesh',
      'chennai',
      'bangladesh',
      'myanmar',
      'andaman sea',
    ],
    note: 'North Indian Ocean',
    availability: 'available',
  },
  {
    id: 'indian-ocean',
    name: 'Indian Ocean',
    kind: 'ocean',
    centre: { latitude: -18.0, longitude: 78.0 },
    span: 30,
    reach: 45,
    aliases: [
      'equatorial indian ocean',
      'southern indian ocean',
      'mascarene',
      'madagascar',
      'reunion',
    ],
    note: 'Basin scale',
    availability: 'available',
  },
  {
    id: 'south-china-sea',
    name: 'South China Sea',
    kind: 'sea',
    centre: { latitude: 14.0, longitude: 114.0 },
    span: 10,
    reach: 14,
    aliases: ['vietnam', 'philippines', 'luzon', 'borneo', 'china', 'hainan'],
    note: 'Western Pacific marginal sea',
    availability: 'available',
  },
  {
    id: 'western-pacific',
    name: 'Western Pacific',
    kind: 'ocean',
    centre: { latitude: 10.0, longitude: 140.0 },
    span: 24,
    reach: 34,
    aliases: ['pacific', 'philippine sea', 'warm pool', 'guam', 'japan', 'palau'],
    note: 'Basin scale',
    availability: 'available',
  },
  {
    id: 'north-atlantic',
    name: 'North Atlantic',
    kind: 'ocean',
    centre: { latitude: 45.0, longitude: -30.0 },
    span: 24,
    reach: 34,
    aliases: ['atlantic', 'gulf stream', 'north atlantic drift', 'azores', 'iceland basin'],
    note: 'Basin scale',
    availability: 'available',
  },
  {
    id: 'red-sea',
    name: 'Red Sea',
    kind: 'sea',
    centre: { latitude: 20.0, longitude: 38.5 },
    span: 6,
    reach: 9,
    aliases: ['egypt', 'saudi arabia', 'sudan', 'eritrea', 'gulf of aden', 'jeddah'],
    note: 'Marginal sea',
    availability: 'unavailable',
  },
  {
    id: 'southern-ocean',
    name: 'Southern Ocean',
    kind: 'ocean',
    centre: { latitude: -55.0, longitude: 60.0 },
    span: 20,
    reach: 30,
    aliases: ['antarctic', 'antarctica', 'circumpolar', 'kerguelen', 'crozet'],
    note: 'Polar basin',
    availability: 'unavailable',
  },
]

/**
 * The region the application opens on — the Arabian Sea sector the earlier
 * steps were built against, so nothing about the opening view changes.
 */
export const DEFAULT_REGION: OceanRegion = OCEAN_REGIONS[0] as OceanRegion

/** Look a region up by id. The single lookup the application goes through. */
export function findRegion(id: string): OceanRegion | undefined {
  return OCEAN_REGIONS.find((region) => region.id === id)
}
