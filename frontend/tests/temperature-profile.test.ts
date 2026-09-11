/**
 * Step 32 unit tests — real measured temperature-profile extraction.
 * Node's built-in `node:test`.
 *
 *   cd frontend && npm test
 *
 * These prove the chart plots REAL data only: a pair survives exactly when its
 * pressure and temperature are both present and finite; QC flags are ignored;
 * a real 0 °C / negative pressure is kept; the output is a pure pressure-sorted
 * subset — no value is invented, interpolated, smoothed or unit-converted.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { measuredProfilePoints } from '../src/components/observation/temperatureProfile.ts'
import type { ArgoLevel, GliderSample } from '../src/api/types.ts'

const level = (pressure: number | null, temperature: number | null, qc = '1'): ArgoLevel => ({
  pressure,
  pressure_qc: qc,
  temperature,
  temperature_qc: qc,
  salinity: null,
  salinity_qc: null,
})

const sample = (pressure: number | null, temperature: number | null): GliderSample => ({
  time: '2022-07-05T00:00:00Z',
  latitude: 15,
  longitude: 87,
  position_qc: '1',
  pressure,
  pressure_qc: '1',
  temperature,
  temperature_qc: '1',
  salinity: null,
  salinity_qc: null,
})

test('1. keeps every finite pair, sorted by ascending pressure, values unchanged', () => {
  const points = measuredProfilePoints([
    level(100, 18.2),
    level(0.5, 29.97),
    level(50.25, 24.6),
  ])
  assert.deepEqual(points, [
    { pressure: 0.5, temperature: 29.97 },
    { pressure: 50.25, temperature: 24.6 },
    { pressure: 100, temperature: 18.2 },
  ])
})

test('2. drops a pair when pressure is null (no in-fill, no interpolation)', () => {
  const points = measuredProfilePoints([level(10, 28), level(null, 27), level(30, 26)])
  assert.deepEqual(points, [
    { pressure: 10, temperature: 28 },
    { pressure: 30, temperature: 26 },
  ])
})

test('3. drops a pair when temperature is null', () => {
  const points = measuredProfilePoints([level(10, 28), level(20, null), level(30, 26)])
  assert.deepEqual(points.map((p) => p.pressure), [10, 30])
})

test('4. NaN / Infinity are treated as missing', () => {
  const points = measuredProfilePoints([
    level(Number.NaN, 25),
    level(40, Number.POSITIVE_INFINITY),
    level(20, 26),
  ])
  assert.deepEqual(points, [{ pressure: 20, temperature: 26 }])
})

test('5. a real 0 °C and a real (slightly negative) surface pressure are kept', () => {
  const points = measuredProfilePoints([sample(-0.0065, 0), sample(5, 12.3)])
  assert.deepEqual(points, [
    { pressure: -0.0065, temperature: 0 },
    { pressure: 5, temperature: 12.3 },
  ])
})

test('6. bad QC flags do not filter a present real value', () => {
  const points = measuredProfilePoints([level(10, 44.25, '4'), level(20, 12.1, '4')])
  assert.equal(points.length, 2)
  assert.equal(points[0]?.temperature, 44.25) // outlier kept — not smoothed away
})

test('7. output length never exceeds the input (nothing is added)', () => {
  const rows: GliderSample[] = []
  for (let i = 0; i < 500; i += 1) rows.push(sample(i * 0.9, 30 - i * 0.03))
  rows.push(sample(null, 5))
  const points = measuredProfilePoints(rows)
  assert.equal(points.length, 500)
  // every output pressure/temperature is one that was in the input
  const inP = new Set(rows.map((r) => r.pressure))
  for (const p of points) assert.ok(inP.has(p.pressure))
})

test('8. empty / all-missing input yields an empty profile (no fake points)', () => {
  assert.deepEqual(measuredProfilePoints([]), [])
  assert.deepEqual(measuredProfilePoints([level(null, null), sample(null, 4)]), [])
})
