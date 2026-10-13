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
const upscale = (c, k) => { const o = canvas(c.w * k, c.h * k); for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const i = ((y / k | 0) * c.w + (x / k | 0)) * 4; put(o, x, y, [c.d[i], c.d[i + 1], c.d[i + 2], c.d[i + 3]]); } return o; };

// ---------------------------------------------------------------- 1. block atlas
const names = Object.keys(cfg.tiles);
const cols = Math.ceil(Math.sqrt(names.length));
const atlasSize = 2 ** Math.ceil(Math.log2(cols * CELL));
const atlas = canvas(atlasSize, atlasSize);
const tileMeta = {};
for (let n = 0; n < names.length; n++) {
  const name = names[n], spec = cfg.tiles[name];
  let tile;
  if (spec.src) tile = await raw(spec.src);
  else if (spec.composite) { tile = await raw(spec.composite[0]); over(tile, await raw(spec.composite[1])); }
  else if (generated[name]) tile = await generated[name](spec);
  else throw new Error(`tile ${name}: no src and no generator`);
  const cx = (n % cols) * CELL, cy = Math.floor(n / cols) * CELL;
  for (let y = -PAD; y < T + PAD; y++) for (let x = -PAD; x < T + PAD; x++) {          // duplicate the border pixels into the padding
    const sx = Math.min(T - 1, Math.max(0, x)), sy = Math.min(T - 1, Math.max(0, y)), i = (sy * T + sx) * 4;
    put(atlas, cx + PAD + x, cy + PAD + y, [tile.d[i], tile.d[i + 1], tile.d[i + 2], tile.d[i + 3]]);
  }
  tileMeta[name] = { x: cx + PAD, y: cy + PAD, w: T, h: T, ...(spec.cutout ? { cutout: true } : {}), ...(spec.translucent ? { translucent: true } : {}) };
}
await png(atlas).png({ compressionLevel: 9 }).toFile(join(OUT, 'atlas.png'));
writeFileSync(join(OUT, 'atlas.json'), JSON.stringify({ size: atlasSize, tile: T, padding: PAD, tiles: tileMeta }, null, 1));

// ---------------------------------------------------------------- 2. item icons
const iNames = Object.keys(cfg.items), I = cfg.itemSize, iCols = 8, iRows = Math.ceil(iNames.length / iCols);
const sheet = canvas(iCols * I, iRows * I);
const iMeta = {};
for (let n = 0; n < iNames.length; n++) {
  const name = iNames[n], spec = cfg.items[name];
  const icon = spec.src ? await raw(spec.src, I) : upscale(genItem[name](), I / 16);
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
