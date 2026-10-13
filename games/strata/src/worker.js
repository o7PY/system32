/*
 * Strata terrain generation and chunk meshing. SELF-CONTAINED classic script (no import / export): it runs
 *   1. as a Web Worker, started from a Blob URL (a sandboxed page has an opaque origin, so `new Worker('worker.js')` would throw),
 *   2. on the main thread as a fallback (loaded with a <script> tag; the API is then globalThis.StrataGen), and
 *   3. in Node tests (module.exports).
 * All three run THE SAME code, so a chunk is byte-identical on every path.
 *
 * Everything is a pure function of (seed, chunk x, chunk z): chunks can be generated in any order, and trees and ore veins that cross a chunk border are
 * written by both sides from the same seeded list (each chunk also walks its 8 neighbours' lists and keeps only the blocks inside itself).
 * Chunk data: Uint8Array(16 * 16 * 128), index = (y << 8) | (z << 4) | x. Block ids come from the host in init() (blocks.js is the registry).
 */
(function () {
  'use strict';
  var CS = 16, H = 128;
  var cfg = null;       // { seed, flat, worldSize, height, sea, snow, gen, ids, blocks }
  var id = null;        // block ids by name
  var perm = null;      // noise permutation

  // ------------------------------------------------------------------ hashing and noise
  function mix(h) { h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
  /** Deterministic integer hash of up to four ints and the seed. */
  function hash(a, b, c, d) { return mix((mix((mix((mix(cfg.seed >>> 0) ^ a) >>> 0) ^ b) >>> 0) ^ (c | 0)) ^ (d | 0)); }
  function rand01(a, b, c, d) { return hash(a, b, c, d) / 4294967296; }
  /** A small seeded generator (mulberry32) for sequences. */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) >>> 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function buildPerm(seed) {
    var p = new Uint8Array(512), a = new Uint8Array(256), r = rng(seed ^ 0x9e3779b9), i, j, t;
    for (i = 0; i < 256; i++) a[i] = i;
    for (i = 255; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    for (i = 0; i < 512; i++) p[i] = a[i & 255];
    return p;
  }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function grad2(h, x, y) { switch (h & 7) { case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; } }
  function grad3(h, x, y, z) {
    h &= 15; var u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  /** 2D gradient noise in about [-1, 1]. */
  function noise2(x, y) {
    var X = Math.floor(x), Y = Math.floor(y); x -= X; y -= Y; X &= 255; Y &= 255;
    var u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad2(perm[a], x, y), grad2(perm[b], x - 1, y), u), lerp(grad2(perm[a + 1], x, y - 1), grad2(perm[b + 1], x - 1, y - 1), u), v);
  }
  /** 3D gradient noise in about [-1, 1]. */
  function noise3(x, y, z) {
    var X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    var u = fade(x), v = fade(y), w = fade(z);
    var A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad3(perm[AA], x, y, z), grad3(perm[BA], x - 1, y, z), u), lerp(grad3(perm[AB], x, y - 1, z), grad3(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad3(perm[AA + 1], x, y, z - 1), grad3(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad3(perm[AB + 1], x, y - 1, z - 1), grad3(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  function fbm2(x, y, oct) { var s = 0, a = 1, f = 1, n = 0, i; for (i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2; } return s / n; }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // ------------------------------------------------------------------ the world as a function of (x, z)
  var PLAINS = 0, FOREST = 1, DESERT = 2, MOUNTAINS = 3, BEACH = 4, OCEAN = 5;

  /** Terrain height (top solid y) and biome of a column. Pure; also used to place trees and to find the spawn. */
  function columnInfo(x, z) {
    if (cfg.flat) return { height: cfg.sea, biome: PLAINS, mountain: 0 };
    var cont = fbm2(x * 0.0035 + 11.3, z * 0.0035 - 7.1, 3);
    var base = cfg.sea + 5 + cont * 40;
    var hills = fbm2(x * 0.012 + 40, z * 0.012 - 90, 4) * 7;
    var mtn = smooth(0.06, 0.32, fbm2(x * 0.0045 + 500, z * 0.0045 + 500, 2));
    var ridged = 1 - Math.abs(fbm2(x * 0.011 - 300, z * 0.011 + 200, 4));
    var h = Math.round(base + hills + mtn * (20 + ridged * ridged * 50));
    h = Math.max(3, Math.min(H - 6, h));
    var temp = fbm2(x * 0.0045 + 1000, z * 0.0045 + 1000, 2), moist = fbm2(x * 0.0045 - 2000, z * 0.0045 + 2000, 2);
    var biome;
    if (mtn > 0.5 && h > cfg.sea + 12) biome = MOUNTAINS;
    else if (h < cfg.sea - 1) biome = OCEAN;
    else if (h <= cfg.sea + 1) biome = BEACH;
    else if (temp > 0.08 && moist < 0.05) biome = DESERT;
    else if (moist > -0.02) biome = FOREST;
    else biome = PLAINS;
    return { height: h, biome: biome, mountain: mtn };
  }

  /** Is (x, y, z) hollowed out by a cave? h is the column's height. */
  function caveAt(x, y, z, h) {
    var g = cfg.gen;
    if (cfg.flat || y < 4 || y > g.caveMaxY) return false;
    var open = y > h - 3;                                             // near the surface only where an entrance is allowed
    if (open) {
      if (y > h || h <= cfg.sea + 1) return false;
      if (noise2(x * 0.03 + 900, z * 0.03 - 900) < g.caveEntrance) return false;
    }
    var c = noise3(x * 0.04, y * 0.06, z * 0.04) + 0.5 * noise3(x * 0.09 + 100, y * 0.12, z * 0.09 - 100);
    if (c > g.caveCheese) return true;
    var a = noise3(x * 0.02 + 300, y * 0.03, z * 0.02), b = noise3(x * 0.02, y * 0.03 + 400, z * 0.02 + 700);
    return Math.abs(a) < g.caveTunnel && Math.abs(b) < g.caveTunnel;
  }

  // ------------------------------------------------------------------ chunk generation
  function inWorld(cx, cz) { var n = cfg.worldSize / CS; return cx >= 0 && cz >= 0 && cx < n && cz < n; }

  function surfaceBlocks(biome, h, x, z) {
    // returns [topBlock, layerBlock, layerDepth]
    if (h < cfg.sea + 1) return [noise2(x * 0.08, z * 0.08) > 0.35 ? id.gravel : id.sand, id.sand, 3];
    switch (biome) {
      case DESERT: case BEACH: return [id.sand, id.sand, 4];
      case MOUNTAINS: return h >= cfg.snow ? [id.snow, id.stone, 0] : h >= 76 ? [id.stone, id.stone, 0] : [id.grass, id.dirt, 3];
      default: return [id.grass, id.dirt, 3 + ((x ^ z) & 1)];
    }
  }

  function generate(cx, cz) {
    if (cfg.dim === 'underlayer') return genUnderlayer(cx, cz);
    var data = new Uint8Array(CS * CS * H), biomes = new Uint8Array(CS * CS);
    var ox = cx * CS, oz = cz * CS, lx, lz, y;
    if (cfg.flat) {
      for (lz = 0; lz < CS; lz++) for (lx = 0; lx < CS; lx++) {
        for (y = 0; y <= cfg.sea; y++) data[(y << 8) | (lz << 4) | lx] = y === 0 ? id.bedrock : y === cfg.sea ? id.grass : y > cfg.sea - 3 ? id.dirt : id.stone;
      }
      return { data: data, biomes: biomes };
    }
    for (lz = 0; lz < CS; lz++) for (lx = 0; lx < CS; lx++) {
      var x = ox + lx, z = oz + lz, info = columnInfo(x, z), h = info.height, sb = surfaceBlocks(info.biome, h, x, z);
      biomes[(lz << 4) | lx] = info.biome;
      for (y = 0; y <= h; y++) {
        var b;
        if (y === 0) b = id.bedrock;
        else if (y <= 3) b = rand01(x, y, z, 1) < (4 - y) * 0.2 ? id.bedrock : id.stone;
        else if (y === h) b = sb[0];
        else if (y > h - 1 - sb[2]) b = sb[1];
        else b = id.stone;
        if (b !== id.bedrock && y > 3 && caveAt(x, y, z, h)) b = id.air;
        data[(y << 8) | (lz << 4) | lx] = b;
      }
      for (y = h + 1; y <= cfg.sea; y++) data[(y << 8) | (lz << 4) | lx] = id.water;
    }
    ores(data, cx, cz);
    features(data, cx, cz);
    crackStamp(data, cx, cz);
    return { data: data, biomes: biomes };
  }

  function setIf(data, ox, oz, x, y, z, v, onlyOver) {
    var lx = x - ox, lz = z - oz;
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 1 || y >= H) return;
    var i = (y << 8) | (lz << 4) | lx;
    if (onlyOver === 0 ? data[i] === id.air : onlyOver === 1 ? data[i] === id.air || data[i] === id.leaves : data[i] === onlyOver) data[i] = v;
  }

  /** Ore veins: small blobs from a per-chunk seeded list; a chunk replays its neighbours' lists, so a vein over a border is whole on both sides. */
  function ores(data, cx, cz) {
    var g = cfg.gen, ox = cx * CS, oz = cz * CS, kinds = [[id.coal_ore, g.coalPerChunk, g.coal, 1.2, 2.4, 1], [id.iron_ore, g.ironPerChunk, g.iron, 1.0, 2.0, 2], [id.cobalt_ore, g.cobaltPerChunk, g.cobalt, 1.0, 1.9, 3]];
    for (var k = 0; k < kinds.length; k++) {
      var kind = kinds[k];
      for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
        var ncx = cx + dx, ncz = cz + dz;
        if (!inWorld(ncx, ncz)) continue;
        var r = rng(hash(ncx, ncz, 100 + kind[5], 0));
        for (var i = 0; i < kind[1]; i++) {
          var bx = ncx * CS + Math.floor(r() * CS), bz = ncz * CS + Math.floor(r() * CS), by = kind[2][0] + Math.floor(r() * (kind[2][1] - kind[2][0] + 1)), rad = kind[3] + r() * (kind[4] - kind[3]);
          var R = Math.ceil(rad);
          if (bx + R < ox || bx - R >= ox + CS || bz + R < oz || bz - R >= oz + CS) continue;
          for (var y = -R; y <= R; y++) for (var z = -R; z <= R; z++) for (var x = -R; x <= R; x++) {
            if (x * x + y * y + z * z < rad * rad * (0.55 + 0.6 * rand01(bx + x, by + y, bz + z, 7))) setIf(data, ox, oz, bx + x, by + y, bz + z, kind[0], id.stone);
          }
        }
      }
    }
    if (rand01(cx, cz, 300, 0) < g.adBlockChunkChance) {                     // the rare Ad Block ore (egg strata-adblock): about one per four chunks, deep down
      var rr = rng(hash(cx, cz, 301, 0));
      setIf(data, ox, oz, ox + Math.floor(rr() * CS), g.adBlock[0] + Math.floor(rr() * (g.adBlock[1] - g.adBlock[0] + 1)), oz + Math.floor(rr() * CS), id.ad_block, id.stone);
    }
  }

  /** Trees and cacti, from per-chunk seeded attempts. Neighbours are replayed in (z, x) order, so every chunk applies them in the same global order. */
  function features(data, cx, cz) {
    var g = cfg.gen, ox = cx * CS, oz = cz * CS;
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var ncx = cx + dx, ncz = cz + dz;
      if (!inWorld(ncx, ncz)) continue;
      var r = rng(hash(ncx, ncz, 200, 0));
      for (var i = 0; i < g.treeAttempts; i++) {
        // draw every random number of the attempt first, so the sequence never depends on whether it is accepted
        var x = ncx * CS + Math.floor(r() * CS), z = ncz * CS + Math.floor(r() * CS), pick = r(), th = r(), corners = r() * 65536 | 0;
        if (x < ox - 3 || x > ox + CS + 2 || z < oz - 3 || z > oz + CS + 2) continue;
        var info = columnInfo(x, z), h = info.height, bi = info.biome;
        if (h <= cfg.sea || h >= H - 12 || caveAt(x, h, z, h)) continue;
        if (bi === DESERT) {
          if (pick >= g.cactusDesert) continue;
          for (var c = 1; c <= 2 + Math.floor(th * 3); c++) setIf(data, ox, oz, x, h + c, z, id.cactus, 0);
          continue;
        }
        var p = bi === FOREST ? g.treeForest : bi === PLAINS ? g.treePlains : bi === MOUNTAINS && h < 76 ? g.treeMountain : 0;
        if (pick >= p) continue;
        var th2 = 4 + Math.floor(th * 3), top = h + th2, yy, xx, zz;      // trunk 4-6 tall
        for (yy = top - 2; yy <= top + 1; yy++) {
          var rad = yy >= top ? 1 : 2;
          for (zz = -rad; zz <= rad; zz++) for (xx = -rad; xx <= rad; xx++) {
            var corner = Math.abs(xx) === rad && Math.abs(zz) === rad;
            if (corner && (rad === 1 && yy > top ? true : ((corners >> ((yy & 3) * 4 + (xx > 0 ? 2 : 0) + (zz > 0 ? 1 : 0))) & 1))) continue;
            setIf(data, ox, oz, x + xx, yy, z + zz, id.leaves, 0);
          }
        }
        for (yy = h + 1; yy <= top; yy++) setIf(data, ox, oz, x, yy, z, id.log, 1);
      }
    }
  }

  /** A dry grassy column near the middle of the world, found by spiralling out. Returns the feet position. */
  function spawn() {
    var mid = cfg.worldSize / 2;
    if (cfg.dim === 'underlayer') return { x: mid + 0.5, y: 41, z: mid + 0.5 };
    if (cfg.flat) return { x: mid + 0.5, y: cfg.sea + 1, z: mid + 0.5 };
    for (var r = 0; r < 600; r += 2) {
      for (var a = 0; a < Math.max(1, r * 2); a++) {
        var ang = (a / Math.max(1, r * 2)) * Math.PI * 2, x = Math.floor(mid + Math.cos(ang) * r), z = Math.floor(mid + Math.sin(ang) * r);
        var info = columnInfo(x, z);
        if ((info.biome === PLAINS || info.biome === FOREST) && info.height >= cfg.sea + 2 && info.height <= 70 && !caveAt(x, info.height, z, info.height)) {
          // not in the middle of a tree: the trunk column and its neighbours must be free of logs (checked on the generated chunk)
          var cx = x >> 4, cz = z >> 4, d = generate(cx, cz).data, lx = x & 15, lz = z & 15, ok = d[(info.height << 8) | (lz << 4) | lx] === id.grass;
          for (var y = info.height + 1; y <= info.height + 3 && ok; y++) if (d[(y << 8) | (lz << 4) | lx] !== id.air) ok = false;
          if (ok) return { x: x + 0.5, y: info.height + 1, z: z + 0.5 };
        }
      }
    }
    return { x: mid + 0.5, y: cfg.sea + 20, z: mid + 0.5 };
  }

  // ------------------------------------------------------------------ Part 2: cobalt, cracked bedrock, the Underlayer, fixed structures
  // Everything here is a pure function of (seed, chunk). Structures are "stamps": a box of cells given by a function, written wherever it overlaps the chunk being generated.

  /** Write every cell of the box [x0..x1] x [y0..y1] x [z0..z1] that lies inside the chunk (cx, cz); `f(x, y, z)` returns a block id or -1 to leave the cell alone. */
  function stamp(data, cx, cz, x0, y0, z0, x1, y1, z1, f) {
    var ox = cx * CS, oz = cz * CS, xa = Math.max(x0, ox), xb = Math.min(x1, ox + CS - 1), za = Math.max(z0, oz), zb = Math.min(z1, oz + CS - 1), x, y, z, v;
    if (xa > xb || za > zb) return;
    for (y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (z = za; z <= zb; z++) for (x = xa; x <= xb; x++) {
      v = typeof f === 'function' ? f(x, y, z) : f;
      if (v >= 0) data[(y << 8) | ((z - oz) << 4) | (x - ox)] = v;
    }
  }

  var crackCache = null, computingSpawn = false;
  /**
   * The Cracked Bedrock sites of the overworld: at least 8 within 250 blocks of the spawn (placed from it), plus a few more far away. Each is { x, y, z }: the cracked block, with a
   * small cave pocket above it so that digging down into it opens onto the block. A site is deep: y 2 or 3, in the bedrock layer.
   */
  function crackSites() {
    if (cfg.flat || (cfg.dim && cfg.dim !== 'overworld')) return [];
    if (computingSpawn) return [];
    if (crackCache) return crackCache;
    computingSpawn = true;
    var sp = spawn();
    computingSpawn = false;
    var out = [], i, r = rng(hash(777, 4242, 1, 0)), base = r() * TAU, lim = cfg.worldSize - 20;
    for (i = 0; i < 8; i++) {
      var a = base + (i / 8) * TAU + (r() - 0.5) * 0.5, d = 45 + r() * 190;
      out.push({ x: Math.max(20, Math.min(lim, Math.floor(sp.x + Math.cos(a) * d))), y: 2 + (r() < 0.5 ? 1 : 0), z: Math.max(20, Math.min(lim, Math.floor(sp.z + Math.sin(a) * d))) });
    }
    for (i = 0; i < 6; i++) out.push({ x: 20 + Math.floor(r() * (lim - 20)), y: 2 + (r() < 0.5 ? 1 : 0), z: 20 + Math.floor(r() * (lim - 20)) });
    crackCache = out;
    return out;
  }
  var TAU = Math.PI * 2;

  function crackStamp(data, cx, cz) {
    var sites = crackSites(), i, s;
    for (i = 0; i < sites.length; i++) {
      s = sites[i];
      if (s.x < cx * CS - 3 || s.x > cx * CS + CS + 2 || s.z < cz * CS - 3 || s.z > cz * CS + CS + 2) continue;
      stamp(data, cx, cz, s.x - 2, s.y + 1, s.z - 2, s.x + 2, s.y + 3, s.z + 2, function (x, y, z) { return (Math.abs(x - s.x) === 2 && Math.abs(z - s.z) === 2) ? -1 : id.air; });      // a small pocket above it
      stamp(data, cx, cz, s.x, s.y, s.z, s.x, s.y, s.z, id.cracked_bedrock);
      stamp(data, cx, cz, s.x - 2, s.y, s.z - 2, s.x + 2, s.y, s.z + 2, function (x, y, z) { return (x === s.x && z === s.z) ? -1 : id.stone; });                                    // a stone floor around it
    }
  }

  // ---- the Underlayer: 512 x 512, ceiling and floor of bedrock (96 tall), no sky. Huge basalt and scorched-stone caverns, ash dunes, lava lakes, glowcap groves, pillars.
  var UH = 96, UC = 256;               // height and centre (x, z) of the Underlayer
  function underFloor(x, z) {          // the height of the cavern floor in a column (pure of x, z)
    var n = noise2(x * 0.018 + 70, z * 0.018 - 40) * 0.6 + noise2(x * 0.06 - 9, z * 0.06 + 31) * 0.25;
    return Math.round(24 + n * 26);
  }
  function underCeil(x, z) { var n = noise2(x * 0.022 - 51, z * 0.022 + 12) * 0.6 + noise2(x * 0.07 + 5, z * 0.07 - 80) * 0.2; return Math.round(70 + n * 16); }
  // ---- the Data Vaults (STRATA_PART2_SPEC 6.3): three server-rack towers 120 degrees apart, 120-200 blocks from the centre. A fixed template with small seeded variations:
  //   hall (dy 1-6): an open doorway, a mob spawner, stairs up behind a sealed vault door -> parkour room (dy 8-14): lava with rack platforms -> stairs -> shard room (dy 16-22):
  //   a chest and the Vault Warden's spot; a roof and a tall glowing spire (visible through the haze). dy is the height above the vault floor (fy).
  var VHALF = 6, VPAD = 10;
  var PLATFORMS = [
    [[-2, 4], [-4, 2], [-1, 0], [-4, -2]],                  // variant 0: top-left corners of the 2 x 2 platforms, snaking from the walkway (x 0..5, z 5) to the far corner
    [[-2, 3], [-1, 0], [-4, 1], [-3, -1]],
  ];
  function vaultSites() {
    var r = rng(hash(555, 9, 3, 0)), a0 = r() * TAU, out = [], i;
    for (i = 0; i < 3; i++) {
      var a = a0 + (i / 3) * TAU, d = 120 + r() * 80, x = Math.floor(UC + Math.cos(a) * d), z = Math.floor(UC + Math.sin(a) * d);
      var v = hash(x, z, 77, i), fy = Math.max(26, Math.min(48, underFloor(x, z))), corner = v % 4, cx = (corner & 1 ? 4 : -4), cz = (corner & 2 ? 4 : -4);
      out.push({
        x: x, z: z, fy: fy, index: i, variant: (v >> 4) & 1, corner: corner,
        spawner: { x: x, y: fy + 1, z: z },
        door: [3, 4, 5].flatMap(function (dx) { return [5, 6].map(function (dy) { return { x: x + dx, y: fy + dy, z: z + 1 }; }); }),
        chest: { x: x + cx, y: fy + 16, z: z + cz, facing: cx > 0 ? 'w' : 'e' },
        warden: { x: x + 0.5, y: fy + 17, z: z + 0.5 },
        entrance: { x: x, y: fy + 1, z: z - VHALF - 3 },
      });
    }
    return out;
  }
  var vaultCache = null;
  function vaults() { return vaultCache || (vaultCache = vaultSites()); }

  /** The block of the vault template at offset (dx, dz) from its centre and height dy above its floor; -1 = leave the world alone. */
  function vaultCell(site, dx, dy, dz) {
    var ax = Math.abs(dx), az = Math.abs(dz), R = id.server_rack;
    if (ax > VPAD || az > VPAD || dy < -6 || dy > 52) return -1;
    if (ax > VHALF || az > VHALF) {                                           // the apron: a flat basalt pad around the tower with air above it
      if (dy < 0) return id.basalt;
      if (dy === 0) return id.basalt;
      return dy <= 12 ? id.air : -1;
    }
    if (dy < 0) return id.basalt;                                             // foundation
    if (dy === 0) return R;                                                   // hall floor
    var wall = ax === VHALF || az === VHALF, inner = !wall;
    // ---- the spire: a 3 x 3 rack column above the roof
    if (dy >= 23) {
      if (dy === 23) return R;                                                // roof slab (the shard room's ceiling)
      return ax <= 1 && az <= 1 && dy <= 50 ? R : (dy <= 23 ? R : id.air);
    }
    if (wall) {
      if (dy <= 3 && dz === -VHALF && ax <= 1) return id.air;                 // the doorway
      if (dy <= 3 && dz === -VHALF && ax === 2) return id.vault_door;         // its frame
      return R;
    }
    // ---- slabs (ceilings): dy 7 over the hall, dy 15 over the parkour room
    if (dy === 7 || dy === 15) {
      if (dy === 7 && ax >= 3 && ax <= 5 && dx > 0 && dz >= 2 && dz <= 3) return id.air;          // the stairwell holes
      if (dy === 15 && dx <= -3 && dx >= -5 && dz >= 2 && dz <= 3) return id.air;
      // the top steps are part of the stairs (below), the rest is slab
      if (dy === 7 && dx >= 3 && dz === 4) return R;
      if (dy === 15 && dx <= -3 && dz === 4) return R;
      return R;
    }
    // ---- the hall (dy 1-6): stairs on the east side, behind the sealed door
    if (dy >= 1 && dy <= 6) {
      if (dx === 2 && dz >= -2 && dz <= 5) return R;                           // the west wall of the stair shaft: the only way up is through the door plug
      if (dx >= 3 && dx <= 5 && dz >= -2 && dz <= 5) { var k = dz + 3; if (dy <= k) return R; if (dz === 1 && dy >= 5 && dy <= 6) return id.vault_door; }   // step k = dz + 3 (k 1..8), the door plug on step 4
      if (dx === 0 && dz === 0 && dy === 1) return id.spawner;
      return id.air;
    }
    if (dy === 8 && dx >= 3 && dx <= 5 && dz === 5) return R;                 // (the top step of the hall stairs, flush with the parkour floor)
    if (dy >= 1 && dy <= 8 && dx >= 3 && dx <= 5 && dz === 5) return R;
    // ---- the parkour room (dy 8-14): the floor layer is dy 8 (lava, rack platforms, rack walkways)
    if (dy >= 8 && dy <= 14) {
      if (dy === 8) {
        if (dz === 5 && dx >= 0 && dx <= 5) return R;                         // the walkway from the stairs
        if (dx >= 3 && dx <= 5 && dz >= 2 && dz <= 4) return id.air;          // the stairwell (open above the hall stairs)
        if (dx <= -3 && dz <= -3) return R;                                   // the far landing
        var pl = PLATFORMS[site.variant], i;
        for (i = 0; i < pl.length; i++) if (dx >= pl[i][0] && dx <= pl[i][0] + 1 && dz >= pl[i][1] && dz <= pl[i][1] + 1) return R;
        // the stairs up to the shard room: x -5..-3, z -2..4 (step k = dz + 3: blocks dy 8..8+k-1... see below)
        if (dx <= -3 && dx >= -5 && dz >= -2 && dz <= 4) return R;
        return id.lava;
      }
      // above the layer: the stairs to the shard room (dx -5..-3), step k at dz = k - 3 (k 1..7) fills dy 8 .. 8 + k
      if (dx <= -3 && dx >= -5 && dz >= -2 && dz <= 4) { var k2 = dz + 3; if (dy <= 8 + k2) return R; }
      return id.air;
    }
    // ---- the shard room (dy 16-22)
    if (dy >= 16 && dy <= 22) {
      var ch = site.chest;
      if (site.x + dx === ch.x && site.z + dz === ch.z && dy === 16) return chestBlock(ch.facing);
      if (dx <= -3 && dx >= -5 && dz >= -2 && dz <= 4 && dy === 16 && dz < 4) return id.air;
      if (dy === 16 && ((dx === 0 && dz === 0) || ax === 3 && az === 3)) return R;               // a plinth and four pillar stubs: a little furniture for the fight
      return id.air;
    }
    return id.air;
  }
  function chestBlock(f) { return f === 'e' ? id.chest_e : f === 'w' ? id.chest_w : f === 'n' ? id.chest_n : id.chest_s; }

  /** Write the vault templates that touch the chunk (cx, cz). */
  function vaultStamps(data, cx, cz) {
    var list = vaults(), i, s, ox = cx * CS, oz = cz * CS;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (s.x + VPAD < ox || s.x - VPAD >= ox + CS || s.z + VPAD < oz || s.z - VPAD >= oz + CS) continue;
      stamp(data, cx, cz, s.x - VPAD, s.fy - 6, s.z - VPAD, s.x + VPAD, s.fy + 52, s.z + VPAD, (function (site) { return function (x, y, z) { return vaultCell(site, x - site.x, y - site.fy, z - site.z); }; })(s));
    }
  }

  function genUnderlayer(cx, cz) {
    var data = new Uint8Array(CS * CS * H), biomes = new Uint8Array(CS * CS), ox = cx * CS, oz = cz * CS, lx, lz, y;
    for (lz = 0; lz < CS; lz++) for (lx = 0; lx < CS; lx++) {
      var x = ox + lx, z = oz + lz, fl = underFloor(x, z), ce = Math.max(fl + 12, underCeil(x, z));
      var dc = Math.hypot(x - UC, z - UC), flat = dc < 22;
      if (flat) { fl = 40; ce = 64; }
      else if (dc < 34) { var t = (dc - 22) / 12; fl = Math.round(40 + (fl - 40) * t); ce = Math.round(64 + (ce - 64) * t); }
      var dune = noise2(x * 0.045 + 300, z * 0.045 - 300) > 0.25 && !flat, pillar = !flat && rand01(x >> 3, z >> 3, 9, 1) < 0.045 && Math.hypot((x & 7) - 3.5, (z & 7) - 3.5) < 1.5 + rand01(x >> 3, z >> 3, 9, 2);
      for (y = 0; y < UH; y++) {
        var b;
        if (y === 0) b = id.bedrock;
        else if (y <= 2) b = rand01(x, y, z, 21) < (3 - y) * 0.3 ? id.bedrock : id.basalt;
        else if (y >= UH - 1) b = id.bedrock;
        else if (y >= UH - 3) b = rand01(x, y, z, 22) < (y - (UH - 4)) * 0.3 ? id.bedrock : id.basalt;
        else if (y < fl) b = (noise3(x * 0.07, y * 0.09, z * 0.07) > 0.35) ? id.scorched_stone : id.basalt;
        else if (y === fl) b = dune ? id.ash : (noise2(x * 0.1, z * 0.1) > 0.3 ? id.scorched_stone : id.basalt);
        else if (y === fl + 1 && dune) b = id.ash;
        else if (y > ce) b = noise3(x * 0.05, y * 0.07, z * 0.05) > 0.1 ? id.basalt : id.scorched_stone;
        else b = id.air;
        if (pillar && y > fl && y <= ce) b = id.basalt;
        if (b === id.air && y <= 20 && !flat && noise2(x * 0.03 + 11, z * 0.03 + 7) > 0.05) b = id.lava;                       // static lava lakes in the lowest basins
        data[(y << 8) | (lz << 4) | lx] = b;
      }
      // glowcap groves on the floor
      if (!flat && fl > 21 && noise2(x * 0.05 - 200, z * 0.05 + 100) > 0.2 && rand01(x, 31, z, 3) < 0.07) { var g = data[((fl + 1) << 8) | (lz << 4) | lx]; if (g === id.air && data[(fl << 8) | (lz << 4) | lx] !== id.lava) data[((fl + 1) << 8) | (lz << 4) | lx] = id.glowcap; }
    }
    vaultStamps(data, cx, cz);
    return { data: data, biomes: biomes };
  }

  // ------------------------------------------------------------------ lighting
  // Two 4-bit channels per cell: sky light (15 straight down from the sky, -1 per step otherwise) and block light (emitters, -1 per step). The light of
  // a chunk is a PURE FUNCTION of the blocks in the 3 x 3 chunks around it (a torch reaches 14 blocks and the chunk is 16 wide, so nothing outside can matter):
  // that is exactly what lightRegion() computes, on a 48 x 128 x 48 copy. Light is never saved; it is recomputed from the blocks, always to the same result.
  var RW = CS * 3;
  var tabs = null;      // per block id: opaque (blocks light), dim (sky light lost passing through), emit

  function buildTabs() {
    var opq = new Uint8Array(256), dim = new Uint8Array(256), emit = new Uint8Array(256);
    for (var i = 0; i < cfg.blocks.length; i++) { var b = cfg.blocks[i]; opq[i] = b.kind === 'opaque' ? 1 : 0; dim[i] = b.dim || 0; emit[i] = b.emit || 0; }
    tabs = { opq: opq, dim: dim, emit: emit };
  }

  /** Flood fill: queues[L] holds cell indices at level L; a cell passes L - 1 to every neighbour that is not opaque and darker. */
  function flood(light, region, queues) {
    var opq = tabs.opq, L, q, k, i, x, y, z, nb;
    var XS = 1, ZS = RW, YS = RW * RW;
    for (L = 15; L >= 2; L--) {
      q = queues[L];
      for (k = 0; k < q.length; k++) {
        i = q[k];
        if (light[i] !== L) continue;                                   // raised meanwhile, it was queued at its higher level
        x = i % RW; z = ((i / RW) | 0) % RW; y = (i / YS) | 0;
        if (x > 0) { nb = i - XS; if (light[nb] < L - 1 && !opq[region[nb]]) { light[nb] = L - 1; queues[L - 1].push(nb); } }
        if (x < RW - 1) { nb = i + XS; if (light[nb] < L - 1 && !opq[region[nb]]) { light[nb] = L - 1; queues[L - 1].push(nb); } }
        if (z > 0) { nb = i - ZS; if (light[nb] < L - 1 && !opq[region[nb]]) { light[nb] = L - 1; queues[L - 1].push(nb); } }
        if (z < RW - 1) { nb = i + ZS; if (light[nb] < L - 1 && !opq[region[nb]]) { light[nb] = L - 1; queues[L - 1].push(nb); } }
        if (y > 0) { nb = i - YS; if (light[nb] < L - 1 && !opq[region[nb]]) { light[nb] = L - 1; queues[L - 1].push(nb); } }
        if (y < H - 1) { nb = i + YS; if (light[nb] < L - 1 && !opq[region[nb]]) { light[nb] = L - 1; queues[L - 1].push(nb); } }
      }
      q.length = 0;
    }
  }

  /**
   * Sky and block light of a 48 x 128 x 48 region (index (y * 48 + z) * 48 + x; the chunk being meshed is the middle one, x and z in 16..31).
   * `sky: false` = no sky at all (the Underlayer and the Kernel). Returns { sky, blk }.
   */
  function lightRegion(region, opts) {
    if (!tabs) buildTabs();
    var hasSky = !(opts && opts.sky === false);
    var n = RW * RW * H, sky = new Uint8Array(n), blk = new Uint8Array(n), opq = tabs.opq, dim = tabs.dim, emit = tabs.emit;
    var queues, L, x, y, z, i;
    function fresh() { var q = []; for (var l = 0; l <= 15; l++) q.push([]); return q; }
    if (hasSky) {
      var top = new Int16Array(RW * RW);                                  // y of the highest opaque cell of a column (-1 = none)
      for (z = 0; z < RW; z++) for (x = 0; x < RW; x++) {
        var level = 15, t = -1;
        for (y = H - 1; y >= 0; y--) {
          i = (y * RW + z) * RW + x;
          var bid = region[i];
          if (opq[bid]) { t = y; break; }
          level = level - dim[bid]; if (level < 0) level = 0;
          sky[i] = level;
        }
        top[z * RW + x] = t;
      }
      queues = fresh();
      for (z = 0; z < RW; z++) for (x = 0; x < RW; x++) {
        // only cells at or below the highest neighbouring ground can have a darker neighbour: everything above is plain open sky
        var hm = top[z * RW + x];
        if (x > 0 && top[z * RW + x - 1] > hm) hm = top[z * RW + x - 1];
        if (x < RW - 1 && top[z * RW + x + 1] > hm) hm = top[z * RW + x + 1];
        if (z > 0 && top[(z - 1) * RW + x] > hm) hm = top[(z - 1) * RW + x];
        if (z < RW - 1 && top[(z + 1) * RW + x] > hm) hm = top[(z + 1) * RW + x];
        for (y = top[z * RW + x] + 1; y <= Math.min(H - 1, hm + 1); y++) { i = (y * RW + z) * RW + x; L = sky[i]; if (L > 1) queues[L].push(i); }
      }
      flood(sky, region, queues);
    }
    queues = fresh();
    for (i = 0; i < n; i++) { var e = emit[region[i]]; if (e) { blk[i] = e; queues[e].push(i); } }
    flood(blk, region, queues);
    return { sky: sky, blk: blk };
  }

  /** The padded 18 x 128 x 18 block array and light arrays of the middle chunk of a region (what mesh() takes). */
  function fromRegion(region, lt) {
    var out = new Uint8Array(PW * H * PW), s = new Uint8Array(PW * H * PW), b = new Uint8Array(PW * H * PW), y, z, ri, pi;
    for (y = 0; y < H; y++) for (z = 0; z < PW; z++) {
      ri = (y * RW + z + CS - 1) * RW + CS - 1; pi = (y * PW + z) * PW;
      out.set(region.subarray(ri, ri + PW), pi); s.set(lt.sky.subarray(ri, ri + PW), pi); b.set(lt.blk.subarray(ri, ri + PW), pi);
    }
    return { padded: out, sky: s, blk: b };
  }

  /** Light of the middle chunk only, packed (sky << 4 | block), index as the chunk data. */
  function packLight(lt) {
    var out = new Uint8Array(CS * H * CS), x, y, z;
    for (y = 0; y < H; y++) for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) { var i = (y * RW + z + CS) * RW + x + CS; out[(y << 8) | (z << 4) | x] = (lt.sky[i] << 4) | lt.blk[i]; }
    return out;
  }

  /** Light and mesh of the chunk in the middle of a 48 x 128 x 48 region. Also returns the chunk's packed light for the main thread (mobs, entities). */
  function meshRegion(region, opts) {
    var lt = lightRegion(region, opts), f = fromRegion(region, lt);
    var out = mesh(f.padded, { sky: f.sky, blk: f.blk, noSky: !!(opts && opts.sky === false) });
    out.light = packLight(lt);
    return out;
  }

  // ------------------------------------------------------------------ meshing
  // padded chunk: 18 x 128 x 18, index = (y * 18 + (z + 1)) * 18 + (x + 1) for x, z in [-1, 16]
  var PW = CS + 2;
  var AO_BRIGHT = [0.55, 0.7, 0.85, 1.0];
  var FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.7, 0.7];
  // per face: normal, and the in-plane axes u, v with u x v = normal (so the quad is wound counter-clockwise seen from outside)
  var FACE = [
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  var CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  function newLayer() { return { pos: [], uv: [], br: [], sk: [], bl: [], an: [], idx: [], faces: 0 }; }

  /** Is this block hiding the face of `cur` that touches it? (for a partial box the caller also checks that the face lies on the cell boundary) */
  function hides(cur, nb) {
    var ck = cfg.blocks[cur].kind, nk = cfg.blocks[nb].kind;
    if (nk === 'air') return false;
    if (cur === nb && (ck === 'cutout' || ck === 'water' || ck === 'lava')) return true;           // glass next to glass, leaves in a blob, water in water
    if (ck === 'opaque') return nk === 'opaque';
    if (ck === 'water' || ck === 'lava') return nk === 'opaque';
    if (ck === 'box') return nk === 'opaque';
    return false;                                                                    // a cutout block's faces stay next to anything else (leaves next to stone keep both faces)
  }

  /**
   * Meshes one padded chunk into three layers (opaque, cutout, water) of typed arrays ready for transfer.
   * lt = { sky, blk } padded light arrays (same indexing); without it every cell has full sky light and no block light (the geometry tests use that).
   * Per vertex: br (face shade x ambient occlusion), sk and bl (smoothed sky / block light 0..1), an (animation frames of the tile, 0 = still).
   */
  function mesh(padded, lt) {
    var layers = { opaque: newLayer(), cut: newLayer(), water: newLayer() };
    var blocks = cfg.blocks, x, y, z, f, c, noSky = !!(lt && lt.noSky);
    var occ = function (px, py, pz) { return py >= 0 && py < H && blocks[padded[(py * PW + pz + 1) * PW + px + 1]].kind === 'opaque' ? 1 : 0; };
    var lightAt = function (arr, px, py, pz, def) { return py < 0 ? 0 : py >= H ? def : arr[(py * PW + pz + 1) * PW + px + 1]; };
    for (y = 0; y < H; y++) for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var bid = padded[(y * PW + z + 1) * PW + x + 1];
      if (bid === 0) continue;
      var def = blocks[bid], bk = def.kind, layer = bk === 'opaque' || bk === 'lava' ? layers.opaque : bk === 'water' ? layers.water : layers.cut, tiles = def.tiles, emitL = (def.emit || 0) / 15;
      if (bk === 'plant') { plant(layer, def, x, y, z); continue; }
      var box = bk === 'box' ? def.box : null;
      for (f = 0; f < 6; f++) {
        var fc = FACE[f], nx = x + fc.n[0], ny = y + fc.n[1], nz = z + fc.n[2];
        var nid = ny < 0 || ny >= H ? 0 : padded[(ny * PW + nz + 1) * PW + nx + 1];
        if (ny < 0) continue;                                                        // never draw the underside of the world
        var hide = nid !== 0 && hides(bid, nid);
        if (box && hide) {                                                           // a partial box: only a face lying ON the cell boundary can be hidden
          var ax = fc.n[0] ? 0 : fc.n[1] ? 1 : 2, onEdge = fc.n[ax] > 0 ? box[ax + 3] === 16 : box[ax] === 0;
          hide = onEdge;
        }
        if (hide) continue;
        // ambient occlusion per corner (the classic 3-neighbour rule), only opaque blocks occlude; partial and plant shapes are not occluded
        var ao = [0, 0, 0, 0];
        if (bk === 'opaque') {
          for (c = 0; c < 4; c++) {
            var su = CORNERS[c][0] ? 1 : -1, sv = CORNERS[c][1] ? 1 : -1;
            var s1 = occ(nx + fc.u[0] * su, ny + fc.u[1] * su, nz + fc.u[2] * su), s2 = occ(nx + fc.v[0] * sv, ny + fc.v[1] * sv, nz + fc.v[2] * sv);
            var co = occ(nx + fc.u[0] * su + fc.v[0] * sv, ny + fc.u[1] * su + fc.v[1] * sv, nz + fc.u[2] * su + fc.v[2] * sv);
            ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + co);
          }
        } else ao = [3, 3, 3, 3];
        // smooth light: the cell in front of the face and the three around the corner (opaque ones count as the front cell's value)
        var skyV = [0, 0, 0, 0], blkV = [0, 0, 0, 0];
        if (lt) {
          var frontOpaque = occ(nx, ny, nz), fx = frontOpaque ? x : nx, fy = frontOpaque ? y : ny, fz = frontOpaque ? z : nz;
          var fs = lightAt(lt.sky, fx, fy, fz, noSky ? 0 : 15), fb = lightAt(lt.blk, fx, fy, fz, 0);
          for (c = 0; c < 4; c++) {
            var cu2 = CORNERS[c][0] ? 1 : -1, cv2 = CORNERS[c][1] ? 1 : -1;
            var ax1 = fx + fc.u[0] * cu2, ay1 = fy + fc.u[1] * cu2, az1 = fz + fc.u[2] * cu2, ax2 = fx + fc.v[0] * cv2, ay2 = fy + fc.v[1] * cv2, az2 = fz + fc.v[2] * cv2;
            var o1 = occ(ax1, ay1, az1), o2 = occ(ax2, ay2, az2), axc = ax1 + fc.v[0] * cv2, ayc = ay1 + fc.v[1] * cv2, azc = az1 + fc.v[2] * cv2, oc = (o1 && o2) || occ(axc, ayc, azc);
            skyV[c] = (fs + (o1 ? fs : lightAt(lt.sky, ax1, ay1, az1, noSky ? 0 : 15)) + (o2 ? fs : lightAt(lt.sky, ax2, ay2, az2, noSky ? 0 : 15)) + (oc ? fs : lightAt(lt.sky, axc, ayc, azc, noSky ? 0 : 15))) / 60;
            blkV[c] = (fb + (o1 ? fb : lightAt(lt.blk, ax1, ay1, az1, 0)) + (o2 ? fb : lightAt(lt.blk, ax2, ay2, az2, 0)) + (oc ? fb : lightAt(lt.blk, axc, ayc, azc, 0))) / 60;
          }
        } else skyV = [1, 1, 1, 1];
        var rect = tiles[f], base = layer.pos.length / 3, anim = def.fr ? def.fr[f] : 0;
        var lowerTop = (bk === 'water' || bk === 'lava') && !(y + 1 < H && padded[((y + 1) * PW + z + 1) * PW + x + 1] === bid);     // an exposed surface sits 1/8 below the top
        // a box face samples a part of its tile (uvr: sides, uvTop / uvBot) by position inside the box; a plain face samples the whole tile by position in the cell
        var sub = box ? (f === 2 ? def.uvTop : f === 3 ? def.uvBot : def.uvr) : null, tr = rect;
        if (sub) tr = [rect[0] + (rect[2] - rect[0]) * sub[0] / 16, rect[1] + (rect[3] - rect[1]) * sub[1] / 16, rect[0] + (rect[2] - rect[0]) * sub[2] / 16, rect[1] + (rect[3] - rect[1]) * sub[3] / 16];
        var lo = box ? [box[0] / 16, box[1] / 16, box[2] / 16] : [0, 0, 0], hi = box ? [box[3] / 16, box[4] / 16, box[5] / 16] : [1, 1, 1];
        for (c = 0; c < 4; c++) {
          var cu = CORNERS[c][0], cv = CORNERS[c][1], q = [0, 0, 0], k;
          for (k = 0; k < 3; k++) q[k] = fc.n[k] ? (fc.n[k] > 0 ? hi[k] : lo[k]) : fc.u[k] ? (cu ? hi[k] : lo[k]) : (cv ? hi[k] : lo[k]);
          layer.pos.push(x + q[0], y + (lowerTop && q[1] === 1 ? 0.875 : q[1]), z + q[2]);
          // texture coordinates: side faces stand upright (v along +y, u to the viewer's right); top and bottom use x and z. `t*` = fraction along the face.
          var tu, tv, ex = box && sub ? [(q[0] - lo[0]) / (hi[0] - lo[0] || 1), (q[1] - lo[1]) / (hi[1] - lo[1] || 1), (q[2] - lo[2]) / (hi[2] - lo[2] || 1)] : q;
          if (f === 2 || f === 3) { tu = ex[0]; tv = ex[2]; }
          else { var rx = fc.n[2], rz = -fc.n[0]; tu = rx !== 0 ? (rx > 0 ? ex[0] : 1 - ex[0]) : (rz > 0 ? ex[2] : 1 - ex[2]); tv = ex[1]; }
          layer.uv.push(tr[0] + (tr[2] - tr[0]) * tu, tr[1] + (tr[3] - tr[1]) * tv);
          layer.br.push(bk === 'water' ? 0.92 : bk === 'lava' ? 1 : FACE_SHADE[f] * AO_BRIGHT[ao[c]]);
          layer.sk.push(skyV[c]); layer.bl.push(Math.max(blkV[c], emitL)); layer.an.push(anim);
        }
        if (ao[0] + ao[2] > ao[1] + ao[3]) layer.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);       // split along the darker diagonal
        else layer.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        layer.faces++;
      }
    }
    // two crossed quads (berry bushes, wheat, glowcaps): double-sided in the cutout material, lit by their own cell
    function plant(L, d, px, py, pz) {
      var rect = d.tiles[0], base, k, s0 = lt ? lightAt(lt.sky, px, py, pz, noSky ? 0 : 15) / 15 : 1, b0 = lt ? lightAt(lt.blk, px, py, pz, 0) / 15 : 0;
      var quads = [[0, 0, 1, 1], [0, 1, 1, 0]];
      for (k = 0; k < 2; k++) {
        base = L.pos.length / 3;
        var q = quads[k];
        L.pos.push(px + q[0], py, pz + q[1], px + q[2], py, pz + q[3], px + q[2], py + 1, pz + q[3], px + q[0], py + 1, pz + q[1]);
        L.uv.push(rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]);
        for (var j = 0; j < 4; j++) { L.br.push(0.95); L.sk.push(s0); L.bl.push(Math.max(b0, (d.emit || 0) / 15)); L.an.push(d.fr ? d.fr[0] : 0); }
        L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        L.faces++;
      }
    }
    var out = { faces: layers.opaque.faces + layers.cut.faces + layers.water.faces };
    for (var kk in layers) {
      var Ly = layers[kk];
      out[kk] = { pos: new Float32Array(Ly.pos), uv: new Float32Array(Ly.uv), br: new Float32Array(Ly.br), sk: new Float32Array(Ly.sk), bl: new Float32Array(Ly.bl), an: new Float32Array(Ly.an), idx: new Uint32Array(Ly.idx), faces: Ly.faces };
    }
    return out;
  }

  // ------------------------------------------------------------------ API
  function init(c) {
    cfg = c; id = c.ids; perm = buildPerm(c.seed >>> 0); tabs = null; crackCache = null; vaultCache = null;
    return true;
  }
  var API = {
    init: init, generate: generate, mesh: mesh, crackSites: crackSites, vaultSites: vaults, vaultCell: vaultCell, underFloor: underFloor, underCeil: underCeil, meshRegion: meshRegion, lightRegion: lightRegion, spawn: spawn, columnInfo: columnInfo, caveAt: caveAt,
    noise2: function (x, y) { return noise2(x, y); }, noise3: function (x, y, z) { return noise3(x, y, z); },
    ao: function (s1, s2, c) { return s1 && s2 ? 0 : 3 - (s1 + s2 + c); },
    BIOME: { PLAINS: PLAINS, FOREST: FOREST, DESERT: DESERT, MOUNTAINS: MOUNTAINS, BEACH: BEACH, OCEAN: OCEAN },
  };

  var isWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
  if (isWorker) {
    self.onmessage = function (e) {
      var m = e.data, out, tr = [];
      try {
        if (m.t === 'init') { init(m.cfg); self.postMessage({ t: 'ready', rid: m.rid }); return; }
        if (m.t === 'gen') { out = generate(m.cx, m.cz); tr.push(out.data.buffer, out.biomes.buffer); self.postMessage({ t: 'gen', rid: m.rid, data: out.data, biomes: out.biomes }, tr); return; }
        if (m.t === 'mesh' || m.t === 'meshR') {
          out = m.t === 'mesh' ? mesh(m.padded) : meshRegion(m.region, m.opts);
          ['opaque', 'cut', 'water'].forEach(function (k) { tr.push(out[k].pos.buffer, out[k].uv.buffer, out[k].br.buffer, out[k].sk.buffer, out[k].bl.buffer, out[k].an.buffer, out[k].idx.buffer); });
          if (out.light) tr.push(out.light.buffer);
          self.postMessage({ t: 'mesh', rid: m.rid, mesh: out }, tr); return;
        }
        if (m.t === 'sites') { self.postMessage({ t: 'sites', rid: m.rid, sites: { cracks: cfg.dim && cfg.dim !== 'overworld' ? [] : crackSites(), vaults: cfg.dim === 'underlayer' ? vaults() : [] } }); return; }
        if (m.t === 'spawn') { self.postMessage({ t: 'spawn', rid: m.rid, spawn: spawn() }); return; }
        if (m.t === 'column') { self.postMessage({ t: 'column', rid: m.rid, info: columnInfo(m.x, m.z) }); return; }
      } catch (err) { self.postMessage({ t: 'error', rid: m.rid, message: String(err && err.stack || err) }); }
    };
    self.postMessage({ t: 'hello' });
  } else if (typeof globalThis !== 'undefined') globalThis.StrataGen = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
