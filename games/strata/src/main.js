// Strata: boot, the state machine (loading -> title -> entering -> playing <-> paused), input, the frame loop, saving through the shell, test hooks.
import { CONFIG } from './config.js';
import { B, BLOCKS, isFurnace, isSolid, itemOfBlock } from './blocks.js';
import { ITEMS, stack, blockItem, isTool, hasDurability } from './items.js';
import { World, createBackend } from './world.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { raycast, Miner, Drops, dropFor, useTool } from './interact.js';
import { Inventory, Menu } from './inventory.js';
import { Furnace } from './crafting.js';
import { UI } from './ui.js';
import { StrataAudio } from './audio.js';
import { serialize, deserialize, SaveError, fmtMB } from './save.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = Number(params.get(k)); return params.has(k) && Number.isFinite(v) ? v : d; };
const OPT = {
  seed: params.has('seed') ? params.get('seed') : null, flat: params.get('flat') === '1', worldSize: num('worldSize', CONFIG.worldSize),
  low: params.get('quality') === 'low', noWorker: params.get('noWorker') === '1', noCompress: params.get('noCompress') === '1', debug: params.get('debug') === '1',
};
const sdk = window.System32;
const $ = (id) => document.getElementById(id);
const IDLE = { x: 0, z: 0, jump: false, sneak: false, sprint: false };

/** A seed field value -> uint32: digits are the seed itself, any other text is hashed (FNV-1a); blank = random. */
export function seedFrom(text) {
  const t = String(text ?? '').trim();
  if (!t) return (Math.random() * 4294967296) >>> 0;
  if (/^\d+$/.test(t) && Number(t) <= 4294967295) return Number(t) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

const G = {
  phase: 'loading',            // loading | title | entering | playing | paused
  menu: null, save: null, soundOn: false,
  settings: { ...CONFIG.settings, viewDistance: OPT.low ? CONFIG.view.low : CONFIG.view.default },
  seed: 0, flat: false, worldSize: OPT.worldSize, spawn: { x: 0, y: 0, z: 0 },
  dayT: CONFIG.day.start, flags: {}, eggs: new Set(),
  keys: new Set(), tapped: new Set(), mouseLeft: false, lastW: 0, sprintLatch: false, fakeLock: false,
  saving: false, saveQueued: false, saveWait: null, lastSaveBytes: 0, saveTimer: 0,
  orbit: { x: 0, y: 70, z: 0, a: 0 }, entering: null, fps: 60, f3: false, f3Timer: 0, mineTick: 0, lastGround: true, now: 0,
};
let ui, audio, renderer, world, player, inv, drops, miner, backendInfo = { kind: '?', reason: '' };
const furnaces = new Map();

const isLocked = () => G.fakeLock || document.pointerLockElement === $('gl');
const eggOnce = (id) => { if (!G.eggs.has(id)) { G.eggs.add(id); sdk?.effect('egg', { egg: id }); } };
const listener = () => ({ x: player.pos.x, y: player.pos.y + player.eyeH, z: player.pos.z, yaw: player.yaw });
const blockAt = (x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));

// ---------------------------------------------------------------- boot
async function boot() {
  ui = new UI(); audio = new StrataAudio();
  ui.show('loading');
  let initResolve; const initGot = new Promise((r) => { initResolve = r; });
  sdk?.onInit((init) => {
    G.save = typeof init?.save === 'string' ? init.save : null;
    G.soundOn = !!init?.soundOn; audio.setAllowed(G.soundOn);
    if (G.phase === 'title') ui.title({ canContinue: !!G.save });
    initResolve();
  });
  sdk?.onSound((p) => { G.soundOn = !!p?.soundOn; audio.setAllowed(G.soundOn); if (G.soundOn) audio.unlock(); });
  sdk?.onPause(() => { if (G.phase === 'playing') pauseGame('shell'); else saveNow('shell'); audio.suspend(); });
  sdk?.onResume(() => { audio.resume(); });
  sdk?.onSaved((r) => onSaved(r));
  sdk?.ready();                                    // INIT (with the saved world) arrives while we load

  const base = 'assets/';
  const [atlas, itemsJson] = await Promise.all([fetch(`${base}atlas.json`).then((r) => r.json()), fetch(`${base}items.json`).then((r) => r.json())]);
  ui.progress(0.05);
  renderer = new Renderer($('gl'), { low: OPT.low });
  await renderer.init(`${base}atlas.png`, `${base}items.png`);
  renderer.setView(G.settings.viewDistance);
  renderer.setWorldSize(G.worldSize);
  renderer.setAtlas(atlas);
  const resize = () => renderer.resize(innerWidth, innerHeight);
  addEventListener('resize', resize); resize();
  ui.init({ atlasImage: renderer.tex.atlas.image, atlas, items: itemsJson, itemsUrl: `${base}items.png` });
  const rect = (name) => { const t = atlas.tiles[name], S = atlas.size, T = atlas.tile; return [(t.x + 0.5) / S, 1 - (t.y + T - 0.5) / S, (t.x + T - 0.5) / S, 1 - (t.y + 0.5) / S]; };
  const icon = (name) => { const t = itemsJson.items[name], s = itemsJson.size; return [(t.x + 0.5) / itemsJson.w, 1 - (t.y + s - 0.5) / itemsJson.h, (t.x + s - 0.5) / itemsJson.w, 1 - (t.y + 0.5) / itemsJson.h]; };
  G.atlasUV = { rect, icon };
  await audio.load(`${base}`, (p) => ui.progress(0.1 + p * 0.3, 'Restoring Strata.exe… recovering 400 hours of digging…'));
  const made = await createBackend({ noWorker: OPT.noWorker });
  backendInfo = made.info;
  world = new World({ backend: made.backend, atlas, size: G.worldSize });
  world.onMesh = (c, m) => renderer.addChunk(c, m);
  world.onUnload = (c) => renderer.removeChunk(c);
  world.view = G.settings.viewDistance;
  player = new Player(world); inv = new Inventory(); drops = new Drops(world); miner = new Miner();
  bindUI();
  bindInput();
  ui.setSettings(G.settings);
  await Promise.race([initGot, new Promise((r) => setTimeout(r, 1500))]);
  ui.progress(0.5, 'Generating the title world…');
  requestAnimationFrame(frame);                    // the loop also pumps the main-thread fallback, so it must run while the title world is awaited
  await startTitleWorld();
  if (OPT.debug) installHooks();
}

async function startTitleWorld() {
  G.phase = 'loading';
  world.setSize(CONFIG.worldSize);
  renderer.setWorldSize(CONFIG.worldSize);
  await world.setSeed(0, { flat: false });
  const sp = await world.backend.spawn();
  G.orbit = { x: sp.x, y: sp.y, z: sp.z, a: 0 };
  G.dayT = 0.12;
  player.teleport(sp.x, sp.y, sp.z);
  const t0 = performance.now();
  G.entering = { title: true, t0 };
  G.phase = 'entering';
}

function showTitle() {
  G.phase = 'title';
  ui.hud(false);
  ui.title({ canContinue: !!G.save, note: backendInfo.kind === 'inline' ? 'Running without a worker thread (slower chunk loading).' : '' });
  ui.show('title');
}

// ---------------------------------------------------------------- starting and leaving a world
/** Start (or resume) a world. save = a deserialized save, or null for a new world. */
async function startGame({ seed, flat = false, save = null, fake = false }) {
  ui.progress(0, 'Digging in…'); ui.show('loading'); ui.hud(false);
  G.phase = 'loading'; G.menu = null; G.keys.clear(); G.mouseLeft = false;
  const size = save ? save.worldSize : OPT.worldSize;
  G.worldSize = size; world.setSize(size); renderer.setWorldSize(size);
  Object.assign(G.settings, save?.settings ?? {});
  G.settings.viewDistance = Math.min(G.settings.viewDistance, OPT.low ? CONFIG.view.low : CONFIG.view.max);
  applySettings();
  await world.setSeed(seed, { flat, edits: save?.edits ?? new Map() });
  G.seed = seed; G.flat = flat;
  G.spawn = save ? save.spawn : await world.backend.spawn();
  const p = save ? save.player : { ...G.spawn, yaw: 0, pitch: 0 };
  player.teleport(p.x, p.y, p.z); player.yaw = p.yaw; player.pitch = p.pitch;
  inv.load(save?.inv ?? null);
  if (!save) inv.slots.fill(null);
  drops.clear(); miner.reset(); furnaces.clear();
  for (const [k, f] of Object.entries(save?.furnaces ?? {})) furnaces.set(k, makeFurnace(k, f));
  G.dayT = save?.time ?? CONFIG.day.start;
  G.flags = { ...(save?.flags ?? {}) };
  G.saveTimer = 0; G.fakeLock = fake;
  G.entering = { title: false, fake, t0: performance.now() };
  G.phase = 'entering';
}

function enterWorld(fake) {
  G.entering = null;
  ui.show(null); ui.hud(true); ui.renderHotbar(inv);
  if (fake || isLocked()) { G.phase = 'playing'; } else {
    G.phase = 'paused'; ui.pauseNote('Your world is ready. Press Resume to start digging.'); ui.show('pause');
  }
  if (!fake) saveNow('start');
}

async function quitToTitle() {
  ui.pauseNote('Saving…');
  await saveNow('quit', true);
  document.exitPointerLock?.();
  G.fakeLock = false; G.menu = null;
  await startTitleWorld();
}

function pauseGame(reason) {
  if (G.phase !== 'playing') return;
  G.phase = 'paused'; G.keys.clear(); G.mouseLeft = false; G.sprintLatch = false;
  if (G.menu) closeMenu(false);
  document.exitPointerLock?.();
  ui.pauseNote(reason === 'shell' ? 'The window lost focus.' : '');
  ui.show('pause');
  saveNow('pause');
}

function resumeGame() {
  if (G.phase !== 'paused') return;
  $('gl').requestPointerLock?.();
  G.phase = 'playing'; ui.show(null); ui.hud(true);
  audio.unlock();
}

// ---------------------------------------------------------------- settings
function applySettings() {
  const s = G.settings;
  audio.setVolume(s.volume); audio.setMusic(s.music);
  world.view = s.viewDistance; renderer.setView(s.viewDistance);
  renderer.camera.fov = s.fov; renderer.camera.updateProjectionMatrix();
  ui.setSettings(s);
}

// ---------------------------------------------------------------- saving
async function saveNow(reason, wait = false) {
  if (!sdk || !world || !(G.phase === 'playing' || G.phase === 'paused') || G.seed === undefined) return;
  if (G.saving) { G.saveQueued = true; return G.saveWait; }
  G.saving = true;
  const data = await serialize({
    seed: G.seed, worldSize: G.worldSize, flat: G.flat, spawn: G.spawn, player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch },
    inv: inv.toJSON(), furnaces: Object.fromEntries([...furnaces].map(([k, f]) => [k, f.toJSON()])), time: G.dayT, settings: G.settings, flags: G.flags, edits: world.edits,
  }, { compress: !OPT.noCompress });
  G.pendingSave = data;
  G.saveWait = new Promise((resolve) => { G.saveDone = resolve; });
  sdk.save(data);
  void reason;
  return wait ? G.saveWait : undefined;
}
function onSaved(r) {
  G.saving = false;
  G.lastSaveResult = r;
  if (r.ok) { G.save = G.pendingSave; G.lastSaveBytes = r.bytes; ui.saved(true, 'Saved'); }
  else if (r.error === 'too-large') ui.saved(false, `World too big to save: ${fmtMB(r.bytes)} / ${fmtMB(CONFIG.save.capBytes)}. Try removing some builds.`);
  else ui.saved(false, 'Could not save: the browser storage is full.');
  G.saveDone?.(r);
  if (G.saveQueued) { G.saveQueued = false; saveNow('queued'); }
}

// ---------------------------------------------------------------- UI wiring
function bindUI() {
  ui.on('continue', async () => {
    try {
      const save = await deserialize(G.save);
      await startGame({ seed: save.seed, flat: save.flat, save });
    } catch (e) {
      if (e instanceof SaveError) { ui.error('Save could not be loaded', `${e.message}. The saved world is damaged. You can start a new world.`); G.phase = 'title'; }
      else throw e;
    }
  });
  ui.on('new', () => { G.armed = false; ui.newWorld({ overwrite: !!G.save }); ui.show('newworld'); $('seed-input').focus(); });
  ui.on('start-new', () => {
    if (G.save && !G.armed) { G.armed = true; ui.armReplace(); return; }                    // a saved world is about to be replaced: ask once more
    startGame({ seed: seedFrom(ui.seedText() || OPT.seed), flat: OPT.flat });                 // ?seed=N and ?flat=1 are the test hooks for a blank seed field
  });
  ui.on('back-title', () => { showTitle(); });
  ui.on('settings', () => { G.settingsFrom = ui.screen; ui.show('settings'); });
  ui.on('back-settings', () => { if (G.settingsFrom === 'pause') ui.show('pause'); else showTitle(); });
  ui.on('settings-change', (s) => { Object.assign(G.settings, s); applySettings(); });
  ui.on('resume', () => resumeGame());
  ui.on('quit', () => quitToTitle());
  ui.on('menu-changed', () => {
    audio.ui('click');
    const m = G.menu;
    if (m?.crafted) {
      if (/_iron$/.test(m.crafted) && isTool(m.crafted) && !G.flags.firstIron) { G.flags.firstIron = true; audio.play('jingle.iron'); }
      m.crafted = null;
    }
  });
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && ui.screen === 'settings') { e.preventDefault(); ui.emit('back-settings'); } });
}

// ---------------------------------------------------------------- menus (inventory, table, furnace)
const furnaceKey = (x, y, z) => `${x},${y},${z}`;
function makeFurnace(key, state) {
  const f = new Furnace(state);
  const [x, y, z] = key.split(',').map(Number);
  f.onDone = () => audio.play('furnace.done', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, listener: listener() });
  return f;
}
function openMenu(kind, furnace = null) {
  if (G.phase !== 'playing' || G.menu) return;
  G.menu = new Menu(inv, kind, furnace);
  G.keys.clear(); G.mouseLeft = false; G.sprintLatch = false;
  if (!G.fakeLock) document.exitPointerLock?.();
  ui.openMenu(G.menu); ui.hud(true);
  audio.ui('open');
}
function closeMenu(relock = true) {
  if (!G.menu) return;
  const over = G.menu.close();
  for (const s of over) drops.spawn(player.pos.x, player.pos.y + 1.2, player.pos.z, s, { delayS: 1.5 });
  G.menu = null; ui.closeMenu();
  if (G.phase === 'playing') ui.show(null);
  audio.ui('close');
  if (relock && !G.fakeLock) $('gl').requestPointerLock?.();
}

// ---------------------------------------------------------------- input
function bindInput() {
  const canvas = $('gl');
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => { if (G.phase === 'playing' && !G.menu) { e.preventDefault(); selectSlot((inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9); } }, { passive: false });
  addEventListener('mousemove', (e) => { if (G.phase === 'playing' && !G.menu && isLocked()) player.look(e.movementX, e.movementY, G.settings.sensitivity, G.settings.invertY); });
  addEventListener('mousedown', (e) => {
    audio.unlock();
    if (G.phase !== 'playing' || G.menu) return;
    if (!isLocked()) { canvas.requestPointerLock?.(); return; }
    if (e.button === 0) G.mouseLeft = true;
    else if (e.button === 2) useOrPlace();
    else if (e.button === 1) { e.preventDefault(); pickBlock(); }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) G.mouseLeft = false; });
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && G.phase === 'playing' && !G.menu && !G.fakeLock) pauseGame(); });
  addEventListener('blur', () => { G.keys.clear(); G.mouseLeft = false; G.sprintLatch = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.phase === 'playing') pauseGame('shell'); });
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', (e) => { G.keys.delete(e.code); if (e.code === 'KeyW') G.sprintLatch = false; });
}

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyE', 'KeyQ', 'F3', 'ShiftLeft', 'ShiftRight', 'Tab', ...Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`)]);
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;                       // never a binding with Ctrl: Ctrl+W / Ctrl+T / Ctrl+N belong to the browser
  if (e.target instanceof HTMLInputElement) return;
  audio.unlock();
  if (G.phase !== 'playing') {
    if (G.phase === 'paused' && e.code === 'Escape') { e.preventDefault(); if (ui.screen === 'pause') resumeGame(); }
    return;
  }
  if (GAME_KEYS.has(e.code) || e.code === 'Escape') e.preventDefault();
  if (e.code === 'Escape') { if (G.menu) closeMenu(); else pauseGame(); return; }
  if (e.code === 'KeyE') { if (G.menu) closeMenu(); else openMenu('inventory'); return; }
  if (e.code === 'F3') { G.f3 = !G.f3; if (!G.f3) ui.debug(''); return; }
  if (G.menu) return;
  G.keys.add(e.code); G.tapped.add(e.code);                 // a tap shorter than one frame still counts for one simulation step
  if (e.code === 'KeyW' && !e.repeat) { const t = performance.now(); if (t - G.lastW < CONFIG.player.sprintTapS * 1000) G.sprintLatch = true; G.lastW = t; }
  if (e.code.startsWith('Digit')) selectSlot(Number(e.code.slice(5)) - 1);
  if (e.code === 'KeyQ' && !e.repeat) dropHeld();
}

function readInput() {
  const held = (c) => G.keys.has(c) || G.tapped.has(c);
  const z = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
  const r = { x: (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0), z, jump: held('Space'), sneak: held('KeyC'), sprint: held('ShiftLeft') || held('ShiftRight') || (G.sprintLatch && z > 0) };
  G.tapped.clear();
  return r;
}

function selectSlot(i) {
  inv.selected = i;
  const s = inv.held();
  ui.flashName(s ? ITEMS[s.id].name : '');
}

function dropHeld() {
  const s = inv.slots[inv.selected];
  if (!s) return;
  const one = inv.takeOne(inv.selected), e = player.eye(), d = player.dir();
  drops.spawn(e.x + d.x * 0.5, e.y - 0.3, e.z + d.z * 0.5, one, { vx: d.x * 5, vy: d.y * 5 + 1.5, vz: d.z * 5, delayS: 1.4 });
}

// ---------------------------------------------------------------- mining and placing
function target() { const e = player.eye(); return raycast(blockAt2, e, player.dir(), CONFIG.reach); }
const blockAt2 = (x, y, z) => world.getBlock(x, y, z);

function breakBlock(hit) {
  const id = hit.id, held = inv.held(), at = { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 };
  const stk = dropFor(id, held);
  if (isFurnace(id)) {
    const key = furnaceKey(hit.x, hit.y, hit.z), f = furnaces.get(key);
    if (f) { for (const s of [f.input, f.fuel, f.output]) if (s) drops.spawn(at.x, at.y, at.z, s); furnaces.delete(key); }
  }
  world.setBlock(hit.x, hit.y, hit.z, B.air);
  if (stk) drops.spawn(at.x, at.y - 0.1, at.z, stk);
  dropUnsupported(hit.x, hit.y, hit.z);
  audio.block('break', id, { at, listener: listener() });
  if (held && isTool(held.id)) {
    const r = useTool(held);
    inv.slots[inv.selected] = r.stack;
    if (r.broke) { audio.play('tool.break'); ui.subtitle(`${ITEMS[held.id].name} broke`, 2500); }
  }
  const egg = BLOCKS[id].egg;
  if (egg) { eggOnce(egg); ui.subtitle('Ad Block enabled.'); sdk?.effect('toast', { title: 'Strata', text: 'Ad Block enabled.' }); }
}

/** Which side of its cell a torch leans on, as the offset to the block that holds it. */
const TORCH_SUPPORT = { torch: [0, -1, 0], torch_px: [-1, 0, 0], torch_nx: [1, 0, 0], torch_pz: [0, 0, -1], torch_nz: [0, 0, 1] };
const TORCH_IDS = new Map(Object.entries(TORCH_SUPPORT).map(([n, off]) => [B[n], off]));
/** After a block was removed: torches that lost their support pop off as items. */
function dropUnsupported(x, y, z) {
  for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const tx = x + dx, ty = y + dy, tz = z + dz, off = TORCH_IDS.get(world.getBlock(tx, ty, tz));
    if (!off) continue;
    if (isSolid(world.getBlock(tx + off[0], ty + off[1], tz + off[2]))) continue;
    world.setBlock(tx, ty, tz, B.air);
    drops.spawn(tx + 0.5, ty + 0.3, tz + 0.5, stack('torch', 1));
  }
}
/** The block to set when the held item is used on `hit` (a torch picks floor or wall; null = it cannot go there). */
function blockFor(info, hit) {
  if (info.id === 'torch') {
    if (hit.ny === -1 || !isSolid(hit.id)) return null;
    return hit.ny === 1 ? B.torch : hit.nx === 1 ? B.torch_px : hit.nx === -1 ? B.torch_nx : hit.nz === 1 ? B.torch_pz : B.torch_nz;
  }
  return info.block;
}

/** Right click on a block with a use of its own that is not a menu (a bed, a rift, a chest): later phases hook in here. */
function useBlock() {}

function useOrPlace() {
  const hit = target();
  if (!hit) return;
  const def = BLOCKS[hit.id];
  if (def.use && !player.sneaking) {
    if (def.use === 'crafting') openMenu('table');
    else if (def.use === 'furnace') { const key = furnaceKey(hit.x, hit.y, hit.z); if (!furnaces.has(key)) furnaces.set(key, makeFurnace(key)); openMenu('furnace', furnaces.get(key)); }
    else useBlock(def, hit);
    return;
  }
  const held = inv.held(), info = held && ITEMS[held.id];
  if (!info || info.block === undefined) return;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (y < 0 || y >= CONFIG.height) return;
  const there = world.getBlock(x, y, z);
  if (there !== B.air && there !== B.water) return;
  const b = player.box();
  if (x + 1 > b.x0 && x < b.x1 && y + 1 > b.y0 && y < b.y1 && z + 1 > b.z0 && z < b.z1 && BLOCKS[info.block].solid) return;      // never inside the player
  const placed = blockFor(info, hit);
  if (placed === null || !world.setBlock(x, y, z, placed)) return;
  inv.takeOne(inv.selected);
  audio.play('place', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, listener: listener() });
  if (y === CONFIG.height - 1) { eggOnce('strata-cloud'); ui.subtitle('Saved to cloud storage.'); }
}

function pickBlock() {
  const hit = target();
  if (!hit) return;
  const item = itemOfBlock(hit.id) && ITEMS[itemOfBlock(hit.id)] ? itemOfBlock(hit.id) : blockItem(BLOCKS[hit.id].drop ? B[BLOCKS[hit.id].drop[0]] : -1);
  if (!item) return;
  const hot = inv.slots.findIndex((s, i) => i < 9 && s?.id === item);
  if (hot >= 0) { selectSlot(hot); return; }
  const main = inv.slots.findIndex((s, i) => i >= 9 && s?.id === item);
  if (main >= 0) { const t = inv.slots[inv.selected]; inv.slots[inv.selected] = inv.slots[main]; inv.slots[main] = t; selectSlot(inv.selected); }
}

// ---------------------------------------------------------------- simulation
function simulate(dt) {
  const locked = isLocked(), open = !!G.menu;
  const inp = open || !locked ? IDLE : readInput();
  if (G.sprintLatch && inp.z <= 0) G.sprintLatch = false;
  const ready = world.has(player.pos.x, player.pos.z);
  if (ready) {
    const wasGround = G.lastGround;
    player.update(dt, inp);
    if (player.onGround && !wasGround && player.lastLanded > 5) audio.block('step', blockAt(player.pos.x, player.pos.y - 0.5, player.pos.z), { vol: 1, at: player.pos, listener: listener() });
    G.lastGround = player.onGround;
    const stride = player.sprinting ? 2.3 : 1.9;
    if (player.onGround && !player.sneaking && player.stepDist >= stride) { player.stepDist = 0; audio.block('step', blockAt(player.pos.x, player.pos.y - 0.5, player.pos.z), { vol: 0.7 }); }
  }
  // camera
  const e = player.eye(), cam = renderer.camera;
  cam.position.set(e.x, e.y, e.z); cam.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  const fov = G.settings.fov + (player.sprinting ? 6 : 0);
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
  $('underwater').hidden = !player.headInWater;

  // interaction
  const hit = !open && locked ? target() : null;
  renderer.setTarget(hit);
  const state = miner.update(dt, hit, inv.held(), G.mouseLeft && !open && locked);
  renderer.setCrack(miner.target, miner.progress);
  if (state === 'mining') {
    G.mineTick -= dt;
    if (G.mineTick <= 0 && hit) { G.mineTick = CONFIG.mining.ticksS; audio.block('dig', hit.id, { at: { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }, listener: listener() }); }
    if (miner.bedrockT >= CONFIG.mining.bedrockEggS && !G.eggs.has('strata-bedrock')) { eggOnce('strata-bedrock'); ui.subtitle("It's called bedrock. It's not going anywhere."); }
  } else if (state === 'broke') { G.mineTick = 0; breakBlock(hit); }
  else G.mineTick = 0;

  // drops, furnaces, time, autosave, music
  const picks = drops.update(dt, player.pos, (s) => inv.add(s));
  if (picks.length) { audio.play('pickup', { vol: 0.8 }); }
  for (const [k, f] of furnaces) {
    f.update(dt);
    const [fx, fy, fz] = k.split(',').map(Number), cur = world.getBlock(fx, fy, fz), want = f.burning ? B.furnace_lit : B.furnace;
    if (isFurnace(cur) && cur !== want) world.setBlock(fx, fy, fz, want);       // a burning furnace glows (light 13)
  }
  G.dayT = (G.dayT + dt / CONFIG.day.lengthS) % 1;
  G.saveTimer += dt;
  if (G.saveTimer >= CONFIG.save.autosaveS) { G.saveTimer = 0; saveNow('autosave'); }
  audio.tick(dt);
  ui.renderHotbar(inv);
  if (G.menu) ui.refresh();
}

// ---------------------------------------------------------------- frame
let last = performance.now(), lastSim = last;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  const real = (now - last) / 1000;
  lastSim = last; last = now; G.now = now / 1000;
  void real;
  G.fps += (1 / Math.max(dt, 1e-3) - G.fps) * 0.05;
  if (!world) return;
  switch (G.phase) {
    case 'title': case 'loading': {
      orbitCamera(dt);
      world.update(G.orbit.x, G.orbit.z); world.pump();
      break;
    }
    case 'entering': {
      const en = G.entering;
      if (en.title) {
        orbitCamera(dt);
        world.update(G.orbit.x, G.orbit.z); world.pump();
        const missing = world.missingMeshes(G.orbit.x, G.orbit.z, 3);
        ui.progress(0.5 + 0.5 * (1 - Math.min(1, missing / 37)), 'Generating the title world…');
        if (missing === 0 || performance.now() - en.t0 > 12000) showTitle();
      } else {
        world.update(player.pos.x, player.pos.z); world.pump();
        const missing = world.missingMeshes(player.pos.x, player.pos.z, 2);
        ui.progress(1 - Math.min(1, missing / 13), 'Digging in…');
        const cam = renderer.camera, e = player.eye();
        cam.position.set(e.x, e.y, e.z); cam.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
        if (missing === 0 || performance.now() - en.t0 > 20000) enterWorld(en.fake);
      }
      break;
    }
    case 'playing': {
      // game time follows real time down to about 4 fps: a slow frame is simulated in steps of at most 1/30 s instead of being clipped
      for (let rem = Math.min(0.25, (now - lastSim) / 1000), step; rem > 1e-6; rem -= step) { step = Math.min(rem, 1 / 30); simulate(step); }
      world.update(player.pos.x, player.pos.z); world.pump();
      break;
    }
    case 'paused': world.update(player.pos.x, player.pos.z); world.pump(); renderer.setTarget(null); renderer.setCrack(null, 0); break;
  }
  renderer.setTime(G.dayT, G.now);
  renderer.setDrops(drops && G.phase !== 'title' ? drops.list.map((d) => ({ x: d.x, y: d.y + 0.12 + Math.sin(G.now * 2 + d.id) * 0.05, z: d.z, spin: G.now * 1.5 + d.id, visual: dropVisual(d.stack.id), light: lightOf(d.x, d.y + 0.2, d.z) })) : [], G.atlasUV);
  renderer.render(G.now);
  if (G.f3 && G.phase === 'playing') { G.f3Timer -= dt; if (G.f3Timer <= 0) { G.f3Timer = 0.25; ui.debug(debugText()); } }
}

/** [sky, block] light 0..1 of a point (an entity's cell); full daylight where the chunk has no light yet. */
const lightOf = (x, y, z) => { const l = world.lightAt(Math.floor(x), Math.floor(y), Math.floor(z)); return l ? [l.sky / 15, l.blk / 15] : [1, 0]; };
const dropVisual = (id) => (ITEMS[id].icon.block !== undefined ? { block: ITEMS[id].icon.block } : { sheet: ITEMS[id].icon.sheet });

function orbitCamera(dt) {
  const o = G.orbit; o.a += dt * 0.05;
  const r = 64, cam = renderer.camera;                                   // far and high enough to see the land, not the inside of a tree
  cam.position.set(o.x + Math.cos(o.a) * r, o.y + 34, o.z + Math.sin(o.a) * r);
  cam.lookAt(o.x, o.y - 4, o.z);
}

function debugText() {
  const p = player.pos, f = player.dir(), yawDeg = ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360;
  const face = ['north (-z)', 'east (+x)', 'south (+z)', 'west (-x)'][Math.round(yawDeg / 90) % 4];
  const bx = Math.floor(p.x), bz = Math.floor(p.z);
  return `Strata  ${Math.round(G.fps)} fps\nXYZ ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}\nChunk ${bx >> 4}, ${bz >> 4}  Biome ${world.biomeAt(bx, bz)}\nFacing ${face}  (${f.x.toFixed(2)} ${f.y.toFixed(2)} ${f.z.toFixed(2)})\n` +
    `Chunks ${world.loadedCount} loaded / ${world.meshedCount} meshed  view ${world.view}\nDraw calls ${renderer.info.calls}  tris ${renderer.info.triangles}\nWorker queue ${world.queueLength}  backend ${backendInfo.kind}\nSeed ${G.seed}  time ${(G.dayT * 24).toFixed(1)}h  edits ${world.editCount()}`;
}

// ---------------------------------------------------------------- test hooks (?debug=1)
function installHooks() {
  const api = {
    config: CONFIG, G, OPT, seedFrom,
    state: () => ({
      phase: G.phase, screen: ui.screen, menu: G.menu?.kind ?? null, pos: { ...player.pos }, vel: { ...player.vel }, yaw: player.yaw, pitch: player.pitch, onGround: player.onGround, inWater: player.inWater,
      chunks: world.loadedCount, meshed: world.meshedCount, queue: world.queueLength, backend: backendInfo.kind, backendReason: backendInfo.reason, seed: G.seed, flat: G.flat,
      dayT: G.dayT, edits: world.editCount(), drops: drops.list.length, selected: inv.selected, held: inv.held(), saving: G.saving, saveBytes: G.lastSaveBytes, saveResult: G.lastSaveResult ?? null,
      eggs: [...G.eggs], settings: { ...G.settings }, locked: isLocked(), draws: renderer.info.calls, flags: { ...G.flags }, sound: { allowed: audio.allowed, ctx: !!audio.ctx, count: audio.count, played: [...audio.played] },
    }),
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    setBlock: (x, y, z, id) => world.setBlock(x, y, z, typeof id === 'string' ? B[id] : id),
    give: (item, n = 1) => inv.add(hasDurability(item) ? stack(item) : stack(item, n)),
    tp: (x, y, z) => { player.teleport(x, y, z); },
    setTime: (t) => { G.dayT = t; },
    save: () => serialize({ seed: G.seed, worldSize: G.worldSize, flat: G.flat, spawn: G.spawn, player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch }, inv: inv.toJSON(), furnaces: Object.fromEntries([...furnaces].map(([k, f]) => [k, f.toJSON()])), time: G.dayT, settings: G.settings, flags: G.flags, edits: world.edits }, { compress: !OPT.noCompress }),
    load: async (str) => { const s = await deserialize(str); await startGame({ seed: s.seed, flat: s.flat, save: s, fake: true }); return s; },
    newWorld: (o = {}) => startGame({ seed: o.seed ?? 1, flat: !!o.flat, fake: o.fake !== false }),
    settle: async (radius = 2, ms = 60000) => { const t0 = performance.now(); while (world.missingMeshes(player.pos.x, player.pos.z, radius) && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return world.missingMeshes(player.pos.x, player.pos.z, radius); },
    look: (dx, dy) => player.look(dx, dy, G.settings.sensitivity, G.settings.invertY),
    face: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch; },
    target, openMenu, closeMenu, pause: () => pauseGame(), resume: () => { G.phase = 'playing'; ui.show(null); }, breakBlock, useOrPlace, pickBlock, selectSlot, saveNow, onKeyDown,
    world: () => world, player: () => player, inv: () => inv, drops: () => drops, audio: () => audio, renderer: () => renderer, ui: () => ui, miner: () => miner, furnaces: () => furnaces,
    mineHold: (on) => { G.mouseLeft = !!on; },
  };
  window.__STRATA = api;
}

boot().catch((e) => {
  console.error('[Strata]', e);
  ui?.error('Strata could not start', String(e?.message ?? e));
});
