// Survival rules (STRATA_PART2_SPEC.md section 2): health, hunger, air, armor, burning, damage sources, death. Pure logic: no DOM, no three.js, no clock of its own
// (everything advances through update(dt, env)), so Node tests can drive it with exact numbers.
import { CONFIG } from './config.js';
import { ITEMS } from './items.js';

export const DIFFICULTIES = ['peaceful', 'normal', 'hard'];
/** Damage that no armor reduces (spec 2.3). */
const IGNORES_ARMOR = new Set(['void', 'starvation', 'suffocation']);
/** Damage that ticks on its own timer and is not blocked by the 0.5 s of invulnerability after a hit. */
const OVER_TIME = new Set(['lava', 'burning', 'drowning', 'starvation', 'suffocation', 'void']);

const DEATH_TEXT = {
  fall: 'Fell from a high place', drowning: 'Drowned', lava: 'Tried to swim in lava', burning: 'Burned to a crisp', void: 'Fell out of the world',
  starvation: 'Starved to death', suffocation: 'Suffocated in a wall', boss: 'Was deleted by the Garbage Collector', mob: 'Was slain', arrow: 'Was shot', fireball: 'Was burned by a fireball',
};

export class Vitals {
  constructor(cfg = CONFIG.survival) {
    this.cfg = cfg;
    this.difficulty = 'normal';
    this.armor = [null, null, null, null];           // stacks: helmet, chestplate, leggings, boots
    this.deaths = 0;
    this.stats = { mined: 0, mobs: 0, timeS: 0 };
    this.reset();
  }

  reset() {
    const c = this.cfg;
    this.hp = c.maxHp; this.hunger = c.maxHunger; this.air = c.bubbles;
    this.exhaustion = 0; this.fedT = 0; this.regenT = 0; this.starveT = 0;
    this.invuln = 0; this.burn = 0; this.burnT = 0; this.lavaT = 0; this.drownT = 0; this.suffocT = 0;
    this.dead = false; this.cause = null; this.causeText = '';
    this.hurtDir = null; this.hurtT = 0; this.nausea = 0;
  }

  get peaceful() { return this.difficulty === 'peaceful'; }
  get armorPoints() { return this.armor.reduce((n, s) => n + (s ? ITEMS[s.id]?.armor?.points ?? 0 : 0), 0); }
  /** Damage taken is multiplied by this (4 % per armor point, at most 80 %). */
  get armorFactor() { return 1 - Math.min(this.cfg.armorMax, this.armorPoints * this.cfg.armorPerPoint); }
  get canSprint() { return this.hunger > this.cfg.noSprintAt; }

  /**
   * Take damage. opts: { type, name, from: {x, z} (the direction it came from), ignoreArmor }. Returns the damage actually applied (0 when invulnerable).
   * Hard mode adds 50 % to what mobs do; armor removes its share (not for the void, starvation and suffocation) and wears down by 1 per hit.
   */
  damage(amount, opts = {}) {
    if (this.dead || amount <= 0) return 0;
    const type = opts.type ?? 'generic', over = OVER_TIME.has(type);
    if (this.invuln > 0 && !over) return 0;
    let d = amount;
    const mobLike = type === 'mob' || type === 'arrow' || type === 'fireball' || type === 'boss';
    if (mobLike && this.difficulty === 'hard') d *= this.cfg.hardDamageMul;
    if (!IGNORES_ARMOR.has(type) && !opts.ignoreArmor) { d *= this.armorFactor; this.#wearArmor(); }
    d = Math.max(0, Math.round(d * 100) / 100);
    if (type === 'starvation' && this.difficulty !== 'hard') d = Math.min(d, Math.max(0, this.hp - 1));      // Normal: starving never kills (it stops at 1 HP)
    if (d <= 0) return 0;
    this.hp = Math.max(0, this.hp - d);
    if (!over) this.invuln = this.cfg.invuln;
    this.addExhaustion(this.cfg.exhaust.damage);
    this.hurtT = 0.45; this.hurtDir = opts.from ?? null;
    if (this.hp <= 0 && type !== 'starvation') this.#die(type, opts.name);
    else if (this.hp <= 0) this.#die(type, opts.name);
    return d;
  }

  #die(type, name) {
    this.dead = true; this.cause = type; this.deaths++;
    this.causeText = type === 'mob' && name ? `Was slain by ${name}` : type === 'arrow' && name ? `Was shot by ${name}` : type === 'fireball' && name ? `Was burned by ${name}` : (DEATH_TEXT[type] ?? 'Died');
  }

  #wearArmor() {
    this.armor = this.armor.map((s) => {
      if (!s) return null;
      const dur = (s.dur ?? ITEMS[s.id].armor.durability) - 1;
      return dur <= 0 ? null : { ...s, dur };
    });
  }

  heal(n) { if (!this.dead) this.hp = Math.min(this.cfg.maxHp, this.hp + n); }
  addExhaustion(x) { if (!this.peaceful) this.exhaustion += x * (this.difficulty === 'hard' ? this.cfg.hardHungerMul : 1); }

  /** Eat a food item (ITEMS[id].food). Returns the hunger it restored; the caller removes the item. Rotten flesh may bring nausea. */
  eat(foodId, rand = Math.random) {
    const f = ITEMS[foodId]?.food;
    if (!f || this.dead) return 0;
    const before = this.hunger;
    this.hunger = Math.min(this.cfg.maxHunger, this.hunger + f.hunger);
    this.fedT = this.cfg.regen.fedS;
    if (f.nausea && rand() < f.nausea) this.nausea = 8;
    return this.hunger - before;
  }

  /**
   * One step. env: { inWater, headInWater, inLava, headInSolid, y, sprintM (metres sprinted this step), jumped, mined (blocks), fall (landing distance, 0 = none) }.
   * Returns the damage events of this step: [{ type, amount }].
   */
  update(dt, env = {}) {
    const events = [], c = this.cfg;
    if (this.dead) return events;
    this.stats.timeS += dt;
    this.invuln = Math.max(0, this.invuln - dt); this.hurtT = Math.max(0, this.hurtT - dt); this.nausea = Math.max(0, this.nausea - dt);
    const hit = (type, amount, o) => { const a = this.damage(amount, { type, ...o }); if (a) events.push({ type, amount: a }); return a; };

    // exhaustion -> hunger (not on Peaceful)
    if (!this.peaceful) {
      if (env.sprintM) this.addExhaustion(env.sprintM * c.exhaust.sprintPerM);
      if (env.jumped) this.addExhaustion(c.exhaust.jump);
      if (env.mined) this.addExhaustion(env.mined * c.exhaust.mine);
      while (this.exhaustion >= c.exhaust.perHunger) { this.exhaustion -= c.exhaust.perHunger; this.hunger = Math.max(0, this.hunger - 1); }
    } else this.exhaustion = 0;

    // falling
    if (env.fall && env.fall > c.fallSafe) hit('fall', Math.floor(env.fall - c.fallSafe));

    // the void
    if (env.y !== undefined && env.y < c.voidY) hit('void', this.cfg.maxHp * 10);

    // air and drowning
    if (env.headInWater) {
      this.air = Math.max(0, this.air - dt / c.bubbleS);
      if (this.air <= 0) { this.drownT += dt; while (this.drownT >= c.drownEveryS) { this.drownT -= c.drownEveryS; hit('drowning', c.drownDamage); } }
    } else { this.air = Math.min(c.bubbles, this.air + dt * c.airRefillPerS); this.drownT = 0; }

    // lava and burning
    if (env.inLava) {
      this.lavaT += dt;
      while (this.lavaT >= c.lava.everyS) { this.lavaT -= c.lava.everyS; hit('lava', c.lava.damage); }
      this.burn = c.lava.burnS;
    } else this.lavaT = Math.min(this.lavaT, c.lava.everyS);
    if (env.inWater) this.burn = 0;
    if (this.burn > 0) {
      this.burn = Math.max(0, this.burn - dt); this.burnT += dt;
      while (this.burnT >= 1) { this.burnT -= 1; hit('burning', c.lava.burnDamage); }
    } else this.burnT = 0;

    // suffocation: the head inside a solid block
    if (env.headInSolid) { this.suffocT += dt; while (this.suffocT >= 1) { this.suffocT -= 1; hit('suffocation', c.suffocation); } } else this.suffocT = 0;

    // starvation, then regeneration
    if (!this.peaceful && this.hunger <= 0) {
      this.starveT += dt;
      while (this.starveT >= c.starveEveryS) { this.starveT -= c.starveEveryS; hit('starvation', 1); }
    } else this.starveT = 0;
    this.fedT = Math.max(0, this.fedT - dt);
    if (this.hp < c.maxHp && !this.dead && (this.hunger >= c.regen.minHunger || this.peaceful)) {
      const fast = this.hunger >= c.maxHunger && this.fedT > 0, every = fast ? c.regen.fastEveryS : c.regen.everyS;
      this.regenT += dt;
      while (this.regenT >= every && this.hp < c.maxHp) { this.regenT -= every; this.hp = Math.min(c.maxHp, this.hp + 1); this.addExhaustion(c.regen.exhaust); }
    } else this.regenT = 0;
    return events;
  }

  /** After the death screen: full health and hunger, nothing burning. Armor and the death counter stay as they are (the caller clears the armor if the items were dropped). */
  respawn() { const deaths = this.deaths; this.reset(); this.deaths = deaths; }

  toJSON() { return { hp: this.hp, hunger: this.hunger, air: this.air, exhaustion: this.exhaustion, armor: this.armor, deaths: this.deaths, difficulty: this.difficulty, stats: this.stats }; }
  load(o) {
    this.reset();
    if (!o) return this;
    const c = this.cfg, n = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    this.hp = Math.max(1, n(o.hp, 0, c.maxHp, c.maxHp)); this.hunger = n(o.hunger, 0, c.maxHunger, c.maxHunger); this.air = n(o.air, 0, c.bubbles, c.bubbles);
    this.exhaustion = n(o.exhaustion, 0, c.exhaust.perHunger, 0);
    this.armor = Array.from({ length: 4 }, (_, i) => o.armor?.[i] ?? null);
    this.deaths = Math.floor(n(o.deaths, 0, 1e6, 0)); this.difficulty = DIFFICULTIES.includes(o.difficulty) ? o.difficulty : 'normal';
    this.stats = { mined: Math.floor(n(o.stats?.mined, 0, 1e9, 0)), mobs: Math.floor(n(o.stats?.mobs, 0, 1e9, 0)), timeS: n(o.stats?.timeS, 0, 1e9, 0) };
    return this;
  }
}

/** The text of the death screen's score line. */
export function scoreText(stats) {
  const m = Math.floor(stats.timeS / 60), s = Math.floor(stats.timeS % 60);
  return `Blocks mined: ${stats.mined}   Time survived: ${m}:${String(s).padStart(2, '0')}`;
}
