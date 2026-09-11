/**
 * Step 46 — model ↔ observation comparison UI logic.
 *
 * Runner: `node:test`. Two halves:
 *   1. the pure `modelComparison.ts` extraction/formatting (no React, no CSS),
 *   2. the existing Step 45 client boundary reached with the selected Argo id.
 *
 * The chart / section components import CSS modules and cannot be loaded under
 * `node:test`; their rendering is covered by the browser/CDP verification.
 *
 * Every fixture here is a faithful shape of the REAL Step 45 response — no
 * value is a plausible-looking invention that could be mistaken for live data.
 *
 *   cd frontend && npm test   # or: node --test tests/model-comparison.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type {
  ModelObsComparisonLevel,
  ModelObsTemperatureComparisonResponse,
} from '../src/api/types.ts'
import {
  MODEL_COMPARISON_SUPPORTED_KINDS,
  comparisonLevelCounts,
  differenceProfilePoints,
  formatCelsius,
  formatComparisonTime,
  formatSignedCelsius,
  formatSpatialSeparation,
  formatTemporalSeparation,
  isModelComparisonSupported,
  modelProfilePoints,
  observedProfilePoints,
  toComparisonViewModel,
} from '../src/components/observation/modelComparison.ts'

/* ------------------------------------------------------------------ *
 * Fixtures — faithful Step 45 response for Argo 3902669_4
 * ------------------------------------------------------------------ */

const matchedRow = (
  overrides: Partial<ModelObsComparisonLevel> & Pick<ModelObsComparisonLevel, 'model_depth_m'>,
): ModelObsComparisonLevel => ({
  model_temperature_c: 27,
  argo_pressure_dbar: 1,
  argo_depth_m: 0.99,
  observed_temperature_c: 27,
  observed_temperature_qc: '1',
  observed_pressure_qc: '1',
  vertical_separation_m: 0.2,
  max_vertical_separation_m: 0.5,
  difference_c: 0,
  matched: true,
  reason: null,
  ...overrides,
})

const PROFILE: ModelObsComparisonLevel[] = [
  matchedRow({
    model_depth_m: 0.494025,
    model_temperature_c: 27.36201,
    argo_pressure_dbar: 0.1,
    argo_depth_m: 0.09939,
    observed_temperature_c: 27.404,
    difference_c: -0.04199,
  }),
  matchedRow({
    model_depth_m: 47.37369,
    model_temperature_c: 25.1,
    argo_pressure_dbar: 47.0,
    argo_depth_m: 46.71,
    observed_temperature_c: 24.9,
    difference_c: 0.2,
  }),
  // an unmatched GLORYS level — model column exists, no Argo obs nearby
  {
    model_depth_m: 11.405,
    model_temperature_c: 27.30415,
    argo_pressure_dbar: null,
    argo_depth_m: null,
    observed_temperature_c: null,
    observed_temperature_qc: null,
    observed_pressure_qc: null,
    vertical_separation_m: null,
    max_vertical_separation_m: 0.9735,
    difference_c: null,
    matched: false,
    reason: 'no Argo observation within the adaptive vertical tolerance',
  },
]

const RESPONSE: ModelObsTemperatureComparisonResponse = {
  comparison: {
    platform_id: '3902669_4',
    model_dataset_id: 'glorys12v1_model',
    model_source: 'GLORYS12V1 / Copernicus Marine',
    observation_source: 'INCOIS Argo float profile (in-situ CTD)',
    model_variable: 'thetao',
    observation_variable: 'sea_water_temperature',
    model_units: 'degrees_C',
    observation_units: 'degree_Celsius',
    difference_units: 'degree_Celsius',
    difference_definition:
      'difference_c = model_temperature_c - observed_temperature_c (positive => model warmer than observation)',
    kind: 'model/reanalysis-versus-observation comparison',
  },
  matching: {
    vertical_method: 'nearest Argo observation to each native GLORYS depth level',
    model_depth_coordinate: 'native GLORYS12V1 depth levels (metres, positive down), unchanged',
    observation_depth_method: 'TEOS-10 (GSW toolbox)',
    gsw_version: '3.6.23',
    gsw_function: 'gsw.z_from_p',
    adaptive_tolerance_rule: 'max_separation_m[i] = local_spacing_m[i] / 2',
    maximum_vertical_separation_m: [0.5237, 0.9735, 0.5695],
    model_level_count: 32,
    matched_level_count: 26,
    unmatched_level_count: 6,
    model_depth_range_m: { min: 0.494025, max: 541.0889 },
    argo_comparison_depth_range_m: { min: 0.0994, max: 1955.82 },
    argo_levels_in_comparison_depth_band: 44,
    argo_observations_below_model_depth: 58,
    temporal_matching: 'reused from Step 43 -- nearest GLORYS daily mean',
    spatial_matching: 'reused from Step 43 -- nearest native GLORYS cell',
  },
  model: {
    dataset_id: 'glorys12v1_model',
    source: 'GLORYS12V1 / Copernicus Marine',
    latitude: 19.6666660308838,
    longitude: 64.6666641235352,
    timestamp: '2025-04-01T00:00:00Z',
    spatial_match: {
      method: 'nearest native GLORYS 1/12 grid cell (no interpolation)',
      requested: { latitude: 19.666, longitude: 64.65 },
      matched: { latitude: 19.6666660308838, longitude: 64.6666641235352 },
      latitude_difference_deg: -6.35e-7,
      longitude_difference_deg: 0.01666,
      distance_km: 1.7449,
    },
    temporal_match: {
      method: 'nearest available GLORYS daily-mean timestep (no interpolation)',
      requested: '2025-03-31T15:00:20Z',
      matched: '2025-04-01T00:00:00Z',
      difference_seconds: 32380,
      note: 'GLORYS thetao is a DAILY MEAN, not an instantaneous value',
    },
  },
  observation: {
    platform_id: '3902669_4',
    platform_number: '3902669',
    cycle_number: 4,
    latitude: 19.666666666666668,
    longitude: 64.65,
    timestamp: '2025-03-31T15:00:20Z',
  },
  profile: PROFILE,
  statistics: {
    population: 'valid matched comparison points only',
    matched_count: 26,
    mean_difference_c: 0.04515,
    mean_absolute_difference_c: 0.228,
    minimum_difference_c: -0.43495,
    maximum_difference_c: 1.49379,
    rmse_c: 0.37335,
  },
  provenance: { model: { doi: 'https://doi.org/10.48670/moi-00021' } },
  notes: [
    'GLORYS thetao is a DAILY MEAN. This is a model/reanalysis-versus-observation comparison, NOT validation against a simultaneous, co-located, instantaneous model observation.',
    'difference_c = model_temperature_c - observed_temperature_c (positive => model warmer).',
  ],
  nan_encoding: 'scientific values verbatim; unmatched => difference_c = null',
}

/* ================================================================== *
 * 1. Pure extraction — real Step 45 data only
 * ================================================================== */

test('glider selection cannot trigger a model comparison (Argo only)', () => {
  assert.deepEqual([...MODEL_COMPARISON_SUPPORTED_KINDS], ['argo'])
  assert.equal(isModelComparisonSupported('argo'), true)
  assert.equal(isModelComparisonSupported('glider'), false)
  assert.equal(isModelComparisonSupported('mooring'), false)
})

test('model series = every finite model temperature at its native GLORYS depth', () => {
  const points = modelProfilePoints(PROFILE)
  // all three rows carry a finite model temperature — including the unmatched one
  assert.equal(points.length, 3)
  assert.deepEqual(
    points.map((p) => p.depth),
    [0.494025, 11.405, 47.37369],
  )
  assert.equal(points[0]?.value, 27.36201)
})

test('observed series = matched rows only, at TEOS-10 derived depth', () => {
  const points = observedProfilePoints(PROFILE)
  assert.equal(points.length, 2) // the unmatched row contributes nothing
  assert.deepEqual(
    points.map((p) => p.value),
    [27.404, 24.9],
  )
  // derived depth, NOT pressure
  assert.equal(points[0]?.depth, 0.09939)
})

test('difference series uses verbatim difference_c, excludes unmatched / null', () => {
  const points = differenceProfilePoints(PROFILE)
  assert.equal(points.length, 2)
  assert.deepEqual(
    points.map((p) => p.value),
    [-0.04199, 0.2],
  )
  // no null was coerced to 0
  assert.ok(points.every((p) => p.value !== 0 || Number.isFinite(p.value)))
})

test('a null difference is never turned into 0', () => {
  const rows: ModelObsComparisonLevel[] = [
    matchedRow({ model_depth_m: 5, difference_c: null, matched: false, observed_temperature_c: null }),
  ]
  assert.deepEqual(differenceProfilePoints(rows), [])
})

test('level counts are read straight off the response, not recomputed', () => {
  assert.deepEqual(comparisonLevelCounts(RESPONSE), { matched: 26, total: 32, unmatched: 6 })
})

test('view model surfaces the real provenance + statistics unchanged', () => {
  const view = toComparisonViewModel(RESPONSE)
  assert.equal(view.platformId, '3902669_4')
  assert.equal(view.modelSource, 'GLORYS12V1 / Copernicus Marine')
  assert.match(view.observationSource, /INCOIS/)
  assert.match(view.observationSource, /Argo/)
  assert.equal(view.modelTimestamp, '2025-04-01T00:00:00Z')
  assert.equal(view.observationTimestamp, '2025-03-31T15:00:20Z')
  assert.equal(view.spatialSeparationKm, 1.7449)
  assert.equal(view.temporalSeparationSeconds, 32380)
  assert.equal(view.statistics.mean_difference_c, 0.04515)
  assert.equal(view.statistics.rmse_c, 0.37335)
  assert.equal(view.statistics.matched_count, 26)
  assert.equal(view.levels.matched, 26)
  assert.equal(view.levels.total, 32)
  assert.ok(view.notes.some((n) => /daily mean/i.test(n)))
})

test('formatters: signed °C, unsigned °C, separations, timestamps', () => {
  assert.equal(formatSignedCelsius(0.04515), '+0.045 °C')
  assert.equal(formatSignedCelsius(-0.43495), '-0.435 °C')
  assert.equal(formatSignedCelsius(null), '—')
  assert.equal(formatCelsius(0.228), '0.228 °C')
  assert.equal(formatCelsius(null), '—')
  assert.equal(formatSpatialSeparation(1.7449), '1.7 km')
  assert.equal(formatSpatialSeparation(0.42), '420 m')
  assert.equal(formatSpatialSeparation(null), '—')
  assert.equal(formatTemporalSeparation(32380), '9.0 h')
  assert.equal(formatTemporalSeparation(45), '45 s')
  assert.equal(formatTemporalSeparation(null), '—')
  assert.equal(formatComparisonTime('2025-04-01T00:00:00Z'), '2025-04-01 00:00 UTC')
  assert.equal(formatComparisonTime(null), '—')
})

/* ================================================================== *
 * 2. Client boundary — the selected Argo id drives the Step 45 request
 * ================================================================== */

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const { status = 200, body } = handler(url)
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const BASE = 'http://test.local'

test('the selected Argo id reaches the temperature-comparison endpoint verbatim', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const r = await client.getModelObservationTemperatureComparison('3902669_4')

  assert.equal(
    calls[0],
    `${BASE}/api/model-observations/argo/3902669_4/temperature-comparison`,
  )
  // the real per-level rows + stats pass straight into the view model
  const view = toComparisonViewModel(r)
  assert.equal(view.model.length, 3)
  assert.equal(view.observed.length, 2)
  assert.equal(view.difference.length, 2)
  assert.equal(view.statistics.rmse_c, 0.37335)
})

test('a comparison failure surfaces as ApiError — no synthetic comparison', async () => {
  for (const [status, type] of [
    [404, 'unknown_argo_platform'],
    [422, 'observation_outside_model_coverage'],
    [503, 'netcdf_unavailable'],
  ] as const) {
    const { fetch } = mockFetch(() => ({
      status,
      body: { error: { type, message: 'x', detail: {} } },
    }))
    const client = createDataApiClient({ baseUrl: BASE, fetch })
    await assert.rejects(
      () => client.getModelObservationTemperatureComparison('9999999_1'),
      (err: unknown) => err instanceof ApiError && err.type === type && err.status === status,
    )
  }
})
