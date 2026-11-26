// The autosave state machine in web/js/ui/saver.js, with a fake store and a fake scheduler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaver, RETRY_FIRST_MS, RETRY_MAX_MS } from '../../web/js/ui/saver.js';
import { ApiError, AuthError } from '../../web/js/data/api.js';
import { ConflictError } from '../../web/js/data/api-store.js';

function rig({ update, conflict = async () => 'keep' } = {}) {
  const log = { states: [], delays: [], timers: [], calls: [], saved: [], reloaded: [], errors: [] };
  let blocks = [{ type: 'p', text: 'v1' }];
  const store = {
    async update(id, patch, opts) { log.calls.push({ id, patch, opts }); return update(id, patch, opts, log.calls.length); },
  };
  const saver = createSaver({
    store,
    getBlocks: () => blocks,
    setSave: (t) => log.states.push(t),
    onConflict: (cur) => conflict(cur),
    onSaved: (p) => log.saved.push(p),
    onReload: (cur) => log.reloaded.push(cur),
    onError: (e) => log.errors.push(e),
    schedule: (fn, ms) => { log.delays.push(ms); log.timers.push(fn); },
  });
  return { saver, log, setBlocks: (b) => { blocks = b; } };
}
const last = (a) => a[a.length - 1];

test('flushSave reports Saved on success', async () => {
  const { saver, log } = rig({ update: async (id, patch) => ({ id, ...patch }) });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(log.calls.length, 1);
  assert.deepEqual(log.calls[0].patch, { content: [{ type: 'p', text: 'v1' }] });
  assert.equal(last(log.states), 'Saved');
  assert.equal(saver.pending(), false);
  assert.equal(log.saved[0].id, 'a');
});

test('flushSave does nothing when nothing changed', async () => {
  const { saver, log } = rig({ update: async () => { throw new Error('should not be called'); } });
  saver.open('a');
  await saver.flush();
  assert.equal(log.calls.length, 0);
});

test('flushSave keeps dirty and schedules retry on network error', async () => {
  const { saver, log } = rig({ update: async () => { throw new ApiError(0, 'network', null); } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(last(log.states), 'Not saved, retrying');
  assert.equal(saver.pending(), true);
  assert.deepEqual(log.delays, [RETRY_FIRST_MS]);
  assert.equal(RETRY_FIRST_MS, 3000);
  await log.timers[0]();
  assert.deepEqual(log.delays, [3000, 6000]);
  assert.equal(log.calls.length, 2);
});

test('flushSave retries on a 5xx and resets the delay after a success', async () => {
  const { saver, log } = rig({ update: async (id, patch, o, n) => { if (n === 1) throw new ApiError(503, 'error', null); return { id }; } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  await log.timers[0]();
  assert.equal(last(log.states), 'Saved');
  assert.equal(saver.pending(), false);
});

test('retry delay caps at 30000', async () => {
  const { saver, log } = rig({ update: async () => { throw new ApiError(502, 'error', null); } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  for (let i = 0; i < 6; i += 1) await last(log.timers)();
  assert.equal(RETRY_MAX_MS, 30000);
  assert.deepEqual(log.delays, [3000, 6000, 12000, 24000, 30000, 30000, 30000]);
});

test('a retry that fires after a newer save started does nothing', async () => {
  let fail = true;
  const { saver, log } = rig({ update: async (id) => { if (fail) throw new ApiError(0, 'network', null); return { id }; } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  fail = false;
  saver.touch();
  await saver.flush();
  const n = log.calls.length;
  await log.timers[0]();
  assert.equal(log.calls.length, n, 'stale retry did not send again');
});

test('flushSave on ConflictError asks and Keep mine forces', async () => {
  const current = { id: 'a', content: [{ type: 'p', text: 'theirs' }] };
  const asked = [];
  const { saver, log } = rig({
    update: async (id, patch, opts) => { if (!opts || !opts.force) throw new ConflictError(current, 7); return { id }; },
    conflict: async (cur) => { asked.push(cur); return 'keep'; },
  });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.deepEqual(asked, [current]);
  assert.equal(log.calls.length, 2);
  assert.deepEqual(log.calls[1].opts, { force: true });
  assert.deepEqual(log.calls[1].patch, { content: [{ type: 'p', text: 'v1' }] });
  assert.equal(last(log.states), 'Saved');
  assert.equal(log.reloaded.length, 0);
});

test('flushSave on ConflictError Reload hands back current content', async () => {
  const current = { id: 'a', content: [{ type: 'p', text: 'theirs' }] };
  const { saver, log } = rig({
    update: async () => { throw new ConflictError(current, 7); },
    conflict: async () => 'reload',
  });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(log.calls.length, 1, 'nothing is sent after Reload');
  assert.deepEqual(log.reloaded, [current]);
  assert.equal(saver.pending(), false);
});

test('an AuthError keeps the change for the next save and schedules nothing', async () => {
  let n = 0;
  const { saver, log } = rig({ update: async (id) => { n += 1; if (n === 1) throw new AuthError('ended'); return { id }; } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(saver.pending(), true);
  assert.deepEqual(log.delays, []);
  assert.equal(last(log.states), 'Not saved');
  await saver.flush();
  assert.equal(last(log.states), 'Saved');
});

test('a rejected save (4xx) is reported, kept, and not retried', async () => {
  const { saver, log } = rig({ update: async () => { throw new ApiError(413, 'too_large', null, 'Too big.'); } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(log.errors.length, 1);
  assert.deepEqual(log.delays, []);
  assert.equal(saver.pending(), true);
  assert.equal(last(log.states), 'Not saved');
});

test('an unsaved edit of the previous paper is still sent, with its own content', async () => {
  let down = true;
  const { saver, log, setBlocks } = rig({ update: async (id) => { if (down) throw new ApiError(0, 'network', null); return { id }; } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  saver.open('b');
  setBlocks([{ type: 'p', text: 'b text' }]);
  saver.touch();
  down = false;
  await saver.flush();
  const sent = log.calls.slice(-2).map((c) => [c.id, c.patch.content[0].text]);
  assert.deepEqual(sent, [['a', 'v1'], ['b', 'b text']]);
  assert.equal(saver.pending(), false);
});

test('saves never overlap: a flush during a flush waits and sends the newer text', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const order = [];
  const { saver, log, setBlocks } = rig({
    update: async (id, patch) => { order.push('start ' + patch.content[0].text); if (order.length === 1) await gate; order.push('end ' + patch.content[0].text); return { id }; },
  });
  saver.open('a');
  saver.touch();
  const first = saver.flush();
  setBlocks([{ type: 'p', text: 'v2' }]);
  saver.touch();
  const second = saver.flush();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start v1', 'end v1', 'start v2', 'end v2']);
  assert.equal(log.calls.length, 2);
});

test('cancel drops the pending change', async () => {
  const { saver, log } = rig({ update: async () => { throw new ApiError(0, 'network', null); } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  saver.cancel();
  assert.equal(saver.pending(), false);
  const n = log.calls.length;
  await log.timers[0]();
  assert.equal(log.calls.length, n);
});

test('a save that finds the paper deleted says Not saved and keeps the text', async () => {
  const { saver, log } = rig({ update: async () => null });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(last(log.states), 'Not saved');
  assert.equal(log.errors.length, 1);
  assert.match(log.errors[0].message, /deleted/);
  assert.deepEqual(log.saved, []);
  assert.equal(saver.pending(), true);
});

test('a 429 is retried later', async () => {
  let n = 0;
  const { saver, log } = rig({ update: async (id) => { n += 1; if (n === 1) throw new ApiError(429, 'rate_limited', null, 'Too many.'); return { id }; } });
  saver.open('a');
  saver.touch();
  await saver.flush();
  assert.equal(last(log.states), 'Not saved, retrying');
  assert.deepEqual(log.delays, [RETRY_FIRST_MS]);
  assert.deepEqual(log.errors, []);
});
