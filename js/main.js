// Boot, wiring, and the boot -> lock -> sign-in -> desktop sequence.
import { bus } from './events.js';
import { state, set, repairedCount, integrity } from './state.js';
import { WM } from './WindowManager.js';
import { initTaskbar } from './taskbar.js';
import { initStartMenu, closeStart } from './startMenu.js';
import { initDesktop, revealIcons, hideIcons } from './desktop.js';
import { initBrowser } from './apps/browser.js';
import { initLauncher } from './launcher.js';
import { initCorruption, scheduleEnding } from './corruption.js';
import { initEggs } from './easterEggs.js';
import { initGameWindows } from './apps/gameWindow.js';
import { announceBonus, debugUnlock } from './bonus.js';
import { closeMenu, closeFlyout } from './menu.js';
import { toast } from './notifications.js';
import { launch } from './events.js';
import { play } from './sound.js';
import { wait, pad2, reducedMotion } from './ui.js';

const $ = (id) => document.getElementById(id);
const setPhase = (p) => { document.body.dataset.phase = p; };

/** Resolves after `ms`, or sooner on the first key press / click (boot is skippable). */
function waitSkip(ms) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      removeEventListener('pointerdown', done, true);
      removeEventListener('keydown', done, true);
      resolve();
    };
    const timer = setTimeout(done, ms);
    addEventListener('pointerdown', done, true);
    addEventListener('keydown', done, true);
  });
}

/** Resolves on the next click/key (listening starts a beat late so the skip press itself is not reused). */
async function anyInput() {
  await wait(80);
  return new Promise((resolve) => {
    const done = () => {
      removeEventListener('pointerdown', done, true);
      removeEventListener('keydown', done, true);
      resolve();
    };
    addEventListener('pointerdown', done, true);
    addEventListener('keydown', done, true);
  });
}

function signIn() {
  return new Promise((resolve) => {
    const btn = $('signin-btn');
    btn.focus();
    const done = () => {
      btn.removeEventListener('click', done);
      document.removeEventListener('keydown', onKey, true);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } };
    btn.addEventListener('click', done);
    document.addEventListener('keydown', onKey, true);
  });
}

function startLockClock() {
  const render = () => {
    const d = new Date();
    $('lock-time').textContent = `${d.getHours() % 12 || 12}:${pad2(d.getMinutes())}`;
    $('lock-date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };
  render();
  const id = setInterval(() => { if (document.body.dataset.phase !== 'lock') clearInterval(id); else render(); }, 1000);
}

function enterDesktop() {
  setPhase('desktop');
  play('startup');
  revealIcons();
  if (state.firstVisit) {
    set({ firstVisit: false });
    setTimeout(() => {
      toast({ title: 'System32', kind: 'warn', text: `⚠ System integrity: ${integrity()}%. Critical components missing.` });
      launch('readme');
    }, 1500);
  }
  scheduleEnding(3000);          // finished all four but never restarted? offer again
  announceBonus();               // the ending is complete (clean desktop after the restart): the Recycle Bin has one more item
}

let booting = false;
async function boot({ skipLock = false } = {}) {
  if (booting) return;
  booting = true;
  WM.closeAll();
  closeMenu();
  closeFlyout();
  closeStart();
  hideIcons();
  document.getElementById('toasts').replaceChildren();
  $('screen-lock').classList.remove('leave');
  $('boot-sub').classList.toggle('show', repairedCount() > 0);
  setPhase('boot');

  await waitSkip(reducedMotion() ? 1200 : 2500);

  if (!skipLock) {
    if (state.firstVisit) {                    // returning visitors skip the lock screen
      setPhase('lock');
      startLockClock();
      await anyInput();
      $('screen-lock').classList.add('leave');
      await wait(reducedMotion() ? 50 : 560);
    }
    setPhase('signin');
    await signIn();
  }
  enterDesktop();
  booting = false;
}

function init() {
  debugUnlock();                 // ?unlockBonus=1: unlock the bonus games without playing the ending
  WM.init();
  initTaskbar();
  initStartMenu();
  initDesktop();
  initBrowser();
  initGameWindows();
  initLauncher();
  initCorruption();
  initEggs();

  // Our own context menus replace the browser's, except inside text fields.
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('textarea, input')) e.preventDefault();
  });

  bus.on('system:reboot', (opts) => boot(opts));
  boot({ skipLock: false });
}

init();
