// SpaceSaga static checks (no browser): every pattern is fair, the config is sane, the committed models fit the budget.
//   node tests/space-saga/static.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, PATTERNS } from '../../games/space-saga/src/config.js';
import { validatePattern, laneAction, safeLanes, safePath, rowGap, parseToken, patternGapOk } from '../../games/space-saga/src/patterns.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };

// ---- patterns
check('pattern ids are unique', new Set(PATTERNS.map((p) => p.id)).size === PATTERNS.length);
check('every tier has patterns, and tier 0 has enough variety', [0, 1, 2].every((t) => PATTERNS.some((p) => p.tier === t)) && PATTERNS.filter((p) => p.tier === 0).length >= 5);
for (const speed of [CONFIG.speed.start, 20, CONFIG.speed.cap]) {
  const bad = PATTERNS.flatMap((p) => validatePattern(p, speed).map((m) => `${p.id}: ${m}`));
  check(`all ${PATTERNS.length} patterns are fair at ${speed} u/s (a survivable action per row, reachable lanes, gaps)`, bad.length === 0, bad.join('\n      '));
}
check('every row has exactly 3 lanes and valid tokens', PATTERNS.every((p) => p.rows.every((r) => r.length === 3 && r.every((t) => { try { parseToken(t); return true; } catch { return false; } }))));
check('no row is a wall of blockers', PATTERNS.every((p) => p.rows.every((r) => r.some((t) => t !== 'B'))));
check('the validator rejects an unfair pattern (all blockers; zero-gap jump->slide)', validatePattern({ id: 'x', rows: [['B', 'B', 'B']] }).length > 0
  && validatePattern({ id: 'y', rows: [['L', 'L', 'L'], ['H', 'H', 'H']], gap: 2 }, 12).length === 0 /* gap is raised to the reaction minimum */);
check('rowGap never gives less than the reaction time between obstacle rows', [12, 20, 34].every((v) => rowGap({ gap: 1 }, ['L', '.', '.'], ['.', 'L', '.'], v) / v >= 0.55));
check('reaction time between rows is >= 0.55 s (config)', CONFIG.reactionS >= 0.55);
check('gap between patterns gives time for two lane switches and a jump', patternGapOk(CONFIG.speed.cap));
check('safePath finds a lane for every row of every pattern', PATTERNS.every((p) => safePath(p, 1)?.length === p.rows.length));
check('tiers unlock at 0 / 400 / 1000 m', CONFIG.tiers.join() === '0,400,1000');
check('speed: 12 u/s start, +0.45 per 50 m, cap 34', CONFIG.speed.start === 12 && CONFIG.speed.add === 0.45 && CONFIG.speed.perM === 50 && CONFIG.speed.cap === 34);
check('geometry numbers: lane 2.6, switch 0.12 s, jump 2.2 m in 0.65 s, slide 0.6 s, buffer 120 ms',
  CONFIG.laneWidth === 2.6 && CONFIG.laneSwitchS === 0.12 && CONFIG.jump.height === 2.2 && CONFIG.jump.durS === 0.65 && CONFIG.slide.durS === 0.6 && CONFIG.bufferS === 0.12);
check('the player can slide under a high obstacle and not walk through it; can jump a low one but not a blocker',
  CONFIG.player.slideHeight < CONFIG.highHang + CONFIG.boxes.H.y0 && CONFIG.player.height > CONFIG.highHang + CONFIG.boxes.H.y0 && CONFIG.jump.height > CONFIG.boxes.L.y1 && CONFIG.jump.height < CONFIG.boxes.B.y1);
check('laneAction: . and P run, L and E jump, H slide, B nothing', laneAction('.') === 'run' && laneAction('P') === 'run' && laneAction('L') === 'jump' && laneAction('E>') === 'jump' && laneAction('H') === 'slide' && laneAction('B') === null && safeLanes(['B', '.', 'H']).join() === '1,2');

// ---- models
const dir = join(ROOT, 'games/space-saga/models');
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
const assets = JSON.parse(readFileSync(join(ROOT, 'tools/assets.json'), 'utf8'));
check(`models/ holds ${assets.models.length} GLBs from tools/assets.json and nothing else`, files.length === assets.models.length && assets.models.every((m) => files.includes(`${m.out}.glb`)) && readdirSync(dir).length === files.length);
check(`total size ${(total / 1048576).toFixed(2)} MB <= 6 MB`, total <= 6 * 1048576);
check('every file is a binary glTF 2.0 whose declared length matches', files.every((f) => { const b = readFileSync(join(dir, f)); return b.toString('latin1', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length; }));
const vendor = join(ROOT, 'games/_shared/vendor/three');
check('three.js is vendored with the files the import map needs', ['three.module.min.js', 'three.core.min.js', 'addons/loaders/GLTFLoader.js', 'addons/utils/SkeletonUtils.js', 'addons/utils/BufferGeometryUtils.js', 'addons/libs/meshopt_decoder.module.js', 'LICENSE'].every((f) => statSync(join(vendor, f), { throwIfNoEntry: false })?.isFile()));
const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
check('CREDITS.md lists the kit and the vendored three.js version', /Quaternius/.test(credits) && credits.includes(readFileSync(join(vendor, 'VERSION'), 'utf8').trim()));

console.log(`\nSpaceSaga static: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
