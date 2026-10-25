import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAll, withCleanup } from '@oma/native/cleanup';
import { primaryFailure } from '@oma/domain/errors';
test('Cleanup group attempts every registered owner once and keeps thrown null/undefined', () => {
  const calls = [], primary = new Error('effect');
  let caught;
  try { withCleanup(() => { throw primary; }, () => cleanupAll([
    () => { calls.push(1); throw null; }, () => { calls.push(2); throw undefined; }, () => { calls.push(3); },
  ])); } catch (error) { caught = error; }
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(primaryFailure(caught), primary);
  assert.deepEqual(caught.errors[1].errors, [null, undefined]);
});
