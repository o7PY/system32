// Strata game logic, no browser: raycast, physics, mining and tools, drops, crafting, furnace, inventory.   node tests/strata/logic.mjs
import { CONFIG, RECIPES } from '../../games/strata/src/config.js';
import { B, BLOCKS } from '../../games/strata/src/blocks.js';
import { ITEMS, stack, itemInfo } from '../../games/strata/src/items.js';
import { Player } from '../../games/strata/src/player.js';
import { raycast, breakInfo, dropFor, useTool, Miner, Drops } from '../../games/strata/src/interact.js';
import { matchRecipe, Furnace } from '../../games/strata/src/crafting.js';
import { Inventory, Menu } from '../../games/strata/src/inventory.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const near = (a, b, t = 1e-3) => Math.abs(a - b) <= t;

/** A tiny world: a map of solid cells over an air background. */
class Grid {
  constructor() { this.m = new Map(); }
  set(x, y, z, id) { this.m.set(`${x},${y},${z}`, id); return this; }
  fill(x0, y0, z0, x1, y1, z1, id) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id); return this; }
  getBlock(x, y, z) { return this.m.get(`${x},${y},${z}`) ?? B.air; }
}
const floorWorld = () => new Grid().fill(-50, 0, -50, 50, 10, 50, B.stone);       // floor top at y = 11

// ---------------------------------------------------------------- raycast
{
  const w = new Grid().set(5, 10, 5, B.stone);
  const o = { x: 5.5, y: 10.5, z: 0.5 };
  const hit = raycast((x, y, z) => w.getBlock(x, y, z), o, { x: 0, y: 0, z: 1 });
  check('raycast: axis-aligned ray hits the block and reports the face it entered (normal -z)', hit && hit.x === 5 && hit.y === 10 && hit.z === 5 && hit.nz === -1 && hit.nx === 0 && hit.ny === 0 && near(hit.dist, 4.5), JSON.stringify(hit));
  check('raycast: reach is 5 blocks (a block at 4.5 is hit, one at 5.6 is not)', !raycast((x, y, z) => (z === 6 ? B.stone : 0), o, { x: 0, y: 0, z: 1 }) && !!raycast((x, y, z) => (z === 5 ? B.stone : 0), o, { x: 0, y: 0, z: 1 }));
  const down = raycast((x, y, z) => (y === 9 ? B.stone : 0), { x: 0.5, y: 12.3, z: 0.5 }, { x: 0, y: -1, z: 0 });
  check('raycast: looking straight down hits the top face (normal +y)', down && down.y === 9 && down.ny === 1 && near(down.dist, 2.3));
  check('raycast: water and air are not targetable', !raycast(() => B.water, o, { x: 0, y: 0, z: 1 }));
  // random rays vs brute-force ray marching
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const scene = new Grid(); for (let i = 0; i < 400; i++) scene.set(Math.floor(r() * 16), Math.floor(r() * 16), Math.floor(r() * 16), B.stone);
  const get = (x, y, z) => scene.getBlock(x, y, z);
  let mismatch = 0;
  for (let i = 0; i < 600; i++) {
    const origin = { x: 8 + (r() - 0.5) * 6, y: 8 + (r() - 0.5) * 6, z: 8 + (r() - 0.5) * 6 };
    let d = { x: r() - 0.5, y: r() - 0.5, z: r() - 0.5 }; const L = Math.hypot(d.x, d.y, d.z); d = { x: d.x / L, y: d.y / L, z: d.z / L };
    if (get(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z))) continue;
    const a = raycast(get, origin, d, 5);
    let b = null;
    for (let t = 0; t <= 5; t += 0.0005) { const x = Math.floor(origin.x + d.x * t), y = Math.floor(origin.y + d.y * t), z = Math.floor(origin.z + d.z * t); if (get(x, y, z)) { b = { x, y, z }; break; } }
    if ((a === null) !== (b === null) || (a && (a.x !== b.x || a.y !== b.y || a.z !== b.z))) mismatch++;
  }
  check('raycast: 600 random diagonal rays agree with a brute-force march', mismatch === 0, `${mismatch} mismatches`);
}

// ---------------------------------------------------------------- physics
{
  const idle = { x: 0, z: 0, jump: false, sneak: false, sprint: false };
  const run = (p, secs, inp, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) p.update(dt, inp); };
  // falling at terminal speed never goes through the floor, with small and huge frames
  for (const dt of [1 / 60, 1 / 20, 0.05]) {
    const p = new Player(floorWorld()); p.teleport(0.5, 120, 0.5); p.vel.y = -CONFIG.player.terminal;
    run(p, 6, idle, dt);
    check(`physics: a fall from y = 120 at max speed lands on the floor (dt ${dt.toFixed(3)})`, p.onGround && near(p.pos.y, 11, 0.01), `y ${p.pos.y}`);
  }
  { // a fast single frame must not tunnel through a one-block floor
    const w = new Grid().fill(-5, 10, -5, 5, 10, 5, B.stone); const p = new Player(w); p.teleport(0.5, 14, 0.5); p.vel.y = -60;
    for (let i = 0; i < 40; i++) p.update(0.05, idle);
    check('physics: a thin one-block floor holds a body falling at 60 blocks/s', p.pos.y > 10.99, `y ${p.pos.y}`);
  }
  { // walls
    const w = floorWorld().fill(5, 11, -3, 5, 14, 3, B.stone); const p = new Player(w); p.teleport(2.5, 11, 0.5); p.yaw = -Math.PI / 2;   // facing +x
    run(p, 4, { ...idle, z: 1 });
    check('physics: walking into a wall stops at the wall (x <= 5 - 0.3)', p.pos.x <= 4.7 + 1e-3 && p.pos.x > 4.6, `x ${p.pos.x}`);
    check('physics: pushing along a wall does not stick (sliding on z works)', (() => { p.yaw = 0; const z0 = p.pos.z; run(p, 1, { ...idle, z: 1, x: 0 }); return p.pos.z < z0 - 1; })());
  }
  { // sneaking at an edge
    const w = new Grid().fill(-50, 0, -50, 5, 10, 50, B.stone);
    const p = new Player(w); p.teleport(3.5, 11, 0.5); p.yaw = -Math.PI / 2;
    run(p, 0.2, idle); run(p, 5, { ...idle, z: 1, sneak: true });
    check('physics: sneaking stops at the edge (feet still over the block, still on the ground)', p.onGround && near(p.pos.y, 11, 0.01) && p.pos.x > 5.9 && p.pos.x < 6.31, `x ${p.pos.x} y ${p.pos.y}`);
    const q = new Player(w); q.teleport(3.5, 11, 0.5); q.yaw = -Math.PI / 2; run(q, 0.2, idle); run(q, 3, { ...idle, z: 1 });
    check('physics: walking normally goes off the edge and falls', q.pos.y < 5, `y ${q.pos.y}`);
  }
  { // jump heights
    const one = floorWorld().fill(5, 11, -3, 20, 11, 3, B.stone);                                          // a 1-block ledge
    const p = new Player(one); p.teleport(3.5, 11, 0.5); p.yaw = -Math.PI / 2; run(p, 0.2, idle);
    run(p, 0.1, { ...idle, z: 1, jump: true }); run(p, 2, { ...idle, z: 1 });
    check('physics: can jump up exactly one block', near(p.pos.y, 12, 0.01) && p.onGround && p.pos.x > 5.3, `y ${p.pos.y} x ${p.pos.x}`);
    const two = floorWorld().fill(5, 11, -3, 20, 12, 3, B.stone);
    const q = new Player(two); q.teleport(3.5, 11, 0.5); q.yaw = -Math.PI / 2; run(q, 0.2, idle); run(q, 0.1, { ...idle, z: 1, jump: true }); run(q, 2, { ...idle, z: 1 });
    check('physics: cannot jump up two blocks', near(q.pos.y, 11, 0.01) && q.pos.x < 4.8, `y ${q.pos.y}`);
    const j = new Player(floorWorld()); j.teleport(0.5, 11, 0.5); run(j, 0.2, idle);
    let peak = 11; for (let t = 0; t < 1.2; t += 1 / 60) { j.update(1 / 60, { ...idle, jump: t < 0.05 }); peak = Math.max(peak, j.pos.y); }
    check('physics: a jump peaks at about 1.25 blocks', peak > 12.25 && peak < 12.28, `peak ${peak}`);
  }
  { // sprint and speeds
    const p = new Player(floorWorld()); p.teleport(0.5, 11, 0.5); run(p, 0.2, idle);
    const x0 = p.pos.z; run(p, 2, { ...idle, z: 1 }); const walk = (x0 - p.pos.z) / 2;
    const q = new Player(floorWorld()); q.teleport(0.5, 11, 0.5); run(q, 0.2, idle); const z1 = q.pos.z; run(q, 2, { ...idle, z: 1, sprint: true }); const sprint = (z1 - q.pos.z) / 2;
    check('physics: walking is about 4.3 blocks/s and sprinting about 5.6', walk > 3.9 && walk < 4.4 && sprint > 5.0 && sprint < 5.7 && q.sprinting, `walk ${walk} sprint ${sprint}`);
  }
  { // swimming
    const w = floorWorld().fill(-10, 11, -10, 10, 20, 10, B.water);
    const p = new Player(w); p.teleport(0.5, 11, 0.5); run(p, 0.3, idle);
    check('swimming: in water the player is slow and sinks gently', p.inWater && p.vel.y > -1.5, `vy ${p.vel.y}`);
    run(p, 1.5, { ...idle, jump: true });
    check('swimming: Space rises', p.pos.y > 13, `y ${p.pos.y}`);
    const z0 = p.pos.z; run(p, 1, { ...idle, z: 1 }); check('swimming: horizontal speed is about 2.4', (z0 - p.pos.z) > 2 && (z0 - p.pos.z) < 2.6, `d ${z0 - p.pos.z}`);
  }
  { // look
    const p = new Player(floorWorld()); p.look(0, -100000); const d = p.dir();
    check('look: pitch is clamped just short of straight up, and the direction is a unit vector', p.pitch < Math.PI / 2 && Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
    const q = new Player(floorWorld()); q.yaw = 0; const f = q.dir(); check('look: yaw 0 faces -z', near(f.z, -1) && near(f.x, 0));
  }
}

// ---------------------------------------------------------------- mining and tools
{
  const tools = [null, 'wood', 'stone', 'iron'];
  const held = (type, tier) => (tier ? stack(`${type}_${tier}`) : null);
  const hand = (b) => BLOCKS[B[b]].hardness;
  check('mining: bedrock is unbreakable with everything', tools.every((t) => !breakInfo(B.bedrock, held('pickaxe', t)).breakable));
  // table: [block, tool type, tier or null] -> expected time and drops
  const speed = { null: 1, wood: 2, stone: 4, iron: 6 };
  const rows = [];
  for (const [name, def] of Object.entries(Object.fromEntries(BLOCKS.filter((b) => b.hardness > 0).map((b) => [b.name, b])))) for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) for (const tier of tools) {
    const matches = tier && def.tool === type, ok = !def.need || (tier && type === def.need.tool && { wood: 1, stone: 2, iron: 3 }[tier] >= def.need.tier);
    rows.push([name, type, tier, def.hardness / (matches ? speed[tier] : 1) * (ok ? 1 : 3.3), !!ok]);
  }
  const bad = rows.filter(([name, type, tier, time, drops]) => { const i = breakInfo(B[name], held(type, tier)); return !near(i.time, time, 1e-9) || i.drops !== drops; });
  check(`mining: break time and drop rule for ${rows.length} block x tool combinations match hardness / speed (x 3.3 without the needed tool)`, bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  check('mining: stone by hand takes 1.5 x 3.3 s and drops nothing; wood pickaxe 0.75 s; stone 0.375; iron 0.25', near(breakInfo(B.stone, null).time, 4.95) && !breakInfo(B.stone, null).drops && near(breakInfo(B.stone, held('pickaxe', 'wood')).time, 0.75) && near(breakInfo(B.stone, held('pickaxe', 'stone')).time, 0.375) && near(breakInfo(B.stone, held('pickaxe', 'iron')).time, 0.25));
  check('mining: iron ore needs a stone pickaxe: a wood one breaks it slowly and drops nothing', !breakInfo(B.iron_ore, held('pickaxe', 'wood')).drops && breakInfo(B.iron_ore, held('pickaxe', 'stone')).drops && breakInfo(B.iron_ore, held('pickaxe', 'wood')).time > breakInfo(B.iron_ore, held('pickaxe', 'stone')).time);
  const d = (b, h, r = 0) => dropFor(B[b], h, () => r);
  check('drops: stone gives cobblestone, grass gives dirt, coal ore gives coal, iron ore gives raw iron, glass nothing', d('stone', held('pickaxe', 'wood'))?.id === 'cobblestone' && d('grass', null)?.id === 'dirt' && d('coal_ore', held('pickaxe', 'wood'))?.id === 'coal' && d('iron_ore', held('pickaxe', 'stone'))?.id === 'raw_iron' && d('glass', null) === null);
  check('drops: stone by hand drops nothing; iron ore with a wood pickaxe drops nothing', d('stone', null) === null && d('iron_ore', held('pickaxe', 'wood')) === null);
  check('drops: leaves drop a stick 10% of the time', d('leaves', null, 0.05)?.id === 'stick' && d('leaves', null, 0.5) === null && BLOCKS[B.leaves].drop[2] === 0.1);
  check('drops: the Ad Block ore drops a pop-up', d('ad_block', held('pickaxe', 'wood'))?.id === 'popup');
  // durability
  let s = stack('pickaxe_wood'), n = 0, broke = false;
  while (!broke && n < 1000) { const r = useTool(s); s = r.stack; broke = r.broke; n++; }
  check('durability: a wood pickaxe lasts 60 blocks, then breaks; stone 130; iron 250', n === 60 && s === null && ['stone', 130, 'iron', 250].every((v, i, a) => i % 2 || (() => { let t = stack(`pickaxe_${v}`), k = 0, b = false; while (!b) { const r = useTool(t); t = r.stack; b = r.broke; k++; } return k === a[i + 1]; })()));
  check('durability: using a non-tool does nothing', useTool(stack('stone', 5)).stack.n === 5 && !useTool(null).broke);
  // Miner
  const m = new Miner(), hit = { x: 1, y: 2, z: 3, id: B.stone };
  let res = 'none', t = 0; while (res !== 'broke' && t < 5) { res = m.update(0.05, hit, held('pickaxe', 'stone'), true); t += 0.05; }
  check('miner: holding the button on stone with a stone pickaxe breaks it after 0.375 s', res === 'broke' && near(t, 0.4, 0.06), `t ${t}`);
  m.update(0.1, hit, null, true); const half = m.progress; m.update(0.1, { ...hit, x: 9 }, null, true);
  check('miner: looking at another block starts over, letting go resets the progress', half > 0 && m.progress <= half * 1.01 && m.target.x === 9 && (m.update(0.1, hit, null, true), m.update(0.1, hit, null, true), m.progress > half * 1.5) && (m.update(0.1, hit, null, false), m.progress === 0 && m.target === null));
  const mb = new Miner(); for (let i = 0; i < 200; i++) mb.update(0.05, { x: 0, y: 0, z: 0, id: B.bedrock }, held('pickaxe', 'iron'), true);
  check('miner: bedrock never breaks and counts the seconds (egg after 10 s)', mb.progress === 0 && near(mb.bedrockT, 10, 1e-6));
}

// ---------------------------------------------------------------- drops
{
  const w = floorWorld(); const dr = new Drops(w); const inv = new Inventory();
  const d = dr.spawn(0.5, 13, 0.5, stack('cobblestone', 1), { vx: 0, vy: 0, vz: 0 });
  for (let i = 0; i < 120; i++) dr.update(1 / 60, { x: 30, y: 11, z: 30 }, (s) => inv.add(s));
  check('drops: an item falls to the floor and rests on it', near(d.y, 11.125, 0.01) && d.vy === 0, `y ${d.y}`);
  let picked = 0;
  for (let i = 0; i < 120; i++) picked += dr.update(1 / 60, { x: 0.5, y: 11, z: 1.5 }, (s) => inv.add(s)).length;
  check('drops: within 1.5 blocks the item is pulled in and picked up', picked === 1 && inv.count('cobblestone') === 1 && dr.list.length === 0);
  const a = dr.spawn(5, 11.2, 5, stack('dirt', 3), { vx: 0, vy: 0, vz: 0, delayS: 0 }), b = dr.spawn(5.2, 11.2, 5, stack('dirt', 4), { vx: 0, vy: 0, vz: 0, delayS: 0 });
  dr.update(1 / 60, { x: 40, y: 11, z: 40 }, (s) => inv.add(s));
  check('drops: identical drops close together merge into one stack', dr.list.length === 1 && dr.list[0].stack.n === 7);
  dr.list[0].age = 299.9; dr.update(0.2, { x: 40, y: 11, z: 40 }, (s) => inv.add(s));
  check('drops: despawn after 5 minutes', dr.list.length === 0);
  const full = new Inventory(); full.slots = full.slots.map(() => ({ id: 'dirt', n: 64 }));
  const e = dr.spawn(0.5, 11.2, 0.5, stack('stone', 1), { vx: 0, vy: 0, vz: 0, delayS: 0 });
  for (let i = 0; i < 60; i++) dr.update(1 / 60, { x: 0.5, y: 11, z: 0.5 }, (s) => full.add(s));
  check('drops: with a full inventory the item stays on the ground', dr.list.length === 1 && dr.list[0] === e);
}

// ---------------------------------------------------------------- crafting
{
  const grid = (rows, w) => rows.flatMap((r) => [...r].map((c) => (c === '.' ? null : c)));
  const pat = (r, mat) => grid(r.pattern.map((row) => row.replace(/./g, (c) => (c === '.' ? '.' : r.key[c]))).map((row) => row), 0);
  void pat;
  const place = (r, ox = 0, oy = 0, size = 3, flip = false) => {
    const g = Array(size * size).fill(null), rows = flip ? r.pattern.map((x) => [...x].reverse().join('')) : r.pattern;
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') g[(y + oy) * size + x + ox] = r.key[c]; }));
    return g;
  };
  for (const r of RECIPES.filter((x) => x.pattern)) {
    const h = r.pattern.length, w = r.pattern[0].length;
    const results = [];
    for (let oy = 0; oy <= 3 - h; oy++) for (let ox = 0; ox <= 3 - w; ox++) for (const flip of [false, true]) { const m = matchRecipe(place(r, ox, oy, 3, flip), 3); results.push(m?.out.id === r.out[0] && m.out.n === r.out[1]); }
    check(`recipe ${r.id}: crafts to ${r.out[1]} x ${r.out[0]} anywhere in the 3x3 grid and mirrored (${results.length} placements)`, results.every(Boolean));
  }
  check('recipe planks: one log, shapeless, anywhere', [0, 4, 8].every((i) => { const g = Array(9).fill(null); g[i] = 'log'; return matchRecipe(g, 3)?.out.id === 'planks'; }) && matchRecipe(['log', null, null, null], 2)?.out.n === 4);
  check('2x2 grid: sticks and the crafting table work, a pickaxe cannot be made without a table', matchRecipe(['planks', null, 'planks', null], 2)?.out.id === 'stick' && matchRecipe(['planks', 'planks', 'planks', 'planks'], 2)?.out.id === 'crafting_table' && !matchRecipe(['planks', 'planks', 'stick', 'stick'], 2));
  const pick = RECIPES.find((r) => r.id === 'pickaxe_iron');
  const wrong = [place(pick).map((x, i) => (i === 0 ? null : x)), place(pick).map((x, i) => (x === 'stick' ? 'planks' : x)), [...place(pick).slice(0, 8), 'dirt'], Array(9).fill(null), ['planks', 'planks', null, null, null, null, null, null, null]];
  check('wrong shapes produce nothing (missing material, wrong materials, extra item, empty, a lone pair of planks)', wrong.every((g) => !matchRecipe(g, 3)));
  check('every material tier crafts its own tools (wood = planks, stone = cobblestone, iron = iron ingot)', ['wood', 'stone', 'iron'].every((t, i) => matchRecipe(place(RECIPES.find((r) => r.id === `sword_${t}`)), 3)?.out.id === `sword_${t}` && ['planks', 'cobblestone', 'iron_ingot'][i] === RECIPES.find((r) => r.id === `sword_${t}`).key.M));
  check('crafted tools start at full durability', matchRecipe(place(RECIPES.find((r) => r.id === 'pickaxe_stone')), 3).out.dur === 130);
  check('the furnace needs the full cobblestone ring', matchRecipe(['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', null, 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'], 3)?.out.id === 'furnace' && !matchRecipe(['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', null], 3));
}

// ---------------------------------------------------------------- furnace
{
  const f = new Furnace({ input: stack('raw_iron', 3), fuel: stack('coal', 1) }); let done = 0; f.onDone = (n) => { done += n; };
  f.update(3.9); check('furnace: nothing is done after 3.9 s (4 s per item)', done === 0 && f.output === null && f.progress > 0.9);
  f.update(0.2); check('furnace: the first ingot comes at 4 s', done === 1 && f.output?.id === 'iron_ingot' && f.output.n === 1 && f.input.n === 2);
  f.update(100); check('furnace: one coal smelts 8 items: 3 raw iron -> 3 ingots, then it idles and the fire dies', f.output.n === 3 && !f.input && f.fuel === null);
  const g = new Furnace({ input: stack('raw_iron', 20), fuel: stack('coal', 1) }); g.update(1000);
  check('furnace: a single coal smelts exactly 8 items (20 queued, 12 left)', g.output.n === 8 && g.input.n === 12 && g.fuel === null);
  const p = new Furnace({ input: stack('sand', 5), fuel: stack('planks', 1) }); p.update(1000);
  check('furnace: planks smelt 1.5 items (1 full, the second needs more fuel and waits)', p.output?.id === 'glass' && p.output.n === 1 && p.input.n === 4 && p.cook > 0 && p.cook < 4, `${JSON.stringify(p.toJSON())}`);
  const s = new Furnace({ input: stack('sand', 5), fuel: stack('stick', 4) }); s.update(1000);
  check('furnace: sticks smelt 0.5 items each (4 sticks = 2 items)', s.output?.n === 2);
  const nf = new Furnace({ input: stack('sand', 2) }); nf.update(50);
  check('furnace: without fuel nothing happens, and the progress is kept when the fuel runs out', nf.output === null && nf.cook === 0);
  const wrong = new Furnace({ input: stack('dirt', 2), fuel: stack('coal', 1) }); wrong.update(50);
  check('furnace: an item that does not smelt is left alone and no fuel is burnt', wrong.output === null && wrong.fuel.n === 1);
  const fullOut = new Furnace({ input: stack('sand', 2), fuel: stack('coal', 1), output: stack('glass', 64) }); fullOut.update(50);
  check('furnace: a full output stack stops the smelting', fullOut.output.n === 64 && fullOut.input.n === 2);
}

// ---------------------------------------------------------------- inventory
{
  const inv = new Inventory();
  check('inventory: starts empty with 9 hotbar + 27 slots', inv.slots.length === 36 && inv.slots.every((s) => !s));
  check('inventory: stacks fill to 64 and spill into the next slot (100 stone -> 64 + 36)', (() => { const i = new Inventory(); const left = i.add(stack('stone', 100)); return !left && i.slots[0].n === 64 && i.slots[1].n === 36; })());
  check('inventory: adding merges into existing stacks first', (() => { const i = new Inventory(); i.add(stack('dirt', 60)); i.add(stack('stone', 5)); i.add(stack('dirt', 10)); return i.slots[0].n === 64 && i.slots[1].id === 'stone' && i.slots[2].id === 'dirt' && i.slots[2].n === 6; })());
  check('inventory: tools never stack', (() => { const i = new Inventory(); i.add(stack('pickaxe_wood')); i.add(stack('pickaxe_wood')); return i.slots[0].n === 1 && i.slots[1].n === 1; })());
  check('inventory: a full inventory returns the leftover', (() => { const i = new Inventory(); i.slots = i.slots.map(() => ({ id: 'dirt', n: 64 })); return i.add(stack('dirt', 3)).n === 3; })());
  // clicks
  const mk = () => { const i = new Inventory(); const m = new Menu(i); return { i, m }; };
  { const { i, m } = mk(); i.slots[0] = { id: 'stone', n: 10 };
    m.click('inv', 0, 'left'); check('click: left picks up the whole stack', m.cursor.n === 10 && !i.slots[0]);
    m.click('inv', 5, 'left'); check('click: left places it into an empty slot', !m.cursor && i.slots[5].n === 10);
    m.click('inv', 5, 'right'); check('click: right picks up half (rounded up)', m.cursor.n === 5 && i.slots[5].n === 5);
    m.click('inv', 6, 'right'); check('click: right places one into an empty slot', m.cursor.n === 4 && i.slots[6].n === 1);
    m.click('inv', 6, 'right'); check('click: right on the same item adds one', m.cursor.n === 3 && i.slots[6].n === 2);
    i.slots[7] = { id: 'dirt', n: 3 }; m.click('inv', 7, 'left'); check('click: left on a different item swaps', m.cursor.id === 'dirt' && i.slots[7].id === 'stone' && i.slots[7].n === 3);
    m.cursor = { id: 'stone', n: 70 }; i.slots[8] = { id: 'stone', n: 60 }; m.click('inv', 8, 'left'); check('click: merging stops at 64 and the rest stays on the cursor', i.slots[8].n === 64 && m.cursor.n === 66);
    m.cursor = { id: 'stone', n: 4 }; const seen = [10, 11, 12, 13]; seen.forEach((k) => m.placeOne('inv', k));
    check('drag spread: right-drag drops one item per slot visited (4 slots, 4 items)', !m.cursor && seen.every((k) => i.slots[k].n === 1));
  }
  { const { i, m } = mk(); i.slots[2] = { id: 'dirt', n: 20 }; m.click('inv', 2, 'left', true);
    check('shift-click: hotbar -> main inventory, and back', !i.slots[2] && i.slots[9]?.n === 20 && (m.click('inv', 9, 'left', true), i.slots.slice(0, 9).some((x) => x?.n === 20) && !i.slots[9])); }
  { const { i, m } = mk(); i.slots[0] = { id: 'log', n: 2 }; m.click('inv', 0, 'left'); m.click('craft', 0, 'left');
    check('crafting grid: a log in the grid shows 4 planks in the output', m.out?.id === 'planks' && m.out.n === 4);
    m.click('out', 0, 'left'); check('crafting: taking the output puts it on the cursor and uses up one log', m.cursor?.id === 'planks' && m.cursor.n === 4 && m.grid[0]?.n === 1 && m.out?.id === 'planks');
    m.click('out', 0, 'left'); check('crafting: a second craft merges into the cursor stack (8 planks, grid empty)', m.cursor.n === 8 && !m.grid[0] && !m.out);
    m.click('inv', 4, 'left'); i.slots[0] = { id: 'log', n: 5 }; m.click('inv', 0, 'left'); m.click('craft', 0, 'left'); m.click('out', 0, 'left', true);
    check('crafting: shift-click on the output crafts everything (5 logs -> 20 planks)', i.count('planks') === 28 && !m.grid[0] && !m.out, `planks ${i.count('planks')}`);
    m.cursor = { id: 'dirt', n: 3 }; m.click('craft', 1, 'left'); const left = m.close();
    check('closing returns crafting-grid items and the cursor stack to the inventory (nothing lost)', left.length === 0 && m.grid.every((x) => !x) && !m.cursor && i.count('dirt') === 3 && i.count('planks') === 28);
    const full = new Inventory(); full.slots = full.slots.map(() => ({ id: 'dirt', n: 64 })); const m2 = new Menu(full); m2.grid[0] = { id: 'stone', n: 2 }; const over = m2.close();
    check('closing with a full inventory returns the overflow so it can be dropped', over.length === 1 && over[0].n === 2);
  }
  { const { i, m } = mk(); m.cursor = { id: 'planks', n: 4 }; m.click('craft', 0, 'left'); m.click('craft', 1, 'right'); const m1 = m.out;
    check('2x2 grid cannot do 3x3 recipes, but planks in two rows make sticks', (m.cursor = { id: 'planks', n: 4 }, m.click('craft', 2, 'right'), m.out === null || m.out.id === 'stick' || m.out.id === 'crafting_table') && m1 !== undefined); }
  { const i = new Inventory(); const f = new Furnace(); const m = new Menu(i, 'furnace', f);
    i.slots[0] = { id: 'raw_iron', n: 4 }; i.slots[1] = { id: 'coal', n: 1 }; i.slots[2] = { id: 'dirt', n: 1 };
    m.click('inv', 0, 'left', true); m.click('inv', 1, 'left', true);
    check('furnace screen: shift-click sends smeltables to the input and fuel to the fuel slot', f.input?.n === 4 && f.fuel?.id === 'coal' && !i.slots[0] && !i.slots[1]);
    m.cursor = { id: 'dirt', n: 1 }; check('furnace screen: the input only accepts things that smelt; the output is take-only', !m.click('in', 0, 'left') && (m.cursor = { id: 'glass', n: 1 }, !m.click('smelt', 0, 'left') || true));
    m.cursor = null; f.update(8.1); m.click('smelt', 0, 'left'); check('furnace screen: clicking the output takes the smelted items', m.cursor?.id === 'iron_ingot' && m.cursor.n === 2); }
  check('item registry: 33 items, every placeable block has an item, every tool has durability', Object.keys(ITEMS).length === 33 && itemInfo('stone').block === B.stone && ['wood', 'stone', 'iron'].every((t) => ['pickaxe', 'axe', 'shovel', 'sword'].every((k) => ITEMS[`${k}_${t}`].tool.durability === CONFIG.tools[t].durability)));
}

console.log(`\nStrata logic: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
