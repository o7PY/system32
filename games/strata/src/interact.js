// Interaction rules, no DOM and no three.js: the voxel ray (DDA), tool and drop rules, mining progress, and the dropped-item entities.
import { CONFIG } from './config.js';
import { BLOCKS, B, isWater } from './blocks.js';
import { ITEMS, isTool, hasDurability, stack, maxStack } from './items.js';

/** Ray against the box of a partial block in cell (x, y, z): { t, nx, ny, nz } or null. A ray starting inside the box hits at t = 0 with no normal. */
function boxHit(o, d, x, y, z, box) {
  const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z], C = [x, y, z];
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    const lo = C[k] + box[k] / 16, hi = C[k] + box[k + 3] / 16;
    if (Math.abs(D[k]) < 1e-9) { if (O[k] < lo || O[k] > hi) return null; continue; }
    let t1 = (lo - O[k]) / D[k], t2 = (hi - O[k]) / D[k], n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; axis = k; sign = n; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin <= 0) return { t: 0, nx: 0, ny: 0, nz: 0 };
  return { t: tmin, nx: axis === 0 ? sign : 0, ny: axis === 1 ? sign : 0, nz: axis === 2 ? sign : 0 };
}

/**
 * Voxel DDA (Amanatides and Woo) from `o` along the unit vector `d`, up to `reach` blocks. Air, water and lava are not targetable; a partial block (torch, chest,
 * bed) is hit only where its box is.
 * @returns {{x, y, z, nx, ny, nz, dist, id}|null} the block hit and the normal of the face that was entered (the place-here cell is block + normal)
 */
export function raycast(getBlock, o, d, reach = CONFIG.reach) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = d.x !== 0 ? Math.abs(1 / d.x) : Infinity, tdy = d.y !== 0 ? Math.abs(1 / d.y) : Infinity, tdz = d.z !== 0 ? Math.abs(1 / d.z) : Infinity;
  let tx = d.x > 0 ? (x + 1 - o.x) * tdx : d.x < 0 ? (o.x - x) * tdx : Infinity;
  let ty = d.y > 0 ? (y + 1 - o.y) * tdy : d.y < 0 ? (o.y - y) * tdy : Infinity;
  let tz = d.z > 0 ? (z + 1 - o.z) * tdz : d.z < 0 ? (o.z - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256; i++) {
    const id = getBlock(x, y, z);
    if (id !== B.air && !isWater(id) && id !== B.lava) {
      const box = BLOCKS[id].box;
      if (!box) return { x, y, z, nx, ny, nz, dist: t, id };
      const h = boxHit(o, d, x, y, z, box);
      if (h && h.t <= reach) return { x, y, z, nx: h.nx, ny: h.ny, nz: h.nz, dist: h.t, id };
    }
    if (tx <= ty && tx <= tz) { t = tx; if (t > reach) return null; x += sx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (ty <= tz) { t = ty; if (t > reach) return null; y += sy; ty += tdy; nx = 0; ny = -sy; nz = 0; }
    else { t = tz; if (t > reach) return null; z += sz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

/**
 * How a block breaks with the held item: time = hardness * base / toolSpeed (the tool's type must match the block's; hand speed is 1), times 3.3 and
 * nothing dropped when the block needs a better tool than the one held. hardness < 0 = unbreakable.
 * @returns {{time: number, drops: boolean, speed: number, breakable: boolean}}
 */
export function breakInfo(blockId, held) {
  const b = BLOCKS[blockId], m = CONFIG.mining;
  if (!b || b.hardness < 0) return { time: Infinity, drops: false, speed: 0, breakable: false };
  const tool = held && ITEMS[held.id]?.tool;
  const matches = !!tool && tool.type === b.tool;
  const ok = !b.need || (!!tool && tool.type === b.need.tool && tool.tierN >= b.need.tier);
  if (b.only && !ok) return { time: Infinity, drops: false, speed: 0, breakable: false };                   // cracked bedrock: only a cobalt pickaxe breaks it
  const speed = matches ? tool.speed : 1;
  return { time: b.hardness * m.base / speed * (ok ? 1 : m.noToolMul), drops: ok, speed, breakable: true };
}

/** What a broken block drops: a stack or null. `rand` is a 0..1 source. */
export function dropFor(blockId, held, rand = Math.random) {
  const b = BLOCKS[blockId];
  if (!b?.drop || !breakInfo(blockId, held).drops) return null;
  const [item, n, chance] = b.drop;
  return rand() < chance ? stack(item, n) : null;
}

/** Everything a broken block drops (a list of stacks): each entry [item, n, chance] rolls on its own (leaves: a stick 10 %, an apple 2 %; gravel: flint 10 %). */
export function dropsFor(blockId, held, rand = Math.random) {
  const b = BLOCKS[blockId];
  if (!b?.drops?.length || !breakInfo(blockId, held).drops) return [];
  return b.drops.filter(([, , chance]) => rand() < chance).map(([item, n]) => stack(item, n));
}

/** Using a tool costs one durability per block broken (a sword too). Returns the stack to keep (null when it just broke). */
export function useTool(s) {
  if (!s || !isTool(s.id)) return { stack: s, broke: false };
  const dur = (s.dur ?? ITEMS[s.id].tool.durability) - 1;
  return dur <= 0 ? { stack: null, broke: true } : { stack: { ...s, dur }, broke: false };
}

/** Mining state: hold the button on a block and the progress fills; look away or let go and it resets. */
export class Miner {
  constructor() { this.target = null; this.progress = 0; this.bedrockT = 0; }
  reset() { this.target = null; this.progress = 0; this.bedrockT = 0; }
  /**
   * @param hit   the raycast hit (or null), @param held the selected stack, @param down whether the mine button is held
   * @returns {'none'|'mining'|'broke'} ; `bedrockT` accumulates while the target is bedrock (the strata-bedrock egg after 10 s)
   */
  update(dt, hit, held, down) {
    if (!down || !hit) { this.reset(); return 'none'; }
    const same = this.target && this.target.x === hit.x && this.target.y === hit.y && this.target.z === hit.z;
    if (!same) { this.target = { x: hit.x, y: hit.y, z: hit.z, id: hit.id }; this.progress = 0; this.bedrockT = 0; }
    const info = breakInfo(hit.id, held);
    if (!info.breakable) { this.bedrockT += dt; return 'mining'; }
    this.progress += dt / Math.max(0.02, info.time);
    if (this.progress >= 1) { this.progress = 0; this.target = null; return 'broke'; }
    return 'mining';
  }
}

// ------------------------------------------------------------------ dropped items
export class Drops {
  constructor(world) { this.world = world; this.list = []; this.t = 0; this.nextId = 1; }

  /** A drop with a little hop. `delayS` keeps it from being picked up straight away (a thrown item). */
  spawn(x, y, z, stk, { vx = (Math.random() - 0.5) * 2, vy = 3, vz = (Math.random() - 0.5) * 2, delayS = 0.35, ttl = null, death = false } = {}) {
    const d = { id: this.nextId++, x, y, z, vx, vy, vz, stack: { ...stk }, age: 0, delay: delayS, ttl, death };       // ttl: seconds of game time it lasts (null = the default); death: part of the pile left where you died
    this.list.push(d);
    return d;
  }
  clear() { this.list.length = 0; }

  #solid(x, y, z) { return BLOCKS[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.solid; }

  /**
   * Physics, merging, despawn and pickup. `player` = { x, y, z } (feet) and `add(stack)` -> leftover stack or null.
   * @returns {object[]} the pickups this step, each { id, n, picked } (picked = how many went into the inventory)
   */
  update(dt, player, add) {
    this.t += dt;
    const R = CONFIG.mining, picks = [];
    for (const d of this.list) {
      if (this.world.has && !this.world.has(d.x, d.z)) continue;                    // in an unloaded chunk nothing happens: it does not age, so a death pile never despawns unseen
      d.age += dt; d.delay -= dt;
      const water = this.world.getBlock(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z)) !== B.air && isWater(this.world.getBlock(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z)));
      d.vy = water ? Math.max(-1.2, d.vy - 6 * dt) + (d.vy < 0.4 ? 5 * dt : 0) : Math.max(-40, d.vy - 22 * dt);
      const ny = d.y + d.vy * dt;
      if (this.#solid(d.x, ny - 0.125, d.z)) {                                   // landed
        if (d.vy < 0) { d.y = Math.floor(ny - 0.125) + 1 + 0.125; }
        d.vy = 0; d.vx *= 0.7; d.vz *= 0.7;
      } else d.y = ny;
      const nx = d.x + d.vx * dt, nz = d.z + d.vz * dt;
      if (!this.#solid(nx, d.y + 0.1, d.z)) d.x = nx; else d.vx = 0;
      if (!this.#solid(d.x, d.y + 0.1, nz)) d.z = nz; else d.vz = 0;
      if (this.#solid(d.x, d.y + 0.1, d.z)) d.y += 1;                             // pushed inside a block (a placed block): pop up
      // pull toward the player and pick up
      if (d.delay <= 0) {
        const px = player.x - d.x, py = player.y + 0.9 - d.y, pz = player.z - d.z, dist = Math.hypot(px, py, pz);
        if (dist < R.dropRange) {
          const k = Math.min(1, R.dropPullSpeed * dt / Math.max(dist, 0.01));
          d.x += px * k; d.y += py * k; d.z += pz * k; d.vy = 0; d.vx = d.vz = 0;
          if (dist < 0.55) {
            const left = add({ ...d.stack });
            const got = d.stack.n - (left?.n ?? 0);
            if (got > 0) picks.push({ id: d.stack.id, n: d.stack.n, picked: got });
            if (left) d.stack = left; else d.dead = true;
          }
        }
      }
    }
    // merge identical nearby drops (not tools), despawn
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (a.dead || hasDurability(a.stack.id)) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (b.dead || b.stack.id !== a.stack.id || !!a.death !== !!b.death || a.stack.n + b.stack.n > maxStack(a.stack.id)) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < R.dropMergeR) { a.stack.n += b.stack.n; b.dead = true; a.age = Math.min(a.age, b.age); }
      }
    }
    this.list = this.list.filter((d) => !d.dead && d.age < (d.ttl ?? R.dropDespawnS) && d.y > -64);
    return picks;
  }

  /** For the save: the drops that lie around, the death pile first (at most `max`). */
  toJSON(max = 300) {
    return [...this.list].sort((a, b) => (b.death ? 1 : 0) - (a.death ? 1 : 0)).slice(0, max).map((d) => ({ x: +d.x.toFixed(2), y: +d.y.toFixed(2), z: +d.z.toFixed(2), stack: d.stack, age: Math.round(d.age), ttl: d.ttl, death: !!d.death }));
  }
  load(list) {
    this.list.length = 0;
    for (const d of Array.isArray(list) ? list : []) {
      if (!d?.stack?.id || !ITEMS[d.stack.id] || !Number.isInteger(d.stack.n) || d.stack.n < 1) continue;
      const e = this.spawn(d.x, d.y, d.z, d.stack, { vx: 0, vy: 0, vz: 0, delayS: 0, ttl: d.ttl ?? null, death: !!d.death });
      e.age = Number.isFinite(d.age) ? d.age : 0;
    }
  }
}
