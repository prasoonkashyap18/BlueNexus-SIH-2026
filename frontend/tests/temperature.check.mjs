/**
 * D12 real end-to-end check: the frontend's temperature path against a live
 * D10 backend.
 *
 *   Terminal 1:  cd backend  && python -m uvicorn main:app --port 8000
 *   Terminal 2:  cd frontend && npm run test:integration:d12
 *
 * Proves the D11 client fetches the real INCOIS temperature grid, that it is
 * 36 x 51 with `null` for missing, that the depth axis is the real irregular
 * one, that time_index 0 is 2026-07-10, and that the renderer's grid sampler
 * (`sampleSliceTemperature`, the exact function `temperatureField.ts` bakes the
 * atlas with) reads the real slice with the right latitude/longitude
 * orientation.
 */

import assert from 'node:assert/strict'

import { dataApi } from '../src/api/client.ts'
import { sampleSliceTemperature } from '../src/state/temperatureDataState.ts'

const DATASET = 'incois_argo_10day_analysis'

function ok(label) {
  console.log(`  ✔ ${label}`)
}

async function main() {
  console.log(`D12 temperature integration check → ${dataApi.baseUrl}\n`)

  // --- coordinates ------------------------------------------------
  const coords = (await dataApi.getCoordinates(DATASET)).coordinates
  const latitudes = coords.latitude.values
  const longitudes = coords.longitude.values
  const depthMetres = coords.depth.values
  const timeIso = coords.time.iso_times

  assert.equal(timeIso.length, 3)
  assert.equal(depthMetres.length, 24)
  assert.equal(latitudes.length, 36)
  assert.equal(longitudes.length, 51)
  assert.equal(depthMetres[0], 5) // depth_index 0 -> 5 m
  assert.equal(depthMetres[depthMetres.length - 1], 2000)
  assert.equal(timeIso[0], '2026-07-10T00:00:00Z') // time_index 0
  // irregular spacing — not index x constant
  const spacings = new Set(depthMetres.slice(1).map((d, i) => d - depthMetres[i]))
  assert.ok(spacings.size > 1, 'depth axis is irregular')
  ok(
    `coordinates: 3 time / 24 depth / 36 lat / 51 lon; depth[0]=5 m, depth[1]=${depthMetres[1]} m, ` +
      `time[0]=${timeIso[0]}; irregular depth spacing (${spacings.size} distinct)`,
  )

  // --- parameter metadata ---------------------------------------
  const params = await dataApi.getParameters(DATASET)
  const temperature = params.parameters.find((p) => p.parameter_id === 'temperature')
  assert.ok(temperature)
  assert.equal(temperature.parameter_id, 'temperature') // never "sst"
  assert.equal(temperature.units, 'degC')
  assert.equal(temperature.surface_only, false)
  ok('parameter "temperature": units degC, analysis, surface_only=false (NOT SST, multi-depth)')

  // --- the initial slice ---------------------------------------
  const slice0 = await dataApi.getParameterSlice(DATASET, 'temperature', {
    timeIndex: 0,
    depthIndex: 0,
  })
  assert.equal(slice0.values.length, 36)
  assert.equal(slice0.values[0].length, 51)
  assert.equal(slice0.units, 'degC')
  assert.equal(slice0.missing_value, null)
  assert.equal(slice0.time.iso, '2026-07-10T00:00:00Z')
  assert.equal(slice0.depth.value, 5)

  const flat0 = slice0.values.flat()
  const nulls = flat0.filter((v) => v === null).length
  const nums = flat0.filter((v) => typeof v === 'number')
  assert.ok(nulls > 0, 'slice has explicit null (missing) cells')
  assert.equal(nulls + nums.length, 36 * 51)
  assert.ok(!flat0.includes(-9999) && !flat0.includes(-1e34), 'no source sentinels leaked')
  for (let r = 0; r < 36; r += 1) {
    for (let c = 0; c < 51; c += 1) {
      assert.equal(slice0.values[r][c] === null, slice0.quality[r][c] === 1)
    }
  }
  const min0 = Math.min(...nums)
  const max0 = Math.max(...nums)
  ok(
    `slice t0/d0: 36 x 51, ${nums.length} valid / ${nulls} null, ${min0.toFixed(2)}..${max0.toFixed(2)} degC, ` +
      `depth ${slice0.depth.value} m, iso ${slice0.time.iso}`,
  )

  // --- depth axis actually changes the field --------------------
  const sliceDeep = await dataApi.getParameterSlice(DATASET, 'temperature', {
    timeIndex: 0,
    depthIndex: 18, // 1000 m
  })
  assert.equal(sliceDeep.depth.value, depthMetres[18])
  const deepNums = sliceDeep.values.flat().filter((v) => typeof v === 'number')
  const deepMax = Math.max(...deepNums)
  assert.ok(deepMax < max0, `1000 m max (${deepMax.toFixed(2)}) should be colder than 5 m max (${max0.toFixed(2)})`)
  ok(`slice t0/d18 (${sliceDeep.depth.value} m): distinct field, max ${deepMax.toFixed(2)} degC < surface max`)

  // --- renderer grid sampler: orientation on real coordinates ---
  const rSlice = {
    timeIndex: 0,
    depthIndex: 0,
    depthMetres: 5,
    timeIso: slice0.time.iso,
    values: slice0.values,
    quality: slice0.quality,
  }
  // sampling exactly on a grid node returns that node's own value (or validity 0
  // if that node is missing) — proving lat->lat, lon->lon with no swap/reverse
  let checked = 0
  for (const [rIdx, cIdx] of [
    [0, 0],
    [0, 50],
    [35, 0],
    [35, 50],
    [17, 25],
  ]) {
    const cell = slice0.values[rIdx][cIdx]
    const s = sampleSliceTemperature(rSlice, latitudes, longitudes, latitudes[rIdx], longitudes[cIdx])
    if (cell === null) {
      assert.equal(s.valid, 0, `node [${rIdx}][${cIdx}] is missing -> validity 0`)
    } else {
      assert.ok(Math.abs(s.value - cell) < 1e-9, `node [${rIdx}][${cIdx}]: sampler ${s.value} != grid ${cell}`)
      assert.equal(s.valid, 1)
    }
    checked += 1
  }
  ok(`renderer sampler: ${checked} grid nodes reproduced exactly — latitude/longitude axes not swapped or reversed`)

  console.log('\nD12 temperature integration check PASSED')
}

main().catch((err) => {
  console.error('\nD12 temperature integration check FAILED:', err?.message ?? err)
  if (err && typeof err === 'object' && 'type' in err) {
    console.error('  error.type:', err.type, '| status:', err.status, '| url:', err.url)
  }
  process.exitCode = 1
})
