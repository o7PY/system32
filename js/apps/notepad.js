// Notepad. README.txt is editable and persists in state; other documents are in-memory only.
import { bus } from '../events.js';
import { Window, WM } from '../WindowManager.js';
import { state, save } from '../state.js';
import { toast } from '../notifications.js';
import { showMenuAt } from '../menu.js';
import { esc } from '../ui.js';

/**
 * @param {{doc?:string, title?:string, text?:string, readOnly?:boolean}} o
 * `doc` names a singleton document (re-opening focuses it). `doc: 'readme'` loads the persisted README.
 */
export function openNotepad({ doc = null, title = 'Untitled', text = '', readOnly = false } = {}) {
  const persist = doc === 'readme';
  if (persist) { title = 'README.txt'; text = state.readmeText; }
  const id = doc ? `np-${doc}` : undefined;
  const existing = id && WM.get(id);
  if (existing) { existing.focus(); return existing; }

  const win = new Window({
    id, title: `${title} - Notepad`, icon: 'a-text', appId: 'notepad', width: 600, height: 450,
    content: () => build(win, { title, text, readOnly, persist }),
  });
  return win.open();
}

function build(win, { title, text, readOnly, persist }) {
  const root = document.createElement('div');
  root.className = 'np';
  root.innerHTML =
    '<div class="np-menubar" role="menubar">' +
    ['File', 'Edit', 'Format', 'View'].map((m) => `<button role="menuitem" data-menu="${m}" aria-haspopup="true">${m}</button>`).join('') +
    '</div>' +
    `<textarea spellcheck="false" aria-label="${esc(title)}"${readOnly ? ' readonly' : ''}></textarea>` +
    '<div class="np-status"><span class="pos">Ln 1, Col 1</span><span class="len">0 characters</span></div>';
  const ta = root.querySelector('textarea');
  const pos = root.querySelector('.pos');
  const len = root.querySelector('.len');
  ta.value = text;

  const status = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n');
    pos.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
    len.textContent = `${ta.value.length} character${ta.value.length === 1 ? '' : 's'}`;
  };
  for (const ev of ['input', 'keyup', 'click', 'select', 'focus']) ta.addEventListener(ev, status);
  ta.addEventListener('input', () => {
    if (persist) { state.readmeText = ta.value; save(); }
    bus.emit('notepad:input', { textarea: ta, win });
  });
  status();

  const noop = () => {};
  const menus = {
    File: [
      { label: 'New', hint: 'Ctrl+N', onClick: noop },
      { label: 'Open…', hint: 'Ctrl+O', onClick: noop },
      { label: 'Save', hint: 'Ctrl+S', onClick: () => toast({ title: 'Notepad', text: 'Saved to nowhere.', silent: true }) },
      { separator: true },
      { label: 'Exit', onClick: () => win.close() },
    ],
    Edit: [
      { label: 'Undo', hint: 'Ctrl+Z', onClick: noop },
      { separator: true },
      { label: 'Cut', hint: 'Ctrl+X', onClick: noop },
      { label: 'Copy', hint: 'Ctrl+C', onClick: noop },
      { label: 'Paste', hint: 'Ctrl+V', onClick: noop },
      { separator: true },
      { label: 'Select all', hint: 'Ctrl+A', onClick: () => { ta.focus(); ta.select(); } },
    ],
    Format: [{
      label: 'Word wrap', checked: true,
      onClick: () => { ta.classList.toggle('nowrap'); ta.wrap = ta.classList.contains('nowrap') ? 'off' : 'soft'; },
    }, { label: 'Font…', onClick: noop }],
    View: [{ label: 'Zoom', onClick: noop }, { label: 'Status bar', checked: true, onClick: noop }],
  };
  root.querySelector('.np-menubar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-menu]');
    if (btn) showMenuAt(btn, menus[btn.dataset.menu]);
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      toast({ title: 'Notepad', text: 'Saved to nowhere.', silent: true });
    }
  });
  queueMicrotask(() => ta.focus());
  return root;
}
