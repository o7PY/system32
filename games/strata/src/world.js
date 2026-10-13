// Chunk storage and streaming. No three.js here: the renderer gets finished meshes through callbacks, so Node tests can drive a World with the
// real generator. Chunks are Uint8Array(16 * 16 * 128), index = (y << 8) | (z << 4) | x. Generation and meshing run in a Web Worker (started from a
// Blob URL, see createBackend) or, if that is not possible, on the main thread in time-sliced batches: same code, same bytes.
import { CONFIG } from './config.js';
import { B, workerTable } from './blocks.js';

const CS = CONFIG.chunk, H = CONFIG.height, PW = CS + 2;
export const chunkKey = (cx, cz) => (cz << 16) | cx;
export const localIndex = (lx, y, lz) => (y << 8) | (lz << 4) | lx;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ backends
/** Runs the generator on the calling thread, one queued job at a time (pump() is called every frame with a time budget). */
export class InlineBackend {
  constructor(gen) { this.gen = gen; this.kind = 'inline'; this.queue = []; this.pending = 0; }
  #job(run, urgent) { return new Promise((resolve, reject) => { this.pending++; (urgent ? this.queue.unshift.bind(this.queue) : this.queue.push.bind(this.queue))({ run, resolve, reject }); }); }
  init(cfg) { this.gen.init(cfg); return Promise.resolve(true); }
  generate(cx, cz) { return this.#job(() => this.gen.generate(cx, cz)); }
  mesh(padded, urgent = false) { return this.#job(() => this.gen.mesh(padded), urgent); }
  spawn() { return this.#job(() => this.gen.spawn()); }
  column(x, z) { return Promise.resolve(this.gen.columnInfo(x, z)); }
  /** Run queued jobs until the budget is used (at least one, so work always moves). Returns how many ran. */
  pump(budgetMs = CONFIG.view.inlineBudgetMs) {
    const t0 = nowMs();
    let n = 0;
    while (this.queue.length && (n === 0 || nowMs() - t0 < budgetMs)) {
      const j = this.queue.shift();
      this.pending--; n++;
      try { j.resolve(j.run()); } catch (e) { j.reject(e); }
    }
    return n;
  }
  /** Tests: run everything that is queued. */
  drain() { while (this.queue.length) this.pump(1e9); }
  dispose() { this.queue.length = 0; this.pending = 0; }
}

export class WorkerBackend {
  constructor(worker) {
    this.worker = worker; this.kind = 'worker'; this.pending = 0; this.next = 1; this.jobs = new Map();
    worker.onmessage = (e) => {
      const m = e.data, j = this.jobs.get(m.rid);
      if (!j) return;
      this.jobs.delete(m.rid); this.pending--;
      if (m.t === 'error') j.reject(new Error(m.message)); else j.resolve(m);
    };
    worker.onerror = (e) => { for (const j of this.jobs.values()) j.reject(new Error(e.message || 'worker error')); this.jobs.clear(); this.pending = 0; };
  }
  #call(msg, transfer = []) {
    return new Promise((resolve, reject) => { const rid = this.next++; this.jobs.set(rid, { resolve, reject }); this.pending++; this.worker.postMessage({ ...msg, rid }, transfer); });
  }
  init(cfg) { return this.#call({ t: 'init', cfg }); }
  generate(cx, cz) { return this.#call({ t: 'gen', cx, cz }).then((r) => ({ data: r.data, biomes: r.biomes })); }
  mesh(padded) { return this.#call({ t: 'mesh', padded }, [padded.buffer]).then((r) => r.mesh); }
  spawn() { return this.#call({ t: 'spawn' }).then((r) => r.spawn); }
  column(x, z) { return this.#call({ t: 'column', x, z }).then((r) => r.info); }
  pump() { return 0; }
  dispose() { this.worker.terminate(); this.jobs.clear(); this.pending = 0; }
}

/**
 * A worker from a Blob URL: a sandboxed page has an opaque origin, so `new Worker('worker.js')` is refused; fetch the source, make a Blob and start
 * a classic worker from its URL. worker.js is self-contained for exactly this reason. Falls back to the main thread (a <script> tag loads the very same
 * file) if anything fails, or with `?noWorker=1`. `info.reason` says why.
 */
export async function createBackend({ noWorker = false, base = 'src/', timeoutMs = 4000 } = {}) {
  const info = { kind: 'inline', reason: noWorker ? 'noWorker' : '' };
  if (!noWorker) {
    try {
      const src = await (await fetch(`${base}worker.js`)).text();
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('worker did not start')), timeoutMs); w.onmessage = (e) => { if (e.data?.t === 'hello') { clearTimeout(t); ok(); } }; w.onerror = (e) => { clearTimeout(t); no(new Error(e.message || 'worker error')); }; });
      URL.revokeObjectURL(url);
      return { backend: new WorkerBackend(w), info: { kind: 'worker', reason: '' } };
    } catch (e) { info.reason = String(e?.message ?? e); }
  }
  if (!globalThis.StrataGen) {
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = `${base}worker.js`; s.onload = ok; s.onerror = () => no(new Error('could not load worker.js on the main thread')); document.head.append(s); });
  }
  return { backend: new InlineBackend(globalThis.StrataGen), info };
}

// ------------------------------------------------------------------ the world
/** @typedef {{cx: number, cz: number, data: Uint8Array|null, base: Uint8Array|null, biomes: Uint8Array|null, ver: number, meshVer: number, meshing: boolean, requested: boolean, urgent: boolean}} Chunk */
export class World {
  /**
   * @param backend  InlineBackend | WorkerBackend
   * @param atlas    atlas.json (the worker needs the face UVs)
   */
  constructor({ backend, atlas, size = CONFIG.worldSize }) {
    this.backend = backend;
    this.table = workerTable(atlas);
    this.size = size;
    this.chunksPerSide = size / CS;
    this.chunks = new Map();
    this.edits = new Map();             // chunkKey -> Map(localIndex -> block id): only blocks that differ from the generator
    this.view = CONFIG.view.default;
    this.seed = 0; this.flat = false;
    this.onMesh = null;                 // (chunk, mesh) the renderer uploads it
    this.onUnload = null;               // (chunk)
    this.uploads = [];
    this.order = []; this.orderFor = '';
    this.generation = 0;                // bumps on setSeed: stale results are ignored
    this.genInFlight = 0; this.meshInFlight = 0;
    this.stats = { generated: 0, meshed: 0 };
  }

  async setSeed(seed, { flat = false, edits = null } = {}) {
    this.generation++;
    for (const c of this.chunks.values()) this.onUnload?.(c);
    this.chunks.clear(); this.uploads.length = 0; this.order = []; this.orderFor = '';
    this.genInFlight = 0; this.meshInFlight = 0;
    this.seed = seed >>> 0; this.flat = flat;
    this.edits = edits ?? new Map();
    await this.backend.init({ seed: this.seed, flat, worldSize: this.size, height: H, sea: CONFIG.seaLevel, snow: CONFIG.snowLine, gen: CONFIG.gen, ids: this.table.ids, blocks: this.table.blocks });
  }

  /** A world of another size (a loaded save): only valid while no chunks are loaded. */
  setSize(size) { this.size = size; this.chunksPerSide = size / CS; }

  inWorld(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.chunksPerSide && cz < this.chunksPerSide; }
  chunkAt(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }
  has(x, z) { return !!this.chunkAt(x >> 4, z >> 4)?.data; }

  /** The block at a position. Outside the world and below y = 0 is bedrock (a wall), above y = 127 is air; a chunk that is not loaded yet reads as stone, so nothing falls through it. */
  getBlock(x, y, z) {
    if (y < 0) return B.bedrock;
    if (y >= H) return B.air;
    const cx = x >> 4, cz = z >> 4;
    if (!this.inWorld(cx, cz)) return B.bedrock;
    const c = this.chunks.get(chunkKey(cx, cz));
    return c?.data ? c.data[localIndex(x & 15, y, z & 15)] : B.stone;
  }

  /** Change a block of a loaded chunk. Records the edit (or forgets it if the block is back to what the generator made) and queues the remesh. */
  setBlock(x, y, z, id) {
    if (y < 0 || y >= H) return false;
    const cx = x >> 4, cz = z >> 4, c = this.chunkAt(cx, cz);
    if (!c?.data) return false;
    const lx = x & 15, lz = z & 15, i = localIndex(lx, y, lz);
    if (c.data[i] === id) return false;
    c.data[i] = id;
    const k = chunkKey(cx, cz);
    let e = this.edits.get(k);
    if (id === c.base[i]) { e?.delete(i); if (e && !e.size) this.edits.delete(k); }
    else { if (!e) this.edits.set(k, (e = new Map())); e.set(i, id); }
    const dxs = [0, ...(lx === 0 ? [-1] : []), ...(lx === CS - 1 ? [1] : [])], dzs = [0, ...(lz === 0 ? [-1] : []), ...(lz === CS - 1 ? [1] : [])];
    for (const dz of dzs) for (const dx of dxs) { const n = this.chunkAt(cx + dx, cz + dz); if (n) { n.ver++; n.urgent = true; } }     // borders and corners change a neighbour's faces and AO
    return true;
  }

  editCount() { let n = 0; for (const e of this.edits.values()) n += e.size; return n; }

  /** Everything that must be loaded for the chunks around (px, pz): nearest first. */
  #plan(pcx, pcz) {
    const R = this.view + CONFIG.view.genExtra, tag = `${pcx},${pcz},${this.view}`;
    if (tag === this.orderFor) return this.order;
    const list = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dz);
      if (d <= R + 0.5 && this.inWorld(pcx + dx, pcz + dz)) list.push({ cx: pcx + dx, cz: pcz + dz, d });
    }
    list.sort((a, b) => a.d - b.d);
    this.order = list; this.orderFor = tag;
    return list;
  }

  #padded(c) {
    const out = new Uint8Array(PW * H * PW);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = dx === 0 && dz === 0 ? c : this.chunkAt(c.cx + dx, c.cz + dz);
      if (!n?.data) continue;
      const d = n.data;
      if (dx === 0 && dz === 0) { for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) out.set(d.subarray((y << 8) + (z << 4), (y << 8) + (z << 4) + CS), (y * PW + z + 1) * PW + 1); }
      else if (dz === 0) { const sx = dx < 0 ? CS - 1 : 0, ox = dx < 0 ? 0 : PW - 1; for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) out[(y * PW + z + 1) * PW + ox] = d[(y << 8) | (z << 4) | sx]; }
      else if (dx === 0) { const sz = dz < 0 ? CS - 1 : 0, oz = dz < 0 ? 0 : PW - 1; for (let y = 0; y < H; y++) out.set(d.subarray((y << 8) + (sz << 4), (y << 8) + (sz << 4) + CS), (y * PW + oz) * PW + 1); }
      else { const sx = dx < 0 ? CS - 1 : 0, sz = dz < 0 ? CS - 1 : 0, ox = dx < 0 ? 0 : PW - 1, oz = dz < 0 ? 0 : PW - 1; for (let y = 0; y < H; y++) out[(y * PW + oz) * PW + ox] = d[(y << 8) | (sz << 4) | sx]; }
    }
    return out;
  }

  #neighboursReady(c) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && this.inWorld(c.cx + dx, c.cz + dz) && !this.chunkAt(c.cx + dx, c.cz + dz)?.data) return false;
    return true;
  }

  #requestGen(cx, cz) {
    const c = { cx, cz, data: null, base: null, biomes: null, ver: 0, meshVer: -1, meshing: false, requested: true, urgent: false, mesh: null };
    this.chunks.set(chunkKey(cx, cz), c);
    const gen = this.generation;
    this.genInFlight++;
    this.backend.generate(cx, cz).then((r) => {
      if (gen !== this.generation) return;
      this.genInFlight--;
      if (this.chunks.get(chunkKey(cx, cz)) !== c) return;                    // unloaded meanwhile
      c.data = r.data; c.base = r.data.slice(); c.biomes = r.biomes;
      const e = this.edits.get(chunkKey(cx, cz));
      if (e) for (const [i, id] of e) c.data[i] = id;
      this.stats.generated++;
    }, (err) => { if (gen === this.generation) { this.genInFlight--; console.error('[Strata] generation failed', err); } });
    return c;
  }

  #requestMesh(c) {
    c.meshing = true; c.urgent = false;
    const ver = c.ver, gen = this.generation;
    this.meshInFlight++;
    this.backend.mesh(this.#padded(c), true).then((m) => {
      if (gen !== this.generation) return;
      this.meshInFlight--;
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) return;
      if (c.ver !== ver) { c.meshing = false; return; }                       // edited while meshing: the next update asks again, the old mesh stays until then
      this.uploads.push({ c, m, ver });                                       // c.meshing stays true until the renderer has it, so it is not asked for twice
    }, (err) => { if (gen === this.generation) { this.meshInFlight--; c.meshing = false; console.error('[Strata] meshing failed', err); } });
  }

  /**
   * Call every frame with the player's block position. Unloads far chunks, asks the backend for missing ones (nearest first, a few in flight at a
   * time), asks for meshes of chunks whose 8 neighbours are loaded, and hands at most `uploadsPerFrame` finished meshes to the renderer.
   */
  update(px, pz, uploadsPerFrame = CONFIG.view.meshPerFrame) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4, R = this.view, V = CONFIG.view;
    for (const c of [...this.chunks.values()]) {
      if (Math.hypot(c.cx - pcx, c.cz - pcz) > R + V.unloadExtra) { this.chunks.delete(chunkKey(c.cx, c.cz)); this.onUnload?.(c); }
    }
    const plan = this.#plan(pcx, pcz);
    for (const o of plan) {
      if (this.genInFlight >= V.genInFlight) break;
      if (!this.chunkAt(o.cx, o.cz)) this.#requestGen(o.cx, o.cz);
    }
    for (const o of plan) {
      if (o.d > R + 0.5) break;
      const c = this.chunkAt(o.cx, o.cz);
      if (!c?.data || c.meshing || c.meshVer === c.ver && c.mesh) continue;
      if (this.meshInFlight >= V.meshInFlight && !c.urgent) continue;
      if (this.#neighboursReady(c)) this.#requestMesh(c);
    }
    for (const c of this.chunks.values()) {                                  // edited chunks outside the plan radius (rare) are still remeshed
      if (c.urgent && c.data && !c.meshing && c.meshVer !== c.ver && this.#neighboursReady(c)) this.#requestMesh(c);
    }
    this.uploads.sort((a, b) => Math.hypot(a.c.cx - pcx, a.c.cz - pcz) - Math.hypot(b.c.cx - pcx, b.c.cz - pcz));
    for (let n = 0; n < uploadsPerFrame && this.uploads.length; n++) {
      const u = this.uploads.shift();
      u.c.meshing = false;
      if (this.chunks.get(chunkKey(u.c.cx, u.c.cz)) !== u.c || u.c.ver !== u.ver) continue;
      u.c.meshVer = u.ver; u.c.mesh = true;
      this.stats.meshed++;
      this.onMesh?.(u.c, u.m);
    }
  }

  /** Per-frame pump for the main-thread backend (a no-op for a worker). */
  pump() { return this.backend.pump(); }
  get queueLength() { return this.backend.pending + this.uploads.length; }
  get loadedCount() { let n = 0; for (const c of this.chunks.values()) if (c.data) n++; return n; }
  get meshedCount() { let n = 0; for (const c of this.chunks.values()) if (c.mesh) n++; return n; }
  /** How many chunks inside the view radius still have no mesh. */
  missingMeshes(px, pz, radius = this.view) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    let n = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.hypot(dx, dz) > radius || !this.inWorld(pcx + dx, pcz + dz)) continue;
      const c = this.chunkAt(pcx + dx, pcz + dz);
      if (!c?.mesh || c.meshVer !== c.ver) n++;
    }
    return n;
  }
  biomeAt(x, z) { const c = this.chunkAt(x >> 4, z >> 4); return c?.biomes ? CONFIG.biomes[c.biomes[((z & 15) << 4) | (x & 15)]] : '?'; }
  dispose() { this.generation++; this.backend.dispose(); this.chunks.clear(); }
}
