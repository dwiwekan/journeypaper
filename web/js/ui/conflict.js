// The dialog shown when an autosave finds the paper changed in another tab or device.
import { $ } from '../util.js';
import { openDialog } from './dialog.js';

/** current: the server's copy. Resolves 'reload' (take theirs) or 'keep' (save mine over it).
 *  Closing the dialog any other way keeps what is on screen, so nothing visible is lost. */
export function openConflict(current) {
  const d = $('#dlg-conflict');
  const when = current && current.updatedAt ? new Date(current.updatedAt).toLocaleString() : '';
  $('#conflict-when').textContent = when ? `The other copy was saved ${when}.` : '';
  d.returnValue = '';
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'reload' ? 'reload' : 'keep'), { once: true });
    if (!d.open) openDialog(d);
  });
}

/** Escape does not dismiss the conflict dialog: the user picks one of the two buttons. */
export function initConflict() {
  $('#dlg-conflict').addEventListener('cancel', (e) => e.preventDefault());
}
