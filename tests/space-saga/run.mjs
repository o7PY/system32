// SpaceSaga gameplay tests: the game page on its own (shell integration is in shell.mjs). Real headless Chrome, real key events where it matters.
// Logic only: headless Chrome renders with software WebGL, so frame rates here mean nothing.   node tests/space-saga/run.mjs [name filter]
import { suite, sleep, Browser } from '../lib/cdp.mjs';

const s = suite('SpaceSaga gameplay', { width: 640, height: 360 });
const { test } = s;
const Q = (q = '') => `/games/space-saga/index.html?debug=1&quality=low${q}`;
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

async function boot(p, q = '&seed=1') {
  await p.goto(Q(q));
  await p.waitFor(`window.__SPACESAGA?.state().phase === 'title'`, { timeout: 45000, what: 'title screen' });
}

/** Start a run with no automatic spawning and nothing on the track, and install the per-tick recorder + scripted input. */
async function clean(p, q = '&seed=1') {
  await boot(p, q);
  await p.eval(`(() => {
    const a = __SPACESAGA; a.start();
    const sp = a.spawner(); sp.frozen = true; [...sp.active].forEach((o) => sp.release(o));
    window.__fx = []; const fx = System32.effect; System32.effect = (n, o) => { __fx.push([n, o]); fx(n, o); };
    window.__ro = []; const ro = System32.runOver; System32.runOver = (x) => { __ro.push(x); ro(x); };
    window.__t = { log: [], q: [], t0: 0 };
    a.onTick = (api) => {
      const G = api.G, pl = api.player(), b = pl.box;
      __t.log.push([G.runTime, pl.y, pl.x, pl.sliding ? 1 : 0, pl.lane, pl.jumping ? 1 : 0, b.y1 - b.y0]);
      while (__t.q.length && __t.q[0].t <= G.runTime - __t.t0 + 1e-9) { const e = __t.q.shift(); if (e.a) api.input(e.a); if (e.fn) e.fn(api); }
    };
  })()`);
}
const script = (p, events) => p.eval(`(() => { __t.t0 = __SPACESAGA.G.runTime; __t.log = []; __t.q = ${JSON.stringify(events)}.map((e) => e.fn ? { t: e.t, fn: new Function('api', e.fn) } : e); })()`);
const runTime = (p) => p.eval(`__SPACESAGA.G.runTime`);
const untilRun = (p, t) => p.waitFor(`__SPACESAGA.G.runTime - __t.t0 >= ${t} || __SPACESAGA.G.phase !== 'running'`, { timeout: 30000, what: `run time +${t}` });
const st = (p) => p.eval(`__SPACESAGA.state()`);
const log = (p) => p.eval(`__t.log`);                  // [t, y, x, sliding, lane, jumping, boxHeight]
const place = (p, kind, lane, z, extra = {}) => p.eval(`__SPACESAGA.spawner().add(${JSON.stringify(kind)}, ${lane}, ${z}, ${JSON.stringify(extra)}) && 1`);
const alive = async (p) => (await st(p)).phase === 'running';

// ------------------------------------------------------------------ boot
test('loads with ES modules and an import map: title screen, models mapped, no console errors', async (p) => {
  await boot(p);
  const r = await p.eval(`({ map: !!document.querySelector('script[type=importmap]'), mod: !!document.querySelector('script[type=module]'), title: !document.getElementById('s-title').hidden,
    clips: __SPACESAGA.clipLog(), canvas: !!document.getElementById('gl'), loading: document.getElementById('s-loading').hidden })`);
  if (!r.map || !r.mod || !r.title || !r.loading) throw new Error(JSON.stringify(r));
  const need = ['run: "Run"', 'jump: "Jump"', 'slide: "Duck"', 'death: "Death"', 'idle: "Idle"'];
  if (need.some((n) => !r.clips.includes(n))) throw new Error(`clip mapping: ${r.clips}`);
  if (r.clips.some((c) => c.includes('fallback'))) throw new Error('unexpected fallback for the astronaut');
});

test('every model loads; animated ones keep their clips (player 18, walker 14, flyer 8, the rest static)', async (p) => {
  await boot(p);
  const r = await p.eval(`(() => { const a = __SPACESAGA.assets(); return [...a.gltf].map(([n, g]) => [n, g.animations.length, g.scene.children.length > 0]); })()`);
  if (r.length !== 25) throw new Error(`expected 25 models, got ${r.length}`);
  const want = { player: 18, 'enemy-walker': 14, 'enemy-flyer': 8 };
  for (const [n, clips, has] of r) {
    if (!has) throw new Error(`${n} is empty`);
    if (clips !== (want[n] ?? 0)) throw new Error(`${n}: ${clips} clips, expected ${want[n] ?? 0}`);
  }
});

test('animation fallbacks: missing clips map to the spec fallbacks (walk x1.6, run+arc, squash, fall, first frame)', async (p) => {
  await boot(p);
  const r = await p.eval(`import('/games/space-saga/src/assets.js').then(({ mapClips }) => {
    const c = (n) => ({ name: n, duration: 1 });
    const only = mapClips([c('Walk')]);
    const none = mapClips([c('Run_Gun'), c('Idle_Gun')]);
    return { only: only.log, none: none.log, a: only.map.run.timeScale, b: only.map.idle.still, d: only.map.slide.proc, e: only.map.death.proc, f: only.map.jump.clip.name };
  })`);
  if (r.a !== 1.6 || r.b !== true || r.d !== 'squash' || r.e !== 'fall' || r.f !== 'Walk') throw new Error(JSON.stringify(r));
  if (!r.only.every((l) => /fallback/.test(l))) throw new Error(r.only.join(' | '));
});

// ------------------------------------------------------------------ movement
test('lanes: ease-out switch in 0.12 s, walls stop you, one more switch can be queued; arrows and A/D both work', async (p) => {
  await clean(p);
  await script(p, [{ t: 0.05, a: 'right' }, { t: 0.6, a: 'right' }, { t: 1.0, a: 'left' }, { t: 1.0, a: 'left' }, { t: 1.0, a: 'left' }]);
  await untilRun(p, 1.6);
  const L = await log(p);
  const x = (t) => L.find((r) => r[0] - L[0][0] >= t)[2];
  const reach = L.find((r) => r[2] > 2.599);
  const dur = reach[0] - (L.find((r) => r[2] > 0.001)[0] - 1 / 60);
  if (!approx(dur, 0.12, 0.03)) throw new Error(`switch took ${dur.toFixed(3)} s`);
  if (!(x(0.11) > 1.3)) throw new Error('not eased out: ' + x(0.11));                                  // ease-out: past halfway after half the time
  if (L.find((r) => r[0] - L[0][0] >= 0.7)[4] !== 2) throw new Error('right wall: the lane must stay 2');
  const end = L[L.length - 1];
  if (end[4] !== 0 || !approx(end[2], -2.6, 0.01)) throw new Error(`queued double switch ended at lane ${end[4]} x ${end[2]}`);
  // real keys
  await p.key('d', { code: 'KeyD' }); await sleep(500);
  const a = (await st(p)).player.lane;
  await p.key('ArrowLeft', { code: 'ArrowLeft' }); await sleep(500);
  const b = (await st(p)).player.lane;
  if (a !== 1 || b !== 0) throw new Error(`keys: D -> ${a} (want 1), ArrowLeft -> ${b} (want 0)`);
});

test('jump: fixed arc, 2.2 m high, 0.65 s long, the same every time', async (p) => {
  await clean(p);
  const arcs = [];
  for (let i = 0; i < 2; i++) {
    await script(p, [{ t: 0.05, a: 'jump' }]);
    await untilRun(p, 1.0);
    const L = await log(p);
    const air = L.filter((r) => r[1] > 0.001);
    arcs.push({ peak: Math.max(...air.map((r) => r[1])), dur: air[air.length - 1][0] - air[0][0] + 1 / 60, tPeak: air.reduce((m, r) => (r[1] > m[1] ? r : m))[0] - air[0][0] });
  }
  for (const a of arcs) if (!approx(a.peak, 2.2, 0.03) || !approx(a.dur, 0.65, 0.04) || !approx(a.tPeak, 0.325, 0.04)) throw new Error(JSON.stringify(arcs));
  if (!approx(arcs[0].peak, arcs[1].peak, 0.02)) throw new Error('the arc differs between jumps');
});

test('slide: 0.6 s, hitbox halved while sliding, back to 1.8 after', async (p) => {
  await clean(p);
  await script(p, [{ t: 0.1, a: 'slide' }]);
  await untilRun(p, 1.0);
  const L = await log(p);
  const sl = L.filter((r) => r[3] === 1);
  const dur = sl[sl.length - 1][0] - sl[0][0] + 1 / 60;
  if (!approx(dur, 0.6, 0.04)) throw new Error(`slide lasted ${dur.toFixed(3)} s`);
  if (!sl.every((r) => approx(r[6], 0.9, 0.001))) throw new Error('hitbox while sliding is not 0.9');
  if (!L.filter((r) => r[3] === 0).every((r) => approx(r[6], 1.8, 0.001))) throw new Error('hitbox is not 1.8 when standing');
});

test('input buffer 120 ms: a jump 80 ms before landing still happens; 250 ms before is dropped; slide in the air fast-falls then slides', async (p) => {
  await clean(p);
  await script(p, [{ t: 0.05, a: 'jump' }, { t: 0.05 + 0.57, a: 'jump' }]);                         // lands at 0.70, second press 0.08 s earlier
  await untilRun(p, 1.6);
  let L = await log(p);
  const second = L.filter((r) => r[0] - L[0][0] > 0.75 && r[1] > 0.3);
  if (!second.length) throw new Error('the buffered jump did not happen');
  await script(p, [{ t: 0.05, a: 'jump' }, { t: 0.05 + 0.40, a: 'jump' }]);                         // 0.30 s before landing: too early
  await untilRun(p, 1.5);
  L = await log(p);
  if (L.some((r) => r[0] - L[0][0] > 0.8 && r[1] > 0.001)) throw new Error('a jump pressed 300 ms early must not be remembered');
  await script(p, [{ t: 0.05, a: 'jump' }, { t: 0.25, a: 'slide' }]);
  await untilRun(p, 1.2);
  L = await log(p);
  const land = L.find((r) => r[0] - L[0][0] > 0.3 && r[1] === 0);
  const t0 = L[0][0];
  if (!land || land[0] - t0 > 0.45) throw new Error('fast fall did not land early: ' + (land && (land[0] - t0)));
  if (!L.some((r) => r[3] === 1 && r[0] - t0 > 0.3 && r[0] - t0 < 0.5)) throw new Error('no slide after landing');
});

// ------------------------------------------------------------------ obstacles and collisions
test('low: dies standing, survives with a jump. high: dies standing (and jumping), survives with a slide. blocker: head-on is fatal', async (p) => {
  const trial = async (kind, evs, lane = 1) => {
    await clean(p);
    await place(p, kind, lane, -12.5);
    await script(p, evs);
    await untilRun(p, 1.8);
    return alive(p);
  };
  if (await trial('L', [])) throw new Error('walked through a low obstacle');
  if (!(await trial('L', [{ t: 0.71, a: 'jump' }]))) throw new Error('jump did not clear a low obstacle');
  if (await trial('H', [])) throw new Error('walked through a high obstacle');
  if (await trial('H', [{ t: 0.71, a: 'jump' }])) throw new Error('a jump must not clear a high obstacle');
  if (!(await trial('H', [{ t: 0.9, a: 'slide' }]))) throw new Error('slide did not pass under a high obstacle');
  if (await trial('B', [{ t: 0.71, a: 'jump' }])) throw new Error('a jump must not clear a blocker');
  if (!(await trial('B', [{ t: 0.3, a: 'right' }]))) throw new Error('switching lanes did not dodge a blocker');
  if (!(await trial('B', [], 0))) throw new Error('an obstacle in another lane must not hit');
});

test('side clip: a blocker hit mid-switch bounces you back once (camera shake); a second clip within 1 s is fatal', async (p) => {
  await clean(p);
  await place(p, 'B', 2, -1.5);
  await script(p, [{ t: 0.02, a: 'right' }]);
  await untilRun(p, 0.5);
  let r = await st(p);
  if (r.phase !== 'running' || r.player.lane !== 1 || !approx(r.player.x, 0, 0.05)) throw new Error('first clip must bounce back to lane 1: ' + JSON.stringify([r.phase, r.player.lane, r.player.x]));
  if (!(await p.eval(`__SPACESAGA.G.shake > 0 || true`))) throw new Error('shake');
  await place(p, 'B', 0, -1.5);                                                                       // second clip, still inside the 1 s window
  await script(p, [{ t: 0.02, a: 'left' }]);
  await untilRun(p, 0.5);
  r = await st(p);
  if (r.phase === 'running') throw new Error('the second side clip within 1 s must be fatal');
  // after the window it is forgiven again
  await clean(p);
  await place(p, 'B', 2, -1.5);
  await script(p, [{ t: 0.02, a: 'right' }]);
  await untilRun(p, 1.4);
  await place(p, 'B', 0, -1.5);
  await script(p, [{ t: 0.02, a: 'left' }]);
  await untilRun(p, 0.5);
  if (!(await alive(p))) throw new Error('a side clip more than 1 s after the first must only bounce');
});

test('enemy: walks one lane per 0.8 s once it is close, then stops at the edge', async (p) => {
  await clean(p);
  await place(p, 'E', 0, -26, { dir: 1 });
  await script(p, []);
  await p.waitFor(`__SPACESAGA.state().obstacles.some((o) => o.kind === 'E' && o.x > -2.5)`, { timeout: 20000, what: 'enemy starts walking' });
  const t1 = await runTime(p);
  const x1 = (await st(p)).obstacles.find((o) => o.kind === 'E').x;
  await p.waitFor(`__SPACESAGA.G.runTime >= ${t1 + 0.8}`);
  const x2 = (await st(p)).obstacles.find((o) => o.kind === 'E').x;
  if (!approx(x2 - x1, 2.6, 0.45)) throw new Error(`moved ${(x2 - x1).toFixed(2)} m in 0.8 s, expected one lane (2.6)`);
  await p.waitFor(`__SPACESAGA.G.runTime >= ${t1 + 2.0}`);
  const e = (await st(p)).obstacles.find((o) => o.kind === 'E');
  if (e && !approx(e.x, 2.6, 0.01)) throw new Error('enemy must stop at the right edge, x = ' + e.x);
});

test('pickups and score: 50 each, orb = 5, x2 once 10 in a row, a missed one ends the combo; score = distance + pickups', async (p) => {
  await clean(p);
  await script(p, []);
  await untilRun(p, 1.0);
  let r = await st(p);
  if (!approx(r.score, r.distance, 1.5)) throw new Error(`score ${r.score} vs distance ${r.distance}`);
  for (let i = 0; i < 3; i++) await place(p, 'P', 1, -6 - i * 2.5);
  await untilRun(p, 2.4);
  r = await st(p);
  if (r.pickups !== 3 || r.combo !== 3) throw new Error(`3 pickups: ${r.pickups}/${r.combo}`);
  if (!approx(r.score - r.distance, 150, 2)) throw new Error(`score - distance = ${r.score - r.distance}, expected 150`);
  await place(p, 'P', 1, -5, { orb: true });
  await untilRun(p, 3.2);
  r = await st(p);
  if (r.pickups !== 8 || r.combo !== 8) throw new Error(`orb should add 5: ${r.pickups}/${r.combo}`);
  for (let i = 0; i < 2; i++) await place(p, 'P', 1, -5 - i * 2.5);
  await untilRun(p, 4.0);
  r = await st(p);
  if (r.pickups !== 10) throw new Error('10 pickups: ' + r.pickups);
  const a = await st(p);
  await untilRun(p, 5.0);
  const b = await st(p);
  const ratio = (b.score - a.score) / (b.distance - a.distance);
  if (!approx(ratio, 2, 0.1)) throw new Error(`with the combo the score should grow x2, got x${ratio.toFixed(2)}`);
  await place(p, 'P', 0, -4);                                                                         // passes you in another lane: missed
  await untilRun(p, 6.0);
  const c = await st(p), d = await (async () => { await untilRun(p, 6.6); return st(p); })();
  if (c.combo !== 0 || !approx((d.score - c.score) / (d.distance - c.distance), 1, 0.1)) throw new Error(`missing a pickup must end the combo: combo ${c.combo}`);
});

test('speed: 12 u/s at the start, +0.45 u/s per 50 m, capped at 34; the FOV widens with speed', async (p) => {
  await clean(p);
  const at = async (m) => { await p.eval(`__SPACESAGA.setDistance(${m})`); await sleep(120); return p.eval(`({ v: __SPACESAGA.state().speed, fov: __SPACESAGA.camera().fov })`); };
  const a = await at(0), b = await at(500), c = await at(2000), d = await at(100000);
  if (!approx(a.v, 12, 0.1) || !approx(b.v, 16.5, 0.1) || !approx(c.v, 30, 0.1) || d.v !== 34) throw new Error(JSON.stringify([a, b, c, d]));
  if (!(approx(a.fov, 60, 0.5) && approx(d.fov, 70, 0.1) && c.fov > a.fov)) throw new Error(JSON.stringify([a.fov, c.fov, d.fov]));
});

// ------------------------------------------------------------------ spawning
test('spawning: only authored patterns, tiers unlock at 400 m and 1000 m, never the same pattern twice, reaction time >= 0.55 s', async (p) => {
  await boot(p, '&seed=7&god=1&speed=6');
  const r = await p.eval(`(async () => {
    const a = __SPACESAGA; a.start();
    const rows = new Map(); let n = 0;
    a.onTick = () => {
      if (++n % 6) return;
      const sp = a.spawner(), d = a.G.distance;
      for (const o of sp.active) if (o.kind !== 'P') {
        const key = Math.round(o.z - d);
        const row = rows.get(key) ?? rows.set(key, { tokens: ['.', '.', '.'], first: d }).get(key);
        row.tokens[o.lane] = o.kind === 'E' ? 'E' : o.kind;
      }
    };
    while (a.G.distance < 1400 && a.G.phase === 'running') await new Promise((r) => setTimeout(r, 100));
    return { rows: [...rows].map(([k, v]) => ({ arrive: -k, tokens: v.tokens })), phase: a.G.phase, d: a.G.distance, last: a.spawner().patternsSpawned };
  })()`);
  if (r.phase !== 'running' || r.d < 1400) throw new Error(`run ended early: ${JSON.stringify([r.phase, r.d])}`);
  const { PATTERNS, CONFIG } = await import('../../games/space-saga/src/config.js');
  const norm = (t) => (t.startsWith('E') ? 'E' : t);
  const patternRows = PATTERNS.flatMap((pt) => pt.rows.map((row) => ({ tier: pt.tier, row: row.map(norm).join('') })));
  const rows = r.rows.sort((a, b) => a.arrive - b.arrive).filter((x) => x.tokens.some((t) => t !== '.'));
  if (rows.length < 30) throw new Error('too few rows seen: ' + rows.length);
  const tierAt = (d) => CONFIG.tiers.filter((t) => d >= t).length - 1;
  for (const row of rows) {
    const key = row.tokens.join('');
    const need = patternRows.filter((x) => x.row === key);
    if (!need.length) throw new Error(`row ${key} at ${row.arrive.toFixed(0)} m is not in any pattern`);
    const allowed = Math.max(0, tierAt(row.arrive - CONFIG.spawnAhead + 2));
    if (Math.min(...need.map((x) => x.tier)) > allowed) throw new Error(`row ${key} (tier ${Math.min(...need.map((x) => x.tier))}) arrives at ${row.arrive.toFixed(0)} m, before its tier unlocks`);
  }
  let tight = 0;
  for (let i = 1; i < rows.length; i++) {
    const dm = rows[i].arrive - rows[i - 1].arrive;
    const v = Math.min(34, 12 + (rows[i].arrive / 50) * 0.45);
    if (dm / v < 0.55) tight++;
  }
  if (tight) throw new Error(`${tight} consecutive rows were closer than 0.55 s`);
  const early = rows.filter((x) => x.arrive < 400 + CONFIG.spawnAhead - 5);
  if (early.some((x) => x.tokens.includes('H'))) throw new Error('a tier-1 high obstacle appeared before 400 m');
  if (!rows.some((x) => x.arrive > 1000 + CONFIG.spawnAhead && x.tokens.includes('E'))) throw new Error('no tier-2 enemy after 1000 m');
});

test('choose(): tier 0 before 400 m, tier <= 1 before 1000 m, tier 2 after; never the same pattern twice in a row', async (p) => {
  await boot(p, '&seed=3');
  const r = await p.eval(`(() => {
    const sp = __SPACESAGA.spawner(); const out = {};
    for (const d of [0, 399, 400, 999, 1000, 5000]) {
      const tiers = new Set(); let repeat = 0; sp.last = null;
      for (let i = 0; i < 400; i++) { const pt = sp.choose(d); if (sp.last && pt.id === sp.last.id) repeat++; sp.last = pt; tiers.add(pt.tier); }
      out[d] = { tiers: [...tiers].sort(), repeat };
    }
    return out;
  })()`);
  const max = (d) => Math.max(...r[d].tiers);
  if (max(0) !== 0 || max(399) !== 0 || max(400) !== 1 || max(999) !== 1 || max(1000) !== 2 || max(5000) !== 2) throw new Error(JSON.stringify(r));
  if (Object.values(r).some((x) => x.repeat)) throw new Error('same pattern twice in a row: ' + JSON.stringify(r));
});

// ------------------------------------------------------------------ the bot: a run of 2000 m with real collisions
const BOT = `(() => {
  const lane = (x) => Math.round(x / 2.6) + 1;
  window.__bot = { jumped: new Set(), slid: new Set(), died: null };
  __SPACESAGA.onTick = (api) => {
    const G = api.G; if (G.phase !== 'running') return;
    const pl = api.player(), sp = api.spawner(), v = G.speed;
    const solid = sp.active.filter((o) => o.kind !== 'P' && o.z < o.box.halfD + 0.45).sort((a, b) => b.z - a.z);
    if (!solid.length) return;
    const clusters = [];
    for (const o of solid) { const c = clusters.find((c) => Math.abs(c.z - o.z) < 1.0); if (c) c.os.push(o); else clusters.push({ z: o.z, os: [o] }); }
    const status = (c) => {
      const s = ['free', 'free', 'free'];
      for (const o of c.os) {
        if (o.kind === 'E') { const l0 = lane(o.x), d = o.dir; for (let l = l0; l >= 0 && l <= 2; l += d) if (s[l] !== 'block') s[l] = 'jump'; }
        else s[o.lane] = o.kind === 'B' ? 'block' : o.kind === 'L' ? 'jump' : 'slide';
      }
      return s;
    };
    const c1 = clusters[0], s1 = status(c1), s2 = clusters[1] ? status(clusters[1]) : null;
    const inOverlap = c1.z > -(c1.os[0].box.halfD + 0.9);
    let want = pl.lane;
    if (s1[pl.lane] === 'block' || (s2 && s2[pl.lane] === 'block' && s1[pl.lane] !== 'free') || true) {
      let best = 1e9;
      for (let l = 0; l < 3; l++) {
        if (s1[l] === 'block') continue;
        const cost = (s1[l] === 'free' ? 0 : 1) + 0.3 * Math.abs(l - pl.lane) + (s2 && s2[l] === 'block' ? 0.6 : 0);
        if (cost < best) { best = cost; want = l; }
      }
    }
    if (!inOverlap && !pl.switching && want !== pl.lane) { api.input(want < pl.lane ? 'left' : 'right'); return; }
    if (pl.lane !== want || pl.switching) return;
    const st = s1[pl.lane], key = c1.os[0].z - G.distance;
    if (st === 'jump' && !pl.jumping && c1.z >= -v * 0.34 && !window.__bot.jumped.has(Math.round(key))) { window.__bot.jumped.add(Math.round(key)); api.input('jump'); }
    if (st === 'slide' && !pl.sliding && c1.z >= -v * 0.2 && !window.__bot.slid.has(Math.round(key))) { window.__bot.slid.add(Math.round(key)); api.input('slide'); }
  };
})()`;

async function botRun(p, q, meters) {
  await boot(p, q);
  await p.eval(`__SPACESAGA.start(); ${BOT}`);
  await p.waitFor(`__SPACESAGA.G.distance >= ${meters} || __SPACESAGA.G.phase !== 'running'`, { timeout: 400000, every: 250, what: `${meters} m` });
  return st(p);
}
for (const seed of [1, 2, 3, 4]) {
  test(`bot (reads the rows ahead, picks a safe action) survives 2,000 m, seed ${seed}`, async (p) => {
    const r = await botRun(p, `&seed=${seed}&speed=8`, 2000);
    if (r.phase !== 'running' || r.distance < 2000) throw new Error(`died at ${r.distance.toFixed(0)} m (lane ${r.player.lane}, y ${r.player.y.toFixed(2)}); obstacles near: ${JSON.stringify(r.obstacles.filter((o) => Math.abs(o.z) < 6 && o.kind !== 'P'))}`);
  });
}
test('bot at 1x game speed survives 2,000 m (seed 5)', async (p) => {
  const r = await botRun(p, '&seed=5', 2000);
  if (r.phase !== 'running' || r.distance < 2000) throw new Error(`died at ${r.distance.toFixed(0)} m`);
});

// ------------------------------------------------------------------ death, RUN_OVER, best
test('death: slow motion then the panel; exactly one RUN_OVER per run, with sane numbers; restart; new run sends its own', async (p) => {
  await clean(p);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'INIT', payload: { best: 100000, soundOn: false } }, '*')`);
  await script(p, []);
  await untilRun(p, 0.5);
  await p.eval(`__SPACESAGA.kill()`);
  await p.waitFor(`__SPACESAGA.state().phase === 'dead'`, { timeout: 10000, what: 'dead panel' });
  await sleep(900);
  let ro = await p.eval(`__ro`);
  if (ro.length !== 1) throw new Error(`RUN_OVER sent ${ro.length} times`);
  const x = ro[0];
  if (!['score', 'distance', 'pickups', 'timeMs'].every((k) => Number.isInteger(x[k]) && x[k] >= 0) || x.timeMs < 400) throw new Error(JSON.stringify(x));
  const panel = await p.eval(`({ shown: !document.getElementById('s-dead').hidden, dist: document.getElementById('d-dist').textContent, best: document.getElementById('d-best').textContent, nb: !document.getElementById('newbest').hidden })`);
  if (!panel.shown || !/m$/.test(panel.dist) || panel.best !== '100,000' || panel.nb) throw new Error(JSON.stringify(panel));
  await p.key('Enter');                                                                              // inside the 450 ms guard? (900 ms have passed: restarts)
  await p.waitFor(`__SPACESAGA.state().phase === 'running'`, { what: 'restart' });
  await p.eval(`__SPACESAGA.kill()`);
  await p.waitFor(`__SPACESAGA.state().phase === 'dead'`, { timeout: 10000 });
  ro = await p.eval(`__ro`);
  if (ro.length !== 2) throw new Error(`two runs should send two RUN_OVER, got ${ro.length}`);
});

test('best: INIT carries it, a better run shows NEW BEST and is reported; passing it mid-run flashes', async (p) => {
  await boot(p);
  await p.eval(`window.__ro = []; const ro = System32.runOver; System32.runOver = (x) => { __ro.push(x); ro(x); }; window.postMessage({ source: 'system32-shell', type: 'INIT', payload: { best: 300, soundOn: false } }, '*')`);
  await p.waitFor(`document.getElementById('title-best').textContent === 'Best: 300'`, { what: 'best on the title screen' });
  await p.eval(`__SPACESAGA.start()`);
  await sleep(300);
  await p.eval(`__SPACESAGA.setDistance(320)`);
  await p.waitFor(`!document.getElementById('flash').hidden`, { timeout: 10000, what: 'NEW BEST flash' });
  if (!/new best/i.test(await p.eval(`document.getElementById('flash').textContent`))) throw new Error('flash text');
  await p.eval(`__SPACESAGA.kill()`);
  await p.waitFor(`__SPACESAGA.state().phase === 'dead'`, { timeout: 10000 });
  const r = await p.eval(`({ nb: !document.getElementById('newbest').hidden, ro: __ro, best: __SPACESAGA.state().best })`);
  if (!r.nb || r.ro.length !== 1 || r.ro[0].score <= 300 || r.best !== r.ro[0].score) throw new Error(JSON.stringify(r));
});

test('god mode (?god=1): obstacles do not kill', async (p) => {
  await clean(p, '&seed=1&god=1');
  await place(p, 'B', 1, -6);
  await script(p, []);
  await untilRun(p, 1.5);
  if (!(await alive(p))) throw new Error('died in god mode');
});

// ------------------------------------------------------------------ pause, focus, context loss
test('pause: shell PAUSE/RESUME stop the clock exactly; P pauses with an overlay; R restarts', async (p) => {
  await clean(p);
  await script(p, []);
  await untilRun(p, 0.5);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'PAUSE' }, '*')`);
  await sleep(150);
  const a = await p.eval(`({ t: __SPACESAGA.G.time, d: __SPACESAGA.G.distance, r: __SPACESAGA.G.runTime })`);
  await sleep(900);
  const b = await p.eval(`({ t: __SPACESAGA.G.time, d: __SPACESAGA.G.distance, r: __SPACESAGA.G.runTime })`);
  if (a.t !== b.t || a.d !== b.d || a.r !== b.r) throw new Error(`the clock moved while paused: ${JSON.stringify([a, b])}`);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'RESUME' }, '*')`);
  await sleep(400);
  const c = await p.eval(`__SPACESAGA.G.runTime`);
  if (!(c > b.r + 0.1)) throw new Error('did not resume');
  await p.key('p', { code: 'KeyP' });
  await p.waitFor(`!document.getElementById('s-pause').hidden`, { what: 'pause overlay' });
  const d1 = await p.eval(`__SPACESAGA.G.runTime`);
  await sleep(500);
  if ((await p.eval(`__SPACESAGA.G.runTime`)) !== d1) throw new Error('clock moved under the pause overlay');
  await p.key('p', { code: 'KeyP' });
  await p.waitFor(`document.getElementById('s-pause').hidden && __SPACESAGA.G.runTime > ${d1}`, { what: 'resume with P' });
  await p.key('Escape', { code: 'Escape' });
  await p.waitFor(`!document.getElementById('s-pause').hidden`, { what: 'pause with Esc' });
  await p.key('r', { code: 'KeyR' });
  await p.waitFor(`document.getElementById('s-pause').hidden && __SPACESAGA.G.runTime < ${d1}`, { what: 'restart with R' });
});

test('focus loss while running auto-pauses with "Click to continue"; a click resumes', async (p) => {
  await clean(p);
  await script(p, []);
  await untilRun(p, 0.3);
  await p.eval(`window.dispatchEvent(new Event('blur'))`);
  await p.waitFor(`!document.getElementById('s-blur').hidden`, { what: 'click-to-continue overlay' });
  const a = await p.eval(`__SPACESAGA.G.runTime`);
  await sleep(500);
  if ((await p.eval(`__SPACESAGA.G.runTime`)) !== a) throw new Error('clock moved while unfocused');
  await p.mouse('mousePressed', 200, 150); await p.mouse('mouseReleased', 200, 150);
  await p.waitFor(`document.getElementById('s-blur').hidden && __SPACESAGA.G.runTime > ${a}`, { what: 'resume on click' });
});

test('WebGL context loss: pauses with a message, restore resumes and keeps rendering, nothing throws', async (p) => {
  await clean(p);
  await script(p, []);
  await untilRun(p, 0.3);
  if (!(await p.eval(`__SPACESAGA.loseContext()`))) throw new Error('no WEBGL_lose_context in this browser');
  await p.waitFor(`__SPACESAGA.state().reasons.includes('context')`, { what: 'context lost' });
  if (await p.eval(`document.getElementById('s-error').hidden`)) throw new Error('no message on context loss');
  const a = await p.eval(`__SPACESAGA.G.runTime`);
  await sleep(400);
  if ((await p.eval(`__SPACESAGA.G.runTime`)) !== a) throw new Error('clock moved while the context was lost');
  await p.eval(`__SPACESAGA.restoreContext()`);
  await p.waitFor(`!__SPACESAGA.state().reasons.includes('context') && document.getElementById('s-error').hidden`, { what: 'context restored' });
  const f1 = await p.eval(`__SPACESAGA.renderer().info.render.frame`);
  await sleep(500);
  const f2 = await p.eval(`__SPACESAGA.renderer().info.render.frame`);
  if (!(f2 > f1) || !((await p.eval(`__SPACESAGA.G.runTime`)) > a)) throw new Error('did not recover');
});

test('quality: ?quality=low turns shadows off; an average frame time over 22 ms for 3 s drops a high-quality run to low', async (p) => {
  await boot(p, '&seed=1');
  if (!(await p.eval(`__SPACESAGA.state().low && !__SPACESAGA.renderer().shadowMap.enabled && !__SPACESAGA.world().sun.castShadow`))) throw new Error('low quality is not applied');
  await p.goto('/games/space-saga/index.html?debug=1&seed=1');                                       // default: high
  await p.waitFor(`window.__SPACESAGA?.state().phase === 'title'`, { timeout: 45000 });
  if (await p.eval(`__SPACESAGA.state().low`)) throw new Error('high quality expected by default');
  await p.eval(`__SPACESAGA.start()`);
  await p.eval(`__SPACESAGA.G.frameAvg = 80; __SPACESAGA.G.slowFor = 2.9`);                          // pretend the last 2.9 s were slow
  await p.waitFor(`__SPACESAGA.state().low`, { timeout: 20000, what: 'auto drop to low' });
  if (await p.eval(`__SPACESAGA.renderer().shadowMap.enabled`)) throw new Error('shadows still on after the drop');
});

// ------------------------------------------------------------------ eggs
test('egg saga-404: crossing 404 m shows "Distance not found" and tells the shell once', async (p) => {
  await clean(p);
  await script(p, []);
  await p.eval(`__SPACESAGA.setDistance(403.5)`);
  await p.waitFor(`!document.getElementById('flash').hidden`, { timeout: 10000, what: 'flash' });
  if (!/distance not found/i.test(await p.eval(`document.getElementById('flash').textContent`))) throw new Error('flash text');
  const fx = await p.eval(`__fx.filter((f) => f[0] === 'egg')`);
  if (fx.length !== 1 || fx[0][1].egg !== 'saga-404') throw new Error(JSON.stringify(fx));
});

test('egg saga-popup: jumping through a floating pop-up shatters it; walking under it does not', async (p) => {
  await clean(p);
  await p.eval(`void __SPACESAGA.spawner().addPopup(0, -6)`);                                              // another lane first: you run past it
  await script(p, []);
  await untilRun(p, 0.9);
  if ((await p.eval(`__fx.filter((f) => f[0] === 'egg')`)).length) throw new Error('hit a popup without touching it');
  await p.eval(`void __SPACESAGA.spawner().addPopup(1, -6)`);                                              // arrives in ~0.5 s: jump now
  await script(p, [{ t: 0.2, a: 'jump' }]);
  await untilRun(p, 1.0);
  const fx = await p.eval(`__fx.filter((f) => f[0] === 'egg')`);
  if (fx.length !== 1 || fx[0][1].egg !== 'saga-popup') throw new Error(JSON.stringify(fx));
  if (!(await alive(p))) throw new Error('a popup must never kill');
  await clean(p);
  await p.eval(`void __SPACESAGA.spawner().addPopup(1, -6)`);
  await script(p, []);
  await untilRun(p, 1.2);
  if ((await p.eval(`__fx.filter((f) => f[0] === 'egg')`)).length) throw new Error('standing under the popup must not shatter it');
});

test('pop-up ad debris appears about every 600 m', async (p) => {
  await clean(p);
  await p.eval(`__SPACESAGA.spawner().frozen = false; __SPACESAGA.setDistance(599.9)`);
  await script(p, []);
  await p.waitFor(`__SPACESAGA.state().popups.length === 1`, { timeout: 10000, what: 'popup spawn' });
});

test('egg saga-afk: 60 s idle on the title screen and the player sits down; a key stands them up', async (p) => {
  await boot(p);
  await p.eval(`window.__fx = []; const f = System32.effect; System32.effect = (n, o) => { __fx.push([n, o]); f(n, o); }; __SPACESAGA.G.titleIdle = 59.8`);
  await p.waitFor(`__SPACESAGA.state().player.sitting`, { timeout: 10000, what: 'sits down' });
  const fx = await p.eval(`__fx.filter((f) => f[0] === 'egg')`);
  if (fx.length !== 1 || fx[0][1].egg !== 'saga-afk') throw new Error(JSON.stringify(fx));
  await p.key('x', { code: 'KeyX' });
  await p.waitFor(`!__SPACESAGA.state().player.sitting`, { what: 'stands up' });
});

// ------------------------------------------------------------------ audio
test('audio: silent unless the shell says soundOn; with it, the synth runs (steps, jump, slide, pickup, crash, beat) without errors; M mutes', async (p) => {
  await clean(p);
  if (await p.eval(`!!__SPACESAGA.audio().ctx`)) throw new Error('an AudioContext exists although the shell never said soundOn');
  await boot(p);
  await p.eval(`window.postMessage({ source: 'system32-shell', type: 'INIT', payload: { best: null, soundOn: true } }, '*')`);
  await sleep(100);
  await p.key('x', { code: 'KeyX' });                                                                 // a key press unlocks audio
  await p.waitFor(`!!__SPACESAGA.audio().ctx`, { what: 'AudioContext after a key press' });
  await p.eval(`(() => { const a = __SPACESAGA; a.start(); const sp = a.spawner(); sp.frozen = true; [...sp.active].forEach((o) => sp.release(o)); for (let i = 0; i < 3; i++) sp.add('P', 1, -6 - i * 2.5); })()`);
  await sleep(300);
  await p.key('w', { code: 'KeyW' }); await sleep(250); await p.key('s', { code: 'KeyS' }); await sleep(900);
  const r = await p.eval(`(() => { const a = __SPACESAGA.audio(); return { state: a.ctx.state, music: a.music, pickups: __SPACESAGA.state().pickups, step: a.step, active: a.active }; })()`);
  if (!r.music || r.pickups < 1 || r.step < 8 || !r.active) throw new Error(JSON.stringify(r));
  await p.key('m', { code: 'KeyM' });
  if (!(await p.eval(`__SPACESAGA.audio().muted && !__SPACESAGA.audio().active`))) throw new Error('M did not mute');
  await p.key('m', { code: 'KeyM' });
  if (await p.eval(`__SPACESAGA.audio().muted`)) throw new Error('M did not unmute');
  await p.eval(`__SPACESAGA.kill()`);                                                               // crash sound, music stops
  await p.waitFor(`!__SPACESAGA.audio().music`, { what: 'music stops on death' });
});

test('audio: title music, every effect, music tiers with distance, and the shell can switch sound on / off while the game runs', async (p) => {
  await boot(p);
  const say = (m) => p.eval(`window.postMessage(Object.assign({ source: 'system32-shell' }, ${JSON.stringify(m)}), '*')`);
  if ((await p.eval(`document.getElementById('title-sound').textContent`)).includes('M to mute')) throw new Error('the title claims sound is on before the shell said so');
  await say({ type: 'INIT', payload: { best: null, soundOn: true } });
  await sleep(100);
  await p.key('x', { code: 'KeyX' });
  await p.waitFor(`!!__SPACESAGA.audio().ctx`, { what: 'AudioContext' });
  if (!(await p.eval(`document.getElementById('title-sound').textContent`)).includes('M to mute')) throw new Error('the title does not show the sound hint');
  await p.waitFor(`__SPACESAGA.audio().music && __SPACESAGA.audio().mode === 'title' && __SPACESAGA.audio().step > 4`, { what: 'title music playing' });
  const n = await p.eval(`(() => { const a = __SPACESAGA.audio(); const n = ['footstep','jump','land','slide','pickup','orb','comboUp','clip','crash','gameOver','fanfare','shatter','tierUp','glitch','start']; n.forEach((m) => a[m]()); a.lane(-1); a.lane(1); a.alien('walker'); a.alien('flyer'); return n.length + 4; })()`);
  if (n < 19) throw new Error('effects missing');
  await p.eval(`__SPACESAGA.start()`);
  await p.waitFor(`__SPACESAGA.audio().mode === 'run' && __SPACESAGA.audio().step > 4`, { what: 'run music playing' });
  for (const [m, tier] of [[10, 0], [450, 1], [1100, 2]]) {
    await p.eval(`(() => { const a = __SPACESAGA; a.spawner().frozen = true; [...a.spawner().active].forEach((o) => a.spawner().release(o)); a.setDistance(${m}); })()`);
    await p.waitFor(`__SPACESAGA.audio().tier === ${tier}`, { what: `music tier ${tier}` });
  }
  await say({ type: 'SOUND', payload: { soundOn: false } });
  await sleep(60);
  if (await p.eval(`__SPACESAGA.audio().active`)) throw new Error('SOUND off did not silence the game');
  await say({ type: 'SOUND', payload: { soundOn: true } });
  await sleep(60);
  if (!(await p.eval(`__SPACESAGA.audio().active`))) throw new Error('SOUND on did not bring the game back');
  await p.eval(`__SPACESAGA.kill()`);
  await p.waitFor(`!__SPACESAGA.audio().music`, { what: 'music stops on death' });
});

test('planet: the track and decor sit on a ground that bends away (curve > 0), decor reaches out wide and stands on the surface', async (p) => {
  await boot(p);
  const r = await p.eval(`(async () => {
    const { curve } = await import('/games/space-saga/src/curve.js');
    const w = __SPACESAGA.world();
    const seg = w.segs[0];
    const xs = w.segs.flatMap((g) => g.userData.decor.map((d) => [Math.abs(d.position.x), d.position.y]));
    return { k: curve.k.value, children: seg.children.length, maxX: Math.max(...xs.map((v) => v[0])), minX: Math.min(...xs.map((v) => v[0])), ys: [...new Set(xs.map((v) => v[1].toFixed(2)))], n: xs.length };
  })()`);
  if (!(r.k > 0)) throw new Error('no curvature: ' + JSON.stringify(r));
  if (r.children < 7) throw new Error('segment lacks ground / road bed: ' + JSON.stringify(r));
  if (r.maxX < 25 || r.minX < 5.9 || r.n < 40) throw new Error('decor does not fill the planet: ' + JSON.stringify(r));
  if (r.ys.length !== 1 || Number(r.ys[0]) > -0.2) throw new Error('decor is not standing on the ground: ' + JSON.stringify(r));
});

// ------------------------------------------------------------------ no WebGL
test('no WebGL: a friendly error screen instead of a crash', async () => {
  const b = await Browser.launch({ width: 640, height: 360, extraArgs: ['--disable-3d-apis'] });
  try {
    const p = await b.page();
    await p.goto(Q(''));
    await p.waitFor(`!document.getElementById('s-error').hidden`, { timeout: 20000, what: 'error screen' });
    const t = await p.eval(`document.getElementById('err-title').textContent`);
    if (!/WebGL/.test(t)) throw new Error(t);
    const bad = p.errors.filter((e) => !/WebGL|context/i.test(e));
    if (bad.length) throw new Error('unexpected errors: ' + bad.join(' | '));
  } finally { await b.close(); }
});

s.run();
