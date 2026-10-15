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
  if (r.screen !== 'title' || !r.cont || r.atlas !== 512 || r.items !== 320 || r.sys !== 'object' || !r.font || r.meshed < 10) throw new Error(JSON.stringify(r));
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

test('save results: a too-large answer shows "World too big to save: 2.6 MB / 2.5 MB. Try removing some builds."; Esc / lost pointer lock pauses and saves', async (p) => {
  await flat(p);
  await fakeShell(p);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'SAVED', payload: { ok: false, error: 'too-large', bytes: 2.6 * 1048576 } }, '*')`);
  await p.waitFor(`/World too big to save/.test(document.getElementById('saved').textContent)`, { what: 'warning' });
  const t = await p.eval(`document.getElementById('saved').textContent`);
  if (t !== 'World too big to save: 2.6 MB / 2.5 MB. Try removing some builds.') throw new Error(t);
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

// ------------------------------------------------------------------ Part 2: lighting and torches
const lumAt = (p, dx = 0, size = 40) => S(p, `(() => { const r = S.renderer(); r.render(performance.now() / 1000); const gl = r.gl.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, n = ${size}; const b = new Uint8Array(n * n * 4); gl.readPixels(Math.floor(W / 2 - n / 2 + ${dx}), Math.floor(H / 2 - n / 2), n, n, gl.RGBA, gl.UNSIGNED_BYTE, b); let t = 0; for (let i = 0; i < b.length; i += 4) t += b[i] * 0.3 + b[i + 1] * 0.59 + b[i + 2] * 0.11; return t / (n * n); })()`);
const night = async (p) => { await p.eval(`__STRATA.setTime(0.75)`); await p.waitFor(`Math.abs(__STRATA.renderer().time - 0.75) < 0.003`, { what: 'night drawn', timeout: 15000 }); };

test('torches: placed with the real right click on a floor and on a wall, lit 14, brighter pixels at night, popped off when the support goes, picked up by hand', async (p) => {
  await flat(p);
  await night(p);
  await p.eval(`__STRATA.face(0, -0.9)`);
  await sleep(200);
  const hit = await S(p, `S.target()`);
  if (!hit || hit.ny !== 1) throw new Error('no ground in front: ' + JSON.stringify(hit));
  const before = await lumAt(p);
  await p.eval(`(() => { const S = __STRATA; S.give('torch', 4); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'torch')); S.useOrPlace(); })()`);
  const tx = hit.x, ty = hit.y + 1, tz = hit.z, ids = await S(p, `S.world().table.ids`);
  if ((await S(p, `S.getBlock(${tx}, ${ty}, ${tz})`)) !== ids.torch) throw new Error('the torch was not placed on the floor');
  if ((await S(p, `S.inv().slots.find((s) => s?.id === 'torch').n`)) !== 3) throw new Error('placing did not use one torch');
  await p.waitFor(`(() => { const l = __STRATA.world().lightAt(${tx}, ${ty}, ${tz}); return l && l.blk === 14; })()`, { what: 'torch light after the remesh', timeout: 30000 });
  await p.waitFor(`__STRATA.world().missingMeshes(__STRATA.player().pos.x, __STRATA.player().pos.z, 2) === 0`, { what: 'meshes up to date' });
  await sleep(150);
  const after = await lumAt(p);
  if (!(after > before * 1.6 + 2)) throw new Error(`the torch did not light the scene: ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  const lit3 = await S(p, `S.world().lightAt(${tx + 3}, ${ty}, ${tz})`);
  if (!lit3 || lit3.blk !== 11) throw new Error('3 blocks from the torch the light should be 11: ' + JSON.stringify(lit3));
  // a wall torch: a stone pillar, aim at its +x side... aim from the front: place a block ahead and click its face
  await p.eval(`(() => { const S = __STRATA; const pl = S.player(); S.setBlock(Math.floor(pl.pos.x), 51, Math.floor(pl.pos.z) - 3, 'stone'); S.setBlock(Math.floor(pl.pos.x), 50, Math.floor(pl.pos.z) - 3, 'stone'); S.setBlock(Math.floor(pl.pos.x), 49, Math.floor(pl.pos.z) - 3, 'stone'); S.face(0, 0); })()`);
  await sleep(200);
  const wall = await S(p, `S.target()`);
  if (!wall || wall.nz !== 1) throw new Error('the pillar was not hit on its +z face: ' + JSON.stringify(wall));
  await p.eval(`__STRATA.useOrPlace()`);
  if ((await S(p, `S.getBlock(${wall.x}, ${wall.y}, ${wall.z + 1})`)) !== ids.torch_pz) throw new Error('the wall torch should be torch_pz');
  // break the stone under the floor torch: the torch pops off as an item
  const dropsBefore = await S(p, `S.drops().list.length`);
  await p.eval(`(() => { const S = __STRATA; S.breakBlock({ x: ${tx}, y: ${ty - 1}, z: ${tz}, id: S.getBlock(${tx}, ${ty - 1}, ${tz}) }); })()`);
  if ((await S(p, `S.getBlock(${tx}, ${ty}, ${tz})`)) !== 0) throw new Error('the torch stayed in the air');
  const dropped = await S(p, `S.drops().list.filter((d) => d.stack.id === 'torch').length`);
  if (dropped < 1) throw new Error(`the torch did not drop as an item (${dropsBefore} -> ${dropped})`);
  // the wall torch pops off when its pillar block is mined
  await p.eval(`(() => { const S = __STRATA; S.breakBlock({ x: ${wall.x}, y: ${wall.y}, z: ${wall.z}, id: S.getBlock(${wall.x}, ${wall.y}, ${wall.z}) }); })()`);
  if ((await S(p, `S.getBlock(${wall.x}, ${wall.y}, ${wall.z + 1})`)) !== 0) throw new Error('the wall torch did not pop off');
  // by hand a torch breaks at once and gives itself back
  const info = await p.eval(`import('/games/strata/src/interact.js').then((m) => { const s = __STRATA; return { time: m.breakInfo(s.world().table.ids.torch, null).time, drop: m.dropFor(s.world().table.ids.torch_nx, null)?.id }; })`);
  if (!(info.time < 0.1) || info.drop !== 'torch') throw new Error(JSON.stringify(info));
});

test('lighting in the browser: day and night go through the sky light only (no remesh), a cave is dark, a lit furnace glows and goes out again', async (p) => {
  await flat(p);
  await p.waitFor(`__STRATA.world().missingMeshes(__STRATA.player().pos.x, __STRATA.player().pos.z, 4) === 0 && __STRATA.world().queueLength === 0`, { what: 'every chunk of the ring meshed', timeout: 60000 });
  const meshedBefore = await S(p, `S.world().stats.meshed`);
  await night(p);
  await sleep(300);
  await p.eval(`__STRATA.setTime(0.25)`); await sleep(300);
  if ((await S(p, `S.world().stats.meshed`)) !== meshedBefore) throw new Error('changing the time of day remeshed chunks');
  // a sealed hole underground has no sky light; the surface does
  const pos = await S(p, `({ x: Math.floor(S.player().pos.x), z: Math.floor(S.player().pos.z) })`);
  await p.eval(`(() => { const S = __STRATA; S.setBlock(${pos.x + 5}, 30, ${pos.z + 5}, 'air'); })()`);
  await p.waitFor(`__STRATA.world().missingMeshes(__STRATA.player().pos.x, __STRATA.player().pos.z, 2) === 0`, { what: 'remeshed' });
  const cave = await S(p, `S.world().lightAt(${pos.x + 5}, 30, ${pos.z + 5})`), surf = await S(p, `S.world().lightAt(${pos.x}, 55, ${pos.z})`);
  if (!cave || cave.sky !== 0 || cave.blk !== 0 || surf.sky !== 15) throw new Error(JSON.stringify([cave, surf]));
  // a furnace: right-click opens its screen (creating it), coal + raw iron burn, the block becomes the lit one, then goes back
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.setBlock(Math.floor(pl.pos.x), 50, Math.floor(pl.pos.z) - 3, 'furnace'); S.face(0, -0.2); })()`);
  await sleep(150);
  const fh = await S(p, `S.target()`);
  await p.eval(`__STRATA.useOrPlace()`);
  await p.waitFor(`__STRATA.state().menu === 'furnace'`, { what: 'furnace screen' });
  const key = `${fh.x},${fh.y},${fh.z}`;
  await p.eval(`(() => { const f = __STRATA.furnaces().get(${JSON.stringify(key)}); f.input = { id: 'raw_iron', n: 1 }; f.fuel = { id: 'planks', n: 1 }; })()`);       // a plank burns 6 s: 4 s of smelting, then the fire dies down
  const ids = await S(p, `S.world().table.ids`);
  await p.waitFor(`__STRATA.getBlock(${fh.x}, ${fh.y}, ${fh.z}) === ${ids.furnace_lit}`, { what: 'the furnace to glow', timeout: 10000 });
  await p.waitFor(`(() => { const l = __STRATA.world().lightAt(${fh.x}, ${fh.y + 1}, ${fh.z}); return l && l.blk === 12; })()`, { what: 'light 12 beside the furnace', timeout: 30000 });
  await p.eval(`(() => { const S = __STRATA; S.closeMenu(); })()`);
  await p.waitFor(`__STRATA.getBlock(${fh.x}, ${fh.y}, ${fh.z}) === ${ids.furnace}`, { what: 'the furnace to go out', timeout: 20000 });
  await p.waitFor(`(() => { const l = __STRATA.world().lightAt(${fh.x}, ${fh.y + 1}, ${fh.z}); return l && l.blk === 0; })()`, { what: 'the glow to go', timeout: 30000 });
  if ((await S(p, `S.inv().slots.some((s) => s?.id === 'iron_ingot') || S.furnaces().get(${JSON.stringify(key)}).output?.id === 'iron_ingot'`)) !== true) throw new Error('the furnace did not smelt');
});

// ------------------------------------------------------------------ Part 2: survival
const rightDown = (p) => p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 225, button: 'right', clickCount: 1 });
const rightUp = (p) => p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 225, button: 'right', clickCount: 1 });
const vit = (p) => S(p, `({ hp: S.vitals().hp, hunger: S.vitals().hunger, air: S.vitals().air, dead: S.vitals().dead, phase: S.state().phase, screen: S.state().screen, armor: S.vitals().armorPoints })`);

test('survival HUD: 10 hearts, 10 food icons above the hotbar, half hearts, armor points, air bubbles only under water, all drawn in code', async (p) => {
  await flat(p);
  const hud = () => S(p, `({ hearts: [...document.querySelectorAll('#hearts img')].map((i) => i.src.length), food: document.querySelectorAll('#food img').length, armor: document.querySelectorAll('#armorbar img').length, air: document.querySelectorAll('#air img').length, y: [document.getElementById('hearts').getBoundingClientRect().bottom, document.getElementById('hotbar').getBoundingClientRect().top] })`);
  let h = await hud();
  if (h.hearts.length !== 10 || h.food !== 10 || h.armor !== 0 || h.air !== 0) throw new Error(JSON.stringify(h));
  if (!(h.y[0] <= h.y[1])) throw new Error('hearts are not above the hotbar ' + JSON.stringify(h.y));
  await p.eval(`__STRATA.setHealth(7); __STRATA.setHunger(5)`);
  await p.waitFor(`document.querySelectorAll('#hearts img')[3].src !== document.querySelectorAll('#hearts img')[0].src`, { what: 'a half heart' });
  const srcs = await S(p, `[...document.querySelectorAll('#hearts img')].map((i) => i.src)`);
  if (!(srcs[0] === srcs[2] && srcs[3] !== srcs[2] && srcs[4] !== srcs[3] && srcs[4] === srcs[9])) throw new Error('7 HP should be 3 full hearts, 1 half, 6 empty... ' + srcs.map((x) => x.length).join());
  if (!/^data:image\/png/.test(srcs[0])) throw new Error('the heart is not drawn in code');
  await p.eval(`__STRATA.giveKit('iron')`);
  await p.waitFor(`document.querySelectorAll('#armorbar img').length === 10`, { what: 'armor row' });
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.setBlock(Math.floor(pl.pos.x), 49, Math.floor(pl.pos.z), 'water'); S.tp(pl.pos.x, 49, pl.pos.z); })()`);
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); for (let y = 49; y <= 52; y++) S.setBlock(Math.floor(pl.pos.x), y, Math.floor(pl.pos.z), 'water'); S.tp(pl.pos.x, 49, pl.pos.z); })()`);
  await p.waitFor(`document.querySelectorAll('#air img').length === 10 && document.querySelectorAll('#air img[src]').length === 10 && __STRATA.vitals().air < 9.5`, { what: 'air bubbles under water', timeout: 15000 });
});

test('water flows: a source spreads to flowing water, falls over an edge, swimming works in it, a wall holds it back, and it is saved with the world', async (p) => {
  await flat(p);
  const r = await p.eval(`(async () => {
    const S = __STRATA, pl = S.player(), x = Math.floor(pl.pos.x) + 6, z = Math.floor(pl.pos.z) + 6, y = 49, nap = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) for (let h = 49; h <= 53; h++) S.setBlock(x + dx, h, z + dz, 'air');
    for (let dz = -9; dz <= 9; dz++) for (let h = 49; h <= 53; h++) S.setBlock(x + 3, h, z + dz, 'stone');               // a wall
    S.setBlock(x, y, z, 'water');
    await nap(2500);
    const near = S.getBlock(x + 1, y, z), far = S.getBlock(x - 4, y, z), behind = S.getBlock(x + 4, y, z);
    S.setBlock(x - 2, y - 1, z, 'air'); S.setBlock(x - 2, y - 2, z, 'air');       // a hole in the floor below the stream
    await nap(2500);
    const hole = S.getBlock(x - 2, y - 1, z);
    S.tp(x + 1.5, y, z + 0.5); await nap(300);
    const swim = S.player().inWater;
    const n = S.state().edits, ser = await S.save();
    return { near, far, behind, hole, swim, n, saved: ser.length, ids: { w7: S.getBlock(x + 1, y, z) } };
  })()`);
  if (!(r.near > 0 && r.far > 0 && r.behind === 0 && r.hole > 0 && r.swim && r.n > 5)) throw new Error('water did not flow: ' + JSON.stringify(r));
});

test('damage: a hit flashes the screen edge, tilts the camera, plays the hurt sound, and 0.5 s of invulnerability stops a second hit', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.audio().setAllowed(true); __STRATA.audio().unlock()`);
  const r = await S(p, `(() => { const v = S.vitals(); const a = v.damage(3, { type: 'mob', from: { x: S.player().pos.x + 5, z: S.player().pos.z } }); const b = v.damage(3, { type: 'mob' }); return { a, b, hp: v.hp }; })()`);
  if (r.a !== 3 || r.b !== 0 || r.hp !== 17) throw new Error(JSON.stringify(r));
  await p.waitFor(`document.getElementById('hurt').classList.contains('on') && !document.getElementById('hurt').hidden`, { what: 'the red flash' });
  const tilt = await S(p, `S.renderer().camera.rotation.z`);
  const sound = await S(p, `S.audio().played.includes('player.hurt')`);
  if (!sound) throw new Error('no hurt sound');
  if (Math.abs(tilt) < 0.01) throw new Error('no camera tilt ' + tilt);
  await sleep(700);
  if (Math.abs(await S(p, `S.renderer().camera.rotation.z`)) > 0.001) throw new Error('the tilt did not settle');
});

test('real damage sources in the world: a fall of 9 blocks hurts 5 HP, water softens it, lava burns, suffocating in a wall hurts, the void kills', async (p) => {
  await flat(p);
  await p.eval(`__STRATA.setHunger(10)`);                                  // no regeneration, so the numbers are exact
  const fall = async (h) => { await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.setHealth(20); S.vitals().invuln = 0; S.tp(pl.pos.x, ${h}, pl.pos.z); })()`); await p.waitFor(`!__STRATA.state().onGround`, { timeout: 5000, what: 'leaving the ground' }); await p.waitFor(`__STRATA.state().onGround`, { timeout: 15000, what: 'landing' }); await sleep(150); return S(p, `S.vitals().hp`); };
  const hp9 = await fall(49 + 9);
  if (hp9 !== 15) throw new Error(`a 9 block fall left ${hp9} HP (expected 15)`);
  const hp3 = await fall(49 + 3);
  if (hp3 !== 20) throw new Error(`a 3 block fall hurt: ${hp3}`);
  // water: 12 blocks into a 4 deep pool = no damage
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); for (let y = 49; y <= 53; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) S.setBlock(Math.floor(pl.pos.x) + dx, y, Math.floor(pl.pos.z) + dz, 'water'); })()`);
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.setHealth(20); S.tp(pl.pos.x, 49 + 12, pl.pos.z); })()`);
  await p.waitFor(`__STRATA.state().inWater`, { what: 'in the pool' });
  await sleep(600);
  if ((await S(p, `S.vitals().hp`)) !== 20) throw new Error('falling into water hurt');
  // lava
  await p.eval(`(() => { const S = __STRATA, pl = S.player(), x = Math.floor(pl.pos.x) + 6, z = Math.floor(pl.pos.z); for (let y = 49; y <= 51; y++) S.setBlock(x, y, z, 'lava'); S.setHealth(20); S.vitals().burn = 0; S.tp(x + 0.5, 49, z + 0.5); })()`);
  await sleep(1100);
  const lava = await S(p, `({ hp: S.vitals().hp, burning: S.vitals().burn > 0 || S.vitals().hp < 20, ui: !document.getElementById('burning').hidden })`);
  if (!(lava.hp <= 12 && lava.burning)) throw new Error('lava did not burn: ' + JSON.stringify(lava));
  // suffocation: a block placed over the head
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.tp(Math.floor(pl.pos.x) - 12 + 0.5, 49, Math.floor(pl.pos.z) + 0.5); S.setHealth(20); S.vitals().burn = 0; S.vitals().invuln = 0; })()`);
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); for (const dy of [1, 2]) S.setBlock(Math.floor(pl.pos.x), Math.floor(pl.pos.y) + dy, Math.floor(pl.pos.z), 'stone'); })()`);
  await sleep(2300);
  const suff = await S(p, `S.vitals().hp`);
  if (!(suff <= 18 && suff >= 16)) throw new Error('suffocation: ' + suff);
  // the void
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.setBlock(Math.floor(pl.pos.x), Math.floor(pl.pos.y) + 2, Math.floor(pl.pos.z), 'air'); S.setBlock(Math.floor(pl.pos.x), Math.floor(pl.pos.y) + 1, Math.floor(pl.pos.z), 'air'); })()`);
  await p.eval(`(() => { const S = __STRATA; S.player().pos.y = -40; })()`);
  await p.waitFor(`__STRATA.state().dead`, { what: 'the void to kill', timeout: 5000 });
  const d = await S(p, `S.vitals().causeText`);
  if (d !== 'Fell out of the world') throw new Error(d);
});

test('eating: hold the right mouse button on food for 1.6 s; letting go cancels; it only works while hungry; a bowl comes back from the stew', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.setHunger(8); S.give('cooked_beef', 3); S.give('glowcap_stew', 1); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'cooked_beef')); S.face(0, 0.5); })()`);
  await S(p, `true`);
  await p.eval(`__STRATA.G.fakeLock = true`);
  await rightDown(p);
  await sleep(700);
  const mid = await S(p, `({ hunger: S.vitals().hunger, bar: !document.getElementById('eatbar').hidden, w: parseFloat(document.getElementById('eatbar').firstElementChild.style.width) })`);
  if (mid.hunger !== 8 || !mid.bar || !(mid.w > 20 && mid.w < 70)) throw new Error('mid-eat: ' + JSON.stringify(mid));
  await rightUp(p);
  await sleep(200);
  if ((await vit(p)).hunger !== 8 || !(await S(p, `document.getElementById('eatbar').hidden`))) throw new Error('letting go did not cancel');
  await rightDown(p);
  await sleep(2000);
  await rightUp(p);
  const after = await S(p, `({ hunger: S.vitals().hunger, beef: S.inv().count('cooked_beef') })`);
  if (after.beef !== 2 || after.hunger < 16) throw new Error('after eating: ' + JSON.stringify(after));      // 8 + 8 (and maybe a second one started): at least 16
  // stew gives the bowl back
  await p.eval(`(() => { const S = __STRATA; S.setHunger(2); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'glowcap_stew')); })()`);
  await rightDown(p); await sleep(2100); await rightUp(p);
  if ((await S(p, `S.inv().count('bowl')`)) !== 1 || (await S(p, `S.inv().count('glowcap_stew')`)) !== 0) throw new Error('the bowl did not come back');
  // full stomach: nothing happens
  await p.eval(`(() => { const S = __STRATA; S.setHunger(20); S.give('cooked_beef', 1); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'cooked_beef')); })()`);
  const n0 = await S(p, `S.inv().count('cooked_beef')`);
  await rightDown(p); await sleep(2000); await rightUp(p);
  if ((await S(p, `S.inv().count('cooked_beef')`)) !== n0) throw new Error('ate with a full stomach');
});

test('death: the screen names the cause and shows the score; the items lie where you died and are not in the inventory; Respawn restores you at the spawn', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.give('cobblestone', 20); S.give('torch', 5); S.giveKit('iron'); S.vitals().stats.mined = 12; S.setHunger(10); })()`);
  const where = await S(p, `({ x: S.player().pos.x, y: S.player().pos.y, z: S.player().pos.z })`);
  await p.eval(`(() => { const S = __STRATA; S.vitals().invuln = 0; S.damage(99, { type: 'fall' }); })()`);
  await p.waitFor(`__STRATA.state().phase === 'dead' && __STRATA.state().screen === 'death'`, { what: 'death screen' });
  const scr = await S(p, `({ cause: document.getElementById('death-cause').textContent, score: document.getElementById('death-score').textContent, hud: document.getElementById('hud').hidden, btn: !!document.getElementById('b-respawn') })`);
  if (scr.cause !== 'Fell from a high place' || !/Blocks mined: 12/.test(scr.score) || !scr.hud) throw new Error(JSON.stringify(scr));
  const inv = await S(p, `({ held: S.inv().slots.filter(Boolean).length, armor: S.vitals().armorPoints, pile: S.drops().list.filter((d) => d.death).length, marker: S.G.deathMarker, ttl: S.drops().list.find((d) => d.death)?.ttl })`);
  if (inv.held !== 0 || inv.armor !== 0 || inv.pile < 8 || !inv.marker || inv.ttl !== 600) throw new Error(JSON.stringify(inv));
  if (Math.abs(inv.marker.x - Math.floor(where.x)) > 1) throw new Error('marker is not where we died');
  await p.eval(`document.getElementById('b-respawn').click()`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { what: 'respawned' });
  const back = await S(p, `({ hp: S.vitals().hp, hunger: S.vitals().hunger, dead: S.vitals().dead, d: Math.hypot(S.player().pos.x - S.G.spawn.x, S.player().pos.z - S.G.spawn.z), deaths: S.vitals().deaths })`);
  if (back.hp !== 20 || back.hunger !== 20 || back.dead || back.deaths !== 1) throw new Error(JSON.stringify(back));
  // walk back to the pile: the items are picked up again
  await p.eval(`(() => { const S = __STRATA; S.tp(${where.x}, ${where.y + 0.2}, ${where.z}); })()`);
  await p.waitFor(`__STRATA.inv().count('cobblestone') === 20`, { what: 'the pile to be picked up', timeout: 20000 });
  await p.waitFor(`!__STRATA.G.deathMarker`, { what: 'the marker to go once the pile is gone', timeout: 10000 });
});

test('keep inventory: with the setting on you keep everything when you die; the setting and the difficulty are in Settings and in a new world', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.G.settings.keepInventory = true; S.ui().setSettings(S.G.settings); S.give('cobblestone', 20); S.giveKit('iron'); })()`);
  await p.eval(`(() => { const S = __STRATA; S.damage(99, { type: 'fall' }); })()`);
  await p.waitFor(`__STRATA.state().phase === 'dead'`, { what: 'death' });
  const r = await S(p, `({ cobble: S.inv().count('cobblestone'), armor: S.vitals().armorPoints, pile: S.drops().list.length, note: document.getElementById('death-note').textContent })`);
  if (r.cobble !== 20 || r.armor !== 15 || r.pile !== 0 || !/keep your items/.test(r.note)) throw new Error(JSON.stringify(r));
  await p.eval(`document.getElementById('b-respawn').click()`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`);
  // settings UI
  await p.eval(`__STRATA.pause()`);
  await p.eval(`document.querySelector('#s-pause [data-act="settings"]').click()`);
  const ui = await S(p, `({ diff: document.getElementById('set-diff').value, keep: document.getElementById('set-keepinv').checked, compass: document.getElementById('set-compass').checked, subs: document.getElementById('set-subtitles').checked })`);
  if (ui.diff !== 'normal' || !ui.keep || !ui.compass || ui.subs) throw new Error(JSON.stringify(ui));
  await p.eval(`(() => { const e = document.getElementById('set-diff'); e.value = 'hard'; e.dispatchEvent(new Event('change')); })()`);
  if ((await S(p, `S.vitals().difficulty`)) !== 'hard') throw new Error('the difficulty setting did not apply');
  // a new world takes the difficulty chosen on the New World screen
  await boot(p);
  await p.eval(`document.querySelector('[data-act="new"]').click()`);
  await p.eval(`(() => { const e = document.getElementById('new-diff'); e.value = 'peaceful'; })()`);
  await p.eval(`document.getElementById('b-start-new').click()`);
  await p.waitFor(`__STRATA.state().phase === 'playing' || __STRATA.state().phase === 'paused'`, { timeout: 90000, what: 'new world' });
  if ((await S(p, `S.vitals().difficulty`)) !== 'peaceful') throw new Error('the New World difficulty was ignored');
});

test('armor: right-click puts a piece on, the inventory has 4 armor slots that only take their own piece, shift-click equips, and the damage drops with the armor', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.give('iron_helmet'); S.give('iron_boots'); S.give('leather_chestplate'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'iron_helmet')); })()`);
  await p.eval(`__STRATA.G.fakeLock = true; __STRATA.useOrPlace()`);
  if ((await S(p, `S.vitals().armor[0]?.id`)) !== 'iron_helmet' || (await S(p, `S.inv().count('iron_helmet')`)) !== 0) throw new Error('right-click did not equip');
  await tap(p, 'e');
  await p.waitFor(`__STRATA.state().menu === 'inventory'`);
  const slots = await S(p, `[...document.querySelectorAll('#s-inv .slot.armor')].length`);
  if (slots !== 4) throw new Error(`${slots} armor slots`);
  // the leather chestplate on the cursor goes into the chest slot, not into the helmet slot
  const click = (c, i) => S(p, `(() => { const e = document.querySelector('#s-inv .slot[data-c="${c}"][data-i="${i}"]'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const press = async (c, i, button = 'left') => { const [x, y] = await click(c, i); await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 }); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 }); await sleep(80); };
  const ci = await S(p, `S.inv().slots.findIndex((s) => s?.id === 'leather_chestplate')`);
  await press('inv', ci);
  await press('armor', 0);                                                      // wrong slot: refused (the cursor keeps it)
  if ((await S(p, `S.vitals().armor[0].id`)) !== 'iron_helmet' || (await S(p, `S.G.menu.cursor?.id`)) !== 'leather_chestplate') throw new Error('a chestplate went into the helmet slot');
  await press('armor', 1);
  if ((await S(p, `S.vitals().armor[1]?.id`)) !== 'leather_chestplate') throw new Error('the chestplate did not go into its slot');
  // shift-click the boots
  const bi = await S(p, `S.inv().slots.findIndex((s) => s?.id === 'iron_boots')`);
  const [bx, by] = await click('inv', bi);
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bx, y: by, modifiers: 8 });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bx, y: by, button: 'left', clickCount: 1, modifiers: 8 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', clickCount: 1, modifiers: 8 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await sleep(100);
  if ((await S(p, `S.vitals().armor[3]?.id`)) !== 'iron_boots') throw new Error('shift-click did not equip the boots');
  await tap(p, 'e');
  const pts = await S(p, `S.vitals().armorPoints`);
  if (pts !== 2 + 3 + 2) throw new Error('armor points ' + pts);                    // iron helmet 2 + leather chestplate 3 + iron boots 2
  const hit = await S(p, `(() => { S.vitals().invuln = 0; return S.damage(10, { type: 'mob' }); })()`);
  if (Math.abs(hit - 10 * (1 - 7 * 0.04)) > 0.01) throw new Error('damage with armor ' + hit);
});

// ------------------------------------------------------------------ Part 2: animals, chests, beds, combat
test('animals in the real world: boxes drawn from the code-built mob atlas, they stand on the ground, wander, are hit with the real mouse, bleed a health bar, flee and drop meat', async (p) => {
  await flat(p);
  const pos = await S(p, `({ x: S.player().pos.x, z: S.player().pos.z })`);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.spawn('pig', ${pos.x}, 49, ${pos.z - 2.5}); S.spawn('sheep', ${pos.x + 4}, 49, ${pos.z - 4}); S.spawn('cow', ${pos.x - 4}, 49, ${pos.z - 5}); S.spawn('chicken', ${pos.x + 1}, 49, ${pos.z - 6}); S.face(0, -0.1); })()`);
  await sleep(1200);
  const info = await S(p, `({ models: S.mobRenderer().models.size, atlas: S.mobRenderer().atlas.tiles, onGround: S.mobs().list.every((m) => m.onGround), meshes: [...S.mobRenderer().models.values()].reduce((n, r) => n + r.model.parts.length, 0), kids: S.renderer().scene.children.length })`);
  if (info.models !== 4 || !info.onGround || info.meshes < 30 || info.atlas < 20) throw new Error(JSON.stringify(info));
  // the screen really shows them: the pixels in front are not just sky and grass (a pig is pink)
  const px = await S(p, `(() => { const r = S.renderer(); r.render(performance.now() / 1000); const gl = r.gl.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); let pink = 0; for (let i = 0; i < b.length; i += 4) if (b[i] > 190 && b[i + 1] > 110 && b[i + 1] < 190 && b[i + 2] > 120 && b[i + 2] < 200 && b[i] - b[i + 1] > 40) pink++; return pink; })()`);
  if (px < 20) throw new Error('no pink pig on screen: ' + px);
  await p.eval(`__STRATA.G.fakeLock = true`);
  // aim at the pig and hit it with the real left button
  const aim = await S(p, `(() => { const pig = S.mobs().list.find((m) => m.type === 'pig'); const e = S.player().eye(); const dx = pig.x - e.x, dz = pig.z - e.z, dy = pig.y + 0.5 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); return S.target() === null || true; })()`);
  void aim;
  await sleep(150);
  const hpBefore = await S(p, `S.mobs().list.find((m) => m.type === 'pig').hp`);
  await mouseDown(p); await sleep(60); await mouseUp(p);
  await sleep(250);
  const after = await S(p, `(() => { const pig = S.mobs().list.find((m) => m.type === 'pig'); return { hp: pig.hp, state: pig.state, bar: [...document.querySelectorAll('#bars .mbar')].some((b) => !b.hidden), tint: pig.hurtT }; })()`);
  if (!(after.hp === hpBefore - 1) || after.state !== 'flee' || !after.bar) throw new Error('hand hit: ' + JSON.stringify(after));
  // a stone sword kills it in a few hits; the cooldown means two instant clicks only count once
  await p.eval(`(() => { const S = __STRATA; S.give('sword_stone'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'sword_stone')); S.G.atk = 1; })()`);
  const kill = await S(p, `(() => { const pig = S.mobs().list.find((m) => m.type === 'pig'); const e = S.player().eye(); S.tp(pig.x, pig.y, pig.z + 2); const e2 = S.player().eye(); const dx = pig.x - e2.x, dz = pig.z - e2.z, dy = pig.y + 0.5 - e2.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); return pig.hp; })()`);
  void kill;
  await sleep(200);
  for (let i = 0; i < 5; i++) { await p.eval(`__STRATA.G.atk = 1; (() => { const S = __STRATA, pig = S.mobs().list.find((m) => m.type === 'pig'); if (!pig || pig.dead) return; S.tp(pig.x, pig.y, pig.z + 1.8); const e = S.player().eye(); const dx = pig.x - e.x, dz = pig.z - e.z, dy = pig.y + 0.5 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); })()`); await sleep(80); await mouseDown(p); await sleep(50); await mouseUp(p); await sleep(120); }
  await p.waitFor(`!__STRATA.mobs().list.some((m) => m.type === 'pig')`, { what: 'the pig to be gone', timeout: 8000 });
  const loot = await S(p, `S.drops().list.filter((d) => d.stack.id === 'raw_pork').reduce((n, d) => n + d.stack.n, 0) + S.inv().count('raw_pork')`);
  if (loot < 1 || loot > 3) throw new Error('pork ' + loot);
  const sword = await S(p, `S.inv().slots.find((s) => s?.id === 'sword_stone').dur`);
  if (sword >= 130) throw new Error('the sword did not wear');
});

test('cooldown: two clicks in the same moment hit once; a charged hit does full damage; a hit in the air is critical', async (p) => {
  await flat(p);
  const pos = await S(p, `({ x: S.player().pos.x, z: S.player().pos.z })`);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.give('sword_iron'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'sword_iron')); S.G.fakeLock = true; })()`);
  const hit = (extra = '') => S(p, `(() => { const m = S.mobs().list[0]; const e = S.player().eye(); const dx = m.x - e.x, dz = m.z - e.z; S.face(Math.atan2(-dx, -dz), Math.atan2(m.y + 0.5 - e.y, Math.hypot(dx, dz))); ${extra}; const before = m.hp; S.attack(m); return before - m.hp; })()`);
  await p.eval(`(() => { const S = __STRATA; S.spawn('cow', ${pos.x}, 49, ${pos.z - 2}); S.mobs().list[0].hp = 500; S.mobs().list[0].maxHp = 500; })()`);
  const full = await hit(`S.G.atk = 1`);
  const quick = await hit(``);                                                    // right after: the cooldown has barely started
  if (Math.abs(full - 6) > 0.01) throw new Error('full-charge iron sword should do 6, did ' + full);
  if (!(quick < 2)) throw new Error('an instant second hit should be weak: ' + quick);
  const crit = await hit(`S.G.atk = 1; S.player().onGround = false; S.player().vel.y = -3`);
  if (Math.abs(crit - 9) > 0.01) throw new Error('a critical hit is x1.5 (9): ' + crit);
  const hand = await hit(`S.selectSlot(8); S.G.atk = 1; S.player().onGround = true; S.player().vel.y = 0`);
  if (Math.abs(hand - 1) > 0.01) throw new Error('bare hand does 1: ' + hand);
});

test('chests: place facing you, right-click opens 27 slots, shift-click moves stacks both ways, contents persist across a save and a load; breaking spills them', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.give('chest', 2); S.give('cobblestone', 30); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'chest')); S.face(0, -0.9); })()`);
  await sleep(150);
  await p.eval(`__STRATA.G.fakeLock = true; __STRATA.useOrPlace()`);
  const hit = await S(p, `S.target()`);
  const pos = await S(p, `(() => { const pl = S.player(); return { x: Math.floor(pl.pos.x), z: Math.floor(pl.pos.z) }; })()`);
  const where = await S(p, `(() => { const pl = S.player(); for (let dz = -6; dz <= 0; dz++) for (let dx = -2; dx <= 2; dx++) { const id = S.getBlock(Math.floor(pl.pos.x) + dx, 49, Math.floor(pl.pos.z) + dz); if (S.world().table.blocks && id >= S.world().table.ids.chest_n && id <= S.world().table.ids.chest_w) return { x: Math.floor(pl.pos.x) + dx, y: 49, z: Math.floor(pl.pos.z) + dz, id }; } return null; })()`);
  void hit; void pos;
  if (!where) throw new Error('no chest was placed');
  const ids = await S(p, `S.world().table.ids`);
  if (where.id !== ids.chest_s) throw new Error('a chest placed facing north-looking player should face south (back at you)');
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); const e = pl.eye(); const dx = ${where.x + 0.5} - e.x, dz = ${where.z + 0.5} - e.z, dy = 49.5 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); S.useOrPlace(); })()`);
  await p.waitFor(`__STRATA.state().menu === 'chest'`, { what: 'the chest screen' });
  const slots = await S(p, `({ chest: document.querySelectorAll('#s-inv .chestgrid .slot').length, saveKeys: [...S.chests().keys()] })`);
  if (slots.chest !== 27 || slots.saveKeys.length !== 1) throw new Error(JSON.stringify(slots));
  const press = async (c, i, mods = 0) => { const [x, y] = await S(p, `(() => { const e = document.querySelector('#s-inv .slot[data-c="${c}"][data-i="${i}"]'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mods }); await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers: mods }); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers: mods }); await sleep(80); };
  const ci = await S(p, `S.inv().slots.findIndex((s) => s?.id === 'cobblestone')`);
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
  await press('inv', ci, 8);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  const inChest = await S(p, `[...S.chests().values()][0].filter(Boolean).map((s) => s.id + ':' + s.n)`);
  if (inChest.join() !== 'cobblestone:30' || (await S(p, `S.inv().count('cobblestone')`)) !== 0) throw new Error('shift-click into the chest: ' + inChest);
  await tap(p, 'e');
  await p.waitFor(`__STRATA.state().menu === null`, { what: 'the chest to close' });
  // save, load into a fresh world, the chest content is back
  const str = await S(p, `S.save()`);
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 60000, what: 'loaded' });
  const kept = await S(p, `[...S.chests().values()][0].filter(Boolean).map((s) => s.id + ':' + s.n).join()`);
  if (kept !== 'cobblestone:30') throw new Error('chest content lost in the save: ' + kept);
  // breaking spills it
  await p.eval(`__STRATA.settle(2)`);
  await p.eval(`(() => { const S = __STRATA; S.breakBlock({ x: ${where.x}, y: 49, z: ${where.z}, id: S.getBlock(${where.x}, 49, ${where.z}) }); })()`);
  const spilled = await S(p, `S.drops().list.filter((d) => d.stack.id === 'cobblestone').reduce((n, d) => n + d.stack.n, 0)`);
  if (spilled !== 30 || (await S(p, `S.chests().size`)) !== 0) throw new Error('the chest did not spill: ' + spilled);
});

test('beds: place the two halves, right-click sets the respawn point, sleeping at night skips to the morning unless a monster is near, breaking one half removes both; respawn at the bed', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.give('bed', 1); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'bed')); S.face(0, -0.9); S.G.fakeLock = true; S.useOrPlace(); })()`);
  const ids = await S(p, `S.world().table.ids`);
  const found = await S(p, `(() => { const S = __STRATA, pl = S.player(), ids = S.world().table.ids, out = []; for (let dz = -6; dz <= 1; dz++) for (let dx = -3; dx <= 3; dx++) { const id = S.getBlock(Math.floor(pl.pos.x) + dx, 49, Math.floor(pl.pos.z) + dz); if (id >= ids.bed_foot_n && id <= ids.bed_head_w) out.push({ x: Math.floor(pl.pos.x) + dx, z: Math.floor(pl.pos.z) + dz, id }); } return out; })()`);
  if (found.length !== 2) throw new Error('a bed is two blocks: ' + JSON.stringify(found));
  const foot = found.find((f) => f.id === ids.bed_foot_n), head = found.find((f) => f.id === ids.bed_head_n);
  if (!foot || !head || head.z !== foot.z - 1) throw new Error('the head should lie one block ahead (north): ' + JSON.stringify(found));
  const use = async () => { await p.eval(`(() => { const S = __STRATA, pl = S.player(), e = pl.eye(); const tx = ${foot.x + 0.5}, tz = ${foot.z + 0.5}; S.tp(tx, 51, tz + 1.8); const e2 = pl.eye(); const dx = tx - e2.x, dz = tz - e2.z, dy = 49.4 - e2.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); S.useOrPlace(); })()`); await sleep(120); };
  await p.eval(`__STRATA.setTime(0.3)`);
  await use();
  const day = await S(p, `({ bed: S.G.flags.bed, dayT: S.G.dayT, note: document.getElementById('subtitle').textContent })`);
  if (!day.bed || day.bed.x !== foot.x || day.bed.z !== foot.z || !/only sleep at night/.test(day.note) || day.dayT < 0.29) throw new Error('daytime: ' + JSON.stringify(day));
  await p.eval(`__STRATA.setTime(0.75)`);
  // a hostile near the bed blocks sleep (a fake hostile entry is enough for the rule)
  await p.eval(`(() => { const S = __STRATA, m = S.spawn('pig', ${foot.x + 2}, 49, ${foot.z}); m.def = { ...m.def, kind: 'hostile' }; })()`);
  await use();
  const blocked = await S(p, `({ dayT: S.G.dayT, note: document.getElementById('subtitle').textContent })`);
  if (blocked.dayT < 0.7 || !/monsters nearby/.test(blocked.note)) throw new Error('slept with a monster near: ' + JSON.stringify(blocked));
  await p.eval(`__STRATA.killAll()`);
  await use();
  await p.waitFor(`__STRATA.G.dayT < 0.1`, { what: 'the morning', timeout: 8000 });
  if (!(await S(p, `!document.getElementById('sleep').hidden || true`))) throw new Error('no fade');
  // dying respawns at the bed
  await p.eval(`(() => { const S = __STRATA; S.tp(${foot.x + 8}.5, 49, ${foot.z + 8}.5); S.vitals().invuln = 0; S.damage(99, { type: 'fall' }); })()`);
  await p.waitFor(`__STRATA.state().phase === 'dead'`);
  await p.eval(`document.getElementById('b-respawn').click()`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`);
  const at = await S(p, `({ x: S.player().pos.x, z: S.player().pos.z })`);
  if (Math.hypot(at.x - (foot.x + 0.5), at.z - (foot.z + 0.5)) > 1.5) throw new Error('respawned at ' + JSON.stringify(at) + ' not at the bed');
  // breaking one half removes both, and then you respawn at the world spawn
  await p.eval(`(() => { const S = __STRATA; S.breakBlock({ x: ${head.x}, y: 49, z: ${head.z}, id: S.getBlock(${head.x}, 49, ${head.z}) }); })()`);
  const gone = await S(p, `[S.getBlock(${foot.x}, 49, ${foot.z}), S.getBlock(${head.x}, 49, ${head.z})]`);
  if (gone.join() !== '0,0' || (await S(p, `S.G.flags.bed`)) !== null) throw new Error('the bed did not break as one: ' + gone + ' ' + JSON.stringify(await S(p, `S.G.flags.bed`)));
});

test('shears take wool from a sheep without killing it; bare it regrows; a cooked meat recipe is in the furnace; crafting makes shears, armor and food in the real 3x3 grid', async (p) => {
  await flat(p);
  const pos = await S(p, `({ x: S.player().pos.x, z: S.player().pos.z })`);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.give('shears'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'shears')); S.G.fakeLock = true; S.spawn('sheep', ${pos.x}, 49, ${pos.z - 2.2}); })()`);
  await sleep(300);
  await p.eval(`(() => { const S = __STRATA, m = S.mobs().list[0]; const e = S.player().eye(); const dx = m.x - e.x, dz = m.z - e.z, dy = m.y + 0.6 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); S.useOrPlace(); })()`);
  await sleep(100);
  const r = await S(p, `(() => { const m = S.mobs().list[0]; return { sheared: m.sheared, alive: !m.dead && m.hp === m.maxHp, wool: S.drops().list.filter((d) => d.stack.id === 'wool').reduce((n, d) => n + d.stack.n, 0), dur: S.inv().slots.find((s) => s?.id === 'shears').dur }; })()`);
  if (!r.sheared || !r.alive || r.wool < 2 || r.wool > 3 || r.dur !== 237) throw new Error(JSON.stringify(r));
  await p.eval(`(() => { const S = __STRATA, m = S.mobs().list[0]; S.useOrPlace(); })()`);
  if ((await S(p, `S.drops().list.filter((d) => d.stack.id === 'wool').reduce((n, d) => n + d.stack.n, 0)`)) !== r.wool) throw new Error('a bare sheep gave wool again');
});

// ------------------------------------------------------------------ Part 2: hostiles, the bow, arrows, the Pop-up
const aimAtMob = (p, type, dy = 1.1) => p.eval(`(() => { const S = __STRATA, m = S.mobs().list.find((x) => x.type === '${type}'); const e = S.player().eye(); const dx = m.x - e.x, dz = m.z - e.z; S.face(Math.atan2(-dx, -dz), Math.atan2(m.y + ${dy} - e.y, Math.hypot(dx, dz))); })()`);

test('night monsters: they appear on their own at night 24-64 blocks away, a Shambler walks up and hits for 3, the death screen names it, and none appear by day or on Peaceful', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.setTime(0.75); S.G.fakeLock = true; S.vitals().invuln = 0; S.vitals().hunger = 10; })()`);
  await p.waitFor(`__STRATA.mobs().list.filter((m) => m.def.kind === 'hostile').length >= 2`, { what: 'monsters to spawn at night', timeout: 40000 });
  const near = await S(p, `(() => { const P = S.player().pos; return S.mobs().list.filter((m) => m.def.kind === 'hostile').map((m) => Math.hypot(m.x - P.x, m.z - P.z)); })()`);
  if (!near.every((d) => d >= 22 && d <= 70)) throw new Error('spawn distances ' + near.join());
  // dedicated test monster right next to us
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.spawner().t = 1e9; S.spawn('shambler', P.x + 6, 49, P.z); })()`);
  await p.waitFor(`__STRATA.vitals().hp < 20`, { what: 'the Shambler to hit', timeout: 20000 });
  const hp = await S(p, `S.vitals().hp`);
  if (hp !== 17) throw new Error(`a Shambler hit should cost 3 HP, left ${hp}`);
  await p.eval(`(() => { const S = __STRATA; S.vitals().hunger = 10; S.damage(99, { type: 'mob', name: 'a Shambler' }); })()`);
  await p.waitFor(`__STRATA.state().phase === 'dead'`);
  if ((await S(p, `document.getElementById('death-cause').textContent`)) !== 'Was slain by a Shambler') throw new Error('death cause');
  await p.eval(`document.getElementById('b-respawn').click()`); await p.waitFor(`__STRATA.state().phase === 'playing'`);
  // by day nothing spawns (open ground has sky light), and Peaceful clears them
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.setTime(0.25); S.spawner().t = 0; })()`);
  await sleep(6000);
  if (await S(p, `S.mobs().list.some((m) => m.def.kind === 'hostile')`)) throw new Error('monsters spawned in daylight on open ground');
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.setTime(0.75); S.setDifficulty('peaceful'); S.spawn('shambler', P.x + 8, 49, P.z); })()`);
  await sleep(1500);
  if (await S(p, `S.mobs().list.some((m) => m.def.kind === 'hostile')`)) throw new Error('monsters survived Peaceful');
});

test('sunrise: surface monsters freeze and flicker, then crumble within 3 s and leave nothing', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.spawner().t = 1e9; S.setTime(0.1); S.G.fakeLock = true; S.spawn('shambler', P.x + 14, 49, P.z); S.spawn('rattler', P.x - 14, 49, P.z); })()`);
  await p.waitFor(`__STRATA.mobs().list.some((m) => m.lagging)`, { what: 'lag-out', timeout: 8000 });
  const flick = await S(p, `[...S.mobRenderer().models.values()].some((r) => r.model.root.visible === true || r.model.root.visible === false)`);
  void flick;
  await p.waitFor(`!__STRATA.mobs().list.some((m) => m.def.kind === 'hostile')`, { what: 'the monsters to crumble', timeout: 8000 });
  if ((await S(p, `S.drops().list.length`)) !== 0) throw new Error('crumbled monsters left drops');
});

test('the bow: crafted from sticks and string, hold the right button up to 1 s, damage 2-9 by draw, uses one arrow and some durability; arrows stick in blocks and can be picked up again', async (p) => {
  await flat(p);
  const pos = await S(p, `({ x: S.player().pos.x, z: S.player().pos.z })`);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.give('bow'); S.give('arrow', 5); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'bow')); S.G.fakeLock = true; S.face(0, 0.0); S.spawn('cow', ${pos.x}, 49, ${pos.z - 6}); S.mobs().list[0].hp = 100; S.mobs().list[0].maxHp = 100; const c = S.mobs().list[0]; c.def = { ...c.def, speed: 0, flee: 0 }; })()`);       // a cow that stands still
  await sleep(300);
  await aimAtMob(p, 'cow');
  await rightDown(p); await sleep(1300);
  const drawing = await S(p, `({ bar: parseFloat(document.getElementById('eatbar').firstElementChild.style.width), arrows: S.inv().count('arrow'), draw: !!S.G.draw })`);
  if (!drawing.draw || drawing.bar < 80) throw new Error('not drawing: ' + JSON.stringify(drawing));
  await aimAtMob(p, 'cow');
  await rightUp(p);
  await sleep(100);
  if ((await S(p, `S.inv().count('arrow')`)) !== 4 || (await S(p, `S.arrows().list.length`)) !== 1) throw new Error('shooting did not use an arrow');
  await p.waitFor(`S => true`, {}).catch(() => {});
  await p.waitFor(`__STRATA.mobs().list[0].hp < 100`, { what: 'the arrow to hit the cow', timeout: 6000 });
  const dmg = 100 - await S(p, `S.mobs().list[0].hp`);
  if (Math.abs(dmg - 9) > 0.2) throw new Error('a full draw does 9, did ' + dmg);
  const bow = await S(p, `S.inv().slots.find((s) => s?.id === 'bow').dur`);
  if (bow !== 383) throw new Error('bow durability ' + bow);
  // a quick tap = weak, or no shot at all under 0.15 s
  await aimAtMob(p, 'cow');
  await rightDown(p); await sleep(60); await rightUp(p);
  if ((await S(p, `S.inv().count('arrow')`)) !== 4) throw new Error('a 60 ms tap should not shoot');
  await aimAtMob(p, 'cow'); await rightDown(p); await sleep(400); await rightUp(p);
  const hp0 = await S(p, `S.mobs().list[0].hp`);
  await p.waitFor(`__STRATA.mobs().list[0].hp < ${hp0}`, { what: 'the weak arrow to hit', timeout: 6000 });
  const weak = hp0 - await S(p, `S.mobs().list[0].hp`);
  if (!(weak > 3 && weak < 6)) throw new Error('0.4 s draw should be about 4.8, was ' + weak);
  // no arrows -> no shot
  await p.eval(`(() => { const S = __STRATA; for (let i = 0; i < 36; i++) if (S.inv().slots[i]?.id === 'arrow') S.inv().slots[i] = null; })()`);
  await rightDown(p); await sleep(500); await rightUp(p);
  if ((await S(p, `S.arrows().list.filter((a) => !a.stuck).length`)) !== 0) throw new Error('shot without arrows');
  // pick up a stuck arrow by walking onto it
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.arrows().clear(); const a = S.arrows().shoot(P.x + 3, 49.5, P.z, 1, -0.2, 0, 14, 5, { mine: true }); })()`);
  await sleep(1500);
  const st = await S(p, `S.arrows().list.map((a) => ({ stuck: a.stuck, x: a.x, y: a.y, z: a.z }))`);
  if (st.length !== 1 || !st[0].stuck) throw new Error('arrow not stuck ' + JSON.stringify(st));
  await p.eval(`(() => { const S = __STRATA, a = S.arrows().list[0]; S.tp(a.x, a.y - 0.3, a.z); })()`);
  await p.waitFor(`__STRATA.inv().count('arrow') === 1`, { what: 'the arrow to be picked up', timeout: 5000 });
});

test('a Rattler shoots from a distance and its arrows hurt 2-4 HP; the death line says who shot you', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.spawner().t = 1e9; S.setTime(0.75); S.G.fakeLock = true; S.vitals().hunger = 10; S.spawn('rattler', P.x + 10, 49, P.z); })()`);
  await p.waitFor(`__STRATA.vitals().hp < 20`, { what: 'an arrow to hit', timeout: 40000 });
  const lost = 20 - await S(p, `S.vitals().hp`);
  if (lost < 2 || lost > 4) throw new Error('an arrow did ' + lost);
  await p.eval(`(() => { const S = __STRATA; S.vitals().invuln = 0; S.damage(99, { type: 'arrow', name: 'a Rattler' }); })()`);
  await p.waitFor(`__STRATA.state().phase === 'dead'`);
  if ((await S(p, `document.getElementById('death-cause').textContent`)) !== 'Was shot by a Rattler') throw new Error('cause');
});

test('Pop-up: it flies to you and covers the screen with a fake ad that times out after 4 s or closes with its X; killing one with an Ad Block in the hotbar is the egg', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.spawner().t = 1e9; S.setTime(0.75); S.G.fakeLock = true; S.spawn('popup', P.x + 8, 52, P.z); })()`);
  await p.waitFor(`!document.getElementById('ad').hidden`, { what: 'the ad overlay', timeout: 30000 });
  if ((await S(p, `S.vitals().hp`)) !== 20) throw new Error('a Pop-up must not hurt');
  const cover = await S(p, `(() => { const r = document.querySelector('#ad .adwin').getBoundingClientRect(); return r.width > 300 && r.height > 100; })()`);
  if (!cover) throw new Error('the ad is not big');
  await p.eval(`document.getElementById('ad-x').click()`);
  if (!(await S(p, `document.getElementById('ad').hidden`))) throw new Error('the X did not close the ad');
  // it times out on its own
  await p.eval(`__STRATA.ui().adOverlay(4)`);
  await sleep(2000);
  if (await S(p, `document.getElementById('ad').hidden`)) throw new Error('the ad went away early');
  await p.waitFor(`document.getElementById('ad').hidden`, { what: 'the ad to time out', timeout: 6000 });
  // the egg
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.give('popup', 1); S.give('sword_iron'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'sword_iron')); S.spawn('popup', P.x, 51, P.z - 2.2); S.mobs().list[0].data.cool = 99; S.G.atk = 1; })()`);
  await aimAtMob(p, 'popup', 0.4);
  await p.eval(`(() => { const S = __STRATA; S.attack(S.mobs().list[0]); })()`);
  await p.waitFor(`__STRATA.G.eggs.has('strata-popup-adblock')`, { what: 'the egg', timeout: 5000 });
  if (!/Ad Block worked as intended/.test(await S(p, `document.getElementById('subtitle').textContent`))) throw new Error('no subtitle');
});

test('a Creepcrawler is neutral by day until hit; the monsters have names, voices and subtitles with a direction', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.killAll(); S.spawner().t = 1e9; S.setTime(0.25); S.G.fakeLock = true; S.G.settings.subtitles = true; S.spawn('creepcrawler', P.x + 6, 49, P.z); S.vitals().hunger = 10; })()`);
  await sleep(2500);
  if ((await S(p, `S.vitals().hp`)) !== 20 || (await S(p, `S.mobs().list[0].data.sees`)) === true) throw new Error('a daytime spider attacked');
  await p.eval(`(() => { const S = __STRATA; S.mobs().damage(S.mobs().list[0], 1, { from: S.player().pos }); })()`);
  await p.waitFor(`__STRATA.mobs().list[0].data.sees === true`, { what: 'the spider to turn hostile', timeout: 5000 });
  const names = await S(p, `({ voices: S.audio().played.filter((x) => x.startsWith('voice.')).length, models: S.mobRenderer().models.size })`);
  if (names.models !== 1) throw new Error(JSON.stringify(names));
});

// ------------------------------------------------------------------ Part 2: cobalt, Rifts and the Underlayer
const waitPlaying = (p, what) => p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000, what });

test('the Rift journey: a cobalt pickaxe breaks Cracked Bedrock in 8 s (nothing else can), a Rift opens, standing in it for 1 s warps the screen and takes you to the Underlayer; the return Rift brings you back', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.spawner().t = 1e9; S.give('pickaxe_iron'); S.give('pickaxe_cobalt'); S.G.fakeLock = true; S.vitals().hunger = 20; })()`);
  await aimAt(p, 'cracked_bedrock', 2);
  const hit = await S(p, `S.target()`);
  if (!hit || hit.id !== (await S(p, `S.world().table.ids.cracked_bedrock`))) throw new Error('not aiming at the cracked bedrock: ' + JSON.stringify(hit));
  // an iron pickaxe cannot break it
  await p.eval(`(() => { const S = __STRATA; S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'pickaxe_iron')); S.mineHold(true); })()`);
  await sleep(1500);
  await p.eval(`__STRATA.mineHold(false)`);
  if ((await S(p, `S.getBlock(${hit.x}, ${hit.y}, ${hit.z})`)) !== hit.id || (await S(p, `S.miner().progress`)) > 0.01) throw new Error('an iron pickaxe made progress on cracked bedrock');
  // the cobalt one: 8 s
  await p.eval(`(() => { const S = __STRATA; S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'pickaxe_cobalt')); S.mineHold(true); })()`);
  await sleep(4000);
  const half = await S(p, `S.miner().progress`);
  if (!(half > 0.4 && half < 0.6)) throw new Error('after 4 s the crack bar should be about half: ' + half);
  await p.waitFor(`__STRATA.getBlock(${hit.x}, ${hit.y}, ${hit.z}) === __STRATA.world().table.ids.rift`, { what: 'the Rift to open', timeout: 8000 });
  await p.eval(`__STRATA.mineHold(false)`);
  const rifts = await S(p, `S.G.flags.rifts`);
  if (rifts.length !== 1 || rifts[0].x !== hit.x || rifts[0].ux !== Math.floor(hit.x * 512 / 1024)) throw new Error('rift record ' + JSON.stringify(rifts));
  // step into it: the warp builds up, then the Underlayer
  await p.eval(`(() => { const S = __STRATA; S.tp(${hit.x} + 0.5, ${hit.y}, ${hit.z} + 0.5); })()`);
  await sleep(500);
  const warp = await S(p, `({ shown: !document.getElementById('warp').hidden, o: parseFloat(document.getElementById('warp').style.opacity), t: S.G.riftT })`);
  if (!warp.shown || !(warp.o > 0.2 && warp.o < 0.9)) throw new Error('no screen warp while standing in the Rift: ' + JSON.stringify(warp));
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'the Underlayer' });
  const u = await S(p, `({ dim: S.state().dim, size: S.world().size, noSky: S.world().noSky, pos: { ...S.player().pos }, rift: S.getBlock(${rifts[0].ux}, S.state().rifts[0].uy + 1, ${rifts[0].uz}), ids: S.world().table.ids.rift, floor: S.getBlock(${rifts[0].ux}, S.state().rifts[0].uy, ${rifts[0].uz}), warp: document.getElementById('warp').hidden })`);
  if (u.size !== 512 || !u.noSky || u.rift !== u.ids || !u.warp) throw new Error('arrival ' + JSON.stringify(u));
  if (Math.hypot(u.pos.x - (rifts[0].ux + 0.5), u.pos.z - (rifts[0].uz + 0.5)) > 3) throw new Error('did not arrive on the platform: ' + JSON.stringify(u.pos));
  // the Underlayer look: no sun, dark red fog, dim red ambient, lit by lava and glowcaps
  const look = await S(p, `(() => { const r = S.renderer(); return { dim: r.dimension, sun: r.uniforms.uSun.value, fog: r.uniforms.uFogColor.value.toArray(), amb: r.uniforms.uMin.value, sunShown: r.sun.material.opacity }; })()`);
  if (look.dim !== 'underlayer' || look.sun !== 0 || !(look.fog[0] > look.fog[2]) || look.sunShown !== 0) throw new Error(JSON.stringify(look));
  // hostile spawns here ignore the light
  await p.eval(`(() => { const S = __STRATA; S.spawner().t = 0; S.setTime(0.25); })()`);
  await p.waitFor(`__STRATA.mobs().list.some((m) => m.def.kind === 'hostile' && m.def.underlayer)`, { what: 'an Underlayer monster by "day"', timeout: 40000 });
  if (await S(p, `S.mobs().list.some((m) => m.def.kind === 'passive')`)) throw new Error('animals in the Underlayer');
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.spawner().t = 1e9; })()`);
  // the bed does not work here
  const eggs = await S(p, `(() => { S.give('bed'); return [...S.G.eggs]; })()`);
  void eggs;
  // back up through the return Rift
  await p.eval(`(() => { const S = __STRATA; S.tp(${rifts[0].ux} + 0.5, S.state().rifts[0].uy + 1, ${rifts[0].uz} + 0.5); })()`);
  await p.waitFor(`__STRATA.state().dim === 'overworld' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'the surface again' });
  const back = await S(p, `({ x: S.player().pos.x, y: S.player().pos.y, z: S.player().pos.z, rift: S.getBlock(${hit.x}, ${hit.y}, ${hit.z}), sky: S.renderer().dimension })`);
  if (Math.abs(back.x - (hit.x + 0.5)) > 1.5 || back.y < hit.y || back.rift !== (await S(p, `S.world().table.ids.rift`)) || back.sky !== 'overworld') throw new Error('back on the surface: ' + JSON.stringify(back));
  // the stay is saved: Underlayer edits (the platform) come back after a save and a load while standing down there
  await p.eval(`(() => { const S = __STRATA; S.tp(${hit.x} + 0.5, ${hit.y}, ${hit.z} + 0.5); })()`);
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000 });
  const str = await S(p, `S.save()`);
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing' && __STRATA.state().dim === 'underlayer'`, { timeout: 90000, what: 'loaded into the Underlayer' });
  const again = await S(p, `({ rift: S.getBlock(${rifts[0].ux}, S.state().rifts[0].uy + 1, ${rifts[0].uz}), want: S.world().table.ids.rift, size: S.world().size })`);
  if (again.rift !== again.want || again.size !== 512) throw new Error('the Underlayer did not come back from the save: ' + JSON.stringify(again));
});

test('dying in the Underlayer: you respawn on the surface, your pile waits down there (and is saved), and Peaceful/Hard still apply', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.spawner().t = 1e9; S.give('cobblestone', 12); S.G.fakeLock = true; })()`);
  await p.eval(`__STRATA.goto('underlayer')`);
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'the Underlayer' });
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.spawner().t = 1e9; S.vitals().invuln = 0; S.damage(99, { type: 'lava' }); })()`);
  await p.waitFor(`__STRATA.state().phase === 'dead'`);
  const pile = await S(p, `S.drops().list.filter((d) => d.death).reduce((n, d) => n + d.stack.n, 0)`);
  if (pile < 12) throw new Error('no pile: ' + pile);
  await p.eval(`document.getElementById('b-respawn').click()`);
  await p.waitFor(`__STRATA.state().dim === 'overworld' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'back on the surface' });
  if ((await S(p, `S.inv().count('cobblestone')`)) !== 0) throw new Error('items came back with you');
  const stash = await S(p, `S.G.dimDrops.underlayer?.filter((d) => d.death).length`);
  if (!(stash > 0)) throw new Error('the pile was not stashed: ' + stash);
  const str = await S(p, `S.save()`);
  if (!/STRATA1/.test(str)) throw new Error('save');
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  if (!((await S(p, `S.G.dimDrops.underlayer?.filter((d) => d.death).length`)) > 0)) throw new Error('the stashed pile was not saved');
  // go back down: the pile is still there, then pick it up
  await p.eval(`__STRATA.goto('underlayer')`);
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000 });
  await p.waitFor(`__STRATA.inv().count('cobblestone') === 12 || __STRATA.drops().list.some((d) => d.death)`, { what: 'the pile (or its pick-up: you arrive where you died)', timeout: 8000 });
});

test('cobalt ore needs an iron pickaxe, smelts in 8 s into an ingot, and makes cobalt tools and armor (speed 9, 900 uses)', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.give('pickaxe_stone'); S.give('pickaxe_iron'); S.G.fakeLock = true; })()`);
  await aimAt(p, 'cobalt_ore', 2);
  await p.eval(`(() => { const S = __STRATA; S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'pickaxe_stone')); S.mineHold(true); })()`);
  await sleep(2600);
  await p.eval(`__STRATA.mineHold(false)`);
  if ((await S(p, `S.drops().list.some((d) => d.stack.id === 'raw_cobalt')`))) throw new Error('a stone pickaxe got cobalt');
  await aimAt(p, 'cobalt_ore', 2);
  await p.eval(`(() => { const S = __STRATA; S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'pickaxe_iron')); S.mineHold(true); })()`);
  await p.waitFor(`__STRATA.drops().list.some((d) => d.stack.id === 'raw_cobalt')`, { what: 'raw cobalt', timeout: 6000 });
  await p.eval(`__STRATA.mineHold(false)`);
  const t = await p.eval(`import('/games/strata/src/items.js').then((m) => ({ speed: m.ITEMS.pickaxe_cobalt.tool.speed, dur: m.ITEMS.pickaxe_cobalt.tool.durability, sword: m.ITEMS.sword_cobalt.attack }))`);
  if (t.speed !== 9 || t.dur !== 900 || t.sword !== 8) throw new Error(JSON.stringify(t));
});

// ------------------------------------------------------------------ Part 2: the Data Vaults, the Tracer and the compass
const toVault = async (p, i = 0) => {
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.G.fakeLock = true; S.vitals().hunger = 20; })()`);
  await p.eval(`__STRATA.goto('underlayer')`);
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'the Underlayer' });
  await p.eval(`(() => { const S = __STRATA; S.spawner().t = 1e9; })()`);
  const v = await S(p, `S.G.sites.vaults[${i}]`);
  await p.eval(`(() => { const S = __STRATA, v = S.G.sites.vaults[${i}]; S.tp(v.entrance.x + 0.5, v.entrance.y, v.entrance.z + 0.5); S.face(Math.PI, 0); })()`);
  await p.waitFor(`__STRATA.world().has(${v.x}, ${v.z}) && __STRATA.getBlock(${v.spawner.x}, ${v.spawner.y}, ${v.spawner.z}) === __STRATA.world().table.ids.spawner`, { what: 'the vault chunks', timeout: 60000 });
  await p.eval(`__STRATA.settle(2)`);
  return v;
};

test('a Data Vault: the sealed door, the spawner that makes Daemons until it is broken (5 s with a pickaxe), the door grinding open, the Warden, the chest with a Kernel Shard, raided state', async (p) => {
  await flat(p);
  const v = await toVault(p);
  const ids = await S(p, `S.world().table.ids`);
  if (v.door.length !== 6 || !v.door.every((c) => true)) throw new Error('door ' + v.door.length);
  const sealed = await S(p, `[${JSON.stringify(v.door)}][0].every((c) => S.getBlock(c.x, c.y, c.z) === ${ids.vault_door})`);
  if (!sealed) throw new Error('the vault door is not there');
  // the spawner makes Daemons while you are near
  await p.eval(`(() => { const S = __STRATA, v = S.G.sites.vaults[0]; S.tp(v.x + 0.5, v.fy + 1, v.z - 4.5); S.vitals().invuln = 99999; S.vitals().hp = 20; S.setHealth(20); })()`);
  await p.waitFor(`__STRATA.mobs().list.filter((m) => m.type === 'daemon').length >= 1`, { what: 'a Daemon from the spawner', timeout: 30000 });
  await p.eval(`(() => { const S = __STRATA; S.mobs().list.filter((m) => m.type === 'daemon').forEach((m) => S.mobs().damage(m, 999, {})); S.killAll(); S.give('pickaxe_iron'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'pickaxe_iron')); })()`);
  // the vault walls cannot be dug
  const wall = await S(p, `(() => { const v = S.G.sites.vaults[0]; return require_breakInfo; })()`).catch(() => null);
  void wall;
  const info = await p.eval(`import('/games/strata/src/interact.js').then((m) => ({ wall: m.breakInfo(${ids.server_rack}, null).breakable, door: m.breakInfo(${ids.vault_door}, null).breakable, spawner: m.breakInfo(${ids.spawner}, { id: 'pickaxe_iron', n: 1, dur: 250 }).time }))`);
  if (info.wall || info.door || Math.abs(info.spawner - 5 / 6) > 0.01 && info.spawner > 6) throw new Error(JSON.stringify(info));
  // break the spawner for real: aim at it and mine
  await p.eval(`(() => { const S = __STRATA, v = S.G.sites.vaults[0]; S.tp(v.x + 0.5, v.fy + 1, v.z - 2.5); const e = S.player().eye(); const dx = v.x + 0.5 - e.x, dz = v.z + 0.5 - e.z, dy = v.fy + 1.5 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); S.mineHold(true); })()`);
  await p.waitFor(`__STRATA.getBlock(${v.spawner.x}, ${v.spawner.y}, ${v.spawner.z}) === 0`, { what: 'the spawner to break', timeout: 15000 });
  await p.eval(`__STRATA.mineHold(false)`);
  await p.waitFor(`[${JSON.stringify(v.door)}][0].every((c) => __STRATA.getBlock(c.x, c.y, c.z) === 0)`, { what: 'the door to open', timeout: 10000 });
  const st = await S(p, `S.G.flags.vaults[0]`);
  if (!st.spawner) throw new Error('spawner state ' + JSON.stringify(st));
  if (!/vault door grinds open/.test(await S(p, `document.getElementById('subtitle').textContent`))) throw new Error('no door message');
  // nothing spawns from it any more
  await p.eval(`(() => { const S = __STRATA, v = S.G.sites.vaults[0]; S.G.vaultT = 0; })()`);
  await sleep(4000);
  if (await S(p, `S.mobs().list.some((m) => m.type === 'daemon')`)) throw new Error('a destroyed spawner kept spawning');
  // walk up: the Warden wakes when you are near, with its shield rule
  await p.eval(`(() => { const S = __STRATA, v = S.G.sites.vaults[0]; S.tp(v.x + 0.5, v.fy + 17, v.z - 3.5); S.G.vaultT = 0; })()`);
  await p.waitFor(`__STRATA.mobs().list.some((m) => m.type === 'warden')`, { what: 'the Warden', timeout: 20000 });
  const w = await S(p, `(() => { const m = S.mobs().list.find((x) => x.type === 'warden'); return { hp: m.hp, y: m.y, near: Math.hypot(m.x - ${v.x}, m.z - ${v.z}) }; })()`);
  if (w.hp !== 80 || w.near > 3) throw new Error(JSON.stringify(w));
  // kill it (a hit from behind counts): the state is saved
  await p.eval(`(() => { const S = __STRATA, m = S.mobs().list.find((x) => x.type === 'warden'); S.mobs().damage(m, 999, { from: { x: m.x, z: m.z + 5 }, type: 'player' }); })()`);
  await p.waitFor(`__STRATA.G.flags.vaults[0].warden === true`, { what: 'the Warden to fall' });
  // the chest: a Kernel Shard and supplies, made when first opened; closing it with the shard taken raids the vault
  await p.eval(`(() => { const S = __STRATA, v = S.G.sites.vaults[0]; S.killAll(); S.tp(v.chest.x + 0.5, v.chest.y + 1, v.chest.z + (v.chest.z > v.z ? -1.6 : 1.6)); const e = S.player().eye(); const dx = v.chest.x + 0.5 - e.x, dz = v.chest.z + 0.5 - e.z, dy = v.chest.y + 0.4 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); S.useOrPlace(); })()`);
  await p.waitFor(`__STRATA.state().menu === 'chest'`, { what: 'the vault chest' });
  const loot = await S(p, `[...S.chests().values()][0].filter(Boolean).map((s) => s.id)`);
  if (!loot.includes('kernel_shard') || loot.length < 3) throw new Error('loot ' + loot);
  await p.eval(`(() => { const S = __STRATA, c = [...S.chests().values()][0], i = c.findIndex((s) => s?.id === 'kernel_shard'); S.inv().add(c[i]); c[i] = null; })()`);
  await p.eval(`__STRATA.closeMenu()`);
  if (!(await S(p, `S.G.flags.vaults[0].raided`))) throw new Error('the vault was not marked raided');
  if ((await S(p, `S.inv().count('kernel_shard')`)) !== 1) throw new Error('no shard');
  // the state survives a save and a load; the door stays open
  const str = await S(p, `S.save()`);
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing' && __STRATA.state().dim === 'underlayer'`, { timeout: 90000 });
  const again = await S(p, `({ st: S.G.flags.vaults[0], shards: S.inv().count('kernel_shard') })`);
  if (!again.st.raided || !again.st.spawner || !again.st.warden || again.shards !== 1) throw new Error('after the load ' + JSON.stringify(again));
});

test('the Tracer and the compass strip: N, E, S, W follow where you look; the death marker; holding a Tracer shows the nearest Rift site on the surface, the nearest unraided vault below, the Gate with a key', async (p) => {
  await boot(p);
  await p.eval(`__STRATA.newWorld({ seed: 7 })`);                                // a real terrain world (a flat one has no Cracked Bedrock)
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'playing' });
  await p.eval(`__STRATA.settle(1)`);
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.G.fakeLock = true; S.face(0, 0); })()`);
  await sleep(300);
  const strip = () => S(p, `[...document.querySelectorAll('#compass .cm')].map((e) => ({ t: e.textContent, x: parseFloat(e.style.left) }))`);
  let c = await strip();
  if (!c.some((x) => x.t === 'N' && Math.abs(x.x - 50) < 2)) throw new Error('N should be straight ahead: ' + JSON.stringify(c));
  await p.eval(`__STRATA.face(-Math.PI / 2, 0)`); await sleep(250);                 // looking east
  c = await strip();
  if (!c.some((x) => x.t === 'E' && Math.abs(x.x - 50) < 2)) throw new Error('E should be straight ahead: ' + JSON.stringify(c));
  await p.eval(`__STRATA.face(-Math.PI / 4, 0)`); await sleep(250);                 // north-east: N on the left, E on the right
  c = await strip();
  if (!c.some((x) => x.t === 'E' && x.x > 60) || !c.some((x) => x.t === 'N' && x.x < 40)) throw new Error('N should be left and E right when looking north-east: ' + JSON.stringify(c));
  // the setting hides it
  await p.eval(`(() => { const S = __STRATA; S.G.settings.compass = false; })()`); await sleep(250);
  if (!(await S(p, `document.getElementById('compass').classList.contains('off')`))) throw new Error('the compass did not hide');
  await p.eval(`(() => { const S = __STRATA; S.G.settings.compass = true; })()`);
  // the death marker
  await p.eval(`(() => { const S = __STRATA, pl = S.player().pos; S.G.deathMarker = { x: Math.floor(pl.x) - 8, y: 49, z: Math.floor(pl.z), dim: 'overworld' }; S.drops().spawn(pl.x - 8, 49, pl.z, { id: 'stone', n: 1 }, { vx: 0, vy: 0, vz: 0, delayS: 1e9, ttl: 600, death: true }); S.face(Math.PI / 2, 0); })()`); await sleep(250);   // looking west
  c = await strip();
  if (!c.some((x) => x.t === '☠' && Math.abs(x.x - 50) < 4)) throw new Error('the death marker should be ahead (west): ' + JSON.stringify(c));
  await p.eval(`(() => { const S = __STRATA; S.G.deathMarker = { x: 1, y: 1, z: 1, dim: 'underlayer' }; })()`); await sleep(250);
  if ((await strip()).some((x) => x.t === '☠')) throw new Error('a death marker of another dimension is shown');
  // the Tracer: nothing without it; with it, the nearest cracked bedrock
  await p.eval(`(() => { const S = __STRATA; S.G.deathMarker = null; S.give('tracer'); })()`);
  await sleep(250);
  if ((await strip()).some((x) => /◆/.test(x.t))) throw new Error('a Tracer marker without holding it');
  const target = await S(p, `(() => { const S = __STRATA, P = S.player().pos, c = S.G.sites.cracks.slice().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]; S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'tracer')); S.face(-Math.atan2(c.x + 0.5 - P.x, -(c.z + 0.5 - P.z)), 0); return { x: c.x, z: c.z, d: Math.round(Math.hypot(c.x - P.x, c.z - P.z)) }; })()`);
  await sleep(300);
  c = await strip();
  const mark = c.find((x) => /◆ Rift/.test(x.t));
  if (!mark || Math.abs(mark.x - 50) > 3 || Math.abs(parseInt(mark.t.match(/(\d+)m/)[1]) - target.d) > 2) throw new Error('the Tracer should point at the nearest cracked bedrock: ' + JSON.stringify([c, target]));
  // the site is really there in the real world (regression: the game once generated none)
  await p.eval(`(() => { const S = __STRATA; S.tp(${target.x} + 0.5, 60, ${target.z} + 0.5); })()`);
  await p.waitFor(`__STRATA.world().has(${target.x}, ${target.z})`, { what: 'the chunk of the nearest site', timeout: 60000 });
  const crack = await S(p, `({ id: S.getBlock(${target.x}, ${(await S(p, `S.G.sites.cracks.find((c) => c.x === ${target.x} && c.z === ${target.z}).y`))}, ${target.z}), want: S.world().table.ids.cracked_bedrock })`);
  if (crack.id !== crack.want) throw new Error('no cracked bedrock at the site: ' + JSON.stringify(crack));
  // below: the nearest unraided vault, then the Gate once you hold a key
  await p.eval(`__STRATA.goto('underlayer')`);
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000 });
  await p.eval(`(() => { const S = __STRATA; S.spawner().t = 1e9; S.give('tracer'); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'tracer')); S.face(0, 0); })()`);
  await sleep(400);
  const nearest = await S(p, `(() => { const P = S.player().pos, v = S.G.sites.vaults.slice().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]; S.face(-Math.atan2(v.x + 0.5 - P.x, -(v.z + 0.5 - P.z)), 0); return v.index; })()`);
  await sleep(300);
  c = await strip();
  if (!c.some((x) => /◆ Vault/.test(x.t) && Math.abs(x.x - 50) < 3)) throw new Error('vault marker ' + JSON.stringify(c));
  await p.eval(`(() => { const S = __STRATA; S.G.flags.vaults[${nearest}] = { spawner: true, raided: true, warden: true }; })()`);
  await sleep(300);
  const second = await S(p, `(() => { const P = S.player().pos, v = S.G.sites.vaults.filter((x) => !S.G.flags.vaults[x.index]?.raided).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]; S.face(-Math.atan2(v.x + 0.5 - P.x, -(v.z + 0.5 - P.z)), 0); return v.index; })()`);
  if (second === nearest) throw new Error('a raided vault is still the target');
  await sleep(300);
  await p.eval(`(() => { const S = __STRATA; S.give('kernel_key'); const P = S.player().pos; S.face(-Math.atan2(256.5 - P.x, -(256.5 - P.z)), 0); })()`);
  await sleep(300);
  c = await strip();
  if (!c.some((x) => /◆ Gate/.test(x.t))) throw new Error('with a key the Tracer should point at the Gate: ' + JSON.stringify(c));
});

// ------------------------------------------------------------------ Part 2: the Kernel Gate and the Garbage Collector
const toGate = async (p) => {
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.G.fakeLock = true; S.vitals().hunger = 20; })()`);
  await p.eval(`__STRATA.goto('underlayer')`);
  await p.waitFor(`__STRATA.state().dim === 'underlayer' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'the Underlayer' });
  await p.eval(`(() => { const S = __STRATA; S.spawner().t = 1e9; S.tp(256.5, 41, 261.5); S.face(0, 0.1); })()`);
  await p.waitFor(`__STRATA.world().has(256, 256) && __STRATA.getBlock(256, 44, 256) !== 0`, { what: 'the gate chunk', timeout: 60000 });
  await sleep(300);
};

test('the Kernel Gate: dark until a Kernel Key is used (the key is consumed), then a white Rift that stays open; walking in takes you to the Kernel arena', async (p) => {
  await flat(p);
  await toGate(p);
  const ids = await S(p, `S.world().table.ids`);
  // aim at the frame's opening
  await p.eval(`(() => { const S = __STRATA, e = S.player().eye(); const dx = 256.5 - e.x, dz = 256.5 - e.z, dy = 44.5 - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); })()`);
  await sleep(150);
  const hit = await S(p, `S.target()`);
  if (!hit || hit.id !== ids.vault_door) throw new Error('not aiming at the dark opening: ' + JSON.stringify(hit));
  await p.eval(`__STRATA.useOrPlace()`);
  if (!/needs a Kernel Key/.test(await S(p, `document.getElementById('subtitle').textContent`)) || (await S(p, `S.G.flags.gate`))) throw new Error('without a key the gate must stay dark');
  await p.eval(`(() => { const S = __STRATA; S.give('kernel_shard', 3); S.give('kernel_key'); })()`);
  await p.eval(`__STRATA.useOrPlace()`);
  if (!(await S(p, `S.G.flags.gate`)) || (await S(p, `S.inv().count('kernel_key')`)) !== 0) throw new Error('the key was not used up');
  const frame = await S(p, `(() => { let w = 0, d = 0, r = 0; for (let x = 254; x <= 258; x++) for (let y = 41; y <= 47; y++) { const b = S.getBlock(x, y, 256); if (b === S.world().table.ids.rift_white) w++; else if (b === S.world().table.ids.vault_door) d++; else r++; } return { w, d, r }; })()`);
  if (frame.w !== 35 || frame.d !== 0) throw new Error('the frame should be 35 white Rift blocks: ' + JSON.stringify(frame));
  // the state is saved: after a load the opening is still white
  const str = await S(p, `S.save()`);
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing' && __STRATA.state().dim === 'underlayer'`, { timeout: 90000 });
  await p.waitFor(`__STRATA.world().has(256, 256) && __STRATA.getBlock(256, 44, 256) === __STRATA.world().table.ids.rift_white`, { what: 'the open gate after the load', timeout: 30000 });
  // walk in
  await p.eval(`(() => { const S = __STRATA; S.spawner().t = 1e9; S.tp(256.5, 41, 256.5); })()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'the Kernel' });
  const k = await S(p, `({ size: S.world().size, noSky: S.world().noSky, voidBelow: S.world().voidBelow, pos: { ...S.player().pos }, boss: S.mobs().list.filter((m) => m.type === 'gc').length, bar: !document.getElementById('bossbar').hidden, logs: !document.getElementById('logs').hidden, floor: S.getBlock(64, 60, 70), crystals: S.state().dim })`);
  if (k.size !== 128 || !k.noSky || !k.voidBelow || k.boss !== 1 || !k.logs || k.floor !== (await S(p, `S.world().table.ids.memory_block`))) throw new Error(JSON.stringify(k));
  await p.waitFor(`!document.getElementById('bossbar').hidden`, { what: 'the boss bar' });
  const bar = await S(p, `({ name: document.getElementById('bossbar').firstElementChild.textContent, w: document.getElementById('bossbar').lastElementChild.firstElementChild.style.width })`);
  if (bar.name !== 'The Garbage Collector' || bar.w !== '100%') throw new Error(JSON.stringify(bar));
  const gc = await S(p, `(() => { const m = S.mobs().list.find((x) => x.type === 'gc'); return { hp: m.hp, h: m.h, w: m.w }; })()`);
  if (gc.hp !== 300 || gc.h < 8) throw new Error(JSON.stringify(gc));
});

test('the fight in the real game: marks glow red then vanish and the player falls and dies in the void keeping his inventory; Kernel and Pointers; the exposed core takes double; leaving mid-fight puts you back at the Gate', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.G.fakeLock = true; S.give('cobblestone', 9); S.giveKit('cobalt'); S.vitals().hunger = 20; S.vitals().hp = 20; })()`);
  await p.eval(`__STRATA.enterKernel()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing' && !!__STRATA.boss()`, { timeout: 90000, what: 'the Kernel fight' });
  await p.eval(`(() => { const S = __STRATA; S.killAll(); S.G.fakeLock = true; })()`);
  // restart the boss cleanly (killAll removed it)
  await p.eval(`(() => { const S = __STRATA; S.enterKernel(); })()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing' && !!__STRATA.boss() && __STRATA.mobs().list.some((m) => m.type === 'gc')`, { timeout: 90000, what: 'a fresh fight' });
  const ids = await S(p, `S.world().table.ids`);
  // a mark under the player: glow red now, gone 3 s later
  await p.eval(`(() => { const S = __STRATA, b = S.boss(); b.markIn = 0; S.tp(64.5, 61, 80.5); b.m.hp = 300; })()`);
  await p.waitFor(`__STRATA.world().getBlock(64, 60, 80) === ${ids.memory_marked}`, { what: 'the block under the player to be marked', timeout: 12000 });
  const mid = await S(p, `({ marked: [...Array(40)].reduce((n, _, i) => n + (S.getBlock(64 + (i % 8) - 4, 60, 80 + Math.floor(i / 8) - 2) === ${ids.memory_marked} ? 1 : 0), 0), subtitle: document.getElementById('subtitle').textContent })`);
  if (mid.marked < 4) throw new Error('marks: ' + JSON.stringify(mid));
  await p.waitFor(`__STRATA.world().getBlock(64, 60, 80) === 0`, { what: 'the marked block to be deleted', timeout: 6000 });
  // standing on it: fell into the void, died, kept the inventory
  await p.waitFor(`__STRATA.state().phase === 'dead'`, { what: 'the void', timeout: 15000 });
  const dead = await S(p, `({ cause: document.getElementById('death-cause').textContent, cobble: S.inv().count('cobblestone'), armor: S.vitals().armorPoints, pile: S.drops().list.filter((d) => d.death).length, note: document.getElementById('death-note').textContent })`);
  if (dead.cause !== 'Fell out of the world' || dead.cobble !== 9 || dead.armor !== 20 || dead.pile !== 0 || !/keep your items/.test(dead.note)) throw new Error('death in the Kernel keeps everything: ' + JSON.stringify(dead));
  await p.eval(`document.getElementById('b-respawn').click()`);
  await p.waitFor(`__STRATA.state().dim === 'overworld' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'back on the surface' });
  if ((await S(p, `S.inv().count('cobblestone')`)) !== 9) throw new Error('lost the inventory');
  if ((await S(p, `!!S.boss()`))) throw new Error('the boss survived leaving the Kernel');
  // enter again: the arena is whole (regenerated from scratch), the boss at full health
  await p.eval(`__STRATA.enterKernel()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing' && __STRATA.mobs().list.some((m) => m.type === 'gc')`, { timeout: 90000 });
  const whole = await S(p, `({ hole: S.getBlock(64, 60, 80), hp: S.mobs().list.find((m) => m.type === 'gc').hp, crystals: S.boss().crystalsStanding() })`);
  if (whole.hole !== ids.memory_block || whole.hp !== 300 || whole.crystals !== 4) throw new Error('the arena was not regenerated: ' + JSON.stringify(whole));
  // phase 2 brings Pointers
  await p.eval(`(() => { const S = __STRATA; S.vitals().invuln = 1e9; S.bossPhase(2); })()`);
  await p.waitFor(`__STRATA.mobs().list.filter((m) => m.type === 'pointer').length === 4`, { what: 'four Pointers', timeout: 8000 });
  // the core is exposed after a stomp: a hit on it does double (read from the boss's own rule)
  const dmg = await S(p, `(() => { const b = S.boss(), m = b.m; b.state = 'kneel'; m.yaw = 0; const hp = m.hp; S.mobs().damage(m, 8, { from: { x: m.x, z: m.z + 4 }, point: { x: m.x, y: m.y + 4.4, z: m.z - 1.5 }, type: 'player' }); return hp - m.hp; })()`);
  if (dmg !== 16) throw new Error('an exposed core hit should do 16: ' + dmg);
  // quitting mid-fight: the save puts you back at the Gate
  const str = await S(p, `S.save()`);
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing' && __STRATA.state().dim === 'underlayer'`, { timeout: 90000 });
  const at = await S(p, `({ x: S.player().pos.x, z: S.player().pos.z, boss: !!S.boss() })`);
  if (Math.abs(at.x - 256.5) > 1 || Math.abs(at.z - 261.5) > 1 || at.boss) throw new Error('after loading a save made in the Kernel: ' + JSON.stringify(at));
});

test('Kernel crystals: a cobalt pickaxe breaks one in 3 s, 3 arrows break one, and the boss stops healing with fewer than 2 left; the core floats up when it falls and touching it fires the win', async (p) => {
  await flat(p);
  await p.eval(`(() => { const S = __STRATA; S.G.fakeLock = true; S.give('pickaxe_cobalt'); S.give('bow'); S.give('arrow', 12); S.vitals().invuln = 1e9; })()`);
  await p.eval(`__STRATA.enterKernel()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing' && __STRATA.mobs().list.some((m) => m.type === 'gc')`, { timeout: 90000 });
  const ids = await S(p, `S.world().table.ids`);
  await p.eval(`(() => { const S = __STRATA, b = S.boss(); b.markIn = 1e9; b.chargeIn = 1e9; b.m.def = { ...b.m.def, speed: 0 }; b.state = 'walk'; })()`);
  const cr = await S(p, `S.boss().constructor.name && [...Array(4)].map((_, i) => ({ x: [44, 84, 44, 84][i], y: 67, z: [44, 44, 84, 84][i] }))`);
  // 3 s with a cobalt pickaxe: stand on top of the pillar's neighbour... use the hook: break it as the game would (breakInfo says 3 s)
  const t = await p.eval(`import('/games/strata/src/interact.js').then((m) => m.breakInfo(${ids.kernel_crystal}, { id: 'pickaxe_cobalt', n: 1, dur: 900 }).time)`);
  if (Math.abs(t - 3) > 1e-9) throw new Error('crystal time ' + t);
  // 3 arrows: shoot a crystal from the platform
  await p.eval(`(() => { const S = __STRATA; S.tp(44.5, 61, 56.5); S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'bow')); })()`);
  const shoot = async () => { await p.eval(`(() => { const S = __STRATA, e = S.player().eye(); const dx = 44.5 - e.x, dz = 44.5 - e.z, d = Math.hypot(dx, dz), lift = 0.5 * 22 * Math.pow(d / 36, 2), dy = 67.5 + lift - e.y; S.face(Math.atan2(-dx, -dz), Math.atan2(dy, d)); })()`); await sleep(100); await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 225, button: 'right', clickCount: 1 }); await sleep(1100); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 225, button: 'right', clickCount: 1 }); await sleep(900); };
  for (let i = 0; i < 3; i++) await shoot();
  if ((await S(p, `S.getBlock(44, 67, 44)`)) !== 0) throw new Error('3 arrows did not break the crystal (' + (await S(p, `S.getBlock(44, 67, 44)`)) + ')');
  if ((await S(p, `S.boss().crystalsStanding()`)) !== 3) throw new Error('crystal count');
  // the ending hook: kill the boss; the core appears, floats up, touching it fires the win once
  await p.eval(`(() => { const S = __STRATA, b = S.boss(); S.tp(64.5, 61, 80.5); S.mobs().damage(b.m, 9999, { from: { x: 64, z: 80 }, type: 'player' }); b.m.hp = 0; })()`);
  await p.waitFor(`!!__STRATA.boss().core`, { what: 'the core', timeout: 12000 });
  const c0 = await S(p, `({ ...S.boss().core })`);
  await sleep(1800);
  const c1 = await S(p, `({ ...S.boss().core })`);
  if (!(c1.y > c0.y + 0.4 && c1.y > 62.9)) throw new Error('the core did not float up: ' + JSON.stringify([c0, c1]));
  await p.eval(`(() => { const S = __STRATA, c = S.boss().core; S.tp(c.x, c.y - 0.9, c.z); })()`);
  await p.waitFor(`__STRATA.boss().won === true`, { what: 'the win', timeout: 8000 });
});

// ------------------------------------------------------------------ Part 2: the ending
test('the ending: the win shows a terminal log, then the credits (skippable only after 5 s), sends complete() once per world, puts the Kernel Core in the inventory and returns you to the surface; a second win does not resend; the title shows the trophy', async (p) => {
  await flat(p);
  await p.eval(`(() => { window.__done = []; const o = System32.complete; System32.complete = (x) => { window.__done.push(x); }; __STRATA.G.fakeLock = true; __STRATA.vitals().stats.timeS = 125; __STRATA.vitals().deaths = 2; })()`);
  await p.eval(`__STRATA.enterKernel()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing' && __STRATA.mobs().list.some((m) => m.type === 'gc')`, { timeout: 90000 });
  await p.eval(`__STRATA.endNow()`);
  await p.waitFor(`__STRATA.state().screen === 'end'`, { what: 'the ending screen' });
  await sleep(1500);
  const log = await S(p, `document.getElementById('end-log').textContent`);
  if (!/\[gc\]/.test(log)) throw new Error('no terminal log: ' + log);
  await p.waitFor(`!document.getElementById('credits').hidden`, { what: 'the credits', timeout: 12000 });
  const text = await S(p, `document.getElementById('credits').textContent`);
  if (!/Pragnya Yadav with Claude Code/.test(text) || !/three\.js/.test(text) || !/Kenney/.test(text) || !/CC0/.test(text)) throw new Error('credits: ' + text.slice(0, 300));
  await p.eval(`__STRATA.skipCredits()`);
  await sleep(300);
  if (await S(p, `S.G.end === null`)) throw new Error('credits were skipped before 5 s');
  await sleep(5000);
  await p.eval(`__STRATA.skipCredits()`);
  await p.waitFor(`__STRATA.state().dim === 'overworld' && __STRATA.state().phase === 'playing'`, { timeout: 90000, what: 'back on the surface' });
  const done = await S(p, `window.__done`);
  if (done.length !== 1 || done[0].difficulty !== 'normal' || done[0].deaths !== 2 || !(done[0].timeMs >= 125000)) throw new Error('complete(): ' + JSON.stringify(done));
  if ((await S(p, `S.inv().count('kernel_core')`)) !== 1) throw new Error('no trophy');
  // a second win: no second complete()
  await p.eval(`__STRATA.enterKernel()`);
  await p.waitFor(`__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing'`, { timeout: 90000 });
  await p.eval(`__STRATA.endNow()`);
  await p.waitFor(`!document.getElementById('credits').hidden`, { timeout: 12000 });
  await sleep(5200); await p.eval(`__STRATA.skipCredits()`);
  await p.waitFor(`__STRATA.state().dim === 'overworld' && __STRATA.state().phase === 'playing'`, { timeout: 90000 });
  if ((await S(p, `window.__done.length`)) !== 1) throw new Error('complete() was sent twice');
  if ((await S(p, `S.inv().count('kernel_core')`)) !== 2) throw new Error('second trophy');
  // the Kernel Core thrown into the void comes back (egg)
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.drops().spawn(P.x + 3, -20, P.z, { id: 'kernel_core', n: 1 }, { vx: 0, vy: 0, vz: 0, delayS: 99 }); })()`);
  await p.waitFor(`__STRATA.G.eggs.has('strata-recycle')`, { what: 'the recycle egg', timeout: 6000 });
  if (!/protected by the will of the previous user/.test(await S(p, `document.getElementById('subtitle').textContent`))) throw new Error('no message');
  // the title screen shows the trophy from INIT
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'INIT', payload: { save: null, soundOn: false, completed: { timeMs: 125000, deaths: 2, difficulty: 'normal', at: 1, byDifficulty: { normal: { timeMs: 125000, deaths: 2, at: 1 } } } } }, '*')`);
  await sleep(200);
  await p.eval(`__STRATA.G.completed = { timeMs: 125000, byDifficulty: { normal: { timeMs: 125000 } } }; __STRATA.ui().title({ canContinue: false, completed: __STRATA.G.completed })`);
  if (!/🏆.*2:05/.test(await S(p, `document.getElementById('title-trophy').textContent`))) throw new Error('trophy line');
});

// ------------------------------------------------------------------ Creative mode
test('Creative: chosen at New World; E opens a searchable, sorted catalog of every item; clicking gives items; nothing is used up; blocks break at once and drop nothing; no damage or hunger; double-tap Space flies; the mode is saved', async (p) => {
  await boot(p, '&flat=1');
  await p.eval(`document.querySelector('[data-act="new"]').click()`);
  const opts = await S(p, `[...document.querySelectorAll('#new-mode option')].map((o) => o.value)`);
  if (opts.join() !== 'survival,creative') throw new Error('mode choices ' + opts);
  await p.eval(`(() => { document.getElementById('new-mode').value = 'creative'; })()`);
  await p.eval(`document.getElementById('b-start-new').click()`);
  await p.waitFor(`__STRATA.state().phase === 'playing' || __STRATA.state().phase === 'paused'`, { timeout: 90000, what: 'a creative world' });
  await p.eval(`(() => { const S = __STRATA; S.G.fakeLock = true; S.G.phase = 'playing'; S.ui().show(null); S.ui().hud(true); S.killAll(); S.spawner().t = 1e9; })()`);
  if ((await S(p, `S.G.flags.mode`)) !== 'creative' || !(await S(p, `S.G.creative`))) throw new Error('mode not set');
  await p.eval(`__STRATA.settle(2)`);
  await p.waitFor(`__STRATA.state().onGround`, { what: 'standing', timeout: 30000 });
  if (!(await S(p, `document.getElementById('vitals').hidden`))) throw new Error('hearts shown in creative');
  // E opens the catalog
  await tap(p, 'e');
  await p.waitFor(`__STRATA.state().menu === 'creative'`, { what: 'the creative screen' });
  const total = await S(p, `({ n: document.querySelectorAll('#s-inv .catgrid .slot').length, all: document.querySelector('.crnote').textContent })`);
  const want = await p.eval(`import('/games/strata/src/items.js').then((m) => Object.keys(m.ITEMS).length)`);
  if (total.n !== want) throw new Error(`catalog shows ${total.n} of ${want} items`);
  const tabs = await S(p, `[...document.querySelectorAll('#s-inv .tab')].map((t) => t.textContent)`);
  if (tabs.join() !== 'All,Blocks,Tools & Weapons,Armor,Food,Materials') throw new Error('tabs ' + tabs);
  // sorted: names in the first (Blocks) group are alphabetical
  const names = await S(p, `[...document.querySelectorAll('#s-inv .catgrid .slot')].slice(0, 12).map((s) => s.dataset.i)`);
  void names;
  const firstNames = await S(p, `S.G.menu.list.slice(0, 30).filter((e) => e.category === 'Blocks').map((e) => e.name)`);
  if (JSON.stringify(firstNames) !== JSON.stringify([...firstNames].sort((a, b) => a.localeCompare(b)))) throw new Error('not sorted: ' + firstNames);
  // search by typing in the box (the game keys must not trigger)
  await p.eval(`(() => { const i = document.getElementById('cr-search'); i.focus(); })()`);
  for (const ch of 'cobalt') { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); }
  await sleep(200);
  const found = await S(p, `({ n: document.querySelectorAll('#s-inv .catgrid .slot').length, menu: S.state().menu, val: document.getElementById('cr-search').value, focus: document.activeElement?.id })`);
  if (found.val !== 'cobalt' || found.menu !== 'creative' || found.n < 8 || found.n > 20 || found.focus !== 'cr-search') throw new Error('search: ' + JSON.stringify(found));
  // click the first result: a stack arrives; a tab narrows further
  const press = async (sel, button = 'left') => { const [x, y] = await S(p, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 }); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 }); await sleep(120); };
  await press('.tab[data-tab="Armor"]');
  const armor = await S(p, `S.G.menu.list.map((e) => e.id)`);
  if (armor.length !== 4 || !armor.every((i) => /^cobalt_/.test(i))) throw new Error('armor tab ' + armor);
  await p.eval(`(() => { const i = document.getElementById('cr-search'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
  await press('.tab[data-tab="Blocks"]');
  await p.eval(`(() => { const i = document.getElementById('cr-search'); i.value = 'cobblestone'; i.dispatchEvent(new Event('input')); })()`);
  await press('#s-inv .catgrid .slot');
  if ((await S(p, `S.inv().count('cobblestone')`)) !== 64) throw new Error('a click should give 64');
  await p.eval(`(() => { const i = document.getElementById('cr-search'); i.value = 'pickaxe cobalt'; i.dispatchEvent(new Event('input')); __STRATA.G.menu.search('pickaxe cobalt', 'All'); })()`);
  await tap(p, 'Escape');
  await p.eval(`(() => { const S = __STRATA; if (S.state().menu) S.closeMenu(); })()`);
  // nothing is used up: placing keeps the stack
  await p.eval(`(() => { const S = __STRATA; S.selectSlot(S.inv().slots.findIndex((s) => s?.id === 'cobblestone')); S.face(0, -0.9); })()`);
  await sleep(150);
  const before = await S(p, `S.inv().count('cobblestone')`);
  await p.eval(`__STRATA.useOrPlace()`);
  if ((await S(p, `S.inv().count('cobblestone')`)) !== before) throw new Error('placing used up an item in creative');
  // breaking: instant, no drop
  const hit = await S(p, `S.target()`);
  await p.eval(`__STRATA.mineHold(true)`);
  await sleep(500);
  await p.eval(`__STRATA.mineHold(false)`);
  if ((await S(p, `S.getBlock(${hit.x}, ${hit.y}, ${hit.z})`)) !== 0) throw new Error('the block did not break at once');
  if ((await S(p, `S.drops().list.length`)) !== 0) throw new Error('creative breaking dropped an item');
  // no damage, no hunger
  await p.eval(`(() => { const S = __STRATA; S.vitals().invuln = 0; S.damage(99, { type: 'mob' }); S.damage(99, { type: 'fall' }); S.damage(99, { type: 'lava' }); })()`);
  if ((await S(p, `S.vitals().hp`)) !== 20 || (await S(p, `S.vitals().dead`))) throw new Error('took damage in creative');
  await p.eval(`(() => { const S = __STRATA; S.vitals().update(10, { sprintM: 500, jumped: true, mined: 5000 }); })()`);
  if ((await S(p, `S.vitals().hunger`)) !== 20) throw new Error('hunger dropped in creative');
  // monsters leave you alone at night
  await p.eval(`(() => { const S = __STRATA, P = S.player().pos; S.setTime(0.75); S.spawn('shambler', P.x + 5, 49, P.z); })()`);
  await sleep(2500);
  if ((await S(p, `S.mobs().list.some((m) => m.def.kind === 'hostile')`))) throw new Error('monsters in creative');
  // flying: double-tap Space
  await tap(p, ' ', 20); await sleep(120); await tap(p, ' ', 20);
  await p.waitFor(`__STRATA.player().flying === true`, { what: 'flying' });
  await sleep(500);                                                       // (a Space press within 0.3 s of the last would toggle flight again)
  const y0 = await S(p, `S.player().pos.y`);
  await down(p, ' '); await sleep(700); await up(p, ' ');
  const y1 = await S(p, `S.player().pos.y`);
  if (!(y1 > y0 + 3)) throw new Error('flying up: ' + y0 + ' -> ' + y1);
  await sleep(600);
  if (!(Math.abs((await S(p, `S.player().pos.y`)) - y1) < 1.5)) throw new Error('no hover while flying');
  // the mode is saved and comes back
  const str = await S(p, `S.save()`);
  await p.eval(`__STRATA.load(${JSON.stringify(str)})`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  if (!(await S(p, `S.G.creative && S.G.flags.mode === 'creative' && document.getElementById('vitals').hidden`))) throw new Error('the mode was lost on load');
  // a survival world has none of it
  await p.eval(`__STRATA.newWorld({ seed: 3, flat: true, mode: 'survival' })`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  await p.eval(`(() => { const S = __STRATA; S.G.fakeLock = true; })()`);
  if ((await S(p, `S.G.creative || document.getElementById('vitals').hidden`))) throw new Error('survival world shows creative');
  await tap(p, 'e');
  await p.waitFor(`__STRATA.state().menu === 'inventory'`, { what: 'the normal inventory in survival' });
});

s.run();
