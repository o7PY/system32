// Desktop icons: grid layout, selection, rubber-band, drag + snap, context menus, drag-to-bin.
import { bus, launch } from './events.js';
import { state, set, save, foundEgg, allRepaired } from './state.js';
import { DESKTOP_ICONS, THANK_YOU_ICON, ACCENTS } from './registry.js';
import { icon, esc, rand, reducedMotion } from './ui.js';
import { showMenu } from './menu.js';
import { showDialog, confirmDialog } from './dialogs.js';
import { toast } from './notifications.js';
import { WM } from './WindowManager.js';
import { bsod } from './system.js';
import { play } from './sound.js';

const SIZES = { medium: { w: 80, h: 90 }, large: { w: 104, h: 116 } };
const PAD = 4;
const host = () => document.getElementById('icons');

let items = [];                 // {id,label,icon,...,el,pos:{col,row}}
const selected = new Set();
const byId = (id) => items.find((i) => i.id === id);

/* ---------------- model ---------------- */
function wantedItems() {
  return [
    ...DESKTOP_ICONS,
    ...(state.endingSeen ? [THANK_YOU_ICON] : []),
    ...state.extraIcons.map((x) => ({
      id: x.id, label: x.label, icon: 'a-folder', type: 'File folder', size: '—', extra: true,
      lore: 'It was empty. Now it is corrupted.',
    })),
  ];
}

function render() {
  const h = host();
  h.innerHTML = '';
  items = wantedItems().map((def) => {
    const el = document.createElement('button');
    el.className = 'd-icon';
    el.dataset.id = def.id;
    el.setAttribute('aria-label', def.label);
    el.innerHTML =
      `<span class="d-inner"><span class="d-art">${icon(def.icon, 48)}<span class="d-check">${icon('check', 12)}</span></span>` +
      `<span class="d-label">${esc(def.label)}</span></span>`;
    h.append(el);
    return { ...def, el, pos: { col: 0, row: 0 } };
  });
  h.classList.toggle('size-large', state.iconSize === 'large');
  syncSelection();
  syncRepaired();
  layout();
}

function metrics() {
  const s = SIZES[state.iconSize] ?? SIZES.medium;
  const r = host().getBoundingClientRect();
  return { ...s, rows: Math.max(1, Math.floor((r.height - PAD) / s.h)), cols: Math.max(1, Math.floor((r.width - PAD) / s.w)) };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const key = (c, r) => `${c},${r}`;

function findFree(col, row, occ, m) {
  let best = null, bestD = Infinity;
  for (let c = 0; c < m.cols; c++) {
    for (let r = 0; r < m.rows; r++) {
      if (occ.has(key(c, r))) continue;
      const d = Math.abs(c - col) * 1.001 + Math.abs(r - row);
      if (d < bestD) { bestD = d; best = { col: c, row: r }; }
    }
  }
  return best ?? { col: 0, row: 0 };
}

function layout() {
  const m = metrics();
  const occ = new Set();
  const place = (it, col, row) => {
    it.pos = { col, row };
    occ.add(key(col, row));
    it.el.style.left = `${PAD + col * m.w}px`;
    it.el.style.top = `${PAD + row * m.h}px`;
  };
  const placed = new Set();
  for (const it of items) {                       // icons the user has positioned keep their cell
    const p = state.iconPositions[it.id];
    if (!p) continue;
    let { col, row } = p;
    col = clamp(col, 0, m.cols - 1);
    row = clamp(row, 0, m.rows - 1);
    if (occ.has(key(col, row))) ({ col, row } = findFree(col, row, occ, m));
    place(it, col, row);
    placed.add(it.id);
  }
  let i = 0;                                      // the rest fill column-first from the top-left
  for (const it of items) {
    if (placed.has(it.id)) continue;
    let spot = null;
    while (i < m.cols * m.rows && !spot) {
      const c = Math.floor(i / m.rows), r = i % m.rows;
      i++;
      if (!occ.has(key(c, r))) spot = { col: c, row: r };
    }
    spot ??= findFree(0, 0, occ, m);
    place(it, spot.col, spot.row);
  }
}

function persistPositions() {
  items.forEach((it) => { state.iconPositions[it.id] = { ...it.pos }; });
  save();
}

/* ---------------- selection ---------------- */
function syncSelection() {
  items.forEach((it) => it.el.classList.toggle('selected', selected.has(it.id)));
}
function selectOnly(id) { selected.clear(); selected.add(id); syncSelection(); }
function clearSelection() { selected.clear(); syncSelection(); }

function syncRepaired() {
  for (const it of items) {
    if (it.game) it.el.classList.toggle('done', !!state.repaired[it.game]);
  }
}

/* ---------------- interactions ---------------- */
function onPointerDown(e) {
  WM.blurAll();
  const iconEl = e.target.closest('.d-icon');
  if (iconEl) return iconDown(e, iconEl);
  if (e.button !== 0) return;
  rubberBand(e);
}

function iconDown(e, iconEl) {
  const id = iconEl.dataset.id;
  if (e.button === 2) { if (!selected.has(id)) selectOnly(id); return; }
  if (e.button !== 0) return;

  const ctrl = e.ctrlKey || e.metaKey;
  let deferSelect = false;
  if (ctrl) { selected.has(id) ? selected.delete(id) : selected.add(id); syncSelection(); }
  else if (!selected.has(id)) selectOnly(id);
  else deferSelect = true;       // clicking one of several selected icons: only collapse the selection if it was not a drag

  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  let group = [];
  let dx = 0, dy = 0;
  iconEl.setPointerCapture(e.pointerId);

  const move = (ev) => {
    dx = ev.clientX - sx;
    dy = ev.clientY - sy;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      group = [...selected].map(byId).filter(Boolean);
      group.forEach((it) => it.el.classList.add('dragging'));
    }
    if (dragging) group.forEach((it) => { it.el.style.transform = `translate(${dx}px, ${dy}px)`; });
  };
  const up = (ev) => {
    iconEl.removeEventListener('pointermove', move);
    iconEl.removeEventListener('pointerup', up);
    iconEl.removeEventListener('pointercancel', up);
    if (!dragging) { if (deferSelect) selectOnly(id); return; }
    drop(group, dx, dy, ev);
  };
  iconEl.addEventListener('pointermove', move);
  iconEl.addEventListener('pointerup', up);
  iconEl.addEventListener('pointercancel', up);
}

function snapBack(group) {
  for (const it of group) {
    it.el.classList.remove('dragging');
    it.el.classList.add('snapback');
    it.el.style.transform = '';
    setTimeout(() => it.el.classList.remove('snapback'), 420);
  }
}

function drop(group, dx, dy, ev) {
  const bin = byId('recycle-bin');
  if (bin && !group.includes(bin)) {
    const r = bin.el.getBoundingClientRect();
    if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
      snapBack(group);
      deleteItems(group);
      return;
    }
  }
  const m = metrics();
  const occ = new Set(items.filter((i) => !group.includes(i)).map((i) => key(i.pos.col, i.pos.row)));
  for (const it of group) {
    let col = clamp(Math.round(it.pos.col + dx / m.w), 0, m.cols - 1);
    let row = clamp(Math.round(it.pos.row + dy / m.h), 0, m.rows - 1);
    if (occ.has(key(col, row))) ({ col, row } = findFree(col, row, occ, m));
    occ.add(key(col, row));
    it.pos = { col, row };
    it.el.classList.remove('dragging');
    it.el.style.transform = '';
    it.el.style.left = `${PAD + col * m.w}px`;
    it.el.style.top = `${PAD + row * m.h}px`;
  }
  persistPositions();
}

function rubberBand(e) {
  const box = document.getElementById('selection-box');
  const h = host();
  const sx = e.clientX, sy = e.clientY;
  const ctrl = e.ctrlKey || e.metaKey;
  const base = ctrl ? new Set(selected) : new Set();
  if (!ctrl) clearSelection();
  document.activeElement?.blur?.();
  h.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const l = Math.min(sx, ev.clientX), t = Math.min(sy, ev.clientY);
    const w = Math.abs(ev.clientX - sx), hh = Math.abs(ev.clientY - sy);
    Object.assign(box.style, { display: 'block', left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${hh}px` });
    selected.clear();
    base.forEach((id) => selected.add(id));
    for (const it of items) {
      const r = it.el.getBoundingClientRect();
      if (r.left < l + w && r.right > l && r.top < t + hh && r.bottom > t) selected.add(it.id);
    }
    syncSelection();
  };
  const up = () => {
    box.style.display = 'none';
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', up);
    h.removeEventListener('pointercancel', up);
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up);
  h.addEventListener('pointercancel', up);
}

export function openItem(id) {
  const it = byId(id);
  if (!it) return;
  launch(it.extra ? 'new-folder' : id);
}

/* ---------------- deleting (mostly refused) ---------------- */
async function deleteItems(group) {
  for (const it of group) await deleteItem(it);
}

async function deleteItem(it) {
  if (it.id === 'this-pc') {
    const ok = await confirmDialog('Delete This PC?\nIt contains you.', { title: 'Delete This PC', kind: 'warning' });
    if (!ok) return;
    foundEgg('bin-pc');
    await bsod({ reboot: true });
    return;
  }
  if (it.game) {
    foundEgg('bin-game');
    toast({ title: 'Recycle Bin', kind: 'warn', text: 'This file is protected by the will of the previous user.' });
    return;
  }
  if (it.extra) {
    state.extraIcons = state.extraIcons.filter((x) => x.id !== it.id);
    delete state.iconPositions[it.id];
    set({ extraIcons: state.extraIcons });
    render();
    play('crumple');
    return;
  }
  const refusals = {
    readme: 'README.txt: you are going to need that.',
    edgy: 'Edgy refuses to be deleted.',
    'recycle-bin': 'You cannot recycle the Recycle Bin. We checked.',
    'thank-you': 'Please keep it. It took a while to write.',
  };
  toast({ title: 'Recycle Bin', kind: 'warn', text: refusals[it.id] ?? 'This item cannot be deleted.' });
}

/* ---------------- context menus ---------------- */
function showProperties(it) {
  const node = document.createElement('div');
  node.innerHTML =
    `<b>${esc(it.label)}</b>` +
    `<dl class="props-grid"><dt>Type</dt><dd>${esc(it.type)}</dd><dt>Location</dt><dd>C:\\Users\\User\\Desktop</dd>` +
    `<dt>Size</dt><dd>${esc(it.size)}</dd><dt>Modified</dt><dd>03-11-2019 02:14 AM</dd></dl>` +
    `<div class="dlg-sub">${esc(it.lore)}</div>`;
  showDialog({ title: `${it.label} Properties`, message: node, kind: 'info', width: 380 });
}

function iconMenu(it, x, y) {
  showMenu(x, y, [
    { label: 'Open', onClick: () => openItem(it.id) },
    { label: 'Delete', onClick: () => deleteItem(it) },
    { separator: true },
    { label: 'Properties', onClick: () => showProperties(it) },
  ]);
}

function sortByName() {
  [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })).forEach((it, i) => {
    const m = metrics();
    state.iconPositions[it.id] = { col: Math.floor(i / m.rows), row: i % m.rows };
  });
  save();
  layout();
}

export function refreshDesktop() {
  items.forEach((it) => {
    it.el.classList.remove('blink');
    void it.el.offsetWidth;
    it.el.classList.add('blink');
  });
  if (!allRepaired() && !reducedMotion()) {
    const d = document.getElementById('desktop');
    d.classList.add('glitch');
    setTimeout(() => d.classList.remove('glitch'), 420);
  }
}

function newFolder() {
  const id = `folder-${Date.now()}`;
  state.extraIcons.push({ id, label: 'New folder (corrupted)' });
  set({ extraIcons: state.extraIcons });
  render();
  selectOnly(id);
}

export function personalize() {
  if (!state.repaired.specificity) {
    toast({ title: 'Personalization', kind: 'err', text: 'Personalization is unavailable. Missing component: theme.dll' });
    return;
  }
  set({ accent: (state.accent + 1) % ACCENTS.length });
  toast({ title: 'Personalization', kind: 'ok', text: `Accent color: ${ACCENTS[state.accent].name}` });
}

function desktopMenu(x, y) {
  showMenu(x, y, [
    {
      label: 'View', submenu: [
        { label: 'Large icons', checked: state.iconSize === 'large', onClick: () => { set({ iconSize: 'large' }); render(); } },
        { label: 'Medium icons', checked: state.iconSize !== 'large', onClick: () => { set({ iconSize: 'medium' }); render(); } },
      ],
    },
    { label: 'Sort by', submenu: [{ label: 'Name', onClick: sortByName }] },
    { label: 'Refresh', onClick: refreshDesktop },
    { separator: true },
    { label: 'New', submenu: [{ label: 'Folder', onClick: newFolder }] },
    { separator: true },
    { label: 'Personalize', onClick: personalize },
  ]);
}

/** "New folder (corrupted)": an error dialog whose progress bar fills backwards. */
export function openCorruptedFolder() {
  foundEgg('new-folder');
  const node = document.createElement('div');
  node.innerHTML =
    `<b>Location is not available</b>The folder is corrupted and cannot be opened.<div class="dlg-sub" id="cf-status">Attempting repair… 0%</div>` +
    `<div class="dlg-progress"><i style="width:100%"></i></div>`;
  const bar = node.querySelector('i');
  const status = node.querySelector('#cf-status');
  const dlg = showDialog({ title: 'New folder (corrupted)', message: node, kind: 'error', width: 420 });
  const t0 = performance.now();
  const timer = setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / 5000);
    bar.style.width = `${(1 - p) * 100}%`;                   // fills backwards
    status.textContent = `Attempting repair… ${Math.round(p * 100)}%`;
    if (p >= 1 || dlg.closed) clearInterval(timer);
  }, 80);
}

/* ---------------- fx hooks used by other modules ---------------- */
export function revealIcons() {
  const h = host();
  items.forEach((it, i) => it.el.style.setProperty('--d', `${i * 50}ms`));
  requestAnimationFrame(() => h.classList.add('revealed'));
}
export const hideIcons = () => host().classList.remove('revealed');

const GLITCH_CHARS = '▓▒░#@%&$?!<>/\\|01';
export function scrambleLabel() {
  if (!items.length) return;
  const it = items[Math.floor(Math.random() * items.length)];
  const label = it.el.querySelector('.d-label');
  const original = it.label;
  let n = 0;
  const timer = setInterval(() => {
    label.classList.add('scrambling');
    label.textContent = [...original].map((c) => (c === ' ' ? ' ' : GLITCH_CHARS[Math.floor(rand(0, GLITCH_CHARS.length))])).join('');
    if (++n >= 4) { clearInterval(timer); label.textContent = original; label.classList.remove('scrambling'); }
  }, 75);
}

/** Konami egg: every icon orbits the screen centre for a while. */
export function orbitIcons(ms = 10000) {
  if (reducedMotion()) return;
  const hr = host().getBoundingClientRect();
  const cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2;
  const maxX = hr.width * 0.42, maxY = hr.height * 0.4;      // keep the orbit on screen
  const STEPS = 72;
  for (const it of items) {
    const r = it.el.getBoundingClientRect();
    const ox = r.left + r.width / 2 - cx, oy = r.top + r.height / 2 - cy;
    const phase = Math.atan2(oy / maxY, ox / maxX);
    const k = Math.min(1, Math.hypot(ox / maxX, oy / maxY));  // inner icons orbit closer to the centre
    const rx = Math.max(60, k * maxX), ry = Math.max(40, k * maxY);
    const at = (a) => `translate(${rx * Math.cos(a) - ox}px, ${ry * Math.sin(a) - oy}px)`;
    // fly out to the orbit, circle twice, fly home
    const frames = [{ offset: 0, transform: 'translate(0,0)' }];
    for (let i = 0; i <= STEPS; i++) {
      frames.push({ offset: 0.06 + (0.88 * i) / STEPS, transform: at(phase + (4 * Math.PI * i) / STEPS) });
    }
    frames.push({ offset: 1, transform: 'translate(0,0)' });
    it.el.animate(frames, { duration: ms, easing: 'linear' });
  }
}

export function setBinFull(full) {
  const bin = byId('recycle-bin');
  if (!bin) return;
  bin.el.querySelector('.d-art use').setAttribute('href', `assets/icons.svg#${full ? 'a-bin-full' : 'a-bin'}`);
}

/* ---------------- init ---------------- */
export function initDesktop() {
  render();
  const h = host();
  h.addEventListener('pointerdown', onPointerDown);
  h.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.d-icon');
    if (el) openItem(el.dataset.id);
  });
  h.addEventListener('keydown', (e) => {
    const el = e.target.closest('.d-icon');
    if (!el) return;
    if (e.key === 'Enter') { e.preventDefault(); openItem(el.dataset.id); }
    else if (e.key === 'Delete') deleteItems([...selected].map(byId).filter(Boolean));
  });
  h.addEventListener('focusin', (e) => {
    const el = e.target.closest('.d-icon');
    if (el && el.matches(':focus-visible')) selectOnly(el.dataset.id);
  });
  h.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('.d-icon');
    if (el) { const it = byId(el.dataset.id); if (it) iconMenu(it, e.clientX, e.clientY); }
    else { clearSelection(); desktopMenu(e.clientX, e.clientY); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'a' && (e.ctrlKey || e.metaKey) && document.body.dataset.phase === 'desktop' && !e.target.closest('textarea,input')) {
      if (WM.active) return;
      e.preventDefault();
      items.forEach((it) => selected.add(it.id));
      syncSelection();
    }
  });
  window.addEventListener('resize', layout);

  bus.on('state:change', () => {
    const want = wantedItems().map((d) => d.id).join('|');
    if (want !== items.map((i) => i.id).join('|')) render(); else syncRepaired();
  });
  bus.on('state:reset', () => { selected.clear(); render(); });
  bus.on('bin:state', setBinFull);
}
