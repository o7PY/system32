// Pattern-based spawning with pooled obstacles. Never random per lane: hand-authored rows (config.js), tiers by distance, fair gaps.
import * as THREE from 'three';
import { CONFIG, PATTERNS } from './config.js';
import { MODELS } from './assets.js';
import { laneX } from './player.js';
import { parseToken, rowGap, safePath } from './patterns.js';

const KIND_MODELS = { L: MODELS.low, H: MODELS.high, B: MODELS.block };
// Floor markers under every obstacle so it reads at speed: yellow = jump, cyan = slide, red = go around.
const DECAL = { L: { color: 0xffd23c, w: 2.1, d: 1.7 }, H: { color: 0x3de0ff, w: 2.6, d: 1.5 }, B: { color: 0xff3b4a, w: 2.4, d: 3.4 } };

function softSquare() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 6, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,.95)'); grad.addColorStop(0.7, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Spawner {
  constructor({ scene, assets, world, rng }) {
    this.scene = scene;
    this.assets = assets;
    this.world = world;
    this.rng = rng;
    this.active = [];
    this.pools = new Map();         // key -> free Object3D[]
    this.cursor = CONFIG.firstRowZ;
    this.last = null;
    this.queuePattern = null;
    this.endLane = 1;
    this.patternsSpawned = 0;
    this.nextPopupM = CONFIG.popupEveryM;
    this.forced = [];               // test hook: pattern ids to spawn next
    this.popups = [];
    this.frozen = false;            // test hook: no automatic spawning
    const tex = softSquare();
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalMats = Object.fromEntries(Object.entries(DECAL).map(([k, d]) => [k, new THREE.MeshBasicMaterial({ map: tex, color: d.color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })]));
  }

  reset() {
    for (const o of [...this.active]) this.release(o);
    for (const p of this.popups) { this.scene.remove(p.mesh); }
    this.popups.length = 0;
    this.cursor = CONFIG.firstRowZ;
    this.last = null;
    this.endLane = 1;
    this.patternsSpawned = 0;
    this.nextPopupM = CONFIG.popupEveryM;
    this.forced.length = 0;
    this.frozen = false;
  }

  // ---- pools -------------------------------------------------------------
  #take(key, make) {
    const pool = this.pools.get(key);
    const obj = pool?.length ? pool.pop() : make();
    obj.visible = true;
    this.scene.add(obj);
    return obj;
  }
  release(o) {
    this.scene.remove(o.obj);
    o.obj.visible = false;
    if (o.anim) o.anim.dispose?.();
    (this.pools.get(o.key) ?? this.pools.set(o.key, []).get(o.key)).push(o.obj);
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
  }

  // ---- placing -----------------------------------------------------------
  #place(kind, lane, z, extra = {}) {
    const box = CONFIG.boxes[kind];
    let key, obj, anim = null, y = 0;
    if (kind === 'L' || kind === 'H' || kind === 'B') {
      const names = KIND_MODELS[kind];
      const name = names[Math.floor(this.rng() * names.length)];
      key = name;
      obj = this.#take(key, () => this.#withDecal(kind, this.assets.instance(name)));
      if (kind === 'H') y = CONFIG.highHang;
    } else if (kind === 'E') {
      const flyer = this.rng() < 0.4;
      key = flyer ? 'flyer' : 'walker';
      obj = this.#take(key, () => { const c = this.assets.character(flyer ? MODELS.flyer : MODELS.walker); c.root.userData.anim = c.anim; return c.root; });
      anim = obj.userData.anim;
      anim.play(flyer ? 'run' : 'idle');           // the flyer's "run" is its Fast_Flying loop (mapped by the walk/run fallback rules)
      if (flyer) y = 0.25;
    } else if (kind === 'P') {
      const orb = extra.orb;
      key = orb ? 'orb' : 'bolt';
      obj = this.#take(key, () => this.assets.instance(orb ? MODELS.orb : MODELS.bolt));
      y = extra.y ?? 0.4;
    }
    const o = { kind, key, obj, anim, lane, x: laneX(lane), z, y, box, dir: extra.dir ?? 0, walking: false, walked: 0, collected: false, orb: !!extra.orb, hit: false };
    if (kind === 'E') obj.rotation.y = 0;
    else if (kind === 'B') obj.rotation.y = Math.PI * (this.rng() < 0.5 ? 0 : 0);
    this.active.push(o);
    this.#sync(o);
    return o;
  }

  #withDecal(kind, model) {
    const g = new THREE.Group();
    const d = new THREE.Mesh(this.decalGeo, this.decalMats[kind]);
    d.scale.set(DECAL[kind].w, 1, DECAL[kind].d);
    d.position.y = (kind === 'H' ? -CONFIG.highHang : 0) + 0.04;
    g.add(model, d);
    return g;
  }

  #sync(o) {
    o.obj.position.set(o.x, o.y, o.z);
  }

  /** Place one obstacle by hand (test hook / debugging). */
  add(kind, lane, z, extra) { return this.#place(kind, lane, z, extra); }

  // ---- patterns ----------------------------------------------------------
  tierAt(distance) { let t = 0; CONFIG.tiers.forEach((d, i) => { if (distance >= d) t = i; }); return t; }

  choose(distance) {
    if (this.forced.length) { const id = this.forced.shift(); return PATTERNS.find((p) => p.id === id); }
    const tier = this.tierAt(distance);
    const pool = PATTERNS.filter((p) => p.tier <= tier && p.id !== this.last?.id);
    // newer tiers are weighted up a little so progress is felt
    const weights = pool.map((p) => 1 + (p.tier === tier ? 0.8 : 0));
    let r = this.rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  /** Spawn one pattern with its first row at z = this.cursor. Returns the z of its last row. */
  spawnPattern(pattern, speed) {
    let z = this.cursor;
    const rowsZ = [];
    pattern.rows.forEach((row, i) => {
      rowsZ.push(z);
      row.forEach((t, lane) => {
        const tok = parseToken(t);
        if (tok.type === '.') return;
        this.#place(tok.type, lane, z, { dir: tok.dir });
      });
      if (i + 1 < pattern.rows.length) z -= rowGap(pattern, row, pattern.rows[i + 1], speed + 1);
    });
    const afterGap = Math.max(CONFIG.minPatternGap, (speed + 1) * CONFIG.patternGapS);
    this.#pickups(pattern, rowsZ, afterGap);
    this.last = pattern;
    this.patternsSpawned++;
    this.cursor = z - afterGap;
    return z;
  }

  /** Pickups follow the safe path: lines along a lane, arcs over low obstacles. */
  #pickups(pattern, rowsZ, afterGap) {
    if (this.rng() > CONFIG.pickupChance) return;
    const path = safePath(pattern, this.endLane) ?? [1];
    const orbRoll = this.rng() < CONFIG.orbChance;
    pattern.rows.forEach((row, i) => {
      const lane = path[i];
      const z = rowsZ[i];
      if (parseToken(row[lane]).type === 'L' || parseToken(row[lane]).type === 'E') {
        [[2.4, 0.9], [0, 1.6], [-2.4, 0.9]].forEach(([dz, y]) => this.#place('P', lane, z + dz, { y, orb: false }));
      }
      if (i + 1 < pattern.rows.length && path[i + 1] === lane) {
        // a line along the lane between two rows, clear of both
        for (let dz = 6; dz <= rowsZ[i] - rowsZ[i + 1] - 6; dz += 3) this.#place('P', lane, z - dz, { y: 0.4 });
      }
    });
    this.endLane = path[path.length - 1];
    // a short line after the pattern, in the lane you finish in (an orb now and then instead of the middle bolt)
    const lastZ = rowsZ[rowsZ.length - 1];
    const n = Math.min(3 + Math.floor(this.rng() * 4), Math.floor((afterGap - 10) / 3) + 1);
    for (let k = 0; k < n; k++) {
      const orb = orbRoll && k === Math.floor(n / 2);
      this.#place('P', this.endLane, lastZ - 6 - k * 3, { y: orb ? 0.5 : 0.4, orb });
    }
  }

  // ---- per tick ----------------------------------------------------------
  /** Move everything toward the camera by dz and spawn what is due. */
  update(dz, dt, speed, distance) {
    this.cursor += dz;
    for (const o of this.active) {
      o.z += dz;
      if (o.kind === 'E') this.#enemy(o, dt, speed);
      else if (o.kind === 'P') { o.obj.rotation.y += dt * 2.4; o.obj.position.y = o.y + Math.sin((o.z + o.y) * 0.4) * 0.06; }
      if (o.kind === 'P') { o.obj.position.x = o.x; o.obj.position.z = o.z; }
      else this.#sync(o);
      o.anim?.update(dt);
    }
    // despawn behind the camera
    for (const o of [...this.active]) if (o.z > 12) this.release(o);

    let guard = 6;
    while (!this.frozen && this.cursor > -CONFIG.spawnAhead && guard--) {
      this.spawnPattern(this.choose(distance), speed);
    }
    this.#popups(dz, dt, distance);
  }

  #enemy(o, dt, speed) {
    if (!o.walking && o.z > -speed * CONFIG.enemy.leadS) {
      o.walking = true;
      this.onEvent?.('alien', o.key);
      o.anim.play(o.key === 'flyer' ? 'run' : 'walk');
      if (o.key === 'walker') o.obj.rotation.y = o.dir * Math.PI / 2;
    }
    if (o.walking === true) {
      const maxX = laneX(2), minX = laneX(0);
      const nx = o.x + o.dir * dt * (CONFIG.laneWidth / CONFIG.enemy.laneS);
      if (nx >= maxX || nx <= minX) {
        o.x = Math.max(minX, Math.min(maxX, nx));
        o.walking = 'done';
        o.anim.play('idle');
        if (o.key === 'walker') o.obj.rotation.y = 0;
      } else o.x = nx;
    }
    if (o.key === 'flyer') o.y = 0.25 + Math.sin(performance.now() / 260 + o.z) * 0.08;
  }

  // ---- pop-up ad debris (decorative; shatters when you jump through it) ----
  addPopup(lane, z) {
    const mesh = this.world.makePopup();
    const p = { mesh, lane, x: laneX(lane), z, y: 2.6, t: 0, hit: false };
    mesh.position.set(p.x, p.y, z);
    this.scene.add(mesh);
    this.popups.push(p);
    return p;
  }

  #popups(dz, dt, distance) {
    if (distance >= this.nextPopupM) {
      this.nextPopupM += CONFIG.popupEveryM;
      this.addPopup(Math.floor(this.rng() * 3), -CONFIG.spawnAhead + 20);
    }
    for (const p of [...this.popups]) {
      p.z += dz; p.t += dt;
      p.mesh.position.set(p.x + Math.sin(p.t * 0.9) * 0.25, p.y + Math.sin(p.t * 1.7) * 0.1, p.z);
      p.mesh.rotation.set(Math.sin(p.t) * 0.12, 0.3 + Math.sin(p.t * 0.7) * 0.3, Math.sin(p.t * 0.5) * 0.1);
      if (p.z > 12 || p.hit) { this.scene.remove(p.mesh); this.popups.splice(this.popups.indexOf(p), 1); }
    }
  }
}
