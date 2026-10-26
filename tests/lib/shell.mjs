// Helpers shared by the browser tests that drive the whole System32 shell (seed a save, sign in, read state back).
import { sleep } from './cdp.mjs';

export const ALL = { 'dom-ination': true, inspect: true, wm404: true };
export const SANDBOX = 'allow-scripts allow-forms allow-pointer-lock';
export const st = (o = {}) => ({ version: 2, firstVisit: false, repaired: ALL, ...o });

export async function toDesktop(page) {
  const t0 = Date.now();
  for (;;) {
    const phase = await page.eval(`document.body.dataset.phase`);
    if (phase === 'desktop') return;
    if (phase === 'signin') break;
    if (Date.now() - t0 > 14000) throw new Error(`stuck in phase ${phase}`);
    await page.key('Shift');
    await sleep(250);
  }
  await page.click('#signin-btn');
  await page.waitFor(`document.body.dataset.phase === 'desktop'`, { what: 'desktop' });
}

/** Seed localStorage (same origin as the shell), load the shell at `url`, sign in. */
export async function boot(page, state, url = '/') {
  await page.goto('/css/tokens.css');
  await page.eval(`localStorage.clear(); ${state ? `localStorage.setItem('system32.state', ${JSON.stringify(JSON.stringify(state))});` : ''} 0`);
  await page.goto(url);
  await toDesktop(page);
}
export const stateOf = (page) => page.eval(`(() => { const a = JSON.parse(localStorage.getItem('system32.state') ?? 'null'), b = JSON.parse(localStorage.getItem('system32.meta') ?? 'null'); return a || b ? { ...a, ...b } : null; })()`);
export const live = (page) => page.eval(`import('/js/state.js').then((m) => JSON.parse(JSON.stringify(m.state)))`);
export const toastTexts = (page) => page.eval(`[...document.querySelectorAll('#toasts .toast-text')].map((e) => e.textContent)`);
