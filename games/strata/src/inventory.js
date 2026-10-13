// Inventory and the click rules of the inventory screens. No DOM: ui.js only draws the model and forwards clicks. A stack is { id, n, dur? }.
import { CONFIG } from './config.js';
import { ITEMS, maxStack, hasDurability, cloneStack, stack } from './items.js';
import { matchRecipe, smeltsTo, fuelValue } from './crafting.js';

// ---------------------------------------------------------------- the Creative catalog: every item, in categories, sorted by name, searchable
export const CATEGORIES = ['Blocks', 'Tools & Weapons', 'Armor', 'Food', 'Materials'];
/** Which tab an item is in. */
export function categoryOf(id) {
  const it = ITEMS[id];
  if (!it) return 'Materials';
  if (it.armor) return 'Armor';
  if (it.food) return 'Food';
  if (it.tool || ['bow', 'arrow', 'shears'].includes(id)) return 'Tools & Weapons';
  if (it.block !== undefined) return 'Blocks';
  return 'Materials';
}
/**
 * Every item of the game that matches `query` (a case-insensitive part of its name or id; words may come in any order) and `tab` ('All' or a category), sorted
 * by category and then by name. Returns [{ id, name, category }].
 */
export function catalog(query = '', tab = 'All') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(ITEMS)
    .map((it) => ({ id: it.id, name: it.name, category: categoryOf(it.id) }))
    .filter((e) => (tab === 'All' || e.category === tab) && words.every((w) => e.name.toLowerCase().includes(w) || e.id.includes(w)))
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
}

const same = (a, b) => !!a && !!b && a.id === b.id && !hasDurability(a.id);

export class Inventory {
  constructor() { this.slots = Array(CONFIG.inv.hotbar + CONFIG.inv.main).fill(null); this.selected = 0; }
  get hotbarSize() { return CONFIG.inv.hotbar; }
  held() { return this.slots[this.selected]; }
  count(id) { return this.slots.reduce((n, s) => n + (s?.id === id ? s.n : 0), 0); }

  /** Put a stack in: merge into matching stacks first (hotbar, then main), then the first empty slot. Returns what did not fit (or null). */
  add(stk) {
    let left = { ...stk };
    const order = [...this.slots.keys()];
    if (!hasDurability(left.id)) for (const i of order) {
      const s = this.slots[i];
      if (same(s, left) && s.n < maxStack(s.id)) { const put = Math.min(maxStack(s.id) - s.n, left.n); s.n += put; left.n -= put; if (!left.n) return null; }
    }
    for (const i of order) {
      if (this.slots[i]) continue;
      const put = Math.min(maxStack(left.id), left.n);
      this.slots[i] = { ...left, n: put }; left.n -= put;
      if (!left.n) return null;
    }
    return left;
  }
  /** Remove one item from a slot. */
  takeOne(i) { const s = this.slots[i]; if (!s) return null; const one = { ...s, n: 1 }; if (s.n > 1) s.n--; else this.slots[i] = null; return one; }
  toJSON() { return { slots: this.slots, selected: this.selected }; }
  load(o) {
    this.slots = Array.from({ length: this.slots.length }, (_, i) => (o?.slots?.[i] && o.slots[i].id ? cloneStack(o.slots[i]) : null));
    this.selected = Math.min(Math.max(0, o?.selected | 0), CONFIG.inv.hotbar - 1);
  }
}

/**
 * One open screen: the player's inventory plus a crafting grid (2x2, or 3x3 at a table) or a furnace, and the stack on the cursor.
 * Containers: 'inv' (the 36 inventory slots: 0-8 hotbar), 'craft' + 'out' (grid and its result), 'in' / 'fuel' / 'smelt' (furnace slots), 'armor' (helmet, chestplate,
 * leggings, boots: the Vitals' armor array; only the matching piece fits), 'chest' (a chest's 27 slots).
 */
export class Menu {
  /** @param kind 'inventory' | 'table' | 'furnace' ; @param furnace a Furnace for kind 'furnace' */
  constructor(inv, kind = 'inventory', furnace = null, { armor = null, chest = null } = {}) {
    this.inv = inv; this.kind = kind; this.furnace = furnace;
    this.query = ''; this.tab = 'All'; this.list = kind === 'creative' ? catalog() : [];       // the Creative catalog (search text, tab, and the current matches)
    this.armor = armor; this.chest = chest;           // armor: the 4-slot array of the Vitals; chest: the chest's slot array
    this.cursor = null;
    this.size = kind === 'table' ? 3 : 2;
    this.grid = kind === 'furnace' || kind === 'chest' || kind === 'creative' ? [] : Array(this.size * this.size).fill(null);
    this.out = null;                       // the crafting result
    this.recompute();
  }

  slotRef(name, i) {
    switch (name) {
      case 'inv': return { get: () => this.inv.slots[i], set: (v) => { this.inv.slots[i] = v; } };
      case 'craft': return { get: () => this.grid[i], set: (v) => { this.grid[i] = v; this.recompute(); } };
      case 'out': return { get: () => this.out, set: (v) => { this.out = v; } };
      case 'in': return { get: () => this.furnace.input, set: (v) => { this.furnace.input = v; } };
      case 'fuel': return { get: () => this.furnace.fuel, set: (v) => { this.furnace.fuel = v; } };
      case 'smelt': return { get: () => this.furnace.output, set: (v) => { this.furnace.output = v; } };
      case 'cat': return { get: () => (this.list[i] ? { id: this.list[i].id, n: 1 } : null), set: () => {} };
      case 'trash': return { get: () => null, set: () => {} };
      case 'armor': return { get: () => this.armor[i], set: (v) => { this.armor[i] = v; } };
      case 'chest': return { get: () => this.chest[i], set: (v) => { this.chest[i] = v; } };
      default: throw new Error(`no container ${name}`);
    }
  }
  accepts(name, stk, i = 0) {
    if (!stk) return true;
    if (name === 'armor') return ITEMS[stk.id]?.armor?.slotN === i;
    if (name === 'out' || name === 'smelt') return false;                  // result slots are take-only
    if (name === 'in') return !!smeltsTo(stk.id);
    if (name === 'fuel') return fuelValue(stk.id) > 0;
    return true;
  }

  search(query, tab = this.tab) { this.query = query; this.tab = tab; this.list = catalog(query, tab); }

  recompute() { const m = this.kind === 'furnace' || this.kind === 'chest' || this.kind === 'creative' ? null : matchRecipe(this.grid.map((s) => s?.id ?? null), this.size); this.out = m ? m.out : null; }

  /** Consume one of each ingredient after taking the result. */
  #consume() { this.grid = this.grid.map((s) => (s ? (s.n > 1 ? { ...s, n: s.n - 1 } : null) : null)); this.recompute(); }

  /** Take the crafted / smelted result onto the cursor (or merge into it). Returns true if something was taken. */
  #takeResult(name) {
    const r = this.slotRef(name, 0), s = r.get();
    if (!s) return false;
    if (this.cursor && !(same(this.cursor, s) && this.cursor.n + s.n <= maxStack(s.id))) return false;
    this.cursor = this.cursor ? { ...this.cursor, n: this.cursor.n + s.n } : cloneStack(s);
    if (name === 'out') { this.crafted = s.id; this.#consume(); } else r.set(null);
    return true;
  }

  /** @param button 'left' | 'right' */
  click(name, i, button = 'left', shift = false) {
    if (name === 'cat') {                                                  // Creative: left = a full stack into your inventory, right = one, with a stack on the cursor = delete it
      if (this.cursor) { this.cursor = null; return true; }
      const e = this.list[i];
      if (!e) return false;
      const n = button === 'right' ? 1 : maxStack(e.id);
      const left = this.inv.add(stack(e.id, n));
      return !left || left.n < n;
    }
    if (name === 'trash') { if (!this.cursor) return false; this.cursor = null; return true; }
    if (name === 'out' || name === 'smelt') {
      if (shift) return this.#shiftResult(name);
      return this.#takeResult(name);
    }
    if (shift) return this.#shift(name, i);
    const r = this.slotRef(name, i), s = r.get(), c = this.cursor;
    if (c && !this.accepts(name, c, i)) return false;
    if (button === 'left') {
      if (!c) { if (!s) return false; this.cursor = s; r.set(null); return true; }
      if (!s) { r.set(c); this.cursor = null; return true; }
      if (same(s, c)) { const put = Math.min(maxStack(s.id) - s.n, c.n); if (!put) return false; r.set({ ...s, n: s.n + put }); this.cursor = c.n - put ? { ...c, n: c.n - put } : null; return true; }
      r.set(c); this.cursor = s; return true;                                  // different items: swap
    }
    // right: pick half / place one
    if (!c) { if (!s) return false; const take = Math.ceil(s.n / 2); this.cursor = { ...s, n: take }; r.set(s.n - take ? { ...s, n: s.n - take } : null); return true; }
    if (!s) { r.set({ ...c, n: 1 }); this.cursor = c.n > 1 ? { ...c, n: c.n - 1 } : null; return true; }
    if (same(s, c)) { if (s.n >= maxStack(s.id)) return false; r.set({ ...s, n: s.n + 1 }); this.cursor = c.n > 1 ? { ...c, n: c.n - 1 } : null; return true; }
    r.set(c); this.cursor = s; return true;
  }

  /** Drag-spread helper: place one item of the cursor stack into a slot (used for every slot a right-drag passes over). */
  placeOne(name, i) {
    const c = this.cursor;
    if (!c || !this.accepts(name, c, i)) return false;
    const r = this.slotRef(name, i), s = r.get();
    if (s && !(same(s, c) && s.n < maxStack(s.id))) return false;
    r.set(s ? { ...s, n: s.n + 1 } : { ...c, n: 1 });
    this.cursor = c.n > 1 ? { ...c, n: c.n - 1 } : null;
    return true;
  }

  /** Move a stack between the hotbar and the main inventory, from the grid / furnace into the inventory, or from the inventory into the furnace. */
  #shift(name, i) {
    const r = this.slotRef(name, i), s = r.get();
    if (!s) return false;
    if (name === 'inv') {
      const arm = ITEMS[s.id]?.armor;
      if (arm && this.armor && !this.armor[arm.slotN]) { this.armor[arm.slotN] = s; r.set(null); return true; }                 // shift-click equips a free armor slot
      if (this.kind === 'chest') { const k = this.chest.findIndex((t) => !t); if (k >= 0 && !hasDurability(s.id)) { const merged = this.#intoChest(s, r); if (merged) return true; } else if (k >= 0) { this.chest[k] = s; r.set(null); return true; } }
      if (this.kind === 'furnace') { const target = smeltsTo(s.id) ? 'in' : fuelValue(s.id) ? 'fuel' : null; if (target && this.#merge(target, s, r)) return true; }
      const hot = CONFIG.inv.hotbar, range = i < hot ? [hot, this.inv.slots.length] : [0, hot];
      return this.#moveInto(s, r, range[0], range[1]);
    }
    return this.#moveInto(s, r, 0, this.inv.slots.length);                     // grid / furnace slots go to the inventory
  }
  #moveInto(s, r, from, to) {
    let left = { ...s };
    if (!hasDurability(s.id)) for (let k = from; k < to && left.n; k++) { const t = this.inv.slots[k]; if (same(t, left) && t.n < maxStack(t.id)) { const put = Math.min(maxStack(t.id) - t.n, left.n); t.n += put; left.n -= put; } }
    for (let k = from; k < to && left.n; k++) if (!this.inv.slots[k]) { const put = Math.min(maxStack(left.id), left.n); this.inv.slots[k] = { ...left, n: put }; left.n -= put; }
    if (left.n === s.n) return false;
    r.set(left.n ? left : null);
    return true;
  }
  /** Shift-click from the inventory into the open chest: merge into stacks of the same item first, then the first free slot. */
  #intoChest(s, r) {
    let left = { ...s };
    for (let k = 0; k < this.chest.length && left.n; k++) { const t = this.chest[k]; if (same(t, left) && t.n < maxStack(t.id)) { const put = Math.min(maxStack(t.id) - t.n, left.n); this.chest[k] = { ...t, n: t.n + put }; left.n -= put; } }
    for (let k = 0; k < this.chest.length && left.n; k++) if (!this.chest[k]) { const put = Math.min(maxStack(left.id), left.n); this.chest[k] = { ...left, n: put }; left.n -= put; }
    if (left.n === s.n) return false;
    r.set(left.n ? left : null);
    return true;
  }
  #merge(name, s, from) {
    const r = this.slotRef(name, 0), t = r.get();
    if (t && !same(t, s)) return false;
    const room = maxStack(s.id) - (t?.n ?? 0), put = Math.min(room, s.n);
    if (put <= 0) return false;
    r.set({ ...s, n: (t?.n ?? 0) + put });
    from.set(s.n - put ? { ...s, n: s.n - put } : null);
    return true;
  }

  /** Shift-click on a result: craft again and again while the ingredients and the inventory allow it, or move the smelted stack over. */
  #shiftResult(name) {
    let any = false;
    for (let guard = 0; guard < 64; guard++) {
      const s = this.slotRef(name, 0).get();
      if (!s) break;
      const probe = new Inventory(); probe.slots = this.inv.slots.map(cloneStack);
      if (probe.add(s)) break;                                                   // no room for another result
      this.inv.add(s); any = true;
      if (name === 'out') { this.crafted = s.id; this.#consume(); } else this.slotRef(name, 0).set(null);
    }
    return any;
  }

  /** Closing the screen: the crafting grid and the cursor go back to the inventory. Returns what did not fit (the caller drops it in the world). */
  close() {
    const overflow = [];
    for (const s of [...this.grid, this.cursor]) if (s) { const left = this.inv.add(s); if (left) overflow.push(left); }
    this.grid = this.grid.map(() => null); this.cursor = null; this.out = null;
    return overflow;
  }
}
