// The homepage for visitors: what JourneyPaper is, a short tour, and a search into the library.
import { $ } from '../util.js';

/** #home-search searches the library; #home-browse opens it. */
export function initHome() {
  $('#home-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#home-q').value.trim();
    location.hash = v ? 'library?q=' + encodeURIComponent(v) : 'library';
  });
  $('#home-browse').addEventListener('click', () => { location.hash = 'library'; });
}
