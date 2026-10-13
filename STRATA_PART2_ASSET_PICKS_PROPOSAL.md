# STRATA_PART2_ASSET_PICKS_PROPOSAL.md: Part 2 Step 0. Status: waiting for approval

Inputs: `STRATA_ASSET_MANIFEST.md` (now with a "Part 2 role candidates" section, written by `tools/strata/inventory-assets.mjs`), the mapping in `tools/strata/assets.json` under the new `part2` key, two contact sheets and an audition page. **Nothing has been built and no Part 2 game code exists.** Part 1 was committed first (three commits, not pushed).
- Contact sheets: `assets/source/_preview/strata/part2-tiles.png`, `part2-items.png`
- **Audition page (please listen):** `python3 serve.py`, then `http://localhost:8000/assets/source/_preview/strata/audition-part2.html`. I chose the sounds by file name only; I cannot hear them.
- All 56 source paths named in the proposal were checked and exist.

## Picks from the Voxel Pack (tiles, 6 of 25; the rest are generated)
| Role | Pick | Note |
|---|---|---|
| lava | `lava` | static, orange, light 15 |
| cobalt ore | `stone_diamond` | blue crystals on stone; the same set's tools become the cobalt tier |
| ash | `greysand` darkened | sand-like |
| glowcap (cross-plant) | `mushroom_tan` tinted cyan + glow dots | |
| wild wheat (cross-plant) | `wheat_stage4` | |
| wool / bed blanket | `cotton_tan` / `cotton_red` | |
| berry bush | `leaves_transparent` + red dots | |

## Picks from the Voxel Pack (items, 11 of 39)
Cobalt pickaxe/axe/shovel/sword = `pick/axe/shovel/sword_diamond` (blue-teal, so no tinting), raw cobalt = `ore_diamond`, apple, bowl, glowcap stew (`stew`), wheat, bow, arrow. The pack has **no** armor, meat, string, bone, feather, shears, key or ingot art.

## Generated in code (pixel art in `build-assets.mjs`, same approach as Part 1's stick and iron ingot)
- **Tiles:** basalt, scorched stone, chest (top/side/front), bed side, torch, cracked bedrock (glowing cracks), Rift (4 animated frames, plus a white Kernel Gate variant), server rack (2 LED frames, side), vault door, mob spawner, memory block, Kernel crystal, Kernel Core.
- **Items:** cobalt ingot and nugget, bread, berries, shears, 4 raw + 4 cooked meats, leather, feather, string, bone, flint, rotten flesh, 12 armor pieces (leather/iron/cobalt x 4), Kernel Shard, Kernel Key, Tracer, ash dust, glitch dust.
- **Drawn at startup, not assets:** hearts, hunger, air and armor icons, the player model, all mobs and the boss (box models with procedural 16x16 face textures).

## Sounds (17 roles, 33 files, ~330 KB raw before mono/trim)
| Role | Pick |
|---|---|
| melee hit / heavy hit | Impact `impactPunch_medium` / `impactPunch_heavy` |
| player hurt / player death | `impactPunch_heavy` 3-4 / `impactBell_heavy_002` |
| sword swing | RPG `knifeSlice`, `knifeSlice2` |
| bow draw / bow shoot | RPG `drawKnife1-2` / `drawKnife3`, `knifeSlice2` |
| arrow hit | `impactWood_light` |
| eating | RPG `handleSmallLeather` x2, `beltHandle1` (a guess; least certain) |
| chest open / close | RPG `creak1-2` / `metalLatch`, `metalClick` |
| bed | RPG `cloth1-3` |
| vault door | RPG `doorOpen_2` + `impactMetal_heavy_000` |
| armor equip | RPG `clothBelt`, `clothBelt2` |
| boss stomp / crystal break | `impactPlate_heavy` / `impactGlass_heavy` |
| **win jingle** | Music Jingles `Steel jingles/jingles_STEEL07` (1.55 s); alternatives on request |
| mob voices, Pop-up beeps, Rift hum, lava, fire, boss music | **synthesized** (no files), as the spec says |

## Budget
Strata assets are 536 KB today. Part 2 adds roughly 35 tiles (atlas 256 px -> 512 px), ~70 item icons and ~33 sounds: estimated **1.3 MB total**, far under the 4 MB cap (`budget` is raised to 4 MB in the `part2` block).

---

# Implementation plan (for approval together with the picks)

The spec's 11 phases stand, with one commit per phase (not pushed), each phase tested before the next. Where the spec leaves a choice, this is what I will do:

1. **Shell (phase 2).** `GAME_COMPLETE` is bonus-only, keeps the best time per difficulty, toast, green check on the icon in all three places, egg `strata-complete`, INIT `completed`. Save cap 1.5 MB -> 2.5 MB (a per-game `saveCap` in the registry).
2. **Lighting (phase 3).** Deviation from "incremental BFS add/remove queues": light for a chunk is a **pure function of the blocks in its 3x3 neighbourhood**, computed in the worker (sky + block channels, flood fill). Torch light (14) and sky spill (15) never travel more than 16 blocks, so this is exact. An edit recomputes and remeshes the chunk plus its 8 neighbours at most (the same set the spec requires), the result is deterministic (so "light recomputed after load matches before save" holds by construction), and it is much easier to test. The mesher gets two vertex channels (sky, block) and the shader combines them with the `daylight` uniform, so day and night never remesh.
3. **New block shapes.** The mesher gains cross-plants (glowcap, berry bush, wild wheat) and small boxes (torch, bed slab, chest), all with their own collision and selection boxes.
4. **Entities (phase 5-6).** One `Entity` system (drops, arrows, mobs, boss) on the fixed step with the existing swept-AABB collision; mobs are box models plus a procedural mob atlas; A* as specified (32 blocks, 600 nodes, 0.5 s re-plan).
5. **Dimensions (phase 7-9).** The world and mesher are parameterized by dimension (overworld 1024x1024x128, Underlayer 512x512x96, Kernel arena = a small fixed template world regenerated on entry). Edits are saved per dimension.
6. **Cracked Bedrock guarantee.** Eight sites are placed deterministically within 300 blocks of spawn (seeded ring of candidates, each carved into a small cave pocket so it is reachable), plus random extras deeper in. Tested for 10 seeds.
7. **Spec details I read this way:** Tracer = 8 iron ingots around 1 cobalt ingot; Kernel Key = 3 Kernel Shards in a row; Bed skip needs night and no hostile within 8 blocks; "bronze/iron/silver" tool names are unchanged from Part 1 (wood/stone/iron tiers), cobalt is the new tier.
8. **Save v2** with a v1 migration (Normal difficulty, full health), light never saved, and a "finished world" size test against the 1.5 MB target.
9. **Tests** follow section 13 of the spec: Node logic tests (survival math, A*, boss phases, saves), browser tests (lighting, Rift travel, vault reachability), the shell test, and the scripted boss bot.
10. **Cannot be verified headless** (as in Part 1): frame rate with up to ~50 entities, fight feel, difficulty tuning, sound quality, the real playthrough. All numbers live in `config.js` so you can tune after your 3-5 hour playthrough.

## What I need from you
1. Are the **asset picks** okay (cobalt = the blue diamond-style tools and ore; generated pixel art for everything else; the win jingle STEEL07)?
2. Is the **per-chunk lighting** deviation (item 2 above) okay?
3. Commit **after each phase** (not pushed), as the spec says?
