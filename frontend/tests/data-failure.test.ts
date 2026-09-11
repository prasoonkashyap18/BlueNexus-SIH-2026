/**
 * Step 48 — frontend failure-state tests.
 *
 * Runner: Node's built-in `node:test` (same as the other suites). No React
 * rendering — the substance of Step 48 is the pure {@link describeDataFailure}
 * classifier plus the fact that the Step 36 client keeps throwing (never
 * fabricates data) so a Retry can safely repeat the same request.
 *
 *   cd frontend && node --test tests/data-failure.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError, createDataApiClient } from '../src/api/client.ts'
import { describeDataFailure } from '../src/components/feedback/dataFailure.ts'

const BASE = 'http://test.local'

function apiError(init: {
  kind: ApiError['kind']
  status: number | null
  type: string
}): ApiError {
  return new ApiError('x', { ...init, url: `${BASE}/api/thing` })
}

// ---------------------------------------------------------------------------
// 1. network / backend unavailable
// ---------------------------------------------------------------------------
test('1. a network failure classifies as "offline" and is retryable', () => {
  const f = describeDataFailure(apiError({ kind: 'network', status: null, type: 'network_error' }))
  assert.equal(f.kind, 'offline')
  assert.equal(f.canRetry, true)
  assert.match(f.title, /reach the data service/i)
  // no exception text leaked
  assert.doesNotMatch(f.detail, /\bx\b|stack|Error:/)
})

test('1b. a provider error object with type "network_error" classifies the same', () => {
  const f = describeDataFailure({ stage: 'platforms', type: 'network_error', message: 'boom' })
  assert.equal(f.kind, 'offline')
  assert.equal(f.canRetry, true)
})

// ---------------------------------------------------------------------------
// 2. HTTP / API errors
// ---------------------------------------------------------------------------
test('2. a 404 classifies as "notFound" and is NOT retryable', () => {
  const f = describeDataFailure(apiError({ kind: 'http', status: 404, type: 'unknown_dataset' }))
  assert.equal(f.kind, 'notFound')
  assert.equal(f.canRetry, false)
})

test('2b. a 503 classifies as "server" and is retryable', () => {
  const f = describeDataFailure(apiError({ kind: 'http', status: 503, type: 'data_unavailable' }))
  assert.equal(f.kind, 'server')
  assert.equal(f.canRetry, true)
})

test('2c. a NetCDF/model unavailable slug classifies as retryable "server"', () => {
  const f = describeDataFailure(apiError({ kind: 'http', status: 503, type: 'netcdf_unavailable' }))
  assert.equal(f.kind, 'server')
  assert.equal(f.canRetry, true)
})

test('2d. a 422 (rejected request) is "unknown" and NOT retryable', () => {
  const f = describeDataFailure(apiError({ kind: 'http', status: 422, type: 'invalid_index' }))
  assert.equal(f.kind, 'unknown')
  assert.equal(f.canRetry, false)
})

test('2e. a provider error object carrying "http_502" classifies as retryable "server"', () => {
  const f = describeDataFailure({ stage: 'slices', type: 'http_502', message: 'bad gateway' })
  assert.equal(f.kind, 'server')
  assert.equal(f.canRetry, true)
})

// ---------------------------------------------------------------------------
// 3. malformed response
// ---------------------------------------------------------------------------
test('3. a malformed 2xx body classifies as "malformed" and is retryable', () => {
  const f = describeDataFailure(apiError({ kind: 'malformed', status: 200, type: 'invalid_response' }))
  assert.equal(f.kind, 'malformed')
  assert.equal(f.canRetry, true)
})

// ---------------------------------------------------------------------------
// 4. observation detail failure
// ---------------------------------------------------------------------------
test('4. an unknown Argo/glider detail (404) is "notFound", retry hidden', () => {
  const argo = describeDataFailure(
    apiError({ kind: 'http', status: 404, type: 'unknown_argo_platform' }),
  )
  assert.equal(argo.kind, 'notFound')
  assert.equal(argo.canRetry, false)

  // the "not in the loaded snapshot" case from useSelectedObservation
  const missing = describeDataFailure({ type: 'not_found', message: 'not in snapshot' })
  assert.equal(missing.kind, 'notFound')
  assert.equal(missing.canRetry, false)
})

// ---------------------------------------------------------------------------
// 5. unknown / unexpected
// ---------------------------------------------------------------------------
test('5. an unrecognised throw is "unknown" and retryable, with no raw text', () => {
  const f = describeDataFailure(new TypeError('Cannot read properties of undefined'))
  assert.equal(f.kind, 'unknown')
  assert.equal(f.canRetry, true)
  assert.doesNotMatch(f.detail, /undefined|TypeError/)

  const provider = describeDataFailure({ stage: 'platforms', type: 'unexpected_error', message: 'weird' })
  assert.equal(provider.kind, 'unknown')
  assert.equal(provider.canRetry, true)
})

// ---------------------------------------------------------------------------
// 6. retry behaviour — the client repeats ONLY the failed request, and a
//    second attempt can succeed. (The client is stateless, so re-calling the
//    same method IS the retry a Retry button performs.)
// ---------------------------------------------------------------------------
test('6. retry: after a failure, re-issuing the same request succeeds and hits the same URL only', async () => {
  const urls: string[] = []
  let attempt = 0
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    attempt += 1
    if (attempt === 1) {
      return new Response(JSON.stringify({ error: { type: 'data_unavailable', message: 'warming up' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(
      JSON.stringify({ dataset_id: 'incois_indian_argo_floats', count: 0, platform_type: 'argo', units: {}, provenance: {}, platforms: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const client = createDataApiClient({ baseUrl: BASE, fetch: fetchImpl })

  await assert.rejects(
    () => client.getArgoPlatforms(),
    (err: unknown) => {
      assert.ok(ApiError.is(err))
      const f = describeDataFailure(err)
      assert.equal(f.canRetry, true) // the UI would show a Retry button
      return true
    },
  )

  // the "Retry" — same call again
  const list = await client.getArgoPlatforms()
  assert.equal(list.count, 0)

  // exactly one request per attempt, always the same endpoint — no fan-out,
  // no page reload, no extra traffic.
  assert.deepEqual(urls, [`${BASE}/api/observations/argo`, `${BASE}/api/observations/argo`])
})

// ---------------------------------------------------------------------------
// 7. no mock fallback on error
// ---------------------------------------------------------------------------
test('7. the client never yields fabricated data on failure — every call throws', async () => {
  const alwaysDown = (async () =>
    new Response('{"error":{"type":"data_unavailable","message":"gone"}}', {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
  const client = createDataApiClient({ baseUrl: BASE, fetch: alwaysDown })

  for (const call of [
    () => client.getCoordinates('incois_argo_10day_analysis'),
    () => client.getParameterSlice('incois_argo_10day_analysis', 'temperature'),
    () => client.getArgoPlatforms(),
    () => client.getArgoPlatform('2903951_10'),
    () => client.getGliderPlatforms(),
    () => client.getGliderPlatform('sea057_20220707'),
    () => client.getModelDataset(),
  ]) {
    const result = await call().then(
      (value) => ({ ok: true as const, value }),
      (err) => ({ ok: false as const, err }),
    )
    assert.equal(result.ok, false)
    assert.ok(ApiError.is(result.err))
    // and the classifier marks it retryable rather than "not found"
    assert.equal(describeDataFailure(result.err).kind, 'server')
  }
})
