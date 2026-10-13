// Item registry: every block you can hold, plus materials, tools, food and armor. A stack is { id, n, dur? } (tools and armor carry `dur`, the uses left). No DOM, no three.js.
import { CONFIG } from './config.js';
import { BLOCKS, B, PLACEABLE } from './blocks.js';

const pretty = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'sword'];
export const TIERS = ['wood', 'stone', 'iron', 'cobalt'];
export const ARMOR_TIERS = ['leather', 'iron', 'cobalt'];

/** id -> { id, name, stack, block?, tool?, food?, armor?, attack, icon: { block } | { sheet } } */
export const ITEMS = {};
for (const name of PLACEABLE) ITEMS[name] = { id: name, name: pretty(name), stack: CONFIG.stack, block: B[name], icon: { block: B[name] } };
// blocks with their own item (several placed variants share it): the placement picks the variant (see main.js placeBlockFor)
ITEMS.torch = { id: 'torch', name: 'Torch', stack: CONFIG.stack, block: B.torch, icon: { sheet: 'torch' } };
ITEMS.chest = { id: 'chest', name: 'Chest', stack: CONFIG.stack, block: B.chest_s, icon: { block: B.chest_s } };
ITEMS.bed = { id: 'bed', name: 'Bed', stack: 1, block: B.bed_foot_s, icon: { sheet: 'bed' } };
for (const [id, name, extra] of [
  ['stick', 'Stick'], ['coal', 'Coal'], ['raw_iron', 'Raw iron'], ['iron_ingot', 'Iron ingot'], ['popup', 'Ad Block'],
  ['raw_cobalt', 'Raw cobalt'], ['cobalt_ingot', 'Cobalt ingot'], ['cobalt_nugget', 'Cobalt nugget'], ['ash_dust', 'Ash dust'], ['glitch_dust', 'Glitch dust'],
  ['wheat', 'Wheat'], ['bowl', 'Bowl'], ['leather', 'Leather'], ['feather', 'Feather'], ['string', 'String'], ['bone', 'Bone'], ['flint', 'Flint'],
  ['arrow', 'Arrow'], ['kernel_shard', 'Kernel Shard', { stack: 3 }], ['kernel_key', 'Kernel Key', { stack: 1 }], ['tracer', 'Tracer', { stack: 1 }],
  ['shears', 'Shears', { stack: 1, durability: 238 }], ['bow', 'Bow', { stack: 1, durability: 384 }],
]) ITEMS[id] = { id, name, stack: CONFIG.stack, icon: { sheet: id }, ...(extra ?? {}) };
ITEMS.glowcap = { id: 'glowcap', name: 'Glowcap', stack: CONFIG.stack, icon: { sheet: 'glowcap' } };
for (const [id, f] of Object.entries(CONFIG.food)) ITEMS[id] = { id, name: id === 'popup' ? 'Ad Block' : pretty(id), stack: CONFIG.stack, icon: { sheet: id }, food: f, ...(ITEMS[id] ?? {}) };
for (const type of TOOL_TYPES) for (const tier of TIERS) {
  const t = CONFIG.tools[tier], id = `${type}_${tier}`, a = CONFIG.attack;
  const sword = a.sword[tier], attack = type === 'sword' ? sword : sword - (type === 'axe' ? a.axeLess : a.otherLess);
  ITEMS[id] = { id, name: `${pretty(tier)} ${type}`, stack: 1, tool: { type, tier, tierN: t.tier, speed: t.speed, durability: t.durability }, attack, icon: { sheet: id } };
}
ARMOR_TIERS.forEach((tier) => CONFIG.armor.slots.forEach((slot, i) => {
  const t = CONFIG.armor.tiers[tier], id = `${tier}_${slot}`;
  ITEMS[id] = { id, name: `${pretty(tier)} ${slot}`, stack: 1, armor: { slot, slotN: i, tier, points: t.points[i], durability: Math.round(t.durability * CONFIG.armor.durabilityMul[i]) }, icon: { sheet: id } };
}));
export const itemInfo = (id) => ITEMS[id] ?? null;
export const maxStack = (id) => ITEMS[id]?.stack ?? CONFIG.stack;
/** Things that wear out: tools, armor, shears and the bow. Their stack keeps `dur`. */
export const durabilityOf = (id) => ITEMS[id]?.tool?.durability ?? ITEMS[id]?.armor?.durability ?? ITEMS[id]?.durability ?? 0;
export const isTool = (id) => !!ITEMS[id]?.tool;
export const isArmor = (id) => !!ITEMS[id]?.armor;
export const isFood = (id) => !!ITEMS[id]?.food;
export const hasDurability = (id) => durabilityOf(id) > 0;
export const blockItem = (blockId) => { const n = BLOCKS[blockId]?.name; return ITEMS[n] ? n : null; };

/** A fresh stack of `n` items (a tool, armor piece, bow or shears starts with full durability). */
export const stack = (id, n = 1) => {
  if (!ITEMS[id]) throw new Error(`unknown item "${id}"`);
  const d = durabilityOf(id);
  return d ? { id, n: 1, dur: d } : { id, n };
};
export const cloneStack = (s) => (s ? { ...s } : null);
