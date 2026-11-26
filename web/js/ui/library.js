// The public library, for visitors and members: the read-only catalog of public papers and the
// read-only paper page. Nothing here can change a paper; "Edit" on your own paper links to the
// member page (#paper-<id>).
import { $, esc } from '../util.js';
import { Store } from '../data/active-store.js';
import { api } from '../data/api.js';
import { blocksHtml, renderMath, viewHeadings } from '../editor/view.js';
import { state } from './state.js';
import { toast } from './toast.js';
import { renderAll, setMode, setQuery } from './catalog.js';
import { route, renderPaperHead, setPageEditable, tocFromView } from './paper-page.js';
import { showView } from './views.js';
import { openLightbox } from './dialog.js';

let seq = 0; // the latest library call; a list or paper that arrives after the user moved on is dropped

/** { paper } for a public paper, { missing: true } when it is gone or private. Other errors throw. */
export async function loadPublicPaper(store, owner, id) {
  const paper = await store.getPublic(owner, id);
  return paper ? { paper } : { missing: true };
}

/** Router handler for #library and #library?q=… */
export async function showLibrary(q = '') {
  const mine = ++seq;
  await route(null);
  setMode('public');
  setQuery(q || '');
  showView('catalog');
  let cards;
  try { cards = await Store.listPublic(); } catch (e) {
    if (mine === seq) toast(`Could not load the library. ${e.message || ''}`.trim());
    return;
  }
  if (mine !== seq || state.mode !== 'public') return;
  state.publicPapers = cards;
  renderAll();
}

function notAvailable(body) {
  $('#pg-cover').parentElement.hidden = true;
  $('#pg-meta').textContent = '';
  $('#pg-title').textContent = '';
  $('#pg-props').innerHTML = '';
  $('#pg-tldr').hidden = true;
  body.innerHTML = `<div class="empty"><h2>This paper is not available.</h2>
    <p>It may have been made private or deleted.</p>
    <div class="row"><a class="btn" href="#library">Back to the library</a></div></div>`;
  document.title = 'Not available · JourneyPaper';
  tocFromView([]);
}

/** Router handler for #library/<owner>/<id>: the read-only paper page. */
export async function showPublicPaper(owner, id) {
  const mine = ++seq;
  await route(null);
  setMode('public');
  setPageEditable(false);
  showView('paper');
  window.scrollTo(0, 0);
  const body = $('#pg-body');
  const own = $('#pg-edit-own');
  own.hidden = true;
  const card = state.publicPapers.find((p) => p.id === id && p.owner === owner);
  if (card) renderPaperHead(card);
  body.innerHTML = '<p class="dim">Loading…</p>';
  tocFromView([]);

  let r;
  try { r = await loadPublicPaper(Store, owner, id); } catch (e) {
    if (mine === seq) { body.innerHTML = `<p class="dim">Could not load this paper. ${esc(e.message || '')}</p>`; }
    return;
  }
  if (mine !== seq) return; // the user went somewhere else meanwhile
  if (r.missing) { notAvailable(body); return; }
  renderPaperHead(r.paper);
  body.innerHTML = blocksHtml(r.paper.content);
  if (window.katex) renderMath(body);
  else window.addEventListener('katex-ready', () => { if (mine === seq) renderMath(body); }, { once: true });
  /* Your own paper: a link to the member page, where it can be edited. */
  own.href = '#paper-' + encodeURIComponent(id);
  own.hidden = api.userId() !== owner;
  tocFromView(viewHeadings(body));
}

/** Read-only page clicks: images open in the lightbox. */
export function initLibrary() {
  $('#pg-body').addEventListener('click', (e) => {
    const img = e.target.closest('.fig img');
    if (img) openLightbox(img.src, img.alt);
  });
}

/** Leaving the library (any member route) drops a list or paper still loading. */
export function leaveLibrary() { seq += 1; }
