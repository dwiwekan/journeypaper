// The Data dialog: export, import, and wipe.
import { $ } from '../util.js';
import { Store } from '../data/active-store.js';
import { state, reload } from './state.js';
import { openDialog } from './dialog.js';
import { renderAll } from './catalog.js';
import { flushSave, cancelPendingSave } from './paper-page.js';
import { refreshPublishAll } from './publish.js';

/* ---------- data: export, import, wipe ---------- */
const dd = { dlg: $('#dlg-data'), ta: $('#data-json'), msg: $('#data-msg'), wipe: $('#btn-wipe') };
let wipeTimer = 0;
function dataMsg(t, bad) { dd.msg.textContent = t; dd.msg.className = 'msg' + (bad ? ' bad' : ''); }
function resetWipe() { clearTimeout(wipeTimer); dd.wipe.textContent = 'Delete everything'; dd.wipe.dataset.armed = ''; }

/** Fills the box with every paper, notes included (the catalog list may hold cards only). */
async function fillExport() {
  let all;
  try { all = await Store.exportAll(); } catch (e) { dataMsg(e.message || 'Could not load the backup.', true); return false; }
  dd.ta.value = JSON.stringify(all, null, 2);
  const kb = Math.round(dd.ta.value.length / 1024);
  dataMsg(`${all.length} ${all.length === 1 ? 'paper' : 'papers'} ready to back up (${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}). Images are included in the JSON.`);
  return true;
}

/** Back up, copy, download, import, and delete-everything buttons. */
export function initDataDialog() {
  $('#btn-data').addEventListener('click', async () => {
    await flushSave();
    dd.ta.value = '';
    dataMsg('Preparing the backup…');
    resetWipe();
    refreshPublishAll();
    openDialog(dd.dlg);
    await fillExport();
  });
  $('#btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(dd.ta.value); dataMsg('Copied to clipboard.'); }
    catch (e) { dd.ta.select(); dataMsg('The browser blocked clipboard access. The text is selected, so press Ctrl+C.', true); }
  });
  $('#btn-download').addEventListener('click', () => {
    const blob = new Blob([dd.ta.value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'journeypaper-' + new Date().toISOString().slice(0, 10) + '.json';
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
    dataMsg('Importing…');
    let r;
    try { r = await Store.merge(ok); } catch (e) { return dataMsg(e.message || 'Import failed. Try again.', true); }
    await reload(); renderAll(); refreshPublishAll();
    if (!(await fillExport())) return;
    if (r && r.errors && r.errors.length) return dataMsg(`Imported ${ok.length - r.errors.length} of ${ok.length} papers. ${r.errors.length} could not be imported: ${r.errors.slice(0, 3).map((x) => x.id || '?').join(', ')}.`, true);
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
    if (state.openId) cancelPendingSave();
    try { await Store.clear(); } catch (e) { return dataMsg(e.message || 'Could not delete. Try again.', true); }
    await reload();
    if (state.openId) location.hash = 'papers'; else renderAll();
    dd.ta.value = '[]';
    dataMsg('All papers deleted.');
  });
}
