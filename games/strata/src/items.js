// Item registry: every block you can hold, plus materials and tools. A stack is { id, n, dur? } (tools carry `dur`, the uses left). No DOM, no three.js.
import { CONFIG } from './config.js';
import { BLOCKS, B, PLACEABLE } from './blocks.js';

const pretty = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'sword'];
export const TIERS = ['wood', 'stone', 'iron'];

/** id -> { id, name, stack, block?, tool?: {type, tier, tierN, speed, durability}, icon: { block } | { sheet } } */
export const ITEMS = {};
for (const name of PLACEABLE) ITEMS[name] = { id: name, name: pretty(name), stack: CONFIG.stack, block: B[name], icon: { block: B[name] } };
for (const [id, name] of [['stick', 'Stick'], ['coal', 'Coal'], ['raw_iron', 'Raw iron'], ['iron_ingot', 'Iron ingot'], ['popup', 'Pop-up']]) ITEMS[id] = { id, name, stack: CONFIG.stack, icon: { sheet: id } };
for (const type of TOOL_TYPES) for (const tier of TIERS) {
  const t = CONFIG.tools[tier], id = `${type}_${tier}`;
  ITEMS[id] = { id, name: `${pretty(tier)} ${type}`, stack: 1, tool: { type, tier, tierN: t.tier, speed: t.speed, durability: t.durability }, icon: { sheet: id } };
}
export const itemInfo = (id) => ITEMS[id] ?? null;
export const maxStack = (id) => ITEMS[id]?.stack ?? CONFIG.stack;
export const isTool = (id) => !!ITEMS[id]?.tool;
export const blockItem = (blockId) => { const n = BLOCKS[blockId]?.name; return ITEMS[n] ? n : null; };

/** A fresh stack of `n` items (a tool starts with full durability). */
export const stack = (id, n = 1) => {
  if (!ITEMS[id]) throw new Error(`unknown item "${id}"`);
  return ITEMS[id].tool ? { id, n: 1, dur: ITEMS[id].tool.durability } : { id, n };
};
export const cloneStack = (s) => (s ? { ...s } : null);
