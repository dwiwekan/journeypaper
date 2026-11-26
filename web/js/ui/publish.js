// Public or private (API mode only): the switch on a paper page, and Make all public in the
// Data dialog. A public paper shows in the library, where anyone with the link can read it.
import { $ } from '../util.js';
import { Store, usingApi } from '../data/active-store.js';
import { state, reload, getPaper, replacePaper } from './state.js';
import { toast } from './toast.js';
import { openDialog } from './dialog.js';
import { renderAll } from './catalog.js';
import { flushSave, renderPaperHead } from './paper-page.js';

/** Flips p between public and private. Returns the saved card (null if it was deleted). */
export const togglePublic = (store, p) => store.update(p.id, { public: !p.public });

/** How many of the member's papers Make all public would change: not samples, not already public. */
export const publishAllCount = (papers) => papers.filter((p) => !p.sample && !p.public).length;

/** The question Make all public asks, or why the button is off. */
export function publishAllText(n) {
  if (!n) return 'All your papers are already public';
  return `Make ${n} ${n === 1 ? 'paper' : 'papers'} public? Anyone with the link can read them.`;
}

/** The #pg-public switch for the open paper; hidden in local mode and in the library. */
export function renderPublicSwitch(p) {
  const sw = $('#pg-public');
  sw.hidden = !usingApi || state.mode === 'public';
  sw.setAttribute('aria-pressed', String(!!p.public));
  sw.querySelector('span').textContent = p.public ? 'Public' : 'Private';
  sw.title = p.public ? 'In the library: anyone with the link can read it. Click to make it private.' : 'Only you can see it. Click to make it public.';
}

/** The Make all public button in the Data dialog, set from the member's papers. */
export function refreshPublishAll() {
  const b = $('#btn-publish-all');
  const n = publishAllCount(state.papers);
  b.hidden = !usingApi;
  b.disabled = !n;
  b.textContent = n ? 'Make all public' : publishAllText(0);
}

/** The switch, and Make all public with its confirmation. */
export function initPublish() {
  const sw = $('#pg-public');
  sw.addEventListener('click', async () => {
    const p = getPaper(state.openId);
    if (!p || sw.disabled) return;
    sw.disabled = true;
    try {
      /* Notes first, so the switch and an autosave never send the same revision. */
      await flushSave();
      const saved = await togglePublic(Store, p);
      if (saved) {
        replacePaper(saved);
        if (state.openId === saved.id) renderPaperHead(saved);
        toast(saved.public ? 'Public: it shows in the library now.' : 'Private: only you can see it.');
      }
    } catch (e) { toast(e.message || 'Could not save.'); }
    sw.disabled = false;
  });

  $('#btn-publish-all').addEventListener('click', () => {
    const n = publishAllCount(state.papers);
    if (!n) return;
    $('#pa-text').textContent = publishAllText(n);
    openDialog($('#dlg-publish-all'));
  });
  $('#pa-go').addEventListener('click', async () => {
    $('#dlg-publish-all').close();
    let n;
    try {
      await flushSave();
      n = await Store.publishAll();
      await reload();
      /* Publishing bumps every revision; load the open paper again so its next autosave does not conflict. */
      if (state.openId) await Store.get(state.openId);
    } catch (e) { toast(e.message || 'Could not make the papers public.'); return; }
    renderAll();
    const open = getPaper(state.openId);
    if (open) renderPaperHead(open);
    refreshPublishAll();
    toast(n === 1 ? '1 paper is public now.' : `${n} papers are public now.`);
  });
}
