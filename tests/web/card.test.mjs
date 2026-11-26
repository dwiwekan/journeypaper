// Catalog cards (ui/card.js): member cards and the read-only public ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHtml } from '../../web/js/ui/card.js';
import { normalizeCard } from '../../web/js/data/paper.js';
import { filterAndSort, highlighter } from '../../web/js/services/search.js';

const OWNER = '6f1c2a9e-0b7d-4c1e-9a55-3d2e8f0c1b2a';
const card = (o) => normalizeCard({ id: 'x1', title: 'A paper', createdAt: 1, owner: OWNER, ...o });

test('read-only card has no edit or delete control and links to the public route', () => {
  const html = cardHtml(card({ public: true }), null, [], 1, { readOnly: true });
  assert.ok(!html.includes('data-act="edit"') && !html.includes('data-act="delete"'), html);
  assert.ok(html.includes(`href="#library/${OWNER}/x1"`), html);
  assert.ok(!html.includes('badge-public'), 'no Public badge for visitors');
  assert.ok(html.includes('class="pill"'), 'the status pill stays');
});

test('member card keeps edit and delete', () => {
  const html = cardHtml(card({ public: true }), null, [], 1);
  assert.ok(html.includes('data-act="edit"') && html.includes('data-act="delete"'));
  assert.ok(html.includes('badge-public'), 'a public paper shows the badge to its owner');
  assert.ok(!cardHtml(card({}), null, [], 1).includes('badge-public'));
  assert.ok(!html.includes('#library/'));
});

test('public card escapes the title and drops a javascript: link', () => {
  const c = card({ title: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)', tags: ['<b>'], summary: '<script>s</script>' });
  const html = cardHtml(c, null, [], 1, { readOnly: true });
  assert.ok(!html.includes('<img src=x'), html);
  assert.ok(!html.includes('javascript:'), html);
  assert.ok(!html.includes('<b>') && !html.includes('<script>'), html);
});

test("search finds a word only in a public paper's notes and shows it highlighted", () => {
  const cards = [card({ id: 'a', title: 'Deep nets' }), card({ id: 'b', title: 'Other', bodyText: 'we train it with backpropagation and luck' })];
  const opts = { status: 'all', tags: new Set(), sort: 'relevance' };
  /* Typos still find the paper (fuzzy match in filterAndSort). */
  assert.deepEqual(filterAndSort(cards, { ...opts, q: 'backpropagaton' }).items.map((p) => p.id), ['b']);
  /* The Notes snippet and its highlight come from an exact match (snippet and hl are exact). */
  const { items, terms } = filterAndSort(cards, { ...opts, q: 'backpropagation' });
  const html = cardHtml(items[0], highlighter(terms), terms, 1, { readOnly: true });
  assert.ok(html.includes('<b>Notes</b>'), html);
  assert.ok(html.includes('<mark>backpropagation</mark>'), html);
});
