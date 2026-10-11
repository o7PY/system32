// Toast notifications (bottom-right, above the taskbar).
import { icon } from './ui.js';
import { play } from './sound.js';

const ICONS = {
  ok: { glyph: 'shield-ok', cls: 'ok' },
  warn: { glyph: 'shield', cls: 'warn' },
  err: { glyph: 'close', cls: 'err' },
  info: { glyph: 'info', cls: 'info' },
};

/**
 * @param {{title?: string, text: string, kind?: 'ok'|'warn'|'err'|'info', emoji?: string, duration?: number, silent?: boolean}} o
 * All text is inserted with textContent, so strings coming from games can never inject markup.
 */
export function toast({ title = 'System32', text, kind = 'info', emoji = null, duration = 5000, silent = false }) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');

  const ic = document.createElement('div');
  ic.className = `toast-ic ${ICONS[kind]?.cls ?? 'info'}`;
  if (emoji) ic.textContent = emoji;
  else ic.innerHTML = icon(ICONS[kind]?.glyph ?? 'info', 22);

  const main = document.createElement('div');
  main.className = 'toast-main';
  const t = document.createElement('div');
  t.className = 'toast-title';
  t.textContent = title;
  const body = document.createElement('div');
  body.className = 'toast-text';
  body.textContent = text;
  main.append(t, body);

  const x = document.createElement('button');
  x.className = 'toast-x';
  x.setAttribute('aria-label', 'Dismiss notification');
  x.innerHTML = icon('close', 11);

  el.append(ic, main, x);
  host.append(el);
  if (!silent) play('notify');

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  x.addEventListener('click', dismiss);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  while (host.children.length > 5) host.firstElementChild.remove();
  return { el, dismiss };
}
