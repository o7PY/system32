// Arrows (STRATA_PART2_SPEC.md 8): entities with gravity that stick in blocks for 30 s (the ones the player shot can be picked up), hit mobs, the player and the boss.
// Pure logic: the world answers getBlock, `mobs` is a Mobs, `hitPlayer(arrow)` is called when a hostile arrow reaches the player.
import { BLOCKS } from './blocks.js';

const G = 22, DRAG = 0.992, STICK_S = 30;
let nextId = 1;
export class Arrows {
  constructor({ world, mobs, rand = Math.random }) { this.world = world; this.mobs = mobs; this.rand = rand; this.list = []; this.events = []; }
  takeEvents() { const e = this.events; this.events = []; return e; }
  clear() { this.list.length = 0; this.events.length = 0; }

  /** Shoot from (x, y, z) along the unit vector (dx, dy, dz) at `speed` blocks/s. `mine` = shot by the player (can be picked up, hurts mobs); else it hurts the player. */
  shoot(x, y, z, dx, dy, dz, speed, damage, { mine = false, shooter = null } = {}) {
    const a = { id: nextId++, x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, damage, mine, shooter, stuck: false, age: 0, dead: false, wobble: 0 };
    this.list.push(a);
    return a;
  }

  /** Advance every arrow. player = { x, y, z (feet), w, h } for hostile arrows. Returns nothing; read takeEvents(): { type: 'hit-mob' | 'hit-player' | 'stick' | 'pickup', ... }. */
  update(dt, player, boss = null) {
    for (const a of this.list) {
      a.age += dt;
      if (a.stuck) { a.wobble = Math.max(0, a.wobble - dt * 3); if (a.age - a.stuckAt > STICK_S) a.dead = true; continue; }
      if (a.age > 12) { a.dead = true; continue; }
      const steps = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / 0.4)), h = dt / steps;
      for (let i = 0; i < steps && !a.stuck && !a.dead; i++) {
        a.vy -= G * h; a.vx *= DRAG; a.vz *= DRAG;
        const px = a.x, py = a.y, pz = a.z;
        a.x += a.vx * h; a.y += a.vy * h; a.z += a.vz * h;
        if (a.y < -40) { a.dead = true; break; }
        const id = this.world.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
        if (BLOCKS[id]?.solid) { a.x = px; a.y = py; a.z = pz; a.stuck = true; a.stuckAt = a.age; a.wobble = 1; a.vx = a.vy = a.vz = 0; this.events.push({ type: 'stick', arrow: a }); break; }
        if (a.mine) {
          const hit = this.mobs?.raycast({ x: px, y: py, z: pz }, norm(a.x - px, a.y - py, a.z - pz), Math.hypot(a.x - px, a.y - py, a.z - pz) + 0.05);
          if (hit) { a.dead = true; this.events.push({ type: 'hit-mob', arrow: a, mob: hit.mob }); break; }
          if (boss && boss.hit?.(a)) { a.dead = true; this.events.push({ type: 'hit-boss', arrow: a }); break; }
        } else if (player && a.x > player.x - player.w / 2 && a.x < player.x + player.w / 2 && a.y > player.y && a.y < player.y + player.h && a.z > player.z - player.w / 2 && a.z < player.z + player.w / 2) {
          a.dead = true; this.events.push({ type: 'hit-player', arrow: a }); break;
        }
      }
    }
    this.list = this.list.filter((a) => !a.dead);
  }

  /** The player walks over arrows he shot himself: pick up the stuck ones within reach. Returns how many. */
  pickup(player, reach = 1.2) {
    let n = 0;
    for (const a of this.list) if (a.stuck && a.mine && !a.dead && Math.hypot(a.x - player.x, a.y - (player.y + 0.9), a.z - player.z) < reach) { a.dead = true; n++; this.events.push({ type: 'pickup', arrow: a }); }
    this.list = this.list.filter((a) => !a.dead);
    return n;
  }
}
function norm(x, y, z) { const d = Math.hypot(x, y, z) || 1; return { x: x / d, y: y / d, z: z / d }; }

/** The damage of a bow shot by how long the string was drawn (0..1 s): 2 at a flick, 9 at full draw. */
export const bowDamage = (drawS) => { const t = Math.min(1, Math.max(0, drawS)); return Math.round((2 + 7 * t) * 10) / 10; };
export const bowSpeed = (drawS) => 14 + 22 * Math.min(1, Math.max(0, drawS));
