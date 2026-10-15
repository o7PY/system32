# System32

A fake Windows 11-style desktop that runs in the browser. The OS is corrupted; each of four DOM-abusing
mini-games you beat repairs one component. This repo is **Part 1: the shell** (see `DESKTOP_SPEC.md`).
Parts 2 (**DOM-ination**), 3 (**Inspect Element**), 4 (**CSS Specificity Wars**) and 5 (**404: Window Manager**) are built, so all four games are real.

No frameworks, no build step: vanilla HTML/CSS/JS (ES modules), all paths relative, deployable to GitHub Pages as-is.

## Run it

```sh
python3 serve.py                # then open http://127.0.0.1:8000   (python3 serve.py 9000 for another port)
```

`serve.py` is a standard-library dev server. Plain `python3 -m http.server` is no longer enough: games run in sandboxed
iframes with an opaque origin, so their module scripts and `fetch()` calls (3D models, for example) are cross-origin
requests that only succeed if the server sends `Access-Control-Allow-Origin`. `serve.py` adds that, plus `no-store` so
edits always reload, and the right MIME types for `.js`, `.mjs`, `.glb`, `.gltf`, `.wasm` and `.bin`. Development only.

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
  corruption.js         glitch FX, fake ads, repair sweep, ending   bonus.js  bonus-game unlock after the ending + ?unlockBonus=1
  easterEggs.js  system.js (BSOD, power)  menu.js  notifications.js  sound.js (WebAudio, no files)
  apps/                 browser (Edgy), notepad, explorer, recycleBin, settings, gameWindow (bonus games)
pages/                  loaded inside Edgy: search (Goggle), offline (runner), crash (vim)
games/                  one folder per game + _shared/sdk.js
tests/                  cors-sandbox (manual), lib/ (headless-Chrome driver + shell helpers), bonus-shell/, space-saga/ and strata/ (see below)
tools/                  asset pipelines + vendoring for SpaceSaga and Strata (dev-only; tools/strata/ holds Strata's inventory and asset plan)
```

## Building a game (Parts 2–5)

Drop the game into its `games/<name>/index.html`. Edgy loads it in
`<iframe sandbox="allow-scripts allow-forms allow-pointer-lock">` (no `allow-same-origin`, no `allow-popups`),
so the game cannot touch the shell and talks to it only through `postMessage`. Because the origin is opaque:

- module scripts (`<script type="module">`, `import`) and `fetch()` work, because `serve.py` and GitHub Pages (which sends
  `Access-Control-Allow-Origin: *`) both allow cross-origin reads. The four existing games keep their classic
  `<script src>` and are left as they are,
- do not use `localStorage` (or cookies): the shell owns persistence,
- never add `allow-same-origin` to the sandbox,
- `tests/cors-sandbox/` is the check for the first point: a page in a sandboxed iframe with the exact attributes above that
  `import`s a module and `fetch`es a `.glb`. Open `tests/cors-sandbox/index.html` under `serve.py` and expect three PASS rows.

Raw asset packs go in `assets/source/` (gitignored, never committed). Only processed, game-ready models, inside the
game's own folder, are committed. Credits are in `CREDITS.md`.

`games/_shared/sdk.js` wraps the protocol:

```html
<script src="../_shared/sdk.js" data-game="dom-ination"></script>
<script>
  System32.onInit(function (init) { /* { bestTimeMs, best, beaten, soundOn } */ });
  System32.onPause(pauseGame); System32.onResume(resumeGame);
  System32.onSound(function (p) { /* { soundOn }: the taskbar speaker was toggled while the game is open */ });
  System32.ready();                              // GAME_READY
  System32.progress('wave', '2/3');              // optional, shown as a chip in the toolbar
  System32.won({ timeMs: 41200, score: 3 });     // GAME_WON  -> repairs the component
  System32.runOver({ score: 12480, distance: 812, pickups: 9, timeMs: 61000 });   // RUN_OVER (bonus games only): keeps the best score
  System32.lost('ran out of time');              // GAME_LOST
</script>
```

Game ids: `dom-ination`, `inspect`, `specificity`, `wm404`. A game can only win for its own id, and the shell
identifies the sender by `event.source` (a game cannot repair a different component).

## Bonus games (SPACESAGA_SPEC.md, Part A)

Bonus games are `.exe` files that appear in the **Recycle Bin** after the ending. They are listed in `bonusGames` as `BONUS_GAMES` in `js/registry.js`
(separate from the four core games) and **never** count toward integrity, corruption, repairs or the ending.

- **State:** `state.version` is 2 and gains `bonus: { unlocked, restored, seen, best }`. Version-1 saves are migrated (missing field = empty), garbage in the field is
  dropped. Settings > Reset progress wipes it too.
- **Unlock:** when the clean desktop appears after the ending's restart, a bonus game is unlocked at once and 4 s later ONE toast says
  "🗑 Recycle Bin: 2 items could not be deleted." (click it: the bin opens; the count is however many bonus games were just unlocked). A save that already finished the
  ending gets any newly added bonus game on its next desktop load, with ONE toast ("1 item"), never again. The bin shows `SpaceSaga.exe` (`C:\Games\`, deleted `03-03-2023`, highlighted the first
  time; Properties shows `binLore`). **Open** (double-click / Enter) launches it; **Restore** (right-click, or the toolbar button) moves it to the desktop and the
  Start menu's pinned grid. "Empty Recycle Bin" never deletes it (the "emotionally attached" joke still plays). Deleting the restored desktop icon puts the game back in the bin.
  Debug: `?unlockBonus=1` on the shell URL unlocks every bonus game without playing the ending.
- **Game window** (`js/apps/gameWindow.js`): a plain `Window` whose content is one iframe (no address bar), 1280x760 clamped to the desktop, resizable. Same sandbox as
  Edgy (the string is exported from `apps/browser.js`: `allow-scripts allow-forms allow-pointer-lock`, never `allow-same-origin`), sender identified by `event.source`,
  PAUSE on minimize or blur and RESUME on restore, `iframe.focus()` whenever the window is focused (and after a title-bar drag).
- **Fullscreen** (both bonus games): the game window has a fullscreen button in its title bar (left of minimize), and a game can ask for it with `System32.fullscreen()`
  (message `FULLSCREEN`; the shell answers with `FULLSCREEN { on }`, `System32.onFullscreen`, also when the player pressed Esc). The shell puts the game area (`.gw`, the iframe)
  into real browser fullscreen with `requestFullscreen()`: no title bar, no taskbar, no desktop, the iframe fills the screen. The browser only allows it from a click or key press, so
  the game calls it from its own key/button handler (SpaceSaga: **F**, **Alt+Enter**, a Fullscreen button on the pause screen; Strata: **Alt+Enter**, Fullscreen buttons on the title
  and pause menus). Esc (or the same button) leaves; closing the window leaves too. If the browser refuses, a toast points at the browser's own F11. Tests: the fullscreen
  tests in `tests/strata/shell-game.mjs` and `tests/space-saga/shell.mjs`.
- **Protocol:** a bonus game does not win, it ends runs: `System32.runOver({ score, distance, pickups, timeMs })` sends `RUN_OVER`. The shell keeps the best `score` in
  `bonus.best[gameId]`, sends it as `best` in INIT, and shows "SpaceSaga: new best — 12,480" on a new best. Scores from games are never trusted (finite, >= 0, clamped
  to 1e9; a forged `gameId` is ignored). `won()` / `lost()` / `progress()` from a bonus game are ignored (a warning is logged with `?debug=1`).
  A bonus game can only report easter eggs with its own prefix (`saga-`): `saga-404`, `saga-popup`, `saga-afk` are in the registry (they count toward "Secrets: n/36"). Strata's are `strata-adblock`, `strata-bedrock`, `strata-cloud`.
- **World saves** (STRATA_SPEC.md Part A, `js/saves.js`): a bonus game with `saves: true` in the registry (Strata) can keep a world. `System32.save(data)` sends `SAVE` (data is a
  string); the shell answers `SAVED { ok, bytes, error? }` (`System32.onSaved`), and INIT carries the last string as `save` (or `null`). It is stored under its OWN localStorage key,
  `system32.save.<gameId>`, never inside `system32.state`. Hard cap per game (default 1.5 MB, a game can declare its own `saveCap`: Strata 4 MB for its world list; `too-large`, nothing written); a localStorage failure answers `quota` and keeps the old save;
  a non-string answers `invalid`. Games without `saves: true`, or a forged `gameId`, are ignored (no reply). Settings gets a "Bonus game saves" row per unlocked saving game with
  its size and a confirmed **Delete save**; Reset progress deletes every `system32.save.*` key. Tests: `node tests/strata/shell.mjs` (against `tests/strata/stub/`).
- **Tests:** `node tests/bonus-shell/run.mjs [filter]` drives real headless Chrome with real mouse/keyboard events over the DevTools protocol (no dependencies; starts
  `serve.py` and Chrome on free ports, scratch profile outside the repo; set `CHROME=` to use another binary): migration, the ending -> toast -> bin -> Open/Restore flow,
  sandbox + focus + pause, `RUN_OVER` bests and INIT, Empty Recycle Bin, `?unlockBonus=1`, Reset, core games unchanged, forged ids and eggs.
- The shell tests run against a stub page (`tests/bonus-shell/stub/`, a "Send RUN_OVER" button): after boot the registry's SpaceSaga `src` is pointed at it. The real game
  has its own shell test (`tests/space-saga/shell.mjs`).

## SpaceSaga (bonus game 1, SPACESAGA_SPEC.md Part B, `games/space-saga/`)

A three-lane endless runner in space (three.js). Run, jump and slide past rocks, wreckage and aliens, grab pickups, go as far as you can: one hit ends the run and the shell
keeps your best score. `A`/`D` or arrows change lane, `W`/`Up`/`Space` jump, `S`/`Down` slide (in the air: fast-fall, then slide), `P`/`Esc` pause, `M` mute, `F` fullscreen, `Enter` starts.

- **Code** (`src/`): `main.js` boot, fixed 1/60 s step loop (game clock, so pause is exact) and state machine; `config.js` every tunable number and the obstacle patterns as data;
  `patterns.js` the pure pattern rules (also used by the tests); `world.js` track, decor, stars, planets, lights, pop-up ad debris; `player.js` lanes / jump / slide / input
  buffer; `spawner.js` pooled pattern spawning; `collision.js` logical boxes; `assets.js` GLB loading and clip mapping (with the spec's fallbacks); `hud.js`; `audio.js` WebAudio synth (music and effects); `curve.js` the planet bend.
  `patterns.js` is an addition to the spec's file list, so the validator test can import the rules without a DOM.
- **A round planet:** the track runs over a small planet (`CONFIG.planet.radius`, 380 m). `curve.js` patches the material shader so every vertex drops by distance^2 / 2R: the track,
  the ground and everything on them bend away over the horizon and obstacles rise into view from below it. It is visual only (collision and spawning stay flat). The surface is a
  textured ground with craters; the kit decor stands on it out to 55 m either side of the track. Long meshes are cut every 2.5 m because the bend works per vertex.
- **Sound** (WebAudio synth, no files; plays only when the shell's sound is on, `M` mutes): a four-chord loop in A minor that gets denser at 400 m and 1000 m and faster with speed
  (bass, pad, arpeggio, lead, drums), a calmer title theme, wind that follows speed, and effects for footsteps (alternating), lane switches (panned), jump, landing, slide, bolts
  (pitch rises with the combo), orbs, combo x2, side clips, crashes, pop-up shattering, aliens, tier-ups, game over and a new-best fanfare. The shell tells a running game when the
  taskbar speaker is toggled (`SOUND` message / `System32.onSound`); the title screen says whether sound is on.
- **Fair by construction:** obstacles are never random per lane; they come from hand-authored patterns (`PATTERNS` in `config.js`; `L` low = jump, `H` high = slide, `B` blocker,
  `E>`/`E<` enemy walking, `P` pickup). Rows are at least `reactionS` (0.7 s) apart at any speed, tiers unlock at 0 / 400 / 1000 m, a pattern never repeats back to back, and
  `tests/space-saga/static.mjs` proves every row has a survivable action and that the next row is reachable.
- **Models:** 25 processed GLBs (1.1 MB of the 6 MB budget) in `models/`, committed. The raw Quaternius pack stays in `assets/source/` (gitignored). To rebuild them:
  `npm install --prefix tools`, then `node tools/build-assets.mjs` (reads `tools/assets.json`; keeps every animation clip and fails the build if one is lost or the budget is exceeded).
  `node tools/inventory-assets.mjs` regenerates `ASSET_MANIFEST.md`; `ASSET_PICKS_PROPOSAL.md` records why each model was picked.
- **three.js** v0.186.1 is vendored in `games/_shared/vendor/three/` (so later bonus games reuse it) by `node tools/vendor-three.mjs`. That release ships no `three.module.min.js`, so the
  script minifies `three.module.js` and `three.core.js` once with esbuild. Game pages use an import map (`three`, `three/addons/`), which works because `serve.py` and GitHub Pages
  send CORS headers.
- **Debug URLs:** `?seed=N` deterministic patterns and decor, `?speed=N` game clock multiplier, `?god=1` no death, `?quality=low`, `?debug=1` FPS / draw-call overlay and
  `window.__SPACESAGA` (`state()`, `setDistance(m)`, `spawnPattern(id)`, `kill()`, `config`, and test helpers). Quality drops to low by itself if the average frame time stays above 22 ms for 3 s.
- **Tests:** `node tests/space-saga/static.mjs` (patterns, config, model budget, vendor files), `node tests/space-saga/run.mjs [filter]` (headless Chrome: lanes, jump arc, slide hitbox,
  input buffer, side clip, enemies, pickups and combo, speed ramp, tiers, a bot that survives 2,000 m on five seeds, RUN_OVER once per run, pause and focus, context loss, quality, audio, eggs,
  no-WebGL error screen) and `node tests/space-saga/shell.mjs` (inside the real shell: sandbox, modules over the opaque origin, INIT best, new-best toast, pause on minimize, eggs reaching the shell).
  Headless Chrome renders with software WebGL, so the tests check logic, not frame rate.
- **Eggs:** `saga-404` (cross 404 m: "Distance not found"), `saga-popup` (jump through a floating pop-up ad), `saga-afk` (60 s on the title screen: the player sits down).

## Strata (bonus game 2, STRATA_SPEC.md, `games/strata/`)

A survival-lite block game: a seeded 1024 x 1024 x 128 world of plains, forests, deserts, snowy mountains, beaches and oceans, with caves and ores underneath. Punch trees, craft tools,
dig down through the strata, smelt iron, build. No mobs, no hunger, no health. The shell saves your world (`system32.save.strata`). Found in the Recycle Bin as `Strata.exe` after the
ending (`Deleted 11-11-2011. Reason: "user spent 400 hours digging a hole."`). Our own game: no other game's names, textures, sounds, fonts or characters.

| | |
|---|---|
| Move | `W A S D`, `Space` jump / swim up, `Shift` or double-tap `W` sprint, `C` sneak (hold; no falling off edges) |
| Mine / place / use | left mouse (hold) / right mouse (also opens the crafting table and furnace) / middle mouse picks the block |
| Hotbar, inventory | `1`-`9` or the wheel, `E` inventory, `Q` drop one, `Esc` pause, `F3` debug overlay |

There is no binding with `Ctrl` anywhere (`Ctrl+W` closes the browser tab and a page cannot stop it), and the context menu and the wheel are blocked on the game.

- **Code** (`src/`): `config.js` every number and the recipes; `blocks.js` the block registry (also builds the table the worker gets); `worker.js` noise, terrain, features and meshing with ambient
  occlusion (SELF-CONTAINED: no `import`); `world.js` chunk streaming, edits and the two backends; `renderer.js` three.js scene (chunk shader with fog and day / night, sky, sun and moon drawn in code,
  clouds, outline, crack stages, border grid, drops); `player.js` AABB physics; `interact.js` voxel ray, break rules, mining progress, dropped items; `items.js`, `inventory.js`, `crafting.js`
  the item registry, click rules and furnace; `ui.js` all the DOM; `save.js` the save format; `audio.js` samples + ambient synth; `main.js` boot, input and the state machine.
- **Worker from a Blob URL:** a sandboxed page has an opaque origin, so `new Worker('worker.js')` throws. `createBackend()` fetches `worker.js`, wraps it in a Blob and starts a classic worker from the
  Blob URL. If that fails (or with `?noWorker=1`) the very same file is loaded with a `<script>` tag and generation runs on the main thread in time-sliced batches (6 ms per frame). The tests check
  that both paths produce byte-identical chunks, and that the Blob worker starts inside the real sandboxed game window.
- **Generation** is a pure function of (seed, chunk x, chunk z): chunks can be made in any order. Trees and ore veins that cross a border are written by both neighbours from the same seeded list.
  Terrain is 2D noise (continents, hills, ridged mountains, temperature and moisture -> six biomes), caves are 3D noise (cheese and tunnels, open to the surface only at some entrances), coal
  (y 20-90) and iron (y 5-60) are small veins, water fills below sea level (48) and flows once the ground around it changes (see Flowing water), bedrock at y = 0 with noise up to y = 3. Chunks load nearest-first and unload when far away; unloaded
  chunks come back from the seed plus the edits.
- **Several worlds** (`games/strata/src/worlds.js`): the shell keeps ONE string per game, so Strata stores a small container in it, `STRATAW1:` + JSON `{ v, last, worlds: [{ id, name, mode, difficulty, created, played, data }] }`, where `data` is one ordinary `STRATA1:` world (save.js is unchanged). Up to **10 worlds**, 4 MB in total (each world still at most 2.5 MB; when the total is full the game says "Storage is full ... delete a world"). A save from before worlds (`STRATA1:...`) is read as a single world "World 1" and becomes a list with its next save. The title screen has **Continue: <name>** (the world played last), **Worlds** (the list, newest first, with mode, difficulty, size and last played; **Play**, **Rename** in place, **Delete** needing a second click "Really delete?") and **New World**, which asks for a name (blank = "World N", a taken name gets "(2)"), seed, game mode and difficulty. Worlds never share edits, chests, inventory or settings-of-the-world (mode, difficulty). Autosave, pause, quit and death write only the current world's entry. Tests: `tests/strata/worlds.mjs` and the "worlds" test in `run.mjs`.
- **Flowing water** (`games/strata/src/fluid.js`): a source (`water`, strength 8) and seven flowing blocks `water_1`..`water_7`. Every 0.25 s the queued cells are looked at (at most 400): water with air below falls and goes no further sideways; otherwise it feeds the air around it with strength - 1, so it runs 7 blocks over flat ground; flowing water that nothing feeds any more (no water above, no stronger neighbour) drains away; sources never dry up. Every block change queues its cell and neighbours, so digging next to the sea lets it in and a wall holds it back. Flowing water is saved like any other edit, and the flowing cells of a chunk are looked at again when it loads. The mesher draws the surface lower the weaker the water (a source 7/8), full height under more water, and shows the side of a higher cell above a lower one. Players and mobs swim in all of it. Lava stays still. Tests: `tests/strata/fluid.mjs`, the water check in `world.mjs` and "water flows" in `run.mjs`.
- **Meshing** emits only visible faces, bakes vertex ambient occlusion and flips the quad diagonal to avoid artefacts; opaque, cutout (leaves, glass) and water are separate meshes. Setting a block
  remeshes its chunk, plus the neighbours when it sits on a border (and corners, for AO).
- **Saves** (`save.js`): `STRATA1:z:` + base64 of a deflate-raw compressed container (`CompressionStream`; `r` = uncompressed when it is not available): a JSON header (seed, size, spawn, player,
  inventory with durability, furnaces, time of day, settings) and the edits: only blocks that differ from the generator, as (index, id) pairs per chunk. An unedited world is about 250 bytes.
  Loading validates everything and rejects garbage with a message instead of loading half. Autosave every 60 s, on pause, on the shell's PAUSE and on Save & Quit. The shell caps a save at 1.5 MB
  and answers `SAVED { ok:false, error:'too-large' }`: the game shows "World too big to save: 1.6 MB / 1.5 MB. Try removing some builds."
- **Assets** (`assets/`, 350 KB of the 3 MB budget; Kenney, CC0): `tools/strata/inventory-assets.mjs` -> `STRATA_ASSET_MANIFEST.md` -> approved picks in `tools/strata/assets.json`
  (`STRATA_ASSET_PICKS_PROPOSAL.md`) -> `node tools/strata/build-assets.mjs` makes the 32x32 atlas with 2 px edge padding, the item sheet, 62 mono Ogg sounds, and the font. Roles with no match in
  the pack (bedrock, stick, iron ingot, crafting table side and front, the Ad Block ore, the pop-up item) are drawn in code, reproducibly. The hotbar block icons are rendered at startup from the atlas.
- **Sound:** Kenney samples per material group (dig every 0.25 s while mining, break, footsteps with the rate following speed and none while sneaking, place, pickup, UI, furnace, tool break, the
  jingle for the first iron tool), panned and attenuated by position, plus a synthesized ambient pad every few minutes. Plays only while the shell's sound is on (`System32.onSound`).
- **Eggs:** `strata-adblock` (mine the rare Ad Block ore, about one per four chunks deep underground: "Ad Block enabled."), `strata-bedrock` (10 s on bedrock), `strata-cloud` (place a block at y = 127).
- **Debug URLs:** `?seed=N`, `?flat=1` (superflat), `?worldSize=N`, `?quality=low` (view distance 5, no clouds, no water wave), `?noWorker=1`, `?debug=1` (adds `window.__STRATA` with `state()`,
  `getBlock`, `setBlock`, `give`, `tp`, `setTime`, `save`, `load` and test helpers).
- **Tests:** `node tests/strata/world.mjs` (noise, determinism, trees and ores across borders, meshing face counts, AO), `node tests/strata/logic.mjs` (ray, physics, mining and tool tables, drops,
  crafting, furnace, inventory), `node tests/strata/run.mjs` (headless Chrome with real key and mouse events: boot, worker and fallback, movement, mining, placing, inventory and crafting through the
  DOM, saving, menus, day / night, audio, eggs, border, streaming), `node tests/strata/shell.mjs` (Part A in the real shell) and `node tests/strata/shell-game.mjs` (the real game in the sandboxed
  window: worker, SAVE / INIT, PAUSE, eggs, sound). Headless Chrome renders with software WebGL, so these check logic, not frame rate.

### Strata Part 2 (STRATA_PART2_SPEC.md): a survival game you can win

Hearts, hunger, air, armor, death and respawn (items stay where you died for 10 minutes; Keep inventory in Settings), three difficulties (Peaceful / Normal / Hard), a real light
engine with torches, animals (pig, cow, sheep, chicken), night monsters (Shambler, Rattler, Creepcrawler, Pop-up), chests, beds, a bow, cobalt gear, **Cracked Bedrock** and
**Rifts** into **the Underlayer** (a second, hostile dimension), three **Data Vaults** (spawner, lava parkour, Vault Warden, a Kernel Shard each), the **Kernel Gate**, and the
**Garbage Collector** in **the Kernel**. Beating it shows the credits, reports `System32.complete()` once per world (best time per difficulty, a green check on the icon) and the
world goes on. `?debug=1` adds the test hooks on `window.__STRATA` (`setHealth`, `setHunger`, `spawn`, `killAll`, `setDifficulty`, `goto('overworld'|'underlayer'|'kernel')`,
`giveKit('iron'|'cobalt')`, `bossPhase(n)`, `setTime`); `?peaceful=1` starts on Peaceful. Tests: `tests/strata/{static,world,logic,light,survival,entities,hostile,underlayer,boss}.mjs`
(Node) and `run.mjs`, `shell.mjs`, `shell-game.mjs` (headless Chrome). Saves are version 2 and still load version 1 worlds.

**Creative mode** (chosen on New World, or `?creative=1`): `E` opens a searchable, sorted catalog of every item (tabs: All, Blocks, Tools & Weapons, Armor, Food, Materials; click = a stack, right-click = one, click with an item on the cursor = delete); nothing is used up, blocks break instantly and drop nothing, no damage or hunger, monsters leave you alone, double-tap `Space` to fly. A Creative world never counts as a win. See section 15 of `STRATA_PART2_SPEC.md`.


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
