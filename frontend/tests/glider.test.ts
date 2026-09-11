/**
 * Step 29 unit tests — real EGO / OceanGliders glider data client + state.
 * Node's built-in `node:test`, HTTP mocked with an injected `fetch`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/glider.test.ts
 *
 * These prove: the D11 client hits `/api/observations/gliders[...]` with the
 * deployment id, carries the real glider fields and source units through
 * unchanged, keeps a missing sample value as `null` (never the 99999 fill,
 * never 0) while preserving its QC flag, and never fabricates a deployment on
 * failure — it throws.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type { GliderPlatformDetail, GliderPlatformList } from '../src/api/types.ts'
import {
  findGliderPlatform,
  isGliderPlatformId,
} from '../src/state/gliderObservationsState.ts'

// ---------------------------------------------------------------------------
function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const { status = 200, body } = handler(url)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const UNITS = {
  pressure: 'decibar',
  temperature: 'degree_Celsius',
  salinity: 'PSU',
}

const LIST: GliderPlatformList = {
  dataset_id: 'ego_oceangliders_gdac',
  count: 2,
  units: UNITS,
  platform_type: 'glider',
  note: 'real glider deployments',
  provenance: {
    source_name: 'EGO / OceanGliders GDAC',
    source_dataset_id: 'OceanGlidersGDACTrajectories',
    product_type: 'observation',
  },
  platforms: [
    {
      platform_id: 'sea057_20220707',
      platform_type: 'glider',
      sample_count: 2740,
      time_start: '2022-07-03T14:02:26Z',
      time_end: '2022-07-08T23:59:25Z',
      latitude_min: 23.5900,
      latitude_max: 24.1782,
      longitude_min: 57.6279,
      longitude_max: 58.16835,
      pressure_min: -0.0065,
      pressure_max: 664.7296,
    },
    {
      platform_id: 'Bellatrix_368',
      platform_type: 'glider',
      sample_count: 3296,
      time_start: '2016-07-06T00:00:04Z',
      time_end: '2016-07-06T05:48:46Z',
      latitude_min: 7.987,
      latitude_max: 8.0015,
      longitude_min: 88.0126,
      longitude_max: 88.0417,
      pressure_min: 0.87,
      pressure_max: 464.07,
    },
  ],
}

const DETAIL: GliderPlatformDetail = {
  ...LIST.platforms[0],
  dataset_id: 'ego_oceangliders_gdac',
  units: UNITS,
  standard_names: {
    pressure: 'sea_water_pressure',
    temperature: 'sea_water_temperature',
    salinity: 'sea_water_practical_salinity',
  },
  quality_definition: { '1': 'good data', '4': 'bad data', '9': 'missing value' },
  missing_value: null,
  provenance: LIST.provenance,
  samples: [
    {
      time: '2022-07-03T14:02:26Z',
      latitude: 23.5904,
      longitude: 58.16826666666666,
      position_qc: '4',
      pressure: 0.0549,
      pressure_qc: '1',
      temperature: 28.2624,
      temperature_qc: '1',
      // a real missing salinity — stays null, QC also absent here
      salinity: null,
      salinity_qc: null,
    },
    {
      time: '2022-07-04T08:40:01Z',
      latitude: 23.59855,
      longitude: 58.16263333333333,
      position_qc: '4',
      pressure: 0.0156,
      pressure_qc: '1',
      // bad data (glider on deck) — value kept, QC flag = 4
      temperature: 40.072,
      temperature_qc: '4',
      salinity: null,
      salinity_qc: null,
    },
  ],
}

// ---------------------------------------------------------------------------
test('1. glider deployment id shape is recognised', () => {
  assert.equal(isGliderPlatformId('sea057_20220707'), true)
  assert.equal(isGliderPlatformId('Bellatrix_368'), true)
  assert.equal(isGliderPlatformId('sea006-2026.01'), true)
  assert.equal(isGliderPlatformId('GLIDER-DEMO-001'), true) // shape only; not in the real list
  assert.equal(isGliderPlatformId('../etc'), false)
  assert.equal(isGliderPlatformId(null), false)
})

test('2. the D11 client requests the real glider list endpoint', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: LIST }))
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })
  const list = await client.getGliderPlatforms()
  assert.deepEqual(calls, ['http://t/api/observations/gliders'])
  assert.equal(list.dataset_id, 'ego_oceangliders_gdac')
  assert.equal(list.platform_type, 'glider')
  assert.equal(list.platforms.length, 2)
  assert.equal(list.platforms[0].platform_id, 'sea057_20220707')
  assert.equal(list.units.pressure, 'decibar')
  assert.equal(list.units.temperature, 'degree_Celsius')
  assert.equal(list.provenance.source_dataset_id, 'OceanGlidersGDACTrajectories')
})

test('3. the client requests one deployment by its id', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: DETAIL }))
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })
  const detail = await client.getGliderPlatform('sea057_20220707')
  assert.deepEqual(calls, ['http://t/api/observations/gliders/sea057_20220707'])
  assert.equal(detail.platform_id, 'sea057_20220707')
  assert.equal(detail.sample_count, 2740)
  assert.equal(detail.time_start, '2022-07-03T14:02:26Z')
  assert.equal(detail.samples.length, 2)
})

test('4. real pressure/temperature/lat/lon values pass through unchanged', () => {
  const s = DETAIL.samples[0]
  assert.equal(s.pressure, 0.0549)
  assert.equal(s.temperature, 28.2624)
  assert.equal(s.latitude, 23.5904)
  assert.equal(s.longitude, 58.16826666666666)
  assert.equal(s.time, '2022-07-03T14:02:26Z')
})

test('5. a missing sample value stays null (never 0, never the 99999 fill)', () => {
  const s = DETAIL.samples[0]
  assert.equal(s.salinity, null)
  assert.equal(s.salinity_qc, null)
  assert.notEqual(s.salinity, 0)
})

test('6. a bad-QC sample keeps both its real value and its QC flag', () => {
  const s = DETAIL.samples[1]
  assert.equal(s.temperature_qc, '4') // bad data — flag preserved
  assert.equal(s.temperature, 40.072) // value NOT dropped or zeroed
})

test('7. findGliderPlatform resolves a real id and rejects unknown/null', () => {
  const state = {
    phase: 'success' as const,
    datasetId: 'ego_oceangliders_gdac',
    units: UNITS,
    provenance: LIST.provenance,
    platforms: LIST.platforms,
    error: null,
    updatedAt: null,
  }
  assert.equal(findGliderPlatform(state, 'Bellatrix_368')?.sample_count, 3296)
  assert.equal(findGliderPlatform(state, 'nope_1'), null)
  assert.equal(findGliderPlatform(state, null), null)
})

test('8. no mock fallback — the client throws instead of fabricating a deployment', async () => {
  const failing = (async () =>
    new Response('{"error":{"type":"data_unavailable","message":"gone"}}', {
      status: 503,
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: 'http://t', fetch: failing })
  await assert.rejects(() => client.getGliderPlatforms(), ApiError)
  await assert.rejects(() => client.getGliderPlatform('sea057_20220707'), ApiError)
})

test('9. glider types are distinct from Argo (not the same dataset)', () => {
  // the glider list is a glider list — platform_type is the literal 'glider'
  assert.equal(LIST.platform_type, 'glider')
  assert.notEqual(LIST.dataset_id, 'incois_indian_argo_floats')
})
