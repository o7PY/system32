// Small DOM helpers shared by everything.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Inline <svg> referencing the sprite. Glyphs use currentColor; `a-*` symbols are full-colour art. */
export const icon = (name, size = 16, cls = '') =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="assets/icons.svg#${name}"/></svg>`;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (min, max) => min + Math.random() * (max - min);
export const pad2 = (n) => String(n).padStart(2, '0');
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run a Web Animation and resolve when finished (resolves immediately under reduced motion). */
export function animate(el, frames, ms = 150, easing = 'ease-out') {
  if (reducedMotion() || !el.animate) return Promise.resolve();
  return el.animate(frames, { duration: ms, easing, fill: 'none' }).finished.catch(() => {});
}

/** Integrity meter colour: red at 0% -> green at 100%. */
export const meterColor = (pct) => `hsl(${Math.round(pct * 1.2)}, 68%, 40%)`;

/** 83123 -> "01:23.1" */
export function fmtTime(ms) {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = (total % 60000) / 1000;
  return `${pad2(m)}:${s.toFixed(1).padStart(4, '0')}`;
}
