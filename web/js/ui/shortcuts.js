// Keyboard shortcuts on the catalog screen.
import { $, $$ } from '../util.js';
import { state } from './state.js';
import { el } from './catalog.js';
import { openForm } from './paper-form.js';

/** Ctrl/Cmd+K or / focuses search; N adds a paper (members only, not in the public library). */
export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ($('#view-catalog').hidden || $$('dialog[open]').length) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); el.q.focus(); el.q.select(); }
    else if (e.key === 'n' && !typing && state.mode !== 'public' && !document.body.classList.contains('visitor') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openForm(); }
  });
}
