// Bonus games, shell side: the unlock after the ending and the debug switch. (Storage helpers live in state.js, the bin row in apps/recycleBin.js,
// the game window in apps/gameWindow.js.) Bonus games never count toward integrity, repairs, corruption or the ending.
import { launch } from './events.js';
import { BONUS_GAMES } from './registry.js';
import { state, unlockBonus, isBonusUnlocked } from './state.js';
import { toast } from './notifications.js';

const onDesktop = () => document.body.dataset.phase === 'desktop';
let timer = 0;

/**
 * Called whenever the desktop appears. Once the ending is complete (the clean desktop after the restart) every `unlock: 'ending'`
 * bonus game is unlocked at once (so its bin row exists even if the page is closed early) and, 4 s later, ONE toast announces it.
 * The toast appears only on the unlocking visit: an already-unlocked game never triggers it again.
 */
export function announceBonus({ delay = 4000 } = {}) {
  if (!state.endingSeen) return;
  const fresh = BONUS_GAMES.filter((g) => g.unlock === 'ending' && !isBonusUnlocked(g.id));
  if (!fresh.length) return;
  fresh.forEach((g) => unlockBonus(g.id));
  clearTimeout(timer);
  const show = () => {
    if (!onDesktop()) { timer = setTimeout(show, 1000); return; }      // rebooting again: wait for the desktop
    toast({
      title: 'System32', kind: 'warn', duration: 12000,
      text: `🗑 Recycle Bin: ${fresh.length === 1 ? '1 item' : `${fresh.length} items`} could not be deleted.`,
      onClick: () => launch('recycle-bin'),
    });
  };
  timer = setTimeout(show, delay);
}

/** Debug: `?unlockBonus=1` on the shell URL unlocks every bonus game without playing the ending (tests, and the author). */
export function debugUnlock() {
  if (new URLSearchParams(location.search).get('unlockBonus') !== '1') return;
  BONUS_GAMES.forEach((g) => unlockBonus(g.id));
}
