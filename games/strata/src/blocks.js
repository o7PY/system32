// Block registry: id, name, how it is drawn and collided, which tile each face uses, hardness, the tool it needs and what it drops.
// No DOM, no three.js: Node tests import it and the worker gets a plain table built from it (workerTable) so there is ONE source of truth.
// Face order everywhere: +x, -x, +y (top), -y (bottom), +z, -z.

/**
 * kind: 'air' | 'opaque' (hides faces behind it) | 'cutout' (alpha-tested: leaves, glass) | 'water' (translucent, not solid)
 *       | 'lava' (opaque colours, not solid, its top sits 1/8 low, lights its surroundings) | 'plant' (two crossed quads, not solid) | 'box' (a partial cuboid, see `box`).
 * Part 2 fields: emit (light 0..15 it gives off), dim (how much sky light it takes away when light passes: leaves and water 1), box [x0,y0,z0,x1,y1,z1]
 * in 16ths of a block (kind 'box'), uvr / uvTop / uvBot [u0,v0,u1,v1] in 16ths of the tile (the box faces sample that part of the tile instead of the whole cell),
 * solid (override), item (the item it drops / is placed from when it is a variant of another block, or false = no item), only (breakable ONLY with `need`).
 * New blocks are always APPENDED: the ids are stored in saves.
 */
const side = (n) => [n, n, null, null, n, n];
const cube = (top, bottom, sideTile, front = sideTile) => [sideTile, sideTile, top, bottom, front, sideTile];
const all = (t) => [t, t, t, t, t, t];
/** A block with a front: d = the way the front looks (n = -z, s = +z, e = +x, w = -x). Faces: +x, -x, +y, -y, +z, -z. */
function facing(d, top, bottom, side, front) {
  const t = [side, side, top, bottom, side, side];
  t[{ e: 0, w: 1, s: 4, n: 5 }[d]] = front;
  return t;
}

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
  // ---- Part 2 (ids 20+). Variants for orientation are separate ids (the chunk format has no metadata byte).
  { name: 'torch', kind: 'box', box: [7, 0, 7, 9, 14, 9], uvr: [7, 0, 9, 14], uvTop: [7, 10, 9, 12], uvBot: [7, 0, 9, 2], tiles: all('torch'), solid: false, emit: 14, hardness: 0.05, drop: ['torch', 1, 1], group: 'wood', item: 'torch' },
  ...[['px', [1, 1, 7, 3, 15, 9]], ['nx', [13, 1, 7, 15, 15, 9]], ['pz', [7, 1, 1, 9, 15, 3]], ['nz', [7, 1, 13, 9, 15, 15]]].map(([d, box]) => (
    { name: `torch_${d}`, kind: 'box', box, uvr: [7, 0, 9, 14], uvTop: [7, 10, 9, 12], uvBot: [7, 0, 9, 2], tiles: all('torch'), solid: false, emit: 14, hardness: 0.05, drop: ['torch', 1, 1], group: 'wood', item: 'torch', variant: true }
  )),
  { name: 'cobalt_ore', tiles: all('cobalt_ore'), hardness: 4, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 3 }, drop: ['raw_cobalt', 1, 1], group: 'stone' },
  { name: 'cracked_bedrock', tiles: all('cracked_bedrock'), hardness: 72, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 4 }, only: true, group: 'stone', item: false, emit: 4 },
  { name: 'berry_bush', kind: 'plant', tiles: all('berry_bush'), hardness: 0.1, drop: ['berries', 2, 1], group: 'grass', item: false },
  { name: 'wild_wheat', kind: 'plant', tiles: all('wild_wheat'), hardness: 0.1, drop: ['wheat', 1, 1], group: 'grass', item: false },
  { name: 'ash', tiles: all('ash'), hardness: 0.5, tool: 'shovel', drop: ['ash', 1, 1], group: 'sand' },
  { name: 'basalt', tiles: all('basalt'), hardness: 2.2, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['basalt', 1, 1], group: 'stone' },
  { name: 'scorched_stone', tiles: all('scorched_stone'), hardness: 1.8, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['scorched_stone', 1, 1], group: 'stone' },
  { name: 'lava', kind: 'lava', tiles: all('lava'), hardness: -1, emit: 15, group: 'sand', item: false },
  { name: 'glowcap', kind: 'plant', tiles: all('glowcap'), hardness: 0.1, emit: 10, drop: ['glowcap', 1, 1], group: 'grass', item: false },
  { name: 'server_rack', tiles: [ 'server_rack_side', 'server_rack_side', 'server_rack_side', 'server_rack_side', 'server_rack_front', 'server_rack_side'], hardness: -1, group: 'stone', item: false },
  { name: 'vault_door', tiles: all('vault_door'), hardness: -1, group: 'stone', item: false },
  { name: 'rift', tiles: all('rift'), hardness: -1, emit: 10, group: 'glass', item: false, use: 'rift' },
  { name: 'rift_white', tiles: all('rift_white'), hardness: -1, emit: 12, group: 'glass', item: false, use: 'rift' },
  { name: 'spawner', tiles: all('spawner'), hardness: 5, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, group: 'stone', item: false, emit: 6 },
  { name: 'memory_block', tiles: all('memory_block'), hardness: 1.5, tool: 'pickaxe', drop: ['memory_block', 1, 1], group: 'glass', emit: 3 },
  { name: 'kernel_crystal', tiles: all('kernel_crystal'), hardness: 27, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 4 }, drop: null, group: 'glass', item: false, emit: 12 },
  { name: 'kernel_core', tiles: all('kernel_core'), hardness: 2, tool: 'pickaxe', drop: ['kernel_core', 1, 1], group: 'glass', emit: 15 },
  { name: 'furnace_lit', tiles: ['furnace_side', 'furnace_side', 'furnace_top', 'furnace_top', 'furnace_front', 'furnace_side'], hardness: 3.5, tool: 'pickaxe', need: { tool: 'pickaxe', tier: 1 }, drop: ['furnace', 1, 1], group: 'stone', use: 'furnace', emit: 13, item: 'furnace', variant: true },
  { name: 'wool', tiles: all('wool'), hardness: 0.8, drop: ['wool', 1, 1], group: 'grass' },
  ...['n', 's', 'e', 'w'].map((d) => ({ name: `chest_${d}`, kind: 'box', box: [1, 0, 1, 15, 14, 15], tiles: facing(d, 'chest_top', 'planks', 'chest_side', 'chest_front'), solid: true, hardness: 2.5, tool: 'axe', drop: ['chest', 1, 1], group: 'wood', use: 'chest', item: 'chest', variant: d !== 's' })),
  ...['n', 's', 'e', 'w'].flatMap((d) => [['foot', 'bed_top'], ['head', 'bed_pillow']].map(([part, top]) => ({ name: `bed_${part}_${d}`, kind: 'box', box: [0, 0, 0, 16, 9, 16], tiles: facing(d, top, 'planks', 'bed_side', 'bed_side'), solid: true, hardness: 0.4, drop: ['bed', 1, 1], group: 'wood', use: 'bed', item: 'bed', variant: true, bed: { part, dir: d } }))),
];

export const BLOCKS = DEFS.map((d, id) => ({
  id, kind: 'opaque', hardness: 1, group: 'stone', emit: 0, dim: d.kind === 'cutout' && d.name === 'leaves' || d.kind === 'water' ? 1 : 0, ...d,
  solid: d.solid ?? !['air', 'water', 'lava', 'plant'].includes(d.kind ?? 'opaque'),
  opaque: (d.kind ?? 'opaque') === 'opaque',
}));
export const B = Object.fromEntries(BLOCKS.map((b) => [b.name, b.id]));
export const BLOCK_BY_NAME = Object.fromEntries(BLOCKS.map((b) => [b.name, b]));
export const isSolid = (id) => BLOCKS[id]?.solid ?? false;
export const isOpaque = (id) => BLOCKS[id]?.opaque ?? false;
export const isWater = (id) => id === B.water;
/** Blocks the player can collect and place as ITS OWN item: no variants (torch_px ...), nothing unbreakable, nothing that only exists in the world. */
export const PLACEABLE = BLOCKS.filter((b) => !['air', 'water', 'bedrock', 'ad_block'].includes(b.name) && b.item === undefined && !b.variant).map((b) => b.name);
/** The item a block turns into when picked or dropped (torch_px -> torch), or null. */
export const itemOfBlock = (id) => { const b = BLOCKS[id]; return b ? (b.item === false ? null : typeof b.item === 'string' ? b.item : b.name) : null; };
/** Is this block a furnace (lit or not)? */
export const isFurnace = (id) => id === B.furnace || id === B.furnace_lit;
/** Cell-relative collision box [x0,y0,z0,x1,y1,z1] in blocks for a solid block (the full cell unless it has a `box`). */
export const collisionBox = (id) => { const b = BLOCKS[id]; return b?.box ? b.box.map((v) => v / 16) : [0, 0, 0, 1, 1, 1]; };

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
  const frames = (name) => atlas.tiles[name]?.frames ?? 0;                                           // animated tiles: how many frames sit side by side
  return {
    ids: B,
    blocks: BLOCKS.map((b) => ({
      kind: b.kind, tiles: b.tiles ? b.tiles.map(rect) : null, fr: b.tiles ? b.tiles.map(frames) : null, emit: b.emit, dim: b.dim,
      box: b.box ?? null, uvr: b.uvr ?? null, uvTop: b.uvTop ?? null, uvBot: b.uvBot ?? null,
    })),
  };
}
