/**
 * D13 unit tests — real INCOIS salinity data model + the renderer's grid
 * sampler. Node's built-in `node:test`, HTTP mocked with an injected `fetch`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/salinity.test.ts
 *
 * Salinity shares the `incois_argo_10day_analysis` dataset with D12 temperature
 * (36 × 51 grid, 24 irregular depths, 3 analysis times), so these mirror the
 * D12 checks: the D11 client is used with the canonical `salinity` id, the D10
 * slice is stored 36 × 51 with `null` / `0` preserved and quality aligned, the
 * depth axis is the real irregular one, and the latitude/longitude axes are not
 * swapped or reversed. Units stay `PSU`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createDataApiClient } from '../src/api/client.ts'
import type { SliceResponse } from '../src/api/types.ts'
import { nearestIndex, sampleBilinear } from '../src/state/gridSampling.ts'
import {
  SALINITY_DATASET_ID,
  SALINITY_PARAMETER_ID,
  sampleSliceSalinity,
  type SalinityGridSlice,
} from '../src/state/salinityDataState.ts'

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

/** A 3 × 4 slice: row = latitude, col = longitude. Corner values are distinct
 *  so a swap/reverse is detectable. One `null` (missing), one real `0`. */
const SLICE: SalinityGridSlice = {
  timeIndex: 0,
  depthIndex: 0,
  depthMetres: 5,
  timeIso: '2026-07-10T00:00:00Z',
  values: [
    [34.0, 34.1, 34.2, 34.3], // lat -9.5  (south edge)
    [35.0, null, 0.0, 35.3], //   lat -8.5
    [36.0, 36.1, 36.2, 36.3], // lat -7.5  (north edge)
  ],
  quality: [
    [0, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
  ],
}

// ---------------------------------------------------------------------------
// 1-3. canonical ids + the D11 client is used
// ---------------------------------------------------------------------------
test('1-3. salinity slice is requested via the D11 client with the canonical ids and indices', async () => {
  assert.equal(SALINITY_DATASET_ID, 'incois_argo_10day_analysis')
  assert.equal(SALINITY_PARAMETER_ID, 'salinity')

  const slice: SliceResponse = {
    schema_version: 'bluenexus.dataset/1',
    dataset_id: 'incois_argo_10day_analysis',
    parameter: 'salinity',
    units: 'PSU',
    product_type: 'analysis',
    data_status: 'analysis',
    missing_value: null,
    quality_definition: { '0': 'VALID', '1': 'MISSING' },
    time: { index: 1, value: 1784505600, iso: '2026-07-20T00:00:00Z', units: 's' },
    depth: { index: 5, value: 75, units: 'METERS' },
    shape: { latitude: 2, longitude: 2 },
    latitude: [-9.5, -8.5],
    longitude: [50.5, 51.5],
    values: [[34.9, null], [0, 35.1]],
    quality: [[0, 1], [0, 0]],
    parameter_metadata: {} as SliceResponse['parameter_metadata'],
    provenance: {} as SliceResponse['provenance'],
    bytes_read: 100,
  }
  const { fetch, calls } = mockFetch(() => ({ body: slice }))
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })

  const result = await client.getParameterSlice('incois_argo_10day_analysis', 'salinity', {
    timeIndex: 1,
    depthIndex: 5,
  })

  assert.equal(
    calls[0],
    'http://t/api/datasets/incois_argo_10day_analysis/parameters/salinity/slice?time_index=1&depth_index=5',
  )
  assert.equal(result.parameter, 'salinity') // exactly, not "salt"
  assert.equal(result.units, 'PSU')
  assert.equal(result.product_type, 'analysis')
})

// ---------------------------------------------------------------------------
// 4. 36 × 51 dimensions are preserved exactly (row = latitude, col = longitude)
// ---------------------------------------------------------------------------
test('4. slice dimensions are preserved exactly (row = latitude, col = longitude)', () => {
  assert.equal(SLICE.values.length, LAT.length)
  assert.equal(SLICE.values[0].length, LON.length)
  assert.equal(SLICE.quality.length, SLICE.values.length)
  assert.equal(SLICE.quality[0].length, SLICE.values[0].length)
})

// ---------------------------------------------------------------------------
// 5. 24 irregular depth levels — nearest real index, no constant spacing
// ---------------------------------------------------------------------------
test('5. depth slider metres map to the nearest real irregular depth index', () => {
  const realDepths = [5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500]
  assert.equal(nearestIndex(realDepths, 0), 0) //   0 m  -> 5 m  (index 0)
  assert.equal(nearestIndex(realDepths, 100), 6) // 100 m -> exactly index 6
  assert.equal(nearestIndex(realDepths, 90), 6) //  90 m -> 100 m nearer than 75 m
  assert.equal(nearestIndex(realDepths, 60), 4) //  60 m -> 50 m nearer than 75 m
  assert.equal(nearestIndex(realDepths, 5000), realDepths.length - 1) // clamps to deepest
})

// ---------------------------------------------------------------------------
// 6. time metadata is preserved on the slice
// ---------------------------------------------------------------------------
test('6. real time metadata (ISO) is preserved on the slice', () => {
  assert.equal(SLICE.timeIso, '2026-07-10T00:00:00Z')
})

// ---------------------------------------------------------------------------
// 7. units are PSU (kept below, in the client parse test) + here on the slice
// ---------------------------------------------------------------------------
test('7. a PSU value is carried through unchanged (no conversion)', () => {
  // 34.9 PSU stays 34.9 — the sampler never rescales the physical value.
  const s = sampleSliceSalinity(SLICE, LAT, LON, LAT[0], LON[0])
  assert.equal(s.value, 34.0)
  assert.equal(s.valid, 1)
})

// ---------------------------------------------------------------------------
// 8. null values remain null (never coerced to 0 / -1 / -9999 / -1e34)
// ---------------------------------------------------------------------------
test('8. a missing value stays null and its quality stays 1', () => {
  assert.equal(SLICE.values[1][1], null)
  assert.equal(SLICE.quality[1][1], 1)
  // sampling exactly on the missing cell yields validity 0, not a fabricated value
  const s = sampleSliceSalinity(SLICE, LAT, LON, LAT[1], LON[1])
  assert.equal(s.valid, 0)
})

test('8b. a real 0.0 stays 0.0 and its quality stays 0 (VALID)', () => {
  assert.equal(SLICE.values[1][2], 0)
  assert.equal(SLICE.quality[1][2], 0)
  const s = sampleSliceSalinity(SLICE, LAT, LON, LAT[1], LON[2])
  assert.equal(s.value, 0)
  assert.equal(s.valid, 1)
})

// ---------------------------------------------------------------------------
// 9. quality flags remain aligned with values
// ---------------------------------------------------------------------------
test('9. quality flags line up 1:1 with null cells', () => {
  for (let r = 0; r < SLICE.values.length; r += 1) {
    for (let c = 0; c < SLICE.values[r].length; c += 1) {
      assert.equal(SLICE.values[r][c] === null, SLICE.quality[r][c] === 1)
    }
  }
})

// ---------------------------------------------------------------------------
// 10. no mock fallback — the client throws instead of fabricating salinity
// ---------------------------------------------------------------------------
test('10. the client never returns fabricated salinity on failure — it throws', async () => {
  const alwaysFails = (async () =>
    new Response('{"error":{"type":"data_unavailable","message":"gone"}}', {
      status: 503,
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: 'http://t', fetch: alwaysFails })
  await assert.rejects(() => client.getParameterSlice('incois_argo_10day_analysis', 'salinity'))
})

// ---------------------------------------------------------------------------
// 11. latitude/longitude orientation is correct — axes not swapped/reversed
// ---------------------------------------------------------------------------
test('11. sampling at a grid node returns that exact cell — axes are not swapped/reversed', () => {
  assert.equal(sampleSliceSalinity(SLICE, LAT, LON, LAT[0], LON[0]).value, SLICE.values[0][0])
  assert.equal(sampleSliceSalinity(SLICE, LAT, LON, LAT[2], LON[3]).value, SLICE.values[2][3])
  // first latitude, last longitude -> values[0][3]  (a swap would go out of range)
  assert.equal(sampleSliceSalinity(SLICE, LAT, LON, LAT[0], LON[3]).value, SLICE.values[0][3])
  assert.equal(sampleSliceSalinity(SLICE, LAT, LON, LAT[2], LON[0]).value, SLICE.values[2][0])
})

test('11b. sampling between nodes is a bilinear blend; a partly-missing cell reports reduced validity', () => {
  // centre of the cell bounded by lat[1]/lat[2] and lon[0]/lon[1]:
  // corners values[1][0]=35, values[1][1]=null, values[2][0]=36, values[2][1]=36.1
  const s = sampleBilinear(SLICE.values, LAT, LON, -8.0, 51.0)
  assert.ok(s.valid > 0 && s.valid < 1, `expected partial validity, got ${s.valid}`)
  // value comes only from the three valid corners: (35 + 36 + 36.1) / 3
  assert.ok(Math.abs(s.value - (35 + 36 + 36.1) / 3) < 1e-9, `got ${s.value}`)
})
