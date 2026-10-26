// The Achievements & Secrets panel (taskbar button at the far left) and the two reset buttons (FINAL_SPEC §2.3, §3).
import { bus } from './events.js';
import { state, reset, hardReset } from './state.js';
import { ACHIEVEMENTS, EGGS } from './registry.js';
import { achievementCount } from './achievements.js';
import { gameSaveBytes } from './saves.js';
import { esc } from './ui.js';
import { showDialog, confirmDialog } from './dialogs.js';

const panel = () => document.getElementById('ach-panel');
const btn = () => document.getElementById('ach-btn');
let tab = 'ach';
let highlight = null;
let sig = '';
const signature = () => `${tab}|${achievementCount()}|${state.eggsFound.length}`;

export const isPanelOpen = () => !panel().hidden;

const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

function achievementsMarkup() {
  const have = ACHIEVEMENTS.filter((a) => a.id in state.achievements).sort((a, b) => state.achievements[b.id] - state.achievements[a.id]);
  const locked = ACHIEVEMENTS.filter((a) => !(a.id in state.achievements));
  const row = (a, on) => {
    const hide = !on && a.hidden;
    return `<div class="ach-item${on ? '' : ' locked'}${highlight === a.id ? ' hl' : ''}" data-ach="${a.id}"><span class="ach-ic">${hide ? '?' : a.icon}</span>` +
      `<span><b>${hide ? '???' : esc(a.name)}</b><small>${hide ? 'Hidden achievement' : esc(a.desc)}${on ? ` · ${fmtDate(state.achievements[a.id])}` : ''}</small></span></div>`;
  };
  return have.map((a) => row(a, true)).join('') + locked.map((a) => row(a, false)).join('');
}

function secretsMarkup() {
  const found = EGGS.filter((e) => state.eggsFound.includes(e.id));
  const left = EGGS.length - found.length;
  return (found.length ? found.map((e) => `<div class="ach-item"><span class="ach-ic">✦</span><span><b>${esc(e.name)}</b><small>${esc(e.desc ?? '')}</small></span></div>`).join('') : '<div class="ach-note">No secrets found yet.</div>') +
    (left ? `<div class="ach-note">${left} secret${left === 1 ? '' : 's'} still hidden.</div>` : '<div class="ach-note">Every secret found.</div>');
}

function render() {
  sig = signature();
  const p = panel();
  const keepScroll = p.querySelector('.ach-list')?.scrollTop ?? 0;
  p.innerHTML =
    `<div class="ach-head"><h2>Achievements &amp; Secrets</h2><p>Achievements ${achievementCount()}/${ACHIEVEMENTS.length} · Secrets ${state.eggsFound.length}/${EGGS.length}</p></div>` +
    `<div class="ach-tabs" role="tablist"><button role="tab" data-tab="ach" class="${tab === 'ach' ? 'on' : ''}" aria-selected="${tab === 'ach'}">Achievements</button>` +
    `<button role="tab" data-tab="sec" class="${tab === 'sec' ? 'on' : ''}" aria-selected="${tab === 'sec'}">Secrets</button></div>` +
    `<div class="ach-list" role="tabpanel">${tab === 'ach' ? achievementsMarkup() : secretsMarkup()}</div>` +
    '<div class="ach-foot"><button class="btn" data-reset>Reset progress…</button><button class="btn danger-solid" data-hard>Hard reset…</button></div>';
  const list = p.querySelector('.ach-list');
  list.scrollTop = keepScroll;
  const hl = list.querySelector('.hl');
  if (hl) { hl.scrollIntoView({ block: 'nearest' }); highlight = null; }
  document.getElementById('ach-badge').textContent = String(achievementCount());
}

export function openPanel({ highlight: h = null, tab: t = null } = {}) {
  bus.emit('start:close');
  highlight = h;
  tab = t ?? 'ach';
  render();
  panel().hidden = false;
  btn().setAttribute('aria-expanded', 'true');
  panel().querySelector('.ach-tabs .on')?.focus();
}
export function closePanel() {
  if (!isPanelOpen()) return;
  panel().hidden = true;
  btn().setAttribute('aria-expanded', 'false');
}

/** Reset progress: the game state only. */
export async function resetProgress() {
  const ok = await confirmDialog('Reset System32 to its corrupted state? Achievements, secrets, bonus games and your Strata world are kept.', { title: 'Reset progress', yes: 'Reset', no: 'Cancel' });
  if (!ok) return false;
  closePanel();
  reset();
  bus.emit('system:reboot', { skipLock: true });
  return true;
}

/** Hard reset: everything, after typing DELETE. */
export async function hardResetFlow() {
  const node = document.createElement('div');
  const strata = gameSaveBytes('strata');
  node.innerHTML = '<b>Hard reset deletes everything System32 stored in this browser:</b>' +
    `<ul class="hard-list"><li>${achievementCount()} achievement${achievementCount() === 1 ? '' : 's'}</li><li>${state.eggsFound.length} secret${state.eggsFound.length === 1 ? '' : 's'}</li>` +
    `<li>Strata world${strata ? `: ${fmtBytes(strata)}` : ': none saved'}</li><li>SpaceSaga best: ${state.bonus.best['space-saga'] ? `${state.bonus.best['space-saga'].toLocaleString('en-US')} m` : 'none'}</li>` +
    '<li>All repairs, settings and bonus games</li></ul>This cannot be undone. Type <b>DELETE</b> to continue.' +
    '<div class="hard-row"><input type="text" aria-label="Type DELETE" autocomplete="off" spellcheck="false"><button class="btn danger-solid" disabled>Delete everything</button></div>';
  const input = node.querySelector('input'), go = node.querySelector('button');
  const dlg = showDialog({ title: 'Hard reset', kind: 'error', message: node, width: 460, buttons: [{ label: 'Cancel', value: false, primary: true }] });
  input.addEventListener('input', () => { go.disabled = input.value !== 'DELETE'; });
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !go.disabled) go.click(); });
  go.addEventListener('click', () => { if (input.value !== 'DELETE') return; dlg._value = true; dlg.close(); });
  setTimeout(() => input.focus(), 50);
  if ((await dlg.result) !== true) return false;
  hardReset();
  location.reload();
  return true;
}

export function initAchievementsPanel() {
  render();
  btn().addEventListener('click', () => (isPanelOpen() ? closePanel() : openPanel()));
  panel().addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-reset]')) resetProgress();
    else if (e.target.closest('[data-hard]')) hardResetFlow();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isPanelOpen()) { closePanel(); btn().focus(); } });
  document.addEventListener('pointerdown', (e) => {
    if (!isPanelOpen()) return;
    if (panel().contains(e.target) || e.target.closest('#ach-btn, .dialog, .toast, .ctx-menu')) return;
    closePanel();
  }, true);
  bus.on('achievements:open', (o) => openPanel(o ?? {}));
  // re-render only when what the panel shows changed (a redraw between mouse-down and mouse-up would swallow a click)
  bus.on('state:change', () => { document.getElementById('ach-badge').textContent = String(achievementCount()); if (isPanelOpen() && signature() !== sig) render(); });
  bus.on('state:reset', () => render());
  bus.on('win:open', () => closePanel());
}
