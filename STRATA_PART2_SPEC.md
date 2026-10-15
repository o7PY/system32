# STRATA_PART2_SPEC.md — Strata Part 2: Survival, Mobs, and an Ending

> Builds on **STRATA_SPEC.md** (Part 1). Finish and test Part 1 first; this spec only describes what changes or gets added.
> **Target:** 8–10 days with Claude Code, in the phases of §14.

Part 1 is survival-lite: mine, craft, build, no danger, no goal. Part 2 turns Strata into a full survival game **you can win**:

- **Hearts, hunger, air, armor, death and respawn.**
- **Mobs:** farm animals, night-time hostiles, and a System32-flavoured original enemy.
- **Lighting and torches**, so darkness matters.
- **The Underlayer:** a second, hostile dimension *below* the bedrock (the deepest stratum).
- **The Kernel:** a final arena and a boss, **the Garbage Collector**. Beat it and the game shows credits and records the win in the shell.

Everything here is original: no Minecraft names, mob designs, dimensions, materials or bosses.

---

## 0. The progression (the "why" of every system)

| Act | Goal | Unlocked by |
|---|---|---|
| 1. First night | Shelter, torches, a bed | Wood + stone tools; sheep for wool |
| 2. Iron age | Iron tools and armor, a bow | Mining iron, smelting |
| 3. Deep dig | **Cobalt** (a new, rare ore at y 2–16) → cobalt pickaxe | Iron pickaxe |
| 4. Through the floor | Break **Cracked Bedrock** with the cobalt pickaxe → fall into **the Underlayer** | Cobalt pickaxe |
| 5. The Vaults | Raid 3 **Data Vaults** for 3 **Kernel Shards** → craft the **Kernel Key** | Surviving the Underlayer |
| 6. The Kernel | Use the key at the **Kernel Gate** → boss arena → defeat **the Garbage Collector** | Kernel Key |
| Credits | *"Garbage collection complete."* World continues afterwards (post-game). | Boss defeated |

A first-time player should finish in **3–5 hours**. Everything a player needs to find (cracked bedrock, vaults, the gate) has an in-game way to locate it (§6.4, §7.3).

---

## 1. Shell changes

### 1.1 Completion message
```js
System32.complete({ timeMs, deaths, difficulty })   // → { type: 'GAME_COMPLETE', payload }
```
- Only bonus games may send it. The shell stores `bonus.completed[gameId] = { timeMs, deaths, difficulty, at }` (keeps the best time per difficulty).
- Shows a toast *"Strata.exe: kernel restored."*, adds a green check overlay to the Strata icon (desktop, bin, Start menu), and counts egg `strata-complete`.
- INIT gains `completed` (the stored object or null) so the title screen can show a 🏆 and best time.

### 1.2 Save cap
Raise Strata's cap from 1.5 MB to **2.5 MB** (two dimensions now). The per-origin localStorage quota is ~5 MB shared with the shell and SpaceSaga, so keep quota errors handled exactly as in Part 1.

---

## 2. Survival systems

### 2.1 Health
- **20 HP**, shown as **10 hearts** (half-heart steps). Icons are drawn in code (pixel art), not assets.
- Damage sources: mobs, **fall damage** (falls over 3.5 blocks: 1 HP per block beyond that), **drowning** (10 air bubbles, 1 bubble per 1.5 s underwater, then 2 HP per second), **lava** (4 HP per 0.5 s + 3 s of burning at 1 HP/s), **the void** (instant death below y = −32), **suffocation** (head inside a solid block: 1 HP/s).
- **Regeneration:** when hunger ≥ 16, regain 1 HP every 3 s (costs hunger). Faster (1 HP/s) when hunger is full and the player is fed recently, so eating good food matters.
- Damage feedback: red screen-edge flash, camera tilt toward the damage direction, short invulnerability (0.5 s), hurt sound.

### 2.2 Hunger
- **20 points**, shown as **10 food icons** (drawn in code: a small drumstick-like ham icon of our own).
- **Exhaustion** accumulates and drains hunger by 1 point per 4 exhaustion: sprinting 0.1/m, jumping 0.05, mining a block 0.005, taking damage 0.1, regenerating 1 HP 1.5.
- Hunger ≤ 6: can't sprint. Hunger 0: starvation 1 HP every 4 s, down to 1 HP on Normal, to death on Hard.
- **Eating:** hold right mouse with food selected for 1.6 s. Food table:

| Food | Hunger | Source |
|---|---|---|
| Berries | 2 | Bushes in forests/plains (new block) |
| Apple | 4 | Leaves, 2% drop |
| Raw meat (pork / mutton / beef / chicken) | 2–3 | Animals |
| Cooked meat | 6–8 | Furnace |
| Bread | 5 | 3 wheat (wild wheat grows in plains; v2 has no farming) |
| Glowcap stew | 6 | Underlayer mushrooms + bowl |

### 2.3 Armor
- Four slots (head, chest, legs, feet) in the inventory screen. Tiers: **leather** (from cows), **iron**, **cobalt**.
- Armor points per full set: leather 7, iron 15, cobalt 20. **Damage reduction = points × 4%** (max 80%). Durability like tools. Void, starvation and suffocation ignore armor.

### 2.4 Death and respawn
- Death screen: cause (*"Fell from a high place"*, *"Was deleted by the Garbage Collector"*), score (blocks mined, time survived), **Respawn** button.
- Items drop at the death location and stay for **10 minutes** of game time (no despawn while that chunk is unloaded). A death marker shows on the HUD compass (§6.4).
- Respawn at your **bed** if set and not obstructed, else world spawn.
- **Exception:** dying in **the Kernel** keeps your inventory ("the Kernel doesn't free your memory"). Losing all your gear to the void would make the final fight miserable.
- Setting: **Keep inventory** (off by default), for casual players.

### 2.5 Difficulty (chosen at New World, changeable in settings)
| | Peaceful | Normal | Hard |
|---|---|---|---|
| Hostile mobs | none (boss still exists, no minions) | yes | yes, +50% damage, more spawns |
| Hunger | doesn't drain | drains | drains faster (×1.3) |
| Starvation | — | stops at 1 HP | can kill |

---

## 3. Lighting (required for mobs and torches)

Part 1 had sunlight only. Part 2 adds a real light engine, in the worker:
- Two 4-bit channels per block: **sky light** (15 from the sky, flows straight down unblocked, −1 per step sideways/below an obstruction) and **block light** (from emitters, −1 per block, flood-fill BFS).
- Emitters: **torch 14**, lava 15, furnace while burning 13, glowcap 10, Kernel crystals 12.
- Light is baked into vertex colors with AO. Final brightness = `max(skyLight × daylight, blockLight)` with a gamma curve; torchlight is slightly warm. Sky light uses a uniform for `daylight`, so day/night changes **don't** need remeshing.
- Edits update light incrementally (BFS add/remove queues), remeshing only affected chunks (≤ 1 chunk away for torches).
- Light is never saved; it's recomputed from blocks.

**Torch:** 1 coal + 1 stick → 4 torches. Placed on floors or walls (small 3D mesh, flickering light). This is where Part 1's "no torches" note goes away.

---

## 4. New blocks, items and recipes

Add to the registries and the asset manifest (§11):

| New block / item | Notes |
|---|---|
| **Torch** | See §3. |
| **Chest** | 27 slots, saved. 8 planks ring. |
| **Bed** | 3 wool + 3 planks. Right click at night: skip to morning if no hostile within 8 blocks; always sets spawn. 2 blocks long. |
| **Wool** | From sheep (shear-free: drops 1–2 on death; or right-click sheep with **shears**, 2 iron ingots diagonal, for 2–3 without killing). |
| **Leather** | Cows. Leather armor. |
| **Bow** | 3 sticks + 3 string. Hold right mouse to draw (up to 1 s), release to shoot. Damage 2–9 by draw. |
| **Arrow** | Flint (gravel, 10% drop) + stick + feather → 4. |
| **String, bone, feather, flint, rotten flesh** | Mob and block drops. |
| **Cobalt ore → raw cobalt → cobalt ingot** | Ore at y 2–16, rare (~2 veins per chunk), needs an iron pickaxe. Cobalt tools: speed 9, durability 900. Cobalt armor. |
| **Cracked Bedrock** | Generated at y 1–4 in deep caves: guaranteed **at least 8 within 300 blocks of spawn**, with a faint glow particle so it's findable. Breakable only with a cobalt pickaxe (8 s). Breaking it opens a **Rift** (§6). |
| **Berry bush, wild wheat, apple** | Food. |
| **Bowl** | 3 planks in a V → 4. |
| **Underlayer blocks** | Ash (sand-like), basalt, scorched stone, lava (static, light 15, damages), glowcap (light 10, food), **server rack** (Data Vault walls, unbreakable), **vault door**. |
| **Kernel Shard** (×3), **Kernel Key** | 3 shards in a row on a crafting table. |
| **Tracer** | A compass-like item: iron ingot ring + 1 redstone-free center: **1 cobalt ingot**. In the overworld it points to the nearest cracked bedrock; in the Underlayer to the nearest unraided vault, or the Kernel Gate once you hold the key. |

Furnace gains: cook meat, smelt raw cobalt (8 s), ash → glass.

---

## 5. Mobs

### 5.1 Entity framework
- One entity system for drops, arrows, mobs and the boss: `{ id, type, pos, vel, yaw, aabb, hp, state, timers }`, updated on the fixed timestep. Same swept-AABB collision as the player.
- **Models are built in code from boxes** (voxel style that fits the world), with per-face textures **painted procedurally** into a small mob atlas at startup (16×16 per face, pixel-art palettes per mob). Each mob is data: parts (size, pivot, parent), palette, animation. No model downloads needed.
- Animation: limb swing tied to speed, head looks at its target, hurt flash (red tint 0.2 s), death (tip over, fade, puff of particles).
- Drops spawn as item entities (Part 1 system). XP is out of scope.

### 5.2 AI and pathfinding
- States: `idle → wander → chase/flee → attack`, with per-mob parameters.
- **Pathfinding:** A* over walkable cells (solid below, 2 air above; step up 1, drop up to 3) within 32 blocks, max 600 nodes, recomputed every 0.5 s while chasing or when stuck for 1 s. Spiders treat walls as walkable; flyers use direct steering with simple obstacle avoidance.
- Mobs don't open doors (there are no doors) and can't break blocks (except the boss).
- **Spawning:**
  - Passive: generated with the chunk (2–4 per grassy chunk, 40% chance); slow respawn (1 per 2 min in loaded grassy chunks, cap 20 loaded).
  - Hostile (overworld): on a solid block with **light ≤ 7** (sky light uses current daylight), 24–64 blocks from the player, not in view if possible. Cap 30. Despawn when > 64 blocks away for 30 s.
  - At **sunrise**, overworld hostiles on the surface "lag out": they freeze, flicker and crumble over 3 s (no burning trope). Cave hostiles stay.
- Mob sounds: synthesized with WebAudio (filtered noise + pitch envelopes per mob): groans, clicks, rattles, squeaks. Positional.

### 5.3 Overworld mobs
| Mob | Behaviour | HP | Drops |
|---|---|---|---|
| **Pig** | Wanders; flees when hit | 10 | raw pork 1–3 |
| **Cow** | Same | 10 | raw beef 1–3, leather 0–2 |
| **Sheep** | Same; regrows wool after shearing (2 min) | 8 | mutton 1–2, wool 1–2 |
| **Chicken** | Same; flutters (slow fall) | 4 | raw chicken 1, feather 0–2 |
| **Shambler** (zombie) | Slow chase, melee 3 HP, groups of 2–4 | 20 | rotten flesh 0–2 (food, 4 hunger, 30% chance of brief nausea screen wobble) |
| **Rattler** (skeleton archer) | Keeps 8–12 blocks away, shoots arrows (2–4 dmg), strafes | 20 | bone 0–2, arrow 0–2 |
| **Creepcrawler** (spider) | Fast, climbs walls, pounces; **neutral in daylight** unless hit | 16 | string 0–2 |
| **Pop-up** (original) | A flying ad window with tiny legs that drifts toward you. On contact (no damage) it **covers the screen with a fake ad overlay** for up to 4 s; clicking the ✕ in the overlay (needs leaving pointer lock briefly) or waiting clears it. Spawns at night, ≤ 2 at a time. | 6 | "Ad Block" item (decorative, counts toward an egg) |

All designs are our own: name, silhouette and palette must not resemble Minecraft's mobs.

### 5.4 Underlayer mobs
| Mob | Behaviour | HP | Drops |
|---|---|---|---|
| **Daemon** | Fast fire imp; dashes, then lobs a fireball (4 dmg + 2 s burn); groups of 2–3 | 24 | ash dust, 15% cobalt nugget |
| **Glitch** | A flickering cube. Every 4 s teleports to a spot next to you and swaps up to 3 blocks around itself with random Underlayer blocks; melee 5 | 30 | glitch dust (used for the Tracer upgrade, optional) |
| **Vault Warden** | One per Data Vault, guards the shard room; slow, heavy melee (8), knockback, shield phase every 10 s where it can only be hit from behind | 80 | (the vault chest holds the shard) |

---

## 6. The Underlayer

### 6.1 Entering
Breaking **Cracked Bedrock** with a cobalt pickaxe turns it into a **Rift** block (animated dark-purple surface, light 10). Walking into the Rift (stand inside it for 1 s with a screen-warp effect) moves you to the Underlayer. You arrive on a small safe platform with a return Rift. Rifts link 1:1 by x/z, clamped to the Underlayer size; the return Rift always leads back to the overworld Rift you came from.

### 6.2 World
- Separate chunk store, same engine, **512 × 512 × 96**. Bedrock floor **and** ceiling. No sky light; ambient light is a dim red (minimum brightness 3) plus lava, glowcaps, and crystals.
- Terrain: huge caverns of basalt and scorched stone (3D noise), ash dunes, **lava lakes** at y ≤ 20 (static), glowcap groves (light + food), basalt pillars.
- Hostile spawns ignore light level here (it's always hostile). Cap 20. No passive mobs. Beds **explode-free but don't work**: right-click shows *"You can't sleep here. Something is compiling."*

### 6.3 Data Vaults (×3)
- Generated at seeded positions 120–200 blocks from the Underlayer center, 120° apart. Each is a tower of **server rack** blocks (unbreakable, blinking LED texture generated in code) with:
  - an entrance hall with a **mob spawner** (spawns Daemons until destroyed; breakable with a pickaxe, 5 s),
  - a short parkour/lava section,
  - the shard room: a **Vault Warden** and a chest with **1 Kernel Shard** + loot (cobalt, food, arrows).
- Vault interiors are generated as fixed templates (data, not noise) with small seeded variations.

### 6.4 Finding things
- **Tracer** item (§4) points to the current objective.
- HUD compass strip at the top (on by default, setting to hide): shows N/E/S/W, your death marker, and the Tracer target when you hold a Tracer.
- In the Underlayer, vault towers are tall enough to be seen glowing from far away through the haze.

---

## 7. The Kernel and the Garbage Collector

### 7.1 The Kernel Gate
At the Underlayer center: a ring of server racks around a dark frame. Right click with the **Kernel Key** → the key is consumed, the frame fills with a white Rift → walking in teleports to **the Kernel**. The Gate stays open afterwards.

### 7.2 The arena
A floating platform of **memory blocks** (grid-patterned, 64 blocks across, ~3 layers thick) over a void, with 4 tall **Kernel crystal** pillars (light 12) and a starless black sky with drifting green log text in the distance (`[gc] marking reachable objects…`). Memory blocks can be mined and placed like normal blocks (the player gets them by mining). Falling into the void = death (inventory kept here, §2.4). The arena is a fixed template, **regenerated from scratch** each time you enter (so a lost fight doesn't leave a half-deleted arena).

### 7.3 The boss: the Garbage Collector
A huge box-built creature (~8 blocks tall): a hunched body made of grey "trash" blocks with a glowing green **core** in its chest, long arms, a head like a recycle bin lid. **300 HP**, armor ignores 50% of damage *except* hits on the exposed core (double damage). Boss bar at the top: *"The Garbage Collector"*.

| Phase | HP | Attacks |
|---|---|---|
| **1. Mark** | 100–70% | Walks toward you, swipes (6 dmg, big knockback toward the edge). Every 8 s **marks** 12–20 blocks around you (they glow red); 3 s later the marked blocks are **deleted** (removed). Standing on them = falling. After each delete it **stomps**, kneeling for 3 s with the core exposed. |
| **2. Sweep** | 70–35% | Summons 4 **Pointers** (small flying cubes, 6 HP, dive at you for 3 dmg; kill them with melee as they dive or with arrows). Charges across the arena (dodge sideways). Marks continue, larger. The crystals heal it 2 HP/s while ≥ 2 crystals stand: break crystals (cobalt pickaxe, 3 s each, or 3 arrows) to stop it. |
| **3. Compact** | 35–0% | The arena edge **shrinks**: the outer ring of memory blocks deletes every 10 s, down to a 16-block circle. It stomps more often (core exposed more), and its swipes are faster. Player-placed blocks are fair game for its marks. |

On Peaceful: no Pointers, slower marks. On Hard: +50% damage, marks every 6 s.

Design rules: every attack is **telegraphed** (marks glow before deleting, charges have a wind-up roar, stomps shake the camera first), so deaths feel fair. The fight should take 4–8 minutes for a prepared player (cobalt sword, iron+ armor, bow, food).

### 7.4 Winning
When it dies: it collapses into a pile of trash blocks that dissolve; the core floats up; touching it starts the ending:
1. Screen fades to a terminal-style log scrolling fast: `[gc] collection complete. 0 bytes freed. strata.exe restored.` then the **credits** (game, assets with licenses, three.js, "Made by Pragnya Yadav with Claude Code"), skippable after 5 s.
2. `System32.complete({ timeMs, deaths, difficulty })` sent **once** per world.
3. Return to the overworld at your spawn with a **trophy block** in your inventory (the Kernel Core, light 15). The world continues: post-game freedom, and the Kernel Gate can be re-entered to fight again (no second `complete`).
4. The title screen shows 🏆 and the best time from INIT.

---

## 8. Combat details
- Melee: damage by item (hand 1, wood sword 4, stone 5, iron 6, cobalt 8; other tools 1–2 less), **0.6 s attack cooldown** (damage scales with cooldown progress, shown as a small bar under the crosshair), knockback, **critical hit** ×1.5 when falling.
- Mobs show a brief health bar above them after being hit.
- Arrows are entities with gravity, stick in blocks for 30 s (pickable if shot by the player), and can hit the boss.
- Shield: out of scope.

---

## 9. Saving changes
- Save format version 2 with migration from Part 1 saves (old saves get Normal difficulty, full health/hunger, no Underlayer yet).
- New saved data: health, hunger, air, armor slots, difficulty, keep-inventory setting, bed spawn, chests (contents per position), **Underlayer edits** (separate section), discovered Rifts, vault state (raided / spawner destroyed), Kernel Gate opened, completion flag, stats (time played, deaths, blocks mined, mobs killed).
- **Persisted entities:** passive animals in a chunk are saved with that chunk (position + type + sheared); dropped items and the death pile are saved; hostiles are not saved; the boss fight is not saved (quitting mid-fight resets it).
- Budget check: a typical finished world must save under 1.5 MB; test it with the debug hooks (§13).

---

## 10. HUD and UI additions
- Hearts (left) and hunger (right) above the hotbar; air bubbles above hunger when underwater; armor points above hearts when > 0.
- Inventory screen gains 4 armor slots and a small 3D preview of the player model (box character built in code, our own design: a person in a "System32 technician" jumpsuit).
- Boss bar; compass strip; death screen; credits screen.
- Subtitles (setting, off by default) for important sounds: *"Shambler groans (left)"*, *"Rattler draws a bow"*.

---

## 11. Assets

No new downloads are needed. Mobs, the player model, the boss, hearts/hunger/armor icons and most new block textures are **generated in code**, which keeps the style consistent and avoids license questions.

Step 0 again, before any Part 2 code: extend `tools/strata/inventory-assets.mjs` and the manifest with these roles, mapped from the packs already in `assets/source/` (Kenney Voxel Pack, Impact Sounds, RPG Audio, UI Audio, Interface Sounds, Music Jingles), and **stop for approval**:

| Role | Likely source | Fallback |
|---|---|---|
| Lava, basalt/scorched stone, ash, glowcap, chest, bed, torch, wool colors, cobalt ore | Voxel Pack tiles | Generated pixel art |
| Melee hits, arrow shot/hit, bow draw, eating, hurt, player death, chest open/close, door-like vault opening | Impact Sounds, RPG Audio | Synth |
| Boss music + win jingle | Music Jingles for the win; boss music synthesized | Synth |
| Mob voices | — | Synth (always) |

Keep the Strata asset budget ≤ 4 MB after Part 2.

---

## 12. Easter eggs (add to the shell registry; `strata-` prefix)
| id | Trigger | Effect |
|---|---|---|
| `strata-complete` | Beat the Garbage Collector | Counted by the shell on GAME_COMPLETE. |
| `strata-popup-adblock` | Kill a Pop-up while an Ad Block item is in your hotbar | Subtitle: *"Ad Block worked as intended."* |
| `strata-sleep-underlayer` | Try to sleep in the Underlayer | The "Something is compiling" message. |
| `strata-recycle` | Throw (Q) the Kernel Core into the void | It flies back into your inventory: *"This file is protected by the will of the previous user."* (callback to the shell's Recycle Bin joke) |

---

## 13. Testing hooks and tests
Hooks (add to `__STRATA` under `?debug=1`): `setHealth`, `setHunger`, `spawn(mobType, x, y, z)`, `killAll()`, `setDifficulty`, `goto('overworld'|'underlayer'|'kernel')`, `giveKit('iron'|'cobalt')`, `bossPhase(n)`, `setTime`, and `?peaceful=1`.

Tests (headless; logic, not fps):
- **Survival:** fall damage table, drowning timing, lava, void, starvation stops at 1 HP on Normal and kills on Hard, regeneration rules, eating timing, armor reduction math, keep-inventory in the Kernel, death drops persist and despawn after 10 min.
- **Lighting:** torch light values decay by 1 per block; placing/removing a torch updates light and remeshes only nearby chunks; sky light under a roof; light recomputed after load matches before save.
- **Mobs:** spawn only at light ≤ 7 and in range; caps; despawn; sunrise lag-out for surface hostiles only; A* finds a path up a staircase and around a wall, gives up gracefully when none exists; spider climbs; Rattler keeps distance; Pop-up overlay appears and clears.
- **Progression:** cracked bedrock count near spawn (≥ 8 within 300 blocks for 10 seeds); cobalt pickaxe required; Rift travel both ways; 3 vaults generated reachable from the arrival point (flood fill through air); Tracer points correctly; Kernel Key recipe; Gate opens.
- **Boss:** each phase transitions at the right HP; marks delete exactly the marked blocks after 3 s; crystals heal and stop healing when broken; arena shrink schedule; arena regenerated on re-entry; death in the Kernel keeps inventory; `GAME_COMPLETE` sent once; second kill doesn't resend.
- **Bot run:** with `giveKit('cobalt')` and `goto('kernel')`, a scripted bot that dodges marks and hits the core wins on Normal within 10 minutes of game time for 3 seeds.
- **Saving:** v1 → v2 migration; full v2 round-trip including chests, Underlayer edits, animals, vault state; a "finished" test world (scripted: 3 vaults raided, 3,000 edits) saves under 1.5 MB.
- **Shell:** `GAME_COMPLETE` stores completion, toast, icon check, INIT `completed`, egg counted.
- **Manual (you):** a full playthrough from a fresh world to the credits on Normal. Note where you got stuck, and we tune.

---

## 14. Build order (phases; test and commit after each)
1. **Step 0 asset update** → approval → build assets.
2. **Shell:** `GAME_COMPLETE`, save cap.
3. **Lighting engine + torches** (everything else depends on darkness).
4. **Survival:** health, hunger, air, damage sources, eating, death/respawn, difficulty, new HUD.
5. **Entity framework + passive animals** (box models, procedural textures, wander/flee, drops, chests, beds, wool, leather, food, cooking).
6. **Hostiles + combat:** Shambler, Rattler, Creepcrawler, Pop-up; A*; spawning rules; melee cooldown; bow and arrows; armor.
7. **Cobalt + cracked bedrock + Rifts + the Underlayer** (terrain, lava, glowcaps, Daemon, Glitch).
8. **Data Vaults** (templates, spawners, Vault Warden, shards), Tracer, compass strip.
9. **Kernel Gate, arena, Garbage Collector** (phases one at a time, telegraphs first).
10. **Ending, credits, `complete()`, post-game**, eggs, save v2 + migration.
11. Full test suite + bot boss run, then your full playthrough and tuning.

---

## 15. Creative mode (added after Part 2)

A game mode chosen on the **New World** screen (*Survival* or *Creative*; `?creative=1` forces it for tests). The mode is stored with the world (`flags.mode`) and survives saving and loading. A Creative world never sends `System32.complete()`: it cannot count as a win.

- **Creative inventory (`E`):** a screen with a **search box**, tabs **All / Blocks / Tools & Weapons / Armor / Food / Materials** and a grid of **every item of the game**, **sorted** by category and then by name. Search is case-insensitive, matches the name or the id, and several words match in any order (`cobalt pickaxe` = `pickaxe cobalt`). Click an item for a full stack (a tool arrives with full durability), right-click for one, click with a stack on the cursor to delete it; a trash slot also deletes. The ordinary hotbar and 27 slots are shown below, and the search box keeps focus while you type (game keys do not fire).
- **Rules:** nothing is used up (placing, tools, arrows, food), blocks break at once (every 0.18 s while held) and drop nothing, mobs drop nothing, middle-click on a block gives you that item. No damage of any kind, no hunger, no death; hearts and hunger are hidden from the HUD; monsters do not spawn and any that exist leave you alone (Creative counts as Peaceful for the monsters). Falling out of the world puts you back at the spawn.
- **Flying:** double-tap `Space` to toggle, `Space` up, `C` down, `Shift` faster; landing on the ground ends the flight.
- **Tests:** `tests/strata/logic.mjs` (catalog: every item exactly once, sorted, tabs, search, click rules) and the `Creative:` test in `tests/strata/run.mjs` (New World choice, search by typing, tabs, clicking, no use-up, instant breaking, no damage or hunger, flying, saving the mode).

## 16. Flowing water (added after Part 2)
- Water has a strength: the source `water` (8) and the flowing blocks `water_1`..`water_7` (ids appended after `memory_marked`; not items, never placed by the player). `isWater(id)` and `waterLevel(id)` in `blocks.js`.
- `fluid.js` ticks every 0.25 s, at most 400 queued cells: air below -> falling water (7), no sideways spread; otherwise the air beside it gets strength - 1 (7 blocks on flat ground); flowing water with no feeder (water above, or a stronger neighbour that spreads) shrinks or drains; sources never dry up. A flowing cell does not spread sideways while it rests on other flowing water (waterfalls stay a column).
- Any `setBlock` queues the cell and its six neighbours (`World.onChange`), so digging beside the sea lets it run in, and placing a block into the stream stops it and drains what was behind it. After a load, the water cells among a chunk's edits are looked at again.
- Mesh: surface height 0.125 + 0.75 * strength / 8 (a source 7/8), full height with water above; a higher cell shows its side above a lower neighbour. Swimming, drowning, pathfinding and item drops treat all water ids alike.
- Not included: infinite sources, lava flow, currents that push the player.
