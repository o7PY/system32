// Every tunable number of SpaceSaga lives here (SPACESAGA_SPEC.md B4/B5). Pure data: no DOM, so Node tests can import it.
// Units: 1 unit = 1 m. The player stands at z = 0; the world moves toward the camera (+z).

export const CONFIG = {
  laneWidth: 2.6,
  laneSwitchS: 0.12,
  bufferS: 0.12,                                   // input buffer
  jump: { height: 2.2, durS: 0.65, fastFall: 30 }, // fixed arc, not physics
  slide: { durS: 0.6 },
  speed: { start: 12, add: 0.45, perM: 50, cap: 34 },    // +0.45 u/s per 50 m: the cap is reached at about 2,450 m
  scoring: { pickup: 50, comboAt: 10, mult: 2, orbPickups: 5 },
  sideClip: { windowS: 1.0, shakeS: 0.35 },
  player: { halfW: 0.35, halfD: 0.3, height: 1.8, slideHeight: 0.9 },

  // Logical collision boxes (about 80% of the visual size, so the game forgives): half width (x), half depth (z), y range.
  boxes: {
    L: { halfW: 0.85, halfD: 0.45, y0: 0, y1: 0.85 },     // low: jump over
    H: { halfW: 1.04, halfD: 0.5, y0: 0.05, y1: 1.4 },    // high: slide under (box is relative to its hang height: 1.05 .. 2.4 above the floor)
    B: { halfW: 1.0, halfD: 1.4, y0: 0, y1: 2.4 },        // blocker: switch lanes
    E: { halfW: 0.5, halfD: 0.4, y0: 0, y1: 1.25 },       // enemy: jump over, or be in another lane
    P: { halfW: 0.7, halfD: 0.9, y0: 0, y1: 0.9 },        // pickup (generous)
  },
  // High obstacles hang with their underside this high above the floor (the slide hitbox is 0.9 tall, standing is 1.8).
  highHang: 1.0,

  // Enemies
  enemy: { laneS: 0.8, leadS: 1.5 },               // one lane per 0.8 s; starts walking 1.5 s before it reaches you
  // Spawning
  spawnAhead: 150,                                 // metres ahead of the player that rows appear
  firstRowZ: -60,
  reactionS: 0.7,                                  // time between obstacle rows at ANY speed (spec asks for >= 0.55 s)
  patternGapS: 1.15,                               // time between patterns
  minPatternGap: 14,
  tiers: [0, 400, 1000],                           // distance (m) at which tier 0 / 1 / 2 unlock
  pickupChance: 0.75,
  orbChance: 0.1,
  popupEveryM: 600,

  // World
  track: { segLen: 20, segs: 12, halfWidth: 4.6 },
  // The track runs over a small round planet: the surface falls away as radius R (visual only), decor fills it out to xMax.
  planet: { radius: 380, ground: -0.3, halfWidth: 200 },
  decor: { perSide: [5, 8], perSideLow: [2, 4], xMin: 6, xMax: 55, nearBias: 1.7 },
  stars: { count: 2000, low: 800, radius: 700 },
  fog: { color: 0x0b0a1e, near: 70, far: 250 },
  camera: { offset: [0, 3.2, 6.5], look: [0, 1.2, -6], fov: [60, 70], lag: 6, laneFollow: 0.55 },

  // Quality
  quality: { dpr: 1.5, lowDpr: 1, autoDropMs: 22, autoDropS: 3 },

  // Easter eggs
  eggs: { distance404: 404, afkS: 60 },
};

/** Pattern rows, top = met first. . empty  L low (jump)  H high (slide)  B blocker (dodge)  E> / E< enemy walking right / left  P pickup. */
export const PATTERNS = [
  { id: 'low-mid',        tier: 0, rows: [['.', 'L', '.']] },
  { id: 'low-left',       tier: 0, rows: [['L', '.', '.']] },
  { id: 'low-right',      tier: 0, rows: [['.', '.', 'L']] },
  { id: 'low-wide',       tier: 0, rows: [['L', 'L', 'L']] },
  { id: 'wall-left2',     tier: 0, rows: [['B', 'B', '.']] },
  { id: 'wall-right2',    tier: 0, rows: [['.', 'B', 'B']] },
  { id: 'wall-mid',       tier: 0, rows: [['.', 'B', '.']] },
  { id: 'low-pair',       tier: 0, rows: [['L', '.', '.'], ['.', '.', 'L']], gap: 16 },

  { id: 'slide-gate',     tier: 1, rows: [['H', 'H', 'H']] },
  { id: 'slide-left2',    tier: 1, rows: [['H', 'H', '.']] },
  { id: 'slide-right2',   tier: 1, rows: [['.', 'H', 'H']] },
  { id: 'zigzag',         tier: 1, rows: [['B', '.', 'B'], ['.', 'B', '.']], gap: 14 },
  { id: 'mixed-row',      tier: 1, rows: [['L', 'B', 'H']] },
  { id: 'jump-then-slide', tier: 1, rows: [['L', 'L', 'L'], ['H', 'H', 'H']], gap: 18 },
  { id: 'slide-then-jump', tier: 1, rows: [['H', 'H', 'H'], ['L', 'L', 'L']], gap: 18 },

  { id: 'jump-or-dodge',  tier: 2, rows: [['L', 'B', 'L']] },
  { id: 'enemy-cross',    tier: 2, rows: [['E>', '.', '.']] },
  { id: 'enemy-cross-l',  tier: 2, rows: [['.', '.', 'E<']] },
  { id: 'enemy-pair',     tier: 2, rows: [['E>', '.', '.'], ['.', '.', 'E<']], gap: 22 },
  { id: 'slalom',         tier: 2, rows: [['B', 'B', '.'], ['.', 'B', 'B'], ['B', 'B', '.']], gap: 16 },
  { id: 'gauntlet',       tier: 2, rows: [['H', 'H', 'H'], ['L', 'L', 'L'], ['B', '.', 'B']], gap: 18 },
];
