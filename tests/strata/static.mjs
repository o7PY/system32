// Strata static checks (no browser): the committed assets fit the budget and cover every block face / item / sound role the game uses, the config matches
// the spec, the worker file is self-contained, nothing uses localStorage or allow-same-origin, credits and docs exist.   node tests/strata/static.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, RECIPES, SMELTING } from '../../games/strata/src/config.js';
import { BLOCKS, TILE_NAMES, B } from '../../games/strata/src/blocks.js';
import { ITEMS } from '../../games/strata/src/items.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const G = join(ROOT, 'games/strata');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const json = (p) => JSON.parse(readFileSync(join(G, p), 'utf8'));

// ---- assets
const files = walk(join(G, 'assets'));
const total = files.reduce((n, f) => n + statSync(f).size, 0);
const sounds = files.filter((f) => f.includes('/sounds/') && f.endsWith('.ogg')).reduce((n, f) => n + statSync(f).size, 0);
check(`games/strata/assets is ${(total / 1024).toFixed(0)} KB: within the 3 MB budget`, total <= 3 * 1024 * 1024);
check(`sounds are ${(sounds / 1024).toFixed(0)} KB: within 1.5 MB`, sounds <= 1.5 * 1024 * 1024);
check('no staged file is over 5 MB', files.every((f) => statSync(f).size < 5 * 1024 * 1024));
const atlas = json('assets/atlas.json');
const png = readFileSync(join(G, 'assets/atlas.png'));
check('atlas.png is a power-of-two square matching atlas.json (32 px tiles, 2 px padding)', png.readUInt32BE(16) === atlas.size && png.readUInt32BE(20) === atlas.size && (atlas.size & (atlas.size - 1)) === 0 && atlas.tile === 32 && atlas.padding === 2);
check('every tile a block face uses is in the atlas, and tiles never overlap or touch the padding of another', TILE_NAMES.every((n) => atlas.tiles[n]) && (() => {
  const t = Object.values(atlas.tiles), cell = 36;
  const slots = new Set(t.map((x) => `${(x.x - 2) / cell},${(x.y - 2) / cell}`));
  return slots.size === t.length && t.every((x) => (x.x - 2) % cell === 0 && (x.y - 2) % cell === 0 && x.x + 32 + 2 <= atlas.size && x.y + 32 + 2 <= atlas.size);
})());
const items = json('assets/items.json');
check('every item with a sheet icon is in items.json', Object.values(ITEMS).filter((i) => i.icon.sheet).every((i) => items.items[i.icon.sheet]));
const snd = json('assets/sounds.json');
const groups = ['stone', 'dirt', 'grass', 'wood', 'sand', 'glass'];
check('sounds exist for dig, break and step in every material group (stone, dirt, grass, wood, sand, glass)', groups.every((g) => ['dig', 'break', 'step'].every((k) => snd[`${k}.${g}`]?.length)));
check('sounds exist for place, pickup, ui click / open / close, furnace done, tool break and the iron jingle', ['place', 'pickup', 'ui.click', 'ui.open', 'ui.close', 'furnace.done', 'tool.break', 'jingle.iron'].every((r) => snd[r]?.length));
check('every sound file listed exists and is an Ogg Vorbis file', Object.values(snd).flat().every((f) => existsSync(join(G, 'assets/sounds', f)) && readFileSync(join(G, 'assets/sounds', f)).subarray(0, 4).toString() === 'OggS'));
check('every block group used by BLOCKS has sounds', BLOCKS.filter((b) => b.name !== 'air').every((b) => groups.includes(b.group)));
check('the font ships', statSync(join(G, 'assets/font.ttf')).size > 5000);

// ---- config against the spec
check('world is 1024 x 1024 x 128 with sea level 48, snow above 90, chunks 16 x 16', CONFIG.worldSize === 1024 && CONFIG.height === 128 && CONFIG.seaLevel === 48 && CONFIG.snowLine === 90 && CONFIG.chunk === 16);
check('view distance: default 8, setting 4 to 12, low quality 5', CONFIG.view.default === 8 && CONFIG.view.min === 4 && CONFIG.view.max === 12 && CONFIG.view.low === 5 && CONFIG.view.meshPerFrame === 2);
check('player: 0.6 x 1.8 x 0.6 box, eye 1.62, reach 5', CONFIG.player.width === 0.6 && CONFIG.player.height === 1.8 && CONFIG.player.eye === 1.62 && CONFIG.reach === 5);
check('tools: speeds hand 1 / wood 2 / stone 4 / iron 6 and durability 60 / 130 / 250', CONFIG.tools.hand.speed === 1 && [['wood', 2, 60], ['stone', 4, 130], ['iron', 6, 250]].every(([t, s, d]) => CONFIG.tools[t].speed === s && CONFIG.tools[t].durability === d));
check('mining: x 3.3 without the required tool, drops despawn after 5 minutes, pickup within 1.5 blocks, bedrock egg after 10 s', CONFIG.mining.noToolMul === 3.3 && CONFIG.mining.dropDespawnS === 300 && CONFIG.mining.dropRange === 1.5 && CONFIG.mining.bedrockEggS === 10);
check('stacks of 64, 9-slot hotbar + 27 slots, a day lasts 20 minutes, autosave every 60 s, save cap 2.5 MB', CONFIG.stack === 64 && CONFIG.inv.hotbar === 9 && CONFIG.inv.main === 27 && CONFIG.day.lengthS === 1200 && CONFIG.save.autosaveS === 60 && CONFIG.save.capBytes === 2.5 * 1048576);
check('furnace: 4 s per item; coal smelts 8, planks 1.5, sticks 0.5; sand -> glass, raw iron -> ingot', CONFIG.furnace.smeltS === 4 && CONFIG.furnace.fuel.coal === 8 && CONFIG.furnace.fuel.planks === 1.5 && CONFIG.furnace.fuel.stick === 0.5 && SMELTING.sand === 'glass' && SMELTING.raw_iron === 'iron_ingot');
check('recipes: planks, sticks, table, furnace, torch and 4 tools in 4 tiers; every output is a real item', ['planks', 'sticks', 'crafting_table', 'furnace', 'torch'].every((id) => RECIPES.some((r) => r.id === id)) && RECIPES.length === 5 + 16 && RECIPES.every((r) => ITEMS[r.out[0]]));
check('block table: bedrock is unbreakable, iron ore needs a stone pickaxe, coal ore a wood one, the Ad Block ore exists', BLOCKS[B.bedrock].hardness < 0 && BLOCKS[B.iron_ore].need.tier === 2 && BLOCKS[B.coal_ore].need.tier === 1 && BLOCKS[B.ad_block].egg === 'strata-adblock');

// ---- source rules
const src = Object.fromEntries(readdirSync(join(G, 'src')).map((f) => [f, readFileSync(join(G, 'src', f), 'utf8')]));
check('worker.js is self-contained: no import or export statements', !/^\s*(import|export)\s/m.test(src['worker.js']) && !/\bimport\s*\(/.test(src['worker.js']));
check('no game file uses localStorage / sessionStorage / indexedDB / cookies', Object.values(src).every((t) => !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(t)));
const page = readFileSync(join(G, 'index.html'), 'utf8');
check('the page loads the SDK as a classic script and the game as a module through the shared import map', /<script src="..\/_shared\/sdk\.js" data-game="strata">/.test(page) && /type="module" src="src\/main\.js"/.test(page) && page.includes('_shared/vendor/three/three.module.min.js'));
check('no Control key binding anywhere (the Ctrl guard is the only mention)', Object.values(src).every((t) => !/ControlLeft|ControlRight/.test(t)) && /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(src['main.js']));
check('Strata names, textures, sounds and fonts are only the ones credited: no trademarked words in the source', Object.values(src).concat(page).every((t) => !/minecraft|mojang|creeper|enderman|notch/i.test(t)));

// ---- docs and credits
const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
check('CREDITS.md lists every Kenney pack used (Voxel Pack, Impact, RPG, Interface, UI Audio, Music Jingles, Fonts)', ['Voxel Pack', 'Impact Sounds', 'RPG Audio', 'Interface Sounds', 'UI Audio', 'Music Jingles', 'Kenney Pixel'].every((n) => credits.includes(n)));
check('the asset plan, manifest and picks proposal are committed next to the spec', ['STRATA_ASSET_MANIFEST.md', 'STRATA_ASSET_PICKS_PROPOSAL.md', 'tools/strata/assets.json', 'tools/strata/build-assets.mjs', 'tools/strata/inventory-assets.mjs'].every((f) => existsSync(join(ROOT, f))));

console.log(`\nStrata static: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
