// FINAL_SPEC in the shell: skip puzzle, sudoku escape hatch, achievements, resets, tutorial.   node tests/final/run.mjs [filter]
import { suite, sleep } from '../lib/cdp.mjs';
import { boot, st, stateOf, live } from '../lib/shell.mjs';

const s = suite('final spec', { width: 1400, height: 900 });
const { test } = s;
const NONE = { 'dom-ination': false, inspect: false, wm404: false };
const DOM = 'games/dom-ination/index.html', INS = 'games/inspect-element/index.html?debug=1';
const open = async (page, id) => { await page.eval(`import('/js/events.js').then((m) => m.launch(${JSON.stringify(id)}))`); await page.waitFor(`!!document.querySelector('.br-view iframe')`); };

test('skip puzzle: refused before 2 losses, accepted after; component repaired, marker, achievements', async (page) => {
  await boot(page, st({ repaired: NONE, unlockedBookmarks: [] }));
  await open(page, 'dom-ination');
  await page.waitForFrame(DOM, `typeof System32 !== 'undefined'`);
  await sleep(400);
  await page.evalInFrame(DOM, `System32.skip(); 0`);
  await sleep(300);
  if ((await live(page)).repaired['dom-ination']) throw new Error('an early skip was accepted');
  await boot(page, st({ repaired: NONE, losses: { 'dom-ination': 2 } }));
  await open(page, 'dom-ination');
  await page.waitForFrame(DOM, `!document.getElementById('skip-start').hidden`, { timeout: 8000 });
  await page.evalInFrame(DOM, `document.getElementById('skip-start').click(); 0`);
  await page.evalInFrame(DOM, `document.querySelector('[data-do="skip-yes"]').click(); 0`);
  await page.waitFor(`import('/js/state.js').then((m) => m.state.repaired['dom-ination'])`.replace(/^/, '(() => window.__r = 1, false) || '), { timeout: 100 }).catch(() => {});
  await sleep(600);
  const sv = await live(page);
  if (!sv.repaired['dom-ination'] || !sv.skipped['dom-ination'] || sv.noShortcuts !== false || !('skip-1' in sv.achievements) || 'skip-2' in sv.achievements) throw new Error(JSON.stringify({ r: sv.repaired, s: sv.skipped, a: Object.keys(sv.achievements) }));
});

test('sudoku: the button needs 10 minutes of play; solving with real keys opens the bank, 0 stars, sudoku achievement', async (page) => {
  await boot(page, st({ repaired: NONE, playtime: { inspect: 0 } }));
  await page.eval(`import('/js/registry.js').then((m) => { m.ROUTES.inspect.src = () => ${JSON.stringify(INS)}; })`);
  await open(page, 'inspect');
  await page.waitForFrame(INS, `!!window.__INSPECT`);
  if (!(await page.evalInFrame(INS, `document.getElementById('vault-open').hidden`))) throw new Error('button too early');
  await page.evalInFrame(INS, `__INSPECT.fakePlaytime(600000); 0`);
  await page.eval(`import('/js/state.js').then((m) => { m.state.playtime.inspect = 600000; })`);       // what the heartbeats would have added
  if (await page.evalInFrame(INS, `document.getElementById('vault-open').hidden`)) throw new Error('button missing after 10 min');
  await page.evalInFrame(INS, `document.getElementById('vault-open').click(); 0`);
  const v = await page.evalInFrame(INS, `__INSPECT.vault()`);
  if (!v.open || v.puzzle.filter(Boolean).length < 30 || v.puzzle.filter(Boolean).length > 34) throw new Error('puzzle ' + JSON.stringify(v).slice(0, 100));
  for (let c = 0; c < 81; c++) {
    if (v.puzzle[c]) continue;
    await page.evalInFrame(INS, `document.querySelector('.scell[data-c="${c}"]').click(); 0`);
    await page.evalInFrame(INS, `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${v.solution[c]}', bubbles: true })); 0`);
  }
  await page.waitForFrame(INS, `!document.getElementById('dashboard').hidden`, { timeout: 5000 });
  await page.evalInFrame(INS, `document.getElementById('install').click(); 0`);
  await sleep(700);
  const sv = await live(page);
  if (!sv.repaired.inspect || sv.bestScores.inspect !== 0 || !('sudoku' in sv.achievements)) throw new Error(JSON.stringify({ r: sv.repaired, b: sv.bestScores, a: Object.keys(sv.achievements) }));
});

test('achievements: ACHIEVEMENT only with the sender prefix; panel counts; Hard reset needs DELETE', async (page) => {
  await boot(page, st({ repaired: NONE }));
  await open(page, 'dom-ination');
  await page.waitForFrame(DOM, `typeof System32 !== 'undefined'`);
  await page.evalInFrame(DOM, `System32.achieve('saga-1km'); System32.achieve('dom-clean'); System32.achieve('bogus'); 0`);
  await sleep(400);
  const a = Object.keys((await live(page)).achievements);
  if (a.includes('saga-1km') || a.includes('bogus') || !a.includes('dom-clean')) throw new Error(a.join());
  await page.click('#ach-btn');
  await sleep(350);
  if (!(await page.eval(`/Achievements \\d+\\/22/.test(document.getElementById('ach-panel').textContent)`))) throw new Error('header');
  await page.click('#ach-panel [data-hard]');
  await page.waitFor(`!!document.querySelector('.dialog .hard-row input')`);
  if (!(await page.eval(`document.querySelector('.dialog .hard-row button').disabled`))) throw new Error('enabled without DELETE');
  await page.eval(`(() => { const i = document.querySelector('.dialog .hard-row input'); i.value = 'DELETE'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  if (await page.eval(`document.querySelector('.dialog .hard-row button').disabled`)) throw new Error('still disabled');
});

test('Reset progress keeps achievements and bonus games; the tutorial ticks from state', async (page) => {
  await boot(page, st({ repaired: { ...NONE, wm404: true }, endingSeen: false, bonus: { unlocked: ['strata'], restored: [], seen: [], best: {}, completed: {} } }));
  await page.eval(`import('/js/achievements.js').then((m) => m.achieve('skip-1', { silent: true }))`);
  await page.eval(`import('/js/events.js').then((m) => m.launch('tutorial'))`);
  await page.waitFor(`!!document.querySelector('#tutorial .tut-step')`);
  if (!(await page.eval(`document.querySelector('#tutorial .tut-step[data-n="6"]').classList.contains('done')`))) throw new Error('step 6 should be ticked');
  await page.eval(`import('/js/achievementsPanel.js').then((m) => { m.resetProgress(); return 0; })`);
  await page.waitFor(`[...document.querySelectorAll('.dialog .btn')].some((b) => b.textContent.trim() === 'Reset')`);
  await page.eval(`[...document.querySelectorAll('.dialog .btn')].find((b) => b.textContent.trim() === 'Reset').click()`);
  await sleep(3500);
  const sv = await stateOf(page);
  if (sv.repaired.wm404 || !('skip-1' in sv.achievements) || !sv.bonus.unlocked.includes('strata')) throw new Error(JSON.stringify(sv).slice(0, 300));
});

s.run();
