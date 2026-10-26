// The objectives journal (FINAL_SPEC §8): which of the 58 objectives are done. Pure logic (no DOM, no three.js), the Node tests import it.
// An objective ticks from EVENTS (the game calls event('place:bed')), COUNTERS (event('mined:iron_ore', 1) adds up) or INVENTORY (peak counts: the most of an item ever
// held, so crafting a bow from 3 string still counts the 3 string). Ticked objectives stay ticked. The text of every objective is data in config.js; the rules are here, keyed by n.
import { OBJECTIVES, ACTS, TIPS } from './config.js';

const ARMOR = (tier) => [`${tier}_helmet`, `${tier}_chestplate`, `${tier}_leggings`, `${tier}_boots`];
const COOKED = ['cooked_pork', 'cooked_beef', 'cooked_mutton', 'cooked_chicken', 'bread', 'glowcap_stew'];
const MEAT = ['raw_pork', 'raw_beef', 'raw_mutton', 'raw_chicken', ...COOKED];
const BLOCKISH = ['stone', 'dirt', 'cobblestone', 'planks', 'sand', 'gravel', 'log', 'glass', 'basalt', 'scorched_stone', 'ash', 'memory_block', 'wool'];

/**
 * Rules by objective number. c = { peak(item), now(item), ev(name), dim, flags, raided, spawners, wardens }. Rules that need more than one thing read it from the context.
 * (A rule never has to be exact about an old save: finishing a later objective also ticks the earlier ones, see IMPLIES.)
 */
const RULES = {
  1: (c) => c.peak('log') >= 4,
  2: (c) => c.peak('planks') >= 1,
  3: (c) => c.ev('place:crafting_table') >= 1,
  4: (c) => c.peak('stick') >= 1,
  5: (c) => c.peak('pickaxe_wood') >= 1,
  6: (c) => c.peak('cobblestone') >= 16 || c.ev('mined:stone') >= 16,
  7: (c) => ['pickaxe', 'axe', 'shovel', 'sword'].every((t) => c.peak(`${t}_stone`) >= 1),
  8: (c) => c.peak('berries') >= 5 || c.peak('apple') >= 1 || MEAT.some((m) => c.peak(m) >= 1),
  9: (c) => c.ev('place:furnace') >= 1 && COOKED.some((m) => c.peak(m) >= 1),
  10: (c) => c.peak('coal') >= 1 || c.ev('mined:coal_ore') >= 1,
  11: (c) => c.peak('torch') >= 16,
  12: (c) => c.peak('wool') >= 3,
  13: (c) => c.ev('place:bed') >= 1,
  14: (c) => c.ev('shelter') >= 1,
  15: (c) => c.ev('night:survived') >= 1 || c.ev('slept') >= 1,
  16: (c) => c.ev('place:chest') >= 1,
  17: (c) => c.ev('mined:iron_ore') >= 1 || c.peak('raw_iron') >= 1,
  18: (c) => c.ev('mined:iron_ore') >= 24,
  19: (c) => c.peak('iron_ingot') >= 1,
  20: (c) => c.peak('pickaxe_iron') >= 1,
  21: (c) => c.peak('sword_iron') >= 1,
  22: (c) => ARMOR('iron').every((i) => c.peak(i) >= 1),
  23: (c) => c.peak('string') >= 3,
  24: (c) => c.peak('bow') >= 1,
  25: (c) => c.peak('flint') >= 1 && c.peak('feather') >= 1,
  26: (c) => c.peak('arrow') >= 32,
  27: (c) => c.peak('shears') >= 1,
  28: (c) => ARMOR('leather').every((i) => c.peak(i) >= 1),
  29: (c) => c.ev('deep') >= 1,
  30: (c) => c.ev('mined:cobalt_ore') >= 1 || c.peak('raw_cobalt') >= 1,
  31: (c) => c.ev('mined:cobalt_ore') >= 30,
  32: (c) => c.peak('pickaxe_cobalt') >= 1,
  33: (c) => c.peak('sword_cobalt') >= 1,
  34: (c) => c.peak('tracer') >= 1,
  35: (c) => ARMOR('cobalt').every((i) => c.peak(i) >= 1),
  36: (c) => c.ev('near:crack') >= 1 || c.rifts >= 1,
  37: (c) => c.rifts >= 1,
  38: (c) => stocked(c),
  39: (c) => c.ev('enter:underlayer') >= 1,
  40: (c) => c.ev('under:time') >= 10,
  41: (c) => c.peak('glowcap') >= 1,
  42: (c) => c.ev('near:vault') >= 1 || c.spawners >= 1 || c.raided >= 1,
  43: (c) => c.spawners >= 1 || c.raided >= 1,
  44: (c) => c.wardens >= 1 || c.raided >= 1,
  45: (c) => c.raided >= 1 || c.peak('kernel_shard') >= 1,
  46: (c) => c.raided >= 2,
  47: (c) => c.raided >= 3,
  48: (c) => c.peak('kernel_key') >= 1 || !!c.flags.gate,
  49: (c) => c.ev('near:gate') >= 1 || !!c.flags.gate,
  50: (c) => !!c.flags.gate,
  51: (c) => kit(c),
  52: (c) => c.ev('enter:kernel') >= 1,
  53: (c) => c.ev('crystals') >= 4,
  54: (c) => c.ev('bossphase') >= 2 || c.ev('boss:defeated') >= 1,
  55: (c) => c.ev('bossphase') >= 3 || c.ev('boss:defeated') >= 1,
  56: (c) => c.ev('boss:defeated') >= 1,
  57: (c) => c.ev('boss:defeated') >= 1,
  58: (c) => c.ev('core:touched') >= 1 || !!c.flags.completed,
};
const foodNow = (c) => COOKED.reduce((n, i) => n + c.now(i), 0);
const blocksNow = (c) => BLOCKISH.reduce((n, i) => n + c.now(i), 0);
const stocked = (c) => foodNow(c) >= 16 && blocksNow(c) >= 64 && c.now('torch') >= 1 && c.now('bow') >= 1 && c.now('arrow') >= 1;
const kit = (c) => c.now('sword_cobalt') >= 1 && c.now('pickaxe_cobalt') >= 1 && c.now('bow') >= 1 && c.now('arrow') >= 32 && foodNow(c) >= 16 && blocksNow(c) >= 64
  && [...ARMOR('cobalt'), ...ARMOR('iron')].some((i) => c.now(i) >= 1 || c.worn?.(i));

/** Finishing the key one also ticks what it needs, so an old save (or a player who skipped around) gets the whole chain: [first, last] ranges. */
const IMPLIES = {
  20: [[1, 7], [17, 19]], 32: [[29, 31]], 39: [[36, 38]], 42: [[40, 40]], 48: [[42, 47]], 50: [[49, 49]], 52: [[49, 51]], 57: [[53, 56]], 58: [[57, 57]],
};

const MAX_N = Math.max(...OBJECTIVES.map((o) => o.n));
const byN = new Map(OBJECTIVES.map((o) => [o.n, o]));

export class Journal {
  constructor() { this.done = new Set(); this.stat = {}; this.peaks = {}; this.tips = 0; this.actsShown = 0; }

  /** From the world's flags: { obj: hex bitset, jst: {counters}, pk: {peaks}, tips, acts }. Missing = a fresh journal (an old save: update() ticks from what is known). */
  load(f) {
    this.done = new Set(); this.stat = {}; this.peaks = {}; this.tips = 0; this.actsShown = 0;
    if (!f || typeof f !== 'object') return;
    if (typeof f.obj === 'string' && /^[0-9a-f]*$/.test(f.obj)) {
      for (let i = 0; i < f.obj.length; i++) { const v = parseInt(f.obj[i], 16); for (let b = 0; b < 4; b++) if (v & (1 << b)) { const n = i * 4 + b + 1; if (byN.has(n)) this.done.add(n); } }
    }
    for (const [k, v] of Object.entries(f.jst ?? {})) if (Number.isFinite(v)) this.stat[k] = v;
    for (const [k, v] of Object.entries(f.pk ?? {})) if (Number.isFinite(v)) this.peaks[k] = v;
    this.tips = Number.isInteger(f.tips) ? f.tips : 0; this.actsShown = Number.isInteger(f.acts) ? f.acts : 0;
  }
  toJSON() {
    let hex = '';
    for (let i = 0; i * 4 < MAX_N; i++) { let v = 0; for (let b = 0; b < 4; b++) if (this.done.has(i * 4 + b + 1)) v |= 1 << b; hex += v.toString(16); }
    return { obj: hex, jst: { ...this.stat }, pk: { ...this.peaks }, tips: this.tips, acts: this.actsShown };
  }

  event(name, n = 1) { this.stat[name] = (this.stat[name] ?? 0) + n; }
  /** A counter that only ever goes up to `n` (a maximum, not a sum). */
  max(name, n) { if (n > (this.stat[name] ?? 0)) this.stat[name] = n; }
  set(n) { if (byN.has(n) && !this.done.has(n)) { this.done.add(n); return [n]; } return []; }
  has(n) { return this.done.has(n); }

  /** Tip bookkeeping: true the first time a tip is asked for. */
  tip(name) { const t = TIPS[name]; if (!t || this.tips & (1 << t.bit)) return false; this.tips |= 1 << t.bit; return true; }

  /**
   * Evaluate every open objective. ctx = { counts: {item: n} (what the inventory holds now), flags, rifts, raided, spawners, wardens, worn? }.
   * Returns the numbers that just ticked, in order.
   */
  update(ctx) {
    for (const [id, n] of Object.entries(ctx.counts)) if (n > (this.peaks[id] ?? 0)) this.peaks[id] = n;
    const c = {
      ...ctx, peak: (i) => this.peaks[i] ?? 0, now: (i) => ctx.counts[i] ?? 0, ev: (k) => this.stat[k] ?? 0,
      rifts: ctx.rifts ?? 0, raided: ctx.raided ?? 0, spawners: ctx.spawners ?? 0, wardens: ctx.wardens ?? 0, flags: ctx.flags ?? {},
    };
    const fresh = [];
    for (let pass = 0; pass < 2; pass++) {                                   // twice: an implied tick can make a later rule true
      for (const o of OBJECTIVES) {
        if (this.done.has(o.n)) continue;
        const rule = RULES[o.n];
        let ok = false;
        try { ok = !!rule?.(c); } catch { ok = false; }
        if (!ok) continue;
        this.done.add(o.n); fresh.push(o.n);
        for (const [a, b] of IMPLIES[o.n] ?? []) for (let k = a; k <= b; k++) if (byN.has(k) && !this.done.has(k)) { this.done.add(k); fresh.push(k); }
      }
    }
    return fresh;
  }

  get total() { return OBJECTIVES.length; }
  get count() { return this.done.size; }
  actOf(n) { return byN.get(n)?.act ?? 0; }
  /** The act number of the first open required objective (the act you are in), or 0 when everything is done. */
  get currentAct() { const o = OBJECTIVES.find((x) => !x.optional && !this.done.has(x.n)); return o ? o.act : 0; }
  actDone(act) { return OBJECTIVES.every((o) => o.act !== act || o.optional || this.done.has(o.n)); }
  actProgress(act) { const l = OBJECTIVES.filter((o) => o.act === act); return { done: l.filter((o) => this.done.has(o.n)).length, total: l.length }; }
  /** The tracker: the first open required objective and the next two (optional ones are never "next"). */
  upcoming(k = 3) { return OBJECTIVES.filter((o) => !o.optional && !this.done.has(o.n)).slice(0, k); }
  /** Acts that are complete but whose banner has not been shown yet; marks them shown. */
  newlyCompletedActs() {
    const out = [];
    for (const a of ACTS) if (this.actDone(a.act) && !(this.actsShown & (1 << a.act))) { this.actsShown |= 1 << a.act; out.push(a); }
    return out;
  }
}

export { OBJECTIVES, ACTS };
