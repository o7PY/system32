// Applies the corruption level to the UI: wallpaper/taskbar glitches, label scrambles, fake ads,
// the repair sweep, and the ending. All motion respects prefers-reduced-motion.
import { bus } from './events.js';
import { state, repairedCount, integrity, allRepaired } from './state.js';
import { GAME_BY_ID, GAME_IDS, ACCENTS } from './registry.js';
import { rand, reducedMotion } from './ui.js';
import { WM, Window } from './WindowManager.js';
import { toast } from './notifications.js';
import { showDialog } from './dialogs.js';
import { scrambleLabel } from './desktop.js';
import { restart } from './system.js';

const root = document.documentElement;
const onDesktop = () => document.body.dataset.phase === 'desktop';

/* ---------- appearance (theme + accent) ---------- */
export function applyAppearance() {
  if (state.theme === 'light' || state.theme === 'dark') root.dataset.theme = state.theme;
  else delete root.dataset.theme;
  // Accent colours come with admin_access.dll (Settings): before it is repaired the default accent is locked in.
  const a = state.repaired.inspect ? ACCENTS[state.accent % ACCENTS.length] : ACCENTS[0];
  root.style.setProperty('--accent', a.value);
  root.style.setProperty('--accent-light', a.light);
}

/* ---------- corruption visuals ---------- */
function applyVisuals() {
  root.style.setProperty('--corruption', String(1 - repairedCount() / GAME_IDS.length));
  root.classList.toggle('theme-broken', !allRepaired());
  document.body.classList.toggle('wm-ok', !!state.repaired.wm404);
}

/** Scanline sweep across the screen; the visual repair lands halfway through. */
function sweep() {
  if (reducedMotion()) { applyVisuals(); return; }
  const el = document.getElementById('scan-sweep');
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  setTimeout(applyVisuals, 460);
  setTimeout(() => el.classList.remove('go'), 1000);
}

/* ---------- ending ---------- */
let endingTimer = 0;
function showEnding() {
  if (!allRepaired() || state.endingSeen) return;
  showDialog({
    title: 'System32', kind: 'info', message: 'System integrity: 100%.\nRestart to complete repair?',
    buttons: [{ label: 'Restart now', value: 'restart', primary: true }, { label: 'Later', value: 'later' }],
  }).result.then((v) => { if (v === 'restart') restart(); });
}
export function scheduleEnding(delay = 3000) {
  clearTimeout(endingTimer);
  if (allRepaired() && !state.endingSeen) endingTimer = setTimeout(showEnding, delay);
}

function onRepaired(gameId) {
  toast({
    title: 'System Integrity', kind: 'ok',
    text: `${GAME_BY_ID[gameId].component} restored${state.skipped[gameId] ? ' (skipped)' : ''}. System integrity: ${integrity()}%.`,
  });
  sweep();
  scheduleEnding(3000);        // 3 s after the last toast
}

/* ---------- timers ---------- */
function loop(fn, minS, maxS) {
  const tick = () => {
    if (!document.hidden && onDesktop()) fn();
    setTimeout(tick, rand(minS, maxS) * 1000);
  };
  setTimeout(tick, rand(minS, maxS) * 1000);
}

function tear() {
  if (!root.classList.contains('theme-broken') || reducedMotion()) return;
  const t = document.getElementById('tear');
  t.style.top = `${rand(4, 92)}%`;
  t.style.height = `${rand(3, 14)}px`;
  t.classList.remove('go');
  void t.offsetWidth;
  t.classList.add('go');
  const bar = document.getElementById('taskbar');
  bar.classList.add('glitch');
  setTimeout(() => bar.classList.remove('glitch'), 320);
}

function scramble() {
  if (allRepaired() || reducedMotion()) return;
  scrambleLabel();
}

let ads = 0;
function spawnAd() {
  if (state.repaired['dom-ination'] || ads >= 2) return;
  if (WM.active?.meta?.game) return;            // never ruin a run
  const lr = WM.layerRect();
  const win = new Window({
    title: 'Congratulations!!!', icon: 'a-html', width: 320, height: 220,
    x: Math.round(rand(30, Math.max(31, lr.width - 350))), y: Math.round(rand(20, Math.max(21, lr.height - 250))),
    resizable: false, minimizable: false, skipTaskbar: true, meta: { ad: true },
    onClose: () => { ads = Math.max(0, ads - 1); },
    content: () => {
      const el = document.createElement('div');
      el.className = 'ad';
      el.innerHTML =
        '<h3>You won a FREE GPU!</h3><p>You are visitor number 1,000,000.</p>' +
        '<button class="btn primary" data-claim>CLAIM NOW</button><button class="btn" data-no>No thanks</button>';
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-claim]')) {
          win.shake();
          toast({ title: 'Security', kind: 'warn', text: 'Nothing was claimed. Thankfully.' });
          setTimeout(() => win.close(), 450);
        } else if (e.target.closest('[data-no]')) win.close();
      });
      return el;
    },
  });
  ads++;
  win.open();
}

export function initCorruption() {
  applyAppearance();
  applyVisuals();
  bus.on('state:change', applyAppearance);
  bus.on('state:reset', () => { applyAppearance(); applyVisuals(); });
  bus.on('repaired', onRepaired);

  loop(tear, 8, 15);
  loop(scramble, 10, 20);
  loop(spawnAd, 60, 120);
}
