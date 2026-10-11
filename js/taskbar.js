// Taskbar: window buttons, tray (hidden icons, Wi-Fi, volume), clock + calendar, show-desktop.
import { bus, launch } from './events.js';
import { WM } from './WindowManager.js';
import { state, set, integrity, repairedCount } from './state.js';
import { GAME_IDS } from './registry.js';
import { icon, pad2, meterColor } from './ui.js';
import { showFlyout } from './menu.js';
import { play } from './sound.js';

const PINNED = [
  { app: 'explorer', icon: 'a-folder', label: 'File Explorer', launch: 'explorer' },
  { app: 'browser', icon: 'a-edgy', label: 'Edgy', launch: 'edgy' },
  { app: 'notepad', icon: 'a-text', label: 'Notepad', launch: 'notepad' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const $ = (id) => document.getElementById(id);
const buttons = new Map();   // app key -> button

/* ---------------- window buttons ---------------- */
function groupOf(app) {
  return WM.windows.filter((w) => !w.skipTaskbar && (w.appId ?? w.id) === app);
}

function onAppClick(app, pinned) {
  const wins = groupOf(app);
  if (!wins.length) { if (pinned) launch(pinned.launch); return; }
  if (wins.length > 1) {
    // Several windows share this button: cycle through them (restoring minimized ones) so none gets stranded.
    const i = wins.indexOf(WM.active);
    const next = i === -1
      ? [...wins].sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0]
      : wins[(i + 1) % wins.length];
    if (next.minimized) next.restore(); else next.focus();
    return;
  }
  const [target] = wins;
  if (target.minimized) target.restore();
  else if (WM.active === target) target.minimize();
  else target.focus();
}

function ensureButton(app, meta, pinned) {
  let btn = buttons.get(app);
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'tb-btn';
    btn.dataset.app = app;
    btn.addEventListener('click', () => onAppClick(app, pinned));
    $('tb-apps').append(btn);
    buttons.set(app, btn);
  }
  if (btn.dataset.icon !== meta.icon) {
    btn.dataset.icon = meta.icon;
    btn.innerHTML = icon(meta.icon, 24);
  }
  btn.title = meta.label;
  btn.setAttribute('aria-label', meta.label);
  return btn;
}

function renderApps() {
  const wanted = new Set();
  for (const p of PINNED) wanted.add(p.app);
  for (const w of WM.windows) if (!w.skipTaskbar) wanted.add(w.appId ?? w.id);

  for (const p of PINNED) ensureButton(p.app, p, p);
  for (const w of WM.windows) {
    if (w.skipTaskbar) continue;
    const key = w.appId ?? w.id;
    if (!PINNED.some((p) => p.app === key)) ensureButton(key, { icon: w.iconName, label: w.title }, null);
  }
  for (const [key, btn] of buttons) {
    if (!wanted.has(key)) { btn.remove(); buttons.delete(key); continue; }
    const wins = groupOf(key);
    btn.classList.toggle('open', wins.length > 0);
    btn.classList.toggle('multi', wins.length > 1);
    btn.classList.toggle('active', wins.some((w) => w === WM.active));
    btn.classList.toggle('minimized', wins.length > 0 && wins.every((w) => w.minimized));
    const solo = !PINNED.some((p) => p.app === key) && wins[0];
    if (solo) btn.title = btn.ariaLabel = wins[0].title;
  }
}

/* ---------------- clock + calendar ---------------- */
let clockOverride = null;
let clockTimer = 0;

function renderClock(d = new Date()) {
  const h = d.getHours() % 12 || 12;
  const time = `${pad2(h)}:${pad2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  const date = `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
  $('clock-time').textContent = clockOverride?.time ?? time;
  $('clock-date').textContent = clockOverride?.date ?? date;
}

function tickClock() {
  const d = new Date();
  renderClock(d);
  clockTimer = setTimeout(tickClock, 1000 - d.getMilliseconds());   // single timeout aligned to the next second
}

function calendarNode() {
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth();
  const root = document.createElement('div');
  root.className = 'cal';
  const draw = () => {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;                 // Monday-first
    const days = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const cells = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<span class="dow">${d}</span>`);
    for (let i = 0; i < 42; i++) {
      const n = i - lead + 1;
      if (n < 1) cells.push(`<span class="dim">${prevDays + n}</span>`);
      else if (n > days) cells.push(`<span class="dim">${n - days}</span>`);
      else {
        const today = n === now.getDate() && month === now.getMonth() && year === now.getFullYear();
        cells.push(`<span class="${today ? 'today' : ''}">${n}</span>`);
      }
    }
    root.innerHTML =
      `<div class="cal-head"><button data-d="-1" aria-label="Previous month">${icon('chevron-left', 14)}</button>` +
      `<span>${MONTHS[month]} ${year}</span><button data-d="1" aria-label="Next month">${icon('chevron-right', 14)}</button></div>` +
      `<div class="cal-grid">${cells.join('')}</div>`;
  };
  root.addEventListener('click', (e) => {
    const d = e.target.closest('[data-d]')?.dataset.d;
    if (!d) return;
    month += Number(d);
    if (month < 0) { month = 11; year--; } else if (month > 11) { month = 0; year++; }
    draw();
  });
  draw();
  return root;
}

/* ---------------- tray ---------------- */
function integrityNode() {
  const pct = integrity();
  const root = document.createElement('div');
  root.innerHTML =
    `<h4>${icon(pct === 100 ? 'shield-ok' : 'shield', 16)} System Integrity</h4>` +
    `<div class="integrity-meter" style="--meter:${meterColor(pct)}"><i style="width:${pct}%"></i></div>` +
    `<p>${repairedCount()}/${GAME_IDS.length} components repaired (${pct}%)</p>` +
    `<button class="fly-row" style="margin-top:8px" data-open>${icon('a-folder', 18)} Open System32 folder</button>`;
  root.querySelector('[data-open]').addEventListener('click', () => launch('explorer', { path: 'system32' }));
  return root;
}

export function wifiFlyoutNode(connected = false) {
  const root = document.createElement('div');
  root.innerHTML = connected
    ? `<h4>${icon('wifi-off', 16)} Connected to: Pretty Fly for a Wi-Fi</h4><p>Secured. Still no internet.</p>`
    : `<h4>${icon('wifi-off', 16)} Not connected</h4><p>No internet. This is fine.</p>`;
  return root;
}

function renderVolume() {
  $('tray-volume').innerHTML = icon(state.soundOn ? 'volume' : 'volume-off', 18);
  $('tray-volume').title = state.soundOn ? 'Sound on' : 'Sound off';
  $('tray-volume').setAttribute('aria-pressed', String(state.soundOn));
  $('tray-volume').setAttribute('aria-label', state.soundOn ? 'Volume: on' : 'Volume: muted');
}

let desktopHidden = [];

export function initTaskbar() {
  renderApps();
  bus.on('win:change', renderApps);
  bus.on('win:open', renderApps);
  bus.on('win:close', renderApps);

  tickClock();
  bus.on('clock:override', ({ time, date, ms }) => {
    clockOverride = { time, date };
    renderClock();
    setTimeout(() => { clockOverride = null; renderClock(); }, ms);
  });
  $('clock').addEventListener('click', () => showFlyout($('clock'), calendarNode()));

  $('tray-chevron').addEventListener('click', () => showFlyout($('tray-chevron'), integrityNode()));
  $('tray-wifi').addEventListener('click', () => showFlyout($('tray-wifi'), wifiFlyoutNode()));
  renderVolume();
  $('tray-volume').addEventListener('click', () => {
    set({ soundOn: !state.soundOn });
    play('notify');
  });
  bus.on('state:change', renderVolume);

  $('show-desktop').addEventListener('click', () => {
    const open = WM.windows.filter((w) => !w.skipTaskbar && !w.isDialog);
    if (open.length && open.every((w) => w.minimized) && desktopHidden.length) {
      desktopHidden.forEach((w) => !w.closed && w.restore());
      desktopHidden = [];
    } else {
      desktopHidden = WM.minimizeAll();
    }
  });

  document.addEventListener('visibilitychange', () => {
    clearTimeout(clockTimer);
    if (!document.hidden) tickClock();
  });
}
