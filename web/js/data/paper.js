// The paper record: its shape, cleanup rules, and values derived from its notes.
import { esc, uid, clamp, norm } from '../util.js';
import { STATUS, SECTIONS, MAX_TAGS } from '../config.js';
import { safeHref, safeImg, plain } from '../editor/sanitize.js';
import { normBlocks, blockPlain } from '../editor/blocks.js';

/* ---------- paper content: template and cleanup ---------- */
export function normTags(t) {
  const arr = Array.isArray(t) ? t : String(t || '').split(',');
  const out = [];
  arr.forEach((x) => {
    const v = String(x).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 32);
    if (v && !out.includes(v)) out.push(v);
  });
  return out.slice(0, MAX_TAGS);
}

/* Every new paper starts with these five sections. Users may rename or delete them in the editor. */
export function templateBlocks() {
  const out = [];
  SECTIONS.forEach(([, title]) => { out.push({ type: 'h2', text: title }, { type: 'p', text: '' }); });
  return out;
}
function legacyContent(r) {
  const blocks = templateBlocks();
  const notes = String(r.notes || '').trim();
  if (notes) blocks.push({ type: 'h2', text: 'Notes' }, { type: 'p', text: esc(notes).replace(/\n/g, '<br>') });
  return normBlocks(blocks);
}

export function normalizePaper(r) {
  const now = Date.now();
  return {
    id: String(r.id || uid()).replace(/[^A-Za-z0-9_-]/g, '') || uid(),
    title: String(r.title || '').trim().slice(0, 300),
    image: safeImg(r.image),
    link: safeHref(r.link),
    authors: String(r.authors || '').trim().slice(0, 400),
    year: r.year ? String(r.year).trim().slice(0, 4) : '',
    venue: String(r.venue || '').trim().slice(0, 120),
    tags: normTags(r.tags),
    status: STATUS[r.status] ? r.status : 'want',
    rating: clamp(parseInt(r.rating, 10) || 0, 0, 5),
    summary: String(r.summary || '').trim(),
    content: Array.isArray(r.content) ? normBlocks(r.content) : legacyContent(r),
    sample: !!r.sample,
    public: !!r.public,
    createdAt: Number(r.createdAt) || now,
    updatedAt: Number(r.updatedAt) || now,
  };
}

/* A list entry from the API: every field except content, plus the server's derived values. */
export function normalizeCard(r) {
  const { content, ...p } = normalizePaper({ ...r, content: [] });
  const keys = SECTIONS.map(([k]) => k);
  const filled = Array.isArray(r.sectionsFilled) ? r.sectionsFilled : [];
  return {
    ...p,
    bodyText: String(r.bodyText || ''),
    sectionsFilled: keys.filter((k) => filled.includes(k)),
    owner: String(r.owner || '').replace(/[^0-9a-f-]/gi, ''), // public cards: the owner's id
    deletedAt: Number(r.deletedAt) || 0, // Trash cards: when it was deleted
  };
}

/* ---------- values derived from content ---------- */
export function sectionKey(text) {
  const t = norm(text).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (['introduction', 'pendahuluan'].includes(t)) return 'intro';
  if (['related work', 'related works', 'tinjauan pustaka', 'literature review'].includes(t)) return 'related';
  if (['method', 'methods', 'methodology', 'metode', 'approach'].includes(t)) return 'method';
  if (['experiment results', 'experiments', 'experiment', 'results', 'hasil eksperimen', 'hasil', 'evaluation'].includes(t)) return 'results';
  if (['conclusion', 'conclusions', 'kesimpulan'].includes(t)) return 'concl';
  return null;
}
export const hasContent = (b) => (b.type === 'divider' || b.type === 'h2' || b.type === 'h3' ? false : !!blockPlain(b).trim() || (b.type === 'image' && !!b.src));
const derivedCache = new WeakMap();
export function derived(p) {
  let d = derivedCache.get(p);
  if (d) return d;
  if (!Array.isArray(p.content)) {
    /* A card without notes: use what the server derived. */
    d = { filled: new Set(p.sectionsFilled || []), body: p.bodyText || '' };
    derivedCache.set(p, d);
    return d;
  }
  const filled = new Set();
  const parts = [];
  let cur = null;
  p.content.forEach((b) => {
    if (b.type === 'h2') {
      cur = sectionKey(plain(b.text));
      if (!cur) parts.push(plain(b.text));
      return;
    }
    if (cur && hasContent(b)) filled.add(cur);
    const t = blockPlain(b);
    if (t) parts.push(t);
  });
  d = { filled, body: parts.join('\n') };
  derivedCache.set(p, d);
  return d;
}
