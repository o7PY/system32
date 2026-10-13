// Strata: boot, the state machine (loading -> title -> entering -> playing <-> paused), input, the frame loop, saving through the shell, test hooks.
import { CONFIG } from './config.js';
import { B, BLOCKS, isFurnace, isSolid, itemOfBlock } from './blocks.js';
import { ITEMS, stack, blockItem, isTool, hasDurability, durabilityOf } from './items.js';
import { World, createBackend } from './world.js';
import { Renderer } from './renderer.js';
import { Mobs } from './entities.js';
import { installHostiles, Spawner } from './hostile.js';
import { Arrows, bowDamage, bowSpeed } from './projectiles.js';
import { Boss } from './boss.js';
import { ARENA, GATE } from './arena.js';
import { MobRenderer } from './mobmodel.js';
import { Player } from './player.js';
import { raycast, Miner, Drops, dropsFor, useTool } from './interact.js';
import { Inventory, Menu } from './inventory.js';
import { Furnace } from './crafting.js';
import { UI } from './ui.js';
import { Vitals, Hold, DIFFICULTIES, keepsInventoryOnDeath, scoreText } from './survival.js';
import { StrataAudio } from './audio.js';
import { serialize, deserialize, SaveError, fmtMB } from './save.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = Number(params.get(k)); return params.has(k) && Number.isFinite(v) ? v : d; };
const OPT = {
  seed: params.has('seed') ? params.get('seed') : null, flat: params.get('flat') === '1', worldSize: num('worldSize', CONFIG.worldSize),
  low: params.get('quality') === 'low', noWorker: params.get('noWorker') === '1', noCompress: params.get('noCompress') === '1', debug: params.get('debug') === '1',
  peaceful: params.get('peaceful') === '1',
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
  settings: { ...CONFIG.settings, viewDistance: OPT.low ? CONFIG.view.low : CONFIG.view.default, difficulty: OPT.peaceful ? 'peaceful' : 'normal' },
  seed: 0, flat: false, worldSize: OPT.worldSize, spawn: { x: 0, y: 0, z: 0 },
  dayT: CONFIG.day.start, flags: {}, eggs: new Set(),
  sites: { cracks: [], vaults: [] }, vaultT: 0, dimEdits: {}, dimDrops: {}, dimAnimals: {}, riftT: 0, afterEnter: null,
  keys: new Set(), tapped: new Set(), mouseLeft: false, mouseRight: false, attackClick: false, atk: 1, mobsOn: false, verifyBed: null, eat: null, hitSeen: 0, tilt: 0, dim: 'overworld', minedStep: 0, deathMarker: null, lastPos: null, lastDeath: null, lastW: 0, sprintLatch: false, fakeLock: false,
  saving: false, saveQueued: false, saveWait: null, lastSaveBytes: 0, saveTimer: 0,
  orbit: { x: 0, y: 70, z: 0, a: 0 }, entering: null, fps: 60, f3: false, f3Timer: 0, mineTick: 0, lastGround: true, now: 0,
};
let ui, audio, renderer, world, player, inv, drops, miner, vitals, mobs, mobRenderer, arrows, spawner, boss = null, arrowMesh, backendInfo = { kind: '?', reason: '' };
let chests = new Map();                       // 'x,y,z' (overworld) or 'dim|x,y,z' -> 27 slots (saved with the world)
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
    G.completed = init?.completed ?? null;
    G.soundOn = !!init?.soundOn; audio.setAllowed(G.soundOn);
    if (G.phase === 'title') ui.title({ canContinue: !!G.save, completed: G.completed });
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
  mobs = new Mobs({ world }); mobRenderer = new MobRenderer(renderer);
  arrows = new Arrows({ world, mobs }); installHostiles(mobs, arrows); spawner = new Spawner(mobs);
  world.onMesh = (c, m) => renderer.addChunk(c, m);
  world.onUnload = (c) => { renderer.removeChunk(c); if (G.mobsOn && G.dim === 'overworld') mobs.chunkUnloaded(c.cx, c.cz, G.seed); };
  world.onGenerated = (c) => { if (G.mobsOn && G.dim === 'overworld') mobs.chunkLoaded(c, G.seed); };
  world.view = G.settings.viewDistance;
  player = new Player(world); inv = new Inventory(); drops = new Drops(world); miner = new Miner(); vitals = new Vitals();
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
  G.phase = 'loading'; G.mobsOn = false; mobs.clear(); mobRenderer.clear(); arrows.clear();
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
  ui.title({ canContinue: !!G.save, completed: G.completed, note: backendInfo.kind === 'inline' ? 'Running without a worker thread (slower chunk loading).' : '' });
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
  G.mobsOn = false; mobs.clear(); mobRenderer.clear(); arrows.clear(); G.draw = null; ui.adOverlay(0);
  boss = null; ui.bossBar(null); ui.logs(false); crystalHits.clear();
  const startDim = save?.player?.dim ?? 'overworld';
  G.dimEdits = { overworld: save?.edits ?? new Map(), underlayer: save?.dims?.underlayer ?? new Map() };
  G.dimDrops = { ...(save?.otherDrops ?? {}) }; G.dimAnimals = {}; G.riftT = 0; G.afterEnter = null;
  await world.setSeed(seed, { flat, dim: startDim, edits: G.dimEdits[startDim] });
  G.seed = seed; G.flat = flat; G.dim = startDim;
  renderer.setDimension(startDim); renderer.setWorldSize(world.size);
  G.sites = await world.backend.sites().catch(() => ({ cracks: [], vaults: [] }));
  if (startDim === 'overworld') mobs.load(save?.animals ?? []); else G.dimAnimals.overworld = save?.animals ?? [];
  chests = new Map(Object.entries(save?.chests ?? {}));
  G.mobsOn = true;
  G.spawn = save ? save.spawn : await world.backend.spawn();
  const p = save ? save.player : { ...G.spawn, yaw: 0, pitch: 0 };
  player.teleport(p.x, p.y, p.z); player.yaw = p.yaw; player.pitch = p.pitch;
  inv.load(save?.inv ?? null);
  if (!save) inv.slots.fill(null);
  drops.clear(); miner.reset(); furnaces.clear();
  if (!save) G.settings.difficulty = ui.difficultyText();
  vitals.load(save?.vitals ?? null); vitals.difficulty = G.settings.difficulty;
  if (save?.drops) drops.load(save.drops);
  G.eat = null; G.mouseRight = false; G.lastDeath = null; G.hitSeen = vitals.hitCount; G.tilt = 0;
  for (const [k, f] of Object.entries(save?.furnaces ?? {})) furnaces.set(k, makeFurnace(k, f));
  G.dayT = save?.time ?? CONFIG.day.start;
  G.flags = { ...(save?.flags ?? {}) };
  if (!Array.isArray(G.flags.rifts)) G.flags.rifts = [];
  if (!G.flags.vaults || typeof G.flags.vaults !== 'object') G.flags.vaults = {};
  G.deathMarker = G.flags.death ?? null;
  G.saveTimer = 0; G.fakeLock = fake;
  G.entering = { title: false, fake, t0: performance.now() };
  G.phase = 'entering';
}

function enterWorld(fake) {
  G.entering = null;
  if (G.afterEnter) { const f = G.afterEnter; G.afterEnter = null; f(); }
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
  if (vitals) vitals.difficulty = DIFFICULTIES.includes(s.difficulty) ? s.difficulty : 'normal';
  ui.setSettings(s);
}

// ---------------------------------------------------------------- saving
/** The flags that go into the save: the death marker rides along. */
function saveFlags() { const f = { ...G.flags }; if (G.deathMarker) f.death = G.deathMarker; else delete f.death; return f; }

/** Everything the save needs: the active dimension's live data, and the stashed data of the other one. */
function saveState() {
  const ow = G.dim === 'overworld' ? world.edits : (G.dimEdits.overworld ?? new Map()), under = G.dim === 'underlayer' ? world.edits : (G.dimEdits.underlayer ?? new Map());
  const other = { ...G.dimDrops }; delete other[G.dim]; delete other.kernel;
  return {
    seed: G.seed, worldSize: G.worldSize, flat: G.flat, spawn: G.spawn, player: G.dim === 'kernel' ? { x: GATE.front.x, y: GATE.front.y, z: GATE.front.z, yaw: 0, pitch: 0, dim: 'underlayer' } : { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, dim: G.dim },       // the fight is not saved: quitting in the Kernel leaves you at the Gate
    inv: inv.toJSON(), furnaces: Object.fromEntries([...furnaces].map(([k, f]) => [k, f.toJSON()])), time: G.dayT, settings: G.settings, flags: saveFlags(), edits: ow, dims: { underlayer: under },
    vitals: vitals.toJSON(), drops: drops.toJSON(), otherDrops: other, animals: G.dim === 'overworld' ? mobs.toJSON() : (G.dimAnimals.overworld ?? []), chests: Object.fromEntries(chests),
  };
}

async function saveNow(reason, wait = false) {
  if (!sdk || !world || !(G.phase === 'playing' || G.phase === 'paused') || G.seed === undefined) return;
  if (G.saving) { G.saveQueued = true; return G.saveWait; }
  G.saving = true;
  const data = await serialize(saveState(), { compress: !OPT.noCompress });
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
  ui.on('respawn', () => respawn());
  ui.on('skip-credits', () => skipCredits());
  addEventListener('keydown', (e) => { if (G.phase === 'ending' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) { e.preventDefault(); skipCredits(); } });
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
const furnaceKey = (x, y, z) => (G.dim === 'overworld' ? `${x},${y},${z}` : `${G.dim}|${x},${y},${z}`);
const inThisDim = (key) => (G.dim === 'overworld' ? !key.includes('|') : key.startsWith(`${G.dim}|`));
function makeFurnace(key, state) {
  const f = new Furnace(state);
  const [x, y, z] = key.split('|').pop().split(',').map(Number);
  f.onDone = () => audio.play('furnace.done', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, listener: listener() });
  return f;
}
function openMenu(kind, furnace = null, extra = {}) {
  if (G.phase !== 'playing' || G.menu) return;
  G.menu = new Menu(inv, kind, furnace, { armor: vitals.armor, ...extra });
  if (kind === 'chest') audio.play('chest.open', { vol: 0.8 });
  G.keys.clear(); G.mouseLeft = false; G.sprintLatch = false;
  if (!G.fakeLock) document.exitPointerLock?.();
  ui.openMenu(G.menu); ui.hud(true);
  audio.ui('open');
}
function closeMenu(relock = true) {
  if (!G.menu) return;
  const was = G.menu.kind, over = G.menu.close();
  if (was === 'chest') { audio.play('chest.close', { vol: 0.8 }); checkRaided(); }
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
    if (e.button === 0) { G.mouseLeft = true; G.attackClick = true; }
    else if (e.button === 2) { G.mouseRight = true; if (inv.held()?.id === 'bow') startDraw(); else useOrPlace(); }
    else if (e.button === 1) { e.preventDefault(); pickBlock(); }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) G.mouseLeft = false; if (e.button === 2) { G.mouseRight = false; G.eat = null; if (G.draw) releaseBow(); else ui.eating(null); } });
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
  const r = { x: (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0), z, jump: held('Space'), sneak: held('KeyC'), sprint: held('ShiftLeft') || held('ShiftRight') || (G.sprintLatch && z > 0), canSprint: vitals.canSprint };
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
  G.minedStep++; vitals.stats.mined++;
  const id = hit.id, held = inv.held(), at = { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 };
  const stks = dropsFor(id, held);
  if (isFurnace(id)) {
    const key = furnaceKey(hit.x, hit.y, hit.z), f = furnaces.get(key);
    if (f) { for (const s of [f.input, f.fuel, f.output]) if (s) drops.spawn(at.x, at.y, at.z, s); furnaces.delete(key); }
  }
  if (id === B.cracked_bedrock) {
    world.setBlock(hit.x, hit.y, hit.z, B.rift);
    registerRift(hit.x, hit.y, hit.z);
    audio.play('vault.open', { at, listener: listener(), vol: 0.9 }); mobRenderer.puff(at.x, at.y + 0.5, at.z, 14, 0x9b6bff);
    ui.subtitle('The bedrock gives way. A Rift opens.', 4500);
    if (held && isTool(held.id)) wear(inv.selected, 1);
    return;
  }
  if (id === B.spawner && G.dim === 'underlayer') {
    const v = vaultNear(hit.x, hit.z, 14);
    if (v) { vaultState(v.index).spawner = true; openVaultDoor(v, true); }
  }
  if (BLOCKS[id].use === 'chest') { const key = furnaceKey(hit.x, hit.y, hit.z); for (const s of chests.get(key) ?? []) if (s) drops.spawn(at.x, at.y, at.z, s); chests.delete(key); }
  const bed = BLOCKS[id].bed, mate = bed ? bedMate(hit.x, hit.y, hit.z, bed) : null;
  world.setBlock(hit.x, hit.y, hit.z, B.air);
  if (mate && BLOCKS[world.getBlock(mate.x, mate.y, mate.z)]?.bed) world.setBlock(mate.x, mate.y, mate.z, B.air);       // a bed is two blocks and goes as one
  if (bed && G.flags.bed && [{ x: hit.x, y: hit.y, z: hit.z }, mate].some((c) => c && c.x === G.flags.bed.x && c.y === G.flags.bed.y && c.z === G.flags.bed.z)) G.flags.bed = null;
  for (const stk of stks) drops.spawn(at.x, at.y - 0.1, at.z, stk);
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
  if (info.id === 'chest') return B[`chest_${OPPOSITE[facingOf(player.yaw)]}`];                     // the front looks back at you
  return info.block;
}

/** Right click with an armor piece in hand: put it on (swapping with what is worn in that slot). */
function equipArmor() {
  const held = inv.held(), slot = ITEMS[held.id].armor.slotN, cur = vitals.armor[slot];
  vitals.armor[slot] = held; inv.slots[inv.selected] = cur ?? null;
  audio.play('armor.equip', { vol: 0.8 });
}

/** The way a horizontal direction points, as one of n e s w (the player's look). */
const DIR4 = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
function facingOf(yaw) { const fx = -Math.sin(yaw), fz = -Math.cos(yaw); return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 'e' : 'w') : (fz > 0 ? 's' : 'n'); }
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
/** The other half of a bed: a foot's head lies one block toward `dir`, a head's foot one block back. */
function bedMate(x, y, z, bed) { const v = DIR4[bed.dir], k = bed.part === 'foot' ? 1 : -1; return { x: x + v[0] * k, y, z: z + v[1] * k }; }

/** Place a two-block bed: the foot where you aimed, the head one block further the way you look. Both need free air and ground below. */
function placeBed(x, y, z) {
  const d = facingOf(player.yaw), v = DIR4[d], hx = x + v[0], hz = z + v[1];
  const free = (a, b, c) => world.getBlock(a, b, c) === B.air && isSolid(world.getBlock(a, b - 1, c));
  const pb = player.box();
  const inPlayer = (a, b, c) => a + 1 > pb.x0 && a < pb.x1 && b + 1 > pb.y0 && b < pb.y1 && c + 1 > pb.z0 && c < pb.z1;
  if (!free(x, y, z) || !free(hx, y, hz) || inPlayer(x, y, z) || inPlayer(hx, y, hz)) return false;
  world.setBlock(x, y, z, B[`bed_foot_${d}`]); world.setBlock(hx, y, hz, B[`bed_head_${d}`]);
  return true;
}

/** The bed (foot position) you respawn at, if it is still there and its head room is free: a point to stand at, or null. A bed in an unloaded chunk is trusted and checked once it loads. */
function bedSpawn() {
  const b = G.flags.bed;
  if (!b) return null;
  if (world.has(b.x, b.z)) {
    const ok = BLOCKS[world.getBlock(b.x, b.y, b.z)]?.bed && !isSolid(world.getBlock(b.x, b.y + 1, b.z)) && !isSolid(world.getBlock(b.x, b.y + 2, b.z));
    if (!ok) { G.flags.bed = null; ui.subtitle('Your bed was missing or obstructed.', 4000); return null; }
  } else G.verifyBed = { ...b };
  return { x: b.x + 0.5, y: b.y + 0.6, z: b.z + 0.5 };
}

/** Right click on a block with a use of its own that is not a menu: chests and beds. */
function useBlock(def, hit) {
  if (def.use === 'chest') {
    const key = furnaceKey(hit.x, hit.y, hit.z);
    if (!chests.has(key)) chests.set(key, vaultLootAt(hit) ?? Array(27).fill(null));
    G.openChest = { key, x: hit.x, y: hit.y, z: hit.z };
    openMenu('chest', null, { chest: chests.get(key) });
  } else if (def.use === 'bed') sleepIn(hit);
}

/** Right click on a bed: it always sets your respawn point; at night with no monster within 8 blocks it also skips to the morning. */
function sleepIn(hit) {
  if (G.dim === 'underlayer' || G.dim === 'kernel') { eggOnce('strata-sleep-underlayer'); ui.subtitle("You can't sleep here. Something is compiling.", 4500); return; }
  const bed = BLOCKS[hit.id].bed, foot = bed.part === 'foot' ? { x: hit.x, y: hit.y, z: hit.z } : bedMate(hit.x, hit.y, hit.z, bed);
  G.flags.bed = foot;
  const night = G.dayT > 0.52 && G.dayT < 0.98;
  const near = mobs.list.some((m) => !m.dead && m.def.kind === 'hostile' && Math.hypot(m.x - player.pos.x, m.y - player.pos.y, m.z - player.pos.z) < 8);
  if (!night) { ui.subtitle('Respawn point set. You can only sleep at night.', 3500); return; }
  if (near) { ui.subtitle("You can't sleep now: there are monsters nearby.", 3500); return; }
  audio.play('bed.use', { vol: 0.8 });
  ui.sleepFade();
  setTimeout(() => { G.dayT = 0; ui.subtitle('Good morning. Respawn point set.', 3000); }, 900);
}

function useOrPlace() {
  const worn = inv.held();
  if (worn && ITEMS[worn.id].armor) { equipArmor(); return; }
  const hit = target(), ent = mobTarget();
  if (ent && (!hit || ent.dist <= hit.dist)) { useOnMob(ent.mob); return; }
  if (!hit) return;
  if (hit.id === B.vault_door && G.dim === 'underlayer' && inGate(hit) && tryOpenGate()) return;
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
  if (info.id === 'bed') { if (!placeBed(x, y, z)) return; }
  else if (placed === null || !world.setBlock(x, y, z, placed)) return;
  inv.takeOne(inv.selected);
  audio.play('place', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, listener: listener() });
  if (y === CONFIG.height - 1) { eggOnce('strata-cloud'); ui.subtitle('Saved to cloud storage.'); }
}

// ---------------------------------------------------------------- the bow
/** Hold the right button with a bow in hand and an arrow somewhere in the inventory: the string draws for up to 1 s, letting go shoots (damage 2 to 9 by draw). */
function startDraw() {
  const ammo = inv.slots.findIndex((s) => s?.id === 'arrow');
  if (ammo < 0) { ui.subtitle('You have no arrows.', 1800); return; }
  G.draw = { t: 0 };
  audio.play('bow.draw', { vol: 0.8 });
}
function releaseBow() {
  const d = G.draw; G.draw = null; ui.eating(null);
  if (!d || d.t < 0.15 || inv.held()?.id !== 'bow') return;
  const ammo = inv.slots.findIndex((s) => s?.id === 'arrow');
  if (ammo < 0) return;
  inv.takeOne(ammo);
  const e = player.eye(), v = player.dir(), dmg = bowDamage(d.t);
  arrows.shoot(e.x + v.x * 0.5, e.y - 0.15 + v.y * 0.5, e.z + v.z * 0.5, v.x, v.y, v.z, bowSpeed(d.t), dmg, { mine: true });
  audio.play('bow.shoot', { vol: 0.9 });
  wear(inv.selected, 1);
  vitals.addExhaustion(0.05);
}

// ---------------------------------------------------------------- mobs: targeting, melee, shearing
const mobTarget = () => mobs.raycast(player.eye(), player.dir(), CONFIG.attack.reach);

/** A used-up amount of durability from a slot: the item breaks (and the slot empties) at 0. */
function wear(slot, amount = 1) {
  const s = inv.slots[slot];
  if (!s || !hasDurability(s.id)) return;
  const dur = (s.dur ?? durabilityOf(s.id)) - amount;
  if (dur <= 0) { inv.slots[slot] = null; audio.play('tool.break'); ui.subtitle(`${ITEMS[s.id].name} broke`, 2500); } else inv.slots[slot] = { ...s, dur };
}

/** Right click on a mob: shears take the wool of a sheep without killing it (it regrows in 2 minutes). */
function useOnMob(m) {
  const held = inv.held();
  if (held?.id === 'shears' && m.def.shearable && !m.sheared && !m.dead) {
    m.sheared = true; m.regrow = m.def.woolRegrowS;
    drops.spawn(m.x, m.y + 0.6, m.z, stack('wool', 2 + Math.floor(Math.random() * 2)));
    audio.play('bed.use', { at: { x: m.x, y: m.y, z: m.z }, listener: listener(), vol: 0.9 });
    wear(inv.selected, 1);
  }
}

/** One melee hit. Damage is by item (hand 1, wood sword 4 ... cobalt 8) and scales with the cooldown (0.6 s); a hit while falling is a critical (x1.5). */
function attack(m) {
  const held = inv.held(), a = CONFIG.attack, base = ITEMS[held?.id]?.attack ?? a.hand, prog = Math.min(1, G.atk / a.cooldownS);
  let dmg = base * (0.2 + 0.8 * prog);
  const crit = prog > 0.9 && !player.onGround && player.vel.y < 0 && !player.inWater;
  if (crit) dmg *= a.critMul;
  G.atk = 0;
  const at = { x: m.x, y: m.y + 0.5, z: m.z };
  const ray = mobs.raycast(player.eye(), player.dir(), a.reach), e0 = player.eye(), dv = player.dir();
  const point = ray && ray.mob === m ? { x: e0.x + dv.x * ray.dist, y: e0.y + dv.y * ray.dist, z: e0.z + dv.z * ray.dist } : { x: m.x, y: m.y + 1, z: m.z };
  mobs.damage(m, dmg, { from: player.pos, knockback: a.knockback * (0.4 + 0.6 * prog), type: 'player', point });
  audio.play(held?.id?.startsWith('sword') ? 'hit.heavy' : 'hit.melee', { at, listener: listener(), vol: 0.9 });
  if (crit && G.settings.subtitles) ui.subtitle('Critical hit', 1200);
  if (held && ITEMS[held.id].tool) wear(inv.selected, held.id.startsWith('sword') ? 1 : 2);
  vitals.addExhaustion(0.1);
}

/** What the monsters need to know about the world and you; hurt() is how they reach your health. */
function hostileCtx() {
  return {
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, w: CONFIG.player.width, h: CONFIG.player.height, dead: vitals.dead }, dayT: G.dayT, now: G.now, peaceful: vitals.peaceful,
    surfaceRules: G.dim === 'overworld', lightAt: (x, y, z) => world.lightAt(x, y, z),
    hurt: (amount, o) => vitals.damage(amount, o),
    knock: (dx, dz, k) => { const d = Math.hypot(dx, dz) || 1; player.vel.x += dx / d * k; player.vel.z += dz / d * k; player.vel.y = Math.max(player.vel.y, 3.2); },
  };
}
/** Where a monster may appear: the first standable cell (solid below, two free above) going down from y0. */
function groundAt(x, z, y0) {
  if (!world.has(x, z)) return null;
  for (let y = Math.min(CONFIG.height - 3, y0); y > 1; y--) {
    if (isSolid(world.getBlock(x, y - 1, z)) && world.getBlock(x, y, z) === B.air && world.getBlock(x, y + 1, z) === B.air) return y;
  }
  return null;
}
function spawnEnv(ctx) {
  const e = player.eye(), d = player.dir();
  return {
    player: ctx.player, dayT: G.dayT, peaceful: vitals.peaceful, difficulty: vitals.difficulty, lightAt: ctx.lightAt, dim: G.dim, ground: (x, z, y0) => groundAt(x, z, G.dim === 'underlayer' ? Math.min(y0, CONFIG.underlayer.height - 5) : y0),
    inView: (x, y, z) => { const dx = x - e.x, dy = y - e.y, dz = z - e.z, l = Math.hypot(dx, dy, dz) || 1; return (dx * d.x + dy * d.y + dz * d.z) / l > 0.5; },
  };
}

/** Arrows landing: a hit on you, on a mob, a stick in a block, or one picked up again. */
function arrowEvents() {
  for (const ev of arrows.takeEvents()) {
    const a = ev.arrow, at = { x: a.x, y: a.y, z: a.z };
    if (ev.type === 'hit-player') {
      const from = a.shooter ? { x: a.shooter.x, z: a.shooter.z } : null;
      vitals.damage(a.damage, { type: a.fire ? 'fireball' : 'arrow', name: `a ${a.shooter?.def?.name ?? 'Rattler'}`, from });
      if (a.fire) vitals.burn = Math.max(vitals.burn, a.burnS);
      audio.play('arrow.hit', { at, listener: listener(), vol: 0.9 });
    } else if (ev.type === 'hit-mob') {
      mobs.damage(ev.mob, a.damage, { from: player.pos, knockback: 2.5, type: 'player', point: { x: a.x, y: a.y, z: a.z } });
      audio.play('arrow.hit', { at, listener: listener(), vol: 0.9 });
      if (ev.mob.def.kind === 'hostile') ev.mob.data.angry = true;
    } else if (ev.type === 'burst') mobRenderer.puff(a.x, a.y, a.z, 8, 0xff7a2a);
    else if (ev.type === 'stick') {
      audio.play('arrow.hit', { at, listener: listener(), vol: 0.5 });
      if (a.mine && a.cell?.id === B.kernel_crystal) crystalHit(a.cell);
    }
    else if (ev.type === 'pickup') { const left = inv.add(stack('arrow', 1)); if (left) drops.spawn(player.pos.x, player.pos.y + 1, player.pos.z, left); audio.play('pickup', { vol: 0.6 }); }
  }
}

/** What the mobs did this step: sounds, drops, smoke. */
function mobEvents() {
  const L = listener(), range = CONFIG.mobs.hearRange;
  for (const ev of mobs.takeEvents()) {
    const m = ev.mob, at = { x: m.x, y: m.y + m.h * 0.5, z: m.z }, dist = Math.hypot(at.x - L.x, at.z - L.z);
    if (ev.type === 'voice') { if (dist < range) { audio.voice(m.def.voice, 'idle', { at, listener: L, vol: 0.8 }); subtitle(`${m.def.name} ${VOICE_VERB[m.def.voice] ?? 'calls'}`, at); } }
    else if (ev.type === 'hurt') { audio.voice(m.def.voice, 'hurt', { at, listener: L }); subtitle(`${m.def.name} hurt`, at); }
    else if (ev.type === 'crumble') { mobRenderer.puff(m.x, m.y + 0.8, m.z, 12, 0xbbbbbb); }
    else if (ev.type === 'draw') { audio.play('bow.draw', { at, listener: L, vol: 0.7 }); subtitle(`${m.def.name} draws a bow`, at); }
    else if (ev.type === 'shoot') audio.play(ev.fire ? 'boss.stomp' : 'bow.shoot', { at, listener: L, vol: ev.fire ? 0.5 : 0.8 });
    else if (ev.type === 'dash') { audio.voice(m.def.voice, 'hurt', { at, listener: L, vol: 0.8 }); subtitle(`${m.def.name} dashes`, at); }
    else if (ev.type === 'teleport') { mobRenderer.puff(m.x, m.y + 0.6, m.z, 10, 0xff3cdc); audio.voice(m.def.voice, 'idle', { at, listener: L }); }
    else if (ev.type === 'glitch-swap') glitchSwap(m, ev.picks);
    else if (ev.type === 'shield') { audio.play(ev.on ? 'boss.crystal' : 'boss.stomp', { at, listener: L, vol: 0.7 }); if (ev.on) subtitle('Vault Warden raises its shield', at); }
    else if (ev.type === 'block') { audio.play('arrow.hit', { at, listener: L, vol: 0.9 }); ui.subtitle('Blocked by the shield: hit it from behind', 1500); }
    else if (ev.type === 'swing') audio.play('sword.swing', { at, listener: L, vol: 0.7 });
    else if (ev.type === 'pounce') { audio.voice(m.def.voice, 'hurt', { at, listener: L, vol: 0.9 }); subtitle(`${m.def.name} pounces`, at); }
    else if (ev.type === 'overlay') { ui.adOverlay(ev.seconds); audio.voice('popup', 'idle', { vol: 1 }); subtitle('Pop-up beeps', at); }
    else if (ev.type === 'die') {
      audio.voice(m.def.voice, 'die', { at, listener: L });
      if (m.type === 'popup' && ev.by === 'player' && inv.slots.slice(0, 9).some((s) => s?.id === 'popup')) { eggOnce('strata-popup-adblock'); ui.subtitle('Ad Block worked as intended.', 4500); }
      for (const d of ev.drops) drops.spawn(m.x, m.y + 0.4, m.z, stack(d.id, d.n));
      mobRenderer.puff(m.x, m.y + 0.3, m.z, 8);
      if (ev.by === 'player') vitals.stats.mobs++;
      if (m.type === 'warden' && m.data.home) { vaultState(m.data.home.index).warden = true; ui.subtitle('The Vault Warden falls. The chest is yours.', 4000); shake(0.8); }
    }
  }
}
const GLITCH_BLOCKS = [B.basalt, B.ash, B.scorched_stone, B.air, B.scorched_stone, B.basalt];
/** The Glitch rewrites a few blocks around where it lands (never bedrock, Rifts, vault parts, or the cell you stand in). */
function glitchSwap(m, picks) {
  const pb = player.box();
  for (const [dx, dy, dz, k] of picks) {
    const x = Math.floor(m.x) + dx, y = Math.floor(m.y) + dy, z = Math.floor(m.z) + dz, cur = BLOCKS[world.getBlock(x, y, z)], nb = GLITCH_BLOCKS[k];
    if (!cur || cur.hardness < 0 || cur.rift || cur.emit >= 12 || BLOCKS[nb].solid && x + 1 > pb.x0 && x < pb.x1 && y + 1 > pb.y0 && y < pb.y1 && z + 1 > pb.z0 && z < pb.z1) continue;
    if (cur.name === 'lava' || cur.name === 'water') continue;
    world.setBlock(x, y, z, nb);
  }
}
const VOICE_VERB = { warden: 'groans', daemon: 'crackles', glitch: 'glitches', pig: 'oinks', cow: 'moos', sheep: 'baas', chicken: 'clucks', shambler: 'groans', rattler: 'rattles', crawler: 'hisses', popup: 'beeps' };
/** "Pig oinks (left)": the direction of a sound relative to where you look. */
function subtitle(text, at) {
  if (!G.settings.subtitles) return;
  const dx = at.x - player.pos.x, dz = at.z - player.pos.z, side = dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw), front = -(dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw));
  const dir = Math.abs(side) > Math.abs(front) ? (side > 0 ? 'right' : 'left') : front > 0 ? 'ahead' : 'behind';
  ui.subtitle(`${text} (${dir})`, 1800);
}

/** The y a mob would stand at on a grass top near (x, z) (two free blocks above), or null (also when that chunk is not loaded). */
function grassNear(x, z) {
  const bx = Math.floor(x), bz = Math.floor(z);
  if (!world.has(bx, bz)) return null;
  for (let y = CONFIG.height - 3; y > CONFIG.seaLevel; y--) {
    const id = world.getBlock(bx, y, bz);
    if (id === B.air) continue;
    return id === B.grass && world.getBlock(bx, y + 1, bz) === B.air && world.getBlock(bx, y + 2, bz) === B.air ? y + 1 : null;
  }
  return null;
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
    const px = player.pos.x, pz = player.pos.z;
    player.update(dt, inp);
    survive(dt, Math.hypot(player.pos.x - px, player.pos.z - pz));
    if (player.onGround && !wasGround && player.lastLanded > 5) audio.block('step', blockAt(player.pos.x, player.pos.y - 0.5, player.pos.z), { vol: 1, at: player.pos, listener: listener() });
    G.lastGround = player.onGround;
    const stride = player.sprinting ? 2.3 : 1.9;
    if (player.onGround && !player.sneaking && player.stepDist >= stride) { player.stepDist = 0; audio.block('step', blockAt(player.pos.x, player.pos.y - 0.5, player.pos.z), { vol: 0.7 }); }
  }
  // camera
  const e = player.eye(), cam = renderer.camera;
  const sh = G.shake > 0 ? G.shake : 0; if (sh) G.shake = Math.max(0, G.shake - dt * 1.6);
  cam.position.set(e.x + (Math.random() - 0.5) * sh * 0.25, e.y + (Math.random() - 0.5) * sh * 0.25, e.z + (Math.random() - 0.5) * sh * 0.25); cam.rotation.set(player.pitch, player.yaw, G.tilt * Math.min(1, vitals.hurtT / 0.45), 'YXZ');       // a hit tilts the view toward where it came from
  const fov = G.settings.fov + (player.sprinting ? 6 : 0);
  if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
  $('underwater').hidden = !player.headInWater;

  // interaction: a mob in reach and in front of the block is what you hit; otherwise the block is what you mine
  const blockHit = !open && locked ? target() : null, ent = !open && locked ? mobTarget() : null;
  const hitMob = !!ent && (!blockHit || ent.dist <= blockHit.dist), hit = hitMob ? null : blockHit;
  G.atk = Math.min(1, G.atk + dt / CONFIG.attack.cooldownS);
  if (hitMob && ((G.attackClick) || (G.mouseLeft && G.atk >= 1))) attack(ent.mob);
  G.attackClick = false;
  ui.attackBar(locked && !open ? G.atk : null);
  renderer.setTarget(hit);
  const state = miner.update(dt, hit, inv.held(), G.mouseLeft && !open && locked && !hitMob);
  renderer.setCrack(miner.target, miner.progress);
  if (state === 'mining') {
    G.mineTick -= dt;
    if (G.mineTick <= 0 && hit) { G.mineTick = CONFIG.mining.ticksS; audio.block('dig', hit.id, { at: { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }, listener: listener() }); }
    if (miner.bedrockT >= CONFIG.mining.bedrockEggS && !G.eggs.has('strata-bedrock')) { eggOnce('strata-bedrock'); ui.subtitle("It's called bedrock. It's not going anywhere."); }
  } else if (state === 'broke') { G.mineTick = 0; breakBlock(hit); }
  else G.mineTick = 0;

  checkRift(dt);
  if (G.dim === 'underlayer') vaultTick(dt);
  compassHud();
  if (G.draw) { G.draw.t += dt; if (!(G.mouseRight && locked && !open && inv.held()?.id === 'bow')) releaseBow(); else ui.eating(Math.min(1, G.draw.t)); }
  // eating: hold the right button with food in hand (1.6 s), only while hungry
  const heldNow = inv.held(), food = heldNow && ITEMS[heldNow.id].food;
  if (G.mouseRight && locked && !open && food && vitals.hunger < CONFIG.survival.maxHunger && !vitals.dead) {
    if (!G.eat || G.eat.id !== heldNow.id) { G.eat = { id: heldNow.id, hold: new Hold(CONFIG.eatS), tick: 0 }; audio.play('eat', { vol: 0.7 }); }
    G.eat.tick += dt;
    if (G.eat.hold.update(dt)) finishEating();
    else { if (G.eat.tick > 0.3) { G.eat.tick = 0; audio.play('eat', { vol: 0.6 }); } ui.eating(G.eat.hold.progress); }
  } else if (G.eat) { G.eat = null; ui.eating(null); }

  // drops, furnaces, time, autosave, music
  if (G.mobsOn) {
    const ctx = hostileCtx();
    if (G.dim !== 'kernel') spawner.update(dt, spawnEnv(ctx));
    if (boss) bossStep(dt, ctx);
    mobs.update(dt, ctx);
    arrows.update(dt, ctx.player);
    arrows.pickup({ x: player.pos.x, y: player.pos.y, z: player.pos.z });
    arrowEvents();
    if (G.dim === 'overworld') mobs.trickle(dt, player.pos, grassNear);
    for (const m of mobs.list) { const dx = player.pos.x - m.x, dz = player.pos.z - m.z; m.look.yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(-dx, -dz) - m.yaw)) * (Math.hypot(dx, dz) < 8 ? 1 : 0); }
    mobEvents();
  }
  if (G.verifyBed && world.has(G.verifyBed.x, G.verifyBed.z)) {              // a bed in a chunk that was not loaded at respawn: check it now
    const b = G.verifyBed; G.verifyBed = null;
    if (!BLOCKS[world.getBlock(b.x, b.y, b.z)]?.bed) { G.flags.bed = null; player.teleport(G.spawn.x, G.spawn.y, G.spawn.z); ui.subtitle('Your bed was missing or obstructed.', 4000); }
  }
  for (const d of drops.list) if (d.stack.id === 'kernel_core' && d.y < -12 && !d.dead) {            // thrown into the void: it comes back (the callback to the Recycle Bin joke)
    d.dead = true; const left = inv.add({ ...d.stack }); if (left) drops.spawn(player.pos.x, player.pos.y + 1, player.pos.z, left);
    eggOnce('strata-recycle'); ui.subtitle('This file is protected by the will of the previous user.', 6000); audio.play('pickup', { vol: 0.8 });
  }
  const picks = drops.update(dt, player.pos, (s) => inv.add(s));
  if (picks.length) { audio.play('pickup', { vol: 0.8 }); }
  for (const [k, f] of furnaces) {
    f.update(dt);
    if (!inThisDim(k)) continue;
    const [fx, fy, fz] = k.split('|').pop().split(',').map(Number), cur = world.getBlock(fx, fy, fz), want = f.burning ? B.furnace_lit : B.furnace;
    if (isFurnace(cur) && cur !== want) world.setBlock(fx, fy, fz, want);       // a burning furnace glows (light 13)
  }
  G.dayT = (G.dayT + dt / CONFIG.day.lengthS) % 1;
  G.saveTimer += dt;
  if (G.saveTimer >= CONFIG.save.autosaveS) { G.saveTimer = 0; saveNow('autosave'); }
  audio.tick(dt);
  if (ui.adLeft > 0) { ui.adLeft -= dt; if (ui.adLeft <= 0) ui.adOverlay(0); }
  ui.renderHotbar(inv);
  ui.mobBars(mobBarsNow());
  ui.renderVitals(vitals);
  ui.burning(vitals.burn > 0);
  if (G.deathMarker && !drops.list.some((d) => d.death)) G.deathMarker = null;              // the pile was picked up (or timed out)
  if (G.menu) ui.refresh();
}

// ---------------------------------------------------------------- survival: damage, eating, death, respawn
/** One step of health, hunger, air and the damage sources. `moved` = the horizontal distance walked this step. */
function survive(dt, moved) {
  const env = { inWater: player.inWater, headInWater: player.headInWater, inLava: player.inLava, headInSolid: player.headInSolid, y: player.pos.y,
    sprintM: player.sprinting ? moved : 0, jumped: player.jumped, mined: G.minedStep, fall: player.takeFall() };
  player.jumped = false; G.minedStep = 0;
  vitals.update(dt, env);
  if (vitals.hitCount !== G.hitSeen) { G.hitSeen = vitals.hitCount; onHurt(); }
  if (vitals.dead) die();
}

/** The red flash, the hurt sound and the tilt toward the side the damage came from. */
function onHurt() {
  audio.play('player.hurt', { vol: 0.9 });
  ui.hurt();
  const d = vitals.hurtDir;
  if (d) { const dx = d.x - player.pos.x, dz = d.z - player.pos.z, side = dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw); G.tilt = (side >= 0 ? -1 : 1) * 0.14; }
  else G.tilt = (Math.random() < 0.5 ? -1 : 1) * 0.08;
  if (G.settings.subtitles) ui.subtitle('You are hurt', 1500);
}

function finishEating() {
  const id = G.eat.id;
  vitals.eat(id);
  inv.takeOne(inv.selected);
  const back = ITEMS[id].food.returns;
  if (back) { const left = inv.add(stack(back, 1)); if (left) drops.spawn(player.pos.x, player.pos.y + 1.2, player.pos.z, left); }
  G.eat = null; ui.eating(null);
  if (vitals.nausea > 0) ui.subtitle('You feel sick…', 2500);
}

/** Where the player comes back: the bed (if it is still there and free), else the world spawn. */
function respawnPoint() { return bedSpawn() ?? { x: G.spawn.x, y: G.spawn.y, z: G.spawn.z }; }

function die() {
  if (G.phase !== 'playing') return;
  if (G.menu) closeMenu(false);
  G.phase = 'dead'; G.keys.clear(); G.mouseLeft = false; G.mouseRight = false; G.eat = null; ui.eating(null);
  document.exitPointerLock?.();
  const keep = keepsInventoryOnDeath(G.settings, G.dim), at = { x: player.pos.x, y: player.pos.y + 0.5, z: player.pos.z };
  if (!keep) {
    const all = [...inv.slots, ...vitals.armor].filter(Boolean);
    for (const s of all) drops.spawn(at.x, at.y, at.z, s, { delayS: 2, ttl: CONFIG.survival.deathDropS, death: true });
    inv.slots.fill(null); vitals.armor = [null, null, null, null];
    if (all.length) G.deathMarker = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z), dim: G.dim };
  }
  G.lastDeath = { cause: vitals.causeText, keep, at };
  audio.play('player.death');
  ui.hud(false); $('underwater').hidden = true; ui.burning(false);
  ui.death({ cause: vitals.causeText, score: scoreText(vitals.stats), note: keep ? 'You keep your items.' : 'Your items are where you died. They stay for 10 minutes.' });
  saveNow('death');
}

function respawn() {
  if (G.phase !== 'dead') return;
  const p = respawnPoint();
  vitals.respawn(); vitals.difficulty = G.settings.difficulty; G.hitSeen = vitals.hitCount;
  if (!G.fakeLock) $('gl').requestPointerLock?.();
  audio.unlock();
  if (G.dim !== 'overworld') { travel('overworld', p); return; }                       // dying below ground brings you back to the surface
  player.teleport(p.x, p.y, p.z); player.peakY = p.y; player.lastFall = 0;
  G.phase = 'playing'; ui.show(null); ui.hud(true);
}

// ---------------------------------------------------------------- dimensions: Rifts, the Underlayer
const DIM_NAMES = { overworld: 'the surface', underlayer: 'the Underlayer', kernel: 'the Kernel' };
/** Leave the current dimension for `to`, arriving at `at` ({x, y, z} feet). The old one's edits, drops and animals are stashed (and saved), the new one is generated from the same seed. */
async function travel(to, at, { afterEnter = null, text = null } = {}) {
  if (G.phase === 'loading' || G.phase === 'entering') return;
  const from = G.dim;
  if (G.menu) closeMenu(false);
  G.phase = 'loading'; G.keys.clear(); G.mouseLeft = false; G.mouseRight = false; G.eat = null; G.draw = null; G.riftT = 0; ui.warp(0); ui.adOverlay(0);
  ui.progress(0.15, text ?? `Entering ${DIM_NAMES[to]}…`); ui.show('loading'); ui.hud(false);
  if (from !== 'kernel') { G.dimEdits[from] = world.edits; G.dimDrops[from] = drops.toJSON(); }
  if (from === 'overworld') G.dimAnimals.overworld = mobs.toJSON();
  G.mobsOn = false; mobs.clear(); mobRenderer.clear(); arrows.clear(); drops.clear(); miner.reset();
  boss = null; ui.bossBar(null); ui.logs(false); audio.setBossMusic(0);
  await world.setSeed(G.seed, { flat: to === 'overworld' && G.flat, dim: to, edits: to === 'kernel' ? new Map() : (G.dimEdits[to] ?? new Map()) });       // the Kernel is regenerated from scratch every time: its edits are never kept
  G.dim = to; renderer.setDimension(to); renderer.setWorldSize(world.size); ui.logs(to === 'kernel');
  G.sites = await world.backend.sites().catch(() => ({ cracks: [], vaults: [] }));
  drops.load(to === 'kernel' ? [] : (G.dimDrops[to] ?? []));
  if (to === 'overworld') mobs.load(G.dimAnimals.overworld ?? []);
  G.mobsOn = true;
  player.teleport(at.x, at.y, at.z); player.peakY = at.y; player.lastFall = 0;
  G.afterEnter = afterEnter;
  G.entering = { title: false, fake: G.fakeLock, t0: performance.now() };
  G.phase = 'entering';
}

/** The Underlayer position an overworld Rift leads to: the same x and z, scaled to its smaller size. */
const riftLink = (x, z) => ({ ux: Math.max(8, Math.min(CONFIG.underlayer.size - 9, Math.floor(x * CONFIG.underlayer.size / G.worldSize))), uz: Math.max(8, Math.min(CONFIG.underlayer.size - 9, Math.floor(z * CONFIG.underlayer.size / G.worldSize))) });
function registerRift(x, y, z) {
  let r = G.flags.rifts.find((q) => q.x === x && q.y === y && q.z === z);
  if (!r) { r = { x, y, z, ...riftLink(x, z) }; G.flags.rifts.push(r); }
  return r;
}

/** A 5 x 5 basalt platform with room to stand and the return Rift in the middle, at the floor of the cavern under (ux, uz). Returns where to stand. */
function buildArrival(ux, uz) {
  let fy = 40;
  for (let y = CONFIG.underlayer.height - 5; y > 3; y--) if (isSolid(world.getBlock(ux, y, uz)) && !isSolid(world.getBlock(ux, y + 1, uz))) { fy = y; break; }
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    world.setBlock(ux + dx, fy, uz + dz, B.basalt);
    for (let k = 1; k <= 4; k++) world.setBlock(ux + dx, fy + k, uz + dz, B.air);
  }
  world.setBlock(ux, fy + 1, uz, B.rift);
  return { x: ux + 0.5, y: fy + 1, z: uz + 2.5 - 1 + 0.01, fy };
}

// ---------------------------------------------------------------- the Data Vaults
const vaultState = (i) => (G.flags.vaults[i] ??= { spawner: false, raided: false, warden: false });      // spawner: destroyed; raided: its shard was taken; warden: killed
const vaultNear = (x, z, r = 12) => G.sites.vaults.find((v) => Math.abs(v.x - x) <= r && Math.abs(v.z - z) <= r) ?? null;
/** The loot of a vault chest, made the first time it is opened: one Kernel Shard and a few supplies. */
function vaultLootAt(hit) {
  const v = G.dim === 'underlayer' ? G.sites.vaults.find((s) => s.chest.x === hit.x && s.chest.y === hit.y && s.chest.z === hit.z) : null;
  if (!v) return null;
  const slots = Array(27).fill(null), r = Math.random;
  slots[13] = stack('kernel_shard', 1);
  let k = 0;
  for (const [id, lo, hi] of CONFIG.vault.loot) { const n = lo + Math.floor(r() * (hi - lo + 1)); if (n > 0) slots[[4, 10, 16, 22][k++ % 4]] = stack(id, n); }
  return slots;
}
/** Close the sealed door of a vault (false) or open it (true): the hatch of vault_door blocks across the hall stairs. */
function openVaultDoor(v, open) {
  let changed = false;
  for (const c of v.door) {
    const cur = world.getBlock(c.x, c.y, c.z);
    if (open && cur === B.vault_door) { world.setBlock(c.x, c.y, c.z, B.air); changed = true; }
  }
  if (changed) { audio.play('vault.open', { at: { x: v.x, y: v.fy + 6, z: v.z }, listener: listener(), vol: 1 }); ui.subtitle('A vault door grinds open.', 4000); shake(0.5); }
}
const shake = (k) => { G.shake = Math.max(G.shake ?? 0, k); };
/** After the chest was closed: a vault whose shard is gone is raided (the Tracer stops pointing at it). */
function checkRaided() {
  const oc = G.openChest; G.openChest = null;
  if (!oc || G.dim !== 'underlayer') return;
  const v = G.sites.vaults.find((s) => s.chest.x === oc.x && s.chest.y === oc.y && s.chest.z === oc.z), items = chests.get(oc.key);
  if (v && items && !items.some((s) => s?.id === 'kernel_shard')) { const st = vaultState(v.index); if (!st.raided) { st.raided = true; ui.subtitle(`Vault ${v.index + 1} raided.`, 3500); saveNow('vault'); } }
}

/** Per step in the Underlayer: the sealed doors follow the saved state, the spawners spawn, the Wardens wake up when you come near. */
function vaultTick(dt) {
  ensureGate();
  G.vaultT -= dt;
  if (G.vaultT > 0) return;
  G.vaultT = CONFIG.vault.spawnerEveryS / 3;
  const P = player.pos, V = CONFIG.vault;
  for (const v of G.sites.vaults) {
    const st = vaultState(v.index), d = Math.hypot(v.x - P.x, v.z - P.z);
    if (d > 70 || !world.has(v.x, v.z)) continue;
    if (st.spawner) openVaultDoor(v, true);
    // the spawner: while its block stands and you are near, Daemons come out of the hall
    if (!st.spawner && d < V.spawnerRange && world.getBlock(v.spawner.x, v.spawner.y, v.spawner.z) === B.spawner && !vitals.peaceful) {
      v.spawnT = (v.spawnT ?? 0) + CONFIG.vault.spawnerEveryS / 3;
      const here = mobs.list.filter((m) => !m.dead && m.type === 'daemon' && Math.hypot(m.x - v.x, m.z - v.z) < 14).length;
      if (v.spawnT >= V.spawnerEveryS && here < V.spawnerMax) {
        v.spawnT = 0;
        const m = mobs.spawn('daemon', v.x + 0.5 + (Math.random() < 0.5 ? -2 : 2), v.fy + 1, v.z + 0.5 + (Math.random() < 0.5 ? -2 : 2));
        mobRenderer.puff(m.x, m.y + 0.8, m.z, 10, 0xff6a2a);
      }
    }
    // the Warden guards the shard room until the vault is raided or it is killed
    const have = mobs.list.some((m) => m.type === 'warden' && !m.dead && Math.hypot(m.x - v.x, m.z - v.z) < 14);
    if (!st.raided && !st.warden && d < V.wardenRange && !have && !vitals.peaceful) { const m = mobs.spawn('warden', v.warden.x, v.warden.y, v.warden.z); m.data.home = { x: v.x, z: v.z, index: v.index }; }
  }
}

/** The nearest Rift-able bedrock, vault or the Kernel Gate for the Tracer, and the text it shows. Returns { x, z, label, cls } or null. */
function tracerTarget() {
  const P = player.pos;
  if (G.dim === 'overworld') {
    const open = new Set(G.flags.rifts.map((r) => `${r.x},${r.z}`));
    const list = G.sites.cracks.filter((c) => !open.has(`${c.x},${c.z}`) && !brokenCrack(c));
    list.sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
    return list[0] ? { x: list[0].x + 0.5, z: list[0].z + 0.5, label: 'Rift', cls: 'tracer' } : null;
  }
  if (G.dim === 'underlayer') {
    if (inv.slots.some((s) => s?.id === 'kernel_key') || G.flags.gate) return { x: CONFIG.underlayer.size / 2 + 0.5, z: CONFIG.underlayer.size / 2 + 0.5, label: 'Gate', cls: 'gate' };
    const list = G.sites.vaults.filter((v) => !vaultState(v.index).raided).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
    return list[0] ? { x: list[0].x + 0.5, z: list[0].z + 0.5, label: 'Vault', cls: 'tracer' } : null;
  }
  return null;
}
const brokenCrack = (c) => world.has(c.x, c.z) && world.getBlock(c.x, c.y, c.z) !== B.cracked_bedrock;

/** The compass strip: N, E, S, W, your death marker, and (holding a Tracer) its target. Off with the setting. */
function compassHud() {
  const on = G.settings.compass !== false && G.phase === 'playing';
  if (!on) { ui.compass(false); return; }
  const heading = -player.yaw, items = [{ bearing: 0, label: 'N', cls: 'n' }, { bearing: Math.PI / 2, label: 'E' }, { bearing: Math.PI, label: 'S' }, { bearing: -Math.PI / 2, label: 'W' }];
  const m = G.deathMarker;
  if (m && (m.dim ?? 'overworld') === G.dim) items.push({ bearing: Math.atan2(m.x + 0.5 - player.pos.x, -(m.z + 0.5 - player.pos.z)), label: '☠', cls: 'death' });
  if (inv.held()?.id === 'tracer') { const t = tracerTarget(); if (t) items.push({ bearing: Math.atan2(t.x - player.pos.x, -(t.z - player.pos.z)), label: `◆ ${t.label} ${Math.round(Math.hypot(t.x - player.pos.x, t.z - player.pos.z))}m`, cls: t.cls }); }
  ui.compass(true, heading, items);
}

// ---------------------------------------------------------------- the Kernel Gate and the Garbage Collector
const inGate = (c) => c.x >= GATE.frame.x0 && c.x <= GATE.frame.x1 && c.y >= GATE.frame.y0 && c.y <= GATE.frame.y1 && c.z === GATE.z;
/** Right click on the dark frame with the Kernel Key: the key is used up and the frame fills with a white Rift. The Gate stays open for good. */
function tryOpenGate() {
  if (G.flags.gate) return false;
  const slot = inv.slots.findIndex((s) => s?.id === 'kernel_key');
  if (slot < 0) { ui.subtitle('The frame is dark. It needs a Kernel Key.', 3000); return true; }
  inv.takeOne(slot);
  G.flags.gate = true; ensureGate(true);
  audio.play('vault.open', { vol: 1 }); shake(0.8); ui.subtitle('The Gate opens. Something white hums inside.', 4500);
  return true;
}
/** Make the opening match the saved state: white Rift when opened, vault-door panels while closed. */
function ensureGate(force = false) {
  if (G.dim !== 'underlayer' || !G.flags.gate) return;
  const c = GATE.inner, mx = (c.x0 + c.x1) >> 1;
  if (!world.has(mx, GATE.z)) return;
  if (!force && world.getBlock(mx, c.y0, GATE.z) === B.rift_white) return;
  for (let x = c.x0; x <= c.x1; x++) for (let y = c.y0; y <= c.y1; y++) if (world.getBlock(x, y, GATE.z) === B.vault_door) world.setBlock(x, y, GATE.z, B.rift_white);
}

/** Walk through the white Rift: the Kernel, a fresh arena every time, and the Garbage Collector in it. */
function enterKernel() {
  travel('kernel', { ...ARENA.spawn }, { text: 'Entering the Kernel…', afterEnter: () => { startBoss(); player.yaw = 0; player.pitch = 0; ui.subtitle('[gc] unreachable object found.', 4000); } });
}
function startBoss() {
  boss = new Boss({ mobs, world, difficulty: vitals.difficulty });
  boss.start(); audio.setBossMusic(1);
}
const crystalHits = new Map();
/** An arrow that stuck in a Kernel crystal: three of them break it. */
function crystalHit(c) {
  const key = `${c.x},${c.y},${c.z}`, n = (crystalHits.get(key) ?? 0) + 1;
  crystalHits.set(key, n);
  audio.play('boss.crystal', { at: { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, listener: listener(), vol: 0.8 });
  if (n >= 3) { world.setBlock(c.x, c.y, c.z, B.air); crystalHits.delete(key); mobRenderer.puff(c.x + 0.5, c.y + 0.5, c.z + 0.5, 14, 0x6dffb0); audio.play('boss.crystal', { vol: 1 }); ui.subtitle('A Kernel crystal shatters.', 2500); }
}
function bossStep(dt, ctx) {
  boss.setDifficulty(vitals.difficulty);
  const bctx = { player: { ...ctx.player, onGround: player.onGround }, hurt: ctx.hurt, knock: ctx.knock, peaceful: vitals.peaceful };
  boss.step(dt, bctx);
  for (const ev of boss.takeEvents()) bossEvent(ev);
  ui.bossBar(boss.alive || boss.state === 'dying' ? boss.bar() : null);
  if (boss.core && boss.stepCore(dt, { x: player.pos.x, y: player.pos.y, z: player.pos.z })) bossEvent({ type: 'win' });
}
function bossEvent(ev) {
  const m = boss.m, at = { x: m.x, y: m.y + 3, z: m.z }, L = listener();
  switch (ev.type) {
    case 'shake': shake(ev.k); break;
    case 'roar': audio.voice('warden', 'hurt', { at, listener: L, vol: 1 }); subtitle('The Garbage Collector roars', at); ui.subtitle('It is going to charge!', 1800); break;
    case 'charge': audio.play('boss.stomp', { at, listener: L, vol: 0.8 }); break;
    case 'swipe-wind': audio.play('sword.swing', { at, listener: L, vol: 0.6 }); break;
    case 'swipe': audio.play('boss.stomp', { at, listener: L, vol: 0.7 }); break;
    case 'mark': audio.play('boss.crystal', { at, listener: L, vol: 0.7 }); ui.subtitle('Marked blocks: move!', 1500); break;
    case 'delete': audio.play('vault.open', { at, listener: L, vol: 0.5 }); break;
    case 'stomp-wind': ui.subtitle('The ground shakes…', 1200); break;
    case 'stomp': audio.play('boss.stomp', { at, listener: L, vol: 1 }); ui.subtitle('The core is exposed. Strike it!', 2500); break;
    case 'phase': audio.setBossMusic(ev.phase); ui.subtitle(['', '', 'Phase 2: Sweep', 'Phase 3: Compact'][ev.phase] ?? '', 3000); break;
    case 'pointers': ui.subtitle('Pointers!', 2000); break;
    case 'shrink': ui.subtitle('The arena is compacting.', 2500); break;
    case 'dying': audio.voice('warden', 'die', { at, listener: L, vol: 1 }); ui.subtitle('[gc] collection failing…', 3000); break;
    case 'trash': mobRenderer.puff(ev.x, ev.y, ev.z, 3, 0x777777); break;
    case 'core': ui.subtitle('A glowing core floats up. Touch it.', 5000); break;
    case 'win': onBossDefeated(); break;
    case 'core-hit': audio.play('hit.heavy', { at, listener: L, vol: 1 }); break;
    case 'armor-hit': break;
  }
}
/** The Garbage Collector is gone: the ending (phase 10 of the build: credits, System32.complete, the trophy). */
function onBossDefeated() { if (G.phase === 'playing') startEnding(); }

// ---------------------------------------------------------------- the ending (STRATA_PART2_SPEC 7.4)
const CREDITS = [
  { h: 'Strata.exe' }, { t: 'a System32 bonus game' }, { t: 'Garbage collection complete.', dim: true },
  { h: 'Game' }, { t: 'Made by Pragnya Yadav with Claude Code' },
  { h: 'Engine' }, { t: 'three.js (MIT License)', dim: false }, { t: 'WebGL, Web Workers and the Web Audio API', dim: true },
  { h: 'Art and sound' }, { t: 'Kenney Voxel Pack: block faces and item icons' }, { t: 'Kenney Impact Sounds, RPG Audio, UI Audio, Interface Sounds' }, { t: 'Kenney Music Jingles' }, { t: 'Kenney Fonts: Kenney Pixel' }, { t: 'all Kenney assets: CC0 (Creative Commons Zero), kenney.nl', dim: true },
  { h: 'Drawn in code' }, { t: 'mobs, the Garbage Collector, hearts, hunger, armor and mining icons, the Rift, server racks and every sound of a living thing' },
  { h: 'Thank you for playing' }, { t: 'You restored the kernel.' }, { t: 'The previous user would be proud.', dim: true },
];
/** Fade out, a terminal log, the credits (skippable after 5 s), then System32.complete() (once per world) and back to the surface with the trophy. */
function startEnding() {
  if (G.phase !== 'playing') return;
  G.phase = 'ending'; G.keys.clear(); G.mouseLeft = false; G.mouseRight = false; G.draw = null; G.eat = null; ui.eating(null);
  document.exitPointerLock?.();
  ui.bossBar(null); ui.hud(false); ui.adOverlay(0); ui.warp(0);
  audio.play('jingle.win', { vol: 0.9 });
  audio.setBossMusic(0);
  const t = vitals.stats.timeS * 1000;
  G.end = { t: 0, stage: 'log', skip: false, timeMs: Math.max(1, Math.round(t)), deaths: vitals.deaths, difficulty: vitals.difficulty };
  ui.endReset(); ui.show('end'); ui.endLog('');
}
const END_LOG = ['[gc] mark phase complete.', '[gc] sweep phase complete.', '[gc] compact phase complete.', '[gc] collection complete. 0 bytes freed. strata.exe restored.', '', '> exit 0'];
function endingStep(dt) {
  const e = G.end;
  if (!e) return;
  e.t += dt;
  if (e.stage === 'log') {
    const n = Math.min(END_LOG.length, Math.floor((e.t / CONFIG.ending.logS) * (END_LOG.length + 1)));
    ui.endLog(END_LOG.slice(0, n).join('\n') + (e.t % 0.8 < 0.4 ? '\n_' : ''));
    if (e.t >= CONFIG.ending.logS) { e.stage = 'credits'; e.t = 0; ui.endCredits(CREDITS); }
  } else if (e.stage === 'credits') {
    ui.endSkip(e.t >= CONFIG.ending.skipAfterS);
    e.skippable = e.t >= CONFIG.ending.skipAfterS;
    if (e.t >= CONFIG.ending.creditsS || e.skip) finishEnding();
  }
}
function skipCredits() { const e = G.end; if (e?.stage === 'credits' && e.skippable) e.skip = true; }
/** The win is reported to the shell ONCE per world; the trophy goes into the inventory; you wake on the surface and the world goes on. */
function finishEnding() {
  const e = G.end; G.end = null;
  ui.endReset(); ui.show(null);
  if (!G.flags.completed) {
    G.flags.completed = true;
    sdk?.complete({ timeMs: e.timeMs, deaths: e.deaths, difficulty: e.difficulty });
    G.completedSent = (G.completedSent ?? 0) + 1;
  }
  const left = inv.add(stack('kernel_core', 1)); if (left) drops.spawn(player.pos.x, player.pos.y + 1, player.pos.z, left);
  G.phase = 'playing';
  boss = null; ui.bossBar(null);
  vitals.hp = CONFIG.survival.maxHp;
  travel('overworld', { ...G.spawn }, { text: 'Returning to the surface…', afterEnter: () => { ui.hud(true); ui.subtitle('You restored Strata.exe. The world is yours.', 6000); saveNow('ending'); } });
}

/** Standing inside a Rift for CONFIG.underlayer.riftS seconds takes you through. */
function useRift(blockId, cell) {
  if (BLOCKS[blockId].rift === 'white' && G.dim === 'underlayer') { enterKernel(); return; }
  if (BLOCKS[blockId].rift === 'purple' && G.dim === 'overworld') {
    const r = registerRift(cell.x, cell.y, cell.z);
    travel('underlayer', { x: r.ux + 0.5, y: 60, z: r.uz + 0.5 }, { text: 'Falling through the floor…', afterEnter: () => { const a = buildArrival(r.ux, r.uz); r.uy = a.fy; player.teleport(a.x, a.y, a.z); player.peakY = a.y; saveNow('rift'); } });
  } else if (BLOCKS[blockId].rift === 'purple' && G.dim === 'underlayer') {
    const here = { x: cell.x, z: cell.z }, r = G.flags.rifts.slice().sort((a, b) => Math.hypot(a.ux - here.x, a.uz - here.z) - Math.hypot(b.ux - here.x, b.uz - here.z))[0];
    const back = r ? { x: r.x + 0.5, y: r.y + 1, z: r.z + 0.5 } : { ...G.spawn };
    travel('overworld', back, { text: 'Climbing back up…', afterEnter: () => saveNow('rift') });
  }
}

function checkRift(dt) {
  const x = Math.floor(player.pos.x), z = Math.floor(player.pos.z);
  let found = null;
  for (const dy of [0, 1]) { const y = Math.floor(player.pos.y + 0.1) + dy, id = world.getBlock(x, y, z); if (BLOCKS[id]?.rift) { found = { id, cell: { x, y, z } }; break; } }
  if (found && G.phase === 'playing') {
    G.riftT += dt; ui.warp(G.riftT / CONFIG.underlayer.riftS);
    if (G.riftT >= CONFIG.underlayer.riftS) { G.riftT = 0; ui.warp(0); useRift(found.id, found.cell); }
  } else if (G.riftT > 0) { G.riftT = Math.max(0, G.riftT - dt * 2); ui.warp(G.riftT / CONFIG.underlayer.riftS); }
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
    case 'paused': case 'dead': world.update(player.pos.x, player.pos.z); world.pump(); renderer.setTarget(null); renderer.setCrack(null, 0); break;
    case 'ending': world.update(player.pos.x, player.pos.z); world.pump(); endingStep(dt); break;
  }
  mobRenderer.sync(G.mobsOn && G.phase !== 'title' ? mobs.list : [], G.now, lightOf, dt);
  renderer.setTime(G.dayT, G.now);
  renderer.setDrops(drops && G.phase !== 'title' ? drops.list.map((d) => ({ x: d.x, y: d.y + 0.12 + Math.sin(G.now * 2 + d.id) * 0.05, z: d.z, spin: G.now * 1.5 + d.id, visual: dropVisual(d.stack.id), light: lightOf(d.x, d.y + 0.2, d.z) })).concat(boss?.core && !boss.won ? [{ x: boss.core.x, y: boss.core.y, z: boss.core.z, spin: G.now * 2, visual: { block: B.kernel_core }, light: [0, 1], scale: 3 }] : []) : [], G.atlasUV);
  renderer.render(G.now);
  if (G.f3 && G.phase === 'playing') { G.f3Timer -= dt; if (G.f3Timer <= 0) { G.f3Timer = 0.25; ui.debug(debugText()); } }
}

/** Health bars of the mobs hit in the last 3 s, in screen pixels. */
function mobBarsNow() {
  if (!G.mobsOn || G.phase !== 'playing') return [];
  return mobs.list.filter((m) => m.barT > 0 && !m.dead).map((m) => { const p = renderer.project(m.x, m.y + m.h + 0.35, m.z); return p && { x: p.x, y: p.y, frac: m.hp / m.maxHp }; }).filter(Boolean);
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
      eggs: [...G.eggs], settings: { ...G.settings }, hp: vitals.hp, hunger: vitals.hunger, air: vitals.air, dead: vitals.dead, locked: isLocked(), draws: renderer.info.calls, flags: { ...G.flags }, dim: G.dim, rifts: G.flags.rifts, riftT: G.riftT, sound: { allowed: audio.allowed, ctx: !!audio.ctx, count: audio.count, played: [...audio.played] },
    }),
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    setBlock: (x, y, z, id) => world.setBlock(x, y, z, typeof id === 'string' ? B[id] : id),
    give: (item, n = 1) => inv.add(hasDurability(item) ? stack(item) : stack(item, n)),
    tp: (x, y, z) => { player.teleport(x, y, z); },
    setTime: (t) => { G.dayT = t; },
    save: () => serialize(saveState(), { compress: !OPT.noCompress }),
    load: async (str) => { const s = await deserialize(str); await startGame({ seed: s.seed, flat: s.flat, save: s, fake: true }); return s; },
    newWorld: (o = {}) => startGame({ seed: o.seed ?? 1, flat: !!o.flat, fake: o.fake !== false }),
    settle: async (radius = 2, ms = 60000) => { const t0 = performance.now(); while (world.missingMeshes(player.pos.x, player.pos.z, radius) && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return world.missingMeshes(player.pos.x, player.pos.z, radius); },
    look: (dx, dy) => player.look(dx, dy, G.settings.sensitivity, G.settings.invertY),
    face: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch; },
    target, openMenu, closeMenu, pause: () => pauseGame(), resume: () => { G.phase = 'playing'; ui.show(null); }, breakBlock, useOrPlace, pickBlock, selectSlot, saveNow, onKeyDown,
    world: () => world, player: () => player, inv: () => inv, drops: () => drops, audio: () => audio, renderer: () => renderer, ui: () => ui, miner: () => miner, furnaces: () => furnaces,
    mineHold: (on) => { G.mouseLeft = !!on; },
    endNow: () => { if (G.phase === 'playing') startEnding(); }, end: () => G.end, completedSent: () => G.completedSent ?? 0, skipCredits,
    boss: () => boss, bossPhase: (n) => { if (boss) boss.m.hp = [0, 300, 200, 90][n] ?? 300; }, enterKernel,
    travel, goto: (dim) => { if (dim === 'kernel') return enterKernel(); const at = dim === 'underlayer' ? { x: CONFIG.underlayer.size / 2 + 0.5, y: 60, z: CONFIG.underlayer.size / 2 + 0.5 } : { ...G.spawn }; return travel(dim, at, dim === 'underlayer' ? { afterEnter: () => { const a = buildArrival(CONFIG.underlayer.size / 2, CONFIG.underlayer.size / 2); player.teleport(a.x, a.y, a.z); } } : {}); },
    arrows: () => arrows, spawner: () => spawner, mobs: () => mobs, mobRenderer: () => mobRenderer, chests: () => chests, spawn: (type, x, y, z) => mobs.spawn(type, x, y, z), killAll: () => { for (const m of [...mobs.list]) mobs.remove(m); }, attack,
    vitals: () => vitals, die, respawn, hold: (on) => { G.mouseRight = !!on; },
    setHealth: (n) => { vitals.hp = n; }, setHunger: (n) => { vitals.hunger = n; }, damage: (n, o) => vitals.damage(n, o),
    setDifficulty: (d) => { G.settings.difficulty = d; applySettings(); },
    giveKit: (kind) => { for (const sl of ['helmet', 'chestplate', 'leggings', 'boots']) vitals.armor[ITEMS[`${kind}_${sl}`].armor.slotN] = stack(`${kind}_${sl}`); for (const t of ['pickaxe', 'sword', 'axe']) inv.add(stack(`${t}_${kind}`)); inv.add(stack('cooked_beef', 16)); },
  };
  window.__STRATA = api;
}

boot().catch((e) => {
  console.error('[Strata]', e);
  ui?.error('Strata could not start', String(e?.message ?? e));
});
