// Modal dialogs and the image lightbox.
import { $, $$ } from '../util.js';

const root = document.documentElement;

/* ---------- shared dialog behavior ---------- */
export function lockScroll() { root.classList.add('locked'); }
export function unlockScroll() { if (!$$('dialog[open]').length) root.classList.remove('locked'); }

export function openDialog(d) { d.showModal(); lockScroll(); }

export function openLightbox(src, caption) {
  $('#lb-img').src = src;
  $('#lb-cap').textContent = caption || '';
  $('#lb-cap').hidden = !caption;
  openDialog($('#dlg-img'));
}

/** Backdrop click and [data-close] buttons close any dialog, except [data-strict] ones. */
export function initDialogs() {
  $$('dialog').forEach((d) => {
    d.addEventListener('close', unlockScroll);
    let downOnBackdrop = false;
    d.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === d; });
    d.addEventListener('click', (e) => { if (e.target === d && downOnBackdrop && !('strict' in d.dataset)) d.close(); });
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { const d = c.closest('dialog'); if (d) d.close(); }
  });
}
