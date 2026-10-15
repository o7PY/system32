# SPACESAGA_SPEC.md — System32 Bonus Game 1: SpaceSaga

> **Unlocked:** after the System32 ending (all 4 components repaired)
> **Found in:** Recycle Bin as `SpaceSaga.exe` · **gameId:** `space-saga` · **Folder:** `games/space-saga/`
> **Assets:** Quaternius *Ultimate Space Kit* (CC0), raw pack at `assets/source/ultimate-space-kit/` (gitignored)
> **Target:** 3–4 days with Claude Code

A 3D, three-lane endless runner in space. The game was "deleted for being too fun" and has been sitting in the Recycle Bin the whole time. Run, jump and slide past rocks, wreckage and aliens; grab pickups; go as far as you can. There's no win: the shell keeps your best score.

This spec has two halves:
- **Part A — Bonus games in the shell** (the unlock flow, built once, reused by every future bonus game).
- **Part B — SpaceSaga itself**, including the asset pipeline.

Delete the empty `SpaceSaga/` folder at the repo root; the game lives in `games/space-saga/`.

---

# Part A — Bonus games in the shell

## A1. Registry
Add a `bonusGames` list to `js/registry.js`, separate from the four core games:

```js
bonusGames: [
  { id: 'space-saga', file: 'SpaceSaga.exe', title: 'SpaceSaga', icon: 'rocket',
    src: 'games/space-saga/index.html', unlock: 'ending',
    binLore: 'Deleted 03-03-2023. Reason: "too fun, employees stopped working."' },
]
```
- Bonus games **never** count toward integrity, corruption, repairs or the ending.
- State gains `bonus: { unlocked: [], restored: [], best: {} }`. Bump `state.version` and migrate old saves (missing field → empty).

## A2. Unlock flow
1. When the ending completes (the clean desktop appears after restart), wait 4 s, then show a toast: **"🗑 Recycle Bin: 1 item could not be deleted."** Clicking the toast opens the Recycle Bin.
2. The Recycle Bin gets a new row, highlighted the first time: `SpaceSaga.exe`, Original location `C:\Games\`, Date deleted `03-03-2023`. Its Properties dialog shows `binLore`.
3. The item can be:
   - **Opened** (double-click / Enter) → launches the game (A3).
   - **Restored** (right-click → Restore, or a Restore button in the toolbar) → the icon appears on the desktop and in the Start menu's pinned grid, and leaves the bin. This is how Windows works, and it's the satisfying moment.
4. "Empty Recycle Bin" never deletes bonus games (reuse the existing "emotionally attached" joke).
5. Unlocks persist. Reset progress wipes them too.
6. Debug: `?unlockBonus=1` on the shell URL unlocks all bonus games without playing the ending (for tests and for you).

## A3. The Game window
Bonus games are `.exe` files, so they open in a **plain game window**, not in Edgy: a normal `Window` whose content is just the iframe (no address bar, no favorites).
- Same sandbox as Edgy: `sandbox="allow-scripts allow-forms allow-pointer-lock"`, no `allow-same-origin`.
- Default size 1280×760 (clamped to the desktop), maximize allowed, resize allowed (the shell's resize unlock is long done by then).
- Same protocol handling as Edgy (`event.source` check, PAUSE on minimize/blur, RESUME on restore).
- **Fullscreen** (added later): a fullscreen button in the title bar, and `System32.fullscreen()` (message `FULLSCREEN`) from the game; the shell fullscreens the game area only (no taskbar or desktop), tells the game with `FULLSCREEN { on }` and leaves when the window closes. SpaceSaga: **F**, **Alt+Enter**, and a Fullscreen button on the pause screen.
- The iframe needs keyboard focus. When the window is focused, call `iframe.focus()`. The game itself shows "Click to focus" if it loses focus (B9).

## A4. Protocol additions
Bonus games don't win; they end runs. Add to the SDK (`games/_shared/sdk.js`) and the shell:

```js
System32.runOver({ score, distance, pickups, timeMs })   // → { type: 'RUN_OVER', payload }
```
- The shell stores the best `score` per bonus game in `bonus.best[gameId]` and sends it back as `best` in INIT.
- On a new best, the shell shows a toast: *"SpaceSaga: new best — 12,480"*.
- `won()` / `lost()` from a bonus game are ignored (log a warning in debug only).
- `progress()` works as before but has nowhere to show in a game window, so the shell ignores it there.

## A5. Shell acceptance
- [ ] After the ending, the toast appears once; the bin shows `SpaceSaga.exe`; Open and Restore both work; Restore puts it on the desktop and Start menu.
- [ ] Game window opens with the sandboxed iframe, gets keyboard focus, pauses on minimize.
- [ ] `RUN_OVER` stores bests and returns them in INIT; new-best toast.
- [ ] Old saves migrate; Reset progress clears bonus state; `?unlockBonus=1` works.
- [ ] Core game flow (integrity, ending) is unchanged; existing suites pass.

---

# Part B — SpaceSaga

## B1. Tech
- **three.js**, vendored and pinned. Pick the latest stable release, record the version in `CREDITS.md`. Put it in `games/_shared/vendor/three/` (so later bonus games reuse it): `three.module.min.js`, `addons/loaders/GLTFLoader.js`, `addons/utils/SkeletonUtils.js`, and the meshopt decoder (`addons/libs/meshopt_decoder.module.js`).
- **ES modules + an import map** in `index.html`:
  ```html
  <script type="importmap">
    { "imports": { "three": "../_shared/vendor/three/three.module.min.js",
                   "three/addons/": "../_shared/vendor/three/addons/" } }
  </script>
  <script src="../_shared/sdk.js" data-game="space-saga"></script>
  <script type="module" src="src/main.js"></script>
  ```
  This works because `serve.py` (and GitHub Pages) send `Access-Control-Allow-Origin: *`. The SDK stays a classic script.
- No other dependencies at runtime. No CDN.

## B2. Files
```
games/space-saga/
├── index.html
├── style.css              # HUD + menus (DOM overlay on top of the canvas)
├── src/
│   ├── main.js            # boot, loop, state machine (loading → title → running → dead)
│   ├── config.js          # every tunable number
│   ├── assets.js          # loads GLBs, builds pools, maps animation clips
│   ├── world.js           # track segments, decor, starfield, planets, lighting
│   ├── player.js          # lanes, jump, slide, animation states, hitbox
│   ├── spawner.js         # pattern-based obstacle/pickup spawning
│   ├── collision.js       # lane/z box checks
│   ├── hud.js             # score, distance, pickups, menus
│   └── audio.js           # WebAudio synth sfx + beat
└── models/                # processed GLBs only (committed)

tools/
├── inventory-assets.mjs   # step 0, see B3
├── assets.json            # which source models are used, as which role, at what scale
└── build-assets.mjs       # source GLTF → optimized GLB in games/space-saga/models/
```

## B3. Asset pipeline

### Step 0: inventory (do this first, then stop and show me)
`tools/inventory-assets.mjs` walks `assets/source/ultimate-space-kit/*/GLTF/`, parses every `.gltf` JSON (no rendering needed), and writes `ASSET_MANIFEST.md` with one row per model:

| Folder | File | Animated? | Animation clip names | Triangles | Bounding box (w×h×d) | Textures |

Then propose a pick for each **role** below and **stop for my approval** before building. Selection rules:
- **Player:** a character with the most of: run, jump, death, idle. Prefer clear silhouettes.
- **Enemies (1–2):** animated, walking/flying, readable from behind.
- **Obstacles:** at least 3 *low* (jump over: rocks, crates, small machinery), 2 *high* (slide under: anything wide that can sit on legs/hover at head height, e.g. a pipe, antenna, sign, wreck part), 2 *blockers* (switch lanes: big structures, parked vehicles).
- **Pickups:** 1–2 small items from `Items` (gem/battery/coin-like). If nothing fits, a procedural glowing octahedron.
- **Decor:** 6–10 side props (plants, crystals, rocks, buildings) for the track edges.
- **Backdrop:** 2–3 planets.
- Total processed size budget: **≤ 6 MB** (all GLBs together). Prefer models that share the kit's atlas texture.

### Step 1: build
`tools/assets.json` records each chosen model: source path, output name, role, target scale (so models are normalized once, at build time).

`tools/build-assets.mjs` uses `@gltf-transform` (run via `npx`, dev-only, never needed at runtime) to, per model:
- convert `.gltf` + `.bin` + textures → single `.glb`,
- apply the role's scale and center the model on its feet (origin at bottom center),
- weld/dedupe/prune, meshopt-compress, resize textures to max 1024 px and convert to WebP,
- **keep animations** (verify clip count before/after; fail the build if any are lost).

The script prints a size table and fails if the total exceeds 6 MB. Commit the GLBs, `assets.json` and both scripts. The raw pack stays out of git; anyone without it just uses the committed GLBs.

### Animation mapping
`assets.js` maps clips by case-insensitive name match and logs the mapping in debug:

| State | Matches | Fallback if missing |
|---|---|---|
| run | `run`, `sprint` | `walk` played at 1.6× |
| jump | `jump` | run clip + the code's jump arc |
| slide | `slide`, `duck`, `crouch`, `roll` | squash the model to 50% height and tilt forward 25° for the slide duration |
| death | `death`, `die`, `hit` | fall over backwards (procedural rotation) |
| idle | `idle` | first frame of run |

Crossfade between clips over 0.12 s.

## B4. Gameplay

### Controls (keyboard; desktop only)
| Action | Keys |
|---|---|
| Lane left / right | A / D or ← / → |
| Jump | W / ↑ / Space |
| Slide | S / ↓ (while airborne: fast-fall, then slide on landing) |
| Pause | P / Esc |
| Start / restart | Enter or Space on title/death screen |

Inputs are buffered for 120 ms (a lane switch pressed just before landing still happens).

### Movement
- 3 lanes, lane width **2.6** units. Lane switch tweens over **0.12 s** (ease-out), and you can queue one more switch.
- **Jump:** fixed arc, height 2.2, duration 0.65 s (not physics-driven; same every time).
- **Slide:** 0.6 s, hitbox height halved.
- The player stays at z = 0; the **world moves toward the camera** (treadmill). Segments and obstacles that pass behind the camera are returned to their pools.

### Speed and scoring
- Speed starts at **12 u/s** and rises by **0.18 u/s every 50 m** to a cap of **34 u/s**. 1 unit = 1 m in the HUD.
- Score = distance (m) + 50 × pickups, with a ×2 multiplier while a combo of 10+ pickups without missing one is active (stretch: multiplier pickup).
- One hit ends the run (classic runner). A **shield** pickup (stretch, after the MVP) absorbs one hit.

### Fair spawning (important)
Never place obstacles randomly per lane. Spawn **patterns**: hand-authored rows of 1–4 lines of obstacles, defined in `config.js` as data, e.g.:

```js
{ id: 'low-mid',      tier: 0, rows: [ ['.', 'L', '.'] ] },
{ id: 'wall-left2',   tier: 0, rows: [ ['B', 'B', '.'] ] },
{ id: 'slide-gate',   tier: 1, rows: [ ['H', 'H', 'H'] ] },
{ id: 'zigzag',       tier: 1, rows: [ ['B', '.', 'B'], ['.', 'B', '.'] ], gap: 14 },
{ id: 'jump-or-dodge',tier: 2, rows: [ ['L', 'B', 'L'] ] },
{ id: 'enemy-cross',  tier: 2, rows: [ ['E>', '.', '.'] ] },   // enemy walks across lanes
```
`L` low (jump), `H` high (slide), `B` blocker (dodge), `E` enemy (moves one lane per 0.8 s in its direction), `P` pickup, `.` empty.

Rules:
- Every row must have **at least one survivable action**; a test validates every pattern statically (B11).
- Distance between rows scales with speed so reaction time stays ≥ **0.55 s** at any speed.
- Tiers unlock by distance: tier 0 from 0 m, tier 1 from 400 m, tier 2 from 1000 m. Weighted random from unlocked tiers, never the same pattern twice in a row.
- Pickups fill the safe path in short arcs (over a jump, along a lane).

### Collision
Logical boxes, not mesh collision: each role has a box in `config.js` (lane, z-length, height range), at 80% of the visual size to be forgiving. Player box: lane position (interpolated during switches), height 0–1.8 (0–0.9 sliding), raised by the jump height. A **side clip** (hitting a blocker mid-switch) bounces you back to the previous lane once and shakes the camera; a second side clip within 1 s is fatal.

## B5. World and visuals
- **Track:** a dark metal floor strip with glowing lane lines, built from repeating procedural segments (no assets). Segment length 20, pool of 12.
- **Edges:** kit decor (plants, crystals, rocks, structures) scattered on both sides from a pool, random rotation/scale ±15%.
- **Sky:** procedural starfield (~2,000 points on a large sphere, slowly rotating), plus 2–3 kit planets far away with slow drift. Light fog matching the sky color so things fade in, not pop in.
- **System32 callback:** rarely (every ~600 m), a floating **pop-up ad window** drifts past as debris: a flat box with a canvas texture of a DOM-ination ad ("You won a FREE GPU!"). Decorative only.
- **Lighting:** hemisphere light + one directional light. Shadows on the player only (small shadow map following the player). No post-processing in the MVP.
- **Camera:** behind and above the player (offset (0, 3.2, 6.5), looking at (0, 1.2, −6)), follows the lane with lag, slight FOV increase with speed (60° → 70°), shake on hit.
- **Performance target:** 60 fps on a laptop iGPU at 1280×720. Cap `devicePixelRatio` at 1.5. Use pools for everything that spawns; `InstancedMesh` for repeated decor where possible; clone animated enemies with `SkeletonUtils.clone`. Add `?quality=low` (no shadows, fewer stars and decor, DPR 1) and auto-drop to low if the average frame time stays above 22 ms for 3 s.

## B6. Screens and HUD
- **Loading:** progress bar from the loading manager, flavor text cycling: *"Restoring SpaceSaga.exe from Recycle Bin…"*, *"Ignoring 3 warnings…"*.
- **Title:** the player idling on the track with the starfield behind; "SpaceSaga" logo (CSS text, original styling), *"Press Enter to run"*, best score from INIT, controls list.
- **HUD (DOM overlay):** distance (big), score, pickups, best; a "NEW BEST" flash when you pass your best.
- **Pause:** dim overlay, Resume / Restart.
- **Death:** 0.4 s slow-motion + death animation, then panel: distance, pickups, score, best, *"Run again (Enter)"*. Send `System32.runOver(...)` **once** when the panel appears.

## B7. Audio
WebAudio synth only, consistent with the rest of System32, and only if `soundOn` from INIT. Footstep tick (rate follows speed), jump whoosh, slide swish, pickup blip (pitch rises with combo), crash, and a simple looping synth beat on the title and while running (tempo rises slightly with speed). Mute toggle: M.

## B8. Easter eggs (`SHELL_EFFECT effect:'egg'`, add ids to the shell registry)
| id | Trigger | Effect |
|---|---|---|
| `saga-404` | Reach exactly 404 m (crossing it) | HUD briefly shows *"Distance not found"*. |
| `saga-popup` | Jump through a floating pop-up debris window | It shatters; toast *"popup_guard.sys would be proud."* |
| `saga-afk` | Stay on the title screen for 60 s | The player sits down. |

## B9. Sandbox and focus details
- Keyboard focus: if the document loses focus while running, auto-pause and show *"Click to continue"*.
- `onPause`/`onResume` from the shell pause the loop exactly (game-time clock, like the core games). Also pause when `document.hidden`.
- Handle `webglcontextlost` / `webglcontextrestored`: pause, show a message, rebuild GPU resources on restore.
- No `localStorage`; bests come from the shell.
- If WebGL isn't available, show a friendly error screen instead of crashing.

## B10. Testing hooks
- `?seed=N` deterministic patterns and decor; `?speed=N` game clock multiplier; `?god=1` no death; `?quality=low`; `?debug=1` → `window.__SPACESAGA = { state(), setDistance(m), spawnPattern(id), kill(), config }` and an on-screen FPS / draw-call counter.
- Headless Chromium uses software WebGL (SwiftShader), so frame-rate numbers there are meaningless; run tests with `?quality=low` and test logic, not performance.

## B11. Tests
- **Pattern validator:** for every pattern, prove each row has at least one survivable action (some lane that's empty, low-with-jump, or high-with-slide), and that consecutive rows are reachable with one lane switch at the minimum gap at max speed.
- Lane switching, buffered input, jump arc timing, slide hitbox, side-clip bounce then second-clip death.
- Seeded run with a bot that reads upcoming rows and picks a safe action: survives 2,000 m in god-free mode at 1× speed.
- Death sends exactly one `RUN_OVER`; shell stores the best and returns it in INIT; new-best toast.
- Pause/resume exact; context-loss recovery doesn't throw.
- Asset build: every GLB loads, expected clips exist (or fallbacks are logged), total size ≤ 6 MB.
- Manual (real browser, you): it feels good at 60 fps; controls feel responsive; models read clearly at speed.

## B12. Acceptance criteria
- [ ] `ASSET_MANIFEST.md` produced and role picks approved before any game code.
- [ ] Processed models committed, ≤ 6 MB, animations intact; raw pack never committed.
- [ ] Loads inside the shell's sandboxed game window with modules + import map; no console errors.
- [ ] Title → running → death → restart loop works; HUD, pause, NEW BEST.
- [ ] Three lanes, jump, slide, enemies, pickups, fair patterns with tier progression and speed ramp.
- [ ] Animation mapping with fallbacks for missing clips.
- [ ] Starfield, planets, decor, fog, pop-up debris; `?quality=low` and auto-downgrade.
- [ ] `RUN_OVER` → shell best; eggs reach the shell.
- [ ] `CREDITS.md` lists the kit and the three.js version.

## B13. Build order for Claude Code
1. **Shell first (Part A):** registry, state migration, unlock toast, bin item with Open/Restore, game window, `RUN_OVER` in SDK and shell, `?unlockBonus=1`. Test with a stub `games/space-saga/index.html` that has a "Send RUN_OVER" button.
2. **Step 0:** inventory script + `ASSET_MANIFEST.md` + proposed picks. **Stop and wait for approval.**
3. Asset build script + processed GLBs + size check.
4. Vendor three.js, import map, loading screen, scene with track treadmill, starfield, camera.
5. Player: lanes, jump, slide, animation mapping, input buffer.
6. Spawner with patterns + collision + death + HUD + restart. Pattern validator test.
7. Decor, planets, pickups, enemies, speed ramp, tiers, pop-up debris.
8. Audio, eggs, pause/focus/context-loss handling, quality modes.
9. Full test suite, then you play it in a real browser and we tune `config.js`.
