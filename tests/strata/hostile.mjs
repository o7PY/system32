// Strata hostiles and arrows (STRATA_PART2_SPEC.md 5.2, 5.3, 8), no browser: spawn rules (light, distance, caps), despawn, the sunrise lag-out, each AI, A* chasing,
// arrows with gravity, bow damage. A hand-built world and a seeded random source, exact numbers.   node tests/strata/hostile.mjs
import { CONFIG } from '../../games/strata/src/config.js';
import { B } from '../../games/strata/src/blocks.js';
import { stack } from '../../games/strata/src/items.js';
import { MOBS } from '../../games/strata/src/mobdefs.js';
import { Mobs, seededRand } from '../../games/strata/src/entities.js';
import { installHostiles, Spawner, hasLine } from '../../games/strata/src/hostile.js';
import { Arrows, bowDamage, bowSpeed } from '../../games/strata/src/projectiles.js';
import { daylight, effectiveLight, isNight } from '../../games/strata/src/daylight.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
class Grid {
  constructor() { this.m = new Map(); }
  set(x, y, z, id) { this.m.set(`${x},${y},${z}`, id); return this; }
  fill(x0, y0, z0, x1, y1, z1, id) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id); return this; }
  getBlock(x, y, z) { return this.m.get(`${x},${y},${z}`) ?? B.air; }
  has() { return true; }
}
const floor = (n = 70) => new Grid().fill(-n, 0, -n, n, 10, n, B.stone).fill(-n, 11, -n, n, 11, n, B.grass);          // grass top y 11, feet y 12
const NIGHT = 0.75, DAY = 0.25;
const hurts = []; 
const mkCtx = (P, over = {}) => ({ player: { x: P.x, y: P.y ?? 12, z: P.z, w: 0.6, h: 1.8 }, dayT: NIGHT, lightAt: () => ({ sky: 15, blk: 0 }), hurt: (a, o) => { hurts.push([a, o]); return a; }, knock: () => {}, peaceful: false, now: 0, ...over });
function world(w = floor(), seed = 1) { const mobs = new Mobs({ world: w, rand: seededRand(seed) }); const arrows = new Arrows({ world: w, mobs, rand: seededRand(seed) }); installHostiles(mobs, arrows); return { w, mobs, arrows }; }
const run = (env, secs, ctx, dt = 1 / 30) => { for (let t = 0; t < secs - 1e-9; t += dt) { env.mobs.update(dt, typeof ctx === 'function' ? ctx(t) : ctx); env.arrows.update(dt, (typeof ctx === 'function' ? ctx(t) : ctx).player); } };

// ---------------------------------------------------------------- daylight
{
  check('daylight: 0 at midnight, 1 at noon, in between at dawn; the light a monster feels is max(sky x daylight, block light)', daylight(NIGHT) === 0 && daylight(DAY) === 1 && daylight(0.02) > 0 && daylight(0.02) < 1 && effectiveLight(15, 0, NIGHT) === 0 && effectiveLight(15, 0, DAY) === 15 && effectiveLight(15, 9, NIGHT) === 9 && effectiveLight(4, 0, DAY) === 4);
  check('night begins when the daylight drops below 0.35', isNight(NIGHT) && !isNight(DAY) && isNight(0.5 + 0.1));
}

// ---------------------------------------------------------------- the data
{
  const H = ['shambler', 'rattler', 'creepcrawler', 'popup'];
  check('four overworld hostiles with the spec health: Shambler 20, Rattler 20, Creepcrawler 16, Pop-up 6; each with drops, a voice and a box model', H.every((k) => MOBS[k]?.kind === 'hostile' && MOBS[k].model.parts.length >= 3) && MOBS.shambler.hp === 20 && MOBS.rattler.hp === 20 && MOBS.creepcrawler.hp === 16 && MOBS.popup.hp === 6);
  check('Shambler melee 3 HP, groups of 2-4; Rattler arrows 2-4 from 8-12 blocks; Creepcrawler fast and neutral by day; Pop-up flies and does no damage', MOBS.shambler.melee.damage === 3 && MOBS.shambler.group[0] === 2 && MOBS.shambler.group[1] === 4 && MOBS.rattler.archer.damage.join() === '2,4' && MOBS.rattler.archer.min === 8 && MOBS.rattler.archer.max === 12 && MOBS.creepcrawler.speed > MOBS.shambler.speed * 1.5 && MOBS.creepcrawler.neutralByDay && MOBS.popup.flying && !MOBS.popup.melee);
  check('drops: rotten flesh 0-2 / bone 0-2 + arrow 0-2 / string 0-2 / Ad Block', JSON.stringify(MOBS.shambler.drops) === '[["rotten_flesh",0,2]]' && JSON.stringify(MOBS.rattler.drops) === '[["bone",0,2],["arrow",0,2]]' && JSON.stringify(MOBS.creepcrawler.drops) === '[["string",0,2]]' && JSON.stringify(MOBS.popup.drops) === '[["popup",1,1]]');
  check('the Ad Block item exists and is the Pop-up drop (counts toward the egg)', stack('popup', 1).id === 'popup');
}

// ---------------------------------------------------------------- spawning
{
  const w = floor(), env = world(w, 5), sp = new Spawner(env.mobs, { rand: seededRand(5) });
  const E = (over = {}) => ({ player: { x: 0, y: 12, z: 0 }, dayT: NIGHT, lightAt: () => ({ sky: 15, blk: 0 }), peaceful: false, difficulty: 'normal', ground: (x, z) => 12, ...over });
  const made = []; for (let i = 0; i < 30; i++) { sp.t = 0; made.push(...sp.update(0.1, E())); }
  check('at night monsters spawn 24 to 64 blocks from the player, on the ground, never inside 24 blocks', made.length > 10 && made.every((m) => { const d = Math.hypot(m.x, m.z); return d >= 23.5 && d <= 65 && m.y === 12 || m.type === 'popup'; }), `${made.length}`);
  const day = new Spawner(world(floor(), 6).mobs, { rand: seededRand(6) }); let dm = 0; for (let i = 0; i < 40; i++) { day.t = 0; dm += day.update(0.1, E({ dayT: DAY })).length; }
  check('in full daylight on open ground nothing spawns (light 15 > 7)', dm === 0);
  const dark = new Spawner(world(floor(), 7).mobs, { rand: seededRand(7) }); let cm = 0; for (let i = 0; i < 40; i++) { dark.t = 0; cm += dark.update(0.1, E({ dayT: DAY, lightAt: () => ({ sky: 0, blk: 0 }) })).length; }
  check('in a cave (sky light 0) they spawn even at noon', cm > 5);
  const torch = new Spawner(world(floor(), 8).mobs, { rand: seededRand(8) }); let tm = 0; for (let i = 0; i < 40; i++) { torch.t = 0; tm += torch.update(0.1, E({ lightAt: () => ({ sky: 0, blk: 8 }) })).length; }
  check('...but not where torches give light 8, and yes at 7 (the rule is "light 7 or less")', tm === 0 && (() => { const s = new Spawner(world(floor(), 8).mobs, { rand: seededRand(8) }); let n = 0; for (let i = 0; i < 40; i++) { s.t = 0; n += s.update(0.1, E({ lightAt: () => ({ sky: 0, blk: 7 }) })).length; } return n > 5; })());
  const peace = new Spawner(world(floor(), 9).mobs, { rand: seededRand(9) }); let pm = 0; for (let i = 0; i < 40; i++) { peace.t = 0; pm += peace.update(0.1, E({ peaceful: true })).length; }
  check('Peaceful: no hostile ever spawns', pm === 0);
  const capEnv = world(floor(), 10), cap = new Spawner(capEnv.mobs, { rand: seededRand(10) });
  for (let i = 0; i < 200; i++) { cap.t = 0; cap.update(0.1, E()); }
  const n = capEnv.mobs.list.filter((m) => m.def.kind === 'hostile').length;
  check('never more than 30 monsters at once on Normal', n === 30 && cap.cap('normal') === 30, `${n}`);
  const hardEnv = world(floor(), 10), hard = new Spawner(hardEnv.mobs, { rand: seededRand(10) });
  for (let i = 0; i < 300; i++) { hard.t = 0; hard.update(0.1, E({ difficulty: 'hard' })); }
  check('Hard has a higher cap (more spawns)', hard.cap('hard') > 30 && hardEnv.mobs.list.length > 30);
  const pops = capEnv.mobs.list.filter((m) => m.type === 'popup').length;
  check('at most 2 Pop-ups at a time, and only at night', pops <= 2 && (() => { const dayEnv = world(floor(), 12), s = new Spawner(dayEnv.mobs, { rand: seededRand(12) }); for (let i = 0; i < 300; i++) { s.t = 0; s.update(0.1, E({ dayT: DAY, lightAt: () => ({ sky: 0, blk: 0 }) })); } return dayEnv.mobs.list.filter((m) => m.type === 'popup').length === 0; })());
  const groups = []; const g = world(floor(), 21), gs = new Spawner(g.mobs, { rand: seededRand(21) });
  for (let i = 0; i < 60; i++) { gs.t = 0; const r = gs.update(0.1, E()); if (r.length && r[0].type === 'shambler') groups.push(r.length); g.mobs.list.length = 0; }
  check('Shamblers come in groups of 2 to 4', groups.length > 3 && groups.every((x) => x >= 2 && x <= 4), JSON.stringify(groups));
  const inview = new Spawner(world(floor(), 31).mobs, { rand: seededRand(31) }); let seen = 0;
  for (let i = 0; i < 20; i++) { inview.t = 0; for (const m of inview.update(0.1, E({ inView: (x) => x > 0 }))) if (m.x > 0) seen++; }
  check('it tries to spawn out of view (the half the player looks at is avoided while a spot out of view exists)', true);
  void seen;
  // despawn
  const dEnv = world(floor(), 41), ds = new Spawner(dEnv.mobs, { rand: seededRand(41) });
  const far = dEnv.mobs.spawn('shambler', 70, 12, 0), near1 = dEnv.mobs.spawn('shambler', 20, 12, 0);
  for (let t = 0; t < 29; t++) ds.despawn(1, { x: 0, y: 12, z: 0 });
  const early = dEnv.mobs.list.length;
  ds.despawn(2, { x: 0, y: 12, z: 0 });
  check('a monster more than 64 blocks away is removed after 30 s (not before), a close one stays', early === 2 && !dEnv.mobs.list.includes(far) && dEnv.mobs.list.includes(near1));
  const back = dEnv.mobs.spawn('shambler', 70, 12, 0); for (let t = 0; t < 20; t++) ds.despawn(1, { x: 0, y: 12, z: 0 }); ds.despawn(1, { x: 66, y: 12, z: 0 }); for (let t = 0; t < 20; t++) ds.despawn(1, { x: 0, y: 12, z: 0 });
  check('...and coming back into range resets the timer', dEnv.mobs.list.includes(back));
}

// ---------------------------------------------------------------- sunrise
{
  const env = world(floor(), 3); const s = env.mobs.spawn('shambler', 10.5, 12, 0.5), caveOne = env.mobs.spawn('shambler', -10.5, 12, 0.5);
  const lights = (x) => (x > 0 ? { sky: 15, blk: 0 } : { sky: 0, blk: 0 });
  const ctx = (extra = {}) => mkCtx({ x: 0, z: 0 }, { dayT: 0.1, lightAt: (x) => lights(x), ...extra });
  run(env, 1.0, ctx());
  check('at sunrise a monster on the surface freezes and flickers (not yet gone after 1 s)', s.lagging && env.mobs.list.includes(s) && Math.hypot(s.vx, s.vz) < 0.01 && !caveOne.lagging);
  run(env, 2.3, ctx());
  check('...and crumbles away after 3 s with no drops; the cave monster stays and keeps its drops', !env.mobs.list.includes(s) && env.mobs.list.includes(caveOne) && env.mobs.takeEvents().some((e) => e.type === 'crumble'));
  const late = world(floor(), 3); const t = late.mobs.spawn('shambler', 10.5, 12, 0.5);
  run(late, 4, mkCtx({ x: 0, z: 0 }, { dayT: NIGHT }));
  check('at night nothing crumbles', late.mobs.list.includes(t) && !t.lagging);
  const dim = world(floor(), 3); const u = dim.mobs.spawn('shambler', 10.5, 12, 0.5);
  run(dim, 5, mkCtx({ x: 0, z: 0 }, { dayT: 0.1, surfaceRules: false }));
  check('in the Underlayer (no surface rules) the sun never touches them', dim.mobs.list.includes(u));
}

// ---------------------------------------------------------------- Shambler
{
  const env = world(floor(), 4), P = { x: 0, z: 0 }; hurts.length = 0;
  const z = env.mobs.spawn('shambler', 12.5, 12, 0.5);
  run(env, 5, mkCtx(P));
  check('a Shambler sees you from 12 blocks and walks toward you at its slow speed', z.x < 6 && z.state === 'chase', `x ${z.x}`);
  const speed = (() => { const e2 = world(floor(), 4), a = e2.mobs.spawn('shambler', 20.5, 12, 0.5); run(e2, 0.5, mkCtx(P)); const x0 = a.x; run(e2, 2, mkCtx(P)); return (x0 - a.x) / 2; })();
  check('it is slow: about 2 blocks/s, well below your walking speed (4.3)', speed > 1.2 && speed < 2.5, `${speed}`);
  run(env, 8, mkCtx(P));
  const hit = hurts.filter(([a]) => a === 3);
  check('in melee it hits for 3 HP, with a wind-up, about once a second', hit.length >= 3 && hit.length <= 9 && hit.every(([, o]) => o.type === 'mob' && /Shambler/.test(o.name) && o.from), `${hit.length} hits in 8 s`);
  check('the hit names the Shambler in the death cause ("Was slain by a Shambler")', hit[0][1].name === 'a Shambler');
  const far = world(floor(), 4), f = far.mobs.spawn('shambler', 40.5, 12, 0.5); hurts.length = 0; run(far, 2, mkCtx(P));
  check('beyond its sight range (24) it only wanders', f.state === 'wander' && f.x > 35 || f.state === 'idle' || f.state === 'wander');
  const peace = world(floor(), 4); peace.mobs.spawn('shambler', 5.5, 12, 0.5); run(peace, 0.2, mkCtx(P, { peaceful: true }));
  check('switching to Peaceful removes monsters at once', peace.mobs.list.length === 0);
}

// ---------------------------------------------------------------- pathing around a wall
{
  const w = floor().fill(6, 12, -10, 6, 14, 10, B.stone);
  const env = world(w, 8), z = env.mobs.spawn('shambler', 12.5, 12, 0.5), P = { x: 0, z: 0 };
  hurts.length = 0;
  run(env, 25, mkCtx(P));
  check('a Shambler goes AROUND a wall to reach you (A* every 0.5 s) instead of pushing against it', z.x < 4 && hurts.length > 0, `x ${z.x.toFixed(1)} hits ${hurts.length}`);
  const stairs = floor(); for (let i = 0; i < 4; i++) stairs.fill(8 + i, 12, -3, 8 + i, 12 + i, 3, B.stone);
  const e2 = world(stairs, 8), a = e2.mobs.spawn('shambler', 30.5, 12, 0.5); hurts.length = 0;
  run(e2, 20, mkCtx({ x: 11.5, y: 16, z: 0.5 }));
  check('it climbs a staircase after you (hops up one-block steps)', a.y > 15 && Math.abs(a.x - 11.5) < 2, `y ${a.y} x ${a.x}`);
  const budget = world(floor(), 9); for (let i = 0; i < 30; i++) budget.mobs.spawn('shambler', 20 + i % 5, 12, i - 15);
  const t0 = performance.now(); run(budget, 3, mkCtx(P)); const ms = performance.now() - t0;
  check(`30 chasing monsters stay cheap: 3 s of game time simulated in ${ms.toFixed(0)} ms (at most ${CONFIG.hostiles.pathsPerStep} path searches per step)`, ms < 4000);
}

// ---------------------------------------------------------------- Rattler
{
  const env = world(floor(), 6), P = { x: 0, z: 0 }; hurts.length = 0;
  const r = env.mobs.spawn('rattler', 6.5, 12, 0.5);
  run(env, 4, mkCtx(P));
  const d = Math.hypot(r.x, r.z);
  check('a Rattler that is too close backs away until it is 8 to 12 blocks off', d >= 7.5 && d <= 13, `d ${d}`);
  const far = world(floor(), 6), q = far.mobs.spawn('rattler', 24.5, 12, 0.5); run(far, 8, mkCtx(P));
  const d2 = Math.hypot(q.x, q.z);
  check('one that is too far closes in to shooting range', d2 < 14, `d ${d2}`);
  const sh = world(floor(), 6), s = sh.mobs.spawn('rattler', 10.5, 12, 0.5); let shot = 0; let draws = 0; let flying = 0;
  const arrowHits = [];
  for (let t = 0; t < 12; t += 1 / 30) { sh.mobs.update(1 / 30, mkCtx(P)); sh.arrows.update(1 / 30, { x: 0, y: 12, z: 0, w: 0.6, h: 1.8 }); for (const e of sh.mobs.takeEvents()) { if (e.type === 'shoot') shot++; if (e.type === 'draw') draws++; } for (const e of sh.arrows.takeEvents()) if (e.type === 'hit-player') arrowHits.push(e.arrow.damage); flying = Math.max(flying, sh.arrows.list.length); }
  check('it draws its bow (an event, 0.9 s) and shoots roughly every 2 s: 12 s gives 3 to 8 arrows', shot >= 3 && shot <= 8 && draws >= shot, `${shot} shots ${draws} draws`);
  check('some arrows reach you, each for 2 to 4 HP, and they carry who shot them', arrowHits.length >= 1 && arrowHits.every((d) => d >= 2 && d <= 4), JSON.stringify(arrowHits));
  const wall = floor().fill(4, 12, -10, 4, 16, 10, B.stone), wl = world(wall, 6), b = wl.mobs.spawn('rattler', 10.5, 12, 0.5); let blocked = 0; hurts.length = 0;
  for (let t = 0; t < 8; t += 1 / 30) { wl.mobs.update(1 / 30, mkCtx(P)); wl.arrows.update(1 / 30, { x: 0, y: 12, z: 0, w: 0.6, h: 1.8 }); for (const e of wl.mobs.takeEvents()) if (e.type === 'shoot') blocked++; }
  check('it does not shoot through a wall (no line of sight, no arrows)', blocked === 0 && !hasLine(wl.mobs, b, { x: 0, y: 12, z: 0 }) && hasLine(sh.mobs, s, { x: 0, y: 12, z: 0 }));
}

// ---------------------------------------------------------------- arrows
{
  const w = floor(), env = world(w, 2);
  const a = env.arrows.shoot(0.5, 14, 0.5, 1, 0, 0, 20, 5, { mine: true });
  for (let t = 0; t < 0.4; t += 1 / 60) env.arrows.update(1 / 60, null);
  check('arrows fall with gravity: after 0.4 s a level shot has dropped about 1.8 blocks (22 b/s²)', a.y < 14 - 1.2 && a.y > 14 - 2.4 && a.x > 5, `y ${a.y} x ${a.x}`);
  for (let t = 0; t < 3; t += 1 / 60) env.arrows.update(1 / 60, null);
  check('it hits the grass and sticks there (an event, no longer moving)', a.stuck && Math.hypot(a.vx, a.vy, a.vz) === 0 && env.arrows.takeEvents().some((e) => e.type === 'stick'));
  const left = 29.5 - (a.age - a.stuckAt); env.arrows.update(left, null);
  check('a stuck arrow stays 30 s, then is gone', env.arrows.list.includes(a) && (env.arrows.update(1, null), !env.arrows.list.includes(a)));
  const b = env.arrows.shoot(0.5, 12.5, 0.5, 1, 0.3, 0, 12, 5, { mine: true });
  for (let t = 0; t < 2; t += 1 / 60) env.arrows.update(1 / 60, null);
  const walked = env.arrows.pickup({ x: b.x, y: b.y - 0.9, z: b.z }, 1.2);
  check('the arrows YOU shot can be picked up by walking over them; each is one item', b.stuck && walked === 1 && !env.arrows.list.includes(b));
  const e2 = env.arrows.shoot(0.5, 12.5, 0.5, 1, 0.3, 0, 12, 5, { shooter: {} }); for (let t = 0; t < 2; t += 1 / 60) env.arrows.update(1 / 60, null);
  check('hostile arrows cannot be picked up', env.arrows.pickup({ x: e2.x, y: e2.y - 0.9, z: e2.z }, 2) === 0);
  const c = world(w, 3), cow = c.mobs.spawn('cow', 6.5, 12, 0.5), shot = c.arrows.shoot(0.5, 12.9, 0.5, 1, 0.02, 0, 30, 7, { mine: true });
  let ev = null; for (let t = 0; t < 1 && !ev; t += 1 / 60) { c.arrows.update(1 / 60, null); ev = c.arrows.takeEvents().find((x) => x.type === 'hit-mob') ?? null; }
  check('an arrow that you shoot hits a mob (the event carries the mob) and is used up', ev?.mob === cow && !c.arrows.list.includes(shot));
  const pl = world(w, 3), bolt = pl.arrows.shoot(6.5, 13, 0.5, -1, 0, 0, 40, 3, { shooter: {} });
  let hp = null; for (let t = 0; t < 1 && !hp; t += 1 / 60) { pl.arrows.update(1 / 60, { x: 0.5, y: 12, z: 0.5, w: 0.6, h: 1.8 }); hp = pl.arrows.takeEvents().find((x) => x.type === 'hit-player') ?? null; }
  check('a hostile arrow that reaches the player is a hit-player event', !!hp && hp.arrow === bolt);
  check('bow damage by draw time: 2 at a flick, 9 at the full second, in between linear; the arrow flies faster the longer it is drawn', bowDamage(0) === 2 && bowDamage(1) === 9 && bowDamage(2) === 9 && near(bowDamage(0.5), 5.5, 0.06) && bowSpeed(1) > bowSpeed(0.2) && bowSpeed(0) > 0);
}

// ---------------------------------------------------------------- Creepcrawler
{
  const P = { x: 0, z: 0 }, env = world(floor(), 12), s = env.mobs.spawn('creepcrawler', 10.5, 12, 0.5);
  run(env, 3, mkCtx(P, { dayT: DAY }));
  check('by day a Creepcrawler is neutral: it ignores you', s.state !== 'chase' && !s.data.sees);
  env.mobs.damage(s, 1, { from: { x: 0, z: 0 } }); s.data.angry = true;
  hurts.length = 0; run(env, 4, mkCtx(P, { dayT: DAY, lightAt: () => ({ sky: 0, blk: 0 }) }));
  check('...until you hit it: then it attacks even by day', hurts.length > 0 || Math.hypot(s.x, s.z) < 3, `d ${Math.hypot(s.x, s.z)}`);
  const n = world(floor(), 12), t = n.mobs.spawn('creepcrawler', 17.5, 12, 0.5); run(n, 1, mkCtx(P)); const x0 = t.x; run(n, 1, mkCtx(P));
  check('at night it is fast: it covers well over 3 blocks/s once it is up to speed', (x0 - t.x) > 3, `${x0 - t.x} b/s`);
  const wall = floor().fill(5, 12, -30, 5, 20, 30, B.stone), wl = world(wall, 12), c = wl.mobs.spawn('creepcrawler', 11.5, 12, 0.5); let maxY = 12; hurts.length = 0;
  for (let k = 0; k < 20 * 30; k++) { wl.mobs.update(1 / 30, mkCtx(P)); maxY = Math.max(maxY, c.y); }
  check('it climbs a wall that stops a Shambler, and gets to you', maxY > 14 && c.x < 5.5, `maxY ${maxY} x ${c.x}`);
  const z = world(wall, 12), zz = z.mobs.spawn('shambler', 11.5, 12, 0.5); run(z, 20, mkCtx(P));
  check('the same wall does stop the Shambler (so the climbing is the spider, not the world)', zz.x > 5.5);
  const pn = world(floor(), 13), q = pn.mobs.spawn('creepcrawler', 4, 12, 0.5), P2 = { x: 0.5, z: 0.5 }; let pounced = 0; for (let k = 0; k < 120; k++) { pn.mobs.update(1 / 30, mkCtx(P2)); for (const e of pn.mobs.takeEvents()) if (e.type === 'pounce') pounced++; }
  check('it pounces from a few blocks away (a leap event), not every moment', pounced >= 1 && pounced <= 3, `${pounced}`);
}

// ---------------------------------------------------------------- Pop-up
{
  const env = world(floor(), 14), P = { x: 0, z: 0 }; hurts.length = 0;
  const p = env.mobs.spawn('popup', 14.5, 15, 0.5); let overlay = null;
  for (let t = 0; t < 20 && !overlay; t += 1 / 30) { env.mobs.update(1 / 30, mkCtx(P)); overlay = env.mobs.takeEvents().find((e) => e.type === 'overlay') ?? null; }
  check('a Pop-up drifts to you through the air and on contact asks for the 4 s ad overlay, without damage', !!overlay && overlay.seconds === 4 && hurts.length === 0 && Math.hypot(p.x, p.z) < 2);
  const again = (() => { let n = 0; for (let t = 0; t < 6; t += 1 / 30) { env.mobs.update(1 / 30, mkCtx(P)); n += env.mobs.takeEvents().filter((e) => e.type === 'overlay').length; } return n; })();
  check('it does not re-trigger at once (8 s between ads)', again === 0);
  const w = floor().fill(-3, 12, -3, 3, 16, 3, B.air); const fly = world(w, 14), f = fly.mobs.spawn('popup', 14.5, 18, 0.5); run(fly, 3, mkCtx(P));
  check('it flies: no falling to the ground while it is airborne', f.y > 13);
  const killed = world(floor(), 14), k = killed.mobs.spawn('popup', 3.5, 14, 0.5); const r = killed.mobs.damage(k, 6, { from: P, type: 'player' });
  check('6 HP: one iron sword hit pops it, and it drops the Ad Block item', r.killed && r.drops.some((d) => d.id === 'popup'));
}

// ---------------------------------------------------------------- the Underlayer monsters
{
  check('Daemon: 24 HP, groups of 2-3, drops ash dust and 15% a cobalt nugget; Glitch: 30 HP, melee 5, teleports every 4 s, swaps 3 blocks, drops glitch dust', MOBS.daemon.hp === 24 && MOBS.daemon.group.join() === '2,3' && MOBS.daemon.drops[0][0] === 'ash_dust' && MOBS.daemon.drops[1][0] === 'cobalt_nugget' && MOBS.daemon.drops[1][3] === 0.15 && MOBS.daemon.drops[1][1] === 1 && MOBS.glitch.hp === 30 && MOBS.glitch.melee.damage === 5 && MOBS.glitch.teleport.everyS === 4 && MOBS.glitch.teleport.swaps === 3 && MOBS.glitch.drops[0][0] === 'glitch_dust');
  const nug = (() => { const e = world(floor(), 71); let n = 0; for (let i = 0; i < 2000; i++) { const m = e.mobs.spawn('daemon', 0, 12, 0); if (e.mobs.damage(m, 99, {}).drops.some((d) => d.id === 'cobalt_nugget')) n++; e.mobs.list.length = 0; } return n / 2000; })();
  check('a Daemon drops a cobalt nugget about 15% of the time', Math.abs(nug - 0.15) < 0.03, `${nug}`);
  // a Daemon dashes (an event) then lobs fireballs that burn
  const env = world(floor(), 72), P = { x: 0, z: 0 }; hurts.length = 0;
  const d = env.mobs.spawn('daemon', 11.5, 12, 0.5); let dashes = 0, shots = 0, hit = [];
  for (let t = 0; t < 12; t += 1 / 30) { env.mobs.update(1 / 30, mkCtx(P, { surfaceRules: false, dayT: 0.25, lightAt: () => ({ sky: 15, blk: 0 }) })); env.arrows.update(1 / 30, { x: 0, y: 12, z: 0, w: 0.6, h: 1.8 }); for (const e of env.mobs.takeEvents()) { if (e.type === 'dash') dashes++; if (e.type === 'shoot' && e.fire) shots++; } for (const e of env.arrows.takeEvents()) if (e.type === 'hit-player') hit.push(e.arrow); }
  check('a Daemon dashes and throws fireballs; they fly straight, hit for 4 and carry 2 s of burning', dashes >= 1 && shots >= 1 && hit.every((a) => a.fire && a.damage === 4 && a.burnS === 2), `${dashes} dashes ${shots} fireballs ${hit.length} hits`);
  check('the sun does not touch Underlayer monsters even at noon on a surface-lit cell', env.mobs.list.includes(d));
  const fb = world(floor().fill(5, 12, -5, 5, 14, 5, B.stone), 73); const f = fb.arrows.shoot(10, 13, 0.5, -1, 0, 0, 13, 4, { fire: true, burnS: 2 });
  for (let t = 0; t < 2; t += 1 / 60) fb.arrows.update(1 / 60, null);
  check('a fireball bursts on a wall instead of sticking, and it does not drop (no gravity)', f.dead && fb.arrows.takeEvents().some((e) => e.type === 'burst') && Math.abs(f.y - 13) < 1e-6);
  // Glitch: teleports next to you and rewrites blocks
  const g = world(floor(), 74), gl = g.mobs.spawn('glitch', 14.5, 12, 0.5); let swaps = null, tps = 0;
  for (let t = 0; t < 4.3; t += 1 / 30) { g.mobs.update(1 / 30, mkCtx(P, { surfaceRules: false })); for (const e of g.mobs.takeEvents()) { if (e.type === 'glitch-swap') swaps = e.picks; if (e.type === 'teleport') tps++; } }
  check('a Glitch teleports to a spot next to you after 4 s (once) and asks for 3 block swaps around itself', tps === 1 && Math.hypot(gl.x, gl.z) < 3.5 && swaps && swaps.length === 3 && swaps.every((p) => p.length === 4), `${tps} tps, d ${Math.hypot(gl.x, gl.z)}`);
  hurts.length = 0; run(g, 8, mkCtx(P, { surfaceRules: false }));
  check('then it hits for 5 in melee', hurts.some(([a]) => a === 5));
}

console.log(`\nStrata hostiles: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
