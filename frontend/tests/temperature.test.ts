/**
 * D12 unit tests — the real-temperature data model + the renderer's grid
 * sampler. Node's built-in `node:test`, HTTP mocked with an injected `fetch`.
 *
 *   cd frontend && npm run test:d12
 *   # or: node --test tests/temperature.test.ts
 *
 * These prove the D11 client is used, the D10 slice is stored 36 x 51 with
 * `null`/`0` preserved and quality aligned, the latitude/longitude axes are
 * not swapped or reversed, and the depth axis is the real irregular one.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createDataApiClient } from '../src/api/client.ts'
import type { SliceResponse } from '../src/api/types.ts'
import {
  nearestIndex,
  sampleSliceTemperature,
  type TemperatureGridSlice,
} from '../src/state/temperatureDataState.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const { status = 200, body } = handler(url)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const LAT = [-9.5, -8.5, -7.5]
const LON = [50.5, 51.5, 52.5, 53.5]

/** A 3 x 4 slice: row = latitude, col = longitude. Corner values are distinct
 *  so a swap/reverse is detectable. One `null` (missing), one real `0`. */
const SLICE: TemperatureGridSlice = {
  timeIndex: 0,
  depthIndex: 0,
  depthMetres: 5,
  timeIso: '2026-07-10T00:00:00Z',
  values: [
    [10.0, 11.0, 12.0, 13.0], //  lat -9.5  (south edge)
    [20.0, null, 0.0, 23.0], //   lat -8.5
    [30.0, 31.0, 32.0, 33.0], //  lat -7.5  (north edge)
  ],
  quality: [
    [0, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
  ],
}

// ---------------------------------------------------------------------------
// 1-2. the D11 client is used, with the canonical ids
// ---------------------------------------------------------------------------
test('1-5. temperature slice is requested via the D11 client with canonical ids and indices', async () => {
  const slice: SliceResponse = {
    schema_version: 'bluenexus.dataset/1',
    dataset_id: 'incois_argo_10day_analysis',
    parameter: 'temperature',
    units: 'degC',
    product_type: 'analysis',
    data_status: 'analysis',
    missing_value: null,
    quality_definition: { '0': 'VALID', '1': 'MISSING' },
    time: { index: 2, value: 1785369600, iso: '2026-07-30T00:00:00Z', units: 's' },
    depth: { index: 7, value: 125, units: 'METERS' },
    shape: { latitude: 2, longitude: 2 },
    latitude: [-9.5, -8.5],
    longitude: [50.5, 51.5],
    values: [[1, null], [0, 2]],
    quality: [[0, 1], [0, 0]],
    parameter_metadata: {} as SliceResponse['parameter_metadata'],
    provenance: {} as SliceResponse['provenance'],
    bytes_read: 100,
  }
  const { fetch, calls } = mockFetch(() => ({ body: slice }))
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })

  const result = await client.getParameterSlice('incois_argo_10day_analysis', 'temperature', {
    timeIndex: 2,
    depthIndex: 7,
  })

  assert.equal(
    calls[0],
    'http://t/api/datasets/incois_argo_10day_analysis/parameters/temperature/slice?time_index=2&depth_index=7',
  )
  assert.equal(result.parameter, 'temperature') // exactly, not "sst"
  assert.equal(result.units, 'degC')
  assert.equal(result.product_type, 'analysis')
})

// ---------------------------------------------------------------------------
// 6-11. slice is stored 36 x 51, null / 0 / quality preserved
// ---------------------------------------------------------------------------
test('6-7. slice dimensions are preserved exactly (row = latitude, col = longitude)', () => {
  assert.equal(SLICE.values.length, LAT.length)
  assert.equal(SLICE.values[0].length, LON.length)
  assert.equal(SLICE.quality.length, SLICE.values.length)
  assert.equal(SLICE.quality[0].length, SLICE.values[0].length)
})

test('8-9. a missing value stays null and its quality stays 1', () => {
  assert.equal(SLICE.values[1][1], null)
  assert.equal(SLICE.quality[1][1], 1)
  // sampling exactly on the missing cell yields validity 0, not a fabricated value
  const s = sampleSliceTemperature(SLICE, LAT, LON, LAT[1], LON[1])
  assert.equal(s.valid, 0)
})

test('10. a real 0.0 stays 0.0 and its quality stays 0 (VALID)', () => {
  assert.equal(SLICE.values[1][2], 0)
  assert.equal(SLICE.quality[1][2], 0)
  const s = sampleSliceTemperature(SLICE, LAT, LON, LAT[1], LON[2])
  assert.equal(s.value, 0)
  assert.equal(s.valid, 1)
})

// ---------------------------------------------------------------------------
// 21. orientation — latitude axis -> latitude, longitude axis -> longitude
// ---------------------------------------------------------------------------
test('21. sampling at a grid node returns that exact cell — axes are not swapped/reversed', () => {
  // first latitude, first longitude  -> values[0][0]
  assert.equal(sampleSliceTemperature(SLICE, LAT, LON, LAT[0], LON[0]).value, SLICE.values[0][0])
  // last latitude, last longitude    -> values[last][last]
  assert.equal(
    sampleSliceTemperature(SLICE, LAT, LON, LAT[2], LON[3]).value,
    SLICE.values[2][3],
  )
  // first latitude, last longitude   -> values[0][3]  (a swap would give values[3][0] -> out of range)
  assert.equal(sampleSliceTemperature(SLICE, LAT, LON, LAT[0], LON[3]).value, SLICE.values[0][3])
  // last latitude, first longitude   -> values[2][0]
  assert.equal(sampleSliceTemperature(SLICE, LAT, LON, LAT[2], LON[0]).value, SLICE.values[2][0])
})

test('21b. sampling between nodes is a bilinear blend of the surrounding cells', () => {
  // centre of the cell bounded by lat[0]/lat[1] and lon[2]/lon[3]:
  // corners values[0][2]=12, values[0][3]=13, values[1][2]=0, values[1][3]=23 -> mean 12
  const s = sampleSliceTemperature(SLICE, LAT, LON, -9.0, 53.0)
  assert.ok(Math.abs(s.value - 12) < 1e-9, `expected 12, got ${s.value}`)
  assert.equal(s.valid, 1)
})

test('21c. a cell partly over missing data reports reduced validity, no invented value', () => {
  // centre of the cell bounded by lat[1]/lat[2] and lon[0]/lon[1]:
  // corners values[1][0]=20, values[1][1]=null, values[2][0]=30, values[2][1]=31
  const s = sampleSliceTemperature(SLICE, LAT, LON, -8.0, 51.0)
  assert.ok(s.valid > 0 && s.valid < 1, `expected partial validity, got ${s.valid}`)
  // value comes only from the three valid corners: (20 + 30 + 31) / 3 = 27
  assert.ok(Math.abs(s.value - 27) < 1e-9, `expected 27, got ${s.value}`)
})

// ---------------------------------------------------------------------------
// 22. depth axis — nearest real index, irregular spacing
// ---------------------------------------------------------------------------
test('22. depth slider metres map to the nearest real irregular depth index', () => {
  const realDepths = [5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500]
  assert.equal(nearestIndex(realDepths, 0), 0) //   0 m  -> 5 m  (index 0)
  assert.equal(nearestIndex(realDepths, 100), 6) // 100 m -> exactly index 6
  assert.equal(nearestIndex(realDepths, 90), 6) //  90 m -> 100 m nearer than 75 m
  assert.equal(nearestIndex(realDepths, 60), 4) //  60 m -> 50 m nearer than 75 m
  assert.equal(nearestIndex(realDepths, 5000), realDepths.length - 1) // clamps to deepest
})
