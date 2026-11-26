'use strict';

/* Jurnal Paper
   Layers that are meant to be swapped later:
   - Store : where data lives. IndexedDB in the browser today, the API later.
   - AI    : auto-fill from title, image, and link. Still a stub.
   - UI    : everything else only renders and calls Store/AI.
   The paper editor lives in editor.js. */

(function () {
  const E = window.JPEditor;

  /* ---------- util ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = E.escapeHtml;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtDate = (t) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));

  const Prefs = {
    get(k, d) { try { const v = localStorage.getItem('jp:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('jp:' + k, v); } catch (e) { /* ignore */ } },
  };

  const STATUS = { want: 'To read', reading: 'Reading', done: 'Done' };
  const SECTIONS = [['intro', 'Introduction'], ['related', 'Related Work'], ['method', 'Method'], ['results', 'Experiment Results'], ['concl', 'Conclusion']];

  const ICON = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  };
  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.7 5.8 6.3.7-4.7 4.3 1.3 6.3L12 16.7 6.4 19.9l1.3-6.3L3 9.3l6.3-.7L12 2.8Z"/></svg>';

  /* ---------- paper content: template and cleanup ---------- */
  function normTags(t) {
    const arr = Array.isArray(t) ? t : String(t || '').split(',');
    const out = [];
    arr.forEach((x) => {
      const v = String(x).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 32);
      if (v && !out.includes(v)) out.push(v);
    });
    return out.slice(0, 12);
  }

  /* Every new paper starts with these five sections. Users may rename or delete them in the editor. */
  function templateBlocks() {
    const out = [];
    SECTIONS.forEach(([, title]) => { out.push({ type: 'h2', text: title }, { type: 'p', text: '' }); });
    return out;
  }
  function legacyContent(r) {
    const blocks = templateBlocks();
    const notes = String(r.notes || '').trim();
    if (notes) blocks.push({ type: 'h2', text: 'Notes' }, { type: 'p', text: esc(notes).replace(/\n/g, '<br>') });
    return E.normBlocks(blocks);
  }

  function normalizePaper(r) {
    const now = Date.now();
    return {
      id: String(r.id || uid()).replace(/[^A-Za-z0-9_-]/g, '') || uid(),
      title: String(r.title || '').trim().slice(0, 300),
      image: E.safeImg(r.image),
      link: E.safeHref(r.link),
      authors: String(r.authors || '').trim().slice(0, 400),
      year: r.year ? String(r.year).trim().slice(0, 4) : '',
      venue: String(r.venue || '').trim().slice(0, 120),
      tags: normTags(r.tags),
      status: STATUS[r.status] ? r.status : 'want',
      rating: clamp(parseInt(r.rating, 10) || 0, 0, 5),
      summary: String(r.summary || '').trim(),
      content: Array.isArray(r.content) ? E.normBlocks(r.content) : legacyContent(r),
      sample: !!r.sample,
      createdAt: Number(r.createdAt) || now,
      updatedAt: Number(r.updatedAt) || now,
    };
  }

  /* ---------- sample data ---------- */
  const DAY = 86400000;
  const T0 = Date.now();
  const P = (text) => ({ type: 'p', text });
  const H3 = (text) => ({ type: 'h3', text });
  const UL = (text) => ({ type: 'ul', text });
  const CALLOUT = (text) => ({ type: 'callout', text });
  const EQ = (tex) => ({ type: 'equation', tex });
  /* Sections without content still appear as a heading with an empty paragraph. */
  function doc(parts) {
    const out = [];
    SECTIONS.forEach(([key, title]) => {
      out.push({ type: 'h2', text: title });
      const items = parts[key];
      if (items && items.length) out.push(...items); else out.push(P(''));
    });
    return out;
  }

  const SEED = [
    {
      title: 'Attention Is All You Need', authors: 'Vaswani et al.', year: 2017, venue: 'NeurIPS', tags: ['transformer', 'nlp'], status: 'done', rating: 5,
      summary: 'Introduces the Transformer, an architecture built entirely on self-attention with no recurrence or convolution. It became the foundation of almost every large language model today.',
      link: 'https://arxiv.org/abs/1706.03762', createdAt: T0 - 40 * DAY,
      content: doc({
        intro: [
          P('Before the Transformer, sequence-to-sequence models were dominated by RNNs, LSTMs, and GRUs that process tokens one at a time. That sequential processing makes parallelization hard and long-range dependencies difficult to learn.'),
          CALLOUT('Core idea: replace recurrence with <b>self-attention</b> so every position can be processed in parallel.'),
        ],
        related: [
          P('Earlier attempts to reduce sequential computation used convolutions, such as ConvS2S and ByteNet. The number of operations needed to relate two positions grows with their distance (linearly in ConvS2S, logarithmically in ByteNet), while in the Transformer it is constant.'),
        ],
        method: [
          H3('Scaled dot-product attention'),
          P('The output is a weighted sum of the values, with weights from how well each query matches each key.'),
          EQ('\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V'),
          P('Dividing by <code>√d_k</code> keeps the dot products from growing too large, so the softmax does not saturate.'),
          H3('Multi-head attention'),
          UL('Queries, keys, and values are projected into several subspaces, and attention is computed in parallel for each head.'),
          UL('The outputs of all heads are concatenated and projected again.'),
          UL('Sinusoidal positional encodings are added because the model has no recurrence.'),
          CALLOUT('Reread before writing related work: the multi-head attention and positional encoding parts.'),
        ],
        results: [
          P('Evaluated on WMT 2014 machine translation.'),
          UL('English to German: 28.4 BLEU'),
          UL('English to French: 41.8 BLEU, trained for 3.5 days on eight GPUs'),
        ],
        concl: [
          P('The Transformer trains faster and performs better than recurrent or convolutional models on translation. The authors plan to extend it to modalities beyond text.'),
        ],
      }),
    },
    {
      title: '3D Scene Graph: A Structure for Unified Semantics, 3D Space, and Camera', authors: 'Armeni et al.', year: 2019, venue: 'ICCV', tags: ['3d-scene-graph', 'semantics'], status: 'done', rating: 4,
      summary: 'Proposes a layered scene graph (building, room, object, camera) that links semantics with 3D space, annotated semi-automatically on the Gibson dataset.',
      link: 'https://arxiv.org/abs/1910.02527', createdAt: T0 - 31 * DAY,
      content: doc({
        intro: [P('Semantics, 3D space, and cameras are usually treated separately. This paper unifies them in a single graph.')],
        method: [
          H3('Four layers'),
          UL('<b>Building</b>, the building as a whole'),
          UL('<b>Room</b>, rooms inside the building'),
          UL('<b>Object</b>, objects inside the rooms'),
          UL('<b>Camera</b>, viewpoints that observe objects and rooms'),
          CALLOUT('The layer definitions and their relations are a good reference when explaining graph structure.'),
        ],
      }),
    },
    {
      title: 'Object Goal Navigation using Goal-Oriented Semantic Exploration', authors: 'Chaplot et al.', year: 2020, venue: 'NeurIPS', tags: ['objectnav', 'navigation'], status: 'done', rating: 4,
      summary: 'Semantic Exploration combines an episodic semantic map with an exploration policy guided by the target object. A strong baseline for ObjectNav.',
      link: 'https://arxiv.org/abs/2007.00643', createdAt: T0 - 22 * DAY,
      content: doc({
        intro: [P('The agent must find an object of a given category, such as a chair, in an environment it has never seen.')],
        method: [
          UL('An episodic semantic map is built from RGB-D observations.'),
          UL('An exploration policy picks a long-term goal on the map.'),
          UL('A local policy drives the agent toward that goal.'),
        ],
      }),
    },
    {
      title: 'A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification', authors: 'Angelopoulos & Bates', year: 2021, venue: 'arXiv', tags: ['conformal-prediction', 'uncertainty'], status: 'reading', rating: 0,
      summary: 'A conformal prediction tutorial with code examples. Explains how to build prediction sets with coverage guarantees and no distributional assumptions.',
      link: 'https://arxiv.org/abs/2107.07511', createdAt: T0 - 9 * DAY,
      content: doc({
        intro: [P('Conformal prediction turns any model into one that outputs prediction sets with finite-sample coverage guarantees.')],
        method: [
          CALLOUT('Reading progress: up to split conformal. Next: the conditional coverage section.'),
          H3('Split conformal'),
          P('Hold out calibration data, compute a nonconformity score for each sample, then take a quantile of those scores.'),
          EQ('\\hat{q}=\\mathrm{Quantile}\\left(s_1,\\dots,s_n;\\ \\frac{\\lceil (n+1)(1-\\alpha)\\rceil}{n}\\right)'),
          EQ('\\mathcal{C}(X_{n+1})=\\{\\,y : s(X_{n+1},y)\\le \\hat{q}\\,\\}'),
        ],
      }),
    },
    {
      title: 'Kimera: from SLAM to Spatial Perception with 3D Dynamic Scene Graphs', authors: 'Rosinol et al.', year: 2021, venue: 'IJRR', tags: ['3d-scene-graph', 'slam'], status: 'want', rating: 0,
      summary: 'Builds a metric-semantic mesh and organizes it into a layered 3D dynamic scene graph, from objects up to rooms and buildings.',
      link: 'https://arxiv.org/abs/2101.06894', createdAt: T0 - 4 * DAY,
    },
    {
      title: 'Learning Transferable Visual Models From Natural Language Supervision', authors: 'Radford et al.', year: 2021, venue: 'ICML', tags: ['clip', 'vision-language'], status: 'want', rating: 0,
      summary: 'CLIP is trained contrastively on about 400 million image-text pairs, so it can classify zero-shot from class descriptions alone.',
      link: 'https://arxiv.org/abs/2103.00020', createdAt: T0 - 1 * DAY,
    },
  ].map((p) => ({ ...p, sample: true }));

  /* ---------- Store: IndexedDB with an in-memory fallback ---------- */
  const DB_NAME = 'jurnal-paper', ST = 'papers', META = '__meta__';
  /* Bump when SEED changes so untouched sample papers are replaced with the new version. */
  const SEED_V = 2;
  let db = null;
  let warned = false;
  const cache = new Map();

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no idb'));
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(ST)) req.result.createObjectStore(ST, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  function writeTx(fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(ST, 'readwrite');
      fn(t.objectStore(ST));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abort'));
    });
  }
  async function persist(puts, dels) {
    if (!db) return false;
    try { await writeTx((s) => { (puts || []).forEach((p) => s.put(p)); (dels || []).forEach((id) => s.delete(id)); }); return true; } catch (e) {
      if (!warned) { warned = true; toast('Could not save to the browser. Storage may be full, so recent changes could be lost when this tab closes.'); }
      return false;
    }
  }

  const Store = {
    async init() {
      try { db = await openDb(); } catch (e) {
        db = null;
        toast('Browser storage is unavailable. Data only lasts while this tab is open.');
      }
      let seeded = false, seedV = 0;
      if (db) {
        const rows = await new Promise((resolve) => {
          const r = db.transaction(ST).objectStore(ST).getAll();
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => resolve([]);
        });
        rows.forEach((x) => { if (x.id === META) { seeded = !!x.seeded; seedV = Number(x.seedV) || 0; } else { const p = normalizePaper(x); cache.set(p.id, p); } });
      }
      if (!seeded) {
        /* Older versions stored data in localStorage. Keep the user's own papers and replace sample data with the current set. */
        let legacy = null;
        try { const raw = localStorage.getItem('jp:papers:v1'); if (raw) legacy = JSON.parse(raw); } catch (e) { legacy = null; }
        const puts = [];
        if (Array.isArray(legacy)) {
          const mine = legacy.filter((r) => r && typeof r === 'object' && !r.sample && String(r.title || '').trim());
          mine.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
          if (legacy.some((r) => r && r.sample) || !mine.length) SEED.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
        } else if (!cache.size) {
          SEED.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
        }
        puts.push({ id: META, seeded: true, seedV: SEED_V });
        if (await persist(puts)) { try { localStorage.removeItem('jp:papers:v1'); } catch (e) { /* ignore */ } }
      } else if (seedV < SEED_V) {
        /* Replace sample papers the user never touched. Editing a sample clears its flag, so edited ones stay. */
        const old = Array.from(cache.values()).filter((p) => p.sample).map((p) => p.id);
        const puts = [];
        if (old.length) {
          old.forEach((id) => cache.delete(id));
          SEED.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
        }
        puts.push({ id: META, seeded: true, seedV: SEED_V });
        await persist(puts, old.filter((id) => !cache.has(id)));
      }
    },
    async list() { return Array.from(cache.values()); },
    async create(data) {
      const p = normalizePaper({ ...data, id: undefined, content: undefined, createdAt: Date.now() });
      cache.set(p.id, p); await persist([p]); return p;
    },
    async update(id, patch) {
      const cur = cache.get(id);
      if (!cur) return null;
      const p = normalizePaper({ ...cur, ...patch, id, sample: false, updatedAt: Date.now() });
      cache.set(id, p); await persist([p]); return p;
    },
    async remove(id) { cache.delete(id); await persist([], [id]); },
    async restore(p) { cache.set(p.id, p); await persist([p]); },
    async removeWhere(fn) { const ids = Array.from(cache.values()).filter(fn).map((p) => p.id); ids.forEach((id) => cache.delete(id)); await persist([], ids); },
    async merge(items) { const ps = items.map((r) => normalizePaper(r)); ps.forEach((p) => cache.set(p.id, p)); await persist(ps); },
    async clear() { const ids = Array.from(cache.keys()); cache.clear(); await persist([], ids); },
  };

  /* ---------- AI (stub) ----------
     Later: send { title, link, image } to the backend, receive { authors, year, venue, tags, summary, content }.
     content may hold blocks for the five sections. The returned object is merged into the new paper. */
  const AI = {
    async enrich(/* paper */) { return null; },
  };

  /* ---------- generated covers ---------- */
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const coverCache = new Map();
  /* The default cover is a small graph, like a scene graph, so every title gets its own look. */
  function coverSvg(title) {
    const key = title || 'paper';
    if (coverCache.has(key)) return coverCache.get(key);
    const r = rng(hash(key));
    const hue = Math.floor(r() * 360);
    const n = 7 + Math.floor(r() * 4);
    const pts = Array.from({ length: n }, () => [Math.round(34 + r() * 332), Math.round(34 + r() * 182), 3 + r() * 5]);
    let edges = '';
    for (let i = 1; i < n; i++) {
      const j = Math.floor(r() * i);
      edges += `<line x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}"/>`;
    }
    for (let k = 0; k < 2; k++) {
      const a = Math.floor(r() * n), b = Math.floor(r() * n);
      if (a !== b) edges += `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`;
    }
    const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2].toFixed(1)}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice">`
      + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 52% 17%)"/><stop offset="1" stop-color="hsl(${(hue + 46) % 360} 58% 30%)"/></linearGradient></defs>`
      + `<rect width="400" height="250" fill="url(#g)"/>`
      + `<g stroke="hsl(${(hue + 20) % 360} 80% 78%)" stroke-opacity=".5" stroke-width="1.4">${edges}</g>`
      + `<g fill="hsl(${(hue + 20) % 360} 90% 80%)">${dots}</g></svg>`;
    const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    coverCache.set(key, uri);
    return uri;
  }

  /* ---------- state ---------- */
  const state = {
    papers: [],
    q: '',
    status: 'all',
    tags: new Set(),
    sort: 'recent',
    sortTouched: false,
    view: Prefs.get('view', 'grid') === 'list' ? 'list' : 'grid',
    openId: null,
  };
  const getPaper = (id) => state.papers.find((p) => p.id === id);
  async function reload() { state.papers = await Store.list(); }
  const replacePaper = (p) => { state.papers = state.papers.map((x) => (x.id === p.id ? p : x)); };

  /* ---------- values derived from content ---------- */
  function sectionKey(text) {
    const t = norm(text).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (['introduction', 'pendahuluan'].includes(t)) return 'intro';
    if (['related work', 'related works', 'tinjauan pustaka', 'literature review'].includes(t)) return 'related';
    if (['method', 'methods', 'methodology', 'metode', 'approach'].includes(t)) return 'method';
    if (['experiment results', 'experiments', 'experiment', 'results', 'hasil eksperimen', 'hasil', 'evaluation'].includes(t)) return 'results';
    if (['conclusion', 'conclusions', 'kesimpulan'].includes(t)) return 'concl';
    return null;
  }
  const hasContent = (b) => (b.type === 'divider' || b.type === 'h2' || b.type === 'h3' ? false : !!E.blockPlain(b).trim() || (b.type === 'image' && !!b.src));
  const derivedCache = new WeakMap();
  function derived(p) {
    let d = derivedCache.get(p);
    if (d) return d;
    const filled = new Set();
    const parts = [];
    let cur = null;
    p.content.forEach((b) => {
      if (b.type === 'h2') {
        cur = sectionKey(E.plain(b.text));
        if (!cur) parts.push(E.plain(b.text));
        return;
      }
      if (cur && hasContent(b)) filled.add(cur);
      const t = E.blockPlain(b);
      if (t) parts.push(t);
    });
    d = { filled, body: parts.join('\n') };
    derivedCache.set(p, d);
    return d;
  }

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const themeBtn = $('#theme-toggle');
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    themeBtn.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(Prefs.get('theme', null) || root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light'));
  if (mq.addEventListener) mq.addEventListener('change', (e) => { if (!Prefs.get('theme', null)) applyTheme(e.matches ? 'dark' : 'light'); });
  themeBtn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.classList.add('theme-anim');
    applyTheme(next);
    Prefs.set('theme', next);
    setTimeout(() => root.classList.remove('theme-anim'), 400);
  });

  /* ---------- search ---------- */
  const STOP = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'itu', 'ini', 'tentang', 'dengan', 'the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'about', 'that']);

  function parseQuery(q) {
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

  function lev(a, b, max) {
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

  function compute() {
    let list = state.papers.slice();
    if (state.status !== 'all') list = list.filter((p) => p.status === state.status);
    if (state.tags.size) list = list.filter((p) => Array.from(state.tags).every((t) => p.tags.includes(t)));
    const terms = parseQuery(state.q);
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
    list.sort(sorters[state.sort] || byRecent);
    return { items: list, terms };
  }

  function highlighter(terms) {
    const raws = terms.map((t) => t.raw).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!raws.length) return null;
    return new RegExp('(' + raws.map(escRe).join('|') + ')', 'gi');
  }
  function hl(text, re) {
    if (!re) return esc(text);
    return String(text).split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
  }
  function snippet(text, terms) {
    const low = text.toLowerCase();
    let at = -1, len = 0;
    for (const t of terms) { const i = low.indexOf(t.raw.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) { at = i; len = t.raw.length; } }
    if (at < 0) return null;
    const a = Math.max(0, at - 50), b = Math.min(text.length, at + len + 70);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
  }

  /* ---------- catalog view ---------- */
  const el = {
    grid: $('#grid'), empty: $('#empty'), stats: $('#stats'), info: $('#result-info'),
    seg: $('#seg-status'), tagbar: $('#tagbar'), q: $('#q'), clearQ: $('#clear-q'), sort: $('#sort'),
    note: $('#sample-note'),
  };
  const catalogView = $('#view-catalog'), pageView = $('#view-paper');

  function starsHtml(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= n ? STAR : STAR.replace('<svg ', '<svg class="off" ');
    return `<span class="stars" role="img" aria-label="Rated ${n} out of 5">${s}</span>`;
  }
  function progressHtml(p) {
    const filled = derived(p).filled;
    const names = SECTIONS.filter(([k]) => filled.has(k)).map(([, t]) => t);
    const label = `${filled.size} of 5 sections filled${names.length ? ': ' + names.join(', ') : ''}`;
    return `<span class="prog" role="img" aria-label="${esc(label)}" title="${esc(label)}">${SECTIONS.map(([k]) => `<i class="${filled.has(k) ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function renderStats() {
    const c = { want: 0, reading: 0, done: 0 };
    state.papers.forEach((p) => { c[p.status]++; });
    el.stats.textContent = state.papers.length
      ? `${state.papers.length} ${state.papers.length === 1 ? 'paper' : 'papers'}  ·  ${c.done} done  ·  ${c.reading} reading  ·  ${c.want} to read`
      : 'No papers yet';
    el.note.hidden = !state.papers.some((p) => p.sample);
  }

  function renderSeg() {
    const c = { all: state.papers.length, want: 0, reading: 0, done: 0 };
    state.papers.forEach((p) => { c[p.status]++; });
    const opts = [['all', 'All'], ['want', STATUS.want], ['reading', STATUS.reading], ['done', STATUS.done]];
    el.seg.innerHTML = opts.map(([k, label]) =>
      `<button type="button" data-status="${k}" aria-pressed="${state.status === k}">${label} <span class="n">${c[k]}</span></button>`).join('');
  }

  function renderTags() {
    const counts = new Map();
    state.papers.forEach((p) => p.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    state.tags.forEach((t) => { if (!counts.has(t)) state.tags.delete(t); });
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    el.tagbar.innerHTML = sorted.map(([t, n]) =>
      `<button type="button" class="tag-chip" data-tag="${esc(t)}" aria-pressed="${state.tags.has(t)}">#${esc(t)} ${n}</button>`).join('');
    $('#tag-suggest').innerHTML = sorted.map(([t]) => `<option value="${esc(t)}"></option>`).join('');
  }

  function cardHtml(p, re, terms, rank) {
    const cover = p.image || coverSvg(p.title);
    const meta = [p.authors, [p.venue, p.year].filter(Boolean).join(' ')].filter(Boolean).join('  ·  ');
    let snip = '';
    if (terms.length) {
      const body = derived(p).body;
      const seen = (p.title + ' ' + p.summary).toLowerCase();
      const inVisible = terms.every((t) => seen.includes(t.raw.toLowerCase()));
      const s = !inVisible && !terms.some((t) => t.tag) && snippet(body, terms);
      if (s) snip = `<p class="snip"><b>Notes</b>${hl(s, re)}</p>`;
    }
    return `<article class="card" data-id="${esc(p.id)}">
      <div class="cover">
        <img src="${esc(cover)}" alt="" loading="lazy" decoding="async" data-title="${esc(p.title)}">
        <span class="no">№ ${pad(rank)}</span>
        <span class="pill" data-s="${p.status}">${STATUS[p.status]}</span>
      </div>
      <div class="card-main">
        <div class="card-body">
          ${meta ? `<p class="meta">${hl(meta, re)}</p>` : ''}
          <h3><button type="button" class="title-btn" data-act="open">${hl(p.title, re)}</button></h3>
          ${p.summary ? `<p class="summary">${hl(p.summary, re)}</p>` : ''}
          ${snip}
          ${p.tags.length ? `<div class="tags">${p.tags.map((t) => `<span class="tag">#${hl(t, re)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="card-foot">
          <span class="foot-l">${progressHtml(p)}${p.rating ? starsHtml(p.rating) : ''}</span>
          <span class="acts">
            ${p.link ? `<a class="icon-btn small" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" aria-label="Open paper link">${ICON.link}</a>` : ''}
            <button type="button" class="icon-btn small" data-act="edit" aria-label="Edit paper info">${ICON.edit}</button>
            <button type="button" class="icon-btn small" data-act="delete" aria-label="Delete paper">${ICON.trash}</button>
          </span>
        </div>
      </div>
    </article>`;
  }

  function renderGrid() {
    const { items, terms } = compute();
    const re = highlighter(terms);
    const rank = new Map(state.papers.slice().sort((a, b) => a.createdAt - b.createdAt).map((p, i) => [p.id, i + 1]));
    el.grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
    el.grid.innerHTML = items.map((p) => cardHtml(p, re, terms, rank.get(p.id))).join('');
    el.grid.hidden = items.length === 0;

    const filtered = terms.length || state.status !== 'all' || state.tags.size;
    el.info.textContent = !state.papers.length ? '' : filtered
      ? `${items.length} of ${state.papers.length} papers match${state.q.trim() ? ` “${trunc(state.q.trim(), 40)}”` : ''}`
      : `${items.length} ${items.length === 1 ? 'paper' : 'papers'}`;

    el.empty.hidden = items.length > 0;
    if (!items.length) {
      if (!state.papers.length) {
        el.empty.innerHTML = `<h2>Your journal has no papers yet.</h2><p>Add your first one. A title and an image are enough, then fill in the five sections on the paper page.</p>
          <div class="row"><button class="btn primary" type="button" data-empty="add">Add paper</button></div>`;
      } else {
        const q = state.q.trim();
        el.empty.innerHTML = `<h2>Nothing matches${q ? ` “${esc(trunc(q, 40))}”` : ''}.</h2>
          <p>Try a shorter word, another language, or loosen the filters above.</p>
          <div class="row">
            <button class="btn" type="button" data-empty="reset">Clear search and filters</button>
            ${q ? `<button class="btn primary" type="button" data-empty="add-q">Add “${esc(trunc(q, 24))}” as a new paper</button>` : ''}
          </div>`;
      }
    }
    el.clearQ.hidden = !state.q;
    $('#view-grid').setAttribute('aria-pressed', String(state.view === 'grid'));
    $('#view-list').setAttribute('aria-pressed', String(state.view === 'list'));
  }

  function renderAll() {
    renderStats(); renderSeg(); renderTags(); renderGrid();
    if (state.openId) { const p = getPaper(state.openId); if (p) renderPaperHead(p); }
  }

  /* ---------- catalog interaction ---------- */
  let qTimer = 0;
  el.q.addEventListener('input', () => {
    state.q = el.q.value;
    if (!state.sortTouched) { state.sort = state.q.trim() ? 'relevance' : 'recent'; el.sort.value = state.sort; }
    clearTimeout(qTimer);
    qTimer = setTimeout(renderGrid, 60);
  });
  el.q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.q.value) { e.preventDefault(); setQuery(''); } });
  el.clearQ.addEventListener('click', () => { setQuery(''); el.q.focus(); });
  function setQuery(v) {
    el.q.value = v; state.q = v;
    if (!state.sortTouched) { state.sort = v.trim() ? 'relevance' : 'recent'; el.sort.value = state.sort; }
    renderGrid();
  }
  el.sort.addEventListener('change', () => { state.sort = el.sort.value; state.sortTouched = true; renderGrid(); });
  el.seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    state.status = b.dataset.status; renderSeg(); renderGrid();
  });
  el.tagbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const t = b.dataset.tag;
    if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
    renderTags(); renderGrid();
  });
  $('#view-grid').addEventListener('click', () => { state.view = 'grid'; Prefs.set('view', 'grid'); renderGrid(); });
  $('#view-list').addEventListener('click', () => { state.view = 'list'; Prefs.set('view', 'list'); renderGrid(); });

  el.grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('a')) return;
    const id = card.dataset.id;
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'edit') return openForm(getPaper(id));
    if (act && act.dataset.act === 'delete') return removePaper(id);
    location.hash = 'paper-' + id;
  });
  /* Broken images (for example a dead URL) fall back to a generated cover. */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset && img.dataset.title !== undefined && !img.dataset.fb) { img.dataset.fb = '1'; img.src = coverSvg(img.dataset.title); }
  }, true);

  el.empty.addEventListener('click', (e) => {
    const b = e.target.closest('[data-empty]');
    if (!b) return;
    if (b.dataset.empty === 'add') openForm();
    if (b.dataset.empty === 'add-q') openForm(null, { title: state.q.trim() });
    if (b.dataset.empty === 'reset') { state.status = 'all'; state.tags.clear(); setQuery(''); renderSeg(); renderTags(); }
  });

  $('#btn-clear-sample').addEventListener('click', async () => {
    await Store.removeWhere((p) => p.sample);
    await reload(); renderAll();
    toast('Sample data removed');
  });

  /* ---------- delete with undo ---------- */
  async function removePaper(id) {
    const p = getPaper(id);
    if (!p) return;
    if (state.openId === id) { dirty = false; clearTimeout(saveTimer); }
    await Store.remove(id);
    await reload();
    if (state.openId === id) { location.hash = 'papers'; } else renderAll();
    toast(`“${trunc(p.title, 38)}” deleted`, {
      label: 'Undo',
      fn: async () => { await Store.restore(p); await reload(); renderAll(); },
    });
  }

  /* ---------- toast ---------- */
  function toast(msg, action) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast';
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    const kill = () => t.remove();
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', () => { kill(); action.fn(); });
      t.appendChild(b);
    }
    box.appendChild(t);
    setTimeout(kill, action ? 7000 : 3600);
  }

  /* ---------- shared dialog behavior ---------- */
  function lockScroll() { root.classList.add('locked'); }
  function unlockScroll() { if (!$$('dialog[open]').length) root.classList.remove('locked'); }
  $$('dialog').forEach((d) => {
    d.addEventListener('close', unlockScroll);
    let downOnBackdrop = false;
    d.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === d; });
    d.addEventListener('click', (e) => { if (e.target === d && downOnBackdrop) d.close(); });
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { const d = c.closest('dialog'); if (d) d.close(); }
  });
  function openDialog(d) { d.showModal(); lockScroll(); }

  function openLightbox(src, caption) {
    $('#lb-img').src = src;
    $('#lb-cap').textContent = caption || '';
    $('#lb-cap').hidden = !caption;
    openDialog($('#dlg-img'));
  }

  /* ---------- paper page ---------- */
  let editor = null;
  let dirty = false;
  let saveTimer = 0;
  let tocTimer = 0;
  let catalogY = 0;
  const saveEl = $('#save-state');
  const setSave = (t) => { saveEl.textContent = t; };

  function renderPaperHead(p) {
    const rank = state.papers.slice().sort((a, b) => a.createdAt - b.createdAt).findIndex((x) => x.id === p.id) + 1;
    const meta = [`№ ${pad(rank)}`, [p.venue, p.year].filter(Boolean).join(' '), p.authors].filter(Boolean).join('  ·  ');
    const cover = $('#pg-cover');
    cover.dataset.title = p.title;
    delete cover.dataset.fb;
    cover.src = p.image || coverSvg(p.title);
    $('#pg-meta').textContent = meta;
    $('#pg-title').textContent = p.title;
    const stars = [1, 2, 3, 4, 5].map((i) =>
      `<button type="button" class="${i <= p.rating ? 'on' : ''}" data-rate="${i}" role="radio" aria-checked="${i === p.rating}" aria-label="${i} ${i === 1 ? 'star' : 'stars'}">${STAR}</button>`).join('');
    $('#pg-props').innerHTML = `
      <div class="seg" role="group" aria-label="Reading status">
        ${Object.keys(STATUS).map((k) => `<button type="button" data-set-status="${k}" aria-pressed="${p.status === k}">${STATUS[k]}</button>`).join('')}
      </div>
      <div class="stars input" role="radiogroup" aria-label="Rating">${stars}</div>
      ${p.link ? `<a class="btn small" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">Open paper ${ICON.link}</a>` : ''}
      ${p.tags.length ? `<span class="tags">${p.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</span>` : ''}`;
    $('#pg-tldr').innerHTML = p.summary
      ? `<b>TL;DR</b><p>${esc(p.summary)}</p>`
      : `<b>TL;DR</b><p class="dim">None yet. AI will fill it in later, or write your own with Edit info.</p>`;
    document.title = trunc(p.title, 60) + ' · Jurnal Paper';
  }

  function buildToc() {
    const hs = editor ? editor.headings() : [];
    $('#toc').hidden = hs.length < 2;
    $('#toc-list').innerHTML = hs.map((h) => `<button type="button" class="toc-l${h.level}" data-id="${esc(h.id)}">${esc(h.text || '(untitled)')}</button>`).join('');
    updateTocActive();
  }
  function updateTocActive() {
    if (!editor || $('#toc').hidden) return;
    const offs = editor.headingOffsets();
    let cur = offs.length ? offs[0].id : null;
    offs.forEach((o) => { if (o.top <= 140) cur = o.id; });
    $$('#toc-list button').forEach((b) => b.classList.toggle('on', b.dataset.id === cur));
  }
  $('#toc-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b && editor) editor.scrollTo(b.dataset.id);
  });
  let rafId = 0;
  window.addEventListener('scroll', () => {
    if (!state.openId || rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; updateTocActive(); });
  }, { passive: true });

  function onEditorChange() {
    dirty = true;
    setSave('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
    clearTimeout(tocTimer);
    tocTimer = setTimeout(buildToc, 300);
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty || !editor || !state.openId) return;
    dirty = false;
    const id = state.openId;
    const saved = await Store.update(id, { content: editor.getBlocks() });
    if (saved) replacePaper(saved);
    if (!dirty) setSave('Saved');
  }
  function destroyEditor() { if (editor) { editor.destroy(); editor = null; } }

  async function openPage(id) {
    if (state.openId === id) return;
    await flushSave();
    if (!state.openId) catalogY = window.scrollY;
    const p = getPaper(id);
    if (!p) { location.hash = 'papers'; return; }
    destroyEditor();
    state.openId = id;
    catalogView.hidden = true; pageView.hidden = false;
    renderPaperHead(p);
    setSave('');
    editor = E.create($('#editor'), { blocks: p.content, onChange: onEditorChange, toast, openImage: openLightbox });
    buildToc();
    window.scrollTo(0, 0);
  }
  async function closePage() {
    if (!state.openId) { catalogView.hidden = false; pageView.hidden = true; return; }
    await flushSave();
    destroyEditor();
    state.openId = null;
    pageView.hidden = true; catalogView.hidden = false;
    document.title = 'Jurnal Paper';
    renderAll();
    window.scrollTo(0, catalogY);
  }
  function route() {
    const m = location.hash.match(/^#paper-([A-Za-z0-9_-]+)$/);
    if (m && getPaper(m[1])) openPage(m[1]); else closePage();
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', () => { flushSave(); });

  $('#pg-back').addEventListener('click', () => { location.hash = 'papers'; });
  $('.brand').addEventListener('click', (e) => { e.preventDefault(); location.hash = 'papers'; });
  $('#pg-edit').addEventListener('click', async () => { await flushSave(); openForm(getPaper(state.openId)); });
  $('#pg-del').addEventListener('click', () => removePaper(state.openId));
  $('#pg-props').addEventListener('click', async (e) => {
    const p = getPaper(state.openId);
    if (!p) return;
    const st = e.target.closest('[data-set-status]');
    const rt = e.target.closest('[data-rate]');
    let patch = null;
    if (st) patch = { status: st.dataset.setStatus };
    else if (rt) { const n = +rt.dataset.rate; patch = { rating: n === p.rating ? 0 : n }; }
    if (!patch) return;
    const saved = await Store.update(p.id, patch);
    if (saved) { replacePaper(saved); renderPaperHead(saved); }
  });

  /* ---------- add / edit info form ---------- */
  const F = { id: null, image: '', tags: [], rating: 0 };
  const f = {
    dlg: $('#dlg-form'), form: $('#paper-form'), heading: $('#form-title'),
    title: $('#f-title'), link: $('#f-link'), authors: $('#f-authors'), year: $('#f-year'), venue: $('#f-venue'),
    status: $('#f-status'), summary: $('#f-summary'), more: $('#more'),
    drop: $('#drop'), preview: $('#drop-preview'), dropEmpty: $('#drop-empty'), file: $('#f-file'),
    url: $('#f-image-url'), clear: $('#btn-img-clear'), err: $('#img-err'),
    tagInput: $('#f-tags'), tagChips: $('#f-tag-chips'), rating: $('#f-rating'), save: $('#btn-save'),
  };

  function openForm(paper, preset) {
    const p = paper || { title: '', image: '', link: '', authors: '', year: '', venue: '', tags: [], status: 'want', rating: 0, summary: '', ...(preset || {}) };
    F.id = paper ? paper.id : null;
    F.image = p.image || '';
    F.tags = p.tags.slice();
    F.rating = p.rating || 0;
    f.heading.textContent = paper ? 'Edit paper info' : 'Add paper';
    f.save.textContent = paper ? 'Save changes' : 'Save and start writing';
    f.title.value = p.title;
    f.link.value = p.link;
    f.authors.value = p.authors;
    f.year.value = p.year;
    f.venue.value = p.venue;
    f.status.value = p.status;
    f.summary.value = p.summary;
    f.tagInput.value = '';
    f.url.value = F.image && !F.image.startsWith('data:') ? F.image : '';
    f.err.hidden = true;
    f.more.open = !!paper;
    renderFormTags(); renderFormStars(); renderPreview();
    openDialog(f.dlg);
  }

  function renderPreview() {
    const has = !!F.image;
    f.preview.hidden = !has;
    f.dropEmpty.hidden = has;
    f.clear.hidden = !has;
    if (has) f.preview.src = F.image;
    else f.preview.removeAttribute('src');
  }
  function showImgErr(msg) { f.err.textContent = msg; f.err.hidden = !msg; }

  async function setImageFile(file) {
    showImgErr('');
    if (!file || !/^image\//.test(file.type)) return showImgErr('That file is not an image. Choose a PNG, JPG, or WebP file.');
    try {
      F.image = await E.compressImage(file, { max: 900, q: 0.84 });
      f.url.value = '';
      renderPreview();
    } catch (e) { showImgErr('Could not read that image. Try another file.'); }
  }

  f.drop.addEventListener('click', () => f.file.click());
  f.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.file.click(); } });
  f.file.addEventListener('change', () => { if (f.file.files[0]) setImageFile(f.file.files[0]); f.file.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => f.drop.addEventListener(ev, (e) => { e.preventDefault(); f.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => f.drop.addEventListener(ev, (e) => { e.preventDefault(); f.drop.classList.remove('over'); }));
  f.drop.addEventListener('drop', (e) => { const file = e.dataTransfer && e.dataTransfer.files[0]; if (file) setImageFile(file); });
  document.addEventListener('paste', (e) => {
    if (!f.dlg.open || !e.clipboardData) return;
    const file = Array.from(e.clipboardData.files || []).find((x) => /^image\//.test(x.type));
    if (file) { e.preventDefault(); setImageFile(file); }
  });
  f.url.addEventListener('input', () => {
    showImgErr('');
    const v = f.url.value.trim();
    F.image = v ? E.safeImg(v) : '';
    if (v && !F.image) showImgErr('Image URLs must start with http:// or https://');
    renderPreview();
  });
  f.preview.addEventListener('error', () => { if (F.image && !F.image.startsWith('data:')) showImgErr('Could not load an image from that URL. A generated cover is used if you leave it.'); });
  f.clear.addEventListener('click', () => { F.image = ''; f.url.value = ''; showImgErr(''); renderPreview(); });

  function renderFormTags() {
    f.tagChips.innerHTML = F.tags.map((t, i) =>
      `<span class="chip">#${esc(t)}<button type="button" data-rm="${i}" aria-label="Remove tag ${esc(t)}">${ICON.x}</button></span>`).join('');
  }
  function addTagsFromInput() {
    normTags(f.tagInput.value).forEach((v) => { if (!F.tags.includes(v) && F.tags.length < 12) F.tags.push(v); });
    f.tagInput.value = '';
    renderFormTags();
  }
  f.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagsFromInput(); }
    else if (e.key === 'Backspace' && !f.tagInput.value && F.tags.length) { F.tags.pop(); renderFormTags(); }
  });
  f.tagInput.addEventListener('change', addTagsFromInput);
  f.tagInput.addEventListener('blur', addTagsFromInput);
  f.tagChips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { F.tags.splice(+b.dataset.rm, 1); renderFormTags(); f.tagInput.focus(); }
  });

  function renderFormStars() {
    f.rating.className = 'stars input';
    f.rating.innerHTML = [1, 2, 3, 4, 5].map((i) =>
      `<button type="button" class="${i <= F.rating ? 'on' : ''}" data-rate="${i}" role="radio" aria-checked="${i === F.rating}" aria-label="${i} ${i === 1 ? 'star' : 'stars'}">${STAR}</button>`).join('');
  }
  f.rating.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rate]');
    if (!b) return;
    const n = +b.dataset.rate;
    F.rating = n === F.rating ? 0 : n;
    renderFormStars();
  });

  /* Invalid fields inside "More details" must be visible, not hidden. */
  f.form.addEventListener('invalid', () => { f.more.open = true; }, true);

  f.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.tagInput.value.trim()) addTagsFromInput();
    const data = {
      title: f.title.value.trim(), image: F.image, link: f.link.value.trim(),
      authors: f.authors.value.trim(), year: f.year.value.trim(), venue: f.venue.value.trim(),
      tags: F.tags, status: f.status.value, rating: F.rating, summary: f.summary.value.trim(),
    };
    if (!data.title) { f.title.focus(); return; }
    f.save.disabled = true;
    try {
      const creating = !F.id;
      const saved = creating ? await Store.create(data) : await Store.update(F.id, data);
      f.dlg.close();
      await reload();
      if (creating) {
        toast('Paper added. The five sections are ready.');
        location.hash = 'paper-' + saved.id;
        /* AI hook: auto-fill fields that are still empty. */
        try {
          const extra = await AI.enrich(saved);
          if (extra) { const up = await Store.update(saved.id, extra); if (up) { replacePaper(up); renderAll(); } }
        } catch (err) { /* AI may fail; the paper is already saved */ }
      } else {
        toast('Changes saved');
        renderAll();
      }
    } finally { f.save.disabled = false; }
  });

  $('#btn-add').addEventListener('click', () => openForm());

  /* ---------- data: export, import, wipe ---------- */
  const dd = { dlg: $('#dlg-data'), ta: $('#data-json'), msg: $('#data-msg'), wipe: $('#btn-wipe') };
  let wipeTimer = 0;
  function dataMsg(t, bad) { dd.msg.textContent = t; dd.msg.className = 'msg' + (bad ? ' bad' : ''); }
  function resetWipe() { clearTimeout(wipeTimer); dd.wipe.textContent = 'Delete everything'; dd.wipe.dataset.armed = ''; }

  $('#btn-data').addEventListener('click', async () => {
    await flushSave();
    dd.ta.value = JSON.stringify(state.papers, null, 2);
    const kb = Math.round(dd.ta.value.length / 1024);
    dataMsg(`${state.papers.length} ${state.papers.length === 1 ? 'paper' : 'papers'} ready to back up (${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}). Images are included in the JSON.`);
    resetWipe();
    openDialog(dd.dlg);
  });
  $('#btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(dd.ta.value); dataMsg('Copied to clipboard.'); }
    catch (e) { dd.ta.select(); dataMsg('The browser blocked clipboard access. The text is selected, so press Ctrl+C.', true); }
  });
  $('#btn-download').addEventListener('click', () => {
    const blob = new Blob([dd.ta.value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jurnal-paper-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    dataMsg('Download started. If nothing appears, use the Copy button.');
  });
  $('#btn-import').addEventListener('click', async () => {
    let arr;
    try { arr = JSON.parse(dd.ta.value); } catch (e) { return dataMsg('Invalid JSON. Check the brackets and commas.', true); }
    if (!Array.isArray(arr)) return dataMsg('The JSON must be a list of papers starting with [ .', true);
    const ok = arr.filter((x) => x && typeof x === 'object' && String(x.title || '').trim());
    if (!ok.length) return dataMsg('No paper in that JSON has a title.', true);
    await Store.merge(ok);
    await reload(); renderAll();
    dd.ta.value = JSON.stringify(state.papers, null, 2);
    dataMsg(`Imported ${ok.length} ${ok.length === 1 ? 'paper' : 'papers'}.${ok.length < arr.length ? ` Skipped ${arr.length - ok.length} without a title.` : ''}`);
  });
  dd.wipe.addEventListener('click', async () => {
    if (!dd.wipe.dataset.armed) {
      dd.wipe.dataset.armed = '1';
      dd.wipe.textContent = 'Click again to delete everything';
      wipeTimer = setTimeout(resetWipe, 4000);
      return;
    }
    resetWipe();
    if (state.openId) { dirty = false; clearTimeout(saveTimer); }
    await Store.clear();
    await reload();
    if (state.openId) location.hash = 'papers'; else renderAll();
    dd.ta.value = '[]';
    dataMsg('All papers deleted.');
  });

  /* ---------- keyboard shortcuts (catalog only) ---------- */
  document.addEventListener('keydown', (e) => {
    if (state.openId || $$('dialog[open]').length) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); el.q.focus(); el.q.select(); }
    else if (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openForm(); }
  });

  /* Shorter placeholder on narrow screens so it is not cut off. */
  const narrow = window.matchMedia('(max-width: 640px)');
  const setPlaceholder = () => { el.q.placeholder = narrow.matches ? 'Title, keyword, or note' : 'Search titles, keywords, or any bit of your notes you remember'; };
  setPlaceholder();
  if (narrow.addEventListener) narrow.addEventListener('change', setPlaceholder);

  /* ---------- start ---------- */
  (async function init() {
    await Store.init();
    await reload();
    el.sort.value = state.sort;
    renderAll();
    route();
  })();
})();
