// Boots main.js in API mode with a stored session the server no longer accepts (expired, or signed
// out on another device). After signing in again the papers must load: before the fix only the
// route was redrawn, so the catalog stayed empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const listeners = []; // { sel, type, fn }
function stub(extra = {}) {
  const fn = function () {};
  const handler = {
    get(_t, k) {
      if (k in extra) return extra[k];
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
const VALUES = { '#si-email': 'a@b.c', '#si-pass': 'pw' };
const elements = new Map();
function element(sel) {
  if (!elements.has(sel)) {
    elements.set(sel, stub({
      addEventListener: (type, fn) => { listeners.push({ sel, type, fn }); },
      ...(sel in VALUES ? { value: VALUES[sel] } : {}),
    }));
  }
  return elements.get(sel);
}
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('signing in again after a refused stored session loads the papers', async () => {
  const card = { id: 'p1', title: 'From the server', revision: 3, createdAt: 1, updatedAt: 2, tags: [], bodyText: '', sectionsFilled: [] };
  const user = { id: 'u1', email: 'a@b.c' };
  const session = { access_token: 'old', refresh_token: 'r-old', expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const calls = [];
  globalThis.window = globalThis;
  globalThis.document = stub({ querySelector: (sel) => element(sel), querySelectorAll: () => [] });
  globalThis.location = { hash: '', hostname: 'localhost', replace(h) { this.hash = h; }, reload() { calls.push('reload'); } };
  globalThis.localStorage = memStorage({ 'jp:api': 'http://api.test', 'jp:session': JSON.stringify(session) });
  globalThis.sessionStorage = memStorage();
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.addEventListener = () => {};
  globalThis.requestAnimationFrame = () => 0;
  globalThis.scrollTo = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const auth = init.headers && init.headers.Authorization;
    calls.push(`${init.method || 'GET'} ${url}`);
    if (url.endsWith('grant_type=refresh_token')) return json(400, { error: 'invalid_grant' });
    if (url.endsWith('grant_type=password')) return json(200, { access_token: 'new', refresh_token: 'r-new', expires_in: 3600, user });
    if (url === 'http://api.test/api/v1/papers') return auth === 'Bearer new' ? json(200, [card]) : json(401, {});
    return json(404, {});
  };

  await import('../../web/js/main.js');
  const { state } = await import('../../web/js/ui/state.js');
  assert.deepEqual(state.papers, [], 'the stored session was refused');

  const submit = listeners.find((l) => l.sel === '#si-form' && l.type === 'submit');
  assert.ok(submit, 'the sign-in form is wired');
  await submit.fn({ preventDefault() {} });
  for (let i = 0; i < 20 && !state.papers.length; i += 1) await new Promise((r) => setTimeout(r, 5));

  assert.deepEqual(state.papers.map((p) => p.title), ['From the server']);
  assert.ok(!calls.includes('reload'), 'same account: no page reload needed');
});
