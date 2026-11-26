// The catalog screen: stats, filters, search results, and delete with undo.
import { $, esc, trunc, Prefs } from '../util.js';
import { STATUS } from '../config.js';
import { Store, usingApi } from '../data/active-store.js';
import { filterAndSort, highlighter } from '../services/search.js';
import { cardHtml, publicHash } from './card.js';
import { state, getPaper, reload, shownPapers } from './state.js';
import { toast } from './toast.js';
import { renderPaperHead, cancelPendingSave } from './paper-page.js';
import { openForm } from './paper-form.js';
import { moveToTrash } from './trash.js';

/* ---------- catalog view ---------- */
export const el = {
  grid: $('#grid'), empty: $('#empty'), stats: $('#stats'), info: $('#result-info'),
  seg: $('#seg-status'), tagbar: $('#tagbar'), q: $('#q'), clearQ: $('#clear-q'), sort: $('#sort'),
  note: $('#sample-note'),
};

function renderStats() {
  const list = shownPapers();
  const c = { want: 0, reading: 0, done: 0 };
  list.forEach((p) => { c[p.status]++; });
  el.stats.textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'paper' : 'papers'}  ·  ${c.done} done  ·  ${c.reading} reading  ·  ${c.want} to read`
    : state.mode === 'public' ? '' : 'No papers yet';
  el.note.hidden = state.mode === 'public' || !list.some((p) => p.sample);
}

function renderSeg() {
  const list = shownPapers();
  const c = { all: list.length, want: 0, reading: 0, done: 0 };
  list.forEach((p) => { c[p.status]++; });
  const opts = [['all', 'All'], ['want', STATUS.want], ['reading', STATUS.reading], ['done', STATUS.done]];
  el.seg.innerHTML = opts.map(([k, label]) =>
    `<button type="button" data-status="${k}" aria-pressed="${state.status === k}">${label} <span class="n">${c[k]}</span></button>`).join('');
}

const tagCounts = (list) => {
  const counts = new Map();
  list.forEach((p) => p.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
function renderTags() {
  const sorted = tagCounts(shownPapers());
  const have = new Set(sorted.map(([t]) => t));
  state.tags.forEach((t) => { if (!have.has(t)) state.tags.delete(t); });
  el.tagbar.innerHTML = sorted.map(([t, n]) =>
    `<button type="button" class="tag-chip" data-tag="${esc(t)}" aria-pressed="${state.tags.has(t)}">#${esc(t)} ${n}</button>`).join('');
  /* The form's tag suggestions are always the member's own tags. */
  $('#tag-suggest').innerHTML = tagCounts(state.papers).map(([t]) => `<option value="${esc(t)}"></option>`).join('');
}

export function renderGrid() {
  const list = shownPapers();
  const ro = state.mode === 'public';
  const { items, terms } = filterAndSort(list, state);
  const re = highlighter(terms);
  const rank = new Map(list.slice().sort((a, b) => a.createdAt - b.createdAt).map((p, i) => [p.id, i + 1]));
  el.grid.className = 'grid' + (state.view === 'list' ? ' list' : '');
  el.grid.innerHTML = items.map((p) => cardHtml(p, re, terms, rank.get(p.id), { readOnly: ro })).join('');
  el.grid.hidden = items.length === 0;

  const filtered = terms.length || state.status !== 'all' || state.tags.size;
  el.info.textContent = !list.length ? '' : filtered
    ? `${items.length} of ${list.length} papers match${state.q.trim() ? ` “${trunc(state.q.trim(), 40)}”` : ''}`
    : `${items.length} ${items.length === 1 ? 'paper' : 'papers'}`;

  el.empty.hidden = items.length > 0;
  if (!items.length) {
    if (!list.length && ro) {
      el.empty.innerHTML = '<h2>No public papers yet.</h2><p>When a member makes a paper public, it shows up here for anyone to read.</p>';
    } else if (!list.length) {
      el.empty.innerHTML = `<h2>Your journal has no papers yet.</h2><p>Add your first one. A title and an image are enough, then fill in the five sections on the paper page.</p>
        <div class="row"><button class="btn primary" type="button" data-empty="add">Add paper</button></div>`;
    } else {
      const q = state.q.trim();
      el.empty.innerHTML = `<h2>Nothing matches${q ? ` “${esc(trunc(q, 40))}”` : ''}.</h2>
        <p>Try a shorter word, another language, or loosen the filters above.</p>
        <div class="row">
          <button class="btn" type="button" data-empty="reset">Clear search and filters</button>
          ${q && !ro ? `<button class="btn primary" type="button" data-empty="add-q">Add “${esc(trunc(q, 24))}” as a new paper</button>` : ''}
        </div>`;
    }
  }
  el.clearQ.hidden = !state.q;
  $('#view-grid').setAttribute('aria-pressed', String(state.view === 'grid'));
  $('#view-list').setAttribute('aria-pressed', String(state.view === 'list'));
}

export function renderAll() {
  renderStats(); renderSeg(); renderTags(); renderGrid();
  if (state.openId) { const p = getPaper(state.openId); if (p) renderPaperHead(p); }
}

let qTimer = 0;

/**
 * Switches the catalog between the member's papers ('mine') and the public library ('public').
 * A switch clears the search and filters (they belong to the other list) and renders again.
 */
export function setMode(m) {
  if (state.mode === m) return;
  state.mode = m;
  state.q = ''; el.q.value = ''; state.status = 'all'; state.tags.clear();
  if (!state.sortTouched) { state.sort = 'recent'; el.sort.value = state.sort; }
  document.body.classList.toggle('read-only', m === 'public');
  $('#cat-title').textContent = m === 'public' ? 'The library' : 'Paper reading journal';
  renderAll();
}

export function setQuery(v) {
  el.q.value = v; state.q = v;
  if (!state.sortTouched) { state.sort = v.trim() ? 'relevance' : 'recent'; el.sort.value = state.sort; }
  renderGrid();
}

/* ---------- delete with undo (to the Trash in API mode; local mode has no Trash) ---------- */
export async function removePaper(id) {
  const p = getPaper(id);
  if (!p) return;
  if (state.openId === id) cancelPendingSave();
  await moveToTrash(Store, p, {
    toast,
    label: usingApi ? 'moved to Trash' : 'deleted',
    refresh: async () => {
      await reload();
      if (state.openId === id) location.hash = 'papers'; else renderAll();
    },
  });
}

/** Search box, filters, view toggle, card actions, and the narrow-screen placeholder. */
export function initCatalog() {
  el.q.addEventListener('input', () => {
    state.q = el.q.value;
    if (!state.sortTouched) { state.sort = state.q.trim() ? 'relevance' : 'recent'; el.sort.value = state.sort; }
    clearTimeout(qTimer);
    qTimer = setTimeout(renderGrid, 60);
  });
  el.q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.q.value) { e.preventDefault(); setQuery(''); } });
  el.clearQ.addEventListener('click', () => { setQuery(''); el.q.focus(); });

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
    if (state.mode === 'public') { location.hash = publicHash({ owner: card.dataset.owner, id }); return; }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'edit') return openForm(getPaper(id));
    if (act && act.dataset.act === 'delete') return removePaper(id);
    location.hash = 'paper-' + id;
  });

  el.empty.addEventListener('click', (e) => {
    const b = e.target.closest('[data-empty]');
    if (!b) return;
    if (b.dataset.empty === 'add' && state.mode !== 'public') openForm();
    if (b.dataset.empty === 'add-q') openForm(null, { title: state.q.trim() });
    if (b.dataset.empty === 'reset') { state.status = 'all'; state.tags.clear(); setQuery(''); renderSeg(); renderTags(); }
  });

  $('#btn-clear-sample').addEventListener('click', async () => {
    await Store.removeWhere((p) => p.sample);
    await reload(); renderAll();
    toast('Sample data removed');
  });

  /* Shorter placeholder on narrow screens so it is not cut off. */
  const narrow = window.matchMedia('(max-width: 640px)');
  const setPlaceholder = () => { el.q.placeholder = narrow.matches ? 'Title, keyword, or note' : 'Search titles, keywords, or any bit of your notes you remember'; };
  setPlaceholder();
  if (narrow.addEventListener) narrow.addEventListener('change', setPlaceholder);
  el.sort.value = state.sort;
}
