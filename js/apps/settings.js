// Settings: unlocked by repairing admin_access.dll (Inspect Element).
import { bus } from '../events.js';
import { Window, WM } from '../WindowManager.js';
import { state, set, reset, repairedCount, integrity } from '../state.js';
import { GAMES, GAME_IDS, EGGS, ACCENTS } from '../registry.js';
import { icon, esc, meterColor } from '../ui.js';
import { showDialog, confirmDialog } from '../dialogs.js';

export function openSettings() {
  if (!state.repaired.inspect) {
    showDialog({
      title: 'Settings', kind: 'error',
      message: 'Settings could not be opened.\nMissing component: admin_access.dll',
    });
    return null;
  }
  const existing = WM.get('settings');
  if (existing) { existing.focus(); return existing; }
  const win = new Window({
    id: 'settings', title: 'Settings', icon: 'a-settings', appId: 'settings', width: 640, height: 600,
    content: () => build(win),
  });
  return win.open();
}

function build(win) {
  const root = document.createElement('div');
  root.className = 'set';

  const draw = () => {
    const themeOk = state.repaired.specificity;
    const pct = integrity();
    root.innerHTML =
      '<h2>Settings</h2>' +
      '<section><h3>Personalization</h3>' +
      `<div class="row"><div>Accent color${themeOk ? '' : '<small>Unavailable. Missing component: theme.dll</small>'}</div>` +
      `<div class="swatches">${ACCENTS.map((a, i) =>
        `<button class="swatch${themeOk && state.accent === i ? ' on' : ''}" data-accent="${i}" style="background:${a.value}" aria-label="${a.name}" ${themeOk ? '' : 'disabled'}></button>`).join('')}</div></div>` +
      '<div class="row"><div>Theme</div><div class="seg" role="group" aria-label="Theme">' +
      ['system', 'light', 'dark'].map((t) => `<button data-theme="${t}" class="${state.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('') +
      '</div></div></section>' +
      '<section><h3>Sound</h3>' +
      `<div class="row"><div>System sounds<small>Also controlled from the volume icon in the tray</small></div>` +
      `<button class="toggle" role="switch" aria-label="System sounds" aria-checked="${state.soundOn}" data-sound></button></div></section>` +
      '<section><h3>System integrity</h3>' +
      `<div class="row"><div style="flex:1">${icon(pct === 100 ? 'shield-ok' : 'shield', 16)} ${pct}% (${repairedCount()}/${GAME_IDS.length} components repaired)` +
      `<div class="meter" style="--meter:${meterColor(pct)}"><i style="width:${pct}%"></i></div></div></div>` +
      GAMES.map((g) => `<div class="row"><div>${esc(g.component)}</div><div>${state.repaired[g.id] ? '<span style="color:var(--success)">Repaired</span>' : '<span style="color:var(--danger)">Missing</span>'}</div></div>`).join('') +
      '</section>' +
      `<section><h3>Secrets</h3><div class="row"><div>Secrets: ${state.eggsFound.length}/${EGGS.length}</div></div>` +
      `<ul class="secret-list">${EGGS.map((e) => `<li class="${state.eggsFound.includes(e.id) ? 'found' : ''}">${state.eggsFound.includes(e.id) ? esc(e.name) : '???'}</li>`).join('')}</ul></section>` +
      '<section><h3>Recovery</h3>' +
      '<div class="row"><div>Reset progress<small>Un-repairs everything and starts over. Cannot be undone.</small></div><button class="btn danger" data-reset>Reset…</button></div></section>';
  };

  root.addEventListener('click', async (e) => {
    const accent = e.target.closest('[data-accent]');
    const theme = e.target.closest('[data-theme]');
    if (accent) set({ accent: Number(accent.dataset.accent) });
    else if (theme) set({ theme: theme.dataset.theme });
    else if (e.target.closest('[data-sound]')) set({ soundOn: !state.soundOn });
    else if (e.target.closest('[data-reset]')) {
      const ok = await confirmDialog('Reset all progress? Every component will be broken again and all secrets forgotten.', { title: 'Reset progress', parent: win });
      if (ok) { reset(); location.reload(); }
    }
  });

  const rerender = () => { if (!win.closed) { const top = root.scrollTop; draw(); root.scrollTop = top; } };
  const off = bus.on('state:change', rerender);
  win.onClose = () => off();
  draw();
  return root;
}
