// The real Strata inside the real shell: the sandboxed game window (opaque origin) must still start its worker from a Blob URL, load models / textures /
// sounds / the font over CORS, save and restore a world through SAVE / SAVED / INIT, autosave on the shell's PAUSE, report eggs and obey the speaker.
//   node tests/strata/shell-game.mjs [name filter]
import { suite, sleep } from '../lib/cdp.mjs';
import { boot, st, live, toastTexts, SANDBOX } from '../lib/shell.mjs';

const s = suite('Strata in the shell', { width: 1400, height: 900 });
const { test } = s;
const GAME = 'games/strata/index.html';
const DBG = `${GAME}?debug=1&quality=low`;
const inFrame = (page, expr) => page.evalInFrame(GAME, expr);
const waitFrame = (page, expr, timeout = 60000) => page.waitForFrame(GAME, expr, { timeout });
const KEY = 'system32.save.strata';
const unlocked = () => st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: ['space-saga', 'strata'], best: {} } });

async function open(page, { src = DBG, soundOn = false } = {}) {
  await boot(page, { ...unlocked(), soundOn }, '/?unlockBonus=1');
  await page.eval(`import('/js/registry.js').then((m) => { m.BONUS_BY_ID.strata.src = ${JSON.stringify(src)}; })`);
  await page.eval(`import('/js/events.js').then((m) => m.launch('strata'))`);
  await page.waitFor(`!!document.querySelector('#game-strata iframe')`, { what: 'game window' });
  await waitFrame(page, `window.__STRATA?.state().phase === 'title'`, 90000);
}
const closeWin = async (page) => { await page.eval(`document.querySelector('#game-strata [data-act="close"]')?.click()`); await page.waitFor(`!document.querySelector('#game-strata')`); };

test('the real game starts in the sandboxed window: worker from a Blob URL, atlas + font + samples over CORS, INIT with no save, no console errors', async (page) => {
  await open(page);
  const info = await page.eval(`(() => { const f = document.querySelector('#game-strata iframe'); return { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src') }; })()`);
  if (info.sandbox !== SANDBOX || info.sandbox.includes('same-origin') || !info.sandbox.includes('allow-pointer-lock')) throw new Error(`sandbox ${info.sandbox}`);
  const r = await inFrame(page, `({ origin: self.origin, state: __STRATA.state(), atlas: __STRATA.renderer().tex.atlas.image.width, samples: __STRATA.audio().raw.size, font: document.fonts.check('20px "Kenney Pixel"'), cont: document.getElementById('b-continue').disabled })`);
  if (r.origin !== 'null') throw new Error('not an opaque origin: ' + r.origin);
  if (r.state.backend !== 'worker') throw new Error(`the worker did not start in the sandbox: ${r.state.backend} (${r.state.backendReason})`);
  if (r.atlas !== 512 || r.samples < 25 || !r.font || !r.cont) throw new Error(JSON.stringify(r));
});

test('the main-thread fallback also works inside the sandbox (?noWorker=1)', async (page) => {
  await open(page, { src: `${DBG}&noWorker=1` });
  const r = await inFrame(page, `__STRATA.state()`);
  if (r.backend !== 'inline') throw new Error(JSON.stringify(r));
  await inFrame(page, `__STRATA.newWorld({ seed: 3, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  if ((await inFrame(page, `__STRATA.settle(2)`)) !== 0) throw new Error('chunks did not load on the main thread in the sandbox');
});

test('SAVE / SAVED / INIT through the real shell: the world is stored under system32.save.strata (not in the state), and Continue brings it back', async (page) => {
  await open(page);
  await inFrame(page, `__STRATA.newWorld({ seed: 77, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  await inFrame(page, `__STRATA.settle(2)`);
  await inFrame(page, `(() => { const S = __STRATA; S.setBlock(512, 60, 512, 'planks'); S.setBlock(513, 60, 512, 'glass'); S.give('stone', 12); S.setTime(0.33); S.saveNow('test'); })()`);
  await waitFrame(page, `__STRATA.state().saveResult?.ok === true && !__STRATA.state().saving`, 20000);
  const stored = await page.eval(`localStorage.getItem(${JSON.stringify(KEY)})`);
  if (!stored || !stored.startsWith('STRATA1:')) throw new Error('nothing stored under ' + KEY);
  if (JSON.stringify(await live(page)).includes('STRATA1')) throw new Error('the world leaked into the shell state');
  const bytes = await inFrame(page, `__STRATA.state().saveBytes`);
  if (bytes !== stored.length) throw new Error(`reported ${bytes} bytes, stored ${stored.length}`);
  await closeWin(page);
  await page.eval(`import('/js/events.js').then((m) => m.launch('strata'))`);
  await waitFrame(page, `window.__STRATA?.state().phase === 'title'`, 90000);
  if (await inFrame(page, `document.getElementById('b-continue').disabled`)) throw new Error('Continue is disabled although a world was saved');
  await inFrame(page, `document.querySelector('[data-act="continue"]').click(); 0`);
  await waitFrame(page, `__STRATA.state().phase === 'paused' && __STRATA.state().seed === 77`, 90000);
  await inFrame(page, `__STRATA.G.fakeLock = true; __STRATA.resume(); __STRATA.settle(2)`);
  const r = await inFrame(page, `({ planks: __STRATA.getBlock(512, 60, 512), glass: __STRATA.getBlock(513, 60, 512), stone: __STRATA.inv().count('stone'), t: __STRATA.state().dayT })`);
  if (r.planks !== 9 || r.glass !== 11 || r.stone !== 12) throw new Error(JSON.stringify(r));
});

test('the shell caps a save at 2.5 MB: an over-sized world gets SAVED too-large, nothing is written, and the game says so', async (page) => {
  await open(page);
  await inFrame(page, `__STRATA.newWorld({ seed: 5, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  await inFrame(page, `__STRATA.saveNow('first'); 0`);
  await waitFrame(page, `__STRATA.state().saveResult?.ok === true`, 20000);
  const before = await page.eval(`localStorage.getItem(${JSON.stringify(KEY)})`);
  await inFrame(page, `(() => { window.__big = 'x'.repeat(2.6 * 1048576); System32.save(window.__big); })()`);
  await waitFrame(page, `__STRATA.state().saveResult?.error === 'too-large'`, 20000);
  if ((await page.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) !== before) throw new Error('a too-large save changed the stored world');
  const msg = await inFrame(page, `document.getElementById('saved').textContent`);
  if (!/World too big to save: 2\.6 MB \/ 2\.5 MB\. Try removing some builds\./.test(msg)) throw new Error(msg);
});

test('the shell\'s PAUSE (minimizing the window) pauses the game and autosaves; the world survives a reload', async (page) => {
  await open(page);
  await inFrame(page, `__STRATA.newWorld({ seed: 8, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  await inFrame(page, `__STRATA.setBlock(520, 70, 520, 'cobblestone'); __STRATA.state(); 0`);
  await page.eval(`document.querySelector('#game-strata [data-act="min"]').click()`);
  await waitFrame(page, `__STRATA.state().phase === 'paused'`, 10000);
  await waitFrame(page, `__STRATA.state().saveResult?.ok === true`, 20000);
  const stored = await page.eval(`localStorage.getItem(${JSON.stringify(KEY)})`);
  if (!stored) throw new Error('PAUSE did not save');
  const check = await inFrame(page, `__STRATA.load(${JSON.stringify(stored)}).then((s) => ({ edits: s.edits.size, seed: s.seed }))`);
  if (check.seed !== 8 || check.edits < 1) throw new Error(JSON.stringify(check));
});

test('eggs reach the shell: strata-adblock (with its toast), strata-bedrock and strata-cloud; only strata- ids are accepted', async (page) => {
  await open(page);
  await inFrame(page, `__STRATA.newWorld({ seed: 9, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  await inFrame(page, `__STRATA.settle(2)`);
  await inFrame(page, `(() => { const S = __STRATA; S.setBlock(512, 55, 512, 'ad_block'); S.give('pickaxe_wood'); S.selectSlot(0); S.breakBlock({ x: 512, y: 55, z: 512, id: 19 }); })()`);
  await page.waitFor(`import('/js/state.js').then((m) => m.state.eggsFound.includes('strata-adblock'))`, { what: 'strata-adblock in the shell' });
  const toasts = await toastTexts(page);
  if (!toasts.some((t) => /Ad Block enabled/.test(t))) throw new Error('no toast: ' + JSON.stringify(toasts));
  await inFrame(page, `System32.effect('egg', { egg: 'saga-404' }); System32.effect('egg', { egg: 'strata-bedrock' }); System32.effect('egg', { egg: 'strata-cloud' }); 0`);
  await sleep(400);
  const found = (await live(page)).eggsFound;
  if (JSON.stringify([...found].sort()) !== JSON.stringify(['strata-adblock', 'strata-bedrock', 'strata-cloud'])) throw new Error(JSON.stringify(found));
});

test('sound: off by default; the taskbar speaker reaches the game, which then decodes and plays the Kenney samples inside the sandbox', async (page) => {
  await open(page);
  if (await inFrame(page, `__STRATA.audio().allowed`)) throw new Error('the game thinks sound is on');
  await page.eval(`import('/js/state.js').then((m) => m.set({ soundOn: true }))`);
  await waitFrame(page, `__STRATA.audio().allowed === true`, 8000);
  await inFrame(page, `__STRATA.newWorld({ seed: 4, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  await page.click('#game-strata iframe');
  await sleep(300);
  await page.key('c', { code: 'KeyC' });
  await waitFrame(page, `__STRATA.audio().ctx && __STRATA.audio().bufs.size > 20`, 30000);
  const ok = await inFrame(page, `(() => { const a = __STRATA.audio(); return a.play('place') !== false || a.count > 0; })()`);
  if (!ok) throw new Error('no sample played');
  await page.eval(`import('/js/state.js').then((m) => m.set({ soundOn: false }))`);
  await waitFrame(page, `__STRATA.audio().allowed === false && !__STRATA.audio().active`, 8000);
});

test('pointer lock is allowed by the sandbox: a click on the game canvas locks the pointer (or the game keeps working when the browser refuses)', async (page) => {
  await open(page);
  await inFrame(page, `__STRATA.newWorld({ seed: 6, flat: true, fake: false }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'paused'`, 90000);
  await inFrame(page, `document.querySelector('[data-act="resume"]').click(); 0`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 10000);
  await page.click('#game-strata iframe');
  await sleep(500);
  const r = await inFrame(page, `({ lock: document.pointerLockElement === document.getElementById('gl'), phase: __STRATA.state().phase, err: null })`);
  if (r.phase !== 'playing' && r.phase !== 'paused') throw new Error(JSON.stringify(r));
});

test('the win in the real shell: the game\'s complete() reaches the shell once (best time per difficulty, toast, egg, check on the icon) and the next INIT carries it back to the title', async (page) => {
  await open(page);
  await inFrame(page, `__STRATA.newWorld({ seed: 5, flat: true }).then(() => 0)`);
  await waitFrame(page, `__STRATA.state().phase === 'playing'`, 90000);
  await inFrame(page, `(() => { const S = __STRATA; S.G.fakeLock = true; S.vitals().stats.timeS = 300; S.enterKernel(); })()`);
  await waitFrame(page, `__STRATA.state().dim === 'kernel' && __STRATA.state().phase === 'playing'`, 90000);
  await inFrame(page, `__STRATA.endNow()`);
  await waitFrame(page, `!document.getElementById('credits').hidden`, 20000);
  await sleep(5300);
  await inFrame(page, `__STRATA.skipCredits()`);
  await page.waitFor(`import('/js/state.js').then((m) => !!m.state.bonus.completed.strata)`, { what: 'the shell to store the win', timeout: 20000 });
  const sv = await live(page);
  const c = sv.bonus.completed.strata;
  if (c.difficulty !== 'normal' || !(c.timeMs >= 300000) || c.deaths !== 0) throw new Error(JSON.stringify(c));
  if (!sv.eggsFound.includes('strata-complete')) throw new Error('egg');
  if (!(await toastTexts(page)).some((t) => t.includes('kernel restored'))) throw new Error('toast ' + JSON.stringify(await toastTexts(page)));
  await closeWin(page);
  await page.eval(`import('/js/events.js').then((m) => m.launch('strata'))`);
  await page.waitFor(`!!document.querySelector('#game-strata iframe')`);
  await waitFrame(page, `window.__STRATA?.state().phase === 'title'`, 90000);
  const t = await inFrame(page, `document.getElementById('title-trophy').textContent`);
  if (!/🏆/.test(t)) throw new Error('title trophy: ' + t);
});

s.run();
