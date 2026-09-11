/**
 * Step 43 — frontend model-at-observation client boundary only.
 *
 * Runner: `node:test`. HTTP mocked with an injected `fetch`. NO UI — this only
 * proves the client can ask the backend for the GLORYS `thetao` profile at a
 * real Argo profile and passes the real values / matching metadata through
 * untouched, and that errors surface as {@link ApiError} (never synthetic data).
 *
 *   cd frontend && npm test   # or: node --test tests/model-observation.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type { ModelAtArgoTemperatureResponse } from '../src/api/types.ts'

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const { status = 200, body } = handler(url)
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const BASE = 'http://test.local'

// Faithful shape of the Step 43 backend response for Argo 3902669_4.
const RESPONSE: ModelAtArgoTemperatureResponse = {
  observation: {
    source: 'INCOIS Argo float profile',
    dataset_id: 'incois_indian_argo_floats',
    platform_id: '3902669_4',
    platform_number: '3902669',
    cycle_number: 4,
    latitude: 19.666666666666668,
    longitude: 64.65,
    timestamp: '2025-03-31T15:00:20Z',
    level_count: 102,
    pressure_min: 0.1,
    pressure_max: 1977.1,
  },
  model: {
    dataset_id: 'glorys12v1_model',
    source: 'GLORYS12V1 / Copernicus Marine',
    product_id: 'GLOBAL_MULTIYEAR_PHY_001_030',
    copernicus_dataset_id: 'cmems_mod_glo_phy_my_0.083deg_P1D-m',
    doi: 'https://doi.org/10.48670/moi-00021',
    file_name: 'temperature_cmems_glorys12v1_arabiansea.nc',
    variable: 'thetao',
    standard_name: 'sea_water_potential_temperature',
    units: 'degrees_C',
    latitude: 19.6666660308838,
    longitude: 64.6666641235352,
    timestamp: '2025-04-01T00:00:00Z',
    spatial_match: {
      method: 'nearest native GLORYS 1/12 grid cell (no interpolation)',
      requested: { latitude: 19.666666666666668, longitude: 64.65 },
      matched: { latitude: 19.6666660308838, longitude: 64.6666641235352 },
      latitude_difference_deg: -6.35e-7,
      longitude_difference_deg: 0.01666412,
      distance_km: 1.7448784,
    },
    temporal_match: {
      method: 'nearest available GLORYS daily-mean timestep (no interpolation)',
      requested: '2025-03-31T15:00:20Z',
      matched: '2025-04-01T00:00:00Z',
      difference_seconds: 32380,
      note: 'GLORYS thetao is a DAILY MEAN, not an instantaneous value',
    },
    decoding: { cf_mask_and_scale: true, raw_dtype: 'int16', note: 'decoded' },
    level_count: 32,
    finite_level_count: 32,
    null_level_count: 0,
    depth_units: 'm',
    depth_positive: 'down',
  },
  profile: [
    { depth: 0.494025, temperature: 27.36201 },
    { depth: 541.0889, temperature: 12.860347 },
  ],
  coverage: {
    latitude: { min: 8, max: 20.5, count: 151, units: 'degrees_north' },
    longitude: { min: 61.5, max: 70, count: 103, units: 'degrees_east' },
    time: { start: '2025-03-24T00:00:00Z', end: '2025-04-02T00:00:00Z', count: 10 },
    note: 'not basin-wide',
  },
  warnings: [],
  notes: [
    'Spatial matching: nearest native GLORYS 1/12 grid cell. No spatial interpolation / regridding.',
    'Step 43 does NOT compute model-minus-observation differences (that is a later step).',
  ],
  nan_encoding: 'CF-decoded; NaN as null',
}

test('getModelTemperatureAtArgo() hits the composite-id endpoint', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const r = await client.getModelTemperatureAtArgo('3902669_4')

  assert.equal(calls[0], `${BASE}/api/model-observations/argo/3902669_4/temperature`)
  assert.equal(r.observation.platform_id, '3902669_4')
  assert.equal(r.observation.cycle_number, 4)
  assert.equal(r.model.dataset_id, 'glorys12v1_model')
  assert.equal(r.model.source, 'GLORYS12V1 / Copernicus Marine')
  assert.equal(r.model.variable, 'thetao')
  assert.equal(r.model.units, 'degrees_C')
})

test('the real matching metadata + native profile pass through verbatim', async () => {
  const { fetch } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const r = await client.getModelTemperatureAtArgo('3902669_4')

  // Argo coordinates untouched
  assert.equal(r.observation.latitude, 19.666666666666668)
  assert.equal(r.observation.timestamp, '2025-03-31T15:00:20Z')
  // nearest-native match, both timestamps explicit, difference in seconds
  assert.equal(r.model.temporal_match.requested, '2025-03-31T15:00:20Z')
  assert.equal(r.model.temporal_match.matched, '2025-04-01T00:00:00Z')
  assert.equal(r.model.temporal_match.difference_seconds, 32380)
  assert.match(r.model.spatial_match.method, /nearest native/i)
  // native profile: real decoded °C, not packed ints, physical
  assert.equal(r.profile.length, 2)
  assert.equal(r.profile[0].temperature, 27.36201)
  assert.ok(r.profile.every((p) => p.temperature === null || (p.temperature > -3 && p.temperature < 40)))
  // transparency: no model−obs difference in Step 43
  assert.ok(r.notes.some((n) => /does NOT compute model-minus-observation/i.test(n)))
})

test('an out-of-coverage observation surfaces as ApiError — never synthetic data', async () => {
  const { fetch } = mockFetch(() => ({
    status: 422,
    body: {
      error: {
        type: 'observation_outside_model_coverage',
        message: 'the Argo observation is outside the configured GLORYS model coverage (longitude)',
        detail: { outside: ['longitude'] },
      },
    },
  }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  await assert.rejects(
    () => client.getModelTemperatureAtArgo('2903988_7'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 422)
      assert.equal(err.type, 'observation_outside_model_coverage')
      return true
    },
  )
})

test('unknown platform / unavailable model both throw (404 / 503), no fallback', async () => {
  for (const [status, type] of [
    [404, 'unknown_argo_platform'],
    [503, 'netcdf_unavailable'],
  ] as const) {
    const { fetch } = mockFetch(() => ({
      status,
      body: { error: { type, message: 'x', detail: {} } },
    }))
    const client = createDataApiClient({ baseUrl: BASE, fetch })
    await assert.rejects(
      () => client.getModelTemperatureAtArgo('9999999_1'),
      (err: unknown) => err instanceof ApiError && err.type === type,
    )
  }
})
