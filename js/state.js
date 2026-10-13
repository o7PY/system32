// Single progress store, persisted to localStorage (falls back to memory if storage is unavailable).
import { bus } from './events.js';
import { GAME_IDS, README_DEFAULT, EGG_IDS, BONUS_IDS } from './registry.js';
import { deleteAllGameSaves } from './saves.js';

const KEY = 'system32.state';
const VERSION = 2;                // 2: adds `bonus` (bonus games). Version-1 saves are migrated, not dropped.

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
  eggsFound: [],                // easter egg ids, shown in Settings as "Secrets: n/N"
  recent: [],                   // launch ids, most recent first
  extraIcons: [],               // desktop icons created by the user ("New folder (corrupted)")
  iconSize: 'medium',
  accent: 0,
  theme: 'system',              // system | light | dark
  // Bonus games never touch repaired/integrity/ending. unlocked: in the Recycle Bin or restored; restored: on the desktop + Start;
  // seen: the bin row has been shown highlighted once; best: gameId -> best score (sent to the game as `best`).
  bonus: { unlocked: [], restored: [], seen: [], best: {} },
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Version 1 saves (before bonus games) are accepted and migrated by merge(); a save from the future is ignored.
    return saved && Number.isInteger(saved.version) && saved.version >= 1 && saved.version <= VERSION ? saved : null;
  } catch {
    return null;
  }
}

const idList = (v) => (Array.isArray(v) ? v.filter((x) => BONUS_IDS.includes(x)) : []);
const cleanBest = (v) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k, n]) => BONUS_IDS.includes(k) && Number.isFinite(n) && n >= 0));

function merge(saved) {
  const base = defaults();
  if (!saved) return base;
  const b = saved.bonus && typeof saved.bonus === 'object' ? saved.bonus : {};          // missing field (old save) -> empty
  return {
    ...base, ...saved, version: VERSION,
    repaired: { ...base.repaired, ...(saved.repaired ?? {}) },
    bonus: { unlocked: idList(b.unlocked), restored: idList(b.restored), seen: idList(b.seen), best: cleanBest(b.best) },
  };
}

const saved = read();
/** Live state object. Mutate through the helpers below (or call save() after editing). */
export const state = merge(saved);
/** True when this browser already had saved state (a returning visitor). */
export const hadSavedState = saved !== null;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
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

export function reset() {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, defaults());
  save();
  deleteAllGameSaves();                          // bonus game worlds go too
  bus.emit('state:reset');
  bus.emit('state:change', ['*']);
}
