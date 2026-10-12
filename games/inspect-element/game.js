/* Inspect Element: three locks, solved with the real DevTools. Classic script; no storage, cookies or modals.
   Everything is delegated on `document` and elements are looked up by id every time, so players can delete
   or recreate nodes without breaking (or crashing) the page. Player-editable data only ever goes in via textContent. */
(function () {
  'use strict';

  const LOCKS = ['password', 'button', 'role'];
  const LABEL = { password: 'Password', button: 'Button', role: 'Access level' };
  const NUDGE_MS = 60000;                       // idle time (unpaused) before the ? button wiggles
  // The password is stored as reversed char codes so a Sources search for it only finds the HTML comment.
  const KEY = [50, 114, 101, 116, 110, 117, 104];
  const secretOk = (v) => v.length === KEY.length && [...v].every((c, i) => c.charCodeAt(0) === KEY[KEY.length - 1 - i]);

  const HINTS = {
    password: ['Developers leave notes. Not in the page, in the code.', 'Look for grey <!-- … --> text near the login form in Elements.', "It's the one for previous_user."],
    button: ["Something is telling this button it can't be clicked.", 'Select the button in Elements. Look at its attributes.', 'Double-click `disabled` and delete it.'],
    role: ['The bank checks who you are… on your computer.', 'There\'s a hidden input in the form. Also a hidden note somewhere.', "Change the `role` input's value to `admin`."],
  };

  const qs = new URLSearchParams(location.search);
  const DEBUG = qs.get('debug') === '1';
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const stars = () => (S.kiddie ? 0 : Math.max(0, 3 - LOCKS.filter((l) => S.hints[l] >= 2).length));   // tier 1 is free

  const S = {
    startedAt: null, elapsedMs: 0, paused: false,
    locks: { password: false, button: false, role: false },
    hints: { password: 0, button: 0, role: 0 },
    won: false, installed: false, dashboard: false, kiddie: false, authing: false,
    count: 0, lastProgress: 0, nudged: false,
  };
  const sent = {};                              // eggs already reported this load
  let soundOn = false, ac = null, raf = 0, last = 0;

  /* ---------------- sound ---------------- */
  function tone(f, at, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + at;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sfx(name) {
    if (!soundOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      if (name === 'lock') tone(1040, 0, 0.09, 'square', 0.05);
      else if (name === 'buzz') tone(110, 0, 0.25, 'sawtooth', 0.08);
      else if (name === 'win') [523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.1));
    } catch (e) { /* audio is never essential */ }
  }

  /* ---------------- clock: counts unpaused time from the first interaction ---------------- */
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (S.paused || S.installed) { last = now; return; }
    S.elapsedMs += Math.min(now - last, 250);
    last = now;
    if (!S.nudged && !S.dashboard && S.elapsedMs - S.lastProgress >= NUDGE_MS) nudge();
    if (S.dashboard) renderStats();
  }
  function startClock() {
    if (S.startedAt !== null) return;
    S.startedAt = performance.now();
    last = S.startedAt;
    raf = requestAnimationFrame(tick);
  }
  function nudge() {
    S.nudged = true;                            // once per idle stretch; never auto-reveals anything
    const b = $('help-btn');
    if (REDUCED || !b) return;
    b.classList.remove('wiggle'); void b.offsetWidth; b.classList.add('wiggle');
  }

  /* ---------------- locks ---------------- */
  function evaluate() {
    const pw = $('password'), btn = $('login-btn'), role = $('role');
    const now = {
      password: !!pw && secretOk(String(pw.value).trim()),
      button: !!btn && !btn.disabled,
      role: !!role && role.value === 'admin',
    };
    for (const k of LOCKS) {
      if (now[k] === S.locks[k]) continue;
      S.locks[k] = now[k];
      const li = document.querySelector(`#lock-row [data-lock="${k}"]`);
      if (li) {
        li.classList.toggle('on', now[k]);
        if (now[k]) { sfx('lock'); li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop'); }
      }
    }
    const n = LOCKS.filter((k) => S.locks[k]).length;
    if (n !== S.count) {
      if (n > S.count) { S.lastProgress = S.elapsedMs; S.nudged = false; }
      S.count = n;
      System32.progress('locks', `${n}/3`);
      renderHints();
    }
  }
  const allSolved = () => LOCKS.every((k) => S.locks[k]);
  const currentLock = () => LOCKS.find((k) => !S.locks[k]) || null;

  /* ---------------- eggs that depend on what the player did to the page ---------------- */
  function egg(id) {
    if (sent[id]) return false;
    sent[id] = true;
    System32.effect('egg', { egg: id });
    return true;
  }
  function checkEggs() {
    const pw = $('password');
    if (pw && pw.type !== 'password') {         // the classic DevTools trick: reveal the field
      const c = $('classic');
      if (c) c.hidden = false;
      egg('inspect-wrong-door');
    }
    if (!S.dashboard && !$('login-card') && !$('deleted')) {
      const d = document.createElement('div');
      d.id = 'deleted';
      d.setAttribute('data-ui', '');
      d.textContent = 'You deleted the bank. Honestly? Fair. Press ⟳ to restore it.';
      document.body.append(d);
      egg('inspect-deleted-bank');
    }
    const bal = $('balance');
    if (S.dashboard && bal && bal.textContent.trim() !== '₹0.00') {
      const r = $('rich');
      if (r) r.hidden = false;
      egg('inspect-rich');
    }
  }

  /* ---------------- submit ---------------- */
  function setMsg(text, ok) {
    const m = $('msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('ok', !!ok);
  }

  function submit() {
    evaluate();
    const pw = $('password'), btn = $('login-btn'), role = $('role');
    // Re-check everything here: never trust the lock row. Only the first failing lock is reported.
    if (!(pw && secretOk(String(pw.value).trim()))) { sfx('buzz'); return setMsg('Incorrect password. 2 attempts remaining. (just kidding, infinite)'); }
    if (!(btn && !btn.disabled)) { sfx('buzz'); return setMsg('Login temporarily disabled for your security.'); }
    const r = role ? String(role.value) : '';
    if (r === 'admin') return authenticate();
    sfx('buzz');
    if (r === 'customer') return setMsg('Login successful. Access level: customer. Admin access required to restore admin_access.dll.', true);
    setMsg(`Unknown access level: '${r}'.`);
  }

  function authenticate() {
    if (S.authing || S.dashboard) return;
    S.authing = true;
    setMsg('');
    const a = $('auth');
    if (a) { a.hidden = false; const sp = a.querySelector('.spin'); if (REDUCED && sp) sp.hidden = true; }   // static text under reduced motion
    setTimeout(() => { S.authing = false; if (a) a.hidden = true; showDashboard(); }, 600);
  }

  /* ---------------- dashboard + win ---------------- */
  function renderStats() {
    const set = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };
    set('s-time', fmt(S.elapsedMs));
    set('s-hints', String(S.hints.password + S.hints.button + S.hints.role));
    set('s-stars', '★'.repeat(stars()) + '☆'.repeat(3 - stars()));
  }

  function showDashboard() {
    if (S.dashboard) return;
    S.dashboard = true;
    const lv = $('login-view'), db = $('dashboard'), who = $('who');
    if (lv) lv.hidden = true;                   // hidden, not removed: removing it would look like a deleted bank
    if (db) db.hidden = false;
    if (who) who.textContent = S.kiddie ? 'script kiddie' : 'admin';
    if (S.installed) lockInstall();
    renderStats();
    checkEggs();
  }
  function lockInstall() {
    const b = $('install');
    if (b) { b.textContent = 'Installed ✓'; b.disabled = true; }
  }

  const realWon = System32.won;                 // the shell's real call; only our Install button may reach it directly
  function install() {
    if (S.won) return;
    S.won = S.installed = true;
    realWon({ timeMs: Math.max(1, Math.round(S.elapsedMs)), score: stars() });
    lockInstall();
    renderStats();
    sfx('win');
  }
  // Calling System32.won() from the Console before the locks are solved still works (it is a hacking game)...
  System32.won = function () {
    if (S.won) return;
    if (!allSolved()) { S.kiddie = true; egg('inspect-script-kiddie'); }   // ...but you get a nickname and zero stars
    S.won = S.installed = true;
    realWon({ timeMs: Math.max(1, Math.round(S.elapsedMs)), score: stars() });
    showDashboard();
  };

  /* ---------------- help card ---------------- */
  function renderHints() {
    const list = $('hint-list'), btn = $('hint-btn'), title = $('hint-title');
    if (!list || !btn || !title) return;
    const cur = currentLock();
    list.textContent = '';
    if (!cur) { title.textContent = 'All locks solved'; btn.hidden = true; return; }
    const n = S.hints[cur];
    title.textContent = `Hints: ${LABEL[cur]} lock`;
    for (let i = 0; i < n; i++) { const li = document.createElement('li'); li.textContent = HINTS[cur][i]; list.append(li); }
    btn.hidden = n >= HINTS[cur].length;
    btn.textContent = `Show hint ${n + 1}${n === 1 ? ' (costs a star)' : ''}`;
  }
  function revealHint() {
    const cur = currentLock();
    if (cur && S.hints[cur] < HINTS[cur].length) { S.hints[cur]++; renderHints(); if (S.dashboard) renderStats(); }
  }
  function toggleHelp() {
    const card = $('help-card'), btn = $('help-btn');
    if (!card) return;
    card.hidden = !card.hidden;
    if (btn) btn.setAttribute('aria-expanded', String(!card.hidden));
  }

  /* ---------------- events (all delegated) ---------------- */
  document.addEventListener('submit', (e) => { e.preventDefault(); startClock(); submit(); }, true);
  document.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.id === 'help-btn') toggleHelp();
    else if (t.id === 'hint-btn') revealHint();
    else if (t.id === 'install') install();
    else if (t.id === 'forgot') { const f = $('forgot-text'); if (f) f.textContent = 'We forgot it too.'; }
  });
  for (const type of ['input', 'change', 'pointerover', 'focusin']) {
    document.addEventListener(type, () => { startClock(); evaluate(); checkEggs(); }, true);
  }
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, startClock, true);

  // DevTools edits arrive as DOM mutations. Ignore writes this script makes itself ([data-ui] nodes).
  // Attached only after parsing: the parser's trailing whitespace nodes would otherwise start the clock at page load.
  const observer = new MutationObserver((records) => {
    const mine = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return !!(el && el.closest('[data-ui]')); };
    if (records.every((r) => mine(r.target))) return;
    startClock(); evaluate(); checkEggs();
  });
  const watch = () => observer.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'type', 'value', 'id'],
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  System32.onPause(() => { S.paused = true; });
  System32.onResume(() => { S.paused = false; last = performance.now(); });
  System32.onInit((init) => {
    init = init || {};
    soundOn = !!init.soundOn;
    const b = $('best');
    if (b && typeof init.bestTimeMs === 'number') { b.hidden = false; b.textContent = `Best: ${fmt(init.bestTimeMs)}`; }
  });

  if (DEBUG) {
    window.__INSPECT = {
      state: () => ({ startedAt: S.startedAt, elapsedMs: S.elapsedMs, paused: S.paused, locks: { ...S.locks }, hintsRevealed: { ...S.hints }, won: S.won, installed: S.installed, dashboard: S.dashboard, kiddie: S.kiddie, stars: stars(), count: S.count }),
      solve(lock) {
        const pw = $('password'), btn = $('login-btn'), role = $('role');
        if (lock === 'password' && pw) { pw.value = 'hunter2'; pw.dispatchEvent(new Event('input', { bubbles: true })); }
        else if (lock === 'button' && btn) btn.removeAttribute('disabled');
        else if (lock === 'role' && role) role.value = 'admin';
        evaluate();
      },
      reset: () => location.reload(),
    };
  }

  evaluate();
  renderHints();
  System32.ready();
})();
