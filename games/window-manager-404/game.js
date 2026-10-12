/* 404: Window Manager. Classic script; no storage, cookies, modals or native drag-and-drop.
   The DOM is only a view: windows and files live in S, and collapse = update state, then animate (render() derives
   every pose from the game clock, so pause is exact). Dragging is pointer events + document.elementsFromPoint. */
(function () {
  'use strict';

  /* ---------------- tuning: every number lives here ---------------- */
  const CONFIG = {
    hp: 3, slots: 4, dragPx: 4, clampKicks: 3,
    collapseMs: 600, ghostMs: 1000, closeMs: 250, warnMs: 3000, bannerMs: 1200, assembleMs: 900, loseGapMs: 350,
    respawnDelayMs: 2000, respawnTimerMs: 10000,
    driftSpeed: 30, jumpMs: 4000, minimizeAfterMs: 4000,
    size: { source: [240, 166], recovery: [290, 150], bin: [150, 124] },
    // at: [fx, fy] fractions of the free space; rel: [key, dx, dy] offset from another window of the phase
    phases: [
      { banner: "Something's wrong.", grace: 3000, wins: [
        { key: 'dl', title: 'Downloads', at: [0.03, 0.05], dur: 14000, files: ['core_01.frag', 'cat.jpg', 'homework_FINAL.docx'] },
        { key: 'tmp', title: 'temp', at: [0.42, 0.78], dur: 18000, files: ['untitled(3).txt', 'core_02.frag', 'definitely_not_a_virus.exe'] },
      ] },
      { banner: 'Windows are overlapping.', grace: 2000, wins: [
        // B holds the fragment, partly under A (created later, so on top); A also covers part of Recovery
        { key: 'sys', title: 'C:\\Windows\\???', rel: ['rec', -220, 110], dur: 16000, files: ['kernel32.bak', 'desktop.ini', 'core_03.frag'] },
        { key: 'doc', title: 'Documents', rel: ['rec', -130, 50], dur: 12000, files: ['IMG_0042.jpg', 'notes_old.txt', 'budget_v7_REAL.xlsx', 'resume (1).pdf', 'thumbs.db', 'cat.jpg'] },
        { key: 'old', title: 'Desktop (old)', at: [0.0, 0.7], dur: 14000, files: ['Recycled.dat',
          { folder: 'New folder', files: [{ folder: 'New folder (2)', files: [{ folder: 'New folder (3)', files: ['turtles.txt'] }] }] }] },
      ] },
      { banner: 'Cascade failure.', grace: 2000, wins: [
        { key: 'doc', title: 'Documents', at: [0.1, 0.5], dur: 18000, files: ['budget_v7_REAL.xlsx', 'IMG_0042.jpg',
          { folder: 'New folder', files: ['core_04.frag', 'notes_old.txt'] }] },
      ] },
    ],
  };
  const FRAG_RE = /^core_0\d\.frag$/;

  const $ = (id) => document.getElementById(id);
  const desk = $('desk'), tasks = $('tasks');
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1';
  const SPEED = Math.max(0.1, Math.min(20, Number(params.get('speed')) || 1));
  const SEED = Number(params.get('seed')) || (Date.now() % 100000);
  const STEP = 1000 / 60;
  const rnd = (function (a) {                    // mulberry32: ?seed=N makes spawns and drift repeatable
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  })(SEED);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmtT = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const dim = () => ({ W: desk.clientWidth, H: desk.clientHeight });

  /* ---------------- state ---------------- */
  let phase = 'start', paused = false, soundOn = false, ac = null, raf = 0, last = 0, acc = 0, toastT = 0, typeT = 0, bannerT = 0;
  const sent = {};
  let S = fresh();
  function fresh() {
    return {
      hp: CONFIG.hp, ph: 0, elapsed: 0, wins: [], files: [], slots: Array(CONFIG.slots).fill(null), seq: 0, z: 10, recovered: 0, lostFrags: 0,
      timers: [], drag: null, wdrag: null, kb: null, hover: null, vx: 0, vy: 0, tasksDirty: true, reported: false, finishMs: 0, winT0: 0,
    };
  }
  const running = () => phase === 'play' || phase === 'assembling' || phase === 'losing';
  const winById = (id) => S.wins.find((w) => w.id === id);
  const fileById = (id) => S.files.find((f) => f.id === id);
  const rec = () => S.wins.find((w) => w.kind === 'recovery');
  const bin = () => S.wins.find((w) => w.kind === 'bin');
  const alive = (w) => !w.dead && !w.closed;
  const rootOf = (w) => { while (w.parentId) w = winById(w.parentId); return w; };
  const stars = () => Math.max(1, S.hp);
  const egg = (id) => { if (!sent[id]) { sent[id] = true; System32.effect('egg', { egg: id }); } };
  const later = (ms, fn) => S.timers.push({ at: S.elapsed + ms, fn });

  /* ---------------- sound ---------------- */
  function tone(f1, f2, at, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const SFX = {                                  // [from Hz, to Hz, delay s, length s, wave, volume]
    pick: [[900, 700, 0, 0.04, 'square', 0.04]], drop: [[200, 90, 0, 0.1, 'triangle', 0.1]], bonk: [[150, 110, 0, 0.18, 'sawtooth', 0.08]],
    crunch: [[260, 40, 0, 0.35, 'sawtooth', 0.1]], chime: [[660, 660, 0, 0.18, 'triangle', 0.09], [880, 880, 0.09, 0.18, 'triangle', 0.09]],
    win: [523, 659, 784, 1046].map((f, i) => [f, f, i * 0.12, 0.25, 'triangle', 0.1]),
  };
  function sfx(name) {
    if (!soundOn || !ac) return;
    try { SFX[name].forEach((n) => tone(n[0], n[1], n[2], n[3], n[4], n[5])); } catch (e) { /* audio is never essential */ }
  }

  /* ---------------- small UI helpers ---------------- */
  function banner(text) {
    const b = $('banner'); b.textContent = text; b.classList.add('show');
    clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), CONFIG.bannerMs);
  }
  function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show'); $('live').textContent = text;
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }
  const hearts = () => { $('hearts').textContent = '♥'.repeat(Math.max(0, S.hp)) + '♡'.repeat(CONFIG.hp - Math.max(0, S.hp)); };
  function place(parent, els) {                  // keyed reconcile: never re-creates (or needlessly moves) an element
    els.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
    while (parent.children.length > els.length) parent.lastChild.remove();
  }

  /* ---------------- windows ---------------- */
  function buildWindow(win) {
    const el = document.createElement('section');
    el.className = `mini-window ${win.kind}`; el.dataset.win = win.id; el.style.width = `${win.w}px`; el.style.height = `${win.h}px`;
    el.innerHTML = '<div class="inner"><header class="tb"><span class="ttl"></span><span class="fail"></span>' +
      '<button type="button" class="tbtn" data-act="min" aria-label="Minimize">–</button><button type="button" class="tbtn" data-act="close" aria-label="Close">x</button></header>' +
      '<i class="meter"></i><div class="body"></div><div class="nf" hidden>404: window not found</div></div><div class="g404" hidden>404</div>';
    const q = (s) => el.querySelector(s), body = q('.body');
    if (win.kind === 'recovery') {
      body.innerHTML = '<div class="slots"></div><div class="exe">⚙️</div><p class="rc-label"></p>';
      for (let i = 0; i < CONFIG.slots; i++) { const s = document.createElement('div'); s.className = 'slot'; s.style.setProperty('--i', i); body.firstChild.appendChild(s); }
    } else if (win.kind === 'bin') body.innerHTML = '<p class="bin-ic">🗑</p><p class="bin-tx">drop junk</p><p class="bin-msg"></p>';
    win.el = el;
    win.refs = { ttl: q('.ttl'), fail: q('.fail'), inner: q('.inner'), body, nf: q('.nf'), g: q('.g404'), label: q('.rc-label'), msg: q('.bin-msg'), slots: [...el.querySelectorAll('.slot')] };
    win.refs.ttl.textContent = win.title;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'task'; b.dataset.task = win.id; b.textContent = win.title; win.btn = b;
    desk.appendChild(el);
  }
  function addWindow(o) {
    const [w, h] = o.kind === 'child' ? CONFIG.size.source : CONFIG.size[o.kind];
    const { W, H } = dim();
    const win = Object.assign({ id: `w${++S.seq}`, kind: 'source', w, h, z: ++S.z, minimized: false, closed: false, dead: false, startAt: 0, dur: 0, parentId: null, dyingAt: 0, dying: '' }, o);
    if (win.kind === 'child') win.kind = 'source';
    win.x = clamp(o.x, 0, Math.max(0, W - w)); win.y = clamp(o.y, 0, Math.max(0, H - h));
    buildWindow(win); S.wins.push(win); S.tasksDirty = true;
    return win;
  }
  function front(win) { if (win.z !== S.z) { win.z = ++S.z; S.tasksDirty = true; } }
  function setMinimized(win, v) { win.minimized = v; win.el.hidden = v || win.closed; S.tasksDirty = true; if (v && S.hover === win) setHover(null); if (!v) { front(win); win.btn.classList.remove('attn'); } }
  const timerOf = (win) => { const r = rootOf(win); return r.dur ? r : null; };
  const remainingMs = (win) => { const r = timerOf(win); return r && S.elapsed >= r.startAt ? r.startAt + r.dur - S.elapsed : null; };

  /* ---------------- files ---------------- */
  const ICONS = { jpg: '🖼️', docx: '📄', txt: '📄', pdf: '📕', xlsx: '📊', exe: '⚙️', tmp: '📄', bak: '📄', ini: '🔧', db: '🗃️', dat: '🗃️' };
  function addFile(name, winId, kind) {
    const f = { id: `f${++S.seq}`, name, kind: kind || (FRAG_RE.test(name) ? 'frag' : 'junk'), windowId: winId, slot: -1, held: false, el: null };
    S.files.push(f);
    return f;
  }
  function fileEl(f) {
    if (f.el) return f.el;
    const b = document.createElement('button');
    b.type = 'button'; b.className = `file ${f.kind}`; b.dataset.file = f.id; b.title = f.name;
    b.innerHTML = '<span class="ic"></span><span class="nm"></span>';
    b.firstChild.textContent = f.kind === 'frag' ? '🧩' : f.kind === 'folder' ? '📁' : ICONS[f.name.split('.').pop()] || '📄';
    b.lastChild.textContent = f.name;
    return (f.el = b);
  }
  function syncWin(win) {
    if (!win || !win.el) return;
    if (win.kind === 'recovery') {
      win.refs.slots.forEach((slot, i) => { const f = fileById(S.slots[i]); place(slot, f ? [fileEl(f)] : []); if (f) f.el.classList.toggle('locked', f.kind === 'frag'); });
      return;
    }
    if (win.kind === 'bin') return;
    place(win.refs.body, S.files.filter((f) => f.windowId === win.id).map(fileEl));
  }
  function fillWindow(win, specs) {
    for (const sp of specs) {
      if (typeof sp === 'string') { addFile(sp, win.id); continue; }
      const f = addFile(sp.folder, win.id, 'folder');
      const kid = addWindow({ kind: 'child', title: sp.folder, x: win.x + 40, y: win.y + 34, parentId: win.id, closed: true });
      kid.el.hidden = true; f.childId = kid.id;
      fillWindow(kid, sp.files);
    }
    syncWin(win);
  }
  function openFolder(f) {
    const kid = winById(f.childId);
    if (!kid || kid.dead) return;
    const p = winById(f.windowId), { W, H } = dim();
    if (kid.closed) { kid.closed = false; kid.x = clamp(p.x + 40, 0, W - kid.w); kid.y = clamp(p.y + 34, 0, H - kid.h); kid.el.hidden = false; kid.minimized = false; }
    setMinimized(kid, false); front(kid);
  }
  function openFile(f) {
    if (f.kind === 'folder') openFolder(f);
    else if (f.name === 'turtles.txt') { egg('wm-matryoshka'); toast("It's folders all the way down."); }
    else toast(`Can't open ${f.name}: the window manager isn't responding.`);
  }
  const canPick = (f) => !!f && !f.held && f.kind !== 'folder' && !(f.kind === 'frag' && f.windowId === rec().id);

  /* ---------------- phases ---------------- */
  function startPhase(n) {
    S.ph = n;
    const P = CONFIG.phases[n - 1], { W, H } = dim(), pos = { rec: rec() };
    banner(P.banner);
    for (const sp of P.wins) {
      const [w, h] = CONFIG.size.source;
      const base = sp.rel ? pos[sp.rel[0]] : null;
      const x = base ? base.x + sp.rel[1] : sp.at[0] * (W - w), y = base ? base.y + sp.rel[2] : sp.at[1] * (H - h);
      const win = addWindow({ kind: 'source', title: sp.title, x, y, startAt: S.elapsed + P.grace, dur: sp.dur });
      pos[sp.key] = win;
      fillWindow(win, sp.files);
    }
    if (n === 2) {                                   // pre-placed junk: only if two slots stay free, so the phase never needs the bin
      const free = S.slots.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
      if (free.length >= 2) putInSlot(addFile('autosave.tmp', rec().id), free[free.length - 2]);
    }
    if (n === 3) {
      const a = rnd() * Math.PI * 2, vx = Math.cos(a) * CONFIG.driftSpeed, r = rec();
      S.vx = r.x > dim().W - r.w - 1 ? -Math.abs(vx) : vx;   // random direction, but never into the wall Recovery starts against
      S.vy = Math.sin(a) * CONFIG.driftSpeed;
      later(CONFIG.minimizeAfterMs, () => {
        const r = rec();
        if (phase !== 'play' || !r) return;
        setMinimized(r, true); r.btn.classList.add('attn'); toast('Recovery stopped responding. Restore it from the taskbar.');
      });
      if (reducedMotion()) jump();
    }
    syncWin(rec());
  }
  function jump() {                                  // reduced motion: Recovery hops to a new spot instead of drifting
    const r = rec(), { W, H } = dim();
    if (phase !== 'play' || S.ph !== 3 || !r) return;
    r.x = rnd() * (W - r.w); r.y = rnd() * (H - r.h);
    later(CONFIG.jumpMs, jump);
  }
  function checkPhase() {
    S.recovered = S.slots.filter((id) => id && fileById(id).kind === 'frag').length;
    $('frags').textContent = `${S.recovered}/${CONFIG.slots}`;
    rec().refs.label.textContent = `wm_core.exe: ${S.recovered}/${CONFIG.slots}`;
    if (S.recovered >= 4) assemble();
    else if (S.recovered >= 3 && S.ph < 3) startPhase(3);
    else if (S.recovered >= 2 && S.ph < 2) startPhase(2);
  }
  function respawn(name) {
    if (phase !== 'play') return;
    const [w, h] = CONFIG.size.source, { W, H } = dim();
    const cost = (x, y) => S.wins.reduce((c, o) => (!alive(o) || o.minimized ? c
      : c + Math.max(0, Math.min(x + w, o.x + o.w) - Math.max(x, o.x)) * Math.max(0, Math.min(y + h, o.y + o.h) - Math.max(y, o.y)) * (o.kind === 'source' ? 1 : 4)), 0);
    let best = null;
    for (let i = 0; i < 16; i++) { const p = { x: rnd() * (W - w), y: rnd() * (H - h) }; p.cost = cost(p.x, p.y); if (!best || p.cost < best.cost) best = p; }   // the spot that covers the least
    fillWindow(addWindow({ kind: 'source', title: 'Backup (restored)', x: best.x, y: best.y, startAt: S.elapsed, dur: CONFIG.respawnTimerMs }), [name]);
    toast(`${name} restored from backup.`);
  }

  /* ---------------- drop rules ---------------- */
  function putInSlot(f, i) { S.slots[i] = f.id; f.windowId = rec().id; f.slot = i; }
  function unslot(f) { if (f.slot >= 0 && S.slots[f.slot] === f.id) S.slots[f.slot] = null; f.slot = -1; }
  const heldFile = () => (S.drag && S.drag.started ? S.drag.f : S.kb ? S.kb.f : null);
  function canDrop(f, t) {
    if (!f || !t || !alive(t) || t.minimized) return null;
    if (t.kind === 'recovery') return f.windowId === t.id ? null : S.slots.includes(null);
    return t.kind === 'bin' && f.kind === 'junk' ? true : null;     // the bin only lights up for junk
  }
  function binSay(t, text) { t.refs.msg.textContent = text; clearTimeout(binSay.t); binSay.t = setTimeout(() => { t.refs.msg.textContent = ''; }, 1600); }
  /** Returns 'ok' | 'refused' | 'invalid'. The dragged file is "in hand", so it is always detached from a dead origin. */
  function dropFile(f, t) {
    if (!t || !alive(t) || t.minimized) return 'invalid';
    if (t.kind === 'recovery' && f.windowId !== t.id) {
      const i = S.slots.indexOf(null);
      if (i < 0) { toast('Recovery is full. Bin some junk first.'); sfx('bonk'); return 'invalid'; }
      const from = winById(f.windowId); unslot(f); putInSlot(f, i);
      syncWin(from); syncWin(t);
      if (f.kind === 'frag') { System32.progress('fragments', `${S.recovered + 1}/${CONFIG.slots}`); sfx('chime'); } else sfx('bonk');
      checkPhase();
      const all = S.slots.every((id) => id && fileById(id).kind === 'junk');
      t.refs.ttl.textContent = all ? 'Recovery (4 cat pictures)' : t.title;
      if (all) egg('wm-hoarder');
      return 'ok';
    }
    if (t.kind === 'bin') {
      if (f.kind !== 'junk') { binSay(t, 'Absolutely not.'); egg('wm-bin-core'); sfx('bonk'); return 'refused'; }
      const from = winById(f.windowId); unslot(f);
      S.files.splice(S.files.indexOf(f), 1); if (f.el) f.el.remove();
      syncWin(from); rec().refs.ttl.textContent = rec().title; sfx('drop');
      return 'ok';
    }
    return 'invalid';
  }
  /** Rescue: a file whose home collapsed while it was in hand and that found no valid target. Fragments come back; junk is gone. */
  function rescue(f) {
    if (f.windowId && winById(f.windowId) && alive(winById(f.windowId))) return false;
    if (f.kind === 'frag' && phase === 'play') { S.files.splice(S.files.indexOf(f), 1); respawn(f.name); } else S.files.splice(S.files.indexOf(f), 1);
    return true;
  }

  /* ---------------- collapse ---------------- */
  function hurt() {
    S.hp--; hearts(); sfx('crunch'); desk.classList.remove('hurt'); void desk.offsetWidth; desk.classList.add('hurt');
    if (S.hp <= 0) lose();
  }
  function collapse(win, kind) {
    if (win.dead) return;
    win.dead = true; win.dying = kind; win.dyingAt = S.elapsed; win.closed = true; S.tasksDirty = true;
    if (win.refs.nf) win.refs.nf.hidden = true;
    if (S.hover === win) setHover(null);
    if (kind === 'collapse') sfx('crunch');
    S.wins.filter((k) => k.parentId === win.id).forEach((k) => collapse(k, kind));
    const mine = S.files.filter((f) => f.windowId === win.id);
    for (const f of mine) {
      if (f.held) { f.windowId = null; continue; }   // mercy: it is in your hand, not in the window
      S.files.splice(S.files.indexOf(f), 1);
      if (f.kind === 'frag' && kind === 'collapse' && phase === 'play') {
        S.lostFrags++; later(CONFIG.respawnDelayMs, () => respawn(f.name)); hurt();
      }
    }
  }
  function reap() {                                // dead windows leave once their shrink + 404 ghost (or polite close) is over
    for (const win of S.wins.slice()) {
      if (win.dead && S.elapsed - win.dyingAt >= (win.dying === 'close' ? CONFIG.closeMs : CONFIG.collapseMs + CONFIG.ghostMs)) { win.el.remove(); win.btn.remove(); S.wins.splice(S.wins.indexOf(win), 1); }
    }
  }

  /* ---------------- drag and drop (Pointer Events) ---------------- */
  function winAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      const m = el.closest ? el.closest('.mini-window') : null;
      if (m) return winById(m.dataset.win) || null;
    }
    return null;
  }
  function setHover(t) {
    const f = heldFile(), ok = t ? canDrop(f, t) : null, next = ok === null ? null : t;
    if (S.hover && S.hover !== next) S.hover.el.classList.remove('drop-ok', 'drop-bad');
    S.hover = next;
    if (next) { next.el.classList.toggle('drop-ok', ok === true); next.el.classList.toggle('drop-bad', ok === false); }
  }
  const hoverAt = (x, y) => setHover(winAt(x, y));
  function ghostAt(g, x, y) { g.style.transform = `translate(${x}px, ${y}px)`; }
  function startDrag(d) {
    const f = d.f, r = f.el.getBoundingClientRect();
    d.started = true; d.ox = d.sx - r.left; d.oy = d.sy - r.top; d.from = { x: r.left, y: r.top };
    const g = document.createElement('div');
    g.className = `ghost ${f.kind}`; g.innerHTML = '<span class="ic"></span><span class="nm"></span>';
    g.firstChild.textContent = f.el.firstChild.textContent; g.lastChild.textContent = f.name;
    $('drag-layer').appendChild(g); d.ghost = g; f.held = true; f.el.classList.add('held');
    try { desk.setPointerCapture(d.pid); } catch (e) { /* synthetic pointers cannot be captured */ }
    sfx('pick');
  }
  /** Shared by mouse and keyboard: drop on t, or give the file back. Returns the result. */
  function settle(f, t) {
    f.held = false; if (f.el) f.el.classList.remove('held');
    const res = dropFile(f, t);
    if (res !== 'ok' && !f.windowId) rescue(f);        // origin collapsed while in hand and nowhere valid to land
    setHover(null);
    syncWin(winById(f.windowId));
    return res;
  }
  function endDrag(x, y, cancelled) {
    const d = S.drag; S.drag = null;
    if (!d || !d.started) return;
    const f = d.f, g = d.ghost, res = settle(f, cancelled ? null : winAt(x, y));
    if (res === 'ok' || !f.windowId || !S.files.includes(f)) { g.remove(); return; }
    const r = f.el.getBoundingClientRect();           // back to the origin in 150 ms
    g.classList.add('back'); ghostAt(g, r.left, r.top);
    setTimeout(() => g.remove(), reducedMotion() ? 0 : 160);
  }
  const cancelDrag = () => { if (S.drag) endDrag(0, 0, true); if (S.wdrag) S.wdrag = null; if (S.kb) cancelKb(); };

  function startWinDrag(win, e) {
    const r = desk.getBoundingClientRect();
    S.wdrag = { win, pid: e.pointerId, ox: e.clientX - r.left - win.x, oy: e.clientY - r.top - win.y, sx: win.x, sy: win.y, kicks: 0, clamped: false };
    try { desk.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers cannot be captured */ }
  }
  function moveWin(e) {
    const wd = S.wdrag, r = desk.getBoundingClientRect(), { W, H } = dim(), win = wd.win;
    const nx = e.clientX - r.left - wd.ox, ny = e.clientY - r.top - wd.oy;
    win.x = clamp(nx, 30 - win.w, W - 30); win.y = clamp(ny, 0, H - 22);   // 30px of title bar always stays inside
    const hit = win.x !== nx || win.y !== ny;
    if (hit && !wd.clamped && ++wd.kicks >= CONFIG.clampKicks) {
      egg('wm-offscreen'); win.refs.nf.hidden = false;
      win.el.classList.add('snap'); win.x = wd.sx; win.y = wd.sy; S.wdrag = null;
      setTimeout(() => { win.refs.nf.hidden = true; win.el.classList.remove('snap'); }, 1300);
      return;
    }
    wd.clamped = hit;
  }

  desk.addEventListener('pointerdown', (e) => {
    if (phase !== 'play' || paused || e.button !== 0 || S.drag || S.wdrag || S.kb) return;
    const m = e.target.closest('.mini-window');
    if (!m) return;
    const win = winById(m.dataset.win); front(win);
    const fb = e.target.closest('.file'), f = fb ? fileById(fb.dataset.file) : null;
    if (f) { if (canPick(f)) S.drag = { f, pid: e.pointerId, sx: e.clientX, sy: e.clientY, started: false, cx: e.clientX, cy: e.clientY }; }
    else if (e.target.closest('.tb') && !e.target.closest('.tbtn')) startWinDrag(win, e);
  });
  desk.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (d && e.pointerId === d.pid) {
      if (!d.started && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= CONFIG.dragPx) startDrag(d);
      if (d.started) { d.cx = e.clientX; d.cy = e.clientY; ghostAt(d.ghost, e.clientX - d.ox, e.clientY - d.oy); hoverAt(e.clientX, e.clientY); }
    } else if (S.wdrag && e.pointerId === S.wdrag.pid) moveWin(e);
  });
  desk.addEventListener('pointerup', (e) => {
    if (S.drag && e.pointerId === S.drag.pid) endDrag(e.clientX, e.clientY, false);
    else if (S.wdrag && e.pointerId === S.wdrag.pid) S.wdrag = null;
  });
  // the pointer left the iframe, the shell took focus, or the browser cancelled it: treat as an invalid drop
  const lost = (e) => { if ((S.drag && e.pointerId === S.drag.pid) || (S.wdrag && e.pointerId === S.wdrag.pid)) cancelDrag(); };
  desk.addEventListener('pointercancel', lost);
  desk.addEventListener('lostpointercapture', lost);
  addEventListener('blur', () => { if (S.drag || S.wdrag) cancelDrag(); });
  desk.addEventListener('dblclick', (e) => {
    const fb = e.target.closest('.file');
    if (fb && phase === 'play' && !paused) openFile(fileById(fb.dataset.file));
  });

  /* ---------------- keyboard alternative ---------------- */
  const kbTargets = () => S.wins.filter((w) => (w.kind === 'recovery' || w.kind === 'bin') && alive(w) && !w.minimized);
  function cancelKb() { const k = S.kb; S.kb = null; if (k) settle(k.f, null); }
  document.addEventListener('keydown', (e) => {
    if (phase !== 'play' || paused) return;
    const k = S.kb;
    if (k) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const list = kbTargets();
        if (!list.length) return;
        k.idx = (k.idx + (e.shiftKey ? -1 : 1) + list.length) % list.length;
        const t = list[k.idx]; front(t); setHover(t); toast(`Target: ${t.title}. Space drops here.`);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const t = kbTargets()[k.idx];
        if (!t) { toast('Press Tab to choose a window first.'); return; }
        S.kb = null; const res = settle(k.f, t);
        toast(res === 'ok' ? 'Dropped.' : res === 'refused' ? 'Refused.' : 'Not a valid target. Put back.');
      } else if (e.key === 'Escape') { e.preventDefault(); cancelKb(); toast('Cancelled.'); }
      return;
    }
    const fb = e.target.closest ? e.target.closest('.file') : null;
    if (!fb) return;
    const f = fileById(fb.dataset.file);
    if (e.key === 'Enter') { e.preventDefault(); openFile(f); }
    else if (e.key === ' ' && canPick(f)) {
      e.preventDefault(); f.held = true; f.el.classList.add('held'); S.kb = { f, idx: -1 };
      sfx('pick'); toast(`Picked up ${f.name}. Tab: choose a window, Space: drop, Esc: cancel.`);
    }
  });

  /* ---------------- window chrome + taskbar ---------------- */
  desk.addEventListener('click', (e) => {
    const b = e.target.closest('.tbtn');
    if (!b || phase !== 'play' || paused) return;
    const win = winById(b.closest('.mini-window').dataset.win);
    if (b.dataset.act === 'min') setMinimized(win, true);
    else if (win.parentId) { win.closed = true; win.el.hidden = true; S.tasksDirty = true; }
    else toast("This window can't be closed right now.");
  });
  tasks.addEventListener('click', (e) => {
    const b = e.target.closest('.task');
    if (!b || phase !== 'play' || paused) return;
    const win = winById(b.dataset.task);
    if (win && alive(win)) setMinimized(win, false);
  });
  function renderTasks() {
    S.tasksDirty = false;
    const list = S.wins.filter(alive);
    place(tasks, list.map((w) => w.btn));
    const top = list.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
    for (const w of list) w.btn.classList.toggle('active', w === top);
  }

  /* ---------------- loop: one rAF clock, fixed step, pause = stop the clock ---------------- */
  function step() {
    S.elapsed += STEP;
    if (S.timers.length) {
      const due = S.timers.filter((t) => t.at <= S.elapsed);
      S.timers = S.timers.filter((t) => t.at > S.elapsed);
      due.forEach((t) => t.fn());
    }
    if (phase === 'play') {
      for (const win of S.wins) if (!win.dead && !win.parentId && win.dur && S.elapsed >= win.startAt + win.dur) collapse(win, 'collapse');
      const r = rec();
      if (phase === 'play' && S.ph === 3 && r && !reducedMotion() && !(S.wdrag && S.wdrag.win === r)) {       // Recovery drifts and bounces
        const { W, H } = dim();
        r.x += (S.vx * STEP) / 1000; r.y += (S.vy * STEP) / 1000;
        if (r.x < 0 || r.x > W - r.w) { S.vx = -S.vx; r.x = clamp(r.x, 0, W - r.w); }
        if (r.y < 0 || r.y > H - r.h) { S.vy = -S.vy; r.y = clamp(r.y, 0, H - r.h); }
      }
      if (S.drag && S.drag.started) hoverAt(S.drag.cx, S.drag.cy);   // the highlight must follow a window drifting under a still pointer
    }
    if (phase === 'assembling' && S.elapsed - S.winT0 >= CONFIG.assembleMs + 600) finishWin();
    reap();
    if (phase === 'losing' && !S.wins.length) showLose();
  }
  function render() {
    const t = S.elapsed;
    for (const win of S.wins) {
      const el = win.el, R = win.refs;
      el.style.transform = `translate(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px)`;
      el.style.zIndex = win.z;
      el.classList.toggle('dead', win.dead);
      if (win.dead) {
        const p = Math.min(1, (t - win.dyingAt) / (win.dying === 'close' ? CONFIG.closeMs : CONFIG.collapseMs)), ghost = win.dying === 'collapse' && p >= 1;
        R.inner.style.visibility = ghost ? 'hidden' : '';
        R.inner.style.transform = win.dying === 'close' ? `scale(${1 - 0.08 * p})` : reducedMotion() ? '' : `scale(${1 - p})`;
        R.inner.style.opacity = ghost ? 0 : win.dying === 'close' || reducedMotion() ? 1 - p : 1;
        R.g.hidden = !ghost;
        if (ghost) R.g.style.opacity = Math.min(1, (CONFIG.collapseMs + CONFIG.ghostMs - (t - win.dyingAt)) / 300);
        el.classList.remove('warn', 'failing');
        continue;
      }
      const rem = remainingMs(win), r = timerOf(win);
      el.classList.toggle('failing', rem !== null);
      el.classList.toggle('warn', rem !== null && rem <= CONFIG.warnMs && !reducedMotion());
      R.fail.textContent = rem === null ? '' : `Not responding ${Math.ceil(rem / 1000)}s`;
      if (rem !== null) el.style.setProperty('--m', `${Math.max(0, (rem / r.dur) * 100)}%`);
      win.btn.classList.toggle('fail', rem !== null && rem <= CONFIG.warnMs);
      if (phase === 'assembling' && win.kind === 'recovery') {
        const p = Math.min(1, (t - S.winT0) / CONFIG.assembleMs);
        el.style.setProperty('--p', p); el.classList.add('assembling'); el.classList.toggle('merged', p >= 1);
      }
    }
    if (S.tasksDirty) renderTasks();
    $('clock').textContent = fmtT(S.elapsed);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(now - last, 100) * SPEED;        // clamp so a stalled tab cannot fast-forward the run
    last = now;
    while (acc >= STEP && running()) { acc -= STEP; step(); }
    render();
  }
  function pause() {
    if (paused) return;
    paused = true; cancelAnimationFrame(raf); cancelDrag();
    document.body.classList.add('paused');
    if (phase === 'play') $('pause').hidden = false;
  }
  function resume() {
    if (!paused) return;
    paused = false;
    document.body.classList.remove('paused'); $('pause').hidden = true;
    if (running()) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  /* ---------------- run lifecycle ---------------- */
  const tooSmall = () => innerWidth < 760 || innerHeight < 480;
  function begin() {
    if (tooSmall()) { $('small').hidden = false; return; }
    if (soundOn && !ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    resume(); cancelAnimationFrame(raf); clearTimeout(typeT);
    cancelDrag();
    desk.querySelectorAll('.mini-window').forEach((n) => n.remove());
    $('drag-layer').textContent = ''; tasks.textContent = '';
    document.body.classList.remove('busy');
    for (const id of ['start', 'win', 'lose', 'help']) $(id).hidden = true;
    S = fresh(); phase = 'play'; acc = 0;
    hearts(); $('frags').textContent = `0/${CONFIG.slots}`;
    const [rw, rh] = CONFIG.size.recovery, [bw, bh] = CONFIG.size.bin, { W, H } = dim();
    const r = addWindow({ kind: 'recovery', title: 'Recovery', x: W - rw, y: 0.05 * (H - rh) });
    r.refs.label.textContent = `wm_core.exe: 0/${CONFIG.slots}`; syncWin(r);
    addWindow({ kind: 'bin', title: 'Recycle Bin', x: W - bw, y: H - bh });
    System32.progress('fragments', `0/${CONFIG.slots}`);
    startPhase(1);
    last = performance.now(); raf = requestAnimationFrame(frame);
    render();
  }
  function assemble() {                              // all four fragments are in
    if (phase !== 'play') return;
    phase = 'assembling'; S.winT0 = S.elapsed; cancelDrag(); sfx('win');
    S.timers = [];
    for (const w of S.wins) if (w.kind !== 'recovery' && w.kind !== 'bin' && !w.dead) collapse(w, 'close');   // politely
    rec().refs.label.textContent = 'assembling wm_core.exe…';
  }
  function finishWin() {
    phase = 'won'; S.finishMs = S.elapsed; cancelAnimationFrame(raf); render();
    rec().refs.label.textContent = 'wm_core.exe recovered';
    const w = $('win'), set = (k, v) => { w.querySelector(`[data-stat=${k}]`).textContent = v; };
    set('time', fmtT(S.finishMs)); set('lost', String(S.lostFrags)); set('stars', '♥'.repeat(stars()) + '♡'.repeat(CONFIG.hp - stars()));
    w.hidden = false; $('install').disabled = false; $('install').textContent = 'Install'; $('install').focus();
  }
  function lose() {
    if (phase !== 'play') return;
    phase = 'losing'; cancelDrag(); S.timers = [];
    document.body.classList.add('busy');
    if (!S.reported) { S.reported = true; System32.lost('core fragments lost'); }
    S.wins.filter((w) => !w.parentId && !w.dead).forEach((w, i) => later(i * CONFIG.loseGapMs, () => collapse(w, 'collapse')));
  }
  function showLose() {
    phase = 'lost'; cancelAnimationFrame(raf);
    $('lose-stats').textContent = `${S.recovered} of ${CONFIG.slots} fragments recovered · ${fmtT(S.elapsed)}`;
    $('lose').hidden = false; $('lose').querySelector('button').focus();
  }
  function install() {
    if (phase !== 'won' || S.reported) return;
    S.reported = true;
    System32.won({ timeMs: Math.max(1, Math.round(S.finishMs)), score: stars() });
    $('install').textContent = 'Installed ✓'; $('install').disabled = true;
  }

  /* ---------------- start screen ---------------- */
  const LINES = ['wm_core.exe: FILE NOT FOUND (404)', 'Attempting recovery…', '4 fragments located in unstable memory.'];
  function typeOut() {
    const term = $('term'), full = LINES.join('\n');
    let n = 0;
    $('begin').hidden = true;
    (function tick() {
      term.textContent = full.slice(0, n);
      if (n >= full.length) { $('begin').hidden = false; $('begin').focus(); return; }
      n += reducedMotion() ? full.length : 1;
      typeT = setTimeout(tick, full[n - 1] === '\n' ? 350 : 22);
    })();
  }
  const skipTyping = () => { clearTimeout(typeT); $('term').textContent = LINES.join('\n'); $('begin').hidden = false; };

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-do], #help-btn') : null;
    if (!t) { if (phase === 'start' && $('begin').hidden) skipTyping(); return; }
    const what = t.dataset.do;
    if (what === 'start') { e.preventDefault(); begin(); }
    else if (what === 'resume') resume();
    else if (what === 'install') install();
    else if (t.id === 'help-btn') { const h = $('help'); h.hidden = !h.hidden; t.setAttribute('aria-expanded', String(!h.hidden)); }
  });
  addEventListener('resize', () => {
    if (phase === 'start' && !$('small').hidden && !tooSmall()) $('small').hidden = true;
    const { W, H } = dim();
    for (const w of S.wins) { w.x = clamp(w.x, 30 - w.w, W - 30); w.y = clamp(w.y, 0, H - 22); }
  });

  System32.onInit((init) => { soundOn = !!(init && init.soundOn); });
  System32.onPause(pause);
  System32.onResume(resume);

  /* ---------------- debug / test hooks ---------------- */
  if (DEBUG) {
    window.__WM404 = {
      state: () => ({
        phase, paused, seed: SEED, hp: S.hp, ph: S.ph, elapsed: S.elapsed, recovered: S.recovered, lostFrags: S.lostFrags, stars: stars(), reported: S.reported,
        pending: S.timers.length, dragging: !!(S.drag && S.drag.started), kb: !!S.kb, hover: S.hover && S.hover.id, vx: S.vx, vy: S.vy,
        slots: S.slots.map((id) => { const f = id && fileById(id); return f ? { id: f.id, name: f.name, kind: f.kind } : null; }),
        wins: S.wins.map((w) => ({ id: w.id, kind: w.kind, title: w.title, x: w.x, y: w.y, w: w.w, h: w.h, z: w.z, minimized: w.minimized, closed: w.closed, dead: w.dead, dying: w.dying, parentId: w.parentId, startAt: w.startAt, dur: w.dur, remaining: remainingMs(w), drop: w.el.classList.contains('drop-ok') ? 'ok' : w.el.classList.contains('drop-bad') ? 'bad' : '' })),
        files: S.files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, windowId: f.windowId, slot: f.slot, held: f.held, childId: f.childId })),
      }),
      move(fileId, winId) { const f = fileById(fileId), t = winById(winId); return f && t ? settle(f, t) : 'missing'; },
      collapse(winId) { const w = winById(winId); if (w) collapse(w, 'collapse'); },
      skipToPhase(n) {
        if (phase !== 'play') begin();
        for (const w of S.wins.slice()) if (w.kind !== 'recovery' && w.kind !== 'bin') { w.el.remove(); w.btn.remove(); S.wins.splice(S.wins.indexOf(w), 1); }
        S.files = []; S.slots.fill(null); S.timers = []; S.ph = 0;
        for (let i = 0; i < [0, 2, 3][n - 1]; i++) putInSlot(addFile(`core_0${i + 1}.frag`, rec().id), i);
        syncWin(rec()); checkPhase(); if (S.ph !== n) startPhase(n);
      },
      begin, config: CONFIG, forceLose() { S.hp = 1; hurt(); },
    };
  }

  typeOut();
  System32.ready();
})();
