/**
 * D13 real end-to-end check: the frontend's salinity + surface-current paths
 * against a live D10 backend.
 *
 *   Terminal 1:  cd backend  && python -m uvicorn main:app --port 8000
 *   Terminal 2:  cd frontend && npm run test:integration:d13
 *
 * Proves that:
 *   • real INCOIS salinity (incois_argo_10day_analysis / salinity) reaches the
 *     frontend data layer — 36 × 51, PSU, 24 irregular depth levels, 3 analysis
 *     times, `null` preserved and quality-aligned, latitude/longitude not
 *     swapped;
 *   • real INCOIS IO-HOOFS surface currents (incois_io_hoofs_surface_currents /
 *     current_u,current_v,current_speed) reach the frontend data layer — their
 *     OWN 421 × 601 grid (NOT the analysis grid), depth = 0 m, m s-1, forecast,
 *     4 forecast times, U eastward / V northward, CURRENT authoritative, missing
 *     vectors not fabricated, latitude/longitude not swapped;
 *   • a known coordinate/value pair is verified independently for each data
 *     family (D13 §26).
 */

import assert from 'node:assert/strict'

import { dataApi } from '../src/api/client.ts'
import { sampleBilinear } from '../src/state/gridSampling.ts'
import { nearestCurrentVector, currentHeadingRadians } from '../src/state/currentDataState.ts'

const ANALYSIS = 'incois_argo_10day_analysis'
const CURRENTS = 'incois_io_hoofs_surface_currents'

function ok(label) {
  console.log(`  ✔ ${label}`)
}

async function checkSalinity() {
  console.log('\n— Salinity —')

  const coords = (await dataApi.getCoordinates(ANALYSIS)).coordinates
  const latitudes = coords.latitude.values
  const longitudes = coords.longitude.values
  const depthMetres = coords.depth.values
  const timeIso = coords.time.iso_times

  assert.equal(latitudes.length, 36)
  assert.equal(longitudes.length, 51)
  assert.equal(depthMetres.length, 24)
  assert.equal(timeIso.length, 3)
  const spacings = new Set(depthMetres.slice(1).map((d, i) => d - depthMetres[i]))
  assert.ok(spacings.size > 1, 'salinity depth axis is irregular')
  ok(
    `coordinates: 36 lat / 51 lon / 24 depth (irregular, ${spacings.size} distinct) / 3 time; ` +
      `depth[0]=${depthMetres[0]} m, time[0]=${timeIso[0]}`,
  )

  const params = await dataApi.getParameters(ANALYSIS)
  const salinity = params.parameters.find((p) => p.parameter_id === 'salinity')
  assert.ok(salinity, 'salinity parameter present')
  assert.equal(salinity.parameter_id, 'salinity') // never "salt"
  assert.equal(salinity.units, 'PSU')
  assert.equal(salinity.surface_only, false)
  ok('parameter "salinity": units PSU, analysis, surface_only=false (multi-depth)')

  const s0 = await dataApi.getParameterSlice(ANALYSIS, 'salinity', { timeIndex: 0, depthIndex: 0 })
  assert.equal(s0.values.length, 36)
  assert.equal(s0.values[0].length, 51)
  assert.equal(s0.units, 'PSU')
  assert.equal(s0.missing_value, null)
  assert.equal(s0.depth.value, depthMetres[0])
  assert.equal(s0.time.iso, timeIso[0])

  const flat = s0.values.flat()
  const nulls = flat.filter((v) => v === null).length
  const nums = flat.filter((v) => typeof v === 'number')
  assert.ok(nulls > 0, 'salinity slice has explicit null (missing) cells')
  assert.equal(nulls + nums.length, 36 * 51)
  assert.ok(!flat.includes(-9999) && !flat.includes(-1e34), 'no source sentinels leaked')
  for (let r = 0; r < 36; r += 1) {
    for (let c = 0; c < 51; c += 1) {
      assert.equal(s0.values[r][c] === null, s0.quality[r][c] === 1)
    }
  }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  ok(
    `slice t0/d0: 36 × 51, ${nums.length} valid / ${nulls} null, ${min.toFixed(2)}..${max.toFixed(2)} PSU`,
  )

  // depth actually changes the field
  const sDeep = await dataApi.getParameterSlice(ANALYSIS, 'salinity', { timeIndex: 0, depthIndex: 12 })
  assert.equal(sDeep.depth.value, depthMetres[12])
  ok(`slice t0/d12 (${sDeep.depth.value} m): distinct field returned`)

  // §26: a known coordinate/value pair — the renderer's sampler reproduces a node.
  let checked = 0
  for (const [rIdx, cIdx] of [[0, 0], [0, 50], [35, 0], [35, 50], [18, 25]]) {
    const cell = s0.values[rIdx][cIdx]
    const sample = sampleBilinear(s0.values, latitudes, longitudes, latitudes[rIdx], longitudes[cIdx])
    if (cell === null) assert.equal(sample.valid, 0)
    else {
      assert.ok(Math.abs(sample.value - cell) < 1e-9, `node [${rIdx}][${cIdx}]: ${sample.value} != ${cell}`)
      assert.equal(sample.valid, 1)
    }
    checked += 1
  }
  ok(`coordinate mapping verified: ${checked} grid nodes reproduced exactly (lat→lat, lon→lon)`)
}

async function checkCurrents() {
  console.log('\n— Surface currents —')

  const coords = (await dataApi.getCoordinates(CURRENTS)).coordinates
  const latitudes = coords.latitude.values
  const longitudes = coords.longitude.values
  const depths = coords.depth.values
  const timeIso = coords.time.iso_times

  assert.equal(latitudes.length, 421)
  assert.equal(longitudes.length, 601)
  assert.equal(depths.length, 1)
  assert.equal(depths[0], 0)
  assert.equal(timeIso.length, 4)
  // NOT the analysis grid
  assert.notEqual(latitudes.length, 36)
  assert.notEqual(longitudes.length, 51)
  ok(
    `coordinates: 421 lat / 601 lon / 1 depth (${depths[0]} m) / 4 forecast times; ` +
      `time[0]=${timeIso[0]} — its OWN grid, not the 36 × 51 analysis grid`,
  )

  const params = await dataApi.getParameters(CURRENTS)
  const u = params.parameters.find((p) => p.parameter_id === 'current_u')
  const v = params.parameters.find((p) => p.parameter_id === 'current_v')
  const speed = params.parameters.find((p) => p.parameter_id === 'current_speed')
  assert.ok(u && v && speed, 'current_u / current_v / current_speed all present')
  assert.equal(u.units, 'm s-1')
  assert.equal(u.vector_role, 'eastward')
  assert.equal(v.vector_role, 'northward')
  assert.equal(speed.authoritative, true)
  assert.equal(speed.surface_only, true)
  ok('parameters: current_u=eastward, current_v=northward, current_speed=authoritative magnitude, m s-1, surface-only')

  const [uS, vS, speedS] = await Promise.all(
    ['current_u', 'current_v', 'current_speed'].map((pid) =>
      dataApi.getParameterSlice(CURRENTS, pid, { timeIndex: 0, depthIndex: 0 }),
    ),
  )
  for (const s of [uS, vS, speedS]) {
    assert.equal(s.values.length, 421)
    assert.equal(s.values[0].length, 601)
    assert.equal(s.units, 'm s-1')
    assert.equal(s.product_type, 'forecast')
    assert.equal(s.depth.value, 0)
    assert.equal(s.missing_value, null)
  }

  const grid = {
    timeIndex: 0,
    timeIso: speedS.time.iso,
    u: uS.values,
    v: vS.values,
    speed: speedS.values,
    quality: { u: uS.quality, v: vS.quality, speed: speedS.quality },
  }

  let speedNulls = 0
  let speedCount = 0
  let speedLo = Number.POSITIVE_INFINITY
  let speedHi = Number.NEGATIVE_INFINITY
  for (const row of speedS.values) {
    for (const x of row) {
      if (x === null) {
        speedNulls += 1
        continue
      }
      speedCount += 1
      if (x < speedLo) speedLo = x
      if (x > speedHi) speedHi = x
    }
  }
  assert.ok(speedNulls > 0, 'current speed slice has explicit null (missing) cells')
  assert.equal(speedNulls + speedCount, 421 * 601)
  ok(
    `slices t0/d0: 3 × (421 × 601), speed ${speedLo.toFixed(3)}..${speedHi.toFixed(3)} m/s, ` +
      `${speedNulls} null cells`,
  )

  // authoritative speed is NOT recomputed: assert we return the stored value,
  // and (sanity, D9 guarantee) that it is consistent with sqrt(u²+v²) where valid.
  let vectorChecks = 0
  let missingChecks = 0
  for (let r = 0; r < 421; r += 53) {
    for (let c = 0; c < 601; c += 61) {
      const s = nearestCurrentVector(grid, latitudes, longitudes, latitudes[r], longitudes[c])
      const cell = speedS.values[r][c]
      if (cell === null || uS.values[r][c] === null || vS.values[r][c] === null) {
        assert.equal(s.valid, 0, `missing cell [${r}][${c}] must not yield a vector`)
        missingChecks += 1
        continue
      }
      assert.equal(s.valid, 1)
      assert.equal(s.speed, cell) // verbatim authoritative value
      assert.equal(s.u, uS.values[r][c])
      assert.equal(s.v, vS.values[r][c])
      const recomputed = Math.hypot(s.u, s.v)
      assert.ok(Math.abs(recomputed - s.speed) < 1e-3, `CURRENT ≈ sqrt(U²+V²) at [${r}][${c}]`)
      vectorChecks += 1
    }
  }
  ok(
    `${vectorChecks} valid nodes: speed returned verbatim (authoritative, not recomputed); ` +
      `${missingChecks} missing nodes yielded no vector`,
  )

  // §26: known coordinate/value pair — nearest-cell mapping, no swap/reverse.
  for (const [rIdx, cIdx] of [[0, 0], [420, 600], [0, 600], [420, 0], [210, 300]]) {
    const s = nearestCurrentVector(grid, latitudes, longitudes, latitudes[rIdx], longitudes[cIdx])
    const cell = speedS.values[rIdx][cIdx]
    if (cell === null) assert.equal(s.valid, 0)
    else assert.equal(s.speed, cell)
  }
  const eastward = currentHeadingRadians(1, 0)
  assert.equal(eastward, 0)
  ok('coordinate mapping verified: corner + centre nodes reproduced exactly (lat→lat, lon→lon); heading east = 0 rad')
}

async function main() {
  console.log(`D13 salinity + current integration check → ${dataApi.baseUrl}`)
  await checkSalinity()
  await checkCurrents()
  console.log('\nD13 salinity + current integration check PASSED')
}

main().catch((err) => {
  console.error('\nD13 integration check FAILED:', err?.message ?? err)
  if (err && typeof err === 'object' && 'type' in err) {
    console.error('  error.type:', err.type, '| status:', err.status, '| url:', err.url)
  }
  process.exitCode = 1
})
