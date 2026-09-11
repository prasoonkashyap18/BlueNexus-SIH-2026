/**
 * Step 55 — application error-boundary tests.
 *
 * Runner: Node's built-in `node:test` (same as every other suite). The
 * `ErrorBoundary` class component imports a CSS module and JSX, so — exactly
 * like the Step 47 comparison-state suite — it cannot load here; the render
 * catch / fallback / recovery path is verified in the browser/CDP flow.
 *
 * What is pinned here is the pure logic the component is a thin shell over
 * ({@link ./src/components/feedback/errorBoundary.ts}):
 *   1. normal (no-error) state
 *   2. a caught error flips to the fallback state, keeping the subtree identity
 *   3. "Try again" clears the error and bumps the remount key (no stale state)
 *   4. repeated recovery keeps moving forward — no loop, no reset
 *   5. the fallback copy carries the required, human-readable messaging
 *   6. neither the copy nor the dev log can leak a stack / path / message
 *   7. dev logging is development-only and minimal
 *
 *   cd frontend && node --test tests/error-boundary.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ERROR_BOUNDARY_COPY,
  INITIAL_ERROR_BOUNDARY_STATE,
  logBoundaryError,
  reduceCaughtError,
  reduceRetry,
  safeDevErrorSummary,
} from '../src/components/feedback/errorBoundary.ts'

/* ================================================================== *
 * 1. normal rendering — the boundary starts transparent
 * ================================================================== */

test('1. initial state has no error and a zero reset counter', () => {
  assert.equal(INITIAL_ERROR_BOUNDARY_STATE.hasError, false)
  assert.equal(INITIAL_ERROR_BOUNDARY_STATE.resetCount, 0)
})

/* ================================================================== *
 * 2. a descendant throw is caught → fallback state
 * ================================================================== */

test('2. reduceCaughtError flips hasError but preserves the subtree identity', () => {
  const next = reduceCaughtError({ hasError: false, resetCount: 3 })
  assert.equal(next.hasError, true)
  assert.equal(next.resetCount, 3) // NOT remounted yet — only on recovery
})

test('2b. a second throw before recovery does not advance the reset counter', () => {
  const once = reduceCaughtError(INITIAL_ERROR_BOUNDARY_STATE)
  const twice = reduceCaughtError(once)
  assert.equal(twice.resetCount, 0)
})

/* ================================================================== *
 * 3. recovery — "Try again"
 * ================================================================== */

test('3. reduceRetry clears the error and bumps the remount key', () => {
  const errored = reduceCaughtError({ hasError: false, resetCount: 0 })
  const recovered = reduceRetry(errored)
  assert.equal(recovered.hasError, false)
  assert.equal(recovered.resetCount, 1) // new key → full remount → no stale state
})

/* ================================================================== *
 * 4. repeated recovery is monotonic — no retry loop, no reset
 * ================================================================== */

test('4. crash → retry → crash → retry keeps the key strictly increasing', () => {
  let state = INITIAL_ERROR_BOUNDARY_STATE
  const keys: number[] = []
  for (let i = 0; i < 5; i += 1) {
    state = reduceCaughtError(state)
    assert.equal(state.hasError, true)
    state = reduceRetry(state)
    assert.equal(state.hasError, false)
    keys.push(state.resetCount)
  }
  assert.deepEqual(keys, [1, 2, 3, 4, 5])
})

/* ================================================================== *
 * 5. the fallback shows safe, human-readable messaging
 * ================================================================== */

test('5. copy contains the required user-facing messaging', () => {
  assert.match(ERROR_BOUNDARY_COPY.title, /something went wrong/i)
  assert.match(ERROR_BOUNDARY_COPY.detail, /visualization encountered an unexpected error/i)
  assert.match(ERROR_BOUNDARY_COPY.retry, /try again/i)
  assert.match(ERROR_BOUNDARY_COPY.reload, /reload application/i)
})

/* ================================================================== *
 * 6. technical detail is never exposed to the user
 * ================================================================== */

const TECHNICAL_MARKERS = [
  /\bat\s+.+\(.+:\d+:\d+\)/, // a V8 stack frame
  /\.tsx?:\d+/, //             a source path + line
  /[A-Za-z]:\\|\/(?:home|Users|src)\//, // a filesystem path
  /Traceback|Exception|TypeError:|ReferenceError:/, // a raw exception
  /\{[\s\S]*"[\s\S]*\}/, //    a JSON payload blob
]

test('6. no boundary copy string leaks a stack, path, exception or payload', () => {
  for (const value of Object.values(ERROR_BOUNDARY_COPY)) {
    for (const marker of TECHNICAL_MARKERS) {
      assert.doesNotMatch(value, marker, `leaked via copy: ${value}`)
    }
  }
})

test('6b. safeDevErrorSummary returns only a safe identifier — never the message', () => {
  assert.equal(safeDevErrorSummary(new TypeError('secret token abc123 in the message')), 'TypeError')
  assert.equal(safeDevErrorSummary(new RangeError('index -1')), 'RangeError')
  assert.equal(safeDevErrorSummary('a bare string with a /Users/me/path'), 'Error')
  assert.equal(safeDevErrorSummary({ message: 'obj' }), 'Error')
  assert.equal(safeDevErrorSummary(undefined), 'Error')

  // an exotic error whose name was overwritten with data falls back to "Error"
  const weird = new Error('x')
  weird.name = 'contains space and : punctuation'
  assert.equal(safeDevErrorSummary(weird), 'Error')

  for (const cause of [new TypeError('boom'), new Error('/src/x.tsx:10:2'), 'str', null]) {
    const summary = safeDevErrorSummary(cause)
    for (const marker of TECHNICAL_MARKERS) assert.doesNotMatch(summary, marker)
    assert.ok(!summary.includes('boom') && !summary.includes('x.tsx'))
  }
})

/* ================================================================== *
 * 7. dev logging is development-only and minimal
 * ================================================================== */

test('7. logBoundaryError is a no-op unless the build is a development build', () => {
  const calls: unknown[][] = []
  const sink = { error: (...args: unknown[]) => calls.push(args) }

  logBoundaryError(new Error('prod secret'), false, sink)
  assert.equal(calls.length, 0)

  logBoundaryError(new TypeError('dev cause'), true, sink)
  assert.equal(calls.length, 1)
  // one argument only — the safe summary string, no cause object, no message
  assert.equal(calls[0].length, 1)
  assert.equal(typeof calls[0][0], 'string')
  assert.match(calls[0][0] as string, /error boundary caught a render error \(TypeError\)/i)
  assert.ok(!(calls[0][0] as string).includes('dev cause'))
})
