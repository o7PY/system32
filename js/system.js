// Power + fake-crash flows: BSOD, sleep, shutdown (blocked until repaired), restart.
import { bus } from './events.js';
import { state, set, allRepaired, repairedCount, foundEgg } from './state.js';
import { GAME_IDS } from './registry.js';
import { showDialog } from './dialogs.js';
import { play } from './sound.js';
import { wait } from './ui.js';

const overlays = () => document.getElementById('overlays');

/** Full-screen fake BSOD (§11.1). Never touches saved state. Esc skips. Resolves once it is gone. */
export function bsod({ reboot = true, duration = 3000 } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'bsod';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="sad">:(</div>' +
      '<p>Your PC ran into a problem and needs to restart. We\'re just collecting some error info, and then we\'ll restart for you.</p>' +
      '<div class="pct"><span>0</span>% complete</div>' +
      '<small>If you call a support person, give them this info:<br>Stop code: CRITICAL_PROCESS_WAS_FUN<br>What failed: system32.exe (it was fun)</small>' +
      '<span class="esc">Press Esc to skip</span>';
    overlays().append(el);
    play('error');

    const pct = el.querySelector('.pct span');
    const t0 = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      document.removeEventListener('keydown', onKey, true);
      if (reboot) bus.emit('system:reboot', { skipLock: true });
      el.remove();
      resolve();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    const timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / duration);
      pct.textContent = String(Math.round(p * 100));
      if (p >= 1) finish();
    }, 60);
    document.addEventListener('keydown', onKey, true);
  });
}

function blackout(html, cls = '') {
  const el = document.createElement('div');
  el.className = `blackout ${cls}`;
  el.innerHTML = html;
  overlays().append(el);
  return el;
}

export function sleep() {
  const el = blackout('<div style="opacity:.35;font-size:14px">Click or press any key to wake</div>');
  const wake = () => {
    window.removeEventListener('keydown', wake, true);
    el.remove();
  };
  setTimeout(() => {
    el.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { capture: true, once: true });
  }, 400);
}

/** The ending is seen once all components are repaired and the player restarts (or shuts down). */
function markEnding() {
  if (!allRepaired() || state.endingSeen) return;
  set({ endingSeen: true });
  bus.emit('ending:seen');
}

export async function restart() {
  markEnding();
  const el = blackout('<div class="spinner" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div>Restarting</div>');
  await wait(1400);
  bus.emit('system:reboot', { skipLock: true });
  el.remove();
}

/** Shut down. Blocked by a fake "updates pending" dialog until all three components are repaired. */
export async function shutdown() {
  if (!allRepaired()) {
    foundEgg('shutdown-early');
    const left = GAME_IDS.length - repairedCount();
    const node = document.createElement('div');
    node.innerHTML =
      `<b>Shutdown blocked: ${left} update${left === 1 ? '' : 's'} pending.</b>Don't turn off your computer.` +
      '<div class="dlg-sub">Installing updates… <span class="pct">0</span>%</div><div class="dlg-progress"><i></i></div>';
    const bar = node.querySelector('i');
    const pct = node.querySelector('.pct');
    const dlg = showDialog({ title: 'Updates pending', message: node, kind: 'warning', width: 420 });
    const t0 = performance.now();
    const timer = setInterval(() => {
      const p = Math.min(0.99, (performance.now() - t0) / 7000);   // climbs to 99% and stays there
      bar.style.width = `${p * 100}%`;
      pct.textContent = String(Math.round(p * 100));
      if (dlg.closed || p >= 0.99) clearInterval(timer);
    }, 90);
    return;
  }
  markEnding();
  const el = blackout('<div class="spinner" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div>Shutting down</div>');
  await wait(1800);
  el.innerHTML = 'It\'s now safe to turn off your computer.<div style="font-size:13px;opacity:.6">(Click anywhere to boot again.)</div>';
  el.className = 'blackout safe';
  el.addEventListener('click', () => {
    bus.emit('system:reboot', { skipLock: false });
    el.remove();
  }, { once: true });
}
