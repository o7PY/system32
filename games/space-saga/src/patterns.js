// Pure pattern rules (no DOM, no three.js): used by the spawner AND by the static validator test (tests/space-saga).
import { CONFIG, PATTERNS } from './config.js';

/** 'E>' -> { type:'E', dir:+1 }; '.' -> { type:'.' } */
export function parseToken(t) {
  if (t.length === 2 && t[0] === 'E') return { type: 'E', dir: t[1] === '>' ? 1 : -1 };
  if ('.LHBP'.includes(t) && t.length === 1) return { type: t };
  throw new Error(`bad pattern token "${t}"`);
}

/** The action that gets you through one lane of a row, or null if there is none. */
export function laneAction(token) {
  switch (parseToken(token).type) {
    case '.': case 'P': return 'run';
    case 'L': case 'E': return 'jump';        // an enemy is jumpable (or sidestep it)
    case 'H': return 'slide';
    default: return null;                      // B: blocker
  }
}

export const rowHasObstacle = (row) => row.some((t) => { const k = parseToken(t).type; return k !== '.' && k !== 'P'; });
export const safeLanes = (row) => row.map((t, i) => (laneAction(t) ? i : -1)).filter((i) => i >= 0);

/** Distance between two rows: never closer than the reaction time at the given speed. */
export function rowGap(pattern, prevRow, nextRow, speed) {
  const base = pattern.gap ?? 10;
  return rowHasObstacle(prevRow) || rowHasObstacle(nextRow) ? Math.max(base, speed * CONFIG.reactionS) : base;
}

/** A lane path through the pattern (nearest safe lane each row, starting near `fromLane`), or null if some row has no safe lane. */
export function safePath(pattern, fromLane = 1) {
  const path = [];
  let lane = fromLane;
  for (const row of pattern.rows) {
    const safe = safeLanes(row);
    if (!safe.length) return null;
    lane = safe.reduce((best, l) => (Math.abs(l - lane) < Math.abs(best - lane) ? l : best), safe[0]);
    path.push(lane);
  }
  return path;
}

/**
 * Static fairness check of one pattern at the worst case (max speed, min gap). Returns a list of problems (empty = fair).
 *  - every row has a survivable action;
 *  - between consecutive rows some safe lane can be reached: each lane step takes laneSwitchS, and the player may queue one more switch,
 *    so at most 2 steps; the time left must also cover the action just taken (a jump takes durS before you can slide);
 *  - the minimum row time is >= 0.55 s.
 */
export function validatePattern(p, speed = CONFIG.speed.cap) {
  const problems = [];
  p.rows.forEach((row, i) => {
    if (row.length !== 3) problems.push(`row ${i}: needs 3 lanes`);
    else if (!safeLanes(row).length) problems.push(`row ${i}: no survivable action (${row.join(' ')})`);
  });
  if (problems.length) return problems;
  for (let i = 0; i + 1 < p.rows.length; i++) {
    const a = p.rows[i], b = p.rows[i + 1];
    const gap = rowGap(p, a, b, speed);
    const timeS = gap / speed;
    if (rowHasObstacle(a) || rowHasObstacle(b)) {
      if (timeS < 0.55 - 1e-9) problems.push(`rows ${i}-${i + 1}: only ${timeS.toFixed(2)} s apart at ${speed} u/s`);
    }
    const ok = safeLanes(a).some((la) => safeLanes(b).some((lb) => {
      const steps = Math.abs(la - lb);
      if (steps > 2) return false;
      const needS = steps * CONFIG.laneSwitchS + (laneAction(a[la]) === 'jump' && laneAction(b[lb]) === 'slide' ? CONFIG.jump.durS : 0);
      return needS <= timeS;
    }));
    if (!ok) problems.push(`rows ${i}-${i + 1}: no safe lane reachable in ${timeS.toFixed(2)} s`);
  }
  return problems;
}

/** The pattern after another (any pattern): every lane of the first row is reachable from every lane (<= 2 steps) in the pattern gap. */
export function patternGapOk(speed = CONFIG.speed.cap) {
  const gapS = Math.max(CONFIG.minPatternGap / speed, CONFIG.patternGapS);
  return gapS >= 2 * CONFIG.laneSwitchS + CONFIG.jump.durS;
}

export { PATTERNS };
