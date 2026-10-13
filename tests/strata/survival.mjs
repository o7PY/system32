// Strata survival rules (STRATA_PART2_SPEC.md section 2), no browser: health, hunger, air, armor, every damage source, eating, death and the keep-inventory rule,
// death piles, and the save fields. Exact numbers: the Vitals class has no clock of its own.   node tests/strata/survival.mjs
import { CONFIG } from '../../games/strata/src/config.js';
import { B } from '../../games/strata/src/blocks.js';
import { ITEMS, stack } from '../../games/strata/src/items.js';
import { Vitals, Hold, keepsInventoryOnDeath, scoreText, DIFFICULTIES } from '../../games/strata/src/survival.js';
import { Player } from '../../games/strata/src/player.js';
import { Drops } from '../../games/strata/src/interact.js';
import { serialize, deserialize, SaveError } from '../../games/strata/src/save.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const S = CONFIG.survival;
/** Advance a Vitals for `secs` seconds in steps of 1/20 s with the same env every step. */
const run = (v, secs, env = {}, dt = 0.05) => { const ev = []; for (let t = 0; t < secs - 1e-9; t += dt) ev.push(...v.update(Math.min(dt, secs - t), env)); return ev; };
/** A player who is not regenerating (hunger 10): damage tests then see exactly the damage. */
const hurtable = () => { const v = new Vitals(); v.hunger = 10; return v; };
const set = (tier) => ['helmet', 'chestplate', 'leggings', 'boots'].map((p) => stack(`${tier}_${p}`));

// ---------------------------------------------------------------- the basics
{
  const v = new Vitals();
  check('20 HP (10 hearts), 20 hunger (10 icons), 10 bubbles of air to start', v.hp === 20 && v.hunger === 20 && v.air === 10 && S.maxHp === 20);
  check('half-heart steps: 1 HP is half a heart (damage 1 leaves 19)', v.damage(1) === 1 && v.hp === 19);
}

// ---------------------------------------------------------------- fall damage
{
  const table = [[0, 0], [2, 0], [3.5, 0], [4.4, 0], [4.5, 1], [5.5, 2], [10.5, 7], [20.5, 17]];
  const bad = table.filter(([dist, hp]) => { const v = new Vitals(); v.update(0.05, { fall: dist }); return 20 - v.hp !== hp; });
  check('fall damage: nothing up to 3.5 blocks, then 1 HP per block beyond (4.5 -> 1, 10.5 -> 7, 20.5 -> 17)', bad.length === 0, JSON.stringify(bad));
  const v = new Vitals(); v.update(0.05, { fall: 30 });
  check('a long fall kills with "Fell from a high place"', v.dead && v.causeText === 'Fell from a high place' && v.deaths === 1);
  // the real physics: drop from a measured height and read the distance
  class Grid { constructor() { this.m = new Map(); } set(x, y, z, id) { this.m.set(`${x},${y},${z}`, id); return this; } fill(x0, y0, z0, x1, y1, z1, id) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id); return this; } getBlock(x, y, z) { return this.m.get(`${x},${y},${z}`) ?? B.air; } }
  const idle = { x: 0, z: 0, jump: false, sneak: false, sprint: false };
  const drop = (world, h) => { const p = new Player(world); p.teleport(0.5, 11 + h, 0.5); for (let i = 0; i < 600; i++) p.update(1 / 60, idle); return { p, fall: p.takeFall() }; };
  const floor = () => new Grid().fill(-10, 0, -10, 10, 10, 10, B.stone);
  const a = drop(floor(), 10), b = drop(floor(), 2);
  check('the Player reports the length of a fall (10 blocks down = 10, 2 blocks = 2) and clears it on read', near(a.fall, 10, 0.05) && near(b.fall, 2, 0.05) && a.p.takeFall() === 0, `${a.fall} ${b.fall}`);
  const water = floor().fill(-10, 11, -10, 10, 13, 10, B.water);
  const w = drop(water, 15);
  check('landing in water ends the fall at once: no distance reported', w.fall === 0 && w.p.inWater);
  const lava = floor().fill(-10, 11, -10, 10, 12, 10, B.lava);
  const l = drop(lava, 15);
  check('lava is swum in like water (no fall damage either) and the Player knows it is in lava', l.fall === 0 && l.p.inLava);
  const j = new Player(floor()); j.teleport(0.5, 11, 0.5); j.update(1 / 60, idle); j.update(1 / 60, { ...idle, jump: true });
  check('a jump sets the jumped flag (hunger counts it)', j.jumped === true);
  const solidHead = new Player(floor().fill(-3, 11, -3, 3, 14, 3, B.stone)); solidHead.teleport(0.5, 12, 0.5); solidHead.update(1 / 60, idle);
  check('a head inside an opaque block is flagged (suffocation)', solidHead.headInSolid === true && a.p.headInSolid === false);
}

// ---------------------------------------------------------------- drowning
{
  const v = hurtable();
  run(v, 7.5, { headInWater: true });
  check('air: 1 bubble per 1.5 s underwater (5 bubbles gone after 7.5 s)', near(v.air, 5, 0.06));
  run(v, 7.5, { headInWater: true });
  check('after 15 s the air is gone and nothing hurt yet', v.air < 0.05 && v.hp === 20);
  const ev = run(v, 1.05, { headInWater: true });
  check('then 2 HP per second: after the first second HP 18', v.hp === 18 && ev.filter((e) => e.type === 'drowning').length === 1, `hp ${v.hp}`);
  run(v, 4, { headInWater: true });
  check('...16 after the next, 10 after 4 more', v.hp === 10, `hp ${v.hp}`);
  run(v, 5, { headInWater: true });
  check('...and it kills with "Drowned"', v.dead && v.causeText === 'Drowned');
  const u = hurtable(); run(u, 9, { headInWater: true }); run(u, 1, {});
  check('coming up refills the air quickly (5 bubbles a second)', u.air > 4 && run(u, 1, {}) && u.air === 10);
  const a = hurtable(); a.armor = set('cobalt'); run(a, 16.1, { headInWater: true });
  check('armor reduces drowning damage like any other (cobalt: 2 HP becomes 0.4)', near(20 - a.hp, 0.4, 0.01), `hp ${a.hp}`);
}

// ---------------------------------------------------------------- lava, fire, void, suffocation
{
  const v = hurtable();
  run(v, 0.5, { inLava: true });
  check('lava: 4 HP every 0.5 s', v.hp === 16, `hp ${v.hp}`);
  run(v, 0.5, { inLava: true });
  check('...so 8 HP in a second, plus the first tick of burning (1 HP): 11', v.hp === 11, `hp ${v.hp}`);
  const f = hurtable(); run(f, 0.5, { inLava: true }); const hp0 = f.hp; run(f, 3.05, {});
  check('and 3 s of burning at 1 HP/s after leaving the lava', f.hp === hp0 - 3 && f.burn === 0, `hp ${f.hp} (from ${hp0}), burn ${f.burn}`);
  const w = hurtable(); run(w, 0.5, { inLava: true }); run(w, 1.0, { inWater: true });
  check('water puts the fire out at once', w.burn === 0 && w.hp === 16);
  const d = hurtable(); run(d, 3.1, { inLava: true });
  check('standing in lava kills: "Tried to swim in lava"', d.dead && /lava/i.test(d.causeText), d.causeText);
  const vv = hurtable(); vv.armor = set('cobalt'); vv.update(0.05, { y: -31 }); const alive = !vv.dead; vv.update(0.05, { y: -33 });
  check('the void kills instantly below y = -32, through full cobalt armor ("Fell out of the world")', alive && vv.dead && vv.causeText === 'Fell out of the world');
  const s = hurtable(); s.armor = set('cobalt'); run(s, 3.05, { headInSolid: true });
  check('suffocation: 1 HP per second, armor does not help (cobalt: still 3 HP in 3 s)', s.hp === 17, `hp ${s.hp}`);
  const k = hurtable(); run(k, 25, { headInSolid: true });
  check('...and it kills ("Suffocated in a wall")', k.dead && k.causeText === 'Suffocated in a wall');
}

// ---------------------------------------------------------------- hunger
{
  const v = new Vitals(); run(v, 4, { sprintM: 0 }); v.addExhaustion(0);
  const sp = new Vitals(); for (let i = 0; i < 100; i++) sp.update(0.1, { sprintM: 0.4 });          // 40 m sprinted
  check('sprinting costs 0.1 exhaustion per metre: 40 m = 4 = one hunger point', sp.hunger === 19 && near(sp.exhaustion, 0, 1e-9), `hunger ${sp.hunger} ex ${sp.exhaustion}`);
  const jp = new Vitals(); for (let i = 0; i < 80; i++) jp.update(0.05, { jumped: true });
  check('jumping costs 0.05: 80 jumps = one hunger point', jp.hunger === 19);
  const mn = new Vitals(); mn.update(0.05, { mined: 800 });
  check('mining costs 0.005 a block: 800 blocks = one hunger point', mn.hunger === 19);
  const hd = new Vitals(); hd.difficulty = 'hard'; for (let i = 0; i < 100; i++) hd.update(0.1, { sprintM: 0.4 });
  check('Hard: hunger drains 1.3 times as fast (40 m sprinted = 5.2 exhaustion)', hd.hunger === 19 && near(hd.exhaustion, 1.2, 1e-9), `ex ${hd.exhaustion}`);
  const pe = new Vitals(); pe.difficulty = 'peaceful'; for (let i = 0; i < 400; i++) pe.update(0.1, { sprintM: 1, jumped: true });
  check('Peaceful: hunger never drains', pe.hunger === 20);
  check('hunger 6 or less: cannot sprint; 7 can', (() => { const a = new Vitals(); a.hunger = 6; const b = new Vitals(); b.hunger = 7; return !a.canSprint && b.canSprint; })());
  const dm = new Vitals(); dm.damage(1); check('taking damage costs 0.1 exhaustion', near(dm.exhaustion, 0.1, 1e-9));
}

// ---------------------------------------------------------------- starvation and regeneration
{
  const n = new Vitals(); n.hunger = 0; run(n, 4.05);
  check('hunger 0: starvation takes 1 HP every 4 s', n.hp === 19);
  run(n, 200);
  check('on Normal starvation stops at 1 HP and never kills', n.hp === 1 && !n.dead);
  const h = new Vitals(); h.difficulty = 'hard'; h.hunger = 0; run(h, 100);
  check('on Hard it kills ("Starved to death")', h.dead && h.causeText === 'Starved to death');
  const p = new Vitals(); p.difficulty = 'peaceful'; p.hunger = 0; run(p, 100);
  check('Peaceful has no starvation', p.hp === 20 && !p.dead);
  const r = new Vitals(); r.hp = 10; r.hunger = 17; run(r, 6.05);
  check('regeneration: with hunger 16 or more, 1 HP every 3 s', r.hp === 12, `hp ${r.hp}`);
  const lo = new Vitals(); lo.hp = 10; lo.hunger = 15; run(lo, 30);
  check('...no regeneration below 16 hunger', lo.hp === 10);
  const c = new Vitals(); c.hp = 4; c.hunger = 18; run(c, 24.05);
  check('each regenerated HP costs 1.5 exhaustion (8 HP = 12 exhaustion, paid in hunger points of 4)', c.hp === 12 && near((18 - c.hunger) * 4 + c.exhaustion, 12, 1e-6), `hp ${c.hp} hunger ${c.hunger} ex ${c.exhaustion}`);
  const fast = new Vitals(); fast.hp = 10; fast.hunger = 18; fast.eat('cooked_beef');
  check('eating to full hunger gives 20 s of fast regeneration: 1 HP per second, and it is cheap enough to last the whole 20 s', fast.hunger === 20 && (() => { run(fast, 5.05); return fast.hp === 15; })() && (() => { run(fast, 5.05); return fast.hp === 20 && fast.hunger >= 19; })());
  const plain = new Vitals(); plain.hp = 10; run(plain, 5.05);
  check('...while a full stomach that was not just fed regenerates every 3 s', plain.hp === 11);
}

// ---------------------------------------------------------------- eating
{
  const h = new Hold(CONFIG.eatS);
  check('eating takes 1.6 s of holding: not done at 1.55 s, done at 1.6 s, reported once', !h.update(1.55) && h.update(0.05) && h.update(0.01) && h.done && CONFIG.eatS === 1.6);
  const rows = [['berries', 2], ['apple', 4], ['raw_pork', 3], ['raw_mutton', 2], ['cooked_beef', 8], ['cooked_chicken', 6], ['bread', 5], ['glowcap_stew', 6], ['rotten_flesh', 4]];
  const bad = rows.filter(([id, hunger]) => { const v = new Vitals(); v.hunger = 0; v.eat(id); return v.hunger !== hunger; });
  check('food table: berries 2, apple 4, raw meat 2-3, cooked 6-8, bread 5, glowcap stew 6, rotten flesh 4', bad.length === 0, JSON.stringify(bad));
  const f = new Vitals(); f.hunger = 18; check('hunger never goes above 20 and eat() says how much it gave', f.eat('cooked_beef') === 2 && f.hunger === 20);
  const rot = new Vitals(); check('rotten flesh: 30 % chance of nausea (a roll of 0.2 makes you sick, 0.5 does not)', (rot.eat('rotten_flesh', () => 0.2), rot.nausea > 0) && (() => { const q = new Vitals(); q.eat('rotten_flesh', () => 0.5); return q.nausea === 0; })());
  check('glowcap stew gives the bowl back', ITEMS.glowcap_stew.food.returns === 'bowl' && ITEMS.glowcap_stew.food.hunger === 6);
}

// ---------------------------------------------------------------- armor
{
  const pts = (tier) => { const v = new Vitals(); v.armor = set(tier); return v.armorPoints; };
  check('armor points per full set: leather 7, iron 15, cobalt 20', pts('leather') === 7 && pts('iron') === 15 && pts('cobalt') === 20);
  const dmg = (tier, base = 10, o = {}) => { const v = new Vitals(); v.armor = tier ? set(tier) : []; if (o.difficulty) v.difficulty = o.difficulty; v.armor = tier ? set(tier) : [null, null, null, null]; return v.damage(base, { type: o.type ?? 'mob' }); };
  check('damage reduction = points x 4 %: leather 28 %, iron 60 %, cobalt 80 %', near(dmg('leather'), 7.2) && near(dmg('iron'), 4) && near(dmg('cobalt'), 2) && near(dmg(null), 10));
  const v = new Vitals(); v.armor = set('cobalt'); v.armor.push(...[]);
  check('the reduction is capped at 80 %', (() => { const x = new Vitals(); x.armor = set('cobalt'); return near(x.armorFactor, 0.2) && S.armorMax === 0.8; })());
  check('Hard: mobs do 50 % more before the armor (4 damage, cobalt: 4 x 1.5 x 0.2 = 1.2); falls and lava are not increased', near(dmg('cobalt', 4, { difficulty: 'hard' }), 1.2) && near(dmg(null, 6, { difficulty: 'hard', type: 'fall' }), 6));
  const nodef = new Vitals(); nodef.armor = set('iron');
  check('void, starvation and suffocation ignore armor (iron: full 3 damage)', (() => { const a = new Vitals(); a.armor = set('iron'); a.damage(3, { type: 'suffocation' }); const b = new Vitals(); b.armor = set('iron'); b.hunger = 0; b.difficulty = 'hard'; b.damage(3, { type: 'starvation' }); return a.hp === 17 && b.hp === 17; })());
  const w = new Vitals(); w.armor = set('leather'); const d0 = w.armor[0].dur;
  w.damage(1, { type: 'mob' });
  check('every hit wears each piece by 1', w.armor.every((s, i) => s.dur === ITEMS[s.id].armor.durability - 1) && d0 === ITEMS.leather_helmet.armor.durability);
  const br = new Vitals(); br.armor = [{ ...stack('iron_helmet'), dur: 1 }, null, null, null]; br.damage(1, { type: 'mob' });
  check('a piece at durability 1 breaks on the next hit (the slot empties)', br.armor[0] === null);
  const a2 = new Vitals(); a2.armor = set('iron'); const pointsBefore = a2.armorPoints; a2.armor[1] = null;
  check('a missing piece counts nothing (iron without the chestplate = 9)', pointsBefore === 15 && a2.armorPoints === 9);
}

// ---------------------------------------------------------------- invulnerability, feedback, death
{
  const v = new Vitals();
  const a = v.damage(3, { type: 'mob' }), b = v.damage(3, { type: 'mob' });
  check('0.5 s of invulnerability after a hit: a second hit right away does nothing', a === 3 && b === 0 && v.hp === 17);
  v.update(0.51, {});
  check('...and it applies again after 0.5 s', v.damage(3, { type: 'mob' }) === 3 && v.hp === 14);
  check('every applied hit counts (the HUD flash, tilt and sound key off hitCount)', v.hitCount === 2);
  const dir = new Vitals(); dir.damage(2, { type: 'mob', from: { x: 5, z: 1 } });
  check('the direction of a hit is remembered for the camera tilt', dir.hurtDir.x === 5 && dir.hurtT > 0);
  const m = new Vitals(); m.damage(40, { type: 'mob', name: 'a Shambler' });
  check('death text from a mob: "Was slain by a Shambler"', m.dead && m.causeText === 'Was slain by a Shambler');
  const bs = new Vitals(); bs.damage(40, { type: 'boss' });
  check('death text from the boss: "Was deleted by the Garbage Collector"', bs.causeText === 'Was deleted by the Garbage Collector');
  const dd = new Vitals(); dd.damage(40, { type: 'fall' }); const hp = dd.hp; dd.damage(5, { type: 'mob' });
  check('a dead player takes no more damage and counts one death', hp === 0 && dd.deaths === 1 && dd.hp === 0);
  dd.respawn();
  check('respawn: full health, hunger and air, nothing burning, the death counter stays', dd.hp === 20 && dd.hunger === 20 && dd.air === 10 && !dd.dead && dd.deaths === 1 && dd.burn === 0);
  check('the death screen score line: blocks mined and time survived', (() => { const x = new Vitals(); x.stats.mined = 12; x.stats.timeS = 125; return scoreText(x.stats) === 'Blocks mined: 12   Time survived: 2:05'; })());
}

// ---------------------------------------------------------------- keep inventory, difficulty
{
  check('dying keeps the inventory only with the setting on, and always in the Kernel', !keepsInventoryOnDeath({ keepInventory: false }, 'overworld') && keepsInventoryOnDeath({ keepInventory: true }, 'overworld') && keepsInventoryOnDeath({ keepInventory: false }, 'kernel') && !keepsInventoryOnDeath({}, 'underlayer'));
  check('three difficulties: peaceful, normal, hard', JSON.stringify(DIFFICULTIES) === JSON.stringify(['peaceful', 'normal', 'hard']));
}

// ---------------------------------------------------------------- death pile
{
  let loaded = true;
  const world = { has: () => loaded, getBlock: (x, y) => (y <= 50 ? B.stone : B.air) };           // a floor at y 50
  const dr = new Drops(world);
  const far = { x: 1e6, y: 0, z: 1e6 };
  dr.spawn(5, 52, 5, stack('cobblestone', 8), { vx: 0, vy: 0, vz: 0, delayS: 0, ttl: S.deathDropS, death: true });
  dr.spawn(6, 52, 5, stack('dirt', 3), { vx: 0, vy: 0, vz: 0, delayS: 0 });
  for (let t = 0; t < 301; t += 0.05) dr.update(0.05, far, () => null);
  check('an ordinary drop lasts 5 minutes; the death pile is still there (it lasts 10)', dr.list.length === 1 && dr.list[0].death === true);
  loaded = false;
  for (let t = 0; t < 5000; t += 1) dr.update(1, far, () => null);       // unloaded: the update skips the drop entirely, however coarse the step
  check('while its chunk is unloaded nothing ages: the pile is still there after 5000 s', dr.list.length === 1 && dr.list[0].age < 302);
  loaded = true;
  const saved = dr.toJSON(); const copy = new Drops(world); copy.load(JSON.parse(JSON.stringify(saved)));
  check('the pile is saved and loaded with its age, lifetime and the death flag', copy.list.length === 1 && copy.list[0].death && copy.list[0].ttl === S.deathDropS && Math.abs(copy.list[0].age - dr.list[0].age) <= 1);
  for (let t = 0; t < 301; t += 0.05) dr.update(0.05, far, () => null);
  check('after 10 minutes of game time the pile despawns', dr.list.length === 0);
  const m = new Drops(world); m.spawn(0, 52, 0, stack('stone', 40), { vx: 0, vy: 0, vz: 0, delayS: 0, death: true }); m.spawn(0, 52, 0, stack('stone', 20), { vx: 0, vy: 0, vz: 0, delayS: 0 });
  m.update(0.1, far, () => null);
  check('a pile never merges with ordinary drops of the same item', m.list.length === 2);
  const garbage = new Drops(world); garbage.load([{ x: 1, y: 2, z: 3, stack: { id: 'nope', n: 1 } }, { x: 1, y: 2, z: 3, stack: { id: 'stone', n: -4 } }, null, { x: 1, y: 2, z: 3, stack: { id: 'stone', n: 2 } }]);
  check('loading drops skips garbage entries', garbage.list.length === 1 && garbage.list[0].stack.n === 2);
}

// ---------------------------------------------------------------- the save
{
  const base = { seed: 7, worldSize: 1024, flat: false, spawn: { x: 500, y: 60, z: 500 }, player: { x: 500, y: 60, z: 500, yaw: 0, pitch: 0 }, inv: { slots: Array(36).fill(null), selected: 0 }, time: 0.1, settings: { ...CONFIG.settings }, flags: {}, edits: new Map() };
  const v = new Vitals(); v.hp = 7; v.hunger = 11; v.air = 4; v.armor = set('iron'); v.deaths = 3; v.stats = { mined: 55, mobs: 4, timeS: 321 };
  const dr = new Drops({ has: () => true }); dr.spawn(1, 2, 3, stack('stone', 5), { vx: 0, vy: 0, vz: 0, ttl: 600, death: true });
  const str = await serialize({ ...base, vitals: v.toJSON(), drops: dr.toJSON() });
  const back = await deserialize(str);
  const w = new Vitals().load(back.vitals);
  check('save round trip: health, hunger, air, armor with its wear, deaths, stats and the dropped pile come back', w.hp === 7 && w.hunger === 11 && w.air === 4 && w.armor[1].id === 'iron_chestplate' && w.deaths === 3 && w.stats.mined === 55 && back.drops.length === 1 && back.drops[0].death === true);
  check('an old save without any of it (a Part 1 world) loads with full health and Normal difficulty', await (async () => { const old = await deserialize(await serialize(base)); const x = new Vitals().load(old.vitals); return x.hp === 20 && x.hunger === 20 && old.settings.difficulty === 'normal' && old.drops.length === 0; })());
  const bad = async (patch) => { try { await deserialize(await serialize({ ...base, ...patch })); return false; } catch (e) { return e instanceof SaveError; } };
  check('forged vitals and drops are rejected', await bad({ vitals: { armor: [{ id: 'iron_helmet', n: 1, dur: 99999 }] } }) && await bad({ drops: [{ x: 1, y: 2, z: 3, stack: { id: 'stone', n: 999 } }] }) && await bad({ settings: { ...CONFIG.settings, difficulty: 'nightmare' } }));
  const g = new Vitals().load({ hp: NaN, hunger: -4, air: 'x', armor: [null, null], difficulty: 'bogus', deaths: -2 });
  check('Vitals.load clamps garbage instead of trusting it (and never loads a dead player: at least 1 HP)', g.hp === 20 && g.hunger === 0 && g.air === 10 && g.difficulty === 'normal' && g.deaths === 0 && new Vitals().load({ hp: 0 }).hp === 1);
}

console.log(`\nStrata survival: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
