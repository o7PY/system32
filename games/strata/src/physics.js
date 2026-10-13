// Swept-AABB collision shared by the player and every entity (STRATA_PART2_SPEC.md 5.1: "same swept-AABB collision as the player"). A body is { x, y, z, w, h }:
// x and z are the centre of the box on the ground, y the feet, w the width in x and z, h the height. The world only has to answer getBlock(x, y, z).
// Solid blocks collide with their own box: a full cube, or the partial box of a chest (14/16 tall) or a bed (9/16), so you can stand on a bed at its real height.
import { BLOCKS, collisionBox } from './blocks.js';

export const EPS = 1e-4;
const FULL = [0, 0, 0, 1, 1, 1];

/** The solid boxes (world coordinates [x0, y0, z0, x1, y1, z1]) of every cell the region touches. */
export function solidBoxes(getBlock, x0, y0, z0, x1, y1, z1, out = []) {
  for (let by = Math.floor(y0); by <= Math.floor(y1 - EPS); by++)
    for (let bz = Math.floor(z0); bz <= Math.floor(z1 - EPS); bz++)
      for (let bx = Math.floor(x0); bx <= Math.floor(x1 - EPS); bx++) {
        const id = getBlock(bx, by, bz), b = BLOCKS[id];
        if (!b?.solid) continue;
        const c = b.box ? collisionBox(id) : FULL;
        out.push([bx + c[0], by + c[1], bz + c[2], bx + c[3], by + c[4], bz + c[5]]);
      }
  return out;
}

/** The boxes that a body at its position really overlaps (a box only touching a face does not count). */
export function overlapping(getBlock, p, w, h) {
  const hw = w / 2, x0 = p.x - hw, x1 = p.x + hw, y0 = p.y, y1 = p.y + h, z0 = p.z - hw, z1 = p.z + hw;
  return solidBoxes(getBlock, x0, y0, z0, x1, y1, z1).filter((b) => b[0] < x1 - EPS && b[3] > x0 + EPS && b[1] < y1 - EPS && b[4] > y0 + EPS && b[2] < z1 - EPS && b[5] > z0 + EPS);
}
export const collidesAt = (getBlock, p, w, h) => overlapping(getBlock, p, w, h).length > 0;

/**
 * Move a body along one axis ('x' | 'y' | 'z') by d, in sub-steps of at most maxStep so nothing tunnels at terminal speed. On contact it snaps to the face of the
 * box it ran into. Returns true if it hit something.
 */
export function moveAxis(getBlock, p, w, h, axis, d, maxStep = 0.4) {
  if (d === 0) return false;
  const hw = w / 2, steps = Math.ceil(Math.abs(d) / maxStep), sd = d / steps, a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (let i = 0; i < steps; i++) {
    const old = p[axis];
    p[axis] += sd;
    const hits = overlapping(getBlock, p, w, h);
    if (!hits.length) continue;
    const size = axis === 'y' ? h : hw;
    p[axis] = sd > 0 ? Math.min(...hits.map((b) => b[a])) - size - EPS : Math.max(...hits.map((b) => b[a + 3])) + (axis === 'y' ? 0 : hw) + EPS;
    if (collidesAt(getBlock, p, w, h)) p[axis] = old;               // (a snap into another box: stay where we were)
    return true;
  }
  return false;
}
