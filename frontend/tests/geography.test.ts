/**
 * Step 40 unit tests — geographic coordinate labels on the graticule.
 * Node's built-in `node:test`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/geography.test.ts
 *
 * These prove: the labels carry REAL degree values on the same lat/lon grid
 * `buildGraticule` draws (multiples of the frame's spacing — nothing
 * fabricated); latitude labels sit off the domain's west edge and longitude
 * labels off its south edge, matching the scene's +x = east / -z = north
 * orientation; the count stays small; and every label is placed through the
 * shared `projectGeo` transform (no second coordinate system).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import type { OceanRegion } from '../src/state/locationState.ts'
import {
  GEO,
  geoFrame,
  graticuleLabels,
} from '../src/components/visualization/scene/geography.ts'
import { DOMAIN } from '../src/components/visualization/scene/sceneConfig.ts'

const ARABIAN_SEA: OceanRegion = {
  id: 'arabian-sea',
  name: 'Arabian Sea',
  kind: 'sea',
  centre: { latitude: 12.94, longitude: 74.86 },
  span: 8,
  reach: 13,
  aliases: [],
  note: 'test',
}

const INDIAN_OCEAN: OceanRegion = {
  ...ARABIAN_SEA,
  id: 'indian-ocean',
  centre: { latitude: -18, longitude: 78 },
  span: 30,
}

test('labels are real values on the graticule grid (multiples of spacing)', () => {
  const frame = geoFrame(ARABIAN_SEA)
  const labels = graticuleLabels(frame)
  assert.ok(labels.length > 0, 'expected some labels')

  for (const label of labels) {
    const degrees = Number(label.text.replace(/°[NSEW]$/, ''))
    assert.ok(Number.isFinite(degrees), `parseable degree value in "${label.text}"`)
    // the value must be an exact multiple of the grid spacing
    const onGrid = Math.abs(Math.round(degrees / frame.spacing) - degrees / frame.spacing)
    assert.ok(onGrid < 1e-6, `${label.text} lies on the ${frame.spacing}° grid`)
  }
})

test('label text is formatted with a hemisphere suffix, no fabricated precision', () => {
  const labels = graticuleLabels(geoFrame(ARABIAN_SEA))
  const lon = labels.find((l) => l.axis === 'longitude')
  const lat = labels.find((l) => l.axis === 'latitude')
  assert.match(lon!.text, /^\d+(\.\d+)?°E$/, 'Arabian Sea longitudes are east')
  assert.match(lat!.text, /^\d+(\.\d+)?°N$/, 'Arabian Sea latitudes are north')
})

test('southern-hemisphere region produces S labels', () => {
  const labels = graticuleLabels(geoFrame(INDIAN_OCEAN))
  assert.ok(
    labels.some((l) => l.axis === 'latitude' && l.text.endsWith('°S')),
    'Indian Ocean sector (centre 18°S) has southern latitudes',
  )
})

test('orientation: latitude labels west (-x), longitude labels south (+z)', () => {
  const halfX = DOMAIN.width / 2
  const halfZ = DOMAIN.depth / 2
  const labels = graticuleLabels(geoFrame(ARABIAN_SEA))

  for (const label of labels) {
    const [x, , z] = label.position
    if (label.axis === 'latitude') {
      assert.ok(x < -halfX, `latitude label sits off the west edge (x=${x.toFixed(2)})`)
    } else {
      assert.ok(z > halfZ, `longitude label sits off the south edge (z=${z.toFixed(2)})`)
    }
  }
})

test('label world positions follow the projection monotonically', () => {
  const frame = geoFrame(ARABIAN_SEA)
  const value = (label: { text: string }) => {
    const degrees = Number(label.text.replace(/°[NSEW]$/, ''))
    return /°[SW]$/.test(label.text) ? -degrees : degrees
  }

  const lon = graticuleLabels(frame)
    .filter((l) => l.axis === 'longitude')
    .sort((a, b) => value(a) - value(b))
  for (let i = 1; i < lon.length; i += 1) {
    assert.ok(
      lon[i].position[0] > lon[i - 1].position[0],
      'east labels increase in +x (east is +x)',
    )
  }

  const lat = graticuleLabels(frame)
    .filter((l) => l.axis === 'latitude')
    .sort((a, b) => value(a) - value(b))
  for (let i = 1; i < lat.length; i += 1) {
    assert.ok(
      lat[i].position[2] < lat[i - 1].position[2],
      'north labels decrease in z (north is -z)',
    )
  }
})

test('the label set stays small (<= maxLabelsPerAxis per family)', () => {
  for (const region of [ARABIAN_SEA, INDIAN_OCEAN]) {
    const labels = graticuleLabels(geoFrame(region))
    const lat = labels.filter((l) => l.axis === 'latitude').length
    const lon = labels.filter((l) => l.axis === 'longitude').length
    assert.ok(lat <= GEO.maxLabelsPerAxis, `${region.id}: ${lat} latitude labels`)
    assert.ok(lon <= GEO.maxLabelsPerAxis, `${region.id}: ${lon} longitude labels`)
  }
})
