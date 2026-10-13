#!/usr/bin/env node
// Step 1 of the SpaceSaga asset pipeline (SPACESAGA_SPEC.md B3): source glTF (assets/source/ultimate-space-kit, NOT in git) -> one optimised GLB
// per model in games/space-saga/models/ (committed). Dev-only. Setup once: `npm install --prefix tools`; run: `node tools/build-assets.mjs`.
//
// Per model: bake the role's scale/rotation into a root node and put the origin at bottom centre, weld/dedupe/prune, resample animations,
// resize textures to <= 1024 px as WebP, meshopt-compress. Animations are counted before and after: the build FAILS if any clip is lost.
// The total must stay within the budget in assets.json.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/source/ultimate-space-kit');
const OUT = join(ROOT, 'games/space-saga/models');
const cfg = JSON.parse(readFileSync(join(ROOT, 'tools/assets.json'), 'utf8'));

let lib;
try {
  lib = {
    core: await import('@gltf-transform/core'),
    ext: await import('@gltf-transform/extensions'),
    fn: await import('@gltf-transform/functions'),
    meshopt: await import('meshoptimizer'),
    sharp: (await import('sharp')).default,
  };
} catch (e) {
  console.error(`Dev dependencies missing (${e.code ?? e.message}). Run once: npm install --prefix tools`);
  process.exit(1);
}
const { NodeIO, getBounds, Logger } = lib.core;
const { ALL_EXTENSIONS } = lib.ext;
const { dedup, weld, prune, resample, textureCompress, meshopt } = lib.fn;

if (!existsSync(SRC)) {
  console.error(`Raw pack not found at ${SRC}.\nIt is gitignored and not needed to RUN the game (the processed GLBs are committed); it is only needed to rebuild them.`);
  process.exit(1);
}

await lib.meshopt.MeshoptEncoder.ready;
await lib.meshopt.MeshoptDecoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': lib.meshopt.MeshoptEncoder,
  'meshopt.decoder': lib.meshopt.MeshoptDecoder,
});

const DEG = Math.PI / 180;

/** Wrap the scene in one root node carrying the role's scale + rotation, feet at the origin, centred on x/z. Returns the final size. */
function normalize(doc, { fit, rotY = 0 }) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  let size = b.max.map((v, i) => v - b.min[i]);
  const quarter = Math.abs(Math.round(rotY / 90)) % 2 === 1;
  if (quarter) size = [size[2], size[1], size[0]];                      // a quarter turn swaps the x and z extents
  const limits = { w: size[0], h: size[1], d: size[2] };
  let s = Infinity;
  for (const [k, v] of Object.entries(fit)) {
    if (!(k in limits)) throw new Error(`unknown fit key "${k}"`);
    s = Math.min(s, v / limits[k]);
  }
  if (!Number.isFinite(s) || s <= 0) throw new Error('no usable fit');
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
  const a = rotY * DEG;                                                 // rotate the centre about Y the same way the node will
  const cx = c[0] * Math.cos(a) + c[1] * Math.sin(a);
  const cz = -c[0] * Math.sin(a) + c[1] * Math.cos(a);
  const root = doc.createNode('Root')
    .setScale([s, s, s])
    .setRotation([0, Math.sin(a / 2), 0, Math.cos(a / 2)])
    .setTranslation([-cx * s, -b.min[1] * s, -cz * s]);
  for (const child of scene.listChildren()) { scene.removeChild(child); root.addChild(child); }
  scene.addChild(root);
  return { scale: s, size: size.map((v) => v * s) };
}

const fmtKB = (n) => `${(n / 1024).toFixed(1)} KB`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const rows = [];
let total = 0;
let failed = 0;
for (const m of cfg.models) {
  try {
    const doc = await io.read(join(SRC, `${m.src}.gltf`));
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    const clipsBefore = doc.getRoot().listAnimations().map((a) => a.getName()).sort();
    const { scale, size } = normalize(doc, m);

    await doc.transform(
      dedup(),
      weld(),
      prune(),
      resample(),
      textureCompress({ encoder: lib.sharp, targetFormat: 'webp', resize: [cfg.textureMax, cfg.textureMax], quality: 90 }),
      meshopt({ encoder: lib.meshopt.MeshoptEncoder, level: 'high' }),
    );

    const file = join(OUT, `${m.out}.glb`);
    const bytes = await io.writeBinary(doc);
    writeFileSync(file, bytes);

    // verify by reading the written file back: the clips must all still be there
    const back = await io.readBinary(bytes);
    const clipsAfter = back.getRoot().listAnimations().map((a) => a.getName()).sort();
    if (clipsBefore.length !== clipsAfter.length || clipsBefore.join('|') !== clipsAfter.join('|')) {
      throw new Error(`animations lost: ${clipsBefore.length} before, ${clipsAfter.length} after`);
    }
    total += bytes.length;
    rows.push({ out: `${m.out}.glb`, role: m.role, size: bytes.length, clips: clipsAfter.length, dims: size.map((v) => v.toFixed(2)).join(' x '), scale: scale.toFixed(3) });
  } catch (e) {
    failed++;
    console.error(`FAIL ${m.out}: ${e.message}`);
  }
}

const pad = (v, n) => String(v).padEnd(n);
console.log(`${pad('file', 24)}${pad('role', 10)}${pad('size', 11)}${pad('clips', 6)}${pad('scale', 8)}final size (w x h x d, m)`);
for (const r of rows) console.log(`${pad(r.out, 24)}${pad(r.role, 10)}${pad(fmtKB(r.size), 11)}${pad(r.clips, 6)}${pad(r.scale, 8)}${r.dims}`);
console.log(`\n${rows.length} models, total ${(total / 1048576).toFixed(2)} MB (${total} bytes), budget ${(cfg.budgetBytes / 1048576).toFixed(2)} MB`);
if (failed) { console.error(`${failed} model(s) failed`); process.exit(1); }
if (total > cfg.budgetBytes) { console.error('OVER BUDGET'); process.exit(1); }
const leftovers = readdirSync(OUT).filter((f) => !cfg.models.some((m) => `${m.out}.glb` === f));
if (leftovers.length) { console.error(`unexpected files in models/: ${leftovers.join(', ')}`); process.exit(1); }
