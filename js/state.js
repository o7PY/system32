// Single progress store, persisted to localStorage (falls back to memory if storage is unavailable).
import { bus } from './events.js';
import { GAME_IDS, README_DEFAULT, EGG_IDS, BONUS_IDS, DIFFICULTIES, ACHIEVEMENT_IDS } from './registry.js';
import { deleteAllGameSaves } from './saves.js';

// Three stores. `system32.state` = game state (wiped by Reset progress); `system32.meta` = what the player earned and prefers (achievements, secrets, bonus games, sound,
// accent, theme: kept by Reset progress, wiped by Hard reset); `system32.save.<gameId>` = world saves (js/saves.js). In memory it is ONE `state` object; save() splits it.
const KEY = 'system32.state';
const META_KEY = 'system32.meta';
const VERSION = 3;                // 2: adds `bonus`; 3: adds the meta store, losses, skips, playtime, tutorial. Older saves are migrated, not dropped.
/** The fields that live in system32.meta. */
export const META_FIELDS = ['achievements', 'eggsFound', 'bonus', 'soundOn', 'accent', 'theme'];

const defaults = () => ({
  version: VERSION,
  firstVisit: true,
  repaired: Object.fromEntries(GAME_IDS.map((id) => [id, false])),
  bestTimes: {},                // gameId -> ms
  bestScores: {},               // gameId -> best score (higher is better), sent to games as `best`
  unlockedBookmarks: [],        // gameIds opened at least once
  iconPositions: {},            // iconId -> {col,row}
  readmeText: README_DEFAULT,
  soundOn: false,               // spec §12: sound is off by default
  offlineHighScore: 0,
  endingSeen: false,
  eggsFound: [],                // easter egg ids (META)
  achievements: {},             // META: id -> unlocked-at (ms)
  losses: {},                   // gameId -> losses counted by the shell (dom-ination, wm404): 2 unlock Skip puzzle
  skipped: {},                  // gameId -> true when the component was repaired by skipping (cleared by a real win)
  playtime: {},                 // gameId -> ms of unpaused play (inspect: the sudoku escape hatch after 10 minutes)
  noShortcuts: true,            // still true while no puzzle was skipped and the sudoku was not used (for `no-skip`)
  tutorial: { seen: false, steps: {}, skipped: {}, opened: [], done: false },   // Recovery Guide progress (restarts with Reset progress)
  recent: [],                   // launch ids, most recent first
  extraIcons: [],               // desktop icons created by the user ("New folder (corrupted)")
  iconSize: 'medium',
  accent: 0,
  theme: 'system',              // system | light | dark
  // Bonus games never touch repaired/integrity/ending. unlocked: in the Recycle Bin or restored; restored: on the desktop + Start;
  // seen: the bin row has been shown highlighted once; best: gameId -> best score (sent to the game as `best`).
  // completed: gameId -> { timeMs, deaths, difficulty, at, byDifficulty: { <difficulty>: { timeMs, deaths, at } } } (the fastest overall + the best per difficulty)
  bonus: { unlocked: [], restored: [], seen: [], best: {}, completed: {} },
});

function read(key = KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Version 1 saves (before bonus games) are accepted and migrated by merge(); a save from the future is ignored.
    return saved && typeof saved === 'object' && Number.isInteger(saved.version) && saved.version >= 1 && saved.version <= VERSION ? saved : null;
  } catch {
    return null;
  }
}
const cleanMap = (v, pred) => Object.fromEntries(Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).filter(([k, x]) => GAME_IDS.includes(k) && pred(x)));
const cleanAch = (v) => Object.fromEntries(Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).filter(([k, t]) => ACHIEVEMENT_IDS.has(k) && Number.isFinite(t)));
const cleanTutorial = (t) => {
  const o = t && typeof t === 'object' ? t : {};
  const flags = (m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => /^\d{1,2}$/.test(k) && v === true));
  return { seen: o.seen === true, steps: flags(o.steps), skipped: flags(o.skipped), opened: Array.isArray(o.opened) ? o.opened.filter((x) => GAME_IDS.includes(x)) : [], done: o.done === true };
};

const idList = (v) => (Array.isArray(v) ? v.filter((x) => BONUS_IDS.includes(x)) : []);
const cleanRun = (r) => (r && Number.isFinite(r.timeMs) && r.timeMs >= 0 && Number.isFinite(r.deaths) && r.deaths >= 0 && Number.isFinite(r.at) ? { timeMs: Math.round(r.timeMs), deaths: Math.floor(r.deaths), at: r.at } : null);
const cleanCompleted = (v) => {
  const out = {};
  for (const [k, c] of Object.entries(v && typeof v === 'object' ? v : {})) {
    if (!BONUS_IDS.includes(k) || !c || typeof c !== 'object') continue;
    const by = {};
    for (const d of DIFFICULTIES) { const r = cleanRun(c.byDifficulty?.[d]); if (r) by[d] = r; }
    const top = cleanRun(c);
    if (top && DIFFICULTIES.includes(c.difficulty)) out[k] = { ...top, difficulty: c.difficulty, byDifficulty: by };
  }
  return out;
};
const cleanBest = (v) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k, n]) => BONUS_IDS.includes(k) && Number.isFinite(n) && n >= 0));

/** `saved` = the state store, `meta` = the meta store (or null: first run of the split, the fields are taken from the old state). */
function merge(saved, meta) {
  const base = defaults();
  if (!saved && !meta) return base;
  const src = { ...(saved ?? {}), ...Object.fromEntries(META_FIELDS.filter((k) => meta && k in meta).map((k) => [k, meta[k]])) };       // meta wins for its own fields
  const b = src.bonus && typeof src.bonus === 'object' ? src.bonus : {};          // missing field (old save) -> empty
  const s = saved ?? {};
  const out = {
    ...base, ...src, version: VERSION,
    repaired: Object.fromEntries(GAME_IDS.map((id) => [id, (s.repaired ?? {})[id] === true])),            // removed games (specificity) fall away
    bestTimes: cleanMap(s.bestTimes, Number.isFinite), bestScores: cleanMap(s.bestScores, Number.isFinite),
    unlockedBookmarks: (Array.isArray(s.unlockedBookmarks) ? s.unlockedBookmarks : []).filter((x) => GAME_IDS.includes(x)),
    eggsFound: (Array.isArray(src.eggsFound) ? src.eggsFound : []).filter((x) => EGG_IDS.has(x)),
    bonus: { unlocked: idList(b.unlocked), restored: idList(b.restored), seen: idList(b.seen), best: cleanBest(b.best), completed: cleanCompleted(b.completed) },
    achievements: cleanAch(src.achievements),
    losses: cleanMap(s.losses, (n) => Number.isInteger(n) && n >= 0), skipped: cleanMap(s.skipped, (v) => v === true), playtime: cleanMap(s.playtime, (n) => Number.isFinite(n) && n >= 0),
    noShortcuts: s.noShortcuts !== false && !Object.keys(cleanMap(s.skipped, (v) => v === true)).length,
    tutorial: cleanTutorial(s.tutorial),
  };
  return out;
}

const savedState = read();
const savedMeta = read(META_KEY);
/** Live state object. Mutate through the helpers below (or call save() after editing). */
export const state = merge(savedState, savedMeta);
/** True when this browser already had saved state (a returning visitor). */
export const hadSavedState = savedState !== null || savedMeta !== null;
/** True when the meta store was just created from a pre-split save (achievements are granted retroactively, once). */
export const migratedMeta = savedState !== null && savedMeta === null;

const pick = (keys, invert = false) => Object.fromEntries(Object.keys(state).filter((k) => keys.includes(k) !== invert).map((k) => [k, state[k]]));
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pick(META_FIELDS, true)));
    localStorage.setItem(META_KEY, JSON.stringify({ version: VERSION, ...pick(META_FIELDS) }));
  } catch { /* storage unavailable: keep running in memory */ }
}

export function set(patch) {
  Object.assign(state, patch);
  save();
  bus.emit('state:change', Object.keys(patch));
}

export const repairedCount = () => GAME_IDS.filter((id) => state.repaired[id]).length;
export const allRepaired = () => repairedCount() === GAME_IDS.length;
export const integrity = () => Math.round((repairedCount() / GAME_IDS.length) * 100);

/** Mark a game's component repaired. Returns true only the first time. */
export function repair(gameId) {
  if (!GAME_IDS.includes(gameId) || state.repaired[gameId]) return false;
  state.repaired[gameId] = true;
  save();
  bus.emit('state:change', ['repaired']);
  bus.emit('repaired', gameId);
  return true;
}

/** Records a best (lowest) time. Returns true if it is a new best. */
export function recordTime(gameId, ms) {
  if (!GAME_IDS.includes(gameId) || !Number.isFinite(ms) || ms <= 0) return false;
  const prev = state.bestTimes[gameId];
  if (prev !== undefined && prev <= ms) return false;
  state.bestTimes[gameId] = Math.round(ms);
  save();
  bus.emit('state:change', ['bestTimes']);
  return true;
}

/**
 * A bonus game was beaten. Keeps the best (fastest) time per difficulty and the fastest overall.
 * @returns {{first: boolean, improved: boolean}|null} null when the report is invalid
 */
export function recordBonusComplete(id, { timeMs, deaths, difficulty }) {
  if (!BONUS_IDS.includes(id) || !DIFFICULTIES.includes(difficulty) || !Number.isFinite(timeMs) || timeMs < 1 || !Number.isFinite(deaths) || deaths < 0) return null;
  const run = { timeMs: Math.round(timeMs), deaths: Math.floor(deaths), at: Date.now() };
  const prev = state.bonus.completed[id];
  const byDifficulty = { ...(prev?.byDifficulty ?? {}) };
  const improved = !byDifficulty[difficulty] || run.timeMs < byDifficulty[difficulty].timeMs;
  if (improved) byDifficulty[difficulty] = run;
  const top = !prev || run.timeMs < prev.timeMs ? { ...run, difficulty } : { timeMs: prev.timeMs, deaths: prev.deaths, at: prev.at, difficulty: prev.difficulty };
  state.bonus.completed[id] = { ...top, byDifficulty };
  save();
  bus.emit('state:change', ['bonus']);
  bus.emit('bonus:completed', id);
  return { first: !prev, improved };
}

/** Records a best (highest) score. Returns true if it is a new best. */
export function recordScore(gameId, score) {
  if (!GAME_IDS.includes(gameId) || !Number.isFinite(score) || score < 0) return false;
  const prev = state.bestScores[gameId];
  if (prev !== undefined && prev >= score) return false;
  state.bestScores[gameId] = Math.round(score);
  save();
  bus.emit('state:change', ['bestScores']);
  return true;
}

/* ---------- bonus games ---------- */
export const isBonusUnlocked = (id) => state.bonus.unlocked.includes(id);
export const isBonusCompleted = (id) => !!state.bonus.completed[id];
export const isBonusRestored = (id) => state.bonus.restored.includes(id);

/** Unlock a bonus game (it appears in the Recycle Bin). Returns true only the first time. */
export function unlockBonus(id) {
  if (!BONUS_IDS.includes(id) || isBonusUnlocked(id)) return false;
  state.bonus.unlocked.push(id);
  save();
  bus.emit('state:change', ['bonus']);
  bus.emit('bonus:unlocked', id);
  return true;
}

/** Restore a bonus game from the bin to the desktop + Start menu. Returns true if it moved. */
export function restoreBonus(id) {
  if (!isBonusUnlocked(id) || isBonusRestored(id)) return false;
  state.bonus.restored.push(id);
  save();
  bus.emit('state:change', ['bonus']);
  bus.emit('bonus:restored', id);
  return true;
}

/** Put a restored bonus game back in the bin (deleting its desktop icon). */
export function binBonus(id) {
  if (!isBonusRestored(id)) return false;
  state.bonus.restored = state.bonus.restored.filter((x) => x !== id);
  save();
  bus.emit('state:change', ['bonus']);
  return true;
}

export function markBonusSeen(id) {
  if (state.bonus.seen.includes(id)) return;
  state.bonus.seen.push(id);
  save();
}

/** Records a best (highest) score of a bonus game. Returns true if it is a new best (score > 0 and above the old best). */
export function recordBonusBest(id, score) {
  if (!BONUS_IDS.includes(id) || !Number.isFinite(score) || score <= 0) return false;
  const prev = state.bonus.best[id];
  if (prev !== undefined && prev >= score) return false;
  state.bonus.best[id] = Math.round(score);
  save();
  bus.emit('state:change', ['bonus']);
  return true;
}

export function unlock(gameId) {
  if (!GAME_IDS.includes(gameId) || state.unlockedBookmarks.includes(gameId)) return;
  state.unlockedBookmarks.push(gameId);
  save();
  bus.emit('state:change', ['unlockedBookmarks']);
}

/** Returns true the first time an egg is found. */
export function foundEgg(id) {
  if (!EGG_IDS.has(id) || state.eggsFound.includes(id)) return false;
  state.eggsFound.push(id);
  save();
  bus.emit('state:change', ['eggsFound']);
  bus.emit('egg:found', id);
  return true;
}

export function addRecent(id) {
  state.recent = [id, ...state.recent.filter((r) => r !== id)].slice(0, 6);
  save();
  bus.emit('state:change', ['recent']);
}

/** Reset progress: only the game state goes (repairs, losses, tutorial, icon positions, README ...). Achievements, secrets, bonus games, settings and world saves stay. */
export function reset() {
  const keep = pick(META_FIELDS);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, defaults(), keep, { firstVisit: false });
  save();
  bus.emit('state:reset');
  bus.emit('state:change', ['*']);
}

/** Hard reset: every system32.* key (state, meta, world saves). The page reloads into a first visit. */
export function hardReset() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith('system32.')) localStorage.removeItem(k); }
  } catch { /* storage unavailable */ }
  deleteAllGameSaves();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, defaults());
  bus.emit('state:reset');
}
