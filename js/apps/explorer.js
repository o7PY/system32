// File Explorer: a tiny virtual file system. System32 doubles as the repair screen.
import { bus, launch } from '../events.js';
import { Window } from '../WindowManager.js';
import { state, integrity, repairedCount } from '../state.js';
import { GAMES, GAME_IDS, DESKTOP_ICONS, THANK_YOU_ICON, BONUS_GAMES, bonusDesktopIcon } from '../registry.js';
import { icon, esc, meterColor } from '../ui.js';
import { showDialog } from '../dialogs.js';

const NODES = {
  home: { name: 'Home', icon: 'a-home' },
  desktop: { name: 'Desktop', icon: 'a-desktop', parent: 'this-pc' },
  documents: { name: 'Documents', icon: 'a-folder-blue', parent: 'this-pc' },
  'this-pc': { name: 'This PC', icon: 'a-pc' },
  c: { name: 'Local Disk (C:)', icon: 'a-drive', parent: 'this-pc', children: ['windows', 'program-files', 'users'] },
  windows: { name: 'Windows', icon: 'a-folder', parent: 'c', children: ['system32', 'fonts'] },
  system32: { name: 'System32', icon: 'a-folder', parent: 'windows' },
  fonts: { name: 'Fonts', icon: 'a-folder', parent: 'windows', children: [] },
  'program-files': { name: 'Program Files', icon: 'a-folder', parent: 'c', children: [] },
  users: { name: 'Users', icon: 'a-folder', parent: 'c', children: [] },
};
const NAV = [['home', 'a-home'], ['this-pc', 'a-pc'], ['desktop', 'a-desktop'], ['documents', 'a-folder-blue']];
const NAV_IDS = new Set(NAV.map(([n]) => n));
const navDepth = (n) => (NODES[n].parent && NAV_IDS.has(NODES[n].parent) ? 1 : 0);   // child of another sidebar item => indented

const DOCS = [
  { name: 'taxes_2019_FINAL_final.xlsx', icon: 'a-xlsx' },
  { name: 'resume_v37.docx', icon: 'a-docx' },
  { name: 'definitely_not_a_virus.zip', icon: 'a-zip' },
];
const SYS_ICON = { sys: 'a-sys', dll: 'a-sys', exe: 'a-exe' };

function crumbs(id) {
  const out = [];
  for (let n = id; n; n = NODES[n]?.parent) out.unshift(n);
  return out;
}

export function openExplorer({ path = 'home' } = {}) {
  const win = new Window({
    title: 'File Explorer', icon: 'a-folder', appId: 'explorer', width: 900, height: 560,
    content: () => build(win, NODES[path] ? path : 'home'),
  });
  return win.open();
}

function build(win, startPath) {
  const root = document.createElement('div');
  root.className = 'ex';
  root.innerHTML =
    '<div class="ex-bar">' +
    `<button class="br-nav" data-a="back" aria-label="Back">${icon('arrow-left', 16)}</button>` +
    `<button class="br-nav" data-a="forward" aria-label="Forward">${icon('arrow-right', 16)}</button>` +
    `<button class="br-nav" data-a="up" aria-label="Up one level">${icon('arrow-up', 16)}</button>` +
    '<div class="ex-crumbs" aria-label="Address"></div></div>' +
    '<div class="ex-body"><nav class="ex-nav" aria-label="Navigation"></nav><div class="ex-main"></div></div>' +
    '<div class="ex-status"></div>';
  const crumbEl = root.querySelector('.ex-crumbs');
  const nav = root.querySelector('.ex-nav');
  const main = root.querySelector('.ex-main');
  const status = root.querySelector('.ex-status');
  const [backBtn, fwdBtn, upBtn] = ['back', 'forward', 'up'].map((a) => root.querySelector(`[data-a="${a}"]`));

  let hist = [startPath];
  let idx = 0;
  let selected = null;
  const here = () => hist[idx];

  const go = (id, push = true) => {
    if (push) { hist = hist.slice(0, idx + 1); hist.push(id); idx = hist.length - 1; }
    selected = null;
    draw();
  };
  const step = (d) => { const i = idx + d; if (i >= 0 && i < hist.length) { idx = i; selected = null; draw(); } };

  /* ----- item model for the current folder ----- */
  function listing(id) {
    const folder = (nid) => ({ key: nid, name: NODES[nid].name, icon: NODES[nid].icon, open: () => go(nid) });
    switch (id) {
      case 'home':
        return { items: [
          folder('desktop'), folder('documents'), folder('this-pc'),
          { key: 'bin', name: 'Recycle Bin', icon: 'a-bin-full', open: () => launch('recycle-bin') },
        ] };
      case 'desktop': {
        const defs = [...DESKTOP_ICONS, ...(state.endingSeen ? [THANK_YOU_ICON] : []), ...BONUS_GAMES.filter((g) => state.bonus.restored.includes(g.id)).map(bonusDesktopIcon)];
        return { items: defs.map((d) => ({
          key: d.id, name: d.label, icon: d.icon,
          open: () => launch(d.id),
        })) };
      }
      case 'documents':
        return { items: DOCS.map((d) => ({
          key: d.name, name: d.name, icon: d.icon,
          open: () => showDialog({ title: d.name, kind: 'error', message: 'No app can open this file.', parent: win }),
        })) };
      case 'this-pc': {
        const pct = integrity();
        return { drives: true, items: [{
          key: 'c', name: 'Local Disk (C:)', icon: 'a-drive', drive: true,
          sub: `System Integrity: ${pct}%  (${repairedCount()}/${GAME_IDS.length} components repaired)`,
          meter: pct, open: () => go('c'),
        }] };
      }
      case 'system32':
        return { items: GAMES.map((g) => {
          const ok = state.repaired[g.id];
          const ext = g.component.split('.').pop();
          return {
            key: g.id, name: g.component, icon: SYS_ICON[ext] ?? 'a-sys', broken: !ok, badge: ok ? 'good' : 'bad',
            open: () => (ok
              ? showDialog({
                title: g.component, kind: 'info', parent: win,
                message: `${g.component} is running normally.`,
                buttons: [{ label: 'OK', primary: true }, { label: 'Replay', value: 'replay' }],
              }).result.then((v) => v === 'replay' && launch(g.id))
              : launch(g.id)),
          };
        }) };
      default:
        return { items: (NODES[id].children ?? []).map((c) => ({ key: c, name: NODES[c].name, icon: NODES[c].icon, open: () => go(c) })) };
    }
  }

  let current = [];
  function draw() {
    const id = here();
    const node = NODES[id];
    win.setTitle(node.name);
    backBtn.disabled = idx === 0;
    fwdBtn.disabled = idx >= hist.length - 1;
    upBtn.disabled = !node.parent;

    crumbEl.innerHTML = crumbs(id)
      .map((c) => `<button class="ex-crumb" data-go="${c}">${esc(NODES[c].name)}</button>`)
      .join('<span class="sep">›</span>');

    let active = id;                                   // deeper folders (C:, System32...) highlight their nearest sidebar ancestor
    while (active && !NAV_IDS.has(active)) active = NODES[active].parent;
    nav.innerHTML = NAV.map(([n, ic]) =>
      `<button data-go="${n}" class="${navDepth(n) ? 'sub' : ''}${n === active ? ' current' : ''}">${icon(ic, 18)}${esc(NODES[n].name)}</button>`
    ).join('') + `<button data-bin>${icon('a-bin-full', 18)}Recycle Bin</button>`;

    const { items, drives } = listing(id);
    current = items;
    main.innerHTML = items.length
      ? `<div class="ex-grid${drives ? ' drives' : ''}">${items.map((it, i) => itemMarkup(it, i)).join('')}</div>`
      : '<div class="ex-empty">This folder is empty.</div>';
    status.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  }

  function itemMarkup(it, i) {
    if (it.drive) {
      return `<button class="ex-item drive" data-i="${i}"><span class="art">${icon(it.icon, 56)}</span>` +
        `<span class="dinfo"><span class="dname">${esc(it.name)}</span>` +
        `<div class="meter" style="--meter:${meterColor(it.meter)}" role="progressbar" aria-label="System Integrity" aria-valuenow="${it.meter}" aria-valuemin="0" aria-valuemax="100"><i style="width:${it.meter}%"></i></div>` +
        `<small>${esc(it.sub)}</small></span></button>`;
    }
    const badge = it.badge ? `<span class="badge ${it.badge}">${icon(it.badge === 'bad' ? 'close' : 'check', 10)}</span>` : '';
    return `<button class="ex-item${it.broken ? ' broken' : ''}${selected === it.key ? ' selected' : ''}" data-i="${i}">` +
      `<span class="art">${icon(it.icon, 44)}${badge}</span><span class="name">${esc(it.name)}</span></button>`;
  }

  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) return go(g.dataset.go);
    if (e.target.closest('[data-bin]')) return launch('recycle-bin');
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') return step(-1);
    if (a === 'forward') return step(1);
    if (a === 'up') return go(NODES[here()].parent);
    const item = e.target.closest('.ex-item');
    if (item) {
      selected = current[item.dataset.i].key;
      main.querySelectorAll('.ex-item').forEach((el) => el.classList.toggle('selected', el === item));
    }
  });
  root.addEventListener('dblclick', (e) => {
    const item = e.target.closest('.ex-item');
    if (item) current[item.dataset.i]?.open();
  });
  root.addEventListener('keydown', (e) => {
    const item = e.target.closest('.ex-item');
    if (item && e.key === 'Enter') current[item.dataset.i]?.open();
  });

  // Integrity meter + System32 file states stay live.
  const off = bus.on('state:change', () => { if (['this-pc', 'system32', 'desktop'].includes(here())) draw(); });
  win.onClose = () => off();
  draw();
  return root;
}
