// Block registry: id, name, how it is drawn and collided, which tile each face uses, hardness, the tool it needs and what it drops.
// No DOM, no three.js: Node tests import it and the worker gets a plain table built from it (workerTable) so there is ONE source of truth.
// Face order everywhere: +x, -x, +y (top), -y (bottom), +z, -z.

/** kind: 'air' | 'opaque' (hides faces behind it) | 'cutout' (alpha-tested: leaves, glass) | 'water' (translucent, not solid) */
const side = (n) => [n, n, null, null, n, n];
const cube = (top, bottom, sideTile, front = sideTile) => [sideTile, sideTile, top, bottom, front, sideTile];
const all = (t) => [t, t, t, t, t, t];

/**
 * hardness: seconds with the right tool at speed 1 (see CONFIG.mining). tool: the tool type that mines it faster.
 * need: { tool, tier } the block only DROPS with that tool tier or better (it still breaks without, slowly).
 * drop: [itemId, count, chance]. group: the sound material.
 */
const DEFS = [
  { name: 'air', kind: 'air' },
  { name: 'bedrock', tiles: all('bedrock'), hardness: -1, group: 'stone' },
  { name: 'stone', tiles: all('stone'), hardness: 1.5, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['cobblestone', 1, 1], group: 'stone' },
  { name: 'dirt', tiles: all('dirt'), hardness: 0.5, tool: 'shovel', drop: ['dirt', 1, 1], group: 'dirt' },
  { name: 'grass', tiles: cube('grass_top', 'dirt', 'grass_side'), hardness: 0.6, tool: 'shovel', drop: ['dirt', 1, 1], group: 'grass' },
  { name: 'sand', tiles: all('sand'), hardness: 0.5, tool: 'shovel', drop: ['sand', 1, 1], group: 'sand' },
  { name: 'gravel', tiles: all('gravel'), hardness: 0.6, tool: 'shovel', drop: ['gravel', 1, 1], group: 'dirt' },
  { name: 'cobblestone', tiles: all('cobblestone'), hardness: 2, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['cobblestone', 1, 1], group: 'stone' },
  { name: 'log', tiles: cube('log_top', 'log_top', 'log_side'), hardness: 2, tool: 'axe', drop: ['log', 1, 1], group: 'wood' },
  { name: 'planks', tiles: all('planks'), hardness: 2, tool: 'axe', drop: ['planks', 1, 1], group: 'wood' },
  { name: 'leaves', kind: 'cutout', tiles: all('leaves'), hardness: 0.2, drop: ['stick', 1, 0.1], group: 'grass' },
  { name: 'glass', kind: 'cutout', tiles: all('glass'), hardness: 0.3, group: 'glass' },                      // drops nothing
  { name: 'water', kind: 'water', tiles: all('water'), hardness: -1, group: 'sand' },
  { name: 'coal_ore', tiles: all('coal_ore'), hardness: 3, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['coal', 1, 1], group: 'stone' },
  { name: 'iron_ore', tiles: all('iron_ore'), hardness: 3, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 2 }, drop: ['raw_iron', 1, 1], group: 'stone' },
  { name: 'crafting_table', tiles: cube('crafting_table_top', 'planks', 'crafting_table_side', 'crafting_table_front'), hardness: 2.5, tool: 'axe', drop: ['crafting_table', 1, 1], group: 'wood', use: 'crafting' },
  { name: 'furnace', tiles: [ 'furnace_side', 'furnace_side', 'furnace_top', 'furnace_top', 'furnace_front', 'furnace_side'], hardness: 3.5, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['furnace', 1, 1], group: 'stone', use: 'furnace' },
  { name: 'snow', tiles: cube('snow', 'dirt', 'snow_side'), hardness: 0.3, tool: 'shovel', drop: ['dirt', 1, 1], group: 'sand' },
  { name: 'cactus', tiles: cube('cactus_top', 'cactus_top', 'cactus_side'), hardness: 0.4, drop: ['cactus', 1, 1], group: 'grass' },
  { name: 'ad_block', tiles: all('ad_block'), hardness: 4, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['popup', 1, 1], group: 'stone', egg: 'strata-adblock' },
];

export const BLOCKS = DEFS.map((d, id) => ({
  id, kind: 'opaque', hardness: 1, group: 'stone', ...d,
  solid: !['air', 'water'].includes(d.kind ?? 'opaque'),
  opaque: (d.kind ?? 'opaque') === 'opaque',
}));
export const B = Object.fromEntries(BLOCKS.map((b) => [b.name, b.id]));
export const BLOCK_BY_NAME = Object.fromEntries(BLOCKS.map((b) => [b.name, b]));
export const isSolid = (id) => BLOCKS[id]?.solid ?? false;
export const isOpaque = (id) => BLOCKS[id]?.opaque ?? false;
export const isWater = (id) => id === B.water;
/** Blocks the player can collect and place: everything but air, water, bedrock and the Ad Block ore (which drops a pop-up). */
export const PLACEABLE = BLOCKS.filter((b) => !['air', 'water', 'bedrock', 'ad_block'].includes(b.name)).map((b) => b.name);

export const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];

/** Tile names the atlas must contain. */
export const TILE_NAMES = [...new Set(BLOCKS.flatMap((b) => b.tiles ?? []))];

/**
 * The plain table the worker needs, built from an atlas.json: per block its kind and, per face, the atlas UV rect [u0, v0, u1, v1]
 * inset by half a texel (NearestFilter, no mipmaps) so neighbouring tiles never bleed in.
 */
export function workerTable(atlas) {
  const S = atlas.size, T = atlas.tile;
  const rect = (name) => {
    const t = atlas.tiles[name];
    if (!t) throw new Error(`atlas has no tile "${name}"`);
    return [(t.x + 0.5) / S, 1 - (t.y + T - 0.5) / S, (t.x + T - 0.5) / S, 1 - (t.y + 0.5) / S];     // v is flipped: image row 0 is the top
  };
  return {
    ids: B,
    blocks: BLOCKS.map((b) => ({ kind: b.kind, tiles: b.tiles ? b.tiles.map(rect) : null })),
  };
}
