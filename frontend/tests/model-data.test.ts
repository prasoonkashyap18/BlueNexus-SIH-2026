/**
 * Step 42 — frontend model-data availability (client boundary only).
 *
 * Runner: Node's built-in `node:test`. HTTP is mocked with an injected `fetch`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/model-data.test.ts
 *
 * Proves the client can ask the backend for the real ocean MODEL TEMPERATURE
 * dataset (`/api/netcdf/*`, Step 39 pipeline wired to MERCATOR GLORYS12V1 in
 * Step 42): correct URLs, the explicit `"GLORYS12V1 / Copernicus Marine"`
 * identity, CF-decoded `degrees_C` values passed through untouched (never packed
 * `int16`), NaN stays `null`, the sample's real limited `coverage` is carried,
 * and a missing model file surfaces as an {@link ApiError} — never fabricated
 * data. Nothing here renders the model.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type { ModelDatasetResponse, ModelSliceResponse, ModelVariableResponse } from '../src/api/types.ts'

interface MockCall {
  url: string
}

function mockFetch(
  handler: (url: string) => { status?: number; body: unknown },
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push({ url })
    const { status = 200, body } = handler(url)
    const text = body === undefined ? '' : JSON.stringify(body)
    return new Response(text, { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const BASE = 'http://test.local'

// A faithful shape of what the Step 42 backend serves for the GLORYS Arabian
// Sea subset (61.5–70 °E, 8–20.5 °N, 2025-03-24…04-02, 0–541 m).
const MODEL_DATASET: ModelDatasetResponse = {
  dataset_id: 'glorys12v1_model',
  source: {
    file_name: 'temperature_cmems_glorys12v1_arabiansea.nc',
    engine: 'netcdf4',
    label: 'GLORYS12V1 / Copernicus Marine',
  },
  dimensions: { time: 10, depth: 32, latitude: 151, longitude: 103 },
  coordinates: [
    { name: 'time', role: 'time', dimensions: ['time'], size: 10, dtype: 'datetime64[ns]', units: null, attributes: {}, values: ['2025-03-24T00:00:00Z', '2025-04-02T00:00:00Z'] },
    { name: 'depth', role: 'depth', dimensions: ['depth'], size: 32, dtype: 'float32', units: 'm', attributes: { positive: 'down' }, values: [0.494025, 541.0889] },
    { name: 'latitude', role: 'latitude', dimensions: ['latitude'], size: 151, dtype: 'float32', units: 'degrees_north', attributes: {}, values: [8.0, 20.5] },
    { name: 'longitude', role: 'longitude', dimensions: ['longitude'], size: 103, dtype: 'float32', units: 'degrees_east', attributes: {}, values: [61.5, 70.0] },
  ],
  variables: ['thetao'],
  variable_count: 1,
  global_attributes: { Conventions: 'CF-1.4', source: 'MERCATOR GLORYS12V1', bulletin_date: '2021-07-07 00:00:00' },
  coverage: {
    time: { start: '2025-03-24T00:00:00Z', end: '2025-04-02T00:00:00Z', count: 10 },
    depth: { min: 0.494025, max: 541.0889, count: 32, units: 'm', positive: 'down' },
    latitude: { min: 8.0, max: 20.5, count: 151, units: 'degrees_north' },
    longitude: { min: 61.5, max: 70.0, count: 103, units: 'degrees_east' },
    bounding_box: { latitude: [8.0, 20.5], longitude: [61.5, 70.0] },
    note: 'This is the full extent of the configured NetCDF sample -- it is not basin-wide coverage. Requests outside this box / time / depth range have no model data.',
  },
  decoding: { cf_mask_and_scale: true, note: 'Variables were opened with xarray mask_and_scale=True.' },
  nan_encoding: 'CF-decoded; NaN as null at the JSON boundary only',
}

const MODEL_VARIABLE: ModelVariableResponse = {
  dataset_id: 'glorys12v1_model',
  name: 'thetao',
  dimensions: ['time', 'depth', 'latitude', 'longitude'],
  shape: [10, 32, 151, 103],
  dtype: 'float64',
  units: 'degrees_C',
  attributes: { standard_name: 'sea_water_potential_temperature', units: 'degrees_C', valid_min: -32766, valid_max: 21306 },
  axis_roles: { time: 'time', depth: 'depth', latitude: 'latitude', longitude: 'longitude' },
  decoding: {
    cf_mask_and_scale: true,
    source_packed: true,
    raw_dtype: 'int16',
    decoded_dtype: 'float64',
    applied: ['scale_factor', 'add_offset', '_FillValue'],
    packing: { dtype: 'int16', scale_factor: 0.0007324442267417908, add_offset: 21.0, _FillValue: -32767 },
    note: 'CF mask-and-scale decoding is ON.',
  },
  nan_encoding: 'x',
}

const MODEL_SLICE: ModelSliceResponse = {
  dataset_id: 'glorys12v1_model',
  variable: 'thetao',
  units: 'degrees_C',
  dtype: 'float64',
  selection: [
    { role: 'time', dimension: 'time', index: 0, value: '2025-03-24T00:00:00Z', iso: '2025-03-24T00:00:00Z' },
    { role: 'depth', dimension: 'depth', index: 0, value: 0.494025, iso: null },
  ],
  dimensions: ['latitude', 'longitude'],
  shape: [2, 3],
  element_count: 6,
  coordinates: { latitude: [19.0, 19.5], longitude: [64.5, 64.583, 64.667] },
  // Real CF-decoded degrees_C — a warm Arabian-Sea surface. Not packed integers.
  values: [
    [27.2411572560668, 27.5133, null],
    [27.8703, 27.61, 27.44],
  ],
  missing_value: null,
  decoding: MODEL_VARIABLE.decoding,
  variable_metadata: { name: 'thetao', dtype: 'float64', units: 'degrees_C' },
  nan_encoding: 'x',
}

test('getModelDataset() hits /api/netcdf/dataset and carries the GLORYS identity + coverage', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: MODEL_DATASET }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const ds = await client.getModelDataset()

  assert.equal(calls[0].url, `${BASE}/api/netcdf/dataset`)
  assert.equal(ds.dataset_id, 'glorys12v1_model')
  assert.equal(ds.source.label, 'GLORYS12V1 / Copernicus Marine')
  assert.deepEqual(ds.variables, ['thetao'])
  assert.deepEqual(ds.dimensions, { time: 10, depth: 32, latitude: 151, longitude: 103 })
  const roles = Object.fromEntries(ds.coordinates.map((c) => [c.name, c.role]))
  assert.deepEqual(roles, { time: 'time', depth: 'depth', latitude: 'latitude', longitude: 'longitude' })
  // the real limited extent travels with the response
  assert.equal(ds.coverage?.time?.count, 10)
  assert.deepEqual(ds.coverage?.bounding_box, { latitude: [8, 20.5], longitude: [61.5, 70] })
  assert.equal(ds.decoding?.cf_mask_and_scale, true)
})

test('getModelVariable() reports thetao as CF-decoded degrees_C, not packed int16', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: MODEL_VARIABLE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const v = await client.getModelVariable('thetao')

  assert.equal(calls[0].url, `${BASE}/api/netcdf/variables/thetao`)
  assert.equal(v.units, 'degrees_C')
  assert.equal(v.dtype, 'float64') // decoded, not int16
  assert.equal(v.attributes.standard_name, 'sea_water_potential_temperature')
  assert.equal(v.decoding?.cf_mask_and_scale, true)
  assert.equal(v.decoding?.raw_dtype, 'int16')
  assert.ok(v.decoding?.applied?.includes('scale_factor'))
  assert.ok(v.decoding?.applied?.includes('add_offset'))
})

test('getModelVariableSlice() builds the indexed query and keeps decoded °C + null verbatim', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: MODEL_SLICE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const slice = await client.getModelVariableSlice('thetao', { timeIndex: 0, depthIndex: 0 })

  assert.equal(
    calls[0].url,
    `${BASE}/api/netcdf/variables/thetao/slice?time_index=0&depth_index=0`,
  )
  assert.equal(slice.units, 'degrees_C')
  // real decoded value passed straight through — not rounded, not re-scaled
  assert.equal((slice.values as (number | null)[][])[0][0], 27.2411572560668)
  // a plausible ocean temperature, never a packed int16 like ~8500
  const flat = (slice.values as (number | null)[][]).flat().filter((x): x is number => x !== null)
  assert.ok(flat.every((t) => t > -3 && t < 40), 'all decoded values are physical °C')
  // missing cell stays null (never 0 / -32767)
  assert.equal((slice.values as (number | null)[][])[0][2], null)
  assert.equal(slice.missing_value, null)
})

test('getModelVariableSlice() supports the full time × depth × lat × lon axis set', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: MODEL_SLICE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  await client.getModelVariableSlice('thetao', {
    timeIndex: 0,
    depthIndex: 5,
    latitudeIndex: 6,
    longitudeIndex: 6,
  })
  assert.equal(
    calls[0].url,
    `${BASE}/api/netcdf/variables/thetao/slice?time_index=0&depth_index=5&latitude_index=6&longitude_index=6`,
  )
})

test('getModelVariableSlice() omits absent indices from the query', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: MODEL_SLICE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  await client.getModelVariableSlice('thetao', { depthIndex: 3 })
  assert.equal(calls[0].url, `${BASE}/api/netcdf/variables/thetao/slice?depth_index=3`)
})

test('a missing model file surfaces as an ApiError — never synthetic data', async () => {
  const { fetch } = mockFetch(() => ({
    status: 503,
    body: { error: { type: 'netcdf_unavailable', message: 'the configured NetCDF dataset is not available', detail: {} } },
  }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  await assert.rejects(
    () => client.getModelDataset(),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.kind, 'http')
      assert.equal(err.status, 503)
      assert.equal(err.type, 'netcdf_unavailable')
      return true
    },
  )
})
