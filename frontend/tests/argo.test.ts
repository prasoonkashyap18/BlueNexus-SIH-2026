/**
 * Step 28 unit tests — real INCOIS Argo profiling-float data client + state.
 * Node's built-in `node:test`, HTTP mocked with an injected `fetch`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/argo.test.ts
 *
 * These prove: the D11 client hits `/api/observations/argo[...]` with the
 * composite id, carries the real Argo fields and source units through
 * unchanged, keeps a missing level value as `null` (never the 99999 fill,
 * never 0), and never fabricates a profile on failure — it throws.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type { ArgoPlatformDetail, ArgoPlatformList } from '../src/api/types.ts'
import { findArgoPlatform, isArgoPlatformId } from '../src/state/argoObservationsState.ts'

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

const LIST: ArgoPlatformList = {
  dataset_id: 'incois_indian_argo_floats',
  count: 2,
  units: {
    pressure: 'decibar',
    temperature: 'degree_Celsius',
    salinity: 'PSU',
  },
  platform_type: 'argo',
  note: 'real Argo float profiles',
  provenance: { source_name: 'INCOIS ERDDAP', source_dataset_id: 'Indian_ARGO_Floats' },
  platforms: [
    {
      platform_id: '2903951_10',
      platform_number: '2903951',
      cycle_number: 10,
      platform_type: 'PROVOR_III',
      direction: 'A',
      time: '2025-04-01T13:29:00Z',
      latitude: -3.0807516666666666,
      longitude: 77.83276333333333,
      level_count: 91,
      pressure_min: 2.5,
      pressure_max: 1968.9,
    },
    {
      platform_id: '7902250_12',
      platform_number: '7902250',
      cycle_number: 12,
      platform_type: 'ARVOR',
      direction: 'A',
      time: '2025-04-21T09:10:00Z',
      latitude: 8.1,
      longitude: 73.2,
      level_count: 88,
      pressure_min: 1.2,
      pressure_max: 1990.0,
    },
  ],
}

const DETAIL: ArgoPlatformDetail = {
  ...LIST.platforms[0],
  dataset_id: 'incois_indian_argo_floats',
  units: LIST.units,
  standard_names: {
    pressure: 'sea_water_pressure',
    temperature: 'sea_water_temperature',
    salinity: 'sea_water_practical_salinity',
  },
  quality_definition: { '1': 'good data', '4': 'bad data' },
  missing_value: null,
  provenance: LIST.provenance,
  levels: [
    { pressure: 2.5, pressure_qc: '1', temperature: 29.995, temperature_qc: '1', salinity: 34.858, salinity_qc: '1' },
    // a real missing salinity at this level — stays null, QC still carried
    { pressure: 10.0, pressure_qc: '1', temperature: 29.9, temperature_qc: '1', salinity: null, salinity_qc: '4' },
  ],
}

// ---------------------------------------------------------------------------
test('1. composite platform id shape is recognised', () => {
  assert.equal(isArgoPlatformId('2903951_10'), true)
  assert.equal(isArgoPlatformId('7902250_509'), true)
  assert.equal(isArgoPlatformId('ARGO-DEMO-001'), false)
  assert.equal(isArgoPlatformId(null), false)
})

test('2. the D11 client requests the real Argo list endpoint', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: LIST }))
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })
  const list = await client.getArgoPlatforms()
  assert.deepEqual(calls, ['http://t/api/observations/argo'])
  assert.equal(list.dataset_id, 'incois_indian_argo_floats')
  assert.equal(list.platform_type, 'argo')
  assert.equal(list.platforms.length, 2)
  // real WMO ids + source units, unchanged
  assert.equal(list.platforms[0].platform_number, '2903951')
  assert.equal(list.units.pressure, 'decibar')
  assert.equal(list.units.temperature, 'degree_Celsius')
})

test('3. the client requests one profile by its composite id', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: DETAIL }))
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })
  const detail = await client.getArgoPlatform('2903951_10')
  assert.deepEqual(calls, ['http://t/api/observations/argo/2903951_10'])
  assert.equal(detail.cycle_number, 10)
  assert.equal(detail.time, '2025-04-01T13:29:00Z')
  assert.equal(detail.latitude, -3.0807516666666666)
  assert.equal(detail.levels.length, 2)
})

test('4. real pressure/temperature/salinity values pass through unchanged', () => {
  const lv = DETAIL.levels[0]
  assert.equal(lv.pressure, 2.5)
  assert.equal(lv.temperature, 29.995)
  assert.equal(lv.salinity, 34.858)
  assert.equal(lv.temperature_qc, '1')
})

test('5. a missing level value stays null (never 0, never the 99999 fill)', () => {
  const lv = DETAIL.levels[1]
  assert.equal(lv.salinity, null)
  assert.equal(lv.salinity_qc, '4') // real QC flag still carried
  assert.notEqual(lv.salinity, 0)
})

test('6. findArgoPlatform resolves a real id and rejects unknown/null', () => {
  const state = {
    phase: 'success' as const,
    datasetId: 'incois_indian_argo_floats',
    units: LIST.units,
    provenance: LIST.provenance,
    platforms: LIST.platforms,
    error: null,
    updatedAt: null,
  }
  assert.equal(findArgoPlatform(state, '7902250_12')?.platform_number, '7902250')
  assert.equal(findArgoPlatform(state, 'nope_1'), null)
  assert.equal(findArgoPlatform(state, null), null)
})

test('7. no mock fallback — the client throws instead of fabricating a profile', async () => {
  const failing = (async () =>
    new Response('{"error":{"type":"data_unavailable","message":"gone"}}', {
      status: 503,
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: 'http://t', fetch: failing })
  await assert.rejects(() => client.getArgoPlatforms(), ApiError)
  await assert.rejects(() => client.getArgoPlatform('2903951_10'), ApiError)
})
