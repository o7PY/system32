// The Garbage Collector (STRATA_PART2_SPEC.md 7.3): a pure state machine on top of a Mobs entity. No DOM, no three.js: Node tests run whole fights with a bot.
//
// Phases by health: 1 "Mark" (100-70 %), 2 "Sweep" (70-35 %), 3 "Compact" (35-0 %). Every attack is TELEGRAPHED: marked blocks glow red for 3 s before they are deleted, a charge has a
// 1.2 s wind-up roar, a stomp shakes the camera before the boss kneels with its core exposed for 3 s. Armor: only half of every hit counts, except hits on the exposed core (double).
import { CONFIG } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { ARENA, arenaCell } from './arena.js';

const TAU = Math.PI * 2;
export const BOSS_HP = 300;
export const phaseOf = (hp) => (hp > BOSS_HP * 0.7 ? 1 : hp > BOSS_HP * 0.35 ? 2 : 3);

const CFG = {
  walk: [0, 2.4, 2.9, 3.4], swipeReach: 4.4, swipeWind: 0.6, swipeCool: [0, 2.4, 2.0, 1.4], swipeDamage: 6, swipeKnock: 11,
  markEvery: { normal: 8, hard: 6, peaceful: 12 }, markDelayS: 3, markCols: [0, [12, 20], [16, 24], [20, 28]], markRadius: [0, 3.2, 3.8, 4.4],
  stompWind: 0.8, kneelS: [0, 3, 3, 3.6], stompDamage: 4, stompRadius: 6, extraStompEveryS: 7,
  charge: { everyS: [0, 0, 12, 9], windS: 1.2, speed: 14, maxS: 2.3, damage: 8, knock: 12, tiredS: 0.9 },
  pointers: { count: 4, again: 18 }, heal: { perS: 2, minCrystals: 2 },
  coreY: [3.0, 5.8], coreFront: 2.2,
  dyingS: 3.2, coreRiseS: 1.5,
};

export class Boss {
  /** @param o { mobs, world (getBlock + setBlock), rand, difficulty: 'peaceful' | 'normal' | 'hard' } */
  constructor({ mobs, world, rand = Math.random, difficulty = 'normal' }) {
    this.mobs = mobs; this.world = world; this.rand = rand; this.difficulty = difficulty;
    this.events = []; this.marks = []; this.m = null; this.core = null; this.phase = 1; this.t = 0;
    this.shrinkR = ARENA.shrink.from; this.shrinkT = ARENA.shrink.everyS; this.shrinkSteps = 0;
    this.pointerT = CFG.pointers.again; this.won = false; this.pointers = [];
  }
  takeEvents() { const e = this.events; this.events = []; return e; }
  get alive() { return !!this.m && !this.m.dead && this.state !== 'dying'; }
  get hp() { return this.m?.hp ?? 0; }
  get exposed() { return this.state === 'kneel'; }
  /** The boss bar: { name, frac }. */
  bar() { return this.m ? { name: 'The Garbage Collector', frac: this.m.hp / BOSS_HP, green: this.exposed } : null; }

  /** Spawn the boss in the arena and arm every timer. */
  start() {
    const m = this.m = this.mobs.spawn('gc', ARENA.boss.x, ARENA.boss.y, ARENA.boss.z);
    m.yaw = 0; this.state = 'walk'; this.stateT = 0; this.phase = 1; this.t = 0;
    this.markIn = 4; this.swipeIn = 0; this.chargeIn = CFG.charge.everyS[2]; this.stompIn = CFG.extraStompEveryS; this.afterDelete = false; this.windup = 0;
    m.data.modify = (amount, opts) => this.#modify(amount, opts);
    this.events.push({ type: 'start' });
    return m;
  }

  /** How much of a hit counts: half, or double on the exposed core. opts.point = where it landed { x, y, z }. */
  #modify(amount, opts) {
    if (this.state === 'dying') return 0;
    const m = this.m, p = opts.point;
    let core = false;
    if (this.exposed && p) {
      const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw), dx = p.x - m.x, dz = p.z - m.z, front = dx * fx + dz * fz;
      core = front > 0 && Math.hypot(dx, dz) < CFG.coreFront + 1.2 && p.y - m.y >= CFG.coreY[0] - 1.2 && p.y - m.y <= CFG.coreY[1];
    } else if (this.exposed && !p) core = true;                            // no point given (a test or a splash): count it as a core hit while exposed
    this.events.push({ type: core ? 'core-hit' : 'armor-hit' });
    return core ? amount * 2 : amount * 0.5;
  }

  crystalsStanding() { return ARENA.crystals.filter((c) => this.world.getBlock(c.x, c.y, c.z) === B.kernel_crystal).length; }

  // ------------------------------------------------------------------ marks: columns of the platform that glow red for 3 s and are then deleted
  /** Mark these columns [{x, z}]: every solid, breakable block of the arena platform in them turns red. Returns the cells marked. */
  mark(cols, delayS = CFG.markDelayS) {
    const cells = [];
    for (const { x, z } of cols) for (let y = ARENA.top - ARENA.thick + 1; y <= ARENA.top; y++) {
      const id = this.world.getBlock(x, y, z);
      if (id === B.air || id === B.memory_marked || BLOCKS[id].hardness < 0 || !BLOCKS[id].solid) continue;
      this.world.setBlock(x, y, z, B.memory_marked);
      cells.push({ x, y, z });
    }
    if (cells.length) { this.marks.push({ cells, t: delayS, n: cols.length }); this.events.push({ type: 'mark', n: cols.length, cells: cells.length }); }
    return cells;
  }
  #deleteMarks(dt) {
    for (const mk of this.marks) mk.t -= dt;
    const due = this.marks.filter((mk) => mk.t <= 0);
    if (!due.length) return false;
    this.marks = this.marks.filter((mk) => mk.t > 0);
    let n = 0;
    for (const mk of due) for (const c of mk.cells) if (this.world.getBlock(c.x, c.y, c.z) === B.memory_marked) { this.world.setBlock(c.x, c.y, c.z, B.air); n++; }
    this.events.push({ type: 'delete', cells: n });
    return true;
  }
  /** Choose the columns to mark around the player: always the one he stands on, then a clump around it. */
  #pickColumns(P) {
    const [lo, hi] = CFG.markCols[this.phase], n = lo + Math.floor(this.rand() * (hi - lo + 1)), R = CFG.markRadius[this.phase], seen = new Set(), cols = [];
    const add = (x, z) => {
      if (!arenaCell(x, ARENA.top, z) || seen.has(`${x},${z}`)) return;
      seen.add(`${x},${z}`); cols.push({ x, z });
    };
    add(Math.floor(P.x), Math.floor(P.z));
    for (let tries = 0; cols.length < n && tries < 400; tries++) { const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * R; add(Math.floor(P.x + Math.cos(a) * r), Math.floor(P.z + Math.sin(a) * r)); }
    return cols;
  }

  // ------------------------------------------------------------------ the step
  /**
   * Advance by dt. ctx = { player: { x, y, z, onGround }, hurt(amount, opts) -> applied, knock(dx, dz, k), peaceful }.
   * Returns nothing: the boss moves its mob (the Mobs step does the collision), and reports through takeEvents().
   */
  step(dt, ctx) {
    const m = this.m;
    if (!m || this.won && !m.hp) return;
    this.t += dt; this.stateT += dt;
    if (m.y < ARENA.top - 1.2 && this.state !== 'dying') this.#relocate();                        // the arena never kills the boss: if the floor went from under it, it steps back onto solid ground
    const P = ctx.player, dx = P.x - m.x, dz = P.z - m.z, dist = Math.hypot(dx, dz);
    if (this.state === 'dying') return this.#dying(dt);
    if (m.hp <= 0) return this.#startDying();
    // phases
    const ph = Math.max(this.phase, phaseOf(m.hp));                                                  // phases are one-way: healing never takes it back
    if (ph !== this.phase) { this.phase = ph; this.events.push({ type: 'phase', phase: ph }); this.#phaseStart(ctx); }
    // crystals heal it in phases 2 and 3
    if (this.phase >= 2 && this.crystalsStanding() >= CFG.heal.minCrystals && m.hp < BOSS_HP) { m.hp = Math.min(BOSS_HP, m.hp + CFG.heal.perS * dt); this.events.push({ type: 'heal' }); }
    // marks come due
    const deleted = this.#deleteMarks(dt);
    if (deleted && this.state === 'walk' && !this.afterDelete) { this.afterDelete = true; this.#beginStomp(); }
    else if (deleted) this.afterDelete = true;
    if (this.phase === 3) this.#shrink(dt);
    this.#pointers(dt, ctx);
    this.markIn -= dt; this.chargeIn -= dt; this.stompIn -= dt; this.swipeIn -= dt;                      // the timers run whatever the boss is doing; an attack waits for its turn (state 'walk')
    // facing: always toward you except while charging
    if (this.state !== 'charge' && this.state !== 'kneel') m.yaw += angDiff(m.yaw, Math.atan2(-dx, -dz)) * Math.min(1, 4 * dt);
    switch (this.state) {
      case 'walk': return this.#walk(dt, ctx, dist, dx, dz);
      case 'swipe': return this.#swipe(dt, ctx, dist);
      case 'stompWind': m.vx = m.vz = 0; this.events.push({ type: 'shake', k: 0.15 + 0.5 * (this.stateT / CFG.stompWind) }); if (this.stateT >= CFG.stompWind) this.#kneel(ctx); return;
      case 'kneel': m.vx = m.vz = 0; if (this.stateT >= CFG.kneelS[this.phase]) { this.state = 'walk'; this.stateT = 0; this.afterDelete = false; } return;
      case 'chargeWind': m.vx = m.vz = 0; if (this.stateT >= CFG.charge.windS) { this.state = 'charge'; this.stateT = 0; const l = Math.hypot(dx, dz) || 1; this.dir = { x: dx / l, z: dz / l }; m.yaw = Math.atan2(-this.dir.x, -this.dir.z); this.hitCharge = false; this.events.push({ type: 'charge' }); } return;
      case 'charge': return this.#charge(dt, ctx, dist);
      case 'tired': m.vx = m.vz = 0; if (this.stateT >= CFG.charge.tiredS) { this.state = 'walk'; this.stateT = 0; } return;
    }
  }

  #phaseStart(ctx) {
    this.events.push({ type: 'shake', k: 0.6 });
    if (this.phase >= 2 && !ctx.peaceful) this.#summonPointers();
    if (this.phase === 3) { this.shrinkT = ARENA.shrink.everyS; }
  }

  #walk(dt, ctx, dist, dx, dz) {
    const m = this.m, P = ctx.player;
    const sp = CFG.walk[this.phase];
    if (dist > CFG.swipeReach - 1) {
      const l = dist || 1, ux = dx / l, uz = dz / l;
      const ahead = this.world.getBlock(Math.floor(m.x + ux * 1.6), ARENA.top, Math.floor(m.z + uz * 1.6));        // it never walks off the platform or into a hole it made
      if (BLOCKS[ahead]?.solid) { m.vx += (ux * sp - m.vx) * Math.min(1, 6 * dt); m.vz += (uz * sp - m.vz) * Math.min(1, 6 * dt); m.driven = true; } else { m.vx *= 0.7; m.vz *= 0.7; }
    }
    if (dist < CFG.swipeReach && this.swipeIn <= 0) { this.state = 'swipe'; this.stateT = 0; this.hitSwipe = false; this.events.push({ type: 'swipe-wind' }); return; }
    if (this.markIn <= 0) {
      this.markIn = CFG.markEvery[ctx.peaceful ? 'peaceful' : this.difficulty] ?? 8; this.afterDelete = false;
      this.mark(this.#pickColumns(P));
    }
    if (this.phase >= 2 && this.chargeIn <= 0 && dist > 7) { this.chargeIn = CFG.charge.everyS[this.phase]; this.state = 'chargeWind'; this.stateT = 0; this.events.push({ type: 'roar' }); return; }
    if (this.phase === 3 && this.stompIn <= 0 && this.marks.length === 0) { this.stompIn = CFG.extraStompEveryS; this.#beginStomp(); }
  }
  #beginStomp() { this.state = 'stompWind'; this.stateT = 0; this.events.push({ type: 'stomp-wind' }); }
  #kneel(ctx) {
    this.state = 'kneel'; this.stateT = 0; this.stompIn = CFG.extraStompEveryS;
    this.events.push({ type: 'stomp' }); this.events.push({ type: 'shake', k: 1 });
    const P = ctx.player, d = Math.hypot(P.x - this.m.x, P.z - this.m.z);
    if (d < CFG.stompRadius && P.onGround !== false) { const a = ctx.hurt(CFG.stompDamage, { type: 'boss', name: 'the Garbage Collector', from: { x: this.m.x, z: this.m.z } }); if (a) ctx.knock?.(P.x - this.m.x, P.z - this.m.z, 6); }
  }
  #swipe(dt, ctx, dist) {
    const m = this.m, P = ctx.player;
    m.vx *= 0.8; m.vz *= 0.8;
    const wind = CFG.swipeWind * (this.phase === 3 ? 0.65 : 1);                                        // faster swipes in the last phase
    if (this.stateT >= wind && !this.hitSwipe) {
      this.hitSwipe = true; this.events.push({ type: 'swipe' });
      if (dist < CFG.swipeReach + 0.6) { const a = ctx.hurt(CFG.swipeDamage, { type: 'boss', name: 'the Garbage Collector', from: { x: m.x, z: m.z } }); if (a) ctx.knock?.(P.x - m.x, P.z - m.z, CFG.swipeKnock); }
    }
    if (this.stateT >= wind + 0.35) { this.state = 'walk'; this.stateT = 0; this.swipeIn = CFG.swipeCool[this.phase]; }
  }
  #charge(dt, ctx, dist) {
    const m = this.m, P = ctx.player, c = CFG.charge;
    m.vx = this.dir.x * c.speed; m.vz = this.dir.z * c.speed; m.driven = true;
    if (!this.hitCharge && Math.hypot(P.x - m.x, P.z - m.z) < 2.6 && Math.abs(P.y - m.y) < 3) {
      this.hitCharge = true;
      const a = ctx.hurt(c.damage, { type: 'boss', name: 'the Garbage Collector', from: { x: m.x, z: m.z } }); if (a) ctx.knock?.(this.dir.x, this.dir.z, c.knock);
    }
    const edge = Math.hypot(m.x - ARENA.cx, m.z - ARENA.cz) > this.shrinkR - 2;
    if (this.stateT >= c.maxS || edge) { this.state = 'tired'; this.stateT = 0; m.vx = m.vz = 0; this.events.push({ type: 'shake', k: 0.7 }); }
  }

  // ------------------------------------------------------------------ pointers
  #summonPointers() {
    this.pointerT = CFG.pointers.again;
    for (let i = 0; i < CFG.pointers.count; i++) {
      const a = (i / CFG.pointers.count) * TAU, p = this.mobs.spawn('pointer', this.m.x + Math.cos(a) * 3, this.m.y + 6, this.m.z + Math.sin(a) * 3);
      this.pointers.push(p);
    }
    this.events.push({ type: 'pointers' });
  }
  #pointers(dt, ctx) {
    if (this.phase < 2 || ctx.peaceful) return;
    this.pointers = this.pointers.filter((p) => !p.dead && !p.removed);
    this.pointerT -= dt;
    if (this.pointers.length === 0 && this.pointerT <= 0) this.#summonPointers();
  }

  // ------------------------------------------------------------------ phase 3: the arena shrinks
  #shrink(dt) {
    if (this.shrinkR <= ARENA.shrink.to) return;
    this.shrinkT -= dt;
    if (this.shrinkT > 0) return;
    this.shrinkT = ARENA.shrink.everyS;
    const from = this.shrinkR, to = Math.max(ARENA.shrink.to, from - ARENA.shrink.step), cols = [];
    for (let x = ARENA.cx - from; x <= ARENA.cx + from; x++) for (let z = ARENA.cz - from; z <= ARENA.cz + from; z++) { const r = Math.hypot(x + 0.5 - ARENA.cx, z + 0.5 - ARENA.cz); if (r > to && r <= from) cols.push({ x: Math.floor(x), z: Math.floor(z) }); }
    this.shrinkR = to; this.shrinkSteps++;
    this.mark(cols);
    this.events.push({ type: 'shrink', radius: to });
  }

  /** The nearest column of the platform that still has its top block (and is not marked), searching outward from (x, z). Falls back to the middle. */
  #solidSpot(x, z) {
    for (let r = 0; r <= 40; r++) for (let a = 0; a < Math.max(1, r * 6); a++) {
      const ang = (a / Math.max(1, r * 6)) * TAU, cx = Math.floor(x + Math.cos(ang) * r), cz = Math.floor(z + Math.sin(ang) * r), id = this.world.getBlock(cx, ARENA.top, cz);
      if (BLOCKS[id]?.solid && id !== B.memory_marked && Math.hypot(cx + 0.5 - ARENA.cx, cz + 0.5 - ARENA.cz) < this.shrinkR - 2) return { x: cx + 0.5, z: cz + 0.5 };
    }
    return { x: ARENA.cx + 0.5, z: ARENA.cz + 0.5 };
  }
  #relocate() { const s = this.#solidSpot(this.m.x, this.m.z); this.m.x = s.x; this.m.z = s.z; this.m.y = ARENA.top + 1; this.m.vx = this.m.vz = this.m.vy = 0; this.events.push({ type: 'relocate' }); }

  // ------------------------------------------------------------------ the end
  #startDying() {
    this.state = 'dying'; this.stateT = 0; this.m.vx = this.m.vz = 0; this.m.hp = 0;
    for (const mk of this.marks) for (const c of mk.cells) if (this.world.getBlock(c.x, c.y, c.z) === B.memory_marked) this.world.setBlock(c.x, c.y, c.z, B.memory_block);        // the arena calms: pending marks are cancelled
    this.marks = [];
    for (const p of this.pointers) if (p.data && !p.dead) this.mobs.damage(p, 99, {});
    this.events.push({ type: 'dying' });
  }
  #dying(dt) {
    const m = this.m;
    m.vx = m.vz = 0;
    if (this.stateT < CFG.dyingS) { this.events.push({ type: 'shake', k: 0.4 }); if (Math.random() < dt * 10) this.events.push({ type: 'trash', x: m.x + (Math.random() - 0.5) * 3, y: m.y + Math.random() * 7, z: m.z + (Math.random() - 0.5) * 3 }); return; }
    if (!this.core) {
      const spot = this.#solidSpot(m.x, m.z);
      this.core = { x: spot.x, y: ARENA.top + 2.3, z: spot.z, t: 0 };
      m.dead = true; m.deadT = 99; this.mobs.remove(m);
      this.events.push({ type: 'core' });
    }
  }
  /** The floating core after the fight: rises over 1.5 s; touching it (within 1.5) is the ending. Returns true once. */
  stepCore(dt, player) {
    const c = this.core;
    if (!c || this.won) return false;
    c.t += dt; c.y = ARENA.top + 2.3 + Math.min(1, c.t / CFG.coreRiseS) * 0.8 + Math.sin(c.t * 2) * 0.1;                 // it floats about a block over your head: walk under it (or jump) to touch it
    if (Math.hypot(player.x - c.x, player.y + 0.9 - c.y, player.z - c.z) < 1.6) { this.won = true; this.events.push({ type: 'win' }); return true; }
    return false;
  }
  /** Peaceful / difficulty can change in the middle of a fight. */
  setDifficulty(d) { this.difficulty = d; }
}

function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
