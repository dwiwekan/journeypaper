// Short messages at the bottom of the screen, with an optional action button.
import { $ } from '../util.js';

/* ---------- toast ---------- */
export function toast(msg, action) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  const kill = () => t.remove();
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.label;
    b.addEventListener('click', () => { kill(); action.fn(); });
    t.appendChild(b);
  }
  box.appendChild(t);
  setTimeout(kill, action ? 7000 : 3600);
}
