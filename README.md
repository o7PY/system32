# System32

A fake Windows 11-style desktop that runs in the browser. The OS is corrupted; each of four DOM-abusing
mini-games you beat repairs one component. This repo is **Part 1: the shell** (see `DESKTOP_SPEC.md`).
Parts 2 (**DOM-ination**), 3 (**Inspect Element**), 4 (**CSS Specificity Wars**) and 5 (**404: Window Manager**) are built, so all four games are real.

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
  System32.onInit(function (init) { /* { bestTimeMs, best, beaten, soundOn } */ });
  System32.onPause(pauseGame); System32.onResume(resumeGame);
  System32.ready();                              // GAME_READY
  System32.progress('wave', '2/3');              // optional, shown as a chip in the toolbar
  System32.won({ timeMs: 41200, score: 3 });     // GAME_WON  -> repairs the component
  System32.lost('ran out of time');              // GAME_LOST
</script>
```

Game ids: `dom-ination`, `inspect`, `specificity`, `wm404`. A game can only win for its own id, and the shell
identifies the sender by `event.source` (a game cannot repair a different component).

## DOM-ination (Part 2, `games/dom-ination/`)

`free_prizes.html` → `popup_guard.sys`. Close pop-ups before they multiply; survive 60 s with fewer than 24 open.
Three files, no globals (`index.html`, `style.css`, `game.js`). Win is reported only when the player clicks **Install**.

- One `requestAnimationFrame` loop runs a fixed 1/60 s simulation step; every timer is game time, so pause is exact
  (no `setTimeout`/`setInterval` for game logic).
- Test hooks (open `games/dom-ination/index.html` directly): `?seed=N` (deterministic spawns), `?speed=N` (game clock
  multiplier), `?debug=1` (adds `window.__DOMINATION` with `state()`, `spawn(type)`, `autoSpawn(bool)`, `closeAll()`,
  `forceWin()`, `forceLose()`, and the live mutable `config`).
- All tuning lives in `CONFIG` at the top of `game.js`. The wave spawn intervals (2.1 / 1.7 / 1.4 s) and weights were
  tuned with simulated players (a bot that clicks the most urgent pop-up, chases runaways and sometimes falls for bait):
  about 25 % wins per attempt at 1 click/s, 58 % at 1.6/s, and ~100 % at 2+/s. The spec's starting values (1.6 / 1.2 / 0.9 s)
  were unwinnable for anything below the skilled bot. Re-check with a real human before shipping.
- The shell stores a best *score* per game (`bestScores`) and sends it as `best` in INIT ("Best: N closed").

## Inspect Element (Part 3, `games/inspect-element/`)

`bank_login.html` → `admin_access.dll` (unlocks Settings). A fake bank login with three locks, each solved with the
**real DevTools**: read a password out of an HTML comment, delete `disabled` from the button, change a hidden `role`
input to `admin`. No timer, no lose condition; stars come from how many tier-2+ hints you used.

- The puzzle is static markup in `index.html` (comments, `disabled`, hidden input, `display:none` note), so View Source,
  Elements and Sources all work. Players get into the game's DOM with **right-click inside the page → Inspect**; F12 opens
  DevTools on the shell instead. For the Console they must switch its context dropdown to the bank page (the in-game
  help card explains both).
- Robust to DOM surgery: every listener is delegated on `document` and elements are looked up by id each time.
  Player-editable text only ever reaches the page through `textContent`.
- `System32.won` is wrapped: calling it from the Console before the locks are solved still repairs the component, but you
  are greeted as "script kiddie" with 0 stars (and the shell receives a normalised payload, so you cannot pick a score).
- Hooks: `?debug=1` adds `window.__INSPECT` (`state()`, `solve('password'|'button'|'role')`, `reset()`).
- Manual check still needed in real Chrome and Firefox: right-click → Inspect lands in the game's DOM, and Console
  context switching. Headless tests drive the page through CDP instead.

## CSS Specificity Wars (Part 4, `games/specificity-wars/`)

`styles_FINAL_v2.html` → `theme.dll` (stops the wallpaper/taskbar glitches, unlocks Personalize). Enemies fall down the
screen, each defended by a rule in `enemy.css`. You type a selector; the game injects
`:where(#arena) :is(<selector>) { display: none; }` into `<style id="player-css">`. An enemy is defeated when the
browser's own `getComputedStyle(el).display` is `none`, so the real cascade decides: out-specify the defense, tie (you win
on source order), or use the single `!important` charge against the inline-styled final boss.

- The specificity calculator (display only, 25 table-driven tests via `__SPECIFICITY.runSpecTests()`) feeds the 🛡 badges,
  the live preview and the "Blocked: your (0,1,0) < defense (0,2,1)" messages. It can never decide the game.
- Player input is treated as hostile: length/character/bracket/pseudo-element checks, `querySelector` validation, then a
  single `insertRule` that is verified to have added exactly one `display:none` rule.
- A sandboxed page cannot read `enemy.css`'s rules (cross-origin sheet), so `game.js` keeps a small `DEFENSES` copy for the
  badges and tooltips. The real file still does the defending, and the test suite diffs the copy against it.
- Cards move with paused Web Animations driven by the game clock, so the element a player inspects in DevTools is never
  rewritten every frame, and pausing is exact. Effects are clones in a layer outside `#arena`.
- Hooks: `?seed`, `?speed`, `?debug=1` -> `window.__SPECIFICITY` (`state`, `submit`, `toggleImportant`, `skipToWave`,
  `specificity`, `runSpecTests`, mutable `config`).
- Tuning from simulated players (a bot that tries the obvious selector first and upgrades when blocked): wins 24/24 at 3-8 s
  per selector; a player who never deletes old rules usually loses around wave 4 (that is the lesson). To make the wave-2
  "old rules still apply" lesson fair, the first ally arrives later in the wave and a reminder is shown at each wave start.
  Still worth a human playtest.

## 404: Window Manager (Part 5, `games/window-manager-404/`)

`recovery_tool.html` -> `wm_core.exe` (windows stop jittering on open, resize handles unlock). A tiny, old-looking desktop
inside the window: source windows start "Not responding", drain a timer and **collapse into a 404**, taking their files
with them. Drag the four `core_0N.frag` fragments into **Recovery** in time; junk goes in the bin. Three phases, one new
complication each: drag basics -> overlapping windows + junk blocking a slot -> a fragment inside nested folders, a
drifting Recovery that minimizes itself once.

- **Pointer Events, not native DnD:** 4 px threshold, ghost in a top-level layer, `document.elementsFromPoint` hit test on
  every `pointermove` *and every game tick* (so the highlight follows Recovery drifting under a still pointer),
  `pointercancel` / `lostpointercapture` / `blur` / pause all return the file to its origin. Pointer capture is on the
  stable `#desk`, never on a file element, because re-parenting a captured element would silently drop the drag.
- **State is the truth, the DOM is a view:** windows and files live in one object; every pose (position, shrink, 404 ghost,
  countdown bar, assembly) is derived from the game clock in `render()`, so pause is exact and `?speed` works.
- **Mercy rule:** a file in your hand when its window collapses is kept. If you then drop it somewhere invalid, a fragment
  is "restored from backup" right away (no heart lost), junk is just gone.
- **Lost fragments never soft-lock:** -1 heart, and 2 s later the fragment reappears in a new window (placed where it covers
  the least) with a fresh 10 s timer. Three lost = lose (every window collapses in turn, then a giant 404).
- **Keyboard:** Tab to a file, Space picks up, Tab / Shift+Tab chooses Recovery or the bin, Space drops, Esc cancels,
  Enter opens a folder.
- Hooks: `?seed`, `?speed`, `?debug=1` -> `window.__WM404` (`state`, `move`, `collapse`, `skipToPhase`, `forceLose`, mutable
  `config`). Drags are tested with real mouse events; `move()` is only for set-up.
- Tuning from simulated players (real mouse events, game-time reaction + drag costs): a player who pays 1 s to decide and
  1.5 s per drag wins 6/6 with 3 hearts in ~21 s; 2.5 s + 2.5 s wins 6/6 with 3 hearts in ~39 s; 4.5 s + 3.5 s still wins
  but loses a fragment (2 hearts). They already know the plan, so a first-timer will be slower: still worth a human playtest.
- The pre-placed `autosave.tmp` is only added if two slots stay free, so phase 2 never *requires* the bin; phase 3 does
  (the full Recovery is the lesson), and the bin is never covered or timed.
- Phase 1 has two junk files in *each* window (four in all) so the "Recovery (4 cat pictures)" secret is reachable.

## Notes on choices the spec left open

- **Sound is off by default** (spec §12 says so; the §10.1 schema example said `true`). Effects are synthesized with
  WebAudio, so `assets/sounds/` ships no files. The tray volume icon toggles it for real.
- **Resize handles** only work once `wm_core.exe` is repaired (§9.3). Maximize/minimize always work.
- **Taskbar grouping:** windows of the same app share one button (pinned Explorer/Edgy/Notepad); with several open,
  clicking cycles through them. Recycle Bin and Settings get their own buttons.
- Goggle's easter eggs report themselves with `SHELL_EFFECT` messages carrying an optional `egg` id.
- Extra effects beyond the spec's list: `SHELL_EFFECT` also accepts `effect: 'egg'` (just count a secret) and
  `NAVIGATE` accepts `route: 'random'` (pick an unbeaten game, used by "I'm Feeling Corrupted").
