// Search: query parsing, typo-tolerant scoring, sorting, and match highlighting.
import { norm, esc, escRe } from '../util.js';
import { derived } from '../data/paper.js';

/* ---------- search ---------- */
const STOP = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'itu', 'ini', 'tentang', 'dengan', 'the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'about', 'that']);

export function parseQuery(q) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[1]) terms.push({ v: norm(m[1]).trim(), raw: m[1].trim(), phrase: true });
    else if (m[2][0] === '#' && m[2].length > 1) terms.push({ v: norm(m[2].slice(1)), raw: m[2].slice(1), tag: true });
    else terms.push({ v: norm(m[2]), raw: m[2] });
  }
  let list = terms.filter((t) => t.v);
  const meaningful = list.filter((t) => t.phrase || t.tag || !STOP.has(t.v));
  if (meaningful.length) list = meaningful;
  return list;
}

const idxCache = new WeakMap();
function indexOf(p) {
  let ix = idxCache.get(p);
  if (ix) return ix;
  const f = {
    title: norm(p.title),
    tags: norm(p.tags.join(' ')),
    authors: norm(p.authors),
    meta: norm([p.venue, p.year].filter(Boolean).join(' ')),
    summary: norm(p.summary),
    body: norm(derived(p).body),
  };
  const words = {};
  Object.keys(f).forEach((k) => { words[k] = Array.from(new Set(f[k].split(/[^a-z0-9]+/).filter((w) => w.length >= 3))); });
  ix = { f, words, tagList: p.tags.map(norm) };
  idxCache.set(p, ix);
  return ix;
}

export function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const WEIGHT = { title: 6, tags: 5, authors: 3, meta: 2, summary: 2, body: 1.5 };

function scoreTerm(ix, t) {
  if (t.tag) return ix.tagList.some((x) => x.includes(t.v)) ? 8 : 0;
  let s = 0;
  for (const k in WEIGHT) if (ix.f[k].includes(t.v)) s += WEIGHT[k];
  if (s === 0 && !t.phrase && t.v.length >= 4) {
    const max = t.v.length >= 8 ? 2 : 1;
    for (const k in WEIGHT) if (ix.words[k].some((w) => lev(w, t.v, max) <= max)) s += WEIGHT[k] * 0.4;
  }
  return s;
}

function scorePaper(p, terms) {
  const ix = indexOf(p);
  let total = 0;
  for (const t of terms) {
    const s = scoreTerm(ix, t);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/** Filter, score and sort papers. Does not change the input list. */
export function filterAndSort(papers, { q, status, tags, sort }) {
  let list = papers.slice();
  if (status !== 'all') list = list.filter((p) => p.status === status);
  if (tags.size) list = list.filter((p) => Array.from(tags).every((t) => p.tags.includes(t)));
  const terms = parseQuery(q);
  const score = new Map();
  if (terms.length) {
    list = list.filter((p) => { const s = scorePaper(p, terms); if (s > 0) score.set(p.id, s); return s > 0; });
  }
  const byRecent = (a, b) => b.createdAt - a.createdAt;
  const sorters = {
    recent: byRecent,
    relevance: (a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0) || byRecent(a, b),
    title: (a, b) => a.title.localeCompare(b.title, 'en'),
    year: (a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0) || byRecent(a, b),
    rating: (a, b) => b.rating - a.rating || byRecent(a, b),
  };
  list.sort(sorters[sort] || byRecent);
  return { items: list, terms };
}

export function highlighter(terms) {
  const raws = terms.map((t) => t.raw).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!raws.length) return null;
  return new RegExp('(' + raws.map(escRe).join('|') + ')', 'gi');
}
export function hl(text, re) {
  if (!re) return esc(text);
  return String(text).split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
}
export function snippet(text, terms) {
  const low = text.toLowerCase();
  let at = -1, len = 0;
  for (const t of terms) { const i = low.indexOf(t.raw.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) { at = i; len = t.raw.length; } }
  if (at < 0) return null;
  const a = Math.max(0, at - 50), b = Math.min(text.length, at + len + 70);
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
}
