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
    var g = cfg.gen, ox = cx * CS, oz = cz * CS, kinds = [[id.coal_ore, g.coalPerChunk, g.coal, 1.2, 2.4, 1], [id.iron_ore, g.ironPerChunk, g.iron, 1.0, 2.0, 2]];
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

  function newLayer() { return { pos: [], uv: [], br: [], idx: [], faces: 0 }; }

  /** Is this block hiding the face of `cur` that touches it? */
  function hides(cur, nb) {
    var ck = cfg.blocks[cur].kind, nk = cfg.blocks[nb].kind;
    if (nk === 'air') return false;
    if (cur === nb && (ck === 'cutout' || ck === 'water')) return true;           // glass next to glass, leaves in a blob, water in water
    if (ck === 'opaque') return nk === 'opaque';
    if (ck === 'water') return nk === 'opaque';
    return false;                                                                    // a cutout block's faces stay next to anything else (leaves next to stone keep both faces)
  }

  /** Meshes one padded chunk into three layers (opaque, cutout, water) of typed arrays ready for transfer. */
  function mesh(padded) {
    var layers = { opaque: newLayer(), cut: newLayer(), water: newLayer() };
    var blocks = cfg.blocks, x, y, z, f, c;
    var occ = function (px, py, pz) { return py >= 0 && py < H && blocks[padded[(py * PW + pz + 1) * PW + px + 1]].kind === 'opaque' ? 1 : 0; };
    for (y = 0; y < H; y++) for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var bid = padded[(y * PW + z + 1) * PW + x + 1];
      if (bid === 0) continue;
      var bk = blocks[bid].kind, layer = bk === 'opaque' ? layers.opaque : bk === 'water' ? layers.water : layers.cut, tiles = blocks[bid].tiles;
      for (f = 0; f < 6; f++) {
        var fc = FACE[f], nx = x + fc.n[0], ny = y + fc.n[1], nz = z + fc.n[2];
        var nid = ny < 0 || ny >= H ? 0 : padded[(ny * PW + nz + 1) * PW + nx + 1];
        if (ny < 0) continue;                                                        // never draw the underside of the world
        if (nid !== 0 && hides(bid, nid)) continue;
        // ambient occlusion per corner (the classic 3-neighbour rule), only opaque blocks occlude
        var ao = [0, 0, 0, 0];
        if (bk !== 'water') {
          for (c = 0; c < 4; c++) {
            var su = CORNERS[c][0] ? 1 : -1, sv = CORNERS[c][1] ? 1 : -1;
            var s1 = occ(nx + fc.u[0] * su, ny + fc.u[1] * su, nz + fc.u[2] * su), s2 = occ(nx + fc.v[0] * sv, ny + fc.v[1] * sv, nz + fc.v[2] * sv);
            var co = occ(nx + fc.u[0] * su + fc.v[0] * sv, ny + fc.u[1] * su + fc.v[1] * sv, nz + fc.u[2] * su + fc.v[2] * sv);
            ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + co);
          }
        } else ao = [3, 3, 3, 3];
        var rect = tiles[f], base = layer.pos.length / 3;
        var lowerTop = bk === 'water' && !(y + 1 < H && padded[((y + 1) * PW + z + 1) * PW + x + 1] === bid);     // an exposed water surface sits 1/8 below the top
        for (c = 0; c < 4; c++) {
          var cu = CORNERS[c][0], cv = CORNERS[c][1];
          var lx = (fc.n[0] > 0 ? 1 : 0) * Math.abs(fc.n[0]) + cu * Math.abs(fc.u[0]) + cv * Math.abs(fc.v[0]);
          var ly = (fc.n[1] > 0 ? 1 : 0) * Math.abs(fc.n[1]) + cu * Math.abs(fc.u[1]) + cv * Math.abs(fc.v[1]);
          var lz = (fc.n[2] > 0 ? 1 : 0) * Math.abs(fc.n[2]) + cu * Math.abs(fc.u[2]) + cv * Math.abs(fc.v[2]);
          layer.pos.push(x + lx, y + (lowerTop && ly === 1 ? 0.875 : ly), z + lz);
          // texture coordinates: side faces stand upright (v along +y, u to the viewer's right); top and bottom use x and z
          var tu, tv;
          if (f === 2 || f === 3) { tu = lx; tv = lz; }
          else { var rx = fc.n[2], rz = -fc.n[0]; tu = rx !== 0 ? (rx > 0 ? lx : 1 - lx) : (rz > 0 ? lz : 1 - lz); tv = ly; }
          layer.uv.push(rect[0] + (rect[2] - rect[0]) * tu, rect[1] + (rect[3] - rect[1]) * tv);
          layer.br.push(bk === 'water' ? 0.92 : FACE_SHADE[f] * AO_BRIGHT[ao[c]]);
        }
        if (ao[0] + ao[2] > ao[1] + ao[3]) layer.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);       // split along the darker diagonal
        else layer.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        layer.faces++;
      }
    }
    var out = { faces: layers.opaque.faces + layers.cut.faces + layers.water.faces };
    for (var k in layers) {
      var L = layers[k];
      out[k] = { pos: new Float32Array(L.pos), uv: new Float32Array(L.uv), br: new Float32Array(L.br), idx: new Uint32Array(L.idx), faces: L.faces };
    }
    return out;
  }

  // ------------------------------------------------------------------ API
  function init(c) {
    cfg = c; id = c.ids; perm = buildPerm(c.seed >>> 0);
    return true;
  }
  var API = {
    init: init, generate: generate, mesh: mesh, spawn: spawn, columnInfo: columnInfo, caveAt: caveAt,
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
        if (m.t === 'mesh') {
          out = mesh(m.padded);
          ['opaque', 'cut', 'water'].forEach(function (k) { tr.push(out[k].pos.buffer, out[k].uv.buffer, out[k].br.buffer, out[k].idx.buffer); });
          self.postMessage({ t: 'mesh', rid: m.rid, mesh: out }, tr); return;
        }
        if (m.t === 'spawn') { self.postMessage({ t: 'spawn', rid: m.rid, spawn: spawn() }); return; }
        if (m.t === 'column') { self.postMessage({ t: 'column', rid: m.rid, info: columnInfo(m.x, m.z) }); return; }
      } catch (err) { self.postMessage({ t: 'error', rid: m.rid, message: String(err && err.stack || err) }); }
    };
    self.postMessage({ t: 'hello' });
  } else if (typeof globalThis !== 'undefined') globalThis.StrataGen = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
