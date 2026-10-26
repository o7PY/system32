// Strata objectives journal, no browser: rules, implications, save round-trip, acts, tracker.   node tests/strata/objectives.mjs
import { Journal, OBJECTIVES, ACTS } from '../../games/strata/src/objectives.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const ctx = (counts = {}, o = {}) => ({ counts, flags: { rifts: [], vaults: {} }, rifts: 0, raided: 0, spawners: 0, wardens: 0, ...o });

check('58 objectives in 6 acts, numbered 1..58, texts and how-lines present', OBJECTIVES.length === 58 && ACTS.length === 6 && OBJECTIVES.every((o, i) => o.n === i + 1 && o.text) && OBJECTIVES.filter((o) => o.how).length > 40);
const j = new Journal();
check('a fresh journal ticks nothing', j.update(ctx()).length === 0 && j.count === 0 && j.upcoming()[0].n === 1);
check('4 logs tick objective 1; planks 2', j.update(ctx({ log: 4, planks: 4 })).join() === '1,2');
j.update(ctx({ stick: 2 }));
check('peaks stay: the logs used up do not un-tick, and counts are peaks', j.has(1) && j.has(4));
j.event('place:crafting_table');
check('events tick (placing the crafting table)', j.update(ctx()).join() === '3');
check('an iron pickaxe ticks 20 and implies 1-7 and 17-19', (() => { const k = new Journal(); k.update(ctx({ pickaxe_iron: 1 })); return [1, 2, 3, 4, 5, 6, 7, 17, 18, 19, 20].every((n) => k.has(n)) && !k.has(21); })());
check('optional objectives never block the tracker', (() => { const k = new Journal(); for (let n = 1; n <= 26; n++) k.set(n); return k.upcoming(1)[0].n === 29 && !k.upcoming(3).some((o) => o.optional); })());
check('save round-trip keeps ticks, counters, peaks, tips', (() => { const a = new Journal(); a.update(ctx({ log: 9 })); a.event('mined:iron_ore', 5); a.tip('night'); const b = new Journal(); b.load(JSON.parse(JSON.stringify(a.toJSON()))); return b.has(1) && b.stat['mined:iron_ore'] === 5 && b.peaks.log === 9 && !b.tip('night') && b.tip('hunger'); })());
check('garbage in the flags is ignored', (() => { const b = new Journal(); b.load({ obj: 'zz', jst: { a: 'x' }, tips: 'q' }); return b.count === 0; })());
check('acts: banner once when an act is complete', (() => { const k = new Journal(); for (const o of OBJECTIVES) if (o.act === 1) k.set(o.n); const a = k.newlyCompletedActs(); return a.length === 1 && a[0].act === 1 && k.newlyCompletedActs().length === 0; })());
check('boss defeat ticks 53-58 chain', (() => { const k = new Journal(); k.event('boss:defeated'); k.update(ctx()); return [53, 54, 55, 56, 57].every((n) => k.has(n)); })());
check('vault counts tick 42-47', (() => { const k = new Journal(); k.update(ctx({}, { raided: 3 })); return [42, 43, 44, 45, 46, 47].every((n) => k.has(n)); })());
console.log(`\nStrata objectives: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
