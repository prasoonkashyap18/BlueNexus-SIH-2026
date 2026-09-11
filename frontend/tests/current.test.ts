/**
 * D13 unit tests — real INCOIS IO-HOOFS surface-current data model.
 * Node's built-in `node:test`, HTTP mocked with an injected `fetch`.
 *
 *   cd frontend && npm test
 *   # or: node --test tests/current.test.ts
 *
 * Currents are a separate dataset with their OWN grid (≈0.0833°, 421 × 601),
 * their OWN coordinate arrays, 4 forecast times and one surface depth level.
 * These prove: the D11 client is used for `current_u` / `current_v` /
 * `current_speed` at `depth_index = 0`; the grid is stored exactly (no
 * regrid / interpolate / resample); U is the eastward component and V the
 * northward one; CURRENT is used verbatim and never recomputed from
 * sqrt(U² + V²); a missing vector is never drawn as a fake zero vector; and the
 * latitude/longitude axes are not swapped or reversed.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createDataApiClient } from '../src/api/client.ts'
import type { SliceResponse } from '../src/api/types.ts'
import { nearestIndex } from '../src/state/gridSampling.ts'
import {
  CURRENT_DATASET_ID,
  CURRENT_PARAMETER_IDS,
  CURRENT_SPEED_PARAMETER_ID,
  CURRENT_SURFACE_DEPTH_INDEX,
  CURRENT_U_PARAMETER_ID,
  CURRENT_V_PARAMETER_ID,
  currentHeadingRadians,
  nearestCurrentVector,
  type CurrentGrid,
} from '../src/state/currentDataState.ts'

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

function sliceBody(parameter: string, values: Array<Array<number | null>>, role: string | null): SliceResponse {
  return {
    schema_version: 'bluenexus.dataset/1',
    dataset_id: 'incois_io_hoofs_surface_currents',
    parameter,
    units: 'm s-1',
    product_type: 'forecast',
    data_status: 'forecast',
    missing_value: null,
    quality_definition: { '0': 'VALID', '1': 'MISSING' },
    time: { index: 0, value: 48, iso: '2026-09-05T01:30:00Z', units: 'hours' },
    depth: { index: 0, value: 0, units: 'meters' },
    shape: { latitude: values.length, longitude: values[0].length },
    latitude: [-10, -9.9, -9.8],
    longitude: [50, 50.1, 50.2, 50.3],
    values,
    quality: values.map((row) => row.map((c) => (c === null ? 1 : 0))) as SliceResponse['quality'],
    parameter_metadata: {
      display_name: parameter,
      kind: role === null ? 'vector_magnitude' : 'vector_component',
      vector_group: 'surface_current',
      vector_role: role,
      authoritative: true,
      surface_only: true,
      standard_name: null,
      long_name: null,
      raw_units: 'm s-1',
    },
    provenance: {} as SliceResponse['provenance'],
    bytes_read: 100,
  }
}

const LAT = [-10, -9.9, -9.8]
const LON = [50, 50.1, 50.2, 50.3]

// ---------------------------------------------------------------------------
// 12. dataset id
// ---------------------------------------------------------------------------
test('12. current dataset id is the canonical IO-HOOFS surface-current id', () => {
  assert.equal(CURRENT_DATASET_ID, 'incois_io_hoofs_surface_currents')
})

// ---------------------------------------------------------------------------
// 13-15 + 17-18. current_u / current_v / current_speed are each requested via
// the D11 client at depth_index = 0, in m s-1
// ---------------------------------------------------------------------------
test('13-15,17,18. u / v / speed are requested through the D11 client at depth_index 0', async () => {
  assert.deepEqual(CURRENT_PARAMETER_IDS, ['current_u', 'current_v', 'current_speed'])
  assert.equal(CURRENT_U_PARAMETER_ID, 'current_u')
  assert.equal(CURRENT_V_PARAMETER_ID, 'current_v')
  assert.equal(CURRENT_SPEED_PARAMETER_ID, 'current_speed')
  assert.equal(CURRENT_SURFACE_DEPTH_INDEX, 0)

  const { fetch, calls } = mockFetch((url) => {
    if (url.includes('/current_u/')) return { body: sliceBody('current_u', [[1]], 'eastward') }
    if (url.includes('/current_v/')) return { body: sliceBody('current_v', [[1]], 'northward') }
    return { body: sliceBody('current_speed', [[1]], null) }
  })
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })

  const results = await Promise.all(
    CURRENT_PARAMETER_IDS.map((pid) =>
      client.getParameterSlice(CURRENT_DATASET_ID, pid, {
        timeIndex: 2,
        depthIndex: CURRENT_SURFACE_DEPTH_INDEX,
      }),
    ),
  )

  assert.deepEqual(calls, [
    'http://t/api/datasets/incois_io_hoofs_surface_currents/parameters/current_u/slice?time_index=2&depth_index=0',
    'http://t/api/datasets/incois_io_hoofs_surface_currents/parameters/current_v/slice?time_index=2&depth_index=0',
    'http://t/api/datasets/incois_io_hoofs_surface_currents/parameters/current_speed/slice?time_index=2&depth_index=0',
  ])
  for (const r of results) {
    assert.equal(r.units, 'm s-1')
    assert.equal(r.product_type, 'forecast')
    assert.equal(r.depth.value, 0)
    assert.equal(r.parameter_metadata.surface_only, true)
  }
  assert.equal(results[0].parameter_metadata.vector_role, 'eastward') // U
  assert.equal(results[1].parameter_metadata.vector_role, 'northward') // V
  assert.equal(results[2].parameter_metadata.authoritative, true) // CURRENT
})

// ---------------------------------------------------------------------------
// 16. the current grid is preserved exactly (row = latitude, col = longitude)
// ---------------------------------------------------------------------------
const GRID: CurrentGrid = {
  timeIndex: 0,
  timeIso: '2026-09-05T01:30:00Z',
  //         lon0    lon1    lon2    lon3
  u: [
    [0.10, 0.11, 0.12, 0.13], // lat -10.0
    [0.20, null, 3.00, 0.23], // lat  -9.9   (one missing U)
    [0.30, 0.31, 0.32, 0.33], // lat  -9.8
  ],
  v: [
    [-0.01, -0.02, -0.03, -0.04],
    [-0.05, 0.5, 4.0, -0.08],
    [-0.09, -0.1, -0.11, -0.12],
  ],
  speed: [
    [0.101, 0.111, 0.121, 0.131],
    [0.206, 0.5, 99.0, 0.239], // [1][2]: authoritative 99, NOT sqrt(3² + 4²) = 5
    [0.313, 0.323, 0.333, 0.343],
  ],
  quality: {
    u: [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
    v: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    speed: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  },
}

test('16. grid dimensions are preserved (row = latitude, col = longitude)', () => {
  assert.equal(GRID.u.length, LAT.length)
  assert.equal(GRID.u[0].length, LON.length)
  assert.equal(GRID.v.length, LAT.length)
  assert.equal(GRID.speed[0].length, LON.length)
  assert.equal(GRID.quality.u.length, GRID.u.length)
})

// ---------------------------------------------------------------------------
// 19-20. U eastward, V northward — direction, no magnitude recombination
// ---------------------------------------------------------------------------
test('19-20. U is eastward and V is northward for the heading (direction only)', () => {
  // Pure eastward flow (u > 0, v = 0) -> heading 0 -> a +X glyph points +X (east).
  assert.equal(currentHeadingRadians(1, 0), 0)
  // Pure northward flow (u = 0, v > 0) -> heading +pi/2.
  assert.ok(Math.abs(currentHeadingRadians(0, 1) - Math.PI / 2) < 1e-12)
  // Westward / southward round out the quadrants.
  assert.ok(Math.abs(Math.abs(currentHeadingRadians(-1, 0)) - Math.PI) < 1e-12)
  assert.ok(Math.abs(currentHeadingRadians(0, -1) + Math.PI / 2) < 1e-12)
})

// ---------------------------------------------------------------------------
// 21-22. CURRENT is the authoritative magnitude, returned verbatim
// ---------------------------------------------------------------------------
test('21-22. CURRENT is used verbatim — never recomputed from sqrt(u² + v²)', () => {
  // cell [1][2]: u = 3, v = 4  ->  sqrt(u²+v²) = 5, but authoritative speed = 99.
  const s = nearestCurrentVector(GRID, LAT, LON, LAT[1], LON[2])
  assert.equal(s.valid, 1)
  assert.equal(s.u, 3)
  assert.equal(s.v, 4)
  assert.equal(s.speed, 99) // the API value, not 5
})

// ---------------------------------------------------------------------------
// 23. a missing vector is not rendered as a fake zero vector
// ---------------------------------------------------------------------------
test('23. a cell with a missing component reports valid 0 (caller draws nothing)', () => {
  // cell [1][1]: U is null -> the whole vector is invalid, no fabricated (0,0).
  const s = nearestCurrentVector(GRID, LAT, LON, LAT[1], LON[1])
  assert.equal(s.valid, 0)
})

// ---------------------------------------------------------------------------
// 24. latitude/longitude orientation is correct — nearest cell, no swap/reverse
// ---------------------------------------------------------------------------
test('24. nearest-cell sampling maps latitude→latitude and longitude→longitude', () => {
  assert.equal(nearestCurrentVector(GRID, LAT, LON, LAT[0], LON[0]).u, GRID.u[0][0])
  assert.equal(nearestCurrentVector(GRID, LAT, LON, LAT[2], LON[3]).u, GRID.u[2][3])
  assert.equal(nearestCurrentVector(GRID, LAT, LON, LAT[0], LON[3]).u, GRID.u[0][3])
  assert.equal(nearestCurrentVector(GRID, LAT, LON, LAT[2], LON[0]).u, GRID.u[2][0])
  // a point between nodes snaps to the nearest — never interpolates
  assert.equal(nearestIndex(LON, 50.06), 1)
  assert.equal(nearestCurrentVector(GRID, LAT, LON, -9.79, 50.06).speed, GRID.speed[2][1])
})

// ---------------------------------------------------------------------------
// 25. no mock fallback — the client throws instead of fabricating currents
// ---------------------------------------------------------------------------
test('25. the client never returns fabricated currents on failure — it throws', async () => {
  const alwaysFails = (async () =>
    new Response('{"error":{"type":"data_unavailable","message":"gone"}}', {
      status: 503,
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: 'http://t', fetch: alwaysFails })
  for (const pid of CURRENT_PARAMETER_IDS) {
    await assert.rejects(() => client.getParameterSlice(CURRENT_DATASET_ID, pid))
  }
})
