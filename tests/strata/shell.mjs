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
const CAP = 1.5 * 1024 * 1024;

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
  if (JSON.stringify(r.eggs) !== JSON.stringify(['strata-adblock', 'strata-bedrock', 'strata-cloud']) || r.total !== 36) throw new Error(JSON.stringify(r));
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
  await boot(page, await page.eval(`JSON.parse(localStorage.getItem('system32.state'))`));
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
  // Reset progress: all system32.save.* keys, nothing else
  await page.eval(`localStorage.setItem(${JSON.stringify(KEY)}, 'again'); 0`);
  await page.eval(`import('/js/state.js').then((m) => m.reset())`);
  const left = await page.eval(`Object.keys(localStorage).filter((k) => k.startsWith('system32.save.'))`);
  if (left.length) throw new Error('reset left ' + JSON.stringify(left));
  if ((await ls(page, 'unrelated')) !== 'z') throw new Error('reset removed an unrelated key');
});

s.run();
