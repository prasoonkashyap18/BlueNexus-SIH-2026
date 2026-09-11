/**
 * Step 51 — real data-source / provenance catalogue.
 *
 * Runner: `node:test`. Two halves:
 *   1. the pure `dataSources.ts` model + helpers (no React, no CSS),
 *   2. the `/api/sources` client boundary reached through the existing client.
 *
 * The `DataSourcePanel` component imports a CSS module and cannot load under
 * `node:test`; its rendering against real state is covered by the browser/CDP
 * verification.
 *
 *   cd frontend && npm test   # or: node --test tests/data-sources.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createDataApiClient } from '../src/api/client.ts'
import type { SourceCatalogResponse } from '../src/api/types.ts'
import {
  STATIC_SOURCE_CATALOG,
  comparisonSources,
  fieldSource,
  findSource,
  formatDepthRange,
  formatLatLon,
  formatTimeCoverage,
  observationSource,
  primaryUnit,
} from '../src/components/controls/dataSources.ts'

/* ================================================================== *
 * 1. the static identity catalogue — accurate, no fakes
 * ================================================================== */

test('the catalogue lists exactly the six real datasets', () => {
  assert.equal(STATIC_SOURCE_CATALOG.count, 6)
  assert.deepEqual(
    STATIC_SOURCE_CATALOG.sources.map((s) => s.key).sort(),
    ['argo', 'currents', 'gliders', 'model_comparison', 'salinity', 'temperature'],
  )
})

test('1-2. temperature & salinity are the INCOIS ocean analysis', () => {
  for (const key of ['temperature', 'salinity'] as const) {
    const s = findSource(STATIC_SOURCE_CATALOG, key)!
    assert.equal(s.label, 'INCOIS Ocean Analysis')
    assert.equal(s.kind, 'analysis')
    assert.equal(s.is_incois, true)
    assert.equal(s.dataset_id, 'incois_argo_10day_analysis')
    assert.equal(s.product_identifier, 'incois_argo_10day_McCreary')
  }
  assert.equal(primaryUnit(findSource(STATIC_SOURCE_CATALOG, 'temperature')!.units), '°C')
  assert.equal(findSource(STATIC_SOURCE_CATALOG, 'salinity')!.units, 'PSU')
})

test('3. currents are the INCOIS IO-HOOFS forecast (m/s)', () => {
  const s = findSource(STATIC_SOURCE_CATALOG, 'currents')!
  assert.equal(s.label, 'INCOIS IO-HOOFS')
  assert.equal(s.kind, 'forecast')
  assert.equal(s.is_incois, true)
  assert.equal(s.dataset_id, 'incois_io_hoofs_surface_currents')
  assert.equal(s.variable.name, 'CURRENT')
  assert.equal(primaryUnit(s.units), 'm/s')
})

test('4. Argo source is INCOIS Indian_ARGO_Floats (observation)', () => {
  const s = findSource(STATIC_SOURCE_CATALOG, 'argo')!
  assert.equal(s.label, 'INCOIS Indian_ARGO_Floats')
  assert.equal(s.kind, 'observation')
  assert.equal(s.is_model, false)
  assert.equal(s.is_incois, true)
  assert.equal(s.product_identifier, 'Indian_ARGO_Floats')
  assert.equal((s.units as Record<string, string>).pressure, 'decibar')
})

test('5. Glider source is EGO / OceanGliders GDAC (observation, not INCOIS)', () => {
  const s = findSource(STATIC_SOURCE_CATALOG, 'gliders')!
  assert.equal(s.label, 'EGO / OceanGliders GDAC')
  assert.equal(s.kind, 'observation')
  assert.equal(s.is_model, false)
  assert.equal(s.is_incois, false)
  assert.equal(s.product_identifier, 'OceanGlidersGDACTrajectories')
})

test('6-7. model comparison is GLORYS12V1 / Copernicus Marine — never INCOIS', () => {
  const s = findSource(STATIC_SOURCE_CATALOG, 'model_comparison')!
  assert.equal(s.label, 'GLORYS12V1 / Copernicus Marine')
  assert.equal(s.kind, 'reanalysis')
  assert.equal(s.is_model, true)
  assert.equal(s.is_incois, false)
  assert.ok(!s.label.includes('INCOIS'))
  assert.ok(!(s.organization ?? '').includes('INCOIS'))
  assert.equal(s.dataset_id, 'glorys12v1_model')
  assert.equal(s.product_identifier, 'GLOBAL_MULTIYEAR_PHY_001_030')
  assert.equal(s.copernicus_dataset_id, 'cmems_mod_glo_phy_my_0.083deg_P1D-m')
  assert.match(s.doi ?? '', /10\.48670\/moi-00021/)
  // honest about the subset
  assert.match(s.subset_note ?? '', /subset/i)
})

test('8. variable identity — thetao is potential temperature, NOT in-situ', () => {
  const s = findSource(STATIC_SOURCE_CATALOG, 'model_comparison')!
  assert.equal(s.variable.name, 'thetao')
  assert.equal(s.variable.standard_name, 'sea_water_potential_temperature')
  assert.match(s.variable.display, /potential temperature/i)
  assert.ok(!/in-?situ/i.test(s.variable.display))
})

test('9. units are scientifically correct across the catalogue', () => {
  assert.equal(primaryUnit(findSource(STATIC_SOURCE_CATALOG, 'temperature')!.units), '°C')
  assert.equal(primaryUnit(findSource(STATIC_SOURCE_CATALOG, 'model_comparison')!.units), '°C')
  assert.equal(primaryUnit(findSource(STATIC_SOURCE_CATALOG, 'currents')!.units), 'm/s')
  assert.equal(primaryUnit({ temperature: 'degree_Celsius', pressure: 'decibar' }), '°C')
  assert.equal(primaryUnit(null), '—')
})

test('12 / 16. no fake labels on any source entry, no internal paths or exceptions', () => {
  for (const s of STATIC_SOURCE_CATALOG.sources) {
    const entry = JSON.stringify(s).toLowerCase()
    for (const bad of [
      'live incois',
      'demo',
      'placeholder',
      'traceback',
      'c:\\',
      '/users/',
      'site-packages',
      '.venv',
      'data/raw/',
      'incois model',
    ]) {
      assert.ok(!entry.includes(bad), `source ${s.key} leaked ${bad}`)
    }
    // a real label is always a non-empty string
    assert.ok(typeof s.label === 'string' && s.label.length > 0)
  }
})

/* ================================================================== *
 * 2. state → active source mapping
 * ================================================================== */

test('11. the active source follows the selected 3D variable', () => {
  assert.equal(fieldSource(STATIC_SOURCE_CATALOG, 'temperature')?.key, 'temperature')
  assert.equal(fieldSource(STATIC_SOURCE_CATALOG, 'salinity')?.key, 'salinity')
  assert.equal(fieldSource(STATIC_SOURCE_CATALOG, 'currentSpeed')?.key, 'currents')
  assert.equal(fieldSource(STATIC_SOURCE_CATALOG, 'chlorophyll'), null)
})

test('11. the active source follows the selected observation family', () => {
  assert.equal(observationSource(STATIC_SOURCE_CATALOG, 'argo')?.label, 'INCOIS Indian_ARGO_Floats')
  assert.equal(observationSource(STATIC_SOURCE_CATALOG, 'glider')?.label, 'EGO / OceanGliders GDAC')
})

test('comparison exposes GLORYS as model and Argo as observation', () => {
  const { model, observation } = comparisonSources(STATIC_SOURCE_CATALOG)
  assert.equal(model?.label, 'GLORYS12V1 / Copernicus Marine')
  assert.equal(observation?.label, 'INCOIS Indian_ARGO_Floats')
})

/* ================================================================== *
 * 3. coverage formatters (only ever fed real backend numbers)
 * ================================================================== */

test('15. coverage formatters render real extents, null when absent', () => {
  assert.equal(formatLatLon({ min: 8, max: 20.5 }, 'lat'), '8.0–20.5 °N')
  assert.equal(formatLatLon({ min: 61.5, max: 70 }, 'lon'), '61.5–70.0 °E')
  assert.equal(formatLatLon(undefined, 'lat'), null)
  assert.equal(formatDepthRange({ min: 0.494, max: 541.09, count: 32 }), '0.5–541 m (32 levels)')
  assert.equal(formatDepthRange({ surface_only: true }), 'Surface only (0 m)')
  assert.equal(formatDepthRange(undefined), null)
  assert.equal(
    formatTimeCoverage({ start: '2025-03-24T00:00:00Z', end: '2025-04-02T00:00:00Z', count: 10 }),
    '2025-03-24 → 2025-04-02 (10 steps)',
  )
  assert.equal(formatTimeCoverage(undefined), null)
})

/* ================================================================== *
 * 4. client boundary
 * ================================================================== */

const REAL_SHAPE: SourceCatalogResponse = STATIC_SOURCE_CATALOG

test('10. getSourceCatalog() hits /api/sources and passes the catalogue through', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify(REAL_SHAPE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const client = createDataApiClient({ baseUrl: 'http://t', fetch: fetchImpl })
  const r = await client.getSourceCatalog()

  assert.equal(calls[0], 'http://t/api/sources')
  assert.equal(r.count, 6)
  assert.equal(r.sources.find((s) => s.key === 'model_comparison')?.is_incois, false)
})
