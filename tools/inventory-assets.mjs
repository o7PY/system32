#!/usr/bin/env node
// Step 0 of the SpaceSaga asset pipeline (SPACESAGA_SPEC.md B3): walk assets/source/ultimate-space-kit/*/GLTF/*.gltf, parse every glTF JSON
// (no rendering, no dependencies) and write ASSET_MANIFEST.md with one row per model:
//   Folder | File | Animated? | Animation clip names | Triangles | Bounding box (w x h x d, metres, world space of the default scene) | Textures
//   node tools/inventory-assets.mjs [--src assets/source/ultimate-space-kit] [--out ASSET_MANIFEST.md] [--json tools/.inventory.json]
// Triangles: every mesh primitive of mode TRIANGLES (indices/3, else positions/3), counted once per node instance. Bounding box: the accessor
// min/max of every POSITION, transformed by the node hierarchy (corners of each primitive box); skinned meshes are measured in the bind pose.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = resolve(ROOT, arg('--src', 'assets/source/ultimate-space-kit'));
const OUT = resolve(ROOT, arg('--out', 'ASSET_MANIFEST.md'));
const JSON_OUT = arg('--json', null);

// ---- 4x4 column-major matrices
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
          (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
          (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

function analyse(gltf) {
  const acc = gltf.accessors ?? [];
  const nodes = gltf.nodes ?? [];
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  let tris = 0, meshInstances = 0, prims = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const skinned = (gltf.skins ?? []).length > 0;
  const visit = (i, parent) => {
    const n = nodes[i];
    const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale));
    if (n.mesh !== undefined) {
      meshInstances++;
      for (const p of gltf.meshes[n.mesh].primitives) {
        prims++;
        if ((p.mode ?? 4) === 4) tris += (p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count) / 3;
        const a = acc[p.attributes.POSITION];
        if (a.min && a.max) for (let c = 0; c < 8; c++) {
          const v = apply(m, [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]]);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
        }
      }
    }
    (n.children ?? []).forEach((c) => visit(c, m));
  };
  (scene?.nodes ?? []).forEach((i) => visit(i, I4()));
  const anims = (gltf.animations ?? []).map((a, i) => a.name ?? `anim_${i}`);
  const images = (gltf.images ?? []).map((im) => (im.uri && !im.uri.startsWith('data:') ? im.uri : `${im.name ?? 'image'}${im.mimeType ? ` (${im.mimeType.replace('image/', '')}, embedded)` : ''}`));
  return {
    animated: anims.length > 0, clips: anims, skinned, tris: Math.round(tris), meshInstances, prims,
    bbox: min[0] === Infinity ? null : [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    min, max, textures: images, materials: (gltf.materials ?? []).map((m) => m.name ?? ''), nodes: nodes.length, joints: (gltf.skins ?? []).reduce((s, k) => s + k.joints.length, 0),
  };
}

if (!existsSync(SRC)) { console.error(`source pack not found: ${SRC}\n(the raw pack is gitignored: put it in assets/source/ultimate-space-kit/)`); process.exit(1); }
const rows = [];
for (const folder of readdirSync(SRC).filter((d) => statSync(join(SRC, d)).isDirectory()).sort()) {
  const dir = join(SRC, folder, 'GLTF');
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.gltf')).sort()) {
    const gltf = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const bin = (gltf.buffers ?? []).reduce((s, b) => s + (b.byteLength ?? 0), 0);          // geometry + animation + embedded images
    rows.push({ folder, file, bytes: bin, ...analyse(gltf) });
  }
}
const f = (n, d = 2) => n.toFixed(d);
const bb = (r) => (r.bbox ? `${f(r.bbox[0])} x ${f(r.bbox[1])} x ${f(r.bbox[2])}` : '-');
const md = [
  '# ASSET_MANIFEST.md: Quaternius Ultimate Space Kit (CC0)', '',
  `Generated by \`tools/inventory-assets.mjs\` from \`assets/source/ultimate-space-kit/*/GLTF/*.gltf\` (${rows.length} models). Triangles are per model instance; the bounding box is in metres (x = width, y = height, z = depth) in the default scene's world space; ` +
  'skinned models are measured in the bind pose; "bin" is the byte length of the model\'s glTF buffers (geometry, animation, embedded images). Textures are the image files the .gltf references (all models of the kit share the same atlas unless the table says otherwise).', '',
  '## Summary', '',
  `| Folder | Models | Animated | Triangles (sum) | Bin size (sum) |`, '|---|---|---|---|---|',
  ...[...new Set(rows.map((r) => r.folder))].map((d) => { const rs = rows.filter((r) => r.folder === d); return `| ${d} | ${rs.length} | ${rs.filter((r) => r.animated).length} | ${rs.reduce((s, r) => s + r.tris, 0).toLocaleString('en-US')} | ${(rs.reduce((s, r) => s + r.bytes, 0) / 1e6).toFixed(2)} MB |`; }),
  '', `Texture files referenced: ${[...new Set(rows.flatMap((r) => r.textures))].map((t) => `\`${t}\``).join(', ') || '(none)'}.`,
  `Animation clip names in the whole kit: ${[...new Set(rows.flatMap((r) => r.clips))].sort().map((c) => `\`${c}\``).join(', ') || '(none)'}.`, '',
  '## Models', '',
  '| Folder | File | Animated? | Animation clip names | Triangles | Bounding box (w x h x d) | Textures |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.folder} | ${r.file} | ${r.animated ? (r.skinned ? 'yes (skinned)' : 'yes') : 'no'} | ${r.clips.length ? r.clips.join(', ') : ''} | ${r.tris.toLocaleString('en-US')} | ${bb(r)} | ${r.textures.map((t) => basename(t)).join(', ') || '-'} |`),
  '',
];
writeFileSync(OUT, md.join('\n'));
if (JSON_OUT) writeFileSync(resolve(ROOT, JSON_OUT), JSON.stringify(rows, null, 1));
console.log(`wrote ${OUT} (${rows.length} models, ${rows.filter((r) => r.animated).length} animated)`);
