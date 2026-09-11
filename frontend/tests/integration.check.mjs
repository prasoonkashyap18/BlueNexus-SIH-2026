/**
 * D11 real end-to-end check: run this against a live D10 backend.
 *
 *   Terminal 1:  cd backend  && python -m uvicorn main:app --port 8000
 *   Terminal 2:  cd frontend && npm run test:integration
 *
 * It performs the exact request set D11 mandates and asserts the temperature
 * slice is 36 x 51 with `null` for missing cells. Uses the *built* frontend
 * client (`src/api/client.ts`) so it exercises the same code path as the app.
 *
 * Override the target with `VITE_API_BASE_URL` (default http://localhost:8000).
 */

import assert from 'node:assert/strict'

import { dataApi } from '../src/api/client.ts'

const ANALYSIS = 'incois_argo_10day_analysis'
const CURRENTS = 'incois_io_hoofs_surface_currents'

function ok(label) {
  console.log(`  ✔ ${label}`)
}

async function main() {
  console.log(`D11 integration check → ${dataApi.baseUrl}\n`)

  // 1. health
  const health = await dataApi.getHealth()
  assert.equal(health.status, 'ok')
  ok(`GET /api/health → status "ok" (service ${health.service})`)

  // 2. datasets
  const datasets = await dataApi.getDatasets()
  const ids = datasets.datasets.map((d) => d.dataset_id).sort()
  assert.deepEqual(ids, [ANALYSIS, CURRENTS])
  ok(`GET /api/datasets → ${datasets.count}: ${ids.join(', ')}`)

  // 3. temperature parameter metadata
  const params = await dataApi.getParameters(ANALYSIS)
  const temperature = params.parameters.find((p) => p.parameter_id === 'temperature')
  assert.ok(temperature, 'temperature parameter present')
  assert.equal(temperature.units, 'degC')
  assert.equal(temperature.surface_only, false)
  const detail = await dataApi.getDataset(ANALYSIS)
  assert.equal(detail.product_type, 'analysis')
  ok(`GET /api/datasets/${ANALYSIS}/parameters → temperature: units degC, analysis, surface_only=false (not SST)`)

  // 4. coordinates
  const coords = await dataApi.getCoordinates(ANALYSIS)
  assert.equal(coords.coordinates.time?.count, 3)
  assert.equal(coords.coordinates.depth?.count, 24)
  assert.equal(coords.coordinates.latitude?.count, 36)
  assert.equal(coords.coordinates.longitude?.count, 51)
  ok(
    `GET /api/datasets/${ANALYSIS}/coordinates → time ${coords.coordinates.time?.count}, ` +
      `depth ${coords.coordinates.depth?.count}, lat ${coords.coordinates.latitude?.count}, ` +
      `lon ${coords.coordinates.longitude?.count}`,
  )

  // 5. real temperature slice
  const slice = await dataApi.getParameterSlice(ANALYSIS, 'temperature', { timeIndex: 0, depthIndex: 0 })
  assert.equal(slice.values.length, 36)
  assert.equal(slice.values[0].length, 51)
  assert.equal(slice.shape.latitude, 36)
  assert.equal(slice.shape.longitude, 51)
  assert.equal(slice.units, 'degC')
  assert.equal(slice.missing_value, null)

  const flat = slice.values.flat()
  const missing = flat.filter((v) => v === null).length
  const valid = flat.filter((v) => typeof v === 'number').length
  assert.ok(missing > 0, 'slice has explicit null (missing) cells')
  assert.equal(missing + valid, 36 * 51)
  assert.ok(!flat.includes(-9999) && !flat.includes(-1e34), 'no source sentinels leaked')

  // null <-> quality alignment
  for (let r = 0; r < 36; r += 1) {
    for (let c = 0; c < 51; c += 1) {
      assert.equal(slice.values[r][c] === null, slice.quality[r][c] === 1)
    }
  }
  ok(
    `GET .../parameters/temperature/slice?time_index=0&depth_index=0 → 36 x 51, ` +
      `${valid} valid / ${missing} null, iso ${slice.time.iso}, depth ${slice.depth.value} m, ` +
      `bytes_read ${slice.bytes_read}`,
  )

  console.log('\nD11 integration check PASSED')
}

main().catch((err) => {
  console.error('\nD11 integration check FAILED:', err?.message ?? err)
  if (err && typeof err === 'object' && 'type' in err) {
    console.error('  error.type:', err.type, '| status:', err.status, '| url:', err.url)
  }
  process.exitCode = 1
})
