# DOMINATION_SPEC.md — System32 Part 2: DOM-ination

> **File on desktop:** `free_prizes.html` · **gameId:** `dom-ination` · **Repairs:** `popup_guard.sys`
> **Route:** `sys32://free-prizes` · **Folder:** `games/dom-ination/`
> **Target:** 1 day with Claude Code

A scam website floods the browser with pop-up ads. Each pop-up is a real `<div>` in the DOM. Close them by clicking the right spot. Every pop-up left open for 5 seconds **duplicates**. Survive 60 seconds without the page drowning in ads.

**One mechanic:** click to close. Every pop-up type is just a different answer to *"where do I click?"*

---

## 1. Fit with the shell (read first)

The game runs in Edgy inside `<iframe sandbox="allow-scripts allow-forms allow-pointer-lock">`. That means:

- **Classic scripts only.** `<script src="game.js">`, not `type="module"`. Module scripts fail on the opaque origin.
- **No `localStorage`.** Best score comes from the shell via `System32.onInit`.
- **No `alert()` / `confirm()` / `window.open()`.** They're blocked (no `allow-modals`, no `allow-popups`). Every "pop-up" is a DOM element. That's the point of the game anyway.
- Talk to the shell **only** through `games/_shared/sdk.js`.

```html
<script src="../_shared/sdk.js" data-game="dom-ination"></script>
<link rel="stylesheet" href="style.css">
<script src="game.js"></script>
```

SDK calls used:

| When | Call |
|---|---|
| Page loaded | `System32.ready()` |
| Init received | `System32.onInit(({ beaten, soundOn, best }) => …)` (show "Best: N closed" if available) |
| Wave changes | `System32.progress('wave', '2/3')` |
| Win | `System32.won({ timeMs: 60000, score: closedCount })` |
| Lose | `System32.lost('browser overloaded')` |
| Minimized / unfocused | `System32.onPause(pause)` / `System32.onResume(resume)` |

---

## 2. Files

```
games/dom-ination/
├── index.html    # scam page markup + HUD + start/end screens
├── style.css     # garish 2005 scam-site look + pop-up styles
└── game.js       # IIFE, no globals except window.__DOMINATION (debug hook, §9)
```

Target size: `game.js` ≤ 600 lines.

---

## 3. Screens

### 3.1 Start screen (the scam page)
A deliberately awful page that fills the iframe:
- Blinking banner: **"🎉 CONGRATULATIONS! You are the 1,000,000th visitor! 🎉"**
- Fake countdown "Offer expires in 00:59" (decorative, static until play).
- A big pulsing button: **"CLAIM YOUR FREE GPU"**. Clicking it starts the game. This also counts as the user gesture for sound.
- Small grey text at the bottom: *"By clicking you agree to receive 4,000 pop-ups."* (true).
- If `beaten`: a corner sticker "popup_guard.sys ✓ restored. Play again for score."

### 3.2 Play screen
The scam page stays visible behind the pop-ups (dimmed 30% so pop-ups pop). The HUD is a fixed bar at the **top**, above every pop-up (`z-index` higher than any pop-up can reach):

```
⏱ 0:42   │  CLUTTER ▓▓▓▓▓▓░░░░░░  9/24  │  CLOSED 31  │  WAVE 2/3  │  <body> nodes: 47
```
- **Timer** counts down from 60.
- **Clutter meter** = open pop-ups / cap. Turns yellow at 60%, red at 80%, and shakes at 90%.
- **`<body>` nodes** is the live `document.body.getElementsByTagName('*').length`. It's a joke stat that makes the "DOM" part literal.

### 3.3 End screens
- **Win:** every remaining pop-up shrinks into the center and pops. A final, clean pop-up appears: **"You won: popup_guard.sys"** with stats (closed, peak clutter, accuracy). One button: "Install" → calls `System32.won(...)`. A "Play again" link below it.
- **Lose (clutter hits cap):** the screen fills with tiny stacked pop-ups (pure CSS, ~60 quick clones, then freeze). Message: **"Your browser is now 98% ads."** Stats + "Try again" button. Call `System32.lost(...)` once when this screen appears.

---

## 4. Rules

- Game lasts **60 s** of *unpaused* time.
- **Win:** reach 0:00 with clutter below the cap.
- **Lose:** open pop-ups reach **24** at any moment.
- **Duplication:** every pop-up has a 5 s life timer. At 5 s it **spawns a copy** of itself (same type, offset +24 px/+24 px, clamped on-screen) and its own timer resets. The copy starts its own 5 s timer.
  - From 3.5 s the pop-up's border flashes red and a thin progress bar at its bottom empties, so the player can see what's about to multiply.
- **Bait clicks:** some pop-ups have a fake close or a "CLAIM" button. Clicking bait immediately spawns **2** extra pop-ups. This is the only penalty besides duplication.
- Clicking the scam page background does nothing.
- **Accuracy** = correct closes / (correct closes + bait clicks). Shown at the end only.

---

## 5. Pop-up types

Every pop-up shares one base: a small fake window (title bar with a garish gradient, body text, buttons) sized 220–320 px wide. Text is pulled from a pool of joke ad copy (§7).

| Type | First wave | Behaviour | Where to click |
|---|---|---|---|
| **Classic** | 1 | Static. | The ✕ in the title bar. |
| **Drifter** | 1 | Slides in a straight line at 40–70 px/s, bouncing off the iframe edges. | The ✕ (on a moving target). |
| **Fake-X** | 2 | Has a big, obvious ✕ that is **bait**. The real close is a tiny grey link in the body: "No thanks, I hate free stuff". | The tiny link. The big ✕ spawns 2 more. |
| **Runaway** | 2 | When the cursor gets within 70 px, it hops to a random spot (150 ms slide). After **3 hops** it gets "tired" (title says *"fine."*) and stays. | The ✕ after it gives up, or catch it mid-approach. |
| **Chain** | 3 | Closing it spawns 2 smaller follow-ups in place: "Are you sure?" → each of those is a one-click Classic with half the size and **no** further chaining. | The ✕, then its two children. |
| **Update boss** | 3 (once, at 50 s) | A big "System Update — do not close" window. Its ✕ moves to a new corner after each click. Needs **5 clicks**. Does **not** duplicate, but counts as 3 toward clutter while open. | Chase the ✕ around its corners. |

Every pop-up type except the boss can also carry an optional **"CLAIM" bait button** in the body (30% chance from wave 2). Bait buttons are big and colorful. Close buttons are always the expected size, except on Fake-X.

---

## 6. Waves

All numbers live in one `CONFIG` object at the top of `game.js` so tuning is a one-line change. They're starting values that need to be tuned by playtesting.

| Wave | Time | Spawn interval | Types (weights) | Banner (1.5 s, during which spawns pause) |
|---|---|---|---|---|
| 1 | 0–20 s | 1.6 s | Classic 70, Drifter 30 | *"WAVE 1: Free stuff incoming!"* |
| 2 | 20–40 s | 1.2 s | Classic 30, Drifter 25, Fake-X 25, Runaway 20 | *"WAVE 2: They know where the ✕ is."* |
| 3 | 40–60 s | 0.9 s | Classic 15, Drifter 20, Fake-X 25, Runaway 20, Chain 20 + boss at 50 s | *"WAVE 3: ACT NOW!!!"* |

```js
const CONFIG = {
  durationMs: 60000,
  clutterCap: 24,
  lifeMs: 5000,
  warnMs: 3500,
  baitSpawn: 2,
  bossClicks: 5,
  bossClutterWeight: 3,
  runawayRadius: 70,
  runawayHops: 3,
  waves: [ /* as in the table */ ],
};
```

Spawn position: random, fully inside the play area (below the HUD), avoiding the exact spot of the last spawn by at least 80 px.

---

## 7. Ad copy pool (≥ 15, pick randomly, no repeats until exhausted)

- "Hot singletons in your area want to meet you!" (with a picture of a 1×1 table)
- "DOWNLOAD MORE RAM — 100% legit"
- "Your PC has (3) viruses. Click to add more."
- "Doctors HATE this one weird semicolon"
- "You won a FREE GPU! (shipping: $4,999)"
- "Congratulations, you're our 1,000,001st visitor too!"
- "Local div discovers it can float. Developers furious."
- "Click here to unsubscribe from pop-ups*"  *(subscribes you to more)*
- "!important: this ad is more important than you"
- "Is your z-index too low? Try ours."
- "Learn React in 3 minutes (the 4th minute is forever)"
- "Your free trial of existence has expired"
- "Nigerian prince needs help with CSS centering"
- "Hot fixes in your area"
- "Your cookies are delicious. Accept all?"

Ad copy must be original jokes. No real brand names or logos.

---

## 8. Implementation notes

- **Game loop:** one `requestAnimationFrame` loop with an accumulated `elapsedMs` that only advances when not paused. All timers (game clock, spawn timer, each pop-up's life timer, drifter movement) are driven from this loop. **No `setTimeout`/`setInterval` for game logic**, so pause/resume is exact.
- **Pause** stops the loop, freezes CSS animations (`.paused * { animation-play-state: paused }`), and shows a "Paused" overlay. Resume on `onResume` or on click of the overlay.
- **Pop-up entity:** `{ id, type, el, x, y, vx, vy, bornAt, hops, clicks }` kept in a `Map`. Move with `transform: translate()`, never `top/left`.
- **Event handling:** one delegated `pointerdown` listener on the play area. Read `data-action="close" | "bait" | "boss"` from the target. Use `pointerdown`, not `click`, so fast clicks register on moving targets.
- **Runaway proximity:** throttled `pointermove` on the play area (once per frame), distance check against each runaway only.
- **Z-order:** newest pop-up on top; clicking anywhere on a pop-up (not a button) raises it.
- **Resize:** on `resize`, clamp all pop-ups into the new bounds.
- **Min play area:** if the iframe is under 760×480, show "Maximize the window to play" instead of starting.
- **Closing animation:** 120 ms scale-down + fade, then remove the node. Counted as closed on `pointerdown`, not after the animation.
- **Sound** (only if `soundOn` from init): tiny WebAudio blips: close = short high blip, bait = buzzer, duplicate = low "bloop", win = 3-note rise. No audio files.
- **Reduced motion** (`prefers-reduced-motion`): drifters move at 50% speed, no shaking clutter meter, no blinking banner, lose screen uses a fade instead of the clone burst.

---

## 9. Testing hooks

To keep it testable in headless Chromium:
- `?seed=123` makes all randomness deterministic (small seeded PRNG like mulberry32).
- `?speed=4` multiplies the game clock (so a full run takes 15 s in tests).
- `window.__DOMINATION = { state(), spawn(type), closeAll(), forceWin(), forceLose() }` exists only when `?debug=1`.

---

## 10. In-game easter eggs (report to the shell with `SHELL_EFFECT effect:'egg'`)

| id | Trigger | Effect |
|---|---|---|
| `dom-rude` | Close the boss within 2 s of it appearing | Its last message: *"rude."* |
| `dom-claim-all` | Click 5 bait buttons in one run | A pop-up: *"Achievement unlocked: Gullible."* (doesn't count toward clutter) |
| `dom-pacifist` | Close nothing for the first 10 s and survive wave 1 | Banner: *"Bold strategy."* |

---

## 11. Acceptance criteria

- [ ] Start screen loads, "CLAIM YOUR FREE GPU" starts the run; `GAME_READY` is sent on load.
- [ ] HUD shows timer, clutter meter, closed count, wave, and live node count, always above pop-ups.
- [ ] All 6 pop-up types behave as in §5, and bait clicks spawn exactly 2 pop-ups.
- [ ] Duplication happens at 5 s with a visible warning from 3.5 s.
- [ ] Wave banners and progress chip (`wave 1/3` → `3/3`) update at 20 s and 40 s; boss appears at 50 s.
- [ ] Clutter reaching 24 ends the run with the lose screen and sends `GAME_LOST` once.
- [ ] Surviving 60 s shows the win screen; "Install" sends `GAME_WON` and the shell repairs `popup_guard.sys`.
- [ ] Minimizing the Edgy window pauses everything exactly; restoring resumes with no time lost or gained.
- [ ] No `alert`, `window.open`, `localStorage`, or module scripts. No console errors.
- [ ] `?seed`, `?speed`, `?debug` hooks work; a headless test can complete a win and a lose.
- [ ] Reduced-motion and the small-window guard work.
- [ ] Playtest: a first-time player wins in 1–3 attempts. Tune `CONFIG` if not.

---

## 12. Build order for Claude Code

1. Markup + scam-page styling + HUD + start screen; SDK wired (`ready`, `onInit`).
2. Game loop with pause/resume, timer, Classic pop-ups, close + clutter + lose condition.
3. Duplication with warning, then win screen and `won()`.
4. Drifter, Fake-X, bait buttons, Runaway.
5. Waves + banners + progress chip, then Chain and the boss.
6. Test hooks, sound, reduced motion, easter eggs, small-window guard.
7. Headless run: seeded win, seeded lose, pause/resume check. Then playtest and tune `CONFIG`.
