// The Trash (API mode): deleting a paper moves it here for 30 days. Restore brings it back;
// Delete forever removes it for good once the member types its exact title.
import { $, esc, trunc } from '../util.js';
import { Store } from '../data/active-store.js';
import { ApiError } from '../data/api.js';
import { reload } from './state.js';
import { toast } from './toast.js';
import { renderAll } from './catalog.js';
import { route } from './paper-page.js';
import { showView } from './views.js';
import { openDialog } from './dialog.js';

const KEEP_DAYS = 30; // the server purges Trash older than this
const DAY_MS = 86400000;

/** The typed title must be the paper's title exactly: same case, same spaces, Unicode NFC. */
export const titleMatches = (typed, title) => typed.normalize('NFC') === title.normalize('NFC');

/** Deletes p (to the Trash in API mode), then a toast with Undo. label says where it went. */
export async function moveToTrash(store, p, { toast: say, refresh, label = 'moved to Trash' }) {
  await store.remove(p.id);
  await refresh();
  say(`“${trunc(p.title, 38)}” ${label}`, {
    label: 'Undo',
    fn: async () => { await store.restore(p); await refresh(); },
  });
}

/* The paper left the Trash elsewhere (restored, deleted forever, or purged). */
const gone = (e) => e instanceof ApiError && (e.status === 404 || e.status === 409);

/** Brings a Trash card back to the member's papers. Returns true when it did. */
export async function restoreFromTrash(store, card, { toast: say, refresh }) {
  try { await store.restore(card); } catch (e) {
    say(gone(e) ? 'This paper is no longer in Trash.' : e.message || 'Could not restore. Try again.');
    if (gone(e)) await refresh();
    return false;
  }
  await refresh();
  say(`“${trunc(card.title, 38)}” restored`);
  return true;
}

/** Deletes a Trash card for good; the server checks the typed title again. Returns true when it did. */
export async function deleteForever(store, card, typed, { toast: say, refresh }) {
  try { await store.deleteForever(card.id, typed); } catch (e) {
    const mismatch = e instanceof ApiError && e.status === 400;
    say(mismatch ? 'The title does not match.' : gone(e) ? 'This paper is no longer in Trash.' : e.message || 'Could not delete. Try again.');
    if (mismatch || gone(e)) await refresh();
    return false;
  }
  await refresh();
  say(`“${trunc(card.title, 38)}” deleted forever`);
  return true;
}

/* ---------- the Trash screen ---------- */
const tr = { list: $('#trash-list'), count: $('#trash-count'), dlg: $('#dlg-forever'), form: $('#fv-form'), title: $('#fv-title'), input: $('#fv-input'), go: $('#fv-go') };
let cards = [];
let seq = 0; // the latest Trash load; an older one that finishes later is dropped
let pending = null; // the card in the Delete forever dialog

function rowHtml(c) {
  const left = Math.max(0, KEEP_DAYS - Math.floor((Date.now() - c.deletedAt) / DAY_MS));
  const when = c.deletedAt ? `Deleted ${new Date(c.deletedAt).toLocaleDateString()} · ${left === 1 ? '1 day' : left + ' days'} left` : '';
  const meta = [c.authors, [c.venue, c.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return `<li class="trash-row" data-id="${esc(c.id)}">
    <div class="trash-text"><b>${esc(c.title)}</b>${meta ? `<span class="muted">${esc(meta)}</span>` : ''}<span class="dim mono">${esc(when)}</span></div>
    <span class="row"><button class="btn small" type="button" data-act="restore">Restore</button><button class="btn small quiet danger" type="button" data-act="forever">Delete forever</button></span>
  </li>`;
}

function renderTrash() {
  const n = cards.length;
  tr.count.textContent = n ? `${n} ${n === 1 ? 'paper' : 'papers'} · kept for ${KEEP_DAYS} days after deleting` : '';
  tr.list.innerHTML = n
    ? `<ul class="trash-list">${cards.slice().sort((a, b) => b.deletedAt - a.deletedAt).map(rowHtml).join('')}</ul>`
    : `<div class="empty"><h2>Trash is empty</h2><p>Deleted papers stay here for ${KEEP_DAYS} days, then they are gone for good.</p>
      <div class="row"><a class="btn" href="#papers">Back to my papers</a></div></div>`;
}

async function loadTrash() {
  const mine = ++seq;
  let list;
  try { list = await Store.listTrash(); } catch (e) {
    if (mine === seq) tr.list.innerHTML = `<p class="dim">Could not load the Trash. ${esc(e.message || '')}</p>`;
    return;
  }
  if (mine !== seq) return;
  cards = list;
  renderTrash();
}

/* After a restore or delete: the member's papers and the Trash both changed. */
async function refresh() {
  await reload();
  renderAll();
  await loadTrash();
}

/** Router handler for #trash. */
export async function showTrash() {
  await route(null);
  showView('trash');
  window.scrollTo(0, 0);
  document.title = 'Trash · JourneyPaper';
  tr.count.textContent = '';
  tr.list.innerHTML = '<p class="dim">Loading…</p>';
  await loadTrash();
}

function openForever(card) {
  pending = card;
  tr.title.textContent = card.title;
  tr.input.value = '';
  tr.go.disabled = !titleMatches('', card.title);
  openDialog(tr.dlg);
  tr.input.focus();
}

/** Restore and Delete forever buttons, and the typed-title check in the dialog. */
export function initTrash() {
  tr.list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    const row = e.target.closest('[data-id]');
    const card = b && row && cards.find((c) => c.id === row.dataset.id);
    if (!card) return;
    if (b.dataset.act === 'forever') { openForever(card); return; }
    b.disabled = true;
    await restoreFromTrash(Store, card, { toast, refresh });
    b.disabled = false;
  });
  tr.input.addEventListener('input', () => { tr.go.disabled = !pending || !titleMatches(tr.input.value, pending.title); });
  tr.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pending || !titleMatches(tr.input.value, pending.title)) return;
    const card = pending;
    tr.go.disabled = true;
    await deleteForever(Store, card, tr.input.value, { toast, refresh });
    pending = null;
    tr.dlg.close();
  });
  tr.dlg.addEventListener('close', () => { pending = null; tr.input.value = ''; });
}
