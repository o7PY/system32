// Shell easter eggs (Goggle's own eggs are reported through the browser protocol).
// The bin-pc, bin-game, shutdown-early and new-folder eggs live next to the code they hook into.
import { bus } from './events.js';
import { foundEgg } from './state.js';
import { EGGS } from './registry.js';
import { state } from './state.js';
import { toast } from './notifications.js';
import { openStart } from './startMenu.js';
import { orbitIcons } from './desktop.js';
import { showFlyout, closeFlyout } from './menu.js';
import { wifiFlyoutNode } from './taskbar.js';
import { wait } from './ui.js';

const $ = (id) => document.getElementById(id);

/** Fires `fn` when `el` is clicked `count` times within `ms`. */
function clickBurst(el, count, ms, fn) {
  let stamps = [];
  el.addEventListener('click', () => {
    const now = performance.now();
    stamps = [...stamps.filter((t) => now - t < ms), now];
    if (stamps.length >= count) { stamps = []; fn(); }
  });
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

function currentLine(ta) {
  const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = ta.value.indexOf('\n', ta.selectionStart);
  if (end === -1) end = ta.value.length;
  return { start, end, text: ta.value.slice(start, end) };
}

export function initEggs() {
  bus.on('egg:found', (id) => {
    const egg = EGGS.find((e) => e.id === id);
    toast({
      title: 'Secret found', emoji: '🥚', kind: 'info',
      text: `${egg?.name ?? id}  (${state.eggsFound.length}/${EGGS.length})`,
    });
  });

  // start-spam: click Start 10x within 3 s -> it opens upside down (once per session)
  let flipped = false;
  clickBurst($('start-btn'), 10, 3000, () => {
    if (flipped) return;
    flipped = true;
    foundEgg('start-spam');
    openStart({ flipped: true });
  });

  // clock: 7 clicks -> 13:37, then the date flips to the epoch
  clickBurst($('clock'), 7, 4000, async () => {
    closeFlyout();
    foundEgg('clock');
    bus.emit('clock:override', { time: '13:37', ms: 1600 });
    await wait(1600);
    bus.emit('clock:override', { time: '13:37', date: '01-01-1970', ms: 3000 });
  });

  // wifi: 5 clicks -> "Connected to: Pretty Fly for a Wi-Fi" (still no internet)
  clickBurst($('tray-wifi'), 5, 4000, () => {
    foundEgg('wifi');
    showFlyout($('tray-wifi'), wifiFlyoutNode(true), { force: true });
  });

  // konami: icons orbit the screen centre
  let k = 0;
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.phase !== 'desktop' || e.target.closest('input,textarea')) { k = 0; return; }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    k = key === KONAMI[k] ? k + 1 : (key === KONAMI[0] ? 1 : 0);
    if (k === KONAMI.length) {
      k = 0;
      foundEgg('konami');
      orbitIcons(10000);
    }
  });

  // notepad-hello: type "hello" on a line of its own and Notepad answers
  let replying = false;
  let helloTimer = 0;
  bus.on('notepad:input', ({ textarea: ta }) => {
    clearTimeout(helloTimer);
    if (replying || currentLine(ta).text.trim().toLowerCase() !== 'hello') return;
    helloTimer = setTimeout(async () => {
      if (replying || currentLine(ta).text.trim().toLowerCase() !== 'hello') return;
      replying = true;
      foundEgg('notepad-hello');
      const reply = '\nhi. please help.';
      const line = currentLine(ta);
      ta.setSelectionRange(line.end, line.end);
      for (const ch of reply) {
        if (!ta.isConnected) break;
        ta.setRangeText(ch, ta.selectionStart, ta.selectionStart, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(70);
      }
      replying = false;
    }, 1000);
  });
}
