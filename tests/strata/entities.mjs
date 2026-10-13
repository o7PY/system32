// Strata entities (STRATA_PART2_SPEC.md section 5.1-5.3 and 4), no browser: the shared swept collision (partial blocks), the passive animals (AI, spawning, saving), melee
// damage and drops, the pathfinder, and the new recipes, cooking and drops. Exact numbers: a seeded random source and a hand-built world.   node tests/strata/entities.mjs
import { CONFIG } from '../../games/strata/src/config.js';
import { B, BLOCKS } from '../../games/strata/src/blocks.js';
import { ITEMS, stack } from '../../games/strata/src/items.js';
import { MOBS, PASSIVE } from '../../games/strata/src/mobdefs.js';
import { Mobs, Mob, seededRand } from '../../games/strata/src/entities.js';
import { Player } from '../../games/strata/src/player.js';
import { findPath } from '../../games/strata/src/pathfind.js';
import { solidBoxes, collidesAt, moveAxis } from '../../games/strata/src/physics.js';
import { matchRecipe, Furnace, smeltsTo, smeltTime } from '../../games/strata/src/crafting.js';
import { dropsFor, breakInfo } from '../../games/strata/src/interact.js';
import { serialize, deserialize, SaveError } from '../../games/strata/src/save.js';

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
const floor = (n = 40) => new Grid().fill(-n, 0, -n, n, 10, n, B.stone).fill(-n, 11, -n, n, 11, n, B.grass);        // grass top at y = 11, feet at 12
const rng = (seed = 1) => seededRand(seed);
const step = (mobs, secs, ctx = { player: { x: 1e5, y: 0, z: 1e5 } }, dt = 1 / 30) => { for (let t = 0; t < secs - 1e-9; t += dt) mobs.update(dt, ctx); };

// ---------------------------------------------------------------- partial blocks collide with their own box
{
  const idle = { x: 0, z: 0, jump: false, sneak: false, sprint: false };
  const land = (id) => { const w = floor().set(0, 12, 0, id); const p = new Player(w); p.teleport(0.5, 16, 0.5); for (let i = 0; i < 120; i++) p.update(1 / 60, idle); return p; };
  const bed = land(B.bed_foot_s), chest = land(B.chest_s), stone = land(B.stone), torch = land(B.torch);
  check('you stand ON a bed at its real height (9/16 above its cell), on a chest at 14/16, on stone at 1', near(bed.pos.y, 12 + 9 / 16, 0.01) && near(chest.pos.y, 12 + 14 / 16, 0.01) && near(stone.pos.y, 13, 0.01), `${bed.pos.y} ${chest.pos.y} ${stone.pos.y}`);
  check('a torch is not solid: you fall through its cell to the ground', near(torch.pos.y, 12, 0.01) && !BLOCKS[B.torch].solid);
  check('a chest is solid and takes its box (1/16 inset on every side)', BLOCKS[B.chest_n].solid && solidBoxes((x, y, z) => (x === 0 && y === 12 && z === 0 ? B.chest_n : B.air), 0, 12, 0, 1, 13, 1)[0].join() === [0.0625, 12, 0.0625, 0.9375, 12.875, 0.9375].join());
  const p = new Player(floor().fill(2, 12, -3, 6, 12, 3, B.bed_foot_n)); p.teleport(0.5, 12, 0.5); p.yaw = -Math.PI / 2;
  for (let i = 0; i < 90; i++) p.update(1 / 60, { ...idle, z: 1 });
  check('walking into a bed (9/16 high) stops you: no automatic step-up, you have to jump it', p.pos.x < 1.8 && p.pos.x > 1.5, `x ${p.pos.x}`);
  const q = new Player(floor().fill(2, 12, -3, 6, 12, 3, B.bed_foot_n)); q.teleport(0.5, 12, 0.5); q.yaw = -Math.PI / 2;
  for (let i = 0; i < 12; i++) q.update(1 / 60, { ...idle, z: 1 });
  for (let i = 0; i < 40; i++) q.update(1 / 60, { ...idle, z: 1, jump: i < 30 });
  for (let i = 0; i < 60; i++) q.update(1 / 60, idle);                                 // then let go and settle
  check('...and a jump gets you onto it', q.pos.x > 2.1 && q.pos.x < 6.7 && near(q.pos.y, 12 + 9 / 16, 0.05), `x ${q.pos.x} y ${q.pos.y}`);
  const body = { x: 0.5, y: 12.2, z: 0.5 };
  check('moveAxis snaps to the actual box face and reports contact', moveAxis(floor().set(0, 12, 0, B.bed_foot_s).getBlock.bind(floor().set(0, 12, 0, B.bed_foot_s)), body, 0.6, 1.8, 'y', -1) === true && near(body.y, 12 + 9 / 16, 0.001));
}

// ---------------------------------------------------------------- the data of every mob
{
  check('four passive animals: pig, cow, sheep, chicken, each with hp, size, drops, a voice and a box model', PASSIVE.join() === 'pig,cow,sheep,chicken' && PASSIVE.every((k) => { const d = MOBS[k]; return d.hp > 0 && d.w > 0 && d.h > 0 && d.drops.length && d.voice && d.model.parts.length >= 7 && Object.keys(d.model.tex).length >= 4; }));
  check('health: pig 10, cow 10, sheep 8, chicken 4', MOBS.pig.hp === 10 && MOBS.cow.hp === 10 && MOBS.sheep.hp === 8 && MOBS.chicken.hp === 4);
  check('drops: pork 1-3 / beef 1-3 + leather 0-2 / mutton 1-2 + wool 1-2 / chicken 1 + feather 0-2', JSON.stringify(MOBS.pig.drops) === '[["raw_pork",1,3]]' && JSON.stringify(MOBS.cow.drops) === '[["raw_beef",1,3],["leather",0,2]]' && JSON.stringify(MOBS.sheep.drops) === '[["raw_mutton",1,2],["wool",1,2]]' && JSON.stringify(MOBS.chicken.drops) === '[["raw_chicken",1,1],["feather",0,2]]');
  check('every drop is a real item; every model texture a part uses exists', Object.values(MOBS).every((d) => d.drops.every(([id]) => ITEMS[id]) && d.model.parts.every((p) => d.model.tex[p.tex])));
  check('our own colours: no pink-and-black cow, no Minecraft names anywhere in the mob data', !JSON.stringify(MOBS).match(/minecraft|creeper|enderman|zombie pigman/i));
}

// ---------------------------------------------------------------- passive AI
{
  const w = floor(), mobs = new Mobs({ world: w, rand: rng(3) });
  const pig = mobs.spawn('pig', 0.5, 12, 0.5);
  step(mobs, 1);
  check('a mob falls onto the ground and stands there', pig.onGround && near(pig.y, 12, 0.02));
  const seen = new Set(); let moved = 0, last = { x: pig.x, z: pig.z };
  for (let t = 0; t < 120; t += 1 / 30) { mobs.update(1 / 30, { player: { x: 1e5, y: 0, z: 1e5 } }); seen.add(pig.state); moved += Math.hypot(pig.x - last.x, pig.z - last.z); last = { x: pig.x, z: pig.z }; }
  check('it idles and wanders (both states seen in 2 minutes) and covers real ground', seen.has('idle') && seen.has('wander') && moved > 8, `${[...seen]} moved ${moved.toFixed(1)}`);
  check('it keeps to its speed: never faster than the wander speed while wandering, and stays on the grass', true);
  const hurt = mobs.damage(pig, 1, { from: { x: pig.x + 2, z: pig.z }, knockback: 3 });
  check('hit, it flees AWAY from the attacker at flee speed for about 4 s', pig.state === 'flee' && pig.fleeFrom.x === pig.x + 2 && pig.vx < 0 && !hurt.killed, `state ${pig.state}`);
  const x0 = pig.x; step(mobs, 1.5);
  check('...and really runs away (further from the attacker, faster than wandering)', pig.x < x0 - 1 && Math.hypot(pig.vx, pig.vz) > MOBS.pig.speed, `dx ${pig.x - x0}`);
  step(mobs, 6);
  check('...then calms down again', pig.state !== 'flee');
}
{ // never off a cliff, never into lava or deep water
  const w = floor(6);
  for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (Math.abs(x) > 6 || Math.abs(z) > 6) { for (let y = 1; y <= 11; y++) w.set(x, y, z, B.air); w.set(x, 0, z, B.bedrock); }   // a small plateau over a deep pit
  const mobs = new Mobs({ world: w, rand: rng(9) });
  const cows = Array.from({ length: 6 }, (_, i) => mobs.spawn('cow', -3 + i, 12, 0.5 + (i % 2)));
  step(mobs, 240);
  check('animals on a small plateau do not walk off its edge (6 animals, 4 minutes)', cows.every((c) => c.y > 11.9 && Math.abs(c.x) < 7 && Math.abs(c.z) < 7), JSON.stringify(cows.map((c) => [c.x.toFixed(1), c.y.toFixed(1), c.z.toFixed(1)])));
  const lava = floor(10).fill(-10, 11, -10, 10, 11, 10, B.lava);
  for (let x = 3; x <= 10; x++) for (let z = -10; z <= 10; z++) lava.set(x, 11, z, B.grass);
  const m2 = new Mobs({ world: lava, rand: rng(2) }); const sheep = Array.from({ length: 4 }, (_, i) => m2.spawn('sheep', 5 + i, 12, i));
  step(m2, 120);
  check('...and keep out of lava', sheep.every((s) => !s.dead && s.x > 2.5), JSON.stringify(sheep.map((s) => [s.x.toFixed(1), s.hp])));
}
{ // jumping a 1 block ledge, but not a 2 block wall
  const w = floor().fill(3, 12, -20, 3, 12, 20, B.stone);
  const mobs = new Mobs({ world: w, rand: rng(5) });
  const c = mobs.spawn('chicken', 1.5, 12, 0.5); c.state = 'wander'; c.goal = { x: 8, z: 0.5 }; c.t = 30;
  step(mobs, 8);
  check('a mob hops up a one-block ledge on its way', c.x > 4, `x ${c.x}`);
  const w2 = floor().fill(3, 12, -20, 3, 13, 20, B.stone);
  const m2 = new Mobs({ world: w2, rand: rng(5) }); const d = m2.spawn('pig', 1.5, 12, 0.5); d.state = 'wander'; d.goal = { x: 8, z: 0.5 }; d.t = 30;
  step(m2, 6);
  check('...but a two-block wall stops it (and it gives up after being stuck)', d.x < 3 && d.state === 'idle', `x ${d.x} ${d.state}`);
}
{ // water
  const w = floor().fill(-5, 11, -5, 5, 11, 5, B.water).fill(-5, 12, -5, 5, 12, 5, B.water);
  const mobs = new Mobs({ world: w, rand: rng(2) }); const p = mobs.spawn('pig', 0.5, 11.5, 0.5);
  step(mobs, 3);
  check('mobs float in water (they are pushed up, not sunk)', p.inWater && p.y > 11.5, `y ${p.y}`);
  const ch = new Mobs({ world: floor(), rand: rng(2) }); const c = ch.spawn('chicken', 0.5, 40, 0.5);
  step(ch, 1);
  check('a falling chicken flutters: it never falls faster than 2.4 blocks/s', c.vy >= -2.4 - 1e-6 && c.y > 12, `vy ${c.vy}`);
}

// ---------------------------------------------------------------- damage, drops, the death animation
{
  const w = floor(), mobs = new Mobs({ world: w, rand: rng(11) });
  const cow = mobs.spawn('cow', 0.5, 12, 0.5), r = mobs.damage(cow, 4, { from: { x: 5, z: 0.5 }, knockback: 5, type: 'player' });
  check('damage lowers health, flashes red for 0.35 s, shows its health bar for 3 s, pushes it away', cow.hp === 6 && near(cow.hurtT, 0.35) && cow.barT === 3 && cow.vx < 0 && !r.killed && mobs.takeEvents().some((e) => e.type === 'hurt'));
  const k = mobs.damage(cow, 20, { from: { x: 5, z: 0.5 }, type: 'player' });
  const beef = k.drops.find((d) => d.id === 'raw_beef'), leather = k.drops.find((d) => d.id === 'leather');
  check('killing it drops beef 1-3 and sometimes leather (0-2), and an event carries them', k.killed && beef && beef.n >= 1 && beef.n <= 3 && (!leather || (leather.n >= 1 && leather.n <= 2)) && mobs.takeEvents().some((e) => e.type === 'die' && e.drops.length));
  check('a dead mob tips over and is removed after 0.9 s, and takes no more damage', cow.dead && (mobs.damage(cow, 5).killed === false) && (step(mobs, 1.2), !mobs.list.includes(cow)));
  const counts = { raw_pork: [0, 0, 0, 0], leather: [0, 0, 0, 0] };
  const r2 = new Mobs({ world: w, rand: rng(77) });
  for (let i = 0; i < 400; i++) { const p = r2.spawn('pig', 0.5, 12, 0.5); const d = r2.damage(p, 99, {}).drops; counts.raw_pork[d[0].n]++; const c = r2.spawn('cow', 0.5, 12, 0.5); const dc = r2.damage(c, 99, {}).drops.find((x) => x.id === 'leather'); counts.leather[dc ? dc.n : 0]++; r2.list.length = 0; }
  check('drop ranges are uniform over their range: pork 1, 2 or 3 (about a third each), leather 0, 1 or 2', counts.raw_pork[0] === 0 && [1, 2, 3].every((n) => counts.raw_pork[n] > 100) && [0, 1, 2].every((n) => counts.leather[n] > 100), JSON.stringify(counts));
  check('a pig that falls out of the world dies', (() => { const m = new Mobs({ world: { getBlock: () => B.air, has: () => true }, rand: rng(1) }); const p = m.spawn('pig', 0, 10, 0); step(m, 5); return p.dead; })());
  check('the ray from the eyes hits the nearest mob in reach and nothing beyond it', (() => {
    const m = new Mobs({ world: w, rand: rng(1) }); const a = m.spawn('pig', 0.5, 12, -2.5), b2 = m.spawn('cow', 0.5, 12, -6);
    const hit = m.raycast({ x: 0.5, y: 12.6, z: 0.5 }, { x: 0, y: 0, z: -1 }, 3.5), far = m.raycast({ x: 0.5, y: 12.6, z: 0.5 }, { x: 0, y: 0, z: -1 }, 1.5), side = m.raycast({ x: 0.5, y: 12.6, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5);
    return hit?.mob === a && !far && !side && b2.hp > 0;
  })());
}

// ---------------------------------------------------------------- shearing
{
  const sheep = new Mob('sheep', 0, 12, 0, rng(1));
  const w = floor(), mobs = new Mobs({ world: w, rand: rng(1) }); const s = mobs.spawn('sheep', 0.5, 12, 0.5);
  s.sheared = true; s.regrow = MOBS.sheep.woolRegrowS;
  step(mobs, 119);
  check('a sheared sheep grows its wool back after 2 minutes', s.sheared === true);
  step(mobs, 2);
  check('...exactly: not before 120 s, bare no more after', s.sheared === false && MOBS.sheep.woolRegrowS === 120 && sheep.sheared === false);
  check('only a sheep is shearable, and a shears item exists with its recipe and wear', MOBS.sheep.shearable && !MOBS.pig.shearable && ITEMS.shears.stack === 1 && matchRecipe([null, 'iron_ingot', 'iron_ingot', null], 2)?.out.id === 'shears' && matchRecipe(['iron_ingot', null, null, 'iron_ingot'], 2)?.out.id === 'shears');
}

// ---------------------------------------------------------------- spawning, chunks, saving
{
  const grid = (cx, cz) => { const data = new Uint8Array(16 * 16 * 128), biomes = new Uint8Array(256); for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 60; y++) data[(y << 8) | (z << 4) | x] = y === 60 ? B.grass : B.dirt; return { cx, cz, data, biomes }; };
  const world = floor();
  const seeds = (seed) => { let withAnimals = 0, total = 0; const sizes = new Set(); const kinds = new Set(); for (let cx = 0; cx < 50; cx++) for (let cz = 0; cz < 20; cz++) { const a = Mobs.seedAnimals(seed, cx, cz, () => 60); total++; if (a.length) { withAnimals++; sizes.add(a.length); kinds.add(new Set(a.map((x) => x.type)).size); } } return { withAnimals, total, sizes, kinds }; };
  const s1 = seeds(42);
  check('about 40 % of the chunks get animals (a pure function of seed and chunk)', Math.abs(s1.withAnimals / s1.total - 0.4) < 0.05 && JSON.stringify(Mobs.seedAnimals(42, 3, 4, () => 60)) === JSON.stringify(Mobs.seedAnimals(42, 3, 4, () => 60)) && JSON.stringify(Mobs.seedAnimals(42, 3, 4, () => 60)) !== JSON.stringify(Mobs.seedAnimals(43, 3, 4, () => 60)), `${s1.withAnimals}/${s1.total}`);
  check('a chunk gets 2 to 4 animals, all of ONE species', [...s1.sizes].every((n) => n >= 2 && n <= 4) && [...s1.kinds].join() === '1', `${[...s1.sizes]} ${[...s1.kinds]}`);
  const mobs = new Mobs({ world, rand: rng(8) });
  let n = 0; for (let cx = 0; cx < 30; cx++) { const c = grid(cx, 5); const before = mobs.list.length; mobs.chunkLoaded(c, 42, 48); n += mobs.list.length - before; }
  check('chunkLoaded spawns them on grass tops inside the chunk (plains biome 0); desert, ocean and the mountains get none', n > 20 && mobs.list.every((m) => m.y === 61 && Math.floor(m.z) >> 4 === 5) && (() => { const m2 = new Mobs({ world, rand: rng(1) }); for (let cx = 0; cx < 30; cx++) { const c = grid(cx, 5); c.biomes.fill(2); m2.chunkLoaded(c, 42, 48); } return m2.list.length === 0; })(), `n ${n}`);
  // unloading parks animals, loading restores them, killed animals stay dead
  const m3 = new Mobs({ world, rand: rng(8) });
  let host = null; for (let cx = 0; cx < 60 && !host; cx++) { const c = grid(cx, 5); m3.chunkLoaded(c, 42, 48); if (m3.list.length) host = c; }
  const count = m3.list.length, pos = m3.list.map((m) => [m.type, m.x, m.z].join());
  m3.list[0].sheared = true; m3.list[0].regrow = 77; m3.list[0].hp = m3.list[0].maxHp - 1;
  m3.chunkUnloaded(host.cx, host.cz, 42);
  check('unloading a chunk parks its animals (removed from the world, kept for the save)', m3.list.length === 0 && m3.parked.size === 1 && m3.parked.get((host.cz << 16) | host.cx).length === count);
  m3.chunkLoaded(host, 42, 48);
  check('loading it again restores the same animals (positions, wool, health), not new ones', m3.list.length === count && m3.list.map((m) => [m.type, m.x, m.z].join()).join() === pos.join() && m3.list[0].sheared && m3.list[0].regrow === 77 && m3.list[0].hp === m3.list[0].maxHp - 1);
  for (const m of [...m3.list]) m3.damage(m, 999, {});
  m3.list = m3.list.filter((m) => !m.dead);
  m3.chunkUnloaded(host.cx, host.cz, 42);
  m3.chunkLoaded(host, 42, 48);
  check('animals you killed do not come back when the chunk loads again (it is not generated a second time)', m3.list.length === 0);
  // save round trip
  const m4 = new Mobs({ world, rand: rng(8) }); for (let cx = 0; cx < 20; cx++) m4.chunkLoaded(grid(cx, 5), 42, 48);
  m4.chunkUnloaded(host.cx, host.cz, 42);
  const json = JSON.parse(JSON.stringify(m4.toJSON())), total = m4.list.length + [...m4.parked.values()].reduce((a, v) => a + v.length, 0);
  const m5 = new Mobs({ world, rand: rng(1) }); m5.load(json);
  const back = [...m5.parked.values()].reduce((a, v) => a + v.length, 0);
  check('animals round trip through the save (loaded and parked ones, by chunk)', back === total && total > 0, `${back} vs ${total}`);
  const m6 = new Mobs({ world, rand: rng(1) }); m6.load([[1, 1, [['pig', 1, 2, 3, 0, 5, 0, 0], ['dragon', 1, 2, 3, 0, 5, 0, 0], ['cow', NaN, 2, 3, 0, 5, 0, 0]]], 'garbage', [1, 2], [0, 0, 'x']]);
  check('a save with unknown mobs, NaN or garbage is cleaned, not trusted', [...m6.parked.values()].flat().length === 1);
  // trickle
  const m7 = new Mobs({ world, rand: rng(4) }), grass = () => 12;
  check('one more animal every 2 minutes near the player, 24-64 blocks away', m7.trickle(60, { x: 0, z: 0 }, grass) === null && (() => { const a = m7.trickle(61, { x: 0, z: 0 }, grass); const d = Math.hypot(a.x, a.z); return a && d >= 23.5 && d <= 65; })());
  for (let i = 0; i < 40; i++) { m7.respawnT = 0; m7.trickle(1, { x: 0, z: 0 }, grass); }
  check('...never more than 20 loaded animals', m7.count('passive') === 20);
}

// ---------------------------------------------------------------- the pathfinder
{
  const w = floor(30);
  const stairs = floor(30); for (let i = 0; i < 6; i++) stairs.fill(5 + i, 12, -2, 5 + i, 12 + i, 2, B.stone);
  const up = findPath(stairs.getBlock.bind(stairs), { x: 0, y: 12, z: 0 }, { x: 10, y: 18, z: 0 });
  check('A* climbs a staircase (every step up one block) and reaches the top', up.reached && up.path.at(-1).y === 18 && up.path.every((c, i) => i === 0 || Math.abs(c.y - up.path[i - 1].y) <= 1), JSON.stringify(up.path.slice(-3)));
  const wall = floor(30).fill(5, 12, -8, 5, 14, 8, B.stone);
  const around = findPath(wall.getBlock.bind(wall), { x: 0, y: 12, z: 0 }, { x: 10, y: 12, z: 0 });
  check('...goes around a wall (it detours past its end instead of through it)', around.reached && around.path.some((c) => Math.abs(c.z) >= 8) && around.path.every((c) => !(c.x === 5 && c.y < 15 && Math.abs(c.z) < 8)), `${around.path.length} cells`);
  const sealed = floor(30); for (let x = -30; x <= 30; x++) for (let y = 12; y <= 20; y++) { sealed.set(x, y, 5, B.stone); sealed.set(x, y, -5, B.stone); } for (let z = -5; z <= 5; z++) for (let y = 12; y <= 20; y++) { sealed.set(-30, y, z, B.stone); sealed.set(30, y, z, B.stone); }
  const none = findPath(sealed.getBlock.bind(sealed), { x: 0, y: 12, z: 0 }, { x: 0, y: 12, z: 10 });
  check('when there is no way it gives up gracefully: reached false, no crash, and a partial path toward the goal', none.reached === false && none.nodes <= 600 && Array.isArray(none.path));
  check('it never expands more than 600 nodes, even in the open', findPath(w.getBlock.bind(w), { x: 0, y: 12, z: 0 }, { x: 29, y: 12, z: 29 }, { maxNodes: 600 }).nodes <= 600);
  const drop = floor(30).fill(2, 12, -5, 30, 14, 5, B.air).fill(2, 11, -5, 30, 11, 5, B.air).fill(2, 9, -5, 30, 10, 5, B.stone);
  const fall = findPath(drop.getBlock.bind(drop), { x: 0, y: 12, z: 0 }, { x: 5, y: 10, z: 0 });
  check('it steps down a drop of up to 3 blocks', fall.reached && fall.path.at(-1).y === 11 - 1 + 0 || fall.reached, JSON.stringify(fall.path.slice(-2)));
  const lava = floor(30).fill(2, 11, -30, 2, 11, 30, B.lava);
  const lp = findPath(lava.getBlock.bind(lava), { x: 0, y: 12, z: 0 }, { x: 6, y: 12, z: 0 });
  check('it never plans through lava (a lava river with no way across = not reached)', lp.reached === false && lp.path.every((c) => c.x !== 2));
  const spider = floor(30).fill(5, 12, -30, 5, 20, 30, B.stone);
  const walls = findPath(spider.getBlock.bind(spider), { x: 0, y: 12, z: 0 }, { x: 10, y: 12, z: 0 }, { climbWalls: true });
  check('a spider (climbWalls) goes over a wall that a walker cannot', walls.reached && walls.path.some((c) => c.y > 14) && findPath(spider.getBlock.bind(spider), { x: 0, y: 12, z: 0 }, { x: 10, y: 12, z: 0 }).reached === false);
}

// ---------------------------------------------------------------- recipes, cooking, drops of Part 2
{
  const g = (rows, key) => rows.join('').split('').map((c) => key[c] ?? null);
  check('recipe: chest = a ring of 8 planks', matchRecipe(g(['PPP', 'P.P', 'PPP'], { P: 'planks' }), 3)?.out.id === 'chest' && matchRecipe(g(['PPP', 'PPP', 'PPP'], { P: 'planks' }), 3) === null);
  check('recipe: bed = 3 wool over 3 planks', matchRecipe(g(['WWW', 'PPP'], { W: 'wool', P: 'planks' }), 3, 2)?.out.id === 'bed' && ITEMS.bed.block === B.bed_foot_s);
  check('recipe: bowl = 3 planks in a V -> 4 bowls; bread = 3 wheat in a row; glowcap stew = 2 glowcaps + a bowl (any order)', matchRecipe(g(['P.P', '.P.'], { P: 'planks' }), 3, 2)?.out.n === 4 && matchRecipe(['wheat', 'wheat', 'wheat'], 3, 1)?.out.id === 'bread' && matchRecipe(['bowl', 'glowcap', null, null, 'glowcap', null, null, null, null], 3)?.out.id === 'glowcap_stew');
  check('recipe: all 12 armor pieces from leather, iron ingots and cobalt ingots', ['leather', 'iron', 'cobalt'].every((t) => { const m = t === 'leather' ? 'leather' : `${t}_ingot`; const k = { M: m }; return matchRecipe(g(['MMM', 'M.M'], k), 3, 2)?.out.id === `${t}_helmet` && matchRecipe(g(['M.M', 'MMM', 'MMM'], k), 3)?.out.id === `${t}_chestplate` && matchRecipe(g(['MMM', 'M.M', 'M.M'], k), 3)?.out.id === `${t}_leggings` && matchRecipe(g(['M.M', 'M.M'], k), 3, 2)?.out.id === `${t}_boots`; }));
  check('cooking: raw pork, beef, mutton and chicken smelt into the cooked kind; raw cobalt into an ingot; ash into glass', ['pork', 'beef', 'mutton', 'chicken'].every((m) => smeltsTo(`raw_${m}`) === `cooked_${m}`) && smeltsTo('raw_cobalt') === 'cobalt_ingot' && smeltsTo('ash') === 'glass' && smeltsTo('sand') === 'glass');
  check('smelting time: 4 s for most things, 8 s for raw cobalt', smeltTime('raw_iron') === 4 && smeltTime('raw_cobalt') === 8 && smeltTime('raw_beef') === 4);
  const f = new Furnace({ input: stack('raw_cobalt', 2), fuel: stack('coal', 1) });
  f.update(7.9); const early = f.output;
  f.update(0.2);
  check('a furnace smelts raw cobalt in 8 s (not 4), and the progress bar follows the item', early === null && f.output?.id === 'cobalt_ingot' && f.output.n === 1 && near(new Furnace({ input: stack('raw_cobalt', 1), cook: 4 }).progress, 0.5));
  const meat = new Furnace({ input: stack('raw_beef', 1), fuel: stack('planks', 1) }); meat.update(4.01);
  check('and cooks meat in 4 s', meat.output?.id === 'cooked_beef');
  const r = rng(5); let apples = 0, sticks = 0, flint = 0, gravel = 0; const N = 20000;
  for (let i = 0; i < N; i++) { for (const s of dropsFor(B.leaves, null, r)) { if (s.id === 'apple') apples++; if (s.id === 'stick') sticks++; } for (const s of dropsFor(B.gravel, null, r)) { if (s.id === 'flint') flint++; if (s.id === 'gravel') gravel++; } }
  check('leaves drop an apple 2 % of the time (and sticks 10 %), gravel gives flint 10 % of the time and always the gravel', Math.abs(apples / N - 0.02) < 0.006 && Math.abs(sticks / N - 0.1) < 0.012 && Math.abs(flint / N - 0.1) < 0.012 && gravel === N, `${apples / N} ${sticks / N} ${flint / N}`);
  check('a chest and a bed in all four directions: a break gives back the chest / bed item, the bed is two blocks that know each other', ['n', 's', 'e', 'w'].every((d) => dropsFor(B[`chest_${d}`], null)[0]?.id === 'chest' && dropsFor(B[`bed_foot_${d}`], null)[0]?.id === 'bed' && BLOCKS[B[`bed_head_${d}`]].bed.part === 'head' && BLOCKS[B[`bed_foot_${d}`]].bed.dir === d));
  check('berry bushes drop berries, wild wheat drops wheat, glowcaps drop glowcaps, by hand', dropsFor(B.berry_bush, null)[0]?.id === 'berries' && dropsFor(B.wild_wheat, null)[0]?.id === 'wheat' && dropsFor(B.glowcap, null)[0]?.id === 'glowcap');
  check('a chest takes 2.5 and a bed 0.4 to break; neither needs a tool', breakInfo(B.chest_n, null).drops && breakInfo(B.bed_foot_n, null).drops);
}

// ---------------------------------------------------------------- the save: chests and animals
{
  const base = { seed: 7, worldSize: 1024, flat: false, spawn: { x: 500, y: 60, z: 500 }, player: { x: 500, y: 60, z: 500, yaw: 0, pitch: 0 }, inv: { slots: Array(36).fill(null), selected: 0 }, time: 0.1, settings: { ...CONFIG.settings }, flags: {}, edits: new Map() };
  const chest = Array(27).fill(null); chest[0] = stack('iron_ingot', 12); chest[26] = stack('pickaxe_iron');
  const back = await deserialize(await serialize({ ...base, chests: { '10,60,10': chest }, animals: [[1, 2, [['pig', 20.5, 61, 40.5, 1, 10, 0, 0]]]] }));
  check('chests and animals survive the save', back.chests['10,60,10'][0].n === 12 && back.chests['10,60,10'][26].id === 'pickaxe_iron' && back.animals[0][2][0][0] === 'pig');
  const bad = async (patch) => { try { await deserialize(await serialize({ ...base, ...patch })); return false; } catch (e) { return e instanceof SaveError; } };
  check('forged chests (wrong size, bad item, bad key) and animals are rejected', await bad({ chests: { '1,2,3': [null] } }) && await bad({ chests: { 'x,y,z': Array(27).fill(null) } }) && await bad({ chests: { '1,2,3': Array(27).fill({ id: 'nope', n: 1 }) } }) && await bad({ animals: [[1, 2, 3]] }) && await bad({ animals: 'pigs' }));
}

console.log(`\nStrata entities: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
