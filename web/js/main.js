// Start-up: wire every screen, load the member's papers (local mode, or signed in), then route
// the URL. Order matters: listeners first, data second, so the first render already responds.
// A visitor (API on, signed out) loads nothing here: no /papers call and no auth call.
import { Store, usingApi } from './data/active-store.js';
import { ApiError, AuthError } from './data/api.js';
import { reload } from './ui/state.js';
import { toast } from './ui/toast.js';
import { initTheme } from './ui/theme.js';
import { initDialogs } from './ui/dialog.js';
import { initCoverFallback } from './ui/cover.js';
import { initCatalog, renderAll, setMode } from './ui/catalog.js';
import { initPaperPage, route } from './ui/paper-page.js';
import { initPaperForm } from './ui/paper-form.js';
import { initDataDialog } from './ui/data-dialog.js';
import { initShortcuts } from './ui/shortcuts.js';
import { initConflict } from './ui/conflict.js';
import { initAuth, isSignedIn, showSignIn } from './ui/auth.js';
import { initImportBanner } from './ui/import-banner.js';
import { initRouter } from './ui/router.js';
import { showLibrary, showPublicPaper, initLibrary, leaveLibrary } from './ui/library.js';
import { initHome } from './ui/home.js';
import { initTrash, showTrash } from './ui/trash.js';
import { initPublish } from './ui/publish.js';
import { showView } from './ui/views.js';

initTheme();
initDialogs();
initCoverFallback();
initCatalog();
initPaperPage();
initPaperForm();
initDataDialog();
initShortcuts();
initConflict();
initLibrary();
initHome();
initTrash();
initPublish();

/* KaTeX loads async from the CDN; tell the editor and the library when it is ready.
   (No onload attribute in index.html: the CSP allows no inline handlers.) */
const katexTag = document.getElementById('katex-js');
if (!window.katex && katexTag) katexTag.addEventListener('load', () => window.dispatchEvent(new Event('katex-ready')), { once: true });

/* A failed API call that nothing else handled still tells the user. A session that ended
   already shows the sign-in screen, so it needs no toast. */
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason instanceof AuthError) { e.preventDefault(); return; }
  if (e.reason instanceof ApiError) { e.preventDefault(); toast(e.reason.message); }
});

let inited = false;
let banner = false;
async function load() {
  try {
    await reload();
  } catch (e) {
    if (e instanceof AuthError) return; // the sign-in screen is up; signing in loads again
    toast(`Could not load your papers. ${e.message || ''}`.trim(), { label: 'Retry', fn: () => load().then(() => initRouter()) });
    return;
  }
  renderAll();
  if (usingApi && !banner) { banner = true; initImportBanner().catch(() => { /* the banner is optional */ }); }
}
/** The member's papers: the store once, then the list. Also runs after every sign-in. */
async function loadMine() {
  if (!inited) { inited = true; await Store.init({ warn: toast }); }
  await load();
}

/* Member screens show the member's own papers, so they leave the read-only library first. */
const mine = (r) => { leaveLibrary(); setMode('mine'); return route(r); };
const handlers = {
  home: async () => { leaveLibrary(); await route(null); showView('home'); window.scrollTo(0, 0); },
  library: (r) => showLibrary(r.q),
  'public-paper': (r) => showPublicPaper(r.owner, r.id),
  papers: mine,
  paper: mine,
  trash: () => { leaveLibrary(); setMode('mine'); return showTrash(); },
  signin: () => { leaveLibrary(); showSignIn(); },
};

if (usingApi) initAuth({ onSignedIn: loadMine });
if (!usingApi || isSignedIn()) await loadMine();
initRouter(handlers, () => ({ signedIn: usingApi && isSignedIn(), apiOn: usingApi }));
