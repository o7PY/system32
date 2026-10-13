// SpaceSaga inside the real shell: sandboxed game window, modules + import map across the opaque origin, INIT/best, RUN_OVER, pause/focus, eggs.
//   node tests/space-saga/shell.mjs [name filter]
import { suite, sleep } from '../lib/cdp.mjs';
import { boot, st, live, toastTexts, SANDBOX } from '../lib/shell.mjs';

const s = suite('SpaceSaga in the shell', { width: 1400, height: 900 });
const { test } = s;
const GAME = 'games/space-saga/index.html';
const inFrame = (page, expr) => page.evalInFrame(GAME, expr);
const waitFrame = (page, expr, timeout = 30000) => page.waitForFrame(GAME, expr, { timeout });
const ds = (page, key) => inFrame(page, `document.documentElement.dataset.${key} ?? null`);

/** Open the game window (the registry entry may be pointed at a debug URL first). */
async function open(page, { debug = false, saved = st({ repaired: {}, endingSeen: false }) } = {}) {
  await boot(page, saved, '/?unlockBonus=1');
  if (debug) await page.eval(`import('/js/registry.js').then((m) => { m.BONUS_BY_ID['space-saga'].src = ${JSON.stringify(`${GAME}?debug=1&quality=low&seed=1`)}; })`);
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await page.waitFor(`!!document.querySelector('#game-space-saga iframe')`, { what: 'game window' });
  await waitFrame(page, `document.documentElement.dataset.phase === 'title'`, 60000);
}

test('the real game loads in the sandboxed game window (modules, import map, fetch of models across the opaque origin) with no errors', async (page) => {
  await open(page);
  const info = await page.eval(`(() => { const f = document.querySelector('#game-space-saga iframe'); return { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src') }; })()`);
  if (info.sandbox !== SANDBOX || info.sandbox.includes('same-origin')) throw new Error(`sandbox ${info.sandbox}`);
  if (info.src !== GAME) throw new Error(`src ${info.src}`);
  const f = await inFrame(page, `({ origin: self.origin, map: !!document.querySelector('script[type=importmap]'), title: !document.getElementById('s-title').hidden, canvas: document.getElementById('gl').width > 0, sdk: typeof System32 })`);
  if (f.origin !== 'null' || !f.map || !f.title || !f.canvas || f.sdk !== 'object') throw new Error(JSON.stringify(f));
  if ((await ds(page, 'inits')) !== '1') throw new Error('INIT was not received exactly once: ' + (await ds(page, 'inits')));
  await page.eval(`document.querySelector('#game-space-saga [data-act="close"]').click()`);
});

test('a run: Enter in the focused game starts it, the crash sends exactly one RUN_OVER, the shell keeps the best and toasts it; the next INIT returns it', async (page) => {
  await open(page);
  await page.eval(`window.__runs = []; import('/js/events.js').then((m) => m.bus.on('bonus:run', (r) => __runs.push(r)))`);
  await sleep(200);
  await page.click('#game-space-saga iframe');
  await sleep(250);
  await page.key('Enter');
  await waitFrame(page, `document.documentElement.dataset.phase === 'running'`, 10000);
  await waitFrame(page, `document.documentElement.dataset.phase === 'dead'`, 90000);                // nobody steers: the first obstacle ends the run
  await sleep(600);
  const runs = await page.eval(`__runs`);
  if (runs.length !== 1) throw new Error(`the shell saw ${runs.length} runs`);
  const sv = await live(page);
  const best = sv.bonus.best['space-saga'];
  if (!(best > 0) || best !== Math.floor(runs[0].score)) throw new Error(`stored best ${best} vs run ${JSON.stringify(runs[0])}`);
  const toasts = await toastTexts(page);
  if (!toasts.some((t) => /^SpaceSaga: new best — [\d,]+$/.test(t))) throw new Error(`no new-best toast in ${JSON.stringify(toasts)}`);
  if ((await ds(page, 'runs')) !== '1') throw new Error('the game counted ' + (await ds(page, 'runs')));
  // reopen: the best comes back in INIT and shows on the title screen
  await page.eval(`document.querySelector('#game-space-saga [data-act="close"]').click()`);
  await page.waitFor(`!document.querySelector('#game-space-saga')`);
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await waitFrame(page, `document.documentElement.dataset.phase === 'title' && document.documentElement.dataset.inits === '1'`, 60000);
  if ((await ds(page, 'best')) !== String(best)) throw new Error(`INIT best ${await ds(page, 'best')} vs ${best}`);
  const tb = await inFrame(page, `document.getElementById('title-best').textContent`);
  if (tb !== `Best: ${best.toLocaleString('en-US')}`) throw new Error(`title: ${tb}`);
});

test('pause: minimize pauses the game exactly, restore resumes; leaving the window shows "Click to continue", a click resumes', async (page) => {
  await open(page, { debug: true });
  await page.click('#game-space-saga iframe');
  await sleep(250);
  await inFrame(page, `__SPACESAGA.start(); 1`);
  await waitFrame(page, `__SPACESAGA.G.runTime > 0.3`, 20000);
  await page.eval(`document.querySelector('#game-space-saga [data-act="min"]').click()`);
  await waitFrame(page, `document.documentElement.dataset.paused.includes('shell')`, 5000);
  const a = await inFrame(page, `__SPACESAGA.G.runTime`);
  await sleep(800);
  if ((await inFrame(page, `__SPACESAGA.G.runTime`)) !== a) throw new Error('the clock ran while minimized');
  await page.click('#tb-apps [data-app="space-saga"]');
  await waitFrame(page, `!document.documentElement.dataset.paused.includes('shell')`, 5000);
  // click the desktop: the window loses focus
  await page.mouse('mousePressed', 700, 500); await page.mouse('mouseReleased', 700, 500);
  await waitFrame(page, `document.documentElement.dataset.paused.includes('blur') || document.documentElement.dataset.paused.includes('shell')`, 5000);
  const b = await inFrame(page, `__SPACESAGA.G.runTime`);
  await sleep(600);
  if ((await inFrame(page, `__SPACESAGA.G.runTime`)) !== b) throw new Error('the clock ran while the window was inactive');
  await page.click('#game-space-saga iframe');
  try { await waitFrame(page, `document.documentElement.dataset.paused === '' && __SPACESAGA.G.runTime > ${b}`, 8000); } catch (e) { throw new Error(`still paused: '${await ds(page, 'paused')}', hasFocus ${await inFrame(page, 'document.hasFocus()')}, active ${await page.eval(`document.activeElement.tagName + ' ' + !!document.querySelector('#game-space-saga.active, #game-space-saga:not(.inactive)')`)}`); }
});

test('eggs reach the shell: saga-404 (crossing 404 m), saga-popup (jumping through a pop-up ad), saga-afk (60 s on the title screen)', async (page) => {
  await open(page, { debug: true });
  await inFrame(page, `__SPACESAGA.G.titleIdle = 59.8; 1`);
  await page.waitFor(`import('/js/state.js').then((m) => m.state.eggsFound.includes('saga-afk'))`, { timeout: 10000, what: 'saga-afk' });
  await inFrame(page, `(() => { const a = __SPACESAGA; a.start(); const sp = a.spawner(); sp.frozen = true; [...sp.active].forEach((o) => sp.release(o)); a.setDistance(403.4); })()`);
  await page.waitFor(`import('/js/state.js').then((m) => m.state.eggsFound.includes('saga-404'))`, { timeout: 15000, what: 'saga-404' });
  await inFrame(page, `(() => { const a = __SPACESAGA; a.start(); const sp = a.spawner(); sp.frozen = true; [...sp.active].forEach((o) => sp.release(o)); sp.addPopup(1, -6); setTimeout(() => a.input('jump'), 150); })()`);
  await page.waitFor(`import('/js/state.js').then((m) => m.state.eggsFound.includes('saga-popup'))`, { timeout: 15000, what: 'saga-popup' });
  const found = (await live(page)).eggsFound.filter((e) => e.startsWith('saga-')).sort();
  if (found.join() !== 'saga-404,saga-afk,saga-popup') throw new Error(found.join());
});

s.run();

test('sound: off by default (the title says so); the taskbar speaker reaches the running game through SOUND, and a click then unlocks the music', async (page) => {
  await open(page, { debug: true });
  const hint = () => inFrame(page, `document.getElementById('title-sound').textContent`);
  if (!/off/.test(await hint())) throw new Error('title hint: ' + (await hint()));
  if (await inFrame(page, `__SPACESAGA.audio().allowed`)) throw new Error('the game thinks sound is on');
  await page.eval(`import('/js/state.js').then((m) => m.set({ soundOn: true }))`);
  await waitFrame(page, `__SPACESAGA.audio().allowed === true && /M to mute/.test(document.getElementById('title-sound').textContent)`, 5000);
  await page.click('#game-space-saga iframe');
  await sleep(250);
  await page.key('Enter');
  await waitFrame(page, `!!__SPACESAGA.audio().ctx && __SPACESAGA.audio().music && __SPACESAGA.audio().mode === 'run' && __SPACESAGA.audio().step > 2`, 15000);
  await page.eval(`import('/js/state.js').then((m) => m.set({ soundOn: false }))`);
  await waitFrame(page, `__SPACESAGA.audio().allowed === false && !__SPACESAGA.audio().active`, 5000);
});
