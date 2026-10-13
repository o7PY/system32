// DOM overlay: HUD, loading/title/pause/death screens. No game logic; main.js drives it.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const FLAVOR = ['Restoring SpaceSaga.exe from Recycle Bin…', 'Ignoring 3 warnings…', 'Reticulating splines…', 'Asking popup_guard.sys nicely…', 'Calibrating fun levels…'];
const SCREENS = ['loading', 'title', 'pause', 'blur', 'dead', 'error'];

export const hud = {
  el: { hud: $('hud'), dist: $('dist'), score: $('score'), pick: $('pick'), best: $('best'), combo: $('combo'), flash: $('flash'), fps: $('fps'), bar: $('bar'), flavor: $('flavor') },
  flavorTimer: 0,
  last: {},

  loading(p) { this.el.bar.style.width = `${Math.round(p * 100)}%`; },
  startFlavor() {
    let i = 0;
    this.flavorTimer = setInterval(() => { this.el.flavor.textContent = FLAVOR[++i % FLAVOR.length]; }, 1500);
  },
  stopFlavor() { clearInterval(this.flavorTimer); },

  show(name) {
    for (const s of SCREENS) $(`s-${s}`).hidden = s !== name;
    this.el.hud.hidden = !(name === null || name === 'pause' || name === 'blur' || name === 'dead');
  },
  hideScreens() { this.show(null); },
  screen() { return SCREENS.find((s) => !$(`s-${s}`).hidden) ?? null; },

  setSoundHint(on) { $('title-sound').textContent = on ? 'Sound on · M to mute' : 'Sound is off · turn it on with the speaker in the taskbar'; },
  setTitleBest(best) { $('title-best').textContent = best ? `Best: ${fmt(best)}` : ''; },

  update({ distance, score, pickups, best, combo }) {
    const l = this.last, e = this.el;
    const d = `${fmt(distance)} m`, s = fmt(score), p = String(pickups), b = `BEST ${fmt(best)}`;
    if (l.d !== d) e.dist.textContent = l.d = d;
    if (l.s !== s) e.score.textContent = l.s = s;
    if (l.p !== p) e.pick.textContent = l.p = p;
    if (l.b !== b) e.best.textContent = l.b = b;
    if (l.c !== combo) { e.combo.hidden = !combo; l.c = combo; }
  },
  resetLast() { this.last = {}; },

  flash(text) {
    const f = this.el.flash;
    f.hidden = true; void f.offsetWidth;              // restart the animation
    f.textContent = text;
    f.hidden = false;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { f.hidden = true; }, 1700);
  },

  dead({ distance, pickups, score, best, isBest }) {
    $('d-dist').textContent = `${fmt(distance)} m`;
    $('d-pick').textContent = fmt(pickups);
    $('d-score').textContent = fmt(score);
    $('d-best').textContent = fmt(best);
    $('newbest').hidden = !isBest;
    this.show('dead');
  },

  error(title, text) {
    $('err-title').textContent = title;
    $('err-text').textContent = text;
    this.show('error');
  },

  debug(text) { this.el.fps.hidden = false; this.el.fps.textContent = text; },
  on(id, fn) { $(id).addEventListener('click', fn); },
};
