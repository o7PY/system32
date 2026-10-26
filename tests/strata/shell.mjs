// Part A of STRATA_SPEC.md: Strata in the shell. Registry + unlock (new and existing saves), SAVE / SAVED / INIT.save round trip,
// per-game save keys, the 1.5 MB cap, quota errors, Settings rows, Reset progress. Real headless Chrome; the game is a stub page.
//   node tests/strata/shell.mjs [name filter]
import { suite, sleep } from '../lib/cdp.mjs';
import { ALL, st, boot as bootShell, live, toastTexts } from '../lib/shell.mjs';

const GAME = 'tests/strata/stub/index.html';
const SAGA = 'tests/bonus-shell/stub/index.html';
const s = suite('Strata in the shell (Part A)');
const { test } = s;
const KEY = 'system32.save.strata';
const CAP = 4 * 1024 * 1024;                    // Strata saveCap (several worlds in one save)

async function boot(page, state, url = '/') {
  await bootShell(page, state, url);
  await page.eval(`import('/js/registry.js').then((m) => { m.BONUS_BY_ID.strata.src = ${JSON.stringify(GAME)}; m.BONUS_BY_ID['space-saga'].src = ${JSON.stringify(SAGA)}; })`);
}
const stub = (page, expr) => page.evalInFrame(GAME, expr);
const ls = (page, k) => page.eval(`localStorage.getItem(${JSON.stringify(k)})`);
const openStrata = async (page) => {
  await page.eval(`import('/js/events.js').then((m) => m.launch('strata'))`);
  await page.waitFor(`!!document.querySelector('#game-strata iframe')`, { what: 'Strata window' });
  await page.waitForFrame(GAME, `!!window.__stub && __stub.inits === 1`, { timeout: 20000 });
};
const stateOf2 = (page) => page.eval(`(() => { const a = JSON.parse(localStorage.getItem('system32.state') ?? 'null'), b = JSON.parse(localStorage.getItem('system32.meta') ?? 'null'); return a || b ? { ...a, ...b } : null; })()`);
const close = (page) => page.eval(`document.querySelector('#game-strata [data-act="close"]')?.click()`);
const doSave = async (page, data, n = 1) => {                                       // call System32.save in the frame, wait for the nth reply
  await stub(page, `__stub.save(${JSON.stringify(data)}); 1`);
  await page.waitForFrame(GAME, `__stub.saved.length >= ${n}`, { timeout: 8000 });
  return stub(page, `__stub.saved[${n - 1}]`);
};

test('registry: Strata is a bonus game with saves, its own egg prefix, and a real pickaxe icon', async (page) => {
  await boot(page, st({ endingSeen: true }));
  const r = await page.eval(`import('/js/registry.js').then((m) => { const g = m.BONUS_BY_ID.strata; return { g, eggs: m.EGGS.filter((e) => e.id.startsWith('strata-')).map((e) => e.id), icon: !!document.getElementById(g.icon), total: m.EGGS.length }; })`);
  if (r.g.file !== 'Strata.exe' || r.g.title !== 'Strata' || r.g.unlock !== 'ending' || r.g.saves !== true || r.g.eggPrefix !== 'strata-') throw new Error(JSON.stringify(r.g));
  if (r.g.binLore !== 'Deleted 11-11-2011. Reason: "user spent 400 hours digging a hole."') throw new Error(r.g.binLore);
  if (JSON.stringify(r.eggs) !== JSON.stringify(['strata-adblock', 'strata-bedrock', 'strata-cloud', 'strata-complete', 'strata-popup-adblock', 'strata-sleep-underlayer', 'strata-recycle']) || r.total !== 36) throw new Error(JSON.stringify(r));
  const hasSprite = await page.eval(`fetch('/assets/icons.svg').then((x) => x.text()).then((t) => t.includes('id="${r.g.icon}"'))`);
  if (!hasSprite) throw new Error(`no sprite ${r.g.icon}`);
});

test('new players: after the ending ONE toast counts both games ("2 items"); the bin lists both', async (page) => {
  await boot(page, st({ endingSeen: false }));
  await page.waitFor(`!!document.querySelector('.dialog')`, { what: 'ending dialog', timeout: 8000 });
  await page.eval(`[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'Restart now')?.click()`);
  await page.waitFor(`document.body.dataset.phase === 'signin' || document.body.dataset.phase === 'boot'`, { timeout: 8000 });
  const { toDesktop } = await import('../lib/shell.mjs');
  await toDesktop(page);
  await page.waitFor(`[...document.querySelectorAll('#toasts .toast-text')].some((e) => e.textContent.includes('Recycle Bin'))`, { timeout: 9000, what: 'unlock toast' });
  const texts = (await toastTexts(page)).filter((t) => t.includes('Recycle Bin'));
  if (texts.length !== 1 || texts[0] !== '🗑 Recycle Bin: 2 items could not be deleted.') throw new Error(JSON.stringify(texts));
  const b = (await live(page)).bonus;
  if (JSON.stringify(b.unlocked) !== JSON.stringify(['space-saga', 'strata'])) throw new Error(JSON.stringify(b));
  await page.eval(`import('/js/events.js').then((m) => m.launch('recycle-bin'))`);
  await page.waitFor(`!!document.querySelector('#recycle-bin .rb-table')`);
  const names = await page.eval(`[...document.querySelectorAll('#recycle-bin tr[data-i]')].map((r) => r.cells[0].textContent.trim())`);
  if (!names.some((n) => n.includes('Strata.exe')) || !names.some((n) => n.includes('SpaceSaga.exe'))) throw new Error(JSON.stringify(names));
});

test('existing finished saves: Strata unlocks on the next load with ONE toast "1 item", never again; SpaceSaga is untouched', async (page) => {
  const old = st({ endingSeen: true, bonus: { unlocked: ['space-saga'], restored: ['space-saga'], seen: ['space-saga'], best: { 'space-saga': 1234 } } });
  await boot(page, old);
  await page.waitFor(`[...document.querySelectorAll('#toasts .toast-text')].some((e) => e.textContent.includes('Recycle Bin'))`, { timeout: 9000, what: 'unlock toast' });
  const texts = (await toastTexts(page)).filter((t) => t.includes('Recycle Bin'));
  if (texts.length !== 1 || texts[0] !== '🗑 Recycle Bin: 1 item could not be deleted.') throw new Error(JSON.stringify(texts));
  const b = (await live(page)).bonus;
  if (JSON.stringify(b.unlocked) !== JSON.stringify(['space-saga', 'strata']) || JSON.stringify(b.restored) !== JSON.stringify(['space-saga']) || b.best['space-saga'] !== 1234) throw new Error(JSON.stringify(b));
  await boot(page, await stateOf2(page));
  await sleep(5200);
  if ((await toastTexts(page)).some((t) => t.includes('Recycle Bin'))) throw new Error('the toast came a second time');
});

test('SAVE / SAVED / INIT: the string is stored under its own key, the core state is untouched, the next INIT returns it', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {} } }));
  await openStrata(page);
  if ((await stub(page, `__stub.init.save`)) !== null) throw new Error('INIT.save should be null before any save');
  const before = await ls(page, 'system32.state');
  const world = JSON.stringify({ v: 1, blocks: 'x'.repeat(5000) });
  const r = await doSave(page, world);
  if (!r.ok || r.bytes !== world.length) throw new Error(JSON.stringify(r));
  if ((await ls(page, KEY)) !== world) throw new Error('the save is not under system32.save.strata');
  if ((await ls(page, 'system32.state')) !== before) throw new Error('the shell state changed on a save');
  if (/blocks/.test(await ls(page, 'system32.state'))) throw new Error('save data leaked into the state object');
  await close(page);
  await page.waitFor(`!document.querySelector('#game-strata')`);
  await openStrata(page);
  if ((await stub(page, `__stub.init.save`)) !== world) throw new Error('INIT did not carry the save');
  await close(page);
});

test('cap and errors: exactly 1.5 MB is accepted, one more is "too-large" and writes nothing, non-strings are "invalid", a quota error is reported and keeps the old save', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {} } }));
  await openStrata(page);
  const small = 'small-world';
  if (!(await doSave(page, small, 1)).ok) throw new Error('small save failed');
  const big = await doSave(page, 'a'.repeat(CAP + 1), 2);
  if (big.ok || big.error !== 'too-large' || big.bytes !== CAP + 1) throw new Error(JSON.stringify(big));
  if ((await ls(page, KEY)) !== small) throw new Error('a too-large save overwrote the old one');
  const exact = await doSave(page, 'b'.repeat(CAP), 3);
  if (!exact.ok || exact.bytes !== CAP) throw new Error(JSON.stringify(exact));
  await stub(page, `System32.save(12345); 1`);
  await page.waitForFrame(GAME, `__stub.saved.length >= 4`, { timeout: 8000 });
  const bad = await stub(page, `__stub.saved[3]`);
  if (bad.ok || bad.error !== 'invalid') throw new Error(JSON.stringify(bad));
  // quota: make setItem throw for this key only
  await page.eval(`(() => { const o = Storage.prototype.setItem; window.__setItem = o; Storage.prototype.setItem = function (k, v) { if (k === ${JSON.stringify(KEY)}) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; })()`);
  const q = await doSave(page, 'quota-me', 5);
  await page.eval(`Storage.prototype.setItem = window.__setItem`);
  if (q.ok || q.error !== 'quota') throw new Error(JSON.stringify(q));
  if ((await ls(page, KEY)).length !== CAP) throw new Error('a quota error damaged the old save');
  if (!(await live(page)).bonus.unlocked.includes('strata')) throw new Error('core state damaged');
  await close(page);
});

test('only games with saves: true may save, and only for themselves: SpaceSaga SAVE is ignored (no reply, no key)', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {} } }));
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await page.waitFor(`!!document.querySelector('#game-space-saga iframe')`);
  await page.waitForFrame(SAGA, `!!window.__stub && !!__stub.init`, { timeout: 20000 });
  await page.evalInFrame(SAGA, `window.addEventListener('message', (e) => { (window.__got = window.__got || []).push(e.data && e.data.type); }); System32.save('sneaky'); 1`);
  await sleep(600);
  const got = await page.evalInFrame(SAGA, `(window.__got || []).filter((t) => t === 'SAVED').length`);
  if (got !== 0) throw new Error('SpaceSaga got a SAVED reply');
  if ((await page.eval(`Object.keys(localStorage).filter((k) => k.startsWith('system32.save.'))`)).length) throw new Error('a non-saving game wrote a key');
  if ((await page.evalInFrame(SAGA, `__stub.init.save`)) !== null) throw new Error('INIT.save should be null for SpaceSaga');
  await page.eval(`document.querySelector('#game-space-saga [data-act="close"]')?.click()`);
});

test('eggs: Strata may report strata- eggs only', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {} } }));
  await openStrata(page);
  await stub(page, `__stub.egg('saga-404'); __stub.egg('strata-bedrock'); __stub.egg('strata-nope'); 1`);
  await sleep(400);
  const found = (await live(page)).eggsFound;
  if (JSON.stringify(found) !== JSON.stringify(['strata-bedrock'])) throw new Error(JSON.stringify(found));
  await close(page);
});

test('Settings: a "Bonus game saves" row with the size and a confirmed Delete save; Reset progress removes every system32.save.* key', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {} } }));
  await page.eval(`localStorage.setItem(${JSON.stringify(KEY)}, 'x'.repeat(2048)); localStorage.setItem('system32.save.other', 'y'); localStorage.setItem('unrelated', 'z'); 0`);
  await page.eval(`import('/js/apps/settings.js').then((m) => m.openSettings())`);
  await page.waitFor(`!!document.querySelector('#settings [data-delsave="strata"]')`, { what: 'save row' });
  const row = await page.eval(`document.querySelector('#settings [data-delsave="strata"]').closest('.row').textContent`);
  if (!/Strata/.test(row) || !/2\.0 KB/.test(row)) throw new Error(row);
  if (await page.eval(`!!document.querySelector('#settings [data-delsave="space-saga"]')`)) throw new Error('SpaceSaga has no saves and must not get a row');
  // cancel keeps it, confirm deletes it
  await page.click('#settings [data-delsave="strata"]');
  await page.waitFor(`!!document.querySelector('.dialog')`);
  await page.eval(`[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'No')?.click()`);
  await sleep(200);
  if ((await ls(page, KEY)) === null) throw new Error('No still deleted the save');
  await page.click('#settings [data-delsave="strata"]');
  await page.waitFor(`!!document.querySelector('.dialog')`);
  await page.eval(`[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'Yes')?.click()`);
  await page.waitFor(`localStorage.getItem(${JSON.stringify(KEY)}) === null`, { what: 'save deleted' });
  await page.waitFor(`/No saved world/.test(document.querySelector('#settings').textContent)`, { what: 'row refreshed' });
  if (!(await live(page)).bonus.unlocked.includes('strata')) throw new Error('Delete save touched the state');
  // Reset progress keeps the world saves; Hard reset removes every system32.* key, nothing else
  await page.eval(`localStorage.setItem(${JSON.stringify(KEY)}, 'again'); 0`);
  await page.eval(`import('/js/state.js').then((m) => m.reset())`);
  if (!(await page.eval(`Object.keys(localStorage).includes(${JSON.stringify(KEY)})`))) throw new Error('Reset progress deleted the world save');
  await page.eval(`import('/js/state.js').then((m) => m.hardReset())`);
  const left = await page.eval(`Object.keys(localStorage).filter((k) => k.startsWith('system32.'))`);
  if (left.length) throw new Error('hard reset left ' + JSON.stringify(left));
  if ((await ls(page, 'unrelated')) !== 'z') throw new Error('hard reset removed an unrelated key');
});

// ---------------------------------------------------------------- Part 2, section 1.1: GAME_COMPLETE
const done = (page, o) => stub(page, `__stub.complete(${JSON.stringify(o)}); 1`);
const completed = async (page) => (await live(page)).bonus.completed.strata ?? null;

test('GAME_COMPLETE: stores the run, one toast, the egg, a green check on the desktop icon, the Start item and the bin row; INIT carries `completed`', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: ['strata'], seen: ['strata'], best: {} } }));
  await openStrata(page);
  if ((await stub(page, `__stub.init.completed`)) !== null) throw new Error('INIT.completed should be null before the first win');
  await done(page, { timeMs: 3600000, deaths: 2, difficulty: 'normal' });
  await page.waitFor(`import('/js/state.js').then((m) => !!m.state.bonus.completed.strata)`, { what: 'completion stored' });
  const c = await completed(page);
  if (c.timeMs !== 3600000 || c.deaths !== 2 || c.difficulty !== 'normal' || !(c.at > 1e12) || c.byDifficulty.normal.timeMs !== 3600000) throw new Error(JSON.stringify(c));
  const sv = await live(page);
  if (!sv.eggsFound.includes('strata-complete')) throw new Error('egg not counted');
  const toasts = (await toastTexts(page)).filter((t) => t.includes('kernel restored'));
  if (toasts.length !== 1 || !toasts[0].includes('Strata.exe: kernel restored.')) throw new Error(JSON.stringify(await toastTexts(page)));
  if (JSON.stringify(sv.repaired) !== JSON.stringify(ALL)) throw new Error('a bonus completion changed the repairs');
  const ui = await page.eval(`(() => { const d = document.querySelector('.d-icon[data-id="strata"]'); const sd = document.querySelector('.d-icon[data-id="space-saga"]');
    return { desk: d && d.classList.contains('done') && getComputedStyle(d.querySelector('.d-check')).display !== 'none', other: !!sd && sd.classList.contains('done') }; })()`);
  if (!ui.desk) throw new Error('no check on the desktop icon');
  await page.eval(`document.getElementById('start-btn').click(); 0`);
  await page.waitFor(`!!document.querySelector('.pin-item[data-launch="strata"]')`, { what: 'start menu' });
  const start = await page.eval(`(() => { const p = document.querySelector('.pin-item[data-launch="strata"]'); return p.classList.contains('done') && getComputedStyle(p.querySelector('.d-check')).display !== 'none'; })()`);
  if (!start) throw new Error('no check in the Start menu');
  // reopen: INIT now carries it
  await close(page);
  await openStrata(page);
  const init = await stub(page, `__stub.init.completed`);
  if (!init || init.timeMs !== 3600000 || init.difficulty !== 'normal') throw new Error(JSON.stringify(init));
});

test('GAME_COMPLETE keeps the best time per difficulty; slower runs and bad payloads change nothing', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: ['strata'], seen: ['strata'], best: {} } }));
  await openStrata(page);
  const settle = () => sleep(350);
  await done(page, { timeMs: 5000, deaths: 1, difficulty: 'hard' }); await settle();
  await done(page, { timeMs: 9000, deaths: 0, difficulty: 'hard' }); await settle();         // slower on the same difficulty
  let c = await completed(page);
  if (c.byDifficulty.hard.timeMs !== 5000 || c.timeMs !== 5000) throw new Error(JSON.stringify(c));
  await done(page, { timeMs: 4000, deaths: 3, difficulty: 'hard' }); await settle();         // faster: replaces
  c = await completed(page);
  if (c.byDifficulty.hard.timeMs !== 4000 || c.byDifficulty.hard.deaths !== 3 || c.timeMs !== 4000) throw new Error(JSON.stringify(c));
  await done(page, { timeMs: 8000, deaths: 0, difficulty: 'peaceful' }); await settle();     // another difficulty is its own best, the overall stays the fastest
  c = await completed(page);
  if (c.byDifficulty.peaceful.timeMs !== 8000 || c.timeMs !== 4000 || c.difficulty !== 'hard') throw new Error(JSON.stringify(c));
  const before = JSON.stringify(c);
  for (const bad of [{ timeMs: -1, deaths: 0, difficulty: 'normal' }, { timeMs: 'x', deaths: 0, difficulty: 'normal' }, { timeMs: 1, deaths: 0, difficulty: 'nightmare' }, { timeMs: 1, deaths: -5, difficulty: 'normal' }, {}, { timeMs: NaN, deaths: 0, difficulty: 'normal' }]) { await done(page, bad); await sleep(120); }
  await settle();
  if (JSON.stringify(await completed(page)) !== before) throw new Error('an invalid GAME_COMPLETE changed the stored run');
  // persisted, and cleaned on load (garbage in the saved state is not trusted)
  const saved = (await stateOf2(page)).bonus.completed.strata;
  if (!saved || saved.byDifficulty.hard.timeMs !== 4000) throw new Error('not persisted');
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['strata'], restored: [], seen: [], best: {}, completed: { strata: { timeMs: 'x', deaths: 1, difficulty: 'normal', at: 1 }, evil: { timeMs: 1, deaths: 0, difficulty: 'normal', at: 1 }, 'space-saga': { timeMs: 5, deaths: 0, difficulty: 'normal', at: 2, byDifficulty: { normal: { timeMs: 5, deaths: 0, at: 2 }, bogus: { timeMs: 1, deaths: 0, at: 1 } } } } } }));
  const cleaned = (await live(page)).bonus.completed;
  if (Object.keys(cleaned).join() !== 'space-saga' || Object.keys(cleaned['space-saga'].byDifficulty).join() !== 'normal') throw new Error(JSON.stringify(cleaned));
});

test('only a game with `completes: true` may send GAME_COMPLETE (SpaceSaga is ignored), and it cannot complete for another game', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {} } }));
  await page.eval(`import('/js/events.js').then((m) => m.launch('space-saga'))`);
  await page.waitForFrame(SAGA, `!!window.__stub && !!__stub.init`, { timeout: 20000 });
  await page.evalInFrame(SAGA, `System32.complete({ timeMs: 1, deaths: 0, difficulty: 'normal' }); window.parent.postMessage({ source: 'system32-game', gameId: 'strata', type: 'GAME_COMPLETE', payload: { timeMs: 1, deaths: 0, difficulty: 'normal' } }, '*'); 1`);
  await sleep(500);
  const sv = await live(page);
  if (Object.keys(sv.bonus.completed).length || sv.eggsFound.includes('strata-complete')) throw new Error(JSON.stringify(sv.bonus.completed));
});

test('the bin row of a finished (not restored) Strata also shows the green check', async (page) => {
  await boot(page, st({ endingSeen: true, bonus: { unlocked: ['space-saga', 'strata'], restored: [], seen: [], best: {}, completed: { strata: { timeMs: 1000, deaths: 0, difficulty: 'normal', at: 5, byDifficulty: { normal: { timeMs: 1000, deaths: 0, at: 5 } } } } } }));
  await page.eval(`import('/js/events.js').then((m) => m.launch('recycle-bin'))`);
  await page.waitFor(`!!document.querySelector('#recycle-bin .rb-table')`);
  const r = await page.eval(`[...document.querySelectorAll('#recycle-bin tr[data-i]')].map((tr) => ({ n: tr.textContent, check: !!tr.querySelector('.d-check') && getComputedStyle(tr.querySelector('.d-check')).display !== 'none' }))`);
  const strata = r.find((x) => x.n.includes('Strata.exe')), saga = r.find((x) => x.n.includes('SpaceSaga.exe'));
  if (!strata?.check || saga?.check) throw new Error(JSON.stringify(r));
});

s.run();
