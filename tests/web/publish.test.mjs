// The Public switch and Make all public in ui/publish.js.
// The module tree needs a DOM, so the boot stub goes in first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDom } from './boot-stub.mjs';

stubDom('');
const { togglePublic, publishAllCount, publishAllText } = await import('../../web/js/ui/publish.js');

test('togglePublic sends public', async () => {
  const asked = [];
  const store = { async update(id, patch) { asked.push([id, patch]); return { id, ...patch }; } };
  const saved = await togglePublic(store, { id: 'x1', public: false });
  assert.deepEqual(asked, [['x1', { public: true }]]);
  assert.deepEqual(saved, { id: 'x1', public: true });
  await togglePublic(store, { id: 'x1', public: true });
  assert.deepEqual(asked[1], ['x1', { public: false }]);
});

test('publishAllCount skips samples and public papers', () => {
  const papers = [
    { id: 'a', public: false },
    { id: 'b', public: true },
    { id: 'c', public: false, sample: true },
    { id: 'd' },
  ];
  assert.equal(publishAllCount(papers), 2);
  assert.equal(publishAllCount([]), 0);
});

test('publishAllText asks with the count, or says all are public', () => {
  assert.equal(publishAllText(3), 'Make 3 papers public? Anyone with the link can read them.');
  assert.equal(publishAllText(1), 'Make 1 paper public? Anyone with the link can read them.');
  assert.equal(publishAllText(0), 'All your papers are already public');
});
