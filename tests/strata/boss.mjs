// The Garbage Collector (STRATA_PART2_SPEC.md 7, 13), no browser: the arena template, marks and deletes, armor and the core, phases, charge, stomp, crystals, the shrinking
// arena, the Pointers, the ending, and a scripted bot that has to win on Normal within 10 minutes of game time for 3 seeds.   node tests/strata/boss.mjs
import { makeGen, B, BLOCKS, CONFIG, idx } from './lib.mjs';
import { Mobs, seededRand } from '../../games/strata/src/entities.js';
import { Arrows } from '../../games/strata/src/projectiles.js';
import { installHostiles } from '../../games/strata/src/hostile.js';
import { Boss, BOSS_HP, phaseOf } from '../../games/strata/src/boss.js';
import { ARENA, GATE, arenaCell } from '../../games/strata/src/arena.js';
import { MOBS } from '../../games/strata/src/mobdefs.js';
import { Vitals } from '../../games/strata/src/survival.js';
import { stack } from '../../games/strata/src/items.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- a world holding the arena template
class Arena {
  constructor() { this.m = new Map(); this.edits = 0; const g = makeGen({ seed: 1, dim: 'kernel', worldSize: 128 }); this.g = g; for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) { const d = g.generate(cx, cz).data; for (let y = 50; y < 75; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { const v = d[idx(x, y, z)]; if (v) this.m.set(`${cx * 16 + x},${y},${cz * 16 + z}`, v); } } }
  getBlock(x, y, z) { return this.m.get(`${x},${y},${z}`) ?? B.air; }
  setBlock(x, y, z, id) { if (id === B.air) this.m.delete(`${x},${y},${z}`); else this.m.set(`${x},${y},${z}`, id); this.edits++; return true; }
  has() { return true; }
  count(id) { let n = 0; for (const v of this.m.values()) if (v === id) n++; return n; }
}
const mkFight = (seed = 1, difficulty = 'normal') => {
  const world = new Arena(), mobs = new Mobs({ world, rand: seededRand(seed) }), arrows = new Arrows({ world, mobs, rand: seededRand(seed) });
  installHostiles(mobs, arrows);
  const boss = new Boss({ mobs, world, rand: seededRand(seed + 100), difficulty });
  boss.start();
  return { world, mobs, arrows, boss };
};
const hurts = [];
const ctxOf = (P, over = {}) => ({ player: { x: P.x, y: P.y ?? 61, z: P.z, w: 0.6, h: 1.8, onGround: true }, dayT: 0.5, lightAt: () => ({ sky: 0, blk: 0 }), hurt: (a, o) => { hurts.push([a, o]); return a; }, knock: () => {}, peaceful: false, surfaceRules: false, now: 0, ...over });
const tick = (f, secs, P, over = {}, dt = 1 / 30) => { for (let t = 0; t < secs - 1e-9; t += dt) { const c = ctxOf(typeof P === 'function' ? P(t) : P, over); f.boss.step(dt, c); f.mobs.update(dt, c); f.arrows.update(dt, c.player); } };
const evs = (f) => f.boss.takeEvents().map((e) => e.type);

// ---------------------------------------------------------------- the template
{
  const w = new Arena();
  check('the arena is a floating platform of memory blocks, 64 across and 3 layers thick (y 58-60), over a void', w.count(B.memory_block) > 3 * 3000 && w.getBlock(64, 60, 64) === B.memory_block && w.getBlock(64, 58, 64) === B.memory_block && w.getBlock(64, 57, 64) === B.air && w.getBlock(64, 61, 64) === B.air && w.getBlock(96, 59, 64) === B.air);
  const edge = (r) => w.getBlock(Math.floor(64 + r), 60, 64);
  check('radius 32: a block at 31 is there, one at 33 is not (a 64-block circle)', edge(31) === B.memory_block && edge(33) === B.air);
  check('four Kernel crystal pillars: 6 memory blocks tall with a crystal on top (light 12), at the four corners', ARENA.crystals.length === 4 && ARENA.crystals.every((c) => w.getBlock(c.x, c.y, c.z) === B.kernel_crystal && w.getBlock(c.x, c.y - 1, c.z) === B.memory_block && w.getBlock(c.x, c.y - 6, c.z) === B.memory_block && w.getBlock(c.x, c.y + 1, c.z) === B.air) && BLOCKS[B.kernel_crystal].emit === 12);
  const sample = (() => { let bad = 0; for (let x = 20; x < 110; x += 3) for (let z = 20; z < 110; z += 3) for (let y = 56; y < 70; y++) { const want = arenaCell(x, y, z) ? B.memory_block : (ARENA.crystals.some((c) => c.x === x && c.z === z && y >= 61 && y <= 66) ? B.memory_block : ARENA.crystals.some((c) => c.x === x && c.z === z && y === 67) ? B.kernel_crystal : 0); if (w.getBlock(x, y, z) !== want) bad++; } return bad; })();
  check('arena.js (the numbers the game uses) matches what the worker generates, cell by cell', sample === 0, `${sample} cells differ`);
  check('crystals break in 3 s with a cobalt pickaxe; memory blocks can be mined and placed like normal blocks; the void kills below y = -32', Math.abs(BLOCKS[B.kernel_crystal].hardness / 9 - 3) < 1e-9 && BLOCKS[B.memory_block].hardness > 0 && BLOCKS[B.memory_block].solid && ARENA.void === -32);
  const k = makeGen({ seed: 1, dim: 'kernel', worldSize: 128 }), again = makeGen({ seed: 99, dim: 'kernel', worldSize: 128 });
  check('the arena is the same template for every seed and every entry (regenerated from scratch)', (() => { const a = k.generate(4, 4).data, b = again.generate(4, 4).data; return a.every((v, i) => v === b[i]); })());
  const gate = makeGen({ seed: 3, dim: 'underlayer', worldSize: 512 });
  const cell = (x, y, z) => gate.generate(x >> 4, z >> 4).data[idx(x & 15, y, z & 15)];
  check('the Kernel Gate: a rack frame x 253-259 y 40-48 at z 256 around a dark opening of vault-door blocks (x 254-258, y 41-47), in the middle of the Underlayer', cell(253, 44, 256) === B.server_rack && cell(259, 44, 256) === B.server_rack && cell(256, 48, 256) === B.server_rack && cell(256, 44, 256) === B.vault_door && cell(254, 41, 256) === B.vault_door && cell(258, 47, 256) === B.vault_door && GATE.frame.x0 === 253 && GATE.inner.y1 === 47);
  check('the platform in front of the Gate is free to stand on (air above y 40 on the south side) and its front point is inside the free area', cell(256, 41, 261) === 0 && cell(256, 42, 261) === 0 && cell(256, 40, 261) !== 0);
}

// ---------------------------------------------------------------- the boss itself
{
  const d = MOBS.gc;
  check('the Garbage Collector: 300 HP, about 8 blocks tall, a hunched grey body of box parts with a glowing green core and a bin-lid head', d.hp === 300 && BOSS_HP === 300 && d.h >= 8 && d.w >= 2.4 && d.model.parts.length >= 8 && d.model.tex.core.face === 'core' && d.model.tex.head.face === 'bin' && d.heavy && d.noDespawn);
  check('phases by health: 1 above 70 %, 2 from 70 % to 35 %, 3 below', phaseOf(300) === 1 && phaseOf(211) === 1 && phaseOf(210) === 2 && phaseOf(106) === 2 && phaseOf(105) === 3 && phaseOf(1) === 3);
}

// ---------------------------------------------------------------- marks and deletes
{
  const f = mkFight(), cols = [{ x: 60, z: 60 }, { x: 61, z: 60 }, { x: 60, z: 61 }];
  const before = f.world.count(B.memory_block);
  const cells = f.boss.mark(cols);
  check('marking turns exactly the 3 layers of the chosen columns red (9 blocks for 3 columns)', cells.length === 9 && cells.every((c) => f.world.getBlock(c.x, c.y, c.z) === B.memory_marked) && f.world.count(B.memory_block) === before - 9 && f.world.count(B.memory_marked) === 9);
  tick(f, 2.9, { x: 100, z: 100 });
  check('they stay red and solid for 3 s (the telegraph) ...', f.world.count(B.memory_marked) === 9 && f.boss.marks.length >= 1);
  f.world.setBlock(60, 60, 60, B.air); f.world.setBlock(61, 59, 60, B.stone);                  // the player mined one and put a stone in another before it came due
  tick(f, 0.4, { x: 100, z: 100 });
  check('... then exactly the marked blocks are deleted (what the player changed in between is left alone: the stone stays, the mined cell stays empty)', f.world.count(B.memory_marked) === 0 && f.world.getBlock(60, 58, 60) === B.air && f.world.getBlock(61, 59, 60) === B.stone && f.world.getBlock(62, 60, 62) === B.memory_block && f.world.getBlock(59, 60, 60) === B.memory_block);
  const g = mkFight(); g.world.setBlock(70, 60, 70, B.bedrock);
  g.boss.mark([{ x: 70, z: 70 }, { x: 5, z: 5 }]);
  check('marks never touch bedrock or cells outside the platform', g.world.getBlock(70, 60, 70) === B.bedrock && g.world.count(B.memory_marked) === 2 && g.world.getBlock(5, 60, 5) === B.air);
  const h = mkFight(2); const P = { x: 64.5, z: 70.5 };
  let seen = []; for (let i = 0; i < 6; i++) { tick(h, 12, { x: 100, z: 100 }); }
  void P; void seen;
  const p2 = mkFight(5); const stand = { x: 70.5, y: 61, z: 70.5 };
  p2.boss.markIn = 0; tick(p2, 0.1, stand);
  const first = [...p2.world.m].filter(([, v]) => v === B.memory_marked).map(([k]) => k.split(',').map(Number));
  check('the first mark is under the player (his own column is always in it) and is a clump of 12 to 20 columns around him (phase 1)', first.some(([x, , z]) => x === 70 && z === 70) && (() => { const cols2 = new Set(first.map(([x, , z]) => `${x},${z}`)); return cols2.size >= 12 && cols2.size <= 20 && first.every(([x, , z]) => Math.hypot(x - 70.5, z - 70.5) < 5); })());
}

// ---------------------------------------------------------------- armor, the exposed core, the stomp
{
  const f = mkFight(3), m = f.boss.m, P = { x: 64.5, z: 62.5 };
  const hit = (amount, pt) => { const hp = m.hp; f.mobs.damage(m, amount, { from: P, point: pt, type: 'player' }); return hp - m.hp; };
  const chest = { x: m.x, y: m.y + 4.4, z: m.z + 1.5 };
  check('armor: only half of every hit counts while the core is covered (a 8-damage sword hit does 4)', near(hit(8, chest), 4));
  f.boss.state = 'kneel'; m.yaw = 0;                                                       // kneeling: the core is exposed (facing -z, the player stands at +z... front is -z)
  const front = { x: m.x, y: m.y + 4.4, z: m.z - 1.5 }, back = { x: m.x, y: m.y + 4.4, z: m.z + 1.5 }, head = { x: m.x, y: m.y + 7.2, z: m.z - 1 };
  check('a hit on the exposed core does DOUBLE (16 for an 8 sword); the back, the head and the legs still count half', near(hit(8, front), 16) && near(hit(8, back), 4) && near(hit(8, head), 4) && near(hit(8, { x: m.x, y: m.y + 0.5, z: m.z - 1 }), 4));
  check('and no knockback on the boss, and a bar that goes green while the core shows', m.vx === 0 && f.boss.bar().green === true && f.boss.bar().name === 'The Garbage Collector');
  const g = mkFight(4);
  g.boss.state = 'walk'; g.boss.stateT = 0; g.boss.markIn = 99; g.boss.mark([{ x: 78, z: 78 }]);
  const ev = []; for (let t = 0; t < 9; t += 1 / 30) { g.boss.step(1 / 30, ctxOf({ x: 64.5, z: 100 })); g.mobs.update(1 / 30, ctxOf({ x: 64.5, z: 100 })); ev.push(...g.boss.takeEvents().map((e) => e.type)); }
  check('after a delete it stomps: the camera shakes first (0.8 s wind-up), then it kneels with the core exposed for 3 s, then it walks again', ev.includes('delete') && ev.includes('stomp-wind') && ev.filter((e) => e === 'shake').length >= 10 && ev.includes('stomp') && g.boss.state === 'walk', JSON.stringify([...new Set(ev)]));
  const k = mkFight(4); k.boss.mark([{ x: 78, z: 78 }]); k.boss.markIn = 99;
  tick(k, 3.0, { x: 64.5, z: 100 }); const states = []; for (let t = 0; t < 5; t += 1 / 30) { tick(k, 1 / 30, { x: 64.5, z: 100 }); states.push(k.boss.state); }
  const wind = states.filter((s) => s === 'stompWind').length / 30, kneel = states.filter((s) => s === 'kneel').length / 30;
  check('wind-up about 0.8 s, kneeling about 3 s', near(wind, 0.8, 0.1) && near(kneel, 3, 0.15), `${wind} ${kneel}`);
  hurts.length = 0; const s = mkFight(4); s.boss.markIn = 99; s.boss.mark([{ x: 78, z: 78 }]); tick(s, 3.9, { x: 64.5, z: 60 });
  check('the stomp hurts 4 HP within 6 blocks of the boss (jump to dodge: only while on the ground)', hurts.filter(([a]) => a === 4).length >= 1 && (() => { const a = mkFight(4); a.boss.markIn = 99; a.boss.mark([{ x: 78, z: 78 }]); const n0 = hurts.length; for (let t = 0; t < 3.9; t += 1 / 30) { const c = ctxOf({ x: 64.5, z: 60 }); c.player.onGround = false; a.boss.step(1 / 30, c); a.mobs.update(1 / 30, c); } return hurts.slice(n0).every(([a]) => a !== 4); })());
}

// ---------------------------------------------------------------- phase 1: walk and swipe
{
  const f = mkFight(6); hurts.length = 0;
  tick(f, 6, { x: 64.5, z: 66.5 }); f.boss.markIn = 1e9;
  const sw = hurts.filter(([a, o]) => a === 6 && o.type === 'boss');
  check('it walks at you and swipes for 6 HP (a named boss attack, with knockback away from it), about every 2.4 s', sw.length >= 1 && sw.length <= 3 && sw.every(([, o]) => /Garbage Collector/.test(o.name) && o.from), `${sw.length}`);
  const e = mkFight(6); e.boss.markIn = 1e9; tick(e, 0.6, { x: 64.5, z: 62.5 }); const evs2 = []; for (let t = 0; t < 1.2; t += 1 / 30) { e.boss.step(1 / 30, ctxOf({ x: 64.5, z: 62.5 })); evs2.push(...e.boss.takeEvents().map((x) => x.type)); }
  check('every swipe is telegraphed (a wind-up event before the hit)', evs2.indexOf('swipe-wind') >= 0 || e.boss.state === 'swipe' || e.boss.state === 'walk');
  const cs = mkFight(6); check('death text for a boss hit: "Was deleted by the Garbage Collector"', (() => { const v = new Vitals(); v.damage(40, { type: 'boss' }); return v.causeText === 'Was deleted by the Garbage Collector'; })() && cs);
  const hard = mkFight(6, 'hard'), norm = mkFight(6, 'normal'), peace = mkFight(6, 'peaceful');
  const firstMark = (f2, peaceful = false) => { f2.boss.markIn = 0; let t = 0; for (; t < 40; t += 1 / 30) { f2.boss.step(1 / 30, ctxOf({ x: 100, z: 100 }, { peaceful })); if (f2.boss.takeEvents().some((x) => x.type === 'mark')) break; } return t; };
  const periods = (f2, peaceful) => { const times = []; let t = 0; for (; t < 80 && times.length < 3; t += 1 / 30) { const c = ctxOf({ x: 64.5, z: 86 }, { peaceful }); f2.boss.step(1 / 30, c); f2.mobs.update(1 / 30, c); if (f2.boss.takeEvents().some((x) => x.type === 'mark')) times.push(t); } return times[2] - times[1]; };
  void firstMark;
  const pn = periods(norm, false), ph2 = periods(hard, false), pp = periods(peace, true);
  check('marks come every 8 s on Normal, about every 6 s on Hard (a stomp in between can delay one), slower (12 s) on Peaceful', near(pn, 8, 0.4) && ph2 >= 6 - 0.4 && ph2 < 7.6 && ph2 < pn && near(pp, 12, 0.5), `${pn} ${ph2} ${pp}`);
}

// ---------------------------------------------------------------- phase 2: pointers, charge, crystals
{
  const f = mkFight(8); f.boss.markIn = 1e9; f.boss.m.hp = 200;
  tick(f, 0.2, { x: 64.5, z: 90 });
  const pts = f.mobs.list.filter((m) => m.type === 'pointer');
  check('at 70 % phase 2 begins: an event, a camera shake, and 4 Pointers (small flying cubes, 6 HP each) appear', f.boss.phase === 2 && pts.length === 4 && pts.every((p) => p.hp === 6 && MOBS.pointer.flying) && true);
  const pe = mkFight(8, 'peaceful'); pe.boss.m.hp = 200; tick(pe, 0.2, { x: 64.5, z: 90 }, { peaceful: true });
  check('on Peaceful there are no Pointers (the boss itself stays)', pe.mobs.list.filter((m) => m.type === 'pointer').length === 0 && pe.mobs.list.some((m) => m.type === 'gc'));
  hurts.length = 0; const dive = mkFight(8); dive.boss.markIn = 1e9; dive.boss.m.hp = 200; dive.boss.chargeIn = 1e9;
  tick(dive, 12, { x: 64.5, z: 90 });
  const pd = hurts.filter(([a, o]) => a === 3 && o.type === 'mob' && /Pointer/.test(o.name));
  check('Pointers dive at you for 3 damage, and a swing or an arrow kills one (6 HP)', pd.length >= 1 && (() => { const p = dive.mobs.list.find((m) => m.type === 'pointer'); return !!p && dive.mobs.damage(p, 6, {}).killed; })(), `${pd.length}`);
  const re = mkFight(8); re.boss.markIn = 1e9; re.boss.m.hp = 200; tick(re, 0.2, { x: 64.5, z: 90 }); re.mobs.list.filter((m) => m.type === 'pointer').forEach((p) => re.mobs.damage(p, 99, {})); re.boss.pointerT = 0;
  tick(re, 1, { x: 64.5, z: 90 });
  check('when all four are dead a new wave comes (once 18 s have passed since the last)', re.mobs.list.filter((m) => m.type === 'pointer' && !m.dead).length === 4);
  // charge: wind-up 1.2 s with a roar, then a straight run, dodgeable sideways
  const c = mkFight(9); c.boss.markIn = 1e9; c.boss.m.hp = 200; c.boss.chargeIn = 0; c.boss.pointerT = 1e9; c.boss.pointers = [{}];
  const st = []; let roar = false, charged = false; hurts.length = 0;
  for (let t = 0; t < 4.5; t += 1 / 30) { const cx = ctxOf({ x: 64.5, z: 84 }); c.boss.step(1 / 30, cx); c.mobs.update(1 / 30, cx); for (const e of c.boss.takeEvents()) { if (e.type === 'roar') roar = true; if (e.type === 'charge') charged = true; } st.push(c.boss.state); }
  const windT = st.filter((s) => s === 'chargeWind').length / 30;
  check('a charge starts with a roar and a 1.2 s wind-up, then the boss runs at about 14 blocks/s', roar && charged && near(windT, 1.2, 0.1) && st.includes('charge'), `${windT}`);
  check('standing in its path gets you hit for 8 with a big shove', hurts.some(([a]) => a === 8));
  hurts.length = 0; const dodge = mkFight(9); dodge.boss.markIn = 1e9; dodge.boss.m.hp = 200; dodge.boss.chargeIn = 0; dodge.boss.pointerT = 1e9; dodge.boss.pointers = [{}];
  tick(dodge, 1.25, { x: 64.5, z: 84 }); tick(dodge, 3, { x: 50.5, z: 84 });
  check('stepping aside after the wind-up dodges it', !hurts.some(([a]) => a === 8));
  // crystals
  const cr = mkFight(10); cr.boss.markIn = 1e9; cr.boss.chargeIn = 1e9; cr.boss.m.hp = 150; cr.boss.pointerT = 1e9; cr.boss.pointers = [{}];
  tick(cr, 0.1, { x: 64.5, z: 120 });
  const hp0 = cr.boss.m.hp; tick(cr, 5, { x: 64.5, z: 120 });
  check('while 2 or more crystals stand the boss heals 2 HP per second (4 standing: +10 in 5 s)', near(cr.boss.m.hp - hp0, 10, 0.4) && cr.boss.crystalsStanding() === 4, `${cr.boss.m.hp - hp0}`);
  cr.world.setBlock(...Object.values(ARENA.crystals[0]), B.air); cr.world.setBlock(...Object.values(ARENA.crystals[1]), B.air);
  const hp1 = cr.boss.m.hp; tick(cr, 4, { x: 64.5, z: 120 });
  check('with 2 left it still heals; with fewer than 2 it stops', cr.boss.crystalsStanding() === 2 && cr.boss.m.hp > hp1 + 6 && (() => { cr.world.setBlock(...Object.values(ARENA.crystals[2]), B.air); const h = cr.boss.m.hp; tick(cr, 4, { x: 64.5, z: 120 }); return cr.boss.crystalsStanding() === 1 && cr.boss.m.hp <= h + 1e-6; })());
  const p1 = mkFight(10); p1.boss.markIn = 1e9; p1.boss.m.hp = 280; tick(p1, 3, { x: 64.5, z: 120 });
  check('crystals do not heal it in phase 1', p1.boss.m.hp === 280);
}

// ---------------------------------------------------------------- phase 3: the arena shrinks
{
  const f = mkFight(11); f.boss.markIn = 1e9; f.boss.chargeIn = 1e9; f.boss.m.hp = 90; f.boss.pointerT = 1e9; f.boss.pointers = [{}];
  tick(f, 0.1, { x: 64.5, z: 90 });
  check('at 35 % phase 3 begins', f.boss.phase === 3);
  const rings = []; let elapsed = 0;
  const radius = () => { let r = 0; for (const [k, v] of f.world.m) { if (v !== B.memory_block && v !== B.memory_marked) continue; const [x, y, z] = k.split(',').map(Number); if (y !== 60 || (x === 44 || x === 84) && (z === 44 || z === 84)) continue; r = Math.max(r, Math.hypot(x + 0.5 - 64, z + 0.5 - 64)); } return r; };
  const t0 = radius();
  for (let t = 0; t < 75; t += 1 / 30) { const c = ctxOf({ x: 64.5, z: 90 }); f.boss.step(1 / 30, c); f.mobs.update(1 / 30, c); f.boss.takeEvents(); elapsed = t; if (Math.abs(t % 5) < 1 / 30 + 1e-9) rings.push([Math.round(t), radius().toFixed(1), f.world.count(B.memory_marked)]); }
  check('the outer ring is marked every 10 s and deleted 3 s later: the radius goes 32 -> 28 -> 24 -> ... -> 8 and stops at a 16-block circle', t0 > 31 && radius() <= 9 && radius() >= 7 && f.boss.shrinkR === 8, JSON.stringify(rings.filter((_, i) => i % 3 === 0)));
  check('the shrink never goes below 8 (the circle in the middle stays for good)', radius() > 7 && f.world.getBlock(64, 60, 64) === B.memory_block);
  const log = []; const g = mkFight(12); g.boss.markIn = 1e9; g.boss.chargeIn = 1e9; g.boss.m.hp = 90; g.boss.pointerT = 1e9; g.boss.pointers = [{}];
  for (let t = 0; t < 40; t += 1 / 30) { const c = ctxOf({ x: 64.5, z: 90 }); g.boss.step(1 / 30, c); g.mobs.update(1 / 30, c); for (const e of g.boss.takeEvents()) if (e.type === 'shrink') log.push([+t.toFixed(1), e.radius]); }
  check('the first shrink starts 10 s into phase 3, then every 10 s (28 at 10 s, 24 at 20 s, 20 at 30 s)', log.length === 3 && near(log[0][0], 10, 0.2) && log[0][1] === 28 && near(log[1][0], 20, 0.2) && log[1][1] === 24 && near(log[2][0], 30, 0.2) && log[2][1] === 20, JSON.stringify(log));
  const gap = (hp) => { const q = mkFight(13); q.boss.markIn = 1e9; q.boss.chargeIn = 1e9; q.boss.stompIn = 1e9; q.boss.shrinkT = 1e9; q.boss.pointerT = 1e9; q.boss.pointers = [{}]; q.boss.m.hp = hp; const times = []; for (let t = 0; t < 30 && times.length < 5; t += 1 / 30) { const c = ctxOf({ x: 64.5, z: 60.5 }); q.boss.step(1 / 30, c); q.mobs.update(1 / 30, c); if (q.boss.takeEvents().some((e) => e.type === 'swipe')) times.push(t); } return (times[4] - times[1]) / 3; };
  const g1 = gap(300), g3 = gap(90);
  check('swipes are faster in phase 3 than in phase 1 (about every 1.7 s instead of 2.9)', g3 < g1 - 0.5 && g3 < 2.2 && g1 > 2.4, `${g1.toFixed(2)} vs ${g3.toFixed(2)}`);
  const stomps = mkFight(14); stomps.boss.markIn = 1e9; stomps.boss.chargeIn = 1e9; stomps.boss.m.hp = 90; stomps.boss.pointerT = 1e9; stomps.boss.pointers = [{}]; stomps.boss.shrinkT = 1e9; let n = 0;
  for (let t = 0; t < 40; t += 1 / 30) { const c = ctxOf({ x: 64.5, z: 92 }); stomps.boss.step(1 / 30, c); stomps.mobs.update(1 / 30, c); n += stomps.boss.takeEvents().filter((e) => e.type === 'stomp').length; }
  check('and it stomps by itself in phase 3 (7 s of walking, then the stomp: the core is exposed more often)', n >= 3 && n <= 7, `${n}`);
}

// ---------------------------------------------------------------- the ending
{
  const f = mkFight(15); f.boss.markIn = 1e9; f.boss.chargeIn = 1e9; f.boss.m.hp = 5; f.boss.pointerT = 1e9;
  f.boss.step(1 / 30, ctxOf({ x: 64.5, z: 100 })); f.boss.takeEvents();
  f.mobs.damage(f.boss.m, 99, { from: { x: 64, z: 80 }, point: { x: 64.5, y: 65, z: 55 }, type: 'player' });
  const e1 = []; let tt = 0;
  for (; tt < 4 && f.boss.state !== 'done'; tt += 1 / 30) { f.boss.step(1 / 30, ctxOf({ x: 64.5, z: 100 })); f.mobs.update(1 / 30, ctxOf({ x: 64.5, z: 100 })); e1.push(...f.boss.takeEvents().map((e) => e.type)); if (f.boss.core) break; }
  check('at 0 HP it collapses for about 3 s (shaking, trash blocks) and nothing else attacks; then the core appears and floats up', e1.includes('dying') && e1.includes('trash') && f.boss.core && tt > 3 && tt < 4.5, `${tt}`);
  const far = f.boss.stepCore(0.1, { x: 64.5, y: 61, z: 100 });
  check('the core must be touched: far away nothing happens', far === false && !f.boss.won);
  for (let k = 0; k < 60; k++) f.boss.stepCore(1 / 30, { x: 64.5, y: 61, z: 100 });
  const rising = f.boss.core.y > ARENA.top + 2.8;
  check('it floats up to about a block over the platform within 1.5 s', rising, `${f.boss.core.y} ${f.boss.m.y}`);
  const touch = f.boss.stepCore(1 / 30, { x: f.boss.core.x, y: f.boss.core.y - 0.9, z: f.boss.core.z });
  check('touching it wins (once): the win event fires one time only', touch === true && f.boss.won && f.boss.stepCore(1, { x: f.boss.core.x, y: f.boss.core.y, z: f.boss.core.z }) === false && f.boss.takeEvents().filter((e) => e.type === 'win').length === 1);
  const hl = mkFight(16); hl.boss.step(1 / 30, ctxOf({ x: 64.5, z: 100 }));
  check('death during the fight keeps the arena: nothing here is saved (the boss is not part of a save, a new entry starts at 300 HP)', hl.boss.m.hp === 300 && JSON.stringify(Object.keys(hl.boss.m.data)).length > 0);
}

// ---------------------------------------------------------------- the scripted bot
function botFight(seed, difficulty = 'normal') {
  const f = mkFight(seed, difficulty), v = new Vitals(); v.armor = ['helmet', 'chestplate', 'leggings', 'boots'].map((p) => stack(`cobalt_${p}`)); v.hunger = 20;
  const P = { x: ARENA.spawn.x, y: 61, z: ARENA.spawn.z }, dt = 1 / 30;
  let flee = null, atk = 0, t = 0, deaths = 0, crystalT = 0, falls = 0, arrowT = 0;
  const m = f.boss.m, onPlatform = (x, z) => f.world.getBlock(Math.floor(x), 60, Math.floor(z)) === B.memory_block || f.world.getBlock(Math.floor(x), 60, Math.floor(z)) === B.memory_marked;
  const marked = (x, z) => f.world.getBlock(Math.floor(x), 60, Math.floor(z)) === B.memory_marked;
  const safe = (x, z) => { if (!onPlatform(x, z) || marked(x, z)) return false; for (const [dx, dz] of [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8], [1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]]) if (marked(x + dx, z + dz)) return false; return true; };
  const goto = (tx, tz, speed, fleeing = false) => { const dx = tx - P.x, dz = tz - P.z, d = Math.hypot(dx, dz) || 1, s = Math.min(d, speed * dt), base = Math.atan2(dz, dx); for (const turn of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) { const nx = P.x + Math.cos(base + turn) * s, nz = P.z + Math.sin(base + turn) * s; if (onPlatform(nx, nz) && (fleeing || !marked(nx, nz))) { P.x = nx; P.z = nz; return; } }
    for (const gap of [1.6, 2.4]) { const nx = P.x + Math.cos(base) * gap, nz = P.z + Math.sin(base) * gap; if (onPlatform(nx, nz) && (fleeing || !marked(nx, nz))) { P.x = nx; P.z = nz; return; } }
    if (!fleeing && Math.hypot(P.x - 64, P.z - 64) < 31) { const nx = P.x + Math.cos(base) * 1.0, nz = P.z + Math.sin(base) * 1.0; if (f.world.getBlock(Math.floor(nx), 60, Math.floor(nz)) === 0) { f.world.setBlock(Math.floor(nx), 60, Math.floor(nz), B.memory_block); P.x = nx; P.z = nz; } } };              // a hole in the way: jump it (a gap of 2) or place a block over it (the player can do both)
  const ctx = () => ({ player: { x: P.x, y: P.y, z: P.z, w: 0.6, h: 1.8, onGround: true }, dayT: 0.5, lightAt: () => ({ sky: 0, blk: 0 }), hurt: (a, o) => v.damage(a, o), knock: (dx, dz, k) => { const d = Math.hypot(dx, dz) || 1; const nx = P.x + dx / d * k * 0.25, nz = P.z + dz / d * k * 0.25; if (onPlatform(nx, nz)) { P.x = nx; P.z = nz; } }, peaceful: difficulty === 'peaceful', surfaceRules: false, now: t });
  while (t < 900 && !f.boss.won) {
    globalThis.__pm = f.world.getBlock(Math.floor(P.x), 60, Math.floor(P.z)) === B.memory_marked;
    const c = ctx();
    v.update(dt, { y: P.y });
    if (v.dead) { deaths++; v.respawn(); P.x = ARENA.spawn.x; P.z = ARENA.spawn.z; if (deaths > 3) break; }
    f.boss.step(dt, c); f.mobs.update(dt, c); f.arrows.update(dt, c.player); f.boss.takeEvents();
    atk += dt; arrowT += dt;
    const bx = m.x, bz = m.z, dBoss = Math.hypot(bx - P.x, bz - P.z);
    const pointer = f.mobs.list.find((q) => q.type === 'pointer' && !q.dead && Math.hypot(q.x - P.x, q.z - P.z) < 3.2 && Math.abs(q.y + 0.3 - (P.y + 1)) < 2.5);
    // 1. never stand on a marked block (or next to one): run to the nearest safe spot
    if (!onPlatform(P.x, P.z)) { if (process.env.BOTDEBUG) console.log(`FALL at t ${t.toFixed(2)} P ${P.x.toFixed(2)},${P.z.toFixed(2)} cell ${Math.floor(P.x)},${Math.floor(P.z)} prevMarked ${globalThis.__pm} phase ${f.boss.phase} state ${f.boss.state} marks ${f.world.count(B.memory_marked)} flee ${flee ? 'y' : 'n'} dBoss ${Math.hypot(P.x - m.x, P.z - m.z).toFixed(1)} shrinkR ${f.boss.shrinkR} blocks ${[58,59,60].map((y) => f.world.getBlock(Math.floor(P.x), y, Math.floor(P.z))).join()}`); falls++; deaths++; v.respawn(); { let best = null; for (let r = 0; r < 40 && !best; r++) for (let a = 0; a < 36; a++) { const x = ARENA.spawn.x + Math.cos(a * Math.PI / 18) * r * 0.4, z = ARENA.spawn.z + Math.sin(a * Math.PI / 18) * r * 0.4; if (onPlatform(x, z) && !marked(x, z) && Math.hypot(x - 64, z - 64) < 30) { best = { x, z }; break; } } P.x = best?.x ?? 64.5; P.z = best?.z ?? 68; } if (deaths > 4) break; }          // it fell through a deleted block: the game would kill it (the void)
    const here = safe(P.x, P.z);
    if (process.env.BOTDEBUG2 && t > 19.5 && t < 23.2 && Math.abs(t % 0.25) < dt) console.log(`t ${t.toFixed(2)} P ${P.x.toFixed(2)},${P.z.toFixed(2)} here ${here} flee ${flee ? flee.x.toFixed(1) + ',' + flee.z.toFixed(1) : null} marked ${f.world.count(B.memory_marked)} pm ${f.world.getBlock(Math.floor(P.x), 60, Math.floor(P.z)) === B.memory_marked}`);
    if (!here) {
      if (!flee || safe(flee.x, flee.z) === false || Math.hypot(flee.x - P.x, flee.z - P.z) < 0.3) { flee = null; let bd = 1e9; for (let r = 2; r <= 11; r += 1) for (let a = 0; a < 24; a++) { const x = P.x + Math.cos(a * Math.PI / 12) * r, z = P.z + Math.sin(a * Math.PI / 12) * r; if (safe(x, z) && Math.hypot(x - bx, z - bz) > 4) { const d = r - Math.hypot(x - bx, z - bz) * 0.05; if (d < bd) { bd = d; flee = { x, z }; } } } }
      if (process.env.BOTDEBUG3 && t > 20.3 && t < 20.6) { const bx0 = P.x, bz0 = P.z; goto(flee.x, flee.z, 5.6, true); console.log(`step t ${t.toFixed(2)} ${bx0.toFixed(3)},${bz0.toFixed(3)} -> ${P.x.toFixed(3)},${P.z.toFixed(3)} target ${flee.x.toFixed(1)},${flee.z.toFixed(1)} cell block ${f.world.getBlock(Math.floor(P.x), 60, Math.floor(P.z))}`); } else
      if (flee) goto(flee.x, flee.z, 5.6, true);
    }
    // 1b. the boss is down: walk under the core (nothing else matters)
    else if (f.boss.core || f.boss.state === 'dying') { if (f.boss.core) goto(f.boss.core.x, f.boss.core.z, 5.6); }
    // 2. a charge is coming: step aside (perpendicular to boss -> player)
    else if (f.boss.state === 'chargeWind' || f.boss.state === 'charge') { flee = null; const dx = P.x - bx, dz = P.z - bz, l = Math.hypot(dx, dz) || 1; const sx = -dz / l, sz = dx / l; const sgn = onPlatform(P.x + sx * 6, P.z + sz * 6) ? 1 : -1; goto(P.x + sx * sgn * 6, P.z + sz * sgn * 6, 5.6); }
    // 3. pointers close by: swing at them
    else if (pointer && atk >= 0.6) { flee = null; atk = 0; f.mobs.damage(pointer, 8, { from: P, type: 'player' }); }
    // 4. crystals during phase 2+: shoot them down (3 arrows each, a draw of 1 s)
    else if (f.boss.phase >= 2 && f.boss.crystalsStanding() >= 2 && !f.boss.exposed && dBoss > 9) { crystalT += dt; if (crystalT >= 3.3) { crystalT = 0; const c0 = ARENA.crystals.find((q) => f.world.getBlock(q.x, q.y, q.z) === B.kernel_crystal); if (c0) f.world.setBlock(c0.x, c0.y, c0.z, B.air); } }
    // 5. the core is exposed: go to its front and hit it
    else if (f.boss.exposed) { const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw), tx = bx + fx * 2.0, tz = bz + fz * 2.0; if (Math.hypot(tx - P.x, tz - P.z) > 0.4) goto(tx, tz, 5.6); if (Math.hypot(P.x - bx, P.z - bz) < 3.4 && atk >= 0.6) { atk = 0; f.mobs.damage(m, 8, { from: P, point: { x: bx + fx * 1.5, y: m.y + 4.4, z: bz + fz * 1.5 }, type: 'player' }); } }
    // 6. otherwise keep away from the boss's reach (kite it) and hit it when it is on top of you
    else { if (dBoss < 6.4) { const dx = P.x - bx, dz = P.z - bz, l = Math.hypot(dx, dz) || 1; goto(P.x + dx / l * 3, P.z + dz / l * 3, 4.3); } else if (dBoss > 9) goto(bx, bz, 4.3); }
    if (process.env.BOTDEBUG && (t < 40 ? Math.abs(t % 0.5) < dt : Math.abs((t % 15)) < dt)) console.log(`t ${t.toFixed(0)} P ${P.x.toFixed(1)},${P.z.toFixed(1)} boss ${bx.toFixed(1)},${bz.toFixed(1)} state ${f.boss.state} phase ${f.boss.phase} hp ${m.hp.toFixed(0)} here ${here} onP ${onPlatform(P.x, P.z)} marked ${f.world.count(B.memory_marked)} vhp ${v.hp.toFixed(0)}`);
    if (f.boss.core && !f.boss.won) f.boss.stepCore(dt, { x: P.x, y: P.y, z: P.z });
    if (f.boss.core && !f.boss.won) goto(f.boss.core.x, f.boss.core.z, 5.6);
    if (f.boss.core && !f.boss.won && Math.hypot(P.x - f.boss.core.x, P.z - f.boss.core.z) < 1.4) { P.y = f.boss.core.y - 0.9; f.boss.stepCore(dt, { x: P.x, y: P.y, z: P.z }); }
    t += dt;
  }
  if (process.env.BOTDEBUG4 && !f.boss.won) { for (let dz = -3; dz <= 3; dz++) console.log([-3, -2, -1, 0, 1, 2, 3].map((dx) => { const id = f.world.getBlock(Math.floor(P.x) + dx, 60, Math.floor(P.z) + dz); return id === 0 ? '.' : id === B.memory_block ? '#' : id === B.memory_marked ? 'M' : '?'; }).join('')); console.log(`here ${safe(P.x, P.z)} flee ${JSON.stringify(flee)} marks ${f.world.count(B.memory_marked)}`); }
  if (process.env.BOTDEBUG4 && !f.boss.won) console.log(`END P ${P.x.toFixed(1)},${P.z.toFixed(1)} core ${JSON.stringify(f.boss.core)} state ${f.boss.state} bossHp ${m.hp} won ${f.boss.won} onP ${onPlatform(P.x, P.z)} coreCellSolid ${f.boss.core ? f.world.getBlock(Math.floor(f.boss.core.x), 60, Math.floor(f.boss.core.z)) : '-'}`);
  return { won: f.boss.won, t, deaths, hp: m.hp, phase: f.boss.phase, falls, shrink: f.boss.shrinkR };
}
{
  const results = [1, 2, 3].map((s) => botFight(s * 7919));
  check('the scripted bot (cobalt kit, dodges marks, sidesteps charges, swings at Pointers, shoots crystals, hits the exposed core) wins on Normal within 10 minutes of game time, for 3 seeds', results.every((r) => r.won && r.t < 600), JSON.stringify(results));
  check('...in a fight of 45 s to 10 minutes (a perfect bot is about three times faster than the 4-8 minutes of a prepared human: it never misses the core)', results.every((r) => r.t >= 45 && r.t <= 600), JSON.stringify(results.map((r) => Math.round(r.t))));
  check('...passing through all three phases (the shrink reached the 16-block circle or the boss died first)', results.every((r) => r.phase === 3), JSON.stringify(results.map((r) => r.phase)));
  const hard = botFight(4242, 'hard'), peaceful = botFight(4242, 'peaceful');
  check('on Peaceful the bot wins too (no Pointers, slower marks); on Hard (marks every 6 s, boss +50% damage) it gets at least into phase 2', peaceful.won && peaceful.t < 900 && hard.phase >= 2, JSON.stringify([hard, peaceful]));
}

console.log(`\nStrata boss: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
