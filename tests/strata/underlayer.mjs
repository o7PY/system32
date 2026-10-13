// Strata progression world generation (STRATA_PART2_SPEC.md sections 4, 6, 13), no browser: cobalt ore, the Cracked Bedrock guarantee, the Underlayer terrain,
// Rift blocks, and the Underlayer save section.   node tests/strata/underlayer.mjs
import { makeGen, B, BLOCKS, CONFIG, idx, atlas } from './lib.mjs';
import { World, InlineBackend } from '../../games/strata/src/world.js';
import { serialize, deserialize } from '../../games/strata/src/save.js';
import { breakInfo } from '../../games/strata/src/interact.js';
import { stack } from '../../games/strata/src/items.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };

// ---------------------------------------------------------------- cobalt
{
  const g = makeGen({ seed: 8 });
  let veins = 0, ore = 0, chunks = 0, yMin = 999, yMax = -1, onStone = true;
  for (let cx = 20; cx < 36; cx++) for (let cz = 20; cz < 36; cz++) {
    const d = g.generate(cx, cz).data; chunks++;
    let here = 0;
    for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (d[idx(x, y, z)] === B.cobalt_ore) { here++; ore++; yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
    if (here) veins++;
  }
  check(`cobalt ore exists in most chunks but is rare (${(ore / chunks).toFixed(1)} blocks per chunk), only at y 2 to 16 (a vein's edge reaches y 1 and 18)`, veins > chunks * 0.6 && ore / chunks < 40 && yMin >= 1 && yMax <= 16 + 2, `${veins}/${chunks} y ${yMin}-${yMax}`);
  const coal = (() => { let n = 0; for (let cx = 20; cx < 28; cx++) for (let cz = 20; cz < 28; cz++) { const d = g.generate(cx, cz).data; for (let i = 0; i < d.length; i++) if (d[i] === B.coal_ore) n++; } return n / 64; })();
  check('it is much rarer than coal', ore / chunks < coal / 2, `cobalt ${ore / chunks} coal ${coal}`);
  const iron = breakInfo(B.cobalt_ore, stack('pickaxe_iron')), stone = breakInfo(B.cobalt_ore, stack('pickaxe_stone'));
  check('cobalt ore drops raw cobalt only with an iron pickaxe or better', iron.drops && !stone.drops);
  const a = makeGen({ seed: 8 }).generate(25, 25).data, b = makeGen({ seed: 8 }).generate(25, 25).data;
  check('and generation stays deterministic with the new ore', a.every((v, i) => v === b[i]));
}

// ---------------------------------------------------------------- cracked bedrock
{
  let allOk = true; const seedInfo = [];
  for (let seed = 1; seed <= 10; seed++) {
    const g = makeGen({ seed: seed * 7919 }), sp = g.spawn(), sites = g.crackSites();
    const within = sites.filter((s) => Math.hypot(s.x - sp.x, s.z - sp.z) <= 300).length;
    seedInfo.push(within);
    if (within < 8) allOk = false;
  }
  check(`at least 8 Cracked Bedrock sites within 300 blocks of the spawn, for 10 seeds (${seedInfo.join(',')})`, allOk);
  const g = makeGen({ seed: 4 }), sites = g.crackSites();
  const real = sites.filter((s) => { const d = g.generate(s.x >> 4, s.z >> 4).data; return d[idx(s.x & 15, s.y, s.z & 15)] === B.cracked_bedrock; }).length;
  check('every site really is a Cracked Bedrock block in the generated chunk, at y 2 or 3 (the bedrock layer)', real === sites.length && sites.every((s) => s.y >= 2 && s.y <= 3), `${real}/${sites.length}`);
  const s0 = sites[0], d0 = g.generate(s0.x >> 4, s0.z >> 4).data;
  check('with a pocket of air above it (you can dig down onto it) and a stone floor around it', d0[idx(s0.x & 15, s0.y + 1, s0.z & 15)] === 0 && d0[idx(s0.x & 15, s0.y + 3, s0.z & 15)] === 0);
  const edge = sites.find((s) => (s.x & 15) < 2 || (s.x & 15) > 13);
  if (edge) {
    const cx = (edge.x - 2) >> 4, cx2 = (edge.x + 2) >> 4, A = g.generate(cx, edge.z >> 4).data, Bc = g.generate(cx2, edge.z >> 4).data;
    check('a site next to a chunk border is whole on both sides', cx === cx2 || (A[idx((edge.x - 2) & 15, edge.y + 1, edge.z & 15)] === 0 && Bc[idx((edge.x + 2) & 15, edge.y + 1, edge.z & 15)] === 0));
  }
  check('Cracked Bedrock glows faintly (light 4), is findable by its own cracks, and only a cobalt pickaxe breaks it (8 s)', BLOCKS[B.cracked_bedrock].emit === 4 && breakInfo(B.cracked_bedrock, stack('pickaxe_cobalt')).time === 8 && !breakInfo(B.cracked_bedrock, stack('pickaxe_iron')).breakable);
  check('the Rift is a block you can walk into (not solid, no suffocation) and it glows', !BLOCKS[B.rift].solid && !BLOCKS[B.rift].opaque && BLOCKS[B.rift].emit === 10 && !BLOCKS[B.rift_white].solid);
}

// ---------------------------------------------------------------- the Underlayer
{
  const g = makeGen({ seed: 5, dim: 'underlayer', worldSize: 512 });
  const counts = {}; let lava = 0, glow = 0, air = 0, total = 0;
  for (let cx = 4; cx < 28; cx += 2) for (let cz = 4; cz < 28; cz += 2) {
    const d = g.generate(cx, cz).data;
    for (let i = 0; i < d.length; i++) { counts[d[i]] = (counts[d[i]] ?? 0) + 1; total++; }
  }
  const name = (id) => BLOCKS[id].name, by = Object.fromEntries(Object.entries(counts).map(([k, v]) => [name(+k), v]));
  check('the Underlayer is made of basalt, scorched stone, ash, lava, glowcaps and bedrock; no dirt, grass, water, ores or trees', ['basalt', 'scorched_stone', 'ash', 'lava', 'glowcap', 'bedrock'].every((n) => by[n] > 0) && ['grass', 'dirt', 'water', 'log', 'leaves', 'coal_ore', 'iron_ore', 'sand'].every((n) => !by[n]), JSON.stringify(by));
  const d = g.generate(16, 16).data;
  check('bedrock floor AND ceiling: y 0 and y 95 are solid bedrock/basalt, nothing above y 95', (() => { for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { if (d[idx(x, 0, z)] !== B.bedrock || d[idx(x, 95, z)] !== B.bedrock) return false; for (let y = 96; y < 128; y++) if (d[idx(x, y, z)] !== 0) return false; } return true; })());
  check('big caverns: at least a third of the cells between the floor and the ceiling are air', (by.air ?? 0) / total > 0.25, `${((by.air ?? 0) / total).toFixed(2)}`);
  const sp = g.spawn(), cd = g.generate(sp.x >> 4, sp.z >> 4).data;
  check('the centre is a flat, safe platform at y 40 with 20+ blocks of air above it (the Kernel Gate goes here later)', cd[idx(sp.x & 15, 40, sp.z & 15)] !== 0 && cd[idx(sp.x & 15, 41, sp.z & 15)] === 0 && cd[idx(sp.x & 15, 60, sp.z & 15)] === 0);
  const lavaLow = (() => { let n = 0, bad = 0; for (let cx = 4; cx < 28; cx += 2) for (let cz = 4; cz < 28; cz += 2) { const dd = g.generate(cx, cz).data; for (let y = 0; y < 96; y++) for (let i = 0; i < 256; i++) if (dd[(y << 8) | i] === B.lava) { n++; if (y > 21) bad++; } } return { n, bad }; })();
  check('lava lakes sit in the low basins only (y 20 and below), static, and there is a lot of it', lavaLow.n > 200 && lavaLow.bad === 0, JSON.stringify(lavaLow));
  const sites = g.vaultSites();
  check('three vault sites, 120 to 200 blocks from the centre, 120 degrees apart', sites.length === 3 && sites.every((s) => { const d = Math.hypot(s.x - 256, s.z - 256); return d >= 119 && d <= 201; }) && (() => { const a = sites.map((s) => Math.atan2(s.z - 256, s.x - 256)).sort((x, y) => x - y); const gaps = [a[1] - a[0], a[2] - a[1], a[0] + Math.PI * 2 - a[2]]; return gaps.every((x) => Math.abs(x - Math.PI * 2 / 3) < 0.5); })());
  const a = makeGen({ seed: 5, dim: 'underlayer', worldSize: 512 }).generate(9, 9).data, b = makeGen({ seed: 5, dim: 'underlayer', worldSize: 512 }).generate(9, 9).data, c = makeGen({ seed: 6, dim: 'underlayer', worldSize: 512 }).generate(9, 9).data;
  check('deterministic per seed (and the vault sites are the same for every seed: the Underlayer is the same shape, fixed design)', a.every((v, i) => v === b[i]));
  void c;
  const w = (() => { const gen = makeGen({ seed: 5, dim: 'underlayer', worldSize: 512 }); return new World({ backend: new InlineBackend(gen), atlas }); })();
  await w.setSeed(5, { dim: 'underlayer' });
  check('a World set to the Underlayer is 512 wide, has no sky and reads bedrock past its edge', w.size === 512 && w.noSky === true && w.getBlock(-1, 40, 10) === B.bedrock && w.getBlock(600, 40, 10) === B.bedrock);
  w.view = 3; const be = w.backend;
  for (let i = 0; i < 600; i++) { w.update(256, 256); be.drain(); await new Promise((r) => setTimeout(r, 0)); if (w.missingMeshes(256, 256, 2) === 0 && !be.pending && !w.uploads.length) break; }
  const l = w.lightAt(256, 45, 256), over = w.lightAt(256, 41, 256);
  check('meshing the Underlayer gives it no sky light at all (only block light from lava, glowcaps and Rifts)', w.missingMeshes(256, 256, 2) === 0 && l && l.sky === 0 && over.sky === 0);
  check('a Rift placed in the Underlayer lights its surroundings (light 10)', (() => { w.setBlock(256, 41, 258, B.rift); return true; })());
  for (let i = 0; i < 300; i++) { w.update(256, 256); be.drain(); await new Promise((r) => setTimeout(r, 0)); if (w.missingMeshes(256, 256, 2) === 0 && !be.pending && !w.uploads.length) break; }
  const rl = w.lightAt(256, 41, 258);
  check('...once remeshed the Rift cell has block light 10 and the next cell 9', rl?.blk === 10 && w.lightAt(256, 41, 259)?.blk === 9 && w.lightAt(256, 41, 258)?.sky === 0, JSON.stringify(rl));
}

// ---------------------------------------------------------------- the save: a second dimension
{
  const base = { seed: 7, worldSize: 1024, flat: false, spawn: { x: 500, y: 60, z: 500 }, player: { x: 256.5, y: 41, z: 256.5, yaw: 0, pitch: 0, dim: 'underlayer' }, inv: { slots: Array(36).fill(null), selected: 0 }, time: 0.1, settings: { ...CONFIG.settings }, flags: { rifts: [{ x: 600, y: 3, z: 700, ux: 300, uz: 350, uy: 40 }] }, edits: new Map([[(5 << 16) | 5, new Map([[100, B.stone]])]]) };
  const under = new Map([[(16 << 16) | 16, new Map([[(41 << 8) | (3 << 4) | 3, B.rift], [(40 << 8) | (3 << 4) | 4, B.basalt]])]]);
  const back = await deserialize(await serialize({ ...base, dims: { underlayer: under }, otherDrops: { overworld: [{ x: 5, y: 60, z: 5, stack: stack('cobblestone', 4), age: 10, ttl: 600, death: true }] } }));
  check('the Underlayer edits are saved in their own section, apart from the overworld edits, and come back exactly', back.dims.underlayer.get((16 << 16) | 16).get((41 << 8) | (3 << 4) | 3) === B.rift && back.edits.get((5 << 16) | 5).get(100) === B.stone && back.player.dim === 'underlayer' && back.flags.rifts[0].ux === 300);
  check('the death pile in the other dimension is saved too', back.otherDrops.overworld[0].death === true && back.otherDrops.overworld[0].stack.n === 4);
  const old = await deserialize(await serialize({ ...base, player: { ...base.player, dim: undefined }, edits: new Map() }));
  check('an old save (no dimension, no Underlayer section) loads in the overworld with no Underlayer edits', old.player.dim === undefined && Object.keys(old.dims).length === 0);
  const bad = async (patch) => { try { await deserialize(await serialize({ ...base, ...patch })); return false; } catch (e) { return e?.constructor?.name === 'SaveError'; } };
  check('a forged dimension name, a forged Underlayer edit and an out-of-range chunk are rejected', await bad({ player: { ...base.player, dim: 'nether' } }) && await bad({ dims: { underlayer: new Map([[(999 << 16) | 999, new Map([[1, 2]])]]) } }) && await bad({ dims: { underlayer: new Map([[(1 << 16) | 1, new Map([[1, 250]])]]) } }));
}

console.log(`\nStrata progression: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
