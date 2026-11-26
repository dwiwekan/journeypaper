// The hash router's pure parts: parsing, the signed-in/out/local redirects, and the inverse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, resolveRoute, routeHash } from '../../web/js/ui/router.js';

const OWNER = '6f1c2a9e-0b7d-4c1e-9a55-3d2e8f0c1b2a';
const OUT = { signedIn: false, apiOn: true };
const IN = { signedIn: true, apiOn: true };
const LOCAL = { signedIn: false, apiOn: false };

test('parses every route', () => {
  assert.deepEqual(parseRoute(''), { name: 'empty' });
  assert.deepEqual(parseRoute('#home'), { name: 'home' });
  assert.deepEqual(parseRoute('#library'), { name: 'library', q: '' });
  assert.deepEqual(parseRoute('#library?q=a%20b'), { name: 'library', q: 'a b' });
  assert.deepEqual(parseRoute(`#library/${OWNER}/x1`), { name: 'public-paper', owner: OWNER, id: 'x1' });
  assert.deepEqual(parseRoute('#papers'), { name: 'papers' });
  assert.deepEqual(parseRoute('#paper-x1'), { name: 'paper', id: 'x1' });
  assert.deepEqual(parseRoute('#trash'), { name: 'trash' });
  assert.deepEqual(parseRoute('#signin'), { name: 'signin' });
  assert.deepEqual(parseRoute('#junk'), { name: 'empty' });
  assert.deepEqual(parseRoute('#paper-<x>'), { name: 'empty' });
});

test('malformed percent-encoding falls back to the raw text', () => {
  assert.deepEqual(parseRoute('#library?q=%E0%A4%A'), { name: 'library', q: '%E0%A4%A' });
});

test('encoded quotes decode', () => {
  assert.equal(parseRoute('#library?q=%E2%80%9Cattention%E2%80%9D').q, '“attention”');
});

test('signed-out member routes go to the library', () => {
  for (const r of [{ name: 'papers' }, { name: 'paper', id: 'x1' }, { name: 'trash' }]) {
    assert.deepEqual(resolveRoute(r, OUT), { name: 'library', q: '' });
  }
  assert.deepEqual(resolveRoute({ name: 'signin' }, OUT), { name: 'signin' });
  assert.deepEqual(resolveRoute({ name: 'library', q: 'x' }, OUT), { name: 'library', q: 'x' });
});

test('empty hash: home when signed out, papers when signed in', () => {
  assert.deepEqual(resolveRoute({ name: 'empty' }, OUT), { name: 'home' });
  assert.deepEqual(resolveRoute({ name: 'empty' }, IN), { name: 'papers' });
  assert.deepEqual(resolveRoute({ name: 'signin' }, IN), { name: 'papers' });
  assert.deepEqual(resolveRoute({ name: 'trash' }, IN), { name: 'trash' });
  assert.deepEqual(resolveRoute({ name: 'home' }, IN), { name: 'home' });
});

test("local mode keeps today's routes", () => {
  assert.deepEqual(resolveRoute({ name: 'empty' }, LOCAL), { name: 'papers' });
  assert.deepEqual(resolveRoute({ name: 'paper', id: 'x1' }, LOCAL), { name: 'paper', id: 'x1' });
  for (const r of [{ name: 'home' }, { name: 'library', q: 'a' }, { name: 'public-paper', owner: OWNER, id: 'x1' }, { name: 'signin' }, { name: 'trash' }]) {
    assert.deepEqual(resolveRoute(r, LOCAL), { name: 'papers' });
  }
});

test('routeHash round-trips parseRoute', () => {
  for (const h of ['', '#home', '#library', '#library?q=%E2%80%9Cattention%E2%80%9D%20%23nlp', `#library/${OWNER}/x1`, '#papers', '#paper-x1', '#trash', '#signin']) {
    const r = parseRoute(h);
    assert.deepEqual(parseRoute('#' + routeHash(r)), r, h);
  }
  assert.equal(routeHash({ name: 'library', q: 'a b' }), 'library?q=a%20b');
  assert.equal(routeHash({ name: 'empty' }), '');
});
