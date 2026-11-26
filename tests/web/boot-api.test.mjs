// Boots main.js in API mode (localStorage 'jp:api' set, a stored session, a fake fetch), against
// the same do-nothing DOM stub as boot.test.mjs. Catches wiring mistakes in auth, the import
// banner and the active store without a browser or a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function stub() {
  const fn = function () {};
  const handler = {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
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
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('main.js boots in API mode: uses the stored session and lists papers from the API', async () => {
  const calls = [];
  const card = { id: 'p1', title: 'From the server', revision: 3, createdAt: 1, updatedAt: 2, tags: [], bodyText: 'hello', sectionsFilled: ['intro'] };
  globalThis.window = globalThis;
  globalThis.document = stub();
  globalThis.location = { hash: '', hostname: 'localhost', replace(h) { this.hash = h; } };
  const session = { access_token: 'tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@b.c' } };
  globalThis.localStorage = memStorage({ 'jp:api': 'http://api.test', 'jp:session': JSON.stringify(session) });
  globalThis.sessionStorage = memStorage();
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.addEventListener = () => {};
  globalThis.requestAnimationFrame = () => 0;
  globalThis.scrollTo = () => {};
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init && init.headers && init.headers.Authorization });
    if (url === 'http://api.test/api/v1/papers') return new Response(JSON.stringify([card]), { status: 200 });
    return new Response('{}', { status: 404 });
  };

  const { usingApi } = await import('../../web/js/data/active-store.js');
  await import('../../web/js/main.js');
  const { state } = await import('../../web/js/ui/state.js');

  assert.equal(usingApi, true);
  assert.deepEqual(calls.map((c) => c.url), ['http://api.test/api/v1/papers']);
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.deepEqual(state.papers.map((p) => p.title), ['From the server'], 'no sample papers in API mode');
});
