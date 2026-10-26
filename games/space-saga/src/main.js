// SpaceSaga: boot, game loop and state machine (loading -> title -> running -> dying -> dead). SPACESAGA_SPEC.md B2/B4/B9/B10.
import * as THREE from 'three';
import { CONFIG, PATTERNS } from './config.js';
import { Assets, MODELS } from './assets.js';
import { World } from './world.js';
import { Player, laneX } from './player.js';
import { Spawner } from './spawner.js';
import { overlaps, classify } from './collision.js';
import { hud } from './hud.js';
import { SagaAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = Number(params.get(k)); return params.has(k) && Number.isFinite(v) ? v : d; };
const OPT = {
  seed: num('seed', Math.floor(Math.random() * 2 ** 31)),
  speed: Math.max(0.1, num('speed', 1)),            // game clock multiplier
  god: params.get('god') === '1',
  low: params.get('quality') === 'low',
  debug: params.get('debug') === '1',
};
const STEP = 1 / 60;
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sdk = window.System32;
const egg = (() => { const sent = {}; return (id) => { if (!sent[id]) { sent[id] = true; sdk?.effect('egg', { egg: id }); } }; })();

const G = {
  phase: 'loading',               // loading | title | running | dying | dead
  time: 0,                        // game seconds since the page started counting (stops while paused)
  runTime: 0, distance: 0, score: 0, pickups: 0, combo: 0, speed: CONFIG.speed.start,
  best: 0, isBest: false, flashedBest: false,
  reasons: new Set(),             // why the clock is stopped: user | shell | hidden | blur | context
  dyingT: 0, deadAt: 0, runOverSent: 0, titleIdle: 0, shake: 0, camX: 0, lastDistance: 0,
  inits: 0, runsSent: 0, low: OPT.low, frameAvg: 0, fps: 0, frames: 0, slowFor: 0,
};

let renderer, scene, camera, assets, world, player, spawner, audio, rng;
const audioFx = new SagaAudio();
audio = audioFx;

// ---------------------------------------------------------------- boot
async function boot() {
  hud.startFlavor();
  try {
    initRenderer();
  } catch (e) {
    hud.stopFlavor();
    hud.error('WebGL is not available', 'SpaceSaga draws with WebGL, which this browser or graphics driver does not provide. Try another browser, or enable hardware acceleration.');
    sdk?.ready();
    return;
  }
  try {
    assets = await new Assets().load((p) => hud.loading(p));
  } catch (e) {
    console.error(e);
    hud.stopFlavor();
    hud.error('Could not load SpaceSaga', String(e.message ?? e));
    sdk?.ready();
    return;
  }
  const rngWorld = mulberry32(OPT.seed), rngSpawn = mulberry32(OPT.seed ^ 0x9e3779b9);
  rng = rngSpawn;
  world = new World({ scene, assets, rng: rngWorld, low: G.low });
  if (G.low) world.setLow(true);
  player = new Player(assets.character(MODELS.player));
  scene.add(player.root);
  spawner = new Spawner({ scene, assets, world, rng: rngSpawn });
  spawner.onEvent = (ev, arg) => { if (ev === 'alien') audio.alien(arg); };
  if (OPT.debug) console.info('[SpaceSaga] player clips:', player.anim.log.join(' | '));
  hud.loading(1);
  hud.stopFlavor();
  toTitle();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  sdk?.ready();
}

function initRenderer() {
  const canvas = document.getElementById('gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !G.low, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no context');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CONFIG.camera.fov[0], 1, 0.1, 2000);
  camera.position.set(...CONFIG.camera.offset);
  renderer.shadowMap.enabled = !G.low;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  resize();
  addEventListener('resize', resize);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    G.screenBefore = hud.screen();
    addReason('context');
    hud.error('Graphics context lost', 'The browser took the GPU away for a moment. Restoring…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    resize();
    G.reasons.delete('context');
    hud.show(G.screenBefore ?? null);
    syncOverlay();
  });
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, G.low ? CONFIG.quality.lowDpr : CONFIG.quality.dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}

function setLow() {
  if (G.low) return;
  G.low = true;
  renderer.shadowMap.enabled = false;
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  world.setLow(true);
  resize();
  if (OPT.debug) console.info('[SpaceSaga] auto quality: low');
}

// ---------------------------------------------------------------- phases
function toTitle() {
  G.phase = 'title';
  G.titleIdle = 0;
  player.reset();
  player.idlePose();
  spawner.reset();
  world.reset();
  audio.startMusic('title');
  hud.setTitleBest(G.best);
  hud.show('title');
}

function startRun() {
  player.reset();
  player.runPose();
  spawner.reset();
  world.reset();
  Object.assign(G, { phase: 'running', runTime: 0, distance: 0, score: 0, pickups: 0, combo: 0, speed: CONFIG.speed.start, isBest: false, flashedBest: false, dyingT: 0, runOverSent: 0, shake: 0, lastDistance: 0 });
  G.camX = 0;
  hud.resetLast();
  hud.show(null);
  audio.start();
  audio.startMusic('run');
  G.tier = 0;
  updateHud();
}

function die() {
  if (G.phase !== 'running') return;
  G.phase = 'dying';
  G.dyingT = 0;
  G.shake = 0.5;
  player.die();
  audio.crash();
  audio.stopMusic(0.9);
}

function showDead() {
  G.phase = 'dead';
  G.deadAt = performance.now();
  const score = Math.floor(G.score);
  G.isBest = score > G.best;
  if (G.isBest) G.best = score;
  if (G.isBest) audio.fanfare(); else audio.gameOver();
  hud.dead({ distance: G.distance, pickups: G.pickups, score, best: G.best, isBest: G.isBest });
  if (!G.runOverSent) {                                // exactly once per run, when the panel appears
    G.runOverSent++; G.runsSent++;
    sdk?.runOver({ score, distance: Math.floor(G.distance), pickups: G.pickups, timeMs: Math.round(G.runTime * 1000) });
    if (G.distance >= 1000) sdk?.achieve('saga-1km');
    if (G.distance >= 5000) sdk?.achieve('saga-5km');
  }
}

// ---------------------------------------------------------------- pause / focus (B9)
function addReason(r) { G.reasons.add(r); syncOverlay(); audio.suspend(); }
function delReason(r) { G.reasons.delete(r); syncOverlay(); if (!G.reasons.size) { audio.resume(); last = performance.now(); } }
const paused = () => G.reasons.size > 0;
function syncOverlay() {
  if (G.reasons.has('context')) return;
  if (G.phase !== 'running' && G.phase !== 'dying') return;
  if (G.reasons.has('user')) hud.show('pause');
  else if (G.reasons.has('blur')) hud.show('blur');
  else if (hud.screen() === 'pause' || hud.screen() === 'blur') hud.show(null);
}
function togglePause() {
  if (G.phase !== 'running') return;
  if (G.reasons.has('user')) delReason('user'); else addReason('user');
}

sdk?.onInit((init) => {
  G.inits++;
  G.best = Math.max(G.best, Number(init?.best) || 0);
  audio.setAllowed(!!init?.soundOn);
  hud.setSoundHint(audio.allowed);
  hud.setTitleBest(G.best);
});
sdk?.onSound((p) => { audio.setAllowed(!!p?.soundOn); hud.setSoundHint(audio.allowed); });
sdk?.onPause(() => addReason('shell'));
sdk?.onResume(() => delReason('shell'));
document.addEventListener('visibilitychange', () => (document.hidden ? addReason('hidden') : delReason('hidden')));
addEventListener('blur', () => { if (G.phase === 'running' || G.phase === 'dying') addReason('blur'); });
addEventListener('focus', () => { if (G.phase !== 'running' && G.phase !== 'dying') delReason('blur'); });
// A click means "I am back". Also on pointerup / click: the shell shuffles focus around a click on an inactive window (it blurs and re-focuses the
// frame), so the blur can arrive after the pointerdown; by pointerup the frame has focus again.
const comeBack = () => { audio.unlock(); if (G.reasons.has('blur') && document.hasFocus()) delReason('blur'); };
for (const ev of ['pointerdown', 'pointerup', 'click']) addEventListener(ev, comeBack);

// ---------------------------------------------------------------- input
const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'slide', KeyS: 'slide',
};
addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey && !e.repeat && (e.code === 'KeyF' || (e.altKey && e.code === 'Enter') || e.code === 'F11')) { e.preventDefault(); sdk?.fullscreen(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const act = KEYS[e.code];
  if (act || e.code === 'Enter' || e.code === 'Escape' || e.code === 'KeyP') e.preventDefault();
  if (e.repeat) return;
  audio.unlock();
  if (G.reasons.has('blur')) { delReason('blur'); return; }
  if (e.code === 'KeyM') { const m = audio.toggleMute(); if (OPT.debug) console.info('[SpaceSaga] muted', m); return; }
  switch (G.phase) {
    case 'title':
      G.titleIdle = 0;
      if (e.code === 'Enter' || e.code === 'Space') startRun();
      else if (player.sitting) { player.reset(); player.idlePose(); }
      break;
    case 'running':
      if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
      else if (G.reasons.has('user')) { if (e.code === 'Enter') delReason('user'); else if (e.code === 'KeyR') { G.reasons.delete('user'); startRun(); } }
      else if (act) player.input(act);
      break;
    case 'dead':
      if ((e.code === 'Enter' || e.code === 'Space') && performance.now() - G.deadAt > 450) startRun();
      break;
  }
});
hud.on('b-full', () => sdk?.fullscreen());
hud.on('b-resume', () => delReason('user'));
hud.on('b-restart', () => { G.reasons.delete('user'); audio.resume(); startRun(); });
hud.on('b-again', () => { if (G.phase === 'dead') startRun(); });

// ---------------------------------------------------------------- simulation
function speedAt(distance) { return Math.min(CONFIG.speed.cap, CONFIG.speed.start + (distance / CONFIG.speed.perM) * CONFIG.speed.add); }
const multiplier = () => (G.combo >= CONFIG.scoring.comboAt ? CONFIG.scoring.mult : 1);

function updateCamera(dt) {
  const c = CONFIG.camera;
  G.camX += (player.x * c.laneFollow - G.camX) * (1 - Math.exp(-c.lag * dt));
  let sx = 0, sy = 0;
  if (G.shake > 0) { G.shake -= dt; const a = Math.min(1, G.shake / 0.35) * 0.22; sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; }
  camera.position.set(c.offset[0] + G.camX + sx, c.offset[1] + sy, c.offset[2]);
  camera.lookAt(G.camX * 0.8, c.look[1], c.look[2]);
  const k = Math.min(1, Math.max(0, (G.speed - CONFIG.speed.start) / (CONFIG.speed.cap - CONFIG.speed.start)));
  const fov = c.fov[0] + (c.fov[1] - c.fov[0]) * k;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  world.sun.position.set(player.x - 5, 11, 7);
  world.sun.target.position.set(player.x, 0, 0);
  world.catcher.position.x = player.x;
}

function playSounds() {
  for (const ev of player.drainEvents()) {
    if (ev === 'jump') audio.jump(); else if (ev === 'slide') audio.slide(); else if (ev === 'land') audio.land();
    else if (ev === 'left') audio.lane(-1); else if (ev === 'right') audio.lane(1);
  }
}

function collect(o) {
  o.collected = true;
  spawner.release?.(o);
  const n = o.orb ? CONFIG.scoring.orbPickups : 1;
  const before = multiplier();
  for (let i = 0; i < n; i++) {
    G.combo++; G.pickups++;
    G.score += CONFIG.scoring.pickup * multiplier();
  }
  if (o.orb) audio.orb(); else audio.pickup(G.combo);
  if (multiplier() > before) audio.comboUp();
}

function collisions() {
  const pb = player.box;
  for (const o of [...spawner.active]) {
    if (Math.abs(o.z) > 5 || o.ignore) continue;
    if (o.kind === 'P') {
      if (!o.collected && overlaps(pb, o)) collect(o);
      continue;
    }
    if (!overlaps(pb, o)) continue;
    if (OPT.god) continue;
    if (classify(player, o) === 'side') {
      o.ignore = true;
      const fatal = player.sideClip(G.runTime);
      G.shake = CONFIG.sideClip.shakeS;
      audio.clip();
      if (fatal) die();
    } else { die(); return; }
  }
  for (const p of spawner.popups) {
    if (p.hit) continue;
    if (Math.abs(p.z) < 0.5 && Math.abs(p.x - player.x) < 1.2 && pb.y1 > p.y - 0.62 && pb.y0 < p.y + 0.62) {
      p.hit = true;
      world.shatter(p.mesh.position);
      audio.shatter();
      egg('saga-popup');
    }
  }
}

function missedPickups() {
  for (const o of spawner.active) if (o.kind === 'P' && !o.collected && !o.missed && o.z > 1.4) { o.missed = true; G.combo = 0; }
}

function stepRunning(dt) {
  G.runTime += dt;
  G.speed = speedAt(G.distance);
  const dz = G.speed * dt;
  G.lastDistance = G.distance;
  G.distance += dz;
  G.score += dz * multiplier();
  player.update(dt, G.speed);
  playSounds();
  world.update(dz, dt, camera);
  spawner.update(dz, dt, G.speed, G.distance);
  audio.steps(dz, player.grounded);
  const tier = spawner.tierAt(G.distance);
  if (tier > G.tier) { G.tier = tier; audio.tierUp(); }
  audio.tick(G.speed, tier);
  collisions();
  missedPickups();
  // eggs
  if (G.lastDistance < CONFIG.eggs.distance404 && G.distance >= CONFIG.eggs.distance404) { hud.flash('Distance not found'); audio.glitch(); egg('saga-404'); }
  if (!G.flashedBest && G.best > 0 && G.score > G.best) { G.flashedBest = true; hud.flash('New best!'); audio.comboUp(); }
  updateHud();
}

function stepDying(dt) {
  G.dyingT += dt;
  const k = 0.25;                                       // slow motion
  G.speed = Math.max(0, G.speed * (1 - dt * 3));
  const dz = G.speed * dt * k;
  player.update(dt * k, G.speed);
  world.update(dz, dt * k, camera);
  spawner.update(dz, dt * k, G.speed, G.distance);
  if (G.dyingT >= 0.4) showDead();
}

function stepTitle(dt) {
  G.speed = 3;
  const dz = G.speed * dt;
  player.update(dt, 8);
  world.update(dz, dt, camera);
  G.titleIdle += dt;
  audio.tick(8, 0);
  if (G.titleIdle >= CONFIG.eggs.afkS && !player.sitting) { player.sitDown(); egg('saga-afk'); }
}

function stepDead(dt) { world.update(0, dt, camera); player.update(dt, 0); }

function updateHud() {
  hud.update({ distance: G.distance, score: Math.floor(G.score), pickups: G.pickups, best: G.best, combo: multiplier() > 1 });
}

function step(dt) {
  G.time += dt;
  switch (G.phase) {
    case 'running': stepRunning(dt); break;
    case 'dying': stepDying(dt); break;
    case 'title': stepTitle(dt); break;
    case 'dead': stepDead(dt); break;
  }
  updateCamera(dt);
  api.onTick?.(api);
}

// ---------------------------------------------------------------- loop
let last = 0, acc = 0, published = '';
/** Mirror the state into data-* attributes on <html>, so a test (or the shell, from outside) can see what the game is doing without a debug hook. */
function publish() {
  const s = `${G.phase}|${[...G.reasons].join(',')}|${G.best}|${G.runsSent}|${G.inits}`;
  if (s === published) return;
  published = s;
  const d = document.documentElement.dataset;
  d.phase = G.phase; d.paused = [...G.reasons].join(','); d.best = String(G.best); d.runs = String(G.runsSent); d.inits = String(G.inits);
}
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!paused()) {
    acc += real * OPT.speed;
    let n = 0;
    const maxSteps = Math.max(8, Math.ceil(8 * OPT.speed));
    while (acc >= STEP && n < maxSteps) { step(STEP); acc -= STEP; n++; }
    if (n === maxSteps) acc = 0;
    trackFrameTime(real);
  }
  if (!G.reasons.has('context')) renderer.render(scene, camera);
  publish();
  if (OPT.debug) debugOverlay(real);
}

/** Auto-drop to low quality if the average frame time stays above 22 ms for 3 s. */
function trackFrameTime(real) {
  if (G.phase !== 'running' || G.low) { G.slowFor = 0; return; }
  G.frameAvg = G.frameAvg * 0.9 + real * 1000 * 0.1;
  if (G.frameAvg > CONFIG.quality.autoDropMs) { G.slowFor += real; if (G.slowFor >= CONFIG.quality.autoDropS) setLow(); } else G.slowFor = 0;
}

let fpsT = 0, fpsN = 0;
function debugOverlay(real) {
  fpsT += real; fpsN++;
  if (fpsT >= 0.5) {
    G.fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0;
    hud.debug(`${G.fps} fps  ${renderer.info.render.calls} calls  ${renderer.info.render.triangles} tris\n${G.low ? 'low' : 'high'}  seed ${OPT.seed}  ${G.phase}`);
  }
}

// ---------------------------------------------------------------- testing hooks (B10)
let loseExt = null;
const api = {
  onTick: null,
  config: CONFIG,
  patterns: PATTERNS,
  state() {
    return {
      phase: G.phase, time: G.time, runTime: G.runTime, distance: G.distance, score: Math.floor(G.score), pickups: G.pickups, combo: G.combo,
      speed: G.speed, best: G.best, low: G.low, reasons: [...G.reasons], runOverSent: G.runOverSent, fps: G.fps, isBest: G.isBest,
      tier: spawner?.tierAt(G.distance), patternsSpawned: spawner?.patternsSpawned,
      player: player && { lane: player.lane, x: player.x, y: player.y, jumping: player.jumping, sliding: player.sliding, switching: player.switching, dead: player.dead, sitting: player.sitting, box: player.box },
      obstacles: spawner?.active.map((o) => ({ kind: o.kind, key: o.key, lane: o.lane, x: o.x, z: o.z, y: o.y, y0: o.y + o.box.y0, y1: o.y + o.box.y1, halfD: o.box.halfD, halfW: o.box.halfW, dir: o.dir })),
      popups: spawner?.popups.map((p) => ({ lane: p.lane, z: p.z, hit: p.hit })),
      draws: renderer?.info.render.calls,
    };
  },
  input(a) { player?.input(a); },
  start() { startRun(); },
  setDistance(m) { G.score += m - G.distance; G.distance = m; G.lastDistance = m; spawner.nextPopupM = (Math.floor(m / CONFIG.popupEveryM) + 1) * CONFIG.popupEveryM; G.speed = speedAt(m); },
  spawnPattern(id) {
    const p = PATTERNS.find((x) => x.id === id);
    if (!p) throw new Error(`no pattern ${id}`);
    const keep = spawner.cursor;
    spawner.cursor = -45;
    spawner.spawnPattern(p, G.speed);
    spawner.cursor = Math.min(keep, spawner.cursor);
  },
  kill() { die(); },
  loseContext() { loseExt = renderer.getContext().getExtension('WEBGL_lose_context'); loseExt?.loseContext(); return !!loseExt; },   // the extension object must be kept: a lost context no longer hands it out
  restoreContext() { loseExt?.restoreContext(); },
  clipLog() { return player?.anim.log; },
  audio: () => audioFx,
  spawner: () => spawner,
  assets: () => assets,
  player: () => player,
  world: () => world,
  camera: () => camera,
  renderer: () => renderer,
  get G() { return G; },
};
if (OPT.debug) window.__SPACESAGA = api;

boot();
