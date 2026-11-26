// The paper page: header, table of contents, the editor, and autosave.
import { $, $$, esc, pad, trunc } from '../util.js';
import { STATUS, AUTOSAVE_MS } from '../config.js';
import { Store } from '../data/active-store.js';
import { createEditor } from '../editor/editor.js';
import { ICON, STAR } from './icons.js';
import { coverFor } from './cover.js';
import { state, getPaper, replacePaper, shownPapers } from './state.js';
import { toast } from './toast.js';
import { openLightbox } from './dialog.js';
import { renderAll, removePaper } from './catalog.js';
import { openForm } from './paper-form.js';
import { createSaver } from './saver.js';
import { openConflict } from './conflict.js';
import { showView } from './views.js';
import { renderPublicSwitch } from './publish.js';

let editor = null;
let toc = null; // what the contents list reads: the editor, or the read-only body (tocFromView)
let saveTimer = 0;
let openSeq = 0; // the latest openPage call; an older one that finishes loading is ignored
let tocTimer = 0;
let catalogY = 0;
const saveEl = $('#save-state');
const setSave = (t) => { saveEl.textContent = t; };

export function renderPaperHead(p) {
  const rank = shownPapers().slice().sort((a, b) => a.createdAt - b.createdAt).findIndex((x) => x.id === p.id) + 1;
  const meta = [rank ? `№ ${pad(rank)}` : '', [p.venue, p.year].filter(Boolean).join(' '), p.authors].filter(Boolean).join('  ·  ');
  const cover = $('#pg-cover');
  cover.parentElement.hidden = false;
  cover.dataset.title = p.title;
  delete cover.dataset.fb;
  const c = coverFor(p);
  cover.classList.toggle('fit', c.fit);
  cover.src = c.src;
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
  /* Visitors see no TL;DR box when there is none, and no hint about Edit info. */
  $('#pg-tldr').hidden = !p.summary && state.mode === 'public';
  $('#pg-tldr').innerHTML = p.summary
    ? `<b>TL;DR</b><p>${esc(p.summary)}</p>`
    : `<b>TL;DR</b><p class="dim">None yet. AI will fill it in later, or write your own with Edit info.</p>`;
  renderPublicSwitch(p);
  document.title = trunc(p.title, 60) + ' · JourneyPaper';
}

function buildToc() {
  const hs = toc ? toc.headings() : [];
  $('#toc').hidden = hs.length < 2;
  $('#toc-list').innerHTML = hs.map((h) => `<button type="button" class="toc-l${h.level}" data-id="${esc(h.id)}">${esc(h.text || '(untitled)')}</button>`).join('');
  updateTocActive();
}
function updateTocActive() {
  if (!toc || $('#toc').hidden) return;
  const offs = toc.headingOffsets();
  let cur = offs.length ? offs[0].id : null;
  offs.forEach((o) => { if (o.top <= 140) cur = o.id; });
  $$('#toc-list button').forEach((b) => b.classList.toggle('on', b.dataset.id === cur));
}

let rafId = 0;

function mount(p) {
  destroyEditor();
  editor = createEditor($('#editor'), { blocks: p.content, onChange: onEditorChange, toast, openImage: openLightbox });
  toc = editor;
  buildToc();
}

const saver = createSaver({
  store: Store,
  getBlocks: () => (editor ? editor.getBlocks() : []),
  setSave,
  onConflict: openConflict,
  onSaved: (saved) => { if (saved) replacePaper(saved); },
  onReload: (current, id) => {
    replacePaper(current);
    if (state.openId !== id) return;
    renderPaperHead(current);
    mount(current);
  },
  onError: (e) => toast(e.message || 'Could not save.'),
});

function onEditorChange() {
  saver.touch();
  setSave('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
  clearTimeout(tocTimer);
  tocTimer = setTimeout(buildToc, 300);
}
export async function flushSave() {
  clearTimeout(saveTimer);
  await saver.flush();
}
/** Drops an unsaved edit. Used when the open paper is deleted. */
export function cancelPendingSave() { saver.cancel(); clearTimeout(saveTimer); }
function destroyEditor() { if (editor) { editor.destroy(); editor = null; } toc = null; }

/** The editor (members) or the read-only #pg-body (the public paper page). */
export function setPageEditable(on) {
  $('#editor').hidden = !on;
  $('.editor-hint').hidden = !on;
  $('#pg-body').hidden = on;
  $('#pg-back-label').textContent = on ? 'All papers' : 'Library';
  if (on) { $('#pg-body').innerHTML = ''; $('#pg-edit-own').hidden = true; }
}

/** Points the contents list at read-only headings (from viewHeadings); [] clears it. */
export function tocFromView(heads) {
  const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  toc = {
    headings: () => heads,
    headingOffsets: () => heads.map((h) => ({ id: h.id, top: h.el.getBoundingClientRect().top })),
    scrollTo: (id) => { const h = heads.find((x) => x.id === id); if (h) h.el.scrollIntoView({ behavior: smooth(), block: 'start' }); },
  };
  buildToc();
}

async function openPage(id) {
  /* Already open (for example behind the sign-in screen after a session ended): show it again. */
  if (state.openId === id) { showView('paper'); return; }
  await flushSave();
  if (!state.openId) catalogY = window.scrollY;
  const card = getPaper(id);
  if (!card) { location.hash = 'papers'; return; }
  const seq = ++openSeq;
  destroyEditor();
  state.openId = id;
  saver.open(id);
  setPageEditable(true);
  showView('paper');
  renderPaperHead(card);
  buildToc();
  setSave('Loading…');
  window.scrollTo(0, 0);
  let p;
  try { p = await Store.get(id); } catch (e) {
    if (seq === openSeq && state.openId === id) { setSave('Could not load'); toast(e.message || 'Could not load this paper.'); }
    return;
  }
  if (seq !== openSeq || state.openId !== id) return; // the user went somewhere else meanwhile
  if (!p) { location.hash = 'papers'; return; }
  setSave('');
  renderPaperHead(p);
  mount(p);
}
async function closePage() {
  if (!state.openId) { toc = null; showView('catalog'); document.title = 'JourneyPaper'; return; }
  await flushSave();
  openSeq += 1;
  destroyEditor();
  state.openId = null;
  saver.open(null);
  showView('catalog');
  document.title = 'JourneyPaper';
  renderAll();
  window.scrollTo(0, catalogY);
}
/** Router handler for #papers, #paper-<id> and #trash; route(null) just closes the open paper. */
export function route(r) {
  return r && r.name === 'paper' && getPaper(r.id) ? openPage(r.id) : closePage();
}

/** Table of contents, autosave flush on leave, and the page header buttons. */
export function initPaperPage() {
  $('#toc-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b && toc) toc.scrollTo(b.dataset.id);
  });

  window.addEventListener('scroll', () => {
    if (!toc || rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; updateTocActive(); });
  }, { passive: true });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', () => { flushSave(); });
  /* No offline queue: warn before closing the tab while an edit is still unsaved. */
  window.addEventListener('beforeunload', (e) => { if (saver.pending()) { e.preventDefault(); e.returnValue = ''; } });

  $('#pg-back').addEventListener('click', () => { location.hash = state.mode === 'public' ? 'library' : 'papers'; });
  /* The empty hash: the router sends it home (visitors) or to the papers (members, local mode). */
  $('.brand').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
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
    try {
      const saved = await Store.update(p.id, patch);
      if (saved) { replacePaper(saved); if (state.openId === saved.id) renderPaperHead(saved); }
    } catch (err) { toast(err.message || 'Could not save.'); }
  });
}
