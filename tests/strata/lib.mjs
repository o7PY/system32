// Helpers for the Strata Node tests: the same worker.js the browser runs, initialised from the real block table and atlas.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from '../../games/strata/src/config.js';
import { BLOCKS, B, workerTable } from '../../games/strata/src/blocks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const atlas = JSON.parse(readFileSync(join(ROOT, 'games/strata/assets/atlas.json'), 'utf8'));
const require = createRequire(import.meta.url);
export const WORKER_FILE = join(ROOT, 'games/strata/src/worker.js');

/** A fresh, isolated copy of worker.js (it keeps its state in a closure, so each call is an independent generator). */
export function makeGen(opts = {}) {
  delete require.cache[WORKER_FILE];
  const gen = require(WORKER_FILE);
  const t = workerTable(atlas);
  gen.init({ seed: 12345, flat: false, worldSize: CONFIG.worldSize, height: CONFIG.height, sea: CONFIG.seaLevel, snow: CONFIG.snowLine, gen: CONFIG.gen, ids: t.ids, blocks: t.blocks, ...opts });
  return gen;
}
export { CONFIG, BLOCKS, B };
export const idx = (x, y, z) => (y << 8) | (z << 4) | x;
/** FNV-1a hash of a byte array. */
export const hashBytes = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };

/** Pad a chunk with air all around (or with neighbours: pass a function (cx, cz) -> data | null for chunk offsets -1..1). */
export function pad(center, neighbours) {
  const out = new Uint8Array(18 * 128 * 18);
  for (let y = 0; y < 128; y++) for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
    const dx = x < 0 ? -1 : x > 15 ? 1 : 0, dz = z < 0 ? -1 : z > 15 ? 1 : 0;
    const src = dx === 0 && dz === 0 ? center : neighbours?.(dx, dz);
    if (src) out[(y * 18 + z + 1) * 18 + x + 1] = src[(y << 8) | ((z - dz * 16) << 4) | (x - dx * 16)];
  }
  return out;
}
