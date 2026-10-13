// Crafting and smelting rules. No DOM. A grid is a flat array of item ids (or null) read row by row, `w` wide.
import { CONFIG, RECIPES, SMELTING } from './config.js';
import { maxStack, stack } from './items.js';

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

/** Shaped recipes match anywhere in the grid and mirrored left-right; shapeless ones match by ingredients alone. Returns { recipe, out: stack } or null. */
export function matchRecipe(grid, w, h = grid.length / w) {
  const cells = grid.map((x) => x ?? null);
  let minX = w, maxX = -1, minY = h, maxY = -1;
  const used = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = cells[y * w + x];
    if (!id) continue;
    used.push(id);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!used.length) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.shapeless) {
      if (r.shapeless.length === used.length && [...r.shapeless].sort().join() === [...used].sort().join()) return { recipe: r, out: stack(r.out[0], r.out[1]) };
      continue;
    }
    if (r.pattern.length !== bh || r.pattern[0].length !== bw) continue;
    for (const pat of [r.pattern, mirror(r.pattern)]) {
      let ok = true;
      for (let y = 0; y < bh && ok; y++) for (let x = 0; x < bw && ok; x++) {
        const want = pat[y][x] === '.' ? null : r.key[pat[y][x]];
        if ((cells[(minY + y) * w + minX + x] ?? null) !== want) ok = false;
      }
      if (ok) return { recipe: r, out: stack(r.out[0], r.out[1]) };
    }
  }
  return null;
}

export const smeltsTo = (id) => SMELTING[id] ?? null;
export const fuelValue = (id) => CONFIG.furnace.fuel[id] ?? 0;          // items it can smelt

/** One furnace: input, fuel and output slots, burn and cook timers. Fuel is only burnt while there is something to cook. */
export class Furnace {
  constructor(s = {}) {
    this.input = s.input ?? null; this.fuel = s.fuel ?? null; this.output = s.output ?? null;
    this.burn = s.burn ?? 0;            // seconds of fire left from the fuel already used
    this.cook = s.cook ?? 0;            // seconds spent on the current item
    this.onDone = null;
  }
  get burning() { return this.burn > 0; }
  get progress() { return this.cook / CONFIG.furnace.smeltS; }
  #canCook() {
    const out = this.input && smeltsTo(this.input.id);
    if (!out) return false;
    return !this.output || (this.output.id === out && this.output.n < maxStack(out));
  }
  update(dt) {
    const S = CONFIG.furnace.smeltS;
    let left = dt, done = 0;
    while (left > 1e-9 && this.#canCook()) {
      if (this.burn <= 0) {
        if (!this.fuel || !fuelValue(this.fuel.id)) break;               // out of fuel: the progress stays
        this.burn = fuelValue(this.fuel.id) * S;
        this.fuel = this.fuel.n > 1 ? { ...this.fuel, n: this.fuel.n - 1 } : null;
      }
      const step = Math.min(left, this.burn, S - this.cook);
      this.burn -= step; this.cook += step; left -= step;
      if (this.cook >= S - 1e-9) {
        const out = smeltsTo(this.input.id);
        this.cook = 0;
        this.input = this.input.n > 1 ? { ...this.input, n: this.input.n - 1 } : null;
        this.output = this.output ? { ...this.output, n: this.output.n + 1 } : stack(out, 1);
        done++;
      }
    }
    if (!this.#canCook() && this.burn > 0) this.burn = Math.max(0, this.burn - left);     // the fire dies down when idle
    if (!this.input) this.cook = 0;
    if (done) this.onDone?.(done);
    return done;
  }
  toJSON() { return { input: this.input, fuel: this.fuel, output: this.output, burn: this.burn, cook: this.cook }; }
}
