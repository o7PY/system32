# DESKTOP_SPEC.md — System32 (Part 1 of 5: The Shell)

> **System32** is a fake Windows 11-style desktop running in the browser. It launches four DOM-abusing mini-games inside a fake browser and wraps them in one story: **the OS is corrupted, and each game you beat repairs part of it.**
>
> This spec covers **only the shell**: desktop, taskbar, start menu, window manager, built-in apps, fake browser, fake search engine, the progression system, and the protocol the games use to talk to the shell. Parts 2–5 (the games) get their own specs and must follow the **Game Protocol** in §9.

---

## 0. What changed from the original pitch (the "make it better" part)

| Original | Upgrade | Why |
|---|---|---|
| Games are four separate toys | **Corruption meta-loop**: the desktop starts glitched. Each win repairs one system component and visibly un-breaks the desktop. All four repaired → ending sequence. | Gives the hub a reason to exist and gives the player a goal across games. |
| Easter eggs are random | Easter eggs **carry lore** (Recycle Bin files, `README.txt`, search results) and hint at the games. | Discovery feels rewarding, not just funny. |
| Shell and games are disconnected | A tiny **`postMessage` protocol** lets games report wins/losses back to the shell. | Enables progress, notifications, and unlocks without breaking iframe isolation. |
| Window = open/close/drag | Plus **focus/z-order, minimize, maximize, and taskbar buttons** (resize is stretch). | Without focus and minimize, more than one open window feels broken immediately. |
| Progress lost on refresh | **localStorage persistence** owned by the shell. | People will refresh. |
| Games only reachable via icons | **Notepad, File Explorer, Recycle Bin** as real mini-apps. | Cheap to build and makes the desktop feel like a real OS. |

---

## 1. Goals and non-goals

**Goals**
- Feels like Windows 11 within 2 seconds of loading: centered taskbar, rounded windows, frosted-glass panels, live clock.
- Zero frameworks: vanilla HTML/CSS/JS (ES modules). No build step. Deployable as a static site (GitHub Pages).
- Games are completely sandboxed in iframes and cannot break the shell.
- Smooth on a mid-range laptop at 1366×768 and up.

**Non-goals (MVP)**
- Mobile/touch support (show a "System32 requires a desktop" screen below 900px width).
- Real file system, real networking, multiple browser tabs, window snapping.
- Using real Microsoft or Google logos, names, or artwork. Everything is a **parody**: original icons, our own OS name ("System32"), our own search engine ("Goggle").

---

## 2. Tech stack and file structure

- HTML5, CSS3 (custom properties, `backdrop-filter`), vanilla JS ES modules.
- Fonts: `font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;` (no font files shipped).
- Icons: original inline SVGs in a single sprite file.
- Local dev: `python3 -m http.server 8000`. **Do not open via `file://`** because iframes and ES modules misbehave there.

```
system32/
├── index.html                 # the desktop (single page)
├── css/
│   ├── tokens.css             # colors, radii, shadows, corruption vars
│   ├── desktop.css            # wallpaper, icons, selection box
│   ├── taskbar.css            # taskbar, tray, clock, start menu
│   ├── window.css             # window chrome
│   └── apps.css               # browser, notepad, explorer, recycle bin
├── js/
│   ├── main.js                # boot, wiring
│   ├── state.js               # progress store + localStorage
│   ├── events.js              # tiny pub/sub bus
│   ├── WindowManager.js       # Window class + manager (z-order, focus)
│   ├── desktop.js             # icons, selection, context menu, drag-to-bin
│   ├── taskbar.js             # clock, taskbar buttons, start menu, tray
│   ├── notifications.js       # toast system
│   ├── corruption.js          # applies corruption level to the UI
│   ├── easterEggs.js          # all shell easter eggs
│   └── apps/
│       ├── browser.js
│       ├── notepad.js
│       ├── explorer.js
│       └── recycleBin.js
├── assets/
│   ├── icons.svg              # SVG sprite
│   ├── wallpaper.svg          # original abstract "bloom"-style wallpaper (CSS gradient fallback)
│   └── sounds/                # optional: startup, error, notify (short, original or CC0)
├── pages/                     # pages that load INSIDE the fake browser
│   ├── search/index.html      # Goggle
│   ├── offline/index.html     # no-internet runner game parody
│   └── crash/index.html       # used by the "exit vim" egg
└── games/
    ├── dom-ination/index.html         # Part 2 (stub until built)
    ├── inspect-element/index.html     # Part 3
    ├── specificity-wars/index.html    # Part 4
    └── window-manager-404/index.html  # Part 5
```

---

## 3. Boot flow

1. **Boot screen (≈2.5 s, skippable with any key/click):** black screen, a spinning-dots loader, the text "System32". After the first win, show a small "Repairing…" line under the loader.
2. **Lock screen:** full-screen wallpaper (blurred), large clock + date. Click / any key → slides up → **sign-in**: avatar circle, username "User", a "Sign in" button (no password). Pressing Enter also works.
3. **Desktop** appears with icons fading in one by one (50 ms stagger).
4. **First-visit only:** after 1.5 s, a toast: *"⚠ System integrity: 0%. Critical components missing."* and Notepad auto-opens `README.txt` (see §8).

Returning visitors (state exists in localStorage) skip the lock screen animation and go straight to sign-in.

---

## 4. Desktop

### 4.1 Wallpaper
- Original abstract wallpaper (soft gradient waves, blue/purple), implemented as SVG or layered CSS gradients.
- Corruption effects layer on top (§10).

### 4.2 Icons
Laid out in a **column-first grid** from the top-left (like Windows): 80×90 px cells, icon 48 px, label below (max 2 lines, ellipsis, white text with shadow).

| Icon | Label | Opens |
|---|---|---|
| PC | `This PC` | File Explorer at `This PC` |
| Bin | `Recycle Bin` | Recycle Bin app (icon shows full/empty state) |
| Text | `README.txt` | Notepad |
| HTML | `free_prizes.html` | Browser → DOM-ination |
| HTML | `bank_login.html` | Browser → Inspect Element |
| HTML | `styles_FINAL_v2.html` | Browser → CSS Specificity Wars |
| HTML | `recovery_tool.html` | Browser → 404: Window Manager |
| Browser | `Edgy` | Browser → Goggle home |

Game file names stay unassuming on purpose. After a game is beaten, its icon gets a small green check overlay.

### 4.3 Interactions
- **Single click:** select (blue translucent highlight). Click empty desktop to deselect.
- **Double click / Enter on selected:** open.
- **Rubber-band selection:** drag on empty desktop draws a translucent blue rectangle; icons inside it get selected.
- **Drag icons:** free positioning, snaps to grid on drop. Positions persist in localStorage.
- **Drag onto Recycle Bin:** see easter eggs (§11). Game icons and `This PC` cannot actually be deleted.
- **Right-click desktop → context menu** (Windows 11 style, rounded, frosted):
  - View → Large / Medium icons (MVP: just toggles icon size class)
  - Sort by → Name (re-flows grid)
  - Refresh (icons blink; with corruption > 0 it also briefly glitches)
  - New → Folder (creates `New folder (corrupted)`, which shows an error on open)
  - Personalize (toast: *"Personalization is unavailable. Missing component: theme.dll"* until CSS Wars is beaten, after which it cycles 3 accent colors)
- **Right-click icon:** Open, Delete, Properties (Properties shows a small dialog with fake file size and a lore line).

---

## 5. Taskbar (bottom, 48 px, frosted glass)

- **Center group** (Windows 11 style): Start button, Search button, pinned **File Explorer**, **Edgy** browser, **Notepad**, then one button per open window.
  - Open windows show an underline indicator; the focused one has a longer, brighter underline.
  - Clicking a taskbar button: if minimized → restore + focus; if focused → minimize; else → focus.
- **Right tray:** up-arrow (hidden icons flyout containing a "System Integrity" shield icon), Wi-Fi icon (always shows "No internet" as a slashed icon, which is a running joke), volume icon (toggles sound on/off for real), and the **clock**.
- **Clock:** live `HH:MM` (12-hour with AM/PM) and date `DD-MM-YYYY` below it. Updates every second, aligned to the minute change. Clicking opens a small calendar flyout (current month grid, today highlighted).
- **Show desktop:** thin sliver at the far right edge; click minimizes all windows.

### 5.1 Start menu
Floating panel centered above the taskbar, 640×700 px max, rounded 8px, frosted.
- Search box at top (typing filters the pinned list; Enter opens Edgy and searches Goggle).
- **Pinned** grid: Edgy, File Explorer, Notepad, Recycle Bin, Settings (stub → error dialog), the 4 game files (only after they've been opened at least once, so discovery happens on the desktop first).
- **Recommended** list: recently opened items (from state).
- Bottom bar: user avatar + "User", and a **power button** → menu: Sleep / Shut down / Restart (see easter eggs).
- Closes on Escape, outside click, or selecting an item. Open with the Start button or the **Windows/Meta key is not reliably capturable**, so use **Ctrl+Esc** as the keyboard shortcut.

---

## 6. Window Manager

### 6.1 `Window` class (one reusable class for every app)

```js
class Window {
  constructor({ id, title, icon, width, height, x, y, content, resizable = true, onClose })
  open()       // mount DOM, animate in (scale 0.95 → 1, opacity 0 → 1, 150 ms), focus
  close()      // animate out, unmount, fire onClose, remove taskbar button
  focus()      // bring to top z-index, mark active, notify taskbar
  minimize()   // animate toward taskbar button, hide
  restore()
  toggleMaximize()  // fill desktop area minus taskbar; double-click title bar also toggles
  setTitle(str)
  shake()      // used by errors / easter eggs
}
```

`WindowManager` (singleton) keeps the list of windows, assigns z-index (start at 100, increment on focus), tracks the active window, and cascades new windows (+30 px x/y offset from the last one, wrapping to top-left when off-screen).

### 6.2 Window chrome (Windows 11 look)
- 8 px rounded corners (0 when maximized), 1 px subtle border, large soft shadow; inactive windows have a lighter shadow and dimmer title.
- **Title bar (32 px):** app icon + title on the left; **minimize, maximize/restore, close** on the right (46 px wide each; close turns red on hover).
- **Drag by title bar** using Pointer Events + `setPointerCapture`. Clamp so at least 40 px of the title bar always stays on-screen. Ignore drags that start on the control buttons.
- **Critical iframe drag fix:** while dragging (or resizing), set `pointer-events: none` on every iframe, otherwise the iframe swallows pointer events and the drag "sticks".
- **Resize (stretch goal):** 8 px invisible handles on edges/corners, min size 400×300.
- Clicking anywhere inside a window focuses it. For iframes, detect focus via `window.addEventListener('blur')` + `document.activeElement === iframe`.

### 6.3 Dialogs
`Dialog` = small non-resizable `Window` with an icon (info/warning/error), message, and 1–2 buttons. Plays the error sound. Used heavily by easter eggs. Modal dialogs dim their parent window only, not the whole desktop.

---

## 7. The Edgy browser (fake browser app)

### 7.1 Layout
```
┌───────────────────────────────────────────────────────┐
│ [icon] Tab title                          _  □  ✕     │  ← window title bar shows tab title
├───────────────────────────────────────────────────────┤
│ ←  →  ⟳  │ 🔒 sys32://free-prizes                │ ⋯  │  ← toolbar
├───────────────────────────────────────────────────────┤
│ ★ Goggle  ★ free_prizes  ★ bank_login  ★ styles_FINAL │  ← favorites bar
│   ★ recovery_tool                                      │
├───────────────────────────────────────────────────────┤
│                                                       │
│                  <iframe> content                     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

- **Back / forward:** internal history stack per browser window (array + index). Disabled state when unavailable.
- **Refresh:** reloads the iframe (restarts the current game).
- **Address bar:** read-only. Shows a fake URL per route. Clicking it selects the text (feels real) but typing does nothing. Stretch: typing a known route and pressing Enter navigates.
- **Favorites bar:** one bookmark per route. Game bookmarks that haven't been unlocked yet (never opened from the desktop) show as `★ ???`.
- **`⋯` menu:** "Inspect (F12)" item opens a dialog: *"Press F12. The real one."* (a hint for Part 3).
- **Loading bar:** thin accent-colored bar at the top of the content area while the iframe loads.
- Default size 1100×720, centered. Multiple browser windows are allowed (each has its own history).

### 7.2 Routes

| Route key | Fake URL | Iframe src |
|---|---|---|
| `home` | `sys32://goggle` | `pages/search/index.html` |
| `search` | `sys32://goggle/search?q=…` | `pages/search/index.html?q=…` |
| `offline` | `sys32://offline` | `pages/offline/index.html` |
| `dom-ination` | `sys32://free-prizes` | `games/dom-ination/index.html` |
| `inspect` | `sys32://bank-login` | `games/inspect-element/index.html` |
| `specificity` | `sys32://styles-final-v2` | `games/specificity-wars/index.html` |
| `wm404` | `sys32://recovery-tool` | `games/window-manager-404/index.html` |

### 7.3 Iframe isolation (critical)
```html
<iframe src="…" sandbox="allow-scripts allow-forms allow-pointer-lock" title="…"></iframe>
```
- **No `allow-same-origin`.** Together with `allow-scripts` it would let game code reach into the parent page. The shell owns all persistence, so games don't need their own storage.
- **No `allow-popups`**, so games can't spawn real windows.
- Games talk to the shell **only** through `postMessage` (§9).
- Note for Part 3 (Inspect Element): real DevTools still work inside sandboxed iframes. Players pick the frame from the DevTools context dropdown or simply right-click → Inspect inside the game, which targets the iframe directly. Put this hint in the game itself.

### 7.4 Goggle (fake search engine) — `pages/search/index.html`
- Clean home page: wordmark "Goggle" in multicolor letters (original parody, not Google's logo), a rounded search box, two buttons: **"Goggle Search"** and **"I'm Feeling Corrupted"** (opens a random unbeaten game).
- On submit, the page posts `{type: 'NAVIGATE', route: 'search', query}` to the shell so the address bar and history update, then renders results.
- **Easter egg queries** (case-insensitive, trimmed, matched against a lookup table in one JS object so more are easy to add):

| Query | Result |
|---|---|
| `how to exit vim` | Results load… then the shell takes over: the browser window title becomes "Edgy (Not Responding)", window goes white-washed, shakes, then closes with a dialog: *"Edgy has stopped working. Nobody knows how to exit vim."* **(MVP)** |
| `sudo` / `sudo anything` | One result: *"User is not in the sudoers file. This incident will be reported."* After 2 s, a toast from "Security": *"Incident reported."* **(MVP)** |
| `do a barrel roll` | The iframe content rotates 360° once. **(MVP)** |
| `system32` | A result page of 4 "forum posts" that hint at each game without spoiling it. |
| `delete system32` | The desktop fakes a BSOD (§11) for 3 s, then: *"Nice try."* |
| `goggle` | *"Did you mean: recursion?"* and clicking it re-runs the same search. |
| anything else | Redirects to `offline` route: the no-internet runner game. |

- **Offline page** (`pages/offline/index.html`): "No internet" message with a broken-plug drawing and a tiny runner game: a pixel **cursor arrow** jumps (Space/click) over incoming **bug** sprites; score counts up; speed slowly increases. Canvas, ~150 lines max. High score sent to the shell via `GAME_PROGRESS` and shown in the page.

---

## 8. Built-in apps

### 8.1 Notepad
- Window 600×450, menu bar (File, Edit, Format, View: items are visual only, except File → Save which shows a toast "Saved to nowhere."), monospace textarea, status bar with `Ln X, Col Y` and character count.
- Opening `README.txt` loads lore text (editable, edits persist in state). Initial content:

```
SYSTEM32 RECOVERY NOTES
-----------------------
If you are reading this, the system is falling apart.

Four components failed during the last update:
  - popup_guard.sys      (something keeps opening windows)
  - admin_access.dll     (locked out of my own bank account?)
  - theme.dll            (the stylesheets are fighting each other)
  - wm_core.exe          (windows won't stay where I put them)

I left the recovery files on the desktop. They look like junk.
They are not junk.

Don't search for "how to exit vim". I'm serious.

- previous user
```

### 8.2 File Explorer
- Window 900×560. Left nav: Home, Desktop, Documents, This PC, Recycle Bin. Main pane: icon grid. Address breadcrumb at top.
- `This PC` shows a drive `Local Disk (C:)` with a **usage bar that doubles as the System Integrity meter** (0/4 → 4/4 repaired; red → green).
- `C:\Windows\System32` folder exists; opening it shows the 4 component files (`popup_guard.sys`, etc.), each greyed out with a red ✕ until repaired, then normal with a green check. Double-clicking a broken one opens its game.
- `Documents` contains 2–3 joke files (e.g. `taxes_2019_FINAL_final.xlsx`) that open an error dialog "No app can open this file."
- Desktop items open the same way they do on the desktop.

### 8.3 Recycle Bin
- Explorer-style window listing deleted items with "Original location" and "Date deleted" columns.
- Pre-filled with lore: `old_password_hint.txt` (opens Notepad: *"it's in the comments. it's always in the comments."*, a Part 3 hint), `my_will_to_live.zip` (error: "Archive is empty"), `Internet Explorer.lnk` (opens a dialog: *"Internet Explorer has been retired. Respect its wishes."*).
- **Empty Recycle Bin** button: confirmation dialog → items vanish with a crumple animation → after 3 s they reappear: *"Some files could not be deleted because they are emotionally attached."*

---

## 9. Game Protocol (contract for Parts 2–5)

All messages are plain objects sent with `postMessage(msg, '*')`. The shell validates sender identity by checking `event.source === thatIframe.contentWindow` (origins are opaque due to sandboxing, so origin checks don't work).

### 9.1 Game → Shell
```js
{ source: 'system32-game', gameId: 'dom-ination', type: 'GAME_READY' }
{ source: 'system32-game', gameId, type: 'GAME_WON',  payload: { timeMs, score } }
{ source: 'system32-game', gameId, type: 'GAME_LOST', payload: { reason } }
{ source: 'system32-game', gameId, type: 'GAME_PROGRESS', payload: { label, value } } // optional, e.g. wave 2/3
{ source: 'system32-game', gameId, type: 'NAVIGATE', route, query }                   // used by Goggle
{ source: 'system32-game', gameId, type: 'SHELL_EFFECT', effect: 'shake' | 'crash' | 'bsod' | 'toast', text }
```

### 9.2 Shell → Game
```js
{ source: 'system32-shell', type: 'INIT', payload: { bestTimeMs, beaten: bool, soundOn: bool } }  // sent after GAME_READY
{ source: 'system32-shell', type: 'PAUSE' }   // window minimized or lost focus
{ source: 'system32-shell', type: 'RESUME' }
```

### 9.3 Game IDs → components repaired

| gameId | Desktop file | Repairs | Visible effect on the desktop when repaired |
|---|---|---|---|
| `dom-ination` | `free_prizes.html` | `popup_guard.sys` | Random fake ad pop-ups on the desktop stop spawning (§10). |
| `inspect` | `bank_login.html` | `admin_access.dll` | Settings opens (a simple panel: accent color, sound, reset progress). |
| `specificity` | `styles_FINAL_v2.html` | `theme.dll` | Wallpaper and taskbar glitch filters are removed; Personalize works. |
| `wm404` | `recovery_tool.html` | `wm_core.exe` | Windows stop randomly jittering; resize handles enabled. |

### 9.4 Stub games (build these on Day 1)
Each `games/*/index.html` starts as a stub with the game's name, a **"Win"** and **"Lose"** button that send the protocol messages. This lets the whole shell (progress, notifications, corruption, ending) be built and tested before any game exists.

---

## 10. Progression and corruption

### 10.1 State (single object in `state.js`, saved to `localStorage['system32.state']` on every change)
```js
{
  version: 1,
  firstVisit: true,
  repaired: { 'dom-ination': false, inspect: false, specificity: false, wm404: false },
  bestTimes: {},                // gameId -> ms
  unlockedBookmarks: [],        // gameIds opened at least once
  iconPositions: {},            // iconId -> {col,row}
  readmeText: '…',
  soundOn: true,
  offlineHighScore: 0,
  endingSeen: false,
  eggsFound: []                 // easter egg ids, shown in Settings as "Secrets: 5/12"
}
```
Wrap all localStorage access in `try/catch`; if storage is unavailable, run in memory.

### 10.2 Corruption level
`corruption = 1 - (repairedCount / 4)` exposed as CSS custom property `--corruption` on `<html>`. Effects scale with it:
- **Wallpaper:** RGB-split / hue shift filter and occasional horizontal tear lines (CSS animation, every 8–15 s) — removed when `theme.dll` is repaired.
- **Icon labels:** 1 random desktop label occasionally renders scrambled for 300 ms.
- **Fake ad pop-ups:** while `popup_guard.sys` is broken, every 60–120 s a small "You won a FREE GPU!" window spawns on the desktop (closable, harmless). Max 2 at a time. Turn these **off** while any game window is focused, so they never ruin a run.
- **Window jitter:** while `wm_core.exe` is broken, newly opened windows occasionally spawn 20 px off and slide into place.

All effects respect `prefers-reduced-motion` (disable tears/jitter, keep static tints).

### 10.3 On `GAME_WON`
1. Mark repaired, save state.
2. Toast: *"popup_guard.sys restored. System integrity: 25%."* with a green shield.
3. Icon gets the check overlay; Explorer and integrity meter update live.
4. Apply that component's visual repair with a short "scanline sweep" transition across the screen.

### 10.4 Ending (all 4 repaired)
- 3 s after the last toast, a dialog: *"System integrity: 100%. Restart to complete repair?"* [Restart now] [Later]
- Restart → shutdown animation → boot screen → **clean desktop**: no glitches, crisp wallpaper, and a new file `thank_you.txt` (credits + total best times + secrets found). The Start menu power → Shut down now works and shows a final "It's now safe to turn off your computer." screen (click to boot again).
- Settings gets **"Reset progress"** (confirmation dialog) for replays.

---

## 11. Shell easter eggs

Each egg has an id and calls `state.foundEgg(id)` the first time, triggering a small "🥚 Secret found" toast.

| id | Trigger | Effect | Tier |
|---|---|---|---|
| `bin-pc` | Drag `This PC` onto Recycle Bin | Confirmation: *"Delete This PC? It contains you."* → Yes → fake BSOD (§11.1) → reboot to desktop, PC still there. | MVP |
| `bin-game` | Drag a game file onto Recycle Bin | Icon bounces back: *"This file is protected by the will of the previous user."* | MVP |
| `start-spam` | Click Start 10× within 3 s | Start menu opens upside down once. | MVP |
| `shutdown-early` | Power → Shut down before all repairs | Dialog: *"Shutdown blocked: 4 updates pending. Don't turn off your computer."* with a fake update % that goes to 99% and stays there. Closable. | MVP |
| `clock` | Click the clock 7× | Clock briefly shows `13:37` then the date flips to `01-01-1970`. | Stretch |
| `konami` | ↑↑↓↓←→←→BA on the desktop | Every desktop icon starts slowly orbiting the screen center for 10 s. | Stretch |
| `new-folder` | Open `New folder (corrupted)` | Error dialog with a progress bar that fills backwards. | Stretch |
| `notepad-hello` | Type "hello" in Notepad on an empty line | After 1 s, Notepad types back: *"hi. please help."* | Stretch |
| `wifi` | Click Wi-Fi icon 5× | Flyout: "Connected to: Pretty Fly for a Wi-Fi". Still no internet. | Stretch |

### 11.1 Fake BSOD
Full-screen overlay (blue, white text, sad-face-style emoticon `:(`), "Your PC ran into a problem…" percentage counter 0→100% over 3 s, a stop code `CRITICAL_PROCESS_WAS_FUN`, then reboot animation (boot screen, skip lock screen). **Must not** wipe state. Escape skips it.

---

## 12. Sound (optional, off-by-default toggle stored in state)
Short original or CC0 sounds: startup chime, error ding, notification pop, recycle crumple. Max 4 files, each under 50 KB. Respect the tray volume toggle. No sound before the first user interaction (autoplay rules).

---

## 13. Visual tokens (`tokens.css`)

```css
:root {
  --accent: #0067c0;
  --accent-light: #4cc2ff;
  --surface: rgba(243, 243, 243, 0.78);      /* frosted panels */
  --surface-solid: #f3f3f3;
  --window-bg: #ffffff;
  --text: #1b1b1b;
  --text-muted: #5f5f5f;
  --border: rgba(0, 0, 0, 0.08);
  --shadow-active: 0 8px 32px rgba(0,0,0,.28);
  --shadow-inactive: 0 4px 16px rgba(0,0,0,.14);
  --radius: 8px;
  --taskbar-h: 48px;
  --blur: blur(30px) saturate(150%);
  --danger: #c42b1c;
  --success: #0f7b0f;
  --corruption: 1;   /* set by corruption.js */
}
@media (prefers-color-scheme: dark) { /* dark variant: surface rgba(32,32,32,.78), window-bg #202020, text #fff */ }
```
Dark mode follows the OS by default; Settings can force light/dark once unlocked.

---

## 14. Performance and quality rules
- One `requestAnimationFrame` loop is **not** needed in the shell; use CSS animations and event-driven updates. The clock uses a single `setTimeout` aligned to the next second.
- Pause shell effects (ad pop-ups, glitch timers) when `document.hidden`.
- Send `PAUSE` to a game whose window is minimized.
- All interactive elements are real `<button>`s with `aria-label`s; windows have `role="dialog"` and `aria-labelledby` pointing to the title.
- Keyboard: Tab moves between icons, Enter opens, Esc closes menus, **Alt+F4 is captured only when a window is focused** (closes it), Ctrl+Esc opens Start.
- No console errors on load. All JS in strict mode via modules.

---

## 15. Acceptance criteria (Part 1 is done when…)

- [ ] Boot → lock → sign-in → desktop plays in order; skippable; returning users skip the lock animation.
- [ ] 8 desktop icons; select, rubber-band select, drag, snap, positions persist.
- [ ] Taskbar: Start, search, pinned apps, open-window buttons with correct active/minimized states; live clock with calendar flyout.
- [ ] Start menu opens/closes correctly, search filters and searches Goggle, power menu works.
- [ ] Windows open, close, drag (including over iframes without sticking), focus/z-order, minimize, maximize, double-click title to maximize.
- [ ] Edgy: address bar, back/forward/refresh, favorites bar, locked `???` bookmarks, loading bar, multiple instances.
- [ ] Iframes sandboxed without `allow-same-origin`; a stub game cannot modify the shell DOM.
- [ ] Goggle: 3 MVP easter egg queries work; everything else goes to the offline runner, which is playable.
- [ ] Notepad, File Explorer (incl. System32 folder + integrity meter), Recycle Bin all work.
- [ ] Stub games' Win button repairs the right component, updates every UI surface, persists across refresh.
- [ ] Corruption visuals scale with progress and respect `prefers-reduced-motion`.
- [ ] Winning all 4 stubs triggers the restart → clean desktop ending; Reset progress works.
- [ ] All 4 MVP shell easter eggs work and count in Secrets.
- [ ] Below 900px wide, a "desktop required" screen shows instead.
- [ ] Deploys to GitHub Pages with no path issues (all paths relative).

---

## 16. Build order for Claude Code (≈1–1.5 days)

Do these as separate prompts, testing between each:

1. **Skeleton:** file structure, `tokens.css`, wallpaper, taskbar with live clock, static desktop icons. Run on a local server.
2. **Window manager:** `Window` + `WindowManager` with open/close/drag/focus/minimize/maximize, taskbar buttons. Test with a dummy window.
3. **State + events + notifications:** `state.js` with localStorage, pub/sub bus, toast component.
4. **Desktop interactions:** select, rubber-band, icon drag + persistence, context menu.
5. **Browser + routes + stub games + protocol:** Edgy with history and favorites, sandboxed iframe, 4 stub games, `postMessage` handling, repairs.
6. **Goggle + offline runner + crash page.**
7. **Notepad, Explorer, Recycle Bin.**
8. **Start menu + boot/lock/sign-in sequence.**
9. **Corruption effects + ending sequence + Settings panel.**
10. **Easter eggs, sound, reduced-motion, keyboard, 900px guard, deploy.**

Hand each later game spec (Parts 2–5) the **Game Protocol (§9)** and the **sandbox attributes (§7.3)** so every game drops in without touching shell code.
