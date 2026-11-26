// The Trash in ui/trash.js: move to Trash with Undo, Restore, and Delete forever (typed title).
// The module tree needs a DOM, so the boot stub goes in first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubDom } from './boot-stub.mjs';

stubDom('');
const { ApiError } = await import('../../web/js/data/api.js');
const { titleMatches, moveToTrash, restoreFromTrash, deleteForever } = await import('../../web/js/ui/trash.js');

/** A fake store that records each call, and a fake toast that records each message. */
function fakes(over = {}) {
  const log = [];
  const toasts = [];
  const store = {
    async remove(id) { log.push(['remove', id]); },
    async restore(p) { log.push(['restore', p.id]); return p; },
    async deleteForever(id, title) { log.push(['forever', id, title]); },
    ...over,
  };
  const toast = (msg, action) => { toasts.push({ msg, action }); };
  const refresh = async () => { log.push(['refresh']); };
  return { log, toasts, store, toast, refresh };
}

test('titleMatches is NFC-equal, case-sensitive and untrimmed', () => {
  assert.equal(titleMatches('Café', 'Café'), true);
  assert.equal(titleMatches('Café', 'Café'), true);
  assert.equal(titleMatches('Title ', 'Title'), false);
  assert.equal(titleMatches('title', 'Title'), false);
  assert.equal(titleMatches('', ''), true);
  assert.equal(titleMatches('', 'Title'), false);
});

test('moveToTrash removes, toasts Moved to Trash with Undo, and Undo restores', async () => {
  const f = fakes();
  const p = { id: 'x1', title: 'A very long paper title that goes past the toast limit' };
  await moveToTrash(f.store, p, { toast: f.toast, refresh: f.refresh });
  assert.deepEqual(f.log, [['remove', 'x1'], ['refresh']]);
  assert.equal(f.toasts.length, 1);
  assert.equal(f.toasts[0].msg, '“A very long paper title that goes pas…” moved to Trash');
  assert.equal(f.toasts[0].action.label, 'Undo');
  await f.toasts[0].action.fn();
  assert.deepEqual(f.log.slice(2), [['restore', 'x1'], ['refresh']]);
});

test('deleteForever calls the store with the typed title', async () => {
  const f = fakes();
  const ok = await deleteForever(f.store, { id: 'x1', title: 'Café' }, 'Café', { toast: f.toast, refresh: f.refresh });
  assert.equal(ok, true);
  assert.deepEqual(f.log, [['forever', 'x1', 'Café'], ['refresh']]);
});

test('deleteForever reports a title mismatch', async () => {
  const f = fakes({ async deleteForever() { throw new ApiError(400, 'title_mismatch', null, 'x'); } });
  const ok = await deleteForever(f.store, { id: 'x1', title: 'T' }, 'T', { toast: f.toast, refresh: f.refresh });
  assert.equal(ok, false);
  assert.deepEqual(f.toasts.map((t) => t.msg), ['The title does not match.']);
  assert.deepEqual(f.log, [['refresh']]);
});

test('deleteForever reports a paper no longer in Trash', async () => {
  const f = fakes({ async deleteForever() { throw new ApiError(409, 'not_in_trash', null, 'x'); } });
  assert.equal(await deleteForever(f.store, { id: 'x1', title: 'T' }, 'T', { toast: f.toast, refresh: f.refresh }), false);
  assert.deepEqual(f.toasts.map((t) => t.msg), ['This paper is no longer in Trash.']);
  assert.deepEqual(f.log, [['refresh']]);
});

test('restoreFromTrash restores and refreshes', async () => {
  const f = fakes();
  await restoreFromTrash(f.store, { id: 'x1', title: 'T' }, { toast: f.toast, refresh: f.refresh });
  assert.deepEqual(f.log, [['restore', 'x1'], ['refresh']]);
});
