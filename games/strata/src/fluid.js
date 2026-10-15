// Flowing water. Water is a cell with a strength: a source (`water`, 8) or flowing water (water_1..water_7). Every TICK seconds the queued cells are looked at:
//  - a cell with air below it fills that cell with falling water (7) and goes no further sideways,
//  - otherwise it feeds the air around it with strength - 1 (so water runs 7 blocks from a source on flat ground),
//  - flowing water that nothing feeds any more (no water above, no stronger water beside it) shrinks or drains away.
// A change of any block queues the cell and its six neighbours, so digging next to the sea lets it run in, and building a wall stops it. Sources never dry up.
// Flowing water is stored like any other edit; after a load the flowing cells of a chunk are looked at again, so a half-finished flood goes on.
import { B, isWater, waterLevel } from './blocks.js';

const TICK = 0.25, BUDGET = 400;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const idOf = (lvl) => (lvl >= 8 ? B.water : B[`water_${lvl}`]);

export class Fluid {
  /** @param world a World (getBlock, setBlock, has, onChange) */
  constructor(world) {
    this.world = world;
    this.queue = new Set();
    this.acc = 0;
    this.enabled = true;
    this.moved = 0;
    this.touched = new Set();
    world.onChange = (x, y, z) => this.poke(x, y, z);
  }

  reset() { this.queue.clear(); this.acc = 0; }

  #key(x, y, z) { return `${x},${y},${z}`; }

  /** Look at this cell and its neighbours at the next tick. */
  poke(x, y, z) {
    if (!this.enabled) return;
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) this.queue.add(this.#key(x + dx, y + dy, z + dz));
  }

  /** A chunk has been generated: its flowing water (from a save) is looked at again. */
  chunkLoaded(c) {
    const e = this.world.edits.get((c.cz << 16) | c.cx);
    if (!e) return;
    for (const [i, id] of e) if (isWater(id)) this.poke(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15));
  }

  update(dt) {
    if (!this.enabled || !this.queue.size) { this.acc = 0; return; }
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc %= TICK;
    this.step();
  }

  /** One tick: the cells queued so far are processed (at most BUDGET), what they change is queued for the next tick. */
  step() {
    const cells = [];
    for (const k of this.queue) { cells.push(k); this.queue.delete(k); if (cells.length >= BUDGET) break; }
    const w = this.world, set = (x, y, z, id) => this.#put(x, y, z, id);
    this.touched = new Set();
    for (const k of cells) {
      if (this.touched.has(k)) continue;                                    // changed already in this tick: acts in the next one
      const [x, y, z] = k.split(',').map(Number);
      if (y < 0 || y > 127 || !w.has(x, z)) continue;
      const here = w.getBlock(x, y, z), lvl = waterLevel(here);
      if (lvl > 0 && lvl < 8) {                                              // flowing: is it still fed?
        const want = this.#fed(x, y, z);
        if (want !== lvl) { if (want > 0) set(x, y, z, idOf(want)); else set(x, y, z, B.air); this.#requeue(x, y, z); continue; }
      }
      if (lvl > 0) this.#spread(x, y, z, lvl);
      else if (here === B.air) {                                             // an empty cell: does something pour into it?
        const want = this.#fed(x, y, z);
        if (want > 0) { set(x, y, z, idOf(want)); this.#requeue(x, y, z); }
      }
    }
  }

  #put(x, y, z, id) {
    if (!this.world.has(x, z) || this.world.getBlock(x, y, z) === id) return false;
    this.world.setBlock(x, y, z, id); this.moved++; this.touched.add(this.#key(x, y, z));
    return true;
  }

  #requeue(x, y, z) { for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) this.queue.add(this.#key(x + dx, y + dy, z + dz)); }

  /** The strength this cell should have: 7 under water, else the strongest side neighbour - 1 (0 = none). Only flowing cells with solid ground or water below keep the sides. */
  #fed(x, y, z) {
    const w = this.world;
    if (isWater(w.getBlock(x, y + 1, z))) return 7;
    let best = 0;
    for (const [dx, dz] of SIDES) {
      const nid = w.getBlock(x + dx, y, z + dz), nl = waterLevel(nid);
      if (nl < 2) continue;
      if (!this.#spreadsSide(x + dx, y, z + dz)) continue;                   // water that falls (or floats on water) does not also spread sideways
      best = Math.max(best, nl - 1);
    }
    return best;
  }

  /** Water spreads sideways only when it rests on something that is not air and not flowing water (a source or solid ground is fine). */
  #spreadsSide(x, y, z) {
    if (y <= 0) return true;
    const below = this.world.getBlock(x, y - 1, z);
    return below !== B.air && !(isWater(below) && waterLevel(below) < 8);
  }

  #spread(x, y, z, lvl) {
    const w = this.world;
    if (y > 0 && w.getBlock(x, y - 1, z) === B.air) {                        // fall
      this.#put(x, y - 1, z, B.water_7); this.#requeue(x, y - 1, z);
      return;
    }
    if (lvl < 2 || !this.#spreadsSide(x, y, z)) return;
    for (const [dx, dz] of SIDES) {
      const nx = x + dx, nz = z + dz;
      if (!w.has(nx, nz)) continue;
      const nid = w.getBlock(nx, y, nz);
      if (nid === B.air || (waterLevel(nid) > 0 && waterLevel(nid) < 8 && waterLevel(nid) < lvl - 1)) {
        this.#put(nx, y, nz, idOf(lvl - 1)); this.#requeue(nx, y, nz);
      }
    }
  }
}
