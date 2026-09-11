/**
 * Step 45 — frontend client boundary for the model−observation temperature
 * comparison. `node:test`, mocked `fetch`. NO UI.
 *
 * Proves the client can ask the backend for the comparison and passes the real
 * per-level `difference_c = model − observed` rows + matching metadata + stats
 * through untouched, and that errors surface as {@link ApiError}.
 *
 *   cd frontend && npm test   # or: node --test tests/temperature-comparison.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import type { ModelObsTemperatureComparisonResponse } from '../src/api/types.ts'

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
    kind: 'model/reanalysis-versus-observation comparison -- NOT validation against a simultaneous co-located instantaneous model observation',
  },
  matching: {
    vertical_method: 'nearest Argo observation to each native GLORYS depth level, matched by derived depth; no interpolation of either dataset; no index pairing',
    model_depth_coordinate: 'native GLORYS12V1 depth levels (metres, positive down), unchanged',
    observation_depth_method: 'TEOS-10 (GSW toolbox): comparison_depth_m = -gsw.z_from_p(pressure_dbar, argo_latitude)…',
    gsw_version: '3.6.23',
    gsw_function: 'gsw.z_from_p',
    adaptive_tolerance_rule: 'max_separation_m[i] = local_spacing_m[i] / 2, where local_spacing_m[i] = (d[i+1] - d[i-1]) / 2 …',
    maximum_vertical_separation_m: [0.5237, 0.5379, 0.5695],
    model_level_count: 32,
    matched_level_count: 26,
    unmatched_level_count: 6,
    model_depth_range_m: { min: 0.494025, max: 541.0889 },
    argo_comparison_depth_range_m: { min: 0.0994, max: 1955.82 },
    argo_levels_in_comparison_depth_band: 44,
    argo_observations_below_model_depth: 58,
    temporal_matching: 'reused from Step 43 -- nearest GLORYS daily mean, no new temporal interpolation',
    spatial_matching: 'reused from Step 43 -- nearest native GLORYS cell, no new spatial interpolation',
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
    qc: { filtering_applied: false, flags_retained: true },
  },
  profile: [
    {
      model_depth_m: 0.494025,
      model_temperature_c: 27.36201,
      argo_pressure_dbar: 0.1,
      argo_depth_m: 0.09939,
      observed_temperature_c: 27.404,
      observed_temperature_qc: '1',
      observed_pressure_qc: '1',
      vertical_separation_m: 0.39463,
      max_vertical_separation_m: 0.5237,
      difference_c: -0.04199,
      matched: true,
      reason: null,
    },
    {
      model_depth_m: 11.405,
      model_temperature_c: 27.30415,
      argo_pressure_dbar: 10.0,
      argo_depth_m: 9.9389,
      observed_temperature_c: 27.421,
      observed_temperature_qc: '1',
      observed_pressure_qc: '1',
      vertical_separation_m: 1.46611,
      max_vertical_separation_m: 0.9735,
      difference_c: null,
      matched: false,
      reason: 'no Argo observation within the adaptive vertical tolerance',
    },
  ],
  statistics: {
    population: 'valid matched comparison points only: model and observed temperature both finite, …',
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
  nan_encoding: 'scientific values verbatim; a null model or observed temperature, or an unmatched GLORYS level, yields difference_c = null',
}

test('getModelObservationTemperatureComparison() hits the temperature-comparison endpoint', async () => {
  const { fetch, calls } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })

  const r = await client.getModelObservationTemperatureComparison('3902669_4')

  assert.equal(calls[0], `${BASE}/api/model-observations/argo/3902669_4/temperature-comparison`)
  assert.equal(r.comparison.platform_id, '3902669_4')
  assert.equal(r.comparison.model_source, 'GLORYS12V1 / Copernicus Marine')
  assert.equal(r.comparison.model_variable, 'thetao')
  assert.equal(r.comparison.observation_variable, 'sea_water_temperature')
  assert.equal(
    r.comparison.difference_definition,
    'difference_c = model_temperature_c - observed_temperature_c (positive => model warmer than observation)',
  )
})

test('per-level rows + matching metadata + stats pass through verbatim', async () => {
  const { fetch } = mockFetch(() => ({ body: RESPONSE }))
  const client = createDataApiClient({ baseUrl: BASE, fetch })
  const r = await client.getModelObservationTemperatureComparison('3902669_4')

  // TEOS-10 method + adaptive tolerance surfaced
  assert.equal(r.matching.gsw_function, 'gsw.z_from_p')
  assert.equal(r.matching.gsw_version, '3.6.23')
  assert.match(r.matching.adaptive_tolerance_rule, /local_spacing/)
  assert.equal(r.matching.model_level_count, 32)

  // a matched row: difference == model - observed exactly; pressure preserved, depth separate
  const m = r.profile[0]
  assert.equal(m.matched, true)
  assert.ok(
    Math.abs(m.difference_c! - (m.model_temperature_c! - m.observed_temperature_c!)) < 1e-9,
    'difference_c == model - observed',
  )
  assert.equal(m.argo_pressure_dbar, 0.1)
  assert.ok(m.argo_depth_m! < m.argo_pressure_dbar!) // depth != pressure (TEOS-10)
  assert.ok(m.vertical_separation_m! <= m.max_vertical_separation_m)
  assert.equal(m.observed_temperature_qc, '1')

  // an unmatched row: difference is null, with a reason
  const u = r.profile[1]
  assert.equal(u.matched, false)
  assert.equal(u.difference_c, null)
  assert.match(u.reason!, /adaptive vertical tolerance/)

  // Step 43 spatial/temporal match reused, both timestamps + separations present
  assert.equal(r.model.temporal_match.matched, '2025-04-01T00:00:00Z')
  assert.equal(r.model.temporal_match.difference_seconds, 32380)
  assert.equal(r.observation.timestamp, '2025-03-31T15:00:20Z')

  // statistics over matched points only
  assert.equal(r.statistics.matched_count, 26)
  assert.equal(typeof r.statistics.mean_difference_c, 'number')
  assert.equal(typeof r.statistics.rmse_c, 'number')

  // transparency: daily-mean / not co-located validation
  assert.ok(r.notes.some((n) => /daily mean/i.test(n) && /not validation/i.test(n)))
})

test('errors surface as ApiError — no synthetic data', async () => {
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
