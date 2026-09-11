/**
 * Step 34 unit tests — profile-variable switching (pure core).
 * Node's built-in `node:test`.
 *
 *   cd frontend && npm test
 *
 * The panel shows ONE measured profile at a time. These tests pin the logic
 * behind that choice: the default is temperature, the two values are the only
 * valid ones, toggling moves between them, and — critically — changing the
 * selected observation resets the choice so a variable picked for one platform
 * never carries onto the next. Rendering "only the selected chart" and the
 * clear-selection teardown are covered by the browser/CDP verification (the
 * chart components import CSS modules and cannot be imported under node:test).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PROFILE_VARIABLE,
  PROFILE_VARIABLES,
  PROFILE_VARIABLE_LABEL,
  initialProfileVariableSelection,
  isProfileVariable,
  otherProfileVariable,
  resolveProfileVariableSelection,
} from '../src/components/observation/profileVariable.ts'

test('1. the default profile variable is temperature', () => {
  assert.equal(DEFAULT_PROFILE_VARIABLE, 'temperature')
  assert.equal(initialProfileVariableSelection('5906221_1').variable, 'temperature')
})

test('2. temperature and salinity are the only valid variables', () => {
  assert.deepEqual([...PROFILE_VARIABLES], ['temperature', 'salinity'])
  assert.equal(isProfileVariable('temperature'), true)
  assert.equal(isProfileVariable('salinity'), true)
  assert.equal(isProfileVariable('pressure'), false)
  assert.equal(isProfileVariable(null), false)
  assert.equal(isProfileVariable(undefined), false)
})

test('3. switching selects salinity, and switching back selects temperature', () => {
  assert.equal(otherProfileVariable('temperature'), 'salinity')
  assert.equal(otherProfileVariable('salinity'), 'temperature')
  assert.equal(otherProfileVariable(otherProfileVariable('temperature')), 'temperature')
})

test('4. the switcher labels are "Temperature" and "Salinity"', () => {
  assert.equal(PROFILE_VARIABLE_LABEL.temperature, 'Temperature')
  assert.equal(PROFILE_VARIABLE_LABEL.salinity, 'Salinity')
})

test('5. same observation → selection kept (same reference, chosen variable preserved)', () => {
  const chosen = { observationKey: '5906221_1', variable: 'salinity' as const }
  const next = resolveProfileVariableSelection(chosen, '5906221_1')
  assert.equal(next, chosen) // referentially equal — caller can bail out
  assert.equal(next.variable, 'salinity')
})

test('6. changing observation resets to temperature — no stale variable carries across', () => {
  const chosen = { observationKey: '5906221_1', variable: 'salinity' as const }
  const next = resolveProfileVariableSelection(chosen, 'sea057_20220707')
  assert.notEqual(next, chosen)
  assert.deepEqual(next, { observationKey: 'sea057_20220707', variable: 'temperature' })
})

test('7. clearing the observation (key → null) also resets to temperature', () => {
  const chosen = { observationKey: 'sea057_20220707', variable: 'salinity' as const }
  const next = resolveProfileVariableSelection(chosen, null)
  assert.deepEqual(next, { observationKey: null, variable: 'temperature' })
})

test('8. re-selecting the same key after a reset starts on temperature again', () => {
  let selection = initialProfileVariableSelection(null)
  selection = resolveProfileVariableSelection(selection, '5906221_1') // select
  selection = { ...selection, variable: 'salinity' } // user picks salinity
  selection = resolveProfileVariableSelection(selection, null) // clear
  selection = resolveProfileVariableSelection(selection, '5906221_1') // re-select
  assert.equal(selection.variable, 'temperature')
})
