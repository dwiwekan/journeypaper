// App-wide constants. Storage names must not change, or existing browser data is lost.

export const STATUS = { want: 'To read', reading: 'Reading', done: 'Done' };
export const SECTIONS = [['intro', 'Introduction'], ['related', 'Related Work'], ['method', 'Method'], ['results', 'Experiment Results'], ['concl', 'Conclusion']];

export const DB_NAME = 'jurnal-paper'; // old name kept on purpose: renaming it would hide every saved paper
export const STORE_NAME = 'papers';
export const META_ID = '__meta__';
/** Older versions kept papers in localStorage under this key. */
export const LEGACY_KEY = 'jp:papers:v1';
/** Bump when SEED changes so untouched sample papers are replaced with the new version. */
export const SEED_V = 2;
export const AUTOSAVE_MS = 800;
export const MAX_TAGS = 12;

/* ---------- online storage (Supabase Auth + our API) ---------- */
export const SUPABASE_URL = 'https://xxgdylyvbbohjpibwucv.supabase.co';
/** The publishable key is meant to be public. Our tables are not exposed to it. */
export const SUPABASE_KEY = 'sb_publishable_6HP5f3IvVggVr7rB1GffOg_bUZ9oARA';
export const SESSION_KEY = 'jp:session';
export const PROD_HOSTS = ['dwiwekan.github.io'];
/** The Cloud Run URL, filled in when the API is deployed. */
export const PROD_API = 'https://journeypaper-api-958305036908.asia-northeast1.run.app';
/* On the production site use PROD_API. Elsewhere the API is off unless localStorage 'jp:api'
   names one, for example http://localhost:8080 while running `make dev`. */
function pickApi() {
  try {
    const host = globalThis.location ? globalThis.location.hostname : '';
    if (PROD_HOSTS.includes(host)) return PROD_API;
    return (globalThis.localStorage && globalThis.localStorage.getItem('jp:api')) || '';
  } catch (e) { return ''; }
}
export const API_BASE = pickApi();
