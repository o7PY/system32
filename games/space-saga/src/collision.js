// Logical box checks, not mesh collision. World space: x across lanes, y up, z toward the camera; the player stands at z = 0.
import { CONFIG } from './config.js';

/** Does the player box overlap this obstacle box? (obstacle: { x, z, box: { halfW, halfD, y0, y1 } }) */
export function overlaps(p, o) {
  const b = o.box;
  return Math.abs(p.x - o.x) < p.halfW + b.halfW
    && Math.abs(o.z) < p.halfD + b.halfD
    && p.y0 < o.y + b.y1 && p.y1 > o.y + b.y0;
}

/**
 * Classify a hit on a solid obstacle.
 *  'side'  = a blocker met while changing lanes (the destination lane holds it): bounce once, shake the camera;
 *  'front' = anything else: fatal.
 */
export function classify(player, o) {
  if (o.kind === 'B' && player.switching && o.lane === player.lane && o.lane !== player.prevLane) return 'side';
  return 'front';
}

export const laneOfX = (x) => Math.round(x / CONFIG.laneWidth) + 1;
