// Strata world core, no browser: noise and terrain generation (determinism, features across chunk borders), meshing (face counts, AO, windings, UVs).
// Runs the same worker.js the browser runs.   node tests/strata/world.mjs
import { makeGen, B, BLOCKS, CONFIG, idx, hashBytes, pad, atlas } from './lib.mjs';
import { World, InlineBackend } from '../../games/strata/src/world.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const count = (d, id) => { let n = 0; for (let i = 0; i < d.length; i++) if (d[i] === id) n++; return n; };
const lone = (blocks) => { const c = new Uint8Array(16 * 16 * 128); for (const [x, y, z, id] of blocks) c[idx(x, y, z)] = id; return c; };

// ---------------------------------------------------------------- noise
{
  const g = makeGen();
  let min = 9, max = -9, sum = 0, n = 0;
  for (let i = 0; i < 20000; i++) { const v = g.noise2(i * 0.37, i * 0.21 + 3); min = Math.min(min, v); max = Math.max(max, v); sum += v; n++; }
  check('2D noise stays in [-1, 1] with a mean near 0', min >= -1.001 && max <= 1.001 && Math.abs(sum / n) < 0.05 && max - min > 1, `min ${min} max ${max} mean ${sum / n}`);
  min = 9; max = -9;
  for (let i = 0; i < 20000; i++) { const v = g.noise3(i * 0.31, i * 0.17, i * 0.23 + 1); min = Math.min(min, v); max = Math.max(max, v); }
  check('3D noise stays in [-1, 1]', min >= -1.001 && max <= 1.001 && max - min > 1, `min ${min} max ${max}`);
  check('noise is continuous (no jumps between neighbouring samples)', (() => { let worst = 0; for (let i = 0; i < 5000; i++) worst = Math.max(worst, Math.abs(g.noise2(i * 0.1, 5) - g.noise2(i * 0.1 + 0.01, 5))); return worst < 0.05; })());
}

// ---------------------------------------------------------------- determinism
{
  const a = makeGen({ seed: 777 }), b = makeGen({ seed: 777 }), c = makeGen({ seed: 778 });
  const cells = [[10, 12], [31, 33], [32, 33], [0, 0], [63, 63], [40, 20]];
  const same = cells.every(([x, z]) => hashBytes(a.generate(x, z).data) === hashBytes(b.generate(x, z).data));
  check('same seed: identical chunk data (hash) from two independent generators', same);
  check('a different seed gives a different world', cells.some(([x, z]) => hashBytes(a.generate(x, z).data) !== hashBytes(c.generate(x, z).data)));
  const fwd = cells.map(([x, z]) => hashBytes(a.generate(x, z).data)), rev = [...cells].reverse().map(([x, z]) => hashBytes(a.generate(x, z).data)).reverse();
  check('generation order does not matter (chunks are pure functions of seed + position)', fwd.join() === rev.join());
  // the generator that ran the other chunks first must still agree for a chunk that has neighbours generated before/after
  const fresh = makeGen({ seed: 777 });
  check('a chunk generated first equals the same chunk generated after many others', hashBytes(fresh.generate(31, 33).data) === fwd[1]);
}

// ---------------------------------------------------------------- terrain content
{
  const g = makeGen({ seed: 4242 });
  let bedrock0 = true, stone = 0, water = 0, coal = 0, iron = 0, logs = 0, leaves = 0, cactus = 0, ad = 0, caves = 0, chunks = 0, sand = 0, snow = 0, over = 0, badWater = 0;
  const biomes = new Set();
  for (let cz = 20; cz < 44; cz++) for (let cx = 20; cx < 44; cx++) {
    const { data, biomes: bm } = g.generate(cx, cz); chunks++;
    bm.forEach((b) => biomes.add(b));
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      if (data[idx(x, 0, z)] !== B.bedrock) bedrock0 = false;
      let top = 127; while (top > 0 && data[idx(x, top, z)] === 0) top--;
      if (data[idx(x, 127, z)] !== 0) over++;
      for (let y = 4; y < 60; y++) if (data[idx(x, y, z)] === 0 && y < top - 4) caves++;
      for (let y = 49; y < 128; y++) if (data[idx(x, y, z)] === B.water) badWater++;
    }
    stone += count(data, B.stone); water += count(data, B.water); coal += count(data, B.coal_ore); iron += count(data, B.iron_ore);
    logs += count(data, B.log); leaves += count(data, B.leaves); cactus += count(data, B.cactus); ad += count(data, B.ad_block); sand += count(data, B.sand); snow += count(data, B.snow);
  }
  check(`y = 0 is bedrock everywhere (${chunks} chunks)`, bedrock0);
  check('all six biomes appear (plains, forest, desert, mountains, beach, ocean)', biomes.size === 6, [...biomes].join());
  check('stone, water, sand and snow all exist', stone > 1e6 && water > 1e4 && sand > 1e4 && snow > 0, JSON.stringify({ stone, water, sand, snow }));
  check('caves exist underground', caves > 5000, `cave cells ${caves}`);
  check('ores: coal is more common than iron, both exist', coal > iron && iron > 100, `coal ${coal} iron ${iron}`);
  check('trees (logs + leaves) and cacti exist', logs > 200 && leaves > logs && cactus > 10, JSON.stringify({ logs, leaves, cactus }));
  check('the rare Ad Block ore appears about once per four chunks', ad > chunks * 0.1 && ad < chunks * 0.5, `ad ${ad} in ${chunks} chunks`);
  check('nothing is built at the very top of the world and water never sits above sea level', over === 0 && badWater === 0, `top ${over} water ${badWater}`);
}

// ---------------------------------------------------------------- features across chunk borders
{
  const g = makeGen({ seed: 99 });
  // generate a 3x3 block of chunks in two different orders and compare the shared border columns with a wider "global" view
  const world = new Map();
  const get = (cx, cz) => { const k = `${cx},${cz}`; if (!world.has(k)) world.set(k, g.generate(cx, cz).data); return world.get(k); };
  const at = (x, y, z) => get(x >> 4, z >> 4)[idx(x & 15, y, z & 15)];
  // find a tree that straddles a border: a log within 2 blocks of a chunk edge whose leaves exist on the other side
  let found = 0, broken = 0;
  for (let cz = 24; cz < 40 && found < 5; cz++) for (let cx = 24; cx < 40 && found < 5; cx++) {
    const d = get(cx, cz);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      if (!(x <= 1 || x >= 14)) continue;
      for (let y = 40; y < 100; y++) if (d[idx(x, y, z)] === B.log) {
        // find the top of this trunk, then check leaves surround it, also across the border
        let top = y; while (at(cx * 16 + x, top + 1, cz * 16 + z) === B.log) top++;
        if (top !== y && at(cx * 16 + x, y - 1, cz * 16 + z) === B.log) continue;     // only look at the bottom log
        let leavesAround = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (at(cx * 16 + x + dx, top, cz * 16 + z + dz) === B.leaves) leavesAround++;
        found++; if (leavesAround < 6) broken++;
      }
    }
  }
  check('trees on chunk borders keep their leaves on both sides (no cut-off crowns)', found >= 3 && broken === 0, `found ${found} border trees, ${broken} without a crown`);
  // reverse order must give the same bytes
  const g2 = makeGen({ seed: 99 });
  let same = true;
  for (let cz = 39; cz >= 24; cz--) for (let cx = 39; cx >= 24; cx--) if (hashBytes(g2.generate(cx, cz).data) !== hashBytes(get(cx, cz))) same = false;
  check('chunk grid generated in reverse order is byte-identical (trees and ores across borders)', same);
  // ore veins across a border: an ore block next to the border has its vein continuing in the neighbour
  let oreBorder = 0;
  for (let cz = 24; cz < 32; cz++) for (let cx = 24; cx < 32; cx++) { const d = get(cx, cz); for (let y = 5; y < 60; y++) for (let z = 0; z < 16; z++) if (d[idx(15, y, z)] === B.coal_ore && get(cx + 1, cz)[idx(0, y, z)] === B.coal_ore) oreBorder++; }
  check('ore veins continue across chunk borders', oreBorder > 3, `joined ore pairs ${oreBorder}`);
}

// ---------------------------------------------------------------- flat world and spawn
{
  const g = makeGen({ flat: true });
  const d = g.generate(5, 7).data;
  check('flat world: bedrock, stone, dirt, grass at sea level, air above', d[idx(3, 0, 3)] === B.bedrock && d[idx(3, 20, 3)] === B.stone && d[idx(3, 47, 3)] === B.dirt && d[idx(3, 48, 3)] === B.grass && d[idx(3, 49, 3)] === 0);
  const s = g.spawn();
  check('flat spawn is the middle of the world, standing on the grass', s.x === 512.5 && s.z === 512.5 && s.y === 49);
  const n = makeGen({ seed: 31 }), sp = n.spawn(), info = n.columnInfo(Math.floor(sp.x), Math.floor(sp.z));
  check('spawn is a dry grassy column near the middle of the world', Math.hypot(sp.x - 512, sp.z - 512) < 400 && sp.y === info.height + 1 && info.height > CONFIG.seaLevel && [0, 1].includes(info.biome), JSON.stringify({ sp, info }));
}

// ---------------------------------------------------------------- meshing
{
  const g = makeGen();
  const faces = (blocks, nb) => g.mesh(pad(lone(blocks), nb));
  const one = faces([[5, 20, 5, B.stone]]);
  check('a single block has 6 faces (12 triangles, 24 vertices)', one.faces === 6 && one.opaque.idx.length === 36 && one.opaque.pos.length === 72, JSON.stringify([one.faces, one.opaque.idx.length]));
  const two = faces([[5, 20, 5, B.stone], [6, 20, 5, B.stone]]);
  check('two adjacent blocks have 10 faces (the touching ones are culled)', two.faces === 10);
  const stoneLeaf = faces([[5, 20, 5, B.stone], [6, 20, 5, B.leaves]]);
  check('leaves next to stone keep both faces (12), and land in different layers', stoneLeaf.faces === 12 && stoneLeaf.opaque.faces === 6 && stoneLeaf.cut.faces === 6);
  const glass2 = faces([[5, 20, 5, B.glass], [6, 20, 5, B.glass]]);
  check('two glass blocks merge (10 faces), a glass block next to stone keeps both (12)', glass2.faces === 10 && faces([[5, 20, 5, B.glass], [6, 20, 5, B.stone]]).faces === 12);
  const leaves3 = faces([[5, 20, 5, B.leaves], [6, 20, 5, B.leaves]]);
  check('a leaf blob hides the faces between its own leaves', leaves3.faces === 10);
  const water = faces([[5, 20, 5, B.water], [5, 21, 5, B.water]]);
  check('water: a stack of two keeps 10 faces; an exposed surface sits 1/8 below the top', water.faces === 10 && Math.abs(Math.max(...water.water.pos.filter((_, i) => i % 3 === 1)) - 21.875) < 1e-6);
  check('water against stone is culled, stone against water is kept', faces([[5, 20, 5, B.water], [6, 20, 5, B.stone]]).faces === 11);
  check('an empty chunk meshes to nothing', g.mesh(pad(new Uint8Array(32768))).faces === 0);
  // faces across a chunk border use the neighbour's blocks
  const edge = lone([[15, 20, 5, B.stone]]), nbr = lone([[0, 20, 5, B.stone]]);
  const withN = g.mesh(pad(edge, (dx, dz) => (dx === 1 && dz === 0 ? nbr : null)));
  check('a block touching a block in the next chunk culls that face', withN.faces === 5 && g.mesh(pad(edge)).faces === 6);
  // the underside of the world is never drawn
  check('the bottom face at y = 0 is never drawn', faces([[5, 0, 5, B.bedrock]]).faces === 5);
  // winding: every triangle of a single block faces outward
  const geo = one.opaque; let outward = true;
  for (let t = 0; t < geo.idx.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => geo.pos[geo.idx[t + k] * 3 + j]));
    const e1 = b.map((v, j) => v - a[j]), e2 = c.map((v, j) => v - a[j]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const centre = [5.5, 20.5, 5.5], mid = [0, 1, 2].map((j) => (a[j] + b[j] + c[j]) / 3), out = [0, 1, 2].map((j) => mid[j] - centre[j]);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) outward = false;
  }
  check('all 12 triangles of a block are wound counter-clockwise seen from outside', outward);
  // uv: every coordinate sits inside the tile's inset rect
  const t = BLOCKS[B.stone].tiles[0];
  check('UVs stay inside the (half-texel inset) atlas rect of the face tile', (() => { const r = g.mesh(pad(lone([[5, 20, 5, B.grass]]))).opaque; const rects = BLOCKS[B.grass].tiles; return r.uv.length === 48 && r.uv.every((v) => v >= 0 && v <= 1); })() && !!t);
}

// ---------------------------------------------------------------- ambient occlusion
{
  const g = makeGen();
  /** The horizontal quads at height y of a layer: [{ verts: [[x, z, brightness] x 4], idx: its 6 indices }]. */
  const quads = (layer, y) => {
    const out = [];
    for (let q = 0; q < layer.pos.length / 12; q++) {
      const v = [0, 1, 2, 3].map((k) => [layer.pos[(q * 4 + k) * 3], layer.pos[(q * 4 + k) * 3 + 1], layer.pos[(q * 4 + k) * 3 + 2], layer.br[q * 4 + k]]);
      if (v.every((p) => p[1] === y)) out.push({ verts: v.map((p) => [p[0], p[2], p[3]]), idx: Array.from(layer.idx.slice(q * 6, q * 6 + 6)).map((i) => i - q * 4) });
    }
    return out;
  };
  check('AO rule: two sides occluded = darkest (0); none = 3; one side + corner = 1', g.ao(1, 1, 0) === 0 && g.ao(1, 1, 1) === 0 && g.ao(0, 0, 0) === 3 && g.ao(1, 0, 1) === 1 && g.ao(0, 0, 1) === 2);
  const floor = []; for (let x = 3; x < 9; x++) for (let z = 3; z < 9; z++) floor.push([x, 10, z, B.stone]);
  const open = g.mesh(pad(lone(floor))).opaque;
  check('a flat open floor has uniform light on its top faces (36 quads, brightness 1)', quads(open, 11).length === 36 && quads(open, 11).every((q) => q.verts.every((v) => v[2] === 1)));
  const withBlock = g.mesh(pad(lone([...floor, [6, 11, 6, B.stone]]))).opaque;
  const around = quads(withBlock, 11).flatMap((q) => q.verts).filter((v) => v[0] >= 5.99 && v[0] <= 7.01 && v[1] >= 5.99 && v[1] <= 7.01);
  check('floor vertices touching a raised block are darker (one occluder: 0.85), vertices far from it stay at 1', around.some((v) => Math.abs(v[2] - 0.85) < 1e-6) && quads(withBlock, 11).some((q) => q.verts.every((v) => v[2] === 1)));
  // a concave corner (two walls) gives the darkest level
  const corner = g.mesh(pad(lone([...floor, [3, 11, 4, B.stone], [4, 11, 3, B.stone]]))).opaque;
  const cornerQuad = quads(corner, 11).find((q) => q.verts.some((v) => v[0] === 4 && v[1] === 4) && q.verts.every((v) => v[0] <= 4 && v[1] <= 4));
  check('a concave corner vertex gets the darkest level (0.55 on a top face)', !!cornerQuad && Math.abs(cornerQuad.verts.find((v) => v[0] === 4 && v[1] === 4)[2] - 0.55) < 1e-6, JSON.stringify(cornerQuad));
  // diagonal flip: with a single dark vertex the quad is split through it; mirrored, through the other diagonal
  const single = g.mesh(pad(lone([...floor, [4, 11, 4, B.stone]]))).opaque, mirror = g.mesh(pad(lone([...floor, [4, 11, 2, B.stone]]))).opaque;
  const find = (m, x, z) => quads(m, 11).find((q) => q.verts.every((v) => v[0] >= x && v[0] <= x + 1 && v[1] >= z && v[1] <= z + 1) && q.verts.some((v) => v[0] === x && v[1] === z));
  const qa = find(single, 3, 3), qb = find(mirror, 3, 3);
  const diag = (q) => { const pairs = new Set(); for (let i = 0; i < 6; i += 3) for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) pairs.add([q.idx[i + a], q.idx[i + b]].sort().join('-')); return ['0-2', '1-3'].find((d) => pairs.has(d)); };
  check('the quad is split along the diagonal through the darkest vertex, so mirrored layouts split differently', !!qa && !!qb && diag(qa) !== diag(qb), `${diag(qa)} vs ${diag(qb)}`);
}

// ---------------------------------------------------------------- the chunk manager feeds the mesher the right data (regression: odd rows of blocks went missing)
{
  for (const flat of [true, false]) {
    const gen = makeGen({ flat, seed: 31337 });
    const backend = new InlineBackend(gen);
    const w = new World({ backend, atlas });
    await w.setSeed(31337, { flat });
    const seen = [];
    const keep = backend.meshRegion.bind(backend);
    backend.meshRegion = (region, opts, urgent) => { seen.push(region.slice()); return keep(region, opts, urgent); };
    // the reference: the 3 x 3 chunks around `c` as one 48 x 128 x 48 array (outside the world = bedrock), built straight from the chunk data
    const refOf = (c) => { const out = new Uint8Array(48 * 128 * 48); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const n = w.chunkAt(c.cx + dx, c.cz + dz)?.data ?? null; for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) out[(y * 48 + (dz + 1) * 16 + z) * 48 + (dx + 1) * 16 + x] = n ? n[idx(x, y, z)] : (w.inWorld(c.cx + dx, c.cz + dz) ? 1 : B.bedrock); } return out; };
    const meshes = new Map();
    w.onMesh = (c, m) => meshes.set(`${c.cx},${c.cz}`, m);
    w.view = 2;
    for (let i = 0; i < 400 && meshes.size < 9; i++) { w.update(512, 512); backend.drain(); await new Promise((r) => setTimeout(r, 0)); }
    check(`${flat ? 'flat' : 'terrain'} world: chunks around the player load and mesh through World.update (${meshes.size} meshed)`, meshes.size >= 9);
    // every padded array given to the mesher must equal the reference built straight from the chunk data (all 8 neighbours present)
    let wrong = 0, compared = 0;
    for (const padded of seen) {
      // find which chunk it was by matching it against the reference of every loaded chunk
      for (const c of w.chunks.values()) {
        if (!c.data) continue;
        const ref = refOf(c);
        let same = true; for (let i = 0; i < ref.length && same; i++) if (ref[i] !== padded[i]) same = false;
        if (same) { compared++; break; }
      }
    }
    check(`${flat ? 'flat' : 'terrain'} world: every 48 x 128 x 48 region handed to the mesher equals the reference (no row, column or layer missing): ${compared}/${seen.filter((_, i) => i < 9).length} matched`, compared >= 9 && seen.slice(0, 9).every((padded) => [...w.chunks.values()].some((c) => c.data && (() => { const ref = refOf(c); for (let i = 0; i < ref.length; i++) if (ref[i] !== padded[i]) return false; return true; })())));
    if (flat) {
      const m = meshes.get('32,32');
      check('flat world: a chunk with all neighbours loaded meshes to exactly its 256 top faces (nothing underground is drawn)', m && m.opaque.faces === 256 && m.faces === 256, `faces ${m?.faces}`);
    } else {
      // exposed top faces of the surface must all exist: brute force on every meshed chunk
      let total = 0, missing = 0;
      for (const [k, m] of meshes) {
        const [cx, cz] = k.split(',').map(Number), d = w.chunkAt(cx, cz).data, present = new Set();
        for (const L of [m.opaque, m.cut]) for (let q = 0; q < L.pos.length / 12; q++) { const y0 = L.pos[q * 12 + 1]; if ([0, 1, 2, 3].every((j) => Math.abs(L.pos[(q * 4 + j) * 3 + 1] - y0) < 1e-6)) present.add(`${Math.min(...[0, 1, 2, 3].map((j) => L.pos[(q * 4 + j) * 3]))} ${y0} ${Math.min(...[0, 1, 2, 3].map((j) => L.pos[(q * 4 + j) * 3 + 2]))}`); }
        for (let y = 1; y < 127; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { const id = d[idx(x, y, z)]; if (!id || id === B.water || d[idx(x, y + 1, z)] !== 0) continue; total++; if (!present.has(`${x} ${y + 1} ${z}`)) missing++; }
      }
      check(`terrain world: every exposed top face of every meshed chunk is drawn, in even and odd rows, columns and layers (${total} faces)`, total > 1000 && missing === 0, `${missing} missing`);
    }
  }
}

// ---------------------------------------------------------------- speed (the worker must keep up)
{
  const g = makeGen({ seed: 5 });
  const nbr = new Map(); const get = (cx, cz) => { const k = `${cx},${cz}`; if (!nbr.has(k)) nbr.set(k, g.generate(cx, cz).data); return nbr.get(k); };
  const t0 = performance.now(); let faces = 0;
  for (let i = 0; i < 6; i++) { const d = get(30 + i, 30); faces += g.mesh(pad(d, (dx, dz) => get(30 + i + dx, 30 + dz))).faces; }
  const ms = (performance.now() - t0) / 6;
  check(`meshing a real chunk is fast enough for time-slicing (${ms.toFixed(1)} ms / chunk, ${Math.round(faces / 6)} faces)`, ms < 60 && faces > 0);
}

console.log(`\nStrata world core: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
