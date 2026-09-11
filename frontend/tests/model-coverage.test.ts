/**
 * Step 42 — model-coverage helpers (`src/api/modelCoverage.ts`).
 *
 * The GLORYS12V1 file wired to `/api/netcdf` is a REGIONAL subset (Step 42
 * expansion: the Arabian Sea box, 8–20.5 °N / 61.5–70 °E, 10 days, 0–541 m).
 * These pure helpers must let the app state that plainly and never imply the
 * model has data outside its real extent.
 *
 *   cd frontend && npm test   # or: node --test tests/model-coverage.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeModelCoverage,
  isPointInModelCoverage,
  summarizeModelCoverage,
} from '../src/api/modelCoverage.ts'
import type { ModelDatasetResponse } from '../src/api/types.ts'

// Shape of the Step 42 backend response for the Arabian Sea subset.
const GLORYS: ModelDatasetResponse = {
  dataset_id: 'glorys12v1_model',
  source: { file_name: 'temperature_cmems_glorys12v1_arabiansea.nc', label: 'GLORYS12V1 / Copernicus Marine' },
  dimensions: { time: 10, depth: 32, latitude: 151, longitude: 103 },
  coordinates: [],
  variables: ['thetao'],
  variable_count: 1,
  global_attributes: {},
  coverage: {
    time: { start: '2025-03-24T00:00:00Z', end: '2025-04-02T00:00:00Z', count: 10 },
    depth: { min: 0.494025, max: 541.0889, count: 32, units: 'm', positive: 'down' },
    latitude: { min: 8.0, max: 20.5, count: 151, units: 'degrees_north' },
    longitude: { min: 61.5, max: 70.0, count: 103, units: 'degrees_east' },
    bounding_box: { latitude: [8.0, 20.5], longitude: [61.5, 70.0] },
    note: 'This is the full extent of the configured NetCDF sample -- it is not basin-wide coverage.',
  },
  decoding: { cf_mask_and_scale: true, note: 'decoded' },
  nan_encoding: 'x',
}

test('summarizeModelCoverage() extracts the real extent and flags it as a subset', () => {
  const s = summarizeModelCoverage(GLORYS)
  assert.ok(s)
  assert.equal(s!.sourceLabel, 'GLORYS12V1 / Copernicus Marine')
  assert.deepEqual(s!.time, { start: '2025-03-24T00:00:00Z', end: '2025-04-02T00:00:00Z', count: 10 })
  assert.equal(s!.latitude!.min, 8.0)
  assert.equal(s!.longitude!.max, 70.0)
  assert.equal(s!.depth!.max, 541.0889)
  assert.equal(s!.depth!.positive, 'down')
  assert.equal(s!.isSubset, true) // regional box, backend note present
})

test('summarizeModelCoverage() does NOT flag a near-global field as a subset', () => {
  const global = {
    ...GLORYS,
    coverage: {
      latitude: { min: -80, max: 90, count: 2041, units: 'degrees_north' },
      longitude: { min: -180, max: 179.9167, count: 4320, units: 'degrees_east' },
      time: { start: '1993-01-01T00:00:00Z', end: '2026-06-30T00:00:00Z', count: 12234 },
    },
  }
  assert.equal(summarizeModelCoverage(global as ModelDatasetResponse)!.isSubset, false)
})

test('summarizeModelCoverage() returns null when no coverage block is present', () => {
  const { coverage: _omit, ...noCoverage } = GLORYS
  assert.equal(summarizeModelCoverage(noCoverage as ModelDatasetResponse), null)
})

test('isPointInModelCoverage() is true inside the box, false outside, false without data', () => {
  const cov = GLORYS.coverage!
  // Argo 6990715_3 (9.40 N, 68.45 E) — inside
  assert.equal(isPointInModelCoverage(cov, 9.4, 68.45), true)
  // Argo 3902669_4 (19.667 N, 64.65 E) — inside
  assert.equal(isPointInModelCoverage(cov, 19.667, 64.65), true)
  assert.equal(isPointInModelCoverage(cov, 8.0, 61.5), true) // edge inclusive
  // the app's demo "Arabian Sea" region (~12.9 N, 74.9 E) is still OUTSIDE (too far east)
  assert.equal(isPointInModelCoverage(cov, 12.94, 74.86), false)
  // glider sea057 (23.6 N, 57.6 E) — outside (north + west)
  assert.equal(isPointInModelCoverage(cov, 23.6, 57.6), false)
  assert.equal(isPointInModelCoverage(null, 9.4, 68.45), false) // fail closed
})

test('describeModelCoverage() is a one-line, honest statement of the extent', () => {
  const text = describeModelCoverage(GLORYS)
  assert.match(text, /GLORYS12V1 \/ Copernicus Marine/)
  assert.match(text, /8\.00°N–20\.50°N/)
  assert.match(text, /61\.50°E–70\.00°E/)
  assert.match(text, /2025-03-24 → 2025-04-02/)
  assert.match(text, /0\.5–541\.1 m/)
  assert.match(text, /regional subset/i)
})

test('describeModelCoverage() falls back to the dataset id when nothing is known', () => {
  const bare = { ...GLORYS, source: {}, coverage: undefined }
  assert.equal(describeModelCoverage(bare as ModelDatasetResponse), 'glorys12v1_model')
})
