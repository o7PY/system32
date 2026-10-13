// World saves for bonus games that opt in with `saves: true` (Strata). Each game gets its OWN localStorage key, `system32.save.<gameId>`,
// so a big world can never break the shell's own state object. Hard cap per game, every write wrapped in try/catch.
import { bus } from './events.js';

export const SAVE_PREFIX = 'system32.save.';
export const SAVE_CAP = 1.5 * 1024 * 1024;                       // string length, per game
export const saveKey = (id) => SAVE_PREFIX + id;

export function readGameSave(id) {
  try {
    const v = localStorage.getItem(saveKey(id));
    return typeof v === 'string' ? v : null;
  } catch { return null; }
}

/** @returns {{ok: boolean, bytes: number, error?: 'invalid'|'too-large'|'quota'}} nothing is written unless ok */
export function writeGameSave(id, data) {
  if (typeof data !== 'string') return { ok: false, bytes: 0, error: 'invalid' };
  const bytes = data.length;
  if (bytes > SAVE_CAP) return { ok: false, bytes, error: 'too-large' };
  try {
    localStorage.setItem(saveKey(id), data);                      // a failed setItem leaves the old save intact
  } catch { return { ok: false, bytes, error: 'quota' }; }
  bus.emit('save:change', id);
  return { ok: true, bytes };
}

export const gameSaveBytes = (id) => readGameSave(id)?.length ?? 0;

export function deleteGameSave(id) {
  try { localStorage.removeItem(saveKey(id)); } catch { /* storage unavailable */ }
  bus.emit('save:change', id);
}

/** Reset progress: every `system32.save.*` key, including ones of games this build does not know. */
export function deleteAllGameSaves() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(SAVE_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
  bus.emit('save:change', '*');
}
