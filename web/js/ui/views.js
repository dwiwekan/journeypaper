// The five screens. Exactly one is shown at a time.
import { $ } from '../util.js';

const VIEWS = ['signin', 'home', 'catalog', 'paper', 'trash'];

/** Shows #view-<name> and hides the others. */
export function showView(name) {
  for (const v of VIEWS) { const e = $('#view-' + v); if (e) e.hidden = v !== name; }
}
