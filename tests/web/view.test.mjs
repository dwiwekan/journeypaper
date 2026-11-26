// The read-only notes view (editor/view.js), with a tiny test DOM so cleanInline really runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMiniDom } from './mini-dom.mjs';
import { blocksHtml } from '../../web/js/editor/view.js';

installMiniDom();

test('blocksHtml strips scripts, handlers and javascript: urls', () => {
  const html = blocksHtml([
    { id: 'a', type: 'p', text: '<script>x</script><a href="javascript:1">a</a><b onclick=1>b</b><img src=x onerror=alert(1)>' },
    { id: 'b', type: 'image', src: 'javascript:1', caption: 'c' },
    { id: 'c', type: 'image', src: 'https://e.test/i.png', caption: '"><script>y</script>' },
    { id: 'd', type: 'h2', text: 'Method <i>x</i>' },
  ]);
  assert.ok(!html.includes('<script'), html);
  assert.ok(!/onclick|onerror/.test(html), html);
  assert.ok(!html.includes('javascript:'), html);
  assert.ok(html.includes('<b>b</b>'), 'allowed inline formatting stays');
  assert.equal((html.match(/<img /g) || []).length, 1, 'the javascript: image is dropped');
  assert.ok(html.includes('&lt;script&gt;y'), 'the caption is escaped text');
  assert.match(html, /<h2 class="blk-body" id="h-d">Method <i>x<\/i><\/h2>/);
});

test('blocksHtml escapes code and keeps data: images', () => {
  const html = blocksHtml([
    { id: 'a', type: 'code', text: 'if (a < b && c) { return "<x>"; }' },
    { id: 'b', type: 'image', src: 'data:image/png;base64,AAAA', caption: '', w: 's' },
    { id: 'c', type: 'equation', tex: '\\frac{a}{b} "<x>"' },
    { id: 'd', type: 'divider' },
  ]);
  assert.ok(html.includes('if (a &lt; b &amp;&amp; c) { return &quot;&lt;x&gt;&quot;; }'), html);
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(html.includes('data-w="s"'));
  assert.ok(html.includes('<div class="eq" data-tex="\\frac{a}{b} &quot;&lt;x&gt;&quot;">\\frac{a}{b} &quot;&lt;x&gt;&quot;</div>'), html);
  assert.ok(html.includes('<hr>'));
});

test('blocksHtml output is never editable', () => {
  const html = blocksHtml([{ id: 'a', type: 'p', text: '<span contenteditable="true">x</span>' }, { id: 'b', type: 'image', src: 'https://e.test/i.png', caption: 'c' }]);
  assert.ok(!/contenteditable/i.test(html), html);
  assert.equal(blocksHtml(null), '');
});
