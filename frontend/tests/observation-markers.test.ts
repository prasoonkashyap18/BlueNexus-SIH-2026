/**
 * Step 30 unit tests — real observation marker layout.
 * Node's built-in `node:test`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/observation-markers.test.ts
 *
 * These prove: markers are placed from the REAL Argo/glider lat/lon via the
 * scene's existing `projectGeo` transform (not fabricated); a null position fix
 * drops the marker; the glider track is a *subset* of the real fixes (stride
 * decimation only — never interpolated in-fills), keeping the first and last
 * real fix; and the marker identity is the real `platform_id`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'

import type { ArgoPlatformSummary, GliderSample } from '../src/api/types.ts'
import type { OceanRegion } from '../src/state/locationState.ts'
import { projectGeo, geoFrame } from '../src/components/visualization/scene/geography.ts'
import {
  argoMarkersFor,
  decimateFixes,
  gliderTrackPositions,
} from '../src/components/visualization/scene/observationMarkerLayout.ts'

const REGION: OceanRegion = {
  id: 'bay-of-bengal',
  name: 'Bay of Bengal',
  kind: 'sea',
  centre: { latitude: 15.0, longitude: 87.0 },
  span: 10,
  reach: 14,
  aliases: [],
  note: 'test',
}

function argo(id: string, latitude: number | null, longitude: number | null): ArgoPlatformSummary {
  return {
    platform_id: id,
    platform_number: id.split('_')[0],
    cycle_number: Number(id.split('_')[1] ?? 0),
    platform_type: 'ARVOR',
    direction: 'A',
    time: '2025-04-01T00:00:00Z',
    latitude,
    longitude,
    level_count: 10,
    pressure_min: 1,
    pressure_max: 2000,
  }
}

function sample(latitude: number | null, longitude: number | null): GliderSample {
  return {
    time: '2022-07-05T00:00:00Z',
    latitude,
    longitude,
    position_qc: latitude === null ? '9' : '1',
    pressure: 10,
    pressure_qc: '1',
    temperature: 25,
    temperature_qc: '1',
    salinity: 35,
    salinity_qc: '1',
  }
}

// ---------------------------------------------------------------------------
test('1. Argo marker position = real lat/lon through the scene projectGeo transform', () => {
  const p = argo('2903988_7', 13.85, 85.85)
  const [m] = argoMarkersFor(REGION, [p])
  assert.equal(m.id, '2903988_7') // real id, verbatim

  // independently reproduce the position from projectGeo — no other maths
  const frame = geoFrame(REGION)
  const v = projectGeo(frame, 13.85, 85.85, new Vector3())
  assert.ok(Math.abs(m.position[0] - v.x) < 1e-9)
  assert.ok(Math.abs(m.position[2] - v.z) < 1e-9)
  // y is the surface plane plus a small fixed lift (no fabricated depth)
  assert.ok(m.position[1] > v.y && m.position[1] - v.y < 1)
})

test('2. a null position fix produces no Argo marker (never a fabricated coord)', () => {
  const markers = argoMarkersFor(REGION, [
    argo('good_1', 12.0, 88.0),
    argo('nofix_1', null, 88.0),
    argo('nofix_2', 12.0, null),
  ])
  assert.equal(markers.length, 1)
  assert.equal(markers[0].id, 'good_1')
})

test('3. real IDs only — the demo ids never appear as marker identities', () => {
  const markers = argoMarkersFor(REGION, [argo('2903951_10', -3.1, 77.8), argo('7902250_12', -1.7, 85.2)])
  const ids = markers.map((m) => m.id)
  assert.deepEqual(ids, ['2903951_10', '7902250_12'])
  for (const bad of ['ARGO-DEMO-001', 'ARGO-DEMO-002', 'GLIDER-DEMO-001', 'GLIDER-DEMO-002']) {
    assert.ok(!ids.includes(bad))
  }
})

test('4. glider decimation keeps only real fixes — a subset, first + last retained', () => {
  const fixes: GliderSample[] = []
  for (let i = 0; i < 5000; i += 1) fixes.push(sample(15 + i * 1e-5, 87 + i * 1e-5))
  const picked = decimateFixes(fixes, 240)

  assert.ok(picked.length <= 241)
  assert.ok(picked.length > 0)
  // every picked element is one of the originals (identity) — nothing invented
  for (const s of picked) assert.ok(fixes.includes(s))
  assert.equal(picked[0], fixes[0])
  assert.equal(picked[picked.length - 1], fixes[fixes.length - 1])
})

test('5. glider track excludes samples without a position fix', () => {
  const mixed = [sample(15, 87), sample(null, null), sample(15.1, 87.1), sample(15.2, null)]
  const picked = decimateFixes(mixed, 240)
  assert.equal(picked.length, 2)
  assert.deepEqual(picked.map((s) => [s.latitude, s.longitude]), [[15, 87], [15.1, 87.1]])
})

test('6. gliderTrackPositions builds line segments from real fixes; start = first real fix', () => {
  const fixes = [sample(15, 87), sample(15.5, 87.5), sample(16, 88)]
  const built = gliderTrackPositions(REGION, fixes)
  assert.notEqual(built, null)
  // 3 points -> 2 segments -> 4 vertices -> 12 floats
  assert.equal(built!.positions.length, 12)
  const frame = geoFrame(REGION)
  const first = projectGeo(frame, 15, 87, new Vector3())
  assert.ok(Math.abs(built!.start[0] - first.x) < 1e-9)
  assert.ok(Math.abs(built!.start[2] - first.z) < 1e-9)
})

test('7. all-missing fixes -> no track (no fake line drawn)', () => {
  assert.equal(gliderTrackPositions(REGION, [sample(null, null), sample(null, null)]), null)
  assert.deepEqual(decimateFixes([sample(null, null)]), [])
})

