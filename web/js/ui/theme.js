// Light and dark theme.
import { $, Prefs } from '../util.js';
import { ICON } from './icons.js';

/* ---------- theme ---------- */
const root = document.documentElement;
const themeBtn = $('#theme-toggle');
function applyTheme(t) {
  root.setAttribute('data-theme', t);
  themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  themeBtn.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
}

/** Applies the saved or system theme and wires the toggle button. */
export function initTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(Prefs.get('theme', null) || root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light'));
  if (mq.addEventListener) mq.addEventListener('change', (e) => { if (!Prefs.get('theme', null)) applyTheme(e.matches ? 'dark' : 'light'); });
  themeBtn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.classList.add('theme-anim');
    applyTheme(next);
    Prefs.set('theme', next);
    setTimeout(() => root.classList.remove('theme-anim'), 400);
  });
}
