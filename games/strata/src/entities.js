// Mobs (STRATA_PART2_SPEC.md section 5): one entity system on a fixed step, with the same swept-AABB collision as the player. No DOM, no three.js (mobrender.js draws them),
// so Node tests drive it with a hand-built world and a seeded random source.
//
// A Mob is { id, type, def, x, y, z (feet), vx, vy, vz, yaw, hp, maxHp, state, t, ... }. Behaviour is a small state machine per kind (idle -> wander -> flee for the
// passive animals; hostile kinds are added by their own AI functions in ai.js). Everything random goes through the `rand` the manager was given.
import { CONFIG } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { MOBS, PASSIVE } from './mobdefs.js';
import { moveAxis, collidesAt } from './physics.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
/** The shortest signed angle from a to b. */
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export const hash = (a, b, c) => { let h = Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(c | 0, 0x27d4eb2f); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); return (h ^ (h >>> 15)) >>> 0; };
export const seededRand = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

let nextId = 1;
export class Mob {
  constructor(type, x, y, z, rand = Math.random) {
    const d = MOBS[type];
    if (!d) throw new Error(`unknown mob "${type}"`);
    this.id = nextId++; this.type = type; this.def = d;
    this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0;
    this.yaw = rand() * TAU; this.pitch = 0;
    this.hp = d.hp; this.maxHp = d.hp;
    this.state = 'idle'; this.t = 1 + rand() * 4;            // seconds left in the state
    this.goal = null;                                         // { x, z } a wander target
    this.fleeFrom = null;                                     // { x, z } what it runs from
    this.onGround = false; this.inWater = false; this.stuck = 0;
    this.hurtT = 0; this.barT = 0;                            // red tint, and how long its health bar still shows
    this.dead = false; this.deadT = 0;                        // dying: tips over, then is removed
    this.walk = 0; this.moveSpeed = 0;                        // animation phase and the speed it is moving at
    this.look = { yaw: 0, pitch: 0 };                         // where the head points (relative)
    this.sheared = false; this.regrow = 0;
    this.voiceT = 2 + rand() * 8;                             // seconds to the next idle sound
    this.age = 0; this.data = {};
  }
  get w() { return this.def.w; }
  get h() { return this.def.h; }
  eye() { return { x: this.x, y: this.y + this.def.eyeH, z: this.z }; }
}

export class Mobs {
  /** @param world { getBlock, has?(x, z) } ; @param opts.rand a 0..1 source (default Math.random) */
  constructor({ world, rand = Math.random } = {}) {
    this.world = world; this.rand = rand;
    this.list = [];
    this.seeded = new Set();                // chunks that had animals at some point: when all are killed the chunk is saved EMPTY, so they are not generated again
    this.parked = new Map();                // chunkKey -> [saved animals]: animals of chunks that are not loaded (persisted with the world)
    this.events = [];                       // { type: 'hurt' | 'die' | 'voice' | 'drop' | 'puff', ... } for the game to play, drain with takeEvents()
    this.respawnT = CONFIG.mobs.respawnS;
    this.cfg = CONFIG.mobs;
  }

  getBlock = (x, y, z) => this.world.getBlock(x, y, z);

  takeEvents() { const e = this.events; this.events = []; return e; }
  count(kind) { return this.list.filter((m) => !m.dead && (!kind || m.def.kind === kind)).length; }
  clear() { this.list.length = 0; this.parked.clear(); this.seeded.clear(); this.events.length = 0; this.respawnT = this.cfg.respawnS; }

  spawn(type, x, y, z) {
    const m = new Mob(type, x, y, z, this.rand);
    this.list.push(m);
    return m;
  }
  remove(m) { m.removed = true; this.list = this.list.filter((x) => x !== m); }

  // ------------------------------------------------------------------ chunks: animals are generated with the chunk and saved with it
  /** The animals a chunk starts with: a pure function of (seed, cx, cz), 40 % of grassy chunks get 2-4 of one species. Returns [{ type, x, z }] (y is found by the caller). */
  static seedAnimals(seed, cx, cz, grassAt) {
    const c = CONFIG.mobs, r = seededRand(hash(seed, cx * 7919 + 13, cz * 104729 + 7));
    if (r() >= c.chunkChance) return [];
    const type = PASSIVE[Math.floor(r() * PASSIVE.length)], n = c.perChunk[0] + Math.floor(r() * (c.perChunk[1] - c.perChunk[0] + 1)), out = [];
    for (let i = 0; i < n * 4 && out.length < n; i++) {
      const lx = Math.floor(r() * 16), lz = Math.floor(r() * 16), x = cx * 16 + lx + 0.5, z = cz * 16 + lz + 0.5, y = grassAt(lx, lz);
      if (y !== null && y !== undefined) out.push({ type, x, y: y + 1, z });
    }
    return out;
  }

  /**
   * A chunk was loaded: bring back its saved animals, or (a chunk never seen) generate its starting ones. `chunk` = { cx, cz, data, biomes }, `seed` the world seed.
   * Grass top = the highest grass block with two free blocks above, in a plains or forest column.
   */
  chunkLoaded(chunk, seed, sea = CONFIG.seaLevel) {
    const key = (chunk.cz << 16) | chunk.cx, saved = this.parked.get(key);
    if (saved) { for (const a of saved) this.#restore(a); this.parked.delete(key); this.seeded.add(key); return; }
    const grassAt = (lx, lz) => {
      const bio = chunk.biomes?.[(lz << 4) | lx];
      if (bio !== 0 && bio !== 1) return null;                                          // plains or forest
      for (let y = CONFIG.height - 3; y > sea; y--) {
        const id = chunk.data[(y << 8) | (lz << 4) | lx];
        if (id === B.air) continue;
        return id === B.grass && chunk.data[((y + 1) << 8) | (lz << 4) | lx] === B.air && chunk.data[((y + 2) << 8) | (lz << 4) | lx] === B.air ? y : null;
      }
      return null;
    };
    const fresh = Mobs.seedAnimals(seed, chunk.cx, chunk.cz, grassAt);
    for (const a of fresh) this.spawn(a.type, a.x, a.y, a.z);
    if (fresh.length) this.seeded.add(key);
  }

  /** A chunk is about to be unloaded: its animals are parked (kept for the save and for the next load) and removed. */
  chunkUnloaded(cx, cz, seed) {
    const mine = this.list.filter((m) => m.def.kind === 'passive' && !m.dead && (Math.floor(m.x) >> 4) === cx && (Math.floor(m.z) >> 4) === cz);
    for (const m of mine) this.remove(m);
    const key = (cz << 16) | cx;
    if (mine.length) this.parked.set(key, mine.map((m) => Mobs.pack(m)));
    else if (this.seeded.has(key)) this.parked.set(key, []);                              // all killed: it must not be generated again
    void seed;
  }

  static pack(m) { return [m.type, +m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), +m.yaw.toFixed(2), m.hp, m.sheared ? 1 : 0, Math.round(m.regrow)]; }
  #restore(a) {
    const [type, x, y, z, yaw, hp, sheared, regrow] = a;
    if (!MOBS[type]) return;
    const m = this.spawn(type, x, y, z);
    m.yaw = yaw; m.hp = Math.min(m.maxHp, hp); m.sheared = !!sheared; m.regrow = regrow;
    return m;
  }

  /** Every passive animal for the save: the parked ones and the ones in loaded chunks. [[cx, cz, [packed...]], ...] */
  toJSON() {
    const by = new Map(this.parked);
    for (const m of this.list) {
      if (m.def.kind !== 'passive' || m.dead) continue;
      const key = ((Math.floor(m.z) >> 4) << 16) | (Math.floor(m.x) >> 4);
      (by.get(key) ? by.get(key) : by.set(key, []).get(key)).push(Mobs.pack(m));
    }
    return [...by].map(([key, arr]) => [key & 0xffff, key >>> 16, arr]);
  }
  load(data) {
    this.list.length = 0; this.parked.clear(); this.seeded.clear();
    for (const e of Array.isArray(data) ? data : []) {
      if (!Array.isArray(e) || e.length !== 3 || !Array.isArray(e[2])) continue;
      const [cx, cz, arr] = e;
      if (!Number.isInteger(cx) || !Number.isInteger(cz) || arr.length > 64) continue;
      this.parked.set((cz << 16) | cx, arr.filter((a) => Array.isArray(a) && MOBS[a[0]] && a.slice(1, 6).every(Number.isFinite)));
    }
  }

  // ------------------------------------------------------------------ simulation
  /** Advance every mob by dt (at most about 1/30 s). ctx: { player: {x, y, z}, now } */
  update(dt, ctx) {
    for (const m of this.list) {
      if (m.dead) { m.deadT += dt; continue; }
      m.age += dt; m.hurtT = Math.max(0, m.hurtT - dt); m.barT = Math.max(0, m.barT - dt);
      if (m.def.kind === 'passive') this.#passive(m, dt, ctx);
      else this.hostile?.(m, dt, ctx);
      this.#body(m, dt);
      if (m.def.shearable && m.sheared) { m.regrow -= dt; if (m.regrow <= 0) m.sheared = false; }
      if (m.y < -40) { m.hp = 0; this.#die(m, null); }
    }
    this.list = this.list.filter((m) => !(m.dead && m.deadT > CONFIG.mobs.deathS));
  }

  /** Gravity, water, swept collision on x, z, y; a one-block step (jump) when it walks into a ledge. */
  #body(m, dt) {
    const g = this.getBlock, w = m.w, h = m.h;
    m.inWater = g(Math.floor(m.x), Math.floor(m.y + 0.3), Math.floor(m.z)) === B.water;
    const inLava = g(Math.floor(m.x), Math.floor(m.y + 0.2), Math.floor(m.z)) === B.lava;
    if (inLava && !m.dead) { m.lavaT = (m.lavaT ?? 0) + dt; if (m.lavaT >= 0.5) { m.lavaT = 0; this.damage(m, 4, { type: 'lava' }); } }
    if (m.def.flying && !m.dead) m.vy = Math.max(-6, Math.min(6, m.vy));                      // a flyer is steered by its AI, gravity does not apply
    else if (m.inWater) m.vy = Math.max(-1.5, m.vy - 8 * dt) + (m.vy < 1.2 ? 14 * dt : 0);       // floats up
    else m.vy = Math.max(-40, m.vy - 28 * dt);
    if (m.def.flutter && m.vy < -2.4) m.vy = -2.4;                                              // a chicken flaps and drops slowly
    const p = m, dx = m.vx * dt, dz = m.vz * dt;
    const hitX = moveAxis(g, p, w, h, 'x', dx), hitZ = moveAxis(g, p, w, h, 'z', dz);
    if ((hitX || hitZ) && m.onGround && !m.dead) {
      const ahead = { x: m.x + Math.sign(m.vx) * (w / 2 + 0.2), y: m.y + 1.01, z: m.z + Math.sign(m.vz) * (w / 2 + 0.2) };
      if (!collidesAt(g, { x: m.x + Math.sign(dx) * 0.3, y: m.y + 1.01, z: m.z + Math.sign(dz) * 0.3 }, w, h)) m.vy = Math.max(m.vy, 8.5);        // hop up a 1-block ledge
      m.stuck += dt; void ahead;
    } else m.stuck = Math.max(0, m.stuck - dt);
    const hitY = moveAxis(g, p, w, h, 'y', m.vy * dt);
    m.onGround = hitY && m.vy < 0;
    if (m.def.flying && !m.dead) m.onGround = false;
    if (hitY) m.vy = 0;
    if (m.onGround && !m.driven) { m.vx *= 0.82; m.vz *= 0.82; }                              // friction only while nothing pushes it
    m.driven = false;
    const sp = Math.hypot(m.vx, m.vz);
    m.moveSpeed = sp; m.walk += dt * (2 + sp * 4);
  }

  /** Walk toward (x, z) at `speed`, turning to face the way it goes. Returns the distance left. */
  steer(m, tx, tz, speed, dt, turn = 7) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const want = Math.atan2(-dx, -dz);                                                         // yaw 0 faces -z
      m.yaw += angDiff(m.yaw, want) * Math.min(1, turn * dt);
      const k = 1 - Math.min(0.9, Math.abs(angDiff(m.yaw, want)) / 2);                         // slows down while turning
      m.vx = lerp(m.vx, -Math.sin(m.yaw) * speed * k, Math.min(1, 10 * dt)); m.vz = lerp(m.vz, -Math.cos(m.yaw) * speed * k, Math.min(1, 10 * dt));
      m.driven = true;
    }
    return d;
  }

  /** Is the cell a step ahead a safe place (not lava, not a drop of more than 3, not deep water)? */
  safeAhead(m, dist = 0.9) {
    const x = Math.floor(m.x - Math.sin(m.yaw) * dist), z = Math.floor(m.z - Math.cos(m.yaw) * dist), y0 = Math.floor(m.y + 0.2);
    for (let dy = 0; dy >= -3; dy--) {
      const id = this.getBlock(x, y0 + dy, z);
      if (id === B.lava) return false;
      if (BLOCKS[id]?.solid) return true;
      if (id === B.water) return dy === 0;
    }
    return false;
  }

  #passive(m, dt, ctx) {
    const d = m.def, r = this.rand;
    m.voiceT -= dt;
    if (m.voiceT <= 0) { m.voiceT = 6 + r() * 14; this.events.push({ type: 'voice', mob: m, kind: 'idle' }); }
    if (m.state === 'flee') {
      m.t -= dt;
      if (m.fleeFrom) {
        const ax = m.x - m.fleeFrom.x, az = m.z - m.fleeFrom.z, d2 = Math.hypot(ax, az) || 1;
        if (!this.safeAhead(m, 0.9)) m.yaw += 1.2 * dt * 8;                                      // do not run off a cliff
        this.steer(m, m.x + ax / d2 * 4, m.z + az / d2 * 4, d.flee, dt, 9);
      }
      if (m.t <= 0 || m.stuck > 1.5) { m.state = 'idle'; m.t = 1 + r() * 3; m.stuck = 0; }
      return;
    }
    if (m.state === 'idle') {
      m.t -= dt;
      m.vx *= 0.8; m.vz *= 0.8;
      if (m.t <= 0) {
        if (r() < 0.55) { const a = r() * TAU, dist = 3 + r() * 6; m.goal = { x: m.x + Math.cos(a) * dist, z: m.z + Math.sin(a) * dist }; m.state = 'wander'; m.t = 8; m.stuck = 0; }
        else m.t = 2 + r() * 4;
      }
      return;
    }
    if (m.state === 'wander') {
      m.t -= dt;
      if (!this.safeAhead(m, 0.9)) { m.goal = null; m.state = 'idle'; m.t = 1 + r() * 2; m.yaw += Math.PI * (0.5 + r()); return; }
      const left = m.goal ? this.steer(m, m.goal.x, m.goal.z, d.speed, dt) : 0;
      if (!m.goal || left < 0.6 || m.t <= 0 || m.stuck > 1.2) { m.state = 'idle'; m.t = 2 + r() * 5; m.goal = null; m.stuck = 0; }
    }
    void ctx;
  }

  // ------------------------------------------------------------------ damage
  /**
   * Hurt a mob. opts: { from: {x, z}, knockback, type }. Returns { killed, drops: [stack...] } (drops only when it dies, rolled with the manager's rand).
   * A passive animal runs from whatever hit it.
   */
  damage(m, amount, opts = {}) {
    if (m.dead || amount <= 0) return { killed: false, drops: [] };
    m.hp -= amount; m.hurtT = 0.35; m.barT = 3; m.data.angry = true;
    this.events.push({ type: 'hurt', mob: m });
    if (opts.from) {
      const dx = m.x - opts.from.x, dz = m.z - opts.from.z, d = Math.hypot(dx, dz) || 1, k = opts.knockback ?? 0;
      m.vx += dx / d * k; m.vz += dz / d * k; if (k) m.vy = Math.max(m.vy, 4.2);
      if (m.def.kind === 'passive') { m.state = 'flee'; m.fleeFrom = { x: opts.from.x, z: opts.from.z }; m.t = 4; }
    }
    if (m.hp <= 0) return { killed: true, drops: this.#die(m, opts) };
    return { killed: false, drops: [] };
  }

  /** Death: it tips over for CONFIG.mobs.deathS, its drops are rolled. */
  #die(m, opts) {
    m.dead = true; m.deadT = 0; m.hp = 0;
    const drops = [];
    for (const [id, lo, hi, chance] of m.def.drops ?? []) {
      if (chance !== undefined && this.rand() >= chance) continue;                             // an optional 4th number: the chance of the drop at all
      const n = lo + Math.floor(this.rand() * (hi - lo + 1));
      if (n > 0) drops.push({ id, n });
    }
    if (m.def.shearable && !m.sheared) { /* the wool is a normal drop */ }
    this.events.push({ type: 'die', mob: m, drops, by: opts?.type ?? null });
    return drops;
  }

  /** Ray against the boxes of the living mobs: the nearest hit { mob, dist } or null. (o, d) is a unit ray. */
  raycast(o, d, reach = 3.5) {
    let best = null;
    for (const m of this.list) {
      if (m.dead) continue;
      const hw = m.w / 2, lo = [m.x - hw, m.y, m.z - hw], hi = [m.x + hw, m.y + m.h, m.z + hw], O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
      let t0 = 0, t1 = reach, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(D[k]) < 1e-9) { if (O[k] < lo[k] || O[k] > hi[k]) ok = false; continue; }
        let a = (lo[k] - O[k]) / D[k], b = (hi[k] - O[k]) / D[k];
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) ok = false;
      }
      if (ok && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
    }
    return best;
  }

  // ------------------------------------------------------------------ spawning over time
  /**
   * Call every step: one new animal per respawnS in a loaded grassy place near (but out of sight of) the player, while fewer than CONFIG.mobs.passiveCap are loaded.
   * `grassNear(x, z)` -> feet y of a grass top or null.
   */
  trickle(dt, player, grassNear) {
    this.respawnT -= dt;
    if (this.respawnT > 0) return null;
    this.respawnT = this.cfg.respawnS;
    if (this.count('passive') >= this.cfg.passiveCap) return null;
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * TAU, dist = 24 + this.rand() * 40, x = Math.floor(player.x + Math.cos(a) * dist) + 0.5, z = Math.floor(player.z + Math.sin(a) * dist) + 0.5;
      const y = grassNear(x, z);
      if (y === null || y === undefined) continue;
      return this.spawn(PASSIVE[Math.floor(this.rand() * PASSIVE.length)], x, y, z);
    }
    return null;
  }
}
