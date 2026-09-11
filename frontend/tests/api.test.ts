/**
 * D11 frontend data-layer unit tests.
 *
 * Runner: Node's built-in `node:test` (no test framework added). Node 24 runs
 * `.ts` directly via type-stripping.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/api.test.ts
 *
 * HTTP is mocked with an injected `fetch`. A real end-to-end check against the
 * running backend lives in `tests/integration.check.mjs`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { API_BASE_URL, API_BASE_URL_IS_CONFIGURED } from '../src/api/config.ts'
import { ApiError, createDataApiClient, isAbortError } from '../src/api/client.ts'
import type { SliceResponse } from '../src/api/types.ts'

// ---------------------------------------------------------------------------
// mock fetch
// ---------------------------------------------------------------------------
interface MockCall {
  url: string
  init: RequestInit | undefined
}

function mockFetch(
  handler: (url: string) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const { status = 200, body } = await handler(url)
    const text = body === undefined ? '' : JSON.stringify(body)
    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const BASE = 'http://test.local'

// ---------------------------------------------------------------------------
// fixtures (trimmed real D10 shapes)
// ---------------------------------------------------------------------------
const HEALTH = { status: 'ok', service: 'bluenexus-data-api', data_layer: { all_expected_present: true } }
const DATASETS = {
  count: 2,
  datasets: [
    { dataset_id: 'incois_argo_10day_analysis', title: 'T&S', product_type: 'analysis', parameter_ids: ['temperature', 'salinity'] },
    { dataset_id: 'incois_io_hoofs_surface_currents', title: 'Currents', product_type: 'forecast', parameter_ids: ['current_u', 'current_v', 'current_speed'] },
  ],
}
const DATASET_DETAIL = { schema_version: 'bluenexus.dataset/1', dataset_id: 'incois_argo_10day_analysis', product_type: 'analysis', coordinates: {}, parameters: {}, metadata: {}, provenance: {} }
const PARAMETERS = {
  dataset_id: 'incois_argo_10day_analysis',
  canonical_parameter_ids: ['temperature', 'salinity'],
  note: 'canonical only',
  parameters: [
    { parameter_id: 'temperature', units: 'degC', raw_units: 'degs', kind: 'scalar_field', surface_only: false, shape: [3, 24, 36, 51], dimensions: ['time', 'depth', 'latitude', 'longitude'], accepts_aliases: false },
    { parameter_id: 'salinity', units: 'PSU', kind: 'scalar_field', surface_only: false, shape: [3, 24, 36, 51], accepts_aliases: false },
  ],
}
const COORDS = {
  dataset_id: 'incois_argo_10day_analysis',
  coordinates: {
    time: { role: 'time', name: 'time', count: 3, values: [1783641600, 1784505600, 1785369600], units: 'seconds since 1970-01-01T00:00:00Z', iso_times: ['2026-07-10T00:00:00Z', '2026-07-20T00:00:00Z', '2026-07-30T00:00:00Z'], regular_step: 864000 },
    depth: { role: 'depth', name: 'ZAX', count: 24, values: [5, 10, 20], units: 'METERS', regular_step: null },
    latitude: { role: 'latitude', name: 'latitude', count: 36, values: [-9.5, 25.5], units: 'degrees_north' },
    longitude: { role: 'longitude', name: 'longitude', count: 51, values: [50.5, 100.5], units: 'degrees_east' },
  },
}
const SLICE: SliceResponse = {
  schema_version: 'bluenexus.dataset/1',
  dataset_id: 'incois_argo_10day_analysis',
  parameter: 'temperature',
  units: 'degC',
  product_type: 'analysis',
  data_status: 'analysis',
  missing_value: null,
  quality_definition: { '0': 'VALID', '1': 'MISSING' },
  time: { index: 0, value: 1783641600, iso: '2026-07-10T00:00:00Z', units: 'seconds since 1970-01-01T00:00:00Z' },
  depth: { index: 0, value: 5, units: 'METERS' },
  shape: { latitude: 2, longitude: 3 },
  latitude: [-9.5, -8.5],
  longitude: [50.5, 51.5, 52.5],
  values: [
    [null, 0.0, 27.5],
    [12.25, null, -0.0],
  ],
  quality: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  parameter_metadata: { display_name: 'Sea Water Temperature', kind: 'scalar_field', vector_group: null, vector_role: null, authoritative: true, surface_only: false, standard_name: null, long_name: 'Objectively Analyzed Temperature', raw_units: 'degs' },
  provenance: { source_name: 'INCOIS ERDDAP', source_url: 'x', source_dataset_id: 'incois_argo_10day_McCreary', source_file_sha256: 'abc', conventions: 'CF-1.6', pipeline_stages: ['D4 acquisition', 'D9 BlueNexus format'], original_units: { temperature: 'degs' }, canonical_units: { temperature: 'degC' } },
  bytes_read: 16524,
}

// Representative real observation shapes (trimmed) — Steps 28/29, Step 35 contract.
const ARGO_LIST = {
  dataset_id: 'incois_indian_argo_floats',
  count: 1,
  units: { pressure: 'decibar', temperature: 'degree_Celsius', salinity: 'PSU' },
  platform_type: 'argo',
  note: 'one entry per real Argo float profile',
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
      pressure_max: 1980.0,
    },
  ],
}
const ARGO_DETAIL = {
  ...ARGO_LIST.platforms[0],
  dataset_id: 'incois_indian_argo_floats',
  units: ARGO_LIST.units,
  standard_names: {},
  quality_definition: { '1': 'good', '4': 'bad' },
  missing_value: null,
  provenance: ARGO_LIST.provenance,
  levels: [
    { pressure: 2.5, pressure_qc: '1', temperature: 29.995, temperature_qc: '1', salinity: 34.858, salinity_qc: '1' },
    { pressure: 1980.0, pressure_qc: '1', temperature: 3.11, temperature_qc: '1', salinity: null, salinity_qc: null },
  ],
}
const GLIDER_LIST = {
  dataset_id: 'ego_oceangliders_gdac',
  count: 1,
  units: { pressure: 'decibar', temperature: 'degree_Celsius', salinity: 'PSU' },
  platform_type: 'glider',
  note: 'one entry per real glider deployment',
  provenance: { source_name: 'EGO / OceanGliders GDAC', source_dataset_id: 'OceanGlidersGDACTrajectories' },
  platforms: [
    {
      platform_id: 'sea057_20220707',
      platform_type: 'glider',
      sample_count: 2740,
      time_start: '2022-07-03T14:02:26Z',
      time_end: '2022-07-31T00:00:00Z',
      latitude_min: 23.0,
      latitude_max: 24.0,
      longitude_min: 58.0,
      longitude_max: 59.0,
      pressure_min: 0.05,
      pressure_max: 664.7,
    },
  ],
}
const GLIDER_DETAIL = {
  ...GLIDER_LIST.platforms[0],
  dataset_id: 'ego_oceangliders_gdac',
  units: GLIDER_LIST.units,
  standard_names: {},
  quality_definition: { '1': 'good', '4': 'bad' },
  missing_value: null,
  provenance: GLIDER_LIST.provenance,
  samples: [
    { time: '2022-07-03T14:02:26Z', latitude: 23.5904, longitude: 58.168, position_qc: '4', pressure: 0.0549, pressure_qc: '1', temperature: 28.2624, temperature_qc: '1', salinity: null, salinity_qc: null },
    { time: '2022-07-03T14:10:00Z', latitude: 23.59, longitude: 58.17, position_qc: '1', pressure: 664.7, pressure_qc: '1', temperature: 11.48, temperature_qc: '1', salinity: 35.68, salinity_qc: '1' },
  ],
}

function router(url: string) {
  if (url.endsWith('/api/health')) return { body: HEALTH }
  if (url.endsWith('/api/datasets')) return { body: DATASETS }
  if (url.endsWith('/api/datasets/incois_argo_10day_analysis')) return { body: DATASET_DETAIL }
  if (url.endsWith('/parameters')) return { body: PARAMETERS }
  if (url.endsWith('/coordinates')) return { body: COORDS }
  if (url.includes('/slice')) return { body: SLICE }
  if (url.endsWith('/api/observations/argo')) return { body: ARGO_LIST }
  if (url.endsWith('/api/observations/argo/2903951_10')) return { body: ARGO_DETAIL }
  if (url.includes('/api/observations/argo/'))
    return { status: 404, body: { error: { type: 'unknown_argo_platform', message: 'no such profile', detail: { known_platform_ids: ['2903951_10'] } } } }
  if (url.endsWith('/api/observations/gliders')) return { body: GLIDER_LIST }
  if (url.endsWith('/api/observations/gliders/sea057_20220707')) return { body: GLIDER_DETAIL }
  if (url.includes('/api/observations/gliders/'))
    return { status: 404, body: { error: { type: 'unknown_glider_deployment', message: 'no such deployment', detail: { known_platform_ids: ['sea057_20220707'] } } } }
  return { status: 404, body: { error: { type: 'unknown_dataset', message: 'nope', detail: {} } } }
}

// ---------------------------------------------------------------------------
// 1. base URL configuration
// ---------------------------------------------------------------------------
test('1. API base URL: built-in development default is the D10 backend', () => {
  assert.equal(API_BASE_URL, 'http://localhost:8000')
  assert.equal(API_BASE_URL_IS_CONFIGURED, false)
})

test('1b. client honours an explicit base URL and strips trailing slashes', () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: 'http://example.test:9000///', fetch })
  assert.equal(client.baseUrl, 'http://example.test:9000')
  return client.getHealth().then(() => {
    assert.equal(calls[0].url, 'http://example.test:9000/api/health')
  })
})

// ---------------------------------------------------------------------------
// 2-8. each endpoint + JSON parsing
// ---------------------------------------------------------------------------
test('2. getHealth() parses the health response', async () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const health = await client.getHealth()
  assert.equal(health.status, 'ok')
  assert.equal(calls[0].url, `${BASE}/api/health`)
  assert.equal(calls[0].init?.method, 'GET')
})

test('3. getDatasets() returns the two known datasets', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  const list = await client.getDatasets()
  assert.equal(list.count, 2)
  assert.deepEqual(
    list.datasets.map((d) => d.dataset_id).sort(),
    ['incois_argo_10day_analysis', 'incois_io_hoofs_surface_currents'],
  )
})

test('4. getDataset() fetches the detail resource', async () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const detail = await client.getDataset('incois_argo_10day_analysis')
  assert.equal(detail.dataset_id, 'incois_argo_10day_analysis')
  assert.equal(calls[0].url, `${BASE}/api/datasets/incois_argo_10day_analysis`)
})

test('5. getParameters() finds canonical temperature (degC, analysis, not surface-only)', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  const params = await client.getParameters('incois_argo_10day_analysis')
  assert.deepEqual(params.canonical_parameter_ids, ['temperature', 'salinity'])
  const temperature = params.parameters.find((p) => p.parameter_id === 'temperature')
  assert.ok(temperature)
  assert.equal(temperature?.units, 'degC')
  assert.equal(temperature?.surface_only, false)
  assert.deepEqual(temperature?.shape, [3, 24, 36, 51])
})

test('6. getCoordinates() preserves the exact coordinate arrays', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  const coords = await client.getCoordinates('incois_argo_10day_analysis')
  assert.equal(coords.coordinates.time?.count, 3)
  assert.equal(coords.coordinates.depth?.count, 24)
  assert.equal(coords.coordinates.latitude?.count, 36)
  assert.equal(coords.coordinates.longitude?.count, 51)
  assert.deepEqual(coords.coordinates.depth?.values, [5, 10, 20])
  assert.equal(coords.coordinates.time?.iso_times?.[0], '2026-07-10T00:00:00Z')
})

test('7/8. getParameterSlice() builds the query and parses the structured slice', async () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const slice = await client.getParameterSlice('incois_argo_10day_analysis', 'temperature', {
    timeIndex: 0,
    depthIndex: 0,
  })
  assert.equal(
    calls[0].url,
    `${BASE}/api/datasets/incois_argo_10day_analysis/parameters/temperature/slice?time_index=0&depth_index=0`,
  )
  assert.equal(slice.units, 'degC')
  assert.equal(slice.product_type, 'analysis')
  assert.equal(slice.missing_value, null)
  // structured object, not flattened
  assert.ok(Array.isArray(slice.values))
  assert.ok(Array.isArray(slice.values[0]))
  assert.equal(slice.values.length, 2)
  assert.equal(slice.values[0].length, 3)
  assert.deepEqual(slice.latitude, [-9.5, -8.5])
  assert.deepEqual(slice.longitude, [50.5, 51.5, 52.5])
  assert.ok(slice.provenance.pipeline_stages.includes('D9 BlueNexus format'))
  assert.equal(slice.parameter_metadata.surface_only, false)
})

// ---------------------------------------------------------------------------
// 9-11. failure handling
// ---------------------------------------------------------------------------
test('9. non-2xx response throws ApiError with the HTTP status', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  await assert.rejects(
    () => client.getDataset('nope'),
    (err: unknown) => ApiError.is(err) && err.status === 404,
  )
})

test('10. D10 structured error envelope is preserved (type + message + detail)', async () => {
  const { fetch } = mockFetch(() => ({
    status: 404,
    body: { error: { type: 'parameter_not_in_dataset', message: "parameter 'temperature' is not in dataset", detail: { available_parameters: ['current_u'] } } },
  }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  await assert.rejects(
    () => client.getParameterSlice('incois_io_hoofs_surface_currents', 'temperature'),
    (err: unknown) => {
      assert.ok(ApiError.is(err))
      assert.equal((err as ApiError).type, 'parameter_not_in_dataset')
      assert.match((err as ApiError).message, /not in dataset/)
      assert.deepEqual((err as ApiError).detail, { available_parameters: ['current_u'] })
      return true
    },
  )
})

test('11. network failure throws ApiError(type="network_error", status=null)', async () => {
  const failing = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: BASE, fetch: failing })
  await assert.rejects(
    () => client.getHealth(),
    (err: unknown) => ApiError.is(err) && err.type === 'network_error' && err.status === null,
  )
})

test('11b. an aborted request rejects with an AbortError, not an ApiError', async () => {
  const controller = new AbortController()
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: BASE, fetch: hanging })
  const promise = client.getHealth(controller.signal)
  controller.abort()
  await assert.rejects(promise, (err: unknown) => isAbortError(err) && !ApiError.is(err))
})

// ---------------------------------------------------------------------------
// 12-14. missing / zero / quality preservation
// ---------------------------------------------------------------------------
test('12. a missing value stays null (never coerced to 0 / -1 / -9999 / -1e34)', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  const slice = await client.getParameterSlice('incois_argo_10day_analysis', 'temperature')
  assert.equal(slice.values[0][0], null)
  assert.equal(slice.values[1][1], null)
  const flat = slice.values.flat()
  assert.ok(!flat.includes(-1))
  assert.ok(!flat.includes(-9999))
  assert.ok(!flat.includes(-1e34))
})

test('13. a real 0.0 stays 0.0 and its quality stays VALID (0)', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  const slice = await client.getParameterSlice('incois_argo_10day_analysis', 'temperature')
  assert.equal(slice.values[0][1], 0)
  assert.equal(Object.is(slice.values[0][1], 0) || slice.values[0][1] === 0, true)
  assert.equal(slice.quality[0][1], 0)
  // negative-zero cell also survives as a number, not null
  assert.equal(typeof slice.values[1][2], 'number')
  assert.equal(slice.quality[1][2], 0)
})

test('14. quality flags survive unchanged and line up with null cells', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  const slice = await client.getParameterSlice('incois_argo_10day_analysis', 'temperature')
  assert.deepEqual(slice.quality, [
    [1, 0, 0],
    [0, 1, 0],
  ])
  for (let r = 0; r < slice.values.length; r += 1) {
    for (let c = 0; c < slice.values[r].length; c += 1) {
      assert.equal(slice.values[r][c] === null, slice.quality[r][c] === 1)
    }
  }
})

// ---------------------------------------------------------------------------
// 15. no mock fallback
// ---------------------------------------------------------------------------
test('15. the client never returns fabricated data on failure — it throws', async () => {
  const alwaysFails = (async () => new Response('{"error":{"type":"data_unavailable","message":"gone"}}', { status: 503 })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: BASE, fetch: alwaysFails })
  for (const call of [
    () => client.getHealth(),
    () => client.getDatasets(),
    () => client.getDataset('x'),
    () => client.getParameters('x'),
    () => client.getCoordinates('x'),
    () => client.getParameterSlice('x', 'temperature'),
    () => client.getArgoPlatforms(),
    () => client.getArgoPlatform('2903951_10'),
    () => client.getGliderPlatforms(),
    () => client.getGliderPlatform('sea057_20220707'),
  ]) {
    await assert.rejects(call, (err: unknown) => ApiError.is(err))
  }
})

// ---------------------------------------------------------------------------
// 16-19. Step 36 — observation endpoints go through the same client boundary
// ---------------------------------------------------------------------------
test('16. getArgoPlatforms() returns the real float summaries with native units', async () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const list = await client.getArgoPlatforms()
  assert.equal(calls[0].url, `${BASE}/api/observations/argo`)
  assert.equal(list.platform_type, 'argo')
  assert.equal(list.units.pressure, 'decibar')
  assert.equal(list.platforms[0].platform_id, '2903951_10')
  assert.equal(list.platforms[0].time, '2025-04-01T13:29:00Z') // ISO timestamp verbatim
})

test('17. getArgoPlatform() preserves real levels, nullable salinity and QC', async () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const detail = await client.getArgoPlatform('2903951_10')
  assert.equal(calls[0].url, `${BASE}/api/observations/argo/2903951_10`)
  assert.equal(detail.missing_value, null)
  assert.equal(detail.levels[0].pressure, 2.5)
  assert.equal(detail.levels[0].salinity, 34.858)
  assert.equal(detail.levels[1].salinity, null) // a real gap stays null
  assert.equal(detail.levels[1].salinity_qc, null)
})

test('18. glider list + deployment come through the client, samples intact', async () => {
  const { fetch, calls } = mockFetch(router)
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const list = await client.getGliderPlatforms()
  assert.equal(calls[0].url, `${BASE}/api/observations/gliders`)
  assert.equal(list.platforms[0].platform_id, 'sea057_20220707')
  const detail = await client.getGliderPlatform('sea057_20220707')
  assert.equal(calls[1].url, `${BASE}/api/observations/gliders/sea057_20220707`)
  assert.equal(detail.samples.length, 2)
  assert.equal(detail.samples[0].salinity, null)
  assert.equal(detail.samples[1].temperature, 11.48)
  assert.equal(detail.samples[0].position_qc, '4') // bad-flagged but kept
})

test('19. unknown Argo / glider → 404 ApiError with the Step 35 slug preserved', async () => {
  const client = createDataApiClient({ baseUrl: BASE, fetch: mockFetch(router).fetch })
  await assert.rejects(
    () => client.getArgoPlatform('9999999_1'),
    (err: unknown) =>
      ApiError.is(err) && err.status === 404 && err.type === 'unknown_argo_platform' && err.kind === 'http',
  )
  await assert.rejects(
    () => client.getGliderPlatform('nope_20200101'),
    (err: unknown) =>
      ApiError.is(err) && err.status === 404 && err.type === 'unknown_glider_deployment',
  )
})

// ---------------------------------------------------------------------------
// 20-21. Step 36 — ApiError.kind discriminant (network / http / malformed)
// ---------------------------------------------------------------------------
test('20. ApiError.kind classifies network vs http failures', async () => {
  const offline = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  await assert.rejects(
    () => createDataApiClient({ baseUrl: BASE, fetch: offline }).getHealth(),
    (err: unknown) => ApiError.is(err) && err.kind === 'network' && err.status === null,
  )
  const http404 = mockFetch(() => ({ status: 404, body: { error: { type: 'unknown_dataset', message: 'x' } } })).fetch
  await assert.rejects(
    () => createDataApiClient({ baseUrl: BASE, fetch: http404 }).getDataset('x'),
    (err: unknown) => ApiError.is(err) && err.kind === 'http' && err.status === 404,
  )
})

test('21. a 2xx body that is not JSON fails honestly as kind="malformed"', async () => {
  const htmlBody = (async () =>
    new Response('<!doctype html><title>proxy</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: BASE, fetch: htmlBody })
  await assert.rejects(
    () => client.getDatasets(),
    (err: unknown) =>
      ApiError.is(err) && err.kind === 'malformed' && err.type === 'invalid_response' && err.status === 200,
  )
})

test('22. a non-2xx body without the envelope still yields a clean http ApiError', async () => {
  const badGateway = (async () =>
    new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: BASE, fetch: badGateway })
  await assert.rejects(
    () => client.getHealth(),
    (err: unknown) =>
      ApiError.is(err) && err.kind === 'http' && err.status === 502 && err.type === 'http_502',
  )
})
