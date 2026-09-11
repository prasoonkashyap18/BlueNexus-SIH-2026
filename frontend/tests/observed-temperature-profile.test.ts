/**
 * Step 44 — frontend client boundary for the OBSERVED Argo temperature profile.
 *
 * `node:test`, mocked `fetch`. NO UI. Proves the client can ask the backend for
 * the comparison-ready observed profile and passes the real
 * `(pressure_dbar, temperature)` pairs + QC + metadata through untouched, and
 * that errors surface as {@link ApiError} (never synthetic data).
 *
 *   cd frontend && npm test   # or: node --test tests/observed-temperature-profile.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type { ArgoObservedTemperatureProfileResponse } from '../src/api/types.ts'

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

const RESPONSE: ArgoObservedTemperatureProfileResponse = {
  observation: {
    source: 'INCOIS Argo float profile (in-situ CTD)',
    dataset_id: 'incois_indian_argo_floats',
    platform_id: '3902669_4',
    platform_number: '3902669',
    cycle_number: 4,
    platform_type: 'ARVOR',
    direction: 'A',
    latitude: 19.666666666666668,
    longitude: 64.65,
    timestamp: '2025-03-31T15:00:20Z',
  },
  profile: [
    { pressure_dbar: 0.1, temperature: 27.404, pressure_qc: '1', temperature_qc: '1' },
    { pressure_dbar: 0.9, temperature: 27.426, pressure_qc: '1', temperature_qc: '1' },
    { pressure_dbar: 1977.1, temperature: 3.408, pressure_qc: '1', temperature_qc: '1' },
  ],
  metadata: {
    variable: 'sea_water_temperature',
    units: 'degree_Celsius',
    vertical_coordinate: 'pressure_dbar',
    vertical_coordinate_units: 'decibar',
    source_level_count: 102,
    point_count: 102,
    finite_temperature_count: 102,
    null_temperature_count: 0,
    finite_pressure_count: 102,
    pressure_dbar_range: { min: 0.1, max: 1977.1 },
    temperature_range: { min: 3.408, max: 27.426 },
    ordering: 'ascending pressure_dbar (pure reordering; source values unchanged)',
    pairing_rule: 'a point is kept only when pressure_dbar AND temperature are both finite',
    qc: {
      filtering_applied: false,
      flags_retained: true,
      representation: 'raw Argo QC codes as strings, per point',
      temperature_qc_codes_present: ['1'],
      definition: { '1': 'good data', '3': 'probably bad data', '4': 'bad data' },
      note: 'Step 44 keeps every finite temperature regardless of QC flag',
    },
    transforms_applied: 'none (no interpolation, smoothing, decimation, gap-fill or unit conversion)',
  },
  provenance: { source_name: 'INCOIS ERDDAP' },
  notes: [
    'No interpolation is performed. No smoothing is performed. No decimation is performed.',
    'No model temperature is involved in Step 44, and no model-minus-observation difference is computed (that is Step 45).',
  ],
  missing_value: null,
}

test('getArgoObservedTemperatureProfile() hits the temperature-profile endpoint', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const r = await client.getArgoObservedTemperatureProfile('3902669_4')

  assert.equal(calls[0], `${BASE}/api/observations/argo/3902669_4/temperature-profile`)
  assert.equal(r.observation.platform_id, '3902669_4')
  assert.equal(r.observation.cycle_number, 4)
  assert.equal(r.metadata.variable, 'sea_water_temperature')
  assert.equal(r.metadata.units, 'degree_Celsius')
  assert.equal(r.metadata.vertical_coordinate, 'pressure_dbar')
})

test('the real observed pairs + QC + counts pass through verbatim', async () => {
  const { fetch } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const r = await client.getArgoObservedTemperatureProfile('3902669_4')

  // Argo position / time untouched
  assert.equal(r.observation.latitude, 19.666666666666668)
  assert.equal(r.observation.timestamp, '2025-03-31T15:00:20Z')
  // ascending pressure, native coordinate, real values
  const press = r.profile.map((p) => p.pressure_dbar)
  assert.deepEqual(press, [...press].sort((a, b) => a - b))
  assert.equal(r.profile[0].temperature, 27.404)
  assert.equal(r.profile[0].temperature_qc, '1')
  // QC retained, not filtered
  assert.equal(r.metadata.qc.filtering_applied, false)
  assert.equal(r.metadata.qc.flags_retained, true)
  // counts consistent
  assert.equal(
    r.metadata.finite_temperature_count + r.metadata.null_temperature_count,
    r.metadata.source_level_count,
  )
  // Step 44 says nothing about the model
  assert.ok(r.notes.some((n) => /no model-minus-observation difference/i.test(n)))
})

test('unknown platform / malformed id surface as ApiError — never synthetic data', async () => {
  for (const [status, type] of [
    [404, 'unknown_argo_platform'],
    [422, 'malformed_request'],
  ] as const) {
    const { fetch } = mockFetch(() => ({
      status,
      body: { error: { type, message: 'x', detail: {} } },
    }))
    const client = createDataApiClient({ baseUrl: BASE, fetch })
    await assert.rejects(
      () => client.getArgoObservedTemperatureProfile('9999999_1'),
      (err: unknown) => err instanceof ApiError && err.type === type && err.status === status,
    )
  }
})
