#!/usr/bin/env node
// Vendors a pinned three.js release into games/_shared/vendor/three/ (SPACESAGA_SPEC.md B1). Dev-only; the output is committed, nothing is fetched at runtime.
//   node tools/vendor-three.mjs [version]        (needs: npm install --prefix tools, and network access to the npm registry)
// The newest three.js ships NO three.module.min.js, only build/three.module.js + build/three.core.js (the first imports the second). We minify
// both once with esbuild and point the import at the .min name. Addons are copied as shipped; they import the bare specifier 'three', which the
// game's import map resolves.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv[2] ?? '0.186.1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'games/_shared/vendor/three');
const { transform } = await import('esbuild').catch(() => { console.error('Run once: npm install --prefix tools'); process.exit(1); });

const tmp = mkdtempSync(join(tmpdir(), 'three-'));
try {
  execFileSync('npm', ['pack', `three@${VERSION}`, '--silent'], { cwd: tmp, stdio: ['ignore', 'pipe', 'inherit'] });
  execFileSync('tar', ['-xzf', `three-${VERSION}.tgz`], { cwd: tmp });
  const pkg = join(tmp, 'package');
  if (JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version !== VERSION) throw new Error('version mismatch');

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(join(DEST, 'addons/loaders'), { recursive: true });
  mkdirSync(join(DEST, 'addons/utils'), { recursive: true });
  mkdirSync(join(DEST, 'addons/libs'), { recursive: true });

  const min = async (from, to, fix = (s) => s) => {
    const { code } = await transform(readFileSync(join(pkg, from), 'utf8'), { minify: true, format: 'esm', legalComments: 'none', target: 'es2022' });
    writeFileSync(join(DEST, to), `/* three.js v${VERSION} (MIT), minified from build/${from.split('/').pop()} by tools/vendor-three.mjs */\n${fix(code)}`);
  };
  await min('build/three.core.js', 'three.core.min.js');
  await min('build/three.module.js', 'three.module.min.js', (s) => s.replaceAll('./three.core.js', './three.core.min.js'));

  const jsm = join(pkg, 'examples/jsm');
  for (const f of ['loaders/GLTFLoader.js', 'utils/SkeletonUtils.js', 'utils/BufferGeometryUtils.js', 'libs/meshopt_decoder.module.js']) {
    copyFileSync(join(jsm, f), join(DEST, 'addons', f));
  }
  copyFileSync(join(pkg, 'LICENSE'), join(DEST, 'LICENSE'));
  writeFileSync(join(DEST, 'VERSION'), `${VERSION}\n`);
  for (const f of ['three.module.min.js', 'three.core.min.js']) console.log(`${f}  ${(statSync(join(DEST, f)).size / 1024).toFixed(0)} KB`);
  console.log(`three.js v${VERSION} vendored to games/_shared/vendor/three/`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
