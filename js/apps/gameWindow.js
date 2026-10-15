// Game window for BONUS games (SpaceSaga ...): a plain Window whose whole content is one sandboxed iframe (no address bar, no favorites).
// Same trust model as Edgy: sandbox without allow-same-origin, the sender is identified by event.source, and the game only talks through postMessage.
// Bonus games do not win: they end runs (RUN_OVER). The shell keeps the best score and sends it back as `best` in INIT.
// A bonus game with an ending (`completes: true`, Strata) sends GAME_COMPLETE once per win; the shell keeps the best time per difficulty (`completed` in INIT).
import { bus } from '../events.js';
import { Window } from '../WindowManager.js';
import { state, recordBonusBest, recordBonusComplete, foundEgg, isBonusUnlocked } from '../state.js';
import { BONUS_BY_ID, EGG_IDS, DIFFICULTIES } from '../registry.js';
import { toast } from '../notifications.js';
import { SANDBOX } from './browser.js';
import { readGameSave, writeGameSave } from '../saves.js';

const open = new Map();            // gameId -> GameWindow
const debug = () => new URLSearchParams(location.search).has('debug');
const warn = (...a) => { if (debug()) console.warn('[game window]', ...a); };
/** A finite, non-negative number clamped to `max`, else null (games are untrusted: never store what they send as-is). */
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);       // numbers only: Number(null) would be 0

class GameWindow {
  constructor(game) {
    this.game = game;
    this.frame = null;
    this.ready = false;
    this.live = null;
    this.win = new Window({
      id: `game-${game.id}`, title: game.title, icon: game.icon, appId: game.id, width: game.width ?? 1280, height: game.height ?? 760,
      center: true, content: () => this.#build(), onClose: () => this.#dispose(), meta: { bonusGame: game.id },
    });
    this.offChange = bus.on('win:change', () => this.#updateLive());
    this.offSound = bus.on('state:change', (keys) => { if (this.ready && keys?.includes('soundOn')) this.post({ type: 'SOUND', payload: { soundOn: state.soundOn } }); });
    this.offFocus = bus.on('win:focus', (w) => { if (w === this.win) this.#focusFrame(); });
    this.onFs = () => this.#fsChanged();
    document.addEventListener('fullscreenchange', this.onFs);
    this.win.open();
  }

  #build() {
    const root = document.createElement('div');
    root.className = 'gw';
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', SANDBOX);            // set before src: the sandbox applies from the first byte
    f.title = this.game.title;
    f.src = this.game.src;
    f.allow = '';
    root.append(f);
    this.frame = f;
    this.root = root;
    // A fullscreen button in the title bar, next to minimize / maximize / close.
    queueMicrotask(() => {
      const controls = this.win.el?.querySelector('.win-controls');
      if (!controls) return;
      const b = document.createElement('button');
      b.className = 'win-btn'; b.dataset.act = 'fullscreen'; b.setAttribute('aria-label', 'Fullscreen'); b.title = 'Fullscreen';
      b.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 4V1h3M6 1h3v3M9 6v3H6M4 9H1V6"/></svg>';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFullscreen(); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      controls.prepend(b);
      this.fsBtn = b;
    });
    // After a drag / click on the title bar the keyboard focus is on <body>: hand it back to the game.
    queueMicrotask(() => this.win.el?.addEventListener('pointerup', () => { if (!this.win.closed && !this.win.minimized) setTimeout(() => this.#focusFrame(), 0); }, true));
    return root;
  }

  #focusFrame() {
    if (this.win.closed || this.win.minimized || !this.frame?.isConnected) return;
    this.frame.focus();
  }

  /** Real browser fullscreen of the game area only: no title bar, no taskbar, no desktop. Esc leaves it (the browser does that itself). */
  async toggleFullscreen() {
    if (!this.root?.isConnected) return;
    try {
      if (document.fullscreenElement === this.root) await document.exitFullscreen();
      else if (!document.fullscreenElement && this.root.requestFullscreen) await this.root.requestFullscreen({ navigationUI: 'hide' });
      else if (document.fullscreenElement) { await document.exitFullscreen(); }
      else throw new Error('unsupported');
    } catch {
      toast({ title: this.game.title, kind: 'info', text: 'Fullscreen is not available here. Try the browser\'s own fullscreen (F11).' });
    }
    this.#focusFrame();
  }

  #fsChanged() {
    const on = document.fullscreenElement === this.root;
    this.fsBtn?.classList.toggle('on', on);
    if (this.ready) this.post({ type: 'FULLSCREEN', payload: { on } });
    setTimeout(() => this.#focusFrame(), 0);
  }

  post(msg) {
    this.frame?.contentWindow?.postMessage({ source: 'system32-shell', ...msg }, '*');
  }

  #initPayload() {
    const { game } = this;
    return { bestTimeMs: null, best: state.bonus.best[game.id] ?? null, beaten: false, soundOn: state.soundOn, highScore: 0, save: game.saves ? readGameSave(game.id) : null, completed: state.bonus.completed[game.id] ?? null };
  }

  /** PAUSE when the window is minimized or loses focus, RESUME when it is shown and active again. */
  #updateLive() {
    if (!this.ready || this.win.closed) return;
    const live = this.win.isActive && !this.win.minimized;
    if (live === this.live) return;
    this.live = live;
    this.post({ type: live ? 'RESUME' : 'PAUSE' });
  }

  /** A message from this window's iframe (identity already verified by event.source). */
  onMessage(msg) {
    const { game } = this;
    if (typeof msg.egg === 'string' && EGG_IDS.has(msg.egg) && msg.egg.startsWith(game.eggPrefix ?? '\0')) foundEgg(msg.egg);   // only this game's own eggs
    switch (msg.type) {
      case 'GAME_READY':
        this.ready = true;
        this.live = null;
        this.post({ type: 'INIT', payload: this.#initPayload() });
        this.#updateLive();
        break;

      case 'RUN_OVER': {
        if (msg.gameId !== game.id) return;                    // a game can only report for itself
        const p = msg.payload ?? {};
        const score = num(p.score, 1e9);
        if (score === null) { warn('RUN_OVER without a valid score ignored'); return; }
        if (recordBonusBest(game.id, score)) {
          toast({ title: game.title, kind: 'ok', emoji: '🏆', text: `${game.title}: new best — ${Math.round(score).toLocaleString('en-US')}` });
        }
        bus.emit('bonus:run', { gameId: game.id, score, distance: num(p.distance, 1e9), pickups: num(p.pickups, 1e6), timeMs: num(p.timeMs, 1e10) });
        break;
      }

      case 'SAVE': {                                           // world saves: only games with `saves: true`, only for themselves, always answered
        if (!game.saves || msg.gameId !== game.id) { warn('SAVE ignored'); return; }
        const r = writeGameSave(game.id, msg.payload?.data, game.saveCap);
        this.post({ type: 'SAVED', payload: r });
        break;
      }

      case 'GAME_COMPLETE': {                                  // a bonus game with an ending (Strata): stores the best time per difficulty
        if (!game.completes || msg.gameId !== game.id) { warn('GAME_COMPLETE ignored'); return; }
        const p = msg.payload ?? {};
        const timeMs = num(p.timeMs, 1e10), deaths = num(p.deaths, 1e6);
        if (timeMs === null || deaths === null || !DIFFICULTIES.includes(p.difficulty)) { warn('GAME_COMPLETE without valid fields ignored'); return; }
        const r = recordBonusComplete(game.id, { timeMs, deaths, difficulty: p.difficulty });
        if (!r) return;
        foundEgg(`${game.eggPrefix}complete`);
        toast({ title: game.title, kind: 'ok', emoji: '🏆', text: game.completeToast ?? `${game.title}: complete.` });
        break;
      }

      case 'FULLSCREEN':           // a game asked (key / button inside it); must come from a click or key press, the browser enforces that
        this.toggleFullscreen();
        break;

      case 'GAME_WON':
      case 'GAME_LOST':
        warn(`${msg.type} ignored: bonus games end runs (RUN_OVER), they never win or lose`);
        break;

      case 'GAME_PROGRESS':          // nowhere to show it in a game window
        break;

      case 'SHELL_EFFECT':
        if (msg.effect === 'shake') this.win.shake();
        else if (msg.effect === 'toast') toast({ title: String(msg.title ?? game.title).slice(0, 40), text: String(msg.text ?? '').slice(0, 200), kind: 'info' });
        break;
    }
  }

  #dispose() {
    open.delete(this.game.id);
    this.offChange?.();
    this.offSound?.();
    this.offFocus?.();
    document.removeEventListener('fullscreenchange', this.onFs);
    if (document.fullscreenElement === this.root) document.exitFullscreen?.().catch(() => {});
    this.frame?.remove();
    this.frame = null;
  }
}

export function openGameWindow(gameId) {
  const game = BONUS_BY_ID[gameId];
  if (!game || !isBonusUnlocked(gameId)) return null;
  const existing = open.get(gameId);
  if (existing && !existing.win.closed) { existing.win.focus(); return existing; }
  const gw = new GameWindow(game);
  open.set(gameId, gw);
  return gw;
}

export function initGameWindows() {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'system32-game') return;
    for (const gw of open.values()) {
      if (gw.frame && gw.frame.contentWindow === e.source) { gw.onMessage(d); return; }
    }
  });
}
