// Small shared helpers: DOM lookup, string helpers, ids, and saved preferences.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
export const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const pad = (n) => String(n).padStart(2, '0');
export const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const Prefs = {
  get(k, d) { try { const v = localStorage.getItem('jp:' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('jp:' + k, v); } catch (e) { /* ignore */ } },
};
