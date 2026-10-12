# WM404_SPEC.md — System32 Part 5: 404: Window Manager

> **File on desktop:** `recovery_tool.html` · **gameId:** `wm404` · **Repairs:** `wm_core.exe`
> **Route:** `sys32://recovery-tool` · **Folder:** `games/window-manager-404/`
> **Target:** 1 day with Claude Code

The window manager is dying. Inside the game is a tiny broken desktop: windows that stop responding and **collapse into "404"**, taking their files with them. Scattered across them are the four fragments of `wm_core.exe`. Drag each fragment into the **Recovery** window before the window it's in collapses. Recover all four, assemble the file, install it.

It's a window manager inside a window manager inside a browser. Lean into that.

**One mechanic:** drag a file from one window and drop it into another. Every complication is about *where* the file is, *where* Recovery is, or *what else* is in the way.

---

## 1. Fit with the shell (read first)

Same rules as every game: classic scripts, no storage/cookies/modals, SDK only. Can't import shell modules (opaque origin), so the mini window manager is its own small implementation.

```html
<script src="../_shared/sdk.js" data-game="wm404"></script>
<link rel="stylesheet" href="style.css">
<script src="game.js"></script>
```

| When | SDK call |
|---|---|
| Page loaded | `System32.ready()` |
| Init | `System32.onInit(({ beaten, best, bestTimeMs, soundOn }) => …)` |
| Fragment recovered | `System32.progress('fragments', '2/4')` |
| Win (player clicks "Install") | `System32.won({ timeMs, score: stars })` |
| Integrity hits 0 | `System32.lost('core fragments lost')` |
| Minimized | `onPause` / `onResume` freeze everything exactly (game-time clock, as in Parts 2 and 4) |

**Last-game note:** the player can beat the four games in any order, so this may or may not be the final repair. The game itself doesn't care; the shell already triggers the ending when the 4th component is repaired, whichever it is. Check that path again after this game ships (§11).

---

## 2. Files

```
games/window-manager-404/
├── index.html    # mini desktop: play area, mini taskbar, start/end screens
├── style.css     # an older-OS look (flat grey, square corners) to contrast the shell's Windows 11 style
└── game.js       # mini WM, drag-and-drop, collapse timers, phases (≤ 650 lines)
```

---

## 3. The mini desktop

```
┌───────────────────────────────────────────────────────────────┐
│ ┌ Downloads ────────[_][x]┐      ┌ Recovery ─────────────┐    │
│ │ 📄 cat.jpg  🧩 core_02   │      │ [🧩][  ][  ][  ]       │    │
│ │ Not responding  ████░ 6s│      │ wm_core.exe: 1/4       │    │
│ └─────────────────────────┘      └───────────────────────┘    │
│        ┌ temp ──────────[_][x]┐                               │
│        │ 📁 New folder        │          ┌ Recycle Bin ┐       │
│        │ 📄 homework.docx     │          │ 🗑 drop junk │       │
│        └──────────────────────┘          └─────────────┘       │
├───────────────────────────────────────────────────────────────┤
│ [Recovery] [Downloads] [temp]              ♥♥♥   ⏱ 0:41       │  ← mini taskbar
└───────────────────────────────────────────────────────────────┘
```

- **Source windows** (Downloads, temp, Documents, `C:\Windows\???`, etc.) hold files. Each has a **collapse timer** shown in its title bar once it starts failing: *"Not responding"* + a draining bar + seconds left.
- **Recovery window:** 4 slots. Each core fragment fills one. It never collapses.
- **Recycle Bin window:** a drop target for junk. Never collapses.
- **Mini taskbar:** one button per open window (click to restore a minimized window / bring to front), integrity ♥♥♥, and elapsed time.
- Mini windows: title-bar drag, focus/z-order on click, minimize. No resize, no maximize (keep scope small).

### 3.1 Files

| File | Icon | Behaviour |
|---|---|---|
| `core_01.frag` … `core_04.frag` | 🧩 glowing | The goal. Drop into Recovery to fill a slot. |
| Junk (`cat.jpg`, `homework_FINAL.docx`, `untitled(3).txt`, `definitely_not_a_virus.exe`, …) | plain | Dropping junk into Recovery **takes a slot** (with a sad sound). Drag it out to the Recycle Bin to free it. |
| `📁 New folder` | folder | Double-click opens a new child window with its contents (may contain a fragment). The child window collapses when its parent does. |

---

## 4. Rules

- **Collapse:** when a source window's timer ends, it shrinks into its center over 600 ms and leaves a "404" ghost for 1 s. Every file still in it is gone.
- **Fragment lost in a collapse:** −1 integrity ♥ (3 total). The fragment is "restored from backup": it reappears 2 s later in a **new** window spawned somewhere else, with a fresh (shorter) timer. So losing a fragment costs a heart and time but never soft-locks the run.
- **Junk lost in a collapse:** nothing happens. Junk is meant to be ignored, unless it's in your way.
- **Recovery full of junk:** a slot holding junk blocks a fragment from being dropped. Fragments in Recovery can't be dragged back out; junk can.
- **Win:** all four fragments in Recovery → the slots merge into `wm_core.exe` (§7).
- **Lose:** integrity 0.
- **Stars (score):** hearts left (0–3). `timeMs` = unpaused time from Start to Install.

---

## 5. Phases (one level, three phases)

Each phase adds exactly one complication. A phase starts when the previous phase's fragments are in Recovery (no gap, a 1.2 s banner). All values in `CONFIG`.

| Phase | Fragments | New complication | Windows / timers (starting values) |
|---|---|---|---|
| 1 *"Something's wrong."* | 1–2 | **Drag basics.** Two source windows, a fragment in each, plus 2 junk files. | Collapse timers 14 s and 18 s, starting after a 3 s grace period. |
| 2 *"Windows are overlapping."* | 3 | **Clutter + junk.** 3 source windows spawn, partly overlapping and on top of Recovery. The fragment sits under a junk-heavy window. Some junk is pre-placed in **one Recovery slot** ("autosave.tmp"), so the player must bin it or use another slot. | Timers 12–16 s. |
| 3 *"Cascade failure."* | 4 | **Moving target + nesting.** The final fragment is inside `📁 New folder` → open it (child window). Meanwhile Recovery **drifts** (slides slowly in a random direction, bouncing off edges) and **minimizes itself once** (restore from the mini taskbar). | Parent timer 18 s; child shares it. Drift 30 px/s. |

Phase timers must assume a human dragging at ~1.5 s per file. Tune with a bot after building (README already does this for Parts 2 and 4).

---

## 6. Drag-and-drop implementation (the part to get right)

**Don't use the native HTML5 drag-and-drop API.** Its ghost image, drop effects and event timing are inconsistent and hard to test. Build it with Pointer Events:

1. `pointerdown` on a file → record offset, `setPointerCapture`, after 4 px of movement start the drag.
2. Create a **drag ghost** (clone of the file icon, 80% opacity) in a top-level `#drag-layer` above all windows. The original stays in place, dimmed.
3. On `pointermove`, move the ghost with `transform`, then hit-test with `document.elementsFromPoint(x, y)`. Ignore the ghost and drag layer; the first element inside a `.mini-window` decides the **drop target window**. Highlight it (outline + tint). Recovery highlights green if a slot is free, red if not. The bin highlights only for junk.
4. On `pointerup`: drop onto the target window if valid; otherwise animate the ghost back to the origin (150 ms).
5. On `pointercancel` / `lostpointercapture`: treat as an invalid drop (return to origin). This covers the pointer leaving the iframe or the shell grabbing focus.
6. **If the origin window collapses mid-drag**, the dragged file is *saved*: it's in your hand, not in the window. That's an intentional mercy rule and a good clutch moment.
7. Dropping onto a minimized/collapsed window is impossible (it's not hit-testable).
8. Window **title-bar dragging** uses the same pointer-capture approach, clamped so 30 px of title bar stays inside the play area.

**Drifting Recovery during a file drag:** hit-testing every `pointermove` is enough. Also re-run the hit test on every game tick while a drag is active, so the highlight is right even if the pointer is still and Recovery drifts under it.

**Keyboard alternative (accessibility, small):** focus a file with Tab, press Space to "pick up", Tab cycles target windows, Space drops. Keeps the game playable without a mouse and makes headless tests easy.

---

## 7. Screens

- **Start:** black screen, white monospace text typing out: *"wm_core.exe: FILE NOT FOUND (404)"*, *"Attempting recovery…"*, *"4 fragments located in unstable memory."* Then **"Begin recovery"** button.
- **Help card** ("?", free): *"Drag 🧩 into Recovery before their window collapses. Junk goes in the bin. Files in your hand are safe."*
- **Win:** the four fragments slide together into one `wm_core.exe` icon in Recovery. All remaining source windows close *politely* (normal close animation, not collapse). A dialog-style window: **"wm_core.exe recovered"** with stats and **Install** → `won()`.
- **Lose:** every window collapses one after another into 404 ghosts, then the play area shows a giant **404** with *"Window manager not found."* and Retry. Send `lost()` once.

---

## 8. Implementation notes

- **Loop:** one rAF loop, fixed timestep, game-time clock (same as Parts 2 and 4). Collapse timers, drift, and spawns all run on game time.
- **Window state:** `{ id, el, title, x, y, z, minimized, collapseAt, files: [] , parentId }`. Files: `{ id, kind: 'frag'|'junk'|'folder', name, windowId, slot? }`. The DOM is a view of this state, so collapse = update state, then animate.
- **Spawn positions:** inside the play area, not fully covering Recovery (except phase 2's intentional overlap, which leaves at least 40% of Recovery visible).
- **Z-order:** clicking a window brings it to front; dragging a file over a window doesn't change z-order (otherwise the target jumps around under the cursor).
- **Collapse warning:** last 3 s of a timer, the window shakes slightly and its title bar flashes red.
- **Play area guard:** under 760×480 → "Maximize the window to play".
- **Sound** (if `soundOn`): pick-up click, drop thunk, slot-fill chime, junk "bonk" in Recovery, collapse crunch, win chord.
- **Reduced motion:** no shake, no drift animation (Recovery *jumps* to a new spot every 4 s instead), collapses fade instead of shrinking.

---

## 9. Easter eggs (report with `SHELL_EFFECT effect:'egg'`)

| id | Trigger | Effect |
|---|---|---|
| `wm-offscreen` | Drag a mini window by its title bar so it would leave the play area (clamping kicks in 3 times in one drag) | Window briefly shows *"404: window not found"* and snaps back. |
| `wm-bin-core` | Try to drop a fragment into the Recycle Bin | The bin refuses: *"Absolutely not."* |
| `wm-hoarder` | Fill all 4 Recovery slots with junk at once | Recovery title becomes *"Recovery (4 cat pictures)"*. |
| `wm-matryoshka` | Open nested folders 3 levels deep (one junk window in phase 2 has `New folder → New folder (2) → New folder (3)`, all empty except the last: `turtles.txt`) | Opening `turtles.txt`: *"It's folders all the way down."* |

Add the four ids to the shell's egg registry (26 → 30 secrets).

---

## 10. Testing hooks

- `?seed=N`, `?speed=N`, `?debug=1` as before.
- `window.__WM404 = { state(), move(fileId, windowId), collapse(windowId), skipToPhase(n), config }` under `?debug=1`.
- Headless test plan (use real pointer events for drags, not just `move()`):
  - Drag a fragment into Recovery fills a slot; junk into Recovery takes a slot; junk into bin removes it; fragment into bin refused.
  - Window collapse with a fragment inside → −1 heart, fragment respawns in a new window.
  - Mercy rule: origin collapses mid-drag, the drop still succeeds.
  - Pointer leaves the iframe mid-drag → file returns to origin, no stuck ghost.
  - Phase 3: child window collapses with its parent; drifting Recovery accepts a drop; self-minimized Recovery restores from the taskbar.
  - Keyboard pick-up/drop works.
  - Seeded win → `GAME_WON` once; three lost fragments → `GAME_LOST` once; pause/resume exact.

---

## 11. Acceptance criteria

- [ ] Loads in Edgy, `GAME_READY` sent, start screen types out, "Begin recovery" starts phase 1.
- [ ] Pointer-based drag with ghost, target highlight, valid/invalid drop, return-to-origin on cancel.
- [ ] Collapse timers, warning, collapse animation, file loss, heart loss, fragment respawn.
- [ ] Recovery slots, junk blocking, bin, phase 2's pre-placed junk.
- [ ] Phase 3 nesting, drift, and self-minimize all work together.
- [ ] Win → assembly animation → Install → `GAME_WON` once → shell repairs `wm_core.exe` (window jitter stops, resize enabled).
- [ ] **Full-game check:** with the other three already repaired, beating this game triggers the shell's restart → clean-desktop ending. Also test winning it first, second, and third.
- [ ] Keyboard alternative works; reduced motion and size guard work.
- [ ] Four eggs fire and reach the shell (30 secrets).
- [ ] No console errors; no native DnD, storage, modals or module scripts.
- [ ] Playtest: a first-timer wins in 1–3 runs; tune `CONFIG` if not.

---

## 12. Build order for Claude Code

1. Mini desktop layout, mini WM (title-bar drag, focus, minimize, taskbar), start screen, SDK.
2. Pointer drag-and-drop with ghost and hit-testing; Recovery slots; bin.
3. Collapse timers + animation + hearts + respawn + lose screen.
4. Phases 1–3 (overlap + junk, nesting + drift + self-minimize), banners, progress chip.
5. Win assembly + Install + stars; eggs + shell registry; keyboard drag; sound; reduced motion.
6. Headless suite (§10) + bot tuning.
7. Full-game run through the shell in every repair order, ending included. Then a human playtest of all four games back to back.
