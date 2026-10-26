// Single place that knows how to open each app/file by id (desktop, Start, Explorer all go through here).
import { bus } from './events.js';
import { WM } from './WindowManager.js';
import { state, addRecent } from './state.js';
import { GAME_BY_ID, GAMES, LAUNCH_ITEMS, EGGS, BONUS_BY_ID } from './registry.js';
import { fmtTime } from './ui.js';
import { openBrowser } from './apps/browser.js';
import { openNotepad } from './apps/notepad.js';
import { openExplorer } from './apps/explorer.js';
import { openRecycleBin } from './apps/recycleBin.js';
import { openSettings } from './apps/settings.js';
import { openGameWindow } from './apps/gameWindow.js';
import { openTutorial } from './apps/tutorial.js';
import { openCorruptedFolder } from './desktop.js';

function thankYouText() {
  const rows = GAMES.map((g) => {
    const t = state.bestTimes[g.id];
    return `  ${g.file.padEnd(26)}${t ? fmtTime(t) : '--:--.-'}`;
  });
  return [
    'THANK YOU',
    '---------',
    'System32 is repaired. All three components are running again.',
    'The windows stay where you put them. The pop-ups have stopped.',
    'Nobody has ever exited vim.',
    '',
    'Best times',
    ...rows,
    '',
    `Secrets found: ${state.eggsFound.length}/${EGGS.length}`,
    '',
    '- the previous user',
    '  (you can stop worrying now)',
    '',
  ].join('\n');
}

function open(id, opts) {
  switch (id) {
    case 'explorer': openExplorer({ path: opts.path ?? 'home' }); break;
    case 'this-pc': openExplorer({ path: 'this-pc' }); break;
    case 'recycle-bin': openRecycleBin(); break;
    case 'notepad': openNotepad(); break;
    case 'readme': openNotepad({ doc: 'readme' }); break;
    case 'thank-you': openNotepad({ doc: 'thank-you', title: 'thank_you.txt', text: thankYouText(), readOnly: true }); break;
    case 'edgy': openBrowser({ route: 'home' }); break;
    case 'search': openBrowser({ route: 'search', query: opts.query ?? '', fresh: true }); break;
    case 'settings': openSettings(); break;
    case 'tutorial': openTutorial(); break;
    case 'new-folder': openCorruptedFolder(); break;
    default:
      if (BONUS_BY_ID[id]) { openGameWindow(id); break; }       // bonus .exe: a plain game window, not Edgy
      if (GAME_BY_ID[id]) {
        const existing = WM.windows.find((w) => w.meta.game === id);
        if (existing) existing.focus(); else openBrowser({ route: id });
      }
  }
}

export function initLauncher() {
  bus.on('launch', (id, opts = {}) => {
    try {
      open(id, opts);
      const recent = id === 'search' ? 'edgy' : id;      // a Start-menu search opens Edgy
      if (LAUNCH_ITEMS[recent]) addRecent(recent);
    } catch (err) {
      console.error(`[launcher] failed to open "${id}"`, err);
    }
  });
}
