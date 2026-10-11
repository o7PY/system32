// Recycle Bin: pre-filled with lore. "Empty" works, then everything comes back.
import { bus } from '../events.js';
import { Window, WM } from '../WindowManager.js';
import { icon, esc, wait } from '../ui.js';
import { showDialog, confirmDialog } from '../dialogs.js';
import { openNotepad } from './notepad.js';
import { play } from '../sound.js';

const ITEMS = (win) => [
  {
    name: 'old_password_hint.txt', icon: 'a-text', from: 'C:\\Users\\User\\Documents', date: '12-03-2019 11:42 PM',
    open: () => openNotepad({ doc: 'password-hint', title: 'old_password_hint.txt', text: "it's in the comments. it's always in the comments.\n", readOnly: true }),
  },
  {
    name: 'my_will_to_live.zip', icon: 'a-zip', from: 'C:\\Users\\User\\Desktop', date: '01-01-2020 12:00 AM',
    open: () => showDialog({ title: 'my_will_to_live.zip', kind: 'error', message: 'Archive is empty.', parent: win }),
  },
  {
    name: 'Internet Explorer.lnk', icon: 'a-lnk', from: 'C:\\Windows\\Legacy', date: '15-06-2022 09:00 AM',
    open: () => showDialog({ title: 'Internet Explorer', kind: 'info', message: 'Internet Explorer has been retired. Respect its wishes.', parent: win }),
  },
];

let emptying = false;

export function openRecycleBin() {
  const existing = WM.get('recycle-bin');
  if (existing) { existing.focus(); return existing; }
  const win = new Window({
    id: 'recycle-bin', title: 'Recycle Bin', icon: 'a-bin-full', appId: 'recycle-bin', width: 760, height: 460,
    content: () => build(win),
  });
  return win.open();
}

function build(win) {
  const root = document.createElement('div');
  root.className = 'ex';
  root.innerHTML =
    `<div class="ex-tools"><button class="btn" data-a="empty">${icon('trash', 14)} Empty Recycle Bin</button></div>` +
    '<div class="ex-main"></div><div class="ex-status"></div>';
  const main = root.querySelector('.ex-main');
  const status = root.querySelector('.ex-status');
  const emptyBtn = root.querySelector('[data-a="empty"]');
  let items = ITEMS(win);
  let selected = -1;

  function draw() {
    emptyBtn.disabled = !items.length || emptying;
    status.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!items.length) { main.innerHTML = '<div class="ex-empty">Recycle Bin is empty.</div>'; return; }
    main.innerHTML =
      '<table class="rb-table"><thead><tr><th>Name</th><th>Original location</th><th>Date deleted</th></tr></thead><tbody>' +
      items.map((it, i) =>
        `<tr data-i="${i}" class="${i === selected ? 'selected' : ''}" tabindex="0"><td><span class="nm">${icon(it.icon, 20)}${esc(it.name)}</span></td>` +
        `<td>${esc(it.from)}</td><td>${esc(it.date)}</td></tr>`).join('') +
      '</tbody></table>';
  }

  root.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-i]');
    if (row) { selected = Number(row.dataset.i); main.querySelectorAll('tr[data-i]').forEach((r) => r.classList.toggle('selected', r === row)); }
  });
  root.addEventListener('dblclick', (e) => {
    const row = e.target.closest('tr[data-i]');
    if (row) items[row.dataset.i]?.open();
  });
  root.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-i]');
    if (row && e.key === 'Enter') items[row.dataset.i]?.open();
  });

  emptyBtn.addEventListener('click', async () => {
    if (emptying || !items.length) return;
    const ok = await confirmDialog(`Are you sure you want to permanently delete these ${items.length} items?`, { title: 'Delete Multiple Items', parent: win });
    if (!ok || emptying) return;
    emptying = true;
    emptyBtn.disabled = true;
    play('crumple');
    main.querySelectorAll('tr[data-i]').forEach((r, i) => { r.style.animationDelay = `${i * 90}ms`; r.classList.add('crumple'); });
    await wait(1000);
    items = [];
    selected = -1;
    if (!win.closed) draw();
    bus.emit('bin:state', false);
    await wait(3000);
    emptying = false;
    items = ITEMS(win);
    if (!win.closed) draw();
    bus.emit('bin:state', true);
    showDialog({
      title: 'Recycle Bin', kind: 'warning', parent: win.closed ? null : win,
      message: 'Some files could not be deleted because they are emotionally attached.',
    });
  });

  draw();
  return root;
}
