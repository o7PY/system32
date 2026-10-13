// Dev tool (not a test): screenshots of Strata scenes for looking at them.  SHOT_DIR=<out-dir> node tests/strata/shot.mjs
import { suite, sleep } from '../lib/cdp.mjs';
const out = process.env.SHOT_DIR ?? '/tmp';
const s = suite('Strata screenshots', { width: 960, height: 540 });
const S = (p, expr) => p.eval(`(() => { const S = __STRATA; return (${expr}); })()`);
s.test('night with torches; day terrain', async (p) => {
  await p.goto('/games/strata/index.html?debug=1&seed=77');
  await p.waitFor(`window.__STRATA?.state().phase === 'title'`, { timeout: 90000 });
  await p.eval(`__STRATA.newWorld({ seed: 77 })`);
  await p.waitFor(`__STRATA.state().phase === 'playing'`, { timeout: 90000 });
  await p.eval(`__STRATA.settle(4)`);
  await p.eval(`__STRATA.setTime(0.2)`); await sleep(1500);
  await p.screenshot(`${out}/day.png`);
  // night: three torches around, one cave-ish hole
  await p.eval(`__STRATA.setTime(0.75)`);
  const pos = await S(p, `({ x: Math.floor(S.player().pos.x), y: Math.floor(S.player().pos.y), z: Math.floor(S.player().pos.z) })`);
  await p.eval(`(() => { const S = __STRATA; for (const [dx, dz] of [[2, -3], [-3, -5], [4, -7]]) { const g = (() => { let y = ${pos.y} + 6; while (y > 0 && S.getBlock(${pos.x} + dx, y, ${pos.z} + dz) === 0) y--; return y + 1; })(); S.setBlock(${pos.x} + dx, g, ${pos.z} + dz, 'torch'); } S.face(0, -0.15); })()`);
  await sleep(3500);
  await p.screenshot(`${out}/night.png`);
  await p.eval(`__STRATA.setTime(0.2)`);
  await p.eval(`(() => { const S = __STRATA; S.giveKit('iron'); S.setHealth(7); S.setHunger(13); S.G.fakeLock = true; S.give('torch', 12); S.give('cobalt_ingot', 3); S.selectSlot(0); })()`);
  await sleep(1200);
  await p.screenshot(`${out}/hud.png`);
  await p.eval(`(() => { const S = __STRATA, pl = S.player(); S.setHealth(20); S.setHunger(20); S.killAll(); const x = pl.pos.x, z = pl.pos.z, y = (() => { let yy = pl.pos.y + 4; while (yy > 0 && S.getBlock(Math.floor(x), Math.floor(yy), Math.floor(z - 4)) === 0) yy--; return yy + 1; })(); S.tp(x, pl.pos.y, z); for (const [t, dx, dz] of [['pig', -2, -4], ['cow', 1, -5], ['sheep', 3, -4], ['chicken', 0, -3]]) { let yy = pl.pos.y + 6; while (yy > 0 && S.getBlock(Math.floor(x + dx), Math.floor(yy), Math.floor(z + dz)) === 0) yy--; S.spawn(t, x + dx, yy + 1, z + dz); } S.face(0, -0.12); })()`);
  await sleep(1800);
  await p.screenshot(`${out}/mobs.png`);
});
s.run();
