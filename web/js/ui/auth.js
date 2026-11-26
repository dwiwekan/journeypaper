// The sign-in screen, the header's account buttons, and what happens when a session ends.
// Only used when the app talks to the API. Visitors are never asked to sign in: the Sign in
// button (or a session that ended on a member screen) leads to #signin.
import { $, $$ } from '../util.js';
import { api, ApiError, AuthError } from '../data/api.js';
import { toast } from './toast.js';
import { flushSave } from './paper-page.js';
import { showView } from './views.js';
import { initRouter, parseRoute, resolveRoute, routeHash, isMemberRoute } from './router.js';

let signedInAs = null;
let next = null; // the hash (without '#') a sign-in goes to; null means #papers
let afterSignIn = async () => {}; // main.js passes one that loads the member's papers
const userId = (s) => (s && s.user && s.user.id) || null;

/** From the stored session; no network call. */
export const isSignedIn = () => !!api.session();

/* Visitors: Library and Sign in. Members: Library, Papers, Trash, Sign out, Data and Add. */
function renderHeader() {
  const s = isSignedIn();
  document.body.classList.toggle('visitor', !s);
  $('#nav-library').hidden = false;
  $('#nav-papers').hidden = !s;
  $('#nav-trash').hidden = !s;
  $('#btn-signin').hidden = s;
  $('#btn-signout').hidden = !s;
  $('#btn-add').hidden = !s;
  $('#btn-data').hidden = !s;
}

/** Router handler for #signin. nextHash (without '#'), when given, is where signing in leads. */
export function showSignIn(nextHash) {
  if (nextHash !== undefined) next = nextHash || null;
  $$('dialog[open]').forEach((d) => d.close());
  showView('signin');
  $('#si-err').hidden = true;
  $('#si-pass').value = '';
  $('#si-email').focus();
}

async function signedIn(s) {
  const prev = signedInAs;
  signedInAs = userId(s);
  /* Signed in again after the session ended. Another account must not see this one's papers. */
  if (prev && prev !== signedInAs) { location.reload(); return; }
  renderHeader();
  await afterSignIn();
  const h = '#' + (next || 'papers');
  next = null;
  if (location.hash === h) initRouter(); else location.hash = h;
  flushSave().catch(() => { /* the save label already says what happened */ });
}

/** Wires the header buttons and the sign-in form. onSignedIn() runs after every sign-in. */
export function initAuth({ onSignedIn } = {}) {
  if (onSignedIn) afterSignIn = onSignedIn;
  signedInAs = api.userId();
  renderHeader();

  const out = $('#btn-signout');
  out.addEventListener('click', async () => {
    out.disabled = true;
    await flushSave();
    await api.signOut();
    location.reload();
  });

  const form = $('#si-form'), err = $('#si-err'), btn = $('#si-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#si-email').value.trim(), password = $('#si-pass').value;
    if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
    btn.disabled = true; err.hidden = true;
    let s;
    try {
      s = await api.signIn(email, password);
    } catch (ex) {
      err.textContent = ex instanceof AuthError ? 'Wrong email or password.'
        : ex instanceof ApiError && ex.status === 0 ? 'Cannot reach the server. Check your connection.'
          : ex.message || 'Could not sign in.';
      err.hidden = false;
      return;
    } finally { btn.disabled = false; }
    await signedIn(s);
  });

  /* The session ended (refused or expired). On a member screen, sign in again and come back. */
  api.onSignedOut(() => {
    renderHeader();
    toast('Signed out. Please sign in again.');
    const here = resolveRoute(parseRoute(location.hash), { signedIn: true, apiOn: true });
    if (!isMemberRoute(here)) return;
    showSignIn(routeHash(here));
    if (location.hash !== '#signin') location.hash = 'signin';
  });
}
