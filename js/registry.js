// Static tables: games, browser routes, launchable items, desktop icons, easter eggs.

export const GAMES = [
  {
    id: 'dom-ination', file: 'free_prizes.html', bookmark: 'free_prizes', component: 'popup_guard.sys',
    title: 'Congratulations!!! You won', effect: 'Fake ad pop-ups stop spawning.',
    lore: 'Something keeps opening windows.',
  },
  {
    id: 'inspect', file: 'bank_login.html', bookmark: 'bank_login', component: 'admin_access.dll',
    title: 'Secure Bank Login', effect: 'Settings is unlocked.',
    lore: 'Locked out of my own bank account?',
  },
  {
    id: 'wm404', file: 'recovery_tool.html', bookmark: 'recovery_tool', component: 'wm_core.exe',
    title: 'Recovery Tool', effect: 'Windows stop jittering. Resize handles enabled.',
    lore: "Windows won't stay where I put them.",
  },
];
/** Games with a lose condition that can be skipped after SKIP_AFTER shell-counted losses (FINAL_SPEC §5). */
export const SKIPPABLE = ['dom-ination', 'wm404'];
export const SKIP_AFTER = 2;
/** Inspect Element: the sudoku escape hatch appears after this much accumulated play (§6); the shell clamps one PLAYTIME message to PLAYTIME_CAP_MS. */
export const SUDOKU_AFTER_MS = 10 * 60 * 1000;
export const PLAYTIME_CAP_MS = 20000;
export const GAME_IDS = GAMES.map((g) => g.id);
export const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

/**
 * Bonus games: .exe files hidden in the Recycle Bin after the ending. They open in a plain game window (not Edgy) and NEVER count
 * toward integrity, corruption, repairs or the ending. `icon` is a sprite id (a-rocket), like every other icon in the shell.
 */
export const BONUS_GAMES = [
  {
    id: 'space-saga', file: 'SpaceSaga.exe', title: 'SpaceSaga', icon: 'a-rocket',
    src: 'games/space-saga/index.html', unlock: 'ending', eggPrefix: 'saga-',
    binLore: 'Deleted 03-03-2023. Reason: "too fun, employees stopped working."',
    binFrom: 'C:\\Games\\', binDate: '03-03-2023 04:20 PM', size: '4.7 MB', width: 1280, height: 760,
    restoredLore: 'Restored from the Recycle Bin. Productivity will suffer.',
  },
  {
    id: 'strata', file: 'Strata.exe', title: 'Strata', icon: 'a-pickaxe',
    src: 'games/strata/index.html', unlock: 'ending', saves: true, saveCap: 4 * 1024 * 1024, completes: true, completeToast: 'Strata.exe: kernel restored.', eggPrefix: 'strata-',
    binLore: 'Deleted 11-11-2011. Reason: "user spent 400 hours digging a hole."',
    binFrom: 'C:\\Games\\', binDate: '11-11-2011 11:11 AM', size: '38.2 MB', width: 1280, height: 760,
    restoredLore: 'Restored from the Recycle Bin. Please come up for air.',
  },
];
export const BONUS_IDS = BONUS_GAMES.map((g) => g.id);
export const BONUS_BY_ID = Object.fromEntries(BONUS_GAMES.map((g) => [g.id, g]));
/** Only games that declare `completes: true` may send GAME_COMPLETE (the shell stores the best time per difficulty). */
export const DIFFICULTIES = ['peaceful', 'normal', 'hard'];
/** The desktop icon of a restored bonus game. */
export const bonusDesktopIcon = (g) => ({ id: g.id, label: g.file, icon: g.icon, type: 'Application', size: g.size, lore: g.restoredLore, bonus: g.id });

const gameRoute = (id, url, src) => ({
  game: id,
  url: () => url,
  src: () => src,
  title: () => GAME_BY_ID[id].title,
});

/** Browser routes. url/src/title are functions of the (optional) search query. */
export const ROUTES = {
  home: { url: () => 'sys32://goggle', src: () => 'pages/search/index.html', title: () => 'Goggle' },
  search: {
    url: (q) => `sys32://goggle/search?q=${encodeURIComponent(q ?? '')}`,
    src: (q, fresh) => `pages/search/index.html?q=${encodeURIComponent(q ?? '')}${fresh ? '&fresh=1' : ''}`,
    title: (q) => `${q} - Goggle`,
  },
  offline: { url: () => 'sys32://offline', src: () => 'pages/offline/index.html', title: () => 'No internet' },
  crash: { url: () => 'sys32://vim', src: () => 'pages/crash/index.html', title: () => 'vim', hidden: true },
  'dom-ination': gameRoute('dom-ination', 'sys32://free-prizes', 'games/dom-ination/index.html'),
  inspect: gameRoute('inspect', 'sys32://bank-login', 'games/inspect-element/index.html'),
  wm404: gameRoute('wm404', 'sys32://recovery-tool', 'games/window-manager-404/index.html'),
};

/** Things the Start menu / recents / desktop can show. */
export const LAUNCH_ITEMS = {
  edgy: { label: 'Edgy', icon: 'a-edgy' },
  explorer: { label: 'File Explorer', icon: 'a-folder' },
  notepad: { label: 'Notepad', icon: 'a-text' },
  'recycle-bin': { label: 'Recycle Bin', icon: 'a-bin-full' },
  settings: { label: 'Settings', icon: 'a-settings' },
  'this-pc': { label: 'This PC', icon: 'a-pc' },
  readme: { label: 'README.txt', icon: 'a-text' },
  'thank-you': { label: 'thank_you.txt', icon: 'a-text' },
  ...Object.fromEntries(GAMES.map((g) => [g.id, { label: g.file, icon: 'a-html' }])),
  ...Object.fromEntries(BONUS_GAMES.map((g) => [g.id, { label: g.file, icon: g.icon }])),
};

export const DESKTOP_ICONS = [
  { id: 'this-pc', label: 'This PC', icon: 'a-pc', type: 'System Folder', size: '—', lore: 'Contains: you.' },
  { id: 'recycle-bin', label: 'Recycle Bin', icon: 'a-bin-full', type: 'System Folder', size: '—', lore: 'Nothing here is ever really gone.' },
  { id: 'readme', label: 'README.txt', icon: 'a-text', type: 'Text Document', size: '1 KB', lore: 'Written by the previous user. Probably in a hurry.' },
  ...GAMES.map((g) => ({
    id: g.id, label: g.file, icon: 'a-html', type: 'HTML Document', game: g.id,
    size: { 'dom-ination': '137 KB', inspect: '42 KB', wm404: '404 KB' }[g.id],
    lore: `Repairs ${g.component}. ${g.lore}`,
  })),
  { id: 'edgy', label: 'Edgy', icon: 'a-edgy', type: 'Application', size: '3.1 MB', lore: 'Edgy. Fast, secure, and entirely offline.' },
];

export const THANK_YOU_ICON = { id: 'thank-you', label: 'thank_you.txt', icon: 'a-text', type: 'Text Document', size: '2 KB', lore: 'Written by the next user. That is you.' };

/** Easter eggs: shell ones + Goggle ones (reported by the page through SHELL_EFFECT.egg). */
export const EGGS = [
  { id: 'bin-pc', name: 'Delete This PC', desc: 'You tried to delete This PC.' },
  { id: 'bin-game', name: 'Protected by the previous user', desc: 'You tried to bin a recovery file.' },
  { id: 'start-spam', name: 'Upside-down Start', desc: 'You clicked Start many times, fast.' },
  { id: 'shutdown-early', name: 'Updates pending', desc: 'You tried to shut down a broken system.' },
  { id: 'clock', name: 'Clock glitch', desc: 'You poked the clock.' },
  { id: 'konami', name: 'Icon orbit', desc: 'You entered the Konami code.' },
  { id: 'new-folder', name: 'Backwards progress', desc: 'You made a new folder.' },
  { id: 'notepad-hello', name: 'Notepad says hi', desc: 'You typed something into Notepad.' },
  { id: 'wifi', name: 'Pretty Fly for a Wi-Fi', desc: 'You clicked the Wi-Fi icon.' },
  { id: 'vim', name: 'Exit vim', desc: 'You searched for how to exit vim.' },
  { id: 'sudo', name: 'sudo', desc: 'You asked for sudo.' },
  { id: 'barrel-roll', name: 'Barrel roll', desc: 'You asked Goggle for a barrel roll.' },
  { id: 'forum', name: 'Forum threads', desc: 'You read the forum threads.' },
  { id: 'delete-system32', name: 'Delete System32', desc: 'You tried to delete System32.' },
  { id: 'did-you-mean', name: 'Did you mean: recursion', desc: 'Goggle suggested a correction.' },
  { id: 'dom-rude', name: 'Rude.', desc: 'You were rude to a pop-up.' },
  { id: 'dom-claim-all', name: 'Gullible', desc: 'You claimed every prize in DOM-ination.' },
  { id: 'dom-pacifist', name: 'Bold strategy', desc: 'You won DOM-ination a surprising way.' },
  { id: 'inspect-script-kiddie', name: 'Script kiddie', desc: 'You took the quick road in Inspect Element.' },
  { id: 'inspect-deleted-bank', name: 'You deleted the bank', desc: 'You deleted the bank page.' },
  { id: 'inspect-rich', name: 'The money is fake too', desc: 'You changed your balance.' },
  { id: 'inspect-wrong-door', name: 'A classic', desc: 'You opened the wrong door.' },
  { id: 'wm-offscreen', name: '404: window not found', desc: 'You lost a window off screen.' },
  { id: 'wm-bin-core', name: 'Absolutely not', desc: 'You binned a core fragment.' },
  { id: 'wm-hoarder', name: 'Cat pictures', desc: 'You gathered the cat pictures.' },
  { id: 'wm-matryoshka', name: 'Folders all the way down', desc: 'You went folders all the way down.' },
  // SpaceSaga (bonus game), reported with SHELL_EFFECT effect:'egg'
  { id: 'saga-404', name: 'Distance not found', desc: 'You ran into the unknown in SpaceSaga.' },
  { id: 'saga-popup', name: 'popup_guard.sys would be proud', desc: 'You hit a pop-up ad in SpaceSaga.' },
  { id: 'saga-afk', name: 'Taking a seat', desc: 'You sat still in SpaceSaga.' },
  // Strata (bonus game)
  { id: 'strata-adblock', name: 'Ad Block enabled', desc: 'You found the Ad Block ore.' },
  { id: 'strata-bedrock', name: "It's called bedrock", desc: 'You dug at the bottom of the world.' },
  { id: 'strata-cloud', name: 'Saved to cloud storage', desc: 'You built into the sky.' },
  { id: 'strata-complete', name: 'Garbage collection complete', desc: 'You beat the Garbage Collector.' },
  { id: 'strata-popup-adblock', name: 'Ad Block worked as intended', desc: 'You used the Ad Block on a pop-up.' },
  { id: 'strata-sleep-underlayer', name: 'Something is compiling', desc: 'You tried to sleep in the Underlayer.' },
  { id: 'strata-recycle', name: 'Protected by the previous user', desc: 'You tried to bin something in Strata.' },
];
export const EGG_IDS = new Set(EGGS.map((e) => e.id));

/**
 * Achievements (FINAL_SPEC §3.4). `by` = who unlocks it: 'shell' (the shell does, see js/achievements.js) or a game prefix (the game sends System32.achieve(id)).
 * `hidden` ones show as ??? until unlocked.
 */
export const ACHIEVEMENTS = [
  { id: 'boot', name: 'Hello, World', desc: 'Sign in for the first time.', icon: '👋' },
  { id: 'tutorial', name: 'RTFM', desc: 'Finish the Start Tutorial.', icon: '📖' },
  { id: 'fix-popup', name: 'Pop-up Blocker', desc: 'Repair popup_guard.sys.', icon: '🛡' },
  { id: 'fix-admin', name: 'sudo make me a sandwich', desc: 'Repair admin_access.dll.', icon: '🥪' },
  { id: 'fix-wm', name: 'Window Manager', desc: 'Repair wm_core.exe.', icon: '🪟' },
  { id: 'restored', name: 'System Restored', desc: 'Reach 100% integrity and restart.', icon: '💾' },
  { id: 'skip-1', name: 'Skill Issue', desc: 'Skip a puzzle.', icon: '↷' },
  { id: 'skip-2', name: 'Ctrl+Alt+Skip', desc: 'Skip both skippable puzzles.', icon: '⏭' },
  { id: 'sudoku', name: 'sudo ku', desc: 'Open the bank with the sudoku.', icon: '🔢' },
  { id: 'dom-clean', name: 'Clean Desktop', desc: 'Win DOM-ination with clutter never above 12.', icon: '🧹' },
  { id: 'inspect-3star', name: 'View Source', desc: 'Win Inspect Element with 3 stars.', icon: '⭐' },
  { id: 'wm-flawless', name: 'Zero Data Loss', desc: 'Win 404: Window Manager without losing a fragment.', icon: '🧩' },
  { id: 'no-skip', name: 'No Shortcuts', desc: 'Restore the system without skipping or using the sudoku.', icon: '🏁' },
  { id: 'bin-diver', name: 'Dumpster Diver', desc: 'Open a program from the Recycle Bin.', icon: '🗑' },
  { id: 'saga-1km', name: 'Escape Velocity', desc: 'Run 1,000 m in SpaceSaga.', icon: '🚀' },
  { id: 'saga-5km', name: 'Light Speed', desc: 'Run 5,000 m in SpaceSaga.', icon: '☄' },
  { id: 'strata-timber', name: 'Timber!', desc: 'Get your first log in Strata.', icon: '🪵' },
  { id: 'strata-iron', name: 'Iron Age', desc: 'Craft an iron pickaxe.', icon: '⛏' },
  { id: 'strata-underlayer', name: 'Below Bedrock', desc: 'Enter the Underlayer.', icon: '🕳' },
  { id: 'strata-key', name: 'Root Access', desc: 'Craft the Kernel Key.', icon: '🔑' },
  { id: 'strata-gc', name: 'Garbage Day', desc: 'Defeat the Garbage Collector.', icon: '🗑' },
  { id: 'secrets-all', name: 'Completionist', desc: 'Find every secret.', icon: '🏆', hidden: true },
];
export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));
/** The prefix a game may use for its achievements (and eggs). */
export const ACHIEVE_PREFIX = { 'dom-ination': 'dom-', inspect: 'inspect-', wm404: 'wm-', 'space-saga': 'saga-', strata: 'strata-' };

export const README_DEFAULT = `SYSTEM32 RECOVERY NOTES
-----------------------
If you are reading this, the system is falling apart.

Three components failed during the last update:
  - popup_guard.sys      (something keeps opening windows)
  - admin_access.dll     (locked out of my own bank account?)
  - wm_core.exe          (windows won't stay where I put them)

I left the recovery files on the desktop. They look like junk.
They are not junk.

Don't search for "how to exit vim". I'm serious.

- previous user
`;

export const ACCENTS = [
  { name: 'Azure', value: '#0067c0', light: '#4cc2ff' },
  { name: 'Orchid', value: '#8a3ab9', light: '#c38bff' },
  { name: 'Ember', value: '#c2410c', light: '#ffa46b' },
];
