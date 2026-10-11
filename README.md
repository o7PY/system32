# System32

A fake Windows 11-style desktop that runs in the browser. The OS is corrupted; each of four DOM-abusing
mini-games you beat repairs one component. This repo is **Part 1: the shell** (see `DESKTOP_SPEC.md`).
The four games ship as stubs with Win / Lose buttons until Parts 2–5 replace them.

No frameworks, no build step: vanilla HTML/CSS/JS (ES modules), all paths relative, deployable to GitHub Pages as-is.

## Run it

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Do not open `index.html` via `file://`: ES modules and iframes misbehave there.
Needs a viewport at least 900px wide. Progress lives in `localStorage['system32.state']`; Settings > Reset progress
(unlocked by repairing `admin_access.dll`) wipes it for a replay.

## Layout

```
index.html              the desktop page
css/                    tokens, desktop, taskbar, window, apps
js/
  main.js               boot -> lock -> sign-in -> desktop sequence, wiring
  state.js              progress store + localStorage      events.js   pub/sub bus + launch()
  registry.js           games, routes, desktop icons, eggs  launcher.js opens apps/files by id
  WindowManager.js      Window class + manager             dialogs.js  Dialog (modal-to-parent)
  desktop.js            icons, selection, drag, menus      taskbar.js / startMenu.js
  corruption.js         glitch FX, fake ads, repair sweep, ending
  easterEggs.js  system.js (BSOD, power)  menu.js  notifications.js  sound.js (WebAudio, no files)
  apps/                 browser (Edgy), notepad, explorer, recycleBin, settings
pages/                  loaded inside Edgy: search (Goggle), offline (runner), crash (vim)
games/                  one folder per game + _shared/sdk.js
```

## Building a game (Parts 2–5)

Drop the game into its `games/<name>/index.html`. Edgy loads it in
`<iframe sandbox="allow-scripts allow-forms allow-pointer-lock">` (no `allow-same-origin`, no `allow-popups`),
so the game cannot touch the shell and talks to it only through `postMessage`. Because the origin is opaque:

- load sub-resources with classic `<script src>` / `<link>` (module scripts need CORS and will fail),
- do not use `localStorage`: the shell owns persistence.

`games/_shared/sdk.js` wraps the protocol:

```html
<script src="../_shared/sdk.js" data-game="dom-ination"></script>
<script>
  System32.onInit(function (init) { /* { bestTimeMs, beaten, soundOn } */ });
  System32.onPause(pauseGame); System32.onResume(resumeGame);
  System32.ready();                              // GAME_READY
  System32.progress('wave', '2/3');              // optional, shown as a chip in the toolbar
  System32.won({ timeMs: 41200, score: 3 });     // GAME_WON  -> repairs the component
  System32.lost('ran out of time');              // GAME_LOST
</script>
```

Game ids: `dom-ination`, `inspect`, `specificity`, `wm404`. A game can only win for its own id, and the shell
identifies the sender by `event.source` (a game cannot repair a different component).

## Notes on choices the spec left open

- **Sound is off by default** (spec §12 says so; the §10.1 schema example said `true`). Effects are synthesized with
  WebAudio, so `assets/sounds/` ships no files. The tray volume icon toggles it for real.
- **Resize handles** only work once `wm_core.exe` is repaired (§9.3). Maximize/minimize always work.
- **Taskbar grouping:** windows of the same app share one button (pinned Explorer/Edgy/Notepad); with several open,
  clicking cycles through them. Recycle Bin and Settings get their own buttons.
- Goggle's easter eggs report themselves with `SHELL_EFFECT` messages carrying an optional `egg` id.
- Extra effects beyond the spec's list: `SHELL_EFFECT` also accepts `effect: 'egg'` (just count a secret) and
  `NAVIGATE` accepts `route: 'random'` (pick an unbeaten game, used by "I'm Feeling Corrupted").
