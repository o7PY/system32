// Part A of SPACESAGA_SPEC.md: bonus games in the shell. Real headless Chrome, real mouse and keyboard events.
//   node tests/bonus-shell/run.mjs [name filter]
import { suite, sleep } from '../lib/cdp.mjs';

const ALL = { 'dom-ination': true, inspect: true, specificity: true, wm404: true };
const SANDBOX = 'allow-scripts allow-forms allow-pointer-lock';
const NONE = { 'dom-ination': false, inspect: false, specificity: false, wm404: false };
const st = (o = {}) => ({ version: 2, firstVisit: false, repaired: ALL, ...o });
// These tests exercise the shell's bonus-game flow against a stub page (a button that sends RUN_OVER), not the real game: after boot() the
// registry's SpaceSaga entry is pointed at the stub. The real game has its own shell test (tests/space-saga/shell.mjs).
const GAME = 'tests/bonus-shell/stub/index.html';

const s = suite('bonus games in the shell (Part A)');
const { test } = s;

/** Seed localStorage (same origin as the shell), then load the shell at `url` and sign in. */
async function boot(page, state, url = '/') {
  await page.goto('/css/tokens.css');
  await page.eval(`localStorage.clear(); ${state ? `localStorage.setItem('system32.state', ${JSON.stringify(JSON.stringify(state))});` : ''} 0`);
  await page.goto(url);
  await toDesktop(page);
  await page.eval(`import('/js/registry.js').then((m) => { m.BONUS_BY_ID['space-saga'].src = ${JSON.stringify(GAME)}; })`);
}
async function toDesktop(page) {
  // keys are only noticed once the boot code has attached its listeners: keep pressing until the next screen shows
  const t0 = Date.now();
  for (;;) {
    const phase = await page.eval(`document.body.dataset.phase`);
    if (phase === 'desktop') return;                                // a restart reboots with skipLock: no sign-in screen
    if (phase === 'signin') break;
    if (Date.now() - t0 > 14000) throw new Error(`stuck in phase ${phase}`);
    await page.key('Shift');
    await sleep(250);
  }
  await page.click('#signin-btn');
  await page.waitFor(`document.body.dataset.phase === 'desktop'`, { what: 'desktop' });
}
const stateOf = (page) => page.eval(`JSON.parse(localStorage.getItem('system32.state') ?? 'null')`);
const live = (page) => page.eval(`import('/js/state.js').then((m) => JSON.parse(JSON.stringify(m.state)))`);
const toastTexts = (page) => page.eval(`[...document.querySelectorAll('#toasts .toast-text')].map((e) => e.textContent)`);
async function binRow(page, name) {
  const i = await page.eval(`[...document.querySelectorAll('#recycle-bin tr[data-i]')].findIndex((r) => r.textContent.includes(${JSON.stringify(name)}))`);
  return i < 0 ? null : `#recycle-bin tr[data-i="${i}"]`;
}
async function openBin(page) {
  await page.eval(`import('/js/events.js').then((m) => m.launch('recycle-bin'))`);
  await page.waitFor(`!!document.querySelector('#recycle-bin .rb-table')`, { what: 'bin table' });
}
const stub = (page, expr) => page.evalInFrame(GAME, expr);
const waitStub = (page, expr, timeout) => page.waitForFrame(GAME, expr, { timeout });
const dlgClick = (page, label) => page.eval(`[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click() ?? false`);

test('old saves migrate (version 1, no bonus field): everything is kept, bonus starts empty', async (page) => {
  await boot(page, { version: 1, firstVisit: false, repaired: { ...ALL, wm404: false }, eggsFound: ['clock'], bestScores: { 'dom-ination': 7 }, bestTimes: { inspect: 9000 }, accent: 1 });
  await page.eval(`import('/js/state.js').then((m) => m.set({ accent: 1 }))`);          // any write persists the migrated state
  const saved = await stateOf(page);
  if (saved.version !== 2) throw new Error(`version ${saved.version}`);
  if (JSON.stringify(saved.bonus) !== JSON.stringify({ unlocked: [], restored: [], seen: [], best: {} })) throw new Error(`bonus ${JSON.stringify(saved.bonus)}`);
  if (saved.repaired.wm404 !== false || saved.repaired.inspect !== true || saved.eggsFound[0] !== 'clock' || saved.bestScores['dom-ination'] !== 7 || saved.bestTimes.inspect !== 9000) throw new Error('old progress lost');
  // garbage in the bonus field is cleaned, not trusted
  await boot(page, st({ bonus: { unlocked: ['space-saga', 'nope'], restored: 'x', best: { 'space-saga': 12, evil: 99, 'space-saga2': -1 } } }));
  const b = (await live(page)).bonus;
  if (JSON.stringify(b) !== JSON.stringify({ unlocked: ['space-saga'], restored: [], seen: [], best: { 'space-saga': 12 } })) throw new Error(`cleaned bonus ${JSON.stringify(b)}`);
});

test('the ending: restart, 4 s later ONE toast, the bin has SpaceSaga.exe, nothing before the restart', async (page) => {
  await boot(page, st({ endingSeen: false }));
  await page.waitFor(`!!document.querySelector('.dialog')`, { what: 'ending dialog', timeout: 8000 });
  if (!(await page.eval(`document.querySelector('.dialog').textContent.includes('Restart')`))) throw new Error('no ending dialog');
  if ((await live(page)).bonus.unlocked.length) throw new Error('unlocked before the restart');
  await dlgClick(page, 'Restart now');
  await page.waitFor(`document.body.dataset.phase === 'signin' || document.body.dataset.phase === 'boot'`, { timeout: 8000 });
  await toDesktop(page);                                            // restart reboots with skipLock; the sign-in screen still shows
  const t0 = Date.now();
  await page.waitFor(`[...document.querySelectorAll('#toasts .toast-text')].some((e) => e.textContent.includes('Recycle Bin'))`, { timeout: 9000, what: 'unlock toast' });
  const dt = Date.now() - t0;
  if (dt < 3000) throw new Error(`toast came after ${dt} ms (expected about 4 s)`);
  const texts = (await toastTexts(page)).filter((t) => t.includes('Recycle Bin'));
  if (texts.length !== 1 || texts[0] !== '🗑 Recycle Bin: 2 items could not be deleted.') throw new Error(`toast texts ${JSON.stringify(texts)}`);
  const sv = await stateOf(page);
  if (!sv.endingSeen || JSON.stringify(sv.bonus.unlocked) !== JSON.stringify(['space-saga', 'strata']) || sv.bonus.restored.length) throw new Error(`state ${JSON.stringify(sv.bonus)}`);
  if (JSON.stringify(sv.repaired) !== JSON.stringify(ALL)) throw new Error('repairs changed');
  // clicking the toast opens the Recycle Bin (wait for its slide-in to finish)
  await sleep(500);
  await page.click('#toasts .toast.clickable');
  await page.waitFor(`!!document.querySelector('#recycle-bin .rb-table')`, { what: 'bin opened by the toast' });
  const row = await binRow(page, 'SpaceSaga.exe');
  if (!row) throw new Error('no SpaceSaga.exe row');
  const rowInfo = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(row)}); return { cls: r.className, cells: [...r.cells].map((c) => c.textContent) }; })()`);
  if (!rowInfo.cls.includes('rb-new')) throw new Error('first-time row is not highlighted');
  if (rowInfo.cells[1] !== 'C:\\Games\\' || rowInfo.cells[2].slice(0, 10) !== '03-03-2023') throw new Error(`row ${JSON.stringify(rowInfo.cells)}`);
  // Properties shows the lore
  await page.click(row, { button: 'right' });
  await page.waitFor(`!!document.querySelector('.ctx-menu')`);
  await page.eval(`[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent.includes('Properties')).click()`);
  await page.waitFor(`!!document.querySelector('.dialog .props-grid')`);
  const lore = await page.eval(`document.querySelector('.dialog .dlg-sub').textContent`);
  if (lore !== 'Deleted 03-03-2023. Reason: "too fun, employees stopped working."') throw new Error(`lore: ${lore}`);
  await dlgClick(page, 'OK');
  // the toast never comes again: reload the desktop, wait past 4 s
  await boot(page, await stateOf(page));
  await sleep(5200);
  if ((await toastTexts(page)).some((t) => t.includes('Recycle Bin'))) throw new Error('the unlock toast appeared a second time');
});

test('Open (double-click) launches a sandboxed game window with keyboard focus; Restore moves it to the desktop and Start', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga'], restored: [], seen: [], best: {} } }));
  await openBin(page);
  const row = await binRow(page, 'SpaceSaga.exe');
  await page.click(row, { count: 2 });                                      // Open
  await page.waitFor(`!!document.querySelector('#game-space-saga iframe')`, { what: 'game window' });
  await sleep(350);                                                          // the open animation (scale .95 -> 1) must be over before measuring
  const info = await page.eval(`(() => { const w = document.querySelector('#game-space-saga'); const f = w.querySelector('iframe'); const r = w.getBoundingClientRect(); const lr = document.getElementById('windows').getBoundingClientRect();
    return { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src'), title: w.querySelector('.win-title').textContent, w: r.width, h: r.height, lw: lr.width, lh: lr.height, edgy: !!document.querySelector('.br-toolbar, .br-address'), active: document.activeElement === f }; })()`);
  if (info.sandbox !== SANDBOX || info.sandbox.includes('same-origin')) throw new Error(`sandbox ${info.sandbox}`);
  if (info.src !== GAME || info.title !== 'SpaceSaga') throw new Error(`src/title ${JSON.stringify(info)}`);
  if (info.edgy) throw new Error('the bonus game opened in Edgy');
  if (Math.abs(info.w - Math.min(1280, info.lw - 8)) > 2 || Math.abs(info.h - Math.min(760, info.lh - 8)) > 2) throw new Error(`size ${info.w}x${info.h} in ${info.lw}x${info.lh}`);
  await waitStub(page, `!!window.__stub && window.__stub.init !== null && window.__stub.state === 'running'`, 8000);
  if (!info.active && !(await page.eval(`document.activeElement.tagName === 'IFRAME'`))) throw new Error('the iframe does not have keyboard focus');
  await page.key('x');                                                     // a real key press reaches the game
  await waitStub(page, `window.__stub.keys.includes('x')`, 3000);
  // the bin row is still there until restored; close the game, restore
  await page.eval(`document.querySelector('#game-space-saga [data-act="close"]').click()`);
  await page.waitFor(`!document.querySelector('#game-space-saga')`);
  await page.click(row);
  await page.waitFor(`!document.querySelector('#recycle-bin [data-a="restore"]').disabled`, { what: 'restore button enabled' });
  await page.click('#recycle-bin [data-a="restore"]');
  await page.waitFor(`!document.querySelector('.d-icon[data-id="space-saga"]') === false`, { what: 'desktop icon' });
  if (await binRow(page, 'SpaceSaga.exe')) throw new Error('the row is still in the bin');
  await page.click('#start-btn');
  await page.waitFor(`!!document.querySelector('#start-menu .pin-item[data-launch="space-saga"]')`, { what: 'pinned in Start' });
  const label = await page.eval(`document.querySelector('.d-icon[data-id="space-saga"] .d-label').textContent`);
  if (label !== 'SpaceSaga.exe') throw new Error(`desktop label ${label}`);
  const sv = await stateOf(page);
  if (sv.bonus.restored[0] !== 'space-saga') throw new Error('not persisted');
  // the Recycle Bin window covers the desktop icons: close it (and Start) before using them
  await page.key('Escape');
  await page.eval(`document.querySelector('#recycle-bin [data-act="close"]').click()`);
  await page.waitFor(`!document.querySelector('#recycle-bin')`);
  // launching from the desktop icon works
  await page.click('.d-icon[data-id="space-saga"]', { count: 2 });
  await page.waitFor(`!!document.querySelector('#game-space-saga iframe')`);
  // a restored game goes back to the bin when its desktop icon is deleted
  await page.eval(`document.querySelector('#game-space-saga [data-act="close"]').click()`);
  await page.click('.d-icon[data-id="space-saga"]', { button: 'right' });
  await page.eval(`[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent.trim() === 'Delete').click()`);
  await page.waitFor(`!document.querySelector('.d-icon[data-id="space-saga"]')`, { what: 'icon removed' });
  if ((await stateOf(page)).bonus.restored.length) throw new Error('still restored');
  await openBin(page);
  if (!(await binRow(page, 'SpaceSaga.exe'))) throw new Error('not back in the bin');
});

test('RUN_OVER: best is stored and returned in INIT, new-best toast only on a new best; won()/lost() are ignored; pause on minimize', async (page) => {
  await boot(page, st({ repaired: NONE, endingSeen: false }), '/?unlockBonus=1');
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await waitStub(page, `!!window.__stub && window.__stub.init !== null`, 8000);
  const init = await stub(page, 'window.__stub.init');
  if (init.best !== null || init.soundOn !== false) throw new Error(`first INIT ${JSON.stringify(init)}`);
  await page.click('#game-space-saga iframe');                              // focus the game, then press the key that sends a run
  await sleep(250);                                                          // (a human cannot press a key within a millisecond of the click)
  await page.key('r');
  await page.waitFor(`document.querySelector('#toasts')?.textContent.includes('SpaceSaga: new best — 1,000')`, { what: 'new-best toast', timeout: 4000 });
  if ((await live(page)).bonus.best['space-saga'] !== 1000) throw new Error('best not stored');
  await stub(page, `System32.runOver({ score: 400, distance: 40, pickups: 0, timeMs: 1000 })`);    // worse: no toast, best unchanged
  await stub(page, `System32.runOver({ score: 'abc' })`);
  await stub(page, `System32.runOver({ score: -5 })`);
  await stub(page, `System32.runOver({ score: 1e30, distance: 1 })`);                                // clamped, still a (silly) best
  await sleep(400);
  const b = (await live(page)).bonus.best['space-saga'];
  if (b !== 1e9) throw new Error(`best after hostile scores: ${b}`);
  // won()/lost() from a bonus game change nothing (no repair, no toast)
  const before = JSON.stringify((await live(page)).repaired);
  const toastsBefore = (await toastTexts(page)).length;
  await stub(page, `(System32.won({ timeMs: 1, score: 1 }), System32.lost('x'), true)`);
  await sleep(300);
  if (JSON.stringify((await live(page)).repaired) !== before) throw new Error('won() repaired something');
  if ((await toastTexts(page)).length !== toastsBefore) throw new Error('won()/lost() produced a toast');
  if (await page.eval(`(async () => (await import('/js/state.js')).repairedCount())()`) !== 0) throw new Error('integrity changed');
  // pause on minimize, resume on restore
  const p0 = await stub(page, 'window.__stub.pauses');
  await page.eval(`document.querySelector('#game-space-saga [data-act="min"]').click()`);
  await waitStub(page, `window.__stub.pauses > ${p0}`, 3000);
  const r0 = await stub(page, 'window.__stub.resumes');
  await page.click('#tb-apps [data-app="space-saga"]');
  await waitStub(page, `window.__stub.resumes > ${r0}`, 3000);
  // reopen: the best comes back in INIT
  await page.eval(`document.querySelector('#game-space-saga [data-act="close"]').click()`);
  await page.waitFor(`!document.querySelector('#game-space-saga')`);
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await waitStub(page, `!!window.__stub && window.__stub.init && window.__stub.init.best === 1e9`, 8000);
});

test('Empty Recycle Bin never deletes a bonus game; its row stays while the joke items come back', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga'], restored: [], seen: [], best: {} } }));
  await openBin(page);
  await page.click('#recycle-bin [data-a="empty"]');
  await page.waitFor(`[...document.querySelectorAll('.dialog .btn')].some((b) => b.textContent.trim() === 'Yes')`);
  await dlgClick(page, 'Yes');
  await sleep(1700);
  const during = await page.eval(`[...document.querySelectorAll('#recycle-bin tr[data-i]')].map((r) => r.querySelector('.nm').textContent.trim())`);
  if (during.length !== 2 || !during.includes('SpaceSaga.exe') || !during.includes('Strata.exe')) throw new Error(`during: ${JSON.stringify(during)}`);
  await page.waitFor(`[...document.querySelectorAll('.dialog')].some((d) => d.textContent.includes('emotionally attached'))`, { timeout: 8000, what: 'the emotionally-attached joke' });
  const after = await page.eval(`[...document.querySelectorAll('#recycle-bin tr[data-i]')].map((r) => r.querySelector('.nm').textContent.trim())`);
  if (after.length !== 5 || !after.includes('SpaceSaga.exe') || !after.includes('Strata.exe') || !after.includes('my_will_to_live.zip')) throw new Error(`after: ${JSON.stringify(after)}`);
  if (!(await stateOf(page)).bonus.unlocked.includes('space-saga')) throw new Error('unlock lost');
});

test('?unlockBonus=1 unlocks without the ending; bonus games never count toward integrity; reset wipes them', async (page) => {
  await boot(page, null, '/?unlockBonus=1');
  const sv = await live(page);
  if (sv.bonus.unlocked[0] !== 'space-saga' || sv.endingSeen) throw new Error(`state ${JSON.stringify(sv.bonus)} ending ${sv.endingSeen}`);
  const counts = await page.eval(`import('/js/state.js').then((m) => [m.repairedCount(), m.integrity(), m.allRepaired()])`);
  if (counts[0] !== 0 || counts[1] !== 0 || counts[2] !== false) throw new Error(`integrity ${JSON.stringify(counts)}`);
  await openBin(page);
  if (!(await binRow(page, 'SpaceSaga.exe'))) throw new Error('no row');
  // reset progress (Settings is unlocked by admin_access.dll)
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga'], restored: ['space-saga'], seen: ['space-saga'], best: { 'space-saga': 123 } } }));
  await page.eval(`import('/js/events.js').then((m) => m.launch('settings'))`);
  await page.click('#settings [data-reset]');
  await page.waitFor(`[...document.querySelectorAll('.dialog .btn')].some((b) => b.textContent.trim() === 'Yes')`);
  const nav = page.waitFor(`false`, { timeout: 1500 }).catch(() => {});
  await dlgClick(page, 'Yes');
  await nav;
  await sleep(1200);
  const after = await stateOf(page);
  if (JSON.stringify(after.bonus) !== JSON.stringify({ unlocked: [], restored: [], seen: [], best: {} }) || after.endingSeen) throw new Error(`after reset ${JSON.stringify(after)}`);
});

test('core games are unchanged: Edgy iframe, INIT with best, GAME_WON repairs; RUN_OVER from a core game is ignored', async (page) => {
  await boot(page, st({ repaired: NONE, bestScores: { 'dom-ination': 4 }, unlockedBookmarks: [] }));
  await page.eval(`import('/js/events.js').then((m) => m.launch('dom-ination'))`);
  await page.waitFor(`!!document.querySelector('.br-view iframe')`, { what: 'Edgy game frame' });
  const sandbox = await page.eval(`document.querySelector('.br-view iframe').getAttribute('sandbox')`);
  if (sandbox !== SANDBOX) throw new Error(`Edgy sandbox ${sandbox}`);
  await page.waitForFrame('games/dom-ination/index.html', `typeof System32 !== 'undefined'`);
  await page.evalInFrame('games/dom-ination/index.html', `System32.runOver({ score: 99999, distance: 1, pickups: 1, timeMs: 1 })`);
  await sleep(300);
  const sv = await live(page);
  if (sv.bonus.best['space-saga'] !== undefined || Object.keys(sv.bonus.best).length) throw new Error('a core game stored a bonus best');
  if (await page.eval(`document.querySelector('#toasts').textContent.includes('new best')`)) throw new Error('a core game produced a new-best toast');
  await page.evalInFrame('games/dom-ination/index.html', `System32.won({ timeMs: 1234, score: 3 })`);
  await page.waitFor(`import('/js/state.js').then((m) => m.state.repaired['dom-ination'])`, { what: 'popup_guard.sys repaired' });
  if ((await live(page)).bestTimes['dom-ination'] !== 1234) throw new Error('best time not recorded');
});

test('a bonus game cannot report for another game and eggs are limited to its own prefix', async (page) => {
  await boot(page, st({ endingSeen: false }), '/?unlockBonus=1');
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await waitStub(page, `!!window.__stub && window.__stub.init !== null`, 8000);
  await stub(page, `window.parent.postMessage({ source: 'system32-game', gameId: 'dom-ination', type: 'RUN_OVER', payload: { score: 777 } }, '*')`);
  await stub(page, `System32.effect('egg', { egg: 'konami' })`);                      // a shell egg: not this game's
  await stub(page, `System32.effect('egg', { egg: 'saga-404' })`);                     // its own
  await sleep(500);
  const sv = await live(page);
  if (sv.bonus.best['space-saga'] !== undefined) throw new Error('a forged gameId stored a best');
  if (sv.eggsFound.includes('konami') || !sv.eggsFound.includes('saga-404')) throw new Error(`eggs ${JSON.stringify(sv.eggsFound)}`);
});

s.run();
