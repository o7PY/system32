// A* over walkable cells (STRATA_PART2_SPEC.md 5.2): a cell is walkable when something solid is below it and two cells above are free; a step may rise 1 or drop up to 3.
// Within `radius` blocks of the start, at most `maxNodes` nodes expanded. When the goal cannot be reached it returns the path to the explored cell closest to it
// (reached: false), so a mob still walks toward the player as far as it can instead of freezing. No DOM, no three.js.
import { B, BLOCKS } from './blocks.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y, z) => `${x},${y},${z}`;

/**
 * @param getBlock (x, y, z) -> block id
 * @param start / goal { x, y, z } integer feet cells (use Math.floor of the entity position)
 * @param opts { maxNodes = 600, radius = 32, maxDrop = 3, climbWalls = false (a spider: walls are walkable), canSwim = false }
 * @returns {{ path: {x, y, z}[], reached: boolean, nodes: number }} path = the cells to walk through, excluding the start
 */
export function findPath(getBlock, start, goal, opts = {}) {
  const { maxNodes = 600, radius = 32, maxDrop = 3, climbWalls = false, canSwim = false } = opts;
  const solid = (x, y, z) => BLOCKS[getBlock(x, y, z)]?.solid ?? false;
  const bad = (x, y, z) => { const id = getBlock(x, y, z); return id === B.lava || (!canSwim && id === B.water); };
  const free = (x, y, z) => !solid(x, y, z) && !bad(x, y, z);
  const standable = (x, y, z) => free(x, y, z) && free(x, y + 1, z) && (solid(x, y - 1, z) || (climbWalls && wallNear(x, y, z)));
  const wallNear = (x, y, z) => DIRS.some(([dx, dz]) => solid(x + dx, y, z + dz));
  const h = (x, y, z) => Math.abs(x - goal.x) + Math.abs(z - goal.z) + Math.abs(y - goal.y) * 1.3;
  const open = new Map(), closed = new Set();
  const first = { x: start.x, y: start.y, z: start.z, g: 0, f: h(start.x, start.y, start.z), parent: null };
  open.set(key(first.x, first.y, first.z), first);
  let best = first, nodes = 0;
  const done = (n, reached) => { const path = []; for (let c = n; c.parent; c = c.parent) path.push({ x: c.x, y: c.y, z: c.z }); path.reverse(); return { path, reached, nodes }; };
  while (open.size && nodes < maxNodes) {
    let cur = null;
    for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
    open.delete(key(cur.x, cur.y, cur.z)); closed.add(key(cur.x, cur.y, cur.z)); nodes++;
    if (cur.x === goal.x && cur.z === goal.z && Math.abs(cur.y - goal.y) <= 1) return done(cur, true);
    if (h(cur.x, cur.y, cur.z) < h(best.x, best.y, best.z)) best = cur;
    if (climbWalls && free(cur.x, cur.y + 1, cur.z) && free(cur.x, cur.y + 2, cur.z) && wallNear(cur.x, cur.y + 1, cur.z)) {        // straight up a wall (a spider)
      const k = key(cur.x, cur.y + 1, cur.z);
      if (!closed.has(k)) { const g = cur.g + 1.5, ex = open.get(k); if (!ex || g < ex.g) open.set(k, { x: cur.x, y: cur.y + 1, z: cur.z, g, f: g + h(cur.x, cur.y + 1, cur.z), parent: cur }); }
    }
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (Math.abs(nx - start.x) > radius || Math.abs(nz - start.z) > radius) continue;
      const cands = [];
      if (standable(nx, cur.y, nz)) cands.push([cur.y, 1]);                                                           // level
      else {
        if (free(cur.x, cur.y + 2, cur.z) && standable(nx, cur.y + 1, nz) && !solid(nx, cur.y + 1, nz)) cands.push([cur.y + 1, 1.6]);       // up one (headroom above the start needed)
        else if (free(nx, cur.y, nz) && free(nx, cur.y + 1, nz)) {                                                    // drop: fall through the open column to the ground
          for (let d = 1; d <= maxDrop; d++) { if (standable(nx, cur.y - d, nz)) { cands.push([cur.y - d, 1 + d * 0.4]); break; } if (solid(nx, cur.y - d, nz) || !free(nx, cur.y - d, nz)) break; }
        }
        if (climbWalls && !cands.length && wallNear(nx, cur.y, nz) && free(nx, cur.y, nz) && free(nx, cur.y + 1, nz)) cands.push([cur.y, 1.2]);     // along a wall
      }
      for (const [ny, cost] of cands) {
        const k = key(nx, ny, nz);
        if (closed.has(k)) continue;
        const g = cur.g + cost, ex = open.get(k);
        if (!ex || g < ex.g) open.set(k, { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: cur });
      }
    }
  }
  return done(best, false);
}
