/* DOM-ination: close the pop-ups before they multiply. Classic script (no modules), no storage, no modals. */
(function () {
  'use strict';

  /* ---------------- tuning: every number lives here ---------------- */
  const CONFIG = {
    durationMs: 60000,
    clutterCap: 24,
    lifeMs: 5000,            // a pop-up left open this long duplicates
    warnMs: 3500,            // ...and flashes red from here
    baitSpawn: 2,
    bossClicks: 5,
    bossClutterWeight: 3,
    bossAtMs: 50000,
    runawayRadius: 70,
    runawayHops: 3,
    hopMs: 150,
    claimChance: 0.3,        // chance a pop-up carries a CLAIM bait button (wave 2+)
    bannerMs: 1500,
    // Tuned by simulated playtests (see README): casual ~25% / average ~58% / skilled ~100% per attempt.
    waves: [
      { at: 0, interval: 2100, banner: 'WAVE 1: Free stuff incoming!', types: { classic: 70, drifter: 30 } },
      { at: 20000, interval: 1700, banner: 'WAVE 2: They know where the ✕ is.', types: { classic: 35, drifter: 25, fakex: 25, runaway: 15 } },
      { at: 40000, interval: 1400, banner: 'WAVE 3: ACT NOW!!!', types: { classic: 20, drifter: 25, fakex: 25, runaway: 15, chain: 15 } },
    ],
  };

  const AD_COPY = [
    { t: 'Hot singletons in your area want to meet you!', art: 'table' },
    { t: 'DOWNLOAD MORE RAM — 100% legit' },
    { t: 'Your PC has (3) viruses. Click to add more.' },
    { t: 'Doctors HATE this one weird semicolon' },
    { t: 'You won a FREE GPU! (shipping: $4,999)' },
    { t: "Congratulations, you're our 1,000,001st visitor too!" },
    { t: 'Local div discovers it can float. Developers furious.' },
    { t: 'Click here to unsubscribe from pop-ups*', note: '*(subscribes you to more)' },
    { t: '!important: this ad is more important than you' },
    { t: 'Is your z-index too low? Try ours.' },
    { t: 'Learn React in 3 minutes (the 4th minute is forever)' },
    { t: 'Your free trial of existence has expired' },
    { t: 'Nigerian prince needs help with CSS centering' },
    { t: 'Hot fixes in your area' },
    { t: 'Your cookies are delicious. Accept all?' },
  ];
  const TITLES = ['CONGRATULATIONS!!!', 'WARNING!', 'Special Offer', 'You have 1 new message', 'FREE!!!', 'ALERT', "Don't miss out"];
  const BOSS_LINES = ['System Update — do not close', 'Please stop.', 'I said DO NOT close.', 'ow.', '…'];

  /* ---------------- test hooks + determinism ---------------- */
  const qs = new URLSearchParams(location.search);
  const SPEED = Math.max(0.1, Number(qs.get('speed')) || 1);
  const DEBUG = qs.get('debug') === '1';
  const SEED = qs.has('seed') ? Number(qs.get('seed')) >>> 0 : (Math.random() * 4294967296) >>> 0;
  const mulberry32 = (a) => () => {
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = mulberry32(SEED);

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STEP = 1000 / 60;                       // fixed simulation step (game ms)

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pad2 = (n) => String(n).padStart(2, '0');
  const field = $('field');

  /* ---------------- state ---------------- */
  let phase = 'start';                          // start | play | won | lost
  let paused = false, soundOn = false, beaten = false;
  let raf = 0, last = 0, acc = 0;
  let t = 0, elapsed = 0;                       // t: cosmetic clock, elapsed: play clock (both game ms, pause-exact)
  let popups, closing, timers, nextId, zTop, adBag, lastSpawn, pointer;
  let wave, spawnAcc, blockedUntil, bossDone, closed, baits, peak, firstClose, reported, gullible;
  let ac = null, autoSpawn = true;              // autoSpawn is only ever switched off by the debug hook

  function resetRun() {
    cancelAnimationFrame(raf);
    popups = new Map(); closing = []; timers = []; nextId = 1; zTop = 10; adBag = []; lastSpawn = null; pointer = null;
    wave = -1; spawnAcc = 0; blockedUntil = 0; bossDone = false; closed = 0; baits = 0; peak = 0;
    firstClose = null; reported = false; gullible = false;
    t = 0; elapsed = 0; acc = 0;
    field.textContent = '';
    $('banner').classList.remove('show');
  }
  resetRun();

  /* ---------------- sound (WebAudio blips, only if the shell says soundOn) ---------------- */
  function tone(f1, f2, at, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(name) {
    if (!soundOn || !ac) return;
    try {
      if (name === 'close') tone(880, 1320, 0, 0.07, 'sine', 0.1);
      else if (name === 'bait') tone(140, 90, 0, 0.3, 'sawtooth', 0.12);
      else if (name === 'dup') tone(220, 90, 0, 0.18, 'sine', 0.14);
      else if (name === 'win') [523, 659, 784].forEach((f, i) => tone(f, f, i * 0.13, 0.2, 'triangle', 0.12));
    } catch (e) { /* audio is never essential */ }
  }

  /* ---------------- helpers ---------------- */
  const bounds = () => ({ w: field.clientWidth, h: field.clientHeight });
  const waveIdx = () => CONFIG.waves.reduce((i, w, k) => (elapsed >= w.at ? k : i), 0);
  const later = (ms, fn) => timers.push({ at: t + ms, fn });
  const egg = (id) => System32.effect('egg', { egg: id });
  const accuracy = () => (closed + baits ? Math.round((100 * closed) / (closed + baits)) : 100);

  function clutter() {
    let c = 0;
    popups.forEach((p) => { if (!p.noClutter) c += p.weight; });
    return c;
  }

  function nextAd() {
    if (!adBag.length) {                       // shuffle bag: no repeats until exhausted
      adBag = AD_COPY.slice();
      for (let i = adBag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [adBag[i], adBag[j]] = [adBag[j], adBag[i]]; }
    }
    return adBag.pop();
  }

  function pickType(types) {
    let r = rnd() * Object.values(types).reduce((a, b) => a + b, 0);
    for (const k in types) { r -= types[k]; if (r < 0) return k; }
    return 'classic';
  }

  /* ---------------- pop-ups ---------------- */
  function move(p, x, y) {
    const b = bounds();
    p.x = clamp(x, 0, Math.max(0, b.w - p.w));
    p.y = clamp(y, 0, Math.max(0, b.h - p.h));
    p.el.style.setProperty('--x', p.x.toFixed(1));
    p.el.style.setProperty('--y', p.y.toFixed(1));
  }

  function spawnPos(w, h) {
    const b = bounds();
    let x = 0, y = 0;
    for (let i = 0; i < 8; i++) {              // keep >= 80px from the previous spawn
      x = rnd() * Math.max(0, b.w - w); y = rnd() * Math.max(0, b.h - h);
      if (!lastSpawn || Math.hypot(x - lastSpawn.x, y - lastSpawn.y) >= 80) break;
    }
    lastSpawn = { x, y };
    return lastSpawn;
  }

  function build(type, o) {
    const src = o.from;
    const p = { id: nextId++, type, x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0, age: 0, hops: 0, cool: 0, hop: null, tired: false, clicks: 0, weight: 1, noClutter: false, static: false };
    if (type === 'boss') {
      p.el = $('tpl-boss').content.firstElementChild.cloneNode(true);
      Object.assign(p, { weight: CONFIG.bossClutterWeight, static: true, born: elapsed, corner: 0 });
      p.el.dataset.corner = '0';
      p.text = p.el.querySelector('.pop-text');
      return p;
    }
    p.el = $('tpl-pop').content.firstElementChild.cloneNode(true);
    const el = p.el, say = (s, v) => { el.querySelector(s).textContent = v; };
    el.classList.add(`t-${type}`);
    el.style.setProperty('--h', Math.floor(rnd() * 360));
    el.style.width = `${o.w || Math.round(220 + rnd() * 100)}px`;
    p.bar = el.querySelector('.pop-timer i');
    if (type === 'achv') {
      Object.assign(p, { noClutter: true, static: true });
      say('.pop-title', 'Achievement'); say('.pop-text', 'Achievement unlocked: Gullible.');
      return p;
    }
    if (type === 'child') {
      say('.pop-title', 'Wait!'); say('.pop-text', 'Are you sure?');
      return p;
    }
    p.ad = src ? src.ad : nextAd();
    p.claim = src ? src.claim : waveIdx() >= 1 && rnd() < CONFIG.claimChance;
    say('.pop-title', src ? src.title : pick(TITLES));
    p.title = el.querySelector('.pop-title').textContent;
    say('.pop-text', p.ad.t);
    const extra = el.querySelector('.pop-extra');
    if (p.ad.art === 'table') el.querySelector('.pop-art').innerHTML = '<table class="one"><tr><td></td></tr></table>';
    if (p.ad.note) { const n = document.createElement('small'); n.className = 'pop-note'; n.textContent = p.ad.note; el.querySelector('.pop-text').after(n); }
    if (type === 'fakex') {                    // big ✕ is the bait; the real close is the tiny link
      el.querySelector('.pop-x').dataset.action = 'bait';
      const link = document.createElement('button');
      link.type = 'button'; link.className = 'pop-nothanks'; link.dataset.action = 'close'; link.textContent = 'No thanks, I hate free stuff';
      extra.append(link);
    }
    if (p.claim) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pop-claim'; b.dataset.action = 'bait'; b.textContent = 'CLAIM';
      extra.prepend(b);
    }
    return p;
  }

  function add(type, o = {}) {
    const p = build(type, o);
    p.el.dataset.id = p.id;
    p.el.style.zIndex = ++zTop;
    field.append(p.el);
    p.w = p.el.offsetWidth; p.h = p.el.offsetHeight;
    const at = o.at || spawnPos(p.w, p.h);
    move(p, at.x, at.y);
    if (type === 'drifter') {
      const a = rnd() * Math.PI * 2, s = (40 + rnd() * 30) * (REDUCED ? 0.5 : 1);
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
    }
    popups.set(p.id, p);
    return p;
  }

  function retire(p, delay = 0) {              // leaves the game now; the node animates out (120ms) and is removed
    popups.delete(p.id);
    p.el.style.pointerEvents = 'none';
    closing.push({ el: p.el, start: t + delay, end: t + delay + 120, on: false });
  }

  function tickPopup(p, dt) {
    if (p.type === 'drifter') {
      const b = bounds();
      let x = p.x + (p.vx * dt) / 1000, y = p.y + (p.vy * dt) / 1000;
      if (x < 0 || x > b.w - p.w) { p.vx = -p.vx; x = clamp(x, 0, b.w - p.w); }
      if (y < 0 || y > b.h - p.h) { p.vy = -p.vy; y = clamp(y, 0, b.h - p.h); }
      move(p, x, y);
    }
    if (p.type === 'runaway' && !p.tired) tickRunaway(p, dt);
    if (p.static) return;
    p.age += dt;
    if (p.age >= CONFIG.warnMs) {
      p.el.classList.add('warn');
      p.bar.style.transform = `scaleX(${clamp(1 - (p.age - CONFIG.warnMs) / (CONFIG.lifeMs - CONFIG.warnMs), 0, 1)})`;
    }
    if (p.age >= CONFIG.lifeMs) {              // duplicate: copy offset +24/+24, own timer restarts
      p.age = 0;
      p.el.classList.remove('warn');
      add(p.type, { from: p, at: { x: p.x + 24, y: p.y + 24 }, w: p.w });
      sfx('dup');
    }
  }

  function tickRunaway(p, dt) {
    p.cool = Math.max(0, p.cool - dt);
    if (p.hop) {
      p.hop.t += dt;
      const k = Math.min(1, p.hop.t / CONFIG.hopMs), e = 1 - (1 - k) * (1 - k);
      move(p, p.hop.fx + (p.hop.tx - p.hop.fx) * e, p.hop.fy + (p.hop.ty - p.hop.fy) * e);
      if (k >= 1) {
        p.hop = null; p.cool = 250;
        if (p.hops >= CONFIG.runawayHops) { p.tired = true; p.el.querySelector('.pop-title').textContent = 'fine.'; }
      }
      return;
    }
    if (!pointer || p.cool > 0) return;
    const dx = Math.max(p.x - pointer.x, 0, pointer.x - (p.x + p.w)), dy = Math.max(p.y - pointer.y, 0, pointer.y - (p.y + p.h));
    if (Math.hypot(dx, dy) >= CONFIG.runawayRadius) return;
    const b = bounds();
    let tx = p.x, ty = p.y;
    for (let i = 0; i < 10; i++) {              // hop somewhere at least 150px from the cursor
      tx = rnd() * Math.max(0, b.w - p.w); ty = rnd() * Math.max(0, b.h - p.h);
      if (Math.hypot(tx + p.w / 2 - pointer.x, ty + p.h / 2 - pointer.y) > 150) break;
    }
    p.hops++;
    p.hop = { fx: p.x, fy: p.y, tx, ty, t: 0 };
  }

  /* ---------------- player actions ---------------- */
  function act(p, action) {
    if (action === 'bait') return bait(p);
    if (action === 'boss') return hitBoss(p);
    if (p.type === 'achv') return retire(p);   // free pop-up: no stats
    closed++;
    if (firstClose === null) firstClose = elapsed;
    sfx('close');
    retire(p);
    if (p.type === 'chain') {                  // "Are you sure?" x2, half size, no further chaining
      for (let i = 0; i < 2; i++) add('child', { at: { x: p.x + i * (p.w / 2 + 6), y: p.y + i * 12 }, w: Math.round(p.w / 2) });
    }
  }

  function bait(p) {
    baits++;
    sfx('bait');
    p.el.classList.remove('nope'); void p.el.offsetWidth; p.el.classList.add('nope');
    const types = CONFIG.waves[Math.max(0, wave)].types;
    for (let i = 0; i < CONFIG.baitSpawn; i++) add(pickType(types));
    if (baits === 5 && !gullible) { gullible = true; add('achv'); egg('dom-claim-all'); }
    checkEnd();
  }

  function hitBoss(p) {
    p.clicks++;
    sfx('close');
    if (p.clicks < CONFIG.bossClicks) {
      let c; do { c = Math.floor(rnd() * 4); } while (c === p.corner);   // its ✕ jumps to another corner
      p.corner = c; p.el.dataset.corner = String(c);
      p.text.textContent = BOSS_LINES[Math.min(p.clicks, BOSS_LINES.length - 1)];
      return;
    }
    closed++;
    if (firstClose === null) firstClose = elapsed;
    if (elapsed - p.born <= 2000) {            // closed within 2s of appearing: its last words
      p.text.textContent = 'rude.';
      retire(p, 700);
      egg('dom-rude');
    } else retire(p);
  }

  field.addEventListener('pointerdown', (e) => {
    if (phase !== 'play' || paused) return;
    const el = e.target.closest('.pop');
    const p = el && popups.get(Number(el.dataset.id));
    if (!p) return;
    p.el.style.zIndex = ++zTop;                // clicking anywhere on a pop-up raises it
    const a = e.target.closest('[data-action]');
    if (a) { act(p, a.dataset.action); checkEnd(); }
  });
  field.addEventListener('click', (e) => {     // keyboard activation (Enter/Space) fires click with no pointerdown
    const a = e.target.closest('[data-action]');
    if (!a || e.detail !== 0 || phase !== 'play' || paused) return;
    const p = popups.get(Number(a.closest('.pop').dataset.id));
    if (p) { act(p, a.dataset.action); checkEnd(); }
  });
  field.addEventListener('pointermove', (e) => {
    const r = field.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  field.addEventListener('pointerleave', () => { pointer = null; });

  /* ---------------- simulation ---------------- */
  function banner(text, sub) {
    const b = $('banner');
    b.firstElementChild.textContent = text;
    b.lastElementChild.textContent = sub || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    later(CONFIG.bannerMs, () => b.classList.remove('show'));
  }

  function startWave(i) {
    wave = i;
    blockedUntil = elapsed + CONFIG.bannerMs;  // spawns pause while the banner is up
    spawnAcc = CONFIG.waves[i].interval;       // ...and the first one lands the moment it ends
    let sub = '';
    if (i === 1 && (firstClose === null || firstClose >= 10000)) { sub = 'Bold strategy.'; egg('dom-pacifist'); }
    banner(CONFIG.waves[i].banner, sub);
    System32.progress('wave', `${i + 1}/${CONFIG.waves.length}`);
  }

  function update(dt) {
    elapsed += dt;
    const i = waveIdx();
    if (i !== wave) startWave(i);
    if (!bossDone && elapsed >= CONFIG.bossAtMs) {
      bossDone = true;
      const boss = add('boss', { at: { x: 0, y: 0 } });
      const b = bounds();
      move(boss, (b.w - boss.w) / 2, (b.h - boss.h) / 2);
    }
    if (autoSpawn && elapsed >= blockedUntil) {
      spawnAcc += dt;
      const w = CONFIG.waves[wave];
      while (spawnAcc >= w.interval) { spawnAcc -= w.interval; add(pickType(w.types)); }
    }
    popups.forEach((p) => tickPopup(p, dt));
    checkEnd();
  }

  function step() {
    t += STEP;
    if (phase === 'play') update(STEP);
    if (timers.length && timers.some((x) => x.at <= t)) {
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.fn());
    }
    if (closing.length) {
      closing = closing.filter((c) => {
        if (!c.on && t >= c.start) { c.on = true; c.el.classList.add('closing'); }
        if (t >= c.end) { c.el.remove(); return false; }
        return true;
      });
    }
  }

  function checkEnd() {
    if (phase !== 'play') return;
    const c = clutter();
    if (c > peak) peak = c;
    if (c >= CONFIG.clutterCap) lose();
    else if (elapsed >= CONFIG.durationMs) win();
  }

  /* ---------------- HUD ---------------- */
  const hud = { time: $('h-time'), meter: $('h-meter'), clutter: $('h-clutter'), closed: $('h-closed'), wave: $('h-wave'), nodes: $('h-nodes'), expires: $('expires') };
  const shown = {};
  function setText(key, el, v) { if (shown[key] !== v) { shown[key] = v; el.textContent = v; } }

  function render() {
    const secs = Math.ceil(Math.max(0, CONFIG.durationMs - elapsed) / 1000);
    setText('time', hud.time, `⏱ ${Math.floor(secs / 60)}:${pad2(secs % 60)}`);
    setText('expires', hud.expires, `00:${pad2(Math.min(59, secs))}`);
    const c = clutter(), pct = c / CONFIG.clutterCap;
    setText('clutter', hud.clutter, `${c}/${CONFIG.clutterCap}`);
    hud.meter.firstElementChild.style.width = `${Math.min(100, pct * 100)}%`;
    const cls = pct >= 0.9 ? 'crit' : pct >= 0.8 ? 'high' : pct >= 0.6 ? 'mid' : '';
    if (shown.cls !== cls) { shown.cls = cls; hud.meter.className = `meter ${cls}`; }
    setText('closed', hud.closed, String(closed));
    setText('wave', hud.wave, `${Math.max(1, wave + 1)}/${CONFIG.waves.length}`);
    setText('nodes', hud.nodes, String(document.body.getElementsByTagName('*').length));   // joke stat, deliberately literal
  }

  /* ---------------- loop (the only clock: pause = cancelAnimationFrame) ---------------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(now - last, 100) * SPEED;  // clamp so a stalled tab cannot fast-forward the run
    last = now;
    while (acc >= STEP) { acc -= STEP; step(); }
    render();
  }

  function pause() {
    if (paused) return;
    paused = true;
    cancelAnimationFrame(raf);
    document.body.classList.add('paused');
    if (phase !== 'start') $('pause').hidden = false;
  }
  function resume() {
    if (!paused) return;
    paused = false;
    document.body.classList.remove('paused');
    $('pause').hidden = true;
    if (phase !== 'start') { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  /* ---------------- start / end ---------------- */
  const tooSmall = () => innerWidth < 760 || innerHeight < 480;

  function begin() {
    if (tooSmall()) { $('small').hidden = false; return; }
    if (soundOn && !ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    resume();
    resetRun();
    phase = 'play';
    document.body.classList.add('playing');
    $('hud').hidden = false;
    $('scam').inert = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
    render();
  }

  function showResult(id) {
    const el = $(id).content.firstElementChild.cloneNode(true);
    el.querySelector('[data-stat=closed]').textContent = String(closed);
    el.querySelector('[data-stat=peak]').textContent = `${peak}/${CONFIG.clutterCap}`;
    el.querySelector('[data-stat=acc]').textContent = `${accuracy()}%`;
    field.append(el);
    const first = el.querySelector('button, a');
    if (first) first.focus({ preventScroll: true });
  }

  function win() {
    phase = 'won';
    sfx('win');
    const b = bounds(), list = [...popups.values()];
    list.forEach((p, i) => {                   // everything shrinks into the centre and pops
      p.el.style.setProperty('--cx', (b.w / 2 - p.w / 2).toFixed(1));
      p.el.style.setProperty('--cy', (b.h / 2 - p.h / 2).toFixed(1));
      p.el.style.animationDelay = `${i * 40}ms`;
      p.el.classList.add('implode');
      p.el.style.pointerEvents = 'none';
      closing.push({ el: p.el, start: Infinity, end: t + 500 + i * 40 + 60, on: true });
    });
    popups.clear();
    later(600 + list.length * 40, () => showResult('tpl-win'));
  }

  function lose() {
    phase = 'lost';
    sfx('bait');
    popups.forEach((p) => { p.el.style.pointerEvents = 'none'; });
    if (!reported) { reported = true; System32.lost('browser overloaded'); }
    if (!REDUCED) {                            // ~60 tiny stacked pop-ups, then freeze
      const flood = document.createElement('div');
      flood.id = 'flood';
      const b = bounds();
      for (let i = 0; i < 60; i++) {
        const d = document.createElement('div');
        d.className = 'tiny';
        d.style.cssText = `left:${Math.round(rnd() * (b.w - 64))}px;top:${Math.round(rnd() * (b.h - 38))}px;--h:${Math.floor(rnd() * 360)};animation-delay:${i * 14}ms`;
        flood.append(d);
      }
      field.append(flood);
    }
    later(REDUCED ? 100 : 1000, () => showResult('tpl-lose'));
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-do]');
    if (!a) return;
    e.preventDefault();
    const what = a.dataset.do;
    if (what === 'claim' || what === 'again') begin();
    else if (what === 'resume') resume();
    else if (what === 'install' && !reported && phase === 'won') {
      reported = true;
      System32.won({ timeMs: CONFIG.durationMs, score: closed });
      a.textContent = 'Installed ✓';
      a.disabled = true;
    }
  });

  addEventListener('resize', () => {
    if (popups) popups.forEach((p) => move(p, p.x, p.y));
    $('small').hidden = !(phase === 'start' && tooSmall() && !$('small').hidden);
  });

  /* ---------------- shell wiring ---------------- */
  System32.onInit((init) => {
    init = init || {};
    soundOn = !!init.soundOn;
    beaten = !!init.beaten;
    $('sticker').hidden = !beaten;
    const best = $('best');
    best.hidden = typeof init.best !== 'number';
    if (!best.hidden) best.textContent = `Best: ${init.best} closed`;
  });
  System32.onPause(pause);
  System32.onResume(resume);

  if (DEBUG) {
    window.__DOMINATION = {
      state: () => ({
        phase, paused, seed: SEED, elapsed, wave, clutter: clutter(), closed, baits, peak, reported,
        popups: [...popups.values()].map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, w: p.w, h: p.h, vx: p.vx, vy: p.vy, age: p.age, hops: p.hops, tired: p.tired, clicks: p.clicks, claim: !!p.claim })),
      }),
      config: CONFIG,                          // mutable on purpose: lets headless playtests sweep tuning values
      spawn: (type) => add(type).id,
      autoSpawn: (on) => { autoSpawn = !!on; },
      closeAll: () => [...popups.values()].forEach((p) => retire(p)),
      forceWin: () => { if (phase === 'play') win(); },
      forceLose: () => { if (phase === 'play') lose(); },
    };
  }

  System32.ready();
})();
