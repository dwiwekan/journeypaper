// api.js and api-store.js against a fake fetch. Run: node --test tests/web/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPABASE_KEY, SESSION_KEY } from '../../web/js/config.js';
import { createApi, AuthError } from '../../web/js/data/api.js';
import { createApiStore, ConflictError } from '../../web/js/data/api-store.js';
import { derived } from '../../web/js/data/paper.js';

const NOW = 1_000_000_000; // ms; 1_000_000 s
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fakeFetch(...replies) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const next = replies.shift();
    if (!next) throw new Error('unexpected call ' + url);
    return typeof next === 'function' ? next(url, init) : next;
  };
  f.calls = calls;
  return f;
}
function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}
const session = (tok, expiresAt = 2_000_000) => JSON.stringify({ access_token: tok, refresh_token: 'R-' + tok, expires_at: expiresAt, user: { id: 'u1', email: 'a@b.c' } });
const goTrue = (tok) => json(200, { access_token: tok, refresh_token: 'R-' + tok, expires_in: 3600, expires_at: 2_000_000, user: { id: 'u1', email: 'a@b.c' } });
function setup(...replies) {
  const fetchImpl = fakeFetch(...replies);
  const storage = mem({ [SESSION_KEY]: session('A1') });
  const api = createApi({ fetchImpl, storage, now: () => NOW, base: 'http://api' });
  return { api, store: createApiStore(api), calls: fetchImpl.calls, storage };
}
const full = (o = {}) => ({ id: 'p1', title: 'T', content: [{ id: 'c1', type: 'code', text: 'x' }], revision: 4, createdAt: 1, updatedAt: 2, ...o });
const card = (o = {}) => ({ id: 'p1', title: 'T', bodyText: '', sectionsFilled: [], revision: 4, createdAt: 1, updatedAt: 2, ...o });

test('sign in stores session under jp:session', async () => {
  const fetchImpl = fakeFetch(goTrue('A1'));
  const storage = mem();
  const api = createApi({ fetchImpl, storage, now: () => NOW, base: 'http://api' });
  await api.signIn('a@b.c', 'pw');
  assert.match(fetchImpl.calls[0].url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(fetchImpl.calls[0].headers.apikey, SUPABASE_KEY);
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].body), { email: 'a@b.c', password: 'pw' });
  assert.deepEqual(JSON.parse(storage.getItem(SESSION_KEY)), { access_token: 'A1', refresh_token: 'R-A1', expires_at: 2_000_000, user: { id: 'u1', email: 'a@b.c' } });
  assert.equal(api.session().user.email, 'a@b.c');
});

test('wrong password throws AuthError and stores nothing', async () => {
  const storage = mem();
  const api = createApi({ fetchImpl: fakeFetch(json(400, { error_description: 'Invalid login credentials' })), storage, now: () => NOW });
  await assert.rejects(api.signIn('a@b.c', 'bad'), AuthError);
  assert.equal(storage.getItem(SESSION_KEY), null);
});

test('request refreshes once on 401 then retries', async () => {
  const { api, calls } = setup(json(401, {}), goTrue('A2'), json(200, []));
  const r = await api.request('GET', '/papers');
  assert.equal(r.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'http://api/api/v1/papers');
  assert.match(calls[1].url, /grant_type=refresh_token$/);
  assert.deepEqual(JSON.parse(calls[1].body), { refresh_token: 'R-A1' });
  assert.equal(calls[2].headers.Authorization, 'Bearer A2');
});

test('request refreshes first when the token is about to expire', async () => {
  const fetchImpl = fakeFetch(goTrue('A2'), json(200, []));
  const storage = mem({ [SESSION_KEY]: session('A1', NOW / 1000 + 30) });
  const api = createApi({ fetchImpl, storage, now: () => NOW, base: 'http://api' });
  await api.request('GET', '/papers');
  assert.match(fetchImpl.calls[0].url, /grant_type=refresh_token$/);
  assert.equal(fetchImpl.calls[1].headers.Authorization, 'Bearer A2');
});

test('refresh failure signs out and throws AuthError', async () => {
  const { api, storage } = setup(json(401, {}), json(400, { error: 'invalid_grant' }));
  let signedOut = 0;
  api.onSignedOut(() => { signedOut += 1; });
  await assert.rejects(api.request('GET', '/papers'), AuthError);
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(signedOut, 1);
});

test('network failure is ApiError status 0 and keeps the session', async () => {
  const { api, storage } = setup(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(api.request('GET', '/papers'), (e) => e.name === 'ApiError' && e.status === 0);
  assert.notEqual(storage.getItem(SESSION_KEY), null);
});

test('refresh reuses a newer session written by another tab', async () => {
  const fetchImpl = fakeFetch(json(200, []));
  const storage = mem({ [SESSION_KEY]: session('A1', NOW / 1000 + 30) });
  const api = createApi({ fetchImpl, storage, now: () => NOW, base: 'http://api' });
  api.session();
  storage.setItem(SESSION_KEY, session('B2', NOW / 1000 + 3600)); // the other tab refreshed first
  await api.request('GET', '/papers');
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer B2');
});

test('list returns cards whose derived() uses bodyText and sectionsFilled', async () => {
  const { store } = setup(json(200, [card({ bodyText: 'hello', sectionsFilled: ['intro', 'bogus'] })]));
  const [c] = await store.list();
  assert.equal(c.content, undefined);
  assert.deepEqual(c.sectionsFilled, ['intro']);
  assert.equal(derived(c).body, 'hello');
  assert.deepEqual([...derived(c).filled], ['intro']);
});

test('get returns full paper, null on 404', async () => {
  const { store } = setup(json(200, full()), json(404, { error: { code: 'not_found', message: 'x' } }));
  const p = await store.get('p1');
  assert.deepEqual(p.content, [{ id: 'c1', type: 'code', text: 'x' }]);
  assert.equal(p.revision, undefined);
  assert.equal(await store.get('gone'), null);
});

test('update sends If-Match with the loaded revision', async () => {
  const { store, calls } = setup(json(200, full()), json(200, card({ title: 'N', revision: 5 })));
  await store.get('p1');
  const c = await store.update('p1', { title: 'N' });
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, 'http://api/api/v1/papers/p1');
  assert.equal(calls[1].headers['If-Match'], '4');
  assert.deepEqual(JSON.parse(calls[1].body), { title: 'N' });
  assert.equal(c.title, 'N');
});

const conflict = (o = {}) => json(409, { error: { code: 'conflict', message: 'changed' }, current: full({ title: 'Theirs', revision: 5, ...o }) });

test('update with content on 409 throws ConflictError with current', async () => {
  const { store } = setup(json(200, full()), conflict());
  await store.get('p1');
  await assert.rejects(store.update('p1', { content: [] }), (e) => {
    assert.ok(e instanceof ConflictError);
    assert.equal(e.revision, 5);
    assert.equal(e.current.title, 'Theirs');
    return true;
  });
});

test('update without content retries a 409 once', async () => {
  const { store, calls } = setup(json(200, full()), conflict(), json(200, card({ revision: 6 })));
  await store.get('p1');
  await store.update('p1', { rating: 3 });
  assert.deepEqual(calls.slice(1).map((c) => c.headers['If-Match']), ['4', '5']);
});

test('update force uses the conflict revision', async () => {
  const { store, calls } = setup(json(200, full()), conflict(), json(200, card({ revision: 6 })), json(200, card({ revision: 7 })));
  await store.get('p1');
  await assert.rejects(store.update('p1', { content: [] }), ConflictError);
  await store.update('p1', { content: [] }, { force: true });
  assert.equal(calls[2].headers['If-Match'], '5');
  await store.update('p1', { content: [] });
  assert.equal(calls[3].headers['If-Match'], '6');
});

test('merge batches by size', async () => {
  const counts = { created: 1, updated: 0, skipped: 0, errors: [] };
  const { store, calls } = setup(json(200, counts), json(200, counts), json(200, counts));
  const big = (id) => ({ id, title: id, content: [{ type: 'code', text: 'x'.repeat(4 * 1024 * 1024) }] });
  const out = await store.merge([big('a'), big('b'), big('c')]);
  assert.equal(calls.length, 3);
  calls.forEach((c) => { assert.ok(c.url.endsWith('/api/v1/import')); assert.equal(c.method, 'POST'); });
  assert.deepEqual(out, { created: 3, updated: 0, skipped: 0, errors: [] });
});

test('merge sends small items in one batch', async () => {
  const { store, calls } = setup(json(200, { created: 2, updated: 0, skipped: 0, errors: [] }));
  await store.merge([{ id: 'a', title: 'a' }, { id: 'b', title: 'b' }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body).map((p) => p.id), ['a', 'b']);
});

test('clear sends X-Confirm: wipe', async () => {
  const { store, calls } = setup(json(200, { deleted: 2 }));
  await store.clear();
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, 'http://api/api/v1/papers');
  assert.equal(calls[0].headers['X-Confirm'], 'wipe');
});

test('a field 409 retry does not move the notes base: the next notes save still conflicts', async () => {
  const { store, calls } = setup(json(200, full()), conflict(), json(200, card({ revision: 6 })), conflict({ revision: 6 }));
  await store.get('p1'); // the editor holds the notes of revision 4
  await store.update('p1', { rating: 3 }); // another tab saved notes (5); the rating is retried and lands as 6
  await assert.rejects(store.update('p1', { content: [] }), ConflictError);
  assert.equal(calls[3].headers['If-Match'], '4');
});

test('list() while a paper is open does not move the notes base', async () => {
  const { store, calls } = setup(json(200, full()), json(200, [card({ revision: 7 })]), json(200, card({ revision: 8 })));
  await store.get('p1');
  await store.list();
  await store.update('p1', { content: [] });
  assert.equal(calls[2].headers['If-Match'], '4');
});

test('a field save with no conflict moves the notes base with it', async () => {
  const { store, calls } = setup(json(200, full()), json(200, card({ revision: 5 })), json(200, card({ revision: 6 })));
  await store.get('p1');
  await store.update('p1', { title: 'N' });
  await store.update('p1', { content: [] });
  assert.equal(calls[2].headers['If-Match'], '5');
});

test('merge names a paper the server refuses as too large and goes on', async () => {
  const counts = { created: 1, updated: 0, skipped: 0, errors: [] };
  const { store, calls } = setup(json(200, counts), json(413, { error: { code: 'too_large', message: 'Too big.' } }), json(200, counts));
  const huge = { id: 'huge', title: 'Huge', content: [{ type: 'code', text: 'x'.repeat(9 * 1024 * 1024) }] };
  const out = await store.merge([{ id: 'a', title: 'a' }, huge, { id: 'c', title: 'c' }]);
  assert.equal(calls.length, 3);
  assert.equal(out.created, 2);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].id, 'huge');
  assert.match(out.errors[0].reason, /too large/);
});

test('sign out ends only this device session', async () => {
  const { api, calls } = setup(json(204));
  await api.signOut();
  assert.match(calls[0].url, /\/auth\/v1\/logout\?scope=local$/);
});

/* ---------- milestone 2: public library and Trash ---------- */
test('publicRequest sends no Authorization and never refreshes', async () => {
  const fetchImpl = fakeFetch(json(200, []));
  const storage = mem({ [SESSION_KEY]: session('OLD', 10) }); // long expired
  const api = createApi({ fetchImpl, storage, now: () => NOW, base: 'http://api' });
  let ended = 0;
  api.onSignedOut(() => { ended += 1; });
  const r = await api.publicRequest('GET', '/public/papers');
  assert.equal(r.status, 200);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'http://api/api/v1/public/papers');
  assert.equal(fetchImpl.calls[0].headers.Authorization, undefined);
  assert.ok(!fetchImpl.calls.some((c) => c.url.includes('/auth/v1/')));
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).access_token, 'OLD');
  assert.equal(ended, 0);
});

test('publicRequest turns a network failure into ApiError 0', async () => {
  const api = createApi({ fetchImpl: async () => { throw new TypeError('offline'); }, storage: mem(), now: () => NOW, base: 'http://api' });
  await assert.rejects(api.publicRequest('GET', '/public/papers'), (e) => e.status === 0);
});

test('userId reads the stored session without a network call', () => {
  const fetchImpl = fakeFetch();
  const api = createApi({ fetchImpl, storage: mem({ [SESSION_KEY]: session('A1') }), now: () => NOW });
  assert.equal(api.userId(), 'u1');
  assert.equal(createApi({ fetchImpl, storage: mem(), now: () => NOW }).userId(), null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('listPublic keeps owner and does not touch member revisions', async () => {
  const OWNER = '00000000-0000-0000-0000-000000000001';
  const { store, calls } = setup(
    json(200, [card({ revision: 4 })]),
    json(200, [card({ owner: OWNER, revision: undefined })]),
    json(200, card({ revision: 5 })),
  );
  await store.list();
  const [pub] = await store.listPublic();
  assert.equal(pub.owner, OWNER);
  assert.equal(calls[1].headers.Authorization, undefined);
  await store.update('p1', { title: 'x' });
  assert.equal(calls[2].headers['If-Match'], '4');
});

test('getPublic returns null on 404 and encodes owner and id', async () => {
  const { store, calls } = setup(
    json(404, { error: { code: 'not_found', message: 'Paper not found.' } }),
    json(200, full({ owner: 'abc', content: [{ id: 'c1', type: 'code', text: 'hi' }] })),
  );
  assert.equal(await store.getPublic('a/b', 'p 1'), null);
  assert.match(calls[0].url, /\/api\/v1\/public\/papers\/a%2Fb\/p%201$/);
  const p = await store.getPublic('abc', 'p1');
  assert.equal(p.content[0].text, 'hi');
  assert.equal(p.owner, 'abc');
});

test('deleteForever sends DELETE with the title as JSON', async () => {
  const { store, calls } = setup(new Response(null, { status: 204 }));
  await store.deleteForever('p1', 'Café ');
  assert.equal(calls[0].method, 'DELETE');
  assert.match(calls[0].url, /\/api\/v1\/papers\/p1\/forever$/);
  assert.deepEqual(JSON.parse(calls[0].body), { title: 'Café ' });
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
});

test('deleteForever passes a title mismatch on as ApiError', async () => {
  const { store } = setup(json(400, { error: { code: 'title_mismatch', message: 'no' } }));
  await assert.rejects(store.deleteForever('p1', 'x'), (e) => e.status === 400 && e.code === 'title_mismatch');
});

test('publishAll returns the published count', async () => {
  const { store, calls } = setup(json(200, { published: 3 }));
  assert.equal(await store.publishAll(), 3);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/api\/v1\/papers\/publish-all$/);
});

test('listTrash keeps deletedAt', async () => {
  const { store } = setup(json(200, [card({ deletedAt: 12345 })]));
  const [t] = await store.listTrash();
  assert.equal(t.deletedAt, 12345);
});

test('update sends public', async () => {
  const { store, calls } = setup(json(200, full()), json(200, card({ revision: 5, public: true })));
  await store.get('p1');
  const c = await store.update('p1', { public: true });
  assert.deepEqual(JSON.parse(calls[1].body), { public: true });
  assert.equal(c.public, true);
});
