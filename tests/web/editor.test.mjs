// DOM-free parts of the editor modules. Run: node --test tests/web/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../../web/js/util.js';
import { safeHref, safeImg } from '../../web/js/editor/sanitize.js';
import { normBlocks, blockPlain, LABEL, MENU } from '../../web/js/editor/blocks.js';

test('esc escapes the five HTML characters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('safeHref allows only http and https', () => {
  assert.equal(safeHref('https://arxiv.org/abs/1706.03762'), 'https://arxiv.org/abs/1706.03762');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('not a url'), '');
});

test('safeImg allows image data URLs and http(s), nothing else', () => {
  assert.equal(safeImg('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(safeImg('data:text/html;base64,AAAA'), '');
  assert.equal(safeImg('javascript:alert(1)'), '');
});

test('normBlocks keeps code and equation text and cleans image fields', () => {
  const out = normBlocks([
    { id: 'a', type: 'code', text: 'x = 1' },
    { id: 'a', type: 'equation', tex: 'e'.repeat(5000) },
    { type: 'image', src: 'javascript:1', w: 'huge', caption: 'c' },
    { type: 'divider' },
  ]);
  assert.equal(out[0].text, 'x = 1');
  assert.equal(out[1].tex.length, 4000);
  assert.notEqual(out[1].id, 'a', 'duplicate ids are replaced');
  assert.deepEqual([out[2].src, out[2].w, out[2].caption], ['', 'l', 'c']);
  assert.equal(out[3].type, 'divider');
});

test('normBlocks caps documents at 600 blocks', () => {
  assert.equal(normBlocks(Array.from({ length: 700 }, () => ({ type: 'divider' }))).length, 600);
});

test('blockPlain reads code, equation, and image caption', () => {
  assert.equal(blockPlain({ type: 'code', text: 'k' }), 'k');
  assert.equal(blockPlain({ type: 'equation', tex: 'a+b' }), 'a+b');
  assert.equal(blockPlain({ type: 'image', caption: 'fig 1' }), 'fig 1');
  assert.equal(blockPlain({ type: 'divider' }), '');
});

test('every slash-menu type has an English label', () => {
  MENU.forEach((t) => assert.ok(LABEL[t], t));
  assert.equal(LABEL.h2, 'Heading');
});
