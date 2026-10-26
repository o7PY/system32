# FINAL_SPEC.md — System32: Finalization

> The last spec. It changes the existing build; it doesn't add new games.
> Applies on top of: DESKTOP_SPEC, DOMINATION_SPEC, INSPECT_SPEC, WM404_SPEC, SPACESAGA_SPEC, STRATA_SPEC, STRATA_PART2_SPEC.
> **Strata section (§8)** assumes Strata Part 2 is built. If it isn't yet, do §1–§7 now and §8 right after Part 2.
> **Target:** 3–4 days with Claude Code.

---

## 0. What changes

| # | Change | Section |
|---|---|---|
| 1 | **Remove CSS Specificity Wars** (`styles_FINAL_v2.html`, `theme.dll`). Three core games remain. | §1 |
| 2 | Split saved data into **game state**, **meta** (achievements + secrets) and **world saves**, so resets can be precise. | §2 |
| 3 | **Reset progress** resets only the game state. New **Hard reset** wipes everything. | §2.3 |
| 4 | **Achievements & Secrets** button at the far left of the taskbar, with a panel. | §3 |
| 5 | **Start Tutorial** app: walks the player through restoring the desktop and finding the games. No puzzle help. | §4 |
| 6 | **Skip puzzle** button after 2 losses in `free_prizes.html` and `recovery_tool.html`. It's an achievement. | §5 |
| 7 | **Sudoku escape hatch** in `bank_login.html` after 10 minutes stuck. Solving it opens the bank. | §6 |
| 8 | **Strata tutorial mode** and a complete **objectives journal** from first log to the Garbage Collector. | §8 |

Rule for everything in this spec: **the System32 tutorial never helps with puzzles.** It says what to do and where, never how to beat a game. The only ways past a hard puzzle are the skip button (§5) and the sudoku (§6). In-game help that already exists (e.g. Inspect Element's "How do I hack?" card) stays as it is.

---

## 1. Remove CSS Specificity Wars

### 1.1 Delete
- `games/specificity-wars/` (whole folder), its tests, and `SPECIFICITY_SPEC.md` (move it to `docs/archive/` instead of deleting, so the history makes sense).
- From `js/registry.js`: the `specificity` game, its route `sys32://styles-final-v2`, its desktop icon, its Edgy favorite, its component `theme.dll`, and its four eggs (`spec-nuke`, `spec-devtools`, `spec-has`, `spec-overkill`).
- From Explorer: `theme.dll` in `C:\Windows\System32`.
- From the README: the CSS Specificity Wars section; update the intro and game list.
- `"I'm Feeling Corrupted"` in Goggle must only pick from the remaining games.

### 1.2 Reassign what `theme.dll` used to do
| Effect | Before | After |
|---|---|---|
| Wallpaper RGB-split, tear lines, taskbar glitch filters | Removed when `theme.dll` was repaired | Scale with corruption like everything else; **fully removed at 100%** (after the ending restart) |
| Personalize (accent colors) | Unlocked by `theme.dll` | Unlocked by `admin_access.dll`, together with the rest of Settings |

### 1.3 Integrity and ending with three components
- Integrity steps become **0% → 33% → 67% → 100%**. Never hardcode 4 anywhere: count components from the registry.
- The ending triggers when all **three** components are repaired.
- README.txt default lore: drop the `theme.dll` line. If the player edited their README, leave their text alone.

### 1.4 Old saves
- Drop `specificity` from `repaired`, bests and scores. Drop removed egg ids from found secrets.
- If the remaining three are all repaired but the ending was never seen (possible for saves that were only missing Specificity Wars), show the "System integrity: 100%. Restart to complete repair?" dialog right after sign-in.
- If the ending was already seen, nothing changes.

---

## 2. Saved data and resets

### 2.1 Three stores (all in `localStorage`)
| Key | Contents | Reset progress | Hard reset |
|---|---|---|---|
| `system32.state` | Repairs, corruption, ending seen, losses and skips (§5), playtime (§6), tutorial progress (§4), unlocked bookmarks, icon positions, README text, best times and scores of the **core** games | **Wiped** | Wiped |
| `system32.meta` *(new)* | Achievements (id → unlocked-at), secrets found, bonus-game unlocks, bonus bests (SpaceSaga), bonus completions (Strata), settings (sound, accent) | Kept | **Wiped** |
| `system32.save.<gameId>` | World saves (Strata) | Kept | **Wiped** |

Bonus games stay unlocked after Reset progress: the player earned them. Restored desktop icons for bonus games stay too.

### 2.2 Migration
On load, if `system32.meta` doesn't exist: create it by moving `eggsFound`, `bonus.unlocked/restored/best/completed` and settings out of `system32.state`. Grant achievements that the old state already proves (e.g. components repaired, ending seen, SpaceSaga best ≥ 1,000 m), silently: no toast storm, one toast *"🏆 4 achievements unlocked from your previous progress."*

### 2.3 Reset UI
Both buttons live at the bottom of the **Achievements panel** (§3), so they're always reachable. (They used to be inside Settings, which Reset progress itself locks again.) Settings keeps a link to them.

- **Reset progress:** dialog *"Reset System32 to its corrupted state? Achievements, secrets, bonus games and your Strata world are kept."* [Reset] [Cancel] → wipe `system32.state` → reboot sequence (boot screen, skip lock) → desktop at 0% integrity.
- **Hard reset:** dialog listing exactly what will be deleted (achievements n, secrets n, Strata world size, SpaceSaga best), plus a text field: type **`DELETE`** to enable the red button. Wipes every `system32.*` key → full first-visit boot.
- Per-game "Delete save" rows in Settings stay as they are.

---

## 3. Achievements & Secrets

### 3.1 Taskbar button
- A new button at the **far left** of the taskbar (where Windows 11 keeps its widgets button), with a trophy icon and a small badge showing achievements unlocked, e.g. `7`.
- Click → a panel slides up from the bottom-left (frosted, rounded, same style as the Start menu), 420 × 600 max. Closes on Esc, outside click, or the button.

### 3.2 Panel
Two tabs: **Achievements** and **Secrets**. Header shows totals: *"Achievements 7/22 · Secrets 12/36"*.

- **Achievements tab:** a list, unlocked ones first (icon, name, description, date unlocked), then locked ones greyed out with their name and description visible (achievements are goals; showing them is the point). **Hidden achievements** (marked in the registry) show as `???` until unlocked.
- **Secrets tab:** found secrets with a short name and a one-line description of what was found. Unfound secrets are **never described**: only a count, *"24 secrets still hidden."* No hints.
- Footer: Reset progress · Hard reset (§2.3).

### 3.3 Unlocking
- Toast: *"🏆 Achievement unlocked: Skill Issue"* with the achievement sound; clicking it opens the panel on that achievement.
- Games unlock achievements with a new SDK call, validated like eggs:
  ```js
  System32.achieve('saga-1km')   // → { type: 'ACHIEVEMENT', id }
  ```
  A game may only unlock achievements with its own prefix (`dom-`, `inspect-`, `wm-`, `saga-`, `strata-`). Shell-side achievements are unlocked by the shell itself. Unknown ids are ignored.
- Achievements are stored in `system32.meta` and survive Reset progress.

### 3.4 The list
All names and descriptions are ours. Ids go in `js/registry.js` as data.

| Id | Name | How | Hidden |
|---|---|---|---|
| `boot` | Hello, World | Sign in for the first time | |
| `tutorial` | RTFM | Finish the Start Tutorial | |
| `fix-popup` | Pop-up Blocker | Repair `popup_guard.sys` | |
| `fix-admin` | sudo make me a sandwich | Repair `admin_access.dll` | |
| `fix-wm` | Window Manager | Repair `wm_core.exe` | |
| `restored` | System Restored | Reach 100% integrity and restart | |
| `skip-1` | Skill Issue | Skip a puzzle | |
| `skip-2` | Ctrl+Alt+Skip | Skip both skippable puzzles | |
| `sudoku` | sudo ku | Open the bank with the sudoku | |
| `dom-clean` | Clean Desktop | Win DOM-ination with clutter never above 12 | |
| `inspect-3star` | View Source | Win Inspect Element with 3 stars | |
| `wm-flawless` | Zero Data Loss | Win 404: Window Manager without losing a fragment | |
| `no-skip` | No Shortcuts | Restore the system without skipping or using the sudoku | |
| `bin-diver` | Dumpster Diver | Open a program from the Recycle Bin | |
| `saga-1km` | Escape Velocity | Run 1,000 m in SpaceSaga | |
| `saga-5km` | Light Speed | Run 5,000 m in SpaceSaga | |
| `strata-timber` | Timber! | Get your first log in Strata | |
| `strata-iron` | Iron Age | Craft an iron pickaxe | |
| `strata-underlayer` | Below Bedrock | Enter the Underlayer | |
| `strata-key` | Root Access | Craft the Kernel Key | |
| `strata-gc` | Garbage Day | Defeat the Garbage Collector | |
| `secrets-all` | Completionist | Find every secret | ✓ |

`skip-1`, `skip-2` and `sudoku` don't block `no-skip`'s opposite: a player can earn `no-skip` on one run and `Skill Issue` after a Reset progress. That's fine.

---

## 4. The Start Tutorial app

### 4.1 What it is
A small app called **Recovery Guide**, opened by a desktop icon labelled **`Start Tutorial`** and a Start-menu entry. Window 460 × 560, a checklist of steps; the current step is expanded with 2–3 sentences, done steps are ticked, future steps are listed but collapsed.

It explains **what** to do and **where**. It never explains **how** to beat a game, never mentions the skip button, the sudoku, easter eggs or secrets.

### 4.2 First visit
Instead of auto-opening README.txt, the first visit shows a dialog after sign-in: *"System32 is damaged. Start the tutorial?"* [Start tutorial] [I'll figure it out]. The second button opens README.txt like before. The `Start Tutorial` icon stays on the desktop either way.

### 4.3 Steps
Each step ticks itself from real state; no "Next" button needed (but a "Skip step" link exists for players who already did it differently).

| # | Step | Text (shown when current) | Ticks when |
|---|---|---|---|
| 1 | Read the notes | *"The previous user left notes. Open `README.txt` on the desktop."* | README opened |
| 2 | Check the damage | *"Open `This PC`. The bar on Local Disk (C:) is your system integrity."* | Explorer shows This PC |
| 3 | Find the recovery files | *"Three files on the desktop repair the system: `free_prizes.html`, `bank_login.html` and `recovery_tool.html`. They look like junk. Each one repairs one broken component in `C:\Windows\System32`."* | All three have been opened once |
| 4 | Repair `popup_guard.sys` | *"Open `free_prizes.html` and win."* | Repaired |
| 5 | Repair `admin_access.dll` | *"Open `bank_login.html` and get in."* | Repaired |
| 6 | Repair `wm_core.exe` | *"Open `recovery_tool.html` and recover the file."* | Repaired |
| 7 | Restart | *"Integrity is at 100%. Restart when the system asks."* | Ending seen |
| 8 | Check the Recycle Bin | *"Some files could not be deleted. Open the Recycle Bin."* | Bin opened after the ending |
| 9 | Restore the games | *"Double-click a program to play it, or right-click → Restore to put it on your desktop."* | A bonus game opened or restored |
| ✓ | Done | *"That's everything. You're on your own now."* | All above |

Steps 4–6 can be done in any order; the guide shows all three as current until each is done.

### 4.4 "Show me"
Each step that points at something (an icon, the bin, This PC) has a **Show me** button: the target pulses with an accent ring for 3 s. Pointing at a file is not puzzle help.

### 4.5 State
Tutorial progress lives in `system32.state` (Reset progress restarts it). Finishing it unlocks `tutorial`. A "Restart tutorial" link at the bottom.

---

## 5. Skip puzzle (DOM-ination and 404: Window Manager)

### 5.1 Rules
- The **shell** counts losses per game: each `GAME_LOST` from `dom-ination` or `wm404` increments `losses[gameId]` in `system32.state`. The game never decides this itself.
- INIT gains `losses` and `canSkip` (`losses >= 2` and not yet repaired).
- From the 2nd loss on, the game's **lose screen** shows a third button next to Retry: **Skip puzzle**. The **start screen** shows it too (smaller, bottom corner), so the player doesn't have to lose again to use it.
- Click → confirmation inside the game: *"Skip this puzzle? The component gets repaired, but you won't get a score."* [Skip] [Keep trying].
- The game sends:
  ```js
  System32.skip()   // → { type: 'GAME_SKIPPED' }
  ```
  The shell re-checks `losses >= 2` (ignore otherwise), repairs the component exactly like a win, records `skipped[gameId] = true`, stores no best, unlocks `skip-1` (and `skip-2` when both are skipped), and shows the usual repair toast with *"(skipped)"*.
- The repaired icon shows the check mark with a small ↷ to mark it as skipped. Winning it properly later (games stay replayable) clears the ↷ and stores a best.
- Inspect Element has no lose condition, so it uses §6 instead.

### 5.2 Game changes
Both games: read `canSkip`/`losses` from INIT; after their own `lost()` call, treat `losses + 1` as current (the shell confirms on next INIT). Add the button and confirmation; add `?debug=1` hook `forceLosses(n)` for tests.

---

## 6. Sudoku escape hatch (Inspect Element)

### 6.1 When it appears
- The shell tracks **time spent** in the bank game: the game sends a heartbeat every 15 s of unpaused play.
  ```js
  System32.playtime(15000)   // → { type: 'PLAYTIME', ms }   (shell clamps ms to ≤ 20000 per message)
  ```
  The shell adds it to `playtime.inspect` in `system32.state` and sends the total in INIT. This way closing and reopening the game doesn't reset the clock.
- Once total playtime ≥ **10 minutes** and the bank isn't open yet, a small button appears under the login card: **"Locked out? Crack the vault instead."**

### 6.2 The sudoku
- Clicking it opens a vault-door panel over the page with a **randomized 9×9 sudoku**.
- **Generation** (in `game.js`, no libraries): fill a full valid grid by randomized backtracking, then remove cells in random order, keeping each removal only if the puzzle still has **exactly one solution** (solver counts solutions, stops at 2). Stop at **30–34 givens** (medium). Generate in under 200 ms; a new puzzle each time the panel opens fresh (the current puzzle persists while the page is open).
- **UI:** click a cell, type 1–9, Backspace/Delete clears, arrow keys move. Givens are bold and locked. Conflicts (same number in row, column or box) turn red. A "New puzzle" button and a "Close" button. No auto-solve, no hints.
- **Solved** (all cells filled, no conflicts, matches the solution): the vault door animates open → the dashboard appears exactly like a normal win → **Install** → `GAME_WON` with **0 stars**. Unlocks `sudoku`. The script-kiddie wrapper must treat this as a legitimate path.
- Make the sudoku keyboard-friendly and readable at 760 px wide.

### 6.3 Tests
Generated puzzles always have a unique solution (100 seeds); givens count in range; conflict detection; solving via real key presses wins; the button appears only after 10 min of accumulated playtime across reloads (use `?speed`/a debug hook to fake time).

---

## 7. Shell protocol summary (new in this spec)

| Message | From | Purpose |
|---|---|---|
| `ACHIEVEMENT { id }` | any game | Unlock a prefixed achievement (§3.3) |
| `GAME_SKIPPED` | `dom-ination`, `wm404` | Skip after 2 losses (§5) |
| `PLAYTIME { ms }` | `inspect` (reusable) | Accumulate play time (§6) |
| INIT `losses`, `canSkip`, `playtimeMs` | shell | Inputs for §5 and §6 |

Add all of them to `games/_shared/sdk.js` and the README protocol section.

---

## 8. Strata: tutorial mode and objectives journal

### 8.1 Two features
- **Objectives journal** (always available, key **J**): the complete checklist below, grouped by act, auto-ticking from real game events and inventory checks. Each objective has a one-line *how* (where to find it, the recipe, what to use).
- **Tutorial mode** (option at New World, default **on** for the first world, toggle in the pause menu):
  - a **tracker** on the right edge showing the current objective and the next two,
  - **contextual tips** the first time something happens (first night falling, first damage, first hunger drop, first cave, first Rift, first vault, entering the Kernel),
  - the controls card on first spawn.

The journal shows **everything**, including future acts, with nothing hidden. Unlike the System32 puzzles, Strata is meant to be fully explained.

### 8.2 The checklist
Tick conditions are either **events** (crafted, mined, killed, entered) or **inventory checks** (have N of X), evaluated on change. Ticked objectives stay ticked. Optional objectives are marked *(optional)* and don't block "next objective" logic.

**Act 1 — First day**
1. Punch a tree and collect **4 logs**. *Hold left mouse on a tree trunk.*
2. Craft **planks**. *E → put a log in the 2×2 grid.*
3. Craft a **crafting table** and place it. *2×2 planks; right-click the ground to place.*
4. Craft **sticks**. *2 planks stacked vertically.*
5. Craft a **wooden pickaxe**. *3 planks across the top, 2 sticks down the middle.*
6. Mine **16 cobblestone**. *Mine stone with the pickaxe.*
7. Craft **stone pickaxe, axe, shovel and sword**.
8. Get **food**: 5 berries, an apple, or meat from an animal. *Bushes in forests; pigs, cows, sheep, chickens.*
9. Craft a **furnace** and **cook meat**. *8 cobblestone in a ring; meat + fuel.*
10. Find and mine **coal**. *Dark-speckled stone, common on hillsides and in caves.*
11. Craft **torches** (at least 16). *1 coal on top of 1 stick → 4 torches.*
12. Collect **3 wool**. *Sheep drop wool, or use shears.*
13. Craft a **bed** and place it. *3 wool over 3 planks. Right-click it to set your spawn.*
14. Build a **shelter** before night (any enclosed space with a light). *Mobs spawn in darkness.*
15. **Survive the first night**, or sleep through it.
16. Craft a **chest** and store spare items. *8 planks in a ring.*

**Act 2 — Iron age**
17. Find **iron ore** (y 5–60). *Orange-flecked stone; caves are the fastest way.*
18. Mine **24 iron ore** with a stone pickaxe or better.
19. **Smelt** iron into ingots.
20. Craft an **iron pickaxe**.
21. Craft an **iron sword**.
22. Craft **iron armor**: helmet, chestplate, leggings, boots *(24 ingots for the full set)*.
23. Collect **3 string** from Creepcrawlers. *They're neutral in daylight; hit one at dusk.*
24. Craft a **bow**. *3 sticks + 3 string.*
25. Collect **flint** (dig gravel) and **feathers** (chickens).
26. Craft **32 arrows**.
27. Craft **shears** *(optional)*. *2 iron ingots diagonally.*
28. Craft **leather armor** *(optional)*.

**Act 3 — Deep dig**
29. Dig below **y = 16**. *Press F3 to see your height. Bring torches and food.*
30. Find **cobalt ore** (y 2–16). *Blue-flecked stone, rare.*
31. Mine **cobalt** with an iron pickaxe and smelt **at least 30 raw cobalt** *(3 pick + 2 sword + 24 armor + 1 Tracer)*.
32. Craft a **cobalt pickaxe**.
33. Craft a **cobalt sword**.
34. Craft the **Tracer**. *8 iron ingots around 1 cobalt ingot. It points to your next objective.*
35. Craft **cobalt armor** (full set). *(Iron armor works too; cobalt makes the boss much easier.)*

**Act 4 — Through the floor**
36. Use the Tracer to find **Cracked Bedrock** (y 1–4, glows faintly).
37. Break it with the **cobalt pickaxe** (8 s). It becomes a **Rift**.
38. Stock up before entering: **16+ cooked food, 64+ building blocks, torches, bow and arrows.**
39. **Enter the Underlayer.** *Stand in the Rift for a second.*
40. Note the **return Rift** on your arrival platform. *It takes you home.*

**Act 5 — The Vaults**
41. Collect **glowcaps** *(optional)*. *Glowing mushrooms; food and light.*
42. Use the Tracer to find **Data Vault 1** (tall glowing tower, 120–200 blocks from the center).
43. **Destroy the spawner** in the vault entrance. *Pickaxe, 5 s. It spawns Daemons until broken.*
44. Defeat the **Vault Warden**. *It blocks hits from the front every 10 s: get behind it.*
45. Take **Kernel Shard 1** from the vault chest.
46. Vault 2: spawner, Warden, **Kernel Shard 2**.
47. Vault 3: spawner, Warden, **Kernel Shard 3**.
48. Craft the **Kernel Key**. *3 shards in a row on a crafting table.*

**Act 6 — The Kernel**
49. Follow the Tracer to the **Kernel Gate** (Underlayer center).
50. **Open the Gate** with the Kernel Key (right-click the frame).
51. Final check: **cobalt sword, cobalt pickaxe, armor, bow + 32 arrows, 16 food, 64 blocks.** *(Your inventory is kept if you die in the Kernel.)*
52. **Enter the Kernel.**
53. Break the **4 Kernel crystals**. *They heal the boss while 2 or more stand. Pickaxe or arrows.*
54. Survive **Phase 1 — Mark**. *Red blocks disappear 3 s later: step off them. Hit the glowing core when it kneels.*
55. Survive **Phase 2 — Sweep**. *Shoot or swat the Pointers; sidestep the charge.*
56. Survive **Phase 3 — Compact**. *The arena edge shrinks: stay near the middle, keep hitting the core.*
57. **Defeat the Garbage Collector.**
58. Touch the **Kernel Core**. *Roll credits.*

The journal header shows *"Objectives 23/58"* and the current act. Objective count and text live in `config.js` as data, so new content can add rows.

### 8.3 Tracker and tips
- Tracker: the first unticked non-optional objective plus the next two, with the *how* line under the first. It can be hidden in settings, and it's always off when tutorial mode is off.
- Tips: a small panel at the top center for 6 s, once per world each, e.g. *"It's getting dark. Hostile mobs spawn in darkness. Get inside and light it up."* Never pauses the game.
- Completing an act shows a short banner: *"Act 2 complete: Iron age."*

### 8.4 Achievements wired to the shell
Send `System32.achieve(...)` for `strata-timber` (obj. 1), `strata-iron` (20), `strata-underlayer` (39), `strata-key` (48), `strata-gc` (57).

### 8.5 Saving
Ticked objectives, tutorial-mode flag and tips shown are saved with the world (a bitset, a few bytes). Old Strata saves: compute ticks from inventory and known world flags on first load (e.g. holding an iron pickaxe ticks 1–7 and 20), never un-tick.

---

## 9. Acceptance criteria

**Removal**
- [ ] No trace of Specificity Wars in the shell, registry, Explorer, Edgy, Goggle, README or tests (spec archived).
- [ ] Integrity shows 0/33/67/100%; the ending triggers with 3 repairs; glitch effects clear at 100%; Personalize unlocks with admin_access.dll.
- [ ] Old saves migrate (including the "3 repaired, no ending" case).

**Saved data and resets**
- [ ] `system32.meta` created and migrated; one summary toast for retroactive achievements.
- [ ] Reset progress wipes only `system32.state`; achievements, secrets, bonus unlocks, bonus bests and the Strata world survive.
- [ ] Hard reset needs `DELETE` typed and wipes every `system32.*` key.
- [ ] Both buttons are reachable even at 0% integrity.

**Achievements & Secrets**
- [ ] Taskbar far-left button with badge; panel with two tabs and the footer resets.
- [ ] All 22 achievements unlock correctly; hidden ones show `???`; unfound secrets are never described.
- [ ] `ACHIEVEMENT` only accepts the sender's prefix.

**Tutorial**
- [ ] First-visit dialog; `Start Tutorial` icon and Start-menu entry; steps tick from real state in any repair order; "Show me" highlights; no puzzle help anywhere; `tutorial` achievement.

**Skip and sudoku**
- [ ] Skip appears only after the shell counts 2 losses; shell rejects early skips; repair works; ↷ marker; achievements; a later real win clears the marker.
- [ ] Sudoku button only after 10 min accumulated playtime (across reloads); unique-solution puzzles; solving opens the bank; 0 stars; `sudoku` achievement; not flagged as script kiddie.

**Strata**
- [ ] Journal (J) lists all 58 objectives with *how* lines, ticks correctly, works with tutorial mode off.
- [ ] Tutorial mode tracker and one-time tips; act banners; achievements reach the shell; old saves get retroactive ticks.

**General**
- [ ] All remaining suites pass; removed tests deleted; no console errors; README updated.

---

## 10. Build order for Claude Code

1. **Remove Specificity Wars** + 3-component integrity + migration. Run every suite.
2. **Stores split** (`state` / `meta` / saves) + migration + Reset progress + Hard reset.
3. **Achievements & Secrets** button, panel, registry, `ACHIEVEMENT` message, shell-side unlocks, retroactive grant.
4. **Recovery Guide** app + first-visit dialog + "Show me".
5. **Skip puzzle** in DOM-ination and 404: Window Manager (+ shell loss counting, `GAME_SKIPPED`).
6. **Sudoku** in Inspect Element (+ `PLAYTIME`).
7. **Strata journal and tutorial mode** (after Strata Part 2).
8. Full test pass, README, then one complete playthrough by you: fresh Hard reset → tutorial → all three repairs (lose twice somewhere and try the skip; wait out the sudoku once) → ending → bin → both bonus games → check achievements.
