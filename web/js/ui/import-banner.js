// A one-time offer to copy the papers saved in this browser (IndexedDB) into the account.
import { $ } from '../util.js';
import { api } from '../data/api.js';
import { readLocal } from '../data/store.js';
import { Store } from '../data/active-store.js';
import { state, reload } from './state.js';
import { renderAll } from './catalog.js';
import { toast } from './toast.js';

const LATER_KEY = 'jp:import-later';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Shows the banner when this browser has papers the account does not. */
export async function initImportBanner() {
  const s = api.session();
  const uid = s && s.user && s.user.id;
  if (!uid) return;
  const flag = 'jp:imported:' + uid;
  try { if (localStorage.getItem(flag) || sessionStorage.getItem(LATER_KEY)) return; } catch (e) { return; }
  const have = new Set(state.papers.map((p) => p.id));
  const local = (await readLocal()).filter((p) => !have.has(p.id));
  if (!local.length) return;

  const box = $('#import-banner'), go = $('#btn-import-local'), later = $('#btn-import-later');
  $('#import-text').textContent = `Import ${plural(local.length, 'paper', 'papers')} saved in this browser`;
  box.hidden = false;
  later.addEventListener('click', () => {
    box.hidden = true;
    try { sessionStorage.setItem(LATER_KEY, '1'); } catch (e) { /* hidden until reload then */ }
  });
  go.addEventListener('click', async () => {
    go.disabled = true; later.disabled = true;
    try {
      const r = await Store.merge(local);
      await reload(); renderAll();
      try { localStorage.setItem(flag, String(Date.now())); } catch (e) { /* offered again next time */ }
      box.hidden = true;
      const bad = r.errors.length ? ` ${plural(r.errors.length, 'paper', 'papers')} could not be imported.` : '';
      toast(`Imported ${plural(r.created, 'new paper', 'new papers')}, updated ${r.updated}, unchanged ${r.skipped}.${bad}`);
    } catch (e) {
      toast(e.message || 'Import failed. Try again.');
    } finally { go.disabled = false; later.disabled = false; }
  });
}
