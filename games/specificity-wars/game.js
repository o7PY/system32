/* CSS Specificity Wars. Classic script; no storage, cookies or modals.
   The truth is always getComputedStyle(): the specificity calculator below is for display only, so a bug in it
   can never decide the game wrongly. Everything the player types is treated as hostile (see validate()). */
(function () {
  'use strict';

  /* ---------------- tuning: every number lives here ---------------- */
  const CONFIG = {
    hp: 3, slots: 6, maxLen: 120, historyMax: 10,
    baseSpeed: 22, speedStep: 3,                 // px/s: wave 1, then +3 per wave
    spawnGapMs: 2500, bannerMs: 1500, waveGapMs: 2000, refillMs: 15000,
    waves: [
      { banner: 'WAVE 1: Class selectors', items: ['grunt', 'grunt', 'grunt'] },
      { banner: 'WAVE 2: Careful, allies share colors', items: ['grunt', 'grunt', 'ally', 'grunt', 'ally'] },
      { banner: 'WAVE 3: Armored. Out-specify them.', items: ['armored', 'armored', 'ally', 'armored'] },
      { banner: 'WAVE 4: IDs', items: ['boss', 'grunt', 'ally', 'grunt'] },
      { banner: 'WAVE 5: Inline styles. !important', items: ['final', 'armored', 'armored'] },
    ],
  };
  const SIZE = { w: 190, h: 84 }, BIG = { w: 250, h: 98 };   // keep in sync with style.css
  // A copy of enemy.css's selectors for the badges/tooltips only. A sandboxed page cannot read that cross-origin
  // sheet's rules, and the real cascade (not this table) is what defends the enemies.
  const DEFENSES = {
    armored: { sel: 'div.enemy.armored', rule: 'div.enemy.armored { display: block; }' },
    boss: { sel: '#arena .boss', rule: '#arena .boss { display: block; }' },
    final: { sel: '#arena .boss', inline: true, rule: '#arena .boss { display: block; }\n+ style="display:block"  (inline: beats every selector)' },
  };

  const qs = new URLSearchParams(location.search);
  const SPEED = Math.max(0.1, Number(qs.get('speed')) || 1);
  const DEBUG = qs.get('debug') === '1';
  const SEED = qs.has('seed') ? Number(qs.get('seed')) >>> 0 : (Math.random() * 4294967296) >>> 0;
  const rnd = ((a) => () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; })(SEED);
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STEP = 1000 / 60;
  const $ = (id) => document.getElementById(id);
  const arena = $('arena'), fx = $('fx'), pv = $('pv'), input = $('sel'), sheet = $('player-css').sheet;
  const fmtT = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const fmtS = (t) => `(${t.join(',')})`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ---------------- specificity calculator (Selectors Level 4; display only) ---------------- */
  const isIdent = (c) => /[\w-]|[^\x00-\x7f]/.test(c);
  const skipIdent = (s, i) => { while (i < s.length && (isIdent(s[i]) || s[i] === '\\')) i += s[i] === '\\' ? 2 : 1; return i; };
  function matchClose(s, i) {                    // index of the bracket closing s[i], honouring quotes
    let depth = 0, q = null;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' || c === '[') depth++;
      else if ((c === ')' || c === ']') && --depth === 0) return j;
    }
    return s.length - 1;
  }
  function splitTop(s) {                         // split a selector list on top-level commas
    const out = []; let depth = 0, q = null, start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    out.push(s.slice(start));
    return out.map((x) => x.trim()).filter(Boolean);
  }
  const add = (t, u) => [t[0] + u[0], t[1] + u[1], t[2] + u[2]];
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const maxSpec = (list) => list.reduce((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0]);
  const LEGACY_PE = new Set(['before', 'after', 'first-line', 'first-letter']);
  function pseudoFn(name, arg) {
    if (name === 'where') return [0, 0, 0];
    if (['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any'].includes(name)) return maxSpec(splitTop(arg).map(specOne));
    if (name === 'nth-child' || name === 'nth-last-child') {
      const m = arg.match(/\sof\s(.+)$/i);       // :nth-child(An+B of S) = one pseudo-class + the specificity of S
      return add([0, 1, 0], m ? maxSpec(splitTop(m[1]).map(specOne)) : [0, 0, 0]);
    }
    return [0, 1, 0];
  }
  function specOne(s) {
    let t = [0, 0, 0], i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '#') { t[0]++; i = skipIdent(s, i + 1); }
      else if (c === '.') { t[1]++; i = skipIdent(s, i + 1); }
      else if (c === '[') { t[1]++; i = matchClose(s, i) + 1; }
      else if (c === ':' && s[i + 1] === ':') { t[2]++; i = skipIdent(s, i + 2); }
      else if (c === ':') {
        const j = skipIdent(s, i + 1), name = s.slice(i + 1, j).toLowerCase();
        if (s[j] === '(') { const e = matchClose(s, j); t = add(t, pseudoFn(name, s.slice(j + 1, e))); i = e + 1; }
        else { t = add(t, LEGACY_PE.has(name) ? [0, 0, 1] : [0, 1, 0]); i = j; }
      } else if (c !== '*' && isIdent(c)) { t[2]++; i = skipIdent(s, i); }   // type selector
      else i++;                                  // `*`, combinators, whitespace count 0
    }
    return t;
  }
  const specificity = (sel) => maxSpec(splitTop(sel).map(specOne));   // a list gets its most specific part

  /* ---------------- validation: the string ends up inside CSS, so it is hostile ---------------- */
  function balanced(s) {
    const stack = []; let q = null;
    for (const c of s) {
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' || c === '[') stack.push(c === '(' ? ')' : ']');
      else if (c === ')' || c === ']') { if (stack.pop() !== c) return false; }
    }
    return !stack.length && !q;
  }
  function validate(raw) {
    const sel = String(raw).trim();
    const bad = (reason) => ({ ok: false, reason });
    if (!sel) return bad('Type a selector first');
    if (sel.length > CONFIG.maxLen) return bad(`Too long (max ${CONFIG.maxLen})`);
    if (/[{};@\\<]|\/\*|[\r\n]/.test(sel)) return bad('No braces, nice try');
    if (!balanced(sel)) return bad('Unbalanced brackets or parentheses');
    if (/::|:(before|after|first-line|first-letter)(?![\w-])/i.test(sel)) return bad("Pseudo-elements can't be hidden");
    try { document.querySelector(sel); } catch (e) { return bad('Invalid selector'); }
    return { ok: true, sel };
  }
  const matchAll = (sel) => { try { return [...arena.querySelectorAll(`:is(${sel})`)]; } catch (e) { return []; } };
  const elMatches = (el, sel) => { try { return el.matches(`:is(${sel})`); } catch (e) { return false; } };
  function specFor(sel, el) {                    // the most specific part of a selector list that matches this element
    let best = null;
    for (const p of splitTop(sel)) if (elMatches(el, p)) { const s = specificity(p); if (!best || cmp(s, best) > 0) best = s; }
    return best || specificity(sel);
  }
  const defSpec = (e) => (DEFENSES[e.type].inline ? [Infinity, 0, 0] : specificity(DEFENSES[e.type].sel));

  /* ---------------- state ---------------- */
  let phase = 'start', paused = false, soundOn = false, ac = null, raf = 0, last = 0, acc = 0, lastX = -999, pvT = 0, toastT = 0;
  const sent = {}, entOf = new Map();
  let S = fresh();
  function fresh() {
    return {
      hp: CONFIG.hp, wave: -1, status: 'idle', queue: [], waveT0: 0, gapEnd: 0, elapsed: 0, ents: [], rules: [], seq: 1,
      rulesUsed: 0, alliesLost: 0, charges: 1, importantOn: false, refillAt: 0, wasted: false, history: [], hIdx: -1,
      timers: [], reported: false, finishMs: 0, pvEnts: [],
    };
  }
  const stars = () => Math.min(S.hp, S.wasted ? 2 : 3);
  const egg = (id) => { if (!sent[id]) { sent[id] = true; System32.effect('egg', { egg: id }); } };
  const later = (ms, fn) => S.timers.push({ at: S.elapsed + ms, fn });

  /* ---------------- sound ---------------- */
  function tone(f1, f2, at, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(name) {
    if (!soundOn || !ac) return;
    try {
      if (name === 'zap') tone(1400, 300, 0, 0.12, 'square', 0.06);
      else if (name === 'clank') tone(180, 120, 0, 0.18, 'sawtooth', 0.08);
      else if (name === 'sad') tone(330, 160, 0, 0.35, 'triangle', 0.1);
      else if (name === 'win') [523, 659, 784].forEach((f, i) => tone(f, f, i * 0.12, 0.2, 'triangle', 0.1));
    } catch (e) { /* audio is never essential */ }
  }

  /* ---------------- small UI helpers ---------------- */
  function line(text, cls) { const p = $('preview'); p.textContent = text; p.className = `preview ${cls || 'muted'}`; }
  function banner(text) {
    const b = $('banner'); b.textContent = text; b.classList.add('show');
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.remove('show'), CONFIG.bannerMs);
  }
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500);
  }
  const flash = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  /* ---------------- entities ---------------- */
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function buildWave(i) {
    const cols = shuffle(['red', 'blue', 'green']); let ci = 0, ai = 0;
    const make = {
      grunt: () => ({ kind: 'enemy', type: 'grunt', tag: 'div', cls: ['enemy', cols[ci++ % 3]] }),
      armored: () => ({ kind: 'enemy', type: 'armored', tag: 'div', cls: ['enemy', 'armored', cols[ci++ % 3]] }),
      ally: () => ({ kind: 'ally', type: 'ally', tag: 'p', cls: ['ally', i === 1 ? ['red', 'blue'][ai++] : cols[ai++ % 3]] }),
      boss: () => ({ kind: 'enemy', type: 'boss', tag: 'div', cls: ['enemy', 'boss'], id: `boss-${Math.floor(0x1000 + rnd() * 0xefff).toString(16)}` }),
      final: () => ({ kind: 'enemy', type: 'final', tag: 'div', cls: ['enemy', 'boss', 'final'], inline: 'display:block' }),
    };
    return CONFIG.waves[i].items.map((k, n) => Object.assign(make[k](), { at: n * CONFIG.spawnGapMs }));
  }

  function spawn(sp) {
    const el = document.createElement(sp.tag);
    el.className = sp.cls.join(' ');
    if (sp.id) el.id = sp.id;
    if (sp.inline) el.setAttribute('style', sp.inline);
    const big = sp.type === 'boss' || sp.type === 'final', sz = big ? BIG : SIZE, def = DEFENSES[sp.type];
    const mk = document.createElement('span'), bd = document.createElement('span');
    mk.className = 'mk'; bd.className = 'badge';
    mk.textContent = `<${sp.tag} class="${sp.cls.join(' ')}"${sp.id ? ` id="${sp.id}"` : ''}${sp.inline ? ` style="${sp.inline}"` : ''}>`;
    bd.textContent = sp.kind === 'ally' ? '🙂 keep me' : def ? `🛡 ${def.inline ? 'inline style' : fmtS(specificity(def.sel))}` : '👾';
    el.append(mk, bd);
    let x = 0;
    for (let k = 0; k < 6; k++) { x = Math.round(rnd() * Math.max(0, arena.clientWidth - sz.w)); if (Math.abs(x - lastX) > 70) break; }
    lastX = x;
    const dist = Math.max(40, arena.clientHeight - sz.h);
    const e = { el, bd, kind: sp.kind, type: sp.type, cls: sp.cls, id: sp.id || null, x, y: 0, w: sz.w, h: sz.h, dist, speed: CONFIG.baseSpeed + CONFIG.speedStep * S.wave, dead: false };
    arena.append(el);
    // Movement is a paused Web Animation driven by the game clock: no per-frame style churn on the element a
    // player is inspecting, and pausing the game is exact.
    e.anim = el.animate([{ transform: `translate(${x}px, 0px)` }, { transform: `translate(${x}px, ${dist}px)` }], { duration: 1000, fill: 'both', easing: 'linear' });
    e.anim.pause(); e.anim.currentTime = 0;
    S.ents.push(e); entOf.set(el, e);
    return e;
  }

  function ghost(e, cls, text) {                 // effects live outside #arena so no player rule can ever hide them
    const g = e.el.cloneNode(true);
    g.classList.add('ghost', cls);
    g.style.transform = `translate(${e.x}px, ${Math.min(e.y, e.dist)}px)`;
    if (text) g.textContent = text;
    fx.append(g);
    setTimeout(() => g.remove(), REDUCED ? 300 : 950);
  }

  function hurt() {
    S.hp--;
    $('hearts').textContent = '♥'.repeat(Math.max(0, S.hp)) + '♡'.repeat(CONFIG.hp - Math.max(0, S.hp));
    if (S.hp <= 0) lose();
  }

  /** Per-frame truth check: hidden by the cascade = defeated (enemy) or hurt (ally). Returns what happened. */
  function checkAll() {
    const out = { enemies: 0, allies: 0 };
    for (const e of S.ents.slice()) {
      if (e.dead || phase !== 'play') continue;
      const hidden = getComputedStyle(e.el).display === 'none';
      const landed = !hidden && e.y >= e.dist;
      if (!hidden && !landed) continue;
      e.dead = true;
      if (hidden && e.kind === 'enemy') {
        out.enemies++;
        ghost(e, 'unstyle'); sfx('zap');
        if (!S.rules.some((r) => elMatches(e.el, r.sel))) { egg('spec-devtools'); toast('Inspect Element veteran, huh?'); }
      } else if (hidden) {
        out.allies++; S.alliesLost++;
        ghost(e, 'grey', 'you deleted my styles :('); sfx('sad');
        const culprit = S.rules.find((r) => elMatches(e.el, r.sel));
        if (culprit) { out.culprit = culprit; line(`Your rule "${culprit.sel}" hid an ally! Delete it (✕).`, 'bad'); markRule(culprit.id); }
        hurt();
      } else if (e.kind === 'enemy') { ghost(e, 'landed'); sfx('sad'); hurt(); }
      e.el.remove(); entOf.delete(e.el);
    }
    S.ents = S.ents.filter((e) => !e.dead);
    return out;
  }

  /* ---------------- rules: injection, panel ---------------- */
  function renderPanel() {
    const ul = $('rules');
    ul.textContent = '';
    for (const r of S.rules) {
      const li = document.createElement('li'), code = document.createElement('code'), sm = document.createElement('small'), x = document.createElement('button');
      code.textContent = r.sel + (r.important ? ' !important' : ''); code.title = code.textContent;
      sm.textContent = fmtS(specificity(r.sel));
      x.type = 'button'; x.textContent = '✕'; x.dataset.del = r.id; x.setAttribute('aria-label', `Delete rule ${r.sel}`);
      li.append(code, sm, x); ul.append(li);
    }
    $('slots').textContent = `slots ${S.rules.length}/${CONFIG.slots}`;
  }
  function markRule(id) {                       // flash the offending rule in the panel
    const b = document.querySelector(`#rules button[data-del="${id}"]`);
    if (b) flash(b.closest('li'), 'culprit');
  }
  function removeRule(id) {
    const i = S.rules.findIndex((r) => r.id === id);
    if (i < 0) return;
    try { sheet.deleteRule(i); } catch (e) { /* the sheet was edited from DevTools: the panel is still right */ }
    S.rules.splice(i, 1);
    renderPanel();
  }

  /** The one path from the input to the stylesheet. Returns {ok, reason?}; never costs HP when it rejects. */
  function submit(raw) {
    if (phase !== 'play') return { ok: false, reason: 'Not playing' };
    const v = validate(raw);
    if (!v.ok) { flash($('sel').closest('.rule'), 'shake'); line(v.reason, 'bad'); return v; }
    const sel = v.sel, important = S.importantOn && S.charges > 0;
    const dupe = S.rules.find((r) => r.sel === sel && r.important === important);
    if (dupe) { line('Already in player.css.', 'warn'); return { ok: true, dupe: true }; }

    const hitsBefore = new Set(matchAll(sel));
    const text = `:where(#arena) :is(${sel}) { display: none${important ? ' !important' : ''}; }`;
    const n = sheet.cssRules.length;
    try {
      sheet.insertRule(text, n);                 // insertRule parses exactly one rule: no second rule can sneak in
      const r = sheet.cssRules[n];
      if (sheet.cssRules.length !== n + 1 || !r || r.type !== 1 || r.style.display !== 'none' || !r.selectorText.startsWith(':where(#arena)')) throw new Error('unexpected rule');
    } catch (e) {
      try { while (sheet.cssRules.length > n) sheet.deleteRule(sheet.cssRules.length - 1); } catch (e2) { /* nothing to undo */ }
      flash($('sel').closest('.rule'), 'shake'); line('Invalid selector', 'bad');
      return { ok: false, reason: 'Invalid selector' };
    }
    S.rules.push({ id: S.seq++, sel, important }); S.rulesUsed++;
    if (S.rules.length > CONFIG.slots) {         // 7th rule evicts the oldest
      const old = S.rules.shift();
      try { sheet.deleteRule(0); } catch (e) { /* see removeRule */ }
      flash(document.querySelector('.panel'), 'flash'); toast(`Slots full: evicted ${old.sel}`);
    }
    renderPanel();

    const hitEnts = S.ents.filter((e) => hitsBefore.has(e.el));
    if (sel === '*') { egg('spec-nuke'); banner('The nuclear option.'); }
    if (sel.includes(':has(')) egg('spec-has');
    if (important) {                             // the single !important charge
      S.charges = 0; S.importantOn = false; syncImp();
      const hitBoss = hitEnts.some((e) => e.type === 'final');
      if (!hitBoss) { S.wasted = true; S.refillAt = S.elapsed + CONFIG.refillMs; }
      if (hitEnts.some((e) => e.kind === 'enemy') && !hitEnts.some((e) => e.type === 'boss' || e.type === 'final')) { egg('spec-overkill'); banner('Overkill.'); }
    }

    const res = checkAll();
    const blocked = S.ents.filter((e) => e.kind === 'enemy' && hitsBefore.has(e.el));
    blocked.forEach((e) => flash(e.bd, 'flash'));
    let msg, cls = 'ok';
    if (res.allies) { msg = `Hid ${plural(res.allies, 'ally')}! -${res.allies} ♥${res.culprit ? `  Rule "${res.culprit.sel}" did it.` : ''}`; cls = 'bad'; }
    else if (blocked.length) {
      const e = blocked[0];
      msg = e.type === 'final' ? 'Blocked: inline style="display:block" beats every selector. Try !important.'
        : `Blocked: your ${fmtS(specFor(sel, e.el))} < defense ${fmtS(defSpec(e))}`;
      if (res.enemies) msg = `Hid ${res.enemies}, but ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`;
      cls = 'warn'; sfx('clank');
    } else if (res.enemies) msg = `Hid ${plural(res.enemies, 'enemy')}.`;
    else msg = 'Rule saved. Nothing to hide right now (it stays active).';
    if (sel.includes(':has(')) msg += '  Look at you, using :has().';
    line(msg, cls);
    return { ok: true, enemies: res.enemies, allies: res.allies, blocked: blocked.length, message: msg };
  }

  /* ---------------- live preview ---------------- */
  function clearPv() { pv.textContent = ''; S.pvEnts = []; }
  function preview(raw) {
    clearPv();
    if (phase !== 'play') return;
    if (!raw.trim()) return line('Type a selector, press Enter.', 'muted');
    const v = validate(raw);
    if (!v.ok) return line(v.reason, 'muted');
    const m = new Set(matchAll(v.sel)), hits = S.ents.filter((e) => m.has(e.el));
    for (const e of hits) {                      // dashed outlines drawn in an overlay: the cards themselves are never touched
      const box = document.createElement('div');
      box.className = `pvbox ${e.kind}`; box.style.width = `${e.w}px`; box.style.height = `${e.h}px`;
      pv.append(box); S.pvEnts.push({ e, box });
    }
    const en = hits.filter((e) => e.kind === 'enemy'), al = hits.length - en.length;
    const mine = specificity(v.sel), imp = S.importantOn && S.charges > 0;
    let txt = `matches: ${plural(en.length, 'enemy').replace('enemys', 'enemies')} · ${plural(al, 'ally').replace('allys', 'allies')} · yours ${fmtS(mine)}`, cls = al ? 'warn' : 'ok';
    const defended = en.filter((e) => DEFENSES[e.type]);
    if (defended.length) {
      const top = defended.reduce((a, b) => (cmp(defSpec(b), defSpec(a)) > 0 ? b : a));
      const d = defSpec(top), me = specFor(v.sel, top.el);
      if (imp) txt += ' · !important beats it ✔';
      else if (cmp(me, d) > 0) txt += ` ✔ beats ${top.type === 'final' ? 'inline' : fmtS(d)}`;
      else if (cmp(me, d) === 0) txt += ' · tie: you win on source order ✔';
      else { txt += ` ✘ blocked by ${top.type === 'final' ? 'inline style' : fmtS(d)}`; cls = 'bad'; }
    }
    if (v.sel.includes(':has(')) txt += '  Look at you, using :has().';
    line(txt, cls);
  }

  /* ---------------- waves ---------------- */
  function syncImp() {
    const b = $('imp'), on = S.wave === CONFIG.waves.length - 1 && phase === 'play';
    b.hidden = !on;
    b.textContent = `!important ×${S.charges}`;
    b.disabled = S.charges < 1;
    b.setAttribute('aria-pressed', String(S.importantOn));
    $('imp-txt').textContent = S.importantOn ? ' !important' : '';
  }
  function startWave(i) {
    S.wave = i; S.status = 'banner';
    S.queue = buildWave(i);
    S.waveT0 = S.elapsed + CONFIG.bannerMs;
    banner(CONFIG.waves[i].banner);
    if (i > 0 && S.rules.length) line('Your rules in player.css still apply. Delete (✕) any that would hide an ally.', 'warn');
    System32.progress('wave', `${i + 1}/${CONFIG.waves.length}`);
    syncImp();
  }
  function advanceWave() {
    if (S.status === 'banner' && S.elapsed >= S.waveT0) S.status = 'active';
    if (S.status === 'active') {
      while (S.queue.length && S.elapsed - S.waveT0 >= S.queue[0].at) spawn(S.queue.shift());
      if (!S.queue.length && !S.ents.some((e) => e.kind === 'enemy')) {
        S.status = 'gap'; S.gapEnd = S.elapsed + CONFIG.waveGapMs;
        S.ents.filter((e) => e.kind === 'ally').forEach((e) => { e.dead = true; ghost(e, 'fade'); e.el.remove(); entOf.delete(e.el); });
        S.ents = S.ents.filter((e) => !e.dead);
        if (S.wave === CONFIG.waves.length - 1) win();
      }
    } else if (S.status === 'gap' && S.elapsed >= S.gapEnd) startWave(S.wave + 1);
  }

  /* ---------------- loop: one rAF clock, fixed step, pause = stop the clock ---------------- */
  function step() {
    S.elapsed += STEP;
    for (const e of S.ents) e.y += (e.speed * STEP) / 1000;
    checkAll();
    if (phase !== 'play') return;
    advanceWave();
    if (S.refillAt && S.elapsed >= S.refillAt) { S.refillAt = 0; S.charges = 1; syncImp(); toast('A second !important charge appeared.'); }
    if (S.timers.length) {
      const due = S.timers.filter((t) => t.at <= S.elapsed);
      S.timers = S.timers.filter((t) => t.at > S.elapsed);
      due.forEach((t) => t.fn());
    }
  }
  function render() {
    for (const e of S.ents) e.anim.currentTime = Math.min(1, e.y / e.dist) * 1000;
    for (const p of S.pvEnts) { p.box.hidden = p.e.dead; p.box.style.transform = `translate(${p.e.x}px, ${p.e.y}px)`; }
    $('wv').textContent = `${Math.max(1, S.wave + 1)}/${CONFIG.waves.length}`;
    $('tm').textContent = fmtT(S.elapsed);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(now - last, 100) * SPEED;    // clamp so a stalled tab cannot fast-forward the run
    last = now;
    while (acc >= STEP && phase === 'play') { acc -= STEP; step(); }
    render();
  }
  function pause() {
    if (paused) return;
    paused = true; cancelAnimationFrame(raf);
    document.body.classList.add('paused');
    if (phase === 'play') $('pause').hidden = false;
  }
  function resume() {
    if (!paused) return;
    paused = false;
    document.body.classList.remove('paused'); $('pause').hidden = true;
    if (phase === 'play') { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  /* ---------------- run lifecycle ---------------- */
  const tooSmall = () => innerWidth < 700 || innerHeight < 460;
  function begin() {
    if (tooSmall()) { $('small').hidden = false; return; }
    if (soundOn && !ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    resume();
    cancelAnimationFrame(raf);
    while (sheet.cssRules.length) sheet.deleteRule(0);
    for (const id of ['arena', 'fx', 'pv']) $(id).textContent = '';
    entOf.clear();
    document.documentElement.classList.remove('overrun'); document.body.classList.remove('clean');
    for (const id of ['start', 'win', 'lose', 'help']) $(id).hidden = true;
    S = fresh(); phase = 'play'; lastX = -999; acc = 0;
    $('hearts').textContent = '♥'.repeat(CONFIG.hp);
    renderPanel(); line('Type a selector, press Enter.', 'muted');
    input.disabled = false; input.value = ''; input.focus();
    startWave(0);
    last = performance.now(); raf = requestAnimationFrame(frame);
    render();
  }
  function endRun() { cancelAnimationFrame(raf); input.disabled = true; clearPv(); syncImp(); render(); }

  function win() {
    phase = 'won'; S.finishMs = S.elapsed;
    endRun(); sfx('win');
    document.body.classList.add('clean');        // the broken page behind snaps into a clean theme
    const w = $('win'), set = (k, v) => { w.querySelector(`[data-stat=${k}]`).textContent = v; };
    set('time', fmtT(S.finishMs)); set('rules', String(S.rulesUsed)); set('allies', String(S.alliesLost)); set('stars', '★'.repeat(stars()) + '☆'.repeat(3 - stars()));
    w.hidden = false; $('install').disabled = false; $('install').textContent = 'Install'; $('install').focus();
  }
  function lose() {
    if (phase !== 'play') return;
    phase = 'lost'; endRun(); sfx('sad');
    if (!S.reported) { S.reported = true; System32.lost('stylesheet overrun'); }
    $('lose-stats').textContent = `Wave ${S.wave + 1} of ${CONFIG.waves.length} · ${plural(S.rulesUsed, 'rule')} used · ${fmtT(S.elapsed)}`;
    $('lose').hidden = false;
    document.documentElement.classList.add('overrun');   // every element loses its styles at once
  }
  function install() {
    if (phase !== 'won' || S.reported) return;
    S.reported = true;
    System32.won({ timeMs: Math.max(1, Math.round(S.finishMs)), score: stars() });
    $('install').textContent = 'Installed ✓'; $('install').disabled = true;
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-do], [data-del], #help-btn, #imp') : null;
    if (!t) { if (phase === 'play' && arena.contains(e.target)) input.focus(); return; }
    const what = t.dataset.do;
    if (what === 'start') { e.preventDefault(); begin(); }
    else if (what === 'resume') resume();
    else if (what === 'install') install();
    else if (t.dataset.del) { removeRule(Number(t.dataset.del)); input.focus(); }
    else if (t.id === 'help-btn') { const h = $('help'); h.hidden = !h.hidden; t.setAttribute('aria-expanded', String(!h.hidden)); }
    else if (t.id === 'imp' && S.charges > 0 && phase === 'play') { S.importantOn = !S.importantOn; syncImp(); preview(input.value); input.focus(); }
  });
  input.addEventListener('input', () => { clearTimeout(pvT); pvT = setTimeout(() => preview(input.value), 80); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (phase !== 'play' || paused) return;
      const raw = input.value, r = submit(raw);
      if (r.ok) {
        if (S.history[0] !== raw.trim()) S.history.unshift(raw.trim());
        S.history.length = Math.min(S.history.length, CONFIG.historyMax); S.hIdx = -1;
        input.value = ''; clearPv();
      }
    } else if (e.key === 'Escape') { input.value = ''; S.hIdx = -1; preview(''); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      S.hIdx = Math.max(-1, Math.min(S.history.length - 1, S.hIdx + (e.key === 'ArrowUp' ? 1 : -1)));
      input.value = S.hIdx < 0 ? '' : S.history[S.hIdx];
      preview(input.value);
    }
  });
  arena.addEventListener('pointermove', (e) => {   // hover an enemy: its defense rule from enemy.css
    let n = e.target, ent = null;
    while (n && n !== arena && !(ent = entOf.get(n))) n = n.parentNode;
    const tip = $('tip');
    if (!ent) { tip.hidden = true; return; }
    tip.textContent = ent.kind === 'ally' ? 'Ally: keep it visible.' : DEFENSES[ent.type] ? DEFENSES[ent.type].rule : 'No defense.';
    tip.hidden = false;
    const r = arena.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 310)}px`; tip.style.top = `${e.clientY - r.top + 14}px`;
  });
  arena.addEventListener('pointerleave', () => { $('tip').hidden = true; });
  addEventListener('resize', () => { if (phase === 'start' && !$('small').hidden && !tooSmall()) $('small').hidden = true; });

  System32.onInit((init) => { soundOn = !!(init && init.soundOn); });
  System32.onPause(pause);
  System32.onResume(resume);

  /* ---------------- debug / test hooks ---------------- */
  if (DEBUG) {
    const TESTS = [
      ['*', [0, 0, 0]], ['div', [0, 0, 1]], ['.a', [0, 1, 0]], ['#a', [1, 0, 0]], ['div.a#b', [1, 1, 1]],
      ['div > p.x[data-y]', [0, 2, 2]], ['#a#a', [2, 0, 0]], [':is(#a, .b)', [1, 0, 0]], [':where(#a) .b', [0, 1, 0]],
      [':not(.a.b)', [0, 2, 0]], ['a:hover', [0, 1, 1]], ['li:nth-child(2n+1)', [0, 1, 1]], [':nth-child(2n+1 of .foo, #x)', [1, 1, 0]],
      [':has(> img)', [0, 0, 1]], [':has(#x, .y p)', [1, 0, 0]], ['[type="text"][name]', [0, 2, 0]], ['ul li > a:not(.b, #c)', [1, 0, 3]],
      ['.a, #b', [1, 0, 0]], [':where(#arena) :is(.enemy.armored.green)', [0, 3, 0]], [':is()', [0, 0, 0]], ['a::before', [0, 0, 2]],
      ['[title="a)b"]', [0, 1, 0]], ['div.enemy.armored', [0, 2, 1]], ['#arena .boss', [1, 1, 0]], [':where(#arena) :is(#boss-1.boss)', [1, 1, 0]],
    ];
    window.__SPECIFICITY = {
      specificity,
      validate,
      runSpecTests: () => {
        const results = TESTS.map(([sel, want]) => { const got = specificity(sel); return { sel, want, got, ok: cmp(got, want) === 0 }; });
        return { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
      },
      state: () => ({
        phase, paused, seed: SEED, hp: S.hp, wave: S.wave + 1, status: S.status, elapsed: S.elapsed, rules: S.rules.map((r) => ({ sel: r.sel, important: r.important })),
        charges: S.charges, importantOn: S.importantOn, wasted: S.wasted, rulesUsed: S.rulesUsed, alliesLost: S.alliesLost, stars: stars(), reported: S.reported, queued: S.queue.length,
        cssRules: [...sheet.cssRules].map((r) => r.cssText),
        ents: S.ents.map((e) => ({ kind: e.kind, type: e.type, cls: e.cls.join(' '), id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, dist: e.dist, speed: e.speed })),
      }),
      submit,
      toggleImportant: () => { if (S.charges > 0) { S.importantOn = !S.importantOn; syncImp(); } return S.importantOn; },
      skipToWave(n) {
        if (phase !== 'play') begin();
        S.ents.forEach((e) => e.el.remove()); S.ents = []; entOf.clear(); S.queue = [];
        startWave(Math.max(1, Math.min(CONFIG.waves.length, n)) - 1);
        S.waveT0 = S.elapsed;                    // skip the banner delay
      },
      config: CONFIG,
      forceLose: () => { S.hp = 1; hurt(); },
    };
  }

  System32.ready();
})();
