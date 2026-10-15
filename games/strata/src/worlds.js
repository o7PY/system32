// Several worlds in one shell save slot. The shell keeps ONE string per game, so the string is a small container:
//   "STRATAW1:" + JSON { v: 1, last: <id>, worlds: [ { id, name, mode, difficulty, created, played, data } ] }       (data = one STRATA1 world, see save.js)
// A save from before worlds existed ("STRATA1:...") is read as a single world called "World 1" and becomes a container with the next write.
// Pure functions, no DOM: the Node tests import them.
export const MAGIC = 'STRATAW1:';
export const LEGACY = 'STRATA1:';
export const MAX_WORLDS = 10;
export const NAME_MAX = 24;

export const emptyStore = () => ({ v: 1, last: null, worlds: [] });

/** The container in a saved string (null or '' = no worlds). Throws an Error for a string that is neither a container nor a single world. */
export function parseStore(str) {
  if (!str) return emptyStore();
  if (str.startsWith(LEGACY)) return { v: 1, last: 'w1', worlds: [{ id: 'w1', name: 'World 1', mode: '', difficulty: '', created: 0, played: 0, data: str }] };
  if (!str.startsWith(MAGIC)) throw new Error('not a Strata save');
  let o;
  try { o = JSON.parse(str.slice(MAGIC.length)); } catch { throw new Error('the world list is damaged'); }
  if (!o || !Array.isArray(o.worlds)) throw new Error('the world list is damaged');
  const worlds = o.worlds.filter((w) => w && typeof w.id === 'string' && typeof w.data === 'string' && w.data.startsWith(LEGACY)).slice(0, MAX_WORLDS).map((w) => ({
    id: w.id, name: cleanName(w.name) || 'World', mode: w.mode === 'creative' ? 'creative' : w.mode === 'survival' ? 'survival' : '', difficulty: typeof w.difficulty === 'string' ? w.difficulty : '',
    created: Number(w.created) || 0, played: Number(w.played) || 0, data: w.data,
  }));
  return { v: 1, last: worlds.some((w) => w.id === o.last) ? o.last : (worlds.at(-1)?.id ?? null), worlds };
}

export const packStore = (store) => MAGIC + JSON.stringify({ v: 1, last: store.last, worlds: store.worlds });

export function cleanName(s) { return String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }

/** A name nobody uses yet: "World 3" for a blank, "Home (2)" for a taken one. */
export function freeName(store, wanted, except = null) {
  const used = new Set(store.worlds.filter((w) => w.id !== except).map((w) => w.name.toLowerCase()));
  let base = cleanName(wanted);
  if (!base) { let n = store.worlds.length + 1; while (used.has(`world ${n}`)) n++; return `World ${n}`; }
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) { const suf = ` (${n++})`; name = base.slice(0, NAME_MAX - suf.length) + suf; }
  return name;
}

export function newId(store) {
  let n = store.worlds.length + 1;
  while (store.worlds.some((w) => w.id === `w${n}`)) n++;
  return `w${n}`;
}

/** Add an empty world (its data comes with the first save). Returns the entry, or null when the list is full. */
export function addWorld(store, { name, mode, difficulty, now = Date.now() }) {
  if (store.worlds.length >= MAX_WORLDS) return null;
  const w = { id: newId(store), name: freeName(store, name), mode: mode === 'creative' ? 'creative' : 'survival', difficulty: difficulty || 'normal', created: now, played: now, data: '' };
  store.worlds.push(w); store.last = w.id;
  return w;
}

export const getWorld = (store, id) => store.worlds.find((w) => w.id === id) ?? null;

export function removeWorld(store, id) {
  const i = store.worlds.findIndex((w) => w.id === id);
  if (i < 0) return false;
  store.worlds.splice(i, 1);
  if (store.last === id) store.last = [...store.worlds].sort((a, b) => b.played - a.played)[0]?.id ?? null;
  return true;
}

export function renameWorld(store, id, name) {
  const w = getWorld(store, id);
  if (!w) return false;
  w.name = freeName(store, cleanName(name) || w.name, id);
  return true;
}

/** The container as it will be written: worlds that never got a first save are left out (a world exists once it has been saved). */
export const persistable = (store) => ({ ...store, worlds: store.worlds.filter((w) => w.data), last: store.worlds.some((w) => w.data && w.id === store.last) ? store.last : (store.worlds.find((w) => w.data)?.id ?? null) });
