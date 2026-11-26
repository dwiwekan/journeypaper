// Boots main.js in API mode with no stored session, on the empty hash. A visitor lands on the
// library: start-up must finish (no forced sign-in) and make one call, the public list, with no
// Authorization and nothing to the auth service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDom } from './boot-stub.mjs';

test('booting signed out lands on the library and only reads the public list', async () => {
  const { calls, replaced } = stubDom('');
  const booted = import('../../web/js/main.js').then(() => 'finished', (e) => `threw ${e.name}: ${e.message}`);
  const waited = new Promise((r) => setTimeout(() => r('still waiting'), 1000));
  assert.equal(await Promise.race([booted, waited]), 'finished');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, [{ auth: undefined, url: 'http://api.test/api/v1/public/papers' }]);
  assert.deepEqual(replaced, ['#library']);
});
