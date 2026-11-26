// The only module that reads or writes stored papers (IndexedDB, plus the old localStorage key).
// data/api-store.js has the same Store interface for papers kept online.
import { DB_NAME, STORE_NAME, META_ID, LEGACY_KEY, SEED_V } from '../config.js';
import { normalizePaper } from './paper.js';
import { SEED } from './seed.js';

/* ---------- Store: IndexedDB with an in-memory fallback ---------- */
let db = null;
let warned = false;
let warn = () => {};
const cache = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no idb'));
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}
function writeTx(fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readwrite');
    fn(t.objectStore(STORE_NAME));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('abort'));
  });
}
async function persist(puts, dels) {
  if (!db) return false;
  try { await writeTx((s) => { (puts || []).forEach((p) => s.put(p)); (dels || []).forEach((id) => s.delete(id)); }); return true; } catch (e) {
    if (!warned) { warned = true; warn('Could not save to the browser. Storage may be full, so recent changes could be lost when this tab closes.'); }
    return false;
  }
}

export const Store = {
  /** warn(message) shows storage problems to the user; the UI passes its toast. */
  async init(opts = {}) {
    if (typeof opts.warn === 'function') warn = opts.warn;
    try { db = await openDb(); } catch (e) {
      db = null;
      warn('Browser storage is unavailable. Data only lasts while this tab is open.');
    }
    let seeded = false, seedV = 0;
    if (db) {
      const rows = await new Promise((resolve) => {
        const r = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      });
      rows.forEach((x) => { if (x.id === META_ID) { seeded = !!x.seeded; seedV = Number(x.seedV) || 0; } else { const p = normalizePaper(x); cache.set(p.id, p); } });
    }
    if (!seeded) {
      /* Older versions stored data in localStorage. Keep the user's own papers and replace sample data with the current set. */
      let legacy = null;
      try { const raw = localStorage.getItem(LEGACY_KEY); if (raw) legacy = JSON.parse(raw); } catch (e) { legacy = null; }
      const puts = [];
      if (Array.isArray(legacy)) {
        const mine = legacy.filter((r) => r && typeof r === 'object' && !r.sample && String(r.title || '').trim());
        mine.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
        if (legacy.some((r) => r && r.sample) || !mine.length) SEED.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
      } else if (!cache.size) {
        SEED.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
      }
      puts.push({ id: META_ID, seeded: true, seedV: SEED_V });
      if (await persist(puts)) { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ } }
    } else if (seedV < SEED_V) {
      /* Replace sample papers the user never touched. Editing a sample clears its flag, so edited ones stay. */
      const old = Array.from(cache.values()).filter((p) => p.sample).map((p) => p.id);
      const puts = [];
      if (old.length) {
        old.forEach((id) => cache.delete(id));
        SEED.forEach((r) => { const p = normalizePaper(r); cache.set(p.id, p); puts.push(p); });
      }
      puts.push({ id: META_ID, seeded: true, seedV: SEED_V });
      await persist(puts, old.filter((id) => !cache.has(id)));
    }
  },
  async list() { return Array.from(cache.values()); },
  async get(id) { return cache.get(id) || null; },
  async exportAll() { return this.list(); },
  async create(data) {
    const p = normalizePaper({ ...data, id: undefined, content: undefined, createdAt: Date.now() });
    cache.set(p.id, p); await persist([p]); return p;
  },
  async update(id, patch) {
    const cur = cache.get(id);
    if (!cur) return null;
    const p = normalizePaper({ ...cur, ...patch, id, sample: false, updatedAt: Date.now() });
    cache.set(id, p); await persist([p]); return p;
  },
  async remove(id) { cache.delete(id); await persist([], [id]); },
  async restore(p) { cache.set(p.id, p); await persist([p]); },
  async removeWhere(fn) { const ids = Array.from(cache.values()).filter(fn).map((p) => p.id); ids.forEach((id) => cache.delete(id)); await persist([], ids); },
  async merge(items) { const ps = items.map((r) => normalizePaper(r)); ps.forEach((p) => cache.set(p.id, p)); await persist(ps); },
  async clear() { const ids = Array.from(cache.keys()); cache.clear(); await persist([], ids); },
};

/** Papers the user saved in this browser (not samples), read once for importing. Never seeds or writes. */
export async function readLocal() {
  let local;
  try { local = await openDb(); } catch (e) { return []; }
  try {
    const rows = await new Promise((resolve) => {
      const r = local.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    });
    return rows.filter((x) => x && x.id !== META_ID && !x.sample).map((x) => normalizePaper(x));
  } finally { if (local !== db) local.close(); }
}
