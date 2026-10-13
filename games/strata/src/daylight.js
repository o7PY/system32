// Time of day as numbers (the renderer draws it, the game rules read it). t: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 0 (night) .. 1 (day): the same curve the sky uses. */
export const daylight = (t) => smooth(-0.12, 0.2, Math.sin(t * Math.PI * 2));
/** The light a monster feels at a cell: sky light scaled by the daylight (0..15), at least the block light. */
export const effectiveLight = (sky, blk, t) => Math.max(Math.round(sky * daylight(t)), blk);
/** Is it night enough for monsters to be out on the surface? */
export const isNight = (t) => daylight(t) < 0.35;
