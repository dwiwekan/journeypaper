// Boots main.js in API mode with no stored session, on #library. The only request is the
// public list, and it carries no token. (A file of its own: each boot needs a fresh process.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDom } from './boot-stub.mjs';

test('booting signed out on #library fetches only the public list', async () => {
  const { calls } = stubDom('#library');
  await import('../../web/js/main.js');
  for (let i = 0; i < 20 && !calls.length; i += 1) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.map((c) => c.url), ['http://api.test/api/v1/public/papers']);
  assert.equal(calls[0].auth, undefined);
});
