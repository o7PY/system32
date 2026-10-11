// Single progress store, persisted to localStorage (falls back to memory if storage is unavailable).
import { bus } from './events.js';
import { GAME_IDS, README_DEFAULT, EGG_IDS } from './registry.js';

const KEY = 'system32.state';
const VERSION = 1;

const defaults = () => ({
  version: VERSION,
  firstVisit: true,
  repaired: Object.fromEntries(GAME_IDS.map((id) => [id, false])),
  bestTimes: {},                // gameId -> ms
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
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved && saved.version === VERSION ? saved : null;
  } catch {
    return null;
  }
}

function merge(saved) {
  const base = defaults();
  if (!saved) return base;
  return { ...base, ...saved, repaired: { ...base.repaired, ...(saved.repaired ?? {}) } };
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
  bus.emit('state:reset');
  bus.emit('state:change', ['*']);
}
