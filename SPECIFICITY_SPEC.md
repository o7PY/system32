# SPECIFICITY_SPEC.md — System32 Part 4: CSS Specificity Wars

> **File on desktop:** `styles_FINAL_v2.html` · **gameId:** `specificity` · **Repairs:** `theme.dll`
> **Route:** `sys32://styles-final-v2` · **Folder:** `games/specificity-wars/`
> **Target:** 1 day with Claude Code

Two stylesheets are fighting over the page. Enemy elements fall down the screen, each **defended by its own CSS rule**. You type a selector; the game turns it into `display: none`. If your selector matches and **beats the enemy's defense in the cascade**, the enemy vanishes. If not, it's blocked, and you learn exactly why.

**One mechanic:** type a selector. The twist that makes it *specificity* wars and not just "selector practice": enemies get stronger defenses, so you must out-specify them, and friendly elements fall too, so you must be precise.

---

## 1. Fit with the shell (read first)

Same rules as every game: classic scripts, no `localStorage`/cookies, no modals, SDK only.

```html
<script src="../_shared/sdk.js" data-game="specificity"></script>
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="enemy.css">   <!-- the enemies' defenses, readable in DevTools -->
<script src="game.js"></script>
```

| When | SDK call |
|---|---|
| Page loaded | `System32.ready()` |
| Init | `System32.onInit(({ beaten, best, bestTimeMs, soundOn }) => …)` |
| Wave changes | `System32.progress('wave', '3/5')` |
| Win (player clicks "Install") | `System32.won({ timeMs, score: stars })` |
| HP hits 0 | `System32.lost('stylesheet overrun')` |
| Minimized | `onPause` / `onResume` freeze the game exactly (rAF clock, as in DOM-ination) |

---

## 2. Files

```
games/specificity-wars/
├── index.html     # arena, HUD, input bar, player.css panel, start/end screens
├── style.css      # game chrome (editor-like dark theme)
├── enemy.css      # the defense rules, one per enemy type (static file, so DevTools shows it)
└── game.js        # loop, waves, selector validation, specificity calc, rule injection (≤ 650 lines)
```

---

## 3. Screen layout

```
┌──────────────────────────────────────────────────────────┬────────────────┐
│ theme.dll ♥♥♥     WAVE 3/5     ⏱ 1:12                    │  player.css    │
├──────────────────────────────────────────────────────────┤  ────────────  │
│                                                          │ .red       ✕   │
│   ┌──────────────────────┐        ┌────────────────┐     │ .enemy.blue ✕  │
│   │ <div class="enemy    │        │ <p class="ally │     │                │
│   │   armored green">    │        │   green">      │     │  slots 2/6     │
│   │ 🛡 (0,2,1)            │        │ 🙂 keep me      │     │                │
│   └──────────────────────┘        └────────────────┘     │                │
│                 #arena (enemies fall ↓)                  │                │
├──────────────────────────────────────────────────────────┴────────────────┤
│ :where(#arena) :is( [ .enemy.armored.green______ ] ) { display: none; }   │
│                     matches: 1 enemy · 0 allies · yours (0,3,0) ✔ beats   │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Arena** (`#arena`): enemies and allies fall from top to the bottom edge.
- **Every falling element is a card** that shows its own markup: tag, classes, id. Enemies with a defense show a 🛡 badge with the specificity of their defense rule, e.g. `(0,2,1)`. Hovering an enemy shows its full defense rule from `enemy.css`.
- **Input bar** at the bottom renders as a CSS rule with the player's selector in the blank, so the player always sees exactly what will be injected.
- **Live preview while typing** (debounced 80 ms): matched elements get a dashed outline (red for enemies, yellow for allies). The preview line shows match counts and the player's specificity vs. the strongest matched defense.
- **player.css panel**: every rule the player has added. Rules **persist** and keep working on future enemies. Max **6 slots**; adding a 7th evicts the oldest (with a flash). Each rule has ✕ to delete it.

---

## 4. Rules

- The player types a selector and presses Enter. The game inserts:
  `:where(#arena) :is(<selector>) { display: none; }` into the player stylesheet.
  - `:where()` adds **zero** specificity and `:is()` takes the specificity of its argument, so the injected rule has **exactly the player's selector's specificity** while being scoped to the arena. The HUD, input, and panel can never be hidden.
  - The player stylesheet comes **after** `enemy.css` in the document, so equal specificity → player wins (source order). Tell the player this in the help card.
- **Enemy defeated** when `getComputedStyle(el).display === 'none'`. It plays a short "unstyled" death animation (the card collapses into plain black-on-white text, then vanishes), then is removed.
- **Blocked:** if the new rule matches an enemy that stays visible, that enemy flashes its shield and the preview line explains: *"Blocked: your (0,1,0) < defense (0,2,1)"*.
- **Enemy reaches the bottom:** −1 HP (theme.dll ♥). 3 HP total.
- **Ally hidden by your rules:** −1 HP and the ally card turns grey with *"you deleted my styles :("*. Allies that reach the bottom safely give nothing (they're just there to punish sloppy selectors).
- **Win:** clear all 5 waves with HP > 0. **Lose:** HP 0.
- **Stars (score):** HP left (0–3). Time is reported as `timeMs`.

---

## 5. Waves (one level, five waves)

Each wave introduces exactly one new idea. Next wave starts 2 s after the last enemy of the current wave is gone (defeated or landed). Each wave opens with a 1.5 s banner. All values live in `CONFIG`.

| Wave | Spawns | New idea | Defense rules in `enemy.css` | Intended answer |
|---|---|---|---|---|
| 1 | 3 grunts: `div.enemy.red`, `.blue`, `.green` (one at a time) | Class selectors | none | `.red`, or `.enemy` once you realize it |
| 2 | 3 grunts + 2 allies: `p.ally.red`, `p.ally.blue` | **Precision**: allies share colors | none | `.enemy.red` / `div.red` / `.enemy` (hiding `.red` alone now also hits an ally; a rule from wave 1 like `.red` will hit it too, which teaches deleting old rules) |
| 3 | 3 armored: `div.enemy.armored.green` etc. + 1 ally | **Out-specify** a defense | `div.enemy.armored { display: block; }` → (0,2,1) | `.enemy.armored.green` (0,3,0), or `div.enemy.armored` (equal, wins on order) |
| 4 | 1 boss: `div.enemy.boss#boss-<4 random hex>` + 2 grunts + 1 ally | **IDs** | `#arena .boss { display: block; }` → (1,1,0) | `#boss-7f3a` (1,0,0) is *not* enough; needs `#boss-7f3a.boss` or `#boss-7f3a.enemy.boss` |
| 5 | Final boss `div.enemy.boss.final` with **inline** `style="display:block"` + 2 armored | **`!important`** | inline style beats any selector | The player gets **one `!important` charge** this wave (a toggle button appears next to the input). With it on, the next rule is injected as `display: none !important`, which beats the inline style. |

Speed: fall at 22 px/s in wave 1, +3 px/s per wave. Spawns per wave are staggered (2.5 s apart). Arena height ~520 px gives roughly 20 s to answer each enemy, enough for a first-timer to read and type.

- Wave 4's random id means the player must actually **read** it (on the card, or in DevTools).
- Wave 5's `!important` toggle: one charge per run. Using it on something else wastes it (egg below). If wasted, a second charge appears after 15 s so the run is always winnable, but stars are capped at 2.

---

## 6. Selector validation and injection (security-critical)

The player's string ends up inside CSS, so treat it as hostile:

1. Trim; reject empty or > 120 chars.
2. **Reject** if it contains `{`, `}`, `;`, `@`, `\`, `/*`, `<`, or a newline.
3. **Reject** if parentheses `()` or brackets `[]` are unbalanced (simple counter, ignoring characters inside quotes).
4. **Reject** pseudo-elements (`::` or legacy `:before`/`:after`/`:first-line`/`:first-letter`): they're invalid inside `:is()`.
5. Validate with `try { document.querySelector(sel) } catch { invalid }`.
6. Insert with `sheet.insertRule(…, sheet.cssRules.length)` inside try/catch (never by editing `textContent`). `insertRule` parses exactly one rule, so injection can't add a second rule.
7. Matching for preview and blocked-detection uses `arena.querySelectorAll(':is(' + sel + ')')`, again in try/catch.

Invalid input: the input bar shakes and shows a short reason (*"Invalid selector"*, *"No braces, nice try"*, *"Pseudo-elements can't be hidden"*). Nothing is inserted and no HP is lost.

---

## 7. Specificity calculator

Needed for the 🛡 badges, the live preview, and "Blocked" messages. Write `specificity(selector) → [a, b, c]` per Selectors Level 4:

- `a` = ids; `b` = classes, attribute selectors, pseudo-classes; `c` = type selectors (and pseudo-elements, which we reject anyway).
- `*` and combinators count 0.
- `:is()`, `:not()`, `:has()` → specificity of their **most specific** argument. `:where()` → 0. `:nth-child(… of S)` → 1 pseudo-class + most specific `S`.
- For a selector list (`a, b`), the preview shows the specificity of each part against the elements it matches; for comparing against a single enemy, use the most specific part that matches that enemy.
- Comparison is lexicographic. Equal → player wins (later in source order); show *"tie: you win on source order"*.

Ship it with a table-driven unit test in the debug harness (≥ 15 cases, including `:is(#a, .b)`, `:where(#a) .b`, `:not(.a.b)`, `div > p.x[data-y]`, `#a#a`).

The calculator is for **display only**. The truth is always `getComputedStyle`, so a calculator bug can never decide the game wrongly.

---

## 8. Screens

- **Start:** dark editor screen with a broken page behind it (half-styled, Comic Sans fighting Times New Roman). Title "CSS Specificity Wars", one line: *"Their styles vs. yours. The cascade decides."* A 4-line cheat sheet: `.class` · `#id` · `tag` · `a.b` (both). "Start" button (focuses the input, so typing works immediately).
- **Help card** ("?" button, free): how injection works (shows the `:where(#arena) :is(…)` wrapper), the specificity triple `(ids, classes, tags)`, and "ties go to whoever comes later: you".
- **Win:** the broken page behind snaps into a clean theme. A card: **"theme.dll — conflicts resolved"** with stats (time, rules used, allies lost, stars) and **Install** → `won()`.
- **Lose:** every element on the page loses its styles at once (pure black-on-white HTML), with *"Stylesheet overrun. Everything is Times New Roman now."* and Retry. Send `lost()` once.

---

## 9. Implementation notes

- **Loop:** one rAF loop, fixed timestep, game-time clock (copy DOM-ination's approach). Move cards with `transform: translateY()`, never `top`.
- **Defeat check:** after each rule insertion **and** once per frame for every live enemy (cheap at ≤ 6 live elements). Per-frame matters because rules persist: a rule added earlier kills new spawns as they appear. An enemy hidden by an old rule on spawn should still play the death animation where it spawned.
- **Death animation must not depend on the element being visible:** clone the card into an effects layer, then remove the original.
- **Ally check:** same per-frame check; an ally that becomes hidden costs HP exactly once.
- **Input focus:** keep focus on the input after Enter, and refocus on any arena click. Esc clears the input.
- **History:** ↑/↓ in the input cycles previous selectors (last 10).
- **Sound** (if `soundOn`): zap on defeat, clank on blocked, sad tone on ally hit, rise on win.
- **Reduced motion:** death animation is an instant fade; banners don't slide.

---

## 10. Easter eggs (report with `SHELL_EFFECT effect:'egg'`)

| id | Trigger | Effect |
|---|---|---|
| `spec-nuke` | Player injects `*` (alone) | Everything in the arena vanishes, allies included (real HP loss). Banner: *"The nuclear option."* |
| `spec-devtools` | An enemy becomes hidden while **no** player rule matches it (they edited it in DevTools, Part 3 style) | It still counts as defeated. Toast: *"Inspect Element veteran, huh?"* |
| `spec-has` | Any accepted selector containing `:has(` | Preview line: *"Look at you, using :has()."* |
| `spec-overkill` | The `!important` charge is used on a rule that matches only grunts | Banner: *"Overkill."* |

Add the four ids to the shell's egg registry (secrets total 22 → 26).

---

## 11. Testing hooks

- `?seed=N`, `?speed=N`, `?debug=1` exactly like DOM-ination.
- `window.__SPECIFICITY = { state(), submit(selector), toggleImportant(), skipToWave(n), specificity(sel), runSpecTests() }` under `?debug=1`.
- Headless test plan:
  - Validation: each rejection reason in §6, plus an attempt like `x) , body :is(y` and `.a{} body{display:none}` → rejected, page intact.
  - Scoping: `*` hides nothing outside `#arena`.
  - Each wave's intended answer defeats its enemies; each "almost" answer (`.red` in wave 2, `#boss-xxxx` in wave 4, any selector without `!important` in wave 5) is blocked or hurts an ally as described.
  - Persistent rules kill new spawns; slot eviction at 7 rules.
  - Full seeded win sends `GAME_WON` once; three landings send `GAME_LOST` once.
  - Pause/resume exact.

---

## 12. Acceptance criteria

- [ ] Loads in Edgy, `GAME_READY` sent, input focused after Start.
- [ ] Live preview outlines matches and shows specificity vs. defense while typing.
- [ ] Injection uses the `:where(#arena) :is()` wrapper via `insertRule`; validation blocks every case in §6.
- [ ] All 5 waves play as in §5, each new idea requires a new kind of selector, and the run is always winnable.
- [ ] Blocked messages show both triples; ties resolve to the player.
- [ ] Allies cost HP when hidden; enemies cost HP when they land; HP 0 → lose screen + `GAME_LOST` once.
- [ ] Win screen → Install → `GAME_WON` once → shell repairs `theme.dll` (wallpaper glitches stop, Personalize works).
- [ ] player.css panel: rules persist, delete works, 6-slot eviction works.
- [ ] Specificity unit tests pass (≥ 15 cases).
- [ ] Four easter eggs fire and reach the shell.
- [ ] No console errors; no modals, storage, or module scripts.
- [ ] Playtest: someone who knows basic CSS clears it in 1–2 runs; someone who doesn't can finish using the help card.

---

## 13. Build order for Claude Code

1. Layout, `style.css`, `enemy.css`, start screen, SDK wiring.
2. Loop + falling cards + HP + lose condition (with a hardcoded wave 1).
3. Input → validation → `insertRule` injection → defeat detection → player.css panel.
4. Specificity calculator + unit tests + live preview + blocked messages.
5. Waves 2–5 (allies, armored, ID boss, inline boss + `!important` charge).
6. Win/lose screens, stars, eggs + shell registry, sound, reduced motion.
7. Headless suite (§11), then a human playtest and `CONFIG` tuning.
