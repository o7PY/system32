// Hostile behaviour and spawning (STRATA_PART2_SPEC.md 5.2-5.3). installHostiles(mobs, arrows) gives a Mobs its `hostile(m, dt, ctx)` step; Spawner decides where and when
// monsters appear. ctx = { player: {x, y, z, w, h}, hurt(amount, opts) -> applied, now, dayT, lightAt(x, y, z) -> {sky, blk} | null, peaceful, difficulty }.
// Chasing uses A* (pathfind.js) recomputed every 0.5 s and when stuck for 1 s, with a global per-step budget so 30 monsters never cost more than a couple of searches.
import { CONFIG } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { findPath } from './pathfind.js';
import { effectiveLight, daylight } from './daylight.js';
import { HOSTILE_KINDS } from './hostiledefs.js';

const TAU = Math.PI * 2;
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Give `mobs` the hostile step. `arrows` is an Arrows (the Rattler shoots through it). */
export function installHostiles(mobs, arrows) {
  mobs.budget = { paths: 0 };
  mobs.pathMs = 0;
  mobs.hostile = (m, dt, ctx) => step(mobs, arrows, m, dt, ctx);
  const update = mobs.update.bind(mobs);
  mobs.update = (dt, ctx) => { mobs.budget.paths = CONFIG.hostiles.pathsPerStep; update(dt, ctx); };
}

const feet = (m) => ({ x: Math.floor(m.x), y: Math.floor(m.y + 0.05), z: Math.floor(m.z) });

function step(mobs, arrows, m, dt, ctx) {
  const d = m.def, P = ctx.player, dx = P.x - m.x, dz = P.z - m.z, dy = P.y - m.y, dist = Math.hypot(dx, dz);
  m.data.cool = Math.max(0, (m.data.cool ?? 0) - dt);
  m.voiceT -= dt;
  if (m.voiceT <= 0) { m.voiceT = 5 + mobs.rand() * 9; if (dist < d.sight) mobs.events.push({ type: 'voice', mob: m, kind: 'idle' }); }

  // ---- sunrise: surface monsters freeze, flicker and crumble over 3 s (cave ones stay); not in the Underlayer / Kernel
  if (d.surface && !d.neutralByDay && !d.underlayer && ctx.surfaceRules !== false) {                    // (a Creepcrawler is neutral by day, so it simply stays)
    const l = ctx.lightAt?.(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z)), day = daylight(ctx.dayT);
    if (l && l.sky >= 13 && day > CONFIG.hostiles.lagDaylight) {
      m.data.lag = (m.data.lag ?? 0) + dt;
      m.vx = m.vz = 0; m.lagging = true;
      if (m.data.lag >= CONFIG.hostiles.lagS) { m.data.crumbled = true; mobs.events.push({ type: 'crumble', mob: m }); mobs.remove(m); }
      return;
    }
    m.data.lag = 0; m.lagging = false;
  }

  if (ctx.peaceful) { mobs.remove(m); return; }                                   // switching to Peaceful clears the monsters

  // ---- targeting: sees the player within `sight` blocks (and a spider is neutral by day until it is hit)
  const calm = d.neutralByDay && !m.data.angry && daylight(ctx.dayT) > 0.5;
  const sees = dist < d.sight && Math.abs(dy) < 14 && !calm && !ctx.player.dead;
  m.data.sees = sees;
  if (!sees) { wander(mobs, m, dt); return; }
  m.state = 'chase';
  switch (d.ai) {
    case 'melee': return melee(mobs, m, dt, ctx, dist);
    case 'archer': return archer(mobs, arrows, m, dt, ctx, dist);
    case 'spider': return spider(mobs, m, dt, ctx, dist);
    case 'popup': return popup(mobs, m, dt, ctx, dist);
    case 'daemon': return daemon(mobs, arrows, m, dt, ctx, dist);
    case 'glitch': return glitch(mobs, m, dt, ctx, dist);
  }
}

/** A lazy walk when there is nothing to chase. */
function wander(mobs, m, dt) {
  m.state = 'wander';
  m.data.wt = (m.data.wt ?? 0) - dt;
  if (m.data.wt <= 0) { m.data.wt = 2 + mobs.rand() * 4; m.goal = mobs.rand() < 0.4 ? null : { x: m.x + Math.cos(mobs.rand() * TAU) * 5, z: m.z + Math.sin(mobs.rand() * TAU) * 5 }; }
  if (!m.goal || !mobs.safeAhead(m, 0.9)) { m.vx *= 0.8; m.vz *= 0.8; return; }
  mobs.steer(m, m.goal.x, m.goal.z, m.def.speed * 0.4, dt);
}

/** Walk toward the player by A* when something is in the way, straight when the way is clear. Returns the distance left to the goal. */
function chase(mobs, m, dt, ctx, tx, tz, speed, { climb = false } = {}) {
  const P = ctx.player, here = feet(m), goal = { x: Math.floor(tx), y: Math.floor(P.y + 0.05), z: Math.floor(tz) };
  m.data.pathT = (m.data.pathT ?? 0) - dt;
  const far = dist2(m, P) > CONFIG.hostiles.pathRange;
  const blocked = m.stuck > 1 || !m.data.path || m.data.pathT <= 0;
  if (blocked && !far && mobs.budget.paths > 0 && m.onGround) {
    mobs.budget.paths--; m.data.pathT = 0.5; m.stuck = 0;
    const r = findPath((x, y, z) => mobs.world.getBlock(x, y, z), here, goal, { climbWalls: climb, radius: 32, maxNodes: 600 });
    m.data.path = r.path; m.data.pathAt = 0; m.data.reached = r.reached;
  }
  const path = m.data.path;
  let nx = tx, nz = tz;
  if (path && m.data.pathAt < path.length) {
    let c = path[m.data.pathAt];
    while (c && Math.abs(c.x + 0.5 - m.x) < 0.35 && Math.abs(c.z + 0.5 - m.z) < 0.35 && m.data.pathAt < path.length - 1) { m.data.pathAt++; c = path[m.data.pathAt]; }
    if (c) {
      nx = c.x + 0.5; nz = c.z + 0.5;
      if (c.y > here.y) { if (climb) m.vy = Math.max(m.vy, 3.6); else if (m.onGround) m.vy = Math.max(m.vy, 8.2); }       // a spider walks up the wall, the others hop a step
    }
  }
  return mobs.steer(m, nx, nz, speed, dt, 9);
}

function hitPlayer(mobs, m, ctx, damage, knockback) {
  const P = ctx.player, applied = ctx.hurt(damage, { type: 'mob', name: `a ${m.def.name}`, from: { x: m.x, z: m.z } });
  if (applied && ctx.knock) ctx.knock(P.x - m.x, P.z - m.z, knockback);
  return applied;
}

function melee(mobs, m, dt, ctx, dist) {
  const d = m.def, c = d.melee, P = ctx.player;
  chase(mobs, m, dt, ctx, P.x, P.z, d.speed);
  m.look.yaw = 0;
  if (dist < c.reach && Math.abs(P.y - m.y) < 1.6) {
    if (m.data.windup === undefined && m.data.cool <= 0) m.data.windup = c.windupS;           // a short wind-up (the arms come up) before the hit
    if (m.data.windup !== undefined) { m.data.windup -= dt; if (m.data.windup <= 0) { m.data.windup = undefined; m.data.cool = c.everyS; if (dist < c.reach + 0.3) { hitPlayer(mobs, m, ctx, c.damage, c.knockback); mobs.events.push({ type: 'swing', mob: m }); } } }
  } else m.data.windup = undefined;
}

/** A Rattler keeps 8-12 blocks away, strafes, and draws a bow for 0.9 s before each shot. */
function archer(mobs, arrows, m, dt, ctx, dist) {
  const d = m.def, a = d.archer, P = ctx.player;
  m.data.strafe = m.data.strafe ?? (mobs.rand() < 0.5 ? -1 : 1); m.data.strafeT = (m.data.strafeT ?? a.strafeS) - dt;
  if (m.data.strafeT <= 0) { m.data.strafeT = a.strafeS * (0.6 + mobs.rand()); m.data.strafe = -m.data.strafe; }
  const ux = (P.x - m.x) / (dist || 1), uz = (P.z - m.z) / (dist || 1);
  if (dist < a.min) { if (mobs.safeAhead({ ...m, yaw: Math.atan2(ux, uz) }, 1.1)) mobs.steer(m, m.x - ux * 4, m.z - uz * 4, d.speed, dt, 9); }   // too close: back away
  else if (dist > a.max) chase(mobs, m, dt, ctx, P.x, P.z, d.speed);                                                                      // too far: close in
  else { mobs.steer(m, m.x - uz * m.data.strafe * 3, m.z + ux * m.data.strafe * 3, d.speed * 0.6, dt, 9); }                                 // in range: strafe
  m.yaw += (Math.atan2(-ux, -uz) - m.yaw) * Math.min(1, 6 * dt) * (dist >= a.min && dist <= a.max ? 1 : 0.3);
  if (dist >= a.min * 0.7 && dist <= a.max + 6 && hasLine(mobs, m, P)) {
    if (m.data.draw === undefined && m.data.cool <= 0) { m.data.draw = a.drawS; mobs.events.push({ type: 'draw', mob: m }); }
    if (m.data.draw !== undefined) {
      m.data.draw -= dt;
      if (m.data.draw <= 0) {
        m.data.draw = undefined; m.data.cool = a.everyS * (0.8 + mobs.rand() * 0.4);
        const ex = m.x, ey = m.y + 1.55, ez = m.z, tx = P.x, ty = P.y + 1.3, tz = P.z, dd = Math.hypot(tx - ex, ty - ey, tz - ez), t = dd / a.speed;
        const lift = 0.5 * 22 * t * t;                                                    // aim above the target to cancel the drop
        const vx = (tx - ex) / dd, vy = (ty + lift - ey) / dd, vz = (tz - ez) / dd, n = Math.hypot(vx, vy, vz);
        const sp = mobs.rand() * 0.06 - 0.03;                                              // a little scatter
        arrows.shoot(ex, ey, ez, vx / n + sp, vy / n + sp * 0.5, vz / n - sp, a.speed, a.damage[0] + Math.floor(mobs.rand() * (a.damage[1] - a.damage[0] + 1)), { shooter: m });
        mobs.events.push({ type: 'shoot', mob: m });
      }
    }
  } else m.data.draw = undefined;
}

/** No wall between the monster's eyes and the player's chest (a coarse ray over the blocks). */
export function hasLine(mobs, m, P) {
  const x0 = m.x, y0 = m.y + 1.5, z0 = m.z, x1 = P.x, y1 = P.y + 1.3, z1 = P.z, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.5);
  for (let i = 1; i < n; i++) { const t = i / n; if (BLOCKS[mobs.world.getBlock(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), Math.floor(z0 + (z1 - z0) * t))]?.opaque) return false; }
  return true;
}

/** Fast, climbs walls, and pounces from a few blocks away. */
function spider(mobs, m, dt, ctx, dist) {
  const d = m.def, P = ctx.player, p = d.pounce, c = d.melee;
  if (m.data.leap) {
    m.data.leap -= dt;
    if (m.data.leap <= 0 || m.onGround) { m.data.leap = 0; }
    if (dist < c.reach + 0.2 && Math.abs(P.y - m.y) < 1.6 && !m.data.leapHit) { m.data.leapHit = true; hitPlayer(mobs, m, ctx, p.damage, 5); }
    return;
  }
  m.data.leapHit = false;
  m.data.pounceCool = Math.max(0, (m.data.pounceCool ?? 0) - dt);
  if (dist < p.range && dist > p.minRange && m.onGround && m.data.pounceCool <= 0 && Math.abs(P.y - m.y) < 2.5) {
    const ux = (P.x - m.x) / dist, uz = (P.z - m.z) / dist;
    m.vx = ux * p.speed; m.vz = uz * p.speed; m.vy = p.up; m.data.leap = 0.7; m.data.pounceCool = p.everyS; m.yaw = Math.atan2(-ux, -uz);
    mobs.events.push({ type: 'pounce', mob: m });
    return;
  }
  chase(mobs, m, dt, ctx, P.x, P.z, d.speed, { climb: true });
  if (dist < c.reach && Math.abs(P.y - m.y) < 1.4 && m.data.cool <= 0) { m.data.cool = c.everyS; hitPlayer(mobs, m, ctx, c.damage, c.knockback); }
}

/** A flying ad window: drifts straight to you (no pathfinding), bobs, and on contact covers the screen with an ad for a few seconds. */
function popup(mobs, m, dt, ctx, dist) {
  const d = m.def, P = ctx.player, tx = P.x, ty = P.y + 1.2, tz = P.z;
  const dx = tx - m.x, dz = tz - m.z, dy = ty - (m.y + 0.4), dd = Math.hypot(dx, dy, dz) || 1;
  const sp = d.speed * (dd < 3 ? 0.7 : 1);
  m.vx += ((dx / dd) * sp - m.vx) * Math.min(1, 3 * dt); m.vz += ((dz / dd) * sp - m.vz) * Math.min(1, 3 * dt);
  m.vy += ((dy / dd) * sp * 0.8 + Math.sin(m.age * 3) * 0.4 - m.vy) * Math.min(1, 3 * dt);
  m.yaw += ((Math.atan2(-dx, -dz)) - m.yaw) * Math.min(1, 5 * dt);
  if (dd < d.contact.range && m.data.cool <= 0) { m.data.cool = d.contact.everyS; mobs.events.push({ type: 'overlay', mob: m, seconds: d.contact.overlayS }); }
}

/** A fast fire imp: dashes at you, then lobs a fireball (4 dmg and 2 s of burning), strafing in between. */
function daemon(mobs, arrows, m, dt, ctx, dist) {
  const d = m.def, P = ctx.player, ux = (P.x - m.x) / (dist || 1), uz = (P.z - m.z) / (dist || 1);
  m.data.dash = Math.max(0, (m.data.dash ?? 0) - dt); m.data.dashCool = Math.max(0, (m.data.dashCool ?? 0) - dt);
  if (m.data.dash > 0) { m.vx = ux * d.dash.speed; m.vz = uz * d.dash.speed; m.yaw = Math.atan2(-ux, -uz); m.driven = true; if (dist < 1.3) { m.data.dash = 0; if (m.data.cool <= 0) { m.data.cool = 1.2; hitPlayer(mobs, m, ctx, 3, 5); } } return; }
  if (dist < d.dash.range && dist > 3 && m.data.dashCool <= 0 && m.onGround) { m.data.dash = d.dash.durS; m.data.dashCool = d.dash.everyS; mobs.events.push({ type: 'dash', mob: m }); return; }
  if (dist > 7) chase(mobs, m, dt, ctx, P.x, P.z, d.speed);
  else { m.data.strafe = m.data.strafe ?? (mobs.rand() < 0.5 ? -1 : 1); m.data.strafeT = (m.data.strafeT ?? 1.2) - dt; if (m.data.strafeT <= 0) { m.data.strafeT = 0.8 + mobs.rand(); m.data.strafe *= -1; } mobs.steer(m, m.x - uz * m.data.strafe * 3, m.z + ux * m.data.strafe * 3, d.speed * 0.8, dt, 9); }
  m.yaw += (Math.atan2(-ux, -uz) - m.yaw) * Math.min(1, 8 * dt);
  if (dist < d.fire.range && hasLine(mobs, m, P)) {
    if (m.data.fireDraw === undefined && m.data.cool <= 0) { m.data.fireDraw = d.fire.drawS; mobs.events.push({ type: 'draw', mob: m, fire: true }); }
    if (m.data.fireDraw !== undefined) {
      m.data.fireDraw -= dt;
      if (m.data.fireDraw <= 0) {
        m.data.fireDraw = undefined; m.data.cool = d.fire.everyS * (0.8 + mobs.rand() * 0.4);
        const ex = m.x, ey = m.y + 1.0, ez = m.z, tx = P.x, ty = P.y + 1.1, tz = P.z, dd = Math.hypot(tx - ex, ty - ey, tz - ez);
        arrows.shoot(ex, ey, ez, (tx - ex) / dd, (ty - ey) / dd, (tz - ez) / dd, d.fire.speed, d.fire.damage, { shooter: m, fire: true, burnS: d.fire.burnS });
        mobs.events.push({ type: 'shoot', mob: m, fire: true });
      }
    }
  } else m.data.fireDraw = undefined;
}

/** A flickering cube: walks at you; every 4 s it teleports next to you and rewrites up to 3 blocks around itself with random Underlayer blocks. */
function glitch(mobs, m, dt, ctx, dist) {
  const d = m.def, c = d.melee, P = ctx.player, t = d.teleport;
  m.data.tp = (m.data.tp ?? t.everyS) - dt;
  if (m.data.tp <= 0 && dist > 3) {
    m.data.tp = t.everyS;
    const a = mobs.rand() * TAU, nx = P.x + Math.cos(a) * 1.8, nz = P.z + Math.sin(a) * 1.8;
    let y = Math.floor(P.y) + 2;
    for (; y > Math.floor(P.y) - 4; y--) if (BLOCKS[mobs.world.getBlock(Math.floor(nx), y - 1, Math.floor(nz))]?.solid && !BLOCKS[mobs.world.getBlock(Math.floor(nx), y, Math.floor(nz))]?.solid && !BLOCKS[mobs.world.getBlock(Math.floor(nx), y + 1, Math.floor(nz))]?.solid) break;
    if (y > Math.floor(P.y) - 4) {
      m.x = nx; m.y = y; m.z = nz; m.vx = m.vz = m.vy = 0; m.data.path = null;
      mobs.events.push({ type: 'glitch-swap', mob: m, picks: Array.from({ length: t.swaps }, () => [Math.floor(mobs.rand() * 5) - 2, Math.floor(mobs.rand() * 3) - 1, Math.floor(mobs.rand() * 5) - 2, Math.floor(mobs.rand() * 6)]) });
      mobs.events.push({ type: 'teleport', mob: m });
    }
  }
  chase(mobs, m, dt, ctx, P.x, P.z, d.speed);
  if (dist < c.reach && Math.abs(P.y - m.y) < 1.6) {
    if (m.data.windup === undefined && m.data.cool <= 0) m.data.windup = c.windupS;
    if (m.data.windup !== undefined) { m.data.windup -= dt; if (m.data.windup <= 0) { m.data.windup = undefined; m.data.cool = c.everyS; if (dist < c.reach + 0.3) { hitPlayer(mobs, m, ctx, c.damage, c.knockback); mobs.events.push({ type: 'swing', mob: m }); } } }
  } else m.data.windup = undefined;
}

// ---------------------------------------------------------------- spawning
export class Spawner {
  constructor(mobs, { rand = Math.random } = {}) { this.mobs = mobs; this.rand = rand; this.t = 0; this.despawnT = new Map(); this.stats = { spawned: 0, despawned: 0, tries: 0 }; }

  /** The cap of monsters at once (Hard: more). */
  cap(difficulty) { return Math.round(CONFIG.hostiles.cap * (difficulty === 'hard' ? CONFIG.hostiles.hardMul : 1)); }

  /** Despawn the monsters that are more than 64 blocks away for 30 s. Call every step. */
  despawn(dt, player) {
    for (const m of [...this.mobs.list]) {
      if (m.def.kind !== 'hostile' || m.dead) continue;
      if (dist2(m, player) > CONFIG.hostiles.despawnDist) {
        const t = (this.despawnT.get(m.id) ?? 0) + dt;
        if (t >= CONFIG.hostiles.despawnS) { this.mobs.remove(m); this.despawnT.delete(m.id); this.stats.despawned++; } else this.despawnT.set(m.id, t);
      } else this.despawnT.delete(m.id);
    }
  }

  /**
   * Try to place monsters (call every step; it acts every CONFIG.hostiles.everyS). A spot is a solid block with two free cells above, 24-64 blocks from the player (not in view
   * when possible) whose light (sky x daylight, or block light, the larger) is 7 or less. A group of 2-4 for Shamblers.
   * env: { player, dayT, lightAt, peaceful, difficulty, ground(x, z, y0) -> feet y | null (the first standable cell downward from y0) }
   */
  update(dt, env) {
    this.despawn(dt, env.player);
    this.t -= dt;
    if (this.t > 0) return [];
    this.t = CONFIG.hostiles.everyS;
    if (env.peaceful) return [];
    const mobs = this.mobs, count = mobs.list.filter((m) => m.def.kind === 'hostile' && !m.dead).length, under = env.dim === 'underlayer';
    if (count >= (under ? CONFIG.underlayer.cap : this.cap(env.difficulty))) return [];
    const P = env.player, out = [];
    for (let tries = 0; tries < CONFIG.hostiles.tries; tries++) {
      this.stats.tries++;
      const a = this.rand() * TAU, r = CONFIG.hostiles.minDist + this.rand() * (CONFIG.hostiles.maxDist - CONFIG.hostiles.minDist);
      const x = Math.floor(P.x + Math.cos(a) * r), z = Math.floor(P.z + Math.sin(a) * r);
      const y = env.ground(x, z, Math.floor(P.y) + (this.rand() < 0.5 ? 24 : 3));            // from the sky down (the surface) or from just above you (the caves around you)
      if (y === null || y === undefined) continue;
      const l = env.lightAt(x, y, z);
      if (!l) continue;
      if (!under && effectiveLight(l.sky, l.blk, env.dayT) > CONFIG.hostiles.maxLight) continue;                          // the Underlayer is always dark enough
      if (env.inView?.(x + 0.5, y + 1, z + 0.5) && tries < CONFIG.hostiles.tries - 3) continue;       // not in view, unless it takes too long to find a spot
      const type = under ? (this.rand() < 0.65 ? 'daemon' : 'glitch') : this.pick(env, l);
      if (!type) continue;
      const def = mobs.defs?.[type] ?? null;
      void def;
      const n = type === 'shambler' ? 2 + Math.floor(this.rand() * 3) : type === 'creepcrawler' ? 1 + Math.floor(this.rand() * 2) : type === 'daemon' ? 2 + Math.floor(this.rand() * 2) : 1;
      const capNow = under ? CONFIG.underlayer.cap : this.cap(env.difficulty);
      for (let k = 0; k < n && mobs.list.filter((m) => m.def.kind === 'hostile' && !m.dead).length < capNow; k++) {
        const gx = x + (k ? Math.floor(this.rand() * 5) - 2 : 0), gz = z + (k ? Math.floor(this.rand() * 5) - 2 : 0), gy = k ? env.ground(gx, gz, y + 3) : y;
        if (gy === null || gy === undefined || Math.abs(gy - y) > 2) continue;
        const gl = env.lightAt(gx, gy, gz);
        if (!gl || (!under && effectiveLight(gl.sky, gl.blk, env.dayT) > CONFIG.hostiles.maxLight)) continue;
        const m = mobs.spawn(type, gx + 0.5, gy, gz + 0.5);
        if (type === 'popup') m.y += 3;
        out.push(m); this.stats.spawned++;
      }
      if (out.length) break;
    }
    return out;
  }

  /** Which monster: Shamblers most of all, Rattlers and Creepcrawlers less often, Pop-ups only at night and never more than 2. */
  pick(env, l) {
    const night = daylight(env.dayT) < 0.35, r = this.rand();
    const pops = this.mobs.list.filter((m) => m.type === 'popup' && !m.dead).length;
    if (night && pops < 2 && r < 0.12) return 'popup';
    const w = [['shambler', 5], ['rattler', 2], ['creepcrawler', 2]];
    let t = this.rand() * w.reduce((s, x) => s + x[1], 0);
    for (const [k, v] of w) { t -= v; if (t <= 0) return HOSTILE_KINDS.includes(k) ? k : null; }
    void l;
    return 'shambler';
  }
}
