// In-browser smoke checks for the modules that need a real DOM. Never opens IndexedDB.
import { normalizePaper, normTags, derived } from '../js/data/paper.js';
import { SEED } from '../js/data/seed.js';
import { cleanInline, safeImg } from '../js/editor/sanitize.js';
import { normBlocks } from '../js/editor/blocks.js';
import { createEditor } from '../js/editor/editor.js';
import { filterAndSort } from '../js/services/search.js';
import { coverSvg } from '../js/ui/cover.js';

const out = document.getElementById('out');
let passed = 0, failed = 0;

function check(name, fn) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true; if (!ok) detail = ' (got ' + JSON.stringify(r) + ')'; } catch (e) { detail = ' (threw ' + e.message + ')'; }
  ok ? passed++ : failed++;
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${detail}`;
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = line;
  out.appendChild(li);
  (ok ? console.log : console.error)(line);
}

const query = (q) => filterAndSort(SEED.map(normalizePaper), { q, status: 'all', tags: new Set(), sort: 'relevance' }).items;

check('normalizePaper trims the title and defaults status and template', () => {
  const p = normalizePaper({ title: ' A ' });
  return p.title === 'A' && p.status === 'want' && p.content.length === 10 || p;
});
check('normTags cleans and dedupes', () => JSON.stringify(normTags('#NLP, Deep Learning, nlp')) === '["nlp","deep-learning"]' || normTags('#NLP, Deep Learning, nlp'));
check('cleanInline drops scripts and unsafe links', () => {
  const r = cleanInline('<b>x</b><script>alert(1)</script><a href="javascript:1">y</a>');
  return r === '<b>x</b>y' || r;
});
check('cleanInline keeps safe links and adds rel', () => {
  const r = cleanInline('<a href="https://arxiv.org" onclick="x()">a</a>');
  return (r.includes('href="https://arxiv.org/"') && r.includes('rel="noopener noreferrer"') && !r.includes('onclick')) || r;
});
check('normBlocks turns an unknown type into p', () => normBlocks([{ type: 'weird', text: 't' }])[0].type === 'p');
check('safeImg rejects javascript: URLs', () => safeImg('javascript:alert(1)') === '');
check('search tolerates the typo "atention"', () => query('atention')[0]?.title === 'Attention Is All You Need' || query('atention').map((p) => p.title));
check('search "#clip" filters by tag', () => query('#clip').length === 1 || query('#clip').length);
check('derived counts filled sections', () => {
  const p = normalizePaper({ title: 'x', content: [{ type: 'h2', text: 'Introduction' }, { type: 'p', text: 'hello' }, { type: 'h2', text: 'Method' }] });
  return derived(p).filled.size === 1 || [...derived(p).filled];
});
check('coverSvg is a deterministic data URL', () => {
  const a = coverSvg('Attention'), b = coverSvg('Attention');
  return (a === b && a.startsWith('data:image/svg+xml') && a !== coverSvg('BERT')) || a.slice(0, 40);
});
check('createEditor mounts, reports blocks and headings, and cleans up', () => {
  const mount = document.getElementById('mount');
  const ed = createEditor(mount, { blocks: [{ type: 'h2', text: 'Introduction' }, { type: 'p', text: 'hello' }], onChange() {}, toast() {}, openImage() {} });
  const r = ed.getBlocks().length === 2 && ed.headings().length === 1 && ed.headings()[0].text === 'Introduction';
  ed.destroy();
  return (r && mount.innerHTML === '') || { blocks: ed.getBlocks().length };
});

const summary = document.getElementById('summary');
summary.className = failed ? 'fail' : 'pass';
summary.textContent = `${passed} passed, ${failed} failed`;
document.title = (failed ? 'FAIL ' : 'PASS ') + document.title;
