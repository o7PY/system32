// Minimal headless-Chrome driver over the DevTools protocol (no dependencies; Node 22+ has a global WebSocket and fetch).
// Used by the browser tests (tests/bonus-shell, tests/space-saga ...). Starts serve.py and Chrome on free ports, with a scratch profile OUTSIDE the repo.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}

async function waitHttp(url, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await sleep(100);
  }
}

export class Browser {
  static async launch({ width = 1400, height = 900, chrome = process.env.CHROME ?? '/usr/bin/google-chrome', extraArgs = [] } = {}) {
    const b = new Browser();
    b.httpPort = await freePort();
    b.debugPort = await freePort();
    b.profile = mkdtempSync(join(tmpdir(), 'system32-test-'));
    b.server = spawn('python3', ['serve.py', String(b.httpPort)], { cwd: ROOT, stdio: 'ignore' });
    b.chrome = spawn(chrome, [
      '--headless=new', `--remote-debugging-port=${b.debugPort}`, `--user-data-dir=${b.profile}`, `--window-size=${width},${height}`,
      '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extraArgs, 'about:blank',
    ], { stdio: 'ignore' });
    await waitHttp(`http://127.0.0.1:${b.httpPort}/index.html`);
    await waitHttp(`http://127.0.0.1:${b.debugPort}/json/version`);
    b.base = `http://127.0.0.1:${b.httpPort}`;
    b.width = width; b.height = height;
    return b;
  }

  /** A fresh tab with its own protocol session. */
  async page() {
    const r = await fetch(`http://127.0.0.1:${this.debugPort}/json/new?about:blank`, { method: 'PUT' });
    const info = await r.json();
    const p = new Page(info.webSocketDebuggerUrl, this);
    p.targetId = info.id;
    await p.ready;
    await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Log.enable');
    await p.send('Page.bringToFront');                                                // a background tab produces no frames: Web Animations would never finish
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });           // headless pages otherwise report document.hasFocus() === false
    await p.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await p.send('Emulation.setDeviceMetricsOverride', { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false });
    return p;
  }

  async close() {
    try { this.chrome.kill('SIGKILL'); } catch { /* gone */ }
    try { this.server.kill('SIGKILL'); } catch { /* gone */ }
    await sleep(200);
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export class Page {
  constructor(wsUrl, browser) {
    this.browser = browser;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.contexts = new Map();           // executionContextId -> description (same-process frames)
    this.children = new Map();           // sessionId -> targetInfo of an out-of-process iframe (sandboxed frames without allow-same-origin get their own process)
    this.errors = [];                    // console.error / exceptions seen
    this.logs = [];
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((res, rej) => { this.ws.addEventListener('open', res); this.ws.addEventListener('error', rej); });
    this.ws.addEventListener('message', (m) => this.#onMessage(JSON.parse(m.data)));
    this.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => { if (targetInfo.type === 'iframe') { this.children.set(sessionId, targetInfo); this.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {}); this.send('Runtime.enable', {}, sessionId).catch(() => {}); } });
    this.on('Target.detachedFromTarget', ({ sessionId }) => this.children.delete(sessionId));
    this.on('Target.targetInfoChanged', ({ targetInfo }) => { for (const [sid, t] of this.children) if (t.targetId === targetInfo.targetId) this.children.set(sid, targetInfo); });
    this.on('Runtime.executionContextCreated', ({ context }) => this.contexts.set(context.id, context));
    this.on('Runtime.executionContextDestroyed', ({ executionContextId }) => this.contexts.delete(executionContextId));
    this.on('Runtime.executionContextsCleared', () => this.contexts.clear());
    this.on('Runtime.exceptionThrown', (e) => this.errors.push(`exception: ${e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text}`));
    this.on('Runtime.consoleAPICalled', (e) => {
      const txt = e.args.map((a) => a.value ?? a.description ?? '').join(' ');
      this.logs.push(`${e.type}: ${txt}`);
      if (e.type === 'error') this.errors.push(`console.error: ${txt}`);
    });
    this.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') this.errors.push(`log.error: ${entry.text} ${entry.url ?? ''}`); });
  }

  #onMessage(msg) {
    if (msg.sessionId && !msg.id && msg.method) {            // an event of a child session (iframe process): keep only what the tests need
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(`frame exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const txt = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        this.logs.push(`frame ${msg.params.type}: ${txt}`);
        if (msg.params.type === 'error') this.errors.push(`frame console.error: ${txt}`);
      }
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)); else res(msg.result);
    } else if (msg.method) {
      for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
    }
  }

  on(method, fn) { (this.handlers.get(method) ?? this.handlers.set(method, []).get(method)).push(fn); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  async goto(path) {
    const loaded = new Promise((res) => { const h = () => res(); this.on('Page.loadEventFired', h); });
    await this.send('Page.navigate', { url: path.startsWith('http') ? path : `${this.browser.base}${path}` });
    await loaded;
  }

  /** Evaluate in the page (top document). Returns the JSON value; throws on exceptions. */
  async eval(expression, { contextId, sessionId, awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, contextId, userGesture: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expression.slice(0, 200)}`);
    return r.result.value;
  }

  async waitFor(expression, { timeout = 10000, every = 50, what = expression, contextId } = {}) {
    const t0 = Date.now();
    let last;
    for (;;) {
      try { last = await this.eval(expression, { contextId }); if (last) return last; } catch (e) { last = e.message; }
      if (Date.now() - t0 > timeout) throw new Error(`timeout (${timeout} ms) waiting for: ${what}  (last: ${JSON.stringify(last)})`);
      await sleep(every);
    }
  }

  /** How to reach the (sandboxed) iframe whose URL contains `urlPart`: its own session if it lives in another process, else its execution context. */
  async frameTarget(urlPart) {
    const kids = [...this.children.entries()].filter(([, t]) => t.url.includes(urlPart));
    if (kids.length) return { sessionId: kids[kids.length - 1][0] };
    const { frameTree } = await this.send('Page.getFrameTree');
    const walk = (t) => [t.frame, ...(t.childFrames ?? []).flatMap(walk)];
    const frame = walk(frameTree).find((f) => f.url.includes(urlPart));
    if (!frame) return null;
    for (const c of this.contexts.values()) if (c.auxData?.frameId === frame.id && c.auxData?.isDefault) return { contextId: c.id };
    return null;
  }
  async evalInFrame(urlPart, expression) {
    const t = await this.frameTarget(urlPart);
    if (!t) throw new Error(`no target for a frame matching ${urlPart}`);
    return this.eval(expression, t);
  }
  async waitForFrame(urlPart, expression, { timeout = 10000 } = {}) {
    const t0 = Date.now();
    let last = null;
    for (;;) {
      const t = await this.frameTarget(urlPart);
      if (t) { try { const v = await this.eval(expression, t); if (v) return v; last = v; } catch (e) { last = e.message; } }
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting in frame ${urlPart}: ${expression} (last: ${JSON.stringify(last)}, target: ${JSON.stringify(t)})`);
      await sleep(50);
    }
  }

  async rect(selector) {
    return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  }
  async mouse(type, x, y, extra = {}) { await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }); }
  async click(selector, { button = 'left', count = 1 } = {}) {
    await this.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, { what: `click target ${selector}` });
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', inline: 'center' })`);
    const r = await this.rect(selector);
    await this.mouse('mouseMoved', r.x, r.y);
    await sleep(60);                                          // a press with no preceding hover is routed badly to out-of-process (sandboxed) iframes
    for (let i = 1; i <= count; i++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button, clickCount: i });
      await sleep(40);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button, clickCount: i });
      if (i < count) await sleep(40);
    }
  }
  async key(key, { code = key, text, modifiers = 0 } = {}) {
    const t = text ?? (key.length === 1 ? key : undefined);
    const keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 })[key];
    await this.send('Input.dispatchKeyEvent', { type: t ? 'keyDown' : 'rawKeyDown', key, code, text: t, windowsVirtualKeyCode: keyCode, modifiers });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }
  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(path, Buffer.from(data, 'base64'));
  }
  async close() {
    try { this.ws.close(); } catch { /* */ }
    try { await fetch(`http://127.0.0.1:${this.browser.debugPort}/json/close/${this.targetId}`); } catch { /* */ }       // a finished tab must not keep running its timers or hold focus
  }
}

/** Tiny test runner: node file.mjs [name filter]. */
export function suite(title, launchOpts = {}) {
  const tests = [];
  const api = {
    test: (name, fn) => tests.push({ name, fn }),
    async run() {
      const filter = process.argv[2];
      let fail = 0, ran = 0;
      const browser = await Browser.launch(launchOpts);
      try {
        for (const t of tests) {
          if (filter && !t.name.includes(filter)) continue;
          ran++;
          const page = await browser.page();
          const t0 = Date.now();
          try {
            await t.fn(page, browser);
            const bad = page.errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 404 \(File not found\)/i.test(e));
            if (bad.length) throw new Error(`console errors: ${bad.slice(0, 3).join(' | ')}`);
            console.log(`PASS  ${t.name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
          } catch (e) {
            fail++;
            console.log(`FAIL  ${t.name}\n      ${String(e.stack ?? e).split('\n').slice(0, 6).join('\n      ')}`);
            try { await page.screenshot(join(tmpdir(), `system32-fail-${ran}.png`)); console.log(`      screenshot: ${join(tmpdir(), `system32-fail-${ran}.png`)}`); } catch { /* */ }
          }
          await page.close();
        }
      } finally { await browser.close(); }
      console.log(`\n${title}: ${ran - fail}/${ran} passed`);
      process.exit(fail ? 1 : 0);
    },
  };
  return api;
}
