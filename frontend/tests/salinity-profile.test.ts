/**
 * Step 33 unit tests — real measured salinity-profile extraction.
 * Node's built-in `node:test`.
 *
 *   cd frontend && npm test
 *
 * These prove the salinity chart plots REAL data only: a pair survives exactly
 * when its pressure and salinity are both present and finite; QC flags are
 * ignored; a real 0 PSU / negative surface pressure is kept; the output is a
 * pure pressure-sorted subset — no value is invented, interpolated, smoothed
 * or unit-converted.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { measuredSalinityPoints } from '../src/components/observation/salinityProfile.ts'
import type { ArgoLevel, GliderSample } from '../src/api/types.ts'

const level = (pressure: number | null, salinity: number | null, qc = '1'): ArgoLevel => ({
  pressure,
  pressure_qc: qc,
  temperature: null,
  temperature_qc: null,
  salinity,
  salinity_qc: qc,
})

const sample = (pressure: number | null, salinity: number | null): GliderSample => ({
  time: '2022-07-05T00:00:00Z',
  latitude: 15,
  longitude: 87,
  position_qc: '1',
  pressure,
  pressure_qc: '1',
  temperature: null,
  temperature_qc: '1',
  salinity,
  salinity_qc: '1',
})

test('1. keeps every finite pair, sorted by ascending pressure, values unchanged', () => {
  const points = measuredSalinityPoints([
    level(100, 35.12),
    level(0.5, 33.98),
    level(50.25, 34.6),
  ])
  assert.deepEqual(points, [
    { pressure: 0.5, salinity: 33.98 },
    { pressure: 50.25, salinity: 34.6 },
    { pressure: 100, salinity: 35.12 },
  ])
})

test('2. drops a pair when salinity is null / missing (no in-fill, no interpolation)', () => {
  const points = measuredSalinityPoints([level(10, 34.1), level(20, null), level(30, 34.9)])
  assert.deepEqual(points, [
    { pressure: 10, salinity: 34.1 },
    { pressure: 30, salinity: 34.9 },
  ])
})

test('3. drops a pair when pressure is null / missing', () => {
  const points = measuredSalinityPoints([level(10, 34.1), level(null, 34.5), level(30, 34.9)])
  assert.deepEqual(points.map((p) => p.pressure), [10, 30])
})

test('4. NaN / Infinity are treated as missing', () => {
  const points = measuredSalinityPoints([
    level(Number.NaN, 35),
    level(40, Number.POSITIVE_INFINITY),
    level(20, 34.7),
  ])
  assert.deepEqual(points, [{ pressure: 20, salinity: 34.7 }])
})

test('5. a real 0 PSU and a real (slightly negative) surface pressure are kept', () => {
  const points = measuredSalinityPoints([sample(-0.0065, 0), sample(5, 32.4)])
  assert.deepEqual(points, [
    { pressure: -0.0065, salinity: 0 },
    { pressure: 5, salinity: 32.4 },
  ])
})

test('6. bad QC flags do not filter a present real value', () => {
  const points = measuredSalinityPoints([level(10, 42.25, '4'), level(20, 34.1, '4')])
  assert.equal(points.length, 2)
  assert.equal(points[0]?.salinity, 42.25) // outlier kept — not smoothed away
})

test('7. output length never exceeds the input (nothing is added)', () => {
  const rows: GliderSample[] = []
  for (let i = 0; i < 500; i += 1) rows.push(sample(i * 0.9, 34 + i * 0.002))
  rows.push(sample(null, 34))
  const points = measuredSalinityPoints(rows)
  assert.equal(points.length, 500)
  const inP = new Set(rows.map((r) => r.pressure))
  for (const p of points) assert.ok(inP.has(p.pressure))
})

test('8. empty / all-missing input yields an empty profile (no fake points)', () => {
  assert.deepEqual(measuredSalinityPoints([]), [])
  assert.deepEqual(measuredSalinityPoints([level(null, null), sample(null, 34)]), [])
})
