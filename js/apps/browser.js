// Edgy: the fake browser. Owns the sandboxed iframes and the game <-> shell postMessage protocol (§9).
import { bus } from '../events.js';
import { Window } from '../WindowManager.js';
import { state, set, repair, recordTime, recordScore, unlock, foundEgg } from '../state.js';
import { ROUTES, GAMES, GAME_BY_ID, EGG_IDS } from '../registry.js';
import { icon, esc, wait, fmtTime } from '../ui.js';
import { toast } from '../notifications.js';
import { showDialog } from '../dialogs.js';
import { showMenuAt } from '../menu.js';
import { bsod } from '../system.js';

const browsers = new Set();
const SANDBOX = 'allow-scripts allow-forms allow-pointer-lock';   // deliberately NO allow-same-origin, NO allow-popups
const short = (v, n) => String(v ?? '').slice(0, n);

class Browser {
  constructor({ route = 'home', query = '', fresh = false } = {}) {
    this.history = [];
    this.index = -1;
    this.frame = null;
    this.ready = false;
    this.live = null;
    this.crashing = false;

    this.win = new Window({
      title: 'Edgy', icon: 'a-edgy', appId: 'browser', width: 1100, height: 720,
      center: browsers.size === 0, content: () => this.#build(),
      onClose: () => this.#dispose(),
    });
    browsers.add(this);
    this.offChange = bus.on('win:change', () => this.#updateLive());
    this.offState = bus.on('state:change', () => this.#renderFavs());
    this.win.open();
    this.navigate(route, query, { fresh });
  }

  #build() {
    const root = document.createElement('div');
    root.className = 'br';
    root.innerHTML =
      '<div class="br-toolbar">' +
      `<button class="br-nav" data-a="back" aria-label="Back">${icon('arrow-left', 16)}</button>` +
      `<button class="br-nav" data-a="forward" aria-label="Forward">${icon('arrow-right', 16)}</button>` +
      `<button class="br-nav" data-a="reload" aria-label="Refresh">${icon('refresh', 16)}</button>` +
      `<label class="br-address">${icon('lock', 13)}<input readonly spellcheck="false" aria-label="Address bar"></label>` +
      '<span class="br-chip" aria-live="polite"></span>' +
      `<button class="br-nav" data-a="more" aria-label="Settings and more" aria-haspopup="true">${icon('more', 16)}</button>` +
      '</div>' +
      '<div class="br-favs" role="toolbar" aria-label="Favorites"></div>' +
      '<div class="br-view"><div class="br-loading"></div></div>';
    this.root = root;
    this.addr = root.querySelector('input');
    this.favs = root.querySelector('.br-favs');
    this.view = root.querySelector('.br-view');
    this.loading = root.querySelector('.br-loading');
    this.chip = root.querySelector('.br-chip');
    this.backBtn = root.querySelector('[data-a="back"]');
    this.fwdBtn = root.querySelector('[data-a="forward"]');

    this.addr.addEventListener('focus', () => this.addr.select());
    this.addr.addEventListener('click', () => this.addr.select());
    root.querySelector('.br-toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-a]');
      if (!btn) return;
      const a = btn.dataset.a;
      if (a === 'back') this.go(-1);
      else if (a === 'forward') this.go(1);
      else if (a === 'reload') this.reload();
      else if (a === 'more') this.#moreMenu(btn);
    });
    this.favs.addEventListener('click', (e) => {
      const fav = e.target.closest('.br-fav');
      if (!fav || fav.classList.contains('locked')) return;
      this.navigate(fav.dataset.route);
    });
    return root;
  }

  #moreMenu(btn) {
    showMenuAt(btn, [
      { label: 'New window', hint: '', onClick: () => openBrowser({ route: 'home' }) },
      { label: 'Inspect (F12)', onClick: () => showDialog({ title: 'Edgy', kind: 'info', message: 'Right-click the page → Inspect. The real one.', parent: this.win }) },
    ]);
  }

  #renderFavs() {
    if (!this.favs) return;
    const cur = this.history[this.index]?.route;
    const mk = (route, label, locked) =>
      `<button class="br-fav${locked ? ' locked' : ''}${cur === route ? ' current' : ''}" data-route="${route}"` +
      `${locked ? ' aria-disabled="true" title="Not discovered yet"' : ''}>${icon('star', 12)}<span>${esc(locked ? '???' : label)}</span></button>`;
    this.favs.innerHTML = mk('home', 'Goggle', false) +
      GAMES.map((g) => mk(g.id, g.bookmark, !state.unlockedBookmarks.includes(g.id))).join('');
  }

  /** Record a navigation. `load:false` only updates history/address bar (used when the page already shows it). */
  navigate(route, query = '', { push = true, load = true, fresh = false } = {}) {
    const def = ROUTES[route];
    if (!def) return;
    if (def.game) unlock(def.game);
    const entry = { route, query, fresh };
    const top = this.history[this.index];
    if (push && !(top && top.route === route && top.query === query && !load)) {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push(entry);
      this.index = this.history.length - 1;
    } else if (!push) {
      this.history[this.index] = entry;
    }
    if (load) this.#load(this.history[this.index]); else this.#sync();
  }

  go(delta) {
    const i = this.index + delta;
    if (i < 0 || i >= this.history.length) return;
    this.index = i;
    this.history[i].fresh = false;
    this.#load(this.history[i]);
  }

  reload() {
    const e = this.history[this.index];
    if (e) { e.fresh = false; this.#load(e); }
  }

  #load(entry) {
    const def = ROUTES[entry.route];
    this.frame?.remove();
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', SANDBOX);       // set before src so the sandbox applies from the first byte
    f.title = def.title(entry.query);
    f.src = def.src(entry.query, entry.fresh);
    entry.fresh = false;
    this.ready = false;
    this.live = null;
    this.loading.className = 'br-loading';
    void this.loading.offsetWidth;
    this.loading.classList.add('run');
    f.addEventListener('load', () => {
      this.loading.classList.remove('run');
      this.loading.classList.add('done');
    });
    this.view.append(f);
    this.frame = f;
    this.#sync();
  }

  #sync() {
    const e = this.history[this.index];
    if (!e) return;
    const def = ROUTES[e.route];
    this.addr.value = def.url(e.query);
    this.win.setTitle(def.title(e.query));
    this.win.meta.game = def.game ?? null;
    this.chip.textContent = '';
    this.backBtn.disabled = this.index <= 0;
    this.fwdBtn.disabled = this.index >= this.history.length - 1;
    this.#renderFavs();
  }

  post(msg) {
    this.frame?.contentWindow?.postMessage({ source: 'system32-shell', ...msg }, '*');
  }

  #updateLive() {
    if (!this.ready || this.win.closed) return;
    const live = this.win.isActive && !this.win.minimized;
    if (live === this.live) return;
    this.live = live;
    this.post({ type: live ? 'RESUME' : 'PAUSE' });
  }

  /** A message from the iframe currently shown by this browser (identity already verified by event.source). */
  onMessage(msg) {
    const cur = this.history[this.index];
    if (!cur) return;
    const def = ROUTES[cur.route];
    const gameId = def.game;

    // Eggs may be reported by any page (Goggle uses this for its search eggs).
    if (typeof msg.egg === 'string' && EGG_IDS.has(msg.egg)) foundEgg(msg.egg);

    switch (msg.type) {
      case 'GAME_READY':
        this.ready = true;
        this.live = null;
        this.post({
          type: 'INIT',
          payload: {
            bestTimeMs: gameId ? state.bestTimes[gameId] ?? null : null,
            best: gameId ? state.bestScores[gameId] ?? null : null,
            beaten: gameId ? !!state.repaired[gameId] : false,
            soundOn: state.soundOn,
            highScore: state.offlineHighScore,
          },
        });
        this.#updateLive();
        break;

      case 'GAME_WON': {
        if (!gameId || msg.gameId !== gameId) return;       // a game can only win for itself
        const timeMs = Number(msg.payload?.timeMs);
        const newBest = recordTime(gameId, timeMs);
        recordScore(gameId, Number(msg.payload?.score));
        const first = repair(gameId);
        if (!first) {
          toast({
            title: 'Edgy', kind: 'ok',
            text: newBest ? `New best time: ${fmtTime(timeMs)}` : `${GAME_BY_ID[gameId].component} is already repaired.`,
          });
        }
        break;
      }

      case 'GAME_LOST': {
        if (!gameId || msg.gameId !== gameId) return;
        const reason = short(msg.payload?.reason, 80);
        toast({ title: 'Edgy', kind: 'warn', text: `${GAME_BY_ID[gameId].component} is still broken.${reason ? ` (${reason})` : ''}` });
        break;
      }

      case 'GAME_PROGRESS': {
        const label = short(msg.payload?.label, 24);
        const value = short(msg.payload?.value, 12);
        if (cur.route === 'offline' && Number.isFinite(Number(msg.payload?.value)) && /high/i.test(label)) {
          const score = Math.floor(Number(msg.payload.value));
          if (score > state.offlineHighScore) set({ offlineHighScore: score });
        }
        this.chip.textContent = label ? `${label}: ${value}` : '';
        break;
      }

      case 'NAVIGATE': {
        let route = short(msg.route, 24);
        const query = short(msg.query, 200);
        if (route === 'random') {
          const unbeaten = GAMES.filter((g) => !state.repaired[g.id]);
          const pool = unbeaten.length ? unbeaten : GAMES;
          route = pool[Math.floor(Math.random() * pool.length)].id;
        }
        if (!ROUTES[route] || ROUTES[route].hidden) return;
        // Goggle already rendered the results itself: just record history instead of reloading it.
        const onGoggle = cur.route === 'home' || cur.route === 'search';
        const targetsGoggle = route === 'home' || route === 'search';
        this.navigate(route, query, { push: true, load: !(onGoggle && targetsGoggle) });
        break;
      }

      case 'SHELL_EFFECT':
        this.#effect(msg);
        break;
    }
  }

  #effect(msg) {
    switch (msg.effect) {
      case 'shake': this.win.shake(); break;
      case 'toast': toast({ title: short(msg.title, 40) || 'Edgy', text: short(msg.text, 200), kind: 'info' }); break;
      case 'crash': this.#crash(); break;
      case 'bsod':
        bsod({ reboot: false }).then(() => showDialog({ title: 'Edgy', message: 'Nice try.', kind: 'info', parent: this.win }));
        break;
    }
  }

  /** "how to exit vim": vim screen, Not Responding, white-wash, shake, close, dialog. */
  async #crash() {
    if (this.crashing) return;
    this.crashing = true;
    this.navigate('crash', '', { push: false });
    await wait(1900);
    if (this.win.closed) return;
    this.win.setTitle('Edgy (Not Responding)');
    this.win.el.classList.add('not-responding');
    await wait(900);
    if (this.win.closed) return;
    this.win.shake();
    await wait(1000);
    this.win.close();
    showDialog({ title: 'Edgy', kind: 'error', message: 'Edgy has stopped working. Nobody knows how to exit vim.' });
  }

  #dispose() {
    browsers.delete(this);
    this.offChange?.();
    this.offState?.();
    this.frame?.remove();
    this.frame = null;
  }
}

export function openBrowser(opts) {
  return new Browser(opts);
}

export function initBrowser() {
  // The only entry point for game messages. Origins are opaque (sandbox), so identity = event.source.
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'system32-game') return;
    for (const b of browsers) {
      if (b.frame && b.frame.contentWindow === e.source) { b.onMessage(d); return; }
    }
  });
}
