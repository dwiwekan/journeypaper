// The Content-Security-Policy in web/index.html and the production host in web/js/config.js,
// read as text (no DOM, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const configSrc = readFileSync(new URL('../../web/js/config.js', import.meta.url), 'utf8');

/** The CSP meta's directives as { name: [values] }. */
function csp() {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/i);
  assert.ok(m, 'no CSP meta in index.html');
  const out = {};
  for (const part of m[1].split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) out[name] = vals;
  }
  return out;
}
const constant = (name) => {
  const m = configSrc.match(new RegExp(`export const ${name} = ([^;]+);`));
  assert.ok(m, `no ${name} in config.js`);
  return JSON.parse(m[1].replace(/'/g, '"'));
};

test('index.html has a CSP meta with the spec img-src', () => {
  const c = csp();
  assert.deepEqual(c['img-src'], ["'self'", 'data:', 'https:']);
  assert.deepEqual(c['default-src'], ["'self'"]);
  assert.deepEqual(c['object-src'], ["'none'"]);
  assert.deepEqual(c['base-uri'], ["'self'"]);
  assert.deepEqual(c['form-action'], ["'self'"]);
});

test('every inline script is allowed by hash', () => {
  const allowed = csp()['script-src'];
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(inline.length >= 1, 'expected the theme script inline');
  for (const body of inline) {
    const h = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    assert.ok(allowed.includes(h), `inline script not allowed by hash: ${h}`);
  }
  assert.ok(!allowed.includes("'unsafe-inline'"));
});

test('no inline event handler attributes', () => {
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /<script async id="katex-js" src="https:\/\/cdnjs\.cloudflare\.com\//);
});

test('connect-src allows Supabase and the production API', () => {
  const allowed = csp()['connect-src'];
  assert.ok(allowed.includes(new URL(constant('SUPABASE_URL')).origin));
  const prod = constant('PROD_API');
  if (prod) assert.ok(allowed.includes(new URL(prod).origin), 'PROD_API origin missing from connect-src');
});

test('production host is GitHub Pages', () => {
  assert.deepEqual(constant('PROD_HOSTS'), ['dwiwekan.github.io']);
});
