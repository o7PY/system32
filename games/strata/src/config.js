// Every tunable number of Strata (STRATA_SPEC.md). Pure data, no DOM and no three.js, so Node tests can import it.
// Units: 1 block = 1 m. y is up. Chunks are 16 x 16 columns, 128 tall.

export const CONFIG = {
  worldSize: 1024,                          // blocks per side, a power of two (?worldSize=N overrides it, for tests)
  height: 128,                              // world height; y = 0 is bedrock, y = 127 the build limit
  seaLevel: 48,
  snowLine: 90,
  chunk: 16,

  view: { default: 8, min: 4, max: 12, low: 5, genExtra: 1, unloadExtra: 2, meshPerFrame: 2, genInFlight: 4, meshInFlight: 3, inlineBudgetMs: 6 },
  render: { dprMax: 1.5, fov: 70, near: 0.08 },
  border: { gridDist: 8 },                  // the faint grid shows within this many blocks of the world edge

  // Terrain generation (worker.js reads these through init). Noise scales are in 1 / blocks.
  gen: {
    caveMaxY: 60, caveCheese: 0.62, caveTunnel: 0.07, caveEntrance: 0.55,
    treeAttempts: 20, treeForest: 0.55, treePlains: 0.06, treeMountain: 0.05, cactusDesert: 0.1,
    coalPerChunk: 14, ironPerChunk: 7, coal: [20, 90], iron: [5, 60], adBlockChunkChance: 0.25, adBlock: [6, 30],
  },
  biomes: ['plains', 'forest', 'desert', 'mountains', 'beach', 'ocean'],

  // Player (AABB 0.6 x 1.8 x 0.6, eye 1.62)
  player: {
    width: 0.6, height: 1.8, eye: 1.62, sneakEye: 1.32,
    gravity: 32, jump: 9, terminal: 60,
    walk: 4.3, sprint: 5.6, sneak: 1.3, swim: 2.4, swimUp: 3.4, swimSink: 1.2, sprintTapS: 0.3,
    accel: 60, airAccel: 18,                // horizontal acceleration (blocks / s^2) on the ground and in the air
    maxStep: 0.4,                           // collision sub-step, so nothing tunnels at terminal speed
    sensitivity: 0.0022,                    // radians per pixel at sensitivity 1
  },
  reach: 5,

  // Mining: time = hardness * base / toolSpeed; * 3.3 and no drop without the required tool
  mining: { base: 1, noToolMul: 3.3, dropRange: 1.5, dropDespawnS: 300, dropMergeR: 0.7, dropPullSpeed: 9, dropSpawnY: 0.25, bedrockEggS: 10, ticksS: 0.25 },
  tools: {                                  // tier -> speed / durability; hand speed 1
    hand: { speed: 1 },
    wood: { tier: 1, speed: 2, durability: 60 },
    stone: { tier: 2, speed: 4, durability: 130 },
    iron: { tier: 3, speed: 6, durability: 250 },
  },
  stack: 64,
  inv: { hotbar: 9, main: 27 },

  // Furnace: 4 s per item; fuel in items-smelted units
  furnace: { smeltS: 4, fuel: { coal: 8, planks: 1.5, stick: 0.5 } },

  day: { lengthS: 1200, start: 0.08 },      // 20 minutes per day; 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  clouds: { y: 112, speed: 1.6 },

  save: { autosaveS: 60, version: 1, capBytes: 1.5 * 1024 * 1024 },
  settings: { sensitivity: 1, fov: 70, viewDistance: 8, invertY: false, volume: 0.7, music: true },
  musicEveryS: [150, 300],                  // a sparse ambient pad every few minutes
};

/**
 * Shaped recipes: `pattern` rows use the keys of `key`; '.' is an empty cell. They match anywhere in the grid and mirrored left-right.
 * Shapeless recipes list their ingredients. `table: true` needs the 3x3 crafting table (the inventory has a 2x2 grid).
 * Materials by tier: planks (wood), cobblestone (stone), iron_ingot (iron).
 */
const TIERS = [['wood', 'planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot']];
export const RECIPES = [
  { id: 'planks', shapeless: ['log'], out: ['planks', 4] },
  { id: 'sticks', pattern: ['P', 'P'], key: { P: 'planks' }, out: ['stick', 4] },
  { id: 'crafting_table', pattern: ['PP', 'PP'], key: { P: 'planks' }, out: ['crafting_table', 1] },
  { id: 'furnace', pattern: ['CCC', 'C.C', 'CCC'], key: { C: 'cobblestone' }, out: ['furnace', 1] },
  ...TIERS.flatMap(([tier, mat]) => [
    { id: `pickaxe_${tier}`, pattern: ['MMM', '.S.', '.S.'], key: { M: mat, S: 'stick' }, out: [`pickaxe_${tier}`, 1] },
    { id: `axe_${tier}`, pattern: ['MM', 'MS', '.S'], key: { M: mat, S: 'stick' }, out: [`axe_${tier}`, 1] },
    { id: `shovel_${tier}`, pattern: ['M', 'S', 'S'], key: { M: mat, S: 'stick' }, out: [`shovel_${tier}`, 1] },
    { id: `sword_${tier}`, pattern: ['M', 'M', 'S'], key: { M: mat, S: 'stick' }, out: [`sword_${tier}`, 1] },
  ]),
];
/** Furnace recipes: input item -> output item. */
export const SMELTING = { sand: 'glass', raw_iron: 'iron_ingot' };
