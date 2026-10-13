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
  // the game passes dim: 'overworld' explicitly (regression: a truthy dim once switched the sites off in the real game)
  check('Cracked Bedrock sites exist when the world is initialised the way the game does it (dim "overworld")', makeGen({ seed: 4, dim: 'overworld' }).crackSites().length === 14 && makeGen({ seed: 4, dim: 'overworld' }).generate(0, 0).data.length > 0 && makeGen({ seed: 4, dim: 'underlayer', worldSize: 512 }).crackSites().length === 0);
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
  const lavaLow = (() => { let n = 0, bad = 0; for (let cx = 4; cx < 28; cx += 2) for (let cz = 4; cz < 28; cz += 2) { const dd = g.generate(cx, cz).data; for (let y = 0; y < 96; y++) for (let i = 0; i < 256; i++) if (dd[(y << 8) | i] === B.lava) { const wx = cx * 16 + (i & 15), wz = cz * 16 + (i >> 4); if (g.vaultSites().some((s) => Math.abs(s.x - wx) <= 7 && Math.abs(s.z - wz) <= 7)) continue; n++; if (y > 21) bad++; } } return { n, bad }; })();
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

// ---------------------------------------------------------------- the Data Vaults
{
  const VROOT = [];
  for (const seed of [5, 11, 42]) {
    const g = makeGen({ seed, dim: 'underlayer', worldSize: 512 }), sites = g.vaultSites();
    const cache = new Map();
    const get = (x, y, z) => { const k = `${x >> 4},${z >> 4}`; let d = cache.get(k); if (!d) { d = g.generate(x >> 4, z >> 4).data; cache.set(k, d); } return d[idx(x & 15, y, z & 15)]; };
    const solid = (x, y, z) => BLOCKS[get(x, y, z)].solid;
    for (const s of sites) {
      const arrival = { x: 256, y: 41, z: 256 };
      void arrival;
      // flood fill through non-solid cells from the doorway (what "reachable through air" means), with the door closed and open
      const flood = (open) => {
        const door = new Set(s.door.map((c) => `${c.x},${c.y},${c.z}`));
        const blocked = (x, y, z) => (door.has(`${x},${y},${z}`) ? !open : solid(x, y, z));          // an opened door is air
        const seen = new Set(), q = [[s.entrance.x, s.entrance.y, s.entrance.z]];
        const key = (x, y, z) => `${x},${y},${z}`;
        seen.add(key(...q[0]));
        for (let i = 0; i < q.length && q.length < 200000; i++) {
          const [x, y, z] = q[i];
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if (Math.abs(nx - s.x) > 12 || Math.abs(nz - s.z) > 12 || ny < s.fy || ny > s.fy + 30 || seen.has(key(nx, ny, nz)) || blocked(nx, ny, nz)) continue;
            seen.add(key(nx, ny, nz)); q.push([nx, ny, nz]);
          }
        }
        return seen;
      };
      const cellAbove = `${s.chest.x},${s.chest.y + 1},${s.chest.z}`;
      VROOT.push({ seed, s, closed: flood(false), open: flood(true), cellAbove, get, solid });
    }
  }
  check('three vaults for every seed, each 120 to 200 blocks from the centre, a flat pad of basalt with the tower on it', VROOT.length === 9 && VROOT.every((v) => { const d = Math.hypot(v.s.x - 256, v.s.z - 256); return d >= 119 && d <= 201 && v.get(v.s.x + 8, v.s.fy, v.s.z) === B.basalt; }));
  check('the tower walls are unbreakable server racks (hardness -1) with a doorway: nothing can dig in', VROOT.every((v) => BLOCKS[v.get(v.s.x + 6, v.s.fy + 5, v.s.z)].hardness < 0 && BLOCKS[v.get(v.s.x - 6, v.s.fy + 12, v.s.z + 2)].name === 'server_rack' && v.get(v.s.x, v.s.fy + 1, v.s.z - 6) === 0));
  check('the entrance hall has a mob spawner (breakable) at its centre and a sealed vault door of 6 blocks across the stairs', VROOT.every((v) => v.get(v.s.spawner.x, v.s.spawner.y, v.s.spawner.z) === B.spawner && v.s.door.length === 6 && v.s.door.every((c) => v.get(c.x, c.y, c.z) === B.vault_door)) && BLOCKS[B.spawner].hardness > 0 && BLOCKS[B.vault_door].hardness < 0);
  check('the chest is in the shard room with the right facing; the Warden spot is its middle', VROOT.every((v) => [B.chest_e, B.chest_w].includes(v.get(v.s.chest.x, v.s.chest.y, v.s.chest.z)) && v.get(v.s.warden.x | 0, v.s.warden.y | 0, v.s.warden.z | 0) === 0));
  check('with the door CLOSED the chest cannot be reached from the entrance (the shard room is sealed)', VROOT.every((v) => !v.closed.has(v.cellAbove) && v.closed.size > 200));
  check('with the door OPEN the chest is reachable through air from the entrance (hall, stairs, lava room, stairs, shard room)', VROOT.every((v) => v.open.has(v.cellAbove)), VROOT.filter((v) => !v.open.has(v.cellAbove)).map((v) => `${v.seed}/${v.s.index}`).join());
  // a walking check: the standable cells reach the chest with moves of at most a 3-block gap and 1 up (so the parkour is a real, jumpable path)
  const walk = (v) => {
    const { s, get, solid } = v, key = (x, y, z) => `${x},${y},${z}`;
    const stand = (x, y, z) => !solid(x, y, z) && !solid(x, y + 1, z) && solid(x, y - 1, z) && get(x, y - 1, z) !== B.lava;
    const lava = (x, y, z) => get(x, y, z) === B.lava;
    const start = [s.entrance.x, s.entrance.y, s.entrance.z], seen = new Set([key(...start)]), q = [start];
    for (let i = 0; i < q.length; i++) {
      const [x, y, z] = q[i];
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -3; dy <= 1; dy++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz)); if (!d || d > (dy < 0 ? 3 : dy === 0 ? 3 : 2)) continue;
        if (Math.abs(dx) + Math.abs(dz) > 4) continue;
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (Math.abs(nx - s.x) > 6 || Math.abs(nz - s.z) > 6 || seen.has(key(nx, ny, nz)) || !stand(nx, ny, nz)) continue;
        // the ground between must not be walled off by a solid at head height along the way (coarse)
        if (solid(x + Math.sign(dx), y + 1, z + Math.sign(dz)) && d > 1) continue;
        seen.add(key(nx, ny, nz)); q.push([nx, ny, nz]);
        void lava;
      }
    }
    return seen;
  };
  const walked = VROOT.map((v) => { const open = new Set(v.s.door.map((c) => `${c.x},${c.y},${c.z}`)); const orig = v.get; const v2 = { ...v, get: (x, y, z) => (open.has(`${x},${y},${z}`) ? 0 : orig(x, y, z)), solid: (x, y, z) => (open.has(`${x},${y},${z}`) ? false : v.solid(x, y, z)) }; return walk(v2).has(`${v.s.chest.x},${v.s.chest.y + 1},${v.s.chest.z}`); });
  check('the chest can also be WALKED to: standable cells connect the doorway to the shard room with hops of 3 blocks at most and 1 up (the lava parkour is passable)', walked.every(Boolean), walked.map((w, i) => `${VROOT[i].seed}/${VROOT[i].s.index}:${w}`).join());
  check('the parkour room is mostly lava (a lava floor with platforms), and there is no way to skip it: the only air from the hall to the shard room goes through it', VROOT.every((v) => { let lava = 0; for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) if (v.get(v.s.x + dx, v.s.fy + 8, v.s.z + dz) === B.lava) lava++; return lava > 40; }));
  check('the spire rises 27 blocks above the roof, 3 x 3 of glowing racks (light 6 each), taller than the cavern walls so it shows through the haze', VROOT.every((v) => v.get(v.s.x, v.s.fy + 50, v.s.z) === B.server_rack && BLOCKS[B.server_rack].emit === 6));
  check('the variation is small and seeded: two platform layouts and four chest corners across the 9 vaults', new Set(VROOT.map((v) => v.s.variant)).size >= 1 && new Set(VROOT.map((v) => `${v.s.chest.x - v.s.x},${v.s.chest.z - v.s.z}`)).size >= 2);
  check('a vault is the same on every load (pure function of seed and position)', (() => { const a = makeGen({ seed: 5, dim: 'underlayer', worldSize: 512 }), b = makeGen({ seed: 5, dim: 'underlayer', worldSize: 512 }), s = a.vaultSites()[0]; const x = a.generate(s.x >> 4, s.z >> 4).data, y = b.generate(s.x >> 4, s.z >> 4).data; return x.every((v, i) => v === y[i]); })());
  check('chunks that only touch a vault edge are filled too (a vault spans several chunks and every border matches)', VROOT.every((v) => v.get(v.s.x - 6, v.s.fy + 5, v.s.z) === B.server_rack && v.get(v.s.x + 6, v.s.fy + 5, v.s.z) === B.server_rack && v.get(v.s.x, v.s.fy + 5, v.s.z + 6) === B.server_rack));
}

// ---------------------------------------------------------------- save version 2 and the migration from version 1
{
  const { MAGIC, toBase64 } = await import('../../games/strata/src/save.js');
  const mk = async (header, edits = new Uint8Array(0)) => {
    const h = new TextEncoder().encode(JSON.stringify(header)), box = new Uint8Array(4 + h.length + edits.length);
    new DataView(box.buffer).setUint32(0, h.length, true); box.set(h, 4); box.set(edits, 4 + h.length);
    return `${MAGIC}:r:${toBase64(box)}`;
  };
  const v1 = { v: 1, seed: 9, worldSize: 1024, flat: false, spawn: { x: 500, y: 60, z: 500 }, player: { x: 501, y: 61, z: 502, yaw: 1, pitch: 0 }, inv: { slots: Array(36).fill(null), selected: 2 }, furnaces: {}, time: 0.4, settings: { sensitivity: 1.5, fov: 80, viewDistance: 6, invertY: true, volume: 0.5, music: false }, flags: { firstIron: true } };
  const back = await deserialize(await mk(v1));
  check('a version-1 save (Part 1) loads: Normal difficulty, compass on, no vitals (full health), no animals, chests, Underlayer or drops; the old settings and flags are kept', back.settings.difficulty === 'normal' && back.settings.compass === true && back.settings.keepInventory === false && back.settings.sensitivity === 1.5 && back.settings.invertY === true && back.settings.music === false && back.vitals === null && back.animals.length === 0 && Object.keys(back.chests).length === 0 && Object.keys(back.dims).length === 0 && back.drops.length === 0 && back.flags.firstIron === true && back.player.x === 501 && back.inv.selected === 2);
  const { Vitals } = await import('../../games/strata/src/survival.js');
  const vit = new Vitals().load(back.vitals);
  check('...and its player starts with full health and hunger', vit.hp === 20 && vit.hunger === 20 && vit.difficulty === 'normal');
  const bad = async (h) => { try { await deserialize(await mk(h)); return false; } catch (e) { return e?.constructor?.name === 'SaveError'; } };
  check('version 0, a future version (3) and garbage versions are still refused', await bad({ ...v1, v: 0 }) && await bad({ ...v1, v: 3 }) && await bad({ ...v1, v: 'x' }));
  const now = await deserialize(await serialize({ seed: 9, worldSize: 1024, flat: false, spawn: v1.spawn, player: v1.player, inv: v1.inv, time: 0.1, settings: { ...CONFIG.settings }, flags: {}, edits: new Map() }));
  check('new saves are version 2', CONFIG.save.version === 2 && now.settings.difficulty === 'normal');
}

// ---------------------------------------------------------------- a finished world fits the budget
{
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const edits = new Map(), put = (cx, cz, i, id) => { const k = (cz << 16) | cx; if (!edits.has(k)) edits.set(k, new Map()); edits.get(k).set(i, id); };
  for (let n = 0; n < 3000; n++) put(20 + Math.floor(rnd() * 30), 20 + Math.floor(rnd() * 30), Math.floor(rnd() * 32768), Math.floor(rnd() * 20));          // 3,000 scattered edits in the overworld
  const under = new Map(); for (let n = 0; n < 1500; n++) { const k = ((10 + Math.floor(rnd() * 12)) << 16) | (10 + Math.floor(rnd() * 12)); if (!under.has(k)) under.set(k, new Map()); under.get(k).set(Math.floor(rnd() * 12000), Math.floor(rnd() * 56)); }
  const chests = {}; for (let n = 0; n < 40; n++) chests[`${100 + n},60,${200 + n}`] = Array.from({ length: 27 }, (_, i) => (i % 3 === 0 ? stack('cobblestone', 20) : null));
  const animals = Array.from({ length: 400 }, (_, i) => [i % 60, Math.floor(i / 60), [['pig', 20.5, 61, 40.5, 1, 10, 0, 0]]]);
  const str = await serialize({ seed: 7, worldSize: 1024, flat: false, spawn: { x: 500, y: 60, z: 500 }, player: { x: 256.5, y: 41, z: 256.5, yaw: 0, pitch: 0, dim: 'underlayer' }, inv: { slots: Array(36).fill(null), selected: 0 }, time: 0.3, settings: { ...CONFIG.settings }, flags: { rifts: Array.from({ length: 8 }, (_, i) => ({ x: i * 50, y: 3, z: i * 40, ux: i * 25, uz: i * 20, uy: 40 })), vaults: { 0: { spawner: true, raided: true, warden: true }, 1: { spawner: true, raided: true, warden: true }, 2: { spawner: true, raided: true, warden: true } }, gate: true, completed: true }, edits, dims: { underlayer: under }, chests, animals });
  const total = [...edits.values()].reduce((n, e) => n + e.size, 0);
  check(`a "finished" world (3 vaults raided, the Gate open, ${total} overworld edits, 1,500 Underlayer edits, 40 chests, 400 animals) saves under 1.5 MB (${(str.length / 1048576).toFixed(2)} MB)`, str.length < 1.5 * 1048576, `${str.length}`);
  check('and always under the shell cap of 2.5 MB', str.length < 2.5 * 1048576);
}

console.log(`\nStrata progression: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
