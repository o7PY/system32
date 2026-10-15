// Strata worlds list, no browser: the container format, names, limits, migration of an old single-world save.   node tests/strata/worlds.mjs
import { parseStore, packStore, emptyStore, persistable, addWorld, getWorld, removeWorld, renameWorld, freeName, cleanName, MAX_WORLDS, MAGIC, LEGACY } from '../../games/strata/src/worlds.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const data = (n) => `${LEGACY}z:${n}`;

check('no save and an empty string mean no worlds', parseStore(null).worlds.length === 0 && parseStore('').worlds.length === 0 && parseStore(undefined).last === null);
const old = parseStore(data('old'));
check('a save from before worlds existed becomes one world called "World 1", data untouched', old.worlds.length === 1 && old.worlds[0].name === 'World 1' && old.worlds[0].data === data('old') && old.last === 'w1');
check('anything else is refused with an error', (() => { try { parseStore('hello'); return false; } catch { return true; } })() && (() => { try { parseStore(MAGIC + '{oops'); return false; } catch { return true; } })() && (() => { try { parseStore(MAGIC + '{"worlds":5}'); return false; } catch { return true; } })());

const s = emptyStore();
const a = addWorld(s, { name: 'Home', mode: 'survival', difficulty: 'hard', now: 100 });
a.data = data('a');
const b = addWorld(s, { name: '', mode: 'creative', now: 200 });
b.data = data('b');
check('worlds get ids, names ("World 2" for a blank), mode and difficulty; the newest is the last one', a.id === 'w1' && b.id === 'w2' && b.name === 'World 2' && b.mode === 'creative' && a.difficulty === 'hard' && s.last === 'w2');
check('a taken name gets a number (case does not matter) and names are cut to 24 characters, without control characters or <>', addWorld(s, { name: 'home' }).name === 'home (2)' && cleanName('  a\n<b>\t c  ') === 'a b c' && cleanName('x'.repeat(40)).length === 24 && freeName(s, 'x'.repeat(40)).length <= 24);
const back = parseStore(packStore(persistable(s)));
check('save and load again: the same worlds in the same order (a world without data is not written)', back.worlds.map((w) => w.id).join() === 'w1,w2' && back.worlds[0].data === data('a') && back.worlds[1].mode === 'creative' && back.last === 'w1' && packStore(s).startsWith(MAGIC));
check('rename: a free name sticks, a taken name is numbered, a blank keeps the old one', renameWorld(s, 'w1', 'Castle') && getWorld(s, 'w1').name === 'Castle' && renameWorld(s, 'w1', 'World 2') && getWorld(s, 'w1').name === 'World 2 (2)' && renameWorld(s, 'w1', '  ') && getWorld(s, 'w1').name === 'World 2 (2)' && !renameWorld(s, 'nope', 'x'));
getWorld(s, 'w1').played = 900; getWorld(s, 'w2').played = 50; s.worlds.filter((w) => w.id !== 'w1' && w.id !== 'w2').forEach((w) => { w.played = 1; }); s.last = 'w2';
check('delete: the world is gone, "last" moves to the most recently played, deleting an unknown id does nothing', removeWorld(s, 'w2') && s.last === 'w1' && !getWorld(s, 'w2') && !removeWorld(s, 'w2'));
check('the list is limited to 10 worlds', (() => { const t = emptyStore(); for (let i = 0; i < MAX_WORLDS; i++) if (!addWorld(t, { name: `W${i}` })) return false; return addWorld(t, { name: 'one more' }) === null && MAX_WORLDS === 10; })());
check('a new id never reuses one that is taken, even after deleting', (() => { const t = emptyStore(); addWorld(t, {}); addWorld(t, {}); addWorld(t, {}); removeWorld(t, 'w2'); return addWorld(t, {}).id === 'w4'; })());
const odd = parseStore(MAGIC + JSON.stringify({ worlds: [{ id: 'x', name: '<b>Evil</b>', data: 'not a world' }, { id: 'y', name: 'Fine', mode: 'weird', data: data('y') }], last: 'zzz' }));
check('damaged entries are dropped, odd modes cleared, an unknown "last" falls back to a real world', odd.worlds.length === 1 && odd.worlds[0].name === 'Fine' && odd.worlds[0].mode === '' && odd.last === 'y');
console.log(`\nStrata worlds: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
