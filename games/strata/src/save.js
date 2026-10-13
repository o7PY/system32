// World save: serialize / deserialize, no DOM. Format of the string handed to System32.save():
//   "STRATA1:" + ("z" deflate-raw | "r" raw) + ":" + base64( [u32 LE header length][header JSON, utf-8][edits bytes] )   (the whole container is compressed)
// Header: seed, world size, spawn, player, inventory, furnaces, time of day, settings. Edits: the blocks that differ from what the generator makes, per chunk:
//   repeated  u16 cx, u16 cz, u32 count, then count x (u16 local index, u8 block id).
// A world nobody has built in saves in a few hundred bytes. Loading validates everything: a corrupt save is rejected with a SaveError, never half-loaded.
import { CONFIG } from './config.js';
import { BLOCKS } from './blocks.js';
import { ITEMS, durabilityOf } from './items.js';
import { DIFFICULTIES } from './survival.js';

export const MAGIC = 'STRATA1';
export const DIMS = ['overworld', 'underlayer'];
const DIM_SIZE = { underlayer: 512 };
export class SaveError extends Error {}
const fail = (m) => { throw new SaveError(m); };

const CHUNK_CELLS = CONFIG.chunk * CONFIG.chunk * CONFIG.height;
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function packEdits(edits) {
  let n = 0;
  for (const e of edits.values()) n += 8 + e.size * 3;
  const out = new Uint8Array(n), dv = new DataView(out.buffer);
  let o = 0;
  for (const [key, e] of edits) {
    if (!e.size) continue;
    dv.setUint16(o, key & 0xffff, true); dv.setUint16(o + 2, key >>> 16, true); dv.setUint32(o + 4, e.size, true); o += 8;
    for (const [i, id] of e) { dv.setUint16(o, i, true); out[o + 2] = id; o += 3; }
  }
  return out.subarray(0, o);
}

export function unpackEdits(bytes, worldSize = CONFIG.worldSize) {
  const edits = new Map(), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), per = worldSize / CONFIG.chunk;
  let o = 0;
  while (o < bytes.length) {
    if (o + 8 > bytes.length) fail('truncated edits');
    const cx = dv.getUint16(o, true), cz = dv.getUint16(o + 2, true), count = dv.getUint32(o + 4, true);
    o += 8;
    if (cx >= per || cz >= per) fail('edit outside the world');
    if (count > CHUNK_CELLS || o + count * 3 > bytes.length) fail('bad edit count');
    const key = (cz << 16) | cx, m = edits.get(key) ?? new Map();
    for (let k = 0; k < count; k++, o += 3) {
      const i = dv.getUint16(o, true), id = bytes[o + 2];
      if (i >= CHUNK_CELLS || id >= BLOCKS.length) fail('bad edit');
      m.set(i, id);
    }
    edits.set(key, m);
  }
  return edits;
}

// ---- base64 and compression (btoa / atob and CompressionStream exist in the browser and in Node)
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(str) {
  let s;
  try { s = atob(str); } catch { fail('not base64'); }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

/** @param s { seed, worldSize, flat, spawn, player, inv, furnaces, time, settings, flags, edits: Map } */
export async function serialize(s, { compress = true } = {}) {
  const header = new TextEncoder().encode(JSON.stringify({
    v: CONFIG.save.version, seed: s.seed >>> 0, worldSize: s.worldSize, flat: !!s.flat, spawn: s.spawn, player: s.player, inv: s.inv,
    furnaces: s.furnaces ?? {}, time: s.time, settings: s.settings, flags: s.flags ?? {}, vitals: s.vitals ?? null, drops: s.drops ?? [], animals: s.animals ?? [], chests: s.chests ?? {},
    otherDrops: s.otherDrops ?? {}, dims: Object.fromEntries(Object.entries(s.dims ?? {}).filter(([, m]) => m.size).map(([k, m]) => [k, toBase64(packEdits(m))])),
  }));
  const edits = packEdits(s.edits ?? new Map());
  const box = new Uint8Array(4 + header.length + edits.length);
  new DataView(box.buffer).setUint32(0, header.length, true);
  box.set(header, 4); box.set(edits, 4 + header.length);
  const z = compress && canCompress();
  return `${MAGIC}:${z ? 'z' : 'r'}:${toBase64(z ? await pipe(box, new CompressionStream('deflate-raw')) : box)}`;
}

const validStack = (s) => s === null || (s && typeof s.id === 'string' && ITEMS[s.id] && Number.isInteger(s.n) && s.n >= 1 && s.n <= ITEMS[s.id].stack && (s.dur === undefined || (Number.isFinite(s.dur) && s.dur >= 1 && s.dur <= durabilityOf(s.id))));

/** Parse and validate. Throws SaveError for anything that is not a sane save (wrong magic, garbage, impossible numbers). */
export async function deserialize(str) {
  if (typeof str !== 'string' || !str.startsWith(`${MAGIC}:`)) fail('not a Strata save');
  const [, flag, b64] = str.split(':');
  if ((flag !== 'z' && flag !== 'r') || typeof b64 !== 'string') fail('bad header');
  let box = fromBase64(b64);
  if (flag === 'z') {
    if (!canCompress()) fail('this browser cannot read compressed saves');
    try { box = await pipe(box, new DecompressionStream('deflate-raw')); } catch { fail('corrupt data'); }
  }
  if (box.length < 4) fail('too short');
  const hl = new DataView(box.buffer, box.byteOffset, box.byteLength).getUint32(0, true);
  if (hl < 2 || hl > 4_000_000 || 4 + hl > box.length) fail('bad header length');
  let h;
  try { h = JSON.parse(new TextDecoder().decode(box.subarray(4, 4 + hl))); } catch { fail('bad header JSON'); }
  if (!h || h.v !== CONFIG.save.version) fail('unknown save version');
  const S = h.worldSize;
  if (!Number.isInteger(S) || S < 64 || S > 4096 || (S & (S - 1)) !== 0) fail('bad world size');
  if (!Number.isInteger(h.seed) || h.seed < 0 || h.seed > 0xffffffff) fail('bad seed');
  const p = h.player, sp = h.spawn;
  if (!p || !num(p.x, 0, S) || !num(p.z, 0, S) || !num(p.y, -64, CONFIG.height + 64) || !num(p.yaw, -1e4, 1e4) || !num(p.pitch, -2, 2)) fail('bad player');
  if (!sp || !num(sp.x, 0, S) || !num(sp.z, 0, S) || !num(sp.y, -64, CONFIG.height + 64)) fail('bad spawn');
  if (p.dim !== undefined && !DIMS.includes(p.dim)) fail('bad dimension');
  if (!h.inv || !Array.isArray(h.inv.slots) || h.inv.slots.length !== CONFIG.inv.hotbar + CONFIG.inv.main || !h.inv.slots.every(validStack)) fail('bad inventory');
  if (!num(h.time, 0, 1)) fail('bad time');
  const fz = h.furnaces ?? {};
  if (typeof fz !== 'object' || Object.values(fz).some((f) => !f || !validStack(f.input ?? null) || !validStack(f.fuel ?? null) || !validStack(f.output ?? null) || !num(f.burn ?? 0, 0, 1e6) || !num(f.cook ?? 0, 0, 100))) fail('bad furnace');
  const st = { ...CONFIG.settings, ...(h.settings && typeof h.settings === 'object' ? h.settings : {}) };
  if (!num(st.sensitivity, 0.1, 5) || !num(st.fov, 60, 100) || !num(st.viewDistance, CONFIG.view.min, CONFIG.view.max) || !num(st.volume, 0, 1)) fail('bad settings');
  if (!DIFFICULTIES.includes(st.difficulty)) fail('bad difficulty');
  const v = h.vitals ?? null;
  if (v !== null && (typeof v !== 'object' || (v.armor ?? []).length > 4 || !(v.armor ?? []).every(validStack))) fail('bad vitals');
  const dr = h.drops ?? [];
  if (!Array.isArray(dr) || dr.length > 400 || dr.some((d) => !d || !validStack(d.stack) || !d.stack || !num(d.x, -64, S + 64) || !num(d.y, -64, CONFIG.height + 64) || !num(d.z, -64, S + 64) || !num(d.age ?? 0, 0, 1e7))) fail('bad drops');
  const an = h.animals ?? [];
  if (!Array.isArray(an) || an.length > 6000 || an.some((e) => !Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || !Array.isArray(e[2]) || e[2].length > 64)) fail('bad animals');
  const ch = h.chests ?? {};
  if (typeof ch !== 'object' || Array.isArray(ch) || Object.keys(ch).length > 1000 || Object.entries(ch).some(([k, v]) => !/^([a-z]+\|)?-?\d+,-?\d+,-?\d+$/.test(k) || !Array.isArray(v) || v.length !== 27 || !v.every(validStack))) fail('bad chests');
  const dimsRaw = h.dims ?? {}, dims = {};
  if (typeof dimsRaw !== 'object' || Array.isArray(dimsRaw)) fail('bad dimensions');
  for (const [k, b64] of Object.entries(dimsRaw)) { if (!DIMS.includes(k) || k === 'overworld' || typeof b64 !== 'string') fail('bad dimension data'); dims[k] = unpackEdits(fromBase64(b64), DIM_SIZE[k]); }
  const od = h.otherDrops ?? {};
  if (typeof od !== 'object' || Array.isArray(od) || Object.entries(od).some(([k, list]) => !DIMS.includes(k) || !Array.isArray(list) || list.length > 400 || list.some((d) => !d || !validStack(d.stack) || !d.stack || !num(d.x, -64, 5000) || !num(d.y, -64, CONFIG.height + 64) || !num(d.z, -64, 5000) || !num(d.age ?? 0, 0, 1e7)))) fail('bad stashed drops');
  const edits = unpackEdits(box.subarray(4 + hl), S);
  return { seed: h.seed, worldSize: S, flat: !!h.flat, spawn: sp, player: p, inv: h.inv, furnaces: fz, time: h.time, settings: { ...st, invertY: !!st.invertY, music: st.music !== false, keepInventory: !!st.keepInventory, compass: st.compass !== false, subtitles: !!st.subtitles }, flags: h.flags ?? {}, vitals: v, drops: dr, animals: an, chests: ch, dims, otherDrops: od, edits };
}

/** Human size for the warning: 1.6 MB / 1.5 MB. */
export const fmtMB = (n) => `${(n / 1048576).toFixed(1)} MB`;
