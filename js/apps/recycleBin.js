// Recycle Bin: pre-filled with lore. "Empty" works, then everything comes back. After the ending it also holds the bonus games
// (SpaceSaga.exe ...): those can be opened, restored to the desktop + Start menu, and are never deleted by "Empty Recycle Bin".
import { bus, launch } from '../events.js';
import { Window, WM } from '../WindowManager.js';
import { icon, esc, wait } from '../ui.js';
import { showDialog, confirmDialog } from '../dialogs.js';
import { showMenu } from '../menu.js';
import { openNotepad } from './notepad.js';
import { play } from '../sound.js';
import { state, isBonusUnlocked, isBonusRestored, restoreBonus, markBonusSeen } from '../state.js';
import { BONUS_GAMES } from '../registry.js';
import { toast } from '../notifications.js';

const ITEMS = (win) => [
  {
    name: 'old_password_hint.txt', icon: 'a-text', from: 'C:\\Users\\User\\Documents', date: '12-03-2019 11:42 PM', type: 'Text Document', size: '1 KB',
    open: () => openNotepad({ doc: 'password-hint', title: 'old_password_hint.txt', text: "it's in the comments. it's always in the comments.\n", readOnly: true }),
  },
  {
    name: 'my_will_to_live.zip', icon: 'a-zip', from: 'C:\\Users\\User\\Desktop', date: '01-01-2020 12:00 AM', type: 'Compressed (zipped) Folder', size: '0 KB',
    open: () => showDialog({ title: 'my_will_to_live.zip', kind: 'error', message: 'Archive is empty.', parent: win }),
  },
  {
    name: 'Internet Explorer.lnk', icon: 'a-lnk', from: 'C:\\Windows\\Legacy', date: '15-06-2022 09:00 AM', type: 'Shortcut', size: '2 KB',
    open: () => showDialog({ title: 'Internet Explorer', kind: 'info', message: 'Internet Explorer has been retired. Respect its wishes.', parent: win }),
  },
];

/** Bonus games that are in the bin: unlocked and not restored yet. They are never emptied. */
const bonusItems = () => BONUS_GAMES.filter((g) => isBonusUnlocked(g.id) && !isBonusRestored(g.id)).map((g) => ({
  name: g.file, icon: g.icon, from: g.binFrom, date: g.binDate, type: 'Application', size: g.size, bonus: g.id, lore: g.binLore,
  open: () => launch(g.id),
}));

export const binHasBonus = () => bonusItems().length > 0;

let emptying = false;

export function openRecycleBin() {
  const existing = WM.get('recycle-bin');
  if (existing) { existing.focus(); return existing; }
  const win = new Window({
    id: 'recycle-bin', title: 'Recycle Bin', icon: 'a-bin-full', appId: 'recycle-bin', width: 760, height: 460,
    content: () => build(win),
    onClose: () => bonusItems().forEach((it) => markBonusSeen(it.bonus)),          // the highlight is for the first visit only
  });
  return win.open();
}

function build(win) {
  const root = document.createElement('div');
  root.className = 'ex';
  root.innerHTML =
    `<div class="ex-tools"><button class="btn" data-a="empty">${icon('trash', 14)} Empty Recycle Bin</button>` +
    `<button class="btn" data-a="restore" disabled>${icon('restore', 14)} Restore the selected item</button></div>` +
    '<div class="ex-main"></div><div class="ex-status"></div>';
  const main = root.querySelector('.ex-main');
  const status = root.querySelector('.ex-status');
  const emptyBtn = root.querySelector('[data-a="empty"]');
  const restoreBtn = root.querySelector('[data-a="restore"]');
  let lorePresent = true;                         // false while "Empty" has swallowed the joke items
  const collect = () => [...(lorePresent ? ITEMS(win) : []), ...bonusItems()];
  let items = collect();
  let selected = '';                              // by name: the list can change under the selection

  const current = () => items.find((it) => it.name === selected) ?? null;

  function draw() {
    items = collect();
    if (!items.some((it) => it.name === selected)) selected = '';
    emptyBtn.disabled = !items.length || emptying;
    restoreBtn.disabled = !current()?.bonus;
    status.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) { main.innerHTML = '<div class="ex-empty">Recycle Bin is empty.</div>'; return; }
    main.innerHTML =
      '<table class="rb-table"><thead><tr><th>Name</th><th>Original location</th><th>Date deleted</th></tr></thead><tbody>' +
      items.map((it, i) => {
        const fresh = it.bonus && !state.bonus.seen.includes(it.bonus);
        return `<tr data-i="${i}" class="${it.name === selected ? 'selected' : ''}${fresh ? ' rb-new' : ''}" tabindex="0"><td><span class="nm">${icon(it.icon, 20)}${esc(it.name)}</span></td>` +
          `<td>${esc(it.from)}</td><td>${esc(it.date)}</td></tr>`;
      }).join('') +
      '</tbody></table>';
  }

  function select(it) {
    selected = it?.name ?? '';
    main.querySelectorAll('tr[data-i]').forEach((r) => r.classList.toggle('selected', items[r.dataset.i]?.name === selected));
    restoreBtn.disabled = !current()?.bonus;
  }

  function restore(it) {
    if (!it?.bonus) return;
    if (restoreBonus(it.bonus)) {
      play('notify');
      toast({ title: 'Recycle Bin', kind: 'ok', text: `${it.name} was restored to the desktop.` });
    }
  }

  function properties(it) {
    const node = document.createElement('div');
    node.innerHTML =
      `<b>${esc(it.name)}</b>` +
      `<dl class="props-grid"><dt>Type</dt><dd>${esc(it.type)}</dd><dt>Original location</dt><dd>${esc(it.from)}</dd>` +
      `<dt>Date deleted</dt><dd>${esc(it.date)}</dd><dt>Size</dt><dd>${esc(it.size)}</dd></dl>` +
      (it.lore ? `<div class="dlg-sub">${esc(it.lore)}</div>` : '');
    showDialog({ title: `${it.name} Properties`, message: node, kind: 'info', width: 400, parent: win });
  }

  const rowItem = (e) => { const row = e.target.closest('tr[data-i]'); return row ? items[row.dataset.i] : null; };

  root.addEventListener('click', (e) => {
    const it = rowItem(e);
    if (it) select(it);
  });
  root.addEventListener('dblclick', (e) => rowItem(e)?.open());
  root.addEventListener('keydown', (e) => {
    const it = rowItem(e);
    if (it && e.key === 'Enter') it.open();
  });
  root.addEventListener('contextmenu', (e) => {
    const it = rowItem(e);
    if (!it) return;
    e.preventDefault();
    select(it);
    showMenu(e.clientX, e.clientY, [
      { label: 'Open', onClick: () => it.open() },
      { label: 'Restore', disabled: !it.bonus, onClick: () => restore(it) },
      { separator: true },
      { label: 'Properties', onClick: () => properties(it) },
    ]);
  });
  restoreBtn.addEventListener('click', () => restore(current()));

  emptyBtn.addEventListener('click', async () => {
    if (emptying || !items.length) return;
    const ok = await confirmDialog(`Are you sure you want to permanently delete these ${items.length} items?`, { title: 'Delete Multiple Items', parent: win });
    if (!ok || emptying) return;
    emptying = true;
    emptyBtn.disabled = true;
    const lore = [...main.querySelectorAll('tr[data-i]')].filter((r) => !items[r.dataset.i]?.bonus);       // bonus games never crumple
    if (lore.length) {
      play('crumple');
      lore.forEach((r, i) => { r.style.animationDelay = `${i * 90}ms`; r.classList.add('crumple'); });
      await wait(1000);
      lorePresent = false;
      if (!win.closed) draw();
      bus.emit('bin:state', binHasBonus());
      await wait(3000);
    }
    emptying = false;
    lorePresent = true;
    if (!win.closed) draw();
    bus.emit('bin:state', true);
    showDialog({
      title: 'Recycle Bin', kind: 'warning', parent: win.closed ? null : win,
      message: 'Some files could not be deleted because they are emotionally attached.',
    });
  });

  const off = bus.on('state:change', () => { if (!win.closed) draw(); });
  const prevClose = win.onClose;
  win.onClose = (w) => { off(); prevClose?.(w); };

  draw();
  return root;
}
