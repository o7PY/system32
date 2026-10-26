// Recovery Guide (FINAL_SPEC §4): a checklist that says WHAT to do and WHERE, never how to beat a game. Steps tick themselves from real state.
// It never mentions the skip button, the sudoku, easter eggs or secrets. "Show me" pulses the target (an icon, the bin, This PC) for 3 s.
import { bus } from '../events.js';
import { Window, WM } from '../WindowManager.js';
import { state, save } from '../state.js';
import { GAMES } from '../registry.js';
import { esc } from '../ui.js';
import { achieve } from '../achievements.js';

/** target: what "Show me" pulses ('icon:<id>' = a desktop icon, 'bin-rows' = the bonus rows of an open Recycle Bin). */
export const STEPS = [
  { n: 1, title: 'Read the notes', text: 'The previous user left notes. Open `README.txt` on the desktop.', done: () => !!state.tutorial.flags.readme, show: ['icon:readme'] },
  { n: 2, title: 'Check the damage', text: 'Open `This PC`. The bar on Local Disk (C:) is your system integrity.', done: () => !!state.tutorial.flags.thispc, show: ['icon:this-pc'] },
  { n: 3, title: 'Find the recovery files', text: 'Three files on the desktop repair the system: `free_prizes.html`, `bank_login.html` and `recovery_tool.html`. They look like junk. Each one repairs one broken component in `C:\\Windows\\System32`.',
    done: () => GAMES.every((g) => state.unlockedBookmarks.includes(g.id) || state.repaired[g.id]), show: GAMES.map((g) => `icon:${g.id}`) },
  { n: 4, title: 'Repair popup_guard.sys', text: 'Open `free_prizes.html` and win.', done: () => !!state.repaired['dom-ination'], show: ['icon:dom-ination'], group: 'repair' },
  { n: 5, title: 'Repair admin_access.dll', text: 'Open `bank_login.html` and get in.', done: () => !!state.repaired.inspect, show: ['icon:inspect'], group: 'repair' },
  { n: 6, title: 'Repair wm_core.exe', text: 'Open `recovery_tool.html` and recover the file.', done: () => !!state.repaired.wm404, show: ['icon:wm404'], group: 'repair' },
  { n: 7, title: 'Restart', text: 'Integrity is at 100%. Restart when the system asks.', done: () => state.endingSeen, show: [] },
  { n: 8, title: 'Check the Recycle Bin', text: 'Some files could not be deleted. Open the Recycle Bin.', done: () => !!state.tutorial.flags.bin, show: ['icon:recycle-bin'] },
  { n: 9, title: 'Restore the games', text: 'Double-click a program to play it, or right-click → Restore to put it on your desktop.', done: () => !!state.tutorial.flags.bonus || state.bonus.restored.length > 0, show: ['bin-rows', 'icon:recycle-bin'] },
];
const DONE_TEXT = "That's everything. You're on your own now.";

export const stepDone = (s) => !!state.tutorial.steps[s.n] || !!state.tutorial.skipped[s.n];
export const tutorialComplete = () => STEPS.every(stepDone);
/** The steps shown as current: the first open step, or all open repair steps together once step 3 is done. */
export function currentSteps() {
  const open = STEPS.filter((s) => !stepDone(s));
  if (!open.length) return [];
  const first = open[0];
  return first.group ? open.filter((s) => s.group === first.group) : [first];
}

/** Tick what is true now (ticked steps stay ticked); returns true when something changed. */
export function tick() {
  let changed = false;
  for (const s of STEPS) if (!state.tutorial.steps[s.n] && s.done()) { state.tutorial.steps[s.n] = true; changed = true; }
  if (!state.tutorial.done && tutorialComplete()) { state.tutorial.done = true; changed = true; achieve('tutorial'); }
  if (changed) { save(); bus.emit('tutorial:change'); }
  return changed;
}

function flag(name) {
  if (state.tutorial.flags[name]) return;
  state.tutorial.flags[name] = true;
  save();
  tick();
}

/** Pulse a target with an accent ring for 3 s. */
export function showMe(targets) {
  document.querySelectorAll('.tut-pulse').forEach((e) => e.classList.remove('tut-pulse'));
  const els = [];
  for (const t of targets) {
    if (t.startsWith('icon:')) els.push(...document.querySelectorAll(`#icons .d-icon[data-id="${t.slice(5)}"]`));
    else if (t === 'bin-rows') els.push(...document.querySelectorAll('#recycle-bin tr[data-bonus]'));
  }
  const unique = [...new Set(els)];
  unique.forEach((e) => e.classList.add('tut-pulse'));
  setTimeout(() => unique.forEach((e) => e.classList.remove('tut-pulse')), 3000);
  return unique.length;
}

export function openTutorial() {
  const existing = WM.get('tutorial');
  if (existing) { existing.focus(); return existing; }
  if (!state.tutorial.seen) { state.tutorial.seen = true; save(); }
  const win = new Window({ id: 'tutorial', title: 'Recovery Guide', icon: 'a-dlg-info', appId: 'tutorial', width: 460, height: 560, content: () => build(win) });
  return win.open();
}

function build(win) {
  const root = document.createElement('div');
  root.className = 'tut';
  const draw = () => {
    const cur = currentSteps(), complete = tutorialComplete();
    const done = STEPS.filter(stepDone).length;
    root.innerHTML = `<h2>Recovery Guide</h2><p class="tut-sub">${done}/${STEPS.length} steps</p><ol class="tut-list">` +
      STEPS.map((s) => {
        const isDone = stepDone(s), isCur = cur.includes(s);
        return `<li class="tut-step${isDone ? ' done' : ''}${isCur ? ' cur' : ''}" data-n="${s.n}"><span class="tut-box" aria-hidden="true">${isDone ? '✓' : s.n}</span>` +
          `<div><b>${esc(s.title)}${state.tutorial.skipped[s.n] ? ' <small>(skipped)</small>' : ''}</b>` +
          (isCur ? `<p>${esc(s.text).replace(/`([^`]+)`/g, '<code>$1</code>')}</p><div class="tut-act">` +
            (s.show.length ? '<button class="btn primary" data-show>Show me</button>' : '') + '<button class="link" data-skip>Skip step</button></div>' : '') +
          '</div></li>';
      }).join('') + '</ol>' +
      (complete ? `<div class="tut-done"><b>✓ Done</b><p>${DONE_TEXT}</p></div>` : '') +
      '<div class="tut-foot"><button class="link" data-restart>Restart tutorial</button></div>';
  };
  root.addEventListener('click', (e) => {
    const li = e.target.closest('.tut-step');
    if (e.target.closest('[data-show]') && li) showMe(STEPS.find((s) => s.n === Number(li.dataset.n)).show);
    else if (e.target.closest('[data-skip]') && li) { state.tutorial.skipped[li.dataset.n] = true; save(); tick(); bus.emit('tutorial:change'); }
    else if (e.target.closest('[data-restart]')) {
      state.tutorial = { seen: true, steps: {}, skipped: {}, flags: {}, done: false };
      save(); tick(); bus.emit('tutorial:change');
    }
  });
  const rerender = () => { if (!win.closed) draw(); };
  const offs = [bus.on('tutorial:change', rerender), bus.on('state:reset', rerender)];
  win.onClose = () => offs.forEach((f) => f());
  draw();
  return root;
}

export function initTutorial() {
  bus.on('state:change', (keys) => { if (keys?.some((k) => ['repaired', 'endingSeen', 'unlockedBookmarks', 'bonus', '*'].includes(k))) tick(); });
  bus.on('launch', (id) => {
    if (id === 'readme') flag('readme');
    else if (id === 'this-pc') flag('thispc');
    else if (id === 'recycle-bin' && state.endingSeen) flag('bin');
    else if (['space-saga', 'strata'].includes(id)) flag('bonus');
  });
  bus.on('explorer:path', (p) => { if (p === 'this-pc') flag('thispc'); });
  bus.on('bin:open', () => flag('bonus'));
  tick();
}
