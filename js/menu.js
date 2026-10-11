// Context menus (with submenus) and anchored taskbar flyouts.
import { esc, icon } from './ui.js';

let current = null;

export function closeMenu() {
  current?.();
  current = null;
}

function buildMenu(items, close) {
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.append(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const btn = document.createElement('button');
    btn.className = 'ctx-item';
    btn.setAttribute('role', 'menuitem');
    btn.disabled = !!item.disabled;
    btn.innerHTML =
      `<span class="ctx-check">${item.checked ? '✓' : ''}</span><span>${esc(item.label)}</span>` +
      (item.hint ? `<span class="ctx-hint">${esc(item.hint)}</span>` : '') +
      (item.submenu ? icon('chevron-right', 12, 'ctx-arrow') : '');
    row.append(btn);
    if (item.submenu) {
      row.append(buildMenu(item.submenu, close));
    } else {
      btn.addEventListener('click', () => {
        close();
        item.onClick?.();
      });
    }
    menu.append(row);
  }
  return menu;
}

/** Show a context menu at viewport coords. items: {label,onClick,disabled,checked,hint,separator,submenu}[] */
export function showMenu(x, y, items) {
  closeMenu();
  const menu = buildMenu(items, closeMenu);
  document.body.append(menu);

  const r = menu.getBoundingClientRect();
  const left = Math.min(x, innerWidth - r.width - 6);
  const top = y + r.height > innerHeight - 6 ? Math.max(6, y - r.height) : y;
  menu.style.left = `${Math.max(6, left)}px`;
  menu.style.top = `${top}px`;
  if (left + r.width * 2 > innerWidth) menu.classList.add('flip-left');

  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
  current = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeMenu);
    menu.remove();
  };
  return menu;
}

/** Menu dropping down from (or above) an element, e.g. Notepad's menubar or the power button. */
export function showMenuAt(anchor, items, { above = false } = {}) {
  const r = anchor.getBoundingClientRect();
  const menu = showMenu(r.left, above ? r.top - 4 : r.bottom + 2, items);
  if (above) {
    const mr = menu.getBoundingClientRect();
    menu.style.top = `${Math.max(6, r.top - mr.height - 6)}px`;
  }
  return menu;
}

/* ---------------- flyouts ---------------- */
let flyout = null;

export function closeFlyout() {
  flyout?.close();
  flyout = null;
}

export const isFlyoutOpen = (anchor) => flyout?.anchor === anchor;

/** Show `node` in a panel above the taskbar next to `anchor`. Clicking the same anchor again closes it unless force. */
export function showFlyout(anchor, node, { force = false } = {}) {
  if (!force && flyout?.anchor === anchor) { closeFlyout(); return null; }
  closeFlyout();
  const host = document.getElementById('flyouts');
  const panel = document.createElement('div');
  panel.className = 'flyout';
  panel.append(node);
  host.append(panel);

  const ar = anchor.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  const left = Math.min(Math.max(8, ar.right - pr.width), innerWidth - pr.width - 8);
  panel.style.left = `${left}px`;

  const onDown = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) closeFlyout(); };
  const onKey = (e) => { if (e.key === 'Escape') closeFlyout(); };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  flyout = {
    anchor,
    close() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      panel.remove();
    },
  };
  return panel;
}
