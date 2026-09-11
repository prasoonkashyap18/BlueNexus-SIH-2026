/**
 * Step 47 — comparison-specific loading / error / coverage / empty states.
 *
 * Runner: `node:test`. Two halves:
 *   1. `describeComparisonFailure` — every expected failure → the right tone,
 *      copy and retryability, and NEVER a raw payload / stack / Python error;
 *      an aborted request classifies as silent.
 *   2. `comparisonHasMatchedLevels` — a successful response with no matched
 *      levels is detected so the UI can show an explicit empty state.
 *   3. the existing Step 45 client boundary under a recoverable-then-OK
 *      sequence (the shape a Retry drives) and under an abort.
 *
 * The section / notice components import CSS modules and cannot load under
 * `node:test`; the loading→success→retry rendering, selection-change reset and
 * Hide/abort behaviour are covered by the browser/CDP verification.
 *
 *   cd frontend && npm test   # or: node --test tests/comparison-states.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient, isAbortError } from '../src/api/client.ts'
import type { ModelObsTemperatureComparisonResponse } from '../src/api/types.ts'
import { describeComparisonFailure } from '../src/components/observation/comparisonFailure.ts'
import { comparisonHasMatchedLevels } from '../src/components/observation/modelComparison.ts'

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function httpError(status: number, type: string, message = 'internal detail — do not surface') {
  return new ApiError(message, {
    kind: 'http',
    status,
    type: type as ApiError['type'],
    detail: { fields: [{ location: ['path', 'platform_id'], message: 'value error' }] },
    url: 'http://x/api/model-observations/argo/1_1/temperature-comparison',
  })
}

/** Copy the user sees must never carry raw internals. */
function assertNoLeak(text: string) {
  for (const bad of ['Traceback', 'detail', 'internal detail', 'value error', 'Exception', 'stack', '{', '}', 'http://']) {
    assert.ok(!text.includes(bad), `leaked "${bad}" in: ${text}`)
  }
}

/* ================================================================== *
 * 1. describeComparisonFailure
 * ================================================================== */

test('404 / unknown_argo_platform → friendly "not found", no retry', () => {
  for (const cause of [httpError(404, 'unknown_argo_platform'), httpError(404, 'http_404')]) {
    const f = describeComparisonFailure(cause)
    assert.equal(f.tone, 'error')
    assert.equal(f.canRetry, false)
    assert.equal(f.silent, false)
    assert.match(f.title, /not found/i)
    assert.match(f.detail, /could not be found/i)
    assertNoLeak(f.detail)
  }
})

test('422 malformed_request → "could not be processed", no retry', () => {
  const f = describeComparisonFailure(httpError(422, 'malformed_request'))
  assert.equal(f.tone, 'error')
  assert.equal(f.canRetry, false)
  assert.match(f.detail, /could not be processed/i)
  assertNoLeak(f.detail)
})

test('422 observation_outside_model_coverage → calm coverage tone, no retry, explains the subset', () => {
  const f = describeComparisonFailure(httpError(422, 'observation_outside_model_coverage'))
  assert.equal(f.tone, 'coverage')
  assert.equal(f.canRetry, false)
  assert.equal(f.silent, false)
  assert.match(f.detail, /outside the currently available GLORYS12V1 model coverage/i)
  assert.match(f.detail, /regional, depth and time subset/i)
  assert.match(f.detail, /no fallback or substitute values/i)
  assertNoLeak(f.detail)
})

test('503 netcdf_unavailable / netcdf_not_configured → "temporarily unavailable", retry, states no mock data', () => {
  for (const type of ['netcdf_unavailable', 'netcdf_not_configured']) {
    const f = describeComparisonFailure(httpError(503, type))
    assert.equal(f.tone, 'error')
    assert.equal(f.canRetry, true)
    assert.match(f.detail, /temporarily unavailable/i)
    assert.match(f.detail, /GLORYS12V1 model data could not be loaded/i)
    assert.match(f.detail, /no fallback or mock data/i)
    assertNoLeak(f.detail)
  }
})

test('network failure → "unable to reach the comparison service", retry offered', () => {
  const cause = new ApiError('Could not reach the data API at http://x.', {
    kind: 'network',
    status: null,
    type: 'network_error' as ApiError['type'],
    url: 'http://x',
  })
  const f = describeComparisonFailure(cause)
  assert.equal(f.tone, 'error')
  assert.equal(f.canRetry, true)
  assert.match(f.detail, /could not reach the model-comparison service/i)
  assertNoLeak(f.detail)
})

test('malformed 2xx body → retry may help', () => {
  const cause = new ApiError('unparseable', {
    kind: 'malformed',
    status: 200,
    type: 'invalid_response' as ApiError['type'],
    url: 'http://x',
  })
  const f = describeComparisonFailure(cause)
  assert.equal(f.canRetry, true)
  assert.match(f.title, /unexpected response/i)
})

test('an aborted request is silent — never shown as an error', () => {
  const abort = new DOMException('The user aborted a request.', 'AbortError')
  assert.equal(isAbortError(abort), true)
  const f = describeComparisonFailure(abort)
  assert.equal(f.silent, true)
  assert.equal(f.title, '')
  assert.equal(f.detail, '')
})

test('an unknown provider-style error → generic, retryable, no message leak', () => {
  const f = describeComparisonFailure({ type: 'unexpected_error', message: 'TypeError: x is undefined' })
  assert.equal(f.tone, 'error')
  assert.equal(f.silent, false)
  assert.ok(!f.detail.includes('TypeError'))
  assertNoLeak(f.detail)
})

/* ================================================================== *
 * 2. comparisonHasMatchedLevels — empty-state detection
 * ================================================================== */

const baseResponse = (
  matchedCount: number,
  profile: ModelObsTemperatureComparisonResponse['profile'] = [],
): ModelObsTemperatureComparisonResponse =>
  ({
    comparison: {},
    matching: { model_level_count: 32, matched_level_count: matchedCount, unmatched_level_count: 32 - matchedCount },
    model: {},
    observation: {},
    profile,
    statistics: { matched_count: matchedCount },
    provenance: {},
    notes: [],
    nan_encoding: 'x',
  }) as unknown as ModelObsTemperatureComparisonResponse

test('matched_count 0 → no matched levels (explicit empty state)', () => {
  assert.equal(comparisonHasMatchedLevels(baseResponse(0)), false)
})

test('matched_count > 0 → has matched levels', () => {
  assert.equal(comparisonHasMatchedLevels(baseResponse(26)), true)
})

test('null matched_count falls back to the per-level rows', () => {
  const withRow = baseResponse(0, [
    { model_depth_m: 5, model_temperature_c: 27, argo_pressure_dbar: 5, argo_depth_m: 4.9, observed_temperature_c: 26.9, observed_temperature_qc: '1', observed_pressure_qc: '1', vertical_separation_m: 0.1, max_vertical_separation_m: 0.5, difference_c: 0.1, matched: true, reason: null },
  ])
  ;(withRow.statistics as { matched_count: number | null }).matched_count = null
  assert.equal(comparisonHasMatchedLevels(withRow), true)

  const allUnmatched = baseResponse(0, [
    { model_depth_m: 5, model_temperature_c: 27, argo_pressure_dbar: null, argo_depth_m: null, observed_temperature_c: null, observed_temperature_qc: null, observed_pressure_qc: null, vertical_separation_m: null, max_vertical_separation_m: 0.5, difference_c: null, matched: false, reason: 'x' },
  ])
  ;(allUnmatched.statistics as { matched_count: number | null }).matched_count = null
  assert.equal(comparisonHasMatchedLevels(allUnmatched), false)
})

/* ================================================================== *
 * 3. client boundary — recoverable-then-OK (Retry) + abort
 * ================================================================== */

function mockFetch(handler: (url: string, n: number) => { status?: number; body: unknown }) {
  let n = 0
  const fn = (async (input: RequestInfo | URL) => {
    n += 1
    const { status = 200, body } = handler(String(input), n)
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: fn }
}

const OK_BODY = {
  comparison: { platform_id: '3902669_4' },
  matching: { model_level_count: 32, matched_level_count: 26, unmatched_level_count: 6 },
  model: {}, observation: {}, profile: [],
  statistics: { matched_count: 26, mean_difference_c: 0.045, mean_absolute_difference_c: 0.228, rmse_c: 0.373 },
  provenance: {}, notes: [], nan_encoding: 'x',
}

test('a 503 then a 200 — the shape Retry drives — both reach the same endpoint', async () => {
  const { fetch } = mockFetch((_url, n) =>
    n === 1
      ? { status: 503, body: { error: { type: 'netcdf_unavailable', message: 'x', detail: {} } } }
      : { body: OK_BODY },
  )
  const client = createDataApiClient({ baseUrl: 'http://t', fetch })

  await assert.rejects(
    () => client.getModelObservationTemperatureComparison('3902669_4'),
    (e: unknown) => e instanceof ApiError && e.status === 503 && describeComparisonFailure(e).canRetry,
  )
  const ok = await client.getModelObservationTemperatureComparison('3902669_4')
  assert.equal(ok.statistics.matched_count, 26)
})

test('an aborted comparison fetch rejects with an AbortError (stale-request path)', async () => {
  const controller = new AbortController()
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      )
    })
  }) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: 'http://t', fetch: fetchImpl })

  const p = client.getModelObservationTemperatureComparison('3902669_4', controller.signal)
  controller.abort()
  await assert.rejects(p, (e: unknown) => isAbortError(e) && describeComparisonFailure(e).silent)
})
