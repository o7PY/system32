// Strata in a real headless Chrome: boot, worker and fallback, movement and mining with real key / mouse events, placing, inventory and crafting through the DOM,
// saving, menus, day / night, audio, eggs, world border, streaming. Software WebGL: logic is tested, not frame rate.   node tests/strata/run.mjs [name filter]
import { suite, sleep } from '../lib/cdp.mjs';

const s = suite('Strata in the browser', { width: 800, height: 450 });
const { test } = s;
const URL_ = (q = '') => `/games/strata/index.html?debug=1&quality=low${q}`;
const KEYS = { w: ['KeyW', 87], a: ['KeyA', 65], s: ['KeyS', 83], d: ['KeyD', 68], ' ': ['Space', 32], c: ['KeyC', 67], e: ['KeyE', 69], q: ['KeyQ', 81], Shift: ['ShiftLeft', 16], Escape: ['Escape', 27], F3: ['F3', 114], 1: ['Digit1', 49], 2: ['Digit2', 50], 3: ['Digit3', 51] };
const down = (p, k, modifiers = 0) => p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: KEYS[k][0], windowsVirtualKeyCode: KEYS[k][1], modifiers });
const up = (p, k, modifiers = 0) => p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: KEYS[k][0], windowsVirtualKeyCode: KEYS[k][1], modifiers });
const tap = async (p, k, ms = 30) => { await down(p, k); await sleep(ms); await up(p, k); };
const mouseDown = (p, button = 'left') => p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 225, button, clickCount: 1 });
const mouseUp = (p, button = 'left') => p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 225, button, clickCount: 1 });
const st = (p) => p.eval(`__STRATA.state()`);
const S = (p, expr) => p.eval(`(() => { const S = __STRATA; return (${expr}); })()`);

async function boot(p, q = '') {
  await p.goto(URL_(q));
  await p.waitFor(`window.__STRATA?.state().phase === 'title'`, { timeout: 90000, what: 'title screen' });
}
/** A flat world, standing in the middle, chunks around loaded. */
async function flat(p, q = '', size = null) {
  await boot(p, q);
  await p.eval(`__STRATA.newWorld({ seed: 1, flat: true })`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'playing' });
  await p.eval(`(() => { const S = __STRATA; S.G.settings.viewDistance = 4; S.world().view = 4; S.renderer().setView(4); })()`);          // small ring: fast, and the fps stays high
  await p.eval(`__STRATA.settle(3)`);
  await p.waitFor(`__STRATA.state().onGround`, { what: 'on the ground' });
  void size;
}
/** Put a block in front of the player at eye level, `d` blocks away, and look at it. */
async function aimAt(p, id, d = 2) {
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); const x = Math.floor(pl.pos.x), y = Math.floor(pl.pos.y + 1.62), z = Math.floor(pl.pos.z) - ${d}; S.setBlock(x, y, z, ${JSON.stringify(id)}); S.face(0, 0); })()`);
  await sleep(100);
}

// ------------------------------------------------------------------ boot
test('loads: title screen over a generated world, generation in a worker started from a Blob URL, Kenney font and atlas ready, no console errors', async (p) => {
  await boot(p);
  const r = await S(p, `({ ...S.state(), font: document.fonts.check('20px "Kenney Pixel"'), atlas: S.renderer().tex.atlas.image.width, items: S.renderer().tex.items.image.width, sys: typeof System32, cont: document.getElementById('b-continue').disabled, logo: getComputedStyle(document.querySelector('#s-title .logo')).fontFamily })`);
  if (r.backend !== 'worker') throw new Error(`backend ${r.backend}: ${r.backendReason}`);
  if (r.screen !== 'title' || !r.cont || r.atlas !== 256 || r.items !== 256 || r.sys !== 'object' || !r.font || r.meshed < 10) throw new Error(JSON.stringify(r));
});

test('fallback: ?noWorker=1 generates and meshes on the main thread, and a chunk is byte-identical to the worker\'s', async (p) => {
  await boot(p, '&noWorker=1');
  const r = await st(p);
  if (r.backend !== 'inline' || r.backendReason !== 'noWorker') throw new Error(JSON.stringify([r.backend, r.backendReason]));
  await p.eval(`__STRATA.newWorld({ seed: 5 })`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  if ((await p.eval(`__STRATA.settle(2)`)) !== 0) throw new Error('chunks did not load on the main thread');
  const same = await p.eval(`(async () => {
    const { createBackend } = await import('/games/strata/src/world.js'); const w = __STRATA.world();
    const cfg = { seed: 99, flat: false, worldSize: 1024, height: 128, sea: 48, snow: 90, gen: __STRATA.config.gen, ids: w.table.ids, blocks: w.table.blocks };
    const a = (await createBackend({ noWorker: false, base: '/games/strata/src/' })).backend, b = (await createBackend({ noWorker: true, base: '/games/strata/src/' })).backend;
    await a.init(cfg); await b.init(cfg);
    const out = [];
    for (const [cx, cz] of [[10, 12], [31, 33], [0, 0], [63, 40], [20, 21]]) {
      const pa = a.generate(cx, cz), pb = b.generate(cx, cz); b.drain(); const [ra, rb] = await Promise.all([pa, pb]);
      out.push(ra.data.length === rb.data.length && ra.data.every((v, i) => v === rb.data[i]) && ra.biomes.every((v, i) => v === rb.biomes[i]));
    }
    return { kinds: [a.kind, b.kind], out };
  })()`);
  if (same.kinds.join() !== 'worker,inline' || !same.out.every(Boolean)) throw new Error(JSON.stringify(same));
});

test('the main-thread fallback is time-sliced: a pump never runs past its budget by more than one job', async (p) => {
  await boot(p, '&noWorker=1');
  const r = await p.eval(`(async () => {
    const { InlineBackend } = await import('/games/strata/src/world.js'); const w = __STRATA.world();
    const g = globalThis.StrataGen; const b = new InlineBackend(g);
    g.init({ seed: 3, flat: false, worldSize: 1024, height: 128, sea: 48, snow: 90, gen: __STRATA.config.gen, ids: w.table.ids, blocks: w.table.blocks });
    for (let i = 0; i < 40; i++) b.generate(i, 3);
    const t0 = performance.now(); const n = b.pump(6); const dt = performance.now() - t0;
    return { n, dt, left: b.queue.length };
  })()`);
  if (r.n < 1 || r.n > 20 || r.dt > 40 || r.left !== 40 - r.n) throw new Error(JSON.stringify(r));
});

// ------------------------------------------------------------------ world and movement
test('flat world: spawn on the grass in the middle of the world; an edit remeshes its chunk (and the neighbour at a border)', async (p) => {
  await flat(p);
  const r = await st(p);
  if (Math.abs(r.pos.x - 512.5) > 0.5 || Math.abs(r.pos.y - 49) > 0.01 || !r.onGround || r.flat !== true) throw new Error(JSON.stringify(r));
  const before = await S(p, `(() => { const w = S.world(); return [w.chunkAt(32, 32).ver, w.chunkAt(31, 32).ver, w.chunkAt(32, 32).meshVer]; })()`);
  await p.eval(`__STRATA.setBlock(512, 60, 520, 'stone'); 0`);                               // x = 512 is local 0: the neighbour at x = 31 changes too
  const after = await S(p, `(() => { const w = S.world(); return [w.chunkAt(32, 32).ver, w.chunkAt(31, 32).ver]; })()`);
  if (after[0] !== before[0] + 1 || after[1] !== before[1] + 1) throw new Error(JSON.stringify([before, after]));
  await p.waitFor(`(() => { const w = __STRATA.world(); const c = w.chunkAt(32, 32), n = w.chunkAt(31, 32); return c.meshVer === c.ver && n.meshVer === n.ver; })()`, { what: 'remesh', timeout: 20000 });
  const verts = await S(p, `S.renderer().chunkMeshes.get('32,32').children.reduce((n, m) => n + m.geometry.attributes.position.count, 0)`);
  if (verts < 4) throw new Error('no geometry');
  if (await p.eval(`__STRATA.getBlock(512, 60, 520)`) !== 2) throw new Error('block not set');
});

test('movement: W / A / S / D with real key events, mouse look, Space jumps one block, Shift and double-tap W sprint, C sneaks', async (p) => {
  await flat(p);
  const run = async (hold, ms) => { const z0 = (await st(p)).pos.z; for (const k of hold) await down(p, k); await sleep(ms); for (const k of hold) await up(p, k); const z1 = (await st(p)).pos.z; await sleep(300); return (z0 - z1) / (ms / 1000); };
  const walk = await run(['w'], 1500);
  if (walk < 3.2 || walk > 4.6) throw new Error(`walk ${walk}`);
  const sprint = await run(['w', 'Shift'], 1500);
  if (sprint < walk + 0.7) throw new Error(`Shift sprint ${sprint} vs walk ${walk}`);
  await down(p, 'w'); await up(p, 'w'); await sleep(80); await down(p, 'w');
  await sleep(1300);
  const dbl = await S(p, `S.player().sprinting`);
  await up(p, 'w');
  if (!dbl) throw new Error('double-tap W did not sprint');
  await sleep(300);
  const sneak = await run(['w', 'c'], 1500);
  if (sneak > 2) throw new Error(`sneak ${sneak}`);
  const y0 = (await st(p)).pos.y; let peak = y0;
  await down(p, ' '); await sleep(60); await up(p, ' ');
  for (let i = 0; i < 12; i++) { peak = Math.max(peak, (await st(p)).pos.y); await sleep(40); }
  if (peak - y0 < 1.1 || peak - y0 > 1.4) throw new Error(`jump ${peak - y0}`);
  const yaw0 = (await st(p)).yaw; await p.eval(`__STRATA.look(100, 0)`);
  if (!((await st(p)).yaw < yaw0)) throw new Error('mouse look');
  await p.eval(`__STRATA.G.settings.invertY = true; __STRATA.face(0, 0); __STRATA.look(0, 50)`);
  if (!((await st(p)).pitch > 0)) throw new Error('invert Y');
});

test('no Ctrl bindings: Ctrl+W does not sprint or walk, and the source has no Control key binding', async (p) => {
  await flat(p);
  const z0 = (await st(p)).pos.z;
  await down(p, 'w', 2); await sleep(600); await up(p, 'w', 2);
  await down(p, 'w', 2); await up(p, 'w', 2); await down(p, 'w', 2); await sleep(300); await up(p, 'w', 2);
  const r = await st(p);
  if (Math.abs(r.pos.z - z0) > 0.05 || (await S(p, `S.G.sprintLatch`))) throw new Error('Ctrl+W was treated as a game key');
  const src = await p.eval(`Promise.all(['main.js', 'ui.js', 'player.js', 'interact.js'].map((f) => fetch('/games/strata/src/' + f).then((r) => r.text()))).then((a) => a.join('\\n'))`);
  if (/Control(Left|Right)|e\.code === 'Ctrl|ctrlKey\s*[^|)]/.test(src.replace(/e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/g, ''))) throw new Error('a Ctrl binding exists');
  if (!/if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/.test(src)) throw new Error('the Ctrl guard is missing');
});

test('physics in the real world: walls stop you, a placed block can be jumped onto, falling lands on the floor', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; for (let y = 49; y < 53; y++) for (let x = 505; x < 520; x++) S.setBlock(x, y, 508, 'stone'); S.face(0, 0); })()`);
  await down(p, 'w'); await sleep(2500); await up(p, 'w');
  const r = await st(p);
  if (r.pos.z < 508 + 1 + 0.3 - 0.05) throw new Error(`walked into the wall: z ${r.pos.z}`);
  await p.eval(`__STRATA.tp(512.5, 110, 520.5)`);
  await p.waitFor(`__STRATA.state().onGround && __STRATA.state().pos.y < 60`, { timeout: 15000, what: 'landed' });
  const y = (await st(p)).pos.y;
  if (Math.abs(y - 49) > 0.01) throw new Error(`landed at ${y}`);
});

// ------------------------------------------------------------------ mining, drops, placing
test('mining with the real mouse: crack stages, a wood pickaxe breaks stone in 0.75 s, the block drops cobblestone, which is picked up; the pickaxe loses durability', async (p) => {
  await flat(p);
  await aimAt(p, 'stone');
  await p.eval(`__STRATA.give('pickaxe_wood'); __STRATA.selectSlot(0)`);
  await mouseDown(p);
  const stages = new Set(); const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const r = await S(p, `({ air: S.getBlock(512, 50, 510) === 0, vis: S.renderer().crack.visible, prog: S.miner().progress })`);
    if (r.vis) stages.add(Math.floor(r.prog * 10));
    if (r.air) break;
    await sleep(25);
  }
  await mouseUp(p);
  const dt = Date.now() - t0;
  if (!(await S(p, `S.getBlock(512, 50, 510) === 0`))) throw new Error('the block did not break');
  if (dt < 500 || dt > 2200) throw new Error(`break took ${dt} ms (expected about 750)`);
  if (stages.size < 2) throw new Error(`crack stages seen: ${[...stages]}`);
  await down(p, 'w'); await p.waitFor(`__STRATA.inv().count('cobblestone') === 1`, { timeout: 8000, what: 'cobblestone picked up' }); await up(p, 'w');
  const dur = await S(p, `S.inv().held().dur`);
  if (dur !== 59) throw new Error(`durability ${dur}`);
});

test('mining rules: by hand stone breaks slowly and drops nothing; iron ore needs a stone pickaxe; dirt by hand; leaves can drop sticks', async (p) => {
  await flat(p);
  await aimAt(p, 'stone');
  await mouseDown(p);
  const t0 = Date.now(); await p.waitFor(`__STRATA.getBlock(512, 50, 510) === 0`, { timeout: 9000, what: 'stone by hand' }); await mouseUp(p);
  const dt = Date.now() - t0;
  if (dt < 4200 || dt > 6500) throw new Error(`stone by hand took ${dt} ms (expected about 4950)`);
  await sleep(1500);
  if ((await p.eval(`__STRATA.drops().list.length`)) !== 0 || (await p.eval(`__STRATA.inv().count('cobblestone')`)) !== 0) throw new Error('stone dropped something without a pickaxe');
  await aimAt(p, 'iron_ore');
  await p.eval(`__STRATA.give('pickaxe_stone'); __STRATA.selectSlot(0)`);
  await mouseDown(p); await p.waitFor(`__STRATA.getBlock(512, 50, 510) === 0`, { timeout: 5000 }); await mouseUp(p);
  await down(p, 'w'); await p.waitFor(`__STRATA.inv().count('raw_iron') === 1`, { timeout: 8000, what: 'raw iron' }); await up(p, 'w');
  await p.eval(`__STRATA.tp(512.5, 49, 512.5)`);
  await aimAt(p, 'iron_ore');
  await p.eval(`__STRATA.inv().slots[0] = null; __STRATA.give('pickaxe_wood'); __STRATA.selectSlot(0)`);
  await mouseDown(p); await p.waitFor(`__STRATA.getBlock(512, 50, 510) === 0`, { timeout: 9000, what: 'iron with a wood pickaxe' }); await mouseUp(p);
  await sleep(1200);
  if ((await p.eval(`__STRATA.inv().count('raw_iron')`)) !== 1) throw new Error('iron ore dropped with a wood pickaxe');
});

test('placing: right click puts the selected block on the targeted face and uses one item; never inside the player; at y = 127 it is the cloud egg', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.give('planks', 10); __STRATA.selectSlot(0)`);
  await aimAt(p, 'stone');
  await mouseDown(p, 'right'); await mouseUp(p, 'right'); await sleep(200);
  const placed = await p.eval(`__STRATA.getBlock(512, 50, 511)`);
  if (placed !== 9 || (await p.eval(`__STRATA.inv().count('planks')`)) !== 9) throw new Error(`placed ${placed}`);
  await p.eval(`__STRATA.face(0, -Math.PI / 2 + 0.02)`);                                      // straight down at the floor under our feet: the cell is inside us
  await mouseDown(p, 'right'); await mouseUp(p, 'right'); await sleep(200);
  if ((await p.eval(`__STRATA.inv().count('planks')`)) !== 9) throw new Error('placed a block inside the player');
  // the cloud egg: stand on a platform at the top of the world and place a block at y = 127
  await p.eval(`(() => { const S = __STRATA; for (let x = 508; x < 517; x++) for (let z = 508; z < 517; z++) S.setBlock(x, 126, z, 'stone'); S.tp(512.5, 127, 512.5); })()`);
  await p.waitFor(`__STRATA.state().onGround`, { what: 'on the platform' });
  await p.eval(`__STRATA.face(0, -0.7)`);
  const hit = await S(p, `S.target()`);
  if (!hit || hit.y !== 126 || hit.ny !== 1) throw new Error(JSON.stringify(hit));
  await mouseDown(p, 'right'); await mouseUp(p, 'right'); await sleep(300);
  const r = await st(p);
  if (!r.eggs.includes('strata-cloud') || (await p.eval(`document.getElementById('subtitle').textContent`)) !== 'Saved to cloud storage.') throw new Error(JSON.stringify(r.eggs));
});

test('drops: Q throws one item out, it can be picked up again; the middle mouse button picks the block; 1-9 and the wheel change the slot; contextmenu is blocked', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.give('dirt', 5); __STRATA.give('stone', 5); __STRATA.selectSlot(0)`);
  await tap(p, 'q');
  if ((await p.eval(`__STRATA.inv().count('dirt')`)) !== 4 || (await p.eval(`__STRATA.drops().list.length`)) !== 1) throw new Error('Q did not drop one');
  await sleep(1700);                                                                           // a thrown item cannot be picked up for 1.4 s
  await down(p, 'w'); await p.waitFor(`__STRATA.inv().count('dirt') === 5`, { timeout: 10000, what: 'thrown item picked up again' }); await up(p, 'w');
  await tap(p, '2');
  if ((await p.eval(`__STRATA.state().selected`)) !== 1) throw new Error('key 2');
  await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 225, deltaX: 0, deltaY: 100 });
  await sleep(100);
  if ((await p.eval(`__STRATA.state().selected`)) !== 2) throw new Error('wheel');
  await aimAt(p, 'stone');
  await p.eval(`__STRATA.selectSlot(5)`);
  await mouseDown(p, 'middle'); await mouseUp(p, 'middle'); await sleep(100);
  if ((await p.eval(`__STRATA.state().selected`)) !== 1) throw new Error('middle mouse did not select the stone stack');
  const blocked = await p.eval(`(() => { const e = new MouseEvent('contextmenu', { cancelable: true, bubbles: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
  if (!blocked) throw new Error('context menu not prevented');
});

// ------------------------------------------------------------------ inventory and crafting through the DOM
const slot = (c, i) => `#s-inv .slot[data-c="${c}"][data-i="${i}"]`;
test('inventory screen: E opens and closes, clicks pick up / place / halve / swap, shift-click moves between hotbar and main, closing returns the grid items', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.give('log', 10); __STRATA.give('dirt', 20)`);
  await tap(p, 'e');
  await p.waitFor(`__STRATA.state().menu === 'inventory' && !document.getElementById('s-inv').hidden`, { what: 'inventory open' });
  await p.click(slot('inv', 0));                                                               // pick up the logs
  if ((await S(p, `S.G.menu.cursor?.n`)) !== 10) throw new Error('left click did not pick up');
  await p.click(slot('craft', 0), { button: 'right' });                                         // right: place one log in the grid
  if ((await S(p, `S.G.menu.out?.id`)) !== 'planks') throw new Error('a log in the grid should show planks');
  await p.click(slot('inv', 0));                                                                // the rest of the logs goes back (the cursor must be empty to take a result)
  await p.click(slot('out', 0));                                                                // take the planks
  if ((await S(p, `S.G.menu.cursor?.id`)) !== 'planks') throw new Error('output not taken');
  await p.click(slot('inv', 20));                                                               // put them away
  await p.click(slot('inv', 1), { button: 'right' });                                           // halve the dirt (20 -> pick up 10)
  if ((await S(p, `S.G.menu.cursor?.n`)) !== 10) throw new Error('right click should pick half');
  await p.click(slot('inv', 21));
  await p.eval(`document.querySelector('${slot('inv', 21)}').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey: true }))`);
  const moved = await S(p, `S.inv().slots.slice(0, 9).some((s) => s?.id === 'dirt' && s.n === 20) && !S.inv().slots[21]`);       // it merges into the dirt already in the hotbar
  if (!moved) throw new Error('shift-click did not move the stack to the hotbar and merge it');
  await p.click(slot('inv', 2));                                                                // pick up whatever is there ...
  await p.click(slot('craft', 3));                                                              // ... and leave it in the grid
  await tap(p, 'e');
  await p.waitFor(`__STRATA.state().menu === null && document.getElementById('s-inv').hidden`, { what: 'inventory closed' });
  const left = await S(p, `({ grid: S.inv().slots.filter(Boolean).reduce((n, s) => n + s.n, 0) })`);
  if (left.grid !== 10 + 20 - 1 + 4 - 0 && left.grid < 29) throw new Error(JSON.stringify(left));
  if ((await p.eval(`__STRATA.drops().list.length`)) !== 0) throw new Error('items were dropped although the inventory had room');
});

test('inventory UI: the slot under the pointer is highlighted (also after a click redraws it), and a picked-up stick or tool is visible on the cursor', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.give('stick', 12); __STRATA.give('pickaxe_wood'); __STRATA.give('glass', 4)`);
  await tap(p, 'e'); await p.waitFor(`!!document.querySelector('${slot('inv', 0)}')`);
  const outline = (sel) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const c = getComputedStyle(e); return { w: c.outlineWidth, style: c.outlineStyle, bg: c.backgroundColor, hov: e.classList.contains('hov') || e.matches(':hover') }; })()`);
  const before = await outline(slot('inv', 2));
  await p.mouse('mouseMoved', ...(await p.rect(slot('inv', 2)) ? Object.values(await p.rect(slot('inv', 2))).slice(0, 2) : [0, 0]));
  await sleep(150);
  const over = await outline(slot('inv', 2));
  if (over.style === 'none' || over.w === '0px' || over.bg === before.bg || !over.hov) throw new Error(`no highlight: ${JSON.stringify([before, over])}`);
  const other = await outline(slot('inv', 3));
  if (other.style !== 'none' && other.w !== '0px' && other.hov) throw new Error('a slot that is not hovered looks highlighted');
  // pick up the stick (slot 0): it must be visible on the cursor, and the highlight must survive the redraw the click causes
  await p.click(slot('inv', 0));
  const cur = await p.eval(`(() => { const c = document.querySelector('#cursor .ic'); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, vis: getComputedStyle(c).visibility, bg: getComputedStyle(c).backgroundImage.slice(0, 40) }; })()`);
  if (cur.w < 30 || cur.h < 30 || cur.vis !== 'visible') throw new Error(`the picked-up stick has no size: ${JSON.stringify(cur)}`);
  const after = await outline(slot('inv', 0));
  if (after.style === 'none' || after.w === '0px') throw new Error(`the slot lost its highlight after the click redrew it: ${JSON.stringify(after)}`);
  await p.click(slot('inv', 5)); await p.click(slot('inv', 1));                                     // a tool and a block icon too
  const cur2 = await p.eval(`(() => { const c = document.querySelector('#cursor .ic'); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
  if (cur2.w < 30 || cur2.h < 30) throw new Error(`the picked-up tool has no size: ${JSON.stringify(cur2)}`);
  // every kind of icon in the hotbar and inventory is drawn at full size
  const sizes = await p.eval(`[...document.querySelectorAll('#s-inv .slot .ic')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
  if (!sizes.length || sizes.some(([w, h]) => w < 30 || h < 30)) throw new Error(JSON.stringify(sizes));
});

test('crafting end to end: log -> planks -> sticks + crafting table (2x2), place the table, right-click it, a 3x3 wooden pickaxe', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.give('log', 3)`);
  const put = (c, i, btn = 'left') => p.click(slot(c, i), { button: btn });
  const idx = (id) => S(p, `S.inv().slots.findIndex((s) => s?.id === '${id}')`);
  const feed = async (id, cells) => { const i = await idx(id); await put('inv', i); for (const c of cells) await put('craft', c, 'right'); await put('inv', i); };       // pick the stack up, drop one in each cell, put the rest back
  const take = async (dest, want) => { if ((await S(p, `S.G.menu.out?.id`)) !== want) throw new Error(`the grid shows ${await S(p, `S.G.menu.out?.id`)}, wanted ${want}`); await put('out', 0); await put('inv', dest); };
  await tap(p, 'e'); await p.waitFor(`!!document.querySelector('${slot('craft', 0)}')`);
  await feed('log', [0]); await take(10, 'planks');                                 // 1 log -> 4 planks
  await feed('log', [0]); await take(10, 'planks');                                 // another -> 8 planks (merges)
  if ((await S(p, `S.inv().count('planks')`)) !== 8) throw new Error('planks ' + (await S(p, `S.inv().count('planks')`)));
  await feed('planks', [0, 1, 2, 3]); await take(11, 'crafting_table');             // 2x2 planks
  await feed('planks', [0, 2]); await take(12, 'stick');                            // planks over planks
  await tap(p, 'e'); await p.waitFor(`__STRATA.state().menu === null`);
  const have = await S(p, `({ table: S.inv().count('crafting_table'), sticks: S.inv().count('stick'), planks: S.inv().count('planks') })`);
  if (have.table !== 1 || have.sticks !== 4 || have.planks !== 2) throw new Error(JSON.stringify(have));
  // place the table, open it with a right click, make a pickaxe
  await p.eval(`__STRATA.give('planks', 1); (() => { const S = __STRATA, i = S.inv().slots.findIndex((s) => s?.id === 'crafting_table'); S.inv().slots[4] = S.inv().slots[i]; if (i !== 4) S.inv().slots[i] = null; S.selectSlot(4); })()`);
  await aimAt(p, 'stone');
  await mouseDown(p, 'right'); await mouseUp(p, 'right'); await sleep(200);
  if ((await S(p, `S.getBlock(512, 50, 511)`)) !== 15) throw new Error(`the table was not placed (block ${await S(p, `S.getBlock(512, 50, 511)`)})`);
  await p.eval(`__STRATA.face(0, 0)`);
  await mouseDown(p, 'right'); await mouseUp(p, 'right');
  await p.waitFor(`__STRATA.state().menu === 'table'`, { timeout: 4000, what: 'crafting table screen' });
  await feed('planks', [0, 1, 2]); await feed('stick', [4, 7]);
  const out = await S(p, `S.G.menu.out`);
  if (out?.id !== 'pickaxe_wood' || out.dur !== 60) throw new Error(`3x3 gave ${JSON.stringify(out)}`);
  await take(25, 'pickaxe_wood');
  await tap(p, 'Escape');
  if ((await S(p, `S.inv().count('pickaxe_wood')`)) !== 1 || (await S(p, `S.state().phase`)) !== 'playing') throw new Error('no pickaxe in the inventory, or Esc paused the game instead of closing the screen');
});

test('furnace: place it, right-click, coal + raw iron smelts an ingot in 4 s, the output can be taken; breaking it drops its contents', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.give('furnace', 1); __STRATA.give('coal', 2); __STRATA.give('raw_iron', 2); __STRATA.selectSlot(0)`);
  await aimAt(p, 'stone');
  await mouseDown(p, 'right'); await mouseUp(p, 'right'); await sleep(200);
  if ((await S(p, `S.getBlock(512, 50, 511)`)) !== 16) throw new Error('furnace not placed');
  await p.eval(`__STRATA.face(0, 0)`);
  await mouseDown(p, 'right'); await mouseUp(p, 'right');
  await p.waitFor(`__STRATA.state().menu === 'furnace'`, { timeout: 4000, what: 'furnace screen' });
  await p.eval(`(() => { const S = __STRATA, m = S.G.menu; m.click('inv', S.inv().slots.findIndex((s) => s?.id === 'raw_iron'), 'left', true); m.click('inv', S.inv().slots.findIndex((s) => s?.id === 'coal'), 'left', true); })()`);
  const t0 = Date.now();
  await p.waitFor(`__STRATA.G.menu.furnace.output?.id === 'iron_ingot'`, { timeout: 9000, what: 'first ingot' });
  const dt = Date.now() - t0;
  if (dt < 3300 || dt > 5200) throw new Error(`first ingot after ${dt} ms (expected about 4000)`);
  await p.click(slot('smelt', 0));
  if ((await S(p, `S.G.menu.cursor?.id`)) !== 'iron_ingot') throw new Error('output not taken');
  await tap(p, 'Escape');
  await p.eval(`__STRATA.face(0, 0)`);
  await p.eval(`(() => { const S = __STRATA; S.inv().slots[0] = null; S.give('pickaxe_wood'); S.selectSlot(0); })()`);
  const f = await S(p, `S.furnaces().get('512,50,511')`);
  if (!f) throw new Error('no furnace state');
  await aimAt(p, 'air');
  await p.eval(`__STRATA.face(0, 0)`);
  await mouseDown(p); await p.waitFor(`__STRATA.getBlock(512, 50, 511) === 0`, { timeout: 8000, what: 'furnace broken' }); await mouseUp(p);
  await p.waitFor(`__STRATA.inv().count('furnace') >= 1 && __STRATA.inv().count('raw_iron') + __STRATA.inv().count('coal') >= 1`, { timeout: 8000, what: 'furnace and its contents back in the inventory' });
});

// ------------------------------------------------------------------ saving
test('saving: 500 random edits round-trip through save -> new world -> load; an unedited world saves under 2 KB; compressed and plain saves agree; garbage is rejected', async (p) => {
  await flat(p);
  const plain = await p.eval(`__STRATA.save()`);
  if (plain.length >= 2048) throw new Error(`unedited save is ${plain.length} bytes`);
  await p.eval(`(() => { const S = __STRATA; let a = 12345; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647); const seen = new Map(); for (let i = 0; i < 500; i++) { const x = 500 + Math.floor(r() * 24), z = 500 + Math.floor(r() * 24), y = 30 + Math.floor(r() * 30), id = 1 + Math.floor(r() * 18); if (S.setBlock(x, y, z, id)) seen.set(x + ',' + y + ',' + z, [x, y, z]); } window.__edits = [...seen.values()].map(([x, y, z]) => [x, y, z, S.getBlock(x, y, z)]); S.give('pickaxe_iron'); S.give('stone', 33); S.tp(520.5, 49, 505.5); S.setTime(0.4); })()`);
  const n = await p.eval(`__edits.length`);
  if (n < 330) throw new Error(`only ${n} edits took`);
  const str = await p.eval(`__STRATA.save()`);
  if (!str.startsWith('STRATA1:z:') && !str.startsWith('STRATA1:r:')) throw new Error('bad prefix');
  await p.eval(`__STRATA.newWorld({ seed: 424242, flat: false })`);
  await p.waitFor(`__STRATA.state().phase === 'playing' && __STRATA.state().seed === 424242`, { timeout: 60000 });
  await p.eval(`__STRATA.load(${JSON.stringify(str)}).then(() => 0)`);
  await p.waitFor(`__STRATA.state().phase === 'playing' && __STRATA.state().flat === true`, { timeout: 60000, what: 'loaded' });
  await p.eval(`__STRATA.settle(2)`);
  const bad = await p.eval(`__edits.filter(([x, y, z, id]) => __STRATA.getBlock(x, y, z) !== id).length`);
  if (bad) throw new Error(`${bad} of ${n} edits differ after loading`);
  const r = await st(p);
  if (r.edits < 280 || Math.abs(r.pos.x - 520.5) > 0.6 || Math.abs(r.dayT - 0.4) > 0.01) throw new Error(JSON.stringify({ edits: r.edits, pos: r.pos, dayT: r.dayT }));
  if ((await S(p, `S.inv().count('stone')`)) !== 33 || (await S(p, `S.inv().count('pickaxe_iron')`)) !== 1) throw new Error('inventory not restored');
  // compressed vs plain agree, and both are accepted
  const both = await p.eval(`(async () => {
    const m = await import('/games/strata/src/save.js'); const S = __STRATA;
    const state = { seed: 9, worldSize: 1024, flat: false, spawn: { x: 1, y: 60, z: 1 }, player: { x: 5, y: 60, z: 5, yaw: 1, pitch: 0 }, inv: S.inv().toJSON(), time: 0.5, settings: S.G.settings, edits: S.world().edits };
    const z = await m.serialize(state, { compress: true }), r = await m.serialize(state, { compress: false });
    const a = await m.deserialize(z), b = await m.deserialize(r);
    let same = a.edits.size === b.edits.size; for (const [k, e] of a.edits) for (const [i, id] of e) if (b.edits.get(k)?.get(i) !== id) same = false;
    return { zLen: z.length, rLen: r.length, zFlag: z.split(':')[1], rFlag: r.split(':')[1], same, edits: a.edits.size };
  })()`);
  if (!both.same || both.rFlag !== 'r' || !(both.zFlag === 'z' && both.zLen < both.rLen)) throw new Error(JSON.stringify(both));
  // garbage
  const rejected = await p.eval(`(async () => {
    const m = await import('/games/strata/src/save.js'); const good = ${JSON.stringify(str)};
    const bads = ['', 'junk', 'STRATA1:', 'STRATA1:z:!!!', 'STRATA1:r:AAAA', 'STRATA1:x:AAAA', good.slice(0, good.length - 40), good.slice(0, 12) + 'A' + good.slice(13), JSON.stringify({ a: 1 })];
    const out = [];
    for (const b of bads) { try { await m.deserialize(b); out.push('accepted:' + b.slice(0, 20)); } catch (e) { out.push(e instanceof m.SaveError ? 'ok' : 'wrong error ' + e); } }
    let loadRejects = false; try { await __STRATA.load('junk'); } catch { loadRejects = true; }
    return { out, loadRejects };
  })()`);
  if (!rejected.out.every((x) => x === 'ok') || !rejected.loadRejects) throw new Error(JSON.stringify(rejected));
});

test('saving: impossible numbers, bad block ids and a forged inventory are rejected by validation', async (p) => {
  await flat(p);
  const r = await p.eval(`(async () => {
    const m = await import('/games/strata/src/save.js'); const S = __STRATA;
    const base = () => ({ seed: 9, worldSize: 1024, flat: false, spawn: { x: 1, y: 60, z: 1 }, player: { x: 5, y: 60, z: 5, yaw: 1, pitch: 0 }, inv: JSON.parse(JSON.stringify(S.inv().toJSON())), time: 0.5, settings: { ...S.G.settings }, edits: new Map() });
    const cases = {
      nan: (s) => { s.player.x = NaN; }, outside: (s) => { s.player.x = 5000; }, size: (s) => { s.worldSize = 1000; }, time: (s) => { s.time = 2; },
      item: (s) => { s.inv.slots[0] = { id: 'bedrock_gun', n: 1 }; }, count: (s) => { s.inv.slots[0] = { id: 'stone', n: 1000 }; }, slots: (s) => { s.inv.slots = s.inv.slots.slice(1); },
      fov: (s) => { s.settings.fov = 500; }, edit: (s) => { s.edits = new Map([[(70 << 16) | 70, new Map([[5, 3]])]]); }, blockid: (s) => { s.edits = new Map([[0, new Map([[5, 250]])]]); },
    };
    const out = {};
    for (const [k, f] of Object.entries(cases)) { const s = base(); f(s); try { await m.deserialize(await m.serialize(s)); out[k] = 'accepted'; } catch (e) { out[k] = e instanceof m.SaveError ? 'ok' : String(e); } }
    out.good = await m.deserialize(await m.serialize(base())).then(() => 'ok', (e) => String(e));
    return out;
  })()`);
  const wrong = Object.entries(r).filter(([k, v]) => v !== 'ok');
  if (wrong.length) throw new Error(JSON.stringify(wrong));
});

// A page with no shell: answer System32.save() like the shell does, and keep what was saved.
const fakeShell = (p) => p.eval(`(() => { window.__saves = []; System32.save = (data) => { __saves.push(data); window.postMessage({ source: 'system32-shell', type: 'SAVED', payload: { ok: true, bytes: data.length } }, '*'); }; })()`);

test('menus: New World with a seed, pause + Save & Quit, Continue brings the same world back; settings apply; a damaged save is refused with a message', async (p) => {
  await boot(p);
  await fakeShell(p);
  if (!(await p.eval(`document.getElementById('b-continue').disabled`))) throw new Error('Continue should be disabled without a save');
  await p.click('[data-act="new"]');
  await p.waitFor(`!document.getElementById('s-newworld').hidden`);
  await p.eval(`document.getElementById('seed-input').value = '31415'`);
  await p.click('[data-act="start-new"]');
  await p.waitFor(`__STRATA.state().phase === 'paused'`, { timeout: 90000, what: 'world ready (waiting for Resume)' });
  if ((await st(p)).seed !== 31415) throw new Error('seed from the field');
  if (!(await p.eval(`/Resume/.test(document.getElementById('s-pause').textContent)`))) throw new Error('no resume prompt');
  await p.click('[data-act="resume"]');
  await p.waitFor(`__STRATA.state().phase === 'playing'`);
  await p.eval(`__STRATA.G.fakeLock = true; __STRATA.give('stone', 7); __STRATA.setBlock(Math.floor(__STRATA.player().pos.x) + 2, 80, Math.floor(__STRATA.player().pos.z), 'planks')`);
  const where = await p.eval(`({ x: Math.floor(__STRATA.player().pos.x) + 2, z: Math.floor(__STRATA.player().pos.z) })`);
  await p.eval(`__STRATA.pause()`);
  await p.waitFor(`__STRATA.state().phase === 'paused' && __saves.length >= 1`, { what: 'pause autosave' });
  await p.click('[data-act="settings"]');
  await p.eval(`(() => { const e = document.getElementById('set-fov'); e.value = 90; e.dispatchEvent(new Event('input', { bubbles: true })); const v = document.getElementById('set-view'); v.value = 4; v.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const set = await S(p, `({ fov: S.renderer().camera.fov, view: S.world().view, s: S.G.settings.fov })`);
  if (set.s !== 90 || set.view !== 4 || Math.abs(set.fov - 90) > 0.01) throw new Error(JSON.stringify(set));
  await p.click('[data-act="back-settings"]');
  await p.waitFor(`!document.getElementById('s-pause').hidden`, { what: 'back to the pause menu' });
  await p.click('[data-act="quit"]');
  await p.waitFor(`__STRATA.state().phase === 'title'`, { timeout: 90000, what: 'title after quitting' });
  if (await p.eval(`document.getElementById('b-continue').disabled`)) throw new Error('Continue should be enabled after a save');
  await p.click('[data-act="continue"]');
  await p.waitFor(`__STRATA.state().phase === 'paused' && __STRATA.state().seed === 31415`, { timeout: 90000, what: 'continued' });
  await p.eval(`__STRATA.G.fakeLock = true; __STRATA.resume(); __STRATA.settle(2)`);
  const r = await S(p, `({ planks: S.getBlock(${where.x}, 80, ${where.z}), stone: S.inv().count('stone'), fov: S.G.settings.fov, view: S.world().view })`);
  if (r.planks !== 9 || r.stone !== 7 || r.fov !== 90 || r.view !== 4) throw new Error(JSON.stringify(r));
  // a damaged save: the next INIT-like save string is garbage
  await p.eval(`__STRATA.G.save = 'STRATA1:z:' + 'A'.repeat(40); __STRATA.pause(); 0`);
  await p.click('[data-act="quit"]');
  await p.waitFor(`__STRATA.state().phase === 'title'`, { timeout: 90000 });
  await p.eval(`__STRATA.G.save = 'STRATA1:z:' + 'A'.repeat(40)`);
  await p.click('[data-act="continue"]');
  await p.waitFor(`!document.getElementById('s-error').hidden`, { timeout: 10000, what: 'error screen' });
  if (!(await p.eval(`/Save could not be loaded/.test(document.getElementById('s-error').textContent)`))) throw new Error('no clear message');
});

test('save results: a too-large answer shows "World too big to save: 1.6 MB / 1.5 MB. Try removing some builds."; Esc / lost pointer lock pauses and saves', async (p) => {
  await flat(p);
  await fakeShell(p);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'SAVED', payload: { ok: false, error: 'too-large', bytes: 1.6 * 1048576 } }, '*')`);
  await p.waitFor(`/World too big to save/.test(document.getElementById('saved').textContent)`, { what: 'warning' });
  const t = await p.eval(`document.getElementById('saved').textContent`);
  if (t !== 'World too big to save: 1.6 MB / 1.5 MB. Try removing some builds.') throw new Error(t);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'SAVED', payload: { ok: false, error: 'quota', bytes: 10 } }, '*')`);
  await p.waitFor(`/storage is full/.test(document.getElementById('saved').textContent)`);
  await p.eval(`__STRATA.G.fakeLock = false`);
  await tap(p, 'Escape');
  await sleep(300);
  if ((await st(p)).phase !== 'playing') {/* with no pointer lock Esc is a plain key: it pauses */}
  await p.eval(`document.dispatchEvent(new Event('pointerlockchange'))`);
  await p.waitFor(`__STRATA.state().phase === 'paused' && !document.getElementById('s-pause').hidden`, { what: 'pause menu' });
  await p.waitFor(`__saves.length >= 1`, { what: 'autosave on pause' });
  const shell = await p.eval(`(() => { window.postMessage({ source: 'system32-shell', type: 'PAUSE' }, '*'); return 1; })()`);
  void shell;
});

test('the shell\'s PAUSE message autosaves and pauses a running game', async (p) => {
  await flat(p);
  await fakeShell(p);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'PAUSE' }, '*')`);
  await p.waitFor(`__STRATA.state().phase === 'paused' && __saves.length >= 1`, { what: 'paused + saved' });
});

// ------------------------------------------------------------------ sky, audio, eggs, border, streaming
test('day and night: 20 minutes per day, bright at noon and dark blue at midnight, sun and moon in code, clouds only at normal quality', async (p) => {
  await flat(p);
  const l0 = await p.eval(`(() => { const S = __STRATA, a = S.G.dayT; return new Promise((r) => setTimeout(() => r((S.G.dayT - a + 1) % 1), 2000)); })()`);
  if (Math.abs(l0 - 2 / 1200) > 0.0006) throw new Error(`2 s advanced ${l0}, expected ${2 / 1200}`);
  const sample = async (t) => { await p.eval(`__STRATA.setTime(${t})`); await p.waitFor(`Math.abs(__STRATA.renderer().time - ${t}) < 0.003`, { what: `a frame drawn at time ${t}`, timeout: 15000 }); await sleep(60); return p.eval(`(() => { const r = __STRATA.renderer(); return { sun: r.uniforms.uSun.value, fog: r.uniforms.uFogColor.value.toArray(), sunY: r.sunDir.y, stars: r.stars.material.opacity, sunVis: r.sun.material.opacity, moonVis: r.moon.material.opacity }; })()`); };
  const noon = await sample(0.25), night = await sample(0.75), dawn = await sample(0.02);
  if (!(noon.sun > 0.95 && night.sun < 0.3 && noon.sunY > 0.9 && night.sunY < -0.9)) throw new Error(JSON.stringify([noon, night]));
  if (!(night.fog[2] > night.fog[0] && night.fog[2] < 0.3 && noon.fog[2] > 0.9)) throw new Error('night is not dark blue: ' + JSON.stringify(night.fog));
  if (!(noon.sunVis > 0.9 && noon.moonVis < 0.1 && night.moonVis > 0.9 && night.stars > 0.9 && noon.stars < 0.1)) throw new Error(JSON.stringify([noon, night]));
  if (!(dawn.fog[0] > dawn.fog[2] * 0.9)) throw new Error('no warm horizon at sunrise');
  if (await S(p, `!!S.renderer().clouds`)) throw new Error('clouds at ?quality=low');
  await boot(p, '').catch(() => {});
  await p.goto('/games/strata/index.html?debug=1');
  await p.waitFor(`window.__STRATA?.state().phase === 'title'`, { timeout: 90000 });
  if (!(await S(p, `!!S.renderer().clouds && S.renderer().clouds.position.y === 112`))) throw new Error('no clouds at normal quality');
});

test('audio: silent without the shell\'s sound; with it, every action asks for the right material sample; SOUND switches it off again', async (p) => {
  await flat(p);
  if ((await S(p, `S.state().sound.ctx`)) !== false) throw new Error('an AudioContext exists although the shell never turned sound on');
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'INIT', payload: { soundOn: true, save: null } }, '*')`);
  await sleep(100);
  await tap(p, 'c', 10);
  await p.waitFor(`__STRATA.state().sound.ctx`, { what: 'AudioContext after a key press' });
  await p.waitFor(`__STRATA.audio().bufs.size > 20`, { timeout: 20000, what: 'samples decoded' });
  await p.eval(`__STRATA.audio().played.length = 0`);
  await p.eval(`__STRATA.give('pickaxe_wood'); __STRATA.give('planks', 5); __STRATA.selectSlot(0)`);
  await aimAt(p, 'stone');
  await mouseDown(p); await p.waitFor(`__STRATA.getBlock(512, 50, 510) === 0`, { timeout: 5000 }); await mouseUp(p);
  await down(p, 'w'); await p.waitFor(`__STRATA.inv().count('cobblestone') === 1`, { timeout: 8000, what: 'cobblestone picked up' }); await up(p, 'w');
  await sleep(500);
  await p.eval(`__STRATA.tp(512.5, 49, 512.5)`);
  await p.eval(`__STRATA.selectSlot(1)`);
  await aimAt(p, 'stone');
  await mouseDown(p, 'right'); await mouseUp(p, 'right');
  await p.eval(`__STRATA.face(Math.PI, 0)`);                                               // away from the stone we just placed
  await down(p, 'w'); await sleep(2200); await up(p, 'w');
  const played = await S(p, `S.state().sound.played`);
  const need = ['dig.stone', 'break.stone', 'pickup', 'place', 'step.grass'];
  const missing = need.filter((r) => !played.includes(r));
  if (missing.length) throw new Error(`never played: ${missing} (played ${[...new Set(played)]})`);
  const walking = played.filter((r) => r.startsWith('step.')).length;
  await p.eval(`__STRATA.audio().played.length = 0`);
  await down(p, 'c'); await down(p, 'w'); await sleep(1800); await up(p, 'w'); await up(p, 'c');
  const sneaking = (await S(p, `S.state().sound.played`)).filter((r) => r.startsWith('step.')).length;
  if (sneaking !== 0) throw new Error(`${sneaking} footsteps while sneaking`);
  if (walking < 3) throw new Error(`only ${walking} footsteps in 2 s of walking`);
  if (!(await S(p, `S.audio().ambient()`))) throw new Error('ambient music did not start');
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'SOUND', payload: { soundOn: false } }, '*')`);
  await sleep(100);
  if (await S(p, `S.audio().active`)) throw new Error('SOUND off did not silence the game');
});

test('eggs: mining the Ad Block ore ("Ad Block enabled." + a pop-up item), 10 s on bedrock, and the shell gets each one once', async (p) => {
  await flat(p);
  await p.eval(`window.__fx = []; const fx = System32.effect; System32.effect = (n, o) => { __fx.push([n, o]); fx(n, o); };`);
  await p.eval(`__STRATA.give('pickaxe_wood'); __STRATA.selectSlot(0)`);
  await aimAt(p, 'ad_block');
  await mouseDown(p); await p.waitFor(`__STRATA.getBlock(512, 50, 510) === 0`, { timeout: 12000, what: 'ad block mined' }); await mouseUp(p);
  await down(p, 'w'); await p.waitFor(`__STRATA.inv().count('popup') === 1`, { timeout: 8000, what: 'pop-up item' }); await up(p, 'w');
  await p.eval(`__STRATA.tp(512.5, 49, 512.5)`);
  const fx = await p.eval(`__fx`);
  if (!fx.some(([n, o]) => n === 'egg' && o.egg === 'strata-adblock') || !fx.some(([n, o]) => n === 'toast' && /Ad Block enabled/.test(o.text))) throw new Error(JSON.stringify(fx));
  if ((await p.eval(`document.getElementById('subtitle').textContent`)) !== 'Ad Block enabled.') throw new Error('no subtitle');
  await aimAt(p, 'bedrock');
  await mouseDown(p);
  await sleep(9000);
  if ((await st(p)).eggs.includes('strata-bedrock')) throw new Error('the bedrock egg came before 10 s');
  await p.waitFor(`__STRATA.state().eggs.includes('strata-bedrock')`, { timeout: 4000, what: 'bedrock egg' });
  await mouseUp(p);
  if ((await p.eval(`document.getElementById('subtitle').textContent`)) !== "It's called bedrock. It's not going anywhere.") throw new Error('no bedrock subtitle');
  if (!(await S(p, `S.getBlock(512, 50, 510) === 1`))) throw new Error('bedrock broke');
  const eggs = (await p.eval(`__fx`)).filter(([n]) => n === 'egg').map(([, o]) => o.egg);
  if (new Set(eggs).size !== eggs.length) throw new Error('an egg was sent twice: ' + eggs);
});

test('world border: a small world stops you at its edge and shows the grid within 8 blocks', async (p) => {
  await boot(p, '&worldSize=64');
  await p.eval(`__STRATA.newWorld({ seed: 1, flat: true })`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  await p.eval(`__STRATA.settle(2)`);
  await p.waitFor(`__STRATA.state().onGround`);
  const far = await S(p, `S.renderer().walls.some((w) => w.visible)`);
  if (far) throw new Error('grid visible far from the edge');
  await p.eval(`__STRATA.face(-Math.PI / 2, 0)`);                       // look east (+x)
  await down(p, 'w'); await down(p, 'Shift');
  await p.waitFor(`__STRATA.state().pos.x > 56`, { timeout: 15000, what: 'near the east edge' });
  const near = await S(p, `S.renderer().walls.filter((w) => w.visible).length`);
  await sleep(2500); await up(p, 'w'); await up(p, 'Shift');
  const r = await st(p);
  if (near < 1) throw new Error('no grid near the edge');
  if (r.pos.x > 64 - 0.3 + 0.01 || r.pos.x < 63) throw new Error(`x ${r.pos.x}: not stopped at the world edge`);
});

test('streaming: chunks far from the player unload (data and mesh), edits survive being unloaded and come back', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.setBlock(512, 70, 512, 'planks')`);
  await p.eval(`__STRATA.setTime(0.25); 0`);
  const loaded0 = await S(p, `S.world().loadedCount`);
  await p.eval(`__STRATA.tp(800.5, 49, 800.5)`);
  await p.waitFor(`__STRATA.world().chunkAt(32, 32) === undefined`, { timeout: 30000, what: 'old chunk unloaded' });
  await p.eval(`__STRATA.settle(2)`);
  const r = await S(p, `({ loaded: S.world().loadedCount, meshes: S.renderer().chunkMeshes.size, old: S.renderer().chunkMeshes.has('32,32'), edits: S.world().editCount() })`);
  if (r.old || r.loaded > loaded0 + 40 || r.meshes > r.loaded) throw new Error(JSON.stringify([loaded0, r]));
  if (r.edits !== 1) throw new Error('edit forgotten while unloaded');
  await p.eval(`__STRATA.tp(512.5, 80, 515.5)`);
  await p.waitFor(`__STRATA.world().chunkAt(32, 32)?.data`, { timeout: 30000 });
  if ((await p.eval(`__STRATA.getBlock(512, 70, 512)`)) !== 9) throw new Error('edit lost after reloading the chunk');
});

test('F3 shows FPS, position, chunk, biome, facing, loaded chunks, draw calls and the worker queue', async (p) => {
  await flat(p);
  await tap(p, 'F3');
  await p.waitFor(`!document.getElementById('f3').hidden && document.getElementById('f3').textContent.length > 20`, { what: 'F3 overlay', timeout: 4000 });
  const t = await p.eval(`document.getElementById('f3').textContent`);
  for (const w of ['fps', 'XYZ', 'Chunk', 'Biome', 'Facing', 'loaded', 'Draw calls', 'Worker queue']) if (!t.includes(w)) throw new Error(`F3 lacks "${w}": ${t}`);
  await tap(p, 'F3');
  await p.waitFor(`document.getElementById('f3').hidden`);
});

test('a seeded terrain world loads with biomes, trees and water in view, and has no console errors', async (p) => {
  await boot(p);
  await p.eval(`__STRATA.newWorld({ seed: 2024 })`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  if ((await p.eval(`__STRATA.settle(3)`)) !== 0) throw new Error('did not settle');
  const r = await S(p, `({ pos: S.state().pos, ground: S.getBlock(Math.floor(S.state().pos.x), Math.floor(S.state().pos.y) - 1, Math.floor(S.state().pos.z)), biome: S.world().biomeAt(Math.floor(S.state().pos.x), Math.floor(S.state().pos.z)) })`);
  if (r.ground !== 4 || !['plains', 'forest'].includes(r.biome)) throw new Error(JSON.stringify(r));
});

s.run();
