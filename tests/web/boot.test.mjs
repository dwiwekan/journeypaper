// Boots main.js against a do-nothing DOM stub. This catches import-time crashes (for example a
// TDZ ReferenceError from the catalog <-> paper-page <-> paper-form import cycle) and wiring
// mistakes in start-up, without a browser. It does not check what is drawn; web/tests/smoke.html does.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function stub(log) {
  const fn = function () {};
  const handler = {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k === 'addEventListener') return (type) => { log.push(type); };
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    has() { return true; },
    deleteProperty() { return true; },
  };
  const proxy = new Proxy(fn, handler);
  return proxy;
}

test('main.js boots: every module imports, every init runs, start-up finishes', async () => {
  const listeners = [];
  const el = stub(listeners);
  const storage = new Map();
  globalThis.window = globalThis;
  globalThis.document = el;
  globalThis.location = { hash: '', replace(h) { this.hash = h; } };
  globalThis.localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.addEventListener = (type) => { listeners.push('window:' + type); };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.scrollTo = () => {};
  const { Store } = await import('../../web/js/data/store.js');
  await import('../../web/js/main.js');
  assert.ok((await Store.list()).length >= 5, 'sample papers load into the in-memory store when IndexedDB is missing');
  for (const t of ['window:hashchange', 'window:pagehide', 'visibilitychange', 'paste', 'keydown', 'input', 'submit']) {
    assert.ok(listeners.includes(t), `listener registered: ${t}`);
  }
});
