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
    id: 'specificity', file: 'styles_FINAL_v2.html', bookmark: 'styles_FINAL', component: 'theme.dll',
    title: 'styles_FINAL_v2', effect: 'Glitch filters removed. Personalize works.',
    lore: 'The stylesheets are fighting each other.',
  },
  {
    id: 'wm404', file: 'recovery_tool.html', bookmark: 'recovery_tool', component: 'wm_core.exe',
    title: 'Recovery Tool', effect: 'Windows stop jittering. Resize handles enabled.',
    lore: "Windows won't stay where I put them.",
  },
];
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
    src: 'games/strata/index.html', unlock: 'ending', saves: true, eggPrefix: 'strata-',
    binLore: 'Deleted 11-11-2011. Reason: "user spent 400 hours digging a hole."',
    binFrom: 'C:\\Games\\', binDate: '11-11-2011 11:11 AM', size: '38.2 MB', width: 1280, height: 760,
    restoredLore: 'Restored from the Recycle Bin. Please come up for air.',
  },
];
export const BONUS_IDS = BONUS_GAMES.map((g) => g.id);
export const BONUS_BY_ID = Object.fromEntries(BONUS_GAMES.map((g) => [g.id, g]));
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
  specificity: gameRoute('specificity', 'sys32://styles-final-v2', 'games/specificity-wars/index.html'),
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
    size: { 'dom-ination': '137 KB', inspect: '42 KB', specificity: '88 KB', wm404: '404 KB' }[g.id],
    lore: `Repairs ${g.component}. ${g.lore}`,
  })),
  { id: 'edgy', label: 'Edgy', icon: 'a-edgy', type: 'Application', size: '3.1 MB', lore: 'Edgy. Fast, secure, and entirely offline.' },
];

export const THANK_YOU_ICON = { id: 'thank-you', label: 'thank_you.txt', icon: 'a-text', type: 'Text Document', size: '2 KB', lore: 'Written by the next user. That is you.' };

/** Easter eggs: shell ones + Goggle ones (reported by the page through SHELL_EFFECT.egg). */
export const EGGS = [
  { id: 'bin-pc', name: 'Delete This PC' },
  { id: 'bin-game', name: 'Protected by the previous user' },
  { id: 'start-spam', name: 'Upside-down Start' },
  { id: 'shutdown-early', name: 'Updates pending' },
  { id: 'clock', name: 'Clock glitch' },
  { id: 'konami', name: 'Icon orbit' },
  { id: 'new-folder', name: 'Backwards progress' },
  { id: 'notepad-hello', name: 'Notepad says hi' },
  { id: 'wifi', name: 'Pretty Fly for a Wi-Fi' },
  { id: 'vim', name: 'Exit vim' },
  { id: 'sudo', name: 'sudo' },
  { id: 'barrel-roll', name: 'Barrel roll' },
  { id: 'forum', name: 'Forum threads' },
  { id: 'delete-system32', name: 'Delete System32' },
  { id: 'did-you-mean', name: 'Did you mean: recursion' },
  { id: 'dom-rude', name: 'Rude.' },
  { id: 'dom-claim-all', name: 'Gullible' },
  { id: 'dom-pacifist', name: 'Bold strategy' },
  { id: 'inspect-script-kiddie', name: 'Script kiddie' },
  { id: 'inspect-deleted-bank', name: 'You deleted the bank' },
  { id: 'inspect-rich', name: 'The money is fake too' },
  { id: 'inspect-wrong-door', name: 'A classic' },
  { id: 'spec-nuke', name: 'The nuclear option' },
  { id: 'spec-devtools', name: 'Inspect Element veteran' },
  { id: 'spec-has', name: 'Look at you, using :has()' },
  { id: 'spec-overkill', name: 'Overkill' },
  { id: 'wm-offscreen', name: '404: window not found' },
  { id: 'wm-bin-core', name: 'Absolutely not' },
  { id: 'wm-hoarder', name: 'Cat pictures' },
  { id: 'wm-matryoshka', name: 'Folders all the way down' },
  // SpaceSaga (bonus game), reported with SHELL_EFFECT effect:'egg'
  { id: 'saga-404', name: 'Distance not found' },
  { id: 'saga-popup', name: 'popup_guard.sys would be proud' },
  { id: 'saga-afk', name: 'Taking a seat' },
  // Strata (bonus game)
  { id: 'strata-adblock', name: 'Ad Block enabled' },
  { id: 'strata-bedrock', name: "It's called bedrock" },
  { id: 'strata-cloud', name: 'Saved to cloud storage' },
];
export const EGG_IDS = new Set(EGGS.map((e) => e.id));

export const README_DEFAULT = `SYSTEM32 RECOVERY NOTES
-----------------------
If you are reading this, the system is falling apart.

Four components failed during the last update:
  - popup_guard.sys      (something keeps opening windows)
  - admin_access.dll     (locked out of my own bank account?)
  - theme.dll            (the stylesheets are fighting each other)
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
