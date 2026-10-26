// Achievements (FINAL_SPEC §3): the list is data in registry.js, unlocks are stored in the meta store (state.achievements, kept by Reset progress).
// The shell unlocks its own from bus events; games unlock theirs with System32.achieve(id), validated by prefix in gameWindow.js / browser.js.
import { bus } from './events.js';
import { state, save, migratedMeta, hadSavedState } from './state.js';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, EGGS, GAMES } from './registry.js';
import { toast } from './notifications.js';
import { play } from './sound.js';

export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const hasAchievement = (id) => id in state.achievements;
export const achievementCount = () => Object.keys(state.achievements).length;

/** Unlock an achievement. Returns true only the first time. `silent`: no toast (retroactive grants show one summary). */
export function achieve(id, { silent = false } = {}) {
  if (!ACHIEVEMENT_IDS.has(id) || hasAchievement(id)) return false;
  state.achievements[id] = Date.now();
  save();
  bus.emit('state:change', ['achievements']);
  bus.emit('achievement:unlocked', id);
  if (!silent) {
    play('achievement');
    toast({
      title: 'Achievements', kind: 'ok', emoji: '🏆', silent: true, text: `🏆 Achievement unlocked: ${ACH_BY_ID[id].name}`,
      onClick: () => bus.emit('achievements:open', { highlight: id }),
    });
  }
  return true;
}

const CHECK = { 'dom-ination': 'fix-popup', inspect: 'fix-admin', wm404: 'fix-wm' };

/** What an old save already proves (silently, then ONE toast). */
function retroactive() {
  const got = [];
  const give = (id) => { if (achieve(id, { silent: true })) got.push(id); };
  if (!state.firstVisit) give('boot');
  for (const [g, a] of Object.entries(CHECK)) if (state.repaired[g]) give(a);
  if (state.endingSeen) { give('restored'); if (state.noShortcuts) give('no-skip'); }
  if ((state.bonus.best['space-saga'] ?? 0) >= 1000) give('saga-1km');
  if ((state.bonus.best['space-saga'] ?? 0) >= 5000) give('saga-5km');
  if (state.bonus.completed.strata) give('strata-gc');
  if (state.eggsFound.length === EGGS.length) give('secrets-all');
  if (got.length) toast({ title: 'Achievements', kind: 'ok', emoji: '🏆', text: `🏆 ${got.length} achievement${got.length === 1 ? '' : 's'} unlocked from your previous progress.`, onClick: () => bus.emit('achievements:open', {}) });
}

export function initAchievements() {
  bus.on('repaired', (g) => { if (CHECK[g]) achieve(CHECK[g]); });
  bus.on('egg:found', () => { if (state.eggsFound.length === EGGS.length) achieve('secrets-all'); });
  bus.on('ending:seen', () => { achieve('restored'); if (state.noShortcuts) achieve('no-skip'); });
  bus.on('bin:open', () => achieve('bin-diver'));
  bus.on('puzzle:skipped', () => {
    const n = GAMES.filter((g) => state.skipped[g.id]).length;
    achieve('skip-1');
    if (n >= 2) achieve('skip-2');
  });
}

let retroDone = false;
/** Called once the desktop is up (the boot sequence clears toasts before that). */
export function grantRetroactive() {
  if (retroDone) return;
  retroDone = true;
  if (hadSavedState && migratedMeta) retroactive();
}
