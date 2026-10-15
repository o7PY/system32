# STRATA_SPEC.md — System32 Bonus Game 2: Strata

> **Found in:** Recycle Bin as `Strata.exe` · **gameId:** `strata` · **Folder:** `games/strata/`
> **Bin lore:** *Deleted 11-11-2011. Reason: "user spent 400 hours digging a hole."*
> **Assets:** Kenney (CC0): Voxel Pack, Impact Sounds, RPG Audio, Interface Sounds, UI Audio, Music Jingles, Kenney Fonts. Raw files in `assets/source/` (gitignored).
> **Target:** 5–6 days with Claude Code

A survival-lite block game. Spawn into a big, seeded world of hills, forests, deserts and caves. Punch trees, craft tools, dig down through the layers (the *strata*), find ores, smelt iron, build whatever you want. No mobs, no hunger, no health: just mining, crafting and building. Your world is saved by the shell.

It's our own game. No Minecraft names, textures, sounds, fonts or characters anywhere.

---

## 0. What already exists (reuse, don't rebuild)

- **Bonus-game system** (SPACESAGA_SPEC Part A): registry, bin item, Open/Restore, game window, sandbox, PAUSE/RESUME, `?unlockBonus=1`.
- **three.js** v0.186.1 vendored in `games/_shared/vendor/three/`, loaded through an import map (works under `serve.py` and GitHub Pages).
- **Asset pipeline pattern** from SpaceSaga: inventory script → manifest → **approval checkpoint** → build script → committed outputs with a size budget.

---

# Part A — Shell changes

## A1. Registry and unlock
Add Strata to `bonusGames`:
```js
{ id: 'strata', file: 'Strata.exe', title: 'Strata', icon: 'pickaxe',
  src: 'games/strata/index.html', unlock: 'ending', saves: true,
  binLore: 'Deleted 11-11-2011. Reason: "user spent 400 hours digging a hole."' }
```
- New players: after the ending, the toast counts both games: *"🗑 Recycle Bin: 2 items could not be deleted."*
- **Existing saves that already saw the ending:** on the next desktop load, unlock Strata and show *"🗑 Recycle Bin: 1 item could not be deleted."* once. Generalize this: any bonus game whose unlock condition is already met but isn't in `bonus.unlocked` gets unlocked on load, with one combined toast.
- Strata reports eggs with the `strata-` prefix only.

## A2. World saves (new protocol)
Strata needs to save a world, which no game has done before. Add to the SDK and shell:

```js
System32.save(data)                 // → { type: 'SAVE', payload: { data } }; data is a string
System32.onSaved(fn)                // shell → game: { type: 'SAVED', ok, bytes, error? }
System32.onInit(({ save }) => …)    // INIT now includes the last saved string (or null)
```
- Only bonus games with `saves: true` may save. Others are ignored.
- The shell stores it as its own localStorage key, `system32.save.<gameId>`, **not** inside the main state object, so a big world can't break the shell's own state.
- Hard cap **1.5 MB per game** (string length). Over the cap → `SAVED { ok: false, error: 'too-large' }`, nothing written.
- Writes are wrapped in try/catch; a quota error returns `ok: false, error: 'quota'`.
- Reset progress deletes all `system32.save.*` keys. Settings gets a small "Bonus game saves" row per game with its size and a **Delete save** button (with confirmation).

## A3. Shell acceptance
- [ ] Strata appears in the bin after the ending (new players) or on next load (players who already finished).
- [ ] SAVE/SAVED/INIT save round-trip works; cap and quota errors are reported; core state is untouched.
- [ ] Reset progress and per-game Delete save both work.
- [ ] Existing suites (shell, bonus-shell, SpaceSaga) still pass.

---

# Part B — Strata

## B1. Tech and files
- three.js from `../_shared/vendor/three/` via import map; ES modules; SDK as classic script.
- **Web Worker for terrain generation and meshing.** Workers must be same-origin, and a sandboxed page has an opaque origin, so `new Worker('worker.js')` will throw. Do this instead: `fetch('src/worker.js')` → `Blob` → `URL.createObjectURL` → `new Worker(blobUrl)` (classic worker). The worker file must therefore be **self-contained** (no `import`; noise and meshing code are duplicated or concatenated at build time). If worker creation fails anyway, fall back to generating on the main thread in time-sliced batches (≤ 6 ms per frame). Test both paths.

```
games/strata/
├── index.html, style.css
├── src/
│   ├── main.js          # boot, loop, state machine (loading → menu → playing → paused)
│   ├── config.js        # every tunable number, block table, recipes, world settings
│   ├── blocks.js        # block registry: id, name, textures per face, hardness, tool, drops
│   ├── world.js         # chunk storage, get/setBlock, edits diff, chunk load/unload
│   ├── worker.js        # self-contained: noise, terrain gen, chunk meshing with AO
│   ├── renderer.js      # scene, sky, day/night, fog, chunk meshes, frustum culling
│   ├── player.js        # first-person controller, AABB physics, input
│   ├── interact.js      # DDA raycast, mining with crack stages, placing, drops
│   ├── items.js         # item registry (blocks + tools + materials), stacks, durability
│   ├── inventory.js     # hotbar + inventory model, drag/drop logic
│   ├── crafting.js      # recipe matching (shaped + shapeless), furnace
│   ├── ui.js            # DOM: hotbar, inventory, crafting, furnace, menus, debug overlay
│   ├── save.js          # serialize/deserialize, autosave
│   └── audio.js         # sample playback per material + synth ambient music
└── assets/              # built outputs only (atlas, icons, sounds, font)
```

## B2. Assets

### Step 0: inventory (then stop for approval)
`tools/strata/inventory-assets.mjs`:
- Extracts the zips in `assets/source/` into `assets/source/<pack>/` if not already extracted (still gitignored).
- Lists every PNG in `kenney_voxel-pack` (name, size, which subfolder: tiles / items / characters) and every audio file in the sound packs (name, duration, format).
- Writes `STRATA_ASSET_MANIFEST.md` and a proposed `tools/strata/assets.json` mapping each **role** below to a source file. **Stop and wait for my approval.**

Roles:
| Role | Needed |
|---|---|
| Block faces | grass top, grass side, dirt, stone, cobblestone, sand, gravel, log top, log side, planks, leaves (with transparency), glass, water, coal ore, iron ore, bedrock, crafting table top/side/front, furnace front/side/top, snow (for mountains), cactus (desert) |
| Item icons | pickaxe, axe, shovel, sword (ideally per tier), stick, coal, raw iron, iron ingot |
| Sounds | break/dig and footstep per material group: **stone, dirt/gravel, grass/leaves, wood, sand, glass**; place block; item pickup; inventory open/close and UI click; furnace done; a short jingle for the first iron tool |
| Font | one readable pixel-style font from Kenney Fonts |

If a role has no good match (likely: per-tier tool icons, some block faces), mark it **"generate"**. The build script then tints a base icon per tier (wood brown, stone grey, iron white) or draws a simple 16×16 pixel-art fallback in code.

### Step 1: build
`tools/strata/build-assets.mjs` (dev-only deps via `npm --prefix tools`):
- **Block atlas:** all block faces resized to **32×32** (nearest-neighbour, for a crisp look), packed into one PNG atlas with **2 px edge padding** per tile (duplicate border pixels) to stop texture bleeding. Writes `atlas.png` + `atlas.json` (tile name → UV rect).
- **Item icons:** 32×32 PNGs into one `items.png` sheet + JSON.
- **Sounds:** copy chosen files as `.ogg` (convert if needed), trim silence, normalize loudness, mono. Budget ≤ 1.5 MB total.
- **Font:** copy the chosen TTF/OTF.
- Total budget for `games/strata/assets/` ≤ **3 MB**; the build fails if exceeded.
- Add the packs to `CREDITS.md`.

Block **icons** for the hotbar and inventory are **not** assets: render each block once at startup as a tiny isometric cube from the atlas (offscreen canvas or a small three.js render target) and cache them as data URLs.

## B3. World

- **Size:** **1024 × 1024** blocks, **128** tall (y = 0 bedrock, sea level y = 48). Configurable in `config.js` (`worldSize`, power of two). The edge is a soft world border: invisible wall plus a faint grid shader when you're within 8 blocks.
- **Chunks:** 16 × 16 × 128. Stored as `Uint8Array` (block ids, max 255 block types). Chunks are generated **lazily** as the player approaches and **unloaded** (mesh and data dropped) when far away; unloaded chunks are regenerated from the seed + edits.
- **View distance:** default 8 chunks radius, setting 4–12. Load/mesh nearest-first, max 2 new meshes per frame.
- **Terrain generation** (seeded, deterministic, in the worker):
  - 2D noise layers (fractal simplex/Perlin, written in-house, no deps) for height, temperature and moisture → **biomes:** plains, forest, desert, mountains (with snow above y = 90), beaches near sea level.
  - 3D noise for **caves** (worm/cheese-style, open to the surface in some places) below y = 60.
  - **Ores:** coal (y 20–90, common), iron (y 5–60, less common), placed as small clusters with 3D noise or seeded blobs.
  - **Trees** in forest/plains (log trunk 4–6 tall + leaf blob), **cactus** in desert. Trees must not be cut at chunk borders: generate features from a seed per chunk *and* its neighbors, writing only the blocks that fall in the current chunk.
  - Water fills everything below sea level that's air after carving (oceans, lakes). Flowing water was added later, see README (Flowing water) and `STRATA_PART2_SPEC.md` §16.
  - Bedrock at y = 0, with a little noise at y = 1–3.
- **Spawn:** search outward from the world center for a dry, grassy column; spawn on top. Saved after the first load.

## B4. Rendering
- **Meshing (worker):** per chunk, emit only faces next to air/transparent blocks. **Vertex ambient occlusion** (the classic 3-neighbor corner rule) baked into vertex colors, with the quad diagonal flipped to avoid AO artifacts. Separate meshes per chunk for **opaque**, **cutout** (leaves, glass; alpha test) and **water** (transparent, rendered last, slight wave in the vertex shader, no depth write). Transfer typed arrays back with `postMessage(…, [buffers])`.
- **Atlas sampling:** `NearestFilter`, no mipmaps for the base level (or mipmaps generated with the padding in mind), UVs inset by half a texel.
- **Sky and time:** gradient sky shader, a sun and moon quad, simple flat clouds that drift. **Day/night cycle: 20 minutes per day.** Sun direction drives a directional light; night is dark blue, not black (no block light in v1). Fog matches the sky color at the view-distance edge.
- **Chunk edits:** setting a block remeshes its chunk, plus neighbors if it sits on a chunk border.
- **Performance target:** 60 fps at view distance 8 on a laptop iGPU at 1280×720. Cap DPR at 1.5. Frustum-cull chunk meshes. `?quality=low` (view distance 5, no clouds, no water wave).

## B5. Player
- **First person with pointer lock.** Click the canvas to lock. **Esc** releases the lock (the browser forces this) → pause menu.
- **Physics:** AABB 0.6 × 1.8 × 0.6, eye height 1.62. Gravity, jump, step-up onto 1-block ledges is **not** automatic (jumping is part of the feel). Swept AABB collision per axis (no tunneling at high speed). Swimming: slower, Space rises, gentle sink.
- **Controls** (all rebindable later; defaults below):

| Action | Default |
|---|---|
| Move | W A S D |
| Jump / swim up | Space |
| Sprint | **double-tap W**, or hold **Shift** |
| Sneak (no falling off edges, slower) | **C** |
| Mine / attack | Left mouse (hold) |
| Place / use (crafting table, furnace) | Right mouse |
| Pick block (select it in the hotbar if you have it) | Middle mouse |
| Hotbar slot | 1–9, mouse wheel |
| Inventory | E |
| Drop item | Q |
| Pause | Esc |
| Debug overlay | F3 |

  **Never use Ctrl in any binding.** Ctrl+W, Ctrl+T and Ctrl+N are browser shortcuts the page can't block; a player sprinting with Ctrl+W would close the whole tab. Also `preventDefault` the context menu and the mouse wheel on the canvas.
- **Settings** (pause menu, saved with the world): mouse sensitivity, FOV (60–100), view distance, invert Y, sound volume, music on/off.

## B6. Mining, placing, drops
- **Raycast:** voxel DDA from the eye, reach **5 blocks**. The targeted block gets a thin dark outline.
- **Mining:** hold left mouse. Break time = `hardness × base / toolSpeed` (with the right tool type and tier) or `× 3.3` without the required tool. Show **10 crack stages** as an overlay (procedural noise textures generated at startup). Releasing or looking away resets progress.
- **Tool requirements:** stone/cobblestone/coal ore need a pickaxe; iron ore needs a **stone** pickaxe or better; bedrock is unbreakable. Mining a block that needs a better tool still breaks it (slowly) but drops nothing.
- **Drops:** broken blocks spawn a small spinning, bobbing item cube (or flat icon for items) that falls with simple physics and is **picked up** when the player is within 1.5 blocks (pull toward the player, pop sound). Drops merge with nearby identical drops and despawn after 5 minutes. Stone drops cobblestone; grass drops dirt; leaves sometimes drop sticks (10%); coal ore drops coal; iron ore drops raw iron; glass drops nothing.
- **Placing:** right click places the selected block on the targeted face, never inside the player's AABB. Crafting table and furnace open their UI on right click instead.
- **Tool durability:** wood 60, stone 130, iron 250 uses. Shown as a bar under the hotbar icon. Breaks with a sound at 0.

## B7. Items, inventory, crafting
- **Inventory:** 9-slot hotbar + 27 slots. Stacks up to 64 (tools don't stack). Starts empty.
- **Inventory UI (E):** player grid, hotbar, and a **2×2 crafting grid** with output. Interactions:
  - left click picks up/places a stack, right click picks up half / places one, shift-click moves between hotbar and inventory (or takes all crafted output when possible), drag with right mouse held to spread one per slot.
  - Closing the inventory returns crafting-grid items to the inventory (drop them if full).
- **Crafting table (3×3)** and **furnace** (input, fuel, output, progress arrow; 4 s per item; coal smelts 8 items, planks 1.5, sticks 0.5) have their own panels.
- **Recipes** (data in `config.js`; shaped recipes match anywhere in the grid and mirrored):

| Output | Recipe |
|---|---|
| 4 planks | 1 log (shapeless) |
| 4 sticks | 2 planks vertical |
| Crafting table | 2×2 planks |
| Furnace | 8 cobblestone ring (3×3 table) |
| Pickaxe | 3 material on top row + 2 sticks down the middle |
| Axe | 3 material in an L + 2 sticks |
| Shovel | 1 material + 2 sticks |
| Sword | 2 material vertical + 1 stick |
| Glass | smelt sand |
| Iron ingot | smelt raw iron |
| Torch-free v1 | (no torches: there's no block light yet) |

  Materials: planks (wood tier), cobblestone (stone tier), iron ingot (iron tier).
- **Tool speeds:** hand 1, wood 2, stone 4, iron 6 (only against the tool's block type).

## B8. Saving
- **What's saved:** seed, world size, spawn, player position/orientation, inventory (incl. durability), furnace contents, time of day, settings, and **the edits diff**: only blocks that differ from what the generator would produce.
- **Format:** JSON header + edits encoded per chunk as a list of `(localIndex, blockId)` pairs, packed into a byte array and base64-encoded. Compress with **`CompressionStream('deflate-raw')`** if available (it is in current Chrome and Firefox), else uncompressed.
- **When:** autosave every 60 s while playing, on pause, on shell PAUSE (window minimized/blurred), and on "Save & Quit to title". Show a small "Saved" indicator; on `SAVED ok:false`, show a clear warning (*"World too big to save: 1.6 MB / 1.5 MB. Try removing some builds."*).
- **Menu:** *Continue* (if a save exists), *New World* (seed field: blank = random, text → hashed seed; confirms before overwriting), *Settings*.
- Load path: INIT `save` → decompress → validate (version, size, sane numbers; reject garbage with a "Save could not be loaded" message and offer New World).

## B9. Audio
- Samples from the Kenney packs by **material group**: dig ticks while mining (every 0.25 s), break, footsteps (rate follows speed; silent while sneaking), place, pickup pop, UI clicks, inventory open/close, furnace finished, tool break, and the jingle on crafting the first iron tool.
- Music: sparse WebAudio synth ambient pads every few minutes, consistent with the rest of System32. Off when the shell's sound is off; respects `System32.onSound`.
- Positional audio for block sounds (three.js `PositionalAudio` or simple panning by direction).

## B10. Screens and HUD
- **Loading:** progress while the atlas, sounds and the first chunks around spawn load. Flavor text: *"Restoring Strata.exe… recovering 400 hours of digging…"*
- **Title:** slow-rotating camera over a generated world (seed 0) behind the menu. "Strata" in the Kenney pixel font.
- **HUD:** crosshair, hotbar with selected-slot highlight and the item name shown briefly on change, durability bars. "Saved" indicator. No health, no hunger.
- **F3 overlay:** FPS, position, chunk, biome, facing, loaded chunks, draw calls, worker queue length.
- **Pause:** Resume, Settings, Save & Quit to title.

## B11. Easter eggs (`SHELL_EFFECT effect:'egg'`, add to the shell registry)
| id | Trigger | Effect |
|---|---|---|
| `strata-adblock` | Mine a rare **"Ad Block"** ore (a block with a tiny pop-up-window texture, generated in code, ~1 per 4 chunks deep underground) | Drops a "pop-up" item; toast *"Ad Block enabled."* |
| `strata-bedrock` | Try to mine bedrock for 10 s straight | Subtitle: *"It's called bedrock. It's not going anywhere."* |
| `strata-cloud` | Place a block at the build limit (y = 127) | Subtitle: *"Saved to cloud storage."* |

## B12. Testing hooks
- `?seed=N`, `?flat=1` (superflat world for tests), `?worldSize=N`, `?quality=low`, `?noWorker=1` (force main-thread fallback), `?debug=1` → `window.__STRATA = { state(), getBlock(x,y,z), setBlock(x,y,z,id), give(item, n), tp(x,y,z), setTime(t), save(), load(str), config }`.
- Headless Chrome uses software WebGL: tests check logic, not frame rate. Pointer lock may not engage headless; the controller must accept a test hook to apply look deltas directly.

## B13. Tests
- **Determinism:** same seed → identical chunk data (hash) in worker and fallback paths; trees and ores identical across chunk borders regardless of generation order.
- **Meshing:** face counts for known small layouts (single block = 6 faces; two adjacent = 10; leaves next to stone keep both faces); AO values for a corner case.
- **Raycast:** hits the right block and face along axis-aligned and diagonal rays, respects reach.
- **Physics:** no falling through the floor at max fall speed; can't walk into walls; sneaking stops at edges; can jump up exactly one block.
- **Mining and tools:** table-driven break times and drops for each block × tool tier; iron ore with a wood pickaxe drops nothing; durability decrements and breaks.
- **Crafting:** every recipe in the table, mirrored shapes, wrong shapes produce nothing, shapeless planks, furnace timing and fuel.
- **Inventory:** stacking to 64, split/place-one, shift-click, closing returns crafting items.
- **Saving:** edits round-trip (place 500 random blocks → save → reload → identical); a world with no edits saves under 2 KB; compressed path and fallback path; too-large and garbage saves handled.
- **In the shell:** Strata unlocks for both new and existing finished saves; SAVE/INIT round-trip through the real shell; PAUSE autosaves; pointer lock works inside the sandboxed game window (`allow-pointer-lock` is already in the sandbox).
- **Manual (you, real browser):** feel of movement and mining, pointer lock, fps at view distance 8 and 12, a 20-minute survival session from punching a tree to an iron pickaxe.

## B14. Acceptance criteria
- [ ] Asset manifest approved before code; built assets ≤ 3 MB; credits updated.
- [ ] 1024×1024×128 seeded world with biomes, caves, ores, trees, water; chunks load and unload smoothly around the player.
- [ ] Worker via Blob URL works in the sandbox; main-thread fallback works.
- [ ] First-person controls, pointer lock, no Ctrl bindings, settings.
- [ ] Mining with crack stages, tool tiers and requirements, drops and pickup, placing, durability.
- [ ] Inventory, 2×2 and 3×3 crafting, furnace, all recipes.
- [ ] Day/night cycle, sky, clouds, fog, AO, water.
- [ ] Saves through the shell with compression, autosave, cap handling; Continue/New World.
- [ ] Sounds per material; music respects the shell's sound setting.
- [ ] Three eggs reach the shell; no console errors; 60 fps target met on your laptop at view distance 8.

## B15. Build order for Claude Code
1. **Shell (Part A):** registry entry, unlock-on-load generalization, SAVE/SAVED/INIT `save`, per-game save keys and cap, Settings rows. Test with a stub page that saves and loads a string.
2. **Step 0:** extract zips, inventory, `STRATA_ASSET_MANIFEST.md`, proposed `assets.json`. **Stop for approval.**
3. Asset build: atlas with padding, item sheet, sounds, font; budget check; credits.
4. World core: block registry, chunk storage, noise, terrain + biomes, worker via Blob URL with fallback, meshing with AO, chunk loading around a free-fly camera.
5. Player controller: pointer lock, physics, collision, swimming, sprint/sneak.
6. Interaction: raycast, outline, mining with cracks, placing, drops and pickup.
7. Items, inventory UI, crafting (2×2, 3×3), furnace, tools, durability.
8. Day/night, sky, clouds, water shader, fog, quality settings.
9. Saving (diff, compression, autosave, menus), title screen, pause, settings.
10. Audio, eggs, F3 overlay.
11. Full test suite, then a real-browser playtest and tuning (`config.js`).
