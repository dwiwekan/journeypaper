// DOM-free parts of the data and services layers. Run: node --test tests/web/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, SECTIONS, MAX_TAGS, SEED_V, LEGACY_KEY } from '../../web/js/config.js';
import { normTags, normalizePaper, sectionKey, derived, normalizeCard } from '../../web/js/data/paper.js';
import { SEED } from '../../web/js/data/seed.js';
import { AI } from '../../web/js/services/ai.js';
import { parseQuery, lev, filterAndSort, highlighter, hl, snippet } from '../../web/js/services/search.js';

const paper = (o) => normalizePaper({ content: [], createdAt: 1, ...o });

test('config keeps the storage keys and labels the app already uses', () => {
  assert.deepEqual(Object.keys(STATUS), ['want', 'reading', 'done']);
  assert.equal(SECTIONS.length, 5);
  assert.equal(MAX_TAGS, 12);
  assert.equal(SEED_V, 2);
  assert.equal(LEGACY_KEY, 'jp:papers:v1');
});

test('normTags lowercases, strips #, hyphenates, dedupes, caps at 12', () => {
  assert.deepEqual(normTags('#NLP, Deep Learning, nlp'), ['nlp', 'deep-learning']);
  assert.equal(normTags(Array.from({ length: 20 }, (_, i) => 't' + i)).length, 12);
});

test('normalizePaper trims and clamps fields', () => {
  const p = paper({ id: 'a b!', title: ' A ', status: 'bogus', rating: '9', year: 2017, link: 'javascript:1' });
  assert.equal(p.id, 'ab');
  assert.equal(p.title, 'A');
  assert.equal(p.status, 'want');
  assert.equal(p.rating, 5);
  assert.equal(p.year, '2017');
  assert.equal(p.link, '');
  assert.deepEqual(p.content, []);
});

test('sectionKey maps English and older Indonesian headings', () => {
  assert.equal(sectionKey('Related Work'), 'related');
  assert.equal(sectionKey('Hasil Eksperimen'), 'results');
  assert.equal(sectionKey('Notes'), null);
});

test('SEED holds the sample papers, all flagged as samples', () => {
  assert.ok(SEED.length >= 5);
  assert.ok(SEED.every((p) => p.sample === true));
  assert.ok(SEED.some((p) => p.title === 'Attention Is All You Need'));
});

test('AI.enrich is still a stub', async () => {
  assert.equal(await AI.enrich({ title: 'x' }), null);
});

test('parseQuery splits phrases and tags and drops stop words', () => {
  const t = parseQuery('the "Deep Learning" #NLP model');
  assert.deepEqual(t.map((x) => [x.v, !!x.phrase, !!x.tag]), [['deep learning', true, false], ['nlp', false, true], ['model', false, false]]);
});

test('lev stops early once the distance passes max', () => {
  assert.equal(lev('atention', 'attention', 1), 1);
  assert.equal(lev('abc', 'xyz', 1), 2);
});

const papers = [
  paper({ id: 'a', title: 'Attention Is All You Need', tags: ['nlp'], status: 'done', rating: 5, year: '2017', createdAt: 3 }),
  paper({ id: 'b', title: 'CLIP', tags: ['clip', 'vision'], status: 'want', rating: 0, year: '2021', createdAt: 2 }),
  paper({ id: 'c', title: 'BERT', tags: ['nlp'], status: 'reading', rating: 4, year: '2019', createdAt: 1 }),
];
const query = (o) => filterAndSort(papers, { q: '', status: 'all', tags: new Set(), sort: 'recent', ...o });

test('filterAndSort tolerates typos and matches tags', () => {
  assert.equal(query({ q: 'atention', sort: 'relevance' }).items[0].id, 'a');
  assert.deepEqual(query({ q: '#clip' }).items.map((p) => p.id), ['b']);
});

test('filterAndSort filters by status and tags and sorts', () => {
  assert.deepEqual(query({ status: 'reading' }).items.map((p) => p.id), ['c']);
  assert.deepEqual(query({ tags: new Set(['nlp']), sort: 'year' }).items.map((p) => p.id), ['c', 'a']);
  assert.deepEqual(query({ sort: 'title' }).items.map((p) => p.id), ['a', 'c', 'b']);
  assert.deepEqual(query({ sort: 'rating' }).items.map((p) => p.id), ['a', 'c', 'b']);
  assert.equal(papers.map((p) => p.id).join(), 'a,b,c', 'input list is not reordered');
});

test('hl escapes HTML and marks matches', () => {
  const re = highlighter(parseQuery('attention'));
  assert.equal(hl('a <b> Attention', re), 'a &lt;b&gt; <mark>Attention</mark>');
  assert.equal(hl('<i>', null), '&lt;i&gt;');
});

test('snippet cuts around the first match', () => {
  const text = 'x'.repeat(100) + ' target ' + 'y'.repeat(100);
  const s = snippet(text, parseQuery('target'));
  assert.ok(s.startsWith('…') && s.endsWith('…') && s.includes('target'));
  assert.equal(snippet('nothing here', parseQuery('target')), null);
});

test('derived falls back to bodyText and sectionsFilled when content is absent', () => {
  const c = normalizeCard({ id: 'c', title: 'Card', bodyText: 'some notes', sectionsFilled: ['method', 'nope'], content: [{ type: 'p', text: 'ignored' }] });
  assert.equal('content' in c, false);
  assert.deepEqual(c.sectionsFilled, ['method']);
  const d = derived(c);
  assert.equal(d.body, 'some notes');
  assert.deepEqual([...d.filled], ['method']);
});

test('normalizePaper keeps public as a boolean', () => {
  assert.equal(paper({ id: 'a', title: 'T' }).public, false);
  assert.equal(paper({ id: 'a', title: 'T', public: 1 }).public, true);
});

test('normalizeCard cleans owner and keeps deletedAt', () => {
  const c = normalizeCard({ id: 'c', title: 'T', owner: '<x>abc-1', deletedAt: '77' });
  assert.equal(c.owner, 'abc-1');
  assert.equal(c.deletedAt, 77);
  assert.equal(normalizeCard({ id: 'c', title: 'T' }).owner, '');
  assert.equal(normalizeCard({ id: 'c', title: 'T' }).deletedAt, 0);
});
