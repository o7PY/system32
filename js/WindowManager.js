// Window class + singleton manager (z-order, focus, cascade, minimize/maximize, drag, resize).
import { bus } from './events.js';
import { state } from './state.js';
import { icon, esc, animate, reducedMotion } from './ui.js';

const layer = () => document.getElementById('windows');
let zTop = 100;
let seq = 0;

const MIN_W = 400;
const MIN_H = 300;
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Viewport rect of the taskbar button that represents this window (animation target). */
function taskbarRect(win) {
  const btn = win.appId && document.querySelector(`#taskbar [data-app="${win.appId}"]`);
  return (btn ?? document.getElementById('tb-center')).getBoundingClientRect();
}

export class Window {
  constructor({
    id, title = 'Window', icon: iconName = 'a-file', appId = null, width = 640, height = 480,
    x, y, center = false, content, resizable = true, minimizable = true, maximizable,
    skipTaskbar = false, onClose, meta = {},
  } = {}) {
    this.id = id ?? `win-${++seq}`;
    this.title = title;
    this.iconName = iconName;
    this.appId = appId;
    this.reqW = width;
    this.reqH = height;
    this.x = x;
    this.y = y;
    this.center = center;
    this.content = content;
    this.resizable = resizable;
    this.minimizable = minimizable;
    this.maximizable = maximizable ?? resizable;
    this.skipTaskbar = skipTaskbar;
    this.onClose = onClose;
    this.meta = meta;
    this.minimized = false;
    this.maximized = false;
    this.closed = false;
    this.modalChild = null;
    this.el = null;
    this.body = null;
  }

  get isActive() { return WM.active === this; }
  get isDialog() { return false; }

  open() {
    const lr = WM.layerRect();
    const el = document.createElement('div');
    el.className = `window${this.isDialog ? ' dialog' : ''}`;
    el.id = this.id;
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', `${this.id}-title`);
    el.style.visibility = 'hidden';

    const controls = [
      this.minimizable && `<button class="win-btn" data-act="min" aria-label="Minimize">${icon('minimize', 10)}</button>`,
      this.maximizable && `<button class="win-btn" data-act="max" aria-label="Maximize">${icon('maximize', 10)}</button>`,
      `<button class="win-btn win-close" data-act="close" aria-label="Close">${icon('close', 10)}</button>`,
    ].filter(Boolean).join('');
    el.innerHTML =
      `<div class="win-titlebar">${icon(this.iconName, 16, 'win-icon')}` +
      `<span class="win-title" id="${this.id}-title">${esc(this.title)}</span>` +
      `<div class="win-controls">${controls}</div></div>` +
      `<div class="win-body"></div>` +
      (this.resizable ? DIRS.map((d) => `<div class="win-resize" data-dir="${d}"></div>`).join('') : '') +
      '<div class="win-dim"></div>';
    this.el = el;
    this.body = el.querySelector('.win-body');
    this.titleEl = el.querySelector('.win-title');
    this.maxBtn = el.querySelector('[data-act="max"]');

    const w = Math.min(this.reqW, lr.width - 8);
    el.style.width = `${w}px`;
    if (this.reqH !== 'auto') el.style.height = `${Math.min(this.reqH, lr.height - 8)}px`;
    layer().append(el);
    this.w = el.offsetWidth;
    this.h = el.offsetHeight;

    if (this.center || this.isDialog) {
      this.x ??= Math.max(0, Math.round((lr.width - this.w) / 2));
      this.y ??= Math.max(0, Math.round((lr.height - this.h) / 2 - 20));
    }
    if (this.x === undefined || this.y === undefined) {
      const p = WM.nextPosition(this.w, this.h);
      this.x = p.x;
      this.y = p.y;
    }
    el.style.left = `${this.x}px`;
    el.style.top = `${this.y}px`;

    this.#wire();
    this.#mountContent();
    WM.register(this);
    el.style.visibility = '';

    // Spawn animation. While wm_core.exe is broken, windows sometimes land 20px off and slide into place.
    const jitter = !this.isDialog && !state.repaired.wm404 && !reducedMotion() && Math.random() < 0.35;
    const off = jitter ? `translate(${Math.random() < 0.5 ? -20 : 20}px, ${Math.random() < 0.5 ? -20 : 20}px) ` : '';
    animate(el, [
      { opacity: 0, transform: `${off}scale(0.95)` },
      { opacity: 1, transform: 'none' },
    ], jitter ? 420 : 150);

    bus.emit('win:open', this);
    this.focus();
    return this;
  }

  #mountContent() {
    const c = typeof this.content === 'function' ? this.content(this) : this.content;
    if (typeof c === 'string') this.body.innerHTML = c;
    else if (c instanceof Node) this.body.append(c);
  }

  #wire() {
    const { el } = this;
    const bar = el.querySelector('.win-titlebar');

    el.addEventListener('pointerdown', () => this.focus(), true);

    el.querySelector('.win-controls').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'min') this.minimize();
      else if (act === 'max') this.toggleMaximize();
      else if (act === 'close') this.close();
    });
    el.querySelector('.win-dim').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.modalChild?.focus();
      this.modalChild?.shake();
    });

    if (this.maximizable) bar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('.win-controls')) this.toggleMaximize();
    });

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.win-controls') || this.maximized) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      document.body.classList.add('dragging');
      const sx = e.clientX, sy = e.clientY, ox = this.x, oy = this.y;
      const move = (ev) => this.moveTo(ox + ev.clientX - sx, oy + ev.clientY - sy);
      const up = () => {
        document.body.classList.remove('dragging');
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });

    for (const handle of el.querySelectorAll('.win-resize')) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || this.maximized) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        document.body.classList.add('dragging');
        const dir = handle.dataset.dir;
        const sx = e.clientX, sy = e.clientY;
        const start = { x: this.x, y: this.y, w: this.w, h: this.h };
        const move = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          let { x, y, w, h } = start;
          if (dir.includes('e')) w = Math.max(MIN_W, start.w + dx);
          if (dir.includes('s')) h = Math.max(MIN_H, start.h + dy);
          if (dir.includes('w')) { w = Math.max(MIN_W, start.w - dx); x = start.x + start.w - w; }
          if (dir.includes('n')) { h = Math.max(MIN_H, start.h - dy); y = start.y + start.h - h; }
          Object.assign(this, { x, y, w, h });
          Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        };
        const up = () => {
          document.body.classList.remove('dragging');
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }
  }

  /** Move, keeping at least 40px of the title bar on screen. */
  moveTo(x, y) {
    const lr = WM.layerRect();
    this.x = Math.min(Math.max(x, 40 - this.w), lr.width - 40);
    this.y = Math.min(Math.max(y, 0), lr.height - 32);
    this.el.style.left = `${this.x}px`;
    this.el.style.top = `${this.y}px`;
  }

  focus() {
    if (this.closed) return this;
    if (this.modalChild) { this.modalChild.focus(); return this; }
    if (this.minimized) return this.restore();
    WM.setActive(this);
    return this;
  }

  setTitle(str) {
    this.title = str;
    if (this.titleEl) this.titleEl.textContent = str;
    bus.emit('win:change', this);
  }

  minimize() {
    if (this.closed || this.minimized || !this.minimizable) return;
    this.minimized = true;
    const r = this.el.getBoundingClientRect();
    const t = taskbarRect(this);
    const dx = t.left + t.width / 2 - (r.left + r.width / 2);
    const dy = t.top + t.height / 2 - (r.top + r.height / 2);
    animate(this.el, [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0 },
    ], 200, 'ease-in').then(() => { if (this.minimized) this.el.style.display = 'none'; });
    if (reducedMotion()) this.el.style.display = 'none';
    if (this.modalChild) {          // dialogs follow their parent into the taskbar
      this.modalChild.minimized = true;
      this.modalChild.el.style.display = 'none';
    }
    if (WM.active === this || this.modalChild?.isActive) WM.activateTop(this);
    bus.emit('win:minimize', this);
    bus.emit('win:change', this);
  }

  restore() {
    if (this.closed) return this;
    if (this.minimized) {
      this.minimized = false;
      this.el.style.display = '';
      const r = this.el.getBoundingClientRect();
      const t = taskbarRect(this);
      const dx = t.left + t.width / 2 - (r.left + r.width / 2);
      const dy = t.top + t.height / 2 - (r.top + r.height / 2);
      animate(this.el, [
        { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], 200);
      if (this.modalChild) { this.modalChild.minimized = false; this.modalChild.el.style.display = ''; }
      bus.emit('win:restore', this);
    }
    WM.setActive(this.modalChild ?? this);
    return this;
  }

  toggleMaximize() {
    if (!this.maximizable || this.closed) return;
    const { el } = this;
    el.classList.add('animating');
    if (!this.maximized) {
      this.restoreRect = { x: this.x, y: this.y, w: this.w, h: this.h };
      this.maximized = true;
      el.classList.add('maximized');
    } else {
      this.maximized = false;
      el.classList.remove('maximized');
      const b = this.restoreRect;
      Object.assign(this, { x: b.x, y: b.y, w: b.w, h: b.h });
      Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    }
    setTimeout(() => el.classList.remove('animating'), 220);
    this.maxBtn.innerHTML = icon(this.maximized ? 'restore' : 'maximize', 10);
    this.maxBtn.setAttribute('aria-label', this.maximized ? 'Restore' : 'Maximize');
    bus.emit('win:change', this);
  }

  shake() {
    animate(this.el, [
      { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' },
      { transform: 'translateX(-7px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' },
    ], 380, 'linear');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.modalChild?.close();
    const wasActive = WM.active === this;
    WM.unregister(this);
    animate(this.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], 120, 'ease-in')
      .then(() => this.el.remove());
    if (reducedMotion()) this.el.remove();
    this.el.style.pointerEvents = 'none';
    try { this.onClose?.(this); } catch (err) { console.error(err); }
    bus.emit('win:close', this);
    if (wasActive) WM.activateTop();
    bus.emit('win:change', this);
  }
}

export const WM = {
  windows: [],
  active: null,
  lastPos: null,

  layerRect() {
    const r = layer().getBoundingClientRect();
    return { width: r.width, height: r.height };
  },

  get(id) { return this.windows.find((w) => w.id === id); },
  byApp(appId) { return this.windows.filter((w) => w.appId === appId && !w.skipTaskbar); },

  register(win) { this.windows.push(win); },
  unregister(win) { this.windows = this.windows.filter((w) => w !== win); },

  setActive(win) {
    if (win && (win.closed || win.minimized)) return;
    const prev = this.active;
    if (prev && prev !== win) prev.el.classList.remove('active');
    this.active = win;
    if (win) {
      if (Number(win.el.style.zIndex) !== zTop) win.el.style.zIndex = ++zTop;
      win.el.classList.add('active');
    }
    if (prev !== win) bus.emit('win:focus', win);
    bus.emit('win:change', win);
  },

  /** Focus the top-most window that is still visible (optionally ignoring one). */
  activateTop(except = null) {
    const candidates = this.windows
      .filter((w) => w !== except && !w.minimized && !w.closed)
      .sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
    if (candidates[0]) candidates[0].focus();
    else this.blurAll();
  },

  blurAll() {
    if (!this.active) return;
    this.active.el.classList.remove('active');
    this.active = null;
    bus.emit('win:focus', null);
    bus.emit('win:change', null);
  },

  /** +30px cascade from the previous window; wraps to the top-left when it would run off-screen. */
  nextPosition(w, h) {
    const lr = this.layerRect();
    let p = this.lastPos ? { x: this.lastPos.x + 30, y: this.lastPos.y + 30 } : { x: 60, y: 40 };
    if (p.x + w > lr.width || p.y + h > lr.height) p = { x: 30, y: 30 };
    p.x = Math.max(0, Math.min(p.x, lr.width - w));
    p.y = Math.max(0, Math.min(p.y, lr.height - h));
    this.lastPos = p;
    return p;
  },

  minimizeAll() {
    const hidden = this.windows.filter((w) => !w.minimized && w.minimizable && !w.isDialog);
    hidden.forEach((w) => w.minimize());
    return hidden;
  },

  closeAll() {
    [...this.windows].forEach((w) => w.close());
  },

  init() {
    // Clicks inside an iframe never reach the shell: detect them via window blur + activeElement.
    window.addEventListener('blur', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (ae?.tagName !== 'IFRAME') return;
        this.windows.find((w) => w.el.contains(ae))?.focus();
      }, 0);
    });
    // Alt+F4 only closes the focused window (never the real tab).
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'F4' && this.active) {
        e.preventDefault();
        this.active.close();
      }
    });
  },
};
