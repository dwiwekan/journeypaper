// compressImage under the page's CSP: the file must be loaded through a URL scheme that img-src
// allows, or the browser blocks it and every upload fails. Image, canvas and FileReader are stubs
// that follow the browser's rules for the parts compressImage touches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const imgSrc = html.match(/img-src ([^;"]+)/)[1].trim().split(/\s+/);
/** True if the page's img-src lets an <img> load this URL. */
const allowed = (u) => {
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(u);
  return scheme ? imgSrc.includes(scheme[0].toLowerCase()) : imgSrc.includes("'self'");
};

function stubBrowser() {
  const saved = {};
  const set = (k, v) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  set('Image', class {
    constructor() { this.naturalWidth = 3000; this.naturalHeight = 1500; }
    set src(u) { setTimeout(() => (allowed(u) ? this.onload() : this.onerror())); }
  });
  set('FileReader', class {
    readAsDataURL(f) { f.arrayBuffer().then((b) => { this.result = `data:${f.type};base64,` + Buffer.from(b).toString('base64'); this.onload(); }); }
  });
  const drawn = [];
  set('document', { createElement: () => ({ getContext: () => ({ drawImage: (i, x, y, w, h) => drawn.push([w, h]), fillRect() {} }), toDataURL: (t) => `data:${t};base64,AAAA` }) });
  return { drawn, restore: () => { for (const [k, d] of Object.entries(saved)) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; } };
}

test('compressImage reads a PNG through a URL the CSP allows and keeps it PNG', async () => {
  const b = stubBrowser();
  try {
    const { compressImage } = await import('../../web/js/editor/image.js');
    const out = await compressImage(new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }), { max: 1400, keepPng: true });
    assert.equal(out, 'data:image/png;base64,AAAA');
    assert.deepEqual(b.drawn, [[1400, 700]]);
  } finally { b.restore(); }
});

test('compressImage turns a JPEG into a resized JPEG data URL', async () => {
  const b = stubBrowser();
  try {
    const { compressImage } = await import('../../web/js/editor/image.js');
    const out = await compressImage(new File([new Uint8Array([255, 216])], 'a.jpg', { type: 'image/jpeg' }), { max: 900 });
    assert.equal(out, 'data:image/jpeg;base64,AAAA');
    assert.deepEqual(b.drawn, [[900, 450]]);
  } finally { b.restore(); }
});
