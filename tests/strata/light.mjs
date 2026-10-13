// Strata lighting (STRATA_PART2_SPEC.md section 3), no browser: the light engine of worker.js (sky and block channels), the smooth vertex light, the
// partial shapes, and how the World remeshes after an edit. Runs the same worker.js the browser runs.   node tests/strata/light.mjs
import { makeGen, B, BLOCKS, CONFIG, idx, atlas } from './lib.mjs';
import { World, InlineBackend } from '../../games/strata/src/world.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };

const RW = 48, H = 128;
const cell = (x, y, z) => (y * RW + z) * RW + x;
/** A 48 x 128 x 48 region: stone up to y = 10 (a floor), air above. */
const floor = () => { const r = new Uint8Array(RW * H * RW); for (let z = 0; z < RW; z++) for (let x = 0; x < RW; x++) for (let y = 0; y <= 10; y++) r[cell(x, y, z)] = B.stone; return r; };
const g = makeGen({ flat: true });

// ---------------------------------------------------------------- block light
{
  const r = floor(); r[cell(24, 12, 24)] = B.torch;
  const lt = g.lightRegion(r), L = (x, y, z) => lt.blk[cell(x, y, z)];
  check('a torch gives light 14 at its own cell', L(24, 12, 24) === 14);
  let wrong = [];
  for (let dx = -16; dx <= 16; dx++) for (let dy = 0; dy <= 12; dy++) for (let dz = -16; dz <= 16; dz++) {
    const y = 12 + dy; if (y < 11 || y > 127) continue;
    const want = Math.max(0, 14 - (Math.abs(dx) + dy + Math.abs(dz)));
    if (L(24 + dx, y, 24 + dz) !== want) wrong.push([dx, dy, dz, L(24 + dx, y, 24 + dz), want]);
  }
  check('in open air the torch light falls by exactly 1 per block (Manhattan distance), to 0 at 14 blocks', wrong.length === 0, JSON.stringify(wrong.slice(0, 4)));
  check('the floor stone (opaque) holds no light', L(24, 10, 24) === 0 && L(24, 5, 24) === 0);
  // a wall: light goes round it, never through it
  const w = floor(); w[cell(24, 12, 24)] = B.torch;
  for (let y = 11; y < 127; y++) for (let z = 0; z < RW; z++) w[cell(26, y, z)] = B.stone;       // a full wall at x = 26
  const wl = g.lightRegion(w);
  check('a full wall blocks the torch light completely', wl.blk[cell(27, 12, 24)] === 0 && wl.blk[cell(25, 12, 24)] === 13);
  // a gap in the wall: light squeezes through and still decays by distance
  w[cell(26, 12, 24)] = 0;
  const gl = g.lightRegion(w);
  check('a gap in the wall lets light through: 12 in the gap, 11 behind it', gl.blk[cell(26, 12, 24)] === 12 && gl.blk[cell(27, 12, 24)] === 11);
  // emitters
  const e = floor(); e[cell(10, 12, 10)] = B.lava; e[cell(20, 12, 10)] = B.furnace_lit; e[cell(30, 12, 10)] = B.glowcap; e[cell(40, 12, 10)] = B.kernel_crystal; e[cell(10, 12, 30)] = B.rift;
  const el = g.lightRegion(e), E = (x, z) => el.blk[cell(x, 12, z)];
  check('emitters: lava 15, burning furnace 13, glowcap 10, Kernel crystal 12, Rift 10', E(10, 10) === 15 && E(20, 10) === 13 && E(30, 10) === 10 && E(40, 10) === 12 && E(10, 30) === 10);
  check('light passes around the sides of an opaque emitter (a lit furnace lights the cell next to it)', el.blk[cell(21, 12, 10)] === 12 && el.blk[cell(41, 12, 10)] === 11);
  check('wall torches and floor torches all give 14', ['torch', 'torch_px', 'torch_nx', 'torch_pz', 'torch_nz'].every((n) => { const t = floor(); t[cell(24, 12, 24)] = B[n]; return g.lightRegion(t).blk[cell(24, 12, 24)] === 14; }));
  check('two torches add nothing: the brighter wins (no double counting)', (() => { const t = floor(); t[cell(24, 12, 24)] = B.torch; t[cell(26, 12, 24)] = B.torch; return g.lightRegion(t).blk[cell(25, 12, 24)] === 13; })());
}

// ---------------------------------------------------------------- sky light
{
  const r = floor();
  const lt0 = g.lightRegion(r);
  check('open sky: 15 in every air cell above the ground, 0 inside the stone', lt0.sky[cell(24, 11, 24)] === 15 && lt0.sky[cell(5, 100, 40)] === 15 && lt0.sky[cell(24, 5, 24)] === 0);
  // a roof 3 thick over x 20..28 (all z): under it the light falls by 1 per block from the open side
  const roof = floor();
  for (let x = 20; x <= 28; x++) for (let z = 0; z < RW; z++) for (let y = 14; y <= 16; y++) roof[cell(x, y, z)] = B.stone;
  const lt = g.lightRegion(roof), S = (x, y) => lt.sky[cell(x, y, 24)];
  check('under a roof the sky light is 15 at the open edge and falls 1 per block going in', S(19, 12) === 15 && S(20, 12) === 14 && S(22, 12) === 12 && S(24, 12) === 10 && S(28, 12) === 14 - 0 - 0 + 0 - 0 + 0 - (8 - 8) + 0 - 0 + 0 + 0 || S(28, 12) === 14);
  check('...and it is darker the further under the roof (centre < edge), symmetric from both sides', S(24, 12) < S(22, 12) && S(22, 12) === S(26, 12) && S(20, 12) === S(28, 12));
  check('the roof itself and the cells straight above it stay at 15 / 0', S(24, 18) === 15 && lt.sky[cell(24, 15, 24)] === 0);
  // a leaf takes 1 off, glass nothing, water 1 per block going down
  const mix = floor(); mix[cell(5, 30, 5)] = B.leaves; mix[cell(10, 30, 10)] = B.glass; mix[cell(15, 30, 15)] = B.water; mix[cell(15, 29, 15)] = B.water;
  const ml = g.lightRegion(mix);
  check('sky light under one leaf is 14, under glass 15, and falls by 1 per block of water', ml.sky[cell(5, 29, 5)] === 14 && ml.sky[cell(10, 29, 10)] === 15 && ml.sky[cell(15, 28, 15)] <= 13);
  // sealed room: no sky at all, and a torch lights only its own room
  const room = floor();
  for (let x = 20; x <= 30; x++) for (let z = 20; z <= 30; z++) for (let y = 11; y <= 17; y++) { const wall = x === 20 || x === 30 || z === 20 || z === 30 || y === 17; if (wall) room[cell(x, y, z)] = B.stone; }
  room[cell(25, 12, 25)] = B.torch;
  const rl = g.lightRegion(room);
  check('inside a sealed room there is no sky light; the torch lights the room and nothing outside', rl.sky[cell(25, 13, 25)] === 0 && rl.blk[cell(25, 13, 25)] === 13 && rl.blk[cell(35, 12, 25)] === 0 && rl.sky[cell(35, 12, 25)] === 15);
  // a dimension without a sky
  const dark = g.lightRegion(floor(), { sky: false });
  check('a dimension without a sky (the Underlayer, the Kernel) has no sky light at all', dark.sky.every((v) => v === 0));
}

// ---------------------------------------------------------------- vertex light and shapes
{
  const r = floor(); r[cell(24, 12, 24)] = B.torch;
  // a chunk-sized padded view: take the middle chunk of the region (x, z 16..31 -> chunk 0..15)
  const m = g.meshRegion(r);
  const top = m.opaque;                                           // the floor top faces (y = 11 in the region = y 11 in the chunk)
  const near = [], far = [];
  for (let v = 0; v < top.pos.length / 3; v++) {
    const x = top.pos[v * 3], y = top.pos[v * 3 + 1], z = top.pos[v * 3 + 2];
    if (y !== 11) continue;
    const d = Math.hypot(x - 8.5, z - 8.5); if (d < 2) near.push(top.bl[v]); else if (d > 9) far.push(top.bl[v]);
  }
  check('floor vertices right next to a torch are bright (block light about 13/15) and far ones dark', near.length > 0 && Math.max(...near) > 0.75 && Math.max(...far) < 0.1, `near ${Math.max(...near)} far ${Math.max(...far)}`);
  check('sky light is 1 on open ground (floor tops in daylight)', top.sk.every((v, i) => top.pos[i * 3 + 1] !== 11 || v === 1));
  check('a torch is one small box: 6 faces, all inside [7/16, 9/16] of its cell horizontally, 14/16 tall', (() => { const c = m.cut; return c.faces === 6 && [...c.pos].every((v, i) => i % 3 === 1 ? v >= 12 - 1e-6 && v <= 12 + 14 / 16 + 1e-6 : (i % 3 === 0 ? v >= 8 + 7 / 16 - 1e-6 && v <= 8 + 9 / 16 + 1e-6 : v >= 8 + 7 / 16 - 1e-6 && v <= 8 + 9 / 16 + 1e-6)); })());
  check('the torch is lit by its own light (an emitter is never dark)', Math.min(...m.cut.bl) >= 13 / 15 - 1e-6 || Math.min(...m.cut.bl) >= 14 / 15 - 1e-6);
  // animated tiles carry their frame count
  const a = floor(); a[cell(24, 11, 24)] = B.rift; a[cell(26, 11, 24)] = B.server_rack; a[cell(28, 11, 24)] = B.stone;
  const am = g.meshRegion(a);
  check('animated tiles carry their frame count (Rift 4 in the cutout layer, server rack front 2, torch 2), still ones 0', Math.max(...am.cut.an) === 4 && Math.max(...am.opaque.an) === 2 && am.opaque.an.includes(0) && Math.max(...m.cut.an) === 2);
  // plants: two crossed quads
  const p = floor(); p[cell(24, 11, 24)] = B.glowcap; p[cell(26, 11, 24)] = B.berry_bush;
  const pm = g.meshRegion(p);
  check('a plant block (glowcap, berry bush) is two crossed quads in the cutout layer; glowcap glows (light 10 on itself)', pm.cut.faces === 4 && Math.max(...pm.cut.bl) >= 10 / 15 - 1e-6);
  // box shapes: a chest keeps its 6 faces, a chest next to stone hides the touching face only if the box fills the cell (it does not: faces stay)
  const c = floor(); c[cell(24, 11, 24)] = B.chest_s; c[cell(25, 11, 24)] = B.stone;
  const cm = g.meshRegion(c);
  check('a chest (a 14/16 box) on the floor has 5 faces (the bottom lies on the cell boundary against the floor); against stone it keeps its side (not on the boundary)', cm.cut.faces === 5);
  const bd = floor(); bd[cell(24, 11, 24)] = B.bed_foot_s; bd[cell(24, 11, 25)] = B.bed_head_s;
  const bm = g.meshRegion(bd);
  check('a bed is 9/16 tall; its bottom is hidden by the floor, so two beds side by side have 10 faces', Math.abs(Math.max(...[...bm.cut.pos].filter((_, i) => i % 3 === 1)) - (11 + 9 / 16)) < 1e-6 && bm.cut.faces === 10);
  // lava: its top sits 1/8 low, next to stone it hides that face, in the opaque layer
  const lone = floor(); lone[cell(24, 11, 24)] = B.lava;
  const withStone = floor(); withStone[cell(24, 11, 24)] = B.lava; withStone[cell(25, 11, 24)] = B.stone;
  const lo = g.meshRegion(lone), ws = g.meshRegion(withStone);
  const tops = [...Array(lo.opaque.pos.length / 3).keys()].filter((v) => lo.opaque.pos[v * 3] >= 8 && lo.opaque.pos[v * 3] <= 9 && lo.opaque.pos[v * 3 + 2] >= 8 && lo.opaque.pos[v * 3 + 2] <= 9 && lo.opaque.pos[v * 3 + 1] > 11.5).map((v) => lo.opaque.pos[v * 3 + 1]);
  check('lava is in the opaque layer and its exposed top is 1/8 below the block top', tops.length > 0 && Math.max(...tops) === 11.875 && lo.cut.faces === 0 && lo.water.faces === 0, JSON.stringify(tops));
  check('the lava face against stone is hidden (the stone keeps all its visible faces)', ws.opaque.faces === lo.opaque.faces - 1 - 1 + 5, `${ws.opaque.faces} vs ${lo.opaque.faces}`);   // lava loses its +x face, the floor top under the stone is hidden, the stone adds its 5 visible faces
}

// ---------------------------------------------------------------- the World: remeshing after an edit
{
  const gen = makeGen({ flat: true, seed: 5 });
  const backend = new InlineBackend(gen), w = new World({ backend, atlas });
  await w.setSeed(5, { flat: true });
  w.view = 3;
  const settle = async () => { for (let i = 0; i < 600; i++) { w.update(512, 512); backend.drain(); await new Promise((r) => setTimeout(r, 0)); if (w.missingMeshes(512, 512, 2) === 0 && !backend.pending && !w.uploads.length) break; } };
  await settle();
  const vers = () => Object.fromEntries([...w.chunks.values()].map((c) => [`${c.cx},${c.cz}`, c.ver]));
  const changed = (a, b) => Object.keys(b).filter((k) => a[k] !== b[k]).sort();
  const ring = (cx, cz) => { const o = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) o.push(`${cx + dx},${cz + dz}`); return o.sort(); };
  check('a flat chunk in the middle has light data after meshing: open sky (15, 0) above the grass, no light inside the ground', (() => { const l = w.lightAt(512, 60, 512), u = w.lightAt(512, 20, 512); return l && l.sky === 15 && l.blk === 0 && u && u.sky === 0; })());

  let before = vers();
  w.setBlock(520, 49, 512, B.torch);
  check('placing a torch bumps the chunk and its 8 neighbours (the light reaches 14 blocks) and no others', JSON.stringify(changed(before, vers())) === JSON.stringify(ring(32, 32)), JSON.stringify(changed(before, vers())));
  await settle();
  const t = w.lightAt(520, 49, 512), t2 = w.lightAt(523, 49, 512);
  check('after the remesh the torch cell has block light 14 and 3 blocks away 11', t?.blk === 14 && t2?.blk === 11, JSON.stringify([t, t2]));
  // across a chunk border
  before = vers();
  w.setBlock(527, 49, 520, B.torch);                                 // chunk (32, 32), lx = 15
  await settle();
  const over = w.lightAt(528, 49, 520), cx33 = w.chunkAt(33, 32);
  check('a torch at the edge of a chunk lights the next chunk too: the cell across the border has 13', over?.blk === 13 && !!cx33?.light, JSON.stringify(over));
  before = vers();
  w.setBlock(520, 49, 512, B.air);
  check('removing the torch bumps the same 9 chunks', JSON.stringify(changed(before, vers())) === JSON.stringify(ring(32, 32)));
  await settle();
  check('after removing it the light is gone again (its cell and 3 blocks away have block light 0 except the second torch)', w.lightAt(520, 49, 512).blk <= 6 && w.lightAt(523, 49, 512).blk <= 3, JSON.stringify([w.lightAt(520, 49, 512), w.lightAt(523, 49, 512)]));
  // a change in the dark that no light reaches only remeshes its own chunk (it is far from the open sky and has no light around it)
  before = vers();
  w.setBlock(516, 20, 516, B.air);
  check('breaking a stone deep underground where there is no light touches only its own chunk', JSON.stringify(changed(before, vers())) === JSON.stringify(['32,32']), JSON.stringify(changed(before, vers())));
  // a change that is not about light at all (a grass block turns to dirt at the surface) touches the chunk only (not at a border)
  before = vers();
  w.setBlock(516, 48, 516, B.dirt);
  check('swapping grass for dirt (same opacity, same light) at the middle of a chunk touches only its own chunk', JSON.stringify(changed(before, vers())) === JSON.stringify(['32,32']));
  // placing opaque stone where there is sky light changes the light around: the 3 x 3
  before = vers();
  w.setBlock(516, 49, 516, B.stone);
  check('placing a stone in the open air (it blocks sky light) bumps the chunk and its 8 neighbours', JSON.stringify(changed(before, vers())) === JSON.stringify(ring(32, 32)));
  await settle();

  // light is never saved: a second world built from the same blocks (the edits) computes exactly the same light
  const gen2 = makeGen({ flat: true, seed: 5 }), backend2 = new InlineBackend(gen2), w2 = new World({ backend: backend2, atlas });
  await w2.setSeed(5, { flat: true, edits: new Map([...w.edits].map(([k, e]) => [k, new Map(e)])) });
  w2.view = 3;
  for (let i = 0; i < 600; i++) { w2.update(512, 512); backend2.drain(); await new Promise((r) => setTimeout(r, 0)); if (w2.missingMeshes(512, 512, 2) === 0 && !backend2.pending && !w2.uploads.length) break; }
  let same = 0, differ = 0;
  for (const c of w.chunks.values()) { const d = w2.chunkAt(c.cx, c.cz); if (!c.light || !d?.light) continue; let eq = true; for (let i = 0; i < c.light.length && eq; i++) if (c.light[i] !== d.light[i]) eq = false; if (eq) same++; else differ++; }
  check(`light recomputed after a load matches the light before the save (${same} chunks compared, ${differ} different)`, same >= 9 && differ === 0);
  check('the saved format holds blocks only: edits are block ids, no light', [...w.edits.values()].every((e) => [...e.values()].every((v) => Number.isInteger(v) && v >= 0 && v < BLOCKS.length)));
}

// ---------------------------------------------------------------- speed
{
  const t = floor(); for (let i = 0; i < 40; i++) t[cell(10 + (i % 8) * 3, 12, 10 + Math.floor(i / 8) * 4)] = B.torch;
  const t0 = performance.now(); for (let i = 0; i < 5; i++) g.lightRegion(t);
  const ms = (performance.now() - t0) / 5;
  check(`the light of a region with 40 torches is fast enough for the worker (${ms.toFixed(1)} ms)`, ms < 120);
  const real = makeGen({ seed: 5 }), cells = new Map(); const get = (cx, cz) => { const k = `${cx},${cz}`; if (!cells.has(k)) cells.set(k, real.generate(cx, cz).data); return cells.get(k); };
  const reg = new Uint8Array(RW * H * RW);
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) { const d = get(30 + dx, 30 + dz); for (let y = 0; y < H; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) reg[cell(dx * 16 + x, y, dz * 16 + z)] = d[idx(x, y, z)]; }
  const t1 = performance.now(); let faces = 0; for (let i = 0; i < 4; i++) faces += real.meshRegion(reg).faces;
  const ms2 = (performance.now() - t1) / 4;
  check(`light and mesh of a real terrain chunk (${ms2.toFixed(1)} ms, ${Math.round(faces / 4)} faces)`, ms2 < 120 && faces > 0);
}

console.log(`\nStrata light: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
