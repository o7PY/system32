// Loads the processed GLBs (games/space-saga/models, meshopt-compressed), builds clones for the pools and maps animation clips to game states.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Model names = file names in models/ (built by tools/build-assets.mjs from tools/assets.json). */
export const MODELS = {
  player: 'player',
  walker: 'enemy-walker',
  flyer: 'enemy-flyer',
  low: ['low-crate', 'low-rock', 'low-solar', 'low-vent'],
  high: ['high-pipe', 'high-truss'],
  block: ['block-rover1', 'block-rover2'],
  bolt: 'pick-bolt',
  orb: 'pick-orb',
  decor: ['decor-crystals', 'decor-spire', 'decor-plant1', 'decor-plant3', 'decor-treelight', 'decor-treeswirl', 'decor-treelava', 'decor-treefloat', 'decor-radar'],
  planets: ['planet-1', 'planet-7', 'planet-8'],
};
export const ALL_MODEL_NAMES = Object.values(MODELS).flat();

const FADE_S = 0.12;                                   // crossfade between clips

/** Pick a clip by case-insensitive name: exact names first (so "Run" wins over "Run_Gun"), then looser patterns. */
const pick = (clips, ...res) => { for (const re of res) { const c = clips.find((k) => re.test(k.name)); if (c) return c; } return null; };

/**
 * Map clips to game states (SPACESAGA_SPEC.md B3 "Animation mapping").
 * Each entry: { clip, timeScale?, still?, fallback? } or { proc:'squash'|'fall', fallback }. Returns { map, log }.
 */
export function mapClips(clips) {
  const log = [];
  const map = {};
  const set = (state, entry, why) => { map[state] = entry; log.push(`${state}: ${entry.clip ? `"${entry.clip.name}"` : entry.proc}${entry.fallback ? ` (fallback: ${entry.fallback})` : ''}${why ? ` ${why}` : ''}`); };

  const run = pick(clips, /^run$/i, /run|sprint/i);
  const walk = pick(clips, /^walk$/i, /walk/i);
  const fly = pick(clips, /^fast_flying$/i, /fly/i);
  if (walk) { map.walk = { clip: walk }; }                         // the walker crosses lanes on foot (not logged: only needed by enemies)
  if (run) set('run', { clip: run });
  else if (fly) set('run', { clip: fly, fallback: 'flying loop' });
  else if (walk) set('run', { clip: walk, timeScale: 1.6, fallback: 'walk at 1.6x' });

  const jump = pick(clips, /^jump$/i, /jump/i);
  if (jump) set('jump', { clip: jump });
  else if (map.run) set('jump', { clip: map.run.clip, timeScale: map.run.timeScale, fallback: 'run clip + code arc' });

  const slide = pick(clips, /^(slide|duck|crouch|roll)$/i, /slide|duck|crouch|roll/i);
  if (slide) set('slide', { clip: slide });
  else set('slide', { proc: 'squash', fallback: 'squash to 50% height, tilt 25 deg' });

  const death = pick(clips, /^(death|die)$/i, /death|die|hit/i);
  if (death) set('death', { clip: death });
  else set('death', { proc: 'fall', fallback: 'fall over backwards' });

  const idle = pick(clips, /^idle$/i, /idle/i);
  if (idle) set('idle', { clip: idle });
  else if (map.run) set('idle', { clip: map.run.clip, still: true, fallback: 'first frame of run' });

  return { map, log };
}

/** Plays mapped clips with crossfades and procedural fallbacks on the clone's own root. */
export class Animator {
  constructor(root, clips, name = '') {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    const { map, log } = mapClips(clips);
    this.map = map;
    this.log = log;
    this.name = name;
    this.current = null;
    this.state = null;
    this.proc = null;          // 'squash' | 'fall' | null
    this.procT = 0;
    this.base = { sy: root.scale.y, rx: root.rotation.x };
  }

  /** @param fitS make a one-shot clip last exactly this long (jump 0.65 s, slide 0.6 s) */
  play(state, { once = false, fitS = 0, rate = 1 } = {}) {
    const e = this.map[state];
    if (!e) return;
    this.state = state;
    this.proc = e.proc ?? null;
    this.procT = 0;
    if (!e.clip) { this.#fade(null); return; }
    const a = this.mixer.clipAction(e.clip);
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = (e.timeScale ?? 1) * rate * (fitS ? e.clip.duration / fitS : 1);
    a.paused = !!e.still;
    a.enabled = true;
    a.play();
    this.#fade(a);
  }

  #fade(next) {
    const prev = this.current;
    if (prev && prev !== next) { if (next) next.crossFadeFrom(prev, FADE_S, false); else prev.fadeOut(FADE_S); }
    this.current = next;
  }

  setRate(rate) { if (this.current && this.state === 'run') this.current.timeScale = (this.map.run.timeScale ?? 1) * rate; }

  update(dt) {
    this.mixer.update(dt);
    const r = this.root;
    if (this.proc === 'squash') { r.scale.y = this.base.sy * 0.5; r.rotation.x = this.base.rx + 0.44; }
    else if (this.proc === 'fall') { this.procT = Math.min(1, this.procT + dt / 0.5); r.rotation.x = this.base.rx - this.procT * 1.5; }
    else { r.scale.y = this.base.sy; r.rotation.x = this.base.rx; }
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}

export class Assets {
  constructor() { this.gltf = new Map(); this.log = []; }

  /** @param onProgress (0..1, name) */
  async load(onProgress = () => {}) {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    const total = ALL_MODEL_NAMES.length;
    let done = 0;
    await Promise.all(ALL_MODEL_NAMES.map(async (name) => {
      const g = await loader.loadAsync(`./models/${name}.glb`);
      g.scene.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
      this.gltf.set(name, g);
      onProgress(++done / total, name);
    }));
    // pickups must pop against the dark track: own materials with a glow
    const glow = { [MODELS.bolt]: [0xffd75a, 0xffa800], [MODELS.orb]: [0xff6a9a, 0xff1f5a] };
    for (const [n, [color, emissive]] of Object.entries(glow)) {
      this.gltf.get(n).scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.set(color);
        o.material.emissive.set(emissive);
        o.material.emissiveIntensity = 0.9;
      });
    }
    // planets sit beyond the fog: give them their own materials with fog off
    for (const n of MODELS.planets) {
      this.gltf.get(n).scene.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.fog = false; o.material.userData.noBend = true; } });
    }
    return this;
  }

  clips(name) { return this.gltf.get(name).animations; }

  /** A static clone (geometry and materials are shared, so a pool of these costs almost nothing). */
  instance(name) { return this.gltf.get(name).scene.clone(true); }

  /** A skinned clone with its own mixer. */
  character(name) {
    const g = this.gltf.get(name);
    const root = cloneSkinned(g.scene);
    const anim = new Animator(root, g.animations, name);
    return { root, anim };
  }
}
