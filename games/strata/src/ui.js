// All the DOM of Strata: HUD (crosshair, hotbar, names, subtitles, saved indicator, F3), the menus, and the inventory / crafting table / furnace screens.
// It draws the models of inventory.js and forwards clicks; it holds no game rules. Block icons are rendered once at startup as little isometric cubes from the
// atlas (a 2D canvas, cached as data URLs): they are not assets.
import { CONFIG } from './config.js';
import { BLOCKS } from './blocks.js';
import { ITEMS, durabilityOf } from './items.js';
import { hudIcons } from './hudicons.js';
import { CATEGORIES } from './inventory.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'worlds', 'newworld', 'pause', 'settings', 'inv', 'death', 'end', 'error'];


const ageText = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };

export class UI {
  constructor() {
    this.handlers = {};
    this.screen = null;
    this.blockIcons = new Map();
    this.sigs = {};
    this.menu = null;
    this.hover = null;                                    // the slot under the pointer in an inventory screen: kept across redraws
    this.drag = null;
    this.timers = {};
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; if (b.dataset.act === 'rename-start') { this.#renameStart(b.closest('.world')); return; } this.emit(b.dataset.act, e); });
    for (const [id, key] of [['set-sens', 'sensitivity'], ['set-fov', 'fov'], ['set-view', 'viewDistance'], ['set-vol', 'volume']]) {
      $(id).addEventListener('input', () => { this.#readSettings(); this.#outputs(); });
    }
    for (const id of ['set-invert', 'set-music', 'set-diff', 'set-keepinv', 'set-compass', 'set-subtitles']) $(id).addEventListener('change', () => this.#readSettings());
    const inv = $('s-inv');
    inv.addEventListener('mousedown', (e) => this.#invDown(e));
    inv.addEventListener('mouseover', (e) => this.#invOver(e));
    inv.addEventListener('mouseleave', () => { this.hover = null; });
    inv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', () => { this.drag = null; });
    window.addEventListener('mousemove', (e) => { this.#moveCursor(e); });
  }

  on(name, fn) { (this.handlers[name] ??= []).push(fn); return this; }
  emit(name, ...a) { for (const fn of this.handlers[name] ?? []) fn(...a); }

  /** atlasImage / itemsImage: loaded <img> (or canvas) elements; atlas / items: the JSON files from the asset build. */
  init({ atlasImage, atlas, items, itemsUrl }) {
    this.atlasImage = atlasImage; this.atlas = atlas; this.items = items; this.itemsUrl = itemsUrl;
  }

  // ---------------------------------------------------------------- screens
  show(name) {
    this.screen = name;
    for (const s of SCREENS) $(`s-${s}`).hidden = s !== name;
    document.body.classList.toggle('menu-open', name === 'inv');                    // the HUD hotbar is hidden behind an open inventory screen
    if (name !== 'inv') { this.menu = null; $('cursor').hidden = true; $('tip').hidden = true; }
  }
  hud(on) { $('hud').hidden = !on; }
  progress(p, text) { $('load-bar').style.width = `${Math.round(p * 100)}%`; if (text) $('load-text').textContent = text; }
  title({ canContinue, continueName = '', worlds = 0, note = '', completed = null }) {
    $('b-continue').disabled = !canContinue; $('b-continue').textContent = canContinue ? `Continue: ${continueName}` : 'Continue'; $('b-worlds').textContent = worlds > 1 ? `Worlds (${worlds})` : 'Worlds'; $('b-worlds').disabled = !worlds;
    $('title-note').textContent = note;
    const t = $('title-trophy');
    t.hidden = !completed;
    if (completed) { const best = completed.byDifficulty ? Math.min(...Object.values(completed.byDifficulty).map((r) => r.timeMs)) : completed.timeMs, m = Math.floor(best / 60000), s = Math.floor((best % 60000) / 1000); t.textContent = `🏆 Kernel restored. Best time ${m}:${String(s).padStart(2, '0')}`; }
  }
  /** The ending screen: lines are appended to the terminal log; credits() starts the roll. */
  endLog(text) { const e = $('end-log'); e.textContent = text; }
  endCredits(lines) {
    const c = $('credits'); c.hidden = false;
    c.firstElementChild.innerHTML = lines.map((l) => (l.h ? `<h2>${l.h}</h2>` : `<p class="${l.dim ? 'dim' : ''}">${l.t}</p>`)).join('');
    c.firstElementChild.style.animation = 'none'; void c.offsetWidth; c.firstElementChild.style.animation = '';
  }
  endSkip(on) { $('end-skip').hidden = !on; }
  endReset() { $('end-log').textContent = ''; $('credits').hidden = true; $('end-skip').hidden = true; }
  newWorld({ placeholder = 'World 1' } = {}) { $('seed-input').value = ''; $('name-input').value = ''; $('name-input').placeholder = placeholder; }
  nameText() { return $('name-input').value.trim(); }
  /** The Worlds screen: one row per world (newest first) with Play, Rename and Delete; `armed` is the id whose Delete was clicked once. */
  worlds(list, { armed = null, last = null, bytes = 0, cap = 1 } = {}) {
    const host = $('world-list');
    host.textContent = '';
    for (const w of list) {
      const row = document.createElement('div');
      row.className = `world${w.id === last ? ' last' : ''}`; row.dataset.id = w.id;
      const info = document.createElement('div'); info.className = 'winfo';
      const nm = document.createElement('b'); nm.textContent = w.name; nm.className = 'wname';
      const meta = document.createElement('span'); meta.className = 'dim small';
      const ago = w.played ? ageText(Date.now() - w.played) : 'earlier';
      meta.textContent = [w.mode === 'creative' ? 'Creative' : w.mode === 'survival' ? 'Survival' : '', w.difficulty ? w.difficulty[0].toUpperCase() + w.difficulty.slice(1) : '', `${(w.data.length / 1048576).toFixed(2)} MB`, `played ${ago}`].filter(Boolean).join(' · ');
      info.append(nm, meta);
      const btns = document.createElement('div'); btns.className = 'wbtns';
      const mk = (act, text, cls = '') => { const b = document.createElement('button'); b.className = `btn small ${cls}`; b.dataset.act = act; b.textContent = text; return b; };
      btns.append(mk('play-world', 'Play'), mk('rename-start', 'Rename'), mk('delete-world', armed === w.id ? 'Really delete?' : 'Delete', armed === w.id ? 'danger' : ''));
      row.append(info, btns); host.append(row);
    }
    if (!list.length) { const p = document.createElement('p'); p.className = 'dim'; p.textContent = 'No worlds yet.'; host.append(p); }
    $('worlds-note').textContent = `${list.length} of 10 worlds · ${(bytes / 1048576).toFixed(2)} of ${(cap / 1048576).toFixed(1)} MB of browser storage used.`;
  }
  /** Rename: the name becomes a text box; Enter or leaving it keeps the new name, Escape cancels. */
  #renameStart(row) {
    const nm = row.querySelector('.wname');
    if (!nm || row.querySelector('input')) return;
    const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 24; inp.value = nm.textContent; inp.className = 'wedit'; inp.spellcheck = false;
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok) this.emit('rename-world', { target: row }, inp.value); else inp.replaceWith(nm); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
    nm.replaceWith(inp); inp.focus(); inp.select();
  }
  seedText() { return $('seed-input').value.trim(); }
  difficultyText() { return $('new-diff').value; }
  modeText() { return $('new-mode').value; }
  setNewMode(m) { $('new-mode').value = m; }
  /** Creative: no hearts or hunger on the HUD. */
  creativeHud(on) { $('vitals').hidden = !!on; }
  setNewDifficulty(d) { $('new-diff').value = d; }
  error(title, text) { $('err-title').textContent = title; $('err-text').textContent = text; this.show('error'); }
  pauseNote(t) { $('pause-note').textContent = t; }

  setSettings(s) {
    $('set-sens').value = s.sensitivity; $('set-fov').value = s.fov; $('set-view').value = s.viewDistance; $('set-vol').value = s.volume;
    $('set-invert').checked = !!s.invertY; $('set-music').checked = !!s.music;
    $('set-diff').value = s.difficulty ?? 'normal'; $('set-keepinv').checked = !!s.keepInventory; $('set-compass').checked = s.compass !== false; $('set-subtitles').checked = !!s.subtitles;
    this.#outputs();
  }
  #outputs() {
    const set = (id, v) => { $(id).parentElement.querySelector('output').textContent = v; };
    set('set-sens', `${Number($('set-sens').value).toFixed(2)}`); set('set-fov', `${$('set-fov').value}°`);
    set('set-view', `${$('set-view').value}`); set('set-vol', `${Math.round($('set-vol').value * 100)}%`);
  }
  #readSettings() {
    this.emit('settings-change', { sensitivity: Number($('set-sens').value), fov: Number($('set-fov').value), viewDistance: Number($('set-view').value), volume: Number($('set-vol').value), invertY: $('set-invert').checked, music: $('set-music').checked, difficulty: $('set-diff').value, keepInventory: $('set-keepinv').checked, compass: $('set-compass').checked, subtitles: $('set-subtitles').checked });
  }

  // ---------------------------------------------------------------- icons
  blockIcon(id) {
    let u = this.blockIcons.get(id);
    if (u) return u;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const o = [32, 4], e1 = [26, 14], e2 = [-26, 14], e3 = [0, 28], t = BLOCKS[id].tiles, clear = BLOCKS[id].kind === 'cutout';
    const face = (name, m, shade) => {
      const r = this.atlas.tiles[name];
      g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (clear) { g.fillStyle = 'rgba(170,205,235,0.28)'; g.fillRect(0, 0, 1, 1); }          // glass and leaves are see-through: give the icon a body so it reads on a dark slot
      g.drawImage(this.atlasImage, r.x, r.y, r.w, r.h, 0, 0, 1, 1);
      if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(0, 0, 1, 1); }
    };
    face(t[2], [e1[0], e1[1], e2[0], e2[1], o[0], o[1]], 0);                                 // top
    face(t[4], [e1[0], e1[1], e3[0], e3[1], o[0] + e2[0], o[1] + e2[1]], 0.22);               // front (+z) on the left
    face(t[0], [-e2[0], -e2[1], e3[0], e3[1], o[0] + e1[0] + e2[0], o[1] + e1[1] + e2[1]], 0.42);   // +x on the right
    g.setTransform(1, 0, 0, 1, 0, 0);
    u = c.toDataURL();
    this.blockIcons.set(id, u);
    return u;
  }
  #icon(stk) {
    const info = ITEMS[stk.id];
    if (info.icon.block !== undefined) return `<img class="ic" alt="" src="${this.blockIcon(info.icon.block)}">`;
    const r = this.items.items[info.icon.sheet], k = 34 / this.items.size;
    return `<div class="ic" style="background-image:url('${this.itemsUrl}');background-size:${this.items.w * k}px ${this.items.h * k}px;background-position:${-r.x * k}px ${-r.y * k}px;image-rendering:pixelated"></div>`;
  }
  #slotInner(stk) {
    if (!stk) return '';
    const info = ITEMS[stk.id], max = durabilityOf(stk.id);
    let h = this.#icon(stk);
    if (stk.n > 1) h += `<span class="ct">${stk.n}</span>`;
    if (max && stk.dur < max) h += `<span class="dur"><i style="width:${(stk.dur / max) * 100}%;background:hsl(${(stk.dur / max) * 120},80%,45%)"></i></span>`;
    return h;
  }
  slotHTML(stk, c, i, cls = '') { return `<div class="slot ${cls}" data-c="${c}" data-i="${i}">${this.#slotInner(stk)}</div>`; }

  // ---------------------------------------------------------------- HUD
  renderHotbar(inv) {
    const sig = JSON.stringify([inv.slots.slice(0, 9), inv.selected]);
    if (sig === this.sigs.hotbar) return;
    this.sigs.hotbar = sig;
    $('hotbar').innerHTML = inv.slots.slice(0, 9).map((s, i) => this.slotHTML(s, 'hot', i, i === inv.selected ? 'sel' : '')).join('');
  }
  #flash(id, text, ms) {
    const el = $(id); el.textContent = text; el.classList.add('on');
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => el.classList.remove('on'), ms);
  }
  flashName(text) { this.#flash('itemname', text, 1600); }
  subtitle(text, ms = 4500) { this.#flash('subtitle', text, ms); }
  saved(ok, text, ms) { const el = $('saved'); el.classList.toggle('bad', !ok); this.#flash('saved', text, ms ?? (ok ? 1400 : 7000)); }
  debug(text) { const el = $('f3'); el.hidden = !text; if (text) el.textContent = text; }

  // ---------------------------------------------------------------- survival HUD
  /** Hearts, food, armor and air for a Vitals. Redrawn only when something changed. */
  renderVitals(v, { hideFood = false } = {}) {
    const sig = `${Math.ceil(v.hp)}|${Math.ceil(v.hunger)}|${Math.ceil(v.air)}|${v.armorPoints}|${hideFood}`;
    if (sig === this.sigs.vitals) return;
    this.sigs.vitals = sig;
    const ic = hudIcons(), img = (src, cls = '') => `<img class="${cls}" alt="" src="${src}">`;
    const row = (value, kind, n = 10) => Array.from({ length: n }, (_, i) => { const left = value - i * 2; return img(ic[kind][left >= 2 ? 'full' : left >= 1 ? 'half' : 'empty'], left > 0 ? 'on' : ''); }).join('');
    $('hearts').innerHTML = row(Math.ceil(v.hp), 'heart'); $('hearts').classList.toggle('low', v.hp <= 4);
    $('food').innerHTML = hideFood ? '' : row(Math.ceil(v.hunger), 'food');
    $('armorbar').innerHTML = v.armorPoints > 0 ? row(v.armorPoints, 'armor') : '';
    $('armorbar').style.minHeight = v.armorPoints > 0 ? '18px' : '0';
    const bubbles = Math.ceil(v.air - 1e-6);
    $('air').innerHTML = bubbles < 10 ? Array.from({ length: 10 }, (_, i) => img(ic.bubble[i < bubbles ? 'full' : 'empty'])).join('') : '';
  }
  /** A red flash at the edge of the screen (the animation restarts on every hit). */
  hurt() { const e = $('hurt'); e.hidden = false; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); }
  /** Health bars over the mobs that were hit lately: [{ x, y (screen px), frac 0..1, name }]. The divs are pooled. */
  mobBars(list) {
    const host = $('bars');
    while (host.children.length < list.length) host.insertAdjacentHTML('beforeend', '<div class="mbar"><i></i></div>');
    [...host.children].forEach((el, i) => {
      const b = list[i];
      el.hidden = !b;
      if (!b) return;
      el.style.transform = `translate(${Math.round(b.x - 22)}px, ${Math.round(b.y)}px)`;
      el.firstElementChild.style.width = `${Math.round(b.frac * 100)}%`;
    });
  }
  /** The attack cooldown under the crosshair (null hides it). */
  attackBar(p) { const e = $('atkbar'); e.hidden = p === null || p >= 1; if (!e.hidden) e.firstElementChild.style.width = `${Math.round(p * 100)}%`; }
  /** Fade to black and back (sleeping through the night). */
  sleepFade() { const e = $('sleep'); e.hidden = false; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); setTimeout(() => { e.hidden = true; e.classList.remove('on'); }, 2400); }
  /** The Pop-up's ad: shows for `seconds` (the game clears it by calling adOverlay(0)); returns nothing. onClose is called when the player clicks the X. */
  adOverlay(seconds, onClose) {
    const e = $('ad');
    e.hidden = seconds <= 0;
    this.adLeft = seconds;
    if (!this.adBound) { this.adBound = true; $('ad-x').addEventListener('click', () => { this.adLeft = 0; $('ad').hidden = true; this.onAdClose?.(); }); }
    this.onAdClose = onClose;
  }
  /** The purple screen warp while standing in a Rift (0..1). */
  warp(f) { const e = $('warp'); e.hidden = f <= 0.01; e.style.opacity = Math.min(1, f).toFixed(2); e.style.transform = `scale(${1 + Math.min(1, f) * 0.25})`; }
  /**
   * The compass strip: N, E, S, W and any marker, placed by bearing relative to where you look. `items` = [{ bearing (radians, 0 = north, + = east), label, cls }]; heading likewise.
   */
  compass(on, heading, items) {
    const e = $('compass');
    e.classList.toggle('off', !on);
    if (!on) return;
    const strip = e.firstElementChild, span = Math.PI * 0.9, parts = ['<div class="tick"></div>'];
    for (const it of items) {
      let rel = (it.bearing - heading) % (Math.PI * 2);
      if (rel > Math.PI) rel -= Math.PI * 2; if (rel < -Math.PI) rel += Math.PI * 2;
      if (Math.abs(rel) > span / 2) continue;
      parts.push(`<span class="cm ${it.cls ?? ''}" style="left:${(50 + (rel / span) * 100).toFixed(1)}%">${it.label}</span>`);
    }
    strip.innerHTML = parts.join('');
  }
  /** The boss bar at the top (name, 0..1, colour). null hides it. */
  bossBar(b) {
    const e = $('bossbar');
    e.hidden = !b;
    if (!b) return;
    e.firstElementChild.textContent = b.name; e.lastElementChild.firstElementChild.style.width = `${Math.max(0, Math.min(1, b.frac)) * 100}%`; e.classList.toggle('green', !!b.green);
  }
  /** The drifting green log text of the Kernel's sky (built once, on and off). */
  logs(on) {
    const e = $('logs');
    e.hidden = !on;
    if (!on || e.childElementCount) return;
    const lines = ['[gc] marking reachable objects…', '[gc] 0 bytes freed', '[gc] sweep: heap fragmented 61%', '[gc] compacting arena…', '[gc] root set: 1 (player.exe)', '[gc] finalizers: 0', '[gc] WARNING: unreachable object found: you', '[gc] collection pending', '[gc] pause: 4096 ms', '[gc] mark phase 3/3'];
    lines.forEach((t, i) => { const d = document.createElement('div'); d.textContent = t; d.style.top = `${6 + (i * 9.3) % 78}%`; d.style.animationDuration = `${70 + (i * 13) % 50}s`; d.style.animationDelay = `-${(i * 17) % 60}s`; d.style.opacity = String(0.35 + (i % 4) * 0.12); e.append(d); });
  }
  burning(on) { $('burning').hidden = !on; }
  eating(p) { const e = $('eatbar'); e.hidden = p === null; if (p !== null) e.firstElementChild.style.width = `${Math.round(p * 100)}%`; }
  death({ cause, score, note }) { $('death-cause').textContent = cause; $('death-score').textContent = score; $('death-note').textContent = note ?? ''; this.show('death'); }

  // ---------------------------------------------------------------- inventory screens
  openMenu(menu) { this.menu = menu; this.show('inv'); this.#renderMenu(true); }
  closeMenu() { this.menu = null; }
  #sig() { const m = this.menu; return JSON.stringify([m.inv.slots, m.grid, m.out, m.cursor, m.furnace?.toJSON(), m.armor, m.chest, m.query, m.tab, m.list.length]); }

  /** Call every frame while a menu is open: redraws only when something changed (the furnace arrow moves smoothly with it). */
  refresh() { if (this.menu && this.screen === 'inv') this.#renderMenu(false); }

  #renderMenu(force) {
    const m = this.menu, sig = this.#sig();
    if (!force && sig === this.sigs.menu) return;
    this.crHad = !!this.crInput && document.activeElement === this.crInput;          // (the search box loses focus when its old panel is thrown away: remember it)
    this.crSel = this.crHad ? [this.crInput.selectionStart, this.crInput.selectionEnd] : null;
    this.sigs.menu = sig;
    const S = (stk, c, i, cls) => this.slotHTML(stk, c, i, cls);
    let top, title;
    if (m.kind === 'furnace') {
      const f = m.furnace;
      title = 'Furnace';
      top = `<div class="col">${S(f.input, 'in', 0)}<div class="flame" style="--f:${f.burning ? 1 : 0}"><i></i></div>${S(f.fuel, 'fuel', 0)}</div>` +
        `<div class="arrow" style="--p:${f.progress}"><i></i></div>${S(f.output, 'smelt', 0, 'take')}`;
    } else {
      title = m.kind === 'table' ? 'Crafting Table' : 'Inventory';
      top = `<div class="grid" style="grid-template-columns:repeat(${m.size},46px)">${m.grid.map((s, i) => S(s, 'craft', i)).join('')}</div><div class="arrow"><i style="width:${m.out ? 100 : 0}%"></i></div>${S(m.out, 'out', 0, 'take')}`;
      if (m.kind === 'inventory' && m.armor) top = `<div class="armorcol">${m.armor.map((s, i) => S(s, 'armor', i, `armor a${i}`)).join('')}<span class="armtotal">${m.armor.reduce((n, s) => n + (s ? ITEMS[s.id]?.armor?.points ?? 0 : 0), 0)} armor</span></div>` + top;
    }
    if (m.kind === 'creative') {
      title = 'Creative Inventory';
      const tabs = ['All', ...CATEGORIES].map((t) => `<button class="tab${m.tab === t ? ' on' : ''}" data-tab="${t}">${t}</button>`).join('');
      top = `<div class="crtop"><div id="cr-search-host"></div><div class="tabs">${tabs}</div></div><div class="grid catgrid" style="grid-template-columns:repeat(9,46px)">${m.list.map((e, i) => S({ id: e.id, n: 1 }, 'cat', i)).join('') || '<p class="dim">Nothing matches.</p>'}</div>` +
        `<div class="crnote">${m.list.length} item${m.list.length === 1 ? '' : 's'}. Click: a stack. Right-click: one. Click with an item on the cursor: delete it.</div>`;
    }
    if (m.kind === 'chest') { title = 'Chest'; top = `<div class="grid chestgrid" style="grid-template-columns:repeat(9,46px)">${m.chest.map((s, i) => S(s, 'chest', i)).join('')}</div>`; }
    const main = Array.from({ length: CONFIG.inv.main }, (_, k) => S(m.inv.slots[CONFIG.inv.hotbar + k], 'inv', CONFIG.inv.hotbar + k)).join('');
    const hot = Array.from({ length: CONFIG.inv.hotbar }, (_, k) => S(m.inv.slots[k], 'inv', k, k === m.inv.selected ? 'sel' : '')).join('');
    $('s-inv').innerHTML = `<div class="panel invp"><h3>${title}</h3><div class="top">${top}</div>` +
      `<div class="grid main" style="grid-template-columns:repeat(9,46px)">${main}</div><div class="grid hot" style="grid-template-columns:repeat(9,46px)">${hot}</div></div>`;
    this.#markHover();
    if (m.kind === 'creative') this.#mountSearch(m);
    this.#renderCursor();
  }

  /** The search box is created once and moved into every redraw, so it keeps focus and the cursor while you type. */
  #mountSearch(m) {
    if (!this.crInput) {
      const i = this.crInput = document.createElement('input');
      i.type = 'text'; i.id = 'cr-search'; i.placeholder = 'Search items…'; i.autocomplete = 'off'; i.spellcheck = false; i.maxLength = 30;
      i.addEventListener('input', () => { if (this.menu?.kind === 'creative') { this.menu.search(i.value); this.#renderMenu(true); } });
    }
    const had = this.crHad, [a, b] = this.crSel ?? [m.query.length, m.query.length];
    this.crInput.value = m.query;
    $('cr-search-host').append(this.crInput);
    if (had) { this.crInput.focus(); this.crInput.setSelectionRange(a, b); }
  }

  /** Re-apply the highlight after a redraw (the old element under the pointer is gone, and :hover only catches up on the next mouse move). */
  #markHover() {
    if (!this.hover) return;
    $('s-inv').querySelector(`.slot[data-c="${this.hover.c}"][data-i="${this.hover.i}"]`)?.classList.add('hov');
  }

  #renderCursor() {
    const c = $('cursor'), s = this.menu?.cursor;
    c.hidden = !s;
    if (s) c.innerHTML = this.#slotInner(s);
  }
  #moveCursor(e) {
    const c = $('cursor');
    if (!c.hidden) { c.style.transform = `translate(${e.clientX - 23}px, ${e.clientY - 23}px)`; }
    const tip = $('tip'), slot = e.target.closest?.('.slot');
    const info = slot && this.menu ? this.#slotAt(slot) : null;
    if (info && !this.menu.cursor) { tip.hidden = false; tip.textContent = ITEMS[info.id].name; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`; } else tip.hidden = true;
  }
  #slotAt(el) { const c = el.dataset.c, i = Number(el.dataset.i); return this.menu?.slotRef(c, i)?.get() ?? null; }

  #invDown(e) {
    const tab = e.target.closest?.('.tab');
    if (tab && this.menu?.kind === 'creative') { this.menu.search(this.menu.query, tab.dataset.tab); this.#renderMenu(true); return; }
    const el = e.target.closest('.slot');
    if (!el || !this.menu) return;
    e.preventDefault();
    const c = el.dataset.c, i = Number(el.dataset.i), btn = e.button === 2 ? 'right' : 'left';
    const had = !!this.menu.cursor;
    const ok = this.menu.click(c, i, btn, e.shiftKey);
    if (btn === 'right' && had && this.menu.cursor !== undefined) this.drag = { visited: new Set([`${c}:${i}`]) };
    if (ok) this.emit('menu-changed', { c, i, btn, shift: e.shiftKey });
    this.#renderMenu(true);
    this.#moveCursor(e);
  }
  #invOver(e) {
    const el = e.target.closest('.slot');
    $('s-inv').querySelectorAll('.slot.hov').forEach((n) => n.classList.remove('hov'));
    this.hover = el ? { c: el.dataset.c, i: el.dataset.i } : null;
    this.#markHover();
    if (!el || !this.drag || !this.menu?.cursor || !(e.buttons & 2)) return;
    const key = `${el.dataset.c}:${el.dataset.i}`;
    if (this.drag.visited.has(key)) return;
    this.drag.visited.add(key);
    if (this.menu.placeOne(el.dataset.c, Number(el.dataset.i))) { this.emit('menu-changed', {}); this.#renderMenu(true); }
  }
}
