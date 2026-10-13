#!/usr/bin/env node
// Step 1 of the Strata asset pipeline (STRATA_SPEC.md B2): Kenney packs in assets/source/ (NOT in git) -> games/strata/assets/ (committed).
// Dev-only. Setup once: `npm install --prefix tools`; needs `ffmpeg` on the PATH for the sounds. Run: `node tools/strata/build-assets.mjs`.
//   atlas.png + atlas.json   every block face at 32x32 (nearest), 2 px duplicated-border padding per tile so nothing bleeds
//   items.png + items.json   item icons at 32x32
//   sounds/*.ogg + sounds.json   mono, silence trimmed, peak-normalised; picks come from tools/strata/assets.json
//   font.ttf                 the chosen Kenney font
// Roles marked "generate" in assets.json have no good match in the pack: they are drawn here, pixel by pixel, from a seed (so the build is reproducible).
// The build FAILS if games/strata/assets/ goes over the budget in assets.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets/source');
const OUT = join(ROOT, 'games/strata/assets');
const cfg = JSON.parse(readFileSync(join(ROOT, 'tools/strata/assets.json'), 'utf8'));

let sharp;
try { sharp = (await import('sharp')).default; } catch (e) { console.error(`Dev dependencies missing (${e.code ?? e.message}). Run once: npm install --prefix tools`); process.exit(1); }
if (!existsSync(join(SRC, 'kenney_voxel-pack'))) { console.error(`Raw packs not found in ${SRC}.\nThey are gitignored and only needed to REBUILD the assets (the built ones are committed). Run: node tools/strata/inventory-assets.mjs`); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'sounds'), { recursive: true });

// ---------------------------------------------------------------- tiny pixel toolkit (RGBA, row-major)
const T = cfg.tile.size, PAD = cfg.tile.padding, CELL = T + PAD * 2;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const canvas = (w, h) => ({ w, h, d: Buffer.alloc(w * h * 4) });
const put = (c, x, y, [r, g, b, a = 255]) => { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const i = (y * c.w + x) * 4; c.d[i] = r; c.d[i + 1] = g; c.d[i + 2] = b; c.d[i + 3] = a; };
const rect = (c, x, y, w, h, col) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(c, x + i, y + j, col); };
const line = (c, x0, y0, x1, y1, col) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) put(c, Math.round(x0 + ((x1 - x0) * i) / (n || 1)), Math.round(y0 + ((y1 - y0) * i) / (n || 1)), col); };
const raw = async (file, size = T) => ({ w: size, h: size, d: await sharp(join(SRC, file)).resize(size, size, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer() });
const png = (c) => sharp(c.d, { raw: { width: c.w, height: c.h, channels: 4 } });
const darken = (c, k) => { for (let i = 0; i < c.d.length; i += 4) { c.d[i] *= k; c.d[i + 1] *= k; c.d[i + 2] *= k; } };
const over = (dst, src, ox = 0, oy = 0) => { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const i = (y * src.w + x) * 4; const a = src.d[i + 3]; if (a) put(dst, x + ox, y + oy, [src.d[i], src.d[i + 1], src.d[i + 2], a]); } };

// ---------------------------------------------------------------- generated faces (roles with no match in the pack)
const generated = {
  async bedrock(spec) {
    const c = await raw(spec.base);
    darken(c, 0.42);
    const r = rng(hash('bedrock'));
    for (let i = 0; i < 90; i++) { const x = Math.floor(r() * T), y = Math.floor(r() * T), v = r() < 0.5 ? [20, 20, 24] : [96, 98, 108]; rect(c, x, y, r() < 0.3 ? 2 : 1, 1, v); }
    return c;
  },
  async crafting_table_side(spec) {
    const c = await raw(spec.base);
    rect(c, 0, 0, T, 5, [92, 58, 28]);                                   // darker top frame
    rect(c, 0, T - 3, T, 3, [92, 58, 28]);
    line(c, 6, 14, 26, 14, [206, 208, 214]);                              // a saw: blade with teeth
    for (let x = 7; x < 26; x += 3) put(c, x, 15, [150, 152, 160]);
    rect(c, 5, 12, 3, 5, [70, 44, 20]);                                    // handle
    return c;
  },
  async crafting_table_front(spec) {
    const c = await raw(spec.base);
    rect(c, 0, 0, T, 5, [92, 58, 28]);
    rect(c, 0, T - 3, T, 3, [92, 58, 28]);
    rect(c, 8, 10, 9, 5, [120, 122, 132]);                                // hammer head
    line(c, 12, 15, 12, 25, [76, 48, 22]); line(c, 13, 15, 13, 25, [76, 48, 22]);
    line(c, 21, 24, 25, 12, [206, 208, 214]); put(c, 25, 11, [206, 208, 214]);   // a chisel
    return c;
  },
  async ad_block(spec) {
    const c = await raw(spec.base);
    rect(c, 6, 8, 20, 16, [190, 190, 190]);                                // a tiny pop-up window
    rect(c, 6, 8, 20, 4, [0, 0, 128]);
    rect(c, 23, 9, 2, 2, [220, 40, 40]);
    rect(c, 8, 14, 16, 8, [255, 255, 255]);
    rect(c, 10, 16, 9, 1, [60, 60, 60]); rect(c, 10, 18, 6, 1, [60, 60, 60]);
    rect(c, 18, 19, 5, 2, [20, 160, 40]);
    return c;
  },
};
const genItem = {                                                         // drawn at 16x16, shown at 32x32
  stick() { const c = canvas(16, 16); for (let i = 0; i < 12; i++) { put(c, 3 + i, 12 - i, [140, 98, 52]); put(c, 4 + i, 12 - i, [104, 70, 34]); } put(c, 3, 12, [176, 130, 76]); return c; },
  iron_ingot() { const c = canvas(16, 16); rect(c, 3, 6, 10, 5, [214, 218, 226]); rect(c, 4, 4, 9, 2, [240, 243, 248]); rect(c, 3, 10, 10, 2, [150, 154, 164]); rect(c, 13, 6, 1, 5, [120, 124, 134]); put(c, 5, 5, [255, 255, 255]); return c; },
  popup() { const c = canvas(16, 16); rect(c, 1, 3, 14, 11, [190, 190, 190]); rect(c, 1, 3, 14, 3, [0, 0, 128]); rect(c, 12, 4, 2, 1, [220, 40, 40]); rect(c, 2, 7, 12, 6, [255, 255, 255]); rect(c, 3, 8, 7, 1, [60, 60, 60]); rect(c, 9, 10, 4, 2, [20, 160, 40]); return c; },
};

// ---- Part 2 helpers
const tint = (c, [r, g, b]) => { for (let i = 0; i < c.d.length; i += 4) { c.d[i] = Math.min(255, c.d[i] * r); c.d[i + 1] = Math.min(255, c.d[i + 1] * g); c.d[i + 2] = Math.min(255, c.d[i + 2] * b); } return c; };
const fill = (w, h, col) => { const c = canvas(w, h); rect(c, 0, 0, w, h, col); return c; };
const speckle = (c, seed, n, cols, maxw = 2) => { const r = rng(seed); for (let i = 0; i < n; i++) rect(c, Math.floor(r() * c.w), Math.floor(r() * c.h), 1 + Math.floor(r() * maxw), 1, cols[Math.floor(r() * cols.length)]); return c; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
/** ASCII pixel art: rows of palette characters ('.' = transparent), centred on a 16x16 canvas. */
const art = (rows, pal, centre = false) => { const c = canvas(16, 16), w = Math.max(...rows.map((r) => r.length)), oy = Math.floor((16 - rows.length) / 2); rows.forEach((row, y) => { const ox = Math.floor((16 - (centre ? row.length : w)) / 2); [...row].forEach((ch, x) => { if (ch !== '.' && ch !== ' ') put(c, ox + x, oy + y, pal[ch]); }); }); return c; };
const plankTile = async () => raw('kenney_voxel-pack/PNG/Tiles/wood.png');
const REDS = [[200, 40, 40], [160, 24, 30]];

Object.assign(generated, {
  async basalt() { const c = await raw('kenney_voxel-pack/PNG/Tiles/greystone.png'); tint(c, [0.5, 0.5, 0.58]); return speckle(speckle(c, hash('basalt'), 60, [[22, 22, 28], [96, 96, 112]]), hash('basalt2'), 12, [[90, 92, 104]], 1); },
  async scorched_stone() { const c = await raw('kenney_voxel-pack/PNG/Tiles/stone.png'); tint(c, [0.5, 0.42, 0.42]); const r = rng(hash('scorch')); for (let i = 0; i < 7; i++) { const x = Math.floor(r() * T), y = Math.floor(r() * T); rect(c, x, y, 4 + Math.floor(r() * 5), 3 + Math.floor(r() * 4), [28, 20, 20]); } return speckle(c, hash('ember'), 7, [[230, 90, 30], [255, 150, 40]], 1); },
  async chest_top() { const c = await plankTile(); rect(c, 0, 0, T, 2, [70, 42, 18]); rect(c, 0, T - 2, T, 2, [70, 42, 18]); rect(c, 0, 0, 2, T, [70, 42, 18]); rect(c, T - 2, 0, 2, T, [70, 42, 18]); return c; },
  async chest_side() { const c = await plankTile(); rect(c, 0, 0, T, 2, [70, 42, 18]); rect(c, 0, T - 2, T, 2, [70, 42, 18]); rect(c, 0, 12, T, 3, [70, 42, 18]); return c; },
  async chest_front() { const c = await generated.chest_side(); rect(c, 13, 10, 6, 8, [190, 190, 200]); rect(c, 14, 11, 4, 3, [120, 120, 130]); rect(c, 15, 14, 2, 3, [60, 60, 70]); return c; },
  async bed_top() { const c = await raw('kenney_voxel-pack/PNG/Tiles/cotton_red.png'); rect(c, 0, 0, T, 2, [150, 30, 30]); rect(c, 0, T - 2, T, 2, [150, 30, 30]); return c; },
  async bed_pillow() { const c = await generated.bed_top(); rect(c, 4, 4, 24, 9, [244, 240, 226]); rect(c, 4, 12, 24, 1, [210, 205, 190]); return c; },
  async bed_side() { const c = await plankTile(); rect(c, 0, 0, T, 20, [196, 52, 52]); rect(c, 0, 18, T, 2, [140, 30, 30]); return c; },
  async glowcap() { const c = await raw('kenney_voxel-pack/PNG/Tiles/mushroom_tan.png'); tint(c, [0.45, 1.0, 1.0]); speckle(c, hash('glow'), 10, [[190, 255, 250]], 1); for (let i = 0; i < c.d.length; i += 4) if (!c.d[i + 3]) continue; return c; },
  async berry_bush() { const c = await raw('kenney_voxel-pack/PNG/Tiles/leaves_transparent.png'); const r = rng(hash('berry')); let n = 0; for (let tries = 0; tries < 400 && n < 9; tries++) { const x = 2 + Math.floor(r() * (T - 5)), y = 2 + Math.floor(r() * (T - 5)); if (c.d[(y * T + x) * 4 + 3]) { rect(c, x, y, 3, 3, [200, 30, 50]); put(c, x, y, [255, 110, 120]); n++; } } return c; },
  async wild_wheat() { return raw('kenney_voxel-pack/PNG/Tiles/wheat_stage4.png'); },
  async cracked_bedrock() { const c = await generated.bedrock({ base: 'kenney_voxel-pack/PNG/Tiles/greystone.png' }); const r = rng(hash('crack')); let x = 4, y = 2; for (let i = 0; i < 36; i++) { rect(c, x, y, 2, 1, [60, 230, 255]); put(c, x - 1, y, [20, 120, 160]); x += Math.floor(r() * 3) - 1; y += 1; if (r() < 0.12) { for (let k = 0; k < 8; k++) { rect(c, x + k, y, 1, 1, [60, 230, 255]); y += r() < 0.4 ? 1 : 0; } } if (y >= T) break; } return c; },
  async rift(spec, f) { return riftTile(f, [[24, 6, 44], [70, 20, 120], [150, 70, 220]]); },
  async rift_white(spec, f) { return riftTile(f, [[170, 176, 190], [225, 230, 240], [255, 255, 255]]); },
  async server_rack_front(spec, f) { const c = fill(T, T, [34, 36, 44]); rect(c, 0, 0, T, 1, [80, 84, 96]); rect(c, 0, T - 1, T, 1, [14, 14, 18]); const r = rng(hash('rack') + f * 7); for (let row = 0; row < 6; row++) { const y = 2 + row * 5; rect(c, 2, y, 28, 4, [20, 22, 28]); rect(c, 3, y + 1, 12, 2, [44, 48, 58]); for (let k = 0; k < 5; k++) { const on = r() < 0.55; put(c, 18 + k * 2, y + 1, on ? (k % 2 ? [50, 240, 90] : [255, 190, 40]) : [38, 42, 50]); } if (r() < 0.2) put(c, 28, y + 1, [255, 50, 50]); } return c; },
  async server_rack_side() { const c = fill(T, T, [30, 32, 40]); rect(c, 0, 0, T, 1, [70, 74, 86]); rect(c, 0, T - 1, T, 1, [14, 14, 18]); for (let y = 4; y < T - 3; y += 3) rect(c, 3, y, 26, 1, [14, 16, 20]); return c; },
  async vault_door() { const c = await generated.server_rack_front({}, 0); rect(c, 3, 3, 26, 26, [92, 96, 108]); rect(c, 4, 4, 24, 24, [60, 64, 76]); for (let i = 0; i < 6; i++) rect(c, 4 + i * 4 + (i % 2) * 0, 24, 2, 4, [240, 190, 30]); rect(c, 12, 10, 8, 8, [28, 30, 38]); rect(c, 14, 12, 4, 4, [60, 240, 120]); return c; },
  async spawner() { const c = fill(T, T, [18, 14, 18]); for (let i = 0; i < T; i += 6) { rect(c, i, 0, 2, T, [96, 100, 112]); rect(c, 0, i, T, 2, [96, 100, 112]); } speckle(c, hash('spawn'), 14, [[255, 110, 30], [255, 190, 60]], 2); rect(c, 12, 12, 8, 8, [255, 120, 30]); rect(c, 14, 14, 4, 4, [255, 220, 120]); return c; },
  async memory_block() { const c = fill(T, T, [12, 44, 28]); for (let i = 0; i <= T; i += 8) { rect(c, Math.min(i, T - 1), 0, 1, T, [40, 200, 100]); rect(c, 0, Math.min(i, T - 1), T, 1, [40, 200, 100]); } speckle(c, hash('mem'), 18, [[120, 255, 170], [30, 120, 70]], 1); return c; },
  async kernel_crystal() { const c = fill(T, T, [20, 110, 70]); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const d = Math.abs(x - 15.5) + Math.abs(y - 15.5); put(c, x, y, mix([30, 140, 90], [200, 255, 220], Math.max(0, 1 - d / 26))); } line(c, 0, 0, 31, 31, [90, 220, 150]); line(c, 31, 0, 0, 31, [90, 220, 150]); return c; },
  async kernel_core() { const c = fill(T, T, [14, 70, 40]); rect(c, 3, 3, 26, 26, [30, 150, 80]); rect(c, 8, 8, 16, 16, [120, 255, 170]); rect(c, 12, 12, 8, 8, [255, 255, 255]); return c; },
  async torch(spec, f) { const c = canvas(T, T); rect(c, 14, 12, 4, 20, [128, 88, 44]); rect(c, 14, 12, 1, 20, [96, 62, 28]); rect(c, 14, 4 + f, 4, 8, [255, 150, 30]); rect(c, 15, 3 + f, 2, 9, [255, 205, 60]); rect(c, 15, 6 + f, 2, 4, [255, 250, 190]); return c; },
});
function riftTile(f, [d, m, l]) {
  const c = canvas(T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const a = Math.atan2(y - 15.5, x - 15.5), r = Math.hypot(x - 15.5, y - 15.5);
    const v = Math.sin(a * 3 + r * 0.45 - f * 1.571) * 0.5 + 0.5, w = Math.sin(r * 0.9 + a - f * 0.9) * 0.5 + 0.5;
    put(c, x, y, mix(mix(d, m, v), l, w * w * 0.7));
  }
  return speckle(c, hash('rift') + f, 10, [l], 1);
}


const PAL = {
  leather: { a: [70, 42, 22], b: [130, 84, 44], c: [168, 112, 62] }, iron: { a: [70, 74, 84], b: [176, 180, 190], c: [228, 231, 238] }, cobalt: { a: [24, 52, 110], b: [58, 118, 210], c: [130, 196, 255] },
};
const ARMOR = {
  helmet: ['.aaaaaaaa.', 'abbbbbbbba', 'abccccccba', 'abccccccba', 'abcc..ccba', 'abc....cba', 'aa......aa'],
  chestplate: ['aaa....aaa', 'abba..abba', 'abcbaaabcba', 'abccbbbccba', 'aaabccccbaaa', '..abccccba..', '..abccccba..', '..abccccba..', '..abbbbbba..', '...aaaaaa...'],
  leggings: ['aaaaaaaaaa', 'abbbbbbbba', 'abccccccba', 'abcc..ccba', 'abcc..ccba', 'abcc..ccba', 'abcc..ccba', 'aaaa..aaaa'],
  boots: ['aaa..aaa', 'abca..acba', 'abca..acba', 'aabbaaaabbaa', 'abccbaabccba', 'aaaaaa..aaaaaa'],
};
const MEAT = ['.........aaaa...', '.......aaaaaaa..', '......aaccaaaab.', '......aacaaaaab.', '......aaaaaaabb.', '.......aaaaabb..', '........bbbbb...', '.......dd.......', '......dd........', '.....dd.........', '....dede........', '....ddd.........'];
const meat = (a, b, c) => art(MEAT, { a, b, c, d: [236, 230, 210], e: [190, 182, 160] });
Object.assign(genItem, {
  cobalt_ingot() { const c = genItem.iron_ingot(); for (let i = 0; i < c.d.length; i += 4) { const l = (c.d[i] + c.d[i + 1] + c.d[i + 2]) / 3 / 255; c.d[i] = 24 + l * 90; c.d[i + 1] = 60 + l * 140; c.d[i + 2] = 130 + l * 125; } return c; },
  cobalt_nugget() { return art(['..aaa..', '.abbba.', 'abcbbba', 'abbbbba', '.aabba.', '...aa..'], { a: [24, 52, 110], b: [58, 118, 210], c: [170, 220, 255] }); },
  bread() { return art(['..aaaaaaaa..', '.abbbbbbbba.', 'abcbbbcbbbba', 'abbbbbbbbbba', 'abbcbbbbcbba', '.aabbbbbbaa.', '..aaaaaaaa..'], { a: [130, 80, 30], b: [214, 158, 74], c: [240, 206, 130] }); },
  berries() { return art(['..g..g....', '.gGgGg....', '..ee.rr...', '.rrrrRrr..', 'rrRrrrrrr.', 'rrrrrrRrr.', '.rrrrrrr..', '..rrrrr...'].map((r) => r.replace(/e/g, 'g')), { g: [50, 130, 50], G: [90, 180, 80], r: [196, 30, 60], R: [255, 120, 130] }); },
  shears() { return art(['.....aa.........', '....abba....cc..', '....abba...cdd..', '.....abbaacdd...', '......abbbd.....', '.......abbd.....', '......abbbbd....', '.....abbaabbd...', '....rrr...rrr...', '...rRRr...rRRr..', '...rrr.....rrr..'], { a: [150, 154, 164], b: [226, 230, 238], c: [150, 154, 164], d: [226, 230, 238], r: [170, 40, 40], R: [220, 80, 80] }); },
  raw_pork() { return meat([236, 150, 160], [196, 100, 112], [255, 205, 210]); },
  raw_beef() { return meat([186, 52, 56], [130, 30, 36], [226, 110, 110]); },
  raw_mutton() { return meat([214, 120, 110], [160, 80, 74], [244, 176, 168]); },
  raw_chicken() { return meat([240, 200, 180], [206, 156, 130], [255, 232, 218]); },
  cooked_pork() { return meat([170, 96, 50], [118, 62, 30], [212, 142, 84]); },
  cooked_beef() { return meat([140, 74, 38], [92, 46, 24], [190, 112, 64]); },
  cooked_mutton() { return meat([160, 88, 46], [108, 56, 28], [204, 130, 76]); },
  cooked_chicken() { return meat([208, 150, 76], [156, 100, 44], [244, 196, 120]); },
  leather() { return art(['..aabbbbaa..', '.abbbbbbbba.', 'abbcbbbbbbba', 'abbbbbbbcbba', 'abbbbbbbbbba', 'ab.bbbbbb.ba', 'a..bbbbbb..a', '...abbbba...'], { a: [86, 50, 24], b: [150, 98, 52], c: [190, 134, 78] }); },
  feather() { return art(['.........aa', '.......aabb', '.....aabbbb', '...aabbbbb.', '..aabbbbb..', '.aabbbb....', '.abbb......', 'dabb.......', 'd..........'], { a: [200, 206, 216], b: [248, 250, 255], d: [150, 150, 160] }); },
  string() { return art(['..aaa...a.', '.a...a.a.a', 'a.....a..a', 'a..aaaa.a.', '.a.a...aa.', '..aa...a..', '.....aa...', '....a.....'], { a: [236, 236, 236] }); },
  bone() { return art(['aa......aa', 'abb....bba', '.abb..bba.', '..abbbba..', '...abbba..', '..abbba...', '.abba.....', 'abba......', 'aa........'].map((r) => r), { a: [196, 188, 168], b: [240, 236, 222] }); },
  flint() { return art(['....aa....', '...abba...', '..abbcba..', '.abbbbcba.', 'abbbbbbba.', '.aabbbba..', '...aaaa...'], { a: [30, 32, 38], b: [72, 76, 88], c: [140, 146, 160] }); },
  rotten_flesh() { return art(['..aaaa....', '.abbbbaa..', 'abbcbbbba.', 'abbbbcbbba', '.abbbbbbba', '..abcbbba.', '...aaaaa..'], { a: [60, 70, 36], b: [112, 120, 70], c: [150, 90, 80] }); },
  kernel_shard() { return art(['...aa...', '..abba..', '.abccba.', 'abccccba', 'abccddba', '.abddba.', '..abba..', '...aa...'], { a: [14, 90, 56], b: [40, 190, 110], c: [140, 255, 190], d: [255, 255, 255] }); },
  kernel_key() { return art(['.aaaa...........', 'abbbba..........', 'abccba..........', 'abccbaaaaaaaaaa.', 'abbbbbbbbbbbbba.', '.aaaa.aaaa.aabba', '......a..a.a..a.'], { a: [120, 100, 30], b: [236, 200, 70], c: [90, 255, 150] }); },
  tracer() { return art(['...aaaaaa...', '..abbbbbba..', '.abccccccba.', 'abccccdcccba', 'abcccddcccba', 'abcccdddcca.', 'abccccdcccba', '.abccccccba.', '..abbbbbba..', '...aaaaaa...'].map((r) => r.replace(/\.a$/, '.')), { a: [60, 64, 74], b: [176, 180, 190], c: [28, 36, 50], d: [255, 80, 80] }); },
  ash_dust() { return art(['...aa...', '..abba..', '.abbbba.', 'abbcbbba', 'aabbbbaa'], { a: [70, 66, 66], b: [120, 116, 116], c: [160, 156, 156] }); },
  glitch_dust() { return art(['a...b..c.', '..c..a...', 'b..aab..c', '..b..c.a.', 'a.c..b..a', '.b..a..c.'], { a: [255, 60, 220], b: [60, 255, 240], c: [255, 255, 255] }); },
});
for (const [tier, pal] of Object.entries(PAL)) for (const [piece, rows] of Object.entries(ARMOR)) genItem[`${tier}_${piece}`] = () => art(rows, pal, true);

const upscale = (c, k) => { const o = canvas(c.w * k, c.h * k); for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const i = ((y / k | 0) * c.w + (x / k | 0)) * 4; put(o, x, y, [c.d[i], c.d[i + 1], c.d[i + 2], c.d[i + 3]]); } return o; };

// ---------------------------------------------------------------- 1. block atlas
// every cell of the atlas: animated tiles take `frames` neighbouring cells in one row (the shader steps u by one cell per frame)
const names = Object.keys(cfg.tiles);
const cellsNeeded = names.reduce((n, k) => n + (cfg.tiles[k].frames ?? 1), 0);
const cols = Math.ceil(Math.sqrt(cellsNeeded)) + 1;
const placed = [];
{ let col = 0, row = 0; for (const name of names) { const f = cfg.tiles[name].frames ?? 1; if (col + f > cols) { col = 0; row++; } placed.push({ name, col, row, f }); col += f; if (col >= cols) { col = 0; row++; } } }
const rowsUsed = Math.max(...placed.map((p) => p.row)) + 1;
const atlasSize = 2 ** Math.ceil(Math.log2(Math.max(cols, rowsUsed) * CELL));
const atlas = canvas(atlasSize, atlasSize);
const tileMeta = {};
for (const { name, col, row, f } of placed) {
  const spec = cfg.tiles[name];
  for (let fr = 0; fr < f; fr++) {
    let tile;
    if (generated[name] && (spec.overlay || spec.tint)) tile = await generated[name](spec, fr);
    else if (spec.src) { tile = await raw(spec.src); if (spec.tint === 'cyan' || Array.isArray(spec.tint)) tint(tile, Array.isArray(spec.tint) ? spec.tint : [0.45, 1, 1]); }
    else if (spec.composite) { tile = await raw(spec.composite[0]); over(tile, await raw(spec.composite[1])); }
    else if (generated[name]) tile = await generated[name](spec, fr);
    else throw new Error(`tile ${name}: no src and no generator`);
    const cx = (col + fr) * CELL, cy = row * CELL;
    for (let y = -PAD; y < T + PAD; y++) for (let x = -PAD; x < T + PAD; x++) {          // duplicate the border pixels into the padding
      const sx = Math.min(T - 1, Math.max(0, x)), sy = Math.min(T - 1, Math.max(0, y)), i = (sy * T + sx) * 4;
      put(atlas, cx + PAD + x, cy + PAD + y, [tile.d[i], tile.d[i + 1], tile.d[i + 2], tile.d[i + 3]]);
    }
    if (fr === 0) tileMeta[name] = { x: cx + PAD, y: cy + PAD, w: T, h: T, ...(f > 1 ? { frames: f, stride: CELL } : {}), ...(spec.cutout ? { cutout: true } : {}), ...(spec.translucent ? { translucent: true } : {}) };
  }
}
await png(atlas).png({ compressionLevel: 9 }).toFile(join(OUT, 'atlas.png'));
writeFileSync(join(OUT, 'atlas.json'), JSON.stringify({ size: atlasSize, tile: T, padding: PAD, tiles: tileMeta }, null, 1));

// ---------------------------------------------------------------- 2. item icons
/** An item icon taken from a block tile (the first frame of the atlas), shown at I x I. */
const tileIcon = async (name, size) => { const m = tileMeta[name]; const c = canvas(T, T); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const i = ((m.y + y) * atlas.w + m.x + x) * 4; put(c, x, y, [atlas.d[i], atlas.d[i + 1], atlas.d[i + 2], atlas.d[i + 3]]); } return size === T ? c : upscale(c, size / T); };
const iNames = Object.keys(cfg.items), I = cfg.itemSize, iCols = 10, iRows = Math.ceil(iNames.length / iCols);
const sheet = canvas(iCols * I, iRows * I);
const iMeta = {};
for (let n = 0; n < iNames.length; n++) {
  const name = iNames[n], spec = cfg.items[name];
  const icon = spec.fromTile ? await tileIcon(spec.fromTile, I) : spec.src ? await raw(spec.src, I) : upscale((genItem[name] ?? (() => { throw new Error(`item ${name}: no src and no generator`); }))(), I / 16);
  const x = (n % iCols) * I, y = Math.floor(n / iCols) * I;
  over(sheet, icon, x, y);
  iMeta[name] = { x, y };
}
await png(sheet).png({ compressionLevel: 9 }).toFile(join(OUT, 'items.png'));
writeFileSync(join(OUT, 'items.json'), JSON.stringify({ size: I, w: sheet.w, h: sheet.h, items: iMeta }, null, 1));

// ---------------------------------------------------------------- 3. sounds: mono, trimmed, peak-normalised to -2 dB, vorbis
const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.004,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01,areverse';
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
const tmp = join(tmpdir(), `strata-snd-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const sounds = {};
let sndBytes = 0;
for (const [role, files] of Object.entries(cfg.sounds)) {
  sounds[role] = [];
  files.forEach((rel, i) => {
    const wav = join(tmp, 'x.wav'), out = `${role}.${i}.ogg`;
    ff(['-i', join(SRC, rel), '-ac', '1', '-af', TRIM, wav]);
    const log = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '';   // volumedetect reports on stderr
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? NaN);
    const gain = Number.isFinite(peak) ? Math.min(24, -2 - peak) : 0;
    ff(['-i', wav, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libvorbis', '-q:a', '2', join(OUT, 'sounds', out)]);
    const bytes = statSync(join(OUT, 'sounds', out)).size;
    sndBytes += bytes;
    sounds[role].push(out);
  });
}
rmSync(tmp, { recursive: true, force: true });
writeFileSync(join(OUT, 'sounds.json'), JSON.stringify(sounds, null, 1));

// ---------------------------------------------------------------- 4. font
copyFileSync(join(SRC, cfg.font.src), join(OUT, 'font.ttf'));

// ---------------------------------------------------------------- budget
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const total = walk(OUT).reduce((n, f) => n + statSync(f).size, 0);
const kb = (n) => (n / 1024).toFixed(1);
console.log(`atlas ${atlasSize}x${atlasSize}: ${names.length} tiles | items ${sheet.w}x${sheet.h}: ${iNames.length} icons | sounds: ${Object.values(sounds).flat().length} files, ${kb(sndBytes)} KB | font ${kb(statSync(join(OUT, 'font.ttf')).size)} KB`);
console.log(`total ${kb(total)} KB of ${kb(cfg.budget.totalBytes)} KB`);
if (sndBytes > cfg.budget.soundBytes) { console.error(`FAIL: sounds ${kb(sndBytes)} KB over ${kb(cfg.budget.soundBytes)} KB`); process.exit(1); }
if (total > cfg.budget.totalBytes) { console.error(`FAIL: assets ${kb(total)} KB over ${kb(cfg.budget.totalBytes)} KB`); process.exit(1); }
