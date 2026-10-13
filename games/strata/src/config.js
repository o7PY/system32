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
    coalPerChunk: 14, ironPerChunk: 7, coal: [20, 90], iron: [5, 60], cobaltPerChunk: 2, cobalt: [2, 16], adBlockChunkChance: 0.25, adBlock: [6, 30],
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
    cobalt: { tier: 4, speed: 9, durability: 900 },
  },
  // melee damage by item (hand 1); other tools are 2 (axe 1) less than the sword of their tier. Cooldown 0.6 s (damage scales with the charge).
  attack: { reach: 3.5, hand: 1, sword: { wood: 4, stone: 5, iron: 6, cobalt: 8 }, axeLess: 1, otherLess: 2, cooldownS: 0.6, critMul: 1.5, knockback: 5 },
  // armor: points per piece [helmet, chestplate, leggings, boots] (a full set: leather 7, iron 15, cobalt 20); damage reduction = points * 4%, at most 80%
  armor: {
    slots: ['helmet', 'chestplate', 'leggings', 'boots'], perPoint: 0.04, maxReduce: 0.8,
    tiers: { leather: { points: [1, 3, 2, 1], durability: 80 }, iron: { points: [2, 6, 5, 2], durability: 240 }, cobalt: { points: [3, 8, 6, 3], durability: 600 } },
    durabilityMul: [0.7, 1, 0.9, 0.8],
  },
  // survival (STRATA_PART2_SPEC 2): 20 HP shown as 10 hearts, 20 hunger as 10 food icons, 10 bubbles of air
  survival: {
    maxHp: 20, maxHunger: 20, invuln: 0.5, armorPerPoint: 0.04, armorMax: 0.8, hardDamageMul: 1.5, hardHungerMul: 1.3,
    fallSafe: 3.5,                                            // blocks you can fall unhurt; then 1 HP per block beyond
    bubbles: 10, bubbleS: 1.5, airRefillPerS: 5, drownDamage: 2, drownEveryS: 1,
    lava: { damage: 4, everyS: 0.5, burnS: 3, burnDamage: 1 }, suffocation: 1, voidY: -32,
    exhaust: { sprintPerM: 0.1, jump: 0.05, mine: 0.005, damage: 0.1, perHunger: 4 },
    regen: { minHunger: 16, everyS: 3, fastEveryS: 1, fedS: 20, exhaust: 1.5, exhaustFast: 0.5 },
    starveEveryS: 4, noSprintAt: 6,
    deathDropS: 600,                                          // the pile at your death place lasts 10 minutes of game time
  },
  // food: hunger points restored (STRATA_PART2_SPEC 2.2); eating takes eatS
  eatS: 1.6,
  food: {
    berries: { hunger: 2 }, apple: { hunger: 4 }, raw_pork: { hunger: 3 }, raw_beef: { hunger: 3 }, raw_mutton: { hunger: 2 }, raw_chicken: { hunger: 2 },
    cooked_pork: { hunger: 8 }, cooked_beef: { hunger: 8 }, cooked_mutton: { hunger: 6 }, cooked_chicken: { hunger: 6 }, bread: { hunger: 5 },
    glowcap_stew: { hunger: 6, returns: 'bowl' }, rotten_flesh: { hunger: 4, nausea: 0.3 },
  },
  stack: 64,
  inv: { hotbar: 9, main: 27 },

  // Furnace: 4 s per item; fuel in items-smelted units
  furnace: { smeltS: 4, timeFor: { raw_cobalt: 8 }, fuel: { coal: 8, planks: 1.5, stick: 0.5 } },

  day: { lengthS: 1200, start: 0.08 },      // 20 minutes per day; 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  clouds: { y: 112, speed: 1.6 },

  save: { autosaveS: 60, version: 1, capBytes: 2.5 * 1024 * 1024 },     // the shell's cap for Strata (two dimensions); a finished world should stay under 1.5 MB
  settings: { sensitivity: 1, fov: 70, viewDistance: 8, invertY: false, volume: 0.7, music: true, difficulty: 'normal', keepInventory: false, compass: true, subtitles: false },
  // mobs (STRATA_PART2_SPEC 5): animals come with the chunk (40 % of grassy chunks, 2 to 4 of one kind), one more every 2 minutes near you, at most 20 loaded
  mobs: { chunkChance: 0.4, perChunk: [2, 4], respawnS: 120, passiveCap: 20, deathS: 0.9, hearRange: 24 },
  // hostiles (STRATA_PART2_SPEC 5.2): spawn on a solid block with light 7 or less, 24-64 blocks from you, cap 30 (Hard x1.5), gone when 64+ blocks away for 30 s,
  // surface ones crumble over 3 s at sunrise; pathsPerStep = A* searches allowed per simulation step for ALL monsters together
  hostiles: { cap: 30, hardMul: 1.5, everyS: 1.5, tries: 8, minDist: 24, maxDist: 64, maxLight: 7, despawnDist: 64, despawnS: 30, lagS: 3, lagDaylight: 0.45, pathRange: 40, pathsPerStep: 2 },
  // the Underlayer (STRATA_PART2_SPEC 6): a second dimension below the bedrock, 512 x 512 x 96, no sky; Rifts link to the overworld; hostiles ignore light, cap 20
  underlayer: { size: 512, height: 96, floor: 40, ambient: 0.4, ambientColor: [1, 0.5, 0.38], fog: [0.1, 0.022, 0.016], cap: 20, riftS: 1.0 },
  musicEveryS: [150, 300],                  // a sparse ambient pad every few minutes
};

/**
 * Shaped recipes: `pattern` rows use the keys of `key`; '.' is an empty cell. They match anywhere in the grid and mirrored left-right.
 * Shapeless recipes list their ingredients. `table: true` needs the 3x3 crafting table (the inventory has a 2x2 grid).
 * Materials by tier: planks (wood), cobblestone (stone), iron_ingot (iron).
 */
const TIERS = [['wood', 'planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot'], ['cobalt', 'cobalt_ingot']];
export const RECIPES = [
  { id: 'planks', shapeless: ['log'], out: ['planks', 4] },
  { id: 'sticks', pattern: ['P', 'P'], key: { P: 'planks' }, out: ['stick', 4] },
  { id: 'crafting_table', pattern: ['PP', 'PP'], key: { P: 'planks' }, out: ['crafting_table', 1] },
  { id: 'furnace', pattern: ['CCC', 'C.C', 'CCC'], key: { C: 'cobblestone' }, out: ['furnace', 1] },
  { id: 'torch', pattern: ['C', 'S'], key: { C: 'coal', S: 'stick' }, out: ['torch', 4] },
  ...TIERS.flatMap(([tier, mat]) => [
    { id: `pickaxe_${tier}`, pattern: ['MMM', '.S.', '.S.'], key: { M: mat, S: 'stick' }, out: [`pickaxe_${tier}`, 1] },
    { id: `axe_${tier}`, pattern: ['MM', 'MS', '.S'], key: { M: mat, S: 'stick' }, out: [`axe_${tier}`, 1] },
    { id: `shovel_${tier}`, pattern: ['M', 'S', 'S'], key: { M: mat, S: 'stick' }, out: [`shovel_${tier}`, 1] },
    { id: `sword_${tier}`, pattern: ['M', 'M', 'S'], key: { M: mat, S: 'stick' }, out: [`sword_${tier}`, 1] },
  ]),
  // Part 2: storage, bed, food, shears
  { id: 'bow', pattern: ['.SB', 'S.B', '.SB'], key: { S: 'stick', B: 'string' }, out: ['bow', 1] },
  { id: 'arrow', pattern: ['F', 'S', 'P'], key: { F: 'flint', S: 'stick', P: 'feather' }, out: ['arrow', 4] },
  { id: 'chest', pattern: ['PPP', 'P.P', 'PPP'], key: { P: 'planks' }, out: ['chest', 1] },
  { id: 'bed', pattern: ['WWW', 'PPP'], key: { W: 'wool', P: 'planks' }, out: ['bed', 1] },
  { id: 'bowl', pattern: ['P.P', '.P.'], key: { P: 'planks' }, out: ['bowl', 4] },
  { id: 'bread', pattern: ['WWW'], key: { W: 'wheat' }, out: ['bread', 1] },
  { id: 'glowcap_stew', shapeless: ['glowcap', 'glowcap', 'bowl'], out: ['glowcap_stew', 1] },
  { id: 'shears', pattern: ['.I', 'I.'], key: { I: 'iron_ingot' }, out: ['shears', 1] },
  // armor: leather from cows, iron, cobalt
  ...[['leather', 'leather'], ['iron', 'iron_ingot'], ['cobalt', 'cobalt_ingot']].flatMap(([tier, mat]) => [
    { id: `${tier}_helmet`, pattern: ['MMM', 'M.M'], key: { M: mat }, out: [`${tier}_helmet`, 1] },
    { id: `${tier}_chestplate`, pattern: ['M.M', 'MMM', 'MMM'], key: { M: mat }, out: [`${tier}_chestplate`, 1] },
    { id: `${tier}_leggings`, pattern: ['MMM', 'M.M', 'M.M'], key: { M: mat }, out: [`${tier}_leggings`, 1] },
    { id: `${tier}_boots`, pattern: ['M.M', 'M.M'], key: { M: mat }, out: [`${tier}_boots`, 1] },
  ]),
];
/** Furnace recipes: input item -> output item. Meat is cooked, raw cobalt is smelted (8 s), ash turns to glass like sand. */
export const SMELTING = {
  sand: 'glass', ash: 'glass', raw_iron: 'iron_ingot', raw_cobalt: 'cobalt_ingot',
  raw_pork: 'cooked_pork', raw_beef: 'cooked_beef', raw_mutton: 'cooked_mutton', raw_chicken: 'cooked_chicken',
};
