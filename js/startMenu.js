// Start menu: search, pinned grid, recent items, power menu.
import { bus, launch } from './events.js';
import { state } from './state.js';
import { LAUNCH_ITEMS, GAMES } from './registry.js';
import { icon, esc } from './ui.js';
import { showMenuAt, closeMenu } from './menu.js';
import { sleep, shutdown, restart } from './system.js';

const menu = () => document.getElementById('start-menu');
const startBtn = () => document.getElementById('start-btn');

const BASE_PINNED = ['edgy', 'explorer', 'notepad', 'recycle-bin', 'settings'];

const pinnedIds = () => [...BASE_PINNED, ...GAMES.filter((g) => state.unlockedBookmarks.includes(g.id)).map((g) => g.id)];

let query = '';

export const isStartOpen = () => !menu().hidden;

function pinnedMarkup() {
  const q = query.trim().toLowerCase();
  const ids = pinnedIds().filter((id) => !q || LAUNCH_ITEMS[id].label.toLowerCase().includes(q));
  if (!ids.length) return `<div class="start-empty">No pinned apps match “${esc(query)}”.</div>`;
  return ids.map((id) =>
    `<button class="pin-item" data-launch="${id}" aria-label="${esc(LAUNCH_ITEMS[id].label)}">${icon(LAUNCH_ITEMS[id].icon, 32)}<span>${esc(LAUNCH_ITEMS[id].label)}</span></button>`
  ).join('');
}

function recentMarkup() {
  const items = state.recent.filter((id) => LAUNCH_ITEMS[id]);
  if (!items.length) return '<div class="start-empty">Nothing recent yet. Try opening something.</div>';
  return items.map((id) =>
    `<button class="rec-item" data-launch="${id}">${icon(LAUNCH_ITEMS[id].icon, 28)}<span><b>${esc(LAUNCH_ITEMS[id].label)}</b><small>Recently opened</small></span></button>`
  ).join('');
}

function render() {
  const searching = query.trim() !== '';
  menu().innerHTML =
    `<label class="start-search">${icon('search', 16)}<input type="text" placeholder="Search for apps, settings, and documents" aria-label="Search" value="${esc(query)}" autocomplete="off" spellcheck="false"></label>` +
    `<div class="start-scroll">` +
    `<div class="start-sec">Pinned</div><div class="pinned-grid">${pinnedMarkup()}</div>` +
    (searching
      ? `<div class="start-sec">Search the web</div><div class="rec-grid"><button class="rec-item" data-search>${icon('search', 28)}<span><b>Search Goggle for “${esc(query.trim())}”</b><small>Press Enter</small></span></button></div>`
      : `<div class="start-sec">Recommended</div><div class="rec-grid">${recentMarkup()}</div>`) +
    `</div>` +
    `<div class="start-foot"><button class="start-user" aria-label="User"><span class="mini-avatar">${icon('user', 18)}</span>User</button>` +
    `<button id="power-btn" aria-label="Power" aria-haspopup="true">${icon('power', 20)}</button></div>`;
}

export function openStart({ focusSearch = true, flipped = false } = {}) {
  query = '';
  render();
  const m = menu();
  m.hidden = false;
  m.classList.toggle('flipped', flipped);
  startBtn().setAttribute('aria-expanded', 'true');
  if (focusSearch) m.querySelector('input').focus();
}

export function closeStart() {
  if (!isStartOpen()) return;
  menu().hidden = true;
  menu().classList.remove('flipped');
  startBtn().setAttribute('aria-expanded', 'false');
  closeMenu();
}

export function toggleStart() {
  if (isStartOpen()) closeStart(); else openStart();
}

export function initStartMenu() {
  const m = menu();
  startBtn().addEventListener('click', toggleStart);
  document.getElementById('search-btn').addEventListener('click', () => {
    if (isStartOpen()) m.querySelector('input').focus(); else openStart();
  });

  m.addEventListener('click', (e) => {
    const item = e.target.closest('[data-launch]');
    if (item) { closeStart(); launch(item.dataset.launch); return; }
    if (e.target.closest('[data-search]')) { const q = query.trim(); closeStart(); launch('search', { query: q }); return; }
    const power = e.target.closest('#power-btn');
    if (power) {
      showMenuAt(power, [
        { label: 'Sleep', onClick: () => { closeStart(); sleep(); } },
        { label: 'Shut down', onClick: () => { closeStart(); shutdown(); } },
        { label: 'Restart', onClick: () => { closeStart(); restart(); } },
      ], { above: true });
    }
    if (e.target.closest('.start-user')) { closeStart(); launch('settings'); }
  });

  m.addEventListener('input', (e) => {
    if (!e.target.matches('input')) return;
    query = e.target.value;
    // Re-render only the lists so the input keeps focus and caret.
    const pos = e.target.selectionStart;
    render();
    const input = m.querySelector('input');
    input.focus();
    input.setSelectionRange(pos, pos);
  });

  m.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input') && query.trim()) {
      const q = query.trim();
      closeStart();
      launch('search', { query: q });
    }
  });

  // Ctrl+Esc toggles Start (the Meta key is not reliably capturable in a browser); plain Esc closes it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.ctrlKey) { e.preventDefault(); toggleStart(); }
    else if (isStartOpen()) { closeStart(); startBtn().focus(); }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!isStartOpen()) return;
    if (m.contains(e.target) || e.target.closest('#start-btn, #search-btn, .ctx-menu')) return;
    closeStart();
  }, true);

  bus.on('win:open', () => closeStart());
}
