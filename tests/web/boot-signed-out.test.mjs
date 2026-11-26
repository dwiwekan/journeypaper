// Boots main.js in API mode with no stored session, on the empty hash. A visitor sees the
// homepage: start-up must finish (no forced sign-in) and call nothing, not even the auth service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDom } from './boot-stub.mjs';

test('booting signed out shows home and calls nothing', async () => {
  const { calls, replaced } = stubDom('');
  const booted = import('../../web/js/main.js').then(() => 'finished', (e) => `threw ${e.name}: ${e.message}`);
  const waited = new Promise((r) => setTimeout(() => r('still waiting'), 1000));
  assert.equal(await Promise.race([booted, waited]), 'finished');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, []);
  assert.deepEqual(replaced, ['#home']);
});
