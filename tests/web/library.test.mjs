// loadPublicPaper in ui/library.js. The module tree needs a DOM, so the boot stub goes in first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDom } from './boot-stub.mjs';

stubDom('');
const { loadPublicPaper } = await import('../../web/js/ui/library.js');
const OWNER = '6f1c2a9e-0b7d-4c1e-9a55-3d2e8f0c1b2a';

test('loadPublicPaper reports missing on 404', async () => {
  const asked = [];
  const store = { async getPublic(o, id) { asked.push([o, id]); return null; } };
  assert.deepEqual(await loadPublicPaper(store, OWNER, 'x1'), { missing: true });
  assert.deepEqual(asked, [[OWNER, 'x1']]);
});

test('loadPublicPaper returns the paper', async () => {
  const paper = { id: 'x1', title: 'T', owner: OWNER, content: [] };
  const store = { async getPublic() { return paper; } };
  assert.deepEqual(await loadPublicPaper(store, OWNER, 'x1'), { paper });
});

test('loadPublicPaper passes other errors on', async () => {
  const store = { async getPublic() { throw new Error('offline'); } };
  await assert.rejects(loadPublicPaper(store, OWNER, 'x1'), /offline/);
});
